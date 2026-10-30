"""Phase 3 smoke suite. Artifacts stay beside this script under tools/edit/tests/tmp3."""
import json,math,subprocess,sys
from pathlib import Path
import cv2,numpy as np
ROOT=Path(__file__).resolve().parents[1];TMP=Path(__file__).resolve().parent/'tmp3';TMP.mkdir(exist_ok=True)
def run(args):subprocess.run([sys.executable,*map(str,args)],check=True)
def ok(name):print('OK',name,flush=True)
# synthetic moving bright ellipse
src=TMP/'moving.mp4';w,h,fps=1920,1080,30;wr=cv2.VideoWriter(str(src),cv2.VideoWriter_fourcc(*'mp4v'),fps,(w,h))
for i in range(90):
 fr=np.zeros((h,w,3),np.uint8);cv2.ellipse(fr,(int(500+i*8),450),(75,110),0,0,360,(240,240,240),-1);wr.write(fr)
wr.release();keys=TMP/'keys.json';keys.write_text(json.dumps([{'t':0,'cx':.26},{'t':2.9,'cx':.63}]),encoding='utf-8');out=TMP/'vertical.mp4';run([ROOT/'reframe.py',src,'-o',out,'--track','manual','--keys',keys]);cap=cv2.VideoCapture(str(out));assert (int(cap.get(3)),int(cap.get(4)))==(1080,1920);cap.release();path=json.loads(Path(str(out)+'.path.json').read_text())['path'];jumps=[abs(path[i][1]-path[i-1][1]) for i in range(1,len(path))];assert max(jumps)<20 and max(x[1] for x in path)-min(x[1] for x in path)>200;ok('reframe moving target + smooth key path')
cascade_file=Path(cv2.data.haarcascades)/'haarcascade_frontalface_default.xml';thumbs=list((ROOT.parent.parent/'reel'/'public'/'v4'/'thumbs').glob('*.jpg'))
if cascade_file.exists() and thumbs:
 detector=cv2.CascadeClassifier(str(cascade_file));found=False
 for image in thumbs:
  frame=cv2.imread(str(image))
  if frame is not None and len(detector.detectMultiScale(cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY),1.1,5,minSize=(24,24))):found=True;break
 if found:print('OK offline face detector found face in',image.name)
 else:print('SKIP real-face reframe (no face detected in local JPG thumbs)')
else:print('SKIP real-face reframe (offline Haar model or local JPG thumbnails unavailable)')
profiles=json.loads((ROOT/'profiles.json').read_text(encoding='utf-8-sig'));clip=TMP/'short.mp4';subprocess.run(['ffmpeg','-hide_banner','-y','-i',str(src),'-t','3','-c:v','libx264',str(clip)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
for name in profiles:run([ROOT/'export.py',clip,'--profile',name,'-o',TMP/f'{name}.mp4']);ok('export '+name)
# 120 bpm click
import soundfile as sf
sr=22050;y=np.zeros(sr*8,dtype=np.float32)
for t in np.arange(0,8,.5):y[int(t*sr):int(t*sr)+300]=.8*np.hanning(300)
track=TMP/'click.wav';sf.write(track,y,sr);music=TMP/'music.json';run([ROOT/'music.py','analyze',track,'-o',music]);run([ROOT/'music.py','window',track,'--length','3']);voice=TMP/'voice.wav';sf.write(voice,np.sin(np.arange(sr*8)*2*np.pi*180/sr).astype('float32')*.1,sr);run([ROOT/'music.py','duck',voice,track,'-o',TMP/'bed.wav']);ok('music analyze/window/duck')
edl=TMP/'edl.json';edl.write_text(json.dumps({'clips':[{'start':.53,'end':2.49,'reason':'synthetic'}]}));run([ROOT/'beats_to_cuts.py',music,'--edl',edl]);ok('beats_to_cuts')
mom=TMP/'moments.json';mom.write_text(json.dumps([{'t':1,'explanation':'Moving target'}]));run([ROOT/'storyboard_mp4.py',clip,'--moments',mom,'-o',TMP/'board']);assert (TMP/'board/storyboard.html').exists();ok('storyboard_mp4')
run([ROOT/'critic.py',clip,'--edl',edl,'--recipe','smoke','-o',TMP/'critic.md']);ok('critic brief')
# Distill only when smoke project exists AND target recipes_learned path remains inside tools/edit (normally it does not).
project=ROOT.parent.parent/'tmp'/'edit_smoke'/'projects'/'test_project'
if project.exists():
 target=ROOT.parent.parent/'recipes_learned'
 try: target.resolve().relative_to(ROOT.resolve());run([ROOT/'distill.py',project]);ok('distill')
 except ValueError:print('SKIP distill (specified repo-root output is outside tools/edit write boundary)')
else:print('SKIP distill (tools/edit/tests/smoke.py project not present under tmp/edit_smoke/projects/test_project)')
