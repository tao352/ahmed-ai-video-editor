// Gain curves for the edit's audio: fades and music ducking under speech.
// Pure functions of time, so the preview and the render hear exactly the same mix.

/** Linear fade in over `fadeIn` s from `start`, fade out over `fadeOut` s before `end`. */
export const fadeGain=(t:number,start:number,end:number,fadeIn=0,fadeOut=0):number=>{
 let g=1;
 if(fadeIn>0)g=Math.min(g,Math.max(0,(t-start)/fadeIn));
 if(fadeOut>0)g=Math.min(g,Math.max(0,(end-t)/fadeOut));
 return g;
};

/**
 * How much speech is happening at t, 0..1: 1 inside a word, ramping in over `attack` s
 * before it and out over `release` s after it. Gaps shorter than attack+release stay ducked.
 */
export const speechAmount=(t:number,words:[number,number,string][],attack=.08,release=.35):number=>{
 let best=0;
 for(const [s,e]of words){
  if(s-attack>t)break;
  if(t>=s&&t<=e)return 1;
  if(t<s)best=Math.max(best,attack>0?1-(s-t)/attack:0);
  else if(t>e)best=Math.max(best,release>0?1-(t-e)/release:0);
 }
 return Math.max(0,Math.min(1,best));
};

export type Duck={db:number;attack:number;release:number};
/** Music gain under speech: lowered by `db` decibels while someone talks. */
export const duckGain=(t:number,words:[number,number,string][],duck:Duck):number=>Math.pow(10,-duck.db*speechAmount(t,words,duck.attack,duck.release)/20);

/** Volume keyframes on a sound (CapCut KFTypeVolume): `volume` is a 0..2 multiplier at item time `t`. */
export type VolumeKey={t:number;volume?:number;ease?:'linear'|'in'|'out'|'inOut'|'hold'};
const shape=(e:VolumeKey['ease'],p:number)=>e==='in'?p*p*p:e==='out'?1-Math.pow(1-p,3):e==='inOut'?(p<.5?4*p*p*p:1-Math.pow(-2*p+2,3)/2):e==='hold'?0:p;
/** The keyframed multiplier at item time t; 1 without keys, held flat before the first and after the last. */
export const volumeAt=(keys:VolumeKey[]|undefined,t:number):number=>{
 const ks=(keys??[]).filter(k=>k.volume!==undefined).sort((a,b)=>a.t-b.t);
 if(!ks.length)return 1;
 if(t<=ks[0].t)return ks[0].volume!;
 for(let i=1;i<ks.length;i++){
  const a=ks[i-1],b=ks[i];
  if(t<=b.t)return a.volume!+(b.volume!-a.volume!)*shape(b.ease,(t-a.t)/Math.max(1e-6,b.t-a.t));
 }
 return ks[ks.length-1].volume!;
};
