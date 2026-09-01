#!/usr/bin/env node
// Watch Seal Web App download events from the terminal.
//   node watch.js                  -> just listen
//   node watch.js <url> [quality]  -> start a download, then listen until it ends
//
// Progress and completion arrive over Socket.IO, which REST clients cannot see.
const path = require('path');
const { io } = require(path.join(__dirname, 'client/node_modules/socket.io-client'));

const API = process.env.SEAL_API || 'http://127.0.0.1:5000';
const [url, quality = '360'] = process.argv.slice(2);

const bar = (pct) => {
  const w = 28, f = Math.round((pct / 100) * w);
  return '[' + '#'.repeat(f) + '-'.repeat(w - f) + ']';
};

const socket = io(API, { transports: ['websocket'] });
let lastLine = '';

socket.on('connect', async () => {
  console.log(`connected to ${API}  (ctrl+c to quit)\n`);
  if (!url) { console.log('listening for events from any client...\n'); return; }

  try {
    const res = await fetch(`${API}/api/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, quality, audioOnly: false }),
    });
    const j = await res.json();
    if (!res.ok) { console.error(`start failed: HTTP ${res.status} ${j.error || ''}`); process.exit(1); }
    console.log(`started  id=${j.downloadId}\n`);
  } catch (e) {
    console.error(`cannot reach ${API} - is the server running?  (${e.message})`);
    process.exit(1);
  }
});

socket.on('download-start', (d) => console.log(`start    ${d.url}`));

socket.on('download-progress', (d) => {
  lastLine = `${bar(d.progress)} ${String(d.progress).padStart(5)}%  ${d.filename || ''}`;
  process.stdout.write('\r' + lastLine.padEnd(80));
});

socket.on('download-complete', (d) => {
  if (lastLine) process.stdout.write('\r' + ' '.repeat(82) + '\r');
  console.log(`DONE     ${d.filename || '(name not captured)'}`);
  if (url) process.exit(0);
});

// The server emits this for plain warnings too, so a non-zero exit is the only
// signal that actually means the download failed.
socket.on('download-error', (d) => {
  const msg = (d.error || '').trim().split('\n')[0];
  const fatal = /Process exited with code/i.test(msg);
  if (lastLine) process.stdout.write('\r' + ' '.repeat(82) + '\r');
  console.log(`${fatal ? 'FAILED  ' : 'warn    '} ${msg.slice(0, 140)}`);
  if (fatal && url) process.exit(1);
});

socket.on('connect_error', (e) => {
  console.error(`connect failed: ${e.message}\nIs the backend running?  node server/index.js`);
  process.exit(1);
});
