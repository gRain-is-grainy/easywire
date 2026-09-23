const test = require('node:test');
const assert = require('node:assert/strict');
const { createPins } = require('../src/pins.js');

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

// Async like chrome.storage, with a delay so unserialized read-modify-write would race.
function fakeStorage(initial = {}) {
  const data = structuredClone(initial);
  let writes = 0;
  return {
    data,
    writes: () => writes,
    async get(key) {
      await tick();
      return key in data ? { [key]: structuredClone(data[key]) } : {};
    },
    async set(obj) {
      await tick();
      writes++;
      Object.assign(data, structuredClone(obj));
    },
  };
}

test('toggle pins then unpins and reports the new state', async () => {
  const pins = createPins(fakeStorage());
  assert.equal(await pins.toggle('g1', 'a'), true);
  assert.deepEqual(await pins.list('g1'), ['a']);
  assert.equal(await pins.toggle('g1', 'a'), false);
  assert.deepEqual(await pins.list('g1'), []);
});

test('groups are isolated and empty groups are removed', async () => {
  const storage = fakeStorage();
  const pins = createPins(storage);
  await pins.toggle('g1', 'a');
  await pins.toggle('g2', 'b');
  await pins.toggle('g1', 'a');
  assert.deepEqual(storage.data.pins, { g2: ['b'] });
  assert.deepEqual(await pins.list('unknown'), []);
});

test('concurrent toggles are serialized (no lost updates)', async () => {
  const pins = createPins(fakeStorage());
  const results = await Promise.all([pins.toggle('g1', 'a'), pins.toggle('g1', 'a'), pins.toggle('g1', 'b')]);
  assert.deepEqual(results, [true, false, true]);
  assert.deepEqual(await pins.list('g1'), ['b']);
});

test('prune keeps only existing ids in pin order; no-op prune does not write', async () => {
  const storage = fakeStorage({ pins: { g1: ['a', 'b', 'c'] } });
  const pins = createPins(storage);
  assert.deepEqual(await pins.prune('g1', ['c', 'a', 'x']), ['a', 'c']);
  assert.deepEqual(storage.data.pins, { g1: ['a', 'c'] });
  const writes = storage.writes();
  assert.deepEqual(await pins.prune('g1', ['a', 'c']), ['a', 'c']);
  assert.equal(storage.writes(), writes);
});

test('list returns a copy', async () => {
  const pins = createPins(fakeStorage({ pins: { g1: ['a'] } }));
  const list = await pins.list('g1');
  list.push('zzz');
  assert.deepEqual(await pins.list('g1'), ['a']);
});
