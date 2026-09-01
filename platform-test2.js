// Run 2: fresh pre-validated URLs, app code unchanged, curl_cffi now installed.
const path = require('path');
const fs = require('fs');
const { io } = require(path.join(__dirname, 'client/node_modules/socket.io-client'));

const API = 'http://127.0.0.1:5000';
const DL  = path.join(__dirname, 'downloads');
const TIMEOUT = 240000;

// [platform, url, note, urlState, mediaDurationSec|null]
const TESTS = [
  ['YouTube',     'https://www.youtube.com/watch?v=aqz-KE-bpKQ',                                             'Blender, official CC-BY',  'reused-live', null],
  ['Vimeo',       'https://vimeo.com/channels/staffpicks/1219875917',                                        'current Staff Pick',       'new',   952],
  ['Dailymotion', 'https://www.dailymotion.com/video/xb15rv6',                                               'Euronews channel',         'new',   704],
  ['SoundCloud',  'https://soundcloud.com/royalty-free-cc/inspiring-piano-royalty-free-creative-commons',     'royalty-free CC track',    'new',   34.1],
  ['BiliBili',    'http://www.bilibili.com/video/av328441986',                                               'Blender open-movie OST',   'new',   128],
  ['Twitch',      'https://www.twitch.tv/nasa/clip/BlazingElatedCormorantPeteZaroll-bo6L3GRfrEmgos9C',       'NASA clip',                'new',   8],
  ['Archive.org', 'https://archive.org/details/Cops1922',                                                    'Keaton, public domain',    'reused-live', 1092],
  ['Reddit',      'https://www.reddit.com/r/videos/comments/6rrwyj/that_small_heart_attack/',                'r/videos post',            'reused-live', 12],
  ['Streamable',  'https://streamable.com/moo',                                                              'test clip',                'reused-live', 12],
  ['Instagram',   'https://www.instagram.com/p/BQ0eAlwhDrw/',                                                'short clip',               'reused-live', null],
  ['Pinterest',   'https://www.pinterest.com/pin/664281013778109217/',                                       'Origami pin',              'reused-live', 57.7],
];

const snap = () => { try { return new Set(fs.readdirSync(DL)); } catch { return new Set(); } };
const results = [];
const socket = io(API, { transports: ['websocket'] });

socket.on('connect', async () => {
  console.log('[run2] connected', socket.id, '\n');
  for (const [platform, url, note, urlState, dur] of TESTS) {
    const before = snap();
    const t0 = Date.now();
    let settled = false, warn = null, myId = null, maxPct = 0, nProg = 0;

    const outcome = await new Promise(async (resolve) => {
      const timer = setTimeout(() => {
        if (!settled) { settled = true; resolve({ status: 'timeout', detail: `no terminal event in ${TIMEOUT/1000}s` }); }
      }, TIMEOUT);
      const onProg = (d) => { if (d.id === myId && d.progress) { nProg++; maxPct = Math.max(maxPct, d.progress); } };
      const onDone = (d) => { if (!settled && d.id === myId) { settled = true; clearTimeout(timer); resolve({ status: 'completed', detail: '' }); } };
      const onErr  = (d) => {
        if (settled || d.id !== myId) return;
        const m = (d.error || '').trim();
        if (/Process exited with code/i.test(m)) { settled = true; clearTimeout(timer); resolve({ status: 'error', detail: warn || m }); }
        else if (!warn) warn = m.split('\n').filter(Boolean).slice(0,2).join(' | ');
      };
      socket.on('download-progress', onProg);
      socket.on('download-complete', onDone);
      socket.on('download-error', onErr);
      try {
        const res = await fetch(`${API}/api/download`, {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ url, quality: '360', audioOnly: false }),
        });
        const j = await res.json();
        if (!res.ok || !j.downloadId) { settled = true; clearTimeout(timer); return resolve({status:'error', detail:`HTTP ${res.status}: ${j.error||'no id'}`}); }
        myId = j.downloadId;
      } catch (e) { settled = true; clearTimeout(timer); return resolve({status:'error', detail:`POST failed: ${e.message}`}); }
    });

    const secs = (Date.now() - t0) / 1000;
    const newFiles = [...snap()].filter(f => !before.has(f));
    let bytes = 0;
    for (const f of newFiles) { try { bytes += fs.statSync(path.join(DL, f)).size; } catch {} }
    const mb = bytes / 1048576;
    const mbps = secs > 0 ? mb / secs : 0;
    const secPerMin = dur ? secs / (dur / 60) : null;

    results.push({ platform, url, note, urlState, status: outcome.status, detail: outcome.detail,
                   seconds: +secs.toFixed(1), bytes, mb: +mb.toFixed(2), mbps: +mbps.toFixed(2),
                   mediaDuration: dur, secPerMinMedia: secPerMin ? +secPerMin.toFixed(1) : null,
                   files: newFiles, warning: warn, progressEvents: nProg, maxPct });
    console.log(`[${outcome.status.toUpperCase().padEnd(9)}] ${platform.padEnd(12)} ${secs.toFixed(1).padStart(6)}s ${mb.toFixed(1).padStart(6)}MB ${mbps.toFixed(2).padStart(5)}MB/s prog=${String(nProg).padStart(3)} ${newFiles[0] || outcome.detail.slice(0,80)}`);

    socket.removeAllListeners('download-progress');
    socket.removeAllListeners('download-complete');
    socket.removeAllListeners('download-error');
  }
  fs.writeFileSync('run2-results.json', JSON.stringify(results, null, 2));
  console.log('\n[run2] wrote run2-results.json');
  socket.close(); process.exit(0);
});
socket.on('connect_error', e => { console.error('[run2] connect_error', e.message); process.exit(1); });
