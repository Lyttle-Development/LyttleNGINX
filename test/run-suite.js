#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { BASELINE_PILLARS, getSuiteDefinitions } = require('./test-harness.config');

const repoRoot = path.resolve(__dirname, '..');
const suiteDefinitions = getSuiteDefinitions();
const validSuites = Object.keys(suiteDefinitions);
const args = process.argv.slice(2);

const options = {
  coverage: false,
  list: false,
};
const requestedSuites = [];

for (const arg of args) {
  if (arg === '--coverage') {
    options.coverage = true;
    continue;
  }

  if (arg === '--list') {
    options.list = true;
    continue;
  }

  requestedSuites.push(arg);
}

if (options.list) {
  console.log('Available test suites:\n');
  for (const [suiteName, suite] of Object.entries(suiteDefinitions)) {
    console.log(
      `- ${suiteName}: ${suite.description} (${suite.files.length} file${suite.files.length === 1 ? '' : 's'})`,
    );
  }

  console.log('\nBaseline coverage pillars:\n');
  for (const pillar of BASELINE_PILLARS) {
    console.log(`- ${pillar.name}`);
    for (const file of pillar.coverage) {
      console.log(`  - ${file}`);
    }
  }

  process.exit(0);
}

const suitesToRun = requestedSuites.length > 0 ? requestedSuites : ['all'];
const invalidSuites = suitesToRun.filter((suite) => !validSuites.includes(suite));
if (invalidSuites.length > 0) {
  console.error(
    `Unknown test suite(s): ${invalidSuites.join(', ')}. Valid suites: ${validSuites.join(', ')}`,
  );
  process.exit(1);
}

const classifiedFiles = new Set(
  suiteDefinitions.all.files.map((file) => normalizeRelativePath(file)),
);
const discoveredFiles = discoverTestFiles(path.join(repoRoot, 'test'));
const unclassifiedFiles = discoveredFiles.filter((file) => !classifiedFiles.has(file));
const missingFiles = [...classifiedFiles].filter((file) => !discoveredFiles.includes(file));

if (unclassifiedFiles.length > 0 || missingFiles.length > 0) {
  if (unclassifiedFiles.length > 0) {
    console.error('Unclassified test files found in the repository:');
    for (const file of unclassifiedFiles) {
      console.error(`- ${file}`);
    }
  }

  if (missingFiles.length > 0) {
    console.error('Classified test files missing from disk:');
    for (const file of missingFiles) {
      console.error(`- ${file}`);
    }
  }

  process.exit(1);
}

const filesToRun = unique(
  suitesToRun.flatMap((suite) => suiteDefinitions[suite].files),
).map((file) => path.join(repoRoot, file));

if (filesToRun.length === 0) {
  console.error('No test files selected for execution.');
  process.exit(1);
}

console.log(
  `Running ${suitesToRun.join(', ')} suite${suitesToRun.length === 1 ? '' : 's'} (${filesToRun.length} file${filesToRun.length === 1 ? '' : 's'})${options.coverage ? ' with coverage' : ''}...`,
);

const childArgs = [];
if (options.coverage) {
  childArgs.push('--experimental-test-coverage');
}
childArgs.push(
  '--test',
  '-r',
  'ts-node/register/transpile-only',
  '-r',
  path.join(repoRoot, 'test/setup/register.js'),
  ...filesToRun,
);

const result = spawnSync(process.execPath, childArgs, {
  cwd: repoRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    TS_NODE_PROJECT:
      process.env.TS_NODE_PROJECT ?? path.join(repoRoot, 'tsconfig.test.json'),
  },
});

if (typeof result.status === 'number') {
  process.exit(result.status);
}

process.exit(1);

function discoverTestFiles(rootDir) {
  const results = [];

  walk(rootDir);
  return results.sort();

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith('.test.js')) {
        results.push(normalizeRelativePath(path.relative(repoRoot, fullPath)));
      }
    }
  }
}

function normalizeRelativePath(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function unique(values) {
  return [...new Set(values)];
}

