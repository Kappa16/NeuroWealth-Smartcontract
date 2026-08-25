import crypto from 'crypto';

interface OTPRecord {
  code: string;
  expiresAt: number; // Unix timestamp ms
  attempts: number;
}

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes expiration
const MAX_ATTEMPTS = 3;

// In-memory OTP storage keyed by phone number hash
const otpStore = new Map<string, OTPRecord>();

/**
 * Generates a 6-digit numeric OTP that expires after 5 minutes.
 */
export function generateOTP(phoneHash: string): string {
  const code = crypto.randomInt(100000, 999999).toString();
  const expiresAt = Date.now() + OTP_TTL_MS;

  otpStore.set(phoneHash, {
    code,
    expiresAt,
    attempts: 0
  });

  return code;
}

/**
 * Verifies an OTP code for a user.
 * Enforces 5-minute expiration and max attempt limits.
 */
export function verifyOTP(phoneHash: string, inputCode: string): { success: boolean; message: string } {
  const record = otpStore.get(phoneHash);

  if (!record) {
    return { success: false, message: 'No OTP request found. Please send "hi" to request a new code.' };
  }

  if (Date.now() > record.expiresAt) {
    otpStore.delete(phoneHash);
    return { success: false, message: 'OTP has expired (valid for 5 minutes). Please request a new code.' };
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    otpStore.delete(phoneHash);
    return { success: false, message: 'Too many invalid attempts. Please request a new OTP code.' };
  }

  if (record.code !== inputCode.trim()) {
    record.attempts += 1;
    return { success: false, message: `Invalid OTP code. ${MAX_ATTEMPTS - record.attempts} attempts remaining.` };
  }

  // Verification successful: clear OTP code
  otpStore.delete(phoneHash);
  return { success: true, message: 'OTP verified successfully!' };
}
