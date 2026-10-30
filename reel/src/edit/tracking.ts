// Tracking and stabilization (CapCut's Tracking / Stabilize), read from track files that
// tools/track/track.py writes under public/tracks/. A track holds, per source frame, the homography
// from its anchor frame to that frame, in normalized source coordinates (see track.py).
// Here the source -> composition mapping of a footage piece (fit, focus, keyframes, zooms, drift,
// stabilization) is built as one 3x3 matrix, so a clip that follows a track lands exactly where the
// tracked thing is drawn, in the editor preview and in the render alike.
import React from 'react';
import {continueRender,delayRender,staticFile} from 'remotion';
import type {EditData} from './schema';
import {zoomAt} from '../zoomMap';
import {keyedBox} from './clipfx';

export type TrackFile={version:number;kind:'plane'|'object'|'face'|'stabilize'|string;src:string;width:number;height:number;fps:number;
 anchor:number;start:number;end:number;shape:[number,number][];frames:number[][];outlines?:[number,[number,number][]][];zoom?:number;strength?:number};
export type Mat=number[]; // 3x3, row major

// ---------- matrices ----------
export const I3:Mat=[1,0,0,0,1,0,0,0,1];
export const mul=(a:Mat,b:Mat):Mat=>{
 const o=new Array(9);
 for(let r=0;r<3;r++)for(let c=0;c<3;c++)o[r*3+c]=a[r*3]*b[c]+a[r*3+1]*b[3+c]+a[r*3+2]*b[6+c];
 return o;
};
export const inv=(m:Mat):Mat=>{
 const [a,b,c,d,e,f,g,h,i]=m;
 const A=e*i-f*h,B=-(d*i-f*g),C=d*h-e*g,det=a*A+b*B+c*C||1e-12;
 return [A/det,-(b*i-c*h)/det,(b*f-c*e)/det,B/det,(a*i-c*g)/det,-(a*f-c*d)/det,C/det,-(a*h-b*g)/det,(a*e-b*d)/det];
};
export const apply=(m:Mat,[x,y]:[number,number]):[number,number]=>{const w=m[6]*x+m[7]*y+m[8]||1e-12;return [(m[0]*x+m[1]*y+m[2])/w,(m[3]*x+m[4]*y+m[5])/w]};
const T=(x:number,y:number):Mat=>[1,0,x,0,1,y,0,0,1];
const S=(sx:number,sy=sx):Mat=>[sx,0,0,0,sy,0,0,0,1];
const R=(deg:number):Mat=>{const r=deg*Math.PI/180,c=Math.cos(r),s=Math.sin(r);return [c,-s,0,s,c,0,0,0,1]};
const chain=(...ms:Mat[])=>ms.reduce(mul,I3);
/** CSS matrix3d of a 2D homography (use with transform-origin 0 0). */
export const css=(m:Mat)=>{const n=m.map(v=>+v.toFixed(8));return `matrix3d(${n[0]},${n[3]},0,${n[6]},${n[1]},${n[4]},0,${n[7]},0,0,1,0,${n[2]},${n[5]},0,${n[8]})`};

// ---------- track files ----------
type Entry={state:'loading'|'ready'|'error';track?:TrackFile;wait:Promise<void>;good?:Int32Array};
const files=new Map<string,Entry>();
const load=(file:string):Entry=>{
 let e=files.get(file);
 if(e)return e;
 const entry:Entry={state:'loading',wait:Promise.resolve()};
 entry.wait=fetch(staticFile(file)).then(r=>{if(!r.ok)throw new Error(`${r.status}`);return r.json()})
  .then((t:TrackFile)=>{entry.track=t;entry.state='ready'},err=>{entry.state='error';console.warn(`track ${file} could not be read: ${err}`)});
 files.set(file,entry);
 return entry;
};
/** The track file (cached), holding the render until it has loaded. undefined while loading or missing. */
export function useTrack(file?:string):TrackFile|undefined{
 const [,bump]=React.useState(0);
 const e=file?load(file):undefined;
 React.useEffect(()=>{
  if(!e||e.state!=='loading')return;
  const handle=delayRender(`track ${file}`);
  let live=true;
  e.wait.finally(()=>{continueRender(handle);if(live)bump(x=>x+1)});
  return ()=>{live=false};
 },[e,file]);
 return e?.state==='ready'?e.track:undefined;
}
/** Several track files at once (footage stabilization), keyed by file. */
export function useTracks(list:string[]):Record<string,TrackFile|undefined>{
 const [,bump]=React.useState(0);
 const key=list.join('|');
 const entries=React.useMemo(()=>list.map(f=>[f,load(f)] as const),[key]); // eslint-disable-line react-hooks/exhaustive-deps
 React.useEffect(()=>{
  const waiting=entries.filter(([,e])=>e.state==='loading');
  if(!waiting.length)return;
  const handle=delayRender(`tracks ${key}`);
  let live=true;
  Promise.allSettled(waiting.map(([,e])=>e.wait)).then(()=>{continueRender(handle);if(live)bump(x=>x+1)});
  return ()=>{live=false};
 },[entries,key]);
 const out:Record<string,TrackFile|undefined>={};
 for(const [f,e] of entries)out[f]=e.state==='ready'?e.track:undefined;
 return out;
}
/** Drop a cached track (the editor calls it after a tracking job rewrites the file). */
export const forgetTrack=(file:string)=>{files.delete(file)};

