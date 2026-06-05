const UNIT_TEST_FILES = [
  'test/unit/health-semantics.test.js',
  'test/unit/entrypoint-recovery.test.js',
  'test/unit/inter-node-addressing.test.js',
  'test/unit/lease-backed-heartbeat.test.js',
  'test/unit/transactional-nginx-rollout.test.js',
  'test/unit/nginx-custom-code-guardrails.test.js',
  'test/unit/domain-validation-and-safe-process.test.js',
  'test/unit/private-key-encryption-at-rest.test.js',
  'test/unit/structured-logging.test.js',
  'test/unit/metrics-and-alerting.test.js',
  'test/unit/auth-service-unit.test.js',
  'test/unit/env-normalization.test.js',
  'test/unit/release-gating.test.js',
];

const INTEGRATION_TEST_FILES = [
  'test/integration/cluster-operations.test.js',
  'test/integration/certificate-order-state-machine.test.js',
  'test/integration/certificate-distribution-and-rollback.test.js',
  'test/integration/acme-strategy-hardening.test.js',
  'test/integration/backup-hardening.test.js',
];

const E2E_TEST_FILES = [
  'test/e2e/auth-lockdown.test.js',
  'test/e2e/auth-foundation.test.js',
  'test/e2e/rbac-authorization.test.js',
  'test/e2e/audit-logging.test.js',
  'test/e2e/proxy-management-api.test.js',
  'test/e2e/cluster-admin-apis.test.js',
  'test/e2e/security-admin-apis.test.js',
];

const CHAOS_TEST_FILES = [
  'test/chaos/chaos-fault-injection.test.js',
];

const BASE_SUITE_DEFINITIONS = {
  unit: {
    description:
      'Fast isolated checks for health semantics, leases, config generation, crypto helpers, and logging/metrics primitives.',
    files: UNIT_TEST_FILES,
  },
  integration: {
    description:
      'Workflow-level checks for cluster operations, certificate orders, artifact rollout, ACME orchestration, and backup flows.',
    files: INTEGRATION_TEST_FILES,
  },
  e2e: {
    description:
      'Nest application and controller surface checks for auth, RBAC, audit, proxy, cluster-admin, and security-admin APIs.',
    files: E2E_TEST_FILES,
  },
  chaos: {
    description:
      'Deterministic fault-injection checks for DB outages, lease recovery, NGINX crashes, rollback safety, node comms failures, and partial certificate activation failures.',
    files: CHAOS_TEST_FILES,
  },
};

const BASELINE_PILLARS = [
  {
    name: 'auth',
    coverage: [
      'test/unit/auth-service-unit.test.js',
      'test/e2e/auth-lockdown.test.js',
      'test/e2e/auth-foundation.test.js',
      'test/e2e/rbac-authorization.test.js',
      'test/e2e/security-admin-apis.test.js',
    ],
  },
  {
    name: 'health',
    coverage: [
      'test/unit/health-semantics.test.js',
      'test/unit/metrics-and-alerting.test.js',
    ],
  },
  {
    name: 'leases',
    coverage: [
      'test/unit/lease-backed-heartbeat.test.js',
      'test/integration/cluster-operations.test.js',
    ],
  },
  {
    name: 'config-generation',
    coverage: [
      'test/unit/transactional-nginx-rollout.test.js',
      'test/unit/nginx-custom-code-guardrails.test.js',
    ],
  },
  {
    name: 'certificate-order-transitions',
    coverage: [
      'test/integration/certificate-order-state-machine.test.js',
      'test/integration/certificate-distribution-and-rollback.test.js',
      'test/integration/acme-strategy-hardening.test.js',
    ],
  },
  {
    name: 'fault-injection',
    coverage: ['test/chaos/chaos-fault-injection.test.js'],
  },
];

function unique(values) {
  return [...new Set(values)];
}

function getSuiteDefinitions() {
  const allFiles = unique(
    Object.values(BASE_SUITE_DEFINITIONS).flatMap((suite) => suite.files),
  );

  return {
    ...BASE_SUITE_DEFINITIONS,
    all: {
      description:
        'All classified repository suites spanning unit, integration, e2e, and chaos coverage pillars.',
      files: allFiles,
    },
  };
}

module.exports = {
  BASELINE_PILLARS,
  getSuiteDefinitions,
};

