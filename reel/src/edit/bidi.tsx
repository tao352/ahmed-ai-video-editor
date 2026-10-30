import React from 'react';

// A mixed phrase has an explicit RTL base. The Latin run is one isolated LTR
// unit, so an Arabic prefix glued to it stays to its right without extra spaces.
// Pure-script strings return unchanged, preserving reference font metrics/bidi.
export const bidiRuns=(text:string):React.ReactNode=>{
 if(!/[\u0600-\u06ff]/u.test(text)||!/[A-Za-z]/u.test(text))return text;
 const runs:React.ReactNode[]=[];
 const latin=/[A-Za-z0-9]+(?:[ \t.'’&/+–—-]*[A-Za-z0-9]+)*[.!?,]?/g;
 let end=0;
 for(const match of text.matchAll(latin)){
  const start=match.index!;
  if(start>end)runs.push(text.slice(end,start));
  runs.push(<bdi key={start} dir="ltr" style={{unicodeBidi:'isolate'}}>{match[0]}</bdi>);
  end=start+match[0].length;
 }
 if(end<text.length)runs.push(text.slice(end));
 return <span dir="rtl" style={{direction:'rtl',unicodeBidi:'isolate'}}>{runs}</span>;
};
