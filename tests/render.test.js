const test = require('node:test');
const assert = require('node:assert/strict');
const { postNumberFromRef, groupSlugFromPath, escapeHtml, itemHtml, sameTitle, ANONYMOUS_IMG } = require('../src/render.js');

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

test('itemHtml shows the author avatar with their presence, like Campuswire cards', () => {
  const view = { time: '2 days', count: null, pinned: false, status: 'active' };
  const named = itemHtml({ id: 'p5', number: 5, title: 't', body: 'b', likesCount: 0, authorName: 'Raj "V"', authorPhoto: 'https://x/a.png' }, view);
  assert.ok(
    named.includes(
      'ew-item" data-number="5"><div title="Raj &quot;V&quot;"><div class="user-img-wrap"><div class="img-wrap"><img alt="Raj &quot;V&quot;" src="https://x/a.png"></div><span class="user-status online"></span></div></div><div class="post-preview">'
    )
  );
  const away = itemHtml({ id: 'p7', number: 7, title: 't', body: 'b', likesCount: 0, authorName: 'A', authorPhoto: 'https://x/a.png' }, { ...view, status: 'away' });
  assert.ok(away.includes('<span class="user-status away"></span>'));
  const unknown = itemHtml({ id: 'p8', number: 8, title: 't', body: 'b', likesCount: 0, authorName: 'A', authorPhoto: 'https://x/a.png' }, { ...view, status: undefined });
  assert.ok(unknown.includes('<span class="user-status offline"></span>'));
});

test("itemHtml shows Campuswire's anonymous icon for anonymous posts", () => {
  const view = { time: '2 days', count: null, pinned: false };
  const anonymous = itemHtml({ id: 'p6', number: 6, title: 't', body: 'b', likesCount: 0, authorName: '', authorPhoto: '' }, view);
  assert.ok(
    anonymous.includes(
      `<div title="Anonymous"><div class="user-img-wrap"><div class="img-wrap"><img alt="Anonymous user" src="${ANONYMOUS_IMG}"></div><span class="user-status offline"></span></div></div>`
    )
  );
});

test('itemHtml marks unread posts like Campuswire, and treats a missing read flag as read', () => {
  const view = { time: '2 days', count: null, pinned: false };
  const base = { id: 'u', number: 7, title: 't', body: 'b', likesCount: 0 };
  assert.ok(itemHtml({ ...base, read: false }, view).includes('class="post-preview-wrapper d-flex align-items-start ew-item unread"'));
  assert.ok(!itemHtml({ ...base, read: true }, view).includes('unread'));
  assert.ok(!itemHtml(base, view).includes('unread'));
});

test('itemHtml shows the same type icon as Campuswire: pen for notes, check for resolved questions', () => {
  const view = { time: '2 days', count: null, pinned: false };
  const note = itemHtml({ id: 'n', number: 1, title: 't', body: 'b', likesCount: 0, answered: false, note: true }, view);
  assert.ok(note.includes('<div class="post-type-icon" title="This is a note"><i class="fas fa-pen"></i></div>'));
  const resolved = itemHtml({ id: 'q', number: 2, title: 't', body: 'b', likesCount: 0, answered: true, note: false }, view);
  assert.ok(resolved.includes('<div class="post-type-icon" title="This question is resolved"><i class="fas fa-check"></i></div>'));
  const open = itemHtml({ id: 'o', number: 3, title: 't', body: 'b', likesCount: 0, answered: false, note: false }, view);
  assert.ok(!open.includes('post-type-icon'));
});
