const { spawnYtDlp } = require('./ytdlpProcess');
const { createLogger } = require('./logger');

// TikTok fingerprints the TLS handshake. Without curl_cffi installed, yt-dlp
// connects with Python's own TLS stack, TikTok answers with a JS challenge,
// and the challenge response is rejected -- extraction then dies with
// "Unable to extract universal data for rehydration" before a byte is fetched.
// `--impersonate` is only valid when curl_cffi supplies a target, so probe once
// at startup and cache the answer for the life of the process.

let probePromise = null;

function runProbe() {
  return new Promise((resolve) => {
    const log = createLogger('capabilities');
    const child = spawnYtDlp(['--list-impersonate-targets']);

    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));

    child.on('error', (error) => {
      log.error('probe.failed', { code: error.code, message: error.message });
      resolve({ impersonate: false, targets: [], reason: error.message });
    });

    child.on('close', (code) => {
      // Rows look like "Chrome-131      Android-14   curl_cffi".
      const targets = out
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /\bcurl_cffi\b/.test(line))
        .map((line) => line.split(/\s+/)[0])
        .filter(Boolean);

      const impersonate = code === 0 && targets.length > 0;
      if (impersonate) {
        log.info('impersonation.available', { targetCount: targets.length, sample: targets.slice(0, 3) });
      } else {
        log.warn('impersonation.unavailable', {
          exitCode: code,
          hint: 'install curl_cffi (pip install "yt-dlp[default,curl-cffi]") -- TikTok extraction will be unreliable without it',
        });
      }

      resolve({ impersonate, targets, reason: impersonate ? null : 'no curl_cffi targets' });
    });
  });
}

function getCapabilities() {
  if (!probePromise) probePromise = runProbe();
  return probePromise;
}

// Returns the flags to append, or [] when impersonation is not supported.
async function impersonateArgs(target) {
  const caps = await getCapabilities();
  if (!caps.impersonate) return [];
  return ['--impersonate', target || process.env.YTDLP_IMPERSONATE || 'chrome'];
}

module.exports = { getCapabilities, impersonateArgs };
