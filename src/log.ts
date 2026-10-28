import { redactSecrets } from './api/redact.ts';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export interface Logger {
  readonly target: 'stderr' | 'custom';
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  /** 以後のログから伏せる文字列（トークンなど）を登録する */
  addSecret(secret: string): void;
}

export interface LoggerOptions {
  level?: LogLevel;
  write?: (line: string) => void;
}

export function parseLogLevel(value: string | undefined): LogLevel {
  return value !== undefined && value in ORDER ? (value as LogLevel) : 'info';
}

/** ログは stderr にだけ出す（stdout は MCP の通信路）。出す前に必ずトークンを伏せる。 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const threshold = ORDER[options.level ?? 'info'];
  const write = options.write ?? ((line: string) => process.stderr.write(line));
  const secrets = new Set<string>();
  const emit = (level: Exclude<LogLevel, 'silent'>, message: string) => {
    if (ORDER[level] < threshold) return;
    write(`[kintai-plus-mcp] ${level}: ${redactSecrets(message, [...secrets])}\n`);
  };
  return {
    target: options.write ? 'custom' : 'stderr',
    debug: (m) => emit('debug', m),
    info: (m) => emit('info', m),
    warn: (m) => emit('warn', m),
    error: (m) => emit('error', m),
    addSecret: (s) => {
      if (s) secrets.add(s);
    },
  };
}

export const silentLogger: Logger = createLogger({ level: 'silent', write: () => {} });
