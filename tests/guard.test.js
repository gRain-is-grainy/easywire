const test = require('node:test');
const assert = require('node:assert/strict');
const { isApiUrl, isAllowedRequest, feedGroupId } = require('../src/guard.js');

const G = 'bc3cc03c-63d5-4d16-8574-398aef054b15';
const P = '685787e7-5e96-4a2c-9a7f-a2cb43b8ef9a';
const BASE = `https://api.campuswire.com/v1/group/${G}`;

test('allows GET feed pages and comments', () => {
  assert.equal(isAllowedRequest('GET', `${BASE}/posts?number=20`), true);
  assert.equal(isAllowedRequest('get', `${BASE}/posts?number=20&before=2026-09-18T16%3A20%3A33.378933Z`), true);
  assert.equal(isAllowedRequest('GET', `${BASE}/posts/${P}/comments`), true);
});

test('refuses every non-GET method', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
    assert.equal(isAllowedRequest(method, `${BASE}/posts?number=20`), false, method);
  }
});

test('refuses other endpoints, hosts, schemes, and path tricks', () => {
  const bad = [
    `${BASE}/posts/${P}/viewed`,
    `${BASE}/posts/${P}`,
    `${BASE}/wall/pinned`,
    'https://api.campuswire.com/v1/user/notifications',
    `https://api.campuswire.com.evil.com/v1/group/${G}/posts?number=20`,
    `http://api.campuswire.com/v1/group/${G}/posts?number=20`,
    'https://api.campuswire.com/v1/group/../posts/../comments',
    `${BASE}/posts/${P}/comments/extra`,
    `${BASE}/posts#frag`,
    `${BASE}/posts`,
    `${BASE}/posts?number=20&_method=DELETE`,
    `${BASE}/posts?_method=DELETE&number=20`,
    `${BASE}/posts?number=20&before=x&y=1`,
  ];
  for (const url of bad) assert.equal(isAllowedRequest('GET', url), false, url);
});

test('isApiUrl', () => {
  assert.equal(isApiUrl(`${BASE}/posts`), true);
  assert.equal(isApiUrl('https://api.campuswire.com.evil.com/v1'), false);
  assert.equal(isApiUrl('https://campuswire.com/c/X/feed'), false);
});

test('feedGroupId: only first-page feed requests', () => {
  assert.equal(feedGroupId(`${BASE}/posts?number=20`), G);
  assert.equal(feedGroupId(`${BASE}/posts`), G);
  assert.equal(feedGroupId(`${BASE}/posts?number=20&before=2026-09-18T16:20:33.378933Z`), null);
  assert.equal(feedGroupId(`${BASE}/posts?category=unread&number=20`), null);
  assert.equal(feedGroupId(`${BASE}/posts/${P}/comments`), null);
  assert.equal(feedGroupId('https://evil.com/v1/group/x/posts'), null);
});
