import { htmlToHast } from 'satteri';
import type { getPosts } from './content';
import { normalizeSearchText } from './search-text';

const blockTags = new Set(['p', 'div', 'li', 'br', 'pre', 'blockquote', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

function visibleText(node: ReturnType<typeof htmlToHast>): string {
  if (node.type === 'text') return node.value;
  if (node.type !== 'root' && node.type !== 'element') return '';
  if (node.type === 'element') {
    if (['script', 'style', 'template', 'button'].includes(node.tagName) || node.properties.hidden) return '';
    if (node.tagName === 'img') return String(node.properties.alt ?? '');
  }
  const text = node.children.map(visibleText).join('');
  return node.type === 'element' && blockTags.has(node.tagName) ? ` ${text} ` : text;
}

export function postSearchText(post: Awaited<ReturnType<typeof getPosts>>[number]) {
  const html = post.entry.rendered?.html ?? post.body;
  const body = visibleText(htmlToHast(html, { fragment: true }));
  return normalizeSearchText([post.title, post.summary, ...post.tags, body].join(' '));
}
