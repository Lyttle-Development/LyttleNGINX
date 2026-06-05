import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProxyEntry, ProxyType } from '@prisma/client';
import { lookup } from 'node:dns/promises';
import { sanitizeNginxCustomCode } from '../nginx/nginx-custom-code';
import { NginxService } from '../nginx/nginx.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  joinDomains,
  normalizeDomains,
  parseDomains,
} from '../utils/domain-utils';
import { CreateProxyEntryDto } from './dto/create-proxy-entry.dto';
import { UpdateProxyEntryDto } from './dto/update-proxy-entry.dto';

type ProxyConfigChangeAction = 'created' | 'updated' | 'deleted';

type SerializedProxyEntry = {
  id: number;
  domains: string[];
  proxyPassHost: string;
  nginxCustomCode: string;
  type: ProxyType;
  ssl: boolean;
};

type ProxyValidationResult = {
  valid: true;
  normalizedEntry: SerializedProxyEntry;
  generatedConfigPreview: string;
  warnings: string[];
};

@Injectable()
export class ProxyService {
  private readonly prisma: PrismaService;
  private readonly nginx: NginxService;

  constructor(prisma: PrismaService, nginx: NginxService) {
    this.prisma = prisma;
    this.nginx = nginx;
  }

  async listProxies() {
    const proxies = await this.prisma.proxyEntry.findMany({
      orderBy: { id: 'asc' },
    });

    return {
      count: proxies.length,
      proxies: proxies.map((entry) => this.serializeProxyEntry(entry)),
    };
  }

  async getProxy(id: number) {
    return this.serializeProxyEntry(await this.getProxyEntryOrThrow(id));
  }

  async createProxy(dto: CreateProxyEntryDto) {
    const validation = await this.validateCandidate(dto);
    const created = await this.prisma.proxyEntry.create({
      data: this.toPersistenceInput(validation),
    });

    return {
      proxy: this.serializeProxyEntry(created),
      validation,
      configChange: this.buildConfigChange('created', created.id),
    };
  }

  async updateProxy(id: number, dto: UpdateProxyEntryDto) {
    const existing = await this.getProxyEntryOrThrow(id);
    const candidate: CreateProxyEntryDto = {
      domains:
        dto.domains ?? parseDomains(existing.domains, { allowWildcard: true }),
      proxyPassHost: dto.proxyPassHost ?? existing.proxy_pass_host,
      nginxCustomCode: dto.nginxCustomCode ?? existing.nginx_custom_code ?? '',
      type: dto.type ?? existing.type,
      ssl: dto.ssl ?? existing.ssl,
    };
    const validation = await this.validateCandidate(candidate, id);

    const updated = await this.prisma.proxyEntry.update({
      where: { id },
      data: this.toPersistenceInput(validation),
    });

    return {
      proxy: this.serializeProxyEntry(updated),
      validation,
      configChange: this.buildConfigChange('updated', updated.id),
    };
  }

  async deleteProxy(id: number) {
    const existing = await this.getProxyEntryOrThrow(id);
    await this.prisma.proxyEntry.delete({ where: { id } });

    return {
      deleted: true,
      proxy: this.serializeProxyEntry(existing),
      configChange: this.buildConfigChange('deleted', id),
    };
  }

  async validateDraftProxy(
    dto: CreateProxyEntryDto,
  ): Promise<ProxyValidationResult> {
    return this.validateCandidate(dto);
  }

  async validateStoredProxy(id: number): Promise<ProxyValidationResult> {
    const entry = await this.getProxyEntryOrThrow(id);
    return this.validateCandidate(
      {
        domains: parseDomains(entry.domains, { allowWildcard: true }),
        proxyPassHost: entry.proxy_pass_host,
        nginxCustomCode: entry.nginx_custom_code ?? '',
        type: entry.type,
        ssl: entry.ssl,
      },
      id,
    );
  }

  async testProxyUpstream(id: number) {
    const entry = await this.getProxyEntryOrThrow(id);
    if (entry.type !== ProxyType.PROXY) {
      throw new BadRequestException(
        'Upstream connectivity checks apply only to PROXY entries',
      );
    }

    const upstream = new URL(entry.proxy_pass_host);
    const hostname = upstream.hostname;
    const protocol = upstream.protocol.replace(/:$/, '');
    const port = upstream.port
      ? Number.parseInt(upstream.port, 10)
      : upstream.protocol === 'https:'
        ? 443
        : 80;

    try {
      const addresses = await lookup(hostname, { all: true });
      return {
        ok: true,
        proxyId: entry.id,
        proxyPassHost: entry.proxy_pass_host,
        hostname,
        protocol,
        port,
        addresses: addresses.map((address) => ({
          address: address.address,
          family: address.family,
        })),
        testedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        ok: false,
        proxyId: entry.id,
        proxyPassHost: entry.proxy_pass_host,
        hostname,
        protocol,
        port,
        addresses: [],
        testedAt: new Date().toISOString(),
        error:
          error instanceof Error
            ? error.message
            : 'Failed to resolve upstream hostname',
      };
    }
  }

  serializeProxyEntry(entry: ProxyEntry): SerializedProxyEntry {
    return {
      id: entry.id,
      domains: parseDomains(entry.domains, { allowWildcard: true }),
      proxyPassHost: entry.proxy_pass_host,
      nginxCustomCode: entry.nginx_custom_code ?? '',
      type: entry.type,
      ssl: entry.ssl,
    };
  }

