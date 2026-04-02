// src/shared/services/email.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService }      from '@nestjs/config';
import * as nodemailer        from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger      = new Logger(EmailService.name);
  private transporter!: nodemailer.Transporter;

  constructor(private readonly config: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host:   this.config.get<string>('SMTP_HOST',   'sandbox.smtp.mailtrap.io'),
      port:   this.config.get<number>('SMTP_PORT',   2525),
      secure: this.config.get<boolean>('SMTP_SECURE', false),
      auth: {
        user: this.config.get<string>('SMTP_USER', 'bf2e883f0ac4bc'),
        pass: this.config.get<string>('SMTP_PASS', '6098a0ac0577b0'),
      },
       tls: {
      rejectUnauthorized: false,  // fixes SSL version mismatch
    },
    });
  }

  // ── Send OTP for MFA login ────────────────────────────────────────────
  async sendMfaOtp(params: {
    to:             string;
    name:           string;
    otp:            string;
    expiresMinutes: number;
  }): Promise<void> {
    console.log(`Sending OTP ${params.otp} to ${params.to} for MFA login`); 
    await this.sendMail({
      to:      params.to,
      subject: `${params.otp} is your Textile ERP login code`,
      html:    this.otpTemplate({
        name:           params.name,
        otp:            params.otp,
        expiresMinutes: params.expiresMinutes,
        purpose:        'sign in to',
      }),
    });
  }

  // ── Send OTP for email verification ──────────────────────────────────
  async sendEmailVerificationOtp(params: {
    to:   string;
    name: string;
    otp:  string;
  }): Promise<void> {
    await this.sendMail({
      to:      params.to,
      subject: `${params.otp} — Verify your Textile ERP email`,
      html:    this.otpTemplate({
        name:           params.name,
        otp:            params.otp,
        expiresMinutes: 10,
        purpose:        'verify your email for',
      }),
    });
  }

  // ── Send password reset link ──────────────────────────────────────────
  async sendPasswordReset(params: {
    to:       string;
    name:     string;
    resetUrl: string;
  }): Promise<void> {
    await this.sendMail({
      to:      params.to,
      subject: 'Reset your Textile ERP password',
      html:    this.passwordResetTemplate(params),
    });
  }

  // ── Core send ─────────────────────────────────────────────────────────
  private async sendMail(params: {
    to:      string;
    subject: string;
    html:    string;
  }): Promise<void> {
    try {
      const info = await this.transporter.sendMail({
        from:    `"Textile ERP" <${this.config.get('SMTP_FROM', 'noreply@textile-erp.com')}>`,
        to:      params.to,
        subject: params.subject,
        html:    params.html,
      });
      this.logger.log(`Email sent to ${params.to} — MessageId: ${info.messageId}`);
    } catch (err) {
      // Log but never throw — email failure must not break auth flow
      this.logger.error(`Failed to send email to ${params.to}`, err);
    }
  }

  // ── OTP email template ────────────────────────────────────────────────
  private otpTemplate(params: {
    name:           string;
    otp:            string;
    expiresMinutes: number;
    purpose:        string;
  }): string {
    return `
      <!DOCTYPE html>
      <html>
      <body style="margin:0;padding:0;background:#f4f4f4;
                   font-family:'Segoe UI',Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td align="center" style="padding:40px 20px;">
            <table width="520" cellpadding="0" cellspacing="0"
              style="background:#ffffff;border-radius:12px;
                     box-shadow:0 2px 8px rgba(0,0,0,0.08);">

              <tr>
                <td style="background:#1F3864;padding:28px 32px;
                           border-radius:12px 12px 0 0;">
                  <h1 style="margin:0;color:#ffffff;font-size:20px;
                             font-weight:600;">
                    Textile ERP
                  </h1>
                </td>
              </tr>

              <tr>
                <td style="padding:36px 32px;">
                  <p style="margin:0 0 8px;color:#1a1a1a;font-size:16px;">
                    Hi ${params.name},
                  </p>
                  <p style="margin:0 0 28px;color:#555;font-size:15px;
                             line-height:1.6;">
                    Use the code below to ${params.purpose} your account.
                    This code expires in
                    <strong>${params.expiresMinutes} minutes</strong>.
                  </p>

                  <div style="background:#f0f4ff;
                              border:2px dashed #2E75B6;
                              border-radius:12px;
                              padding:24px;
                              text-align:center;
                              margin-bottom:28px;">
                    <p style="margin:0 0 6px;color:#666;font-size:12px;
                               text-transform:uppercase;letter-spacing:2px;">
                      Verification code
                    </p>
                    <p style="margin:0;font-size:40px;font-weight:700;
                               letter-spacing:10px;color:#1F3864;
                               font-family:monospace;">
                      ${params.otp}
                    </p>
                  </div>

                  <p style="margin:0;color:#999;font-size:13px;">
                    If you did not request this, ignore this email.
                    Your account remains secure.
                  </p>
                </td>
              </tr>

              <tr>
                <td style="background:#f8f9fa;padding:16px 32px;
                           border-radius:0 0 12px 12px;
                           border-top:1px solid #eee;">
                  <p style="margin:0;color:#aaa;font-size:12px;
                             text-align:center;">
                    Textile ERP — Enterprise manufacturing platform
                  </p>
                </td>
              </tr>

            </table>
          </td></tr>
        </table>
      </body>
      </html>
    `;
  }

  // ── Password reset template ───────────────────────────────────────────
  private passwordResetTemplate(params: {
    name:     string;
    resetUrl: string;
  }): string {
    return `
      <!DOCTYPE html>
      <html>
      <body style="margin:0;padding:0;background:#f4f4f4;
                   font-family:'Segoe UI',Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td align="center" style="padding:40px 20px;">
            <table width="520" cellpadding="0" cellspacing="0"
              style="background:#fff;border-radius:12px;
                     box-shadow:0 2px 8px rgba(0,0,0,0.08);">

              <tr>
                <td style="background:#1F3864;padding:28px 32px;
                           border-radius:12px 12px 0 0;">
                  <h1 style="margin:0;color:#fff;font-size:20px;
                             font-weight:600;">
                    Textile ERP
                  </h1>
                </td>
              </tr>

              <tr>
                <td style="padding:36px 32px;">
                  <p style="margin:0 0 8px;color:#1a1a1a;font-size:16px;">
                    Hi ${params.name},
                  </p>
                  <p style="margin:0 0 28px;color:#555;font-size:15px;
                             line-height:1.6;">
                    We received a request to reset your password.
                    Click the button below — the link expires in
                    <strong>15 minutes</strong>.
                  </p>

                  <div style="text-align:center;margin-bottom:28px;">
                    <a href="${params.resetUrl}"
                       style="display:inline-block;background:#1F3864;
                              color:#fff;text-decoration:none;
                              padding:14px 32px;border-radius:8px;
                              font-size:15px;font-weight:600;">
                      Reset Password
                    </a>
                  </div>

                  <p style="margin:0;color:#999;font-size:13px;">
                    If you did not request this, ignore this email.
                  </p>
                </td>
              </tr>

            </table>
          </td></tr>
        </table>
      </body>
      </html>
    `;
  }
}