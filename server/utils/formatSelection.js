const NUMERIC_QUALITIES = new Set(['2160', '1440', '1080', '720', '480', '360']);
const VIDEO_QUALITIES = new Set(['best', 'worst', ...NUMERIC_QUALITIES]);

function videoSelector(quality = 'best') {
  const value = String(quality || 'best');
  if (!VIDEO_QUALITIES.has(value)) {
    const error = new Error(`Unsupported video quality: ${value}`);
    error.code = 'INVALID_QUALITY';
    throw error;
  }

  if (value === 'best') return 'bv*+ba/b';
  if (value === 'worst') return 'wv*+wa/w';
  return `bv*[height<=${value}]+ba/b[height<=${value}]/b`;
}

function legacyVideoSelector(quality = 'best') {
  const value = String(quality || 'best');
  if (!VIDEO_QUALITIES.has(value)) {
    const error = new Error(`Unsupported video quality: ${value}`);
    error.code = 'INVALID_QUALITY';
    throw error;
  }

  if (value === 'best') return 'b';
  if (value === 'worst') return 'worst';
  return `best[height<=${value}]/best`;
}

function explicitVideoSelector(formatId) {
  const value = String(formatId || '').trim();
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    const error = new Error(`Unsupported format id: ${value}`);
    error.code = 'INVALID_FORMAT_ID';
    throw error;
  }

  // A selected video stream may not contain audio, so prefer it and merge the
  // best available audio stream when yt-dlp needs to.
  return `${value}+ba/${value}/b`;
}

module.exports = { videoSelector, legacyVideoSelector, explicitVideoSelector };