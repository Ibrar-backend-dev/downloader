const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const { getGenericDownloadError, isTransientFailure } = require('../utils/downloadError');
const { createLogger } = require('../utils/logger');
const { createTracer } = require('../utils/ytdlpTrace');
const { spawnYtDlp } = require('../utils/ytdlpProcess');
const { accessArgs } = require('../utils/ytdlpAccess');
const { legacyVideoSelector, explicitVideoSelector } = require('../utils/formatSelection');
const router = express.Router();

// TikTok rejects roughly a third of extraction attempts with a challenge that
// clears on a retry, so a single attempt is not a fair test of availability.
const MAX_ATTEMPTS = Number(process.env.YTDLP_MAX_ATTEMPTS || 3);
const RETRY_DELAY_MS = Number(process.env.YTDLP_RETRY_DELAY_MS || 2000);

// POST /api/download
router.post('/', async (req, res) => {
  const downloadId = Date.now().toString();
  const log = createLogger('download', downloadId);

  try {
    const { url, format, formatId, quality, audioOnly, outputPath } = req.body;
    const io = req.app.get('socketio');

    log.info('request.received', {
      url,
      format,
      formatId,
      quality,
      audioOnly: Boolean(audioOnly),
      outputPath,
      ip: req.ip,
    });

    if (!url) {
      log.warn('validate.rejected', { reason: 'missing-url' });
      return res.status(400).json({ error: 'URL is required' });
    }

    // Basic URL validation - let yt-dlp handle specific format validation
    const urlPattern = /^https?:\/\/.+/i;
    if (!urlPattern.test(url)) {
      log.warn('validate.rejected', { reason: 'bad-url-format', url });
      return res.status(400).json({ error: 'Invalid URL format. Please provide a valid HTTP/HTTPS URL.' });
    }

    log.info('validate.passed', {
      cookiesFromBrowser: process.env.YTDLP_COOKIES_FROM_BROWSER || null,
      cookiesFile: process.env.YTDLP_COOKIES_FILE || null,
    });

    const downloadsDir = path.join(__dirname, '../../downloads');
    await fs.ensureDir(downloadsDir);
    log.debug('downloads.dir-ready', { downloadsDir });

    // Build yt-dlp command with better YouTube handling
    const args = [];
    
    args.push(...(await accessArgs(url, log)));

    if (audioOnly) {
      args.push('-f', 'bestaudio/best');
      args.push('--extract-audio');
      args.push('--audio-format', format || 'mp3');
    } else {
      try {
        args.push('-f', formatId ? explicitVideoSelector(formatId) : legacyVideoSelector(quality));
        args.push('--merge-output-format', 'mp4');
      } catch (error) {
        if (error.code === 'INVALID_FORMAT_ID' || error.code === 'INVALID_QUALITY') {
          return res.status(400).json({ error: error.message, code: error.code });
        }
        throw error;
      }
    }

    args.push('-o', path.join(downloadsDir, '%(title).80s [%(id)s].%(ext)s'));
    args.push('--no-playlist');
    args.push('--progress');
    // One progress update per line instead of carriage-return rewrites, so the
    // trace keeps every tick rather than a single overwritten line.
    args.push('--newline');
    if (process.env.YTDLP_VERBOSE === '1') args.push('--verbose');
    args.push(url);

    log.info('ytdlp.args', { argv: args });

    let downloadInfo = {
      id: downloadId,
      url,
      status: 'starting',
      progress: 0,
      filename: '',
      error: null
    };

    io.emit('download-start', downloadInfo);

    // One yt-dlp run. Resolves with everything needed to decide whether the
    // failure is worth another attempt.
    const runAttempt = (attempt) => new Promise((resolve) => {
      const attemptLog = log.child(`try${attempt}`);
      const spawnedAt = Date.now();
      let rawYtDlpError = '';
      let spawnFailed = null;

      const tracer = createTracer({
        logger: attemptLog,
        onProgress: (tick) => {
          downloadInfo.progress = tick.percent;
          downloadInfo.status = 'downloading';
          io.emit('download-progress', downloadInfo);
        },
      });

      attemptLog.info('attempt.start', { attempt, of: MAX_ATTEMPTS });
      const ytdlp = spawnYtDlp(args);
      attemptLog.info('ytdlp.spawned', { pid: ytdlp.pid });

      ytdlp.stdout.on('data', (data) => tracer.feedStdout(data));

      ytdlp.stderr.on('data', (data) => {
        rawYtDlpError += data.toString();
        tracer.feedStderr(data);
      });

      ytdlp.on('error', (error) => {
        spawnFailed = error;
        rawYtDlpError = error.message;
        attemptLog.error('ytdlp.spawn-failed', {
          code: error.code,
          message: error.message,
          hint: error.code === 'ENOENT' ? 'yt-dlp is not on the server PATH' : undefined,
        });
      });

      ytdlp.on('close', async (code, signal) => {
        tracer.flush();
        const state = tracer.snapshot();
        const durationMs = Date.now() - spawnedAt;

        if (state.destination) downloadInfo.filename = path.basename(state.destination);

        // Trust the file on disk over the exit code: a zero exit with no output
        // file is still a failure from the user's point of view.
        let fileSize = null;
        if (state.destination) {
          try {
            fileSize = (await fs.stat(state.destination)).size;
          } catch (statError) {
            fileSize = null;
          }
        }

        attemptLog.info('ytdlp.exited', {
          code,
          signal,
          durationMs,
          furthestStage: state.furthestStage,
          percent: state.percent,
          extractor: state.extractor,
          formats: state.formats,
          file: downloadInfo.filename || null,
          fileSize,
          warnings: state.warnings.length,
          errors: state.errors.length,
        });

        resolve({
          ok: code === 0 && !spawnFailed,
          code,
          signal,
          durationMs,
          fileSize,
          state,
          rawYtDlpError,
          spawnFailed,
          diagnosis: tracer.describeFailure(code),
        });
      });
    });

    // Run attempts in the background; the client already has its 202-style ack
    // and follows the job over the socket.
    (async () => {
      let result = null;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        result = await runAttempt(attempt);
        if (result.ok) break;

        const retryable = !result.spawnFailed && isTransientFailure(result.rawYtDlpError);
        if (!retryable || attempt === MAX_ATTEMPTS) {
          log.warn('retry.stopped', {
            attempt,
            reason: result.spawnFailed
              ? 'yt-dlp could not be started'
              : retryable
                ? 'attempts exhausted'
                : 'failure is not transient',
          });
          break;
        }

        log.warn('retry.scheduled', {
          afterAttempt: attempt,
          delayMs: RETRY_DELAY_MS,
          because: result.diagnosis,
        });
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }

      if (result.ok) {
        downloadInfo.status = 'completed';
        downloadInfo.progress = 100;
        downloadInfo.error = null;
        io.emit('download-complete', downloadInfo);
        log.info('download.completed', {
          file: downloadInfo.filename,
          fileSize: result.fileSize,
          totalMs: log.elapsed(),
        });
        return;
      }

      const genericError = getGenericDownloadError(url, result.rawYtDlpError, result.code);
      downloadInfo.status = 'error';
      downloadInfo.error = genericError;
      io.emit('download-error', downloadInfo);

      log.error('download.failed', {
        diagnosis: result.diagnosis,
        exitCode: result.code,
        signal: result.signal,
        totalMs: log.elapsed(),
        furthestStage: result.state.furthestStage,
        percentReached: result.state.percent,
        sawFirstByte: result.state.sawFirstByte,
        extractor: result.state.extractor,
        formats: result.state.formats,
        destination: result.state.destination,
        ytdlpErrors: result.state.errors,
        ytdlpWarnings: result.state.warnings,
        lastLine: result.state.lastLine,
        userFacingError: genericError,
      });
    })();

    log.info('response.sent', { downloadId, status: 'accepted' });
    res.json({
      success: true,
      downloadId,
      message: 'Download started'
    });

  } catch (error) {
    log.error('route.exception', { message: error.message, stack: error.stack });
    res.status(500).json({
      error: 'Download failed',
      details: error.message
    });
  }
});

// GET /api/download/list - List downloaded files
router.get('/list', async (req, res) => {
  try {
    const downloadsDir = path.join(__dirname, '../../downloads');
    const files = await fs.readdir(downloadsDir);
    
    const fileList = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(downloadsDir, file);
        const stats = await fs.stat(filePath);
        return {
          name: file,
          size: stats.size,
          createdAt: stats.birthtime,
          modifiedAt: stats.mtime
        };
      })
    );

    res.json(fileList);
  } catch (error) {
    console.error('Error listing files:', error);
    res.status(500).json({ error: 'Failed to list files' });
  }
});

// DELETE /api/download/:filename - Delete a downloaded file
router.delete('/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(__dirname, '../../downloads', filename);
    
    // Security check - ensure file is in downloads directory
    if (!filePath.startsWith(path.join(__dirname, '../../downloads'))) {
      return res.status(400).json({ error: 'Invalid file path' });
    }

    await fs.remove(filePath);
    res.json({ success: true, message: 'File deleted successfully' });
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

module.exports = router;
