// Per-clip looks that work on ANY component: style (opacity, blend, rounded corners, shadow,
// outline, glow), shape masks, and in / out / loop animations. Pure functions -> CSS, so the
// Studio Editor preview and the render agree.
import {z} from 'zod';

const color=z.string();
export const styleSchema=z.object({
 opacity:z.number().min(0).max(1).optional(),
 blend:z.enum(['normal','multiply','screen','overlay','soft-light','hard-light','color-dodge','lighten','darken','difference']).optional(),
 radius:z.number().min(0).optional(),                                   // px at the composition size; clips full-frame media
 shadow:z.object({color:color.default('#000000'),blur:z.number().default(30),y:z.number().default(12),opacity:z.number().default(.5)}).optional(),
 outline:z.object({color:color.default('#ffffff'),width:z.number().default(6)}).optional(),
 glow:z.object({color:color.default('#07BFF1'),size:z.number().default(24)}).optional(),
});
// Crop (CapCut "crop"): cut the edges off a clip or a footage piece, as fractions of the frame.
export const cropSchema=z.object({l:z.number().min(0).max(.95).default(0),t:z.number().min(0).max(.95).default(0),r:z.number().min(0).max(.95).default(0),b:z.number().min(0).max(.95).default(0)});
export type Crop=z.infer<typeof cropSchema>;
/** CSS clip-path for a crop, with optional rounded corners. */
export const cropPath=(c:Partial<Crop>|undefined,radius?:number):string|undefined=>{
 const p=(v?:number)=>`${((v??0)*100).toFixed(3)}%`;
 const any=c&&((c.l??0)||(c.t??0)||(c.r??0)||(c.b??0));
 if(!any&&!radius)return undefined;
 return `inset(${any?`${p(c!.t)} ${p(c!.r)} ${p(c!.b)} ${p(c!.l)}`:'0'}${radius?` round ${radius}px`:''})`;
};
// Chroma key (CapCut "chroma key"): remove a green or blue screen behind a clip. One SVG colour
// matrix: alpha falls as the key channel rises above the other two; spill pulls the key colour out
// of the edges. Same filter in preview and render.
export const chromaSchema=z.object({key:z.enum(['green','blue']).default('green'),strength:z.number().min(0).max(1).default(.5),soft:z.number().min(0).max(1).default(.2),spill:z.number().min(0).max(1).default(.5)});
export type Chroma=z.infer<typeof chromaSchema>;
export const chromaMatrix=(c:Partial<Chroma>):string=>{
 const k=c.key??'green',s=c.strength??.5,soft=c.soft??.2,spill=c.spill??.5;
 const thr=.3-.25*s,g=1/Math.max(.02,soft*.5);
 // rows R G B A, columns R G B A 1; "key" is G (or B), the other two average against it
 const keyRow=(kr:number,kg:number,kb:number)=>[kr,kg,kb,0,1+g*thr];
 const rows=k==='green'
  ?[[1,0,0,0,0],[spill/2,1-spill,spill/2,0,0],[0,0,1,0,0],keyRow(g/2,-g,g/2)]
  :[[1,0,0,0,0],[0,1,0,0,0],[spill/2,spill/2,1-spill,0,0],keyRow(g/2,g/2,-g)];
 return rows.map(r=>r.map(v=>+v.toFixed(4)).join(' ')).join(' ');
};
export const maskSchema=z.object({
 shape:z.enum(['rect','circle','linear','mirror']).default('rect'),
 x:z.number().default(.5),y:z.number().default(.5),                      // centre, fraction of the frame
 w:z.number().default(.6),h:z.number().default(.6),                      // size (linear/mirror: h = band height)
 rotate:z.number().default(0),feather:z.number().min(0).max(1).default(.04),radius:z.number().min(0).max(.5).default(0),
 invert:z.boolean().default(false),
});
export const ANIM_IN=['fade','pop','slide-up','slide-down','slide-left','slide-right','zoom-in','zoom-out','blur','spin','drop','rise','swing','bounce','rotate'] as const;
export const ANIM_LOOP=['float','pulse','wiggle','sway','breathe','shake','spin','heartbeat'] as const;
// Text-only animations (CapCut's text In/Out/Loop): the Text component plays them per word or letter;
// the clip layer leaves them alone. They live in the same clip.anim fields.
export const TEXT_IN=['typewriter','letter-fade','blur-letters','word-pop','word-rise','word-drop','word-fade','wipe','stretch'] as const;
export const TEXT_LOOP=['wave','letters-bounce','jelly','flicker','glow-pulse'] as const;
export const animSchema=z.object({
 in:z.enum([...ANIM_IN,...TEXT_IN]).optional(),out:z.enum([...ANIM_IN,...TEXT_IN]).optional(),loop:z.enum([...ANIM_LOOP,...TEXT_LOOP]).optional(),
 inDur:z.number().positive().default(.35),outDur:z.number().positive().default(.3),loopSpeed:z.number().positive().default(1),
});
// Outline / glow around the speaker cut-out (needs base[].matte).
export const subjectSchema=z.object({outline:z.object({color:color.default('#ffffff'),width:z.number().default(8)}).optional(),glow:z.object({color:color.default('#07BFF1'),size:z.number().default(30)}).optional()});
// Keyframes on a clip's on-screen box: t is seconds from the clip's start; any field left out
// follows clip.box. ease shapes the move INTO this key from the previous one.
export const EASES=['linear','in','out','inOut','hold'] as const;
export const keySchema=z.object({t:z.number().min(0),x:z.number().optional(),y:z.number().optional(),scale:z.number().positive().optional(),rotate:z.number().optional(),opacity:z.number().min(0).max(1).optional(),ease:z.enum(EASES).optional()});
export type Key=z.infer<typeof keySchema>;
export type KeyBox={x:number;y:number;scale:number;rotate:number;opacity:number};
const KEY_FIELDS=['x','y','scale','rotate','opacity'] as const;
const easeFn=(e:Key['ease'],p:number)=>e==='in'?p*p*p:e==='out'?1-Math.pow(1-p,3):e==='inOut'?(p<.5?4*p*p*p:1-Math.pow(-2*p+2,3)/2):e==='hold'?0:p;

