// Shapes made to ride on a track (clip.follow, see tracking.ts): an outline that highlights a building,
// a plot of land or an object, and a callout (pin, leader line and label) that points at it.
// Points are fractions of the composition, placed over the track's anchor frame; the follow layer
// carries them through the shot.
import React from 'react';
import {AbsoluteFill,useVideoConfig} from 'remotion';
import {z} from 'zod';
import {useAbsFrame} from '../shared';

const clamp01=(v:number)=>Math.max(0,Math.min(1,v));
const easeOut=(p:number)=>1-Math.pow(1-p,3);
const backOut=(p:number)=>{const c=1.70158;return 1+(c+1)*Math.pow(p-1,3)+c*Math.pow(p-1,2)};
const pt=z.tuple([z.number(),z.number()]);

/** Closed Catmull-Rom curve through the points (a smooth outline for curved roofs and land). */
function smoothPath(p:[number,number][]):string{
 const n=p.length;
 if(n<3)return '';
 let d=`M${p[0][0]},${p[0][1]}`;
 for(let i=0;i<n;i++){
  const a=p[(i-1+n)%n],b=p[i],c=p[(i+1)%n],e=p[(i+2)%n];
  d+=`C${b[0]+(c[0]-a[0])/6},${b[1]+(c[1]-a[1])/6} ${c[0]-(e[0]-b[0])/6},${c[1]-(e[1]-b[1])/6} ${c[0]},${c[1]}`;
 }
 return d+'Z';
}
const polyPath=(p:[number,number][])=>p.length?`M${p.map(q=>q.join(',')).join('L')}Z`:'';

export const HighlightSchema=z.object({
 points:z.array(pt).default([[.4,.4],[.6,.4],[.6,.6],[.4,.6]]),   // outline, fractions of the frame
 smooth:z.boolean().default(true),
 color:z.string().default('#FFD54A'),
 stroke:z.number().min(0).default(6),                              // px at the composition size
 fill:z.number().min(0).max(1).default(.18),                       // fill opacity
 glow:z.number().min(0).default(18),
 dash:z.boolean().default(false),
 draw:z.number().min(0).default(.9),                               // seconds the outline takes to draw itself
 pulse:z.boolean().default(true),                                  // a soft breathing glow while it shows
 width:z.number().default(1080),height:z.number().default(1920),from:z.number().default(0),to:z.number().default(3),
});
export const Highlight:React.FC<z.infer<typeof HighlightSchema>>=({points,smooth,color,stroke,fill,glow,dash,draw,pulse,width,height,from})=>{
 const {fps}=useVideoConfig(),t=useAbsFrame()/fps-from;
 const px=points.map(([x,y])=>[x*width,y*height] as [number,number]);
 const d=smooth?smoothPath(px):polyPath(px);
 const p=draw>0?easeOut(clamp01(t/draw)):1;
 const fillIn=clamp01((t-draw*.6)/.4);
 const breath=pulse?.75+.25*Math.sin(t*Math.PI*1.4):1;
 return <AbsoluteFill style={{pointerEvents:'none'}}>
  <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{position:'absolute',inset:0,overflow:'visible'}}>
   <path d={d} fill={color} fillOpacity={fill*fillIn} stroke="none"/>
   {glow>0&&<path d={d} fill="none" stroke={color} strokeWidth={stroke*2.2} strokeOpacity={.55*breath*p} pathLength={1} strokeDasharray={`${p} 1`} style={{filter:`blur(${glow*.6}px)`}} strokeLinejoin="round"/>}
   <path d={d} fill="none" stroke={color} strokeWidth={stroke} pathLength={1} strokeDasharray={dash?`.012 .008`:`${p} 1`} strokeOpacity={dash?p:1} strokeLinejoin="round" strokeLinecap="round"/>
  </svg>
 </AbsoluteFill>;
};

export const CalloutSchema=z.object({
 text:z.string().default('Label'),
 point:pt.default([.5,.5]),                                        // what it points at, fraction of the frame
 lift:z.number().default(.12),                                     // how far above the point the label sits, fraction of the height
 font:z.string().default(''),size:z.number().positive().default(54),weight:z.number().default(800),
 color:z.string().default('#111111'),background:z.string().default('#FFD54A'),line:z.string().default('#FFD54A'),
 sub:z.string().default(''),                                       // a second, smaller line (area, price...)
 width:z.number().default(1080),height:z.number().default(1920),from:z.number().default(0),to:z.number().default(3),
});
export const Callout:React.FC<z.infer<typeof CalloutSchema>>=({text,point,lift,font,size,weight,color,background,line,sub,width,height,from,to})=>{
 const {fps}=useVideoConfig(),t=useAbsFrame()/fps-from,left=to-from-t;
 const x=point[0]*width,y=point[1]*height,top=y-lift*height;
 const dot=backOut(clamp01(t/.35)),grow=easeOut(clamp01((t-.15)/.45)),card=backOut(clamp01((t-.45)/.45));
 const out=clamp01(left/.3); // fade out over the last 0.3 s
 const arabic=/[؀-ۿ]/.test(text);
 return <AbsoluteFill style={{pointerEvents:'none',opacity:out}}>
  <svg width={width} height={height} style={{position:'absolute',inset:0,overflow:'visible'}}>
   <line x1={x} y1={y} x2={x} y2={y-(y-top)*grow} stroke={line} strokeWidth={Math.max(3,size*.07)} strokeLinecap="round"/>
   <circle cx={x} cy={y} r={size*.22*dot} fill={line}/>
   <circle cx={x} cy={y} r={size*.22*dot*(1.6+.4*Math.sin(t*5))} fill="none" stroke={line} strokeOpacity={.5} strokeWidth={3}/>
  </svg>
  <div style={{position:'absolute',left:x,top,transform:`translate(-50%,-100%) scale(${card})`,transformOrigin:'50% 100%',background,color,
   fontFamily:font||undefined,fontWeight:weight,fontSize:size,lineHeight:1.15,padding:`${size*.28}px ${size*.5}px`,borderRadius:size*.32,
   whiteSpace:'nowrap',textAlign:'center',direction:arabic?'rtl':'ltr',boxShadow:'0 10px 30px rgba(0,0,0,.35)'}}>
   {text}
   {sub&&<div style={{fontSize:size*.5,fontWeight:600,opacity:.8,marginTop:size*.08}}>{sub}</div>}
  </div>
 </AbsoluteFill>;
};