/** Homography (normalized source coords) of the track at source time s, holding the last good frame where it was lost. */
export function homographyAt(track:TrackFile,s:number):Mat{
 const n=track.frames.length;
 if(!n)return I3;
 let good=goodIndex.get(track);
 if(!good){
  good=new Int32Array(n);
  let last=-1;
  for(let i=0;i<n;i++){if(track.frames[i][9]>=.15||last<0)last=i;good[i]=last}
  goodIndex.set(track,good);
 }
 const x=Math.max(0,Math.min(n-1,(s-track.start)*track.fps)),i0=Math.floor(x),i1=Math.min(n-1,i0+1),k=x-i0;
 const a=track.frames[good[i0]],b=track.frames[good[i1]];
 const h=new Array(9);
 for(let j=0;j<8;j++)h[j]=a[1+j]*(1-k)+b[1+j]*k;
 h[8]=1;
 return h;
}
const goodIndex=new WeakMap<TrackFile,Int32Array>();

// ---------- footage piece -> composition ----------
type Base=EditData['base'][number];
/** Handheld drift Edit adds to the footage (identical on base + matte); layout.drift:false turns it off. */
export const driftAt=(data:EditData,t:number)=>{
 const k=data.layout.drift===false?0:1;
 return {x:k*(Math.sin(t*1.3)*5+Math.sin(t*2.9)*2.2),y:k*(Math.cos(t*1.1)*4+Math.sin(t*3.3)*1.8)};
};
const STILL={x:0,y:0,scale:1,rotate:0,opacity:1};
export const pieceLength=(data:EditData,b:Base)=>b.duration??Math.max(0,data.settings.duration-b.start);
/** Source time shown by a footage piece at composition time t. */
export const sourceTime=(b:Base,t:number)=>b.freeze?(b.sourceIn??0):(b.sourceIn??0)+Math.max(0,t-b.start)*(b.speed??1);

/**
 * The transform Edit puts on a footage video element at time t (origin 0 0): stabilization, its
 * edge-hiding zoom, then keyframes, zoom events, drift and mirror around Edit's 50%/28% origin.
 */
export function videoMatrix(data:EditData,b:Base,t:number,W:number,H:number,stab?:TrackFile):Mat{
 const kb=keyedBox(STILL,b.keys,t-(b.start??0)),zoom=zoomAt(data.zooms,t),d=driftAt(data,t);
 const ox=W*.5,oy=H*.28;
 const move=chain(T(ox,oy),T(d.x+kb.x*W,d.y+kb.y*H),S(zoom*kb.scale),R(kb.rotate),b.mirror?S(-1,1):I3,T(-ox,-oy));
 if(!stab)return move;
 const s=stabilizeAt(b,stab,t,W,H);
 return mul(move,s);
}

/** Element-pixel matrix that steadies the piece (correction then the zoom that hides the moved edges). */
function stabilizeAt(b:Base,stab:TrackFile,t:number,W:number,H:number):Mat{
 const F=fitMatrix(b,W,H,stab.width,stab.height);
 const Hn=homographyAt(stab,sourceTime(b,t));
 const z=Math.max(1,stab.zoom??1);
 return chain(T(W/2,H/2),S(z),T(-W/2,-H/2),F,Hn,inv(F));
}

