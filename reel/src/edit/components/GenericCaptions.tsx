// Ported from template-tiktok/src/CaptionedVideo/Page.tsx + SubtitlePage.tsx; generic canvas adapter.
import React from 'react';
import {interpolate,useVideoConfig,Easing} from 'remotion';
import {useAbsFrame,useScale,useTokens,resolveFont,clamp,ThemeContext} from '../shared';
import {bidiRuns} from '../bidi';
import {Captions as ReferenceCaptions,type CaptionsProps} from './Captions';
import {baseFonts} from '../fonts';
import {fitText} from '@remotion/layout-utils';
// Words are inline text (not flex items) so the Unicode bidi algorithm orders mixed Arabic/English correctly.
const GenericCaptions:React.FC<CaptionsProps>=({words,style})=>{
 const s=useScale(),frame=useAbsFrame(),{fps}=useVideoConfig(),{plex,C}=useTokens();
 const theme=React.useContext(ThemeContext);
 const active=words.findIndex(w=>frame/fps>=w[0]&&frame/fps<w[1]);
 if(active<0||style.preset==='none')return null;
 if(style.preset==='keyword-pop'&&!style.keywords.includes(words[active][2]))return null;
 const limit=Math.min(3,style.maxWords);let first=0;
 for(let i=1;i<=active;i++)if(i-first>=limit||words[i][0]-words[i-1][1]>style.gapBreak)first=i;
 const group=[];for(let i=first;i<Math.min(words.length,first+limit);i++){if(i>first&&words[i][0]-words[i-1][1]>style.gapBreak)break;group.push(i)}
 const selected=style.preset==='keyword-pop'?[active]:group;
 const text=selected.map(i=>words[i][2]).join(' '),rtl=/[\u0600-\u06ff]/u.test(text);
 const pop=interpolate(frame/fps-words[active][0],[0,.18],[1.08,1],{...clamp,easing:Easing.out(Easing.cubic)});
 const size=Math.max(s.body,Math.min(style.size,s.width*.075));
 const accent=theme.colors.accent??C.blue;
 // 'behind': huge words placed behind the speaker; Edit draws base[].matte (tools/edit/matte.py) over this layer.
 if(style.preset==='behind'){
  // Fit the words to ~90% of the width, then sit them so their lower ~40% hides behind the head
  // (position.headTop comes from the matte sidecar JSON; position.y overrides).
  const family=resolveFont(style.font,rtl?baseFonts.cairo:baseFonts.anton),weight=rtl?'900':'400';
  let fitted=s.width*.17;try{fitted=fitText({text:rtl?text:text.toUpperCase(),withinWidth:s.width*.9,fontFamily:family,fontWeight:weight}).fontSize}catch{}
  const big=style.size>64?style.size:Math.max(s.width*.1,Math.min(s.width*.34,fitted));
  const top=style.position.y??Math.max(s.height*.025+(rtl?.18*big:0),style.position.headTop!==undefined?style.position.headTop-.62*big:s.height*.12);  // room for Arabic marks above the line
  return <div dir={rtl?'rtl':'ltr'} style={{position:'absolute',top,left:-s.width*.05,right:-s.width*.05,textAlign:'center',direction:rtl?'rtl':'ltr',unicodeBidi:'plaintext',pointerEvents:'none',transform:`scale(${pop})`,transformOrigin:'50% 60%'}}>{selected.map((i,k)=><React.Fragment key={i}>{k>0?' ':null}<span style={{display:'inline',fontFamily:family,fontWeight:Number(weight),fontSize:big,lineHeight:1,textTransform:rtl?undefined:'uppercase',color:i===active?(style.colors.active??theme.colors.caption??'#fff'):(style.colors.text??'#ffffffcc'),textShadow:`0 0 ${.6*s.u}px #0006`,unicodeBidi:'normal'}}>{words[i][2]}</span></React.Fragment>)}</div>;
 }
 return <div dir={rtl?'rtl':'ltr'} style={{position:'absolute',bottom:s.height*.09,insetInline:s.safeX,display:'flex',justifyContent:'center',pointerEvents:'none',zIndex:20}}><div dir={rtl?'rtl':'ltr'} style={{display:'block',textAlign:'center',direction:rtl?'rtl':'ltr',unicodeBidi:'plaintext',background:'rgba(0,0,0,.70)',padding:`${s.u}px ${2*s.u}px`,borderRadius:s.radius,boxShadow:'0 6px 24px #0007',maxWidth:'100%'}}>{selected.map((i,k)=><React.Fragment key={i}>{k>0?' ':null}<span style={{display:'inline',fontFamily:resolveFont(style.font,plex),fontWeight:700,fontSize:size,lineHeight:1.3,color:'#fff',borderBottom:style.preset==='karaoke'&&i===active?`${.35*s.u}px solid ${accent}`:`${.35*s.u}px solid transparent`,background:style.preset==='karaoke'&&i===active?'rgba(255,255,255,.16)':undefined,borderRadius:.4*s.u,paddingInline:.35*s.u,unicodeBidi:'normal',textShadow:'0 2px 3px #000, 1px 0 #000, -1px 0 #000',WebkitTextStroke:style.preset==='bottom-bold'?'.6px #000':undefined}}>{words[i][2]}</span></React.Fragment>)}</div></div>;
};
export const CaptionLayer:React.FC<CaptionsProps>=props=>props.style.preset==='reel4'?<ReferenceCaptions {...props}/>:<GenericCaptions {...props}/>;
