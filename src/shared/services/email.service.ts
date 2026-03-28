// src/shared/services/email.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService }      from '@nestjs/config';
import * as nodemailer        from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger      = new Logger(EmailService.name);
  private readonly transporter: nodemailer.Transporter;

  constructor(private readonly config: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host:   config.get('SMTP_HOST',   'smtp.gmail.com'),
      port:   config.get('SMTP_PORT',   587),
      secure: config.get('SMTP_SECURE', false),
      auth: {
        user: config.get('SMTP_USER'),
        pass: config.get('SMTP_PASS'),
      },
    });
  }

  // ── Send OTP for MFA ──────────────────────────────────────────────────
  async sendMfaOtp(params: {
    to:       string;
    name:     string;
    otp:      string;
    expiresMinutes: number;
  }): Promise<void> {
    await this.send({
      to:      params.to,
      subject: `${params.otp} — Your Textile ERP login code`,
      html:    this.otpTemplate({
        name:           params.name,
        otp:            params.otp,
        expiresMinutes: params.expiresMinutes,
        purpose:        'sign in to',
      }),
    });
  }

  // ── Send OTP for email verification ───────────────────────────────────
  async sendEmailVerificationOtp(params: {
    to:   string;
    name: string;
    otp:  string;
  }): Promise<void> {
    await this.send({
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
    await this.send({
      to:      params.to,
      subject: 'Reset your Textile ERP password',
      html:    this.passwordResetTemplate(params),
    });
  }

  // ── Core send method ──────────────────────────────────────────────────
  private async send(params: {
    to:      string;
    subject: string;
    html:    string;
  }): Promise<void> {
    try {
      await this.transporter.sendMail({
        from:    `"Textile ERP" <${this.config.get('SMTP_FROM', 'noreply@textile-erp.com')}>`,
        to:      params.to,
        subject: params.subject,
        html:    params.html,
      });
      this.logger.log(`Email sent to ${params.to}: ${params.subject}`);
    } catch (err) {
      this.logger.error(`Failed to send email to ${params.to}`, err);
      // Don't throw — email failure should not break the auth flow
      // The user can request resend
    }
  }

  // ── Email templates ───────────────────────────────────────────────────
  private otpTemplate(params: {
    name:           string;
    otp:            string;
    expiresMinutes: number;
    purpose:        string;
  }): string {
    return `
      <!DOCTYPE html>
      <html>
      <body style="margin:0;padding:0;background:#f4f4f4;font-family:'Segoe UI',Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td align="center" style="padding:40px 20px;">
            <table width="520" cellpadding="0" cellspacing="0"
              style="background:#fff;border-radius:12px;overflow:hidden;
                     box-shadow:0 2px 8px rgba(0,0,0,0.08);">

              <!-- Header -->
              <tr><td style="background:#1F3864;padding:32px;text-align:center;">
                <h1 style="margin:0;color:#fff;font-size:22px;font-weight:600;
                           letter-spacing:-0.5px;">Textile ERP</h1>
              </td></tr>

              <!-- Body -->
              <tr><td style="padding:40px 40px 32px;">
                <p style="margin:0 0 8px;color:#1a1a1a;font-size:16px;">
                  Hi ${params.name},
                </p>
                <p style="margin:0 0 32px;color:#555;font-size:15px;line-height:1.6;">
                  Use the code below to ${params.purpose} your Textile ERP account.
                  This code expires in <strong>${params.expiresMinutes} minutes</strong>.
                </p>

                <!-- OTP Box -->
                <div style="background:#f0f4ff;border:2px dashed #2E75B6;
                            border-radius:12px;padding:28px;text-align:center;
                            margin-bottom:32px;">
                  <p style="margin:0 0 8px;color:#555;font-size:13px;
                             text-transform:uppercase;letter-spacing:2px;">
                    Your verification code
                  </p>
                  <p style="margin:0;font-size:42px;font-weight:700;
                             letter-spacing:12px;color:#1F3864;font-family:monospace;">
                    ${params.otp}
                  </p>
                </div>

                <p style="margin:0;color:#888;font-size:13px;line-height:1.6;">
                  If you did not request this code, please ignore this email.
                  Your account remains secure.
                </p>
              </td></tr>

              <!-- Footer -->
              <tr><td style="background:#f8f9fa;padding:20px 40px;
                             border-top:1px solid #eee;">
                <p style="margin:0;color:#aaa;font-size:12px;text-align:center;">
                  Textile ERP — Enterprise manufacturing platform
                </p>
              </td></tr>

            </table>
          </td></tr>
        </table>
      </body>
      </html>
    `;
  }

  private passwordResetTemplate(params: {
    name:     string;
    resetUrl: string;
  }): string {
    return `
      <!DOCTYPE html>
      <html>
      <body style="margin:0;padding:0;background:#f4f4f4;font-family:'Segoe UI',Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td align="center" style="padding:40px 20px;">
            <table width="520" cellpadding="0" cellspacing="0"
              style="background:#fff;border-radius:12px;overflow:hidden;
                     box-shadow:0 2px 8px rgba(0,0,0,0.08);">
              <tr><td style="background:#1F3864;padding:32px;text-align:center;">
                <h1 style="margin:0;color:#fff;font-size:22px;font-weight:600;">
                  Textile ERP
                </h1>
              </td></tr>
              <tr><td style="padding:40px;">
                <p style="margin:0 0 8px;color:#1a1a1a;font-size:16px;">Hi ${params.name},</p>
                <p style="margin:0 0 32px;color:#555;font-size:15px;line-height:1.6;">
                  We received a request to reset your password.
                  Click the button below — the link expires in 15 minutes.
                </p>
                <div style="text-align:center;margin-bottom:32px;">
                  <a href="${params.resetUrl}"
                    style="display:inline-block;background:#1F3864;color:#fff;
                           text-decoration:none;padding:14px 32px;border-radius:8px;
                           font-size:15px;font-weight:600;">
                    Reset Password
                  </a>
                </div>
                <p style="margin:0;color:#888;font-size:13px;">
                  If you did not request a password reset, ignore this email.
                </p>
              </td></tr>
            </table>
          </td></tr>
        </table>
      </body>
      </html>
    `;
  }
}
