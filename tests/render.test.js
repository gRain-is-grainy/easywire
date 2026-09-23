const test = require('node:test');
const assert = require('node:assert/strict');
const { postNumberFromRef, groupSlugFromPath, escapeHtml, itemHtml, sameTitle } = require('../src/render.js');

test('postNumberFromRef', () => {
  assert.equal(postNumberFromRef('#40'), 40);
  assert.equal(postNumberFromRef(' #7 '), 7);
  assert.equal(postNumberFromRef(''), null);
  assert.equal(postNumberFromRef(undefined), null);
  assert.equal(postNumberFromRef('abc'), null);
});

test('groupSlugFromPath', () => {
  assert.equal(groupSlugFromPath('/c/GBC3CC03C/feed/39'), 'GBC3CC03C');
  assert.equal(groupSlugFromPath('/c/GBC3CC03C/feed'), 'GBC3CC03C');
  assert.equal(groupSlugFromPath('/signin'), null);
});

test('escapeHtml', () => {
  assert.equal(escapeHtml(`<img src=x onerror="a">&'`), '&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;');
});

test('itemHtml escapes Campuswire text and renders time, count, pin', () => {
  const html = itemHtml(
    { id: 'p"1', number: 12, title: '<b>hi</b>', body: '<script>x()</script>', likesCount: 3, answered: true },
    { time: 'a day', count: 5, pinned: true }
  );
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<b>'));
  assert.ok(html.includes('&lt;b&gt;hi&lt;/b&gt;'));
  assert.ok(html.includes('data-number="12"'));
  assert.ok(html.includes('data-post-id="p&quot;1"'));
  assert.ok(html.includes('#12'));
  assert.ok(html.includes('a day'));
  assert.ok(html.includes('fa-comment'));
  assert.ok(html.includes('<span>5</span>'));
  assert.ok(html.includes('is-pinned'));
  assert.ok(html.includes('fa-check'));
});

test('itemHtml without count or pin or answer', () => {
  const html = itemHtml(
    { id: 'p2', number: 2, title: 't', body: 'b', likesCount: 0, answered: false },
    { time: '2 days', count: null, pinned: false }
  );
  assert.ok(!html.includes('fa-comment'));
  assert.ok(!html.includes('is-pinned'));
  assert.ok(!html.includes('fa-check'));
});

test('sameTitle: ignores surrounding and repeated whitespace, rejects other titles', () => {
  assert.equal(sameTitle('  HW 3   question ', 'HW 3 question'), true);
  assert.equal(sameTitle('HW 3 question', 'Exam logistics'), false);
  assert.equal(sameTitle('', 'Exam logistics'), false);
});

test('itemHtml puts the pin in the footer stats, not the title row', () => {
  const html = itemHtml(
    { id: 'p3', number: 3, title: 't', body: 'b', likesCount: 0, answered: false },
    { time: '2 days', count: 1, pinned: false }
  );
  const title = /<div class="post-title[^"]*">.*?<\/div>/.exec(html)[0];
  const stats = /<div class="post-preview-stats">.*?<\/div>/.exec(html)[0];
  assert.ok(!title.includes('ew-pin'));
  assert.ok(stats.includes('ew-pin'));
});

test('itemHtml puts the reply count right after the time', () => {
  const html = itemHtml(
    { id: 'p4', number: 4, title: 't', body: 'b', likesCount: 0, answered: true },
    { time: '2 days', count: 7, pinned: false }
  );
  assert.ok(/2 days<span class="ew-count">.*?<span>7<\/span><\/span><\/div>/.test(html));
});
