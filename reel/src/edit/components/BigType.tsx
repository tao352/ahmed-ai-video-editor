// Ported from reel/src/Reel4.tsx. Geometry, springs, and reveal timing are preserved.
import React from 'react';
import {AbsoluteFill,interpolate,useVideoConfig} from 'remotion';
import {z} from 'zod';
import {useAbsFrame,useTokens,useFrameClock,sp,clamp} from '../shared';
import {bidiRuns} from '../bidi';
export const BigTypeSchema=z.object({b:z.object({from:z.number(),to:z.number(),text:z.string(),ar:z.boolean().optional(),hit:z.boolean().optional(),label:z.string().optional()}),accent:z.string()});
export type BigTypeProps=z.infer<typeof BigTypeSchema>;
export const BigType:React.FC<BigTypeProps>=({b,accent})=>{const {C,grid,card,font,rtl,plex,serif,markazi}=useTokens(),{f}=useFrameClock();const fr=useAbsFrame(),{fps}=useVideoConfig(),p=sp(fr-f(b.from),fps),latin=!b.ar;return <AbsoluteFill style={{alignItems:"center",pointerEvents:"none",zIndex:2}}>{b.label&&<div style={{position:"absolute",top:80,fontFamily:plex,fontWeight:700,fontSize:44,color:C.ink,...rtl}}>{bidiRuns(b.label)}</div>}<div style={{position:"absolute",top:b.label?150:115,width:"100%",textAlign:"center",fontFamily:latin?serif:markazi,fontWeight:latin?400:700,fontSize:latin?380:360,lineHeight:.95,color:b.hit?accent:C.ink,opacity:p,transform:`translateY(${(1-p)*46}px) scale(${b.hit?1.15-.15*p:1})`,...(!latin?rtl:{})}}>{b.text.split("\n").map((line,i)=><div key={i} style={{clipPath:`inset(0 0 ${(1-interpolate(fr-f(b.from),[i*3,i*3+9],[0,1],clamp))*100}% 0)`}}>{bidiRuns(line)}</div>)}</div></AbsoluteFill>};
