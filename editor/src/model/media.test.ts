import {expect, test} from 'vitest';
import {mediaKind, safeName} from '../../server/api';

test('imported files are sorted by kind and get safe names', () => {
  expect(mediaKind('Clip.MOV')).toBe('video');
  expect(mediaKind('logo.png')).toBe('image');
  expect(mediaKind('whoosh.wav')).toBe('audio');
  expect(mediaKind('notes.txt')).toBeNull();
  expect(safeName('C:\\Users\\me\\My Clip (final).mp4')).toBe('My-Clip-final.mp4');
  expect(safeName('../../evil.png')).toBe('evil.png');
  expect(safeName('صوت.mp3')).toMatch(/^file-[a-z0-9]+\.mp3$/);
});

import {addMedia} from './edits';
import type {Doc} from './ops';
const doc = (music = false): Doc => ({version: 1, settings: {width: 1080, height: 1920, fps: 30, duration: 20}, base: [{src: 'base.mp4', start: 0, duration: 20}], clips: [],
  captions: {words: []}, audio: {sfx: [], ...(music ? {music: {src: 'm.mp3', volume: 0.1}} : {})}});

test('an imported file lands on the timeline as the right kind of item', () => {
  const v = addMedia(doc(), {path: 'media/videos/a.mp4', kind: 'video', duration: 30}, 4);
  expect(v.doc.clips[0]).toMatchObject({component: 'VideoLayer', from: 4, to: 20, props: {src: 'media/videos/a.mp4', volume: 0, whip: false}});
  const el = addMedia(doc(), {path: 'media/images/logo.png', kind: 'image'}, 1);
  expect(el.doc.clips[0]).toMatchObject({component: 'ImageLayer', from: 1, to: 4, box: {scale: 0.45}, props: {fit: 'contain'}});
  const photo = addMedia(doc(), {path: 'media/images/p.jpg', kind: 'image'}, 1);
  expect(photo.doc.clips[0].box).toBeUndefined();
  const hit = addMedia(doc(), {path: 'media/audio/hit.wav', kind: 'audio', duration: 0.8}, 2);
  expect(hit.doc.audio.sfx).toEqual([{at: 2, file: 'media/audio/hit.wav', volume: 1, duration: 0.8}]);
  const song = addMedia(doc(), {path: 'media/audio/song.mp3', kind: 'audio', duration: 120}, 0);
  expect(song.ref).toEqual({kind: 'music'});
  expect(song.doc.audio.music.src).toBe('media/audio/song.mp3');
  const second = addMedia(doc(true), {path: 'media/audio/song.mp3', kind: 'audio', duration: 120}, 3);
  expect(second.doc.audio.music.src).toBe('m.mp3');
  expect(second.doc.audio.sfx[0]).toMatchObject({at: 3, duration: 17, volume: 0.5});
});

import * as op from './ops';
test('trimming or splitting a video clip keeps its picture in place', () => {
  const d = addMedia(doc(), {path: 'media/videos/a.mp4', kind: 'video', duration: 30}, 4).doc;
  const id = d.clips[0].id;
  const trimmed = op.trimItem(d, {kind: 'clip', id}, 'start', 6);
  expect(trimmed.clips[0]).toMatchObject({from: 6, props: {sourceIn: 2}});
  const split = op.splitClip(d, id, 10);
  expect(split.doc.clips.map((c: any) => [c.from, c.props.sourceIn ?? 0])).toEqual([[4, 0], [10, 6]]);
});

test('replace swaps what an item plays and keeps its place', async () => {
  const {replaceMedia} = await import('./edits');
  const d: Doc = {...doc(true), clips: [{id: 'c1', component: 'VideoLayer', from: 2, to: 5, track: 6, box: {x: 10, y: 0, scale: 0.5, rotate: 0}, props: {src: 'a.mp4', sourceIn: 3, volume: 0.4, transparent: false}}],
    audio: {sfx: [{at: 1, file: 'pop.wav', volume: 0.8, duration: 0.4}], music: {src: 'm.mp3', volume: 0.1}}};
  const v = replaceMedia(d, {kind: 'clip', id: 'c1'}, {path: 'media/videos/b.mp4', kind: 'video', duration: 10})!;
  expect(v.doc.clips[0]).toMatchObject({from: 2, to: 5, track: 6, box: {x: 10, scale: 0.5}, component: 'VideoLayer', props: {src: 'media/videos/b.mp4', sourceIn: 0, volume: 0.4}});
  const img = replaceMedia(d, {kind: 'clip', id: 'c1'}, {path: 'media/images/p.jpg', kind: 'image'})!;
  expect(img.doc.clips[0]).toMatchObject({component: 'ImageLayer', from: 2, to: 5, props: {image: 'media/images/p.jpg'}});
  expect(img.doc.clips[0].props.src).toBeUndefined();
  expect(replaceMedia(d, {kind: 'clip', id: 'c1'}, {path: 'short.mp4', kind: 'video', duration: 1})).toBeNull();
  expect(replaceMedia(d, {kind: 'base', index: 0}, {path: 'media/videos/long.mp4', kind: 'video', duration: 30})!.doc.base[0]).toMatchObject({src: 'media/videos/long.mp4', start: 0, duration: 20, sourceIn: 0});
  expect(replaceMedia(d, {kind: 'base', index: 0}, {path: 'p.jpg', kind: 'image'})).toBeNull();
  expect(replaceMedia(d, {kind: 'sfx', index: 0}, {path: 'boom.wav', kind: 'audio', duration: 2})!.doc.audio.sfx[0]).toMatchObject({at: 1, file: 'boom.wav', volume: 0.8, duration: 0.4});
  expect(replaceMedia(d, {kind: 'music'}, {path: 'n.mp3', kind: 'audio'})!.doc.audio.music).toMatchObject({src: 'n.mp3', volume: 0.1});
  expect(replaceMedia(d, {kind: 'sfx', index: 0}, {path: 'x.mp4', kind: 'video'})).toBeNull();
});
