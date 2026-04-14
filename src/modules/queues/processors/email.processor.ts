// src/modules/queues/processors/email.processor.ts
import { Process, Processor } from '@nestjs/bull';
import { Logger }             from '@nestjs/common';
import { Job }                from 'bull';
import { EmailService }       from '../../../shared/services/email.service';

export interface EmailJobData {
  tenantId:    string;
  to:          string;
  subject:     string;
  template:    'INVOICE' | 'PAYMENT_RECEIPT' | 'PO_SENT' | 'PR_APPROVED' | 'MRP_COMPLETE' | 'OVERDUE_REMINDER';
  context:     Record<string, any>;
  attachments?: Array<{ filename: string; path: string }>;
}

@Processor('email-queue')
export class EmailProcessor {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(private readonly emailService: EmailService) {}

  @Process('send-email')
  async handleSendEmail(job: Job<EmailJobData>) {
    const { to, subject, template, context } = job.data;
    this.logger.log(`[Job ${job.id}] Sending ${template} email to ${to}`);

    try {
      await this.emailService.send({
        to,
        subject,
        html: this.renderTemplate(template, context),
      });

      this.logger.log(`[Job ${job.id}] Email sent to ${to}`);
      return { sent: true, to, template };
    } catch (error: any) {
      this.logger.error(`[Job ${job.id}] Email failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  private renderTemplate(template: string, context: Record<string, any>): string {
    // In production, use a proper templating engine (Handlebars, mjml, etc.)
    // For now, return a simple HTML body.
    const title = template.replace(/_/g, ' ');
    const rows  = Object.entries(context)
      .map(([k, v]) => `<tr><td><strong>${k}</strong></td><td>${v}</td></tr>`)
      .join('');

    return `
      <h2>${title}</h2>
      <table border="1" cellpadding="8" cellspacing="0">
        ${rows}
      </table>
      <p style="color:#888;font-size:12px">This is an automated email from Textile ERP.</p>
    `;
  }
}
