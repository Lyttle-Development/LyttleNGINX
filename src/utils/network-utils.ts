import * as os from 'os';
import { isIP } from 'node:net';
import { URL } from 'node:url';

const DEFAULT_CLUSTER_CONTROL_PROTOCOL = 'http';
const DEFAULT_CLUSTER_CONTROL_PORT = 3000;

export type ControlPlaneEndpoint = {
  address: string;
  port: number;
  protocol: 'http' | 'https';
  baseUrl: string;
  source: string;
};

export type ControlPlaneResolution = {
  endpoint: ControlPlaneEndpoint | null;
  issues: string[];
};

type ClusterNodeLike = {
  ipAddress?: string | null;
  metadata?: unknown;
};

/**
 * Resolve the control-plane endpoint that this node should advertise to peers.
 * Session 6 intentionally avoids any public-IP discovery and instead relies on
 * explicit cluster configuration.
 */
export function getLocalControlPlaneRegistration(
  env: NodeJS.ProcessEnv = process.env,
): ControlPlaneResolution {
  const allowHostnameFallback = env['NODE_ENV'] !== 'production';
  const allowLoopback = env['NODE_ENV'] !== 'production';
  const configuredUrl = firstDefinedString(
    env['CLUSTER_CONTROL_URL'],
    env['CONTROL_PLANE_URL'],
  );

  if (configuredUrl) {
    return createEndpointFromUrl(configuredUrl, {
      source: 'CLUSTER_CONTROL_URL',
      allowLoopback,
    });
  }

  const issues: string[] = [];
  const configuredAddress = firstDefinedString(
    env['CLUSTER_CONTROL_ADDRESS'],
    env['CONTROL_PLANE_ADDRESS'],
  );

  const address =
    configuredAddress ??
    (allowHostnameFallback
      ? firstDefinedString(env['HOSTNAME'], os.hostname())
      : null);

  if (!address) {
    return {
      endpoint: null,
      issues: [
        'No control-plane address configured. Set CLUSTER_CONTROL_URL or CLUSTER_CONTROL_ADDRESS.',
      ],
    };
  }

  if (!configuredAddress) {
    issues.push(
      `CLUSTER_CONTROL_ADDRESS is not set; falling back to hostname "${address}"`,
    );
  }

  const configuredPort = firstDefinedString(
    env['CLUSTER_CONTROL_PORT'],
    env['CONTROL_PLANE_PORT'],
  );

  if (!configuredPort) {
    issues.push(
      `CLUSTER_CONTROL_PORT is not set; defaulting to ${DEFAULT_CLUSTER_CONTROL_PORT}`,
    );
  }

  return createEndpointFromParts(
    {
      address,
      port: configuredPort ?? String(DEFAULT_CLUSTER_CONTROL_PORT),
      protocol:
        firstDefinedString(
          env['CLUSTER_CONTROL_PROTOCOL'],
          env['CONTROL_PLANE_PROTOCOL'],
        ) ?? DEFAULT_CLUSTER_CONTROL_PROTOCOL,
      source: configuredAddress ? 'CLUSTER_CONTROL_ADDRESS' : 'HOSTNAME',
    },
    { allowLoopback, issues },
  );
}

export async function getNodeIpAddress(): Promise<string | null> {
  return getLocalControlPlaneRegistration().endpoint?.address ?? null;
}

export function getClusterNodeControlPlaneEndpoint(
  node: ClusterNodeLike,
): ControlPlaneEndpoint | null {
  const controlPlaneMetadata = getControlPlaneMetadata(node.metadata);
  const configuredUrl = firstDefinedString(
    asNonEmptyString(controlPlaneMetadata?.baseUrl),
    asNonEmptyString(controlPlaneMetadata?.url),
  );

  if (configuredUrl) {
    return createEndpointFromUrl(configuredUrl, {
      source: 'cluster-node.metadata.controlPlane.baseUrl',
      allowLoopback: false,
    }).endpoint;
  }

  const address = firstDefinedString(
    asNonEmptyString(controlPlaneMetadata?.address),
    node.ipAddress ?? undefined,
  );
  const port = getMetadataPort(controlPlaneMetadata);

  if (!address || !port) {
    return null;
  }

  return createEndpointFromParts(
    {
      address,
      port,
      protocol:
        asNonEmptyString(controlPlaneMetadata?.protocol) ??
        DEFAULT_CLUSTER_CONTROL_PROTOCOL,
      source: 'cluster-node.metadata.controlPlane',
    },
    { allowLoopback: false, issues: [] },
  ).endpoint;
}

export function buildClusterNodeUrl(
  node: ClusterNodeLike,
  pathname: string,
  query?: Record<string, string | undefined>,
): string | null {
  const endpoint = getClusterNodeControlPlaneEndpoint(node);
  if (!endpoint) {
    return null;
  }

  const url = new URL(endpoint.baseUrl);
  url.pathname = pathname.startsWith('/') ? pathname : `/${pathname}`;

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    }
  }

  return url.toString();
}

