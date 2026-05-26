export class AcmeChallengeInfoDto {
  id: string;
  orderId: string | null;
  token: string;
  domain: string;
  challengeType: string;
  provider: string | null;
  status: string;
  presentedAt: Date;
  cleanedUpAt: Date | null;
  finalizedAt: Date | null;
  lastServedAt: Date | null;
  expiresAt: Date;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

