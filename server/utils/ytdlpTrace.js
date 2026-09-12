// Turns raw yt-dlp console output into ordered, named stages so a failure can
// be attributed to a precise point: before extraction, during extraction,
// before the first byte, at N% of the transfer, or in post-processing.

// yt-dlp rewrites the progress line with a carriage return instead of emitting
// a new line, so both terminators have to split the stream.
function createLineSplitter(onLine) {
  let buffer = '';
  return {
    feed(chunk) {
      buffer += chunk;
      const lines = buffer.split(/\r\n|\r|\n/);
      buffer = lines.pop();
      for (const line of lines) {
        if (line.trim()) onLine(line.trim());
      }
    },
    flush() {
      if (buffer.trim()) onLine(buffer.trim());
      buffer = '';
    },
  };
}

const PROGRESS_RE = /\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+~?\s*([\d.]+\s*\w+)(?:\s+at\s+(\S+))?(?:\s+ETA\s+(\S+))?/;
const FRAGMENT_RE = /\(frag\s+(\d+)\/(\d+)\)/;

// Ordered so an index comparison answers "how far did it get?".
const STAGE_ORDER = [
  'spawned',
  'extractor.start',
  'extractor.progress',
  'format.selected',
  'download.destination',
  'download.progress',
  'download.finished',
  'postprocess',
  'exited',
];

function parseLine(line) {
  if (/^ERROR:/i.test(line)) return { type: 'error', message: line };
  if (/^WARNING:/i.test(line)) return { type: 'warning', message: line };

  // The summary line ("100% of 2.62MiB in 00:00:02") also matches the progress
  // pattern, so it has to be recognised first or the transfer never registers
  // as finished and a post-processing failure looks like a stall at 100%.
  if (/^\[download\]\s+100(?:\.0)?%\s+of\s+.+\s+in\s+/.test(line)) {
    return { type: 'event', stage: 'download.finished', name: 'download.complete', message: line };
  }

  const progress = line.match(PROGRESS_RE);
  if (progress) {
    const fragment = line.match(FRAGMENT_RE);
    return {
      type: 'progress',
      stage: 'download.progress',
      percent: parseFloat(progress[1]),
      totalSize: progress[2],
      speed: progress[3] || null,
      eta: progress[4] || null,
      fragment: fragment ? fragment[1] + '/' + fragment[2] : null,
    };
  }

  const destination = line.match(/^\[download\] Destination:\s*(.+)$/);
  if (destination) {
    return {
      type: 'event',
      stage: 'download.destination',
      name: 'download.destination',
      destination: destination[1],
    };
  }

  const cached = line.match(/^\[download\]\s+(.+?)\s+has already been downloaded$/);
  if (cached) {
    return {
      type: 'event',
      stage: 'download.finished',
      name: 'download.cached',
      destination: cached[1],
      message: line,
    };
  }

  const selected = line.match(/^\[info\]\s+(.+?):\s+Downloading\s+(\d+)\s+format\(s\):\s*(.+)$/);
  if (selected) {
    return {
      type: 'event',
      stage: 'format.selected',
      name: 'format.selected',
      videoId: selected[1],
      formatCount: Number(selected[2]),
      formats: selected[3],
    };
  }

  const extracting = line.match(/^\[([^\]]+)\] Extracting URL:\s*(.+)$/);
  if (extracting) {
    return {
      type: 'event',
      stage: 'extractor.start',
      name: 'extractor.start',
      extractor: extracting[1],
      url: extracting[2],
    };
  }

  // Post-processors announce themselves with their own bracket tag.
  const postprocessor = line.match(/^\[(Merger|ExtractAudio|VideoConvertor|EmbedSubtitle|MoveFiles|ThumbnailsConvertor|Fixup\w*)\]\s*(.*)$/);
  if (postprocessor) {
    return {
      type: 'event',
      stage: 'postprocess',
      name: 'postprocess.' + postprocessor[1].toLowerCase(),
      message: postprocessor[2] || postprocessor[1],
    };
  }

  const extractorStep = line.match(/^\[([^\]]+)\]\s+(.+?):\s+(.+)$/);
  if (extractorStep) {
    return {
      type: 'event',
      stage: 'extractor.progress',
      name: 'extractor.step',
      extractor: extractorStep[1],
      videoId: extractorStep[2],
      step: extractorStep[3],
    };
  }

  const generic = line.match(/^\[([^\]]+)\]\s+(.+)$/);
  if (generic) {
    return { type: 'event', stage: null, name: 'ytdlp.' + generic[1].toLowerCase(), message: generic[2] };
  }

  return { type: 'raw', message: line };
}

