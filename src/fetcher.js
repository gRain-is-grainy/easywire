(function (root) {
  const { summarize } = typeof module === 'object' && module.exports ? require('./activity.js') : root.EasywireActivity;
  const API = 'https://api.campuswire.com/v1/group/';
  const PAUSE_STATUSES = [401, 429];

  function slim(post) {
    const author = post.author || {}; // {} for anonymous posts
    return {
      id: post.id,
      number: post.number,
      title: post.title || '',
      body: String(post.body || '').slice(0, 200),
      publishedAt: post.publishedAt,
      likesCount: post.likesCount || 0,
      answered: Boolean(post.answeredAt),
      note: post.type === 'note',
      read: Boolean(post.read), // Campuswire leaves `read` unset on unread posts
      conversationId: post.conversationId || (post.conversation && post.conversation.id) || '', // keys Campuswire's unread-comment counts; socket posts nest it
      authorId: author.id || '',
      authorName: [author.firstName, author.lastName].filter(Boolean).join(' '),
      authorPhoto: author.photo || '',
    };
  }

  const fullName = (author) => [author && author.firstName, author && author.lastName].filter(Boolean).join(' ');

  // Full post text and replies, kept apart from the cache so rendering never loads them; read only by export.
  function thread(post, comments) {
    return {
      body: String(post.body || ''),
      comments: comments.map((comment) => ({
        depth: comment.depth || 1,
        answer: Boolean(comment.answer),
        authorName: fullName(comment.author),
        createdAt: comment.createdAt,
        body: String(comment.body || ''),
      })),
    };
  }

  // Throttle and pause live in storage so they survive page reloads (e.g. opening a post via location.assign).
  function createFetcher({
    request,
    storage,
    concurrency = 3,
    pageSize = 20,
    now = Date.now,
    minRefreshMs = 60 * 1000,
    pauseMs = 10 * 60 * 1000,
  }) {
    let generation = 0;
    let runningGroupId = null;
    let crawling = null; // the running crawl's cache and threads, so live updates land in what it saves
    const removed = new Set(); // posts Campuswire said were deleted; a running crawl may have fetched them already
    const keyFor = (groupId) => `cache:${groupId}`;
    const refreshedKey = (groupId) => `refreshedAt:${groupId}`;
    const threadsKey = (groupId) => `threads:${groupId}`;

    async function read(key) {
      return (await storage.get(key))[key];
    }

    async function load(groupId) {
      return (await read(keyFor(groupId))) || { posts: [], summaries: {} };
    }

    async function loadThreads(groupId) {
      return (await read(threadsKey(groupId))) || {};
    }

    function save(groupId, cache, threads) {
      return storage.set({ [keyFor(groupId)]: cache, [threadsKey(groupId)]: threads });
    }

    async function fetchAllPosts(groupId, isStale) {
      const posts = [];
      const seen = new Set();
      let before = null;
      while (!isStale()) {
        let url = `${API}${groupId}/posts?number=${pageSize}`;
        if (before) url += `&before=${encodeURIComponent(before)}`;
        const response = await request(url);
        if (!response.ok) return { ok: false, status: response.status };
        if (!Array.isArray(response.data)) return { ok: false, status: 0 };
        const page = response.data;
        for (const post of page) {
          if (seen.has(post.id)) continue;
          seen.add(post.id);
          posts.push(post);
        }
        // Stop on an empty page or one that doesn't move `before`; don't trust the server to return full pages.
        const last = page[page.length - 1];
        if (!last || last.publishedAt === before) return { ok: true, posts };
        before = last.publishedAt;
      }
      return { ok: false, status: 0 };
    }

    // A refresh for the group that is already being fetched is ignored, so its progress isn't thrown away.
    async function refresh(groupId, onUpdate) {
      if (runningGroupId === groupId) return { busy: true };
      runningGroupId = groupId;
      crawling = null;
      const mine = ++generation;
      try {
        return await run(groupId, onUpdate, () => mine !== generation);
      } finally {
        if (mine === generation) {
          runningGroupId = null;
          crawling = null;
        }
      }
    }

    function pause() {
      return storage.set({ pausedUntil: now() + pauseMs });
    }

    async function run(groupId, onUpdate, isStale) {
      const cached = await load(groupId);
      if (isStale()) return { stale: true };
      onUpdate(cached);

      const pausedUntil = await read('pausedUntil');
      if (pausedUntil != null && now() < pausedUntil) return { complete: false, paused: true };
      const refreshedAt = await read(refreshedKey(groupId));
      if (refreshedAt != null && now() - refreshedAt < minRefreshMs) return { complete: false, paused: false };
      await storage.set({ [refreshedKey(groupId)]: now() });
      const result = await crawl(groupId, cached, onUpdate, isStale);
      // An abandoned crawl (class switch) didn't finish, so it shouldn't throttle coming back to this class.
      if (result.stale) await storage.set({ [refreshedKey(groupId)]: null });
      return result;
    }

    async function crawl(groupId, cached, onUpdate, isStale) {
      if (isStale()) return { stale: true };

      const list = await fetchAllPosts(groupId, isStale);
      if (isStale()) return { stale: true };
      if (!list.ok) {
        const refused = PAUSE_STATUSES.includes(list.status);
        if (refused) await pause();
        return { complete: false, paused: refused };
      }
      // An empty list for a class we've seen posts in is more likely a glitch than a wiped class: keep cache and pins.
      if (!list.posts.length && cached.posts.length) return { complete: false, paused: false };

      const raw = list.posts.filter((post) => !removed.has(post.id));
      const posts = raw.map(slim);
      const summaries = {};
      for (const post of posts) if (cached.summaries[post.id]) summaries[post.id] = cached.summaries[post.id];
      const fresh = { posts: [...posts], summaries }; // a copy: live updates add to it while workers index into posts
      function dropRemoved() {
        if (!removed.size) return;
        fresh.posts = fresh.posts.filter((post) => !removed.has(post.id));
        for (const id of removed) {
          delete fresh.summaries[id];
          delete threads[id];
        }
      }
      const cachedThreads = await loadThreads(groupId);
      const threads = {};
      for (const post of posts) if (cachedThreads[post.id]) threads[post.id] = cachedThreads[post.id];
      if (isStale()) return { stale: true };
      crawling = { groupId, cache: fresh, threads };
      await save(groupId, fresh, threads);
      if (isStale()) return { stale: true };
      onUpdate(fresh);

      let paused = false;
      let next = 0;
      let done = 0;
      async function worker() {
        while (!paused && !isStale() && next < posts.length) {
          const index = next++;
          const post = posts[index];
          const response = await request(`${API}${groupId}/posts/${post.id}/comments`);
          if (isStale()) return;
          if (response.ok) {
            const comments = Array.isArray(response.data) ? response.data : [];
            fresh.summaries[post.id] = summarize(post, comments);
            threads[post.id] = thread(raw[index], comments);
            dropRemoved();
            onUpdate(fresh);
            if (++done % pageSize === 0) await save(groupId, fresh, threads); // keep progress if the page reloads
          } else if (PAUSE_STATUSES.includes(response.status)) {
            paused = true;
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, posts.length) }, worker));
      if (isStale()) return { stale: true };
      dropRemoved();
      await save(groupId, fresh, threads);
      if (paused) await pause();
      return { complete: true, paused };
    }

    // Forgets a deleted post now instead of waiting for the next refresh; pins are pruned by that refresh as usual.
    async function remove(groupId, postId) {
      removed.add(postId);
      const cache = await load(groupId);
      const threads = await loadThreads(groupId);
      delete cache.summaries[postId];
      delete threads[postId];
      await save(groupId, { posts: cache.posts.filter((post) => post.id !== postId), summaries: cache.summaries }, threads);
    }

    // Changes the running crawl's data when it is for this class, else the stored data. Returns the cache, or null if change() returned false.
    async function edit(groupId, change) {
      const target = crawling && crawling.groupId === groupId ? crawling : { cache: await load(groupId), threads: await loadThreads(groupId) };
      if (change(target.cache, target.threads) === false) return null;
      await save(groupId, target.cache, target.threads);
      return target.cache;
    }

    // A post from Campuswire's socket: adds a newly published one, or takes a known one's edited title and body.
    function upsertPost(groupId, raw) {
      return edit(groupId, (cache, threads) => {
        if (removed.has(raw.id)) return false;
        const post = slim(raw);
        const known = cache.posts.find((p) => p.id === raw.id);
        if (known) {
          if ('title' in raw) known.title = post.title;
          if ('body' in raw) {
            known.body = post.body;
            if (threads[raw.id]) threads[raw.id].body = String(raw.body || '');
          }
          return;
        }
        if (raw.draft || !raw.publishedAt || raw.number == null) return false;
        cache.posts.unshift(post);
        cache.summaries[post.id] = summarize(post, []);
        threads[post.id] = thread(raw, []);
      });
    }

    // Read or resolved state Campuswire's socket reported for a known post.
    function patchPost(groupId, postId, changes) {
      return edit(groupId, (cache) => {
        const post = cache.posts.find((p) => p.id === postId);
        if (!post) return false;
        Object.assign(post, changes);
      });
    }

    // Re-reads one post's replies after Campuswire's socket reported a change to them.
    async function refreshComments(groupId, postId) {
      const pausedUntil = await read('pausedUntil');
      if (pausedUntil != null && now() < pausedUntil) return null;
      const response = await request(`${API}${groupId}/posts/${postId}/comments`);
      if (!response.ok) {
        if (PAUSE_STATUSES.includes(response.status)) await pause();
        return null;
      }
      const comments = Array.isArray(response.data) ? response.data : [];
      return edit(groupId, (cache, threads) => {
        const post = cache.posts.find((p) => p.id === postId);
        if (!post) return false;
        cache.summaries[postId] = summarize(post, comments);
        threads[postId] = thread({ body: threads[postId] ? threads[postId].body : post.body }, comments);
      });
    }

    // Abandons any running refresh (the extension was switched off).
    function cancel() {
      generation++;
      runningGroupId = null;
      crawling = null;
    }

    return { load, loadThreads, refresh, remove, cancel, upsertPost, patchPost, refreshComments };
  }

  const api = { createFetcher };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EasywireFetcher = api;
})(globalThis);
