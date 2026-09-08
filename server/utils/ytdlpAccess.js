const { impersonateArgs } = require('./ytdlpCapabilities');

function isTikTokUrl(url = '') {
  return /(?:^|\.)tiktok\.com|ttok\.video/i.test(url);
}

function isFacebookUrl(url = '') {
  return /(?:^|\.)facebook\.com|fb\.watch/i.test(url);
}

const browserUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function baseAccessArgs() {
  return [
    '--user-agent',
    browserUserAgent,
    '--add-header',
    'Accept-Language:en-US,en;q=0.9',
  ];
}

/**
 * The flags TikTok needs before it will serve anything, in one place so that
 * metadata lookups and downloads present the same identity. They have to match:
 * TikTok fingerprints the TLS handshake as well as the headers, and a request
 * that gets either half wrong is answered with a JS challenge that fails
 * extraction before any media is fetched.
 *
 * Async because impersonation support is probed once, then cached.
 */
async function accessArgs(url, log, runtimeOptions = {}) {
  const tiktok = isTikTokUrl(url);
  const facebook = isFacebookUrl(url);
  if (!tiktok && !facebook) return baseAccessArgs();

  const args = baseAccessArgs();

  if (tiktok) {
    const impersonate = await impersonateArgs();
    if (impersonate.length) {
      args.push(...impersonate);
      if (log) log.info('impersonation.enabled', { target: impersonate[1] });
    } else if (log) {
      log.warn('impersonation.unavailable', {
        note: 'curl_cffi missing; TikTok extraction will fail intermittently',
      });
    }
  }

  const browserCookieSource = (
    runtimeOptions.cookiesFromBrowser
    || (tiktok ? process.env.YTDLP_COOKIES_FROM_BROWSER : process.env.YTDLP_FACEBOOK_COOKIES_FROM_BROWSER)
    || (facebook ? process.env.YTDLP_COOKIES_FROM_BROWSER : '')
    || ''
  ).trim();
  const fileCookieSource = (
    runtimeOptions.cookiesFile
    || (tiktok ? process.env.YTDLP_COOKIES_FILE : process.env.YTDLP_FACEBOOK_COOKIES_FILE)
    || (facebook ? process.env.YTDLP_COOKIES_FILE : '')
    || ''
  ).trim();

  // Cookies are optional and must be user-scoped. They should only be attached
  // when the request explicitly provides a valid browser or file-backed session.
  if (browserCookieSource && browserCookieSource !== 'none') {
    args.push('--cookies-from-browser', browserCookieSource);
    if (log) log.info('cookies.enabled', { source: 'browser', value: browserCookieSource });
  } else if (fileCookieSource && fileCookieSource !== 'none') {
    args.push('--cookies', fileCookieSource);
    if (log) log.info('cookies.enabled', { source: 'file', value: fileCookieSource });
  } else if (log && (tiktok || facebook)) {
    log.info('cookies.absent', { platform: tiktok ? 'TikTok' : 'Facebook' });
  }

  return args;
}

module.exports = { isTikTokUrl, isFacebookUrl, accessArgs };
