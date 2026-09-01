// Metadata-only probe: --dump-json needs no ffmpeg and no format matching.
// Separates "extractor/URL broken" from "app's format selector broken".
const fs = require('fs');
const API = 'http://127.0.0.1:5000';
const T = 90000;
const URLS = JSON.parse(fs.readFileSync('platform-test-results.json','utf8'))
  .map(r => [r.platform, r.url]);
(async () => {
  const out = [];
  for (const [platform, url] of URLS) {
    const t0 = Date.now();
    let status, detail = '', title = '', nFmt = 0;
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), T);
      const res = await fetch(`${API}/api/info?url=${encodeURIComponent(url)}`, { signal: ac.signal });
      clearTimeout(timer);
      const j = await res.json();
      if (res.ok && j.title !== undefined) {
        status = 'ok'; title = String(j.title).slice(0,60); nFmt = (j.formats||[]).length;
      } else {
        status = 'fail';
        detail = String(j.details || j.error || '').replace(/\s+/g,' ').slice(0,200);
      }
    } catch (e) {
      status = e.name === 'AbortError' ? 'timeout' : 'fail';
      detail = e.message;
    }
    const secs = (Date.now()-t0)/1000;
    out.push({ platform, url, status, secs, title, nFmt, detail });
    console.log(`[${status.padEnd(7)}] ${platform.padEnd(12)} ${secs.toFixed(1)}s fmts=${String(nFmt).padEnd(3)} ${title || detail.slice(0,100)}`);
  }
  fs.writeFileSync('info-probe-results.json', JSON.stringify(out,null,2));
  console.log('[probe] done');
})();
