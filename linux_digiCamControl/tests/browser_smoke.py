#!/usr/bin/env python3
"""Optional browser smoke: pip install playwright, plus installed Chromium.

Not needed to run the server or the stdlib unittest suite.
"""
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def main():
    from playwright.sync_api import sync_playwright
    parser=argparse.ArgumentParser()
    parser.add_argument('--browser', default=shutil.which('chromium'))
    parser.add_argument('--screenshots',type=Path)
    args=parser.parse_args()
    with tempfile.TemporaryDirectory() as temp:
        temp=Path(temp)
        logfile=temp/'stdout.log'
        with logfile.open('w') as log:
            proc=subprocess.Popen([sys.executable,str(ROOT/'linux_digicamcontrol.py'),
                                   'serve','--camera','mock','--port','0','--data-dir',str(temp/'data')],
                                   stdout=log,stderr=subprocess.STDOUT)
            try:
                deadline=time.monotonic()+10
                base=None
                while time.monotonic()<deadline:
                    match=re.search(r'http://localhost:(\d+)/reelme-test.html',logfile.read_text())
                    if match:
                        base='http://127.0.0.1:'+match.group(1);break
                    if proc.poll() is not None: raise RuntimeError(logfile.read_text())
                    time.sleep(.05)
                assert base,logfile.read_text()
                with sync_playwright() as p:
                    launch={'headless':True,'args':['--no-sandbox']}
                    if args.browser: launch['executable_path']=args.browser
                    browser=p.chromium.launch(**launch)
                    page=browser.new_page(viewport={'width':1100,'height':1000})
                    errors=[];uploads=[]
                    page.on('pageerror',lambda err:errors.append(str(err)))
                    page.on('response',lambda r: uploads.append(r.status) if r.url.endswith('/test-upload') else None)
                    page.goto(base+'/reelme-test.html')
                    if args.screenshots:
                        args.screenshots.mkdir(parents=True,exist_ok=True)
                        page.screenshot(path=str(args.screenshots/'linux-ready.png'),full_page=True)
                    for run in range(3):
                        page.locator('#start').click()
                        page.wait_for_function("document.getElementById('result').className === 'ok'",timeout=20000)
                        assert page.locator('#gallery .item').count()==3
                        assert 'DEMO' in page.locator('#result').inner_text()
                        page.wait_for_timeout(300)
                        with urllib.request.urlopen(base+'/filelist.json') as r:
                            files=json.load(r)
                        assert len(files)==(run+1)*3,files
                        assert page.locator('#start').is_enabled()
                    assert len(uploads)==3 and all(x==200 for x in uploads),uploads
                    page.locator('summary').click()
                    assert 'РУЧНОЙ ПРОГОН 1' in page.locator('#logs').inner_text()
                    assert 'РУЧНОЙ ПРОГОН 3' in page.locator('#logs').inner_text()
                    if args.screenshots:
                        page.screenshot(path=str(args.screenshots/'linux-success.png'),full_page=True)
                    # Failure must re-enable the button and offer logs, not silently retry.
                    page.route('**/filelist.json*',lambda route:route.fulfill(status=503,body='unavailable'))
                    page.locator('#start').click()
                    page.wait_for_function("document.getElementById('result').className === 'bad'")
                    assert 'Сергею' in page.locator('#result').inner_text()
                    assert page.locator('#start').is_enabled()
                    with page.expect_download() as download:
                        page.locator('#logsBtn').click()
                    download.value.save_as(str(temp/'browser-log.txt'))
                    assert 'РУЧНОЙ ПРОГОН 4' in (temp/'browser-log.txt').read_text()
                    assert not errors,errors
                    browser.close()
                print('PASS: 3 manual runs, 9 JPEGs, 3 local uploads, no automatic rerun, error handling, downloaded log, zero JS exceptions.')
            finally:
                proc.terminate()
                try: proc.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    proc.kill();proc.wait();raise
    return 0

if __name__=='__main__':
    raise SystemExit(main())