/**
 * Watches one yt-dlp process and reports where it got to.
 *
 * `onProgress` fires for every parsed progress tick (unthrottled) so callers
 * can forward it to the UI; the log itself is throttled to stay readable.
 */
function createTracer({ logger, onProgress, progressLogIntervalMs = 1000, progressLogStep = 10 }) {
  const state = {
    stage: 'spawned',
    furthestStage: 'spawned',
    extractor: null,
    videoId: null,
    formats: null,
    destination: null,
    percent: 0,
    totalSize: null,
    speed: null,
    eta: null,
    fragment: null,
    sawFirstByte: false,
    warnings: [],
    errors: [],
    lastLine: null,
  };

  let lastProgressLogAt = 0;
  let lastLoggedBucket = -1;

  function advance(stage) {
    if (!stage) return;
    state.stage = stage;
    if (STAGE_ORDER.indexOf(stage) > STAGE_ORDER.indexOf(state.furthestStage)) {
      state.furthestStage = stage;
    }
  }

  function handleLine(line, stream) {
    state.lastLine = line;
    const parsed = parseLine(line);

    if (parsed.type === 'error') {
      state.errors.push(parsed.message);
      logger.error('ytdlp.error', { stage: state.stage, percent: state.percent, message: parsed.message });
      return;
    }

    if (parsed.type === 'warning') {
      state.warnings.push(parsed.message);
      logger.warn('ytdlp.warning', { stage: state.stage, message: parsed.message });
      return;
    }

    if (parsed.type === 'progress') {
      advance('download.progress');
      state.percent = parsed.percent;
      state.totalSize = parsed.totalSize;
      state.speed = parsed.speed;
      state.eta = parsed.eta;
      state.fragment = parsed.fragment;

      if (!state.sawFirstByte && parsed.percent > 0) {
        state.sawFirstByte = true;
        logger.info('download.first-byte', { totalSize: parsed.totalSize });
      }

      if (onProgress) onProgress(Object.assign({}, parsed));

      // Log on a time interval or a percentage step, whichever comes first.
      const now = Date.now();
      const bucket = Math.floor(parsed.percent / progressLogStep);
      if (bucket !== lastLoggedBucket || now - lastProgressLogAt >= progressLogIntervalMs) {
        lastLoggedBucket = bucket;
        lastProgressLogAt = now;
        logger.info('download.progress', {
          percent: parsed.percent,
          of: parsed.totalSize,
          speed: parsed.speed,
          eta: parsed.eta,
          frag: parsed.fragment,
        });
      }
      return;
    }

    if (parsed.type === 'event') {
      advance(parsed.stage);
      if (parsed.extractor) state.extractor = parsed.extractor;
      if (parsed.videoId) state.videoId = parsed.videoId;
      if (parsed.formats) state.formats = parsed.formats;
      if (parsed.destination) state.destination = parsed.destination;

      const fields = Object.assign({}, parsed);
      delete fields.type;
      delete fields.stage;
      delete fields.name;
      logger.info(parsed.name, fields);
      return;
    }

    logger.debug('ytdlp.output', { stream, line });
  }

  const stdoutSplitter = createLineSplitter((line) => handleLine(line, 'stdout'));
  const stderrSplitter = createLineSplitter((line) => handleLine(line, 'stderr'));

  return {
    feedStdout: (chunk) => stdoutSplitter.feed(chunk.toString()),
    feedStderr: (chunk) => stderrSplitter.feed(chunk.toString()),
    flush: () => {
      stdoutSplitter.flush();
      stderrSplitter.flush();
    },
    snapshot: () => Object.assign({}, state),
    // Plain-language answer to "where exactly did it break?".
    describeFailure: (exitCode) => {
      const at = state.furthestStage;
      if (at === 'spawned') return 'failed before yt-dlp produced any output';
      if (at === 'extractor.start' || at === 'extractor.progress') {
        return 'failed during extraction (extractor=' + (state.extractor || 'unknown') + '), before any format was selected';
      }
      if (at === 'format.selected') return 'failed after selecting a format but before the transfer started';
      if (at === 'download.destination') return 'failed after opening the output file but before the first byte arrived';
      if (at === 'download.progress') return 'failed mid-transfer at ' + state.percent + '% of ' + (state.totalSize || 'unknown size');
      if (at === 'download.finished') return 'transfer completed; failed afterwards (post-processing or cleanup)';
      if (at === 'postprocess') return 'transfer completed; failed during post-processing (merge/convert)';
      return 'failed with exit code ' + exitCode;
    },
  };
}

module.exports = { createTracer, createLineSplitter, parseLine, STAGE_ORDER };
