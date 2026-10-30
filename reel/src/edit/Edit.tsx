// Ported from reel/src/Reel4.tsx (layout, video/matte order, whip, chromatic hits, audio).
import React from 'react';
import {AbsoluteFill,Audio,Freeze,OffthreadVideo,Sequence,getRemotionEnvironment,interpolate,staticFile,useVideoConfig,type CalculateMetadataFunction} from 'remotion';
import {editSchema,type EditData,type EditProps,type EditClip} from './schema';
import {registry} from './registry';
import {CaptionLayer as Captions} from './components/GenericCaptions';
import {Block,ThemeContext,useTokens,useAbsFrame,useFrameClock,clamp} from './shared';
import {zoomAt} from '../zoomMap';
import {findClipChains,SequentialClips,TransitionOverlay,isSeriesTransition} from './transitions';
import {duckGain,fadeGain,volumeAt} from './audioMix';
import {GradeDefs,Grain,Vignette,gradeUrl,pieceGrade} from './look';
import {animAt,chromaMatrix,cropPath,edgeFilters,keyedBox,maskCss} from './clipfx';
import {applyLanes} from './lanes';
import {cutOverlay,cutStyle,footageCuts,isCutTransition} from './cutTransitions';
import {css,driftAt,followCss,followMatrix,shapeAtAnchor,useTrack,useTracks,videoMatrix,type TrackFile} from './tracking';

const warnings=new Set<string>();
const warn=(message:string)=>{if(!warnings.has(message)){warnings.add(message);console.warn(message)}};
const Placeholder:React.FC<{message:string}>=({message})=><div style={{position:'absolute',left:30,right:30,top:'45%',padding:24,background:'#fee2e2',border:'3px solid #dc2626',color:'#7f1d1d',fontSize:30,zIndex:99}}>{message}</div>;
// Every clip sits in its own full-frame layer, tagged so the editor can find it; box moves the layer.
type Box={x:number;y:number;scale:number;rotate:number};
// clip adds its look: style (opacity, blend, corners, shadow/outline/glow), mask and in/out/loop motion (clipfx.ts).
const Layer:React.FC<{id:string;box?:Box;filter?:string;clip?:EditClip;children:React.ReactNode}>=({id,box,filter,clip,children})=>{
 const {width,height,fps}=useVideoConfig(),frame=useAbsFrame();
 const b=keyedBox({x:0,y:0,scale:1,rotate:0,opacity:1,...box},clip?.keys,clip?frame/fps-clip.from:0),m=clip?animAt(clip.anim,frame/fps-clip.from,clip.to-clip.from):{tx:0,ty:0,scale:1,rotate:0,opacity:1,blur:0};
 const x=b.x*width+m.tx/100*width,y=b.y*height+m.ty/100*height,r=b.rotate+m.rotate,s=b.scale*m.scale;
 const transform=x||y||s!==1||r?`translate(${x}px,${y}px) rotate(${r}deg) scale(${s})`:undefined;
 const st=clip?.style,mask=clip?.mask?maskCss(clip.mask,width,height):undefined;
 const filters=[filter,...edgeFilters(st),m.blur>.05?`blur(${m.blur}px)`:''].filter(Boolean).join(' ')||undefined;
 const opacity=(st?.opacity??1)*m.opacity*b.opacity;
 return <AbsoluteFill data-clip-id={id} style={{pointerEvents:'none',transform,filter:filters,opacity:opacity<1?opacity:undefined,mixBlendMode:st?.blend,clipPath:cropPath(clip?.crop,st?.radius),maskImage:mask,WebkitMaskImage:mask,maskSize:mask&&'100% 100%',WebkitMaskSize:mask&&'100% 100%'}}>{children}</AbsoluteFill>;
};
// A clip that follows a track (clip.follow): the whole layer is carried by the track's homography.
const TrackContext=React.createContext<{data?:EditData;stabs:Record<string,TrackFile|undefined>}>({stabs:{}});
const FollowLayer:React.FC<{follow:NonNullable<EditClip['follow']>;children:React.ReactNode}>=({follow,children})=>{
 const {data,stabs}=React.useContext(TrackContext),track=useTrack(follow.track),{width,height,fps}=useVideoConfig(),frame=useAbsFrame();
 const G=data&&track?followMatrix(data,track,frame/fps,width,height,stabs):undefined;
 if(!G)return <>{children}</>;
 const c=follow.point??centre(track!,data!,width,height,stabs);
 return <AbsoluteFill style={{pointerEvents:'none',transformOrigin:'0 0',transform:followCss(G,follow.mode,c)}}>{children}</AbsoluteFill>;
};
const centreCache=new WeakMap<TrackFile,[number,number]>();
const centre=(track:TrackFile,data:EditData,W:number,H:number,stabs:Record<string,TrackFile|undefined>):[number,number]=>{
 let c=centreCache.get(track);
 if(!c){const pts=shapeAtAnchor(data,track,W,H,stabs);c=pts.length?[pts.reduce((a,p)=>a+p[0],0)/pts.length,pts.reduce((a,p)=>a+p[1],0)/pts.length]:[W/2,H/2];centreCache.set(track,c)}
 return c;
};
const active=<T extends {from:number;to:number}>(items:T[],t:number)=>items.find(item=>t>=item.from&&t<item.to);

