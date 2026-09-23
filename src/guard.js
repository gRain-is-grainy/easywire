(function (root) {
  const ID = '[A-Za-z0-9-]+';
  // Only the two query shapes fetcher.js builds: ?number=N and ?number=N&before=<encoded timestamp>.
  const ALLOWED = new RegExp(
    `^https://api\\.campuswire\\.com/v1/group/${ID}/posts(?:\\?number=\\d+(?:&before=[A-Za-z0-9%._-]+)?|/${ID}/comments)$`
  );
  const FEED = new RegExp(`^https://api\\.campuswire\\.com/v1/group/(${ID})/posts(?:\\?([^#]*))?$`);

  function isApiUrl(url) {
    return String(url).startsWith('https://api.campuswire.com/');
  }

  function isAllowedRequest(method, url) {
    return String(method).toUpperCase() === 'GET' && ALLOWED.test(String(url));
  }

  function feedGroupId(url) {
    const match = FEED.exec(String(url));
    if (!match) return null;
    const query = new URLSearchParams(match[2] || '');
    return query.has('before') || query.has('category') ? null : match[1];
  }

  const api = { isApiUrl, isAllowedRequest, feedGroupId };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EasywireGuard = api;
})(globalThis);
