// Timeline lane switches stored in edit.json: hide or mute a whole lane, or lock it so neither the
// editor nor Claude moves it. Keys match the Studio Editor lanes: track-<n>, words, base, voice,
// music, sfx, zoom, transitions, notes. The render applies hidden / muted; locked is a promise only;
// name is the owner's label for a clip track in the editor.
import {z} from 'zod';
import type {EditData} from './schema';

export const laneSchema=z.object({locked:z.boolean().optional(),hidden:z.boolean().optional(),muted:z.boolean().optional(),name:z.string().optional()});
export const lanesSchema=z.record(z.string(),laneSchema);
export type Lanes=z.infer<typeof lanesSchema>;

/** The edit as it should play: hidden lanes removed, muted lanes silent. */
export const applyLanes=(data:EditData&{lanes?:Lanes}):EditData=>{
 // clips and sounds switched off in the editor (CapCut "disable clip") stay in the file but do not play
 if(data.clips.some(c=>c.disabled)||data.audio.sfx.some(x=>x.disabled))data={...data,clips:data.clips.filter(c=>!c.disabled),audio:{...data.audio,sfx:data.audio.sfx.filter(x=>!x.disabled)}};
 const l=data.lanes;
 if(!l||!Object.values(l).some(x=>x.hidden||x.muted))return data;
 const off=(k:string)=>Boolean(l[k]?.hidden),mute=(k:string)=>Boolean(l[k]?.muted);
 return {
  ...data,
  clips:data.clips.filter(c=>!off(`track-${c.track??5}`)),
  captions:off('words')?{...data.captions,enabled:false}:data.captions,
  base:off('base')?[]:data.base,
  zooms:off('zoom')?[]:data.zooms,
  transitions:off('transitions')?[]:data.transitions,
  audio:{
   ...data.audio,
   voice:data.audio.voice&&mute('voice')?{...data.audio.voice,volume:0}:data.audio.voice,
   music:data.audio.music&&mute('music')?{...data.audio.music,volume:0}:data.audio.music,
   sfx:mute('sfx')?data.audio.sfx.map(s=>({...s,volume:0})):data.audio.sfx,
  },
 };
};
