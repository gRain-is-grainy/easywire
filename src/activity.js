(function (root) {
  function summarize(post, comments) {
    let last = Date.parse(post.publishedAt);
    if (!Number.isFinite(last)) last = -Infinity;
    for (const comment of comments) {
      const time = Date.parse(comment.createdAt);
      if (time > last) last = time;
    }
    if (!Number.isFinite(last)) return { replyCount: comments.length, lastActivityAt: null };
    return { replyCount: comments.length, lastActivityAt: new Date(last).toISOString() };
  }

  function activityOf(post, summaries) {
    const summary = summaries[post.id];
    return (summary && summary.lastActivityAt) || post.publishedAt;
  }

  function sortByActivity(posts, summaries) {
    const time = (post) => {
      const t = Date.parse(activityOf(post, summaries));
      return Number.isFinite(t) ? t : -Infinity;
    };
    return [...posts].sort((a, b) => {
      const ta = time(a);
      const tb = time(b);
      return ta === tb ? b.number - a.number : tb > ta ? 1 : -1;
    });
  }

  // Same thresholds and rounding as moment.js fromNow(true), which Campuswire uses.
  // Returns '' for a missing or unparseable date.
  function formatRelative(date, now) {
    const then = typeof date === 'number' ? date : Date.parse(date);
    if (!Number.isFinite(then)) return '';
    const ms = Math.max(0, now - then);
    const seconds = Math.round(ms / 1000);
    const minutes = Math.round(ms / 60000);
    const hours = Math.round(ms / 3600000);
    const exactDays = ms / 86400000;
    const days = Math.round(exactDays);
    const months = Math.round((exactDays * 4800) / 146097);
    const years = Math.round((exactDays * 400) / 146097);
    if (seconds < 45) return 'a few seconds';
    if (minutes <= 1) return 'a minute';
    if (minutes < 45) return `${minutes} minutes`;
    if (hours <= 1) return 'an hour';
    if (hours < 22) return `${hours} hours`;
    if (days <= 1) return 'a day';
    if (days < 26) return `${days} days`;
    if (months <= 1) return 'a month';
    if (months < 11) return `${months} months`;
    if (years <= 1) return 'a year';
    return `${years} years`;
  }

  const api = { summarize, activityOf, sortByActivity, formatRelative };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EasywireActivity = api;
})(globalThis);
