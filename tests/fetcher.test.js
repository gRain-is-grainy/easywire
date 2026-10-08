const test = require('node:test');
const assert = require('node:assert/strict');
const { createFetcher } = require('../src/fetcher.js');

const G = 'g1';

// Newest first, like Campuswire. number n..1, one hour apart.
function makePosts(n) {
  return Array.from({ length: n }, (_, i) => {
    const number = n - i;
    return {
      id: `p${number}`,
      number,
      title: `T${number}`,
      body: `B${number}`,
      publishedAt: new Date(Date.UTC(2026, 8, 1) + number * 3600000).toISOString(),
      likesCount: 0,
    };
  });
}

function slim(p) {
  return { id: p.id, number: p.number, title: p.title, body: p.body, publishedAt: p.publishedAt, likesCount: 0, answered: false, note: false, read: false, conversationId: '', authorId: '', authorName: '', authorPhoto: '' };
}

// status: { urlSubstring: httpStatus } forces failures.
function fakeApi({ posts, comments = {}, status = {}, delay = 0 }) {
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  async function request(url) {
    calls.push(url);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await new Promise((resolve) => setTimeout(resolve, delay));
      for (const [needle, code] of Object.entries(status)) {
        if (url.includes(needle)) return { ok: false, status: code, data: null };
      }
      const commentMatch = /\/posts\/([^/]+)\/comments$/.exec(url);
      if (commentMatch) return { ok: true, status: 200, data: comments[commentMatch[1]] || [] };
      const u = new URL(url);
      const before = u.searchParams.get('before');
      const page = posts.filter((p) => !before || p.publishedAt < before).slice(0, Number(u.searchParams.get('number')));
      return { ok: true, status: 200, data: page };
    } finally {
      inFlight--;
    }
  }
  return { request, calls, maxInFlight: () => maxInFlight };
}

function fakeStorage(initial = {}) {
  const data = structuredClone(initial);
  return {
    data,
    async get(key) {
      return key in data ? { [key]: structuredClone(data[key]) } : {};
    },
    async set(obj) {
      Object.assign(data, structuredClone(obj));
    },
  };
}

const commentUrls = (api) => api.calls.filter((u) => u.endsWith('/comments'));
const listUrls = (api) => api.calls.filter((u) => !u.endsWith('/comments'));

test('pages through every post with before= and summarizes each', async () => {
  const posts = makePosts(45);
  const api = fakeApi({
    posts,
    comments: { p45: [{ createdAt: '2026-09-10T00:00:00Z' }, { createdAt: '2026-09-09T00:00:00Z' }] },
  });
  const fetcher = createFetcher({ request: api.request, storage: fakeStorage() });

  assert.deepEqual(await fetcher.refresh(G, () => {}), { complete: true, paused: false });

  const lists = listUrls(api);
  assert.equal(lists.length, 4); // 20 + 20 + 5, then an empty page ends it
  assert.equal(lists[0], `https://api.campuswire.com/v1/group/${G}/posts?number=20`);
  assert.ok(lists[1].endsWith(`&before=${encodeURIComponent(posts[19].publishedAt)}`));
  assert.equal(commentUrls(api).length, 45);

  const cache = await fetcher.load(G);
  assert.equal(cache.posts.length, 45);
  assert.deepEqual(cache.posts[0], slim(posts[0]));
  assert.deepEqual(cache.summaries.p45, { replyCount: 2, lastActivityAt: '2026-09-10T00:00:00.000Z' });
  assert.equal(cache.summaries.p1.replyCount, 0);
});

test('slim posts truncate body and record answered', async () => {
  const [post] = makePosts(1);
  post.body = 'x'.repeat(500);
  post.answeredAt = '2026-09-02T00:00:00Z';
  post.likesCount = 4;
  const fetcher = createFetcher({ request: fakeApi({ posts: [post] }).request, storage: fakeStorage() });
  await fetcher.refresh(G, () => {});
  const [cached] = (await fetcher.load(G)).posts;
  assert.equal(cached.body.length, 200);
  assert.equal(cached.answered, true);
  assert.equal(cached.likesCount, 4);
});

test('never runs more than 3 comment requests at once', async () => {
  const api = fakeApi({ posts: makePosts(10), delay: 5 });
  await createFetcher({ request: api.request, storage: fakeStorage() }).refresh(G, () => {});
  assert.equal(api.maxInFlight(), 3);
});

