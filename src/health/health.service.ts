import { Injectable, Logger } from '@nestjs/common';
import * as fsPromises from 'node:fs/promises';
import * as process from 'node:process';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly startedAt = new Date();
  private readonly configApplyMaxAgeMs = this.getThresholdFromEnv(
    'HEALTH_CONFIG_APPLY_MAX_AGE_MS',
    15 * 60 * 1000,
  );
  private readonly certificateSyncMaxAgeMs = this.getThresholdFromEnv(
    'HEALTH_CERTIFICATE_SYNC_MAX_AGE_MS',
    15 * 60 * 1000,
  );
  private configApplyState = this.createOperationState();
  private certificateSyncState = this.createOperationState();

  constructor(private readonly prisma: PrismaService) {}

  async live() {
    return {
      status: 'ok',
      probe: 'liveness',
      uptime: process.uptime(),
      startedAt: this.startedAt.toISOString(),
      timestamp: new Date().toISOString(),
    };
  }

  async startup() {
    const checks = [
      this.checkInitializationState('config_apply', this.configApplyState),
      this.checkInitializationState(
        'certificate_sync',
        this.certificateSyncState,
      ),
    ];

    const healthy = checks.every((check) => check.status === 'ok');

    return {
      status: healthy ? 'ok' : 'starting',
      probe: 'startup',
      checks,
      uptime: process.uptime(),
      startedAt: this.startedAt.toISOString(),
      timestamp: new Date().toISOString(),
    };
  }

  async ready() {
    const checks = [
      await this.checkDatabaseConnectivity(),
      await this.checkNginxMasterProcess(),
      this.checkOperationFreshness(
        'config_apply',
        this.configApplyState,
        this.configApplyMaxAgeMs,
      ),
      this.checkOperationFreshness(
        'certificate_sync',
        this.certificateSyncState,
        this.certificateSyncMaxAgeMs,
      ),
    ];

    const healthy = checks.every((check) => check.status === 'ok');

    return {
      status: healthy ? 'ok' : 'error',
      probe: 'readiness',
      checks,
      thresholds: {
        configApplyMaxAgeMs: this.configApplyMaxAgeMs,
        certificateSyncMaxAgeMs: this.certificateSyncMaxAgeMs,
      },
      uptime: process.uptime(),
      startedAt: this.startedAt.toISOString(),
      timestamp: new Date().toISOString(),
    };
  }

  recordConfigApplySuccess(details?: string) {
    this.configApplyState = this.markOperationSuccess(
      this.configApplyState,
      details,
    );
  }

  recordConfigApplyFailure(error: string) {
    this.configApplyState = this.markOperationFailure(
      this.configApplyState,
      error,
    );
  }

  recordCertificateSyncSuccess(details?: string) {
    this.certificateSyncState = this.markOperationSuccess(
      this.certificateSyncState,
      details,
    );
  }

  recordCertificateSyncFailure(error: string) {
    this.certificateSyncState = this.markOperationFailure(
      this.certificateSyncState,
      error,
    );
  }

  private createOperationState(): OperationState {
    return {
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastError: null,
      details: null,
    };
  }

  private markOperationSuccess(
    state: OperationState,
    details?: string,
  ): OperationState {
    const now = new Date();

    return {
      lastAttemptAt: now,
      lastSuccessAt: now,
      lastError: null,
      details: details ?? state.details,
    };
  }

  private markOperationFailure(state: OperationState, error: string): OperationState {
    return {
      ...state,
      lastAttemptAt: new Date(),
      lastError: error,
    };
  }

  private checkInitializationState(
    name: string,
    state: OperationState,
  ): HealthCheckResult {
    if (!state.lastSuccessAt) {
      return this.createCheckResult(
        name,
        'error',
        'awaiting first successful completion',
        state,
      );
    }

    return this.createCheckResult(name, 'ok', 'initialized', state);
  }

  private checkOperationFreshness(
    name: string,
    state: OperationState,
    maxAgeMs: number,
  ): HealthCheckResult {
    if (!state.lastSuccessAt) {
      return this.createCheckResult(
        name,
        'error',
        'no successful completion recorded yet',
        state,
      );
    }

    if (
      state.lastAttemptAt &&
      state.lastAttemptAt.getTime() >= state.lastSuccessAt.getTime() &&
      state.lastError
    ) {
      return this.createCheckResult(
        name,
        'error',
        `latest attempt failed: ${state.lastError}`,
        state,
      );
    }

    const ageMs = Date.now() - state.lastSuccessAt.getTime();
    if (ageMs > maxAgeMs) {
      return this.createCheckResult(
        name,
        'error',
        `last successful completion is stale (${ageMs}ms old, max ${maxAgeMs}ms)`,
        state,
      );
    }

    return this.createCheckResult(name, 'ok', 'fresh', state, ageMs, maxAgeMs);
  }

  private async checkDatabaseConnectivity(): Promise<HealthCheckResult> {
    const startedAt = Date.now();

    try {
      const prismaClient = this.prisma as PrismaService & {
        $queryRawUnsafe?: (query: string) => Promise<unknown>;
      };

      if (typeof prismaClient.$queryRawUnsafe !== 'function') {
        throw new Error('Prisma raw query API is unavailable');
      }

      await prismaClient.$queryRawUnsafe('SELECT 1');
      const latencyMs = Date.now() - startedAt;

      return {
        name: 'database',
        status: 'ok',
        details: 'query succeeded',
        latencyMs,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Database readiness check failed: ${message}`);

      return {
        name: 'database',
        status: 'error',
        details: message,
        latencyMs: Date.now() - startedAt,
        checkedAt: new Date().toISOString(),
      };
    }
  }

  private async checkNginxMasterProcess(): Promise<HealthCheckResult> {
    const pidFileCandidates = ['/run/nginx.pid', '/var/run/nginx.pid'];

    for (const pidFile of pidFileCandidates) {
      try {
        const pid = await this.readPidFromFile(pidFile);
        process.kill(pid, 0);

        return {
          name: 'nginx_master',
          status: 'ok',
          details: `master process responding via ${pidFile}`,
          pid,
          checkedAt: new Date().toISOString(),
        };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code === 'ENOENT') {
          continue;
        }

        const message = error instanceof Error ? error.message : String(error);
        return {
          name: 'nginx_master',
          status: 'error',
          details: message,
          checkedAt: new Date().toISOString(),
        };
      }
    }

    return {
      name: 'nginx_master',
      status: 'error',
      details: 'nginx pid file not found',
      checkedAt: new Date().toISOString(),
    };
  }

  private async readPidFromFile(pidFile: string): Promise<number> {
    await fsPromises.access(pidFile);
    const rawPid = await fsPromises.readFile(pidFile, 'utf8');
    const pid = Number.parseInt(rawPid.trim(), 10);

    if (!Number.isInteger(pid) || pid <= 0) {
      throw new Error(`invalid nginx pid in ${pidFile}`);
    }

    return pid;
  }

  private createCheckResult(
    name: string,
    status: HealthCheckStatus,
    details: string,
    state: OperationState,
    ageMs?: number,
    maxAgeMs?: number,
  ): HealthCheckResult {
    return {
      name,
      status,
      details,
      checkedAt: new Date().toISOString(),
      lastAttemptAt: state.lastAttemptAt?.toISOString() ?? null,
      lastSuccessAt: state.lastSuccessAt?.toISOString() ?? null,
      lastError: state.lastError,
      operationAgeMs: ageMs,
      maxAgeMs,
      stateDetails: state.details,
    };
  }

  private getThresholdFromEnv(name: string, fallback: number): number {
    const rawValue = process.env[name];
    if (!rawValue) {
      return fallback;
    }

    const parsedValue = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
      this.logger.warn(
        `Ignoring invalid ${name} value ${rawValue}; using fallback ${fallback}`,
      );
      return fallback;
    }

    return parsedValue;
  }
}

type HealthCheckStatus = 'ok' | 'error';

type OperationState = {
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  details: string | null;
};

type HealthCheckResult = {
  name: string;
  status: HealthCheckStatus;
  details: string;
  checkedAt: string;
  latencyMs?: number;
  pid?: number;
  lastAttemptAt?: string | null;
  lastSuccessAt?: string | null;
  lastError?: string | null;
  operationAgeMs?: number;
  maxAgeMs?: number;
  stateDetails?: string | null;
};

