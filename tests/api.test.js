/**
 * Automated Test Suite for QR-Based Geo-Tagged Attendance Management System
 * Tests Haversine Geofencing, Cryptographic QR Tokens, JWT Authentication,
 * AI Analytics, Event CRUD, and Downloadable CSV Reports.
 */

const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { calculateDistance, verifyGeofence } = require('../geo');
const { generateSecretKey, generateDynamicToken, validateToken, TOKEN_WINDOW_SECONDS } = require('../qr');
const { generateJWT, verifyJWT, hashPassword, verifyPassword } = require('../auth');
const { handleRequest } = require('../server');
const db = require('../db');

function simulateRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter();
    req.method = method;
    req.url = path;
    req.headers = { host: 'localhost:3000', ...headers };
    req.socket = { remoteAddress: '127.0.0.1' };
    req.destroy = () => {};

    const res = new EventEmitter();
    let responseData = '';
    res.statusCode = 200;
    res.headers = {};

    res.writeHead = (statusCode, hdrs = {}) => {
      res.statusCode = statusCode;
      for (const [k, v] of Object.entries(hdrs)) {
        res.headers[k.toLowerCase()] = v;
      }
    };

    res.setHeader = (key, val) => {
      res.headers[key.toLowerCase()] = val;
    };

    res.write = (chunk) => {
      responseData += chunk ? chunk.toString() : '';
    };

    res.end = (chunk) => {
      if (chunk) responseData += chunk.toString();
      let parsed = responseData;
      try {
        parsed = JSON.parse(responseData);
      } catch (e) {}
      resolve({ status: res.statusCode, headers: res.headers, body: parsed });
    };

    handleRequest(req, res).catch(reject);

    if (body) {
      const dataStr = typeof body === 'object' ? JSON.stringify(body) : String(body);
      req.emit('data', Buffer.from(dataStr));
    }
    req.emit('end');
  });
}

