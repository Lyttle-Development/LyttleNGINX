const UNIT_TEST_FILES = [
  'test/session4/health-semantics.test.js',
  'test/session5/entrypoint-recovery.test.js',
  'test/session6/inter-node-addressing.test.js',
  'test/session11/lease-backed-heartbeat.test.js',
  'test/session13/transactional-nginx-rollout.test.js',
  'test/session14/nginx-custom-code-guardrails.test.js',
  'test/session15/domain-validation-and-safe-process.test.js',
  'test/session19/private-key-encryption-at-rest.test.js',
  'test/session24/structured-logging.test.js',
  'test/session25/metrics-and-alerting.test.js',
  'test/session26/auth-service-unit.test.js',
];

const INTEGRATION_TEST_FILES = [
  'test/session12/cluster-operations.test.js',
  'test/session16/certificate-order-state-machine.test.js',
  'test/session17/certificate-distribution-and-rollback.test.js',
  'test/session18/acme-strategy-hardening.test.js',
  'test/session20/backup-hardening.test.js',
];

const E2E_TEST_FILES = [
  'test/session3/auth-lockdown.test.js',
  'test/session7/auth-foundation.test.js',
  'test/session8/rbac-authorization.test.js',
  'test/session9/audit-logging.test.js',
  'test/session21/proxy-management-api.test.js',
  'test/session22/cluster-admin-apis.test.js',
  'test/session23/security-admin-apis.test.js',
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
};

const BASELINE_PILLARS = [
  {
    name: 'auth',
    coverage: [
      'test/session26/auth-service-unit.test.js',
      'test/session3/auth-lockdown.test.js',
      'test/session7/auth-foundation.test.js',
      'test/session8/rbac-authorization.test.js',
      'test/session23/security-admin-apis.test.js',
    ],
  },
  {
    name: 'health',
    coverage: [
      'test/session4/health-semantics.test.js',
      'test/session25/metrics-and-alerting.test.js',
    ],
  },
  {
    name: 'leases',
    coverage: [
      'test/session11/lease-backed-heartbeat.test.js',
      'test/session12/cluster-operations.test.js',
    ],
  },
  {
    name: 'config-generation',
    coverage: [
      'test/session13/transactional-nginx-rollout.test.js',
      'test/session14/nginx-custom-code-guardrails.test.js',
    ],
  },
  {
    name: 'certificate-order-transitions',
    coverage: [
      'test/session16/certificate-order-state-machine.test.js',
      'test/session17/certificate-distribution-and-rollback.test.js',
      'test/session18/acme-strategy-hardening.test.js',
    ],
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
        'All classified repository suites spanning unit, integration, and e2e coverage pillars.',
      files: allFiles,
    },
  };
}

module.exports = {
  BASELINE_PILLARS,
  getSuiteDefinitions,
};

