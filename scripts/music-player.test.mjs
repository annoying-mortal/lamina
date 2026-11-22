import test from 'node:test';
import assert from 'node:assert/strict';
import { createMusicPlayer } from '../src/lib/music-player.ts';
import { albumTracks } from '../lib/album-tracks.mjs';

const track = id => ({ id, title: id, src: `/static/${id}.mp3` });
const albums = [
  { id: 'empty', title: 'Empty', tracks: [] },
  { id: 'one', title: 'Album one', tracks: [track('first'), track('last')] },
  { id: 'two', title: 'Album two', tracks: [track('solo')] },
];
class AudioDouble extends EventTarget {
  currentTime = 0; duration = 90; attempts = 0; blocked = false; ended = false;
  set src(value) { this.source = value; this.currentTime = 0; this.ended = false; }
  pause() { this.dispatchEvent(new Event('pause')); }
  async play() { this.attempts++; if (this.blocked) throw new DOMException('blocked', 'NotAllowedError'); }
  finish() { this.currentTime = this.duration; this.ended = true; this.dispatchEvent(new Event('ended')); }
}
function fixture(draws = [0, 0], catalog = albums) {
  const audio = new AudioDouble(); const snapshots = [];
  const player = createMusicPlayer(catalog, audio, value => snapshots.push(value), () => {}, () => draws.shift());
  return { player, audio, snapshots };
}

test('random album then random track is a paused starting point, including after explicit pause', async () => {
  const { player, audio, snapshots } = fixture([0.1, 0.99]);
  player.start(null);
  assert.equal(player.state.track.id, 'last'); assert.equal(audio.attempts, 0);
  await player.play(); player.pause(); player.checkpoint();
  assert.equal(snapshots.at(-1).intent, 'pause');
  const fresh = fixture([0.99, 0.1]); fresh.player.start(snapshots.at(-1));
  assert.equal(fresh.player.state.track.id, 'solo'); assert.equal(fresh.audio.attempts, 0);
  const empty = fixture([], []); empty.player.start(null); empty.player.toggle(); assert.equal(empty.audio.attempts, 0);
});

test('reload restores by album and stable track identity; denied autoplay keeps position until resume', async () => {
  const { player, audio, snapshots } = fixture(); player.start(null); await player.play();
  audio.currentTime = 32.5; audio.pause(); player.checkpoint();
  const restart = fixture([], [albums[2], { ...albums[1], tracks: [...albums[1].tracks].reverse() }]);
  restart.audio.blocked = true;
  restart.player.start(snapshots.at(-1)); await Promise.resolve();
  assert.equal(restart.player.state.status, 'resume'); assert.equal(restart.player.state.track.id, 'first');
  assert.equal(restart.player.state.position, 32.5); assert.equal(restart.snapshots.at(-1).intent, 'play');
  restart.audio.dispatchEvent(new Event('loadedmetadata')); assert.equal(restart.audio.currentTime, 32.5);
  restart.audio.blocked = false; await restart.player.play();
  assert.equal(restart.player.state.status, 'playing'); assert.equal(restart.player.state.index, 1);
});

test('ended advances only within the active album, never wraps or crosses the boundary', async () => {
  const { player, audio } = fixture(); player.start(null);
  player.skip(-1); assert.equal(player.state.track.id, 'first');
  player.skip(1); assert.equal(audio.attempts, 0); player.skip(-1);
  await player.play(); audio.finish(); await Promise.resolve();
  assert.equal(player.state.track.id, 'last'); assert.equal(player.state.status, 'playing');
  audio.finish(); player.skip(1); assert.equal(player.state.track.id, 'last'); assert.equal(player.state.status, 'ended');
  assert.equal(audio.attempts, 2); player.choose('two', 'solo'); await Promise.resolve();
  assert.equal(player.state.track.id, 'solo'); assert.equal(player.state.status, 'playing');
});

test('tracks are ordered and album-only, with unique identities and local audio upload paths', () => {
  const list = [track('last'), track('first')];
  assert.deepEqual(albumTracks(list, 'albums'), list); assert.deepEqual(albumTracks(undefined, 'books'), []);
  assert.throws(() => albumTracks(list, 'books')); assert.throws(() => albumTracks([list[0], list[0]], 'albums'));
  const repeat = { ...list[0], id: 'new-id', title: 'Renamed', src: list[0].src.replace('/static/', '/uploads/') };
  assert.throws(() => albumTracks([...list, repeat], 'albums'), /同一音频/);
  assert.deepEqual(albumTracks([list[0], repeat, list[1]], 'albums', { skipRepeatedAudio: true }), list);
  for (const src of ['https://music.example/song.mp3', '/static/../x.mp3', '/static/song.html']) assert.throws(() => albumTracks([{ ...list[0], src }], 'albums'));
});
