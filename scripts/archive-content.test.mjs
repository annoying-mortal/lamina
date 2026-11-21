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

test('Blog, Library and Friends keep distinct identities and destinations in one archive', () => {
  const friend = { id: 'same-id', name: 'Another blog', url: 'https://friend.example.test/notes/', domain: 'friend.example.test', avatar: '', description: '', kind: 'Blog', label: '', demo: false };
  const data = createArchiveCollection([post], categories, [collection], undefined, [friend]);
  assert.deepEqual(data.posts.map(record => record.id), ['blog:same-id', 'library:same-id', 'friend:same-id']);
  assert.deepEqual(data.posts.map(record => record.categoryId), ['blog:music', 'library:albums', 'friends']);
  assert.deepEqual(data.posts.map(record => record.href), ['/blog/first-post/', '/library/#work-same-id', friend.url]);
  assert.equal(data.posts[1].cover, '/uploads/record.jpg');
  assert.equal(data.posts[1].creator, '创作者');
  assert.equal(data.posts[1].rating, '8.5');
  configureArchive(data);
  assert.deepEqual(archiveColumns, ['blog:music', 'library:albums', 'friends']);
  assert.deepEqual(categoryRecords.map(category => category.label), ['Blog · 音乐笔记', 'Library · Albums', 'Friends']);
  assert.deepEqual(categoryRecords.map(category => category.tabLabel), ['Blog', 'Albums', 'Friends']);
  assert.deepEqual(columnFiles(0), [0]);
  assert.deepEqual(columnFiles(1), [1]);
  assert.equal(fileLocation(1).lane, 1);
  assert.deepEqual(columnFiles(2), [2]);
  assert.equal(records.length, 3);
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

test('archive payload excludes build-only article data and empty navigation lanes', () => {
  const entry = { ...post, entry: { body: 'full article' }, sourcePath: 'nested/post.md' };
  const data = createArchiveCollection([entry], [...categories, { id: 'empty', label: 'Empty', en: 'EMPTY' }], [collection]);
  assert.deepEqual(data.categories.map(category => category.id), ['blog:music', 'library:albums']);
  assert.equal(data.categories[0].tabLabel, 'Blog');
  for (const key of ['entry', 'sourcePath', 'slug']) assert.equal(Object.hasOwn(data.posts[0], key), false);
  configureArchive(data);
  assert.deepEqual(columnFiles(-1), [1]);
  assert.deepEqual(columnFiles(2), [0]);
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
  assert.deepEqual(categoryRecords.map(category => category.tabLabel), ['Notes', 'Records']);
  assert.deepEqual(data.posts.map(record => record.category), ['Records', 'Notes']);
  assert.deepEqual(columnFiles(0), [1]);
  assert.deepEqual(columnFiles(1), [0]);
});

test('populated blog categories remain distinguishable in the tab bar', () => {
  const second = { ...post, id: 'second', categoryId: 'travel', category: 'Travel' };
  const data = createArchiveCollection([post, second], [...categories, { id: 'travel', label: 'Travel' }]);
  assert.deepEqual(data.categories.map(category => category.tabLabel), ['音乐笔记', 'Travel']);
});
