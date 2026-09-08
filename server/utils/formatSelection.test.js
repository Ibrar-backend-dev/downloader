const test = require('node:test');
const assert = require('node:assert/strict');

const { videoSelector, legacyVideoSelector, explicitVideoSelector } = require('./formatSelection');

test('builds a merged selector for numeric video quality', () => {
  assert.equal(videoSelector('720'), 'bv*[height<=720]+ba/b[height<=720]/b');
});

test('supports best and worst quality without malformed selectors', () => {
  assert.equal(videoSelector('best'), 'bv*+ba/b');
  assert.equal(videoSelector('worst'), 'wv*+wa/w');
});

test('preserves the legacy best selector', () => {
  assert.equal(legacyVideoSelector('best'), 'b');
  assert.equal(legacyVideoSelector('1080'), 'best[height<=1080]/best');
});

test('builds a selector for a format returned by video info', () => {
  assert.equal(explicitVideoSelector('137'), '137+ba/137/b');
});

test('rejects unsupported quality values', () => {
  assert.throws(() => videoSelector('source'), { code: 'INVALID_QUALITY' });
  assert.throws(() => legacyVideoSelector('source'), { code: 'INVALID_QUALITY' });
  assert.throws(() => explicitVideoSelector('137+https://bad'), { code: 'INVALID_FORMAT_ID' });
});
