import type { MusicAlbum } from '../data/library';

export type PlayerStatus = 'paused' | 'starting' | 'playing' | 'resume' | 'ended' | 'error';
export interface PlaybackSnapshot { album: string; track: string; src: string; position: number; intent: 'play' | 'pause' }

export function createMusicPlayer(catalog: MusicAlbum[], audio: HTMLAudioElement, save: (snapshot: PlaybackSnapshot) => void, changed: () => void, random = Math.random) {
  const albums = catalog.filter(album => album.tracks.length);
  let album: MusicAlbum | undefined;
  let index = 0;
  let status: PlayerStatus = 'paused';
  let pendingPosition = 0;
  let version = 0;
  let lastSavedSecond = -1;
  const track = () => album?.tracks[index];
  const position = () => pendingPosition || audio.currentTime || 0;
  const isActive = () => status === 'playing' || status === 'starting';
  const checkpoint = () => {
    const current = track();
    if (album && current) save({ album: album.id, track: current.id, src: current.src, position: position(), intent: isActive() || status === 'resume' ? 'play' : 'pause' });
  };
  const update = (next: PlayerStatus) => { status = next; checkpoint(); changed(); };
  const play = async () => {
    if (!track()) return;
    const ticket = ++version;
    if (status === 'ended') audio.currentTime = 0;
    update('starting');
    try {
      await audio.play();
      if (ticket === version) update('playing');
    } catch (error) {
      if (ticket === version) update((error as Error).name === 'NotAllowedError' ? 'resume' : 'error');
    }
  };
  const pause = () => { version++; audio.pause(); update('paused'); };
  const select = (next: MusicAlbum, ordinal: number, start: boolean, seconds = 0) => {
    version++;
    status = 'paused';
    audio.pause();
    album = next; index = ordinal; pendingPosition = seconds; lastSavedSecond = -1;
    audio.preload = seconds > 0 ? 'metadata' : 'none';
    audio.src = next.tracks[ordinal].src;
    if (start) void play(); else update('paused');
  };
  const skip = (direction: number) => {
    const next = index + direction;
    if (!album?.tracks[next]) return false;
    select(album, next, isActive());
    return true;
  };
  audio.preload = 'none';
  audio.addEventListener('loadedmetadata', () => {
    if (pendingPosition && Number.isFinite(audio.duration)) {
      audio.currentTime = Math.min(pendingPosition, Math.max(0, audio.duration - 0.05));
      pendingPosition = 0;
    }
    changed();
  });
  audio.addEventListener('timeupdate', () => {
    const second = Math.floor(position());
    if (second !== lastSavedSecond) { lastSavedSecond = second; checkpoint(); }
    changed();
  });
  audio.addEventListener('ended', () => {
    if (!audio.ended || !isActive()) return;
    if (skip(1)) return;
    version++;
    update('ended');
  });
  audio.addEventListener('error', () => { if (audio.error) { version++; update('error'); } });
  return {
    start(saved: Partial<PlaybackSnapshot> | null) {
      if (!albums.length) return;
      if (saved?.intent === 'play') {
        const previous = albums.find(item => item.id === saved.album);
        const ordinal = previous?.tracks.findIndex(item => item.id === saved.track && item.src === saved.src) ?? -1;
        if (previous && ordinal >= 0) {
          select(previous, ordinal, true, typeof saved.position === 'number' && Number.isFinite(saved.position) ? Math.max(0, saved.position) : 0);
          return;
        }
      }
      const pick = albums[Math.floor(random() * albums.length)];
      select(pick, Math.floor(random() * pick.tracks.length), false);
    },
    get state() { return { album, index, track: track(), status, active: isActive(), position: position(), duration: Number.isFinite(audio.duration) ? audio.duration : 0 }; },
    toggle() { if (isActive()) pause(); else void play(); },
    choose(albumId: string, trackId: string) {
      const next = albums.find(item => item.id === albumId);
      const ordinal = next?.tracks.findIndex(item => item.id === trackId) ?? -1;
      if (!next || ordinal < 0) return;
      if (album === next && index === ordinal) this.toggle();
      else select(next, ordinal, true);
    },
    seek(seconds: number) {
      if (Number.isFinite(seconds) && Number.isFinite(audio.duration)) {
        pendingPosition = 0; audio.currentTime = Math.max(0, Math.min(seconds, audio.duration)); checkpoint(); changed();
      }
    },
    play, pause, skip, checkpoint,
  };
}
