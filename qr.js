/**
 * QR Code Security & Cryptographic Token Utility
 * Generates dynamic rotating anti-proxy tokens and validates time-slice HMACs.
 */

const crypto = require('node:crypto');

const TOKEN_WINDOW_SECONDS = 20; // 20-second validity window for dynamic QR codes

/**
 * Generate a random secret key for an event
 */
function generateSecretKey() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Calculate the HMAC signature for an event and time slice
 */
function computeSignature(secretKey, eventId, timeSlice) {
  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(`${eventId}:${timeSlice}`);
  return hmac.digest('hex').substring(0, 16); // 16-char truncated hex signature
}

/**
 * Generate a dynamic QR payload for an event
 * Returns the token string and remaining seconds in current window
 */
function generateDynamicToken(eventId, secretKey) {
  const now = Date.now();
  const timeSlice = Math.floor(now / (TOKEN_WINDOW_SECONDS * 1000));
  const elapsedInSlice = Math.floor((now % (TOKEN_WINDOW_SECONDS * 1000)) / 1000);
  const remainingSeconds = TOKEN_WINDOW_SECONDS - elapsedInSlice;
  
  const signature = computeSignature(secretKey, eventId, timeSlice);
  const token = `GEO:${eventId}:${timeSlice}:${signature}`;

  return {
    token,
    timeSlice,
    remainingSeconds,
    windowSeconds: TOKEN_WINDOW_SECONDS,
    timestamp: new Date().toISOString()
  };
}

/**
 * Validate a submitted QR token against the event's secret key and current time
 * @param {string} submittedToken Token scanned by attendee
 * @param {string} eventId Expected event ID
 * @param {string} secretKey Event secret key
 * @param {boolean} isDynamic Whether dynamic QR is enforced
 * @param {string} staticCode Static code for comparison when dynamic QR is off
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateToken(submittedToken, eventId, secretKey, isDynamic = false, staticCode = '') {
  if (!submittedToken || typeof submittedToken !== 'string') {
    return { valid: false, reason: 'Missing or invalid token format' };
  }

  const cleanToken = submittedToken.trim();

  // If dynamic QR is disabled, allow either the static code or event ID
  if (!isDynamic) {
    if (cleanToken === staticCode || cleanToken === eventId || cleanToken.startsWith(`GEO:${eventId}`)) {
      return { valid: true };
    }
    return { valid: false, reason: 'QR Code does not match this event' };
  }

  // Dynamic token format: GEO:eventId:timeSlice:signature
  if (!cleanToken.startsWith('GEO:')) {
    // Also allow static code if organizer switched modes
    if (cleanToken === staticCode || cleanToken === eventId) {
      return { valid: true };
    }
    return { valid: false, reason: 'Invalid token structure. Live QR code required.' };
  }

  const parts = cleanToken.split(':');
  if (parts.length !== 4) {
    return { valid: false, reason: 'Malformed dynamic QR token' };
  }

  const [, tokenEventId, tokenTimeSliceStr, tokenSig] = parts;
  const tokenTimeSlice = parseInt(tokenTimeSliceStr, 10);

  if (tokenEventId !== eventId) {
    return { valid: false, reason: 'This QR code belongs to a different event' };
  }

  if (isNaN(tokenTimeSlice)) {
    return { valid: false, reason: 'Invalid time stamp in QR code' };
  }

  const now = Date.now();
  const currentTimeSlice = Math.floor(now / (TOKEN_WINDOW_SECONDS * 1000));

  // Allow current time slice or previous 1 slice (to tolerate scan and network transmission latency)
  const isTimeValid = tokenTimeSlice === currentTimeSlice || tokenTimeSlice === (currentTimeSlice - 1);
  if (!isTimeValid) {
    return {
      valid: false,
      reason: 'QR Code expired. Dynamic codes refresh every 20s to prevent proxy attendance.'
    };
  }

  // Verify HMAC signature
  const expectedSig = computeSignature(secretKey, eventId, tokenTimeSlice);
  if (crypto.timingSafeEqual(Buffer.from(tokenSig, 'utf8'), Buffer.from(expectedSig, 'utf8'))) {
    return { valid: true };
  }

  return { valid: false, reason: 'Cryptographic signature mismatch. Potential token tampering.' };
}

module.exports = {
  TOKEN_WINDOW_SECONDS,
  generateSecretKey,
  generateDynamicToken,
  validateToken
};
