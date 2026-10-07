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

  // Plain text for pasting into an AI chat. threads: postId -> {body, comments}; comments are in Campuswire's order.
  function formatExport(posts, threads, now) {
    const count = posts.length;
    const lines = [`Campuswire class export: ${count} post${count === 1 ? '' : 's'}, copied ${new Date(now).toISOString().slice(0, 10)}`, ''];
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

  const api = { formatExport };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EasywireExport = api;
})(globalThis);
