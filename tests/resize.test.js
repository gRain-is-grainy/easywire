const test = require('node:test');
const assert = require('node:assert/strict');
const { clampWidth, MIN_WIDTH } = require('../src/resize.js');

test('keeps a width between the minimum and half the area beside the nav', () => {
  assert.equal(clampWidth(400, 1700), 400);
  assert.equal(clampWidth(100, 1700), MIN_WIDTH);
  assert.equal(clampWidth(1200, 1700), 850);
});

test('the minimum wins when the window is too narrow for both limits', () => {
  assert.equal(clampWidth(400, 400), MIN_WIDTH);
});

test('the minimum keeps a card title and post number readable', () => {
  assert.ok(MIN_WIDTH >= 260);
});

test('rounds to whole pixels', () => {
  assert.equal(clampWidth(300.6, 1700), 301);
});
