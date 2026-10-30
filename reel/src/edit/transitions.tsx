// Presentations use the installed Remotion transition primitives. Overlay ideas adapted from claude-code-video-toolkit/lib/transitions/presentations/.
import React from 'react';
import {AbsoluteFill,Easing,Freeze,Sequence,useCurrentFrame,useVideoConfig} from 'remotion';
import {TransitionSeries,linearTiming} from '@remotion/transitions';
import {fade} from '@remotion/transitions/fade';
import {slide} from '@remotion/transitions/slide';
import {wipe} from '@remotion/transitions/wipe';
import {flip} from '@remotion/transitions/flip';
import {clockWipe} from '@remotion/transitions/clock-wipe';
import type {TransitionPresentation,TransitionPresentationComponentProps} from '@remotion/transitions';
import {Offset} from './shared';
import type {EditClip,EditData} from './schema';
export const transitionRegistry={
 fade:{kind:'series',description:'Crossfade adjacent clips; duration begins at the incoming clip from.'},
 slide:{kind:'series',description:'Push outgoing and incoming scenes horizontally.'},
 scenePush:{kind:'series',description:'Cinematic scene push, using the slide presentation.'},
 wipe:{kind:'series',description:'Directional wipe between adjacent scenes.'},
 flip:{kind:'series',description:'Perspective card flip between adjacent scenes.'},
 clockWipe:{kind:'series',description:'Clockwise radial scene reveal.'},
 circleWipe:{kind:'series',description:'Expanding circular scene reveal.'},
 glitch:{kind:'overlay',description:'Deterministic displaced scanline bands.'},
 rgbSplit:{kind:'overlay',description:'Separated red and cyan flashes.'},
 lightLeak:{kind:'overlay',description:'Warm animated film light leak.'},
 zoomBlur:{kind:'overlay',description:'Radial streaks with backdrop blur.'},
 zoomThrough:{kind:'overlay',description:'Zoom blur burst.'},
 pixelate:{kind:'overlay',description:'Animated pixel grid.'},
 checkerboard:{kind:'overlay',description:'Checkerboard interference.'},
 whip:{kind:'legacy',description:'Original Reel4 whip blur.'},
 'whip-blur':{kind:'legacy',description:'Original Reel4 whip blur alias.'}
} as const;
export type TransitionName=keyof typeof transitionRegistry;
export const isSeriesTransition=(type:string)=>type in transitionRegistry&&transitionRegistry[type as TransitionName].kind==='series';
const Circle:React.FC<TransitionPresentationComponentProps<Record<string,never>>>=({children,presentationDirection,presentationProgress})=><AbsoluteFill style={{clipPath:presentationDirection==='entering'?`circle(${presentationProgress*150}% at 50% 50%)`:undefined}}>{children}</AbsoluteFill>;
export const presentationFor=(type:string,width:number,height:number):TransitionPresentation<Record<string,unknown>>=>{
 const result=type==='fade'?fade():type==='flip'?flip({direction:'from-right'}):type==='wipe'?wipe({direction:'from-right'}):type==='clockWipe'?clockWipe({width,height}):type==='circleWipe'?{component:Circle,props:{}}:slide({direction:'from-right'});
 return result as TransitionPresentation<Record<string,unknown>>;
};
// Series overlap is extended into the outgoing hold, preserving every authored from/to.
export const findClipChains=(clips:EditClip[],transitions:EditData['transitions'],fps:number)=>{
 const chains:EditClip[][]=[],used=new Set<string>();
 for(const first of clips){if(used.has(first.id))continue;const chain=[first];let previous=first;
  while(true){const next=clips.find(c=>!used.has(c.id)&&c.id!==previous.id&&!chain.includes(c)&&(c.track??5)===(previous.track??5)&&Math.round(c.from*fps)===Math.round(previous.to*fps)&&transitions.some(t=>Math.round(t.at*fps)===Math.round(c.from*fps)&&isSeriesTransition(t.type)));
   if(!next)break;chain.push(next);previous=next;
  }
  if(chain.length>1){chain.forEach(c=>used.add(c.id));chains.push(chain)}
 }
 return {chains,used};
};
const Hold:React.FC<{clip:EditClip;children:React.ReactNode}>=({clip,children})=>{
 const local=useCurrentFrame(),{fps}=useVideoConfig(),start=Math.round(clip.from*fps),length=Math.round(clip.to*fps)-start;
 return <Freeze frame={Math.min(local,length-1)}><Offset.Provider value={start}>{children}</Offset.Provider></Freeze>;
};
export const SequentialClips:React.FC<{clips:EditClip[];transitions:EditData['transitions'];render:(clip:EditClip)=>React.ReactNode}>=({clips,transitions,render})=>{
 const {fps,width,height}=useVideoConfig();
 const frames=(s:number)=>Math.round(s*fps),nodes:React.ReactNode[]=[];
 for(let i=0;i<clips.length;i++){
  const clip=clips[i],next=clips[i+1],transition=next?transitions.find(t=>frames(t.at)===frames(next.from)&&isSeriesTransition(t.type)):undefined;
  const overlap=transition?Math.max(1,frames(transition.duration)):0;
  nodes.push(<TransitionSeries.Sequence key={clip.id} name={clip.component} durationInFrames={frames(clip.to)-frames(clip.from)+overlap}><Hold clip={clip}>{render({...clip,to:clip.to+overlap/fps})}</Hold></TransitionSeries.Sequence>);
  if(transition)nodes.push(<TransitionSeries.Transition key={`t-${clip.id}`} timing={linearTiming({durationInFrames:overlap,easing:Easing.inOut(Easing.cubic)})} presentation={presentationFor(transition.type,width,height)}/>);
 }
 return <Sequence from={frames(clips[0].from)} durationInFrames={frames(clips.at(-1)!.to)-frames(clips[0].from)} layout="none"><TransitionSeries>{nodes}</TransitionSeries></Sequence>;
};
export const TransitionOverlay:React.FC<{type:string;progress:number}>=({type,progress})=>{
 const peak=Math.sin(Math.PI*progress),stripe=Math.floor(progress*16)%2;
 const background=type==='lightLeak'?`radial-gradient(ellipse at ${progress*120-10}% 35%,#fff5d8, #ef854875 20%,transparent 65%)`:type==='rgbSplit'?`linear-gradient(${stripe?90:270}deg,#ff004055,transparent 35% 65%,#00eeff55)`:type==='glitch'?`repeating-linear-gradient(0deg,transparent 0 11%,#00e5ff88 11% 12%,transparent 12% 25%,#ff225566 25% 27%)`:type==='pixelate'?'repeating-conic-gradient(#ffffff40 0 25%,#0004 0 50%) 0/48px 48px':type==='checkerboard'?'repeating-conic-gradient(#000 0 25%,transparent 0 50%) 0/96px 96px':'repeating-conic-gradient(from 10deg,#fff2 0 1deg,transparent 1deg 12deg)';
 return <AbsoluteFill style={{pointerEvents:'none',zIndex:18,opacity:peak,background,transform:type==='glitch'?`translateX(${stripe?30:-30}px)`:undefined,backdropFilter:type==='zoomBlur'||type==='zoomThrough'?`blur(${peak*14}px)`:type==='glitch'?`hue-rotate(${stripe*120}deg)`:undefined,mixBlendMode:type==='lightLeak'||type==='rgbSplit'?'screen':'normal'}}/>;
};