test('a failed comments request keeps the cached summary', async () => {
  const posts = makePosts(2);
  const old = { replyCount: 7, lastActivityAt: '2026-09-05T00:00:00.000Z' };
  const storage = fakeStorage({ [`cache:${G}`]: { posts: posts.map(slim), summaries: { p2: old } } });
  const api = fakeApi({ posts, status: { 'posts/p2/comments': 500 } });
  const fetcher = createFetcher({ request: api.request, storage });

  assert.deepEqual(await fetcher.refresh(G, () => {}), { complete: true, paused: false });
  const cache = await fetcher.load(G);
  assert.deepEqual(cache.summaries.p2, old);
  assert.equal(cache.summaries.p1.replyCount, 0);
});

test('429 on comments pauses: no further comment requests, partial results saved', async () => {
  const api = fakeApi({ posts: makePosts(10), status: { 'posts/p10/comments': 429 } });
  const fetcher = createFetcher({ request: api.request, storage: fakeStorage() });

  assert.deepEqual(await fetcher.refresh(G, () => {}), { complete: true, paused: true });
  assert.ok(commentUrls(api).length <= 3, `made ${commentUrls(api).length} comment requests`);
  assert.equal((await fetcher.load(G)).posts.length, 10);
});

test('post-list failure: incomplete, paused on 401, cache untouched', async () => {
  const posts = makePosts(3);
  const initial = { posts: posts.map(slim), summaries: { p1: { replyCount: 1, lastActivityAt: '2026-09-02T00:00:00.000Z' } } };
  const storage = fakeStorage({ [`cache:${G}`]: initial });
  const api = fakeApi({ posts, status: { '?number=': 401 } });
  const fetcher = createFetcher({ request: api.request, storage });

  assert.deepEqual(await fetcher.refresh(G, () => {}), { complete: false, paused: true });
  assert.deepEqual(await fetcher.load(G), initial);
  assert.equal(commentUrls(api).length, 0);
});

test('post-list 500 is incomplete but not paused', async () => {
  const api = fakeApi({ posts: makePosts(3), status: { '?number=': 500 } });
  const fetcher = createFetcher({ request: api.request, storage: fakeStorage() });
  assert.deepEqual(await fetcher.refresh(G, () => {}), { complete: false, paused: false });
});

test('deleted posts drop out of the cache', async () => {
  const posts = makePosts(2);
  const gone = { ...slim(posts[0]), id: 'gone', number: 99 };
  const storage = fakeStorage({
    [`cache:${G}`]: { posts: [gone], summaries: { gone: { replyCount: 3, lastActivityAt: '2026-09-02T00:00:00.000Z' } } },
  });
  const fetcher = createFetcher({ request: fakeApi({ posts }).request, storage });
  await fetcher.refresh(G, () => {});
  const cache = await fetcher.load(G);
  assert.deepEqual(cache.posts.map((p) => p.id), ['p2', 'p1']);
  assert.equal(cache.summaries.gone, undefined);
});

test('onUpdate first receives the cached data, then fresh data', async () => {
  const posts = makePosts(1);
  const initial = { posts: [], summaries: {} };
  const seen = [];
  const fetcher = createFetcher({ request: fakeApi({ posts }).request, storage: fakeStorage({ [`cache:${G}`]: initial }) });
  await fetcher.refresh(G, (cache) => seen.push(structuredClone(cache)));
  assert.deepEqual(seen[0], initial);
  assert.equal(seen.at(-1).summaries.p1.replyCount, 0);
});

test('load returns an empty cache for an unknown group', async () => {
  const fetcher = createFetcher({ request: async () => ({ ok: false, status: 0 }), storage: fakeStorage() });
  assert.deepEqual(await fetcher.load('nope'), { posts: [], summaries: {} });
});

test('malformed first page (data not an array) is incomplete, cache untouched', async () => {
  const storage = fakeStorage();
  const request = async () => ({ ok: true, status: 200, data: { posts: [] } });
  const fetcher = createFetcher({ request, storage });

  assert.deepEqual(await fetcher.refresh(G, () => {}), { complete: false, paused: false });
  assert.deepEqual(await fetcher.load(G), { posts: [], summaries: {} });
});

test('malformed page 2 of 45 posts is incomplete, cache untouched', async () => {
  const posts = makePosts(45);
  const storage = fakeStorage();
  const request = async (url) => {
    const u = new URL(url);
    if (u.searchParams.get('before')) return { ok: true, status: 200, data: { posts: [] } };
    const page = posts.slice(0, Number(u.searchParams.get('number')));
    return { ok: true, status: 200, data: page };
  };
  const fetcher = createFetcher({ request, storage });

  assert.deepEqual(await fetcher.refresh(G, () => {}), { complete: false, paused: false });
  assert.deepEqual(await fetcher.load(G), { posts: [], summaries: {} });
});

