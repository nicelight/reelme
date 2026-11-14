"""Local camera backends; only WebcamBackend owns a persistent Live View process.

V4L2 operations share one owner. Preview retains one bounded JPEG in memory;
Live View capture waits for a newer frame, then uses the ordinary file publisher.
No physical backend falls back to mock; closing cancels owned subprocesses.
"""
from __future__ import annotations

import os
from pathlib import Path
import re
import select
import shlex
import shutil
import signal
import subprocess
import tempfile
import threading
import time
from dataclasses import dataclass, asdict
import logging

LOG = logging.getLogger("linux_digiCamControl")
ROOT = Path(__file__).resolve().parent


class CaptureError(RuntimeError):
    """Actionable camera/backend failure; no implicit retries of the shutter."""


@dataclass(frozen=True)
class Camera:
    id: str
    kind: str
    label: str
    device: str
    note: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


def _probe(argv: list[str], timeout: float = 8) -> tuple[int, str]:
    try:
        result = subprocess.run(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, text=True, errors="replace",
                                timeout=timeout, env={**os.environ, "LC_ALL": "C"})
        return result.returncode, result.stdout
    except (OSError, subprocess.TimeoutExpired) as exc:
        return -1, str(exc)


def parse_gphoto_devices(text: str) -> list[Camera]:
    found = []
    for line in text.splitlines():
        match = re.match(r"^(.+?)\s+(usb:\d+,\d+)\s*$", line.strip())
        if match:
            model, port = match.groups()
            found.append(Camera("gphoto2:" + port, "gphoto2", model.strip(), port))
    return found


def v4l_capture_capability(text: str) -> bool:
    # A UVC webcam can expose both a video node and a metadata-only node.
    # Device Caps (when present) overrides the union in Capabilities.
    match = re.search(r"Device Caps\s*:", text, re.I)
    section = text[match.end():] if match else text
    return bool(re.search(r"^\s*Video Capture(?:\s+Multiplanar)?\s*$", section, re.M))


def discover() -> tuple[list[Camera], list[str]]:
    cameras: list[Camera] = []
    warnings: list[str] = []
    if shutil.which("gphoto2"):
        code, out = _probe(["gphoto2", "--auto-detect"])
        if code == 0:
            cameras.extend(parse_gphoto_devices(out))
        else:
            warnings.append("gphoto2: " + out[-1200:].strip())
    else:
        warnings.append("gphoto2 не установлен: USB-фотоаппараты не опрошены.")
    have_ctl = bool(shutil.which("v4l2-ctl"))
    for node in sorted(Path("/dev").glob("video[0-9]*"),
                       key=lambda p: int(re.search(r"\d+$", p.name).group())):
        name_path = Path("/sys/class/video4linux") / node.name / "name"
        try:
            label = name_path.read_text().strip()
        except OSError:
            label = node.name
        note = ""
        if have_ctl:
            code, out = _probe(["v4l2-ctl", "--device", str(node), "--all"], timeout=3)
            if code == 0 and not v4l_capture_capability(out):
                continue
            if code:
                note = "Не удалось проверить доступ/возможности: " + out[-250:].strip()
        else:
            note = "Тип узла не проверен (нет v4l2-ctl); возможен metadata-узел."
        cameras.append(Camera("v4l2:" + str(node), "v4l2", label, str(node), note))
    if not shutil.which("ffmpeg"):
        warnings.append("ffmpeg не установлен: захват с веб-камер недоступен.")
    return cameras, warnings


def direct_camera(identifier: str) -> Camera | None:
    if identifier == "mock":
        return Camera("mock", "mock", "DEMO / синтетическое изображение, НЕ камера", "mock")
    if identifier.startswith("gphoto2:"):
        port = identifier[len("gphoto2:"):]
        if re.fullmatch(r"usb:\d+,\d+", port):
            return Camera(identifier, "gphoto2", "USB-фотоаппарат " + port, port)
    device = identifier[len("v4l2:"):] if identifier.startswith("v4l2:") else identifier
    if device.startswith("/dev/"):
        return Camera("v4l2:" + device, "v4l2", "Веб-камера " + device, device)
    return None


