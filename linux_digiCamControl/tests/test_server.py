"""Offline tests: real HTTP, real files/subprocesses; no physical camera needed."""
from __future__ import annotations
import hashlib
import http.client
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from cameras import (Camera, CaptureError, GPhotoBackend, MockBackend, Runner,
                     WebcamBackend, direct_camera, jpeg_info,
                     parse_gphoto_devices, v4l_capture_capability)
from linux_digicamcontrol import (ApiError, CameraHTTPServer, Controller,
                                  MAX_UPLOAD, validate_upload)

FIXTURE = ROOT / 'fixtures/demo.jpg'


def multipart(images):
    boundary = 'ReelMe-test-boundary-65ac5'
    parts = []
    for name, data in images:
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="photos"; filename="{name}"\r\nContent-Type: image/jpeg\r\n\r\n'.encode() + data + b'\r\n')
    parts.append(f'--{boundary}--\r\n'.encode())
    return b''.join(parts), 'multipart/form-data; boundary=' + boundary


class UtilityTests(unittest.TestCase):
    def test_gphoto_discovery(self):
        text = 'Model Port\n--------------------\nCanon EOS 1100D       usb:001,007\nNikon D750   usb:004,002\n'
        cams = parse_gphoto_devices(text)
        self.assertEqual(len(cams), 2)
        self.assertEqual(cams[0].label, 'Canon EOS 1100D')
        self.assertEqual(cams[0].id, 'gphoto2:usb:001,007')

    def test_v4l_metadata_not_a_camera(self):
        output = 'Capabilities :\n Video Capture\n Metadata Capture\nDevice Caps :\n Metadata Capture\n Streaming\n'
        self.assertFalse(v4l_capture_capability(output))
        self.assertTrue(v4l_capture_capability('Device Caps :\n Video Capture\n Streaming\n'))
        self.assertTrue(v4l_capture_capability('Device Caps :\n Video Capture Multiplanar\n'))

    def test_direct_identifiers(self):
        self.assertEqual(direct_camera('/dev/video0').kind, 'v4l2')
        self.assertEqual(direct_camera('v4l2:/dev/v4l/by-id/cam').device, '/dev/v4l/by-id/cam')
        self.assertEqual(direct_camera('gphoto2:usb:001,002').device, 'usb:001,002')
        self.assertIsNone(direct_camera('gphoto2:some-command'))
        self.assertEqual(direct_camera('mock').kind, 'mock')

    def test_jpeg_parser(self):
        self.assertEqual(jpeg_info(FIXTURE.read_bytes()), (960,640))
        self.assertEqual(jpeg_info(FIXTURE.read_bytes() + b'trailing metadata'), (960,640))
        for data in (b'', b'<html>', FIXTURE.read_bytes()[:-2], b'\xff\xd8\xff\xc0\x00\x01\xff\xd9'):
            with self.assertRaises(CaptureError):
                jpeg_info(data)

    def test_multipart_roundtrip(self):
        data = FIXTURE.read_bytes()
        body, ct = multipart([('one.jpg', data), ('two.jpg',data), ('three.jpg',data)])
        files = validate_upload(body, ct)
        self.assertEqual(len(files),3)
        self.assertEqual(files[1]['sha256'],hashlib.sha256(data).hexdigest())

    def test_bad_multipart(self):
        for body, ct in [(b'abc','application/json'), (b'abc','multipart/form-data; boundary=x')]:
            with self.assertRaises(ApiError): validate_upload(body,ct)
        body, ct = multipart([('bad.jpg',b'not a jpeg')])
        with self.assertRaises(ApiError): validate_upload(body,ct)

    def test_runner_timeout(self):
        with tempfile.TemporaryDirectory() as work:
            start=time.monotonic()
            with self.assertRaisesRegex(CaptureError, 'Тайм-аут'):
                Runner(threading.Event()).run([sys.executable,'-c','import time; time.sleep(10)'],Path(work),.15)
            self.assertLess(time.monotonic()-start,3)

    def test_runner_cancellation(self):
        cancel=threading.Event()
        timer=threading.Timer(.15,cancel.set)
        with tempfile.TemporaryDirectory() as work:
            timer.start()
            with self.assertRaisesRegex(CaptureError, 'отменена'):
                Runner(cancel).run([sys.executable,'-c','import time; time.sleep(10)'],Path(work),5)
        timer.join()

    def test_webcam_command(self):
        backend=WebcamBackend(direct_camera('/dev/video0'),threading.Event(),size='1280x720',
                              fps=30,input_format='mjpeg',warmup=.5)
        cmd=backend.command()
        self.assertIn('video4linux2',cmd)
        self.assertLess(cmd.index('-input_format'),cmd.index('-i'))
        self.assertEqual(cmd[cmd.index('-frames:v')+1],'1')
        self.assertIn('setpts=PTS-STARTPTS,select=gte(t\\,0.5)',cmd)

    @unittest.skipUnless(shutil.which('ffmpeg'),'FFmpeg not installed')
    def test_webcam_encoding_with_ffmpeg_synthetic_input(self):
        backend=WebcamBackend(direct_camera('/dev/video0'),threading.Event(),warmup=.1)
        cmd=backend.command()
        # Keep the actual output pipeline; replace only the hardware input.
        cmd=cmd[:cmd.index('-f')]+['-f','lavfi','-i','testsrc2=size=320x240:rate=30']+cmd[cmd.index('-an'):]
        with tempfile.TemporaryDirectory() as work:
            Runner(threading.Event()).run(cmd,Path(work),10)
            self.assertEqual(jpeg_info((Path(work)/'webcam.jpg').read_bytes()),(320,240))

    def test_gphoto_backend_preserves_raw_and_uses_keep(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp); binpath=path/'bin';binpath.mkdir();work=path/'work';work.mkdir()
            executable=binpath/'gphoto2'
            executable.write_text('#!'+sys.executable+'\nimport sys,shutil\nfrom pathlib import Path\n'
                                  'assert "--keep" in sys.argv\nassert "--capture-image-and-download" in sys.argv\n'
                                  'assert sys.argv[sys.argv.index("--port")+1]=="usb:001,007"\n'
                                  'shutil.copyfile('+repr(str(FIXTURE))+',"capture-001.JPG")\n'
                                  'Path("capture-002.CR2").write_bytes(b"RAW")\n')
            executable.chmod(0o755)
            with patch.dict(os.environ,{'PATH':str(binpath)+os.pathsep+os.environ['PATH']}):
                result=GPhotoBackend(direct_camera('gphoto2:usb:001,007'),threading.Event()).capture(work,'test')
            self.assertEqual(result.name,'capture-001.JPG')
            self.assertTrue((work/'capture-002.CR2').exists())
            self.assertEqual(result.read_bytes(),FIXTURE.read_bytes())


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cancel = threading.Event()
        self.backend = MockBackend(direct_camera('mock'),self.cancel,delay=.08)
        self.controller = Controller(self.backend,Path(self.tmp.name)/'session')
        self.server = CameraHTTPServer(('127.0.0.1',0),self.controller,ROOT/'web')
        self.port = self.server.server_address[1]
        self.thread=threading.Thread(target=self.server.serve_forever,kwargs={'poll_interval':.03})
        self.thread.start()

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.controller.close()
        self.thread.join(); self.tmp.cleanup()

    def request(self,path,method='GET',body=None,headers=None):
        c=http.client.HTTPConnection('127.0.0.1',self.port,timeout=5)
        c.request(method,path,body,headers or {})
        r=c.getresponse();result=(r.status,r.read(),dict(r.getheaders()));c.close()
        return result

    def json(self,path):
        status,body,_=self.request(path)
        self.assertEqual(status,200,body)
        return json.loads(body)

    def wait_done(self):
        until=time.monotonic()+5
        while time.monotonic()<until:
            status=self.json('/status.json')
            if not status['busy']: return status
            time.sleep(.015)
        self.fail('capture timeout')

    def test_static_health(self):
        status,body,headers=self.request('/')
        self.assertEqual(status,200);self.assertIn(b'<html',body)
        self.assertNotIn('Access-Control-Allow-Origin',headers)
        self.assertTrue(self.json('/health')['simulated'])
        self.assertEqual(self.json('/filelist.json'),[])

    def test_capture_and_download(self):
        code,body,headers=self.request('/?CMD=Capture')
        self.assertEqual(code,200);self.assertEqual(body,b'OK');self.assertIn('X-Capture-Id',headers)
        state=self.wait_done();self.assertEqual(state['last_job']['state'],'done')
        items=self.json('/filelist.json');self.assertEqual(len(items),1)
        code,data,headers=self.request(items[0]['Original'])
        self.assertEqual(code,200);self.assertEqual(headers['Content-Type'],'image/jpeg')
        self.assertEqual(hashlib.sha256(data).hexdigest(),items[0]['Sha256'])
        self.assertEqual(jpeg_info(data),(960,640))
        self.assertEqual(self.request('/preview.jpg')[1],data)
        self.assertEqual(self.request('/?slc=get&param1=lastcaptured&param2=')[1].decode(),items[0]['Name'])
        self.assertEqual(len(self.json('/session.json')['Files']),1)

    def test_busy_rejected_and_polling_stays_responsive(self):
        self.backend.delay=.4
        self.assertEqual(self.request('/?CMD=Capture')[0],200)
        self.assertEqual(self.request('/?CMD=Capture')[0],409)
        self.assertEqual(self.request('/?slc=get&param1=lastcaptured')[1],b'-')
        start=time.monotonic()
        self.assertEqual(self.json('/filelist.json'),[])
        self.assertLess(time.monotonic()-start,.2)
        self.wait_done();self.assertEqual(len(self.json('/filelist.json')),1)

    def test_three_manually_requested_runs(self):
        seen=set()
        for run in range(3):
            for shot in range(3):
                self.assertEqual(self.request('/?CMD=Capture')[0],200)
                self.wait_done()
            items=self.json('/filelist.json')
            self.assertEqual(len(items),(run+1)*3)
            time.sleep(.1)
            self.assertEqual(len(self.json('/filelist.json')),(run+1)*3)  # no automatic run
            seen.update(x['Sha256'] for x in items)
        self.assertEqual(len(seen),9)

    def test_slc_capture(self):
        self.assertEqual(self.request('/?slc=capture&param1=&param2=')[0],200)
        self.wait_done()
        self.assertEqual(len(self.json('/filelist.json')),1)

    def test_error_and_recovery(self):
        original=self.backend.capture
        def broken(*args): raise CaptureError('test: disconnected camera')
        self.backend.capture=broken
        self.request('/?CMD=Capture')
        status=self.wait_done()
        self.assertEqual(status['last_job']['state'],'error')
        self.assertIn('disconnected',status['last_job']['error'])
        self.assertEqual(self.json('/filelist.json'),[])
        self.backend.capture=original
        self.request('/?CMD=Capture');self.wait_done()
        self.assertEqual(len(self.json('/filelist.json')),1)

    def test_local_upload(self):
        images=[(f'frame-{i}.jpg',FIXTURE.read_bytes()) for i in range(3)]
        body,ct=multipart(images)
        status,payload,_=self.request('/test-upload','POST',body,{'Content-Type':ct})
        self.assertEqual(status,200,payload)
        result=json.loads(payload)
        self.assertTrue(result['ok']);self.assertFalse(result['stored'])
        self.assertEqual(len(result['files']),3)
        self.assertEqual(result['files'][0]['sha256'],hashlib.sha256(images[0][1]).hexdigest())
        self.assertEqual(self.json('/filelist.json'),[]) # received files never become captured photos

    def test_upload_size_and_invalid_body(self):
        self.assertEqual(self.request('/test-upload','POST',b'',{'Content-Length':str(MAX_UPLOAD+1),
                                                                  'Content-Type':'multipart/form-data'})[0],413)
        self.assertEqual(self.request('/test-upload','POST',b'abc',{'Content-Type':'application/json'})[0],415)

    def test_no_silent_liveview_emulation(self):
        self.assertEqual(self.request('/liveview.jpg')[0],501)
        self.assertEqual(self.request('/?CMD=LiveViewWnd_Show')[0],501)
        self.assertEqual(self.json('/filelist.json'),[])

    def test_head_never_triggers_capture(self):
        self.assertEqual(self.request('/?CMD=Capture','HEAD')[0],405)
        self.assertEqual(self.json('/filelist.json'),[])
        self.assertEqual(self.request('/reelme-test.html','HEAD')[0],200)

    def test_security(self):
        self.assertEqual(self.request('/health',headers={'Host':'evil.example'})[0],403)
        self.assertEqual(self.request('/?CMD=Capture',headers={'Origin':'https://evil.example'})[0],403)
        self.assertEqual(self.request('/?CMD=Capture',headers={'Sec-Fetch-Site':'cross-site'})[0],403)
        self.assertEqual(self.request('/?CMD=Capture',headers={'Referer':'https://evil.example/'})[0],403)
        self.assertEqual(self.request('/health',headers={'Origin':f'http://127.0.0.1:{self.port}'})[0],200)
        self.assertEqual(self.json('/filelist.json'),[])

    def test_cross_site_entry_navigation_only(self):
        headers = {'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate',
                   'Sec-Fetch-Dest': 'document', 'Referer': 'https://example.com/'}
        self.assertEqual(self.request('/reelme-test.html', headers=headers)[0], 200)
        for path in ('/?CMD=Capture', '/liveview.html?CMD=LiveViewWnd_Show',
                     '/filelist.json', '/liveview.jpg', '/image/photo.jpg'):
            self.assertEqual(self.request(path, headers=headers)[0], 403, path)
        self.assertEqual(self.request('/reelme-test.html', headers={
            **headers, 'Sec-Fetch-Dest': 'iframe'})[0], 403)
        self.assertEqual(self.request('/reelme-test.html', headers={
            **headers, 'Host': 'evil.example'})[0], 403)

    def test_path_traversal_blocked(self):
        for path in ('/%2e%2e/linux_digicamcontrol.py','/image/%2e%2e%2fserver.log',
                     '/.work/secret.jpg','/image/%5c..%5cpasswd','/../cameras.py'):
            self.assertEqual(self.request(path)[0],404,path)

    def test_cancel_no_published_file(self):
        self.backend.delay=1
        self.request('/?CMD=Capture')
        self.controller.close()
        self.assertFalse(self.controller.busy)
        self.assertEqual(self.controller.file_list(),[])
        self.assertEqual(self.request('/?CMD=Capture')[0],503)


if __name__=='__main__':
    unittest.main()