test('de-dupes when before= is inclusive (boundary post repeated across pages)', async () => {
  const posts = makePosts(25);
  const request = async (url) => {
    const u = new URL(url);
    const before = u.searchParams.get('before');
    const page = posts.filter((p) => !before || p.publishedAt <= before).slice(0, Number(u.searchParams.get('number')));
    return { ok: true, status: 200, data: page };
  };
  const fetcher = createFetcher({ request, storage: fakeStorage() });

  assert.deepEqual(await fetcher.refresh(G, () => {}), { complete: true, paused: false });
  const cache = await fetcher.load(G);
  assert.equal(cache.posts.length, 25);
  assert.equal(new Set(cache.posts.map((p) => p.id)).size, 25);
});

test('a newer refresh makes the running one stale (class switch mid-fetch)', async () => {
  const api = fakeApi({ posts: makePosts(10), delay: 2 });
  const fetcher = createFetcher({ request: api.request, storage: fakeStorage() });
  let oldUpdates = 0;
  let newer;
  const older = fetcher.refresh('old', () => {
    oldUpdates++;
    // Second update = post list done; switch class now, before comments finish.
    if (oldUpdates === 2) newer = fetcher.refresh('new', () => {});
  });
  assert.deepEqual(await older, { stale: true });
  assert.deepEqual(await newer, { complete: true, paused: false });
  assert.equal(oldUpdates, 2);
});

test('a same-group refresh while one is running is ignored and keeps its progress', async () => {
  const api = fakeApi({ posts: makePosts(10), delay: 2 });
  let t = 0;
  const fetcher = createFetcher({ request: api.request, storage: fakeStorage(), now: () => t });
  let second;
  let secondUpdates = 0;
  let firstUpdates = 0;
  const first = fetcher.refresh(G, () => {
    if (++firstUpdates === 5) {
      t = 61000;
      second = fetcher.refresh(G, () => secondUpdates++);
    }
  });
  assert.deepEqual(await first, { complete: true, paused: false });
  assert.deepEqual(await second, { busy: true });
  assert.equal(secondUpdates, 0);
  assert.equal(commentUrls(api).length, 10);
});

test('summaries are saved during the comments pass, not only at the end', async () => {
  const storage = fakeStorage();
  let savedMidRun = null;
  const fetcher = createFetcher({ request: fakeApi({ posts: makePosts(45) }).request, storage });
  await fetcher.refresh(G, (cache) => {
    if (Object.keys(cache.summaries).length === 25) {
      savedMidRun = Object.keys(storage.data[`cache:${G}`].summaries).length;
    }
  });
  assert.ok(savedMidRun >= 20, `saved ${savedMidRun} summaries by the 25th`);
});

test('a refresh within 60 s of the last one, even after a reload, shows cache without fetching', async () => {
  const storage = fakeStorage();
  let t = 0;
  const now = () => t;
  const api = fakeApi({ posts: makePosts(3) });
  await createFetcher({ request: api.request, storage, now }).refresh(G, () => {});
  const calls = api.calls.length;

  t = 30000;
  const seen = [];
  const reloaded = createFetcher({ request: api.request, storage, now });
  assert.deepEqual(await reloaded.refresh(G, (c) => seen.push(c)), { complete: false, paused: false });
  assert.equal(api.calls.length, calls);
  assert.equal(seen[0].posts.length, 3);

  t = 61000;
  assert.deepEqual(await reloaded.refresh(G, () => {}), { complete: true, paused: false });
  assert.ok(api.calls.length > calls);
});

test('a 401/429 pause persists across reloads for 10 minutes', async () => {
  const storage = fakeStorage();
  let t = 0;
  const now = () => t;
  const failing = fakeApi({ posts: makePosts(3), status: { '?number=': 429 } });
  assert.deepEqual(await createFetcher({ request: failing.request, storage, now }).refresh(G, () => {}), {
    complete: false,
    paused: true,
  });

  const api = fakeApi({ posts: makePosts(3) });
  t = 5 * 60000;
  assert.deepEqual(await createFetcher({ request: api.request, storage, now }).refresh('other', () => {}), {
    complete: false,
    paused: true,
  });
  assert.equal(api.calls.length, 0);

  t = 11 * 60000;
  assert.deepEqual(await createFetcher({ request: api.request, storage, now }).refresh(G, () => {}), {
    complete: true,
    paused: false,
  });
});

