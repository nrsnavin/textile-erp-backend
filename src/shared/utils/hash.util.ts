// src/shared/utils/hash.util.ts
import { createHash, randomBytes } from 'crypto';
import * as bcrypt                 from 'bcrypt';

const SALT_ROUNDS = 12;

// ── Password hashing ──────────────────────────────────────────────────────

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function comparePassword(
  plain:  string,
  hashed: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hashed);
}

// ── Token hashing (SHA-256) ───────────────────────────────────────────────
// Used for refresh tokens, password reset tokens, and OTP codes.
// We store the hash — never the raw value.

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function hashOtp(otp: string): string {
  return createHash('sha256').update(otp).digest('hex');
}

// ── Random token generation ───────────────────────────────────────────────

export function generateSecureToken(bytes: number = 32): string {
  return randomBytes(bytes).toString('hex');
}

export function generateOtp(digits: number = 6): string {
  const min = Math.pow(10, digits - 1);
  const max = Math.pow(10, digits) - 1;
  return (Math.floor(Math.random() * (max - min + 1)) + min).toString();
}

// ── String masking (for logs and responses) ───────────────────────────────

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const visible = local.length > 2 ? local[0] : '';
  return `${visible}***@${domain}`;
}

export function maskPhone(phone: string): string {
  if (phone.length < 6) return '***';
  return phone.slice(0, 2) + '***' + phone.slice(-2);
}
