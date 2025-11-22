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

@Controller('.well-known/acme-challenge')
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
      // Look up challenge in database
      this.logger.debug(`[ACME] Looking up challenge in database: ${token}`);
      const challenge = await this.prisma.acmeChallenge.findUnique({
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
        // Clean up expired challenge
        await this.prisma.acmeChallenge.delete({
          where: { id: challenge.id },
        });
        res.status(HttpStatus.NOT_FOUND).send('Challenge expired');
        return;
      }

      // Return the key authorization (Let's Encrypt expects plain text)
      this.logger.log(
        `[ACME] Returning challenge response for ${challenge.domain} (keyAuth length: ${challenge.keyAuth.length})`,
      );
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
