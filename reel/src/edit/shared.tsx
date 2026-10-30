// Ported from reel/src/Reel4.tsx (fonts, tokens, Offset, Block, and springs).
import React from 'react';
import {Sequence,spring,useCurrentFrame,useVideoConfig} from 'remotion';
import {loadFont as loadPlex} from '@remotion/google-fonts/IBMPlexSansArabic';
import {loadFont as loadInstrument} from '@remotion/google-fonts/InstrumentSerif';
import {loadFont as loadMarkazi} from '@remotion/google-fonts/MarkaziText';

const {fontFamily:plex}=loadPlex('normal',{weights:['500','700'],subsets:['arabic','latin']});
const {fontFamily:serif}=loadInstrument('normal',{weights:['400'],subsets:['latin']});
const {fontFamily:markazi}=loadMarkazi('normal',{weights:['700'],subsets:['arabic','latin']});
export const defaultColors={canvas:'#F8FAFC',grid:'#E2E8F0',ink:'#0F172A',muted:'#94A3B8',blue:'#0084FF',red:'#E5484D',coral:'#D97757'};
export type Theme={colors:Record<string,string>;fonts:Record<string,string>};
export const ThemeContext=React.createContext<Theme>({colors:{},fonts:{}});
const fontNames:Record<string,string>={'IBMPlexSansArabic':plex,'IBM Plex Sans Arabic':plex,'InstrumentSerif':serif,'Instrument Serif':serif,'MarkaziText':markazi,'Markazi Text':markazi};
export const resolveFont=(name:string|undefined,fallback:string)=>name?(fontNames[name]??name):fallback;
export const useTokens=()=>{
 const theme=React.useContext(ThemeContext),C={...defaultColors,...theme.colors};
 const fonts={plex:resolveFont(theme.fonts.arabic,plex),serif:resolveFont(theme.fonts.serif,serif),markazi:resolveFont(theme.fonts.markazi,markazi)};
 const rtl:React.CSSProperties={direction:'rtl',unicodeBidi:'plaintext'};
 const font:React.CSSProperties={fontFamily:fonts.plex,fontWeight:700,...rtl};
 const grid:React.CSSProperties={backgroundColor:C.canvas,backgroundImage:`linear-gradient(${C.grid} 1px,transparent 1px),linear-gradient(90deg,${C.grid} 1px,transparent 1px)`,backgroundSize:'32px 32px',backgroundBlendMode:'multiply'};
 const card:React.CSSProperties={background:'#fff',border:'1.5px solid #E2E8F0',borderRadius:24,boxShadow:'0 4px 6px -1px rgba(0,0,0,.05), 0 20px 25px -5px rgba(0,0,0,.08)',color:C.ink};
 return {C,...fonts,rtl,font,grid,card};
};
export const Offset=React.createContext(0);
export const useAbsFrame=()=>useCurrentFrame()+React.useContext(Offset);
export const useFrameClock=()=>{const {fps}=useVideoConfig();return {f:(s:number)=>Math.round(s*fps),fps}};
export const Block:React.FC<{name:string;from:number;to:number;children:React.ReactNode}>=({name,from,to,children})=>{
 const {f}=useFrameClock();
 return <Sequence name={name} from={f(from)} durationInFrames={Math.max(1,f(to)-f(from))} layout="none"><Offset.Provider value={f(from)}>{children}</Offset.Provider></Sequence>;
};
export const clamp={extrapolateLeft:'clamp',extrapolateRight:'clamp'} as const;
export const sp=(frame:number,fps:number,damping=22,stiffness=280)=>spring({frame,fps,config:{damping,stiffness}});
export const Title:React.FC<{children:React.ReactNode}>=({children})=>{const {font}=useTokens();return <div style={{...font,fontSize:40,marginBottom:20,textAlign:'center'}}>{children}</div>};

// Canvas sizing for the generic library. Existing Reel4 tokens are untouched.
export const useScale=()=>{
 const {width,height}=useVideoConfig(),u=Math.min(width,height)/100;
 return {u,width,height,hero:9*u,title:6*u,subtitle:3.4*u,body:2.8*u,
  small:Math.max(22,2.2*u),number:14*u,chip:6*u,button:7*u,padding:2.4*u,
  radius:1.5*u,safe:5*u,safeX:width>height?width*.10:5*u};
};
