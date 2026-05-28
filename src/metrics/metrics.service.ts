import { Injectable, Logger } from '@nestjs/common';
import * as fsPromises from 'node:fs/promises';
import * as process from 'node:process';
import { HealthService } from '../health/health.service';
import { PrismaService } from '../prisma/prisma.service';

const BACKUP_FILENAME_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:lyttlebackup|zip)$/;
const LEADER_LEASE_NAME = 'cluster:leader';
const TERMINAL_CERTIFICATE_ORDER_STATUSES = new Set([
  'activated',
  'failed',
  'revoked',
]);

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);
  private readonly backupDir = process.env['BACKUP_DIR'] || '/tmp/cert-backups';
  private readonly clusterOperationStaleMaxAgeMs = this.getThresholdFromEnv(
    'METRICS_CLUSTER_OPERATION_STALE_MAX_AGE_MS',
    15 * 60 * 1000,
  );
  private readonly clusterOperationFailureWindowMs = this.getThresholdFromEnv(
    'METRICS_CLUSTER_OPERATION_FAILURE_WINDOW_MS',
    60 * 60 * 1000,
  );
  private readonly certificateOrderStaleMaxAgeMs = this.getThresholdFromEnv(
    'METRICS_CERTIFICATE_ORDER_STALE_MAX_AGE_MS',
    30 * 60 * 1000,
  );
  private readonly backupMaxAgeMs = this.getThresholdFromEnv(
    'METRICS_BACKUP_MAX_AGE_MS',
    24 * 60 * 60 * 1000,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly healthService: HealthService,
  ) {}

  async getAllMetrics() {
    const sections = [
      ['certificates', () => this.getCertificateMetrics()],
      ['proxies', () => this.getProxyMetrics()],
      ['health', () => this.getHealthMetrics()],
      ['leases', () => this.getLeaseMetrics()],
      ['clusterOperations', () => this.getClusterOperationMetrics()],
      ['certificateOrders', () => this.getCertificateOrderMetrics()],
      ['backups', () => this.getBackupMetrics()],
    ] as const;

    const settled = await Promise.allSettled(
      sections.map(async ([section, loader]) => [section, await loader()] as const),
    );

    const metrics = {
      timestamp: new Date().toISOString(),
      collection: {
        sections: {} as Record<string, 'ok' | 'error'>,
        errors: [] as Array<{ section: string; message: string }>,
      },
      certificates: this.getEmptyCertificateMetrics(),
      proxies: this.getEmptyProxyMetrics(),
      health: this.getEmptyHealthMetrics(),
      leases: this.getEmptyLeaseMetrics(),
      clusterOperations: this.getEmptyClusterOperationMetrics(),
      certificateOrders: this.getEmptyCertificateOrderMetrics(),
      backups: this.getEmptyBackupMetrics(),
    };

    for (const [index, result] of settled.entries()) {
      if (result.status === 'fulfilled') {
        const [section, value] = result.value;
        metrics.collection.sections[section] = 'ok';
        (metrics as Record<string, unknown>)[section] = value;
        continue;
      }

      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      const section = sections[index]?.[0] ?? 'unknown';
      metrics.collection.sections[section] = 'error';
      metrics.collection.errors.push({ section, message: reason });
      this.logger.warn(`Failed to collect ${section} metrics: ${reason}`);
    }

    for (const [section] of sections) {
      if (!metrics.collection.sections[section]) {
        metrics.collection.sections[section] = 'error';
      }
    }

    return metrics;
  }

  async getCertificateMetrics() {
    const certificates = await this.prisma.certificate.findMany({
      where: { isOrphaned: false },
    });

    const now = Date.now();
    const metrics = this.getEmptyCertificateMetrics();
    let totalDays = 0;

    certificates.forEach((cert) => {
      const daysUntilExpiry = Math.ceil(
        (cert.expiresAt.getTime() - now) / (1000 * 60 * 60 * 24),
      );

      totalDays += daysUntilExpiry;

      if (daysUntilExpiry < 0) {
        metrics.expired++;
      } else if (daysUntilExpiry <= 30) {
        metrics.expiringSoon++;
      } else {
        metrics.valid++;
      }

      if (!metrics.oldestExpiry || cert.expiresAt < metrics.oldestExpiry) {
        metrics.oldestExpiry = cert.expiresAt;
      }
      if (!metrics.newestExpiry || cert.expiresAt > metrics.newestExpiry) {
        metrics.newestExpiry = cert.expiresAt;
      }
    });

    metrics.total = certificates.length;
    metrics.avgDaysUntilExpiry =
      certificates.length > 0 ? Math.round(totalDays / certificates.length) : 0;

    return metrics;
  }

  async getProxyMetrics() {
    const entries = await this.prisma.proxyEntry.findMany();
    return {
      total: entries.length,
      withSsl: entries.filter((entry) => entry.ssl).length,
      withoutSsl: entries.filter((entry) => !entry.ssl).length,
      proxies: entries.filter((entry) => entry.type === 'PROXY').length,
      redirects: entries.filter((entry) => entry.type === 'REDIRECT').length,
    };
  }

  async getHealthMetrics() {
    const dependencyReport = await this.healthService.dependencies();
    const operationalState = this.healthService.getOperationalDependencyState();
    const dependencyChecks = Object.fromEntries(
      dependencyReport.checks.map((check) => [check.name, check]),
    );

    return {
      status: dependencyReport.status,
      summary: dependencyReport.summary,
      thresholds: dependencyReport.thresholds,
      checks: dependencyReport.checks,
      database: dependencyChecks['database'] ?? null,
      nginxMaster: dependencyChecks['nginx_master'] ?? null,
      operations: operationalState,
    };
  }

  async getLeaseMetrics() {
    const leases = await this.prisma.clusterLease.findMany({
      orderBy: [{ leaseName: 'asc' }],
    });
    const now = Date.now();
    const leaderLease = leases.find((lease) => lease.leaseName === LEADER_LEASE_NAME) ?? null;
    const active = leases.filter((lease) => lease.expiresAt.getTime() > now).length;
    const expired = leases.length - active;

    return {
      total: leases.length,
      active,
      expired,
      leader: leaderLease
        ? {
            present: true,
            ownerNodeId: leaderLease.ownerNodeId,
            ownerHostname: leaderLease.ownerHostname,
            generation: leaderLease.generation,
            ttlSeconds: leaderLease.ttlSeconds,
            secondsRemaining: Math.max(
              0,
              Math.round((leaderLease.expiresAt.getTime() - now) / 1000),
            ),
            isExpired: leaderLease.expiresAt.getTime() <= now,
          }
        : {
            present: false,
            ownerNodeId: null,
            ownerHostname: null,
            generation: 0,
            ttlSeconds: 0,
            secondsRemaining: 0,
            isExpired: true,
          },
    };
  }

  async getClusterOperationMetrics() {
    const [operations, acknowledgements] = await Promise.all([
      this.prisma.clusterOperation.findMany({
        orderBy: [{ createdAt: 'desc' }],
      }),
      this.prisma.clusterOperationAck.findMany(),
    ]);

    const now = Date.now();
    const activeOperations = operations.filter((operation) =>
      ['pending', 'running'].includes(operation.status),
    );
    const staleOperations = activeOperations.filter(
      (operation) => now - operation.createdAt.getTime() > this.clusterOperationStaleMaxAgeMs,
    );
    const oldestActive = activeOperations.reduce<number | null>((oldest, operation) => {
      const ageSeconds = Math.max(0, Math.round((now - operation.createdAt.getTime()) / 1000));
      return oldest === null ? ageSeconds : Math.max(oldest, ageSeconds);
    }, null);
    const recentFailures = operations.filter(
      (operation) =>
        ['failed', 'partially_failed'].includes(operation.status) &&
        now - operation.createdAt.getTime() <= this.clusterOperationFailureWindowMs,
    );

    return {
      total: operations.length,
      byStatus: this.countBy(
        operations as Array<Record<string, unknown>>,
        (operation) => operation['status'] as string | null | undefined,
      ),
      byType: this.countBy(
        operations as Array<Record<string, unknown>>,
        (operation) => operation['operationType'] as string | null | undefined,
      ),
      active: {
        total: activeOperations.length,
        stale: staleOperations.length,
        oldestAgeSeconds: oldestActive ?? 0,
        staleThresholdMs: this.clusterOperationStaleMaxAgeMs,
      },
      recentFailures: {
        total: recentFailures.length,
        windowMs: this.clusterOperationFailureWindowMs,
      },
      acknowledgements: {
        total: acknowledgements.length,
        byStatus: this.countBy(
          acknowledgements as Array<Record<string, unknown>>,
          (ack) => ack['status'] as string | null | undefined,
        ),
      },
    };
  }

  async getCertificateOrderMetrics() {
    const orders = await this.prisma.certificateOrder.findMany({
      orderBy: [{ createdAt: 'desc' }],
    });

    const now = Date.now();
    const activeOrders = orders.filter(
      (order) => !TERMINAL_CERTIFICATE_ORDER_STATUSES.has(order.status),
    );
    const staleOrders = activeOrders.filter(
      (order) => now - order.updatedAt.getTime() > this.certificateOrderStaleMaxAgeMs,
    );
    const retryScheduled = orders.filter(
      (order) => order.nextRetryAt && order.nextRetryAt.getTime() > now,
    ).length;
    const retryDue = orders.filter(
      (order) => order.nextRetryAt && order.nextRetryAt.getTime() <= now,
    ).length;
    const oldestActiveAgeSeconds = activeOrders.reduce<number | null>((oldest, order) => {
      const ageSeconds = Math.max(0, Math.round((now - order.updatedAt.getTime()) / 1000));
      return oldest === null ? ageSeconds : Math.max(oldest, ageSeconds);
    }, null);

    return {
      total: orders.length,
      active: activeOrders.length,
      stale: staleOrders.length,
      staleThresholdMs: this.certificateOrderStaleMaxAgeMs,
      oldestActiveAgeSeconds: oldestActiveAgeSeconds ?? 0,
      retryScheduled,
      retryDue,
      byStatus: this.countBy(
        orders as Array<Record<string, unknown>>,
        (order) => order['status'] as string | null | undefined,
      ),
    };
  }

  async getBackupMetrics() {
    let files: Array<{ filename: string; size: number; createdAt: Date }> = [];

    try {
      const entries = await fsPromises.readdir(this.backupDir);
      files = (
        await Promise.all(
          entries
            .filter((entry) => BACKUP_FILENAME_PATTERN.test(entry))
            .map(async (filename) => {
              const stats = await fsPromises.stat(`${this.backupDir}/${filename}`);
              return {
                filename,
                size: stats.size,
                createdAt: stats.birthtime,
              };
            }),
        )
      ).sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') {
        throw error;
      }
    }

    const latest = files[0] ?? null;
    const latestAgeSeconds = latest
      ? Math.max(0, Math.round((Date.now() - latest.createdAt.getTime()) / 1000))
      : 0;

    return {
      total: files.length,
      totalSizeBytes: files.reduce((sum, file) => sum + file.size, 0),
      latest: latest
        ? {
            filename: latest.filename,
            createdAt: latest.createdAt.toISOString(),
            sizeBytes: latest.size,
            ageSeconds: latestAgeSeconds,
          }
        : null,
      maxAgeMs: this.backupMaxAgeMs,
      freshnessStatus:
        latest !== null && latest.createdAt.getTime() >= Date.now() - this.backupMaxAgeMs ? 1 : 0,
    };
  }

  formatPrometheusMetrics(data: Awaited<ReturnType<MetricsService['getAllMetrics']>>): string {
    const lines: string[] = [];
    const emitted = new Set<string>();

    for (const [section, status] of Object.entries(data.collection.sections)) {
      this.appendGauge(
        lines,
        emitted,
        'lyttle_metrics_collection_status',
        'Whether collecting a metrics section succeeded',
        status === 'ok' ? 1 : 0,
        { section },
      );
    }
    this.appendGauge(
      lines,
      emitted,
      'lyttle_metrics_collection_errors_total',
      'Number of metrics collection sections that failed',
      data.collection.errors.length,
    );

    this.appendGauge(
      lines,
      emitted,
      'lyttle_certificates_total',
      'Total number of non-orphaned certificates',
      data.certificates.total,
    );
    this.appendGauge(
      lines,
      emitted,
      'lyttle_certificates_valid',
      'Number of valid certificates',
      data.certificates.valid,
    );
    this.appendGauge(
      lines,
      emitted,
      'lyttle_certificates_expiring_soon',
      'Number of certificates expiring within 30 days',
      data.certificates.expiringSoon,
    );
    this.appendGauge(
      lines,
      emitted,
      'lyttle_certificates_expired',
      'Number of expired certificates',
      data.certificates.expired,
    );
    this.appendGauge(
      lines,
      emitted,
      'lyttle_certificates_avg_days_until_expiry',
      'Average number of days until certificate expiry',
      data.certificates.avgDaysUntilExpiry,
    );
    this.appendGauge(
      lines,
      emitted,
      'lyttle_certificates_oldest_expiry_timestamp_seconds',
      'Unix timestamp for the certificate expiring soonest',
      this.toUnixTimestampSeconds(data.certificates.oldestExpiry),
    );
    this.appendGauge(
      lines,
      emitted,
      'lyttle_certificates_newest_expiry_timestamp_seconds',
      'Unix timestamp for the certificate expiring latest',
      this.toUnixTimestampSeconds(data.certificates.newestExpiry),
    );

    this.appendGauge(
      lines,
      emitted,
      'lyttle_proxy_entries_total',
      'Total number of proxy entries',
      data.proxies.total,
    );
    this.appendGauge(
      lines,
      emitted,
      'lyttle_proxy_entries_ssl',
      'Number of proxy entries with SSL enabled',
      data.proxies.withSsl,
    );
    this.appendGauge(
      lines,
      emitted,
      'lyttle_proxy_entries_without_ssl',
      'Number of proxy entries without SSL enabled',
      data.proxies.withoutSsl,
    );
    this.appendGauge(
      lines,
      emitted,
      'lyttle_proxy_entries_by_type_total',
      'Number of proxy entries by type',
      data.proxies.proxies,
      { type: 'proxy' },
    );
    this.appendGauge(
      lines,
      emitted,
      'lyttle_proxy_entries_by_type_total',
      'Number of proxy entries by type',
      data.proxies.redirects,
      { type: 'redirect' },
    );

    for (const check of data.health.checks) {
      this.appendGauge(
        lines,
        emitted,
        'lyttle_health_dependency_status',
        'Dependency status where 1 indicates healthy and 0 indicates unhealthy',
        check.status === 'ok' ? 1 : 0,
        { name: check.name },
      );
      if (typeof check.latencyMs === 'number') {
        this.appendGauge(
          lines,
          emitted,
          'lyttle_health_dependency_latency_ms',
          'Dependency check latency in milliseconds when available',
          check.latencyMs,
          { name: check.name },
        );
      }
    }
    this.appendGauge(
      lines,
      emitted,
      'lyttle_db_connectivity_status',
      'Database connectivity health where 1 indicates healthy',
      data.health.database?.status === 'ok' ? 1 : 0,
    );
    this.appendGauge(
      lines,
      emitted,
      'lyttle_db_query_duration_ms',
      'Database health-check query duration in milliseconds',
      data.health.database?.latencyMs ?? 0,
    );
    this.appendGauge(
      lines,
      emitted,
      'lyttle_nginx_master_process_status',
      'NGINX master-process health where 1 indicates healthy',
      data.health.nginxMaster?.status === 'ok' ? 1 : 0,
    );
    this.appendOperationalStateMetrics(
      lines,
      emitted,
      'config_apply',
      'Configuration apply state',
      data.health.operations.configApply,
    );
    this.appendOperationalStateMetrics(
      lines,
      emitted,
      'certificate_sync',
      'Certificate sync state',
      data.health.operations.certificateSync,
    );

    this.appendGauge(
      lines,
      emitted,
      'lyttle_cluster_leases_total',
      'Total number of cluster leases',
      data.leases.total,
    );
    this.appendGauge(
      lines,
      emitted,
      'lyttle_cluster_leases_active',
      'Number of active cluster leases',
      data.leases.active,
    );
    this.appendGauge(
      lines,
      emitted,
      'lyttle_cluster_leases_expired',
      'Number of expired cluster leases still present in the database',
      data.leases.expired,
    );
    this.appendGauge(
      lines,
      emitted,
      'lyttle_cluster_leader_present',
      'Whether a leader lease record is present',
      data.leases.leader.present ? 1 : 0,
    );
    this.appendGauge(
      lines,
      emitted,
      'lyttle_cluster_leader_lease_seconds_remaining',
      'Seconds remaining before the leader lease expires',
      data.leases.leader.secondsRemaining,
    );
    this.appendGauge(
      lines,
      emitted,
      'lyttle_cluster_leader_lease_generation',
      'Current leader lease generation / fencing token',
      data.leases.leader.generation,
    );
    this.appendGauge(
      lines,
      emitted,
      'lyttle_cluster_leader_lease_expired',
      'Whether the current leader lease is expired',
      data.leases.leader.isExpired ? 1 : 0,
    );

    this.appendStatusSeries(
      lines,
      emitted,
      'lyttle_cluster_operations_total',
      'Number of cluster operations by status',
      data.clusterOperations.byStatus,
    );
    this.appendStatusSeries(
      lines,
      emitted,
      'lyttle_cluster_operation_acks_total',
      'Number of cluster operation acknowledgements by status',
      data.clusterOperations.acknowledgements.byStatus,
    );
    this.appendStatusSeries(
      lines,
      emitted,
      'lyttle_cluster_operations_by_type_total',
      'Number of cluster operations by operation type',
      data.clusterOperations.byType,
      'operation_type',
    );
    this.appendGauge(
      lines,
      emitted,
      'lyttle_cluster_operations_active_total',
      'Number of active cluster operations',
      data.clusterOperations.active.total,
    );
    this.appendGauge(
      lines,
      emitted,
      'lyttle_cluster_operations_stale_total',
      'Number of active cluster operations older than the configured stale threshold',
      data.clusterOperations.active.stale,
    );
    this.appendGauge(
      lines,
      emitted,
      'lyttle_cluster_operations_oldest_active_age_seconds',
      'Age in seconds of the oldest active cluster operation',
      data.clusterOperations.active.oldestAgeSeconds,
    );
    this.appendGauge(
      lines,
      emitted,
      'lyttle_cluster_operations_stale_threshold_seconds',
      'Stale threshold for active cluster operations in seconds',
      Math.round(data.clusterOperations.active.staleThresholdMs / 1000),
    );
    this.appendGauge(
      lines,
      emitted,
      'lyttle_cluster_operations_recent_failures_total',
      'Number of failed or partially failed cluster operations within the configured failure window',
      data.clusterOperations.recentFailures.total,
    );
    this.appendGauge(
      lines,
      emitted,
      'lyttle_cluster_operations_failure_window_seconds',
      'Observation window for recent cluster operation failure counts in seconds',
      Math.round(data.clusterOperations.recentFailures.windowMs / 1000),
    );

    this.appendStatusSeries(
      lines,
      emitted,
      'lyttle_certificate_orders_total',
      'Number of certificate orders by lifecycle status',
      data.certificateOrders.byStatus,
    );
    this.appendGauge(
      lines,
      emitted,
      'lyttle_certificate_orders_active_total',
      'Number of non-terminal certificate orders',
      data.certificateOrders.active,
    );
    this.appendGauge(
      lines,
      emitted,
      'lyttle_certificate_orders_retry_scheduled_total',
      'Number of certificate orders scheduled to retry in the future',
      data.certificateOrders.retryScheduled,
    );
    this.appendGauge(
      lines,
      emitted,
      'lyttle_certificate_orders_retry_due_total',
      'Number of certificate orders whose retry time is due now',
      data.certificateOrders.retryDue,
    );
    this.appendGauge(
      lines,
      emitted,
      'lyttle_certificate_orders_stale_total',
      'Number of active certificate orders older than the configured stale threshold',
      data.certificateOrders.stale,
    );
    this.appendGauge(
      lines,
      emitted,
      'lyttle_certificate_orders_oldest_active_age_seconds',
      'Age in seconds of the oldest active certificate order',
      data.certificateOrders.oldestActiveAgeSeconds,
    );
    this.appendGauge(
      lines,
      emitted,
      'lyttle_certificate_orders_stale_threshold_seconds',
      'Stale threshold for active certificate orders in seconds',
      Math.round(data.certificateOrders.staleThresholdMs / 1000),
    );

    this.appendGauge(
      lines,
      emitted,
      'lyttle_backups_total',
      'Total number of backup artifacts present on disk',
      data.backups.total,
    );
    this.appendGauge(
      lines,
      emitted,
      'lyttle_backups_total_size_bytes',
      'Combined size in bytes of all backup artifacts present on disk',
      data.backups.totalSizeBytes,
    );
    this.appendGauge(
      lines,
      emitted,
      'lyttle_backup_latest_age_seconds',
      'Age in seconds of the most recent backup artifact',
      data.backups.latest?.ageSeconds ?? 0,
    );
    this.appendGauge(
      lines,
      emitted,
      'lyttle_backup_latest_size_bytes',
      'Size in bytes of the most recent backup artifact',
      data.backups.latest?.sizeBytes ?? 0,
    );
    this.appendGauge(
      lines,
      emitted,
      'lyttle_backup_freshness_status',
      'Whether a recent backup exists within the configured freshness window',
      data.backups.freshnessStatus,
    );
    this.appendGauge(
      lines,
      emitted,
      'lyttle_backup_max_age_seconds',
      'Maximum acceptable age for the latest backup before it is considered stale',
      Math.round(data.backups.maxAgeMs / 1000),
    );

    return lines.join('\n');
  }

  private appendOperationalStateMetrics(
    lines: string[],
    emitted: Set<string>,
    operationName: string,
    helpPrefix: string,
    state: {
      status: string;
      ageMs: number | null;
      maxAgeMs: number;
      lastSuccessAt: string | null;
      lastAttemptAt: string | null;
      lastError: string | null;
    },
  ) {
    this.appendGauge(
      lines,
      emitted,
      `lyttle_${operationName}_status`,
      `${helpPrefix} health where 1 indicates healthy`,
      state.status === 'ok' ? 1 : 0,
    );
    this.appendGauge(
      lines,
      emitted,
      `lyttle_${operationName}_age_seconds`,
      `${helpPrefix} age in seconds since the last successful completion`,
      state.ageMs === null ? 0 : Math.round(state.ageMs / 1000),
    );
    this.appendGauge(
      lines,
      emitted,
      `lyttle_${operationName}_max_age_seconds`,
      `${helpPrefix} maximum acceptable freshness age in seconds`,
      Math.round(state.maxAgeMs / 1000),
    );
    this.appendGauge(
      lines,
      emitted,
      `lyttle_${operationName}_last_success_timestamp_seconds`,
      `${helpPrefix} last successful completion time as a Unix timestamp`,
      this.toUnixTimestampSeconds(state.lastSuccessAt),
    );
    this.appendGauge(
      lines,
      emitted,
      `lyttle_${operationName}_last_attempt_timestamp_seconds`,
      `${helpPrefix} last attempted completion time as a Unix timestamp`,
      this.toUnixTimestampSeconds(state.lastAttemptAt),
    );
    this.appendGauge(
      lines,
      emitted,
      `lyttle_${operationName}_last_error_status`,
      `${helpPrefix} latest attempt error indicator where 1 means an error is present`,
      state.lastError ? 1 : 0,
    );
  }

  private appendStatusSeries(
    lines: string[],
    emitted: Set<string>,
    metricName: string,
    help: string,
    values: Record<string, number>,
    labelName = 'status',
  ) {
    const entries: Array<[string, number]> =
      Object.keys(values).length > 0
        ? Object.entries(values).map(([key, value]) => [key, Number(value)])
        : [['none', 0]];
    for (const [labelValue, value] of entries) {
      this.appendGauge(lines, emitted, metricName, help, value, {
        [labelName]: labelValue,
      });
    }
  }

  private appendGauge(
    lines: string[],
    emitted: Set<string>,
    name: string,
    help: string,
    value: number,
    labels?: Record<string, string>,
  ) {
    if (!emitted.has(name)) {
      lines.push(`# HELP ${name} ${help}`);
      lines.push(`# TYPE ${name} gauge`);
      emitted.add(name);
    }

    lines.push(`${name}${this.formatLabels(labels)} ${this.normalizeMetricValue(value)}`);
    lines.push('');
  }

  private formatLabels(labels?: Record<string, string>) {
    if (!labels || Object.keys(labels).length === 0) {
      return '';
    }

    const rendered = Object.entries(labels)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}="${this.escapeLabelValue(value)}"`)
      .join(',');

    return `{${rendered}}`;
  }

  private escapeLabelValue(value: string) {
    return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
  }

  private normalizeMetricValue(value: number) {
    if (!Number.isFinite(value)) {
      return 0;
    }

    return value;
  }

  private toUnixTimestampSeconds(value: Date | string | null | undefined) {
    if (!value) {
      return 0;
    }

    const date = value instanceof Date ? value : new Date(value);
    const timestamp = date.getTime();
    return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : 0;
  }

  private countBy<T>(items: T[], getKey: (item: T) => string | null | undefined) {
    return items.reduce<Record<string, number>>((counts, item) => {
      const key = getKey(item)?.trim();
      const normalizedKey = key && key.length > 0 ? key : 'unknown';
      const nextCount = (counts[normalizedKey] ?? 0) + 1;
      counts[normalizedKey] = nextCount;
      return counts;
    }, {});
  }

  private getThresholdFromEnv(name: string, fallback: number) {
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

  private getEmptyCertificateMetrics() {
    return {
      total: 0,
      valid: 0,
      expiringSoon: 0,
      expired: 0,
      avgDaysUntilExpiry: 0,
      oldestExpiry: null as Date | null,
      newestExpiry: null as Date | null,
    };
  }

  private getEmptyProxyMetrics() {
    return {
      total: 0,
      withSsl: 0,
      withoutSsl: 0,
      proxies: 0,
      redirects: 0,
    };
  }

  private getEmptyHealthMetrics() {
    return {
      status: 'error',
      summary: {
        total: 0,
        ok: 0,
        error: 0,
      },
      thresholds: {
        configApplyMaxAgeMs: 0,
        certificateSyncMaxAgeMs: 0,
      },
      checks: [] as any[],
      database: null as any,
      nginxMaster: null as any,
      operations: {
        configApply: {
          status: 'error',
          ageMs: null as number | null,
          maxAgeMs: 0,
          lastSuccessAt: null as string | null,
          lastAttemptAt: null as string | null,
          lastError: null as string | null,
        },
        certificateSync: {
          status: 'error',
          ageMs: null as number | null,
          maxAgeMs: 0,
          lastSuccessAt: null as string | null,
          lastAttemptAt: null as string | null,
          lastError: null as string | null,
        },
      },
    };
  }

  private getEmptyLeaseMetrics() {
    return {
      total: 0,
      active: 0,
      expired: 0,
      leader: {
        present: false,
        ownerNodeId: null as string | null,
        ownerHostname: null as string | null,
        generation: 0,
        ttlSeconds: 0,
        secondsRemaining: 0,
        isExpired: true,
      },
    };
  }

  private getEmptyClusterOperationMetrics() {
    return {
      total: 0,
      byStatus: {} as Record<string, number>,
      byType: {} as Record<string, number>,
      active: {
        total: 0,
        stale: 0,
        oldestAgeSeconds: 0,
        staleThresholdMs: this.clusterOperationStaleMaxAgeMs,
      },
      recentFailures: {
        total: 0,
        windowMs: this.clusterOperationFailureWindowMs,
      },
      acknowledgements: {
        total: 0,
        byStatus: {} as Record<string, number>,
      },
    };
  }

  private getEmptyCertificateOrderMetrics() {
    return {
      total: 0,
      active: 0,
      stale: 0,
      staleThresholdMs: this.certificateOrderStaleMaxAgeMs,
      oldestActiveAgeSeconds: 0,
      retryScheduled: 0,
      retryDue: 0,
      byStatus: {} as Record<string, number>,
    };
  }

  private getEmptyBackupMetrics() {
    return {
      total: 0,
      totalSizeBytes: 0,
      latest: null as {
        filename: string;
        createdAt: string;
        sizeBytes: number;
        ageSeconds: number;
      } | null,
      maxAgeMs: this.backupMaxAgeMs,
      freshnessStatus: 0,
    };
  }
}
