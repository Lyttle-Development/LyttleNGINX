import { execFile } from 'node:child_process';
import * as process from 'node:process';

export type RunCommandOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  timeoutMs?: number;
  maxBuffer?: number;
  allowNonZeroExit?: boolean;
};

export class ProcessExecutionError extends Error {
  constructor(
    message: string,
    readonly command: string,
    readonly args: string[],
    readonly stdout: string,
    readonly stderr: string,
    readonly exitCode?: number | null,
  ) {
    super(message);
    this.name = 'ProcessExecutionError';
  }
}

export async function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      command,
      args,
      {
        cwd: options.cwd,
        env: {
          ...process.env,
          ...options.env,
        },
        timeout: options.timeoutMs ?? 30_000,
        maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const normalizedStdout = stdout ?? '';
        const normalizedStderr = stderr ?? '';

        if (error && !options.allowNonZeroExit) {
          const combinedOutput = [
            normalizedStderr.trim(),
            normalizedStdout.trim(),
          ]
            .filter(Boolean)
            .join('\n');
          reject(
            new ProcessExecutionError(
              combinedOutput
                ? `${command} ${args.join(' ')} failed: ${combinedOutput}`
                : `${command} ${args.join(' ')} failed`,
              command,
              args,
              normalizedStdout,
              normalizedStderr,
              typeof (error as NodeJS.ErrnoException & { code?: unknown })
                .code === 'number'
                ? ((error as NodeJS.ErrnoException & { code?: number }).code ??
                    null)
                : null,
            ),
          );
          return;
        }

        resolve({ stdout: normalizedStdout, stderr: normalizedStderr });
      },
    );

    if (options.input !== undefined) {
      child.stdin?.end(options.input);
    }
  });
}
