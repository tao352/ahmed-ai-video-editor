"""Generate a measured external-video-review brief.
Ported from OpenMontage/skills/meta/reviewer.md (CHAI reviewer protocol)."""
import argparse,json,sys,subprocess
from pathlib import Path
import sys as _sys
from pathlib import Path as _P
_sys.path.insert(0,str(_P(__file__).resolve().parent))  # allow python -I
from _media import probe

def main():
 ap=argparse.ArgumentParser();ap.add_argument('video',type=Path);ap.add_argument('--edl',required=True,type=Path);ap.add_argument('--recipe',required=True);ap.add_argument('-o','--output',required=True,type=Path);ap.add_argument('--send-gemini',action='store_true');a=ap.parse_args();info=probe(a.video);edl=json.loads(a.edl.read_text(encoding='utf-8-sig'));rows=edl if isinstance(edl,list) else edl.get('ranges',edl.get('clips',edl.get('segments',[])));starts=[float(x.get('start',0)) for x in rows];ends=[float(x.get('end',0)) for x in rows];lens=[e-s for s,e in zip(starts,ends) if e>s];gaps=[b-a for a,b in zip(sorted(ends),sorted(starts)[1:]) if b>=a];hook=min(starts,default=0)
 loud='Not measured (run tools/edit/loudness.py on final and sections).'
 try:
  r=subprocess.run([sys.executable,str(Path(__file__).with_name('loudness.py')),str(a.video)],capture_output=True,text=True,encoding='utf-8');loud=r.stdout.strip() or r.stderr.strip()
 except Exception:pass
 captions=[str(x.get('caption','')) for x in rows if x.get('caption')];caption_words=sum(len(x.split()) for x in captions);caption_density=f'{caption_words/info["duration"]:.2f} words/s from EDL caption fields' if captions and info['duration'] else 'EDL has no caption text fields; visual OCR review required'
 sections=','.join(f'{s:.3f}-{e:.3f}' for s,e in zip(starts,ends) if e>s)
 if sections:
  try:
   r=subprocess.run([sys.executable,str(Path(__file__).with_name('loudness.py')),str(a.video),'--sections',sections],capture_output=True,text=True,encoding='utf-8');loud+='\nPer-section: '+r.stdout.strip()
  except Exception:pass
 brief=f'''# Critic brief — {a.recipe}\n\nReview `{a.video}`. Watch the full video and write ranked, timecoded issues to `critic_report.md` next to the brief. Cite visible/audio evidence; scan for repeated instances. Every critical issue must include a specific proposed fix; suggestions need a concrete change. Distinguish observation from inference.\n\n## Measured facts\n- Duration: {info['duration']:.2f}s; frame: {info['width']}×{info['height']}\n- EDL shots: {len(rows)}; mean shot length: {sum(lens)/len(lens) if lens else 0:.2f}s; longest EDL shot: {max(lens,default=0):.2f}s\n- Longest cut-free gap (EDL-derived): {max(gaps,default=max(lens,default=0)):.2f}s\n- First EDL hook time: {hook:.2f}s\n- Loudness: {loud}\n- Caption density: {caption_density}\n\n## Review rubric\nApply CHAI: accurate findings tied to timestamp/frame/field; complete pass checking for repeated defects; constructive critical findings with exact fixes. Score 1–5 on narrative contribution, reference adherence, subject/product consistency, action/camera readability, image quality, style consistency, editability, and technical usability. Grade A = directly usable; B = minor post repair; C = regenerate due to key identity/action/composition/continuity failure; D = upstream design failure requiring story/shot-design revision. Hard factual/identity/brand failures cannot be averaged away.\n\nApply retention laws: hook/payoff deadline (short hook ≤2.5s, long-form thesis ≤10s); visible change on a clock (shorts 3–8s; long-form median shot 3–6.5s and 7–13 visual changes/min); open early loop and close it around 55–85%; captions suit format (shorts 1–6 words/screen, one emphasis style; long-form avoid burned speech captions); preserve authentic pauses; keep text away from face and avoid zone overlap; end on payoff without an outro.\n\nReturn ranked findings with severity, timecode, evidence, why it matters, and proposed fix. Include a short pass/warnings decision and list what you checked.\n''';a.output.write_text(brief,encoding='utf-8');print(f'OK critic brief {a.output}')
 if a.send_gemini:
  cmd=f'bash ~/.claude/bin/agy.sh new-conversation --model=flash --title=critic "{a.output}"';print(cmd)
if __name__=='__main__':sys.stdout.reconfigure(encoding='utf-8');main()
