import { Prisma } from '@prisma/client';

export function toPrismaJsonValue(value: unknown): Prisma.InputJsonValue {
  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : String(value);
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(value.stack ? { stack: value.stack } : {}),
    } satisfies Prisma.InputJsonObject;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toPrismaJsonValue(entry));
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value).flatMap(([key, entry]) =>
      entry === undefined ? [] : [[key, toPrismaJsonValue(entry)] as const],
    );

    return Object.fromEntries(entries) as Prisma.InputJsonObject;
  }

  return String(value);
}

export function toPrismaNullableJsonValue(
  value: unknown,
): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue {
  return value === null ? Prisma.JsonNull : toPrismaJsonValue(value);
}

