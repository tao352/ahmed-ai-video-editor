import {CUT_TRANSITIONS} from '../../../reel/src/edit/cutTransitions';

// Transition types the render knows (reel/src/edit/transitions.tsx), with plain names.
// CUT_TRANSITIONS (cutTransitions.ts) are the CapCut set the library offers; the older ones below
// still play in projects that use them. Overlay types work on any cut, including a cut in the footage; series types need two clips
// side by side on one track.
export const OVERLAY_TRANSITIONS: [string, string][] = [
  ['whip', 'Whip pan'], ['zoomBlur', 'Zoom blur'], ['zoomThrough', 'Zoom through'], ['glitch', 'Glitch'],
  ['rgbSplit', 'RGB split'], ['lightLeak', 'Light leak'], ['pixelate', 'Pixelate'], ['checkerboard', 'Checkerboard'],
];
export const SERIES_TRANSITIONS: [string, string][] = [
  ['fade', 'Fade'], ['slide', 'Slide'], ['wipe', 'Wipe'], ['flip', 'Flip'], ['clockWipe', 'Clock wipe'], ['circleWipe', 'Circle wipe'],
];
export const transitionName = (type: string) => [...CUT_TRANSITIONS, ...OVERLAY_TRANSITIONS, ...SERIES_TRANSITIONS].find(([t]) => t === type)?.[1] ?? type;
