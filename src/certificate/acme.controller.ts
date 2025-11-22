import { Controller, Get, HttpStatus, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';

@Controller('.well-known/acme-challenge')
export class AcmeController {
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
    try {
      // Look up challenge in database
      const challenge = await this.prisma.acmeChallenge.findUnique({
        where: { token },
      });

      if (!challenge) {
        res.status(HttpStatus.NOT_FOUND).send('Challenge not found');
        return;
      }

      // Check if expired
      if (new Date() > challenge.expiresAt) {
        // Clean up expired challenge
        await this.prisma.acmeChallenge.delete({
          where: { id: challenge.id },
        });
        res.status(HttpStatus.NOT_FOUND).send('Challenge expired');
        return;
      }

      // Return the key authorization (Let's Encrypt expects plain text)
      res
        .status(HttpStatus.OK)
        .contentType('text/plain')
        .send(challenge.keyAuth);
    } catch (error) {
      console.error('[ACME] Error serving challenge:', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).send('Internal error');
    }
  }
}
