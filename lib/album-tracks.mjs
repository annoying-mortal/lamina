export const isAudioUpload = value => typeof value === 'string' && /^\/(?:static|uploads)\/[a-zA-Z0-9][\w.-]*\.(?:mp3|m4a|ogg|wav|flac)$/i.test(value);

export function albumTracks(value, type, { skipRepeatedAudio = false } = {}) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 200 || (value.length && type !== 'albums')) throw new Error('只有 Albums 可设置曲目，每张专辑最多 200 首。');
  const ids = new Set();
  const sources = new Set();
  const tracks = [];
  for (const track of value) {
    if (!track || typeof track.id !== 'string' || !/^[\w-]{1,80}$/.test(track.id) || ids.has(track.id)) throw new Error('曲目 ID 无效或重复。');
    if (typeof track.title !== 'string' || !track.title.trim() || track.title.length > 200 || !isAudioUpload(track.src)) throw new Error('请填写曲名，并选择已上传的 MP3、M4A、OGG、WAV 或 FLAC 文件。');
    ids.add(track.id);
    // Both upload URL prefixes can serve the same stored file.
    const file = track.src.split('/').pop();
    if (sources.has(file)) {
      if (skipRepeatedAudio) continue;
      throw new Error('同一音频在一张专辑中只能添加一次。');
    }
    sources.add(file);
    tracks.push({ id: track.id, title: track.title.trim(), src: track.src });
  }
  return tracks;
}
