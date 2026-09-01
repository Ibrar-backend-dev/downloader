// Platform matrix test: drives the app's own /api/download + Socket.IO, like the browser does.
const path = require('path');
const fs = require('fs');
const { io } = require(path.join(__dirname, 'client/node_modules/socket.io-client'));

const API = 'http://127.0.0.1:5000';
const DL  = path.join(__dirname, 'downloads');
const PER_URL_TIMEOUT_MS = 120000;

const TESTS = [
  ['YouTube',     'https://www.youtube.com/watch?v=BaW_jenozKc',                              'yt-dlp project test video'],
  ['YouTube',     'https://www.youtube.com/watch?v=aqz-KE-bpKQ',                              'Big Buck Bunny (official, CC-BY)'],
  ['Vimeo',       'https://vimeo.com/147365861',                                              'from repo TEST_URLS.md'],
  ['Archive.org', 'https://archive.org/details/Cops1922',                                     'Buster Keaton, public domain'],
  ['Dailymotion', 'https://www.dailymotion.com/video/x2iuewm',                                'IGN news clip'],
  ['SoundCloud',  'https://soundcloud.com/jaimemf/youtube-dl-test-video-a-y-baw/s-8Pjrp',     'yt-dlp test track (audio)'],
  ['Streamable',  'https://streamable.com/moo',                                               'yt-dlp test clip'],
  ['Reddit',      'https://www.reddit.com/r/videos/comments/6rrwyj/that_small_heart_attack/', 'r/videos post'],
  ['TikTok',      'https://www.tiktok.com/@patroxofficial/video/6742501081818877190',         'yt-dlp test post'],
  ['X / Twitter', 'https://twitter.com/starwars/status/665052190608723968',                   'official Star Wars account'],
  ['Instagram',   'https://www.instagram.com/p/BQ0eAlwhDrw/',                                 'yt-dlp test post'],
  ['Facebook',    'https://www.facebook.com/radiokicksfm/videos/3676516585958356/',           'yt-dlp test post'],
  ['Twitch',      'https://clips.twitch.tv/FaintLightGullWholeWheat',                         'clip, yt-dlp test'],
  ['BiliBili',    'https://www.bilibili.com/video/BV13x41117TL',                              'yt-dlp test video'],
  ['Pinterest',   'https://www.pinterest.com/pin/664281013778109217/',                        'yt-dlp test pin'],
];

const snap = () => { try { return new Set(fs.readdirSync(DL)); } catch { return new Set(); } };
const results = [];

const socket = io(API, { transports: ['websocket'] });

socket.on('connect', async () => {
  console.log('[harness] socket connected:', socket.id);

  for (const [platform, url, note] of TESTS) {
    const before = snap();
    const t0 = Date.now();
    let settled = false, stderrFirst = null, lastProgress = 0, myId = null;

    const outcome = await new Promise(async (resolve) => {
      const timer = setTimeout(() => {
        if (!settled) { settled = true; resolve({ status: 'timeout', detail: `no terminal event in ${PER_URL_TIMEOUT_MS/1000}s` }); }
      }, PER_URL_TIMEOUT_MS);

      const onProgress = (d) => { if (d.id === myId && d.progress) lastProgress = d.progress; };
      const onComplete = (d) => {
        if (settled || d.id !== myId) return;
        settled = true; clearTimeout(timer); resolve({ status: 'completed', detail: '' });
      };
      const onError = (d) => {
        if (settled || d.id !== myId) return;
        const msg = (d.error || '').trim();
        // The server emits download-error on ANY stderr byte, incl. harmless warnings.
        // Only a non-zero process exit is genuinely terminal.
        if (/Process exited with code/i.test(msg)) {
          settled = true; clearTimeout(timer);
          resolve({ status: 'error', detail: stderrFirst || msg });
        } else if (!stderrFirst) {
          stderrFirst = msg.split('\n').filter(Boolean).slice(0, 2).join(' | ');
        }
      };

      socket.on('download-progress', onProgress);
      socket.on('download-complete', onComplete);
      socket.on('download-error', onError);

      try {
        const res = await fetch(`${API}/api/download`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, quality: '360', audioOnly: false }),
        });
        const j = await res.json();
        if (!res.ok || !j.downloadId) {
          settled = true; clearTimeout(timer);
          return resolve({ status: 'error', detail: `HTTP ${res.status}: ${j.error || 'no downloadId'}` });
        }
        myId = j.downloadId;
      } catch (e) {
        settled = true; clearTimeout(timer);
        return resolve({ status: 'error', detail: `POST failed: ${e.message}` });
      }
    });

    const secs = ((Date.now() - t0) / 1000);
    const after = snap();
    const newFiles = [...after].filter((f) => !before.has(f));
    let bytes = 0;
    for (const f of newFiles) { try { bytes += fs.statSync(path.join(DL, f)).size; } catch {} }

    results.push({ platform, url, note, status: outcome.status, detail: outcome.detail,
                   seconds: secs, files: newFiles, bytes, warning: stderrFirst, lastProgress });
    console.log(`[${outcome.status.toUpperCase().padEnd(9)}] ${platform.padEnd(12)} ${secs.toFixed(1)}s  ${(bytes/1048576).toFixed(1)}MB  ${newFiles[0] || outcome.detail.slice(0,90)}`);

    socket.removeAllListeners('download-progress');
    socket.removeAllListeners('download-complete');
    socket.removeAllListeners('download-error');
  }

  fs.writeFileSync(path.join(__dirname, 'platform-test-results.json'), JSON.stringify(results, null, 2));
  console.log('[harness] wrote platform-test-results.json');
  socket.close();
  process.exit(0);
});

socket.on('connect_error', (e) => { console.error('[harness] socket connect_error:', e.message); process.exit(1); });
