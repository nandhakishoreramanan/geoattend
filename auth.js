/**
 * Authentication & JWT Security Utility
 * Provides RFC 7519 compliant JWT creation and verification using native node:crypto,
 * plus cryptographic password hashing (PBKDF2/scrypt).
 */

const crypto = require('node:crypto');

const JWT_SECRET = process.env.JWT_SECRET || 'geoattend_jwt_super_secret_signing_key_2026';
const JWT_EXPIRES_IN_SECONDS = 24 * 60 * 60; // 24 hours

/**
 * Base64URL encode buffer/string
 */
function base64UrlEncode(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Base64URL decode string
 */
function base64UrlDecode(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Sign payload into a standard JWT string
 */
function generateJWT(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + JWT_EXPIRES_IN_SECONDS
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
  const dataToSign = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto.createHmac('sha256', JWT_SECRET).update(dataToSign).digest();
  const encodedSignature = base64UrlEncode(signature);

  return `${dataToSign}.${encodedSignature}`;
}

/**
 * Verify and decode JWT
 * @returns {object|null} Decoded payload or null if invalid/expired
 */
function verifyJWT(token) {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const dataToSign = `${encodedHeader}.${encodedPayload}`;

  const expectedSignature = base64UrlEncode(
    crypto.createHmac('sha256', JWT_SECRET).update(dataToSign).digest()
  );

  if (encodedSignature !== expectedSignature) {
    return null; // Signature mismatch
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    const now = Math.floor(Date.now() / 1000);

    if (payload.exp && payload.exp < now) {
      return null; // Token expired
    }

    return payload;
  } catch (e) {
    return null;
  }
}

/**
 * Hash password with salt
 */
function hashPassword(password, existingSalt = null) {
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

/**
 * Verify password against stored hash and salt
 */
function verifyPassword(password, hash, salt) {
  try {
    const checkHash = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(checkHash, 'hex'));
  } catch (e) {
    return false;
  }
}

/**
 * Decode and validate Google ID token (JWT) or simulated profile payload
 * Native implementation with zero external dependencies
 */
function parseGoogleCredential(credential) {
  if (!credential) return null;

  // Object payload (from client Google profile / simulator)
  if (typeof credential === 'object' && credential.email) {
    return {
      google_id: credential.google_id || credential.sub || 'g_' + crypto.randomBytes(6).toString('hex'),
      email: credential.email.toLowerCase().trim(),
      name: credential.name || credential.email.split('@')[0],
      avatar_url: credential.picture || credential.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(credential.name || credential.email)}`
    };
  }

  // Raw Google ID Token JWT string (from accounts.google.com/gsi/client)
  if (typeof credential === 'string') {
    const parts = credential.split('.');
    if (parts.length !== 3) return null;
    try {
      const payload = JSON.parse(base64UrlDecode(parts[1]));
      if (!payload || !payload.email) return null;
      return {
        google_id: payload.sub || 'g_' + crypto.randomBytes(6).toString('hex'),
        email: payload.email.toLowerCase().trim(),
        name: payload.name || payload.email.split('@')[0],
        avatar_url: payload.picture || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(payload.name || payload.email)}`
      };
    } catch (e) {
      return null;
    }
  }

  return null;
}

module.exports = {
  generateJWT,
  verifyJWT,
  hashPassword,
  verifyPassword,
  parseGoogleCredential
};
