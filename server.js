/**
 * QR-Based Geo-Tagged Attendance Management System - Server
 * High-performance Node.js HTTP & Real-Time SSE Server (Zero External Dependencies)
 * Includes JWT Authentication, Geofencing, Dynamic QR, and AI Smart Insights
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');
const crypto = require('node:crypto');

const db = require('./db');
const { calculateDistance, verifyGeofence } = require('./geo');
const { generateDynamicToken, validateToken, TOKEN_WINDOW_SECONDS } = require('./qr');
const { generateJWT, verifyJWT, verifyPassword, parseGoogleCredential } = require('./auth');
const { generateAttendanceInsights, generateEventDescription, searchEventsNaturalLanguage, getOllamaStatus, setOllamaConfig, askEventAssistant } = require('./ai');

// Load environment variables from .env if present
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(envPath);
  }
} catch (e) {
  // Ignore env loading error
}

let GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
let GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// MIME types for static assets
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.csv': 'text/csv; charset=utf-8'
};

// Real-Time SSE (Server-Sent Events) Subscriber Pool
const sseSubscribers = new Map();

/**
 * Register a client for live real-time updates of an event
 */
function addSseSubscriber(eventId, res) {
  if (!sseSubscribers.has(eventId)) {
    sseSubscribers.set(eventId, new Set());
  }
  sseSubscribers.get(eventId).add(res);

  res.on('close', () => {
    const clients = sseSubscribers.get(eventId);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) {
        sseSubscribers.delete(eventId);
      }
    }
  });
}

/**
 * Broadcast event to all connected organizers of an event
 */
function broadcastToEvent(eventId, eventName, payload) {
  const clients = sseSubscribers.get(eventId);
  if (!clients || clients.size === 0) return;

  const message = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    try {
      client.write(message);
    } catch (e) {}
  }
}

function broadcastToAll(eventType, data) {
  const message = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [, clients] of sseSubscribers) {
    for (const client of clients) {
      try {
        client.write(message);
      } catch (e) {}
    }
  }
}

// Global SSE heartbeat every 20s
const heartbeatInterval = setInterval(() => {
  for (const [, clients] of sseSubscribers) {
    for (const client of clients) {
      try {
        client.write(': heartbeat\n\n');
      } catch (e) {}
    }
  }
}, 20000);
if (heartbeatInterval.unref) heartbeatInterval.unref();

/**
 * Helper to read JSON request body
 */
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Extract authenticated user from Authorization header (JWT)
 */
function getAuthUser(req) {
  const authHeader = req.headers['authorization'] || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    const payload = verifyJWT(token);
    if (payload && payload.id) {
      return db.getUserById(payload.id) || payload;
    }
  }
  return null;
}

/**
 * Send JSON response
 */
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(data));
}

/**
 * Send CSV file response
 */
function sendCsv(res, filename, csvString) {
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-cache'
  });
  res.end(csvString);
}

/**
 * Serve static files from /public directory
 */
