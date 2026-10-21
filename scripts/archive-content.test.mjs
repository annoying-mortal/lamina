import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createArchiveCollection, configureArchive, records, categoryRecords,
  archiveColumns, columnFiles, fileLocation,
} from '../src/archive/data.ts';

const post = {
  id: 'same-id', slug: 'first-post', title: '一篇文章', summary: '摘要',
  category: '音乐笔记', categoryId: 'music', date: '2026-10-20', tags: ['生活'], readTime: 2,
};
const collection = {
  id: 'same-id', title: '一张唱片', original: 'A RECORD', type: 'music', typeLabel: '音乐',
  creator: '创作者', date: '2026-10-19', rating: '8.5', cover: '/uploads/record.jpg',
  note: '听后感', detail: '详细记录', tags: ['音乐'], demo: false,
};
const categories = [{ id: 'music', label: '音乐笔记', en: 'MUSIC NOTES' }];

test('Blog and Library keep distinct identities and destinations in one archive', () => {
  const data = createArchiveCollection([post], categories, [collection]);
  assert.deepEqual(data.posts.map(record => record.id), ['blog:same-id', 'library:same-id']);
  assert.deepEqual(data.posts.map(record => record.categoryId), ['blog:music', 'library:albums']);
  assert.deepEqual(data.posts.map(record => record.href), ['/blog/first-post/', '/library/#work-same-id']);
  assert.equal(data.posts[1].cover, '/uploads/record.jpg');
  assert.equal(data.posts[1].creator, '创作者');
  assert.equal(data.posts[1].rating, '8.5');
  configureArchive(data);
  assert.deepEqual(archiveColumns, ['blog:music', 'library:albums']);
  assert.deepEqual(categoryRecords.map(category => category.label), ['Blog · 音乐笔记', 'Library · Albums']);
  assert.deepEqual(columnFiles(0), [0]);
  assert.deepEqual(columnFiles(1), [1]);
  assert.equal(fileLocation(1).lane, 1);
  assert.equal(records.length, 2);
});

test('Library-only archives remain navigable and encode their deep links', () => {
  const data = createArchiveCollection([], categories, [{ ...collection, id: '唱片 / 01', type: 'book', typeLabel: '书籍', note: '' }]);
  configureArchive(data);
  assert.deepEqual(archiveColumns, ['library:books']);
  assert.equal(records[0].summary, '详细记录');
  assert.equal(records[0].href, '/library/#work-%E5%94%B1%E7%89%87%20%2F%2001');
  assert.deepEqual(columnFiles(8), [0]);
  assert.equal(fileLocation(0).lane, 0);
  configureArchive(createArchiveCollection([], categories, []));
  assert.deepEqual(records, []);
  assert.deepEqual(archiveColumns, []);
  assert.deepEqual(columnFiles(0), []);
});

test('Home archive follows configured Library names and order while omitting the aggregate tab', () => {
  const libraryTypes = [
    { id: 'all', label: 'Everything', en: 'ALL' },
    { id: 'notes', label: 'Notes', en: 'NOTES' },
    { id: 'albums', label: 'Records', en: 'RECORDS' },
  ];
  const data = createArchiveCollection([], [], [collection, { ...collection, id: 'note', type: 'notes' }], libraryTypes);
  configureArchive(data);
  assert.deepEqual(archiveColumns, ['library:notes', 'library:albums']);
  assert.deepEqual(categoryRecords.map(category => category.label), ['Library · Notes', 'Library · Records']);
  assert.deepEqual(data.posts.map(record => record.category), ['Records', 'Notes']);
  assert.deepEqual(columnFiles(0), [1]);
  assert.deepEqual(columnFiles(1), [0]);
});
