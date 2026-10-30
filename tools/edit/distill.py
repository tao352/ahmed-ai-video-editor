"""Persist learnings from an approved edit.
Ported from cheap-claude-video/references/workflow-state-artifacts.md (durable workflow memory/capsule format)."""
import argparse,json,sys,re,datetime
from pathlib import Path

def main():
 ap=argparse.ArgumentParser();ap.add_argument('project_dir',type=Path);a=ap.parse_args();root=a.project_dir;edit=root/'edit';edlp=edit/'edl.json';ep=edit/'edit.json';edl=json.loads(edlp.read_text(encoding='utf-8-sig')) if edlp.exists() else {};ej=json.loads(ep.read_text(encoding='utf-8-sig')) if ep.exists() else {};rows=edl if isinstance(edl,list) else edl.get('ranges',edl.get('clips',edl.get('segments',[])));dur=sum(max(0,float(x.get('end',0))-float(x.get('start',0))) for x in rows);components={}
 def walk(x):
  if isinstance(x,dict):
   n=x.get('component') or x.get('type')
   if n:components[n]=components.get(n,0)+1
   for v in x.values():walk(v)
  elif isinstance(x,list):
   for v in x:walk(v)
 walk(ej);pm=edit/'project.md';notes=pm.read_text(encoding='utf-8-sig') if pm.exists() else '';genre='general'
 for g in ('reel-talking-head','youtube-16x9','cinematic','real-estate','podcast-clip','promo-explainer'):
  if g in notes.lower():genre=g;break
 repo=next((p for p in (root,*root.parents) if (p/'tools'/'edit').is_dir()),root.parent.parent)
 date=datetime.date.today().isoformat();out=repo/'recipes_learned'/f'{genre}-{date}.md';out.parent.mkdir(parents=True,exist_ok=True);out.write_text(f'''# Learned recipe: {genre}\n\nValidated after approved project `{root.name}` on {date}.\n\n## EDL stats\n- Segments: {len(rows)}\n- Kept duration: {dur:.2f}s\n- Mean segment: {dur/len(rows) if rows else 0:.2f}s\n\n## Edit structure\n- Top level keys: {', '.join(ej.keys()) if isinstance(ej,dict) else 'array'}\n- Components/types: {json.dumps(components,ensure_ascii=False)}\n\n## Grade and loudness\n- Grade: inspect edit.json grade field: `{ej.get('grade','not recorded') if isinstance(ej,dict) else 'not recorded'}`\n- Loudness target: -14 LUFS / -1 dBTP; measured result was not stored in project files.\n\n## Iteration learnings\nExtracted project memory (user edits/notes):\n\n{notes[-5000:] if notes else 'No project.md notes found.'}\n\nReuse this as a starting point; retain only decisions supported by the approved edit.\n''',encoding='utf-8');print(f'OK distill {out}')
if __name__=='__main__':sys.stdout.reconfigure(encoding='utf-8');main()
