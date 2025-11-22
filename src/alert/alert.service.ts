import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import * as process from 'node:process';

export interface AlertConfig {
  email?: {
    enabled: boolean;
    to: string;
    from: string;
    smtp?: {
      host: string;
      port: number;
      secure: boolean;
      auth?: {
        user: string;
        pass: string;
      };
    };
  };
  webhook?: {
    enabled: boolean;
    url: string;
    type: 'slack' | 'discord' | 'generic';
  };
}

@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);
  private transporter: nodemailer.Transporter | null = null;
  private alertConfig: AlertConfig;

  constructor() {
    this.alertConfig = {
      email: {
        enabled: !!process.env.ALERT_EMAIL,
        to: process.env.ALERT_EMAIL || '',
        from: process.env.ALERT_FROM_EMAIL || process.env.ADMIN_EMAIL || '',
        smtp: process.env.SMTP_HOST
          ? {
              host: process.env.SMTP_HOST,
              port: parseInt(process.env.SMTP_PORT || '587', 10),
              secure: process.env.SMTP_SECURE === 'true',
              auth: process.env.SMTP_USER
                ? {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS || '',
                  }
                : undefined,
            }
          : undefined,
      },
      webhook: {
        enabled: !!(
          process.env.SLACK_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL
        ),
        url:
          process.env.SLACK_WEBHOOK_URL ||
          process.env.DISCORD_WEBHOOK_URL ||
          '',
        type: process.env.SLACK_WEBHOOK_URL
          ? 'slack'
          : process.env.DISCORD_WEBHOOK_URL
            ? 'discord'
            : 'generic',
      },
    };

    if (this.alertConfig.email?.enabled && this.alertConfig.email.smtp) {
      this.transporter = nodemailer.createTransport(
        this.alertConfig.email.smtp,
      );
      this.logger.log('[Alert] Email alerts enabled');
    }

    if (this.alertConfig.webhook?.enabled) {
      this.logger.log(
        `[Alert] Webhook alerts enabled (${this.alertConfig.webhook.type})`,
      );
    }
  }

  async sendCertificateExpiringAlert(
    domains: string[],
    daysUntilExpiry: number,
    expiresAt: Date,
  ): Promise<void> {
    const primaryDomain = domains[0];
    const subject = `⚠️ Certificate Expiring Soon: ${primaryDomain}`;
    const message = `
Certificate for ${primaryDomain} will expire in ${daysUntilExpiry} days.

Domains: ${domains.join(', ')}
Expiry Date: ${expiresAt.toISOString()}
Days Remaining: ${daysUntilExpiry}

Action Required: Please renew this certificate before it expires.
`;

    await Promise.allSettled([
      this.sendEmailAlert(subject, message),
      this.sendWebhookAlert(subject, message, 'warning'),
    ]);
  }

  async sendCertificateExpiredAlert(
    domains: string[],
    expiresAt: Date,
  ): Promise<void> {
    const primaryDomain = domains[0];
    const subject = `🚨 Certificate EXPIRED: ${primaryDomain}`;
    const message = `
Certificate for ${primaryDomain} has EXPIRED!

Domains: ${domains.join(', ')}
Expired On: ${expiresAt.toISOString()}

URGENT: This certificate needs immediate renewal.
`;

    await Promise.allSettled([
      this.sendEmailAlert(subject, message),
      this.sendWebhookAlert(subject, message, 'critical'),
    ]);
  }

  async sendCertificateRenewalSuccessAlert(
    domains: string[],
    newExpiryDate: Date,
  ): Promise<void> {
    const primaryDomain = domains[0];
    const subject = `✅ Certificate Renewed: ${primaryDomain}`;
    const message = `
Certificate for ${primaryDomain} has been successfully renewed.

Domains: ${domains.join(', ')}
New Expiry Date: ${newExpiryDate.toISOString()}

Certificate is valid for another 90 days.
`;

    await Promise.allSettled([
      this.sendEmailAlert(subject, message),
      this.sendWebhookAlert(subject, message, 'success'),
    ]);
  }

  async sendCertificateRenewalFailureAlert(
    domains: string[],
    error: string,
  ): Promise<void> {
    const primaryDomain = domains[0];
    const subject = `❌ Certificate Renewal Failed: ${primaryDomain}`;
    const message = `
Failed to renew certificate for ${primaryDomain}.

Domains: ${domains.join(', ')}
Error: ${error}

Please check the logs and renew manually if needed.
`;

    await Promise.allSettled([
      this.sendEmailAlert(subject, message),
      this.sendWebhookAlert(subject, message, 'error'),
    ]);
  }

  private async sendEmailAlert(
    subject: string,
    message: string,
  ): Promise<void> {
    if (!this.alertConfig.email?.enabled || !this.transporter) {
      return;
    }

    try {
      await this.transporter.sendMail({
        from: this.alertConfig.email.from,
        to: this.alertConfig.email.to,
        subject,
        text: message,
        html: `<pre>${message}</pre>`,
      });
      this.logger.log(`[Email Alert] Sent: ${subject}`);
    } catch (error) {
      this.logger.error(
        '[Email Alert] Failed to send',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async sendWebhookAlert(
    subject: string,
    message: string,
    severity: 'success' | 'warning' | 'error' | 'critical',
  ): Promise<void> {
    if (!this.alertConfig.webhook?.enabled) {
      return;
    }

    try {
      const payload = this.formatWebhookPayload(subject, message, severity);
      const response = await fetch(this.alertConfig.webhook.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      this.logger.log(`[Webhook Alert] Sent: ${subject}`);
    } catch (error) {
      this.logger.error(
        '[Webhook Alert] Failed to send',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private formatWebhookPayload(
    subject: string,
    message: string,
    severity: string,
  ): any {
    const color = {
      success: '#28a745',
      warning: '#ffc107',
      error: '#dc3545',
      critical: '#ff0000',
    }[severity];

    switch (this.alertConfig.webhook?.type) {
      case 'slack':
        return {
          text: subject,
          attachments: [
            {
              color,
              text: message,
              footer: 'LyttleNGINX Certificate Alert',
              ts: Math.floor(Date.now() / 1000),
            },
          ],
        };

      case 'discord':
        return {
          embeds: [
            {
              title: subject,
              description: message,
              color: parseInt(color.replace('#', ''), 16),
              footer: {
                text: 'LyttleNGINX Certificate Alert',
              },
              timestamp: new Date().toISOString(),
            },
          ],
        };

      default:
        return {
          subject,
          message,
          severity,
          timestamp: new Date().toISOString(),
        };
    }
  }
}
