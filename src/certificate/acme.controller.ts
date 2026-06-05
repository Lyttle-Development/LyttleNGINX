import {
  Controller,
  Get,
  HttpStatus,
  Logger,
  Param,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { AcmeService } from './acme.service';

@Controller('.well-known/acme-challenge')
@Public()
export class AcmeController {
  private readonly logger = new Logger(AcmeController.name);

  constructor(private readonly acmeService: AcmeService) {}

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
      const result = await this.acmeService.getPresentedHttpChallenge(token);

      if (result.status === 'missing') {
        this.logger.warn(`[ACME] Challenge not found in database: ${token}`);
        res.status(HttpStatus.NOT_FOUND).send('Challenge not found');
        return;
      }

      if (result.status === 'expired') {
        this.logger.warn(`[ACME] Challenge expired for token ${token}`);
        res.status(HttpStatus.NOT_FOUND).send('Challenge expired');
        return;
      }

      if (result.status !== 'found') {
        res.status(HttpStatus.NOT_FOUND).send('Challenge not found');
        return;
      }

      const challenge = result.challenge;

      this.logger.log(`[ACME] Challenge found for domain: ${challenge.domain}`);

      // Return the key authorization (Let's Encrypt expects plain text)
      this.logger.log(
        `[ACME] Returning challenge response for ${challenge.domain} (keyAuth length: ${challenge.keyAuth.length})`,
      );
      await this.acmeService.markChallengeServed(challenge.id);
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
