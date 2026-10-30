// CapCut's text: one block of text the owner types, in any font on the machine, with stroke,
// background, shadow, and CapCut's text animations (per letter / per word In, Out and Loop).
// clip.box places it, clip.style adds glow/outline to the whole block, clip.anim holds the animations
// (TEXT_IN / TEXT_LOOP play here; the clip-wide ones play on the layer in Edit.tsx).
import React from 'react';
import {AbsoluteFill,useVideoConfig} from 'remotion';
import {z} from 'zod';
import {useAbsFrame,useTokens} from '../shared';
import {animSchema,TEXT_IN,TEXT_LOOP} from '../clipfx';

const color=z.string();
export const TextSchema=z.object({
 text:z.string().default('Default text'),
 font:z.string().default(''),                                            // a font family on the machine; empty = the theme font
 size:z.number().positive().default(80),                                 // px at the composition size
 color:color.default('#ffffff'),
 weight:z.number().min(100).max(900).default(700),
 italic:z.boolean().default(false),underline:z.boolean().default(false),
 caps:z.enum(['none','upper','lower']).default('none'),
 align:z.enum(['left','center','right']).default('center'),
 spacing:z.number().default(0),                                          // letter spacing, px
 lineHeight:z.number().positive().default(1.2),
 wrap:z.number().min(.1).max(1).default(.86),                            // wrap width, fraction of the frame (width/height are the frame's, injected by Edit)
 stroke:z.object({color:color.default('#000000'),width:z.number().min(0).default(6)}).optional(),
 background:z.object({color:color.default('#000000'),opacity:z.number().min(0).max(1).default(.7),radius:z.number().min(0).default(16),padX:z.number().min(0).default(28),padY:z.number().min(0).default(14)}).optional(),
 shadow:z.object({color:color.default('#000000'),opacity:z.number().min(0).max(1).default(.6),blur:z.number().min(0).default(12),x:z.number().default(0),y:z.number().default(6)}).optional(),
 anim:animSchema.optional(),                                             // passed in from the clip by Edit.tsx
 from:z.number().default(0),to:z.number().default(3),
});
export type TextProps=z.infer<typeof TextSchema>;

const TEXT_IN_SET=new Set<string>(TEXT_IN),TEXT_LOOP_SET=new Set<string>(TEXT_LOOP);
const LETTER_ANIMS=new Set(['typewriter','letter-fade','blur-letters','letters-bounce']);
const ARABIC=/[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
const clamp01=(v:number)=>Math.max(0,Math.min(1,v));
const easeOut=(p:number)=>1-Math.pow(1-p,3);
const backOut=(p:number)=>{const c=1.70158;return 1+(c+1)*Math.pow(p-1,3)+c*Math.pow(p-1,2)};
const bounceOut=(p:number)=>{const n=7.5625,d=2.75;if(p<1/d)return n*p*p;if(p<2/d)return n*(p-=1.5/d)*p+.75;if(p<2.5/d)return n*(p-=2.25/d)*p+.9375;return n*(p-=2.625/d)*p+.984375};
const rgba=(hex:string,a:number)=>{const h=hex.replace('#','');const f=h.length===3?[...h].map(c=>c+c).join(''):h.slice(0,6);const n=parseInt(f,16);return Number.isNaN(n)?hex:`rgba(${n>>16&255},${n>>8&255},${n&255},${a})`};

/**
 * Split text into animation units: letters, or words when the anim is word-based or the text is
 * Arabic (Arabic letters join, so they only animate as whole words). Whitespace stays its own unit.
 */
export const textUnits=(text:string,letters:boolean):string[]=>{
 if(letters&&!ARABIC.test(text))return [...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)].map(s=>s.segment);
 return text.split(/(\s+)/).filter(Boolean);
};

/** Progress (0..1) of unit i of n, `t` seconds into a `dur`-long staggered entrance. */
export const staggered=(t:number,dur:number,i:number,n:number,each=.45)=>{
 if(n<=1)return clamp01(t/dur);
 const w=dur*each,start=(dur-w)*(i/(n-1));
 return clamp01((t-start)/w);
};

type UnitLook={opacity:number;tx:number;ty:number;scale:number;blur:number};
const settled=():UnitLook=>({opacity:1,tx:0,ty:0,scale:1,blur:0});
/** One unit at entrance progress p (0 hidden .. 1 settled); ty in em. */
const unitEnter=(name:string,p:number):UnitLook=>{
 const u=settled(),e=easeOut(p);
 switch(name){
  case 'typewriter':u.opacity=p>0?1:0;break;
  case 'letter-fade':case 'word-fade':u.opacity=e;break;
  case 'blur-letters':u.opacity=e;u.blur=(1-e)*.25;break;
  case 'word-pop':u.scale=.3+.7*backOut(p);u.opacity=clamp01(p*3);break;
  case 'word-rise':u.ty=(1-e)*.7;u.opacity=e;break;
  case 'word-drop':u.ty=-(1-bounceOut(p))*.9;u.opacity=clamp01(p*4);break;
 }
 return u;
};
const unitLoop=(name:string,t:number,i:number,speed:number):UnitLook=>{
 const u=settled(),w=2*Math.PI*speed*t;
 if(name==='wave')u.ty=Math.sin(w*1.1-i*.65)*.12;
 if(name==='letters-bounce')u.ty=-Math.abs(Math.sin(w*.9-i*.45))*.2;
 return u;
};