  private async validateCandidate(
    candidate: CreateProxyEntryDto,
    existingId?: number,
  ): Promise<ProxyValidationResult> {
    const domains = normalizeDomains(candidate.domains, {
      allowWildcard: true,
    });
    const type = candidate.type;
    const proxyPassHost = this.normalizeProxyPassHost(
      type,
      candidate.proxyPassHost,
    );
    const nginxCustomCode = this.normalizeCustomCode(candidate.nginxCustomCode);

    await this.ensureNoDomainConflicts(domains, existingId);

    const previewEntry = {
      id: existingId ?? 0,
      domains: joinDomains(domains, { allowWildcard: true }),
      proxy_pass_host: proxyPassHost,
      nginx_custom_code: nginxCustomCode,
      type,
      ssl: candidate.ssl,
    } as ProxyEntry;

    const generatedConfigPreview = this.nginx.generateNginxConfig(
      [previewEntry],
      {
        resolved: true,
      },
    );

    if (!generatedConfigPreview.trim()) {
      throw new BadRequestException(
        'Proxy entry validation produced an empty NGINX config',
      );
    }

    const warnings: string[] = [];
    if (candidate.ssl && domains.some((domain) => domain.startsWith('*.'))) {
      warnings.push(
        'Wildcard proxy domains require pre-provisioned certificate material because the built-in HTTP-01 ACME flow does not issue wildcard certificates.',
      );
    }

    return {
      valid: true,
      normalizedEntry: this.serializeProxyEntry(previewEntry),
      generatedConfigPreview,
      warnings,
    };
  }

  private normalizeCustomCode(value: string | undefined): string | null {
    const sanitized = sanitizeNginxCustomCode(value ?? '');
    const normalized = sanitized.trimEnd();
    return normalized.length > 0 ? normalized : null;
  }

  private normalizeProxyPassHost(type: ProxyType, value: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BadRequestException('proxyPassHost must be a non-empty string');
    }

    const normalized = value.trim();
    if (/[\u0000-\u001f\u007f\s]/.test(normalized)) {
      throw new BadRequestException(
        'proxyPassHost cannot contain whitespace or control characters',
      );
    }

    if (type === ProxyType.REDIRECT && normalized.startsWith('/')) {
      return normalized;
    }

    let parsed: globalThis.URL;
    try {
      parsed = new URL(normalized);
    } catch {
      throw new BadRequestException(
        'proxyPassHost must be an absolute http(s) URL, or an absolute path for redirects',
      );
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new BadRequestException(
        'proxyPassHost must use the http or https scheme',
      );
    }

    if (!parsed.hostname) {
      throw new BadRequestException('proxyPassHost must include a hostname');
    }

    if (parsed.username || parsed.password) {
      throw new BadRequestException(
        'proxyPassHost must not include embedded credentials',
      );
    }

    if (parsed.hash) {
      throw new BadRequestException(
        'proxyPassHost must not include a URL fragment',
      );
    }

    return parsed.toString();
  }

  private async ensureNoDomainConflicts(
    candidateDomains: string[],
    existingId?: number,
  ): Promise<void> {
    const existingEntries = await this.prisma.proxyEntry.findMany({
      where: existingId ? { id: { not: existingId } } : undefined,
      orderBy: { id: 'asc' },
    });

    for (const entry of existingEntries) {
      const existingDomains = parseDomains(entry.domains, {
        allowWildcard: true,
      });
      const conflictingDomain = this.findConflictingDomain(
        candidateDomains,
        existingDomains,
      );

      if (conflictingDomain) {
        throw new BadRequestException(
          `Domain ${JSON.stringify(conflictingDomain)} is already managed by proxy entry ${entry.id}`,
        );
      }
    }
  }

  private findConflictingDomain(
    leftDomains: string[],
    rightDomains: string[],
  ): string | null {
    for (const leftDomain of leftDomains) {
      for (const rightDomain of rightDomains) {
        if (this.domainsConflict(leftDomain, rightDomain)) {
          return leftDomain;
        }
      }
    }

    return null;
  }

  private domainsConflict(leftDomain: string, rightDomain: string): boolean {
    return (
      leftDomain === rightDomain ||
      this.domainMatchesWildcard(leftDomain, rightDomain) ||
      this.domainMatchesWildcard(rightDomain, leftDomain)
    );
  }

  private domainMatchesWildcard(
    domain: string,
    wildcardDomain: string,
  ): boolean {
    if (!wildcardDomain.startsWith('*.')) {
      return false;
    }

    const wildcardBase = wildcardDomain.slice(2);
    return (
      domain.length > wildcardBase.length + 1 &&
      domain.endsWith(`.${wildcardBase}`)
    );
  }

  private toPersistenceInput(validation: ProxyValidationResult) {
    return {
      domains: joinDomains(validation.normalizedEntry.domains, {
        allowWildcard: true,
      }),
      proxy_pass_host: validation.normalizedEntry.proxyPassHost,
      nginx_custom_code:
        validation.normalizedEntry.nginxCustomCode.trim().length > 0
          ? validation.normalizedEntry.nginxCustomCode
          : null,
      type: validation.normalizedEntry.type,
      ssl: validation.normalizedEntry.ssl,
    };
  }

  private buildConfigChange(action: ProxyConfigChangeAction, proxyId: number) {
    return {
      scope: 'proxy-entry',
      action,
      proxyId,
      reloadRequired: true,
      suggestedOperationEndpoint: '/cluster/reload',
    };
  }

  private async getProxyEntryOrThrow(id: number): Promise<ProxyEntry> {
    const entry = await this.prisma.proxyEntry.findUnique({ where: { id } });
    if (!entry) {
      throw new NotFoundException(`Proxy entry ${id} was not found`);
    }

    return entry;
  }
}