test('an empty first page when posts are cached is incomplete and keeps the cache', async () => {
  const initial = { posts: makePosts(3).map(slim), summaries: {} };
  const storage = fakeStorage({ [`cache:${G}`]: initial });
  const request = async () => ({ ok: true, status: 200, data: [] });
  const fetcher = createFetcher({ request, storage });
  assert.deepEqual(await fetcher.refresh(G, () => {}), { complete: false, paused: false });
  assert.deepEqual(await fetcher.load(G), initial);
});

test('keeps paging when the server returns fewer posts per page than asked', async () => {
  const posts = makePosts(45);
  const request = async (url) => {
    const u = new URL(url);
    const before = u.searchParams.get('before');
    return { ok: true, status: 200, data: posts.filter((p) => !before || p.publishedAt < before).slice(0, 15) };
  };
  const fetcher = createFetcher({ request, storage: fakeStorage() });
  assert.deepEqual(await fetcher.refresh(G, () => {}), { complete: true, paused: false });
  assert.equal((await fetcher.load(G)).posts.length, 45);
});

test('a crawl abandoned by a class switch does not throttle returning to that class', async () => {
  const api = fakeApi({ posts: makePosts(10), delay: 2 });
  const fetcher = createFetcher({ request: api.request, storage: fakeStorage() });
  let updates = 0;
  let toB;
  const firstA = fetcher.refresh('A', () => {
    if (++updates === 2) toB = fetcher.refresh('B', () => {});
  });
  assert.deepEqual(await firstA, { stale: true });
  await toB;
  assert.deepEqual(await fetcher.refresh('A', () => {}), { complete: true, paused: false });
});

test('cancel stops a running crawl and does not throttle the next refresh', async () => {
  const api = fakeApi({ posts: makePosts(10), delay: 2 });
  const fetcher = createFetcher({ request: api.request, storage: fakeStorage() });
  let updates = 0;
  const running = fetcher.refresh(G, () => {
    if (++updates === 2) fetcher.cancel();
  });
  assert.deepEqual(await running, { stale: true });
  assert.ok(commentUrls(api).length < 10);
  assert.deepEqual(await fetcher.refresh(G, () => {}), { complete: true, paused: false });
});

test('slim posts record whether a post is a note', async () => {
  const [note, question] = makePosts(2);
  note.type = 'note';
  question.type = 'question';
  const fetcher = createFetcher({ request: fakeApi({ posts: [note, question] }).request, storage: fakeStorage() });
  await fetcher.refresh(G, () => {});
  const [a, b] = (await fetcher.load(G)).posts;
  assert.equal(a.note, true);
  assert.equal(b.note, false);
});

test('slim posts record read state, conversation and author id, name and photo', async () => {
  const [named, anonymous] = makePosts(2);
  named.read = true;
  named.conversationId = 'c1';
  named.author = { id: 'u1', firstName: 'Raj', lastName: 'Venkat', photo: 'https://files.campuswire.com/avatars/r.png' };
  anonymous.author = {};
  const fetcher = createFetcher({ request: fakeApi({ posts: [named, anonymous] }).request, storage: fakeStorage() });
  await fetcher.refresh(G, () => {});
  const [a, b] = (await fetcher.load(G)).posts;
  assert.equal(a.read, true);
  assert.equal(a.conversationId, 'c1');
  assert.equal(a.authorId, 'u1');
  assert.equal(a.authorName, 'Raj Venkat');
  assert.equal(a.authorPhoto, 'https://files.campuswire.com/avatars/r.png');
  assert.equal(b.read, false); // Campuswire leaves `read` unset on unread posts
  assert.equal(b.conversationId, '');
  assert.equal(b.authorId, '');
  assert.equal(b.authorName, '');
  assert.equal(b.authorPhoto, '');
});

