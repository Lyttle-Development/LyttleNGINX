#!/usr/bin/env node

const { spawn } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const coverageCommand = [
  path.join(repoRoot, 'test/run-suite.js'),
  'all',
  '--coverage',
];

const thresholds = {
  lines: readThreshold('COVERAGE_MIN_LINES', 70),
  branches: readThreshold('COVERAGE_MIN_BRANCHES', 67),
  functions: readThreshold('COVERAGE_MIN_FUNCTIONS', 76),
};

const child = spawn(process.execPath, coverageCommand, {
  cwd: repoRoot,
  env: process.env,
  stdio: ['inherit', 'pipe', 'pipe'],
});

let transcript = '';

child.stdout.on('data', (chunk) => {
  const text = chunk.toString();
  transcript += text;
  process.stdout.write(chunk);
});

child.stderr.on('data', (chunk) => {
  const text = chunk.toString();
  transcript += text;
  process.stderr.write(chunk);
});

child.on('close', (code, signal) => {
  if (typeof code === 'number' && code !== 0) {
    process.exit(code);
  }

  if (signal) {
    console.error(`Coverage run terminated by signal: ${signal}`);
    process.exit(1);
  }

  const summary = parseCoverageSummary(transcript);
  if (!summary) {
    console.error('Unable to locate the final "all files" coverage summary in the test output.');
    process.exit(1);
  }

  console.log(
    `Coverage summary: lines=${summary.lines.toFixed(2)}% branches=${summary.branches.toFixed(2)}% functions=${summary.functions.toFixed(2)}%`,
  );
  console.log(
    `Coverage thresholds: lines>=${thresholds.lines}% branches>=${thresholds.branches}% functions>=${thresholds.functions}%`,
  );

  const failures = [];
  if (summary.lines < thresholds.lines) {
    failures.push(`lines ${summary.lines.toFixed(2)}% < ${thresholds.lines}%`);
  }
  if (summary.branches < thresholds.branches) {
    failures.push(`branches ${summary.branches.toFixed(2)}% < ${thresholds.branches}%`);
  }
  if (summary.functions < thresholds.functions) {
    failures.push(`functions ${summary.functions.toFixed(2)}% < ${thresholds.functions}%`);
  }

  if (failures.length > 0) {
    console.error(`Coverage gate failed: ${failures.join(', ')}`);
    process.exit(1);
  }

  console.log('Coverage gate passed.');
});

function readThreshold(envName, fallback) {
  const rawValue = process.env[envName];
  if (rawValue == null || rawValue.trim() === '') {
    return fallback;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error(`${envName} must be a number between 0 and 100. Received: ${rawValue}`);
  }

  return parsed;
}

function parseCoverageSummary(output) {
  const normalized = stripAnsi(output);
  const match = normalized.match(/all files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|/);

  if (!match) {
    return null;
  }

  return {
    lines: Number(match[1]),
    branches: Number(match[2]),
    functions: Number(match[3]),
  };
}

function stripAnsi(value) {
  return value.replace(/\u001B\[[0-9;]*m/g, '');
}

