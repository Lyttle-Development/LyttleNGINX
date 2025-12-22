import * as os from 'os';

/**
 * Get the public IP address of this node using an external service
 */
export async function getPublicIpAddress(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout

    const response = await fetch('https://api.ipify.org', {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const ip = await response.text();
      // Basic validation to ensure it looks like an IP
      if (/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(ip)) {
        return ip;
      }
    }
    return null;
  } catch (error) {
    // Fail silently on network errors, fallback will be used
    return null;
  }
}

/**
 * Get the primary IP address of this node
 * Prioritizes public IP, then non-internal IPv4 addresses, falls back to internal addresses
 */
export async function getNodeIpAddress(): Promise<string | null> {
  // Try to get public IP first
  const publicIp = await getPublicIpAddress();
  if (publicIp) {
    return publicIp;
  }

  try {
    const interfaces = os.networkInterfaces();
    const addresses: string[] = [];

    // Collect all IPv4 addresses
    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      if (!iface) continue;

      for (const addr of iface) {
        // Only consider IPv4 addresses
        if (addr.family === 'IPv4') {
          addresses.push(addr.address);
        }
      }
    }

    // Filter and prioritize addresses
    const externalAddresses = addresses.filter((addr) => !isInternalIp(addr));
    const internalAddresses = addresses.filter(
      (addr) => isInternalIp(addr) && addr !== '127.0.0.1',
    );

    // Prefer external addresses, then internal (non-localhost), then localhost
    if (externalAddresses.length > 0) {
      return externalAddresses[0];
    }

    if (internalAddresses.length > 0) {
      return internalAddresses[0];
    }

    // Fallback to localhost if nothing else found
    if (addresses.includes('127.0.0.1')) {
      return '127.0.0.1';
    }

    return null;
  } catch (error) {
    console.error('Failed to get node IP address:', error);
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
  if (parts[0] === 169 && parts[1] === 254) return true;

  return false;
}

/**
 * Check if IP address is reachable (public or internal network)
 */
export function isReachableIp(ip: string): boolean {
  if (!ip) return false;
  if (ip === '127.0.0.1') return false; // Localhost is not reachable from other nodes
  return true;
}
