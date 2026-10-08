(function () {
  const { createFetcher } = globalThis.EasywireFetcher;
  const { createPins } = globalThis.EasywirePins;
  const Render = globalThis.EasywireRender;
  const { formatExport, filterPosts } = globalThis.EasywireExport;
  const REQUEST_TIMEOUT_MS = 15 * 1000;

  const state = {
    groupId: null,
    cache: { posts: [], summaries: {} },
    pinnedIds: [],
    sorted: false,
    searchSorted: false, // "Recent activity" in the search modal's menu; in memory only
    collapsed: false,
    paused: false,
    enabled: false, // set from storage at startup; the toolbar popup flips it
    presence: {}, // userId -> status, from Campuswire's own traffic via page-hook.js
    unreadCounts: {}, // conversationId -> unread comments, from Campuswire's socket snapshot via page-hook.js
    exportStatus: '', // shown in place of "Export" for a moment after a copy
    exportOpen: false, // the Export modal
    exportRange: { from: '', to: '' }, // its dates, remembered while the page is open
    exportModalStatus: '', // replaces "Export all N" for a moment after a copy
    selecting: false,
    selectedIds: [], // in memory only; separate from pins
    selectStatus: '', // replaces "Copy N posts" for a moment after a copy
  };
  let exportTimer = null, modalTimer = null, selectTimer = null;
  let feedGroupId = null; // last class Campuswire's feed loaded, so switching on can fetch it
  let sawReady = false; // a later socket `ready` is a reconnect, which may have missed live events
  const commentTimers = new Map(); // postId -> pending re-read, so a burst of replies costs one request
  const COMMENT_DELAY_MS = 2000;

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
      feedGroupId = data.groupId;
      if (state.enabled) onFeed(data.groupId);
    } else if (data.type === 'presence') {
      Object.assign(state.presence, data.statuses);
      schedule();
    } else if (data.type === 'unread') {
      state.unreadCounts = data.counts;
      if (sawReady && state.enabled && state.groupId) onFeed(state.groupId); // throttled like any refresh
      sawReady = true;
      schedule();
    } else if (data.type === 'post-deleted') {
      onPostDeleted(data.groupId, data.postId);
    } else if (data.type === 'wall') {
      if (state.enabled) onWall(data);
    }
  });

  const fetcher = createFetcher({ request: pageRequest, storage: chrome.storage.local });
  const pins = createPins(chrome.storage.sync);

  async function onFeed(groupId) {
    if (groupId !== state.groupId) {
      state.groupId = groupId;
      state.cache = { posts: [], summaries: {} };
      state.pinnedIds = [];
      closeExport();
      endSelect();
      state.pinnedIds = await pins.list(groupId);
    }
    if (!state.enabled) return; // switched off while pins loaded
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

  // Campuswire drops its own card on its socket's wall-post-deleted event; without this ours stayed until a reload.
  function onPostDeleted(groupId, postId) {
    fetcher.remove(groupId, postId).catch((error) => console.warn('[easywire] Could not forget deleted post:', error));
    if (groupId !== state.groupId) return;
    const { [postId]: _, ...summaries } = state.cache.summaries;
    state.cache = { posts: state.cache.posts.filter((post) => post.id !== postId), summaries };
    schedule();
  }

  // Campuswire's socket said a post was created or edited, its replies changed, or it was read or resolved.
  function onWall({ post, postId, changes }) {
    const groupId = state.groupId;
    if (!groupId) return;
    const show = (update) =>
      update
        .then((cache) => {
          if (cache && state.groupId === groupId) {
            state.cache = cache;
            schedule();
          }
        })
        .catch((error) => console.warn('[easywire] Could not apply live update:', error));
    if (post) {
      if (post.group === groupId || state.cache.posts.some((p) => p.id === post.id)) show(fetcher.upsertPost(groupId, post));
      return;
    }
    if (!state.cache.posts.some((p) => p.id === postId)) return; // another class's post, or one we haven't loaded
    if (changes) {
      show(fetcher.patchPost(groupId, postId, changes));
      return;
    }
    clearTimeout(commentTimers.get(postId));
    commentTimers.set(
      postId,
      setTimeout(() => {
        commentTimers.delete(postId);
        if (state.enabled && state.groupId === groupId) show(fetcher.refreshComments(groupId, postId));
      }, COMMENT_DELAY_MS)
    );
  }

  function saveUi() {
    chrome.storage.local.set({ ui: { sorted: state.sorted, collapsed: state.collapsed } });
  }

  // Copies from stored threads only; nothing is fetched, so the click still counts as a user gesture.
  async function copyPosts(posts, scope) {
    const threads = await fetcher.loadThreads(state.groupId);
    const { text, postCount, missingCount } = formatExport(posts, threads, Date.now(), scope);
    try {
      await navigator.clipboard.writeText(text);
      return `Copied ${postCount} post${postCount === 1 ? '' : 's'}` + (missingCount ? ` (${missingCount} without replies)` : '');
    } catch (error) {
      console.warn('[easywire] Could not copy export:', error);
      return 'Copy failed';
    }
  }

  function flashExportStatus(text) {
    state.exportStatus = text;
    schedule();
    clearTimeout(exportTimer);
    exportTimer = setTimeout(() => {
      state.exportStatus = '';
      schedule();
    }, 2500);
  }

  function closeExport() {
    clearTimeout(modalTimer);
    state.exportOpen = false;
    state.exportModalStatus = '';
  }

  function endSelect() {
    clearTimeout(selectTimer);
    state.selecting = false;
    state.selectedIds = [];
    state.selectStatus = '';
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
    onSortOff() {
      if (!state.sorted) return;
      state.sorted = false;
      saveUi();
      schedule();
    },
    onToggleSearchSorted() {
      state.searchSorted = !state.searchSorted;
      schedule();
    },
    onSearchSortOff() {
      if (!state.searchSorted) return;
      state.searchSorted = false;
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
    // Returns true when the menu should stay open to show a status.
    onExport() {
      if (!state.groupId) return true;
      const selected = filterPosts(state.cache.posts, { selectedIds: state.selectedIds });
      if (selected.length) {
        copyPosts(selected, { selected: true }).then((status) => {
          endSelect();
          flashExportStatus(status);
        });
        return true;
      }
      if (state.selecting) {
        flashExportStatus('No posts selected');
        return true;
      }
      state.exportOpen = true;
      schedule();
      return false;
    },
    onExportDates(from, to) {
      state.exportRange = { from, to };
      schedule();
    },
    async onExportAll() {
      if (state.exportModalStatus) return;
      const { from, to } = state.exportRange;
      const posts = filterPosts(state.cache.posts, { from, to });
      if (!posts.length) return;
      state.exportModalStatus = await copyPosts(posts, from || to ? { from, to } : undefined);
      schedule();
      modalTimer = setTimeout(() => {
        closeExport();
        schedule();
      }, 1500);
    },
    onCloseExport() {
      closeExport();
      schedule();
    },
    onStartSelect() {
      closeExport();
      state.selecting = true;
      state.selectedIds = [];
      schedule();
    },
    onToggleSelect(postId) {
      if (!state.selecting || state.selectStatus || !postId) return;
      state.selectedIds = state.selectedIds.includes(postId) ? state.selectedIds.filter((id) => id !== postId) : [...state.selectedIds, postId];
      schedule();
    },
    onSetSelection(ids) {
      if (!state.selecting || state.selectStatus) return;
      state.selectedIds = ids;
      schedule();
    },
    async onCopySelected() {
      if (state.selectStatus) return;
      const posts = filterPosts(state.cache.posts, { selectedIds: state.selectedIds });
      if (!posts.length) return;
      state.selectStatus = await copyPosts(posts, { selected: true });
      schedule();
      selectTimer = setTimeout(() => {
        endSelect();
        schedule();
      }, 1500);
    },
    onCancelSelect() {
      endSelect();
      schedule();
    },
  };

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (!state.enabled) return;
      Render.render(
        {
          posts: state.cache.posts,
          summaries: state.cache.summaries,
          pinnedIds: state.pinnedIds,
          sorted: state.sorted,
          searchSorted: state.searchSorted,
          collapsed: state.collapsed,
          paused: state.paused,
          presence: state.presence,
          unreadCounts: state.unreadCounts,
          exportStatus: state.exportStatus,
          exportModal: state.exportOpen ? { ...state.exportRange, status: state.exportModalStatus } : null,
          selecting: state.selecting,
          selectedIds: state.selectedIds,
          selectStatus: state.selectStatus,
          now: Date.now(),
        },
        handlers
      );
    });
  }

  // Only feed-column and search-result changes matter; ignoring the rest keeps typing in the composer from re-rendering every frame.
  function touchesFeed(record) {
    const column = document.querySelector(Render.SELECTORS.column);
    const search = document.querySelector(Render.SELECTORS.searchModal);
    const node = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentNode;
    return !column || !node || column.contains(node) || node.contains(column) || Boolean(search && search.contains(node));
  }

  new MutationObserver((records) => {
    if (records.some(touchesFeed)) schedule();
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] }); // class: Campuswire's unread dot
  setInterval(schedule, 60 * 1000); // keep relative times current; no network

  // page-hook.js still loads while off (manifest scripts can't be switched off), but it only answers our requests.
  function setEnabled(enabled) {
    state.enabled = enabled;
    if (enabled) {
      if (feedGroupId) onFeed(feedGroupId);
      schedule();
    } else {
      fetcher.cancel();
      closeExport();
      endSelect();
      Render.teardown();
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && 'enabled' in changes) setEnabled(changes.enabled.newValue !== false);
  });

  // The toolbar popup asks which class this tab is showing, to read its cached status.
  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message && message.type === 'status') reply({ groupId: feedGroupId });
  });

  chrome.storage.local.get(['ui', 'enabled']).then(({ ui, enabled }) => {
    if (ui) {
      state.sorted = Boolean(ui.sorted);
      state.collapsed = Boolean(ui.collapsed);
    }
    setEnabled(enabled !== false);
  });

  // page-hook may have seen the feed request before this script loaded.
  window.postMessage({ source: 'easywire', type: 'hello' }, location.origin);
})();
