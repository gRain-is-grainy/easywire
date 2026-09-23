const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const G = 'bc3cc03c-63d5-4d16-8574-398aef054b15';
const FEED = `https://api.campuswire.com/v1/group/${G}/posts?number=20`;
const src = (name) => fs.readFileSync(path.join(__dirname, '..', 'src', name), 'utf8');
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

// Loads guard.js + page-hook.js into a fake page world.
function loadHook() {
  const fetches = [];
  const posted = [];
  const listeners = [];
  const xhrSent = [];

  class FakeXHR {
    open() {}
    setRequestHeader() {}
    send() {
      xhrSent.push(this);
    }
  }

  const win = {
    URL,
    URLSearchParams,
    Request,
    Headers,
    XMLHttpRequest: FakeXHR,
    location: { href: 'https://campuswire.com/c/X/feed', origin: 'https://campuswire.com' },
    fetch: async (input, init) => {
      fetches.push({ input, init });
      return { ok: true, status: 200, json: async () => [{ id: 'p1' }] };
    },
    addEventListener: (type, fn) => listeners.push(fn),
  };
  let page = null; // the sandbox global, which is what `window` is inside the hook
  win.postMessage = (data) => {
    posted.push(structuredClone(data));
    setTimeout(() => listeners.forEach((fn) => fn({ source: page, data: structuredClone(data) })));
  };
  win.window = win;
  vm.createContext(win);
  page = vm.runInContext('globalThis', win);
  vm.runInContext(src('guard.js'), win);
  vm.runInContext(src('page-hook.js'), win);

  const fromHook = () => posted.filter((m) => m.source === 'easywire-page');
  const ask = async (url, source = page) => {
    const data = { source: 'easywire', type: 'request', id: fromHook().length + 1, url };
    listeners.forEach((fn) => fn({ source, data }));
    await tick();
    return fromHook().filter((m) => m.type === 'response').at(-1);
  };
  return { win, fetches, fromHook, ask, xhrSent };
}

test('refuses to fetch before the auth header is seen', async () => {
  const hook = loadHook();
  const response = await hook.ask(FEED);
  assert.equal(response.ok, false);
  assert.equal(hook.fetches.length, 0);
});

test('captures auth from a page fetch with a Headers object and serves allowed GETs with it', async () => {
  const hook = loadHook();
  await hook.win.fetch(FEED, { headers: new Headers({ authorization: 'Bearer secret' }) });
  assert.deepEqual(hook.fromHook().find((m) => m.type === 'feed'), { source: 'easywire-page', type: 'feed', groupId: G });

  const response = await hook.ask(FEED);
  assert.equal(response.ok, true);
  const sent = hook.fetches.at(-1);
  assert.equal(sent.input, FEED);
  assert.equal(sent.init.method, 'GET');
  assert.equal(sent.init.headers.authorization, 'Bearer secret');
  assert.ok(!JSON.stringify(hook.fromHook()).includes('secret'), 'token leaked to the content script');
});

test('captures auth from a page XHR', async () => {
  const hook = loadHook();
  const xhr = new hook.win.XMLHttpRequest();
  xhr.open('GET', FEED);
  xhr.setRequestHeader('Authorization', 'Bearer x');
  xhr.send();
  assert.equal((await hook.ask(FEED)).ok, true);
});

test('refuses disallowed URLs even with auth', async () => {
  const hook = loadHook();
  await hook.win.fetch(FEED, { headers: { authorization: 'Bearer x' } });
  const before = hook.fetches.length;
  for (const url of [
    `https://api.campuswire.com/v1/group/${G}/posts/p1/viewed`,
    `https://api.campuswire.com/v1/group/${G}/posts?number=20&_method=DELETE`,
    'https://evil.com/v1/group/x/posts?number=20',
  ]) {
    assert.equal((await hook.ask(url)).ok, false, url);
  }
  assert.equal(hook.fetches.length, before);
});

test('ignores request messages from other windows', async () => {
  const hook = loadHook();
  await hook.win.fetch(FEED, { headers: { authorization: 'Bearer x' } });
  const before = hook.fetches.length;
  await hook.ask(FEED, {});
  assert.equal(hook.fetches.length, before);
});

test('a failure inside the XHR hook never blocks the page request', async () => {
  const hook = loadHook();
  await hook.win.fetch(FEED, { headers: { authorization: 'Bearer x' } });
  hook.win.postMessage = () => {
    throw new Error('boom');
  };
  const xhr = new hook.win.XMLHttpRequest();
  xhr.open('GET', FEED);
  assert.doesNotThrow(() => xhr.send());
  assert.equal(hook.xhrSent.length, 1);
});
