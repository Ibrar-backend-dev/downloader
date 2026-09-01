const { spawn } = require('child_process');

// On Windows, Python writes to a pipe using the console codepage, which drops
// every character the codepage cannot represent -- emoji and accents vanish
// from the reported filename, so the name shown in the UI (and passed back to
// the delete endpoint) no longer matches the file on disk. Forcing UTF-8 keeps
// the parsed output byte-faithful to what yt-dlp actually wrote.
function ytdlpEnv(extra) {
  return Object.assign({}, process.env, {
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
  }, extra);
}

function spawnYtDlp(args, options) {
  return spawn('yt-dlp', args, Object.assign({}, options, { env: ytdlpEnv(options && options.env) }));
}

module.exports = { spawnYtDlp, ytdlpEnv };
