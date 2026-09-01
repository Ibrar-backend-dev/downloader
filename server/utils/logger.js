const LEVELS = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 };

const configuredLevel = LEVELS[String(process.env.LOG_LEVEL || 'debug').toLowerCase()];
const activeLevel = configuredLevel === undefined ? LEVELS.debug : configuredLevel;

const LABELS = {
  error: 'ERROR',
  warn: 'WARN ',
  info: 'INFO ',
  debug: 'DEBUG',
  trace: 'TRACE',
};

// Values land in a single grep-able line, so keep them short and quote anything
// that contains whitespace.
function formatValue(value) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (value instanceof Error) return JSON.stringify(`${value.name}: ${value.message}`);
  if (typeof value === 'object') return JSON.stringify(value);
  const text = String(value);
  return /[\s"]/.test(text) ? JSON.stringify(text) : text;
}

function formatFields(fields) {
  return Object.entries(fields || {})
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(' ');
}

function write(level, scope, id, startedAt, event, fields) {
  if (LEVELS[level] > activeLevel) return;

  const parts = [
    new Date().toISOString(),
    LABELS[level],
    `[${scope}${id ? `:${id}` : ''}]`,
    `+${String(Date.now() - startedAt).padStart(5, ' ')}ms`,
    event,
  ];

  const tail = formatFields(fields);
  if (tail) parts.push('|', tail);

  const line = parts.join(' ');
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

/**
 * A logger bound to one unit of work (one HTTP request, one download job).
 * Every line carries the scope, the correlation id and the milliseconds since
 * the job started, so a failure can be placed exactly on the timeline.
 */
function createLogger(scope, id) {
  const startedAt = Date.now();

  const logger = {
    id,
    scope,
    startedAt,
    elapsed: () => Date.now() - startedAt,
    child: (childScope, childId) => createLogger(`${scope}.${childScope}`, childId || id),
  };

  for (const level of Object.keys(LEVELS)) {
    logger[level] = (event, fields) => write(level, scope, id, startedAt, event, fields);
  }

  return logger;
}

module.exports = { createLogger, LEVELS, activeLevel };
