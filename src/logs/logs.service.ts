import { Injectable, LoggerService } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

const LOG_FILE_PATH =
  process.env.NGINX_LOG_FILE_PATH ||
  path.resolve(process.cwd(), 'nginx-app.log');
const MAX_LOG_LINES = 1000;

@Injectable()
export class LogsService implements LoggerService {
  private buffer: string[] = [];

  constructor() {
    this.readLogFile();
  }

  log(message: string) {
    this.appendLog(`[LOG] ${message}`);
    process.stdout.write(`[LOG] ${message}\n`);
  }

  error(message: string, trace?: string) {
    this.appendLog(`[ERROR] ${message}${trace ? ' - ' + trace : ''}`);
    process.stderr.write(`[ERROR] ${message}${trace ? ' - ' + trace : ''}\n`);
  }

  warn(message: string) {
    this.appendLog(`[WARN] ${message}`);
    process.stdout.write(`[WARN] ${message}\n`);
  }

  debug(message: string) {
    this.appendLog(`[DEBUG] ${message}`);
    process.stdout.write(`[DEBUG] ${message}\n`);
  }

  verbose(message: string) {
    this.appendLog(`[VERBOSE] ${message}`);
    process.stdout.write(`[VERBOSE] ${message}\n`);
  }

  private appendLog(logLine: string) {
    const entry = `${new Date().toISOString()} ${logLine}`;
    this.buffer.push(entry);
    if (this.buffer.length > MAX_LOG_LINES) this.buffer.shift();
    fs.appendFileSync(LOG_FILE_PATH, entry + '\n');
  }

  private readLogFile() {
    if (!fs.existsSync(LOG_FILE_PATH)) return;
    const lines = fs.readFileSync(LOG_FILE_PATH, 'utf8').trim().split('\n');
    this.buffer = lines.slice(-MAX_LOG_LINES);
  }

  getLastLogs(count: number): string[] {
    return this.buffer.slice(-count);
  }
}
