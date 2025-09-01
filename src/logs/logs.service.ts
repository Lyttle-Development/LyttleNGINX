import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { execSync } from 'child_process';

@Injectable()
export class LogsService {
  // Uses bash to get the last `count` lines from the running NestJS application's stdout log
  getLastLogs(count: number): string[] {
    try {
      const output = execSync(`tail -n ${count} nohup.out`).toString();
      return output.trim().split('\n');
    } catch (err) {
      throw new InternalServerErrorException(
        'Could not read logs from application.',
      );
    }
  }
}
