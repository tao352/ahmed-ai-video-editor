// Chroma key (CapCut): remove a green or blue screen behind a video clip.
import React from 'react';
import {CheckField, SliderField} from './fields';

type Chroma = {key?: 'green' | 'blue'; strength?: number; soft?: number; spill?: number};

export function ChromaFields({value, onChange}: {value: Chroma | undefined; onChange: (next: Chroma | undefined, field: string) => void}) {
  const set = (patch: Chroma, field: string) => onChange({...value, ...patch}, field);
  return (
    <div className="subgroup">
      <div className="sub-title">Chroma key (remove green screen)</div>
      <CheckField label="Enabled" value={!!value} onChange={on => onChange(on ? {key: 'green', strength: 0.5, soft: 0.2, spill: 0.5} : undefined, 'chroma')} />
      {value && <>
        <div className="seg" role="group" aria-label="Key color">
          {([['green', 'Green'], ['blue', 'Blue']] as const).map(([k, n]) => <button key={k} className={`key small ${(value.key ?? 'green') === k ? 'lit' : ''}`} aria-pressed={(value.key ?? 'green') === k} onClick={() => set({key: k}, 'key')}>{n}</button>)}
        </div>
        <SliderField label="Strength" value={value.strength} neutral={0.5} min={0} max={1} step={0.01} onChange={v => set({strength: v ?? 0.5}, 'strength')} />
        <SliderField label="Edge softness" value={value.soft} neutral={0.2} min={0} max={1} step={0.01} onChange={v => set({soft: v ?? 0.2}, 'soft')} />
        <SliderField label="Spill removal" value={value.spill} neutral={0.5} min={0} max={1} step={0.01} onChange={v => set({spill: v ?? 0.5}, 'spill')} />
      </>}
    </div>
  );
}
