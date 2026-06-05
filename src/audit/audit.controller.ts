import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { AuthorizeAdmin } from '../auth/decorators/authorize.decorator';
import { AuditService } from './audit.service';
import { AuditOutcome } from './types/audit.types';

const AUDIT_OUTCOMES: AuditOutcome[] = ['success', 'failure', 'denied'];

@Controller('audit')
@AuthorizeAdmin('security-admin')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  async listEvents(
    @Query('limit') limit?: string,
    @Query('action') action?: string,
    @Query('actorSubject') actorSubject?: string,
    @Query('correlationId') correlationId?: string,
    @Query('outcome') outcome?: AuditOutcome,
  ) {
    if (outcome && !AUDIT_OUTCOMES.includes(outcome)) {
      throw new BadRequestException(
        `Invalid audit outcome. Expected one of: ${AUDIT_OUTCOMES.join(', ')}`,
      );
    }

    const parsedLimit = Number.parseInt(limit || '', 10);
    const resolvedLimit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 200)
      : 50;

    const events = await this.auditService.listEvents({
      action: action?.trim() || undefined,
      actorSubject: actorSubject?.trim() || undefined,
      correlationId: correlationId?.trim() || undefined,
      limit: resolvedLimit,
      outcome,
    });

    return {
      count: events.length,
      events,
    };
  }
}
