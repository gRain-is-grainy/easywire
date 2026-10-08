const test = require('node:test');
const assert = require('node:assert/strict');
const { statusLines } = require('../src/popup/status.js');

const NOW = Date.parse('2026-10-07T12:00:00Z');
const MIN = 60 * 1000;

test('no class open', () => {
  assert.deepEqual(statusLines({ groupId: null, now: NOW }), {
    title: 'No class open',
    detail: 'Open a class feed on Campuswire to see its status.',
  });
});

test('post count and when it was last checked', () => {
  assert.deepEqual(statusLines({ groupId: 'g', postCount: 1284, refreshedAt: NOW - 3 * MIN, now: NOW }), {
    title: '1,284 posts in this class',
    detail: 'Checked 3 minutes ago',
  });
});

test('singular post', () => {
  assert.equal(statusLines({ groupId: 'g', postCount: 1, refreshedAt: NOW, now: NOW }).title, '1 post in this class');
});

test('cached posts but no refresh time yet', () => {
  assert.equal(statusLines({ groupId: 'g', postCount: 5, refreshedAt: null, now: NOW }).detail, 'Not checked yet');
});

test('nothing cached yet', () => {
  assert.deepEqual(statusLines({ groupId: 'g', postCount: 0, refreshedAt: null, now: NOW }), {
    title: 'No posts loaded yet',
    detail: 'easywire loads them when the feed opens.',
  });
});

test('paused by a rate limit shows when it resumes', () => {
  const lines = statusLines({ groupId: 'g', postCount: 40, refreshedAt: NOW - MIN, pausedUntil: NOW + 8 * MIN, now: NOW });
  assert.deepEqual(lines, { title: '40 posts in this class', detail: 'Campuswire asked to slow down. Resumes in 8 minutes.' });
});

test('an expired pause is ignored', () => {
  const lines = statusLines({ groupId: 'g', postCount: 40, refreshedAt: NOW - MIN, pausedUntil: NOW - MIN, now: NOW });
  assert.equal(lines.detail, 'Checked a minute ago');
});
