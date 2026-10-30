// Audio waveforms (voice lane, music and sound blocks): peaks decoded once per file, drawn
// through segments so the voice follows text cuts (timeline time -> file time).
import React, {useEffect, useRef, useState} from 'react';

const RATE = 100; // peaks per second
const cache = new Map<string, Promise<Float32Array>>();

function loadPeaks(url: string): Promise<Float32Array> {
  if (!cache.has(url)) {
    cache.set(url, (async () => {
      const buf = await (await fetch(url)).arrayBuffer();
      const ctx = new OfflineAudioContext(1, 1, 44100);
      const audio = await ctx.decodeAudioData(buf);
      const data = audio.getChannelData(0);
      const step = Math.max(1, Math.floor(audio.sampleRate / RATE));
      const peaks = new Float32Array(Math.ceil(data.length / step));
      for (let i = 0; i < peaks.length; i++) {
        let max = 0;
        for (let j = i * step, end = Math.min(data.length, j + step); j < end; j++) { const v = Math.abs(data[j]); if (v > max) max = v; }
        peaks[i] = max;
      }
      return peaks;
    })());
  }
  return cache.get(url)!;
}

type Segment = {start: number; sourceIn: number; duration: number};

export function Waveform({url, segments, duration, pps, height, color = '#5f8f9c'}: {url: string; segments: Segment[]; duration: number; pps: number; height: number; color?: string}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setPeaks(null); loadPeaks(url).then(setPeaks).catch(() => setFailed(true)); }, [url]);

  const width = Math.max(1, Math.ceil(duration * pps));
  useEffect(() => {
    const c = canvas.current;
    if (!c || !peaks) return;
    // Very long timelines at high zoom: cap the canvas and let CSS stretch it.
    const w = Math.min(width, 16000);
    c.width = w; c.height = height;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, w, height);
    g.fillStyle = color;
    const mid = height / 2;
    for (let x = 0; x < w; x++) {
      const t = (x / w) * duration;
      const seg = segments.find(s => t >= s.start && t < s.start + s.duration);
      if (!seg) continue;
      const i = Math.floor((seg.sourceIn + t - seg.start) * RATE);
      const p = Math.min(1, (peaks[i] ?? 0) * 1.6);
      const h = Math.max(1, p * (height - 4));
      g.fillRect(x, mid - h / 2, 1, h);
    }
  }, [peaks, segments, duration, width, height, color]);

  if (failed) return <span className="wave-note">Could not read audio</span>;
  return <canvas ref={canvas} className="wave" style={{width, height}} aria-hidden />;
}