def jpeg_info(data: bytes) -> tuple[int, int]:
    """Check JPEG envelope and extract SOF dimensions, without recompressing it.

    This is structural validation, not a full entropy-stream decoder. The browser
    test additionally decodes every image. Legitimate trailing bytes after EOI
    are accepted.
    """
    if len(data) < 4 or data[:2] != b"\xff\xd8" or b"\xff\xd9" not in data[2:]:
        raise CaptureError("Нет полного JPEG. На фотоаппарате нужен JPEG или RAW+JPEG.")
    sof = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
           0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
    pos = 2
    while pos + 1 < len(data):
        if data[pos] != 0xFF:
            raise CaptureError("Некорректная структура JPEG.")
        while pos < len(data) and data[pos] == 0xFF:
            pos += 1
        if pos >= len(data):
            break
        marker = data[pos]
        pos += 1
        if marker in (0xDA, 0xD9):
            break
        if marker in range(0xD0, 0xD9) or marker == 0x01:
            continue
        if pos + 2 > len(data):
            break
        length = int.from_bytes(data[pos:pos + 2], "big")
        if length < 2 or pos + length > len(data):
            raise CaptureError("Обрезанный сегмент JPEG.")
        if marker in sof:
            if length < 8:
                raise CaptureError("Неверный JPEG SOF.")
            height = int.from_bytes(data[pos + 3:pos + 5], "big")
            width = int.from_bytes(data[pos + 5:pos + 7], "big")
            if not (0 < width <= 65535 and 0 < height <= 65535):
                raise CaptureError("Неверные размеры JPEG.")
            return width, height
        pos += length
    raise CaptureError("Не удалось найти размеры JPEG.")


