// Ported from reel/src/Reel4.tsx. Geometry, springs, and reveal timing are preserved.
import React from 'react';
import {AbsoluteFill,interpolate,useVideoConfig} from 'remotion';
import {z} from 'zod';
import {useAbsFrame,useTokens,useFrameClock,sp,clamp} from '../shared';
import {bidiRuns} from '../bidi';
export const HeadlineSchema=z.object({head:z.tuple([z.string(),z.string()]),from:z.number(),accent:z.string()});
export type HeadlineProps=z.infer<typeof HeadlineSchema>;
export const Headline:React.FC<HeadlineProps>=({head,from,accent})=>{const {C,grid,card,font,rtl,plex,serif,markazi}=useTokens(),{f}=useFrameClock();const fr=useAbsFrame(),{fps}=useVideoConfig(),p=sp(fr-f(from),fps);return <div dir="rtl" style={{position:"absolute",top:74,width:"100%",display:"flex",alignItems:"center",flexDirection:"column",gap:8,zIndex:3}}><div style={{...font,fontSize:58,color:C.ink,opacity:p,transform:`translateY(${(1-p)*22}px)`,textAlign:"center",maxWidth:1000,lineHeight:1.12}}>{bidiRuns(head[0])}</div><div style={{...font,fontSize:52,color:"white",background:accent,borderRadius:14,padding:"5px 24px 10px",transform:`scaleX(${p})`,transformOrigin:"right center",lineHeight:1.1,maxWidth:1020,textAlign:"center"}}>{bidiRuns(head[1])}</div></div>};