// Retain early-v1 data compatibility; all graphics still render through registry entries.
const clipsFor=(data:EditData):EditClip[]=>{
 const clips=[...data.clips];
 for(const [i,b]of data.big.entries())if(!clips.some(c=>c.component==='BigType'&&c.from===b.from))clips.push({id:`big-${i}`,component:'BigType',from:b.from,to:b.to,props:{b},track:2});
 for(const [i,p]of data.phrases.entries())if(!clips.some(c=>c.component==='Phrase'&&c.from===p.from))clips.push({id:`phrase-${i}`,component:'Phrase',from:p.from,to:p.to,props:{p},track:8});
 for(const [i,beat]of data.layout.beats.entries())if(beat.head&&!clips.some(c=>c.component==='Headline'&&c.from===beat.from))clips.push({id:`headline-${i}`,component:'Headline',from:beat.from,to:beat.to,props:{head:beat.head},track:3});
 return clips.sort((a,b)=>(a.track??5)-(b.track??5));
};

// Preview proxies (like CapCut's proxy media): the Studio Editor passes light copies of the
// footage and matte as `__proxies` {original: proxy}, so the live preview decodes small files.
// Rendering always reads the originals.
const ProxyContext=React.createContext<Record<string,string>>({});
// short content fingerprint (FNV-1a) for the clip body cache
const hash=(text:string)=>{let h=0x811c9dc5;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);return `#${(h>>>0).toString(36)}`};