class Runner:
    """Bounded subprocess execution; cancellation terminates its process group."""
    def __init__(self, cancel: threading.Event):
        self.cancel = cancel

    def run(self, argv: list[str], cwd: Path, timeout: float) -> str:
        if self.cancel.is_set():
            raise CaptureError("Съёмка отменена: сервер останавливается.")
        LOG.debug("EXEC %s", shlex.join(argv))
        with tempfile.TemporaryFile() as output:
            try:
                proc = subprocess.Popen(argv, cwd=str(cwd), stdin=subprocess.DEVNULL,
                                        stdout=output, stderr=subprocess.STDOUT,
                                        start_new_session=True,
                                        env={**os.environ, "LC_ALL": "C"})
            except FileNotFoundError as exc:
                raise CaptureError(f"Не установлен {argv[0]}.") from exc
            deadline = time.monotonic() + timeout
            reason = None
            while proc.poll() is None:
                if self.cancel.is_set():
                    reason = "Съёмка отменена: сервер останавливается."
                    break
                if time.monotonic() >= deadline:
                    reason = f"Тайм-аут {argv[0]} ({timeout:g} с)."
                    break
                time.sleep(0.05)
            if reason:
                try:
                    os.killpg(proc.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    proc.wait(timeout=1.5)
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(proc.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    proc.wait()
            else:
                proc.wait()
            output.seek(0, os.SEEK_END)
            output.seek(max(0, output.tell() - 12000))
            tail = output.read().decode("utf-8", errors="replace").strip()
            if tail:
                LOG.debug("%s output: %s", argv[0], tail)
            if reason:
                raise CaptureError(reason + ("\n" + tail if tail else ""))
            if proc.returncode:
                raise CaptureError(f"{argv[0]} завершился с кодом {proc.returncode}.\n{tail}")
            return tail


class Backend:
    def __init__(self, camera: Camera, cancel: threading.Event, timeout: float = 25):
        self.camera, self.cancel, self.timeout = camera, cancel, timeout
        self.runner = Runner(cancel)

    supports_live_view = False

    def capture(self, work: Path, job_id: str) -> Path:
        raise NotImplementedError

    def close(self) -> None:
        self.cancel.set()


class GPhotoBackend(Backend):
    def capture(self, work: Path, job_id: str) -> Path:
        # Relative pattern avoids treating '%' in a user's directory as a template.
        # --keep prevents gphoto2's default deletion of downloaded camera files.
        self.runner.run(["gphoto2", "--port", self.camera.device,
                         "--keep", "--filename", "capture-%03n.%C",
                         "--capture-image-and-download"], work, self.timeout)
        images = [p for p in work.iterdir() if p.is_file() and p.suffix.lower() in {".jpg", ".jpeg"}]
        if len(images) != 1:
            raise CaptureError(
                f"После одной команды получено JPEG: {len(images)}. "
                "Нужен одиночный кадр в JPEG или RAW+JPEG; отключите брекетинг/серийный режим. "
                "Скачанные файлы оставлены в .work для диагностики.")
        return images[0]


class WebcamBackend(Backend):
    supports_live_view = True
    frame_timeout = 3.0
    preview_max_age = 2.0
    idle_timeout = 15.0
    max_frame_bytes = 64 * 1024 * 1024

    def __init__(self, *args, size: str | None = None, fps: float | None = None,
                 input_format: str | None = None, warmup: float = 0.7, **kwargs):
        super().__init__(*args, **kwargs)
        self.size, self.fps, self.input_format, self.warmup = size, fps, input_format, warmup
        self.operation = threading.RLock()
        self.frames = threading.Condition()
        self.live_stop = threading.Event()
        self.live_thread: threading.Thread | None = None
        self.live_frame: bytes | None = None
        self.live_sequence = 0
        self.live_at = self.live_access = 0.0
        self.live_error: str | None = None

    def command(self, filename: str = "webcam.jpg") -> list[str]:
        argv = ["ffmpeg", "-hide_banner", "-loglevel", "warning", "-nostdin", "-y",
                "-f", "video4linux2"]
        if self.input_format:
            argv += ["-input_format", self.input_format]
        if self.size:
            argv += ["-video_size", self.size]
        if self.fps:
            argv += ["-framerate", str(self.fps)]
        argv += ["-i", self.camera.device, "-an",
                 "-vf", f"setpts=PTS-STARTPTS,select=gte(t\\,{self.warmup:g})",
                 "-frames:v", "1", "-c:v", "mjpeg", "-q:v", "2",
                 "-threads", "1", "-f", "image2", "-update", "1", filename]
        return argv

    def stream_command(self) -> list[str]:
        # UVC timestamps can quantize to duplicate encoder PTS. After warmup,
        # assign one timestamp per frame at the input's declared nominal rate.
        # JPEG polling uses arrival time; no audio/video timeline is exposed.
        argv = self.command()
        argv[argv.index("-vf") + 1] += ",setpts=N/(FRAME_RATE*TB)"
        return argv[:argv.index("-frames:v")] + [
            "-fps_mode", "passthrough", "-c:v", "mjpeg", "-q:v", "2",
            "-threads", "1", "-f", "image2pipe", "-flush_packets", "1", "pipe:1"]

    def _check_size(self, data: bytes) -> None:
        width, height = jpeg_info(data)
        if self.size and f"{width}x{height}" != self.size:
            raise CaptureError(f"Запрошено {self.size}, драйвер выдал {width}x{height}. "
                               "Выберите поддерживаемый --size.")

    def _stream(self) -> None:
        proc = None
        error = None
        with tempfile.TemporaryFile() as output:
            try:
                argv = self.stream_command()
                LOG.debug("LIVE VIEW EXEC %s", shlex.join(argv))
                proc = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                        stderr=output, start_new_session=True,
                                        env={**os.environ, "LC_ALL": "C"})
                buffer = bytearray()
                last_frame = time.monotonic()
                while not self.live_stop.is_set() and not self.cancel.is_set():
                    now = time.monotonic()
                    with self.frames:
                        if now - self.live_access >= self.idle_timeout:
                            LOG.info("Live View остановлен: нет запросов %g с", self.idle_timeout)
                            break
                    if now - last_frame > self.frame_timeout + (self.warmup if not self.live_frame else 0):
                        raise CaptureError("Live View: камера перестала передавать кадры.")
                    ready, _, _ = select.select([proc.stdout], [], [], .1)
                    if not ready:
                        continue
                    chunk = os.read(proc.stdout.fileno(), 65536)
                    if not chunk:
                        raise CaptureError("Live View: поток FFmpeg завершился; проверьте камеру.")
                    buffer.extend(chunk)
                    if len(buffer) > self.max_frame_bytes:
                        raise CaptureError("Live View: JPEG превышает 64 МиБ.")
                    # FFmpeg's own MJPEG encoder emits complete SOI/EOI-delimited frames,
                    # without camera EXIF/embedded thumbnail payloads.
                    while True:
                        end = buffer.find(b"\xff\xd9")
                        if end < 0:
                            break
                        data = bytes(buffer[:end + 2])
                        del buffer[:end + 2]
                        self._check_size(data)
                        last_frame = time.monotonic()
                        with self.frames:
                            self.live_frame = data
                            self.live_at = last_frame
                            self.live_sequence += 1
                            self.frames.notify_all()
            except Exception as exc:
                if not self.live_stop.is_set() and not self.cancel.is_set():
                    error = str(exc)
            finally:
                if proc:
                    if proc.poll() is None:
                        try:
                            os.killpg(proc.pid, signal.SIGTERM)
                        except ProcessLookupError:
                            pass
                        try:
                            proc.wait(timeout=1.5)
                        except subprocess.TimeoutExpired:
                            os.killpg(proc.pid, signal.SIGKILL)
                            proc.wait()
                    proc.stdout.close()
                output.seek(0, os.SEEK_END)
                output.seek(max(0, output.tell() - 4000))
                tail = output.read().decode("utf-8", errors="replace").strip()
                if tail:
                    LOG.debug("Live View FFmpeg: %s", tail)
                if error:
                    LOG.warning("%s%s", error, "\n" + tail if tail else "")
                with self.frames:
                    self.live_frame = None
                    self.live_error = error
                    self.frames.notify_all()

    def _wait_frame(self, after: int, timeout: float) -> bytes:
        deadline = time.monotonic() + timeout
        with self.frames:
            while True:
                if self.cancel.is_set() or self.live_stop.is_set():
                    raise CaptureError("Live View остановлен.")
                if self.live_error:
                    raise CaptureError(self.live_error)
                if self.live_frame and self.live_sequence > after and time.monotonic() - self.live_at <= self.preview_max_age:
                    return self.live_frame
                if not self.live_thread or not self.live_thread.is_alive():
                    raise CaptureError("Live View не запущен.")
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise CaptureError("Live View: не получен свежий кадр.")
                self.frames.wait(min(.1, remaining))

    def start_live_view(self) -> None:
        with self.operation:
            if self.cancel.is_set():
                raise CaptureError("Сервер останавливается.")
            with self.frames:
                self.live_access = time.monotonic()
                running = self.live_thread and self.live_thread.is_alive()
            if not running:
                self.live_stop.clear()
                with self.frames:
                    self.live_error = None
                    self.live_frame = None
                self.live_thread = threading.Thread(target=self._stream, name="camera-live-view", daemon=False)
                self.live_thread.start()
            try:
                self._wait_frame(-1, min(self.timeout, 4))
            except CaptureError:
                self.stop_live_view()
                raise

    def stop_live_view(self) -> None:
        with self.operation:
            self.live_stop.set()
            with self.frames:
                self.frames.notify_all()
            if self.live_thread:
                self.live_thread.join(timeout=4)
            with self.frames:
                self.live_frame = None
                self.live_error = None

    def preview(self) -> bytes:
        with self.frames:
            self.live_access = time.monotonic()
            if self.live_error:
                raise CaptureError(self.live_error)
            if (not self.live_frame or self.live_stop.is_set() or self.cancel.is_set()
                    or time.monotonic() - self.live_at > self.preview_max_age):
                raise CaptureError("Live View: нет свежего кадра; запустите превью заново.")
            return self.live_frame

    def capture(self, work: Path, job_id: str) -> Path:
        with self.operation:
            with self.frames:
                running = self.live_thread and self.live_thread.is_alive()
                marker = self.live_sequence
                self.live_access = time.monotonic()
                if self.live_error:
                    raise CaptureError(self.live_error)
            path = work / "webcam.jpg"
            if running:
                # Never reuse the preview that existed when this capture began.
                path.write_bytes(self._wait_frame(marker, self.timeout))
            else:
                self.runner.run(self.command(), work, self.timeout)
                if not path.is_file():
                    raise CaptureError("FFmpeg не создал JPEG.")
                self._check_size(path.read_bytes())
            return path

    def close(self) -> None:
        self.cancel.set()
        self.stop_live_view()


class MockBackend(Backend):
    def __init__(self, *args, delay: float = 0.25, **kwargs):
        super().__init__(*args, **kwargs)
        self.delay = delay

    def capture(self, work: Path, job_id: str) -> Path:
        if self.cancel.wait(self.delay):
            raise CaptureError("DEMO: съёмка отменена.")
        data = (ROOT / "fixtures" / "demo.jpg").read_bytes()
        # Unique, valid JPEG COM metadata. Pixels clearly say DEMO / NO CAMERA.
        comment = ("linux_digiCamControl MOCK " + job_id).encode("ascii")
        data = data[:2] + b"\xff\xfe" + (len(comment) + 2).to_bytes(2, "big") + comment + data[2:]
        path = work / "demo.jpg"
        path.write_bytes(data)
        return path
