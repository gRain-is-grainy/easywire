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

  function createFetcher({ request, storage, concurrency = 3, pageSize = 20 }) {
    let generation = 0;
    const keyFor = (groupId) => `cache:${groupId}`;

    async function load(groupId) {
      const stored = (await storage.get(keyFor(groupId)))[keyFor(groupId)];
      return stored || { posts: [], summaries: {} };
    }

    function save(groupId, cache) {
      return storage.set({ [keyFor(groupId)]: cache });
    }

    async function fetchAllPosts(groupId, isStale) {
      const posts = [];
      let before = null;
      while (!isStale()) {
        let url = `${API}${groupId}/posts?number=${pageSize}`;
        if (before) url += `&before=${encodeURIComponent(before)}`;
        const response = await request(url);
        if (!response.ok) return { ok: false, status: response.status };
        const page = Array.isArray(response.data) ? response.data : [];
        posts.push(...page);
        const last = page[page.length - 1];
        if (page.length < pageSize || !last || last.publishedAt === before) return { ok: true, posts };
        before = last.publishedAt;
      }
      return { ok: false, status: 0 };
    }

    async function refresh(groupId, onUpdate) {
      const mine = ++generation;
      const isStale = () => mine !== generation;

      const cached = await load(groupId);
      if (isStale()) return { stale: true };
      onUpdate(cached);

      const list = await fetchAllPosts(groupId, isStale);
      if (isStale()) return { stale: true };
      if (!list.ok) return { complete: false, paused: PAUSE_STATUSES.includes(list.status) };

      const posts = list.posts.map(slim);
      const summaries = {};
      for (const post of posts) if (cached.summaries[post.id]) summaries[post.id] = cached.summaries[post.id];
      const fresh = { posts, summaries };
      await save(groupId, fresh);
      if (isStale()) return { stale: true };
      onUpdate(fresh);

      let paused = false;
      let next = 0;
      async function worker() {
        while (!paused && !isStale() && next < posts.length) {
          const post = posts[next++];
          const response = await request(`${API}${groupId}/posts/${post.id}/comments`);
          if (isStale()) return;
          if (response.ok) {
            fresh.summaries[post.id] = summarize(post, Array.isArray(response.data) ? response.data : []);
            onUpdate(fresh);
          } else if (PAUSE_STATUSES.includes(response.status)) {
            paused = true;
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, posts.length) }, worker));
      if (isStale()) return { stale: true };
      await save(groupId, fresh);
      return { complete: true, paused };
    }

    return { load, refresh };
  }

  const api = { createFetcher };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EasywireFetcher = api;
})(globalThis);
