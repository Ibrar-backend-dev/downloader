const test = require('node:test');
const assert = require('node:assert/strict');

const { getGenericDownloadError, isTransientFailure } = require('./downloadError');

test('returns a TikTok-specific generic error for TikTok failures', () => {
  const error = getGenericDownloadError('https://www.tiktok.com/@user/video/123', 'ERROR: TikTok requires login or the video is unavailable');
  assert.match(error, /TikTok download failed/i);
});

test('suggests browser cookies when TikTok blocks webpage hydration', () => {
  const error = getGenericDownloadError('https://www.tiktok.com/@user/video/123', 'Unable to extract universal data for rehydration');
  assert.match(error, /YTDLP_COOKIES_FROM_BROWSER/i);
});

test('explains how to recover when Chrome cookies are locked', () => {
  const error = getGenericDownloadError('https://www.tiktok.com/@user/video/123', 'Could not copy Chrome cookie database');
  assert.match(error, /Close every Chrome window/i);
});

test('explains the cookie file workaround for Windows DPAPI failures', () => {
  const error = getGenericDownloadError('https://www.tiktok.com/@user/video/123', 'Failed to decrypt with DPAPI');
  assert.match(error, /YTDLP_COOKIES_FILE/i);
});

test('returns a generic fallback for non-TikTok failures', () => {
  const error = getGenericDownloadError('https://www.youtube.com/watch?v=abc', 'ERROR: This video is unavailable');
  assert.match(error, /Download failed/i);
});

test('returns a generic fallback when the process exits with failure code', () => {
  const error = getGenericDownloadError('https://example.com/video', '', 1);
  assert.match(error, /Download failed/i);
});

test('retries the TikTok rehydration failure, which clears on a second attempt', () => {
  assert.equal(isTransientFailure('ERROR: [TikTok] 123: Unable to extract universal data for rehydration'), true);
});

test('retries an unexpected webpage response', () => {
  assert.equal(isTransientFailure('ERROR: [TikTok] 123: Unexpected response from webpage request'), true);
});

test('retries server-side and network faults', () => {
  assert.equal(isTransientFailure('ERROR: unable to download video data: HTTP Error 503: Service Unavailable'), true);
  assert.equal(isTransientFailure('ERROR: Read timed out'), true);
});

test('does not retry a video that is private or removed', () => {
  assert.equal(isTransientFailure('ERROR: [TikTok] 123: This video is private'), false);
  assert.equal(isTransientFailure('ERROR: Video has been removed'), false);
});

test('does not retry a local cookie configuration problem', () => {
  assert.equal(isTransientFailure('ERROR: Could not copy Chrome cookie database'), false);
  assert.equal(isTransientFailure('ERROR: Failed to decrypt with DPAPI'), false);
});

test('does not retry an empty or unrecognised message', () => {
  assert.equal(isTransientFailure(''), false);
  assert.equal(isTransientFailure('ERROR: something nobody has seen before'), false);
});