/** Normalized source coords -> element pixels for object-fit cover/contain/fill with the piece's focus. */
export function fitMatrix(b:Base,W:number,H:number,sw:number,sh:number):Mat{
 const fit=b.fit==='blurfill'?'contain':b.fit??'cover';
 const [fx,fy]=b.focus??[.5,.5];
 if(fit==='fill')return S(W,H);
 const s=fit==='contain'?Math.min(W/sw,H/sh):Math.max(W/sw,H/sh);
 return chain(T((W-sw*s)*fx,(H-sh*s)*fy),S(s*sw,s*sh));
}

/** Normalized source coords of piece b -> composition pixels at time t. */
export const sourceToComp=(data:EditData,b:Base,t:number,W:number,H:number,sw:number,sh:number,stab?:TrackFile)=>
 mul(videoMatrix(data,b,t,W,H,stab),fitMatrix(b,W,H,sw,sh));

/** The footage piece that shows `src` at t: the one playing then, else the nearest in time. */
export function pieceFor(data:EditData,src:string,t:number):Base|undefined{
 let best:Base|undefined,gap=Infinity;
 for(const b of data.base){
  if(b.src!==src)continue;
  const s=b.start,e=b.start+pieceLength(data,b);
  const g=t<s?s-t:t>=e?t-e+1e-6:0;
  if(g<gap){gap=g;best=b}
 }
 return best;
}

export type Follow={track:string;mode?:'perspective'|'transform'|'position';point?:[number,number]};

/**
 * The composition-pixel homography that carries what was placed over the anchor frame to where the
 * tracked thing is at time t. The anchor frame is the time the piece shows the track's anchor.
 */
export function followMatrix(data:EditData,track:TrackFile,t:number,W:number,H:number,stabs:Record<string,TrackFile|undefined>):Mat|undefined{
 const b=pieceFor(data,track.src,t);
 if(!b)return undefined;
 const ta=Math.max(b.start,Math.min(b.start+pieceLength(data,b),b.start+(track.anchor-(b.sourceIn??0))/(b.speed??1)));
 const stab=b.stabilize?stabs[b.stabilize.track]:undefined;
 const now=sourceToComp(data,b,t,W,H,track.width,track.height,stab);
 const then=sourceToComp(data,b,ta,W,H,track.width,track.height,stab);
 return chain(now,homographyAt(track,sourceTime(b,t)),inv(then));
}

/** CSS transform (origin 0 0) for a follow mode from the follow homography G. */
export function followCss(G:Mat,mode:Follow['mode'],point:[number,number]):string{
 if(!mode||mode==='perspective')return css(G);
 const [cx,cy]=point,[nx,ny]=apply(G,point);
 if(mode==='position')return `translate(${(nx-cx).toFixed(2)}px,${(ny-cy).toFixed(2)}px)`;
 // transform: position, size and turn of the surface around the point (local Jacobian), no perspective
 const e=1,[ax,ay]=apply(G,[cx+e,cy]),[bx,by]=apply(G,[cx,cy+e]);
 const jx=[ax-nx,ay-ny],jy=[bx-nx,by-ny];
 const scale=Math.sqrt(Math.abs(jx[0]*jy[1]-jx[1]*jy[0])),rot=Math.atan2(jx[1],jx[0])*180/Math.PI;
 return `translate(${nx.toFixed(2)}px,${ny.toFixed(2)}px) rotate(${rot.toFixed(3)}deg) scale(${scale.toFixed(5)}) translate(${-cx}px,${-cy}px)`;
}

/** Where the tracked shape sits in composition pixels at the anchor (for placing a clip over it). */
export function shapeAtAnchor(data:EditData,track:TrackFile,W:number,H:number,stabs:Record<string,TrackFile|undefined>={}):[number,number][]{
 const b=pieceFor(data,track.src,0);
 if(!b)return [];
 const ta=b.start+(track.anchor-(b.sourceIn??0))/(b.speed??1);
 const stab=b.stabilize?stabs[b.stabilize.track]:undefined;
 const m=sourceToComp(data,b,ta,W,H,track.width,track.height,stab);
 return track.shape.map(p=>apply(m,p));
}