/**
 * Check whether an advertised node address is actually reachable from peers.
 * Private RFC1918 ranges are intentionally allowed because the cluster should
 * prefer internal networking, but loopback/unspecified addresses are rejected.
 */
export function isReachableIp(address: string): boolean {
  return isReachableAddress(address, { allowLoopback: false });
}

function createEndpointFromUrl(
  rawUrl: string,
  options: { source: string; allowLoopback: boolean },
): ControlPlaneResolution {
  const issues: string[] = [];
  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch (error) {
    return {
      endpoint: null,
      issues: [
        `Invalid control-plane URL "${rawUrl}": ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }

  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    return {
      endpoint: null,
      issues: [
        'CLUSTER_CONTROL_URL must be an origin only and must not include a path, query string, or hash fragment.',
      ],
    };
  }

  if (!parsed.port) {
    return {
      endpoint: null,
      issues: ['CLUSTER_CONTROL_URL must include an explicit port.'],
    };
  }

  return createEndpointFromParts(
    {
      address: parsed.hostname,
      port: parsed.port,
      protocol: parsed.protocol.replace(/:$/, ''),
      source: options.source,
    },
    { allowLoopback: options.allowLoopback, issues },
  );
}

function createEndpointFromParts(
  parts: {
    address: string;
    port: string;
    protocol: string;
    source: string;
  },
  options: { allowLoopback: boolean; issues: string[] },
): ControlPlaneResolution {
  const issues = [...options.issues];
  const normalizedAddress = normalizeAddress(parts.address);
  const normalizedProtocol = parts.protocol.trim().toLowerCase();
  const parsedPort = Number.parseInt(parts.port, 10);

  if (!normalizedAddress) {
    issues.push('Cluster control-plane address is empty.');
    return { endpoint: null, issues };
  }

  if (!looksLikeHostOrIp(normalizedAddress)) {
    issues.push(`Invalid cluster control-plane address "${parts.address}".`);
    return { endpoint: null, issues };
  }

  if (normalizedProtocol !== 'http' && normalizedProtocol !== 'https') {
    issues.push(
      `Invalid cluster control-plane protocol "${parts.protocol}". Expected http or https.`,
    );
    return { endpoint: null, issues };
  }

  if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
    issues.push(`Invalid cluster control-plane port "${parts.port}".`);
    return { endpoint: null, issues };
  }

  if (!isReachableAddress(normalizedAddress, options)) {
    issues.push(
      `Cluster control-plane address "${normalizedAddress}" is not routable from peer nodes.`,
    );
    return { endpoint: null, issues };
  }

  return {
    endpoint: {
      address: normalizedAddress,
      port: parsedPort,
      protocol: normalizedProtocol,
      baseUrl: `${normalizedProtocol}://${formatAddressForUrl(normalizedAddress)}:${parsedPort}`,
      source: parts.source,
    },
    issues,
  };
}

function getControlPlaneMetadata(
  metadata: unknown,
): Record<string, unknown> | null {
  if (!isRecord(metadata)) {
    return null;
  }

  const controlPlane = metadata['controlPlane'];
  return isRecord(controlPlane) ? controlPlane : null;
}

function getMetadataPort(
  metadata: Record<string, unknown> | null,
): string | null {
  const port = metadata?.port;

  if (typeof port === 'number' && Number.isInteger(port)) {
    return String(port);
  }

  if (typeof port === 'string' && port.trim()) {
    return port.trim();
  }

  return null;
}

function firstDefinedString(
  ...values: Array<string | null | undefined>
): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeAddress(address: string): string {
  return address.trim().replace(/^\[/, '').replace(/]$/, '');
}

function formatAddressForUrl(address: string): string {
  return isIP(address) === 6 ? `[${address}]` : address;
}

function looksLikeHostOrIp(address: string): boolean {
  if (isIP(address) !== 0) {
    return true;
  }

  if (/\s|[/?#]/.test(address)) {
    return false;
  }

  if (address.startsWith('.') || address.endsWith('.') || address.includes('..')) {
    return false;
  }

  return /^[a-zA-Z0-9.-]+$/.test(address);
}

function isReachableAddress(
  address: string,
  options: { allowLoopback: boolean },
): boolean {
  const normalizedAddress = normalizeAddress(address).toLowerCase();

  if (!normalizedAddress) {
    return false;
  }

  if (
    normalizedAddress === '0.0.0.0' ||
    normalizedAddress === '::' ||
    normalizedAddress === '::0'
  ) {
    return false;
  }

  if (isLoopbackAddress(normalizedAddress)) {
    return options.allowLoopback;
  }

  return true;
}

function isLoopbackAddress(address: string): boolean {
  if (address === 'localhost' || address === 'ip6-localhost') {
    return true;
  }

  if (isIP(address) === 4) {
    const octets = address.split('.').map((segment) => Number.parseInt(segment, 10));
    return octets.length === 4 && octets[0] === 127;
  }

  if (isIP(address) === 6) {
    return address === '::1';
  }

  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

