import {
  Controller,
  Get,
  HttpStatus,
  Logger,
  Param,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../auth/decorators/public.decorator';

@Controller('.well-known/acme-challenge')
@Public()
export class AcmeController {
  private readonly logger = new Logger(AcmeController.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Serve ACME challenges from database
   * This allows any node to serve challenges created by the leader
   */
  @Get(':token')
  async getChallenge(
    @Param('token') token: string,
    @Res() res: Response,
  ): Promise<void> {
    this.logger.log(`[ACME] Challenge request received for token: ${token}`);

    try {
      const acmeChallengeDelegate = (this.prisma as unknown as {
        acmeChallenge?: {
          findFirst?: (args: unknown) => Promise<{
            id: string;
            token: string;
            keyAuth: string;
            domain: string;
            expiresAt: Date;
          } | null>;
          findUnique?: (args: unknown) => Promise<{
            id: string;
            token: string;
            keyAuth: string;
            domain: string;
            expiresAt: Date;
          } | null>;
          update?: (args: unknown) => Promise<unknown>;
          delete?: (args: unknown) => Promise<unknown>;
        };
      }).acmeChallenge;

      if (!acmeChallengeDelegate) {
        this.logger.error('[ACME] Prisma ACME challenge delegate is unavailable');
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).send('Internal error');
        return;
      }

      // Look up challenge in database
      this.logger.debug(`[ACME] Looking up challenge in database: ${token}`);
      const challenge =
        typeof acmeChallengeDelegate.findFirst === 'function'
          ? await acmeChallengeDelegate.findFirst({
              where: {
                token,
                status: 'presented',
              },
            })
          : await acmeChallengeDelegate.findUnique?.({
              where: { token },
            });

      if (!challenge) {
        this.logger.warn(`[ACME] Challenge not found in database: ${token}`);
        res.status(HttpStatus.NOT_FOUND).send('Challenge not found');
        return;
      }

      this.logger.log(`[ACME] Challenge found for domain: ${challenge.domain}`);

      // Check if expired
      if (new Date() > challenge.expiresAt) {
        this.logger.warn(
          `[ACME] Challenge expired for token ${token} (expired at: ${challenge.expiresAt})`,
        );
        if (typeof acmeChallengeDelegate.update === 'function') {
          await acmeChallengeDelegate.update({
            where: { id: challenge.id },
            data: {
              status: 'expired',
              finalizedAt: new Date(),
            },
          });
        } else if (typeof acmeChallengeDelegate.delete === 'function') {
          await acmeChallengeDelegate.delete({
            where: { id: challenge.id },
          });
        }
        res.status(HttpStatus.NOT_FOUND).send('Challenge expired');
        return;
      }

      // Return the key authorization (Let's Encrypt expects plain text)
      this.logger.log(
        `[ACME] Returning challenge response for ${challenge.domain} (keyAuth length: ${challenge.keyAuth.length})`,
      );
      await acmeChallengeDelegate.update?.({
        where: { id: challenge.id },
        data: {
          lastServedAt: new Date(),
        },
      });
      res
        .status(HttpStatus.OK)
        .contentType('text/plain')
        .send(challenge.keyAuth);
    } catch (error) {
      this.logger.error(
        `[ACME] Error serving challenge for token ${token}: ${error instanceof Error ? error.message : String(error)}`,
      );
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).send('Internal error');
    }
  }
}
