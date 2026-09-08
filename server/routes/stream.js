const express = require('express');
const { spawn } = require('child_process');
const { createLogger } = require('../utils/logger');
const { createTracer, createLineSplitter } = require('../utils/ytdlpTrace');
const { isTransientFailure } = require('../utils/downloadError');
const { isTikTokUrl, accessArgs } = require('../utils/ytdlpAccess');
const { spawnYtDlp } = require('../utils/ytdlpProcess');
const { videoSelector } = require('../utils/formatSelection');
const router = express.Router();

let requestCounter = 0;
const nextId = (prefix) => `${prefix}-${Date.now().toString(36)}-${++requestCounter}`;

// TikTok's challenge makes extraction intermittent, so an empty pipe is worth
// another try before giving up on the request.
const MAX_ATTEMPTS = Number(process.env.YTDLP_MAX_ATTEMPTS || 3);
const RETRY_DELAY_MS = Number(process.env.YTDLP_RETRY_DELAY_MS || 2000);

const humanBytes = (n) => {
  if (!n) return '0B';
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / Math.pow(1024, i)).toFixed(2)}${units[i]}`;
};

// Video+audio are separate streams on most modern platforms, so ask for the
// best of each and let yt-dlp fall back to a pre-merged file when one exists.
const selFor = (q) => videoSelector(q);

const isHttp = (u) => /^https?:\/\//i.test(u || '');
const safeName = (s) =>
  String(s || 'download').replace(/[\/:*?"<>|\r\n]/g, '_').trim().slice(0, 120) || 'download';

// Optional: set FFMPEG_LOCATION if ffmpeg is not on the server's PATH.
const ffmpegArgs = process.env.FFMPEG_LOCATION
  ? ['--ffmpeg-location', process.env.FFMPEG_LOCATION]
  : [];

const resolveError = (res, statusCode, code, message, details) => res.status(statusCode).json({
  success: false,
  status: 'error',
  data: null,
  error: {
    code,
    message,
    ...(details ? { details } : {}),
  },
});

// GET /api/resolve?url=...&quality=360
// Returns what to download and where to fetch it, without transferring media.
router.get('/resolve', async (req, res) => {
  const { url, quality = '360' } = req.query;
  const log = createLogger('resolve', nextId('rs'));

  log.info('request.received', { url, quality, tiktok: isTikTokUrl(url), ip: req.ip });

  if (!isHttp(url)) {
    log.warn('validate.rejected', { reason: 'bad-url-format', url });
    return resolveError(res, 400, 'INVALID_URL', 'Provide a valid http(s) URL.');
  }

  let selector;
  try {
    selector = selFor(quality);
  } catch (error) {
    if (error.code === 'INVALID_QUALITY') {
      return resolveError(res, 400, error.code, error.message);
    }
    throw error;
  }

  const argv = [
    '-f', selector, '-J', '--no-playlist',
    ...(await accessArgs(url, log)), ...ffmpegArgs, url,
  ];
  log.info('ytdlp.args', { selector, argv });

  const startedAt = Date.now();
  const yt = spawnYtDlp(argv);
  log.info('ytdlp.spawned', { pid: yt.pid });

  let out = '', err = '';
  yt.stdout.on('data', (d) => (out += d));
  yt.stderr.on('data', (d) => {
    err += d;
    // Extraction messages arrive here; log each line so a stall is visible.
    for (const line of d.toString().split(/\r?\n/)) {
      if (line.trim()) log.debug('ytdlp.stderr', { line: line.trim() });
    }
  });

  yt.on('error', (e) => {
    log.error('ytdlp.spawn-failed', {
      code: e.code,
      message: e.message,
      hint: e.code === 'ENOENT' ? 'yt-dlp is not on the server PATH' : undefined,
    });
    resolveError(res, 500, 'YTDLP_UNAVAILABLE', 'yt-dlp could not be started.', e.message);
  });

  yt.on('close', (code) => {
    const durationMs = Date.now() - startedAt;
    log.info('ytdlp.exited', { code, durationMs, stdoutBytes: out.length, stderrBytes: err.length });

    if (res.headersSent) return;
    if (code !== 0) {
      log.error('resolve.failed', {
        stage: 'extraction',
        diagnosis: 'yt-dlp could not extract metadata; nothing was downloaded',
        exitCode: code,
        durationMs,
        stderr: err.trim().slice(-800),
      });
      return resolveError(res, 502, 'EXTRACTION_FAILED', 'The video could not be extracted.', err.trim().slice(-400));
    }

    let info;
    try {
      // --dump-json emits one object per line for multi-video posts.
      info = out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    } catch (e) {
      log.error('resolve.failed', {
        stage: 'parse',
        diagnosis: 'yt-dlp exited 0 but its JSON output could not be parsed',
        message: e.message,
        stdoutHead: out.trim().slice(0, 300),
      });
      return resolveError(res, 502, 'INVALID_EXTRACTOR_RESPONSE', 'The extractor returned invalid data.', e.message);
    }

    const downloads = info.map((entry, i) => {
      const dl = (entry.requested_downloads && entry.requested_downloads[0]) || {};
      const parts = dl.requested_formats || [dl];
      const needsMerge = parts.length > 1;
      // Always delivered as MP4: yt-dlp writes Matroska to the pipe and ffmpeg
      // remuxes it into a fragmented MP4, which is the only MP4 flavour that
      // can be written to a non-seekable stream.
      const ext = 'mp4';
      const filename = `${safeName(entry.title)}.${ext}`;
      return {
        filename,
        ext,
        needsMerge,
        duration: entry.duration || null,
        url: `/api/stream?url=${encodeURIComponent(url)}&quality=${encodeURIComponent(quality)}`
           + `&index=${i}&name=${encodeURIComponent(filename)}`,
      };
    });

    log.info('resolve.ready', {
      title: info[0] && info[0].title,
      extractor: info[0] && info[0].extractor,
      count: downloads.length,
      needsMerge: downloads.some((d) => d.needsMerge),
      durationMs,
    });

    const primary = info[0] || {};
    const media = {
      id: primary.id || null,
      title: primary.title || 'Untitled video',
      description: primary.description || '',
      duration: primary.duration || null,
      uploader: primary.uploader || primary.channel || null,
      thumbnail: primary.thumbnail || null,
      webpageUrl: primary.webpage_url || url,
      extractor: primary.extractor || null,
    };
    const primaryDownload = downloads[0] || null;

    res.json({
      success: true,
      status: 'ready',
      message: downloads.length === 1
        ? 'Video is ready to download.'
        : `${downloads.length} videos are ready to download.`,
      error: null,
      data: {
        media,
        download: primaryDownload,
        items: downloads,
      },
      // Temporary compatibility alias for clients using the previous payload.
      downloads,
      title: media.title,
      extractor: media.extractor,
      count: downloads.length,
    });
  });
});

// GET /api/stream?url=...&quality=360&name=...&index=0
// Streams the media straight through. Nothing is written to disk.
router.get('/stream', async (req, res) => {
  const { url, quality = '360', name, index } = req.query;
  const log = createLogger('stream', nextId('st'));

  log.info('request.received', { url, quality, index, name, tiktok: isTikTokUrl(url), ip: req.ip });

  if (!isHttp(url)) {
    log.warn('validate.rejected', { reason: 'bad-url-format', url });
    return res.status(400).send('Invalid URL format.');
  }

  const args = [
    '-f', selFor(quality),
    '-o', '-',
    '--merge-output-format', 'mkv',
    '--no-playlist',
    // Progress is forced on and newline-delimited because stdout carries the
    // media here: every status line arrives on stderr, where the tracer reads
    // it. Warnings are kept -- they usually name the reason a transfer stalls.
    '--progress',
    '--newline',
    ...(await accessArgs(url, log)),
    ...ffmpegArgs,
  ];
  if (process.env.YTDLP_VERBOSE === '1') args.push('--verbose');
  // Multi-video posts (an Instagram carousel) expose each entry by position.
  if (index !== undefined && index !== '') {
    args.push('--playlist-items', String(Number(index) + 1));
  }
  args.push(url);

  const filename = safeName(name || 'download.mp4');
  const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

  // MP4 cannot be written to a pipe the normal way (the moov atom needs a
  // backwards seek), so we emit fragmented MP4. Two attempts:
  //   1. -c copy      remux only. No quality loss, negligible CPU. Works when
  //                   the source is already H.264/AAC, which is most platforms.
  //   2. re-encode    for codecs MP4 cannot carry (Theora/Vorbis from
  //                   Archive.org) or malformed AAC bitstreams. Costs CPU.
  const ffArgsFor = (reencode) => reencode
    ? ['-v', 'error', '-i', 'pipe:0',
       '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
       '-c:a', 'aac', '-b:a', '128k',
       '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1']
    : ['-v', 'error', '-i', 'pipe:0', '-c', 'copy',
       '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1'];

  let sent = 0;
  let finished = false;
  let current = null;
  let extractionTries = 0;

  const cleanup = () => {
    if (!current) return;
    const { yt, ff } = current;
    if (yt && !yt.killed) yt.kill('SIGKILL');
    if (ff && !ff.killed) ff.kill('SIGKILL');
  };

  const attempt = (reencode) => {
    const mode = reencode ? 're-encode' : 'copy';
    extractionTries += 1;
    const attemptLog = log.child(mode);
    const startedAt = Date.now();

    attemptLog.info('attempt.start', { mode, ytdlpArgs: args, ffmpegArgs: ffArgsFor(reencode) });

    const yt = spawnYtDlp(args);
    const ff = spawn(FFMPEG, ffArgsFor(reencode));
    current = { yt, ff };

    attemptLog.info('processes.spawned', { ytdlpPid: yt.pid, ffmpegPid: ff.pid });

    // Byte counters on each hop separate "yt-dlp produced nothing" from
    // "ffmpeg rejected what yt-dlp produced" from "the client hung up".
    let ytBytes = 0;
    let ytExit = null;
    let ffExit = null;
    let ffmpegStderr = '';

    yt.stdout.on('data', (chunk) => { ytBytes += chunk.length; });
    yt.stdout.pipe(ff.stdin);

    // Only send bytes onward; do not end the response until ffmpeg closes,
    // so a failed first attempt can still be retried.
    ff.stdout.on('data', (chunk) => {
      if (finished) return;
      if (sent === 0) {
        attemptLog.info('response.first-byte', { ytdlpBytesSoFar: ytBytes, afterMs: Date.now() - startedAt });
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${filename.replace(/"/g, '')}"; ` +
          `filename*=UTF-8''${encodeURIComponent(filename)}`
        );
      }
      sent += chunk.length;
      res.write(chunk);
    });

    // yt-dlp writes progress to stderr when stdout is the media pipe, so the
    // tracer gets the full picture from stderr alone here.
    const tracer = createTracer({ logger: attemptLog });
    yt.stderr.on('data', (d) => tracer.feedStderr(d));

    const ffSplitter = createLineSplitter((line) => {
      ffmpegStderr += line + '\n';
      attemptLog.error('ffmpeg.stderr', { line });
    });
    ff.stderr.on('data', (d) => ffSplitter.feed(d.toString()));

    // yt-dlp finishing before ffmpeg drains is normal.
    yt.stdout.on('error', () => {});
    ff.stdin.on('error', () => {});
    yt.on('error', (e) => {
      attemptLog.error('ytdlp.spawn-failed', {
        code: e.code,
        message: e.message,
        hint: e.code === 'ENOENT' ? 'yt-dlp is not on the server PATH' : undefined,
      });
    });

    yt.on('close', (code, signal) => {
      ytExit = code;
      tracer.flush();
      const state = tracer.snapshot();
      attemptLog.info('ytdlp.exited', {
        code,
        signal,
        bytesToFfmpeg: ytBytes,
        human: humanBytes(ytBytes),
        furthestStage: state.furthestStage,
        percent: state.percent,
        extractor: state.extractor,
        formats: state.formats,
      });
      if (code !== 0) {
        attemptLog.error('ytdlp.failed', {
          diagnosis: tracer.describeFailure(code),
          exitCode: code,
          percentReached: state.percent,
          errors: state.errors,
          lastLine: state.lastLine,
        });
      }
    });

    ff.on('error', (e) => {
      attemptLog.error('ffmpeg.spawn-failed', {
        code: e.code,
        message: e.message,
        hint: e.code === 'ENOENT' ? `ffmpeg not found at "${FFMPEG}" (set FFMPEG_PATH)` : undefined,
      });
      if (!finished && !res.headersSent) { finished = true; res.status(500).end(); }
    });

    ff.on('close', (code) => {
      ffExit = code;
      const durationMs = Date.now() - startedAt;
      const ytState = tracer.snapshot();

      attemptLog.info('ffmpeg.exited', {
        code,
        durationMs,
        bytesIn: ytBytes,
        bytesOut: sent,
        humanOut: humanBytes(sent),
      });

      if (finished) {
        attemptLog.debug('attempt.ignored', { reason: 'response already finished' });
        return;
      }

      if (code === 0 && sent > 0) {
        finished = true;
        attemptLog.info('stream.completed', {
          mode,
          bytesSent: sent,
          human: humanBytes(sent),
          durationMs,
        });
        return res.end();
      }

      // Nothing delivered yet, so a retry is still safe. Which retry depends on
      // which hop broke: an empty pipe means yt-dlp never got the media, and
      // re-encoding nothing would only burn CPU and hide the real error --
      // that case wants the same cheap copy mode again. Re-encoding is only
      // the answer when yt-dlp did deliver bytes that ffmpeg could not remux.
      if (sent === 0) {
        const extractionFailed = ytBytes === 0;

        if (extractionFailed) {
          const retryable = isTransientFailure(ytState.errors.join(' '));
          if (retryable && extractionTries < MAX_ATTEMPTS) {
            attemptLog.warn('attempt.retrying', {
              reason: 'yt-dlp produced no bytes (extraction failed, not a codec problem)',
              retryMode: mode,
              try: extractionTries,
              of: MAX_ATTEMPTS,
              ytdlpExit: ytExit,
              ytdlpStage: ytState.furthestStage,
            });
            cleanup();
            return setTimeout(() => {
              if (!finished) attempt(reencode);
            }, RETRY_DELAY_MS);
          }
        } else if (!reencode) {
          attemptLog.warn('attempt.retrying', {
            reason: 'ffmpeg copy produced no output from ' + humanBytes(ytBytes) + ' of input',
            retryMode: 're-encode',
            ffmpegExit: code,
            ytdlpExit: ytExit,
          });
          cleanup();
          return attempt(true);
        }
      }

      finished = true;
      // Attribute the failure to whichever hop actually broke.
      const diagnosis = ytBytes === 0
        ? 'yt-dlp delivered no media bytes: ' + tracer.describeFailure(ytExit)
        : sent === 0
          ? 'yt-dlp delivered ' + humanBytes(ytBytes) + ' but ffmpeg produced no output (unsupported codec or malformed stream)'
          : 'stream broke mid-transfer after sending ' + humanBytes(sent);

      attemptLog.error('stream.failed', {
        diagnosis,
        mode,
        ytdlpExit: ytExit,
        ffmpegExit: ffExit,
        ytdlpStage: ytState.furthestStage,
        percentReached: ytState.percent,
        bytesFromYtdlp: ytBytes,
        bytesSentToClient: sent,
        durationMs,
        ytdlpErrors: ytState.errors,
        ffmpegStderr: ffmpegStderr.trim().slice(-600) || null,
        headersSent: res.headersSent,
      });

      if (!res.headersSent) return res.status(502).end();
      res.end();
    });
  };

  req.on('close', () => {
    if (!finished) {
      log.warn('client.disconnected', { bytesSent: sent, human: humanBytes(sent) });
    }
    finished = true;
    cleanup();
  });

  attempt(false);

});

module.exports = router;
