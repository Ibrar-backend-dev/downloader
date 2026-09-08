const express = require('express');
const { createLogger } = require('../utils/logger');
const { spawnYtDlp } = require('../utils/ytdlpProcess');
const { accessArgs } = require('../utils/ytdlpAccess');
const { isTransientFailure } = require('../utils/downloadError');
const router = express.Router();

let infoCounter = 0;

// Metadata lookups hit the same intermittent TikTok challenge as downloads, and
// this is the first call the UI makes, so a single failed attempt would look
// like an unsupported video.
const MAX_ATTEMPTS = Number(process.env.YTDLP_MAX_ATTEMPTS || 3);
const RETRY_DELAY_MS = Number(process.env.YTDLP_RETRY_DELAY_MS || 2000);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Runs yt-dlp once and resolves with its outcome rather than throwing, so the
// caller can decide whether the failure is worth another attempt.
function runYtDlp(args, log) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const ytdlp = spawnYtDlp(args);
    log.info('ytdlp.spawned', { pid: ytdlp.pid });

    let output = '';
    let error = '';
    let spawnFailed = null;

    ytdlp.stdout.on('data', (data) => {
      output += data.toString();
    });

    ytdlp.stderr.on('data', (data) => {
      error += data.toString();
      for (const line of data.toString().split(/\r?\n/)) {
        if (line.trim()) log.debug('ytdlp.stderr', { line: line.trim() });
      }
    });

    ytdlp.on('error', (spawnError) => {
      spawnFailed = spawnError;
      error = spawnError.message;
      log.error('ytdlp.spawn-failed', {
        code: spawnError.code,
        message: spawnError.message,
        hint: spawnError.code === 'ENOENT' ? 'yt-dlp is not on the server PATH' : undefined,
      });
    });

    ytdlp.on('close', (code) => {
      const durationMs = Date.now() - startedAt;
      log.info('ytdlp.exited', { code, durationMs, stdoutBytes: output.length, stderrBytes: error.length });
      resolve({ ok: code === 0 && !spawnFailed, code, output, error, spawnFailed, durationMs });
    });
  });
}

// Retries only the failures that clear on their own; a private or removed video
// fails the same way every time and is returned immediately.
async function runWithRetries(args, log) {
  let result = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    log.info('attempt.start', { attempt, of: MAX_ATTEMPTS });
    result = await runYtDlp(args, log.child(`try${attempt}`));
    if (result.ok) return result;

    const retryable = !result.spawnFailed && isTransientFailure(result.error);
    if (!retryable || attempt === MAX_ATTEMPTS) {
      log.warn('retry.stopped', {
        attempt,
        reason: result.spawnFailed
          ? 'yt-dlp could not be started'
          : retryable
            ? 'attempts exhausted'
            : 'failure is not transient',
      });
      return result;
    }

    log.warn('retry.scheduled', { afterAttempt: attempt, delayMs: RETRY_DELAY_MS });
    await delay(RETRY_DELAY_MS);
  }

  return result;
}

