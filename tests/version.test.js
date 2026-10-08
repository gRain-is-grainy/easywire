const test = require('node:test');
const assert = require('node:assert/strict');
const { isNewer } = require('../src/popup/version.js');

test('newer when any part is higher', () => {
  assert.equal(isNewer('0.2.0', '0.1.0'), true);
  assert.equal(isNewer('1.0.0', '0.9.9'), true);
  assert.equal(isNewer('0.1.1', '0.1.0'), true);
});

test('compares parts as numbers, not strings', () => {
  assert.equal(isNewer('0.10.0', '0.9.0'), true);
  assert.equal(isNewer('0.9.0', '0.10.0'), false);
});

test('not newer when equal or older', () => {
  assert.equal(isNewer('0.1.0', '0.1.0'), false);
  assert.equal(isNewer('0.1.0', '0.2.0'), false);
});

test('missing parts count as 0', () => {
  assert.equal(isNewer('0.2', '0.1.9'), true);
  assert.equal(isNewer('1', '1.0.0'), false);
});
