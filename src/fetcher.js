(function (root) {
  const { summarize } = typeof module === 'object' && module.exports ? require('./activity.js') : root.EasywireActivity;
  const API = 'https://api.campuswire.com/v1/group/';
  const PAUSE_STATUSES = [401, 429];

  function slim(post) {
    return {
      id: post.id,
      number: post.number,
      title: post.title || '',
      body: String(post.body || '').slice(0, 200),
      publishedAt: post.publishedAt,
      likesCount: post.likesCount || 0,
      answered: Boolean(post.answeredAt),
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
    const keyFor = (groupId) => `cache:${groupId}`;
    const refreshedKey = (groupId) => `refreshedAt:${groupId}`;

    async function read(key) {
      return (await storage.get(key))[key];
    }

    async function load(groupId) {
      return (await read(keyFor(groupId))) || { posts: [], summaries: {} };
    }

    function save(groupId, cache) {
      return storage.set({ [keyFor(groupId)]: cache });
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
      const mine = ++generation;
      try {
        return await run(groupId, onUpdate, () => mine !== generation);
      } finally {
        if (mine === generation) runningGroupId = null;
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

      const posts = list.posts.map(slim);
      const summaries = {};
      for (const post of posts) if (cached.summaries[post.id]) summaries[post.id] = cached.summaries[post.id];
      const fresh = { posts, summaries };
      await save(groupId, fresh);
      if (isStale()) return { stale: true };
      onUpdate(fresh);

      let paused = false;
      let next = 0;
      let done = 0;
      async function worker() {
        while (!paused && !isStale() && next < posts.length) {
          const post = posts[next++];
          const response = await request(`${API}${groupId}/posts/${post.id}/comments`);
          if (isStale()) return;
          if (response.ok) {
            fresh.summaries[post.id] = summarize(post, Array.isArray(response.data) ? response.data : []);
            onUpdate(fresh);
            if (++done % pageSize === 0) await save(groupId, fresh); // keep progress if the page reloads
          } else if (PAUSE_STATUSES.includes(response.status)) {
            paused = true;
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, posts.length) }, worker));
      if (isStale()) return { stale: true };
      await save(groupId, fresh);
      if (paused) await pause();
      return { complete: true, paused };
    }

    // Abandons any running refresh (the extension was switched off).
    function cancel() {
      generation++;
      runningGroupId = null;
    }

    return { load, refresh, cancel };
  }

  const api = { createFetcher };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EasywireFetcher = api;
})(globalThis);
