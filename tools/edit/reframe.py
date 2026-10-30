"""Auto reframe with local detection, scene-aware smoothing, keyframe overrides.
Ported from OpenMontage/tools/video/auto_reframe.py and tools/analysis/face_tracker.py (trajectory approach)."""
import argparse,json,math,subprocess,sys
from pathlib import Path
import cv2
import sys as _sys
from pathlib import Path as _P
_sys.path.insert(0,str(_P(__file__).resolve().parent))  # allow python -I
from _media import probe,ffmpeg

YUNET=Path(__file__).resolve().parents[2]/'work'/'models'/'face_detection_yunet_2023mar.onnx'
def make_detector(w,h):
 """Face detector returning [(x,y,w,h)]: OpenCV YuNet (work/models) first, Haar cascade as fallback, None if neither exists."""
 if YUNET.exists():
  yn=cv2.FaceDetectorYN.create(str(YUNET),'',(w,h),0.7,0.3,50)
  def det(frame):
   _,f=yn.detect(frame)
   return [] if f is None else [tuple(map(int,r[:4])) for r in f]
  return det
 hp=Path(cv2.data.haarcascades+'haarcascade_frontalface_default.xml') if hasattr(cv2,'data') else None
 if hp and hp.exists():
  hc=cv2.CascadeClassifier(str(hp))
  return lambda frame: list(hc.detectMultiScale(cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY),1.1,5,minSize=(32,32)))
 print('WARNING: no face model found; --track face falls back to center',file=sys.stderr)
 return None

def main():
 p=argparse.ArgumentParser();p.add_argument('input',type=Path);p.add_argument('-o','--output',required=True,type=Path);p.add_argument('--ratio',choices=['9:16','1:1','4:5'],default='9:16');p.add_argument('--track',choices=['face','center','manual'],default='face');p.add_argument('--keys',type=Path);p.add_argument('--smooth',type=float,default=.85);p.add_argument('--preview-png',action='store_true');a=p.parse_args()
 inf=probe(a.input); w,h,fps,dur=inf['width'],inf['height'],inf['fps'],inf['duration']; rw,rh=map(int,a.ratio.split(':')); cw=min(w,round(h*rw/rh)); ch=min(h,round(w*rh/rw)); cw-=cw%2;ch-=ch%2
 cap=cv2.VideoCapture(str(a.input)); n=int(dur*fps); step=max(1,int(fps/3)); cascade=make_detector(w,h); tracker=None; vals=[]; scenes=set()
 # PySceneDetect cut times, if installed.
 try:
  from scenedetect import open_video, SceneManager
  from scenedetect.detectors import ContentDetector
  v=open_video(str(a.input)); sm=SceneManager();sm.add_detector(ContentDetector());sm.detect_scenes(v);scenes={int(x.get_frames()[0]) for x in sm.get_scene_list()[1:]}
 except Exception: pass
 for i in range(n):
  ok,frame=cap.read()
  if not ok: break
  if i in scenes: tracker=None
  target=None
  if a.track=='face' and cascade is not None and (i%step==0 or tracker is None):
   faces=cascade(frame)
   if len(faces):
    x,y,bw,bh=max(faces,key=lambda b:b[2]*b[3]-.02*abs((b[0]+b[2]/2)-w/2)); target=x+bw/2
    tracker=cv2.TrackerCSRT_create();tracker.init(frame,(int(x),int(y),int(bw),int(bh)))
  elif a.track=='face' and tracker:
   okb,box=tracker.update(frame)
   if okb: target=box[0]+box[2]/2
  vals.append([i,target])
 cap.release()
 # Fill frames without a detection: before the first hit use the first hit (no drift in from the center), after it hold the last one.
 first=next((v for _,v in vals if v is not None),w/2); last=first
 for v in vals:
  if v[1] is None: v[1]=last
  else: last=v[1]
 for v in vals:
  if v[0]>=next((i for i,x in vals if x==first),0): break
  v[1]=first
 keys=json.loads(a.keys.read_text(encoding='utf-8-sig')) if a.keys else []
 # Scene-relative exponential smoothing/dead zone and bounded pan 0.18 frame/sec.
 centers=[]; prev=vals[0][1] if vals else w/2; alpha=max(.02,min(.98,1-a.smooth)); maxstep=max(1,w*.18/fps)
 keys=sorted(keys,key=lambda k:float(k['t']))
 for i,t in vals:
  now=i/fps
  if keys:
   right=next((k for k in keys if float(k['t'])>=now),keys[-1]);left=next((k for k in reversed(keys) if float(k['t'])<=now),keys[0])
   lx=float(left['cx'])*w if float(left['cx'])<=1 else float(left['cx']);rx=float(right['cx'])*w if float(right['cx'])<=1 else float(right['cx']);span=float(right['t'])-float(left['t']);t=lx if span<=0 else lx+(rx-lx)*max(0,min(1,(now-float(left['t']))/span))
  if i in scenes: prev=t
  else:
   desired=prev if abs(t-prev)<w*.012 else prev+alpha*(t-prev)
   prev+=max(-maxstep,min(maxstep,desired-prev))
  centers.append(max(cw/2,min(w-cw/2,prev)))
 # Smooth path at frame granularity; crop filter expression interpolates sampled crop-left values.
 path=[[i/fps,round(max(0,min(w-cw,c-cw/2)))] for i,c in enumerate(centers)]
 a.output.parent.mkdir(parents=True,exist_ok=True); jp=Path(str(a.output)+'.path.json');jp.write_text(json.dumps({'width':w,'height':h,'crop_width':cw,'crop_height':ch,'fps':fps,'scenes':sorted(scenes),'path':path},indent=2),encoding='utf-8')
 # Per-frame crop x via a sendcmd file (scales to any length; a nested if() expression does not).
 ow,oh={'9:16':(1080,1920),'1:1':(1080,1080),'4:5':(1080,1350)}[a.ratio]
 import tempfile
 td=Path(tempfile.mkdtemp(prefix='reframe_'))
 (td/'cmds.txt').write_text(''.join(f'{t:.4f} crop x {x};'+chr(10) for t,x in path),encoding='ascii')
 vf=f"sendcmd=f=cmds.txt,crop={cw}:{ch}:{path[0][1]}:(ih-{ch})/2,scale={ow}:{oh},setsar=1"
 subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(a.input.resolve()),'-vf',vf,'-c:v','libx264','-crf','18','-preset','fast','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',str(a.output.resolve())],cwd=td,check=True)
 import shutil; shutil.rmtree(td,ignore_errors=True)
 if a.preview_png:
  from PIL import Image,ImageDraw
  cap=cv2.VideoCapture(str(a.input)); thumbs=[]
  for j in range(8):
   cap.set(cv2.CAP_PROP_POS_MSEC,dur*1000*j/8);ok,fr=cap.read()
   if ok:
    xx=int(path[min(len(path)-1,int(dur*j/8*fps))][1]); cv2.rectangle(fr,(xx,0),(xx+cw,h-1),(0,255,0),5); thumbs.append(Image.fromarray(cv2.cvtColor(cv2.resize(fr,(320,180)),cv2.COLOR_BGR2RGB)))
  sheet=Image.new('RGB',(320*len(thumbs),180));[sheet.paste(im,(j*320,0)) for j,im in enumerate(thumbs)];sheet.save(a.output.with_suffix('.preview.png'))
 print(f'OK reframe {a.output} ({ow}x{oh}), path {jp}')
if __name__=='__main__':
 sys.stdout.reconfigure(encoding='utf-8');main()
