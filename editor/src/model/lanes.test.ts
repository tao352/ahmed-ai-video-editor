import {describe, expect, it} from 'vitest';
import {applyLanes} from '../../../reel/src/edit/lanes';
import * as op from './ops';

const data = (): any => ({
  clips: [{id: 'a', track: 3}, {id: 'b', track: 5}], captions: {enabled: true, words: []}, base: [{src: 'b.mp4'}], zooms: [{type: 'punch'}], transitions: [],
  audio: {voice: {src: 'v.wav', volume: 1}, music: {src: 'm.mp3', volume: 0.3}, sfx: [{at: 1, file: 's.wav', volume: 1}]},
});

describe('lanes', () => {
  it('hides and mutes in the render', () => {
    const d = applyLanes({...data(), lanes: {'track-3': {hidden: true}, words: {hidden: true}, music: {muted: true}, sfx: {muted: true}, base: {locked: true}}});
    expect(d.clips.map((c: any) => c.id)).toEqual(['b']);
    expect(d.captions.enabled).toBe(false);
    expect(d.audio.music!.volume).toBe(0);
    expect(d.audio.sfx[0].volume).toBe(0);
    expect(d.base).toHaveLength(1); // locked only: nothing changes
  });
  it('toggles switches and keeps edit.json clean', () => {
    let d: any = {settings: {duration: 10}, clips: [{id: 'a', from: 1, to: 2, track: 3}], lanes: undefined};
    d = op.toggleLane(d, 'track-3', 'locked');
    expect(d.lanes).toEqual({'track-3': {locked: true}});
    expect(op.isLocked(d, {kind: 'clip', id: 'a'})).toBe(true);
    expect(op.unlocked(d, [{kind: 'clip', id: 'a'}])).toEqual([]);
    d = op.toggleLane(d, 'track-3', 'locked');
    expect('lanes' in d).toBe(false);
  });
  it('selects by side of the playhead and manages beats', () => {
    const d: any = {settings: {duration: 10}, clips: [{id: 'a', from: 1, to: 2}, {id: 'b', from: 5, to: 6}], zooms: [], audio: {music: {src: 'm.mp3', volume: 1}, sfx: [{at: 7, file: 's'}]}, transitions: [], notes: []};
    expect(op.sideRefs(d, 4, 'after')).toEqual([{kind: 'clip', id: 'b'}, {kind: 'sfx', index: 0}]);
    expect(op.sideRefs(d, 4, 'before')).toEqual([{kind: 'clip', id: 'a'}]);
    let m = op.addBeat(d, 2.5);
    m = op.addBeat(m, 1.25);
    expect(op.beats(m)).toEqual([1.25, 2.5]);
    expect(op.beats(op.removeBeatNear(m, 2.45))).toEqual([1.25]);
    expect(op.snapPoints(m)).toContain(1.25);
  });
});
