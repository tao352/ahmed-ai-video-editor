// Crop (CapCut "crop"): trim each edge of a clip or footage piece, as a share of the frame.
import React from 'react';
import {SliderField} from './fields';

export type Crop = {l?: number; t?: number; r?: number; b?: number};
const EDGES: [keyof Crop, string][] = [['t', 'Top'], ['b', 'Bottom'], ['l', 'Left'], ['r', 'Right']];

export function CropFields({value, onChange}: {value: Crop | undefined; onChange: (next: Crop | undefined, edge: string) => void}) {
  const set = (k: keyof Crop, v: number | undefined) => {
    const next = {...value, [k]: v};
    if (!v) delete next[k];
    onChange(Object.values(next).some(Boolean) ? next : undefined, k);
  };
  return (
    <div className="subgroup">
      <div className="sub-title">Crop</div>
      {EDGES.map(([k, label]) => <SliderField key={k} label={label} value={value?.[k]} neutral={0} min={0} max={0.45} step={0.005} onChange={v => set(k, v)} />)}
    </div>
  );
}
