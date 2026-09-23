const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize, activityOf, sortByActivity, formatRelative } = require('../src/activity.js');

const post = { id: 'p1', number: 39, publishedAt: '2026-09-20T01:29:23.600922Z' };

test('summarize: no comments -> zero count, publishedAt', () => {
  assert.deepEqual(summarize(post, []), { replyCount: 0, lastActivityAt: '2026-09-20T01:29:23.600Z' });
});

test('summarize: counts all comments, newest createdAt wins (microsecond timestamps)', () => {
  const comments = [
    { createdAt: '2026-09-20T01:50:49.029688Z', depth: 0 },
    { createdAt: '2026-09-21T01:21:52.892482Z', depth: 1 },
    { createdAt: '2026-09-20T19:13:45.583119Z', depth: 1 },
  ];
  assert.deepEqual(summarize(post, comments), { replyCount: 3, lastActivityAt: '2026-09-21T01:21:52.892Z' });
});

test('summarize: comment older than post keeps post time; missing createdAt still counted', () => {
  const comments = [{ createdAt: '2026-09-19T00:00:00Z' }, {}];
  assert.deepEqual(summarize(post, comments), { replyCount: 2, lastActivityAt: '2026-09-20T01:29:23.600Z' });
});

test('summarize: unparseable post time falls back to comment time, or null with no comments (no throw)', () => {
  assert.deepEqual(summarize({ publishedAt: undefined }, [{ createdAt: '2026-09-21T00:00:00Z' }]), {
    replyCount: 1,
    lastActivityAt: '2026-09-21T00:00:00.000Z',
  });
  assert.deepEqual(summarize({ publishedAt: undefined }, []), { replyCount: 0, lastActivityAt: null });
});

test('activityOf: summary when present, else publishedAt', () => {
  const summaries = { p1: { replyCount: 1, lastActivityAt: '2026-09-22T00:00:00.000Z' } };
  assert.equal(activityOf(post, summaries), '2026-09-22T00:00:00.000Z');
  assert.equal(activityOf(post, {}), post.publishedAt);
});

test('sortByActivity: newest first, falls back to publishedAt, ties by higher number, no mutation', () => {
  const posts = [
    { id: 'a', number: 1, publishedAt: '2026-09-01T00:00:00Z' },
    { id: 'b', number: 2, publishedAt: '2026-09-05T00:00:00Z' },
    { id: 'c', number: 3, publishedAt: '2026-09-03T00:00:00Z' },
    { id: 'd', number: 4, publishedAt: '2026-09-03T00:00:00Z' },
  ];
  const summaries = { a: { replyCount: 2, lastActivityAt: '2026-09-10T00:00:00.000Z' } };
  assert.deepEqual(sortByActivity(posts, summaries).map((p) => p.id), ['a', 'b', 'd', 'c']);
  assert.deepEqual(posts.map((p) => p.id), ['a', 'b', 'c', 'd']);
});

test('formatRelative: matches Campuswire (moment fromNow(true)) wording', () => {
  const now = Date.parse('2026-09-23T00:00:00Z');
  const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;
  const cases = [
    [10 * S, 'a few seconds'],
    [60 * S, 'a minute'],
    [5 * M, '5 minutes'],
    [50 * M, 'an hour'],
    [12 * H, '12 hours'],
    [23 * H, 'a day'],
    [2 * D, '2 days'],
    [25 * D, '25 days'],
    [30 * D, 'a month'],
    [90 * D, '3 months'],
    [400 * D, 'a year'],
    [800 * D, '2 years'],
    [-5 * M, 'a few seconds'],
  ];
  for (const [ago, expected] of cases) {
    assert.equal(formatRelative(now - ago, now), expected, `${ago}ms ago`);
  }
  assert.equal(formatRelative('2026-09-22T12:00:00.123456Z', now), '12 hours');
});
