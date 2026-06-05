export function normalizePossiblyQuotedEnvValue(
  value: string | undefined | null,
): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const startsWithDoubleQuote = trimmed.startsWith('"');
  const endsWithDoubleQuote = trimmed.endsWith('"');
  if (startsWithDoubleQuote && endsWithDoubleQuote && trimmed.length >= 2) {
    return trimmed.slice(1, -1).trim();
  }

  const startsWithSingleQuote = trimmed.startsWith("'");
  const endsWithSingleQuote = trimmed.endsWith("'");
  if (startsWithSingleQuote && endsWithSingleQuote && trimmed.length >= 2) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

