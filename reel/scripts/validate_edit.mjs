import fs from 'node:fs';
import path from 'node:path';
import {registry,editSchema,readJson} from './edit_runtime.mjs';
const file=process.argv[2];if(!file)throw Error('usage: validate_edit.mjs <edit.json>');
const target=path.resolve(file),data=editSchema.parse(readJson(target)),pub=path.join(path.dirname(target),'public'),errors=[];
const raw=fs.readFileSync(target,'utf8');if(/\?{4,}|\uFFFD/u.test(raw))errors.push('encoding damage: repeated question marks or replacement characters');
const identifiers=new Set();
for(const clip of data.clips){
 if(identifiers.has(clip.id))errors.push(`duplicate clip id: ${clip.id}`);identifiers.add(clip.id);
 if(clip.from<0||clip.to<=clip.from||clip.to>data.settings.duration+1e-6)errors.push(`${clip.id}: invalid clip window`);
 const entry=registry[clip.component];if(!entry){errors.push(`${clip.id}: unknown component ${clip.component}`);continue}
 const mode=data.layout.beats.find(b=>clip.from>=b.from&&clip.from<b.to)?.mode??data.layout.mode;
 const result=entry.schema.safeParse({...entry.defaults,accent:data.theme.colors.accent??'#0084FF',mode,width:data.settings.width,height:data.settings.height,words:data.captions.words,style:data.captions.style,audioSrc:data.audio.voice?.src,...clip.props,from:clip.from,to:clip.to});
 if(!result.success)errors.push(`${clip.id}: ${clip.component}: ${result.error.message}`);
}
const mediaKeys=new Set(['src','image','logo','audioSrc','srcA','srcB','mainSrc','pipSrc','matte','file','thumbs','images']);
function checkMedia(value,key,location){
 if(typeof value==='string'&&value&&mediaKeys.has(key)){
  const resolved=path.resolve(pub,value);if(!resolved.startsWith(pub+path.sep)||!fs.existsSync(resolved))errors.push(`${location}: missing public media ${value}`);
 }else if(Array.isArray(value))value.forEach((v,i)=>checkMedia(v,key,`${location}[${i}]`));
 else if(value&&typeof value==='object')for(const [k,v]of Object.entries(value))checkMedia(v,k,`${location}.${k}`);
}
checkMedia(data,'','edit');
if(errors.length){console.error(errors.join('\n'));process.exitCode=1}else console.log(`valid: ${target} (${data.clips.length} clips; 0 errors)`);
