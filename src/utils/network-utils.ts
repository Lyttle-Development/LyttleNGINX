import * as os from 'os';

/**
 * Get the public IP address of this node using external services
 * Tries multiple services for redundancy
 */
export async function getPublicIpAddress(): Promise<string | null> {
  const services = [
    'https://api.ipify.org',
    'https://api64.ipify.org',
    'https://icanhazip.com',
    'https://ifconfig.me/ip',
  ];

  for (const service of services) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout

      const response = await fetch(service, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const ip = (await response.text()).trim();
        // Basic validation to ensure it looks like an IPv4 address
        if (/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(ip)) {
          // Additional validation: check that each octet is 0-255
          const octets = ip.split('.').map(Number);
          if (octets.every((octet) => octet >= 0 && octet <= 255)) {
            return ip;
          }
        }
      }
    } catch (error) {
      // Try next service if this one fails
    }
  }

  return null;
}

/**
 * Get the primary IP address of this node
 * Prioritizes public IP, then non-internal IPv4 addresses, falls back to internal addresses
 * PRODUCTION-GRADE: Multiple fallbacks and comprehensive error handling
 */
export async function getNodeIpAddress(): Promise<string | null> {
  // Try to get public IP first (with multiple services for redundancy)
  const publicIp = await getPublicIpAddress();
  if (publicIp) {
    console.log(`[Network] Using public IP: ${publicIp}`);
    return publicIp;
  }

  console.log(
    '[Network] Public IP detection failed, using local network interfaces',
  );

  try {
    const interfaces = os.networkInterfaces();
    const addresses: string[] = [];

    // Collect all IPv4 addresses
    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      if (!iface) continue;

      for (const addr of iface) {
        // Only consider IPv4 addresses
        if (addr.family === 'IPv4' && !addr.internal) {
          addresses.push(addr.address);
          console.log(`[Network] Found interface ${name}: ${addr.address}`);
        }
      }
    }

    // Filter and prioritize addresses
    const externalAddresses = addresses.filter((addr) => !isInternalIp(addr));
    const internalAddresses = addresses.filter(
      (addr) => isInternalIp(addr) && addr !== '127.0.0.1',
    );

    // Prefer external addresses, then internal (non-localhost)
    if (externalAddresses.length > 0) {
      console.log(`[Network] Using external address: ${externalAddresses[0]}`);
      return externalAddresses[0];
    }

    if (internalAddresses.length > 0) {
      console.log(`[Network] Using internal address: ${internalAddresses[0]}`);
      return internalAddresses[0];
    }

    // Last resort: use localhost
    console.warn(
      '[Network] No network interfaces found, falling back to localhost',
    );
    return '127.0.0.1';
  } catch (error) {
    console.error(
      `[Network] Failed to get node IP address: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/**
 * Check if an IP address is internal/private
 */
function isInternalIp(ip: string): boolean {
  const parts = ip.split('.').map(Number);

  if (parts.length !== 4) return false;

  // 127.x.x.x (loopback)
  if (parts[0] === 127) return true;

  // 10.x.x.x (private)
  if (parts[0] === 10) return true;

  // 172.16.x.x - 172.31.x.x (private)
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;

  // 192.168.x.x (private)
  if (parts[0] === 192 && parts[1] === 168) return true;

  // 169.254.x.x (link-local)
  return parts[0] === 169 && parts[1] === 254;
}

/**
 * Check if IP address is reachable (public or internal network)
 */
export function isReachableIp(ip: string): boolean {
  if (!ip) return false;
  if (ip === '127.0.0.1') return false; // Localhost is not reachable from other nodes
  return true;
}
