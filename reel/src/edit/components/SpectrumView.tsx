// Ported from template-audiogram/src/Audiogram/Spectrum.tsx; aligned to the edit voice clock.
import React from 'react';
import {getStaticFiles,staticFile,useVideoConfig} from 'remotion';
import {useAudioData,visualizeAudio} from '@remotion/media-utils';
import {useAbsFrame,useScale} from '../shared';
type Props={audioSrc?:string;bars:number;accent:string;waveform?:boolean};
const Bars:React.FC<Props&{values:number[]}>=({values,accent,waveform})=>{
 const s=useScale();
 return <div style={{position:'absolute',insetInline:s.safeX,bottom:s.height*.22,height:s.height*.13,display:'flex',gap:.45*s.u,alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,.70)',border:'1px solid #ffffff20',borderRadius:s.radius,padding:s.padding}}>{values.map((v,i)=><i key={i} style={{display:'block',flex:1,maxWidth:1.3*s.u,minWidth:2,height:Math.max(.4*s.u,Math.min(1,v)*(s.height*.11)),background:accent,borderRadius:waveform?.15*s.u:.65*s.u}}/>)}</div>;
};
const AudioBars:React.FC<Props&{audioSrc:string}>=props=>{
 const audio=useAudioData(staticFile(props.audioSrc)),frame=useAbsFrame(),{fps}=useVideoConfig();
 // FFT sample count must be a power of two. Draw only the requested count.
 const samples=2**Math.ceil(Math.log2(props.bars));
 const values=audio?visualizeAudio({audioData:audio,frame,fps,numberOfSamples:samples,smoothing:true}).slice(0,props.bars).map(v=>Math.min(1,Math.sqrt(v)*2.2)):Array(props.bars).fill(0);
 return <Bars {...props} values={values}/>;
};
const MissingAudioBars:React.FC<Props>=props=>{
 const frame=useAbsFrame();return <Bars {...props} values={Array.from({length:props.bars},(_,i)=>.12+.18*Math.abs(Math.sin(i*1.7+frame*.13)))}/>;
};
export const SpectrumView:React.FC<Props>=props=>{
 const exists=props.audioSrc&&getStaticFiles().some(file=>file.name===props.audioSrc);
 // Loading/decoding failures for an existing asset fail the render; only a missing asset gets the fallback.
 return exists?<AudioBars {...props} audioSrc={props.audioSrc!}/>:<MissingAudioBars {...props}/>;
};
