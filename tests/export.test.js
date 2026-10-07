const test = require('node:test');
const assert = require('node:assert/strict');
const { formatExport, filterPosts } = require('../src/export.js');

const NOW = Date.UTC(2026, 9, 7, 12, 0);

const post = (over) => ({
  id: 'p1',
  number: 1,
  title: 'T1',
  body: 'short',
  publishedAt: '2026-10-07T13:02:00Z',
  answered: false,
  note: false,
  authorName: 'Ada Lovelace',
  ...over,
});

test('formatExport: header, post with full body, nested replies indented by depth (top-level replies are depth 1)', () => {
  const posts = [post({ id: 'p148', number: 148, title: 'Content Quiz 3', answered: true, authorName: '' })];
  const threads = {
    p148: {
      body: 'Just to confirm?\nSecond line',
      comments: [
        { depth: 1, answer: true, authorName: 'Raj Venkat', createdAt: '2026-10-07T14:00:00Z', body: 'No linked lists.' },
        { depth: 2, answer: false, authorName: 'Sam Lee', createdAt: '2026-10-07T14:05:00Z', body: 'Thanks!\nGot it' },
      ],
    },
  };
  const { text, postCount, missingCount } = formatExport(posts, threads, NOW);
  assert.equal(postCount, 1);
  assert.equal(missingCount, 0);
  assert.equal(
    text,
    [
      'Campuswire class export: 1 post, copied 2026-10-07',
      '',
      '=== #148 Content Quiz 3 [question, resolved] ===',
      'Anonymous, 2026-10-07 13:02 UTC',
      'Just to confirm?',
      'Second line',
      '',
      '  > [answer] Raj Venkat, 2026-10-07 14:00 UTC',
      '    No linked lists.',
      '    > Sam Lee, 2026-10-07 14:05 UTC',
      '      Thanks!',
      '      Got it',
      '',
    ].join('\n')
  );
});

test('formatExport: notes are tagged note, unresolved questions just question', () => {
  const posts = [post({ id: 'a', number: 2, note: true }), post({ id: 'b', number: 1 })];
  const { text } = formatExport(posts, { a: { body: 'x', comments: [] }, b: { body: 'y', comments: [] } }, NOW);
  assert.ok(text.includes('=== #2 T1 [note] ==='));
  assert.ok(text.includes('=== #1 T1 [question] ==='));
  assert.ok(text.indexOf('#2') < text.indexOf('#1')); // keeps the given (feed) order
});

test('formatExport: post without a stored thread uses the cached snippet and is marked and counted', () => {
  const { text, postCount, missingCount } = formatExport([post({ body: 'snippet' })], {}, NOW);
  assert.equal(postCount, 1);
  assert.equal(missingCount, 1);
  assert.ok(text.includes('snippet\n(full text and replies not loaded yet)\n'));
});

test('formatExport: anonymous reply and missing or bad times do not throw', () => {
  const posts = [post({ publishedAt: undefined })];
  const threads = { p1: { body: 'b', comments: [{ depth: 1, answer: false, authorName: '', createdAt: 'nope', body: 'r' }] } };
  const { text } = formatExport(posts, threads, NOW);
  assert.ok(text.includes('\nAda Lovelace\nb\n'));
  assert.ok(text.includes('  > Anonymous\n    r\n'));
});

const at = (id, publishedAt) => ({ id, publishedAt });
// Built from local wall-clock times so the tests pass in any timezone.
const localIso = (y, m, d, h = 0, min = 0, s = 0) => new Date(y, m - 1, d, h, min, s).toISOString();
const rangePosts = [
  at('after', localIso(2026, 10, 8, 0, 0, 0)),
  at('lastMoment', localIso(2026, 10, 7, 23, 59, 59)),
  at('firstMoment', localIso(2026, 9, 22, 0, 0, 0)),
  at('before', localIso(2026, 9, 21, 23, 59, 59)),
];
const ids = (posts) => posts.map((p) => p.id);

test('filterPosts: no filters keeps every post in order', () => {
  assert.deepEqual(filterPosts(rangePosts), rangePosts);
  assert.deepEqual(filterPosts(rangePosts, { from: '', to: '' }), rangePosts);
});

test('filterPosts: both bounds are inclusive local days', () => {
  assert.deepEqual(ids(filterPosts(rangePosts, { from: '2026-09-22', to: '2026-10-07' })), ['lastMoment', 'firstMoment']);
});

test('filterPosts: a blank side is unbounded', () => {
  assert.deepEqual(ids(filterPosts(rangePosts, { from: '2026-09-22' })), ['after', 'lastMoment', 'firstMoment']);
  assert.deepEqual(ids(filterPosts(rangePosts, { to: '2026-10-07' })), ['lastMoment', 'firstMoment', 'before']);
});

test('filterPosts: a start after the end matches nothing', () => {
  assert.deepEqual(filterPosts(rangePosts, { from: '2026-10-07', to: '2026-09-22' }), []);
});

test('filterPosts: posts with a missing or bad date stay without bounds and drop out with one', () => {
  const posts = [at('none', undefined), at('bad', 'nope'), at('ok', localIso(2026, 10, 1, 12))];
  assert.deepEqual(ids(filterPosts(posts)), ['none', 'bad', 'ok']);
  assert.deepEqual(ids(filterPosts(posts, { from: '2026-01-01' })), ['ok']);
});

test('filterPosts: selected ids win over dates, keep class order, and skip ids no longer in the class', () => {
  const posts = [at('a', localIso(2026, 10, 3)), at('b', localIso(2026, 10, 2)), at('c', localIso(2026, 10, 1))];
  assert.deepEqual(ids(filterPosts(posts, { from: '2030-01-01', selectedIds: ['c', 'a', 'gone'] })), ['a', 'c']);
  assert.deepEqual(filterPosts(posts, { selectedIds: [] }), []);
});

test('formatExport: header names what was exported', () => {
  const header = (posts, scope) => formatExport(posts, {}, NOW, scope).text.split('\n')[0];
  const two = [post({ id: 'a' }), post({ id: 'b' })];
  assert.equal(header(two), 'Campuswire class export: 2 posts, copied 2026-10-07');
  assert.equal(header(two, { from: '', to: '' }), 'Campuswire class export: 2 posts, copied 2026-10-07');
  assert.equal(header([post()], { selected: true }), 'Campuswire class export: 1 selected post, copied 2026-10-07');
  assert.equal(header(two, { selected: true }), 'Campuswire class export: 2 selected posts, copied 2026-10-07');
  assert.equal(header(two, { from: '2026-09-22', to: '2026-10-07' }), 'Campuswire class export: 2 posts published 2026-09-22 to 2026-10-07, copied 2026-10-07');
  assert.equal(header(two, { from: '2026-09-22', to: '' }), 'Campuswire class export: 2 posts published from 2026-09-22, copied 2026-10-07');
  assert.equal(header(two, { from: '', to: '2026-10-07' }), 'Campuswire class export: 2 posts published up to 2026-10-07, copied 2026-10-07');
});
