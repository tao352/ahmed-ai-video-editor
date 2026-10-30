// Video scopes under the monitor: luma waveform and vectorscope of the footage at the playhead,
// with the grade applied in JS (grade.ts gradePixel), so they show what the render will show.
import React, {useEffect, useRef} from 'react';
import {gradePixel, mergeGrade, type Grade} from '../../../reel/src/edit/grade';
import * as op from '../model/ops';
import {nowTime, useDoc, useEditor, usePlayhead} from '../store';
import {footageFrame} from './ColorPanel';

const W = 220, H = 110, V = 110;

function gradeAt(doc: op.Doc, t: number): Grade | undefined {
  const piece = op.bases(doc).find((b, i) => { const s = op.getSpan(doc, {kind: 'base', index: i}); return s && t >= s.start && t < s.end; });
  return mergeGrade(doc.grade, piece?.grade);
}

function draw(wave: HTMLCanvasElement, vec: HTMLCanvasElement, px: Uint8ClampedArray, cols: number, g?: Grade) {
  const wc = wave.getContext('2d')!, vc = vec.getContext('2d')!;
  const wImg = wc.createImageData(W, H), vImg = vc.createImageData(V, V);
  const wBuf = new Uint32Array(W * H), vBuf = new Uint32Array(V * V);
  const rows = px.length / 4 / cols;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 4;
      let r = px[i], gg = px[i + 1], b = px[i + 2];
      if (g) [r, gg, b] = gradePixel(r, gg, b, g);
      const L = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
      const wx = Math.floor(x / cols * W), wy = H - 1 - Math.floor(L / 256 * H);
      wBuf[wy * W + wx]++;
      const cb = (b - L) / 1.8556, cr = (r - L) / 1.5748; // Rec.709, about -128..128
      const vx = Math.round(V / 2 + cb / 256 * V * 0.9), vy = Math.round(V / 2 - cr / 256 * V * 0.9);
      if (vx >= 0 && vx < V && vy >= 0 && vy < V) vBuf[vy * V + vx]++;
    }
  }
  const paint = (buf: Uint32Array, img: ImageData, gain: number, tint: [number, number, number]) => {
    for (let k = 0; k < buf.length; k++) {
      const a = Math.min(255, buf[k] * gain);
      img.data[k * 4] = tint[0]; img.data[k * 4 + 1] = tint[1]; img.data[k * 4 + 2] = tint[2]; img.data[k * 4 + 3] = a;
    }
  };
  paint(wBuf, wImg, 14, [190, 230, 200]);
  paint(vBuf, vImg, 18, [230, 220, 190]);
  wc.putImageData(wImg, 0, 0);
  vc.putImageData(vImg, 0, 0);
  // reference lines on top: 0%, 50%, 100% luma; outer ring and skin-tone line on the vectorscope
  wc.fillStyle = 'rgb(255 255 255 / 0.14)';
  for (const f of [0, 0.5, 1]) wc.fillRect(0, Math.min(H - 1, Math.round((1 - f) * (H - 1))), W, 1);
  vc.strokeStyle = 'rgb(255 255 255 / 0.16)';
  vc.beginPath(); vc.arc(V / 2, V / 2, V * 0.45, 0, Math.PI * 2); vc.stroke();
  vc.strokeStyle = 'rgb(229 160 58 / 0.5)';
  vc.beginPath(); vc.moveTo(V / 2, V / 2); vc.lineTo(V / 2 - V * 0.2, V / 2 - V * 0.37); vc.stroke();
}

export function Scopes() {
  const doc = useDoc('panel');
  const frame = usePlayhead(p => p.frame);
  const wave = useRef<HTMLCanvasElement>(null), vec = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        const px = footageFrame();
        if (!px || !doc || !wave.current || !vec.current) return;
        draw(wave.current, vec.current, px, 160, gradeAt(doc, nowTime()));
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [doc, frame]);
  return (
    <div className="scopes" dir="ltr" aria-label="Color scopes">
      <figure><canvas ref={wave} width={W} height={H} /><figcaption>Waveform</figcaption></figure>
      <figure><canvas ref={vec} width={V} height={V} /><figcaption>Vectorscope</figcaption></figure>
    </div>
  );
}
