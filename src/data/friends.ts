import entries from '../content/friends.json';
import { imageSource } from './site';

export interface Friend {
  id: string; name: string; url: string; avatar: string; initials: string;
  description: string; label: string; kind: string; order: number; visible: boolean; demo: boolean;
}

export const friends = (entries as Friend[])
  .filter(friend => friend.visible)
  .sort((a, b) => a.order - b.order)
  .map(friend => {
    let domain = '';
    try { domain = new URL(friend.url).host; } catch { /* Backend validation normally prevents malformed URLs. */ }
    return { ...friend, avatar: imageSource(friend.avatar), initials: friend.initials || [...friend.name][0] || '↗', domain };
  });
