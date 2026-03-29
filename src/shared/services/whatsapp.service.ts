// src/shared/services/whatsapp.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService }      from '@nestjs/config';
import { HttpService }        from '@nestjs/axios';
import { firstValueFrom }     from 'rxjs';

// ── WhatsAppService ───────────────────────────────────────────────────────
// Sends WhatsApp messages via Interakt API.
// Used for: order confirmations, PM due alerts, QC failures,
//           shipment dispatches, payment reminders.
//
// All messages use pre-approved WhatsApp templates.
// You must create and approve templates in the Interakt dashboard first.

@Injectable()
export class WhatsAppService {
  private readonly logger  = new Logger(WhatsAppService.name);
  private readonly baseUrl = 'https://api.interakt.ai/v1/public/message/';

  constructor(
    private readonly config:      ConfigService,
    private readonly httpService: HttpService,
  ) {}

  // ── Order confirmed ───────────────────────────────────────────────────
  async sendOrderConfirmed(params: {
    phone:        string;
    buyerName:    string;
    poNumber:     string;
    deliveryDate: string;
  }): Promise<void> {
    await this.send({
      phone:        params.phone,
      templateName: 'order_confirmed_v2',
      bodyValues:   [params.buyerName, params.poNumber, params.deliveryDate],
    });
  }

  // ── Shipment dispatched ───────────────────────────────────────────────
  async sendShipmentDispatched(params: {
    phone:      string;
    buyerName:  string;
    poNumber:   string;
    vehicleNo:  string;
    ewayBill:   string;
  }): Promise<void> {
    await this.send({
      phone:        params.phone,
      templateName: 'shipment_dispatched_v1',
      bodyValues:   [
        params.buyerName,
        params.poNumber,
        params.vehicleNo,
        params.ewayBill,
      ],
    });
  }

  // ── PM due alert ──────────────────────────────────────────────────────
  async sendPmDueAlert(params: {
    phone:       string;
    techName:    string;
    machineName: string;
    taskName:    string;
    dueDate:     string;
  }): Promise<void> {
    await this.send({
      phone:        params.phone,
      templateName: 'pm_due_alert_v1',
      bodyValues:   [
        params.techName,
        params.machineName,
        params.taskName,
        params.dueDate,
      ],
    });
  }

  // ── QC inspection failed ──────────────────────────────────────────────
  async sendQcFailed(params: {
    phone:       string;
    managerName: string;
    poNumber:    string;
    defectCount: number;
    styleCode:   string;
  }): Promise<void> {
    await this.send({
      phone:        params.phone,
      templateName: 'qc_failed_v1',
      bodyValues:   [
        params.managerName,
        params.poNumber,
        params.styleCode,
        params.defectCount.toString(),
      ],
    });
  }

  // ── Payment due reminder ───────────────────────────────────────────────
  async sendPaymentDue(params: {
    phone:         string;
    buyerName:     string;
    invoiceNo:     string;
    amount:        string;
    currency:      string;
    daysOverdue:   number;
  }): Promise<void> {
    await this.send({
      phone:        params.phone,
      templateName: 'payment_due_v1',
      bodyValues:   [
        params.buyerName,
        params.invoiceNo,
        `${params.currency} ${params.amount}`,
        params.daysOverdue.toString(),
      ],
    });
  }

  // ── Core send ─────────────────────────────────────────────────────────
  private async send(params: {
    phone:        string;
    templateName: string;
    bodyValues:   string[];
    countryCode?: string;
  }): Promise<void> {
    const apiKey = this.config.get<string>('INTERAKT_API_KEY');
    if (!apiKey) {
      this.logger.warn('INTERAKT_API_KEY not set — WhatsApp message skipped');
      return;
    }

    try {
      await firstValueFrom(
        this.httpService.post(
          this.baseUrl,
          {
            countryCode: params.countryCode ?? '+91',
            phoneNumber: params.phone,
            type:        'Template',
            template: {
              name:         params.templateName,
              languageCode: 'en',
              bodyValues:   params.bodyValues,
            },
          },
          {
            headers: {
              Authorization: `Basic ${apiKey}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      this.logger.log(
        `WhatsApp sent: ${params.templateName} → ${params.phone.slice(-4)}`
      );
    } catch (err: any) {
      // Log but never throw — notification failure must not break main flow
      this.logger.error(
        `WhatsApp failed: ${params.templateName} → ${err?.response?.data ?? err.message}`
      );
    }
  }
}