const EditScene:React.FC<{data:EditData}>=({data})=>{
 const proxies=React.useContext(ProxyContext),useProxy=!getRemotionEnvironment().isRendering;
 const videoFile=(src:string)=>staticFile(useProxy&&proxies[src]?proxies[src]:src);
 const frame=useAbsFrame(),{fps,width,height}=useVideoConfig(),{f}=useFrameClock(),{C,grid}=useTokens(),t=frame/fps;
 const beat=active(data.layout.beats,t)??data.layout.beats.at(-1),mode=beat?.mode??data.layout.mode??'full';
 const accent=data.theme.colors.accent??C.blue;
 const switchBeat=data.layout.beats.filter((b,i)=>i>0&&b.from<=t&&b.mode!==data.layout.beats[i-1].mode).at(-1);
 const authoredTransition=data.transitions.filter(x=>x.at<=t&&t<x.at+x.duration).at(-1);
 const transition=(authoredTransition&&(authoredTransition.type==='whip'||authoredTransition.type==='whip-blur')?authoredTransition:undefined)??(switchBeat?{at:switchBeat.from,duration:4/fps,type:'whip'}:undefined);
 const whipFrame=transition?frame-f(transition.at):99,whipDuration=transition?Math.max(1,f(transition.duration)):4;
 const whip=whipFrame>=0&&whipFrame<whipDuration;
 const shift=whip?interpolate(whipFrame,[0,whipDuration],[mode==='split'?80:-80,0],clamp):0;
 const blur=whip?interpolate(whipFrame,[0,whipDuration],[18,0],clamp):0;
 const zoom=zoomAt(data.zooms,t);
 // faint handheld drift (identical on base + matte so they stay locked)
 // layout.drift:false turns it off (finished footage brought in as it is)
 const {x:driftX,y:driftY}=driftAt(data,t);
 // stabilized pieces: their stabilize tracks, loaded once (tracking.ts builds the whole video transform then)
 const stabFiles=React.useMemo(()=>[...new Set(data.base.map(b=>b.stabilize?.track).filter((x):x is string=>Boolean(x)))],[data]);
 const stabs=useTracks(stabFiles);
 const trackCtx=React.useMemo(()=>({data,stabs}),[data,stabs]);
 // everything below that depends only on the document is computed once per document
 const clips=React.useMemo(()=>clipsFor(data),[data]);
 const behindMatteClips=React.useMemo(()=>clips.filter(c=>registry[c.component]?.layer==='behindMatte'),[clips]);
 const currentBig=active(behindMatteClips,t);
 const bigProps=currentBig?.props.b as {hit?:boolean}|undefined,hit=Boolean(bigProps?.hit);
 // Captions behind the speaker: drawn under the matte in full mode; needs base[].matte from tools/edit/matte.py.
 const behindCaps=data.captions.enabled&&data.captions.style.preset==='behind'&&mode==='full';
 if(behindCaps&&!data.base.some(b=>b.matte))warn('captions preset "behind" needs base[].matte (python tools/edit/matte.py)');

 // Clip bodies are cached by content: the same element object lets React skip a clip whose inputs did not
 // change, so dragging one clip in the editor (or playing) never re-renders the others. They still follow the frame.
 const shared=React.useMemo(()=>hash(JSON.stringify([accent,mode,width,height,data.audio.voice?.src,data.captions.words,data.captions.style])),[accent,mode,width,height,data.audio.voice?.src,data.captions.words,data.captions.style]);
 const bodies=React.useRef(new Map<string,React.ReactNode>()),bodyKeys=React.useRef(new WeakMap<EditClip,string>());
 const body=(clip:EditClip):React.ReactNode=>{
  let key=bodyKeys.current.get(clip);
  if(!key||!key.endsWith(shared)){key=JSON.stringify([clip.component,clip.props,clip.anim,clip.from,clip.to])+shared;bodyKeys.current.set(clip,key)}
  const hit=bodies.current.get(key);
  if(hit)return hit;
  const entry=registry[clip.component];
  let child:React.ReactNode;
  if(!entry){const message=`Unknown Edit component: ${clip.component}`;warn(message);child=<Placeholder message={message}/>}
  else{
   const result=entry.schema.safeParse({...entry.defaults,accent,mode,width,height,audioSrc:data.audio.voice?.src,words:data.captions.words,style:data.captions.style,...clip.props,anim:clip.anim,from:clip.from,to:clip.to});
   if(!result.success){const message=`Invalid props for ${clip.component}: ${result.error.message}`;warn(message);child=<Placeholder message={message}/>}
   else{const Component=entry.component;child=<Component {...result.data as Record<string,unknown>}/>}
  }
  if(bodies.current.size>600)bodies.current.clear();
  bodies.current.set(key,child);
  return child;
 };
 const renderClip=(clip:EditClip,timed=true)=>{
  const child=body(clip);
  const layer=<Layer key={clip.id} id={clip.id} box={clip.box} clip={clip} filter={[clip.chroma?`url(#chroma-${clip.id.replace(/[^\w-]/g,'_')})`:'',gradeUrl(`clip-${clip.id}`,clip.grade)??''].filter(Boolean).join(' ')||undefined}>{child}</Layer>;
  const placed=clip.follow?<FollowLayer key={clip.id} follow={clip.follow}>{layer}</FollowLayer>:layer;
  return timed?<Block key={clip.id} name={`${clip.component} ${clip.id}`} from={clip.from} to={clip.to}>{placed}</Block>:placed;
 };
 // behind: any clip can sit between the footage and the speaker cut-out (clip.behind or a behindMatte component).
 const {chains,used,behind,overlays,gradeEntries}=React.useMemo(()=>{
  const isBehind=(c:EditClip)=>registry[c.component]?.layer==='behindMatte'||Boolean(c.behind);
  return {...findClipChains(clips,data.transitions,fps),behind:clips.filter(isBehind),overlays:clips.filter(c=>!isBehind(c)),
   gradeEntries:[...data.base.map((b,i)=>[`base-${i}`,pieceGrade(data.grade,b.grade)] as [string,typeof b.grade]),...clips.map(c=>[`clip-${c.id}`,c.grade] as [string,typeof c.grade])]};
 },[clips,data,fps]);
 const behindNow=clips.some(c=>c.behind&&t>=c.from&&t<c.to),subjectFx=edgeFilters(data.subject).join(' ')||undefined;
 const matteOn=Boolean(subjectFx||behindNow||currentBig||behindCaps);
 const matteSoon=!getRemotionEnvironment().isRendering&&clips.some(c=>(c.behind||registry[c.component]?.layer==='behindMatte')&&t>=c.from-1.5&&t<c.to+.5);

 // Transitions on footage cuts (cutTransitions.ts): around the cut both pieces play, the outgoing one
 // past its out point and the incoming one from before its in point, each styled by the transition.
 const cuts=React.useMemo(()=>footageCuts(data.base.map(b=>({start:b.start,end:b.start+(b.duration??Math.max(0,data.settings.duration-b.start))})),data.transitions),[data]);
 const activeCut=cuts.find(c=>t>=c.at&&t<c.at+c.duration);
 // One Sequence per base/matte gives sourceIn and start identical playback clocks.
 const media=(pass:'base'|'matte'|'chromatic'|'split')=>data.base.map((base,i)=>{
  const src=pass==='matte'?base.matte:base.src;
  if(!src)return null;
  const into=cuts.find(c=>c.in===i),outOf=cuts.find(c=>c.out===i);
  // the incoming piece can only start early by as much file as there is before its in point (else it would slip out of sync)
  const early=into?Math.min(Math.max(0,into.cut-into.at),(base.sourceIn??0)/(base.speed??1)):0,late=outOf?Math.max(0,outOf.at+outOf.duration-outOf.cut):0;
  const start=f(base.start-early),duration=f((base.duration??Math.max(0,data.settings.duration-base.start))+early+late);
  const cutFx=activeCut&&(activeCut.in===i||activeCut.out===i)&&(pass==='base'||pass==='matte')?cutStyle(activeCut.type,(t-activeCut.at)/activeCut.duration,activeCut.in===i?'in':'out'):undefined;
  // CapCut animation on a footage piece (In / Out / Loop), on the piece and its cut-out alike
  const pieceLen=base.duration??Math.max(0,data.settings.duration-base.start);
  // frame-based window: a piece can start between two frames (its Sequence starts at the rounded frame)
  const am=base.anim&&(pass==='base'||pass==='matte')&&frame>=f(base.start)&&frame<f(base.start+pieceLen)?animAt(base.anim,Math.max(0,t-base.start),pieceLen):undefined;
  const moved=am&&(am.tx||am.ty||am.scale!==1||am.rotate);
  const fx:React.CSSProperties|undefined=am?{...cutFx,
   transform:[cutFx?.transform,moved?`translate(${am.tx}%,${am.ty}%) rotate(${am.rotate}deg) scale(${am.scale})`:''].filter(Boolean).join(' ')||undefined,
   opacity:(Number(cutFx?.opacity??1))*am.opacity<1?Number(cutFx?.opacity??1)*am.opacity:cutFx?.opacity,
   filter:[cutFx?.filter,am.blur>.05?`blur(${am.blur}px)`:''].filter(Boolean).join(' ')||undefined}:cutFx;
  // CapCut-style keyframes on the footage piece itself: zoom (scale), pan (x, y) and rotate over time
  const kb=keyedBox(STILL,base.keys,t-(base.start??0)),stab=base.stabilize?stabs[base.stabilize.track]:undefined;
  const split=pass==='split',applyWhip=pass==='base'||pass==='matte',scale=split?1:zoom; // the matte moves with the footage or the cut-out slides off the person
  const fit=base.fit==='blurfill'?'contain':base.fit;
  const look=pass==='chromatic'?undefined:gradeUrl(`base-${i}`,pieceGrade(data.grade,base.grade));
  const pip=mode==='pip',splitMode=mode==='split-h'||mode==='split-v',pw=data.layout.pip.width*width,ph=data.layout.pip.height*height,px=data.layout.pip.x*width,py=data.layout.pip.y*height;
  const from=f((base.sourceIn??0)-early*(base.speed??1));
  const video=<OffthreadVideo src={videoFile(src)} startFrom={from} transparent={pass==='matte'?true:undefined} muted style={{position:'absolute',left:pip?px:splitMode&&mode==='split-h'?0:applyWhip?shift:0,top:pip?py:splitMode?0:split?-data.layout.split.offset:0,width:pip?pw:splitMode&&mode==='split-h'?width/2:splitMode&&mode==='split-v'?width:split?1080:width,height:pip?ph:splitMode&&mode==='split-v'?height/2:splitMode&&mode==='split-h'?height:split?1920:height,borderRadius:pip?data.layout.pip.radius:undefined,overflow:'hidden',objectFit:fit,objectPosition:base.focus?`${base.focus[0]*100}% ${base.focus[1]*100}%`:undefined,filter:applyWhip&&blur?`blur(${blur}px)`:undefined,...(stab&&!split?{transform:css(videoMatrix(data,base,t,width,height,stab)),transformOrigin:'0 0'}:{transform:`translate(${(split?0:driftX)+kb.x*width}px,${(split?0:driftY)+kb.y*height}px) scale(${scale*kb.scale})${kb.rotate?` rotate(${kb.rotate}deg)`:''}${base.mirror?' scaleX(-1)':''}`,transformOrigin:'50% 28%'}),boxShadow:pip?'0 12px 40px #0008':undefined}}/>;
  return <Sequence key={`${pass}-${i}`} from={start} durationInFrames={Math.max(1,duration)} layout="none"><Freeze frame={0} active={Boolean(base.freeze)}><AbsoluteFill data-base-index={pass==='base'?i:undefined} style={{...fx,filter:[look,fx?.filter].filter(Boolean).join(' ')||undefined,clipPath:fx?.clipPath??cropPath(base.crop)}}>{base.fit==='blurfill'&&<OffthreadVideo src={videoFile(src)} startFrom={from} muted style={{position:'absolute',inset:-30,width:width+60,height:height+60,objectFit:'cover',filter:'blur(28px) brightness(.48)'}}/>}{base.speed&&base.speed!==1?React.cloneElement(video,{playbackRate:base.speed}):video}</AbsoluteFill></Freeze></Sequence>;
 });
 const music=data.audio.music,voice=data.audio.voice,voiceSrc=voice?.chain?.bypass&&voice.original?voice.original:voice?.src;
 return <TrackContext.Provider value={trackCtx}><AbsoluteFill style={{background:data.settings.background}}>
  {data.audio.voice&&!data.audio.voice.segments&&<Audio src={staticFile(voiceSrc!)} volume={data.audio.voice.volume}/>}
  {data.audio.voice?.segments?.map((s,i)=><Sequence key={`voice-${i}`} name={`Voice ${i}`} from={f(s.start)} durationInFrames={Math.max(1,f(s.duration))} layout="none"><Audio src={staticFile(voiceSrc!)} startFrom={f(s.sourceIn)} volume={data.audio.voice!.volume}/></Sequence>)}
  {music&&<Audio src={staticFile(music.src)} volume={fr=>{
   const sec=fr/fps,fade=fadeGain(sec,0,data.settings.duration,music.fadeIn,music.fadeOut)*volumeAt(music.keys,sec);
   if(music.duck)return music.volume*duckGain(sec,data.captions.words,music.duck)*fade;
   const talking=data.captions.words.some(([s,e])=>sec>=s-.15&&sec<=e+.15);
   return music.volume*(talking?1:music.gapBoost)*fade;
  }}/>}
  {data.audio.sfx.map((s,i)=>{const len=s.duration??.65;return <Sequence key={i} name={`SFX ${s.file}`} from={f(s.at)} durationInFrames={Math.max(1,f(len))}><Audio src={staticFile(s.file)} volume={s.fadeIn||s.fadeOut||s.keys?.length?fr=>s.volume*fadeGain(fr/fps,0,len,s.fadeIn,s.fadeOut)*volumeAt(s.keys,fr/fps):s.volume}/></Sequence>})}
  {clips.some(c=>c.chroma)&&<svg width="0" height="0" style={{position:'absolute'}} aria-hidden>{clips.filter(c=>c.chroma).map(c=><filter key={c.id} id={`chroma-${c.id.replace(/[^\w-]/g,'_')}`} colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values={chromaMatrix(c.chroma!)}/></filter>)}</svg>}
  <GradeDefs entries={gradeEntries}/>
  <AbsoluteFill style={{overflow:'hidden',background:mode==='split'?C.canvas:mode==='full'&&data.captions.style.preset==='reel4'?'#fff':data.settings.background}}>
   {(mode==='full'||mode==='pip'||mode==='split-h'||mode==='split-v')&&media('base')}
   {mode==='full'&&behind.map(c=>renderClip(c))}
   {/* one speaker cut-out layer (a second copy would decode the matte video twice); the preview
       mounts it 1.5 s early and keeps it 0.5 s after, so it is already playing in step when it shows */}
   {mode==='full'&&(matteOn||matteSoon)&&<AbsoluteFill style={{zIndex:3,pointerEvents:'none',filter:subjectFx,opacity:matteOn?1:0}}>{media('matte')}</AbsoluteFill>}
   {behindCaps&&<AbsoluteFill style={{zIndex:2,pointerEvents:'none'}}><Layer id="__captions" box={data.captions.box}><Captions words={data.captions.words} mode={mode} style={data.captions.style} width={width} height={height}/></Layer></AbsoluteFill>}
   {mode==='full'&&hit&&<><AbsoluteFill style={{mixBlendMode:'screen',opacity:.2,transform:`translateX(${Math.floor(frame/2)%2?14:-14}px)`,filter:'hue-rotate(130deg)'}}>{media('chromatic')}</AbsoluteFill><AbsoluteFill style={{mixBlendMode:'screen',opacity:.16,transform:`translateX(${Math.floor(frame/2)%2?-14:14}px)`,filter:'hue-rotate(-70deg)'}}>{media('chromatic')}</AbsoluteFill></>}
   {mode==='split'&&<><AbsoluteFill style={{...grid,height:data.layout.split.y}}/><div style={{position:'absolute',left:shift,top:data.layout.split.y,width:1080,height:height-data.layout.split.y,borderTopLeftRadius:40,borderTopRightRadius:40,overflow:'hidden',filter:blur?`blur(${blur}px)`:undefined,boxShadow:'0 -14px 36px rgba(15,23,42,.15)'}}>{media('split')}</div></>}
   {data.captions.style.preset==='reel4'&&transition&&<AbsoluteFill style={{zIndex:18,pointerEvents:'none',opacity:whip?Math.sin(Math.PI*Math.min(1,whipFrame/whipDuration))*.35:0,background:'linear-gradient(110deg,transparent,#fff8,transparent)',mixBlendMode:'normal'}}/>}
   {activeCut&&cutOverlay(activeCut.type,(t-activeCut.at)/activeCut.duration)&&<AbsoluteFill style={{zIndex:3,pointerEvents:'none',...cutOverlay(activeCut.type,(t-activeCut.at)/activeCut.duration)}}/>}
   {authoredTransition&&!isSeriesTransition(authoredTransition.type)&&!isCutTransition(authoredTransition.type)&&!['whip','whip-blur'].includes(authoredTransition.type)&&<TransitionOverlay type={authoredTransition.type} progress={(t-authoredTransition.at)/authoredTransition.duration}/>}
   {data.grade&&<AbsoluteFill style={{zIndex:3,pointerEvents:'none'}}><Vignette amount={data.grade.vignette??0}/><Grain amount={data.grade.grain??0}/></AbsoluteFill>}
   {/* overlays sit above the speaker matte (zIndex 3) so cards are never hidden behind the person */}
   <AbsoluteFill style={{zIndex:4,pointerEvents:'none'}}>{overlays.map(c=>{const chain=chains.find(items=>items[0].id===c.id);return chain?<SequentialClips key={c.id} clips={chain} transitions={data.transitions} render={item=>renderClip(item,false)}/>:used.has(c.id)?null:renderClip(c)})}</AbsoluteFill>
  </AbsoluteFill>
  {data.captions.enabled&&mode!=='end'&&!behindCaps&&<Layer id="__captions" box={data.captions.box}><Captions words={data.captions.words} mode={mode} style={data.captions.style} width={width} height={height}/></Layer>}
 </AbsoluteFill></TrackContext.Provider>;
};

const NO_PROXIES={};
const STILL={x:0,y:0,scale:1,rotate:0,opacity:1};
export const Edit:React.FC<EditProps>=(props)=>{
 // parsing the whole edit is the costliest step: once per document, never per frame
 const data=React.useMemo(()=>applyLanes(editSchema.parse(props)),[props]);
 const proxies=(props as {__proxies?:Record<string,string>}).__proxies??NO_PROXIES;
 return <ThemeContext.Provider value={data.theme}><ProxyContext.Provider value={proxies}><EditScene data={data}/></ProxyContext.Provider></ThemeContext.Provider>;
};
export const editCompositionSchema=editSchema;
export const calculateEditMetadata:CalculateMetadataFunction<EditProps>=({props})=>{
 const {width,height,fps,duration}=props.settings;
 return {width,height,fps,durationInFrames:Math.round(duration*fps)};
};
