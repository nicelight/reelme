#!/usr/bin/env python3
"""Local digiCamControl-compatible photo bridge for ReelMe (not a full emulator).

Python 3.10+; no pip dependencies. See README.md and AGENTS.md.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from email import policy
from email.parser import BytesParser
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
import math
import mimetypes
import os
from pathlib import Path
import shutil
import signal
import socket
import sys
import threading
import time
from urllib.parse import parse_qs, unquote, urlsplit
import uuid
import webbrowser

from cameras import (Backend, Camera, CaptureError, GPhotoBackend, MockBackend,
                     WebcamBackend, direct_camera, discover, jpeg_info)

ROOT = Path(__file__).resolve().parent
APP = "linux_digiCamControl"
VERSION = "1.0.0"
LOG = logging.getLogger(APP)
MAX_UPLOAD = 96 * 1024 * 1024
MAX_IMAGE = 64 * 1024 * 1024


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


class Controller:
    def __init__(self, backend: Backend, folder: Path):
        self.backend = backend
        self.folder = folder.resolve()
        self.folder.mkdir(parents=True, exist_ok=False, mode=0o700)
        (self.folder / ".work").mkdir(mode=0o700)
        self.lock = threading.RLock()
        self.files: list[dict] = []
        self.busy = False
        self.closed = False
        self.job: dict | None = None
        self.worker: threading.Thread | None = None
        self.started = utcnow()
        self.persist()

    def status(self) -> dict:
        with self.lock:
            return {
                "app": APP, "version": VERSION,
                "simulated": self.backend.camera.kind == "mock",
                "camera": self.backend.camera.to_dict(),
                "busy": self.busy, "closed": self.closed,
                "started_at": self.started,
                "session": self.folder.name,
                "file_count": len(self.files),
                "last_job": dict(self.job) if self.job else None,
                "features": {"local_test_upload": True, "live_view": self.backend.supports_live_view},
            }

    def file_list(self) -> list[dict]:
        with self.lock:
            return [dict(item) for item in self.files]

    def persist(self) -> None:
        with self.lock:
            document = {"status": self.status(), "files": self.file_list()}
            tmp = self.folder / ".session.json.tmp"
            tmp.write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")
            tmp.replace(self.folder / "session.json")

    def live_view(self, action: str) -> bytes | None:
        if not self.backend.supports_live_view:
            raise ApiError(501, "Live View поддерживается только для V4L2-веб-камер.")
        with self.lock:
            if self.closed:
                raise ApiError(503, "Сервер останавливается.")
            if action != "preview" and self.busy:
                raise ApiError(409, "Дождитесь завершения текущей съёмки.")
        if action == "start":
            self.backend.start_live_view()
        elif action == "stop":
            self.backend.stop_live_view()
        else:
            return self.backend.preview()

    def request_capture(self, live_view: bool = False) -> str:
        if live_view and not self.backend.supports_live_view:
            raise ApiError(501, "Live View поддерживается только для V4L2-веб-камер.")
        with self.lock:
            if self.closed:
                raise ApiError(503, "Сервер останавливается.")
            if self.busy:
                raise ApiError(409, "Камера занята. Повторный спуск не поставлен в очередь.")
            job_id = uuid.uuid4().hex
            self.busy = True
            self.job = {"id": job_id, "state": "capturing", "started_at": utcnow(),
                        "error": None, "file": None}
            self.worker = threading.Thread(target=self._capture, args=(job_id,),
                                           name="camera-capture", daemon=False)
            self.worker.start()
            return job_id

    def _capture(self, job_id: str) -> None:
        start = time.monotonic()
        work = self.folder / ".work" / job_id
        try:
            work.mkdir(mode=0o700)
            LOG.info("CAPTURE start job=%s camera=%s", job_id, self.backend.camera.id)
            source = self.backend.capture(work, job_id)
            if self.backend.cancel.is_set():
                raise CaptureError("Сервер остановлен до публикации фотографии.")
            if source.stat().st_size > MAX_IMAGE:
                raise CaptureError("JPEG превышает ограничение 64 МиБ.")
            data = source.read_bytes()
            width, height = jpeg_info(data)
            digest = hashlib.sha256(data).hexdigest()
            name = datetime.now(timezone.utc).strftime("reelme-%Y%m%dT%H%M%S-") + job_id[:12] + ".jpg"
            destination = self.folder / name
            # Publish only a completely downloaded, validated file. No resize/re-encode.
            source.replace(destination)
            record = {"FileName": str(destination), "Name": name,
                      "Original": "/image/" + name,
                      "Width": width, "Height": height,
                      "Size": len(data), "Sha256": digest,
                      "CapturedAt": utcnow(), "JobId": job_id,
                      "Simulated": self.backend.camera.kind == "mock"}
            with self.lock:
                self.files.append(record)
                self.job.update(state="done", file=name, error=None,
                                finished_at=utcnow(), elapsed_ms=round((time.monotonic() - start) * 1000))
                self.busy = False
            try:
                work.rmdir()  # Only remove an empty directory; RAW/partial files are kept.
            except OSError:
                pass
            LOG.info("CAPTURE done job=%s name=%s bytes=%s size=%sx%s sha256=%s",
                     job_id, name, len(data), width, height, digest)
        except Exception as exc:
            LOG.exception("CAPTURE failed job=%s", job_id)
            with self.lock:
                self.job.update(state="error", error=str(exc), finished_at=utcnow(),
                                elapsed_ms=round((time.monotonic() - start) * 1000))
                self.busy = False
        finally:
            try:
                self.persist()
            except OSError:
                LOG.exception("Cannot persist session manifest")

    def lastcaptured(self) -> str:
        with self.lock:
            if self.busy:
                return "-"
            return self.files[-1]["Name"] if self.files else ""

    def image_path(self, name: str) -> Path:
        if not name or "/" in name or "\\" in name or name in {".", ".."}:
            raise ApiError(404, "Фотография не найдена.")
        with self.lock:
            if not any(item["Name"] == name for item in self.files):
                raise ApiError(404, "Фотография отсутствует в текущей сессии.")
        path = self.folder / name
        if path.is_symlink() or not path.is_file():
            raise ApiError(404, "Файл отсутствует.")
        return path

    def close(self) -> None:
        with self.lock:
            self.closed = True
            self.backend.cancel.set()
            worker = self.worker
        self.backend.close()
        if worker and worker is not threading.current_thread():
            worker.join(timeout=8)
        self.persist()


def validate_upload(body: bytes, content_type: str) -> list[dict]:
    if not content_type.lower().startswith("multipart/form-data") or "\n" in content_type or "\r" in content_type:
        raise ApiError(415, "Ожидается multipart/form-data.")
    if len(content_type) > 512:
        raise ApiError(400, "Слишком длинный Content-Type.")
    try:
        message = BytesParser(policy=policy.default).parsebytes(
            b"Content-Type: " + content_type.encode("ascii") + b"\r\nMIME-Version: 1.0\r\n\r\n" + body)
    except (ValueError, UnicodeError) as exc:
        raise ApiError(400, "Некорректный multipart.") from exc
    if not message.is_multipart() or message.defects:
        raise ApiError(400, "Некорректные границы multipart.")
    records = []
    for part in message.iter_parts():
        if part.defects or part.is_multipart():
            raise ApiError(400, "Некорректная часть multipart.")
        if part.get_content_disposition() != "form-data":
            raise ApiError(400, "Ожидается form-data.")
        if part.get_param("name", header="content-disposition") != "photos":
            raise ApiError(400, "Все файлы должны иметь имя поля photos.")
        name = part.get_filename()
        if not name:
            raise ApiError(400, "Отсутствует имя JPEG.")
        data = part.get_payload(decode=True)
        if not data or len(data) > MAX_IMAGE:
            raise ApiError(400, "Пустой или слишком большой JPEG.")
        try:
            width, height = jpeg_info(data)
        except CaptureError as exc:
            raise ApiError(400, str(exc)) from exc
        records.append({"name": name.replace("\\", "/").split("/")[-1], "size": len(data),
                        "sha256": hashlib.sha256(data).hexdigest(), "width": width, "height": height})
        if len(records) > 6:
            raise ApiError(400, "В локальном тесте допускается не более 6 фотографий.")
    if not records:
        raise ApiError(400, "В запросе нет фотографий.")
    return records


class CameraHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address: tuple[str, int], controller: Controller, webroot: Path):
        self.controller = controller
        self.webroot = webroot.resolve()
        super().__init__(address, Handler)

    def get_request(self):
        sock, address = super().get_request()
        sock.settimeout(15)
        return sock, address


class Handler(BaseHTTPRequestHandler):
    server_version = "linux_digiCamControl/" + VERSION
    sys_version = ""
    protocol_version = "HTTP/1.0"  # Close each connection; no indefinite keepalive.

    def log_message(self, fmt: str, *args) -> None:
        LOG.debug("HTTP %s %s", self.client_address[0], fmt % args)

    def guard(self) -> None:
        port = self.server.server_address[1]
        allowed_hosts = {f"localhost:{port}", f"127.0.0.1:{port}"}
        if port == 80:
            allowed_hosts |= {"localhost", "127.0.0.1"}
        host = self.headers.get("Host", "").lower()
        if host not in allowed_hosts:
            raise ApiError(403, "Недопустимый Host. Используйте localhost или 127.0.0.1.")
        # Entry-page navigation is safe across sites; camera commands and media
        # still require same-origin requests. No query can bypass the guard.
        target = urlsplit(self.path)
        if (self.command in {"GET", "HEAD"}
                and target.path in {"/", "/reelme.html", "/reelme-test.html", "/liveview.html"}
                and not target.query
                and self.headers.get("Sec-Fetch-Mode") == "navigate"
                and self.headers.get("Sec-Fetch-Dest") == "document"):
            return
        expected = "http://" + host
        origin = self.headers.get("Origin")
        if origin is not None and origin.lower() != expected:
            raise ApiError(403, "Междоменный доступ запрещён. Откройте страницу на этом сервере.")
        referer = self.headers.get("Referer")
        if referer:
            parsed = urlsplit(referer)
            if f"{parsed.scheme}://{parsed.netloc}".lower() != expected:
                raise ApiError(403, "Запрос пришёл с другой страницы/origin.")
        if self.headers.get("Sec-Fetch-Site", "") not in {"", "none", "same-origin"}:
            raise ApiError(403, "Cross-site запрос запрещён.")

    def send_bytes(self, body: bytes, kind: str = "text/plain; charset=utf-8", code: int = 200,
                   extra: dict | None = None) -> None:
        self.send_response(code)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("X-Frame-Options", "DENY")
        for key, value in (extra or {}).items():
            self.send_header(key, str(value))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_json(self, data: dict | list, code: int = 200) -> None:
        self.send_bytes(json.dumps(data, ensure_ascii=False).encode("utf-8"),
                        "application/json; charset=utf-8", code)

    def send_file(self, path: Path) -> None:
        try:
            data = path.read_bytes()
        except FileNotFoundError as exc:
            raise ApiError(404, "Файл не найден.") from exc
        kind = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if kind.startswith("text/") or kind in {"application/javascript", "application/json"}:
            kind += "; charset=utf-8"
        self.send_bytes(data, kind)

    def _dispatch(self) -> None:
        self.guard()
        split = urlsplit(self.path)
        path = unquote(split.path)
        query = {k.lower(): v[0] for k, v in parse_qs(split.query, keep_blank_values=True).items()}
        ctl = self.server.controller
        if self.command == "OPTIONS":
            self.send_bytes(b"", code=204)
            return
        if self.command == "POST":
            if path != "/test-upload":
                raise ApiError(404, "POST endpoint не найден.")
            if self.headers.get("Transfer-Encoding"):
                raise ApiError(400, "Chunked-загрузка в этом тестовом сервере не поддерживается.")
            length_text = self.headers.get("Content-Length")
            if length_text is None:
                raise ApiError(411, "Нужен Content-Length.")
            try:
                length = int(length_text)
            except ValueError as exc:
                raise ApiError(400, "Неверный Content-Length.") from exc
            if not 0 < length <= MAX_UPLOAD:
                raise ApiError(413, "Ограничение загрузки: 96 МиБ.")
            body = self.rfile.read(length)
            if len(body) != length:
                raise ApiError(400, "Тело запроса получено не полностью.")
            files = validate_upload(body, self.headers.get("Content-Type", ""))
            LOG.info("LOCAL UPLOAD verified files=%s bytes=%s (not stored)", len(files), length)
            self.send_json({"ok": True, "files": files, "bytes_received": length,
                            "stored": False, "local_only": True})
            return
        if self.command not in {"GET", "HEAD"}:
            raise ApiError(405, "Метод не поддерживается.")
        if "cmd" in query or "slc" in query:
            if path not in {"/", "/index.html", "/liveview.html"}:
                raise ApiError(400, "Команды принимаются только на / или /liveview.html.")
            if "cmd" in query and "slc" in query:
                raise ApiError(400, "Укажите одну команду.")
            cmd, slc = query.get("cmd", "").lower(), query.get("slc", "").lower()
            if cmd in {"liveviewwnd_show", "liveviewwnd_hide", "liveviewwnd_close"}:
                if self.command == "HEAD":
                    raise ApiError(405, "HEAD не управляет камерой.")
                ctl.live_view("start" if cmd == "liveviewwnd_show" else "stop")
                self.send_bytes(b"OK")
                return
            if cmd in {"capture", "liveview_capture"} or slc == "capture":
                if self.command == "HEAD":
                    raise ApiError(405, "HEAD никогда не вызывает съёмку.")
                if query.get("param1") or query.get("param2"):
                    raise ApiError(501, "Выбор имени файла через slc не реализован.")
                requested = query.get("camera")
                if requested and requested not in {ctl.backend.camera.id, ctl.backend.camera.label}:
                    raise ApiError(400, "Доступна только камера, выбранная в CLI.")
                job_id = ctl.request_capture(live_view=cmd == "liveview_capture")
                self.send_bytes(b"OK", extra={"X-Capture-Id": job_id})
                return
            if slc == "get" and query.get("param1", "").lower() == "lastcaptured":
                self.send_bytes(ctl.lastcaptured().encode("utf-8"))
                return
            raise ApiError(501, "Эта команда digiCamControl не реализована; поддерживается фотосъёмка.")
        if path in {"/health", "/status.json"}:
            self.send_json(ctl.status())
        elif path == "/filelist.json":
            self.send_json(ctl.file_list())
        elif path == "/session.json":
            self.send_json({"Name": ctl.folder.name, "Folder": str(ctl.folder),
                            "Files": ctl.file_list(), "Bridge": ctl.status()})
        elif path.startswith("/image/"):
            self.send_file(ctl.image_path(path[len("/image/"):]))
        elif path == "/preview.jpg":
            items = ctl.file_list()
            if not items:
                raise ApiError(404, "Фотографий ещё нет.")
            self.send_file(ctl.image_path(items[-1]["Name"]))
        elif path in {"/liveview.jpg", "/liveviewwebcam.jpg"}:
            self.send_bytes(ctl.live_view("preview"), "image/jpeg")
        else:
            relative = path.lstrip("/") or "reelme-test.html"
            if "\\" in relative or any(x.startswith(".") for x in relative.split("/")):
                raise ApiError(404, "Файл не найден.")
            candidate = (self.server.webroot / relative).resolve()
            if not candidate.is_relative_to(self.server.webroot) or not candidate.is_file():
                raise ApiError(404, "Файл не найден.")
            self.send_file(candidate)

    def handle_request_safely(self) -> None:
        try:
            self._dispatch()
        except ApiError as exc:
            self.send_json({"error": str(exc)}, exc.status)
        except CaptureError as exc:
            self.send_json({"error": str(exc)}, 503)
        except (BrokenPipeError, ConnectionResetError):
            LOG.debug("Client disconnected")
        except (TimeoutError, socket.timeout):
            LOG.warning("HTTP client timeout")
            try:
                self.send_json({"error": "HTTP timeout"}, 408)
            except OSError:
                pass
        except Exception:
            LOG.exception("HTTP error")
            try:
                self.send_json({"error": "Ошибка сервера; смотрите server.log"}, 500)
            except OSError:
                pass

    do_GET = do_HEAD = do_POST = do_OPTIONS = handle_request_safely


def setup_logging(folder: Path, verbose: bool) -> None:
    LOG.setLevel(logging.DEBUG)
    formatter = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    stream = logging.StreamHandler()
    stream.setLevel(logging.DEBUG if verbose else logging.INFO)
    stream.setFormatter(formatter)
    file = logging.FileHandler(folder / "server.log", encoding="utf-8")
    file.setLevel(logging.DEBUG)
    file.setFormatter(formatter)
    LOG.addHandler(stream)
    LOG.addHandler(file)


def positive(value: str) -> float:
    number = float(value)
    if not math.isfinite(number) or number <= 0:
        raise argparse.ArgumentTypeError("Нужно положительное конечное число.")
    return number


def nonnegative(value: str) -> float:
    number = float(value)
    if not math.isfinite(number) or number < 0:
        raise argparse.ArgumentTypeError("Нужно неотрицательное конечное число.")
    return number


def make_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Linux camera bridge для ReelMe; только localhost.")
    parser.add_argument("--version", action="version", version=APP + " " + VERSION)
    sub = parser.add_subparsers(dest="command")
    listing = sub.add_parser("list", help="Список USB-фотоаппаратов и веб-камер")
    listing.add_argument("--json", action="store_true", help="Машиночитаемый вывод")
    serve = sub.add_parser("serve", help="Выбрать камеру и запустить HTTP-сервер")
    serve.add_argument("--camera", help="ID из list, номер, /dev/video0 или mock")
    serve.add_argument("--port", type=int, default=5513)
    serve.add_argument("--web-root", type=Path, default=ROOT / "web")
    serve.add_argument("--data-dir", type=Path, default=ROOT / "data")
    serve.add_argument("--capture-timeout", type=positive, default=25)
    serve.add_argument("--size", help="Размер для веб-камеры, например 1280x720; по умолчанию драйвер")
    serve.add_argument("--fps", type=positive, help="Частота для веб-камеры; по умолчанию драйвер")
    serve.add_argument("--input-format", help="Формат V4L2/FFmpeg, например mjpeg или yuyv422")
    serve.add_argument("--warmup", type=nonnegative, default=0.7, help="Пропустить первые N секунд веб-камеры")
    serve.add_argument("--open-browser", action="store_true")
    serve.add_argument("--verbose", action="store_true")
    return parser


def select_camera(identifier: str | None) -> Camera:
    # Direct identifiers avoid discovery opening an unrelated active device.
    if identifier:
        direct = direct_camera(identifier)
        if direct:
            return direct
    cameras, warnings = discover()
    for warning in warnings:
        print("Примечание:", warning, file=sys.stderr)
    if identifier:
        if identifier.isdigit() and 1 <= int(identifier) <= len(cameras):
            return cameras[int(identifier) - 1]
        for camera in cameras:
            if identifier == camera.id:
                return camera
        raise CaptureError("Камера не найдена. Выполните: python3 linux_digicamcontrol.py list")
    for index, camera in enumerate(cameras, 1):
        print(f"  {index}. [{camera.kind}] {camera.label}\n     {camera.id}")
        if camera.note:
            print("     " + camera.note)
    print("  m. DEMO — синтетические JPEG, без камеры\n  q. Выход")
    if not sys.stdin.isatty():
        raise CaptureError("Нет интерактивного терминала: укажите --camera ID или --camera mock.")
    while True:
        answer = input("Выберите камеру: ").strip().lower()
        if answer in {"q", "quit"}:
            raise SystemExit(0)
        if answer == "m":
            return direct_camera("mock")
        if answer.isdigit() and 1 <= int(answer) <= len(cameras):
            return cameras[int(answer) - 1]
        print("Введите номер, m или q.")


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if not argv:
        argv = ["serve"]
    parser = make_parser()
    args = parser.parse_args(argv)
    if args.command == "list":
        cameras, warnings = discover()
        if args.json:
            print(json.dumps({"cameras": [c.to_dict() for c in cameras], "warnings": warnings},
                             ensure_ascii=False, indent=2))
        else:
            for index, camera in enumerate(cameras, 1):
                print(f"{index}. {camera.label}\n   {camera.id}" + ("\n   " + camera.note if camera.note else ""))
            for warning in warnings:
                print("Примечание:", warning, file=sys.stderr)
            if not cameras:
                print("Физические камеры не найдены. Демо: serve --camera mock")
        return 0
    if args.command != "serve":
        parser.print_help()
        return 0
    if not 0 <= args.port <= 65535:
        parser.error("Порт должен быть от 0 до 65535 (0 = свободный порт).")
    import re
    if args.size and not re.fullmatch(r"[1-9]\d{0,4}x[1-9]\d{0,4}", args.size):
        parser.error("--size должен иметь вид 1280x720.")
    if args.warmup >= args.capture_timeout:
        parser.error("--warmup должен быть меньше --capture-timeout.")
    if not args.web_root.is_dir():
        parser.error("--web-root: папка не существует.")
    controller = server = None
    try:
        camera = select_camera(args.camera)
        dependency = {"gphoto2": "gphoto2", "v4l2": "ffmpeg"}.get(camera.kind)
        if dependency and not shutil.which(dependency):
            raise CaptureError(f"Не установлен {dependency}. См. README.md.")
        if camera.kind == "v4l2" and not Path(camera.device).exists():
            raise CaptureError(f"Устройство не существует: {camera.device}")
        if camera.kind == "v4l2" and not os.access(camera.device, os.R_OK | os.W_OK):
            raise CaptureError(f"Нет доступа к {camera.device}. См. README.md; не запускайте сервер через sudo.")
        cancel = threading.Event()
        if camera.kind == "gphoto2":
            backend = GPhotoBackend(camera, cancel, args.capture_timeout)
        elif camera.kind == "v4l2":
            backend = WebcamBackend(camera, cancel, args.capture_timeout, size=args.size,
                                    fps=args.fps, input_format=args.input_format, warmup=args.warmup)
        else:
            backend = MockBackend(camera, cancel, args.capture_timeout)
        session_id = datetime.now(timezone.utc).strftime("session-%Y%m%dT%H%M%S-") + uuid.uuid4().hex[:8]
        folder = args.data_dir.resolve() / session_id
        controller = Controller(backend, folder)
        setup_logging(folder, args.verbose)
        server = CameraHTTPServer(("127.0.0.1", args.port), controller, args.web_root)
        url = f"http://localhost:{server.server_address[1]}/reelme-test.html"
        LOG.info("%s %s; camera=%s", APP, VERSION, camera.id)
        LOG.info("Открыть: %s", url)
        LOG.info("Фото и журнал: %s", folder)
        if camera.kind == "mock":
            LOG.warning("DEMO: используются синтетические фото, физическая камера НЕ проверяется.")
        LOG.info("Остановка: Ctrl+C. Сеть: только 127.0.0.1; никуда не загружаем фотографии.")
        if args.open_browser:
            webbrowser.open(url)
        def interrupted(signum, frame):
            raise KeyboardInterrupt
        signal.signal(signal.SIGTERM, interrupted)
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        LOG.info("Остановка сервера…")
    except (CaptureError, OSError, EOFError) as exc:
        print("Ошибка:", exc, file=sys.stderr)
        return 1
    finally:
        if server:
            server.server_close()
        if controller:
            controller.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
