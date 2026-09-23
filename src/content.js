(function () {
  const { createFetcher } = globalThis.EasywireFetcher;
  const { createPins } = globalThis.EasywirePins;
  const Render = globalThis.EasywireRender;
  const REQUEST_TIMEOUT_MS = 15 * 1000;

  const state = {
    groupId: null,
    cache: { posts: [], summaries: {} },
    pinnedIds: [],
    sorted: false,
    collapsed: false,
    paused: false,
  };

  // --- bridge to page-hook.js (MAIN world) ---
  let nextRequestId = 0;
  const pending = new Map();

  function pageRequest(url) {
    return new Promise((resolve) => {
      const id = ++nextRequestId;
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, status: 0, data: null });
      }, REQUEST_TIMEOUT_MS);
      pending.set(id, (response) => {
        clearTimeout(timer);
        resolve(response);
      });
      window.postMessage({ source: 'easywire', type: 'request', id, url }, location.origin);
    });
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window || !data || data.source !== 'easywire-page') return;
    if (data.type === 'response') {
      const resolve = pending.get(data.id);
      if (resolve) {
        pending.delete(data.id);
        resolve(data);
      }
    } else if (data.type === 'feed') {
      onFeed(data.groupId);
    }
  });

  const fetcher = createFetcher({ request: pageRequest, storage: chrome.storage.local });
  const pins = createPins(chrome.storage.sync);

  async function onFeed(groupId) {
    if (groupId !== state.groupId) {
      state.groupId = groupId;
      state.cache = { posts: [], summaries: {} };
      state.pinnedIds = [];
      state.pinnedIds = await pins.list(groupId);
    }
    state.paused = false; // a real pause comes back from refresh within a couple of storage reads
    const result = await fetcher.refresh(groupId, (cache) => {
      if (state.groupId !== groupId) return;
      state.cache = cache;
      schedule();
    });
    // The fetcher throttles repeat refreshes and holds a 401/429 pause across reloads; see fetcher.js.
    if (result.stale || result.busy) return;
    if (state.groupId !== groupId) return;
    state.paused = result.paused;
    // Prune only after the full post list loaded, so a failed request never deletes pins.
    if (result.complete) state.pinnedIds = await pins.prune(groupId, state.cache.posts.map((p) => p.id));
    schedule();
  }

  function saveUi() {
    chrome.storage.local.set({ ui: { sorted: state.sorted, collapsed: state.collapsed } });
  }

  const handlers = {
    async onTogglePin(postId) {
      const groupId = state.groupId;
      if (!groupId || !postId) return;
      try {
        await pins.toggle(groupId, postId);
      } catch (error) {
        // chrome.storage.sync caps one item at 8 KB (~200 pins across all classes).
        console.warn('[easywire] Could not save pin:', error);
        window.alert('easywire could not save this pin (browser sync storage is full). Unpin some posts and try again.');
      }
      if (state.groupId === groupId) state.pinnedIds = await pins.list(groupId);
      schedule();
    },
    onToggleSorted() {
      state.sorted = !state.sorted;
      saveUi();
      schedule();
    },
    onToggleCollapsed() {
      state.collapsed = !state.collapsed;
      saveUi();
      schedule();
    },
    onOpen(number) {
      Render.openPost(number);
    },
  };

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      Render.render(
        {
          posts: state.cache.posts,
          summaries: state.cache.summaries,
          pinnedIds: state.pinnedIds,
          sorted: state.sorted,
          collapsed: state.collapsed,
          paused: state.paused,
          now: Date.now(),
        },
        handlers
      );
    });
  }

  // Only feed-column changes matter; ignoring the rest keeps typing in the composer from re-rendering every frame.
  function touchesFeed(record) {
    const column = document.querySelector(Render.SELECTORS.column);
    const node = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentNode;
    return !column || !node || column.contains(node) || node.contains(column);
  }

  new MutationObserver((records) => {
    if (records.some(touchesFeed)) schedule();
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
  setInterval(schedule, 60 * 1000); // keep relative times current; no network

  chrome.storage.local.get('ui').then(({ ui }) => {
    if (ui) {
      state.sorted = Boolean(ui.sorted);
      state.collapsed = Boolean(ui.collapsed);
    }
    schedule();
  });

  // page-hook may have seen the feed request before this script loaded.
  window.postMessage({ source: 'easywire', type: 'hello' }, location.origin);
})();
