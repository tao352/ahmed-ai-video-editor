// Ported from reel/src/Reel4.tsx (grouping, fonts, position, and active-word spring).
import React from 'react';
import {useVideoConfig} from 'remotion';
import {z} from 'zod';
import {useAbsFrame,useTokens,useFrameClock,sp,resolveFont} from '../shared';
import {bidiRuns} from '../bidi';

export const captionStyleSchema=z.object({
 preset:z.string().default('reel4'),font:z.string().optional(),englishFont:z.string().optional(),size:z.number().default(64),
 colors:z.record(z.string(),z.string()).default({}),position:z.record(z.string(),z.number()).default({}),
 maxWords:z.number().int().min(1).default(2),gapBreak:z.number().default(.25),
 keywords:z.array(z.string()).default([]),
});
export const CaptionsSchema=z.object({words:z.array(z.tuple([z.number(),z.number(),z.string()])),mode:z.string().default('full'),style:captionStyleSchema,width:z.number().default(1080),height:z.number().default(1920)});
export type CaptionsProps=z.infer<typeof CaptionsSchema>;
export const Captions:React.FC<CaptionsProps>=({words,mode,style,width,height})=>{
 const local=useAbsFrame(),{fps}=useVideoConfig(),{f}=useFrameClock(),{C,plex,serif}=useTokens();
 const t=local/fps,size=style.size;
 const at=words.findIndex(w=>t>=w[0]&&t<w[1]);
 if(at<0)return null;
 let ids=[at];
 for(let i=at-1;i>=0;i--){const prev=words[i],cur=words[i+1];if(cur[0]-prev[1]>style.gapBreak||ids.length>=style.maxWords)break;ids.unshift(i)}
 for(let i=at+1;i<words.length;i++){const prev=words[i-1],cur=words[i];if(cur[0]-prev[1]>style.gapBreak||ids.length>=style.maxWords)break;ids.push(i)}
 if(style.preset==='none')return null;
 const pop=sp(local-f(words[at][0]),fps);
 const english=(s:string)=>/^[\x00-\x7F]+$/.test(s.replace(/[.,?!]/g,''));
 const bottom=style.preset==='bottom-bold'||style.preset==='keyword-pop'||style.preset==='karaoke';
 const fontSize=style.preset==='bottom-bold'?Math.max(34,height*.046):style.preset==='keyword-pop'?Math.max(30,height*.035):size;
 const top=style.position[mode]??(bottom?undefined:height*(mode==='split'?.5:.68));
 return <div style={{position:'absolute',top,bottom:bottom?height*.09:undefined,insetInline:0,width:'100%',display:'flex',justifyContent:'center',zIndex:20,pointerEvents:'none'}}><div dir="auto" style={{display:'flex',gap:12,alignItems:'center',justifyContent:'center',maxWidth:width*.9,padding:'3px 20px',textAlign:'center',direction:ids.every(i=>english(words[i][2]))?'ltr':'rtl',textShadow:bottom?'0 2px 2px #000, 2px 0 #000,-2px 0 #000,0 -2px #000':'0 2px 10px rgba(0,0,0,.55)',background:style.preset==='keyword-pop'&&style.colors.box?'rgba(0,0,0,.72)':undefined,borderRadius:8}}>{ids.map(i=>{const keyword=style.preset==='keyword-pop'&&words[i][2]&&((style as any).keywords??[]).includes(words[i][2]);return <span key={i} dir="auto" style={{fontFamily:english(words[i][2])?resolveFont(style.englishFont,serif):resolveFont(style.font,plex),fontWeight:900,fontSize, color:style.preset==='karaoke'&&i===at?(style.colors.highlight??'#4DFF88'):keyword?(style.colors.highlight??'#ffe66d'):english(words[i][2])?(style.colors.english??(bottom?'white':'#4DB3FF')):mode==='split'?(style.colors.split??style.colors.arabic??C.ink):(style.colors.full??'white'),transform:i===at&&(style.preset==='karaoke'||style.preset==='bottom-bold')?`scale(${1.08-.08*pop})`:'scale(1)',unicodeBidi:'isolate',WebkitTextStroke:bottom?'1.5px #000':undefined}}>{bidiRuns(words[i][2])}</span>})}</div></div>;
};
