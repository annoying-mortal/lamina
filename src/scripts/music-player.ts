import type { MusicAlbum } from '../data/library';
import { createMusicPlayer, type PlaybackSnapshot } from '../lib/music-player';

const storageKey = 'lamina:music:v1';
const albums: MusicAlbum[] = JSON.parse(document.querySelector('#music-catalog')?.textContent || '[]');
const audio = new Audio();
const player = createMusicPlayer(albums, audio, snapshot => {
  try { sessionStorage.setItem(storageKey, JSON.stringify(snapshot)); } catch {}
}, render);
let lastView = '';
const clock = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;

function renderVolume() {
  const panel = document.querySelector('#music-player');
  if (!panel) return;
  const volume = panel.querySelector<HTMLInputElement>('[data-audio-volume]')!;
  const level = audio.muted ? 0 : Math.round(audio.volume * 100);
  volume.value = String(level);
  volume.style.setProperty('--fill', `${level}%`);
  volume.setAttribute('aria-valuetext', `${level}%`);
  panel.querySelector('[data-audio-mute]')!.setAttribute('aria-pressed', String(level === 0));
}

function renderQueue(panel: HTMLElement, album: MusicAlbum) {
  const list = panel.querySelector<HTMLOListElement>('#audio-queue ol')!;
  if (list.dataset.album === album.id) return;
  list.dataset.album = album.id;
  list.replaceChildren(...album.tracks.map((track, index) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.playAlbum = album.id;
    button.dataset.playTrack = track.id;
    button.dataset.ordinal = String(index + 1).padStart(2, '0');
    button.textContent = track.title;
    item.append(button);
    return item;
  }));
}

function render() {
  const panel = document.querySelector<HTMLElement>('#music-player');
  if (!panel) return;
  const { album, track, index, status, active, position, duration } = player.state;
  const seek = panel.querySelector<HTMLInputElement>('[data-audio-seek]')!;
  seek.max = String(duration); seek.value = String(position); seek.disabled = duration <= 0;
  seek.style.setProperty('--fill', `${duration > 0 ? Math.min(100, position / duration * 100) : 0}%`);
  const time = `${clock(position)} / ${clock(duration)}`;
  seek.setAttribute('aria-valuetext', time);
  panel.querySelector('[data-audio-time]')!.textContent = time;
  const view = JSON.stringify([album?.id, track?.id, status]);
  if (view === lastView) return;
  lastView = view;
  for (const control of document.querySelectorAll<HTMLButtonElement>('.music-toggle')) {
    control.querySelector<HTMLElement>('[data-resume-hint]')!.hidden = status !== 'resume';
    control.setAttribute('aria-label', status === 'resume' ? '继续播放' : '音乐播放器');
  }
  const link = panel.querySelector<HTMLAnchorElement>('[data-audio-album]')!;
  link.textContent = album?.creator || album?.title || '浏览作品志专辑';
  link.href = album ? `/library/#work-${encodeURIComponent(album.id)}` : '/library/';
  link.title = album ? `查看专辑 · ${album.title}` : '浏览作品志专辑';
  const cover = panel.querySelector<HTMLImageElement>('[data-audio-cover]')!;
  if (cover.getAttribute('src') !== (album?.cover || null)) {
    cover.hidden = !album?.cover;
    if (album?.cover) cover.src = album.cover;
    else cover.removeAttribute('src');
  }
  panel.querySelector('[data-audio-title]')!.textContent = track?.title ?? '暂无曲目';
  panel.querySelector('[data-queue-title]')!.textContent = album?.title ?? '';
  panel.querySelector('[data-audio-count]')!.textContent = album ? `${index + 1} / ${album.tracks.length}` : '';
  const listToggle = panel.querySelector<HTMLButtonElement>('[data-audio-list]')!;
  listToggle.disabled = !album;
  if (album && listToggle.getAttribute('aria-expanded') === 'true') renderQueue(panel, album);
  const toggle = panel.querySelector<HTMLButtonElement>('[data-audio-toggle]')!;
  toggle.disabled = !track;
  toggle.dataset.playing = String(active);
  toggle.title = active ? '暂停' : status === 'resume' ? '继续播放' : status === 'ended' ? '重播' : '播放';
  toggle.setAttribute('aria-label', toggle.title);
  panel.querySelector<HTMLButtonElement>('[data-audio-prev]')!.disabled = !album || index <= 0;
  panel.querySelector<HTMLButtonElement>('[data-audio-next]')!.disabled = !album || index >= album.tracks.length - 1;
  panel.querySelector('[data-audio-status]')!.textContent = status === 'resume' ? '点击播放键继续播放' : status === 'error' ? '音频加载失败，点击播放键重试' : status === 'ended' ? '本张专辑已播完' : '';
  document.querySelectorAll<HTMLButtonElement>('[data-play-track]').forEach(button => {
    const current = album?.id === button.dataset.playAlbum && track?.id === button.dataset.playTrack;
    button.setAttribute('aria-pressed', String(active && current));
    if (button.closest('#audio-queue')) button.setAttribute('aria-current', String(current));
  });
}

let saved: Partial<PlaybackSnapshot> | null = null;
if ((performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type === 'reload') {
  try { saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); } catch {}
}
player.start(saved);
render();
renderVolume();
audio.addEventListener('volumechange', renderVolume);
document.addEventListener('error', event => {
  const image = event.target;
  if (image instanceof HTMLImageElement && image.hasAttribute('data-audio-cover')) image.hidden = true;
}, true);
document.addEventListener('click', event => {
  const button = (event.target as Element)?.closest<HTMLButtonElement>('button');
  if (!button || button.disabled) return;
  if (button.classList.contains('music-toggle') && player.state.status === 'resume') void player.play();
  else if (button.hasAttribute('data-audio-toggle')) player.toggle();
  else if (button.hasAttribute('data-audio-prev')) player.skip(-1);
  else if (button.hasAttribute('data-audio-next')) player.skip(1);
  else if (button.hasAttribute('data-audio-mute')) {
    if (audio.volume === 0) { audio.volume = 1; audio.muted = false; }
    else audio.muted = !audio.muted;
  } else if (button.hasAttribute('data-audio-list')) {
    const queue = document.querySelector<HTMLElement>('#audio-queue')!;
    queue.hidden = !queue.hidden;
    button.setAttribute('aria-expanded', String(!queue.hidden));
    lastView = ''; render();
  } else if (button.dataset.playAlbum && button.dataset.playTrack) player.choose(button.dataset.playAlbum, button.dataset.playTrack);
});
document.addEventListener('input', event => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  if (input.hasAttribute('data-audio-seek')) player.seek(input.valueAsNumber);
  else if (input.hasAttribute('data-audio-volume')) {
    audio.volume = input.valueAsNumber / 100; audio.muted = false; renderVolume();
  }
});
document.addEventListener('astro:page-load', () => { lastView = ''; render(); renderVolume(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) player.checkpoint(); });
window.addEventListener('pagehide', player.checkpoint);
if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('pause', player.pause);
  navigator.mediaSession.setActionHandler('play', () => { void player.play(); });
}
