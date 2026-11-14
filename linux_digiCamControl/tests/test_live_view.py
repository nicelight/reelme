"""Live View: actual FFmpeg/HTTP plus controlled subprocess failure, no camera required."""
import hashlib
import http.client
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from cameras import CaptureError, WebcamBackend, direct_camera, jpeg_info
from linux_digicamcontrol import CameraHTTPServer, Controller


@unittest.skipUnless(shutil.which('ffmpeg'), 'FFmpeg not installed')
class LiveViewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.backend = WebcamBackend(direct_camera('/dev/video-test'), threading.Event(),
                                     size='320x240', warmup=.05, timeout=3)
        command = self.backend.command
        def synthetic(filename='webcam.jpg'):
            original = command(filename)
            return original[:original.index('-f')] + ['-re', '-f', 'lavfi', '-i',
                'testsrc2=size=320x240:rate=15'] + original[original.index('-an'):]
        self.backend.command = synthetic
        self.controller = Controller(self.backend, Path(self.temp.name)/'session')
        self.server = CameraHTTPServer(('127.0.0.1', 0), self.controller, ROOT/'web')
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': .02})
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.controller.close()
        self.server.server_close()
        self.thread.join()
        self.assertFalse(self.backend.live_thread and self.backend.live_thread.is_alive())
        self.temp.cleanup()

    def request(self, path, method='GET', headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_address[1], timeout=5)
        connection.request(method, path, headers=headers or {})
        response = connection.getresponse()
        result = response.status, response.read(), dict(response.getheaders())
        connection.close()
        return result

    def wait_capture(self):
        deadline = time.monotonic() + 5
        while self.controller.status()['busy'] and time.monotonic() < deadline:
            time.sleep(.02)
        self.assertEqual(self.controller.status()['last_job']['state'], 'done')

    def test_routes_fresh_capture_during_preview_and_stop(self):
        self.assertTrue(json.loads(self.request('/health')[1])['features']['live_view'])
        self.assertEqual(self.request('/liveview.html?CMD=LiveViewWnd_Show', 'HEAD')[0], 405)
        self.assertIsNone(self.backend.live_thread)
        self.assertEqual(self.request('/liveview.html?CMD=LiveViewWnd_Show', headers={'Origin':'https://evil.example'})[0],403)
        self.assertEqual(self.request('/liveview.html?CMD=LiveViewWnd_Show')[0], 200)
        worker = self.backend.live_thread
        code, preview, headers = self.request('/liveview.jpg')
        self.assertEqual(code, 200)
        self.assertEqual(headers['Content-Type'], 'image/jpeg')
        self.assertIn('no-store', headers['Cache-Control'])
        self.assertEqual(jpeg_info(preview), (320, 240))
        self.assertEqual(self.controller.file_list(), [])
        # Starting again must reuse the same camera process/reader.
        self.assertEqual(self.request('/?CMD=LiveViewWnd_Show')[0], 200)
        self.assertIs(self.backend.live_thread, worker)
        self.assertEqual(self.request('/?CMD=LiveView_Capture', 'HEAD')[0], 405)
        with self.backend.frames:
            marker = self.backend.live_sequence
        self.assertEqual(self.request('/?CMD=LiveView_Capture')[0], 200)
        self.assertEqual(self.request('/liveview.jpg')[0], 200)
        self.wait_capture()
        self.assertGreater(self.backend.live_sequence, marker)
        files = self.controller.file_list()
        self.assertEqual(len(files), 1)
        image = self.request(files[0]['Original'])[1]
        self.assertNotEqual(image, preview)
        self.assertEqual(hashlib.sha256(image).hexdigest(), files[0]['Sha256'])
        self.assertEqual(self.request('/?CMD=Capture')[0], 200)
        self.wait_capture()
        self.assertIs(self.backend.live_thread, worker)
        self.assertEqual(len(self.controller.file_list()), 2)
        self.assertEqual(self.request('/liveview.html?CMD=LiveViewWnd_Hide')[0], 200)
        self.assertFalse(worker.is_alive())
        self.assertEqual(self.request('/liveview.jpg')[0], 503)
        # Normal one-shot capture still works after stopping Live View.
        self.assertEqual(self.request('/?CMD=Capture')[0], 200)
        self.wait_capture()
        self.assertEqual(len(self.controller.file_list()), 3)

    def test_repeated_input_timestamps_do_not_abort_mjpeg_encoder(self):
        # Real FFmpeg input repeats each timestamp, like the observed UVC jitter.
        # Keep the production output filter/encoder and require all 60 frames.
        command = self.backend.stream_command()
        source = command.index('-i') + 1
        command[source] += ',setpts=floor(N/2)/(15*TB)'
        command.remove('-re')
        command[-1:-1] = ['-frames:v', '60']
        result = subprocess.run(command, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr.decode(errors='replace'))
        self.assertNotIn(b'Invalid pts', result.stderr)
        self.assertEqual(result.stdout.count(b'\xff\xd9'), 60)

    def test_idle_releases_camera_and_explicit_start_recovers(self):
        self.backend.idle_timeout = .4
        self.backend.start_live_view()
        worker = self.backend.live_thread
        worker.join(timeout=3)
        self.assertFalse(worker.is_alive())
        with self.assertRaises(CaptureError):
            self.backend.preview()
        self.backend.start_live_view()
        self.assertIsNot(worker, self.backend.live_thread)
        self.assertEqual(jpeg_info(self.backend.preview()), (320, 240))

    def controlled_stream(self, tail):
        self.backend.size = None
        fixture = str(ROOT/'fixtures/demo.jpg')
        script = ('import sys,time; from pathlib import Path; '
                  f'sys.stdout.buffer.write(Path({fixture!r}).read_bytes()); '
                  'sys.stdout.buffer.flush(); time.sleep(.15); ' + tail)
        self.backend.stream_command = lambda: [sys.executable, '-c', script]

    def test_disconnected_stream_never_serves_cached_frame_or_publishes_capture(self):
        self.controlled_stream('sys.exit(1)')
        self.backend.start_live_view()
        self.backend.live_thread.join(timeout=3)
        self.assertFalse(self.backend.live_thread.is_alive())
        self.assertEqual(self.request('/liveview.jpg')[0], 503)
        self.assertEqual(self.request('/?CMD=LiveView_Capture')[0], 200)
        deadline = time.monotonic() + 3
        while self.controller.status()['busy'] and time.monotonic() < deadline:
            time.sleep(.01)
        self.assertEqual(self.controller.status()['last_job']['state'], 'error')
        self.assertEqual(self.controller.file_list(), [])

    def test_stalled_stream_cannot_reuse_previous_frame_and_close_joins_worker(self):
        self.controlled_stream('time.sleep(10)')
        self.backend.frame_timeout = .3
        self.backend.start_live_view()
        work = Path(self.temp.name)/'capture'
        work.mkdir()
        started = time.monotonic()
        with self.assertRaises(CaptureError):
            self.backend.capture(work, 'fresh-frame')
        self.assertLess(time.monotonic() - started, 2)
        self.assertFalse((work/'webcam.jpg').exists())
        self.controller.close()
        self.assertFalse(self.backend.live_thread.is_alive())
