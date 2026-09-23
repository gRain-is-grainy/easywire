(function () {
  const { isApiUrl, isAllowedRequest, feedGroupId } = window.EasywireGuard;
  const nativeFetch = window.fetch.bind(window);
  const USERS_URL = 'https://api.campuswire.com/v1/users'; // Campuswire's own member lookup, which carries presence
  let auth = null;
  let lastFeedGroupId = null;
  const presence = {}; // userId -> Campuswire presence status, replayed on hello

  function toContent(message) {
    window.postMessage({ source: 'easywire-page', ...message }, location.origin);
  }

  // Passes on statuses from Campuswire's own traffic; easywire never asks for them itself.
  function sawUsers(users) {
    const statuses = {};
    for (const user of users) {
      const status = user && user.id && user.presence && user.presence.status;
      if (typeof status === 'string') statuses[user.id] = status;
    }
    if (!Object.keys(statuses).length) return;
    Object.assign(presence, statuses);
    toContent({ type: 'presence', statuses });
  }

  function onUsersLoad() {
    try {
      if (this.status !== 200) return;
      const users = JSON.parse(this.responseText);
      if (Array.isArray(users)) sawUsers(users);
    } catch (_) {
      // Never break the page's own requests.
    }
  }

  function onSocketMessage(event) {
    try {
      // Check the prefix first so we don't parse every chat frame.
      if (typeof event.data !== 'string' || !event.data.startsWith('{"event":"presence-changed"')) return;
      const { data } = JSON.parse(event.data);
      if (data && data.user) sawUsers([data.user]);
    } catch (_) {
      // Never break the page's socket.
    }
  }

  const NativeWebSocket = window.WebSocket;
  window.WebSocket = new Proxy(NativeWebSocket, {
    construct(target, args, newTarget) {
      const socket = Reflect.construct(target, args, newTarget);
      socket.addEventListener('message', onSocketMessage);
      return socket;
    },
  });

  // Called for every request the page itself makes. The auth header stays in this closure.
  function sawRequest(method, url, authorization) {
    if (!isApiUrl(url)) return;
    if (authorization) auth = authorization;
    if (!auth || String(method).toUpperCase() !== 'GET') return;
    const groupId = feedGroupId(url);
    if (groupId) {
      lastFeedGroupId = groupId;
      toContent({ type: 'feed', groupId });
    }
  }

  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  const xhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      this.__easywire = { method, url: new URL(String(url), location.href).href, authorization: null };
    } catch (_) {
      this.__easywire = null;
    }
    return xhrOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this.__easywire && String(name).toLowerCase() === 'authorization') this.__easywire.authorization = value;
    return xhrSetHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    const info = this.__easywire;
    try {
      if (info) sawRequest(info.method, info.url, info.authorization);
      if (info && String(info.method).toUpperCase() === 'POST' && info.url === USERS_URL) this.addEventListener('load', onUsersLoad);
    } catch (_) {
      // Never break the page's own requests.
    }
    return xhrSend.apply(this, arguments);
  };

  window.fetch = function (input, init) {
    try {
      const request = input instanceof Request ? input : null;
      const url = new URL(request ? request.url : String(input), location.href).href;
      const method = (init && init.method) || (request && request.method) || 'GET';
      const headers = new Headers((init && init.headers) || (request && request.headers) || undefined);
      sawRequest(method, url, headers.get('authorization'));
    } catch (_) {
      // Never break the page's own requests.
    }
    return nativeFetch(input, init);
  };

  window.addEventListener('message', async (event) => {
    const data = event.data;
    if (event.source !== window || !data || data.source !== 'easywire') return;
    if (data.type === 'hello') {
      if (lastFeedGroupId) toContent({ type: 'feed', groupId: lastFeedGroupId });
      if (Object.keys(presence).length) toContent({ type: 'presence', statuses: { ...presence } });
      return;
    }
    if (data.type !== 'request') return;
    if (!auth || !isAllowedRequest('GET', data.url)) {
      toContent({ type: 'response', id: data.id, ok: false, status: 0, data: null });
      return;
    }
    try {
      const response = await nativeFetch(data.url, {
        method: 'GET',
        headers: { authorization: auth, accept: 'application/json' },
      });
      const body = response.ok ? await response.json() : null;
      toContent({ type: 'response', id: data.id, ok: response.ok, status: response.status, data: body });
    } catch (_) {
      toContent({ type: 'response', id: data.id, ok: false, status: 0, data: null });
    }
  });
})();
