// Look layers for the edit: colour grade filters (global, per footage piece, per clip),
// vignette and grain overlays. Everything is CSS/SVG inside the composition, so the
// Studio Editor preview and the final render draw the same pixels.
import React from 'react';
import {AbsoluteFill,random,useCurrentFrame} from 'remotion';
import {colorMatrix,curveTable,isGraded,mergeGrade,type Grade} from './grade';

const svgId=(key:string)=>`grade-${key.replace(/[^\w-]/g,'_')}`;

/** One SVG <filter> for a grade: tone curve, white balance + saturation, optional sharpen. */
const GradeFilter:React.FC<{id:string;grade:Grade}>=({id,grade})=>{
 const table=curveTable(grade),k=(grade.sharpen??0)*.9;
 return <filter id={id} colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%">
  <feComponentTransfer>
   <feFuncR type="table" tableValues={table}/><feFuncG type="table" tableValues={table}/><feFuncB type="table" tableValues={table}/>
  </feComponentTransfer>
  <feColorMatrix type="matrix" values={colorMatrix(grade)}/>
  {k>0&&<feConvolveMatrix order="3" preserveAlpha="true" kernelMatrix={`0 ${-k} 0 ${-k} ${1+4*k} ${-k} 0 ${-k} 0`}/>}
 </filter>;
};

/** The grade a footage piece gets: its own sliders over the project's. */
export const pieceGrade=(global:Grade|undefined,piece:Grade|undefined)=>mergeGrade(global,piece);

/** All filters this edit needs, in one hidden <svg>. Reference them with gradeUrl(). */
// memo: the entries list is made once per document, so the SVG filters are not rebuilt every frame
export const GradeDefs=React.memo(function GradeDefs({entries}:{entries:[string,Grade|undefined][]}){
 const live=entries.filter((e):e is [string,Grade]=>isGraded(e[1]));
 if(!live.length)return null;
 return <svg width="0" height="0" style={{position:'absolute'}} aria-hidden>{live.map(([key,g])=><GradeFilter key={key} id={svgId(key)} grade={g}/>)}</svg>;
});
export const gradeUrl=(key:string,g?:Grade)=>isGraded(g)?`url(#${svgId(key)})`:undefined;

/** Darkened edges. */
export const Vignette:React.FC<{amount:number}>=({amount})=>amount>0?<AbsoluteFill style={{pointerEvents:'none',background:`radial-gradient(ellipse 75% 70% at 50% 48%, transparent ${Math.round(58-amount*25)}%, rgba(0,0,0,${(amount*.85).toFixed(3)}) 100%)`}}/>:null;

/** Film grain that changes every frame (seeded, so renders are repeatable). */
export const Grain:React.FC<{amount:number}>=({amount})=>{
 const frame=useCurrentFrame();
 if(amount<=0)return null;
 const seed=Math.floor(random(`grain-${frame}`)*1000);
 return <AbsoluteFill style={{pointerEvents:'none',mixBlendMode:'overlay',opacity:Math.min(1,amount*.7)}}>
  <svg width="100%" height="100%" aria-hidden><filter id={`grain-${frame}`}><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed={seed} stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="100%" height="100%" filter={`url(#grain-${frame})`}/></svg>
 </AbsoluteFill>;
};
