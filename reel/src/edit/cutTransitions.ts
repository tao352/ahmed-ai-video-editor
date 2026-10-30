// CapCut-style transitions on a footage cut: for `duration` seconds around the cut both shots play
// (the outgoing one runs on past its out point, the incoming one starts early) and each gets a style
// from the transition at progress p. Pure functions -> CSS, so the editor preview, the library's
// hover thumbnails and the render all agree. A transition is {at, type, duration} in data.transitions
// whose window [at, at + duration] holds a cut between two footage pieces.
import type React from 'react';

/** The 20 most used CapCut transitions (Basic, Camera, Blur, Glitch, Light, Mask, 3D packs). */
export const CUT_TRANSITIONS=[
 ['mix','Mix'],['black-fade','Black fade'],['white-flash','Flash'],['blur','Blur'],
 ['pull-in','Pull in'],['pull-out','Pull out'],['zoom-blur','Zoom blur'],['spin','Spin'],
 ['swipe-left','Swipe left'],['swipe-right','Swipe right'],['swipe-up','Swipe up'],['swipe-down','Swipe down'],
 ['shake','Shake'],['glitch','Glitch'],['rgb-split','RGB split'],['flare','Flare'],
 ['film-burn','Film burn'],['circle','Circle'],['wipe','Wipe'],['cube','Cube'],
] as const;
export type CutTransition=typeof CUT_TRANSITIONS[number][0];
const NAMES=new Set<string>(CUT_TRANSITIONS.map(([k])=>k));
export const isCutTransition=(type:string):type is CutTransition=>NAMES.has(type);
export const CUT_DEFAULT_DURATION=.5;

const clamp01=(v:number)=>Math.max(0,Math.min(1,v));
const inOut=(p:number)=>p<.5?4*p*p*p:1-Math.pow(-2*p+2,3)/2;
const easeIn=(p:number)=>p*p*p;
const easeOut=(p:number)=>1-Math.pow(1-p,3);
/** 0 at both ends, 1 at the middle: how hard the cut is "hit" */
const peak=(p:number)=>Math.sin(Math.PI*clamp01(p));
const HIDDEN:React.CSSProperties={opacity:0};

/**
 * Style of one shot during the transition. role 'out' = the shot ending, 'in' = the shot starting.
 * Most camera moves hide the outgoing shot at the middle and carry the motion across the cut.
 */
export function cutStyle(type:string,p:number,role:'out'|'in'):React.CSSProperties{
 p=clamp01(p);
 if(p>=1)return role==='in'?{}:HIDDEN; // done: the incoming shot alone, exactly as it plays after the cut
 const e=inOut(p),first=p<.5,a=first?easeIn(p*2):0,b=first?0:easeOut((p-.5)*2),k=peak(p);
 const out=role==='out';
 const half=(show:React.CSSProperties):React.CSSProperties=>(out?first:!first)?show:HIDDEN;
 switch(type){
  case 'mix':return out?{}:{opacity:e};
  case 'black-fade':case 'white-flash':return half({});
  case 'blur':return half({filter:`blur(${(k*28).toFixed(2)}px)`,transform:`scale(${1+k*.06})`});
  case 'pull-in':return out?half({transform:`scale(${1+a*.7})`,filter:`blur(${(a*22).toFixed(2)}px)`}):half({transform:`scale(${1.7-b*.7})`,filter:`blur(${((1-b)*22).toFixed(2)}px)`});
  case 'pull-out':return out?{zIndex:2,transform:`scale(${1-e*.45})`,opacity:1-easeIn(p),filter:`blur(${(e*16).toFixed(2)}px)`}:{transform:`scale(${1.35-e*.35})`};
  case 'zoom-blur':return out?half({transform:`scale(${1+a*1.4})`,filter:`blur(${(a*30).toFixed(2)}px) brightness(${1+a*.6})`}):half({transform:`scale(${2.4-b*1.4})`,filter:`blur(${((1-b)*30).toFixed(2)}px) brightness(${1+(1-b)*.6})`});
  case 'spin':return out?half({transform:`rotate(${a*180}deg) scale(${1+a*.5})`,filter:`blur(${(a*18).toFixed(2)}px)`}):half({transform:`rotate(${-(1-b)*180}deg) scale(${1.5-b*.5})`,filter:`blur(${((1-b)*18).toFixed(2)}px)`});
  case 'swipe-left':case 'swipe-right':case 'swipe-up':case 'swipe-down':{
   const dir=type==='swipe-left'?[-1,0]:type==='swipe-right'?[1,0]:type==='swipe-up'?[0,-1]:[0,1];
   const off=out?e*100:(e-1)*100,blur=k*26;
   return {transform:`translate(${dir[0]*off}%,${dir[1]*off}%)`,filter:`blur(${blur.toFixed(2)}px)`};
  }
  case 'shake':{
   const amp=k*48;
   return half({transform:`translate(${(Math.sin(p*71)*amp).toFixed(1)}px,${(Math.cos(p*53)*amp*.7).toFixed(1)}px) rotate(${(Math.sin(p*37)*k*3).toFixed(2)}deg) scale(${1+k*.12})`,filter:`blur(${(k*7).toFixed(2)}px)`});
  }
  case 'glitch':{
   const step=Math.floor(p*14)%3;
   return half({transform:`translateX(${(step-1)*k*60}px) skewX(${(step-1)*k*8}deg)`,filter:`hue-rotate(${step*90*k}deg) contrast(${1+k*.6})`});
  }
  case 'rgb-split':return half({transform:`translateX(${(Math.floor(p*18)%2?1:-1)*k*26}px) scale(${1+k*.08})`,filter:`saturate(${1+k*1.5})`});
  case 'flare':case 'film-burn':return out?{}:{opacity:clamp01((p-.3)/.4)};
  case 'circle':return out?{}:{clipPath:`circle(${(e*75).toFixed(2)}% at 50% 50%)`};
  case 'wipe':{
   const edge=e*120-10;
   const m=`linear-gradient(to right, #000 ${(edge-10).toFixed(2)}%, transparent ${edge.toFixed(2)}%)`;
   return out?{}:{maskImage:m,WebkitMaskImage:m};
  }
  case 'cube':return out
   ?{transformOrigin:'100% 50%',transform:`perspective(1800px) translateX(${-e*100}%) rotateY(${-e*90}deg)`,backfaceVisibility:'hidden'}
   :{transformOrigin:'0% 50%',transform:`perspective(1800px) translateX(${(1-e)*100}%) rotateY(${(1-e)*90}deg)`,backfaceVisibility:'hidden'};
 }
 return {};
}

