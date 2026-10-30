// Colour grade math shared by the renderer (SVG filter) and the editor (scopes, colour match).
// One definition of every slider, so what the scopes measure is what the render shows.
import {z} from 'zod';

const knob=(min:number,max:number)=>z.number().min(min).max(max).optional();
// All sliders default to 0 = untouched. Exposure in stops; the rest are -1..1 (fade/vignette/grain/sharpen 0..1).
export const gradeSchema=z.object({
 exposure:knob(-2,2),contrast:knob(-1,1),highlights:knob(-1,1),shadows:knob(-1,1),
 saturation:knob(-1,1),temperature:knob(-1,1),tint:knob(-1,1),
 fade:knob(0,1),vignette:knob(0,1),grain:knob(0,1),sharpen:knob(0,1),
 preset:z.string().optional(),
});
export type Grade=z.infer<typeof gradeSchema>;
export const GRADE_KEYS=['exposure','contrast','highlights','shadows','saturation','temperature','tint','fade','vignette','grain','sharpen'] as const;
export type GradeKey=typeof GRADE_KEYS[number];

/** Built-in looks; any key left out stays 0. */
export const GRADE_PRESETS:Record<string,Grade>={
 natural:{exposure:.05,contrast:-.06,saturation:-.05,temperature:.04,highlights:-.15,shadows:.1},
 punch:{contrast:.18,saturation:.15,highlights:-.1,shadows:-.05,sharpen:.25},
 warm:{temperature:.35,tint:.05,contrast:.1,saturation:-.05,highlights:-.15},
 cool:{temperature:-.3,contrast:.1,saturation:-.08},
 film:{contrast:.12,fade:.35,saturation:-.15,temperature:.12,grain:.35,vignette:.3},
 moody:{exposure:-.25,contrast:.25,saturation:-.25,shadows:-.2,vignette:.45,temperature:-.08},
 bright:{exposure:.3,contrast:-.08,shadows:.25,saturation:.08},
 bw:{saturation:-1,contrast:.2,grain:.2},
};

export const isGraded=(g?:Grade|null):boolean=>!!g&&GRADE_KEYS.some(k=>Math.abs(g[k]??0)>1e-4);

/** Merge a per-piece grade over the global one, key by key. */
export const mergeGrade=(base?:Grade,over?:Grade):Grade|undefined=>!base?over:!over?base:{...base,...Object.fromEntries(Object.entries(over).filter(([,v])=>v!==undefined))};

/** Tone curve for one 0..1 value: exposure, contrast, shadows/highlights, fade. */
export const toneCurve=(x:number,g:Grade):number=>{
 let v=x*Math.pow(2,g.exposure??0);
 const c=g.contrast??0;
 v=(v-.5)*(c>=0?1+c*1.2:1+c*.8)+.5;
 const s=g.shadows??0,h=g.highlights??0;
 // bumps that peak in the darks (v=1/3) and brights (v=2/3) and leave pure black/white alone
 const u=Math.max(0,Math.min(1,v));
 v+=s*1.4*u*(1-u)*(1-u)+h*1.4*u*u*(1-u);
 const fade=g.fade??0;
 v=v*(1-fade*.22)+fade*.1;
 return Math.max(0,Math.min(1,v));
};

/** Per-channel gains for white balance: temperature warms (R up, B down), tint goes magenta (G down). */
export const balance=(g:Grade):[number,number,number]=>{
 const t=g.temperature??0,n=g.tint??0;
 return [1+t*.12,1-n*.1,1-t*.14];
};

/** The same pipeline the SVG filter runs, for one pixel (0..255 in, 0..255 out). */
export const gradePixel=(r:number,gr:number,b:number,g:Grade):[number,number,number]=>{
 let R=toneCurve(r/255,g),G=toneCurve(gr/255,g),B=toneCurve(b/255,g);
 const [kr,kg,kb]=balance(g);
 R*=kr;G*=kg;B*=kb;
 const s=1+(g.saturation??0);
 const L=.2126*R+.7152*G+.0722*B;
 R=L+(R-L)*s;G=L+(G-L)*s;B=L+(B-L)*s;
 const c=(v:number)=>Math.max(0,Math.min(255,Math.round(v*255)));
 return [c(R),c(G),c(B)];
};

/** Tone curve sampled for feComponentTransfer tableValues. */
export const curveTable=(g:Grade,n=33):string=>Array.from({length:n},(_,i)=>toneCurve(i/(n-1),g).toFixed(4)).join(' ');

/** feColorMatrix values for white balance followed by saturation (luma-preserving, Rec.709). */
export const colorMatrix=(g:Grade):string=>{
 const [kr,kg,kb]=balance(g),s=1+(g.saturation??0);
 const lr=.2126,lg=.7152,lb=.0722;
 const row=(i:number)=>[0,1,2].map(j=>{const lum=[lr,lg,lb][j]*(1-s);return (lum+(i===j?s:0))*[kr,kg,kb][j]});
 return [0,1,2].map(i=>[...row(i),0,0].map(v=>v.toFixed(5)).join(' ')).join(' ')+' 0 0 0 1 0';
};

/** Image statistics used for colour matching: mean luma, luma spread, mean chroma, R-B and G balance. */
export type Stats={luma:number;spread:number;chroma:number;warm:number;green:number};
export const imageStats=(px:Uint8ClampedArray,g?:Grade):Stats=>{
 let n=0,sl=0,sl2=0,sc=0,sw=0,sg=0;
 for(let i=0;i<px.length;i+=16){
  let r=px[i],gg=px[i+1],b=px[i+2];
  if(g)[r,gg,b]=gradePixel(r,gg,b,g);
  const L=(.2126*r+.7152*gg+.0722*b)/255;
  sl+=L;sl2+=L*L;sc+=(Math.max(r,gg,b)-Math.min(r,gg,b))/255;sw+=(r-b)/255;sg+=(gg-(r+b)/2)/255;n++;
 }
 const luma=sl/n;
 return {luma,spread:Math.sqrt(Math.max(0,sl2/n-luma*luma)),chroma:sc/n,warm:sw/n,green:sg/n};
};

/** A grade that moves `cur` toward `ref`. Rough on purpose: a starting point to fine-tune by eye. */
export const matchGrade=(cur:Stats,ref:Stats):Grade=>{
 const r=(v:number,lo:number,hi:number)=>Math.round(Math.max(lo,Math.min(hi,v))*100)/100;
 return {
  exposure:r(Math.log2(Math.max(.02,ref.luma)/Math.max(.02,cur.luma)),-2,2),
  contrast:r(ref.spread/Math.max(.01,cur.spread)-1,-1,1),
  saturation:r(ref.chroma/Math.max(.01,cur.chroma)-1,-1,1),
  temperature:r((ref.warm-cur.warm)*4,-1,1),
  tint:r(-(ref.green-cur.green)*5,-1,1),
 };
};
