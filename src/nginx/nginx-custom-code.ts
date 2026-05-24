import { posix as pathPosix } from 'path';

type NginxCustomStatement =
  | {
      kind: 'directive';
      name: string;
      args: string[];
    }
  | {
      kind: 'block';
      name: string;
      args: string[];
      children: NginxCustomStatement[];
    };

const SERVER_DIRECTIVE_ALLOWLIST = new Set([
  'add_header',
  'client_max_body_size',
  'expires',
]);

const LOCATION_DIRECTIVE_ALLOWLIST = new Set([
  'add_header',
  'alias',
  'autoindex',
  'client_max_body_size',
  'default_type',
  'expires',
  'index',
  'return',
  'root',
  'try_files',
]);

const DEFAULT_ALLOWED_PATH_PREFIXES = [
  '/etc/nginx/custom',
  '/etc/nginx/html',
  '/srv/www',
  '/usr/share/nginx/html',
  '/var/www',
];

export class NginxCustomCodeValidationError extends Error {
  constructor(message: string) {
    super(`Invalid nginx_custom_code: ${message}`);
    this.name = 'NginxCustomCodeValidationError';
  }
}

export function sanitizeNginxCustomCode(
  fragment: string | null | undefined,
): string {
  const statements = parseValidatedCustomCode(fragment);
  if (statements.length === 0) {
    return '';
  }

  return `${renderStatements(statements, '  ').trimEnd()}\n`;
}

export function extractManagedPathsFromCustomCode(
  fragment: string | null | undefined,
): string[] {
  const statements = parseValidatedCustomCode(fragment);
  const paths = new Set<string>();
  collectManagedPaths(statements, paths);
  return [...paths];
}

function parseValidatedCustomCode(
  fragment: string | null | undefined,
): NginxCustomStatement[] {
  const normalized = normalizeFragment(fragment);
  if (!normalized) {
    return [];
  }

  assertNoDisallowedControlCharacters(normalized);

  const tokens = tokenize(normalized);
  const { statements, index } = parseStatements(tokens, 0);
  if (index !== tokens.length) {
    throw new NginxCustomCodeValidationError(
      'unexpected trailing tokens in custom fragment',
    );
  }

  validateStatements(statements, 'server');
  return statements;
}

function normalizeFragment(fragment: string | null | undefined): string {
  return (fragment ?? '').replace(/\r\n?/g, '\n').trim();
}

function assertNoDisallowedControlCharacters(fragment: string): void {
  for (const character of fragment) {
    const code = character.charCodeAt(0);
    const isAllowedWhitespace = character === '\n' || character === '\t';
    if (code < 32 && !isAllowedWhitespace) {
      throw new NginxCustomCodeValidationError(
        'control characters are not allowed in custom fragments',
      );
    }
  }
}

