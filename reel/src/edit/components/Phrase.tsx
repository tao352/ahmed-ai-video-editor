// Ported from reel/src/Reel4.tsx. Geometry, springs, and reveal timing are preserved.
import React from 'react';
import {AbsoluteFill,interpolate,useVideoConfig} from 'remotion';
import {z} from 'zod';
import {useAbsFrame,useTokens,useFrameClock,sp,clamp} from '../shared';
import {bidiRuns} from '../bidi';
export const PhraseSchema=z.object({p:z.object({from:z.number(),to:z.number(),lines:z.array(z.string()),hit:z.boolean().optional()}),accent:z.string()});
export type PhraseProps=z.infer<typeof PhraseSchema>;
export const Phrase:React.FC<PhraseProps>=({p,accent})=>{const {C,grid,card,font,rtl,plex,serif,markazi}=useTokens(),{f}=useFrameClock();const fr=useAbsFrame(),{fps}=useVideoConfig();return <div style={{position:"absolute",top:70,width:"100%",display:"flex",flexDirection:"column",alignItems:"center",gap:10,zIndex:8}}>{p.lines.map((line,i)=>{const a=sp(fr-f(p.from)-i*6,fps);return <div key={line} style={{fontFamily:i?serif:plex,fontStyle:i?"italic":"normal",fontWeight:700,fontSize:i?96:70,padding:"7px 26px 12px",borderRadius:14,background:i?accent:"white",color:i?"white":C.ink,transform:`scale(${a})`,boxShadow:"0 8px 26px rgba(15,23,42,.13)"}}>{line}</div>})}</div>};
