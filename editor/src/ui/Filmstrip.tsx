// Thumbnails along a footage piece on the timeline (CapCut's main track), drawn from the sprite
// the server makes (one frame per second, see editor_tools.py thumbs).
import React, {useEffect, useRef, useState} from 'react';
import type {Thumbs} from '../store';

const images = new Map<string, Promise<HTMLImageElement>>();
const loadImage = (url: string) => {
  if (!images.has(url)) images.set(url, new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = url; }));
  return images.get(url)!;
};

export function Filmstrip({thumbs, base, sourceIn, speed, duration, pps, height}: {thumbs: Thumbs; base: string; sourceIn: number; speed: number; duration: number; pps: number; height: number}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => { loadImage(`${base}/${thumbs.sprite}`).then(setImg).catch(() => setImg(null)); }, [base, thumbs.sprite]);
  const width = Math.max(1, Math.ceil(duration * pps));
  useEffect(() => {
    const c = canvas.current;
    if (!c || !img) return;
    const w = Math.min(width, 16000), scale = w / width;
    c.width = w; c.height = height;
    const g = c.getContext('2d')!;
    const tw = (thumbs.w * height) / thumbs.h;
    for (let x = 0; x < width; x += tw) {
      const src = sourceIn + (x / pps) * speed;
      const i = Math.max(0, Math.min(thumbs.count - 1, Math.floor(src / thumbs.every)));
      g.drawImage(img, (i % thumbs.cols) * thumbs.w, Math.floor(i / thumbs.cols) * thumbs.h, thumbs.w, thumbs.h, x * scale, 0, tw * scale, height);
    }
  }, [img, thumbs, sourceIn, speed, width, pps, height]);
  return <canvas ref={canvas} className="filmstrip" style={{width, height}} aria-hidden />;
}
