import test from 'node:test';
import assert from 'node:assert/strict';
import { homeSettings } from '../lib/home-settings.mjs';

test('legacy About settings receive independent placeholders while an empty array remains empty', () => {
  const first = homeSettings({});
  const second = homeSettings({});
  assert.equal(first.aboutHighlights.length, 3);
  first.aboutHighlights[0].title = 'Changed locally';
  assert.equal(second.aboutHighlights[0].title, 'Enter achievement title');
  assert.deepEqual(homeSettings({ aboutHighlights: [] }).aboutHighlights, []);
  assert.equal(homeSettings({ aboutHighlights: null }).aboutHighlights.length, 3);
});

test('hand-edited highlights tolerate malformed values without exposing unsafe links', () => {
  const settings = homeSettings({ aboutHighlights: [null, 'row', [], {}, { title: 123 },
    { title: 'Valid item', label: 99, description: ['invalid'], period: false, url: 'javascript:alert(1)' },
    { title: 'Linked item', url: 'https://example.com/work' },
  ] });
  assert.deepEqual(settings.aboutHighlights, [
    { title: 'Valid item', label: '', description: '', period: '', url: '' },
    { title: 'Linked item', label: '', description: '', period: '', url: 'https://example.com/work' },
  ]);
  const bounded = homeSettings({ aboutHighlights: Array.from({ length: 8 }, () => ({ title: 'x'.repeat(400), description: 'x'.repeat(1000) })) }).aboutHighlights;
  assert.equal(bounded.length, 6); assert.equal(bounded[0].title.length, 200); assert.equal(bounded[0].description.length, 500);
});
