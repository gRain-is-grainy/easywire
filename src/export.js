(function (root) {
  // '2026-10-07 13:02 UTC', or '' for a missing or unparseable date.
  function formatTime(date) {
    const time = Date.parse(date);
    if (!Number.isFinite(time)) return '';
    return `${new Date(time).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  }

  function byline(name, date) {
    const time = formatTime(date);
    return [name || 'Anonymous', time].filter(Boolean).join(', ');
  }

  function tags(post) {
    if (post.note) return '[note]';
    return post.answered ? '[question, resolved]' : '[question]';
  }

  // selectedIds (an array) wins; otherwise keeps posts published within [from, to], local days, inclusive. '' is unbounded.
  function filterPosts(posts, { from = '', to = '', selectedIds = null } = {}) {
    if (selectedIds) {
      const wanted = new Set(selectedIds);
      return posts.filter((post) => wanted.has(post.id));
    }
    if (!from && !to) return posts;
    const start = from ? new Date(`${from}T00:00:00`).getTime() : -Infinity;
    let end = Infinity;
    if (to) {
      const next = new Date(`${to}T00:00:00`);
      next.setDate(next.getDate() + 1); // setDate, not +24h, so DST days stay whole
      end = next.getTime();
    }
    return posts.filter((post) => {
      const time = Date.parse(post.publishedAt);
      return time >= start && time < end; // NaN (missing or bad date) fails both
    });
  }

  // scope: undefined (whole class), { selected: true }, or { from, to }.
  function describe(count, scope) {
    const posts = `${count} ${scope && scope.selected ? 'selected ' : ''}post${count === 1 ? '' : 's'}`;
    if (!scope || scope.selected) return posts;
    if (scope.from && scope.to) return `${posts} published ${scope.from} to ${scope.to}`;
    if (scope.from) return `${posts} published from ${scope.from}`;
    if (scope.to) return `${posts} published up to ${scope.to}`;
    return posts;
  }

  // Plain text for pasting into an AI chat. threads: postId -> {body, comments}; comments are in Campuswire's order.
  function formatExport(posts, threads, now, scope) {
    const count = posts.length;
    const lines = [`Campuswire class export: ${describe(count, scope)}, copied ${new Date(now).toISOString().slice(0, 10)}`, ''];
    let missingCount = 0;
    for (const post of posts) {
      const thread = threads[post.id];
      lines.push(`=== #${post.number} ${post.title} ${tags(post)} ===`, byline(post.authorName, post.publishedAt));
      lines.push(...String(thread ? thread.body : post.body).split('\n'));
      if (!thread) {
        missingCount++;
        lines.push('(full text and replies not loaded yet)');
      }
      lines.push('');
      if (!thread || !thread.comments.length) continue;
      for (const comment of thread.comments) {
        const indent = '  '.repeat(Math.max(1, Number(comment.depth) || 1)); // Campuswire's top-level replies are depth 1
        lines.push(`${indent}> ${comment.answer ? '[answer] ' : ''}${byline(comment.authorName, comment.createdAt)}`);
        for (const line of String(comment.body).split('\n')) lines.push(`${indent}  ${line}`);
      }
      lines.push('');
    }
    return { text: lines.join('\n'), postCount: count, missingCount };
  }

  const api = { formatExport, filterPosts };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EasywireExport = api;
})(globalThis);
