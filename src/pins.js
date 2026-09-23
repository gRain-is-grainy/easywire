(function (root) {
  function createPins(storage) {
    let chain = Promise.resolve();
    function serial(fn) {
      const result = chain.then(fn);
      chain = result.catch(() => {});
      return result;
    }

    async function load() {
      const { pins } = await storage.get('pins');
      return pins || {};
    }

    async function save(pins, groupId, ids) {
      if (ids.length) pins[groupId] = ids;
      else delete pins[groupId];
      await storage.set({ pins });
    }

    return {
      list: (groupId) => serial(async () => [...((await load())[groupId] || [])]),

      toggle: (groupId, postId) =>
        serial(async () => {
          const pins = await load();
          const ids = pins[groupId] || [];
          const pinned = !ids.includes(postId);
          await save(pins, groupId, pinned ? [...ids, postId] : ids.filter((id) => id !== postId));
          return pinned;
        }),

      prune: (groupId, existingIds) =>
        serial(async () => {
          const pins = await load();
          const ids = pins[groupId] || [];
          const existing = new Set(existingIds);
          const kept = ids.filter((id) => existing.has(id));
          if (kept.length !== ids.length) await save(pins, groupId, kept);
          return kept;
        }),
    };
  }

  const api = { createPins };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EasywirePins = api;
})(globalThis);
