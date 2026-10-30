"""Build still/clip storyboard from any MP4."""
import sys,argparse,json,sys,subprocess
from pathlib import Path
import cv2
from PIL import Image,ImageDraw

def main():
 ap=argparse.ArgumentParser();ap.add_argument('video',type=Path);ap.add_argument('--moments',type=Path);ap.add_argument('-o','--output',required=True,type=Path);ap.add_argument('--auto',action='store_true');ap.add_argument('--edl',type=Path);a=ap.parse_args();a.output.mkdir(parents=True,exist_ok=True);mom=json.loads(a.moments.read_text(encoding='utf-8-sig')) if a.moments else []
 if isinstance(mom,dict):mom=mom.get('moments',[])
 if a.auto and a.edl:
  e=json.loads(a.edl.read_text(encoding='utf-8-sig'));rows=e if isinstance(e,list) else e.get('ranges',e.get('clips',e.get('segments',[])))
  # EDL ranges are in source time; the video is the rendered output, so map each range to its output offset.
  mom=[];off=0.0
  for r in rows[:10]:
   d=float(r.get('end',0))-float(r.get('start',0));mom.append({'t':off+min(.5,d/2),'explanation':' · '.join(x for x in (r.get('beat',''),r.get('reason','') or r.get('quote','')) if x) or 'Selected edit moment'});off+=max(0,d)
 if not mom: sys.exit('storyboard_mp4: no moments (give --moments or --auto --edl with ranges)')
 cap=cv2.VideoCapture(str(a.video));cards=[];html=[]
 for i,m in enumerate(mom):
  t=float(m.get('t',m.get('time',0)));cap.set(cv2.CAP_PROP_POS_MSEC,t*1000);ok,fr=cap.read()
  if not ok:continue
  h,w=fr.shape[:2];im=Image.fromarray(cv2.cvtColor(cv2.resize(fr,(w//2,h//2)),cv2.COLOR_BGR2RGB));fn=f's{i+1:02}.jpg';im.save(a.output/fn,quality=88);cards.append((im,m.get('explanation',m.get('reason',''))));clip=m.get('clip')
  clip_html=''
  if clip and len(clip)==2:
   cn=f'c{i+1:02}.mp4';subprocess.run(['ffmpeg','-hide_banner','-y','-ss',str(clip[0]),'-i',str(a.video),'-t',str(float(clip[1])-float(clip[0])),'-vf','scale=-2:540','-c:v','libx264','-crf','30','-c:a','aac',str(a.output/cn)],check=True);clip_html=f'<video controls src="{cn}"></video>'
  html.append(f'<article><img src="{fn}"><p>{m.get("explanation",m.get("reason",""))}</p>{clip_html}</article>')
 sheet=Image.new('RGB',(640*max(1,min(3,len(cards))),360*((len(cards)+2)//3)),(20,20,20));d=ImageDraw.Draw(sheet)
 for i,(im,txt) in enumerate(cards):
  x=(i%3)*640;y=(i//3)*360;im.thumbnail((640,330));sheet.paste(im,(x,y));d.text((x+8,y+335),str(txt)[:90],fill='white')
 sheet.save(a.output/'sheet.jpg');(a.output/'storyboard.html').write_text('<!doctype html><html dir="rtl"><meta charset="utf-8"><style>body{background:#111;color:#eee;font:18px sans-serif;max-width:1100px;margin:auto}article{margin:24px}img,video{max-width:100%}</style><main>'+''.join(html)+'</main></html>',encoding='utf-8');print(f'OK storyboard_mp4 {len(cards)} cards')
if __name__=='__main__':sys.stdout.reconfigure(encoding='utf-8');main()
