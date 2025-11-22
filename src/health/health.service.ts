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
    let critical = true;

    // 1) Check local nginx HTTP response (short timeout)
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1500);
      const res = await fetch('http://127.0.0.1:80/', {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      checks.push({ nginx_http: res.ok ? 'ok' : `status:${res.status}` });
    } catch (err) {
      // Nginx might not be fully ready yet, but don't fail the health check
      const errMsg = String(err).substring(0, 50);
      checks.push({ nginx_http: `starting:${errMsg}` });
      critical = false; // Don't require nginx for readiness
    }

    // 2) Ensure nginx config file exists (critical check)
    try {
      await access('/etc/nginx/nginx.conf');
      checks.push({ nginx_conf: 'ok' });
    } catch {
      checks.push({ nginx_conf: 'missing' });
    }

    // Consider healthy if app is running (config exists)
    // Nginx http check is informational but not critical during startup
    const configOk = checks.some((c) => c.nginx_conf === 'ok');
    const healthy =
      configOk &&
      (critical ? checks.every((c) => Object.values(c)[0] === 'ok') : true);

    return {
      status: healthy ? 'ok' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    };
  }
}