test('stores each full thread separately from the cache, for export', async () => {
  const [post] = makePosts(1);
  post.body = 'x'.repeat(500);
  const comments = {
    p1: [
      { depth: 1, answer: true, author: { firstName: 'Raj', lastName: 'Venkat' }, createdAt: '2026-09-10T00:00:00Z', body: 'Yes.' },
      { depth: 2, body: 'Thanks', createdAt: '2026-09-11T00:00:00Z' }, // anonymous: no author
    ],
  };
  const storage = fakeStorage();
  const fetcher = createFetcher({ request: fakeApi({ posts: [post], comments }).request, storage });
  await fetcher.refresh(G, () => {});

  assert.deepEqual(await fetcher.loadThreads(G), {
    p1: {
      body: 'x'.repeat(500),
      comments: [
        { depth: 1, answer: true, authorName: 'Raj Venkat', createdAt: '2026-09-10T00:00:00Z', body: 'Yes.' },
        { depth: 2, answer: false, authorName: '', createdAt: '2026-09-11T00:00:00Z', body: 'Thanks' },
      ],
    },
  });
  assert.deepEqual(Object.keys(storage.data[`cache:${G}`]), ['posts', 'summaries']);
});

test('a failed comments request keeps the cached thread; deleted posts lose theirs', async () => {
  const posts = makePosts(2);
  const old = { body: 'old', comments: [] };
  const storage = fakeStorage({ [`threads:${G}`]: { p2: old, gone: old } });
  const api = fakeApi({ posts, status: { 'posts/p2/comments': 500 } });
  await createFetcher({ request: api.request, storage }).refresh(G, () => {});

  assert.deepEqual(await createFetcher({ request: api.request, storage }).loadThreads(G), {
    p2: old,
    p1: { body: 'B1', comments: [] },
  });
});

test('loadThreads is empty for a class never crawled', async () => {
  const fetcher = createFetcher({ request: fakeApi({ posts: [] }).request, storage: fakeStorage() });
  assert.deepEqual(await fetcher.loadThreads(G), {});
});

test('remove drops a post from the stored cache and threads', async () => {
  const posts = makePosts(2);
  const storage = fakeStorage();
  const fetcher = createFetcher({ request: fakeApi({ posts }).request, storage });
  await fetcher.refresh(G, () => {});
  await fetcher.remove(G, 'p2');
  const cache = await fetcher.load(G);
  assert.deepEqual(cache.posts.map((p) => p.id), ['p1']);
  assert.equal(cache.summaries.p2, undefined);
  assert.deepEqual(Object.keys(await fetcher.loadThreads(G)), ['p1']);
});

test('a post removed during a crawl does not come back when the crawl saves', async () => {
  const posts = makePosts(3);
  const storage = fakeStorage();
  const fetcher = createFetcher({ request: fakeApi({ posts, delay: 5 }).request, storage, concurrency: 1 });
  const seen = [];
  let removing = null;
  const done = fetcher.refresh(G, (cache) => {
    seen.push(cache.posts.map((p) => p.id));
    if (cache.posts.length && !removing) removing = fetcher.remove(G, 'p2');
  });
  await done;
  await removing;
  assert.deepEqual((await fetcher.load(G)).posts.map((p) => p.id), ['p3', 'p1']);
  assert.equal((await fetcher.load(G)).summaries.p2, undefined);
  assert.equal((await fetcher.loadThreads(G)).p2, undefined);
  assert.ok(!seen.at(-1).includes('p2'));
});

test('upsertPost adds a newly published post from the socket, unread and with no replies', async () => {
  const fetcher = createFetcher({ request: fakeApi({ posts: makePosts(2) }).request, storage: fakeStorage() });
  await fetcher.refresh(G, () => {});
  const raw = {
    id: 'p3',
    number: 3,
    title: 'T3',
    body: 'Hello',
    publishedAt: '2026-10-08T00:00:00.000Z',
    conversation: { id: 'conv3' }, // the socket nests it; the post list gives conversationId
    author: { id: 'u1', firstName: 'A', lastName: 'B', photo: 'x.png' },
  };
  const cache = await fetcher.upsertPost(G, raw);
  assert.deepEqual(cache.posts.map((p) => p.id), ['p3', 'p2', 'p1']);
  assert.equal(cache.posts[0].conversationId, 'conv3');
  assert.equal(cache.posts[0].read, false);
  assert.equal(cache.posts[0].authorName, 'A B');
  assert.deepEqual(cache.summaries.p3, { replyCount: 0, lastActivityAt: '2026-10-08T00:00:00.000Z' });
  assert.deepEqual((await fetcher.loadThreads(G)).p3, { body: 'Hello', comments: [] });
  assert.deepEqual(await fetcher.load(G), cache);
});

