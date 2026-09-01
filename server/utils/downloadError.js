function isTikTokUrl(url = '') {
  return /tiktok\.com|vm\.tiktok\.com|ttok\.video/i.test(url);
}

function normalizeYtDlpMessage(message = '') {
  return String(message)
    .replace(/\s+/g, ' ')
    .trim();
}

function getGenericDownloadError(url = '', rawMessage = '', exitCode = null) {
  const normalized = normalizeYtDlpMessage(rawMessage);

  if (isTikTokUrl(url) && normalized) {
    const lower = normalized.toLowerCase();
    if (lower.includes('login') || lower.includes('unavailable') || lower.includes('private') || lower.includes('blocked') || lower.includes('not available') || lower.includes('requires login') || lower.includes('copyright') || lower.includes('removed')) {
      return 'TikTok download failed. The video may be private, removed, or unavailable.';
    }

    if (lower.includes('universal data') || lower.includes('rehydration') || lower.includes('challenge')) {
      return 'TikTok download failed because TikTok blocked this request. Set YTDLP_COOKIES_FROM_BROWSER (for example, chrome) and try again.';
    }

    if (lower.includes('could not copy chrome cookie database')) {
      return 'TikTok download failed because Chrome cookies are locked. Close every Chrome window and retry, or configure YTDLP_COOKIES_FILE.';
    }

    if (lower.includes('failed to decrypt with dpapi')) {
      return 'TikTok download failed because Windows could not decrypt Chrome cookies. Export TikTok cookies to a Netscape cookie file and configure YTDLP_COOKIES_FILE.';
    }

    return 'TikTok download failed. The video could not be processed right now.';
  }

  if (exitCode !== null && exitCode !== 0) {
    return 'Download failed. Please check the URL or try again later.';
  }

  return 'Download failed. Please check the URL or try again later.';
}

// TikTok answers a share of requests with a JS challenge that yt-dlp's native
// solver cannot satisfy. The attempt dies during extraction, at 0%, and an
// identical request moments later usually succeeds -- so these two signatures
// are worth retrying. Anything describing the video itself is not.
const TRANSIENT_PATTERNS = [
  /unable to extract universal data for rehydration/i,
  /unexpected response from webpage request/i,
  /\bhttp error 5\d\d\b/i,
  /read timed out|connection reset|temporarily unavailable/i,
];

const PERMANENT_PATTERNS = [
  /private|removed|deleted|copyright/i,
  /requires login|log in|sign in/i,
  /not available in your country|geo/i,
  /could not copy .* cookie database|failed to decrypt with dpapi/i,
];

function isTransientFailure(rawMessage = '') {
  const normalized = normalizeYtDlpMessage(rawMessage);
  if (!normalized) return false;
  if (PERMANENT_PATTERNS.some((pattern) => pattern.test(normalized))) return false;
  return TRANSIENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

module.exports = {
  isTikTokUrl,
  normalizeYtDlpMessage,
  getGenericDownloadError,
  isTransientFailure,
};
