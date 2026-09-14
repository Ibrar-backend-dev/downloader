const NUMERIC_QUALITIES = new Set(['2160', '1440', '1080', '720', '480', '360']);
const VIDEO_QUALITIES = new Set(['best', 'worst', ...NUMERIC_QUALITIES]);

function normalizeDurationSeconds(duration) {
  if (duration === null || duration === undefined || duration === '') return null;

  const numericDuration = Number(duration);
  if (!Number.isFinite(numericDuration)) return null;

  return Math.round(numericDuration);
}

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

function dedupeFormatsByResolution(formats = []) {
  if (!Array.isArray(formats)) return [];

  const byResolution = new Map();
  for (const format of formats) {
    const key = String(format?.resolution || '').trim();
    if (!key) continue;

    const existing = byResolution.get(key);
    if (!existing) {
      byResolution.set(key, format);
      continue;
    }

    const existingBytes = Number(existing?.sizeBytes ?? 0);
    const candidateBytes = Number(format?.sizeBytes ?? 0);
    const existingHasBytes = Number.isFinite(existingBytes) && existingBytes > 0;
    const candidateHasBytes = Number.isFinite(candidateBytes) && candidateBytes > 0;

    if (!existingHasBytes && candidateHasBytes) {
      byResolution.set(key, format);
    }
  }

  return Array.from(byResolution.values());
}

function filterFormatsByMinimumResolution(formats = [], minHeight = 480) {
  if (!Array.isArray(formats)) return [];

  const minimum = Number(minHeight);
  if (!Number.isFinite(minimum)) return formats;

  return formats.filter((format) => {
    const height = Number.parseInt(String(format?.resolution || '').replace(/p$/i, ''), 10);
    return Number.isFinite(height) && height >= minimum;
  });
}

function formatSizeMb(format = {}) {
  if (!format || typeof format !== 'object') return null;

  const explicitBytes = Number(format.filesize ?? format.filesize_approx ?? 0);
  if (Number.isFinite(explicitBytes) && explicitBytes > 0) {
    return Number((explicitBytes / 1024 / 1024).toFixed(2));
  }

  return null;
}

module.exports = {
  videoSelector,
  legacyVideoSelector,
  explicitVideoSelector,
  normalizeDurationSeconds,
  dedupeFormatsByResolution,
  filterFormatsByMinimumResolution,
  formatSizeMb,
};