function tokenize(fragment: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;

  const pushCurrent = () => {
    if (current) {
      tokens.push(current);
      current = '';
    }
  };

  for (let index = 0; index < fragment.length; index += 1) {
    const character = fragment[index];

    if (quote) {
      current += character;
      if (escaped) {
        escaped = false;
        continue;
      }

      if (character === '\\') {
        escaped = true;
        continue;
      }

      if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === '#' && current.length === 0) {
      while (index < fragment.length && fragment[index] !== '\n') {
        index += 1;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      current += character;
      quote = character;
      continue;
    }

    if (/\s/.test(character)) {
      pushCurrent();
      continue;
    }

    if (character === '{' || character === '}' || character === ';') {
      pushCurrent();
      tokens.push(character);
      continue;
    }

    current += character;
  }

  if (quote) {
    throw new NginxCustomCodeValidationError(
      'unterminated quoted string in custom fragment',
    );
  }

  pushCurrent();
  return tokens;
}

function parseStatements(
  tokens: string[],
  startIndex: number,
): { statements: NginxCustomStatement[]; index: number } {
  const statements: NginxCustomStatement[] = [];
  let index = startIndex;

  while (index < tokens.length && tokens[index] !== '}') {
    const headTokens: string[] = [];

    while (
      index < tokens.length &&
      !['{', '}', ';'].includes(tokens[index])
    ) {
      headTokens.push(tokens[index]);
      index += 1;
    }

    if (headTokens.length === 0) {
      throw new NginxCustomCodeValidationError(
        'empty or malformed statement in custom fragment',
      );
    }

    const delimiter = tokens[index];
    if (delimiter === ';') {
      statements.push({
        kind: 'directive',
        name: headTokens[0],
        args: headTokens.slice(1),
      });
      index += 1;
      continue;
    }

    if (delimiter === '{') {
      const blockName = headTokens[0];
      const childResult = parseStatements(tokens, index + 1);
      if (tokens[childResult.index] !== '}') {
        throw new NginxCustomCodeValidationError(
          `block "${blockName}" is missing a closing brace`,
        );
      }

      statements.push({
        kind: 'block',
        name: blockName,
        args: headTokens.slice(1),
        children: childResult.statements,
      });
      index = childResult.index + 1;
      continue;
    }

    throw new NginxCustomCodeValidationError(
      `statement "${headTokens.join(' ')}" must end with ";" or contain a block`,
    );
  }

  return { statements, index };
}

function validateStatements(
  statements: NginxCustomStatement[],
  context: 'server' | 'location',
): void {
  for (const statement of statements) {
    if (statement.kind === 'block') {
      validateBlock(statement, context);
      continue;
    }

    validateDirective(statement, context);
  }
}

function validateBlock(
  statement: Extract<NginxCustomStatement, { kind: 'block' }>,
  context: 'server' | 'location',
): void {
  const name = statement.name.toLowerCase();
  if (context !== 'server' || name !== 'location') {
    throw new NginxCustomCodeValidationError(
      `block directive "${statement.name}" is not allowed in ${context}-level custom fragments`,
    );
  }

  validateLocationSelector(statement.args);
  validateStatements(statement.children, 'location');
}

function validateDirective(
  statement: Extract<NginxCustomStatement, { kind: 'directive' }>,
  context: 'server' | 'location',
): void {
  const name = statement.name.toLowerCase();
  const allowlist =
    context === 'server'
      ? SERVER_DIRECTIVE_ALLOWLIST
      : LOCATION_DIRECTIVE_ALLOWLIST;

  if (!allowlist.has(name)) {
    throw new NginxCustomCodeValidationError(
      `directive "${statement.name}" is not allowed in ${context}-level custom fragments`,
    );
  }

  switch (name) {
    case 'add_header':
      validateAddHeader(statement.args);
      return;
    case 'alias':
    case 'root':
      validateManagedPathDirective(statement.name, statement.args);
      return;
    case 'autoindex':
      validateSingleEnumArg(statement.name, statement.args, ['on', 'off']);
      return;
    case 'client_max_body_size':
      validateClientMaxBodySize(statement.args);
      return;
    case 'default_type':
      validateDefaultType(statement.args);
      return;
    case 'expires':
      validateExpires(statement.args);
      return;
    case 'index':
      validateIndex(statement.args);
      return;
    case 'return':
      validateReturn(statement.args);
      return;
    case 'try_files':
      validateTryFiles(statement.args);
      return;
    default:
      throw new NginxCustomCodeValidationError(
        `directive "${statement.name}" is not supported`,
      );
  }
}

function validateLocationSelector(args: string[]): void {
  if (args.length === 0 || args.length > 2) {
    throw new NginxCustomCodeValidationError(
      'location blocks must use a path and may optionally use only the "=" or "^~" modifiers',
    );
  }

  const [maybeModifier, maybePath] = args;
  const modifier = args.length === 2 ? maybeModifier : null;
  const locationPath = args.length === 2 ? maybePath : maybeModifier;

  if (modifier && !['=', '^~'].includes(modifier)) {
    throw new NginxCustomCodeValidationError(
      'location blocks may only use the "=" or "^~" modifiers',
    );
  }

  if (!locationPath.startsWith('/')) {
    throw new NginxCustomCodeValidationError(
      'location paths must start with "/"',
    );
  }

  if (/[{};$]/.test(locationPath) || locationPath.includes('..')) {
    throw new NginxCustomCodeValidationError(
      `location path "${locationPath}" is not allowed`,
    );
  }
}

function validateAddHeader(args: string[]): void {
  if (args.length < 2 || args.length > 3) {
    throw new NginxCustomCodeValidationError(
      'add_header requires a header name, a value, and optionally the "always" flag',
    );
  }

  if (!/^[A-Za-z0-9-]+$/.test(args[0])) {
    throw new NginxCustomCodeValidationError(
      `header name "${args[0]}" is not allowed`,
    );
  }

  if (args.length === 3 && args[2] !== 'always') {
    throw new NginxCustomCodeValidationError(
      'add_header only supports the optional "always" flag as the third argument',
    );
  }
}

function validateManagedPathDirective(name: string, args: string[]): void {
  if (args.length !== 1) {
    throw new NginxCustomCodeValidationError(
      `${name} requires exactly one absolute path argument`,
    );
  }

  const normalizedPath = normalizeManagedPath(args[0]);
  const allowedPrefixes = getAllowedPathPrefixes();
  const isAllowed = allowedPrefixes.some((prefix) =>
    normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`),
  );

  if (!isAllowed) {
    throw new NginxCustomCodeValidationError(
      `${name} path "${normalizedPath}" must stay within one of: ${allowedPrefixes.join(', ')}`,
    );
  }
}

function validateSingleEnumArg(
  name: string,
  args: string[],
  allowedValues: string[],
): void {
  if (args.length !== 1 || !allowedValues.includes(args[0])) {
    throw new NginxCustomCodeValidationError(
      `${name} must be one of: ${allowedValues.join(', ')}`,
    );
  }
}

function validateClientMaxBodySize(args: string[]): void {
  if (args.length !== 1 || !/^(0|\d+[kKmMgG]?)$/.test(args[0])) {
    throw new NginxCustomCodeValidationError(
      'client_max_body_size must be 0 or a size such as 10m',
    );
  }
}

function validateDefaultType(args: string[]): void {
  if (args.length !== 1 || !/^[A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+$/.test(args[0])) {
    throw new NginxCustomCodeValidationError(
      'default_type must be a single MIME type such as text/plain',
    );
  }
}

function validateExpires(args: string[]): void {
  if (
    args.length !== 1 ||
    !/^(off|epoch|max|modified|@?[A-Za-z0-9_:+-]+)$/.test(args[0])
  ) {
    throw new NginxCustomCodeValidationError(
      'expires must be a single cache-control value such as off, max, or 1h',
    );
  }
}

function validateIndex(args: string[]): void {
  if (args.length === 0) {
    throw new NginxCustomCodeValidationError(
      'index requires at least one file name',
    );
  }

  for (const value of args) {
    if (/[{};$]/.test(value) || value.includes('..')) {
      throw new NginxCustomCodeValidationError(
        `index value "${value}" is not allowed`,
      );
    }
  }
}

function validateReturn(args: string[]): void {
  if (args.length === 0 || args.length > 2) {
    throw new NginxCustomCodeValidationError(
      'return requires one or two arguments',
    );
  }

  if (args.length === 2 && !/^\d{3}$/.test(args[0])) {
    throw new NginxCustomCodeValidationError(
      'two-argument return statements must start with an HTTP status code',
    );
  }
}

function validateTryFiles(args: string[]): void {
  if (args.length < 2) {
    throw new NginxCustomCodeValidationError(
      'try_files requires at least two arguments',
    );
  }

  for (const value of args) {
    if (/[{};]/.test(value)) {
      throw new NginxCustomCodeValidationError(
        `try_files value "${value}" is not allowed`,
      );
    }
  }
}

function normalizeManagedPath(rawPathToken: string): string {
  const rawPath = stripWrappingQuotes(rawPathToken);
  if (!rawPath.startsWith('/')) {
    throw new NginxCustomCodeValidationError(
      `managed path "${rawPath}" must be absolute`,
    );
  }

  if (/[{};$]/.test(rawPath) || rawPath.includes('..') || rawPath.includes('\\')) {
    throw new NginxCustomCodeValidationError(
      `managed path "${rawPath}" is not allowed`,
    );
  }

  if (/\s/.test(rawPath)) {
    throw new NginxCustomCodeValidationError(
      `managed path "${rawPath}" must not contain whitespace`,
    );
  }

  const normalized = pathPosix.normalize(rawPath);
  if (!normalized.startsWith('/')) {
    throw new NginxCustomCodeValidationError(
      `managed path "${rawPath}" is not allowed`,
    );
  }

  return normalized;
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function getAllowedPathPrefixes(): string[] {
  const configuredPrefixes = process.env['NGINX_CUSTOM_CODE_ALLOWED_PATH_PREFIXES']
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => pathPosix.normalize(stripWrappingQuotes(value)));

  return configuredPrefixes?.length
    ? configuredPrefixes
    : DEFAULT_ALLOWED_PATH_PREFIXES;
}

function collectManagedPaths(
  statements: NginxCustomStatement[],
  paths: Set<string>,
): void {
  for (const statement of statements) {
    if (statement.kind === 'block') {
      collectManagedPaths(statement.children, paths);
      continue;
    }

    const name = statement.name.toLowerCase();
    if ((name === 'root' || name === 'alias') && statement.args[0]) {
      paths.add(normalizeManagedPath(statement.args[0]));
    }
  }
}

function renderStatements(
  statements: NginxCustomStatement[],
  indent: string,
): string {
  return statements
    .map((statement) => {
      if (statement.kind === 'directive') {
        return `${indent}${statement.name} ${statement.args.join(' ')};`;
      }

      return `${indent}${statement.name} ${statement.args.join(' ')} {\n${renderStatements(
        statement.children,
        `${indent}  `,
      )}\n${indent}}`;
    })
    .join('\n');
}