export const Text:React.FC<TextProps>=p=>{
 const frame=useAbsFrame(),{fps,width}=useVideoConfig(),{plex}=useTokens();
 const t=frame/fps-p.from,dur=Math.max(.05,p.to-p.from);
 const a=p.anim;
 const inName=a?.in&&TEXT_IN_SET.has(a.in)?a.in:undefined,outName=a?.out&&TEXT_IN_SET.has(a.out)?a.out:undefined;
 const loopName=a?.loop&&TEXT_LOOP_SET.has(a.loop)?a.loop:undefined,speed=a?.loopSpeed??1;
 const inDur=Math.min(a?.inDur??.6,dur/2),outDur=Math.min(a?.outDur??.5,dur/2);
 const inP=inName&&t<inDur?t/inDur:1,outP=outName&&t>dur-outDur?(dur-t)/outDur:1;
 const text=p.caps==='upper'?p.text.toUpperCase():p.caps==='lower'?p.text.toLowerCase():p.text;
 const perUnit=(inName&&!['wipe','stretch'].includes(inName))||(outName&&!['wipe','stretch'].includes(outName))||loopName==='wave'||loopName==='letters-bounce';
 const letters=[inName,outName,loopName].some(n=>n&&LETTER_ANIMS.has(n));
 const units=perUnit?textUnits(text,letters):[text];
 const solid=units.map(u=>!/^\s+$/.test(u));
 const count=solid.filter(Boolean).length;

 // whole-block effects: wipe, stretch, jelly, flicker, glow pulse
 let clip:string|undefined,spacing=p.spacing,scaleX=1,scaleY=1,blockOpacity=1,glow=0;
 const wipe=(q:number)=>{const cut=`${((1-easeOut(clamp01(q)))*100).toFixed(2)}%`;return ARABIC.test(text)?`inset(0 0 0 ${cut})`:`inset(0 ${cut} 0 0)`};
 if(inName==='wipe'&&inP<1)clip=wipe(inP);
 if(outName==='wipe'&&outP<1)clip=wipe(outP);
 // stretch: Latin opens its letter spacing; Arabic letters must stay joined, so the block widens instead
 const stretch=(q:number)=>{const e=easeOut(clamp01(q));if(ARABIC.test(text))scaleX*=1+(1-e)*.6;else spacing=p.spacing+(1-e)*p.size*.6;blockOpacity*=e};
 if(inName==='stretch'&&inP<1)stretch(inP);
 if(outName==='stretch'&&outP<1)stretch(outP);
 const w=2*Math.PI*speed*t;
 if(loopName==='jelly'){scaleX*=1+Math.sin(w*1.6)*.045;scaleY*=1-Math.sin(w*1.6)*.045}
 if(loopName==='flicker'){const n=Math.sin(t*speed*37.1)*Math.sin(t*speed*13.7);blockOpacity*=n>.55?.35:1}
 if(loopName==='glow-pulse')glow=.5+.5*Math.sin(w*1.2);

 const shadows:string[]=[];
 if(p.shadow)shadows.push(`${p.shadow.x}px ${p.shadow.y}px ${p.shadow.blur}px ${rgba(p.shadow.color,p.shadow.opacity)}`);
 if(glow)shadows.push(`0 0 ${(.15+.35*glow)*p.size}px ${rgba(p.color,.55+.4*glow)}`);
 const bg=p.background;
 let k=-1;
 return (
  <AbsoluteFill style={{display:'grid',placeItems:'center',pointerEvents:'none'}}>
   <div dir="auto" style={{
    maxWidth:p.wrap*width,boxSizing:'border-box',whiteSpace:'pre-wrap',overflowWrap:'anywhere',unicodeBidi:'plaintext',
    fontFamily:p.font?`"${p.font}", ${plex}`:plex,fontSize:p.size,fontWeight:p.weight,fontStyle:p.italic?'italic':undefined,
    textDecoration:p.underline?'underline':undefined,textAlign:p.align,letterSpacing:spacing||undefined,lineHeight:p.lineHeight,color:p.color,
    WebkitTextStroke:p.stroke&&p.stroke.width>0?`${p.stroke.width*2}px ${p.stroke.color}`:undefined,paintOrder:'stroke fill',
    textShadow:shadows.join(', ')||undefined,
    background:bg?rgba(bg.color,bg.opacity):undefined,borderRadius:bg?.radius,padding:bg?`${bg.padY}px ${bg.padX}px`:undefined,
    clipPath:clip,opacity:blockOpacity<1?blockOpacity:undefined,transform:scaleX!==1||scaleY!==1?`scale(${scaleX},${scaleY})`:undefined,
   }}>
    {perUnit?units.map((u,i)=>{
     if(!solid[i])return <React.Fragment key={i}>{u}</React.Fragment>;
     k++;
     let look=settled();
     if(inName&&inP<1)look=unitEnter(inName,staggered(t,inDur,k,count));
     else if(outName&&outP<1)look=unitEnter(outName,staggered(dur-t,outDur,count-1-k,count));
     if(loopName){const l=unitLoop(loopName,t,k,speed);look={...look,ty:look.ty+l.ty}}
     const moved=look.tx||look.ty||look.scale!==1;
     return <span key={i} style={{display:'inline-block',opacity:look.opacity<1?look.opacity:undefined,
      transform:moved?`translate(${look.tx}em,${look.ty}em) scale(${look.scale})`:undefined,filter:look.blur>.001?`blur(${look.blur}em)`:undefined}}>{u}</span>;
    }):text}
   </div>
  </AbsoluteFill>
 );
};
