// Conservative static layout checks, including intentional compositor layers and the frozen Reel4 reference contract.
import path from 'node:path';
import {registry,editSchema,readJson} from './edit_runtime.mjs';
const file=process.argv[2];if(!file)throw Error('usage: qa_layout.mjs <edit.json>');
const data=editSchema.parse(readJson(file)),u=Math.min(data.settings.width,data.settings.height)/100,warnings=[];
const warn=message=>warnings.push(message);
// Normalized bounds describe foreground ink/panels; metadata can occupy several regions.
const regions={top:[.05,.02,.95,.19],center:[.10,.22,.90,.79],bottom:[.05,.83,.95,.96],full:[0,0,1,1],lowerThird:[.10,.64,.90,.81],corner:[.59,.38,.95,.62]};
const intersect=(a,b)=>a[0]<b[2]&&b[0]<a[2]&&a[1]<b[3]&&b[1]<a[3];
const entries=data.clips.map(c=>({...c,meta:registry[c.component]}));
const words=value=>String(value??'').trim().split(/\s+/u).filter(Boolean).length;
function visibleWords(c){
 const p=c.props??{},fields=c.component==='KineticText'?(p.tokens?.length?['tokens']:['title','text']):c.component==='LowerThird'?['name','role']:c.component==='StatCard'||c.component==='KpiCounter'?['label','value','subtitle','suffix']:c.component==='PriceFacts'?['title','price','currency','beds','baths','area','bedLabel','bathLabel','unit']:c.component==='NarratorPiP'?['title','subtitle']:['title','text','subtitle','chapter','cta'];
 let count=0;for(const key of fields){const value=p[key];count+=Array.isArray(value)?value.reduce((n,v)=>n+words(v),0):words(value)}
 if(p.handle)count+=1;for(const item of p.items??[])count+=words(typeof item==='string'?item:item.label);
 for(const pin of p.pins??[])count+=words(pin.label);
 if(c.component==='ChapterTitle'&&!p.chapter)count+=1;
 if(c.component==='BarChartRace'&&!p.title&&!p.text)count+=2;
 if(c.component==='PriceFacts')count+=['bedLabel','bathLabel','unit'].filter(k=>!p[k]).length;
 return count;
}

