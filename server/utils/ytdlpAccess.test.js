const test = require('node:test');
const assert = require('node:assert/strict');

const { accessArgs, isFacebookUrl, isTikTokUrl } = require('./ytdlpAccess');

test('detects Facebook and TikTok URLs', () => {
  assert.equal(isFacebookUrl('https://www.facebook.com/reel/123'), true);
  assert.equal(isFacebookUrl('https://fb.watch/abc'), true);
  assert.equal(isTikTokUrl('https://www.tiktok.com/@user/video/123'), true);
});

test('adds browser headers and Facebook cookies only for Facebook', async () => {
  const originalBrowser = process.env.YTDLP_FACEBOOK_COOKIES_FROM_BROWSER;
  const originalFile = process.env.YTDLP_FACEBOOK_COOKIES_FILE;
  process.env.YTDLP_FACEBOOK_COOKIES_FROM_BROWSER = 'chrome';
  delete process.env.YTDLP_FACEBOOK_COOKIES_FILE;

  try {
    const facebookArgs = await accessArgs('https://www.facebook.com/reel/123');
    assert.deepEqual(facebookArgs.slice(0, 6), [
      '--user-agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      '--add-header',
      'Accept-Language:en-US,en;q=0.9',
      '--cookies-from-browser',
      'chrome',
    ]);

    const youtubeArgs = await accessArgs('https://www.youtube.com/watch?v=abc');
    assert.equal(youtubeArgs.includes('--cookies-from-browser'), false);
  } finally {
    if (originalBrowser === undefined) delete process.env.YTDLP_FACEBOOK_COOKIES_FROM_BROWSER;
    else process.env.YTDLP_FACEBOOK_COOKIES_FROM_BROWSER = originalBrowser;
    if (originalFile === undefined) delete process.env.YTDLP_FACEBOOK_COOKIES_FILE;
    else process.env.YTDLP_FACEBOOK_COOKIES_FILE = originalFile;
  }
});
