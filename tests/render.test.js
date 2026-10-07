const test = require('node:test');
const assert = require('node:assert/strict');
const { postNumberFromRef, groupSlugFromPath, escapeHtml, itemHtml, sameTitle, unreadOf, ANONYMOUS_IMG, selectHtml, selectBarHtml, exportModalView, EXPORT_MODAL_HTML, dragSelection } = require('../src/render.js');

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

test("itemHtml shows Campuswire's unread dot and new-comment badge before the pin", () => {
  const view = { time: '2 days', count: null, pinned: false };
  const post = { id: 'u', number: 7, title: 't', body: 'b', likesCount: 0 };
  const html = itemHtml(post, { ...view, unread: true, badge: '3' });
  assert.ok(html.includes('class="post-preview-wrapper d-flex align-items-start ew-item unread"'));
  assert.ok(html.includes('<div class="post-preview-stats"><div class="unread-badge">3</div><button type="button" class="ew-pin'));
  assert.ok(!itemHtml(post, { ...view, unread: false, badge: '' }).includes('unread'));
});

test("unreadOf copies Campuswire's own card when it has one, else uses fetched read state and snapshot counts", () => {
  const post = { id: 'p1', read: false, conversationId: 'c1' };
  const native = new Map([['p1', { unread: false, badge: '' }]]);
  assert.deepEqual(unreadOf(post, { native, unreadCounts: { c1: 4 } }), { unread: false, badge: '' });
  assert.deepEqual(unreadOf(post, { native: new Map(), unreadCounts: { c1: 4 } }), { unread: true, badge: '4' });
  assert.deepEqual(unreadOf(post, { native: new Map(), unreadCounts: { c1: 120 } }).badge, '99+');
  assert.deepEqual(unreadOf({ id: 'p2', read: true, conversationId: '' }, { native: new Map(), unreadCounts: {} }), { unread: false, badge: '' });
  // Cached posts from before we stored `read` count as read.
  assert.equal(unreadOf({ id: 'p3' }, { native: new Map(), unreadCounts: {} }).unread, false);
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

test('itemHtml swaps the pin for a Campuswire checkbox while selecting and tints selected cards', () => {
  const post = { id: 'p9', number: 9, title: 't', body: 'b', likesCount: 0 };
  const view = { time: '2 days', count: null, pinned: true, selecting: true, selected: true };
  const html = itemHtml(post, view);
  assert.ok(!html.includes('ew-pin'));
  assert.ok(html.includes('class="post-preview-wrapper d-flex align-items-start ew-item ew-selected"'));
  assert.ok(/<\/span><\/div><div class="custom-control custom-checkbox ew-select">.*?<\/div><\/div><div class="post-preview">/.test(html)); // under the avatar
  assert.ok(!/<div class="post-preview-stats">[^]*ew-select/.test(html));
  assert.ok(html.includes('aria-label="Select post #9" checked>'));
  const unselected = itemHtml(post, { ...view, selected: false });
  assert.ok(!unselected.includes('ew-selected'));
  assert.ok(!unselected.includes(' checked'));
  assert.ok(itemHtml(post, { ...view, selecting: false }).includes('ew-pin is-pinned'));
});

test('selectHtml escapes the post id, keeps the input out of the tab order, and labels it with the post number', () => {
  const html = selectHtml({ id: 'a"b', number: 4 }, false);
  assert.ok(html.includes('data-post-id="a&quot;b" aria-label="Select post #4">'));
  assert.ok(html.includes('<label class="custom-control-label"></label>'));
  assert.ok(html.includes('tabindex="-1"'));
  assert.ok(!html.includes(' checked'));
  assert.ok(!html.includes(' id=') && !html.includes(' for='));
});

test('selectBarHtml: count, Copy label, disabled at zero, status replaces the label', () => {
  const four = selectBarHtml({ count: 4, status: '' });
  assert.ok(four.includes('<span class="ew-select-count">4 selected</span>'));
  assert.ok(four.includes('<button type="button" class="btn btn-outline ew-select-cancel">Cancel</button>'));
  assert.ok(four.includes('<button type="button" class="btn btn-primary ew-select-copy">Copy 4 posts</button>'));
  assert.ok(selectBarHtml({ count: 1, status: '' }).includes('>Copy 1 post</button>'));
  assert.ok(selectBarHtml({ count: 0, status: '' }).includes('ew-select-copy" disabled>Copy 0 posts</button>'));
  assert.ok(selectBarHtml({ count: 4, status: 'Copied 4 posts' }).includes('>Copied 4 posts</button>'));
});

test('exportModalView: count line, Export all label, and when the button is disabled', () => {
  assert.deepEqual(exportModalView({ total: 95, matching: 23, invalid: false, status: '' }), { countText: '23 of 95 posts', allLabel: 'Export all 23', allDisabled: false });
  assert.deepEqual(exportModalView({ total: 1, matching: 1, invalid: false, status: '' }), { countText: '1 of 1 post', allLabel: 'Export all 1', allDisabled: false });
  assert.deepEqual(exportModalView({ total: 95, matching: 0, invalid: false, status: '' }), { countText: '0 of 95 posts', allLabel: 'No posts in range', allDisabled: true });
  assert.deepEqual(exportModalView({ total: 95, matching: 0, invalid: true, status: '' }), { countText: 'Start date is after end date', allLabel: 'No posts in range', allDisabled: true });
  assert.deepEqual(exportModalView({ total: 95, matching: 23, invalid: false, status: 'Copied 23 posts' }), { countText: '23 of 95 posts', allLabel: 'Copied 23 posts', allDisabled: true });
});

test('the Export modal is a labelled dialog built from Campuswire modal classes', () => {
  assert.ok(EXPORT_MODAL_HTML.includes('<div class="modal-backdrop show"></div>'));
  assert.ok(EXPORT_MODAL_HTML.includes('class="modal show ew-export-modal" role="dialog" aria-modal="true" aria-labelledby="ew-export-title"'));
  assert.ok(EXPORT_MODAL_HTML.includes('aria-labelledby="ew-export-title" tabindex="-1">'));
  assert.ok(EXPORT_MODAL_HTML.includes('<h5 class="modal-title" id="ew-export-title">Export posts</h5>'));
  assert.ok(EXPORT_MODAL_HTML.includes('Published between (optional)'));
  assert.ok(EXPORT_MODAL_HTML.includes('<input type="date" class="form-control" id="ew-export-from" aria-label="From date">'));
  assert.ok(EXPORT_MODAL_HTML.includes('<input type="date" class="form-control" id="ew-export-to" aria-label="To date">'));
  assert.ok(EXPORT_MODAL_HTML.includes('aria-label="Close"'));
  assert.ok(EXPORT_MODAL_HTML.includes('<div class="ew-export-count" aria-live="polite"></div>'));
  assert.ok(EXPORT_MODAL_HTML.includes('class="btn btn-outline ew-export-select">Select posts</button><button type="button" class="btn btn-primary ew-export-all"></button>'));
  assert.ok(!/style=/.test(EXPORT_MODAL_HTML)); // Campuswire's CSP blocks inline styles
});

test('dragSelection select: base first, then range ids not already in base, in range order', () => {
  assert.deepEqual(dragSelection(['a', 'c'], ['b', 'c', 'd'], 'select'), ['a', 'c', 'b', 'd']);
});

test('dragSelection deselect: removes range ids, keeps base order', () => {
  assert.deepEqual(dragSelection(['a', 'b', 'c', 'd'], ['d', 'b'], 'deselect'), ['a', 'c']);
});

test('dragSelection: shrinking the range recomputes from the base, restoring ids outside it', () => {
  const base = ['a'];
  assert.deepEqual(dragSelection(base, ['b', 'c', 'd'], 'select'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(dragSelection(base, ['b'], 'select'), ['a', 'b']);
  const selected = ['a', 'b', 'c'];
  assert.deepEqual(dragSelection(selected, ['b', 'c'], 'deselect'), ['a']);
  assert.deepEqual(dragSelection(selected, ['b'], 'deselect'), ['a', 'c']);
});

test('dragSelection: empty range returns a copy of base; inputs are not mutated', () => {
  const base = ['a', 'b'];
  for (const mode of ['select', 'deselect']) {
    const result = dragSelection(base, [], mode);
    assert.deepEqual(result, ['a', 'b']);
    assert.notEqual(result, base);
  }
  const range = ['b', 'c'];
  dragSelection(base, range, 'select');
  dragSelection(base, range, 'deselect');
  assert.deepEqual(base, ['a', 'b']);
  assert.deepEqual(range, ['b', 'c']);
});