function color(value){
 if(/^#[a-f\d]{6}$/i.test(value??''))return [1,3,5].map(i=>parseInt(value.slice(i,i+2),16)).concat(1);
 const m=/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(value??'');return m?[+m[1],+m[2],+m[3],m[4]===undefined?1:+m[4]]:null;
}
const luminance=rgb=>{const c=rgb.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722};
const contrast=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
function checkContrast(c){
 if(c.meta.scalePolicy!=='canvas'||!c.meta.minTextU||c.component==='SplitScreen'||c.component.includes('Caption'))return;
 const foreground=color(c.props.color??'#ffffff');let surface=c.props.background;
 if(c.component==='FullscreenText')surface=c.props.background==='solid'?(c.props.backgroundColor??'#101827'):'rgba(0,0,0,.70)';
 if(c.component==='EndCardGeneric')surface='#090f1b';
 const bg=color(surface??'rgba(0,0,0,.70)');if(!foreground||!bg)return;
 for(const frame of [0,255]){const rgb=bg.slice(0,3).map(v=>v*bg[3]+frame*(1-bg[3]));if(contrast(foreground,rgb)<4.5)warn(`${c.id}: text contrast below 4.5:1 over ${frame?'light':'dark'} footage`)}
}
for(const c of entries){
 const m=c.meta;if(!m){warn(`${c.id}: unknown component ${c.component}`);continue}
 checkContrast(c);
 if(c.to<=c.from||c.from<0||c.to>data.settings.duration+1e-6)warn(`${c.id}: invalid clip window`);
 if(m.scalePolicy==='canvas'&&m.minTextU>0){
  const floor=m.smallPrint?2.2:2.8;if(m.minTextU<floor)warn(`${c.id}: declared minTextU ${m.minTextU} below ${floor}`);
  for(const [key,value] of Object.entries(c.props))if(typeof value==='number'&&/^(size|fontSize|titleSize|subtitleSize|labelSize|bodySize|smallSize)$/.test(key)&&value<Math.max(22,(key==='smallSize'?2.2:2.8)*u))warn(`${c.id}: ${key} ${value}px below minimum`);
 }
 if(m.reading==='static'){const count=visibleWords(c),needed=count*.33+.5;if(count&&c.to-c.from+1e-6<needed)warn(`${c.id}: ${count} words need ${needed.toFixed(2)}s, has ${(c.to-c.from).toFixed(2)}s`)}
}
for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++){
 const a=entries[i],b=entries[j];if(!a.meta||!b.meta||a.from>=b.to||b.from>=a.to)continue;
 // Background footage and optical effects intentionally composite with foreground panels.
 if([a.meta.purpose,b.meta.purpose].includes('effect'))continue;
 if([a.meta.purpose,b.meta.purpose].includes('background')&&!(a.meta.purpose==='background'&&b.meta.purpose==='background'&&(a.track??5)===(b.track??5)))continue;
 if((a.meta.regions??[a.meta.region]).some(ra=>(b.meta.regions??[b.meta.region]).some(rb=>intersect(regions[ra],regions[rb]))))warn(`${a.id} / ${b.id}: time and region overlap (${a.meta.region}, ${b.meta.region})`);
}
if(data.settings.height/data.settings.width>1.6){
 const changes=[0,data.settings.duration];const mark=t=>{if(t>=0&&t<=data.settings.duration)changes.push(t)};
 for(const c of data.clips){mark(c.from);mark(c.to);for(const t of c.props.events??[])mark(t);
  if(c.component==='KenBurnsGallery'){let t=c.from;for(const image of c.props.images??[]){mark(t);t+=image.duration??3}}
 }
 for(const b of data.layout.beats){mark(b.from);mark(b.to)}
 for(const t of data.transitions){mark(t.at);mark(t.at+t.duration)}
 for(const z of data.zooms){if(z.type==='punch')mark(z.t);else if(z.type==='ratchet')for(const step of z.steps)mark(step[0]);else{mark(z.t0);mark(z.t1)}}
 if(data.captions.enabled&&data.captions.style.preset!=='none')for(const word of data.captions.words){mark(word[0]);mark(word[1])}
 const times=[...new Set(changes)].sort((a,b)=>a-b);for(let i=1;i<times.length;i++)if(times[i]-times[i-1]>8)warn(`9:16 edit has no authored visual change for ${(times[i]-times[i-1]).toFixed(2)}s (${times[i-1]}-${times[i]})`);
}
for(const transition of data.transitions){const types=['fade','slide','scenePush','wipe','flip','clockWipe','circleWipe'];if(!types.includes(transition.type))continue;
 const adjacent=data.clips.some(a=>data.clips.some(b=>a.id!==b.id&&(a.track??5)===(b.track??5)&&Math.abs(a.to-b.from)<.5/data.settings.fps&&Math.abs(b.from-transition.at)<.5/data.settings.fps&&transition.duration<Math.min(a.to-a.from,b.to-b.from)));
 if(!adjacent)warn(`${transition.type} at ${transition.at}: needs adjacent clips on the same track, duration shorter than each clip`);
}
for(const c of entries.filter(c=>c.component==='EndCardGeneric'))if(data.clips.some(other=>other.id!==c.id&&other.from<c.to&&other.to>c.from))warn(`${c.id}: generic end card must play alone`);
if(warnings.length){for(const message of warnings)console.warn(`WARN ${path.basename(path.dirname(file))}: ${message}`);process.exitCode=1}else console.log(`qa_layout: ${file}: 0 warnings`);
