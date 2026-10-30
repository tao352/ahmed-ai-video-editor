import React from 'react';
import {Easing,interpolate,spring,useVideoConfig} from 'remotion';
import {z} from 'zod';
import {bidiRuns} from '../bidi';
import {useAbsFrame,useTokens,clamp} from '../shared';

export const StepBadgeSchema=z.object({from:z.number(),to:z.number(),step:z.number(),total:z.number(),title:z.string(),accent:z.string().default('#3b82f6'),y:z.number().default(.075)});
export type StepBadgeProps=z.infer<typeof StepBadgeSchema>;
export const StepBadge:React.FC<StepBadgeProps>=p=>{
 const frame=useAbsFrame(),{fps,height}=useVideoConfig(),{plex}=useTokens(),start=Math.round(p.from*fps),end=Math.round(p.to*fps),enter=spring({frame:frame-start,fps,config:{damping:18,stiffness:250}}),fadeIn=interpolate(frame,[start,start+Math.round(.4*fps)],[0,1],clamp),fadeOut=interpolate(frame,[end-Math.round(.25*fps),end],[1,0],{...clamp,easing:Easing.inOut(Easing.cubic)}),progress=Math.min(enter,fadeIn),opacity=Math.min(progress,fadeOut),scale=.9+.1*enter;
 const titleParts=p.title.split(/([A-Za-z][A-Za-z0-9&._'-]*(?: [A-Za-z0-9&._'-]+)*)/g);
 return <div style={{position:'absolute',top:height*p.y,left:0,right:0,display:'flex',justifyContent:'center',pointerEvents:'none',opacity,transform:`scale(${scale})`}}><div dir="rtl" style={{display:'flex',alignItems:'center',gap:20,padding:'18px 28px',borderRadius:999,background:'rgba(10,15,25,.72)',border:'1px solid rgba(255,255,255,.12)',backdropFilter:'blur(16px)',WebkitBackdropFilter:'blur(16px)',boxShadow:'0 12px 40px rgba(0,0,0,.22)',fontFamily:plex,color:'#fff',maxWidth:'92%',boxSizing:'border-box'}}><div style={{width:58,height:58,flex:'0 0 58px',borderRadius:'50%',background:p.accent,display:'grid',placeItems:'center',fontSize:30,fontWeight:700}}>{p.step}</div><div style={{display:'flex',flexDirection:'column',gap:2,textAlign:'right',minWidth:0}}><span style={{fontSize:28,color:'rgba(255,255,255,.7)',lineHeight:1.1}}>{bidiRuns(`خطوة ${p.step} من ${p.total}`)}</span><span dir="rtl" style={{fontSize:44,fontWeight:700,lineHeight:1.18,whiteSpace:'nowrap'}}>{titleParts.map((part,i)=>/^[A-Za-z]/.test(part)?<span key={i} style={{unicodeBidi:'isolate',direction:'ltr'}}>{bidiRuns(part)}</span>:<React.Fragment key={i}>{bidiRuns(part)}</React.Fragment>)}</span></div></div></div>;
};