/** Box + opacity at `t` seconds into the clip, interpolated per field between the keys that set it. */
export const keyedBox=(base:KeyBox,keys:Key[]|undefined,t:number):KeyBox=>{
 if(!keys?.length)return base;
 const ks=[...keys].sort((a,b)=>a.t-b.t),out={...base};
 for(const f of KEY_FIELDS){
  const own=ks.filter(k=>k[f]!==undefined);
  if(!own.length)continue;
  const next=own.findIndex(k=>k.t>t);
  if(next===-1){out[f]=own.at(-1)![f]!;continue}
  if(next===0){out[f]=own[0][f]!;continue}
  const a=own[next-1],b=own[next],p=(t-a.t)/Math.max(1e-6,b.t-a.t);
  out[f]=a[f]!+(b[f]!-a[f]!)*easeFn(b.ease,Math.max(0,Math.min(1,p)));
 }
 return out;
};

export type ClipStyle=z.infer<typeof styleSchema>;
export type ClipMask=z.infer<typeof maskSchema>;
export type ClipAnim=z.infer<typeof animSchema>;
export type Subject=z.infer<typeof subjectSchema>;

const hexA=(hex:string,a:number)=>{
 const h=hex.replace('#','');const full=h.length===3?[...h].map(c=>c+c).join(''):h.slice(0,6);
 const n=parseInt(full,16);return Number.isNaN(n)?hex:`rgba(${n>>16&255},${n>>8&255},${n&255},${a})`;
};

/** drop-shadow() chain for shadow, outline and glow; they follow the drawn shape, not a box. */
export const edgeFilters=(s:{shadow?:ClipStyle['shadow'];outline?:ClipStyle['outline'];glow?:ClipStyle['glow']}|undefined):string[]=>{
 if(!s)return [];
 const out:string[]=[];
 if(s.outline&&s.outline.width>0){const w=s.outline.width,c=s.outline.color;out.push(`drop-shadow(${w}px 0 0 ${c})`,`drop-shadow(-${w}px 0 0 ${c})`,`drop-shadow(0 ${w}px 0 ${c})`,`drop-shadow(0 -${w}px 0 ${c})`);}
 if(s.glow&&s.glow.size>0)out.push(`drop-shadow(0 0 ${s.glow.size/2}px ${s.glow.color})`,`drop-shadow(0 0 ${s.glow.size}px ${s.glow.color})`);
 if(s.shadow)out.push(`drop-shadow(0 ${s.shadow.y}px ${s.shadow.blur}px ${hexA(s.shadow.color,s.shadow.opacity)})`);
 return out;
};

