"""Platform exports. Ported from OpenMontage/lib/media_profiles.py MediaProfile definitions."""
import argparse,json,subprocess,sys
from pathlib import Path
import sys as _sys
from pathlib import Path as _P
_sys.path.insert(0,str(_P(__file__).resolve().parent))  # allow python -I
from _media import probe,ffmpeg,HERE

def main():
 ap=argparse.ArgumentParser();ap.add_argument('input',type=Path);ap.add_argument('--profile',required=True);ap.add_argument('-o','--output',required=True,type=Path);ap.add_argument('--reframe',action='store_true');ap.add_argument('--safe-overlay',type=Path);a=ap.parse_args(); profiles=json.loads((HERE/'profiles.json').read_text(encoding='utf-8-sig'));p=profiles[a.profile];info=probe(a.input)
 if p['max_duration'] and info['duration']>p['max_duration']:ap.error(f"duration {info['duration']:.1f}s exceeds profile maximum {p['max_duration']}s")
 source=a.input
 if a.reframe:
  import reframe
  ratio=f"{p['width']//__import__('math').gcd(p['width'],p['height'])}:{p['height']//__import__('math').gcd(p['width'],p['height'])}"
  if ratio in ('9:16','1:1','4:5'):
   tmp=a.output.with_name(a.output.stem+'.reframed.mp4');sys.argv=['reframe',str(a.input),'-o',str(tmp),'--ratio',ratio];reframe.main();source=tmp
 if a.safe_overlay:
  import cv2
  im=cv2.VideoCapture(str(source));ok,frame=im.read()
  if not ok:raise RuntimeError('cannot read first frame for overlay')
  h,w=frame.shape[:2];s=p['safe'];cv2.rectangle(frame,(int(w*s['left']),int(h*s['top'])),(int(w*(1-s['right'])),int(h*(1-s['bottom']))),(0,220,255),4);cv2.imwrite(str(a.safe_overlay),frame)
 vf=f"scale={p['width']}:{p['height']}:force_original_aspect_ratio=decrease,pad={p['width']}:{p['height']}:(ow-iw)/2:(oh-ih)/2,fps={p['fps']},setsar=1"
 # Measure loudness first, then apply measured values in a second pass.
 probe_run=subprocess.run(['ffmpeg','-hide_banner','-i',str(source),'-af','loudnorm=I=-14:TP=-1:LRA=11:print_format=json','-f','null','-'],capture_output=True,text=True,encoding='utf-8')
 import re
 match=re.search(r'\{[^{}]+\}\s*$',probe_run.stderr,re.S);stats=json.loads(match.group(0)) if match else {}
 af='loudnorm=I=-14:TP=-1:LRA=11'
 if stats: af+=':measured_I='+stats['input_i']+':measured_TP='+stats['input_tp']+':measured_LRA='+stats['input_lra']+':measured_thresh='+stats['input_thresh']+':offset='+stats['target_offset']+':linear=true:print_format=summary'
 ffmpeg('-i',source,'-vf',vf,'-c:v','libx264','-b:v',p['video_bitrate'],'-pix_fmt','yuv420p','-c:a','aac','-b:a',p['audio_bitrate'],'-af',af,'-movflags','+faststart',a.output);print(f"OK export {a.profile} {a.output}")
if __name__=='__main__':sys.stdout.reconfigure(encoding='utf-8');main()
