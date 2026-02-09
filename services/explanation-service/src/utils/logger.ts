type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const rawLevel = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
const ACTIVE_LEVEL: LogLevel = ['debug', 'info', 'warn', 'error'].includes(rawLevel)
  ? (rawLevel as LogLevel)
  : 'info';
const LOG_JSON = process.env.LOG_JSON === '1' || process.env.LOG_JSON === 'true';

function shouldLog(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[ACTIVE_LEVEL];
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '"[unserializable]"';
  }
}

export function toErrorMeta(error: unknown): { name?: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}

export function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;
  const ts = new Date().toISOString();
  if (LOG_JSON) {
    const payload = meta ? { ts, level, message, ...meta } : { ts, level, message };
    console.log(safeStringify(payload));
    return;
  }
  const suffix = meta ? ` ${safeStringify(meta)}` : '';
  console.log(`[${ts}] [${level.toUpperCase()}] ${message}${suffix}`);
}

export function logDebug(message: string, meta?: Record<string, unknown>): void {
  log('debug', message, meta);
}

export function logInfo(message: string, meta?: Record<string, unknown>): void {
  log('info', message, meta);
}

export function logWarn(message: string, meta?: Record<string, unknown>): void {
  log('warn', message, meta);
}

export function logError(message: string, meta?: Record<string, unknown>): void {
  log('error', message, meta);
}
