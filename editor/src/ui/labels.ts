// Plain names for the prop keys components share, so the inspector reads as words, not JSON.
// The original key always stays in the field's tooltip for talking to Claude.
import {layoutMetadata} from '../../../reel/src/edit/layoutMetadata';
const NAMES: Record<string, string> = {
  t: 'Time', t0: 'Starts', t1: 'Ends', stagger: 'Stagger', sub: 'Small line', labelAr: 'Arabic label', cta: 'Call to action',
  bg: 'Background', backgroundColor: 'Background color', englishFont: 'English font', serif: 'Serif font', latin: 'Latin letters', caps: 'Capitals',
  dir: 'Direction', locale: 'Language', arabicNumerals: 'Arabic numerals', w: 'Width', h: 'Height', r: 'Radius',
  x: 'Left / right', y: 'Up / down', cx: 'Center X', cy: 'Center Y', rot: 'Tilt', pop: 'Pop', audioSrc: 'Audio file', alt: 'Image description',
  matte: 'Speaker cut-out', src: 'File', fadeIn: 'Fade in', fadeOut: 'Fade out', maxWords: 'Max words', gapBreak: 'Pause that breaks a line',
  seed: 'Random seed', easing: 'Easing',
};

/** A readable name for a prop key: the table above, or the key split into words. */
export function propName(key: string): string {
  if (NAMES[key]) return NAMES[key];
  const words = key.replace(/([a-z])([A-Z0-9])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Field hints mix units (s, dB) with the JSON names behind the field. The units stay on screen;
 * a JSON name moves to the tooltip, so the label reads as plain words.
 */
export function splitHint(hint?: string): {shown?: string; tip?: string} {
  if (!hint) return {};
  if (/^(s|×|%|px|deg|dB|LUFS)$/i.test(hint) || !/[a-z]/i.test(hint)) return {shown: hint};
  const unit = hint.match(/(^|\s)(s|dB)$/)?.[2];
  return {shown: unit, tip: hint};
}

// ---------- what a clip track holds ----------

/** A plain role for a component, guessed from its layout purpose and its name. */
export function componentRole(name: string): string {
  const purpose = layoutMetadata[name]?.purpose;
  if (purpose === 'effect' || /Grain|Vignette|Flash|Shock|Wipe|Sweep|Cut$|Pop$|Pulse|Scan|Grade|Taper|Glitch|Leak|Blur/.test(name)) return 'Effects';
  if (/Video|Pip|Phone|Image|Photo|Broll/.test(name)) return 'Video & images';
  if (purpose === 'background' || /Background/.test(name)) return 'Backgrounds';
  if (/Logo|Brand|Bug|EndCard|SkyEnd|Recap|Outro/.test(name)) return 'Logo & end card';
  if (/Caption|Word|Text|Type|Title|Headline|Phrase|Slam|Tag|Note|Stamp|Lockup|Tease|Sticker|Arc|Header/.test(name)) return 'Text';
  return 'Cards & graphics';
}

/** The role most of a track's clips share. */
export function trackRole(components: string[]): string {
  const count = new Map<string, number>();
  for (const c of components) { const r = componentRole(c); count.set(r, (count.get(r) ?? 0) + 1); }
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Layer';
}

/** CapCut's clip colours on the timeline: video/images, text, graphics (stickers, cards), effects. */
export type ClipKind = 'media' | 'text' | 'graphic' | 'effect';
export function clipKind(name: string): ClipKind {
  const role = componentRole(name);
  return role === 'Video & images' ? 'media' : role === 'Text' ? 'text' : role === 'Effects' ? 'effect' : 'graphic';
}