/** CSS mask-image for a shape mask, as an SVG drawn in frame fractions (feathered with a blur). */
export const maskCss=(m:ClipMask,width:number,height:number):string=>{
 const W=1000,H=Math.round(1000*height/width),cx=m.x*W,cy=m.y*H,rw=m.w*W,rh=m.h*H;
 const blur=Math.max(0,m.feather)*Math.min(W,H)*.5;
 let shape='';
 if(m.shape==='rect')shape=`<rect x="${cx-rw/2}" y="${cy-rh/2}" width="${rw}" height="${rh}" rx="${m.radius*Math.min(rw,rh)}"/>`;
 else if(m.shape==='circle')shape=`<ellipse cx="${cx}" cy="${cy}" rx="${rw/2}" ry="${rh/2}"/>`;
 else if(m.shape==='mirror')shape=`<rect x="${-W}" y="${cy-rh/2}" width="${3*W}" height="${rh}"/>`;
 else shape=`<rect x="${-W}" y="${cy}" width="${3*W}" height="${2*H+W}"/>`;                    // linear: keep everything below the line
 const fg=m.invert?'black':'white',bg=m.invert?'white':'black';
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><filter id="f" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${blur.toFixed(1)}"/></filter><mask id="m"><rect width="${W}" height="${H}" fill="${bg}"/><g fill="${fg}" filter="url(#f)" transform="rotate(${m.rotate} ${cx} ${cy})">${shape}</g></mask></defs><rect width="${W}" height="${H}" fill="white" mask="url(#m)"/></svg>`;
 return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
};

const easeOut=(p:number)=>1-Math.pow(1-p,3);
const backOut=(p:number)=>{const c=1.70158;return 1+(c+1)*Math.pow(p-1,3)+c*Math.pow(p-1,2)};
const bounceOut=(p:number)=>{const n=7.5625,d=2.75;if(p<1/d)return n*p*p;if(p<2/d)return n*(p-=1.5/d)*p+.75;if(p<2.5/d)return n*(p-=2.25/d)*p+.9375;return n*(p-=2.625/d)*p+.984375};

export type Motion={tx:number;ty:number;scale:number;rotate:number;opacity:number;blur:number};
const still=():Motion=>({tx:0,ty:0,scale:1,rotate:0,opacity:1,blur:0});

/** One entrance/exit at progress p (0 = hidden, 1 = settled). tx/ty in % of the frame. */
const enter=(name:string,p:number):Motion=>{
 const m=still(),e=easeOut(p),q=1-e;
 switch(name){
  case 'fade':m.opacity=e;break;
  case 'pop':m.scale=.55+.45*backOut(p);m.opacity=Math.min(1,p*2.5);break;
  case 'slide-up':m.ty=14*q;m.opacity=Math.min(1,p*2);break;
  case 'slide-down':m.ty=-14*q;m.opacity=Math.min(1,p*2);break;
  case 'slide-left':m.tx=18*q;m.opacity=Math.min(1,p*2);break;
  case 'slide-right':m.tx=-18*q;m.opacity=Math.min(1,p*2);break;
  case 'zoom-in':m.scale=1.35-.35*e;m.opacity=e;break;
  case 'zoom-out':m.scale=.7+.3*e;m.opacity=e;break;
  case 'blur':m.blur=24*q;m.opacity=e;break;
  case 'spin':m.rotate=-120*q;m.scale=.6+.4*e;m.opacity=Math.min(1,p*2);break;
  case 'drop':m.ty=-30*(1-bounceOut(p));m.opacity=Math.min(1,p*3);break;
  case 'rise':m.ty=22*q;m.blur=10*q;m.opacity=e;break;
  case 'swing':m.rotate=-28*(1-backOut(p));m.opacity=Math.min(1,p*2.5);break;
  case 'bounce':m.scale=bounceOut(p);m.opacity=Math.min(1,p*4);break;
  case 'rotate':m.rotate=90*q;m.opacity=e;break;
 }
 return m;
};
const loopAt=(name:string,t:number,speed:number):Motion=>{
 const m=still(),w=2*Math.PI*speed*t;
 switch(name){
  case 'float':m.ty=Math.sin(w*.8)*1.2;break;
  case 'pulse':m.scale=1+Math.sin(w*1.6)*.035;break;
  case 'wiggle':m.rotate=Math.sin(w*2.2)*2.5;break;
  case 'sway':m.tx=Math.sin(w*.7)*1.2;m.rotate=Math.sin(w*.7)*1;break;
  case 'breathe':m.opacity=.82+.18*(Math.sin(w*.9)*.5+.5);m.scale=1+Math.sin(w*.9)*.015;break;
  case 'shake':m.tx=Math.sin(w*7.3)*.5+Math.sin(w*11.1)*.3;m.ty=Math.cos(w*8.7)*.4;break;
  case 'spin':m.rotate=(t*speed*120)%360;break;
  case 'heartbeat':{const ph=(t*speed)%1;m.scale=1+.07*Math.max(Math.exp(-((ph-.1)**2)/.002),.6*Math.exp(-((ph-.32)**2)/.002));break}
 }
 return m;
};
const combine=(a:Motion,b:Motion):Motion=>({tx:a.tx+b.tx,ty:a.ty+b.ty,scale:a.scale*b.scale,rotate:a.rotate+b.rotate,opacity:a.opacity*b.opacity,blur:a.blur+b.blur});

/** Motion of a clip `t` seconds after it starts, `dur` long. */
export const animAt=(a:ClipAnim|undefined,t:number,dur:number):Motion=>{
 if(!a)return still();
 let m=still();
 const inDur=Math.min(a.inDur,dur/2),outDur=Math.min(a.outDur,dur/2);
 if(a.in&&t<inDur)m=combine(m,enter(a.in,Math.max(0,t/inDur)));
 if(a.out&&t>dur-outDur)m=combine(m,enter(a.out,Math.max(0,(dur-t)/outDur)));
 if(a.loop)m=combine(m,loopAt(a.loop,t,a.loopSpeed));
 return m;
};
