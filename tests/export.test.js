const test = require('node:test');
const assert = require('node:assert/strict');
const { formatExport } = require('../src/export.js');

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
