import { Injectable } from '@nestjs/common';
import { access } from 'fs/promises';

@Injectable()
export class HealthService {
  async live() {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  async ready() {
    const checks: Record<string, string>[] = [];

    // 1) Check local nginx HTTP response (short timeout)
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch('http://127.0.0.1:80/', { signal: controller.signal });
      clearTimeout(timeout);
      checks.push({ nginx_http: res.ok ? 'ok' : `status:${res.status}` });
    } catch (err) {
      checks.push({ nginx_http: `error:${String(err)}` });
    }

    // 2) Ensure nginx config file exists
    try {
      await access('/etc/nginx/nginx.conf');
      checks.push({ nginx_conf: 'ok' });
    } catch {
      checks.push({ nginx_conf: 'missing' });
    }

    const healthy = checks.every((c) => Object.values(c)[0] === 'ok');

    return {
      status: healthy ? 'ok' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    };
  }
}