test('upsertPost takes an edited title and body but keeps the rest of a known post', async () => {
  const fetcher = createFetcher({ request: fakeApi({ posts: makePosts(2) }).request, storage: fakeStorage() });
  await fetcher.refresh(G, () => {});
  const cache = await fetcher.upsertPost(G, { id: 'p2', title: 'Edited', body: 'New body' });
  assert.deepEqual(cache.posts[0], { ...slim(makePosts(2)[0]), title: 'Edited', body: 'New body' });
  assert.equal((await fetcher.loadThreads(G)).p2.body, 'New body');
  const titleOnly = await fetcher.upsertPost(G, { id: 'p1', title: 'Only title' });
  assert.equal(titleOnly.posts[1].title, 'Only title');
  assert.equal(titleOnly.posts[1].body, 'B1');
});

test('upsertPost ignores drafts, partial posts it never saw and posts already deleted', async () => {
  const fetcher = createFetcher({ request: fakeApi({ posts: makePosts(1) }).request, storage: fakeStorage() });
  await fetcher.refresh(G, () => {});
  const full = { number: 5, title: 'T', publishedAt: '2026-10-08T00:00:00.000Z' };
  assert.equal(await fetcher.upsertPost(G, { ...full, id: 'd1', draft: true }), null);
  assert.equal(await fetcher.upsertPost(G, { ...full, id: 'd2', publishedAt: null }), null);
  assert.equal(await fetcher.upsertPost(G, { id: 'd3', title: 'partial update' }), null);
  await fetcher.remove(G, 'gone');
  assert.equal(await fetcher.upsertPost(G, { ...full, id: 'gone' }), null);
  assert.deepEqual((await fetcher.load(G)).posts.map((p) => p.id), ['p1']);
});

test('patchPost changes read or resolved state of a known post only', async () => {
  const fetcher = createFetcher({ request: fakeApi({ posts: makePosts(1) }).request, storage: fakeStorage() });
  await fetcher.refresh(G, () => {});
  const cache = await fetcher.patchPost(G, 'p1', { read: true, answered: true });
  assert.equal(cache.posts[0].read, true);
  assert.equal(cache.posts[0].answered, true);
  assert.equal((await fetcher.load(G)).posts[0].answered, true);
  assert.equal(await fetcher.patchPost(G, 'nope', { read: true }), null);
});

test('refreshComments re-reads one post and updates its summary and thread', async () => {
  const comments = {};
  const api = fakeApi({ posts: makePosts(2), comments });
  const fetcher = createFetcher({ request: api.request, storage: fakeStorage() });
  await fetcher.refresh(G, () => {});
  comments.p1 = [{ createdAt: '2026-10-08T00:00:00.000Z', body: 'late reply', author: { firstName: 'T', lastName: 'A' } }];
  const before = api.calls.length;
  const cache = await fetcher.refreshComments(G, 'p1');
  assert.deepEqual(api.calls.slice(before), [`https://api.campuswire.com/v1/group/${G}/posts/p1/comments`]);
  assert.deepEqual(cache.summaries.p1, { replyCount: 1, lastActivityAt: '2026-10-08T00:00:00.000Z' });
  const thread = (await fetcher.loadThreads(G)).p1;
  assert.equal(thread.body, 'B1');
  assert.equal(thread.comments[0].body, 'late reply');
});

test('refreshComments makes no request while paused and pauses on 429', async () => {
  const api = fakeApi({ posts: makePosts(1), status: { '/p1/comments': 429 } });
  const storage = fakeStorage();
  const fetcher = createFetcher({ request: api.request, storage, now: () => 0 });
  await fetcher.refresh(G, () => {}); // its 429 pauses
  const before = api.calls.length;
  assert.equal(await fetcher.refreshComments(G, 'p1'), null);
  assert.equal(api.calls.length, before);
  storage.data.pausedUntil = null;
  assert.equal(await fetcher.refreshComments(G, 'p1'), null);
  assert.equal(api.calls.length, before + 1);
  assert.ok(storage.data.pausedUntil > 0);
});

test('live updates during a crawl land in what the crawl saves', async () => {
  const storage = fakeStorage();
  const fetcher = createFetcher({ request: fakeApi({ posts: makePosts(3), delay: 5 }).request, storage, concurrency: 1 });
  let live = null;
  const done = fetcher.refresh(G, (cache) => {
    if (cache.posts.length && !live) live = fetcher.upsertPost(G, { id: 'p9', number: 9, title: 'T9', publishedAt: '2026-10-08T00:00:00.000Z' });
  });
  await done;
  await live;
  assert.deepEqual((await fetcher.load(G)).posts.map((p) => p.id), ['p9', 'p3', 'p2', 'p1']);
  assert.ok((await fetcher.loadThreads(G)).p9);
});
