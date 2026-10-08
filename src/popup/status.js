(function (root) {
  const { formatRelative } = typeof module === 'object' && module.exports ? require('../activity.js') : root.EasywireActivity;

  // The popup's two lines about the class open in the current tab, from what the fetcher cached.
  function statusLines({ groupId, postCount = 0, refreshedAt = null, pausedUntil = null, now }) {
    if (!groupId) return { title: 'No class open', detail: 'Open a class feed on Campuswire to see its status.' };
    if (!postCount && refreshedAt == null) {
      return { title: 'No posts loaded yet', detail: 'easywire loads them when the feed opens.' };
    }
    const title = `${postCount.toLocaleString('en-US')} ${postCount === 1 ? 'post' : 'posts'} in this class`;
    if (pausedUntil != null && pausedUntil > now) {
      return { title, detail: `Campuswire asked to slow down. Resumes in ${formatRelative(now, pausedUntil)}.` };
    }
    if (refreshedAt == null) return { title, detail: 'Not checked yet' };
    return { title, detail: `Checked ${formatRelative(refreshedAt, now)} ago` };
  }

  const api = { statusLines };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EasywireStatus = api;
})(globalThis);
