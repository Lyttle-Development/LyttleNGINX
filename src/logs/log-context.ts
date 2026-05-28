import { AsyncLocalStorage } from 'node:async_hooks';
import { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';

export type LogContext = {
  request?: AuthenticatedRequest;
  correlationId?: string;
  operationId?: string;
};

const storage = new AsyncLocalStorage<LogContext>();

export function getLogContext() {
  return storage.getStore();
}

export function runWithLogContext<T>(
  context: Partial<LogContext>,
  callback: () => T,
) {
  return storage.run({ ...(storage.getStore() ?? {}), ...context }, callback);
}

export function assignLogContext(context: Partial<LogContext>) {
  const current = storage.getStore();
  if (current) {
    Object.assign(current, context);
  }
}