// GET /api/info?url=<video_url> - Get video information
router.get('/', async (req, res) => {
  const log = createLogger('info', `if-${++infoCounter}`);

  try {
    const { url } = req.query;
    log.info('request.received', { url, ip: req.ip });

    if (!url) {
      log.warn('validate.rejected', { reason: 'missing-url' });
      return res.status(400).json({ error: 'URL parameter is required' });
    }

    // Basic URL validation - let yt-dlp handle specific format validation
    const urlPattern = /^https?:\/\/.+/i;
    if (!urlPattern.test(url)) {
      log.warn('validate.rejected', { reason: 'bad-url-format', url });
      return res.status(400).json({ error: 'Invalid URL format. Please provide a valid HTTP/HTTPS URL.' });
    }

    const args = [
      '--dump-json',
      '--no-playlist',
      ...(await accessArgs(url, log)),
      url
    ];

    log.info('ytdlp.args', { argv: args });
    const result = await runWithRetries(args, log);

    if (!result.ok) {
      log.error('info.failed', {
        stage: 'extraction',
        diagnosis: 'yt-dlp could not extract metadata for this URL',
        exitCode: result.code,
        totalMs: log.elapsed(),
        stderr: result.error.trim().slice(-800),
      });
      return res.status(500).json({
        error: 'Failed to get video information',
        details: result.error
      });
    }

    let videoInfo;
    try {
      videoInfo = JSON.parse(result.output);
    } catch (parseError) {
      log.error('info.failed', {
        stage: 'parse',
        diagnosis: 'yt-dlp exited 0 but its JSON output could not be parsed',
        message: parseError.message,
        stdoutHead: result.output.trim().slice(0, 300),
      });
      return res.status(500).json({
        error: 'Failed to parse video information',
        details: parseError.message
      });
    }

    // Extract relevant information
    const formats = videoInfo.formats ? videoInfo.formats.map(format => ({
      format_id: format.format_id,
      ext: format.ext,
      quality: format.quality,
      filesize: format.filesize,
      filesize_approx: format.filesize_approx,
      width: format.width,
      height: format.height,
      fps: format.fps,
      vcodec: format.vcodec,
      acodec: format.acodec,
      format_note: format.format_note,
      has_video: format.vcodec && format.vcodec !== 'none',
      has_audio: format.acodec && format.acodec !== 'none'
    })) : [];

    const info = {
      id: videoInfo.id,
      title: videoInfo.title,
      description: videoInfo.description,
      duration: videoInfo.duration,
      uploader: videoInfo.uploader,
      upload_date: videoInfo.upload_date,
      view_count: videoInfo.view_count,
      thumbnail: videoInfo.thumbnail,
      webpage_url: videoInfo.webpage_url,
      extractor: videoInfo.extractor,
      formats,
      resolutions: formats
        .filter(format => format.has_video && format.height)
        .map(format => ({
          format_id: format.format_id,
          resolution: `${format.height}p`,
          width: format.width,
          height: format.height,
          ext: format.ext,
          filesize: format.filesize,
          filesize_approx: format.filesize_approx,
          has_audio: format.has_audio
        }))
    };

    log.info('info.resolved', {
      id: info.id,
      title: info.title,
      extractor: info.extractor,
      duration: info.duration,
      formatCount: info.formats.length,
      totalMs: log.elapsed(),
    });
    res.json(info);

  } catch (error) {
    log.error('route.exception', { message: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Failed to extract video information',
      details: error.message
    });
  }
});

// GET /api/info/playlist?url=<playlist_url> - Get playlist information
router.get('/playlist', async (req, res) => {
  const log = createLogger('info.playlist', `pl-${++infoCounter}`);

  try {
    const { url } = req.query;
    log.info('request.received', { url, ip: req.ip });

    if (!url) {
      log.warn('validate.rejected', { reason: 'missing-url' });
      return res.status(400).json({ error: 'URL parameter is required' });
    }

    const args = [
      '--flat-playlist',
      '--dump-json',
      ...(await accessArgs(url, log)),
      url
    ];

    log.info('ytdlp.args', { argv: args });
    const result = await runWithRetries(args, log);

    if (!result.ok) {
      log.error('playlist.failed', {
        stage: 'extraction',
        exitCode: result.code,
        stderr: result.error.trim().slice(-800),
      });
      return res.status(500).json({
        error: 'Failed to get playlist information',
        details: result.error
      });
    }

    try {
      const lines = result.output.trim().split('\n').filter(line => line.trim());
      const playlist = lines.map(line => JSON.parse(line));

      log.info('playlist.resolved', { entries: playlist.length, totalMs: log.elapsed() });
      res.json({
        entries: playlist.map(entry => ({
          id: entry.id,
          title: entry.title,
          url: entry.url,
          duration: entry.duration,
          uploader: entry.uploader
        }))
      });
    } catch (parseError) {
      log.error('playlist.failed', {
        stage: 'parse',
        message: parseError.message,
        stdoutHead: result.output.trim().slice(0, 300),
      });
      res.status(500).json({
        error: 'Failed to parse playlist information',
        details: parseError.message
      });
    }

  } catch (error) {
    log.error('route.exception', { message: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Failed to extract playlist information',
      details: error.message
    });
  }
});

module.exports = router;
