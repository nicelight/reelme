import json, subprocess, time, urllib.request
from pathlib import Path
origin='http://localhost:5513'
def get(path):
    with urllib.request.urlopen(origin+path, timeout=5) as r:return r.read()
def children():
    r=subprocess.run(['pgrep','-P','669029','-x','ffmpeg'],capture_output=True,text=True)
    return r.stdout.split()
health=json.loads(get('/health'))
logpath=Path('linux_digiCamControl/data')/health['session']/'server.log'
offset=len(logpath.read_text())
report={'pass':False,'session':health['session'],'serverPid':669029,'polls':0}
try:
    get('/liveview.html?CMD=LiveViewWnd_Show')
    child=children();assert len(child)==1,child
    report['ffmpegPid']=int(child[0])
    start=time.monotonic()
    while time.monotonic()-start<20:
        data=get('/liveview.jpg');assert data[:2]==b'\xff\xd8' and data[-2:]==b'\xff\xd9'
        assert children()==child
        report['polls']+=1
        time.sleep(.2)
    report['pollingSeconds']=round(time.monotonic()-start,2)
    report['aliveBeforeIdle']=children()==child;assert report['aliveBeforeIdle']
    idle_offset=len(logpath.read_text())
    time.sleep(17)
    after=logpath.read_text()[idle_offset:]
    assert 'Live View остановлен: нет запросов 15 с' in after,after
    assert 'GET /liveview' not in after,after
    log=logpath.read_text()[offset:]
    assert not any(x in log for x in ['Invalid pts','поток FFmpeg завершился','Error encoding','перестала передавать']),log
    assert children()==[],children()
    report.update(pass_=True,idleMessageConfirmed=True,encoderErrors=False,childrenAfterIdle=[])
    report['pass']=report.pop('pass_')
    Path('.tasks/LINUX-LIVEVIEW-CHECK/idle-server.log').write_text(log)
except Exception as e:
    report['failure']=str(e)
    raise
finally:
    Path('.tasks/LINUX-LIVEVIEW-CHECK/idle-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report))