async function runTests() {
  console.log('=== STARTING TEST SUITE: Geo-Tagged Attendance System ===\n');
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`    Error:`, err);
      failed++;
    }
  }

  // --- UNIT TESTS: GEO & HAVERSINE ---
  console.log('[1/6] Testing Haversine & Geofence Verification...');

  await test('calculateDistance should return 0 for identical coordinates', () => {
    const d = calculateDistance(12.82315, 80.04420, 12.82315, 80.04420);
    assert.strictEqual(d, 0);
  });

  await test('calculateDistance accurately computes ~50-80m distance', () => {
    const d = calculateDistance(12.82315, 80.04420, 12.82365, 80.04420);
    assert.ok(d > 50 && d < 60, `Expected ~55m, got ${d}m`);
  });

  await test('verifyGeofence flags within boundary and out of boundary correctly', () => {
    const venueLat = 12.82315;
    const venueLng = 80.04420;
    const radius = 80;

    const inside = verifyGeofence(12.82325, 80.04425, venueLat, venueLng, radius);
    assert.strictEqual(inside.isWithin, true);
    assert.ok(inside.distanceMeters < 80);

    const outside = verifyGeofence(12.82700, 80.04420, venueLat, venueLng, radius);
    assert.strictEqual(outside.isWithin, false);
    assert.ok(outside.distanceMeters > 400);
    assert.ok(outside.breachMeters > 300);
  });

  // --- UNIT TESTS: QR & CRYPTOGRAPHIC TOKENS ---
  console.log('\n[2/6] Testing Anti-Proxy QR Token Generation & Validation...');

  await test('generateDynamicToken produces time-sliced HMAC token', () => {
    const secret = generateSecretKey();
    const tokenObj = generateDynamicToken('evt_123', secret);
    assert.ok(tokenObj.token.startsWith('GEO:evt_123:'));
    assert.ok(tokenObj.remainingSeconds > 0 && tokenObj.remainingSeconds <= TOKEN_WINDOW_SECONDS);
  });

  await test('validateToken accepts fresh token matching event', () => {
    const secret = generateSecretKey();
    const tokenObj = generateDynamicToken('evt_test', secret);
    const result = validateToken(tokenObj.token, 'evt_test', secret, true);
    assert.strictEqual(result.valid, true);
  });

  await test('validateToken rejects tampered or expired token', () => {
    const secret = generateSecretKey();
    const tokenObj = generateDynamicToken('evt_test', secret);
    
    const tampered = tokenObj.token.slice(0, -4) + 'ffff';
    const resultTampered = validateToken(tampered, 'evt_test', secret, true);
    assert.strictEqual(resultTampered.valid, false);

    const expiredToken = `GEO:evt_test:1000:aabbccddeeff`;
    const resultExpired = validateToken(expiredToken, 'evt_test', secret, true);
    assert.strictEqual(resultExpired.valid, false);

    // Reject token belonging to a different event
    const diffEventToken = generateDynamicToken('evt_different_event', secret).token;
    const resultDiff = validateToken(diffEventToken, 'evt_test', secret, true);
    assert.strictEqual(resultDiff.valid, false);
    assert.ok(resultDiff.reason.includes('different event'));

    // Reject non-dynamic random string when dynamic QR is required
    const resultRandom = validateToken('https://google.com', 'evt_test', secret, true);
    assert.strictEqual(resultRandom.valid, false);
  });

  // --- UNIT TESTS: JWT AUTHENTICATION ---
  console.log('\n[3/6] Testing JWT Authentication & Password Hashing...');

  let organizerToken = null;

  await test('hashPassword and verifyPassword work correctly', () => {
    const { hash, salt } = hashPassword('secret123');
    assert.strictEqual(verifyPassword('secret123', hash, salt), true);
    assert.strictEqual(verifyPassword('wrong', hash, salt), false);
  });

  await test('POST /api/auth/login authenticates organizer and returns JWT', async () => {
    const res = await simulateRequest('POST', '/api/auth/login', {
      email: 'organizer@srmist.edu.in',
      password: 'adminpassword123'
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.token);
    assert.strictEqual(res.body.user.role, 'organizer');
    organizerToken = res.body.token;
  });

  await test('POST /api/auth/login rejects invalid credentials', async () => {
    const res = await simulateRequest('POST', '/api/auth/login', {
      email: 'organizer@srmist.edu.in',
      password: 'wrongpassword'
    });
    assert.strictEqual(res.status, 401);
  });

  await test('GET /api/auth/me returns authenticated user with valid JWT', async () => {
    const res = await simulateRequest('GET', '/api/auth/me', null, {
      authorization: `Bearer ${organizerToken}`
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.user.email, 'organizer@srmist.edu.in');
  });

  let googleUserToken = null;
  await test('POST /api/auth/google authenticates Google user and assigns JWT', async () => {
    const res = await simulateRequest('POST', '/api/auth/google', {
      profile: {
        email: 'rohan.sharma@gmail.com',
        name: 'Rohan Sharma Google',
        sub: 'g_test_1029384756',
        picture: 'https://lh3.googleusercontent.com/a/default-user'
      },
      role: 'participant'
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.token);
    assert.strictEqual(res.body.user.email, 'rohan.sharma@gmail.com');
    assert.strictEqual(res.body.user.google_id, 'g_test_1029384756');
    googleUserToken = res.body.token;
  });

  let originalGoogleConfig = null;
  await test('GET /api/auth/google/config returns OAuth configuration status', async () => {
    const res = await simulateRequest('GET', '/api/auth/google/config');
    assert.strictEqual(res.status, 200);
    assert.ok(typeof res.body.configured === 'boolean');
    originalGoogleConfig = res.body;
  });

  await test('GET /api/auth/google/login redirects to #google_error when client_id is missing', async () => {
    await simulateRequest('POST', '/api/auth/google/config', { client_id: '', client_secret: '' });
    const res = await simulateRequest('GET', '/api/auth/google/login');
    assert.strictEqual(res.status, 302);
    assert.ok(res.headers.location.includes('google_error=no_client_id'));
  });

  await test('POST /api/auth/google/config updates client_id and login redirects to accounts.google.com', async () => {
    const resConfig = await simulateRequest('POST', '/api/auth/google/config', {
      client_id: 'test-client-123.apps.googleusercontent.com',
      client_secret: 'test-secret-456'
    });
    assert.strictEqual(resConfig.status, 200);
    assert.strictEqual(resConfig.body.configured, true);

    const resLogin = await simulateRequest('GET', '/api/auth/google/login');
    assert.strictEqual(resLogin.status, 302);
    assert.ok(resLogin.headers.location.startsWith('https://accounts.google.com/o/oauth2/v2/auth'));
    assert.ok(resLogin.headers.location.includes('test-client-123.apps.googleusercontent.com'));

    // Restore original client_id and secret if one was present
    if (originalGoogleConfig && originalGoogleConfig.client_id) {
      await simulateRequest('POST', '/api/auth/google/config', {
        client_id: originalGoogleConfig.client_id,
        client_secret: process.env.GOOGLE_CLIENT_SECRET || ''
      });
    }
  });

  // --- INTEGRATION TESTS: HTTP REST API & ENDPOINTS ---
  console.log('\n[4/6] Testing Server REST Endpoints & Geofenced Check-in...');

  let createdEventId = null;
  let dynamicToken = null;

  await test('GET /api/events returns event list', async () => {
    const res = await simulateRequest('GET', '/api/events');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.events));
  });

  await test('POST /api/events creates a new event with geofence settings', async () => {
    const newEventPayload = {
      title: 'SRM Campus Automated Hackathon',
      description: 'Test event for verifying geofencing',
      venue_name: 'TP Ganesan Seminar Hall 2',
      latitude: 12.82315,
      longitude: 80.04420,
      radius_meters: 60,
      dynamic_qr: 1
    };

    const res = await simulateRequest('POST', '/api/events', newEventPayload, {
      authorization: `Bearer ${organizerToken}`
    });

    assert.strictEqual(res.status, 201);
    assert.ok(res.body.event);
    assert.strictEqual(res.body.event.title, newEventPayload.title);
    assert.strictEqual(res.body.event.radius_meters, 60);
    createdEventId = res.body.event.id;
  });

  await test('GET /api/events/:id/qr-token returns dynamic rotating token', async () => {
    const res = await simulateRequest('GET', `/api/events/${createdEventId}/qr-token`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.is_dynamic, true);
    assert.ok(res.body.token.startsWith('GEO:'));
    assert.ok(res.body.remaining_seconds > 0);
    dynamicToken = res.body.token;
  });

  await test('POST /api/check-in VERIFIED when attendee is inside geofence', async () => {
    const checkinPayload = {
      event_id: createdEventId,
      token: dynamicToken,
      name: 'Rohan Sharma',
      student_id: 'RA2111003010123',
      email: 'rohan.s@srmist.edu.in',
      latitude: 12.82320,
      longitude: 80.04422
    };

    const res = await simulateRequest('POST', '/api/check-in', checkinPayload);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.status, 'VERIFIED');
    assert.ok(res.body.distance_meters <= 60);
    assert.ok(res.body.receipt.verification_hash);
  });

  await test('POST /api/check-in OUT_OF_BOUNDS when attendee is outside geofence', async () => {
    const checkinPayload = {
      event_id: createdEventId,
      token: dynamicToken,
      name: 'Naveen Kumar (Remote)',
      student_id: 'RA2111003010999',
      email: 'naveen.k@srmist.edu.in',
      latitude: 12.82850,
      longitude: 80.04420
    };

    const res = await simulateRequest('POST', '/api/check-in', checkinPayload);
    assert.strictEqual(res.status, 422);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.status, 'OUT_OF_BOUNDS');
    assert.ok(res.body.distance_meters > 60);
    assert.ok(res.body.breach_meters > 0);
  });

  await test('POST /api/check-in recognizes duplicate registration', async () => {
    const duplicatePayload = {
      event_id: createdEventId,
      token: dynamicToken,
      name: 'Rohan Sharma',
      student_id: 'RA2111003010123',
      email: 'rohan.s@srmist.edu.in',
      latitude: 12.82320,
      longitude: 80.04422
    };

    const res = await simulateRequest('POST', '/api/check-in', duplicatePayload);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.already_verified, true);
  });

  await test('POST /api/events/:id/whitelist updates authorized Gmails', async () => {
    const res = await simulateRequest('POST', `/api/events/${createdEventId}/whitelist`, {
      allowed_emails: 'rohan.sharma@gmail.com, student@srmist.edu.in',
      require_whitelist: 1
    }, {
      authorization: `Bearer ${organizerToken}`
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.allowed_emails.includes('rohan.sharma@gmail.com'));
  });

  await test('GET /api/events/:id/my-pass returns personal QR entry pass for whitelisted Google user', async () => {
    const res = await simulateRequest('GET', `/api/events/${createdEventId}/my-pass`, null, {
      authorization: `Bearer ${googleUserToken}`
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.authorized, true);
    assert.ok(res.body.entry_token.startsWith(`PASS:${createdEventId}:`));
  });

  const unauthorizedUserToken = generateJWT({
    id: 'usr_unauth_test',
    email: 'unauthorized.stranger@gmail.com',
    name: 'Unauthorized Stranger',
    role: 'participant'
  });

  await test('GET /api/events/:id/my-pass denies pass without verified Google token (401)', async () => {
    const res = await simulateRequest('GET', `/api/events/${createdEventId}/my-pass?email=unauthorized.stranger@gmail.com`);
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.authorized, false);
  });

  await test('GET /api/events/:id/my-pass denies pass for non-whitelisted Google email (403)', async () => {
    const res = await simulateRequest('GET', `/api/events/${createdEventId}/my-pass`, null, {
      authorization: `Bearer ${unauthorizedUserToken}`
    });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.authorized, false);
  });

  await test('POST /api/check-in rejects check-in when not authenticated with Google (403)', async () => {
    const res = await simulateRequest('POST', '/api/check-in', {
      event_id: createdEventId,
      name: 'Intruder',
      student_id: 'RA9999999999999',
      email: 'not.whitelisted@gmail.com',
      latitude: 12.82315,
      longitude: 80.04420
    });
    assert.strictEqual(res.status, 403);
    assert.ok(res.body.error.includes('Authentication Required'));
  });

  await test('POST /api/check-in rejects unwhitelisted attendee when whitelist is enabled (403)', async () => {
    const res = await simulateRequest('POST', '/api/check-in', {
      event_id: createdEventId,
      name: 'Intruder',
      student_id: 'RA9999999999999',
      latitude: 12.82315,
      longitude: 80.04420
    }, {
      authorization: `Bearer ${unauthorizedUserToken}`
    });
    assert.strictEqual(res.status, 403);
    assert.ok(res.body.error.includes('Access Denied'));
  });

  await test('POST /api/check-in accepts personal pass token for whitelisted attendee', async () => {
    const passRes = await simulateRequest('GET', `/api/events/${createdEventId}/my-pass`, null, {
      authorization: `Bearer ${googleUserToken}`
    });
    const res = await simulateRequest('POST', '/api/check-in', {
      event_id: createdEventId,
      name: 'Rohan Sharma Google',
      student_id: 'RA2111003010123-G',
      email: 'rohan.sharma@gmail.com',
      token: passRes.body.entry_token,
      latitude: 12.82315,
      longitude: 80.04420
    }, {
      authorization: `Bearer ${googleUserToken}`
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'VERIFIED');
  });

  // --- STATS, BROWNIE REPORTS & AI FEATURES ---
  console.log('\n[5/6] Testing Real-Time Statistics, AI Insights & CSV Export...');

  await test('GET /api/events/:id/stats aggregates live metrics', async () => {
    const res = await simulateRequest('GET', `/api/events/${createdEventId}/stats`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.metrics.total, 3);
    assert.strictEqual(res.body.metrics.verified, 2);
    assert.strictEqual(res.body.metrics.outOfBounds, 1);
  });

  await test('GET /api/events/:id/ai-insights returns AI analytics & forecast', async () => {
    const res = await simulateRequest('GET', `/api/events/${createdEventId}/ai-insights`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.insights);
    assert.ok(res.body.insights.healthScore >= 0);
    assert.ok(res.body.insights.executiveSummary.length > 20);
    assert.ok(Array.isArray(res.body.insights.recommendations));
  });

  await test('POST /api/ai/generate-description generates smart event content', async () => {
    const res = await simulateRequest('POST', '/api/ai/generate-description', {
      title: 'Autonomous Robotics Workshop',
      venue: 'Tech Park Hall 101',
      category: 'workshop'
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.description.includes('Autonomous Robotics Workshop'));
    assert.strictEqual(res.body.suggestedRadius, 50);
  });

  await test('GET /api/ai/status returns Ollama configuration and status', async () => {
    const res = await simulateRequest('GET', '/api/ai/status');
    assert.strictEqual(res.status, 200);
    assert.ok(typeof res.body.connected === 'boolean');
    assert.ok(typeof res.body.active_model === 'string');
    assert.ok(Array.isArray(res.body.installed_models));
  });

  await test('POST /api/ai/config updates local Ollama model configuration', async () => {
    const res = await simulateRequest('POST', '/api/ai/config', {
      model: 'qwen2.5:0.5b'
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.active_model, 'qwen2.5:0.5b');
  });

  await test('POST /api/ai/chat returns intelligent contextual attendance answer', async () => {
    const res = await simulateRequest('POST', '/api/ai/chat', {
      message: 'How many attendees checked in?',
      event_id: createdEventId
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.reply);
    assert.ok(typeof res.body.reply === 'string');
    assert.ok(res.body.reply.length > 10);
    assert.ok(res.body.ai_provider);
  });

  await test('POST /api/ai/search-events searches events semantically', async () => {
    const res = await simulateRequest('POST', '/api/ai/search-events', {
      query: 'AI symposium auditorium'
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(Array.isArray(res.body.matches));
    assert.ok(typeof res.body.explanation === 'string');
    assert.ok(res.body.ai_provider);
  });

  await test('POST /api/ai/recommendations generates personalized recommendations for attendees', async () => {
    const res = await simulateRequest('POST', '/api/ai/recommendations', {
      email: 'student@srmist.edu.in'
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(Array.isArray(res.body.recommendations));
    assert.ok(res.body.ai_provider);
  });

  await test('POST /api/events creates an event with category and formatted schedule date/time', async () => {
    const res = await simulateRequest('POST', '/api/events', {
      title: 'SRM Robotics & AI Summit 2026',
      venue_name: 'TP Ganesan Main Hall',
      category: 'Hackathon',
      event_date: '2026-09-20',
      start_time: '10:00',
      end_time: '18:00',
      latitude: 12.82315,
      longitude: 80.04420,
      radius_meters: 120
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.event.category, 'Hackathon');
    assert.ok(res.body.event.start_time.includes('2026-09-20'));
    assert.strictEqual(res.body.event.radius_meters, 120);
    db.deleteEvent(res.body.event.id);
  });

  await test('GET /api/events/:id/export/csv exports required columns (Name, Registration ID, Email, Timestamp)', async () => {
    const res = await simulateRequest('GET', `/api/events/${createdEventId}/export/csv`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers['content-type'], 'text/csv; charset=utf-8');

    const csv = res.body;
    assert.ok(typeof csv === 'string');
    assert.ok(csv.includes('Name,Registration ID,Email,Attendance Status,Timestamp'));
    assert.ok(csv.includes('RA2111003010123'));
    assert.ok(csv.includes('Rohan Sharma'));
    if (createdEventId) db.deleteEvent(createdEventId);
  });

  // --- STATIC ASSETS & FRONTEND SERVING ---
  console.log('\n[6/6] Testing Frontend Single Page Application & Static Assets...');

  await test('GET / serves index.html single-page application shell', async () => {
    const res = await simulateRequest('GET', '/');
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers['content-type'].includes('text/html'));
    assert.ok(res.body.includes('GeoAttend'));
  });

  await test('GET /css/style.css serves valid stylesheet', async () => {
    const res = await simulateRequest('GET', '/css/style.css');
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers['content-type'].includes('text/css'));
  });

  await test('GET /vendor/jsqr.min.js serves valid QR decoder engine', async () => {
    const res = await simulateRequest('GET', '/vendor/jsqr.min.js');
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers['content-type'].includes('application/javascript'));
    assert.ok(res.body.includes('jsQR'));
  });

  await test('GET /js/qr-scanner.js serves robust scanner with dynamic engine fallback', async () => {
    const res = await simulateRequest('GET', '/js/qr-scanner.js');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.includes('ensureDecoderEngine'));
    assert.ok(res.body.includes('getEngine'));
  });

  console.log(`\n======================================================`);
  console.log(`  TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log(`======================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
