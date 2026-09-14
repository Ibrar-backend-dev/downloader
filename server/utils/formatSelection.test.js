const test = require('node:test');
const assert = require('node:assert/strict');

const {
  videoSelector,
  legacyVideoSelector,
  explicitVideoSelector,
  normalizeDurationSeconds,
  dedupeFormatsByResolution,
  filterFormatsByMinimumResolution,
  formatSizeMb,
} = require('./formatSelection');

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

test('normalizes duration values into whole seconds', () => {
  assert.equal(normalizeDurationSeconds(12.7), 13);
  assert.equal(normalizeDurationSeconds('12.2'), 12);
  assert.equal(normalizeDurationSeconds(null), null);
  assert.equal(normalizeDurationSeconds(undefined), null);
});

test('deduplicates repeated resolutions down to one format entry per height', () => {
  const formats = [
    { formatId: 602, resolution: '144p', ext: 'mp4', hasVideo: true, hasAudio: false },
    { formatId: 269, resolution: '144p', ext: 'mp4', hasVideo: true, hasAudio: false },
    { formatId: 160, resolution: '144p', ext: 'mp4', hasVideo: true, hasAudio: false },
    { formatId: 232, resolution: '720p', ext: 'mp4', hasVideo: true, hasAudio: false },
    { formatId: 136, resolution: '720p', ext: 'mp4', hasVideo: true, hasAudio: false },
  ];

  const deduped = dedupeFormatsByResolution(formats);
  assert.deepEqual(deduped.map((entry) => entry.resolution), ['144p', '720p']);
  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].formatId, 602);
  assert.equal(deduped[1].formatId, 232);
});

test('filters out low resolutions below 480p while preserving the deduped list', () => {
  const formats = [
    { formatId: 602, resolution: '144p', ext: 'mp4', hasVideo: true, hasAudio: false },
    { formatId: 269, resolution: '240p', ext: 'mp4', hasVideo: true, hasAudio: false },
    { formatId: 134, resolution: '360p', ext: 'mp4', hasVideo: true, hasAudio: false },
    { formatId: 135, resolution: '480p', ext: 'mp4', hasVideo: true, hasAudio: false },
    { formatId: 136, resolution: '720p', ext: 'mp4', hasVideo: true, hasAudio: false },
  ];

  const filtered = filterFormatsByMinimumResolution(formats, 480);
  assert.deepEqual(filtered.map((entry) => entry.resolution), ['480p', '720p']);
  assert.equal(filtered.length, 2);
});

test('derives an accurate megabyte estimate from yt-dlp byte fields', () => {
  const format = {
    filesize_approx: 1048576,
  };

  assert.equal(formatSizeMb(format), 1);
});

test('prefers the format with real file-size metadata when deduplicating resolutions', () => {
  const formats = [
    { formatId: 231, resolution: '480p', ext: 'mp4', hasVideo: true, hasAudio: false, sizeMb: 76, sizeBytes: null },
    { formatId: 135, resolution: '480p', ext: 'mp4', hasVideo: true, hasAudio: false, sizeMb: 34.56, sizeBytes: 36267746 },
  ];

  const deduped = dedupeFormatsByResolution(formats);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].formatId, 135);
  assert.equal(deduped[0].sizeBytes, 36267746);
});

test('rejects unsupported quality values', () => {
  assert.throws(() => videoSelector('source'), { code: 'INVALID_QUALITY' });
  assert.throws(() => legacyVideoSelector('source'), { code: 'INVALID_QUALITY' });
  assert.throws(() => explicitVideoSelector('137+https://bad'), { code: 'INVALID_FORMAT_ID' });
});
