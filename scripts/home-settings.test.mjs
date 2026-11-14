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

test('About me defaults contain nine independent empty slots without inventing works', () => {
  const first = homeSettings({}), second = homeSettings({});
  assert.equal(first.aboutMeTitle, 'About me');
  assert.equal(first.aboutMeSubtitle, '构成我的九部作品');
  assert.deepEqual(first.aboutMeWorks, Array.from({ length: 9 }, () => ({ label: '', libraryId: '' })));
  first.aboutMeWorks[0].label = 'Changed';
  assert.equal(first.aboutMeWorks[1].label, '');
  assert.equal(second.aboutMeWorks[0].label, '');
});

test('hand-edited About me works keep their positions and always fill nine slots', () => {
  const settings = homeSettings({ aboutMeTitle: '', aboutMeSubtitle: '', aboutMeWorks: [
    null, { label: ' 最喜欢 ', libraryId: ' work-1 ' }, { label: false, libraryId: 123 },
    { label: 'Again', libraryId: 'work-1' }, { label: 'Removed', libraryId: 'missing-work' },
  ] });
  assert.equal(settings.aboutMeTitle, ''); assert.equal(settings.aboutMeSubtitle, '');
  assert.equal(settings.aboutMeWorks.length, 9);
  assert.deepEqual(settings.aboutMeWorks.slice(0, 5), [
    { label: '', libraryId: '' }, { label: '最喜欢', libraryId: 'work-1' }, { label: '', libraryId: '' },
    { label: 'Again', libraryId: 'work-1' }, { label: 'Removed', libraryId: 'missing-work' },
  ]);
  assert.ok(settings.aboutMeWorks.slice(5).every(item => item.label === '' && item.libraryId === ''));
  for (const aboutMeWorks of [[], null, 'invalid']) assert.equal(homeSettings({ aboutMeWorks }).aboutMeWorks.length, 9);
  const bounded = homeSettings({ aboutMeWorks: Array.from({ length: 10 }, () => ({ label: 'x'.repeat(81), libraryId: 'x'.repeat(81) })) }).aboutMeWorks;
  assert.equal(bounded.length, 9); assert.equal(bounded[0].label.length, 80); assert.equal(bounded[0].libraryId.length, 80);
});