function serveStaticFile(req, res, pathname) {
  let relativePath = pathname === '/' ? '/index.html' : pathname;
  const safePath = path.normalize(relativePath).replace(/^(\.\.[\/\\])+/, '');
  let filePath = path.join(PUBLIC_DIR, safePath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      const indexPath = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(indexPath, (idxErr, content) => {
        if (idxErr) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('404 Not Found');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(content);
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server File Error');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });
  });
}

/**
 * HTTP Request Router & Controller
 */
async function handleRequest(req, res) {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // Enable CORS
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end();
    return;
  }

  try {
    // -------------------------------------------------------------
    // API: AUTHENTICATION (JWT)
    // -------------------------------------------------------------

    // POST /api/auth/login - Authenticate user & return JWT token
    if (pathname === '/api/auth/login' && method === 'POST') {
      const body = await parseJsonBody(req);
      const { email, password } = body;

      if (!email || !password) {
        return sendJson(res, 400, { error: 'Email and password are required' });
      }

      const user = db.getUserByEmail(email);
      if (!user) {
        return sendJson(res, 401, { error: 'Invalid email or password' });
      }

      const isValid = verifyPassword(password, user.password_hash, user.salt);
      if (!isValid) {
        return sendJson(res, 401, { error: 'Invalid email or password' });
      }

      const token = generateJWT({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      });

      return sendJson(res, 200, {
        success: true,
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role
        }
      });
    }

    // POST /api/auth/register - Register new user / participant
    if (pathname === '/api/auth/register' && method === 'POST') {
      const body = await parseJsonBody(req);
      const { name, email, password, role } = body;

      if (!name || !email || !password) {
        return sendJson(res, 400, { error: 'Name, email, and password are required' });
      }

      const existing = db.getUserByEmail(email);
      if (existing) {
        return sendJson(res, 409, { error: 'An account with this email already exists' });
      }

      const id = 'usr_' + crypto.randomBytes(6).toString('hex');
      const newUser = db.createUser({
        id,
        name: name.trim(),
        email: email.trim(),
        password,
        role: role === 'organizer' ? 'organizer' : 'participant'
      });

      const token = generateJWT({
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        role: newUser.role
      });

      return sendJson(res, 201, {
        success: true,
        token,
        user: {
          id: newUser.id,
          name: newUser.name,
          email: newUser.email,
          role: newUser.role
        }
      });
    }

    // GET /api/auth/me - Return current user profile from JWT
    if (pathname === '/api/auth/me' && method === 'GET') {
      const user = getAuthUser(req);
      if (!user) {
        return sendJson(res, 401, { error: 'Not authenticated' });
      }
      return sendJson(res, 200, { user });
    }

    // POST /api/auth/google - Authenticate / Sign in with Google
    if (pathname === '/api/auth/google' && method === 'POST') {
      const body = await parseJsonBody(req);
      const { credential, profile, role } = body;

      const googleData = parseGoogleCredential(credential || profile || body);
      if (!googleData || !googleData.email) {
        return sendJson(res, 400, { error: 'Invalid Google authentication payload or email' });
      }

      const assignedRole = role || (googleData.email.includes('organizer') ? 'organizer' : 'participant');

      const user = db.upsertGoogleUser({
        google_id: googleData.google_id,
        email: googleData.email,
        name: googleData.name,
        avatar_url: googleData.avatar_url,
        role: assignedRole
      });

      const token = generateJWT({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        avatar_url: user.avatar_url
      });

      return sendJson(res, 200, {
        success: true,
        token,
        user
      });
    }

    // GET /api/auth/google/config - Check if Google OAuth Client ID is configured
    if (pathname === '/api/auth/google/config' && method === 'GET') {
      return sendJson(res, 200, {
        configured: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_ID.trim().length > 0),
        client_id: GOOGLE_CLIENT_ID || ''
      });
    }

    // POST /api/auth/google/config - Save Google OAuth Client ID & Secret
    if (pathname === '/api/auth/google/config' && method === 'POST') {
      const body = await parseJsonBody(req);
      if (body.client_id !== undefined) {
        GOOGLE_CLIENT_ID = (body.client_id || '').trim();
      }
      if (body.client_secret !== undefined) {
        GOOGLE_CLIENT_SECRET = (body.client_secret || '').trim();
      }
      try {
        const envPath = path.join(__dirname, '.env');
        const envContent = `PORT=${PORT}\nGOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}\nGOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}\n`;
        fs.writeFileSync(envPath, envContent, 'utf8');
      } catch (e) {
        console.warn('Could not write to .env:', e.message);
      }

      return sendJson(res, 200, {
        success: true,
        configured: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_ID.trim().length > 0),
        client_id: GOOGLE_CLIENT_ID
      });
    }

    // GET /api/auth/google/login (or /redirect) - Redirect to official Google sign-in page
    if ((pathname === '/api/auth/google/login' || pathname === '/api/auth/google/redirect') && method === 'GET') {
      if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.trim().length === 0) {
        res.writeHead(302, { Location: '/#google_error=no_client_id' });
        res.end();
        return;
      }

      const host = req.headers.host || `localhost:${PORT}`;
      const proto = req.headers['x-forwarded-proto'] || 'http';
      const redirectUri = `${proto}://${host}/api/auth/google/callback`;

      const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      googleAuthUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
      googleAuthUrl.searchParams.set('redirect_uri', redirectUri);
      googleAuthUrl.searchParams.set('response_type', 'code');
      googleAuthUrl.searchParams.set('scope', 'openid email profile');
      googleAuthUrl.searchParams.set('access_type', 'offline');
      googleAuthUrl.searchParams.set('prompt', 'select_account');

      res.writeHead(302, { Location: googleAuthUrl.toString() });
      res.end();
      return;
    }

    // GET /api/auth/google/callback - Handle OAuth redirect callback from Google
    if (pathname === '/api/auth/google/callback' && method === 'GET') {
      const code = parsedUrl.query.code;
      const error = parsedUrl.query.error;

      if (error) {
        res.writeHead(302, { Location: `/#google_error=${encodeURIComponent(error)}` });
        res.end();
        return;
      }

      if (!code) {
        res.writeHead(302, { Location: '/#google_error=no_code_provided' });
        res.end();
        return;
      }

      const host = req.headers.host || `localhost:${PORT}`;
      const proto = req.headers['x-forwarded-proto'] || 'http';
      const redirectUri = `${proto}://${host}/api/auth/google/callback`;

      try {
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code'
          })
        });

        const tokenData = await tokenRes.json();
        if (!tokenRes.ok || !tokenData.access_token) {
          throw new Error(tokenData.error_description || tokenData.error || 'Failed to exchange token with Google');
        }

        const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });

        const profile = await userRes.json();
        if (!profile.email) {
          throw new Error('Google did not return an email address');
        }

        const user = db.upsertGoogleUser({
          google_id: profile.sub,
          email: profile.email.toLowerCase(),
          name: profile.name || profile.email.split('@')[0],
          avatar_url: profile.picture,
          role: profile.email.includes('organizer') ? 'organizer' : 'participant'
        });

        const token = generateJWT({
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          avatar_url: user.avatar_url
        });

        const targetUrl = `/#google_token=${encodeURIComponent(token)}&user=${encodeURIComponent(JSON.stringify(user))}`;
        res.writeHead(302, { Location: targetUrl });
        res.end();
        return;
      } catch (err) {
        console.error('Google OAuth callback error:', err);
        res.writeHead(302, { Location: `/#google_error=${encodeURIComponent(err.message)}` });
        res.end();
        return;
      }
    }

    // -------------------------------------------------------------
    // API: REAL-TIME SSE STREAM
    // -------------------------------------------------------------
    // GET /api/events/:id/live-stream
    const sseMatch = pathname.match(/^\/api\/events\/([^/]+)\/live-stream$/);
    if (sseMatch && method === 'GET') {
      const eventId = sseMatch[1];
      const event = db.getEventById(eventId);
      if (!event) {
        return sendJson(res, 404, { error: 'Event not found' });
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });

      const initialStats = db.getEventStats(eventId);
      res.write(`event: connected\ndata: ${JSON.stringify({ status: 'connected', eventId, stats: initialStats })}\n\n`);

      addSseSubscriber(eventId, res);
      return;
    }

    // -------------------------------------------------------------
    // API: EVENTS
    // -------------------------------------------------------------

    // GET /api/events/search - Natural language search
    if (pathname === '/api/events/search' && method === 'GET') {
      const query = parsedUrl.query.q || '';
      const allEvents = db.getAllEvents();
      const results = searchEventsNaturalLanguage(query, allEvents);
      return sendJson(res, 200, { results, count: results.length });
    }

    // GET /api/events - List all events
    if (pathname === '/api/events' && method === 'GET') {
      const organizerId = parsedUrl.query.organizer_id;
      const events = organizerId ? db.getEventsByOrganizer(organizerId) : db.getAllEvents();
      return sendJson(res, 200, { events });
    }

    // POST /api/events - Create new event (organizer protected)
    if (pathname === '/api/events' && method === 'POST') {
      const authUser = getAuthUser(req);
      const organizerId = authUser ? authUser.id : 'usr_org_default';
      const organizerEmail = (authUser ? authUser.email : '').trim().toLowerCase();

      const body = await parseJsonBody(req);
      if (!body.title || !body.venue_name || body.latitude === undefined || body.longitude === undefined) {
        return sendJson(res, 400, { error: 'Missing required event fields: title, venue_name, latitude, longitude' });
      }

      const id = body.id || 'evt_' + crypto.randomBytes(6).toString('hex');
      const staticCode = body.static_code || body.title.replace(/[^A-Z0-9]/gi, '-').toUpperCase().slice(0, 15) + '-' + Math.floor(100 + Math.random() * 900);
      const secretKey = crypto.randomBytes(16).toString('hex');

      const now = new Date();
      const startTime = body.start_time || now.toISOString();
      const endTime = body.end_time || new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString();

      let allowedEmailsList = (body.allowed_emails || '')
        .split(/[\n,;]+/)
        .map(e => e.trim().toLowerCase())
        .filter(Boolean);

      const requireWhitelist = body.require_whitelist !== undefined
        ? (body.require_whitelist ? 1 : 0)
        : (body.allowed_emails && body.allowed_emails.trim().length > 0 ? 1 : 0);

      // Only auto-include creator if whitelist is actively required
      if (requireWhitelist && organizerEmail && !allowedEmailsList.includes(organizerEmail)) {
        allowedEmailsList.push(organizerEmail);
      }

      const allowedEmailsStr = allowedEmailsList.join(',');

      const newEvent = db.createEvent({
        id,
        organizer_id: organizerId,
        title: body.title.trim(),
        description: (body.description || '').trim(),
        venue_name: body.venue_name.trim(),
        static_code: staticCode,
        secret_key: secretKey,
        latitude: parseFloat(body.latitude),
        longitude: parseFloat(body.longitude),
        radius_meters: parseInt(body.radius_meters || 100, 10),
        start_time: startTime,
        end_time: endTime,
        is_active: body.is_active !== undefined ? body.is_active : 1,
        dynamic_qr: body.dynamic_qr !== undefined ? body.dynamic_qr : 1,
        allowed_emails: allowedEmailsStr,
        require_whitelist: requireWhitelist
      });

      db.logAudit(id, 'EVENT_CREATED', `Event "${newEvent.title}" created with radius ${newEvent.radius_meters}m`);
      broadcastToAll('event_created', { event: newEvent });
      return sendJson(res, 201, { event: newEvent });
    }

    // GET /api/events/:id - Get event details
    const eventIdMatch = pathname.match(/^\/api\/events\/([^/]+)$/);
    if (eventIdMatch && method === 'GET') {
      const event = db.getEventById(eventIdMatch[1]);
      if (!event) return sendJson(res, 404, { error: 'Event not found' });
      return sendJson(res, 200, { event });
    }

    // PUT /api/events/:id - Update event (organizer protected)
    if (eventIdMatch && method === 'PUT') {
      const eventId = eventIdMatch[1];
      const existing = db.getEventById(eventId);
      if (!existing) return sendJson(res, 404, { error: 'Event not found' });

      const authUser = getAuthUser(req);
      if (authUser && existing.organizer_id && existing.organizer_id !== authUser.id && authUser.role !== 'admin') {
        return sendJson(res, 403, { error: 'Unauthorized: You can only edit events you organized' });
      }

      const body = await parseJsonBody(req);
      const updated = db.updateEvent(eventId, body);

      broadcastToEvent(eventId, 'event_updated', { event: updated });
      db.logAudit(eventId, 'EVENT_UPDATED', `Settings updated: active=${updated.is_active}, radius=${updated.radius_meters}m`);
      return sendJson(res, 200, { event: updated });
    }

    // DELETE /api/events/:id - Delete event (organizer protected)
    if (eventIdMatch && method === 'DELETE') {
      const eventId = eventIdMatch[1];
      const existing = db.getEventById(eventId);
      if (!existing) return sendJson(res, 404, { error: 'Event not found' });

      const authUser = getAuthUser(req);
      if (authUser && existing.organizer_id && existing.organizer_id !== authUser.id && authUser.role !== 'admin') {
        return sendJson(res, 403, { error: 'Unauthorized: You can only delete events you organized' });
      }

      db.deleteEvent(eventId);
      broadcastToEvent(eventId, 'event_deleted', { eventId });
      broadcastToAll('event_deleted', { eventId });
      return sendJson(res, 200, { success: true, message: 'Event deleted' });
    }

    // GET /api/events/:id/whitelist - Get allowed attendee emails
    const whitelistMatch = pathname.match(/^\/api\/events\/([^/]+)\/whitelist$/);
    if (whitelistMatch && method === 'GET') {
      const eventId = whitelistMatch[1];
      const event = db.getEventById(eventId);
      if (!event) return sendJson(res, 404, { error: 'Event not found' });
      const whitelist = db.getEventWhitelist(eventId);
      return sendJson(res, 200, {
        event_id: eventId,
        require_whitelist: Boolean(event.require_whitelist),
        allowed_emails: whitelist,
        count: whitelist.length
      });
    }

    // POST /api/events/:id/whitelist - Update allowed attendee emails (organizer)
    if (whitelistMatch && method === 'POST') {
      const eventId = whitelistMatch[1];
      const event = db.getEventById(eventId);
      if (!event) return sendJson(res, 404, { error: 'Event not found' });

      const authUser = getAuthUser(req);
      if (authUser && event.organizer_id && event.organizer_id !== authUser.id && authUser.role !== 'admin') {
        return sendJson(res, 403, { error: 'Unauthorized: You can only manage whitelist for your own events' });
      }

      const body = await parseJsonBody(req);
      const { allowed_emails, require_whitelist } = body;
      const updated = db.updateEventWhitelist(
        eventId,
        allowed_emails,
        require_whitelist !== undefined ? require_whitelist : 1
      );

      broadcastToEvent(eventId, 'whitelist_updated', {
        eventId,
        allowed_emails: db.getEventWhitelist(eventId),
        require_whitelist: Boolean(updated.require_whitelist)
      });

      return sendJson(res, 200, {
        success: true,
        allowed_emails: db.getEventWhitelist(eventId),
        require_whitelist: Boolean(updated.require_whitelist)
      });
    }

    // GET /api/events/:id/my-pass - Gatekeeper: gives personal entry QR code to whitelisted logged-in users
    const myPassMatch = pathname.match(/^\/api\/events\/([^/]+)\/my-pass$/);
    if (myPassMatch && method === 'GET') {
      const eventId = myPassMatch[1];
      const event = db.getEventById(eventId);
      if (!event) return sendJson(res, 404, { error: 'Event not found' });

      const authUser = getAuthUser(req);
      if (!authUser || !authUser.email) {
        return sendJson(res, 401, {
          success: false,
          authorized: false,
          error: 'Security Enforcement: You must sign in with your verified Google account to receive your personal entry pass. Manual email entry is disabled.'
        });
      }

      const email = authUser.email.trim().toLowerCase();

      const isWhitelisted = db.isEmailWhitelisted(eventId, email);
      if (!isWhitelisted) {
        return sendJson(res, 403, {
          success: false,
          authorized: false,
          error: `Access Denied: Your verified Google email (${email}) is not on the organizer's whitelist for this event.`
        });
      }

      // Generate authorized personal entry pass
      const nowEpoch = Math.floor(Date.now() / 1000);
      const activeToken = generateDynamicToken(event.id, event.secret_key, nowEpoch).token;
      const personalPassToken = `PASS:${event.id}:${encodeURIComponent(email)}:${activeToken}`;

      return sendJson(res, 200, {
        success: true,
        authorized: true,
        event_id: event.id,
        event_title: event.title,
        venue_name: event.venue_name,
        email,
        name: authUser ? authUser.name : email.split('@')[0],
        entry_token: personalPassToken,
        raw_token: activeToken,
        static_code: event.static_code,
        latitude: event.latitude,
        longitude: event.longitude,
        radius_meters: event.radius_meters
      });
    }

    // -------------------------------------------------------------
    // API: DYNAMIC QR CODE TOKEN
    // -------------------------------------------------------------
    // GET /api/events/:id/qr-token
    const qrTokenMatch = pathname.match(/^\/api\/events\/([^/]+)\/qr-token$/);
    if (qrTokenMatch && method === 'GET') {
      const event = db.getEventById(qrTokenMatch[1]);
      if (!event) return sendJson(res, 404, { error: 'Event not found' });

      if (event.dynamic_qr) {
        const dynamicData = generateDynamicToken(event.id, event.secret_key);
        return sendJson(res, 200, {
          is_dynamic: true,
          token: dynamicData.token,
          remaining_seconds: dynamicData.remainingSeconds,
          window_seconds: dynamicData.windowSeconds,
          event_id: event.id,
          event_title: event.title,
          venue_name: event.venue_name
        });
      } else {
        return sendJson(res, 200, {
          is_dynamic: false,
          token: event.static_code,
          event_id: event.id,
          event_title: event.title,
          venue_name: event.venue_name
        });
      }
    }

    // -------------------------------------------------------------
    // API: CHECK-IN VERIFICATION (CORE ATTENDANCE ENGINE)
    // -------------------------------------------------------------
    // POST /api/check-in
    if (pathname === '/api/check-in' && method === 'POST') {
      const body = await parseJsonBody(req);
      const {
        event_id,
        token,
        name,
        student_id,
        email,
        latitude,
        longitude,
        device_fingerprint
      } = body;

      if (!event_id || !name || !student_id || latitude === undefined || longitude === undefined) {
        return sendJson(res, 400, {
          success: false,
          error: 'Missing required check-in fields: event_id, name, student_id, latitude, longitude'
        });
      }

      const event = db.getEventById(event_id) || db.getEventByCode(event_id);
      if (!event) {
        return sendJson(res, 404, { success: false, error: 'Event not found' });
      }

      if (!event.is_active) {
        return sendJson(res, 403, {
          success: false,
          error: 'Event is currently closed or attendance has been disabled by the organizer.'
        });
      }

      // Time Window Validation
      const now = new Date();
      const startTime = new Date(event.start_time);
      const endTime = new Date(event.end_time);

      if (now < startTime) {
        return sendJson(res, 403, {
          success: false,
          error: `Event check-in has not opened yet. Opens at ${startTime.toLocaleTimeString()}`
        });
      }

      if (now > endTime) {
        return sendJson(res, 403, {
          success: false,
          error: `Event check-in window closed at ${endTime.toLocaleTimeString()}`
        });
      }

      // Whitelist Access Control & Verified Google Identity Enforcement
      const authUser = getAuthUser(req);
      const attendeeEmail = (authUser ? authUser.email : (email || '')).trim().toLowerCase();

      if (event.require_whitelist || (event.allowed_emails && event.allowed_emails.trim().length > 0)) {
        if (!authUser || !authUser.email) {
          return sendJson(res, 403, {
            success: false,
            error: 'Authentication Required: You must sign in with your verified Google account to check in. Manual email entry is disabled.'
          });
        }
        if (!db.isEmailWhitelisted(event.id, attendeeEmail)) {
          return sendJson(res, 403, {
            success: false,
            error: `Access Denied: Your verified Google email (${attendeeEmail}) is not authorized for this event. Only organizer-whitelisted attendees can enter.`
          });
        }
      }

      // Unwrap personal pass token (PASS:eventId:email:token) if provided
      let checkToken = token || event.static_code;
      if (checkToken && checkToken.startsWith(`PASS:${event.id}:`)) {
        const passParts = checkToken.split(':');
        checkToken = passParts.slice(3).join(':');
      }

      // Token Cryptographic & Anti-Proxy Validation
      const tokenCheck = validateToken(
        checkToken,
        event.id,
        event.secret_key,
        Boolean(event.dynamic_qr),
        event.static_code
      );

      if (!tokenCheck.valid) {
        return sendJson(res, 400, {
          success: false,
          error: tokenCheck.reason || 'Invalid or expired QR code.'
        });
      }

      // High-Precision Haversine Geofence Verification
      const attendeeLat = parseFloat(latitude);
      const attendeeLng = parseFloat(longitude);

      if (isNaN(attendeeLat) || isNaN(attendeeLng)) {
        return sendJson(res, 400, { success: false, error: 'Invalid geographic coordinates' });
      }

      const geoResult = verifyGeofence(
        attendeeLat,
        attendeeLng,
        event.latitude,
        event.longitude,
        event.radius_meters
      );

      let status = 'VERIFIED';
      let statusMessage = `Verified successfully! You are ${geoResult.distanceMeters}m from the venue (within ${event.radius_meters}m boundary).`;

      if (!geoResult.isWithin) {
        status = 'OUT_OF_BOUNDS';
        statusMessage = `Geofence Violation: You are ${geoResult.distanceMeters}m away from the venue, exceeding the allowed radius of ${event.radius_meters}m (by ${geoResult.breachMeters}m).`;
      }

      // Check for duplicate registration
      const existingAttendee = db.findAttendee(event.id, student_id.trim());
      let attendeeRecord;

      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';

      if (existingAttendee) {
        if (existingAttendee.status === 'VERIFIED') {
          return sendJson(res, 200, {
            success: true,
            already_verified: true,
            status: 'VERIFIED',
            message: `You are already checked in and verified for this event (recorded at ${new Date(existingAttendee.checkin_time).toLocaleTimeString()}).`,
            distance_meters: existingAttendee.distance_meters,
            radius_meters: event.radius_meters,
            breach_meters: 0,
            is_within_geofence: true,
            attendee: existingAttendee,
            receipt: {
              verification_hash: crypto.createHash('sha256').update(`${existingAttendee.id}:${event.id}:${existingAttendee.checkin_time}`).digest('hex').substring(0, 12).toUpperCase(),
              event_title: event.title,
              venue_name: event.venue_name,
              timestamp: existingAttendee.checkin_time,
              student_name: existingAttendee.name,
              student_id: existingAttendee.student_id
            }
          });
        }

        attendeeRecord = db.updateAttendee(existingAttendee.id, {
          status,
          notes: statusMessage
        });
      } else {
        const checkinId = 'att_' + crypto.randomBytes(6).toString('hex');
        attendeeRecord = db.addAttendee({
          id: checkinId,
          event_id: event.id,
          user_id: authUser ? authUser.id : null,
          name: name.trim(),
          student_id: student_id.trim(),
          email: attendeeEmail,
          checkin_time: now.toISOString(),
          latitude: attendeeLat,
          longitude: attendeeLng,
          distance_meters: geoResult.distanceMeters,
          status,
          device_fingerprint: device_fingerprint || '',
          ip_address: ip,
          notes: statusMessage
        });
      }

      // Real-Time Broadcast to Organizers (SSE)
      const updatedStats = db.getEventStats(event.id);
      broadcastToEvent(event.id, 'new_checkin', {
        attendee: attendeeRecord,
        stats: updatedStats
      });

      db.logAudit(event.id, 'CHECK_IN_ATTEMPT', `${name} (${student_id}) status: ${status}, distance: ${geoResult.distanceMeters}m`);

      return sendJson(res, status === 'VERIFIED' ? 200 : 422, {
        success: status === 'VERIFIED',
        status,
        message: statusMessage,
        distance_meters: geoResult.distanceMeters,
        radius_meters: event.radius_meters,
        breach_meters: geoResult.breachMeters,
        is_within_geofence: geoResult.isWithin,
        attendee: attendeeRecord,
        receipt: {
          verification_hash: crypto.createHash('sha256').update(`${attendeeRecord.id}:${event.id}:${attendeeRecord.checkin_time}`).digest('hex').substring(0, 12).toUpperCase(),
          event_title: event.title,
          venue_name: event.venue_name,
          timestamp: attendeeRecord.checkin_time,
          student_name: attendeeRecord.name,
          student_id: attendeeRecord.student_id
        }
      });
    }

    // -------------------------------------------------------------
    // API: ATTENDEE MANAGEMENT
    // -------------------------------------------------------------

    // GET /api/events/:id/attendees
    const attendeesMatch = pathname.match(/^\/api\/events\/([^/]+)\/attendees$/);
    if (attendeesMatch && method === 'GET') {
      const eventId = attendeesMatch[1];
      const { status, search } = parsedUrl.query;
      const attendees = db.getAttendeesByEvent(eventId, { status, search });
      return sendJson(res, 200, { attendees, count: attendees.length });
    }

    // PATCH /api/attendees/:id - Manual organizer override
    const attendeeOverrideMatch = pathname.match(/^\/api\/attendees\/([^/]+)$/);
    if (attendeeOverrideMatch && method === 'PATCH') {
      const attendeeId = attendeeOverrideMatch[1];
      const body = await parseJsonBody(req);
      const updated = db.updateAttendee(attendeeId, body);
      if (!updated) return sendJson(res, 404, { error: 'Attendee not found' });

      const updatedStats = db.getEventStats(updated.event_id);
      broadcastToEvent(updated.event_id, 'attendee_updated', {
        attendee: updated,
        stats: updatedStats
      });

      db.logAudit(updated.event_id, 'MANUAL_OVERRIDE', `Attendee ${updated.name} status changed to ${updated.status}`);
      return sendJson(res, 200, { attendee: updated });
    }

    // -------------------------------------------------------------
    // API: REAL-TIME STATISTICS & BROWNIE REPORTS
    // -------------------------------------------------------------

    // GET /api/events/:id/stats - Live statistics
    const statsMatch = pathname.match(/^\/api\/events\/([^/]+)\/stats$/);
    if (statsMatch && method === 'GET') {
      const eventId = statsMatch[1];
      const stats = db.getEventStats(eventId);
      if (!stats) return sendJson(res, 404, { error: 'Event not found' });
      return sendJson(res, 200, stats);
    }

    // GET /api/ai/status - Check local Ollama / Qwen model status
    if (pathname === '/api/ai/status' && method === 'GET') {
      const status = await getOllamaStatus();
      return sendJson(res, 200, status);
    }

    // POST /api/ai/config - Configure local Ollama host or model name
    if (pathname === '/api/ai/config' && method === 'POST') {
      const body = await parseJsonBody(req);
      setOllamaConfig(body);
      const status = await getOllamaStatus();
      return sendJson(res, 200, { success: true, ...status });
    }

    // POST /api/ai/chat - Interactive organizer Q&A powered by local Qwen
    if (pathname === '/api/ai/chat' && method === 'POST') {
      const body = await parseJsonBody(req);
      const { message, event_id } = body;
      if (!message) return sendJson(res, 400, { error: 'Message is required' });

      let event = null;
      let attendees = [];
      let stats = null;

      if (event_id) {
        event = db.getEventById(event_id);
        if (event) {
          attendees = db.getAttendeesByEvent(event_id);
          stats = db.getEventStats(event_id);
        }
      }

      if (!event) {
        const allEvents = db.getAllEvents();
        if (allEvents.length > 0) {
          event = allEvents[0];
          attendees = db.getAttendeesByEvent(event.id);
          stats = db.getEventStats(event.id);
        }
      }

      const replyData = await askEventAssistant(
        message,
        event || { title: 'General Session', venue_name: 'SRM Campus', radius_meters: 80 },
        attendees,
        stats
      );
      return sendJson(res, 200, replyData);
    }

    // GET /api/events/:id/ai-insights - AI Attendance Insights (Local Qwen + Heuristic Fallback)
    const aiInsightsMatch = pathname.match(/^\/api\/events\/([^/]+)\/ai-insights$/);
    if (aiInsightsMatch && method === 'GET') {
      const eventId = aiInsightsMatch[1];
      const event = db.getEventById(eventId);
      if (!event) return sendJson(res, 404, { error: 'Event not found' });

      const attendees = db.getAttendeesByEvent(eventId);
      const stats = db.getEventStats(eventId);
      const insights = await generateAttendanceInsights(event, attendees, stats.metrics);
      return sendJson(res, 200, { insights });
    }

    // POST /api/ai/generate-description - AI Description Generator (Local Qwen + Heuristic Fallback)
    if (pathname === '/api/ai/generate-description' && method === 'POST') {
      const body = await parseJsonBody(req);
      const { title, venue, category } = body;
      const result = await generateEventDescription(title || 'Campus Seminar', venue || 'SRM Auditorium', category || 'academic');
      return sendJson(res, 200, result);
    }

    // GET /api/events/:id/export/csv - Data Export (CSV)
    // Required fields: Name, Registration ID, Email, Attendance Status, Timestamp
    const exportCsvMatch = pathname.match(/^\/api\/events\/([^/]+)\/export\/csv$/);
    if (exportCsvMatch && method === 'GET') {
      const eventId = exportCsvMatch[1];
      const event = db.getEventById(eventId);
      if (!event) return sendJson(res, 404, { error: 'Event not found' });

      const attendees = db.getAttendeesByEvent(eventId);

      const headers = [
        'Name',
        'Registration ID',
        'Email',
        'Attendance Status',
        'Timestamp',
        'Distance (m)',
        'Allowed Radius (m)',
        'Venue'
      ];

      function escapeCsv(val) {
        if (val === null || val === undefined) return '""';
        const str = String(val).replace(/"/g, '""');
        return `"${str}"`;
      }

      const rows = attendees.map(a => {
        const localTime = new Date(a.checkin_time).toLocaleString();
        return [
          escapeCsv(a.name),
          escapeCsv(a.student_id),
          escapeCsv(a.email),
          escapeCsv(a.status),
          escapeCsv(localTime),
          escapeCsv(a.distance_meters),
          escapeCsv(event.radius_meters),
          escapeCsv(event.venue_name)
        ].join(',');
      });

      const csvContent = [headers.join(','), ...rows].join('\r\n');
      const safeTitle = event.title.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `Attendance_${safeTitle}_${new Date().toISOString().slice(0, 10)}.csv`;

      return sendCsv(res, filename, csvContent);
    }

    // GET /api/events/:id/export/json - Downloadable JSON
    const exportJsonMatch = pathname.match(/^\/api\/events\/([^/]+)\/export\/json$/);
    if (exportJsonMatch && method === 'GET') {
      const eventId = exportJsonMatch[1];
      const event = db.getEventById(eventId);
      if (!event) return sendJson(res, 404, { error: 'Event not found' });

      const attendees = db.getAttendeesByEvent(eventId);
      const stats = db.getEventStats(eventId);

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="attendance_${event.id}.json"`
      });
      return res.end(JSON.stringify({ event, stats, attendees }, null, 2));
    }

    // POST /api/seed - Re-seed initial demo dataset
    if (pathname === '/api/seed' && method === 'POST') {
      db.seedDemoData();
      return sendJson(res, 200, { success: true, message: 'Demo dataset reloaded' });
    }

    // -------------------------------------------------------------
    // STATIC ASSETS FALLBACK
    // -------------------------------------------------------------
    return serveStaticFile(req, res, pathname);

  } catch (err) {
    console.error('Server error:', err);
    return sendJson(res, 500, { error: 'Internal Server Error', message: err.message });
  }
}

const server = http.createServer(handleRequest);

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`  GeoAttend: QR-Based Attendance Management System`);
    console.log(`  Server running at: http://localhost:${PORT}`);
    console.log(`  Time-slice window: ${TOKEN_WINDOW_SECONDS}s (Dynamic Anti-Proxy)`);
    console.log(`  JWT Auth & AI Analytics Engine: Active`);
    console.log(`======================================================\n`);
  });
}

module.exports = { server, handleRequest, sseSubscribers, broadcastToEvent };