/** A full-frame layer drawn over both shots (flashes, light, burns, scan lines), or null. */
export function cutOverlay(type:string,p:number):React.CSSProperties|null{
 p=clamp01(p);
 const k=peak(p);
 switch(type){
  case 'black-fade':return {background:'#000',opacity:k};
  case 'white-flash':return {background:'#fff',opacity:Math.pow(k,1.6)};
  case 'zoom-blur':return {background:'radial-gradient(circle at 50% 50%, transparent 30%, rgba(255,255,255,.35) 100%)',opacity:k,mixBlendMode:'screen'};
  case 'glitch':return {background:'repeating-linear-gradient(0deg,transparent 0 9%,rgba(0,229,255,.55) 9% 10.5%,transparent 10.5% 23%,rgba(255,34,85,.45) 23% 25%)',opacity:k,mixBlendMode:'screen',transform:`translateY(${(Math.floor(p*20)%5)*7}%)`};
  case 'rgb-split':return {background:`linear-gradient(90deg,rgba(255,0,64,.45),transparent 30% 70%,rgba(0,238,255,.45))`,opacity:k,mixBlendMode:'screen'};
  case 'flare':return {background:`radial-gradient(ellipse at ${(p*120-10).toFixed(1)}% 40%, #fffbe8 0%, rgba(255,190,90,.85) 18%, rgba(239,133,72,.35) 40%, transparent 70%)`,opacity:k,mixBlendMode:'screen'};
  case 'film-burn':return {background:`radial-gradient(ellipse at ${(20+p*60).toFixed(1)}% ${(70-p*40).toFixed(1)}%, #fff6d0 0%, #ffb347 22%, #e8481c 45%, rgba(120,20,0,.6) 65%, transparent 85%)`,opacity:Math.min(1,k*1.4),mixBlendMode:'screen'};
 }
 return null;
}

export type CutFx={type:string;at:number;duration:number;cut:number;out:number;in:number};
/**
 * Transitions that sit on a footage cut, with the two pieces they join (indices into base, in time order).
 * `pieces` are the footage spans; a transition belongs to the cut inside its window.
 */
export function footageCuts(pieces:{start:number;end:number}[],transitions:{at:number;type:string;duration:number}[]):CutFx[]{
 const order=pieces.map((s,i)=>({...s,i})).sort((a,b)=>a.start-b.start);
 const out:CutFx[]=[];
 for(const tr of transitions){
  if(!isCutTransition(tr.type))continue;
  for(let j=1;j<order.length;j++){
   const cut=order[j].start;
   if(cut>=tr.at-1e-3&&cut<=tr.at+tr.duration+1e-3){out.push({...tr,cut,out:order[j-1].i,in:order[j].i});break}
  }
 }
 return out;
}
