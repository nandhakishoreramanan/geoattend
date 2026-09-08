/**
 * Database Layer using Node.js built-in SQLite (node:sqlite DatabaseSync)
 * Provides schema initialization, user authentication, event CRUD, attendance, and audit logs.
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const { generateSecretKey } = require('./qr');
const { calculateDistance } = require('./geo');
const { hashPassword, verifyPassword } = require('./auth');

const DB_PATH = path.join(__dirname, 'attendance.db');
const db = new DatabaseSync(DB_PATH);

try {
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
} catch (e) {
  console.warn('Pragma note:', e.message);
}

/**
 * Initialize Schema
 */
function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'participant', -- 'organizer' | 'participant'
      google_id TEXT,
      avatar_url TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      organizer_id TEXT NOT NULL DEFAULT 'usr_org_default',
      title TEXT NOT NULL,
      description TEXT,
      venue_name TEXT NOT NULL,
      static_code TEXT NOT NULL UNIQUE,
      secret_key TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      radius_meters INTEGER NOT NULL DEFAULT 100,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      dynamic_qr INTEGER NOT NULL DEFAULT 1,
      category TEXT DEFAULT 'Tech / AI',
      allowed_emails TEXT DEFAULT '',
      require_whitelist INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (organizer_id) REFERENCES users (id) ON DELETE SET DEFAULT
    );

    CREATE TABLE IF NOT EXISTS attendees (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      user_id TEXT,
      name TEXT NOT NULL,
      student_id TEXT NOT NULL,
      email TEXT NOT NULL,
      checkin_time TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      distance_meters REAL NOT NULL,
      status TEXT NOT NULL, -- 'VERIFIED', 'OUT_OF_BOUNDS', 'LATE', 'FLAGGED'
      device_fingerprint TEXT,
      ip_address TEXT,
      notes TEXT,
      FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE,
      UNIQUE (event_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT,
      action TEXT NOT NULL,
      details TEXT,
      timestamp TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
    CREATE INDEX IF NOT EXISTS idx_events_organizer ON events (organizer_id);
    CREATE INDEX IF NOT EXISTS idx_attendees_event ON attendees (event_id);
    CREATE INDEX IF NOT EXISTS idx_attendees_status ON attendees (status);
  `);

  // Migrate existing tables gracefully
  try { db.exec("ALTER TABLE users ADD COLUMN google_id TEXT;"); } catch (e) {}
  try { db.exec("ALTER TABLE users ADD COLUMN avatar_url TEXT;"); } catch (e) {}
  try { db.exec("ALTER TABLE events ADD COLUMN allowed_emails TEXT DEFAULT '';"); } catch (e) {}
  try { db.exec("ALTER TABLE events ADD COLUMN require_whitelist INTEGER NOT NULL DEFAULT 0;"); } catch (e) {}
  try { db.exec("ALTER TABLE events ADD COLUMN category TEXT DEFAULT 'Tech / AI';"); } catch (e) {}
}

initSchema();

// --- User & Authentication Queries ---

function createUser(userData) {
  const { hash, salt } = hashPassword(userData.password);
  const stmt = db.prepare(`
    INSERT INTO users (id, name, email, password_hash, salt, role, google_id, avatar_url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    userData.id,
    userData.name.trim(),
    userData.email.toLowerCase().trim(),
    hash,
    salt,
    userData.role || 'participant',
    userData.google_id || null,
    userData.avatar_url || null,
    userData.created_at || new Date().toISOString()
  );

  return getUserById(userData.id);
}

function getUserByEmail(email) {
  if (!email) return null;
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
}

function getUserById(id) {
  if (!id) return null;
  const user = db.prepare('SELECT id, name, email, role, google_id, avatar_url, created_at FROM users WHERE id = ?').get(id);
  return user;
}

const crypto = require('node:crypto');

function upsertGoogleUser(userData) {
  const email = (userData.email || '').toLowerCase().trim();
  if (!email) throw new Error('Email is required for Google user');

  const existing = getUserByEmail(email);
  if (existing) {
    db.prepare(`
      UPDATE users SET
        name = COALESCE(?, name),
        google_id = COALESCE(?, google_id),
        avatar_url = COALESCE(?, avatar_url)
      WHERE id = ?
    `).run(
      userData.name ? userData.name.trim() : existing.name,
      userData.google_id || existing.google_id || null,
      userData.avatar_url || existing.avatar_url || null,
      existing.id
    );
    return getUserById(existing.id);
  }

  const id = userData.id || 'usr_g_' + crypto.randomBytes(6).toString('hex');
  const dummyHash = 'google_oauth_' + crypto.randomBytes(8).toString('hex');
  const dummySalt = 'google_salt';

  db.prepare(`
    INSERT INTO users (id, name, email, password_hash, salt, role, google_id, avatar_url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    userData.name ? userData.name.trim() : email.split('@')[0],
    email,
    dummyHash,
    dummySalt,
    userData.role || 'participant',
    userData.google_id || null,
    userData.avatar_url || null,
    new Date().toISOString()
  );

  return getUserById(id);
}

// --- Event Queries ---

function getAllEvents() {
  const query = `
    SELECT 
      e.*,
      u.name AS organizer_name,
      u.email AS organizer_email,
      COUNT(a.id) AS total_checkins,
      SUM(CASE WHEN a.status = 'VERIFIED' THEN 1 ELSE 0 END) AS verified_checkins,
      SUM(CASE WHEN a.status = 'OUT_OF_BOUNDS' THEN 1 ELSE 0 END) AS out_of_bounds_checkins
    FROM events e
    LEFT JOIN users u ON e.organizer_id = u.id
    LEFT JOIN attendees a ON e.id = a.event_id
    GROUP BY e.id
    ORDER BY e.created_at DESC
  `;
  return db.prepare(query).all();
}

function getEventsByOrganizer(organizerId) {
  const query = `
    SELECT 
      e.*,
      COUNT(a.id) AS total_checkins,
      SUM(CASE WHEN a.status = 'VERIFIED' THEN 1 ELSE 0 END) AS verified_checkins,
      SUM(CASE WHEN a.status = 'OUT_OF_BOUNDS' THEN 1 ELSE 0 END) AS out_of_bounds_checkins
    FROM events e
    LEFT JOIN attendees a ON e.id = a.event_id
    WHERE e.organizer_id = ?
    GROUP BY e.id
    ORDER BY e.created_at DESC
  `;
  return db.prepare(query).all(organizerId);
}

function getEventById(id) {
  const query = `
    SELECT 
      e.*,
      u.name AS organizer_name,
      COUNT(a.id) AS total_checkins,
      SUM(CASE WHEN a.status = 'VERIFIED' THEN 1 ELSE 0 END) AS verified_checkins,
      SUM(CASE WHEN a.status = 'OUT_OF_BOUNDS' THEN 1 ELSE 0 END) AS out_of_bounds_checkins
    FROM events e
    LEFT JOIN users u ON e.organizer_id = u.id
    LEFT JOIN attendees a ON e.id = a.event_id
    WHERE e.id = ?
    GROUP BY e.id
  `;
  return db.prepare(query).get(id);
}

function getEventByCode(code) {
  return db.prepare('SELECT * FROM events WHERE static_code = ? OR id = ?').get(code, code);
}

function createEvent(eventData) {
  const stmt = db.prepare(`
    INSERT INTO events (
      id, organizer_id, title, description, venue_name, static_code, secret_key,
      latitude, longitude, radius_meters, start_time, end_time,
      is_active, dynamic_qr, category, allowed_emails, require_whitelist, created_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?
    )
  `);

  let allowedEmailsStr = '';
  if (Array.isArray(eventData.allowed_emails)) {
    allowedEmailsStr = eventData.allowed_emails.map(e => String(e).trim().toLowerCase()).filter(Boolean).join(',');
  } else if (typeof eventData.allowed_emails === 'string') {
    allowedEmailsStr = eventData.allowed_emails.trim();
  }

  stmt.run(
    eventData.id,
    eventData.organizer_id || 'usr_org_default',
    eventData.title,
    eventData.description || '',
    eventData.venue_name,
    eventData.static_code,
    eventData.secret_key || generateSecretKey(),
    eventData.latitude,
    eventData.longitude,
    eventData.radius_meters || 100,
    eventData.start_time,
    eventData.end_time,
    eventData.is_active !== undefined ? (eventData.is_active ? 1 : 0) : 1,
    eventData.dynamic_qr !== undefined ? (eventData.dynamic_qr ? 1 : 0) : 1,
    eventData.category || 'Tech / AI',
    allowedEmailsStr,
    eventData.require_whitelist !== undefined ? (eventData.require_whitelist ? 1 : 0) : (allowedEmailsStr.length > 0 ? 1 : 0),
    eventData.created_at || new Date().toISOString()
  );

  return getEventById(eventData.id);
}

function updateEvent(id, updates) {
  const existing = getEventById(id);
  if (!existing) return null;

  const title = updates.title !== undefined ? updates.title : existing.title;
  const description = updates.description !== undefined ? updates.description : existing.description;
  const venue_name = updates.venue_name !== undefined ? updates.venue_name : existing.venue_name;
  const latitude = updates.latitude !== undefined ? updates.latitude : existing.latitude;
  const longitude = updates.longitude !== undefined ? updates.longitude : existing.longitude;
  const radius_meters = updates.radius_meters !== undefined ? updates.radius_meters : existing.radius_meters;
  const start_time = updates.start_time !== undefined ? updates.start_time : existing.start_time;
  const end_time = updates.end_time !== undefined ? updates.end_time : existing.end_time;
  const is_active = updates.is_active !== undefined ? (updates.is_active ? 1 : 0) : existing.is_active;
  const dynamic_qr = updates.dynamic_qr !== undefined ? (updates.dynamic_qr ? 1 : 0) : existing.dynamic_qr;
  const category = updates.category !== undefined ? updates.category : (existing.category || 'Tech / AI');
  const allowed_emails = updates.allowed_emails !== undefined
    ? (Array.isArray(updates.allowed_emails) ? updates.allowed_emails.map(e => e.trim().toLowerCase()).filter(Boolean).join(',') : String(updates.allowed_emails).trim())
    : (existing.allowed_emails || '');
  const require_whitelist = updates.require_whitelist !== undefined ? (updates.require_whitelist ? 1 : 0) : (existing.require_whitelist || 0);

  db.prepare(`
    UPDATE events SET
      title = ?, description = ?, venue_name = ?,
      latitude = ?, longitude = ?, radius_meters = ?,
      start_time = ?, end_time = ?, is_active = ?, dynamic_qr = ?,
      category = ?, allowed_emails = ?, require_whitelist = ?
    WHERE id = ?
  `).run(
    title, description, venue_name,
    latitude, longitude, radius_meters,
    start_time, end_time, is_active, dynamic_qr,
    category, allowed_emails, require_whitelist,
    id
  );

  return getEventById(id);
}

function getEventWhitelist(eventId) {
  const event = getEventById(eventId);
  if (!event || !event.allowed_emails) return [];
  try {
    if (event.allowed_emails.startsWith('[')) {
      return JSON.parse(event.allowed_emails);
    }
  } catch (e) {}
  return event.allowed_emails
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
}

function isEmailWhitelisted(eventId, email) {
  if (!email) return false;
  const event = getEventById(eventId);
  if (!event) return false;
  if (!event.require_whitelist && (!event.allowed_emails || event.allowed_emails.trim() === '')) {
    return true; // Whitelist not required
  }
  const whitelist = getEventWhitelist(eventId);
  if (whitelist.length === 0 && !event.require_whitelist) return true;
  return whitelist.includes(email.toLowerCase().trim());
}

function updateEventWhitelist(eventId, allowedEmailsList, requireWhitelist = 1) {
  const emailsStr = Array.isArray(allowedEmailsList)
    ? allowedEmailsList.map(e => e.trim().toLowerCase()).filter(Boolean).join(',')
    : String(allowedEmailsList || '');

  db.prepare(`
    UPDATE events SET
      allowed_emails = ?,
      require_whitelist = ?
    WHERE id = ?
  `).run(emailsStr, requireWhitelist ? 1 : 0, eventId);

  return getEventById(eventId);
}

function deleteEvent(id) {
  db.prepare('DELETE FROM events WHERE id = ?').run(id);
  return { success: true };
}

// --- Attendee Queries ---

function getAttendeesByEvent(eventId, filters = {}) {
  let query = 'SELECT * FROM attendees WHERE event_id = ?';
  const params = [eventId];

  if (filters.status && filters.status !== 'ALL') {
    query += ' AND status = ?';
    params.push(filters.status);
  }

  if (filters.search) {
    query += ' AND (name LIKE ? OR student_id LIKE ? OR email LIKE ?)';
    const term = `%${filters.search}%`;
    params.push(term, term, term);
  }

  query += ' ORDER BY checkin_time DESC';

  return db.prepare(query).all(...params);
}

function getAttendeeById(id) {
  return db.prepare('SELECT * FROM attendees WHERE id = ?').get(id);
}

function findAttendee(eventId, studentId) {
  return db.prepare('SELECT * FROM attendees WHERE event_id = ? AND student_id = ?').get(eventId, studentId);
}

function addAttendee(record) {
  const stmt = db.prepare(`
    INSERT INTO attendees (
      id, event_id, user_id, name, student_id, email, checkin_time,
      latitude, longitude, distance_meters, status,
      device_fingerprint, ip_address, notes
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?
    )
  `);

  stmt.run(
    record.id,
    record.event_id,
    record.user_id || null,
    record.name,
    record.student_id,
    record.email || '',
    record.checkin_time || new Date().toISOString(),
    record.latitude,
    record.longitude,
    record.distance_meters,
    record.status,
    record.device_fingerprint || '',
    record.ip_address || '',
    record.notes || ''
  );

  return getAttendeeById(record.id);
}

function updateAttendee(id, updates) {
  const existing = getAttendeeById(id);
  if (!existing) return null;

  const status = updates.status !== undefined ? updates.status : existing.status;
  const notes = updates.notes !== undefined ? updates.notes : existing.notes;

  db.prepare('UPDATE attendees SET status = ?, notes = ? WHERE id = ?').run(status, notes, id);
  return getAttendeeById(id);
}

// --- Statistics & Analytics ---

function getEventStats(eventId) {
  const event = getEventById(eventId);
  if (!event) return null;

  const attendees = db.prepare('SELECT * FROM attendees WHERE event_id = ? ORDER BY checkin_time ASC').all(eventId);

  const total = attendees.length;
  const verified = attendees.filter(a => a.status === 'VERIFIED').length;
  const outOfBounds = attendees.filter(a => a.status === 'OUT_OF_BOUNDS').length;
  const late = attendees.filter(a => a.status === 'LATE').length;
  const flagged = attendees.filter(a => a.status === 'FLAGGED').length;

  const passRate = total > 0 ? Math.round((verified / total) * 100) : 0;

  const sumDistance = attendees.reduce((acc, a) => acc + a.distance_meters, 0);
  const avgDistance = total > 0 ? Math.round((sumDistance / total) * 10) / 10 : 0;
  const minDistance = total > 0 ? Math.min(...attendees.map(a => a.distance_meters)) : 0;
  const maxDistance = total > 0 ? Math.max(...attendees.map(a => a.distance_meters)) : 0;

  const distanceBuckets = {
    '0-25m': 0,
    '25-50m': 0,
    '50-100m': 0,
    '100-200m': 0,
    '>200m': 0
  };

  attendees.forEach(a => {
    const d = a.distance_meters;
    if (d <= 25) distanceBuckets['0-25m']++;
    else if (d <= 50) distanceBuckets['25-50m']++;
    else if (d <= 100) distanceBuckets['50-100m']++;
    else if (d <= 200) distanceBuckets['100-200m']++;
    else distanceBuckets['>200m']++;
  });

  const recentCheckins = attendees.slice(-10).reverse();

  return {
    event: {
      id: event.id,
      organizer_id: event.organizer_id,
      title: event.title,
      venue_name: event.venue_name,
      latitude: event.latitude,
      longitude: event.longitude,
      radius_meters: event.radius_meters,
      is_active: Boolean(event.is_active),
      dynamic_qr: Boolean(event.dynamic_qr)
    },
    metrics: {
      total,
      verified,
      outOfBounds,
      late,
      flagged,
      passRate,
      avgDistance,
      minDistance,
      maxDistance
    },
    distanceBuckets,
    recentCheckins
  };
}

// --- Audit Log ---

function logAudit(eventId, action, details) {
  try {
    db.prepare(`
      INSERT INTO audit_logs (event_id, action, details, timestamp)
      VALUES (?, ?, ?, ?)
    `).run(eventId, action, details, new Date().toISOString());
  } catch (e) {
    console.error('Audit log failed:', e.message);
  }
}

// --- Seed Realistic Demo Data ---

function seedDemoData() {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  
  if (userCount === 0) {
    console.log('Seeding default users...');
    // Seed Organizer
    createUser({
      id: 'usr_org_default',
      name: 'Dr. K. Ramanathan',
      email: 'organizer@srmist.edu.in',
      password: 'adminpassword123',
      role: 'organizer'
    });

    // Seed Participant
    createUser({
      id: 'usr_student_default',
      name: 'Rohan Sharma',
      email: 'student@srmist.edu.in',
      password: 'studentpassword123',
      role: 'participant'
    });
  }

  // Ensure default campus events exist so semantic search and categories are immediately testable
  const eventCount = db.prepare('SELECT COUNT(*) as count FROM events').get().count;
  if (eventCount <= 1) {
    console.log('Seeding campus demo events including Hackathons & Workshops...');
    const now = new Date();

    // 1. Flagship SRM National Hackathon at TP Ganesan
    const hackDate1 = new Date(now.getTime() + 1 * 86400000);
    hackDate1.setHours(9, 0, 0, 0);
    const hackEnd1 = new Date(hackDate1.getTime() + 36 * 3600000);
    createEvent({
      id: 'evt_hackathon_tpganesan',
      organizer_id: 'usr_org_default',
      title: 'SRM HackMatrix 2026: 36-Hour National Hackathon',
      description: 'Flagship 36-hour hackathon bringing together 300+ developers to build AI, IoT, Web3, and sustainability innovations.',
      venue_name: 'TP Ganesan Main Auditorium',
      static_code: 'HACK-SRM-2026',
      latitude: 12.82315,
      longitude: 80.04420,
      radius_meters: 100,
      start_time: hackDate1.toISOString(),
      end_time: hackEnd1.toISOString(),
      category: 'Hackathon',
      is_active: 1,
      dynamic_qr: 1,
      allowed_emails: 'student@srmist.edu.in,nandhakishore.hi@gmail.com',
      require_whitelist: 0
    });

    // 2. NextGen AI & Agentic LLM Morning Sprint
    const hackDate2 = new Date(now.getTime() + 3 * 86400000);
    hackDate2.setHours(9, 30, 0, 0);
    const hackEnd2 = new Date(hackDate2.getTime() + 10 * 3600000);
    createEvent({
      id: 'evt_hackathon_ai_sprint',
      organizer_id: 'usr_org_default',
      title: 'NextGen AI & Agentic LLM Morning Hackathon',
      description: 'Morning hackathon sprint building autonomous agents, on-device Qwen inference, and local LLM pipelines.',
      venue_name: 'Tech Park 3rd Floor Innovation Lab',
      static_code: 'AI-SPRINT-404',
      latitude: 12.82480,
      longitude: 80.04510,
      radius_meters: 75,
      start_time: hackDate2.toISOString(),
      end_time: hackEnd2.toISOString(),
      category: 'Hackathon',
      is_active: 1,
      dynamic_qr: 1,
      allowed_emails: 'student@srmist.edu.in,nandhakishore.hi@gmail.com',
      require_whitelist: 0
    });

    // 3. Hands-on Full-Stack Web & AI Workshop
    const workshopDate = new Date(now.getTime() + 5 * 86400000);
    workshopDate.setHours(14, 0, 0, 0);
    const workshopEnd = new Date(workshopDate.getTime() + 3 * 3600000);
    createEvent({
      id: 'evt_workshop_fullstack',
      organizer_id: 'usr_org_default',
      title: 'Hands-on Spatial Geofencing & Zero-Dependency Node.js Workshop',
      description: 'Lab session building geofenced attendance verification, WebRTC camera QR decoding, and cryptographic token streams.',
      venue_name: 'University Building UB-602',
      static_code: 'WORKSHOP-GEO-2026',
      latitude: 12.82280,
      longitude: 80.04350,
      radius_meters: 50,
      start_time: workshopDate.toISOString(),
      end_time: workshopEnd.toISOString(),
      category: 'Workshop',
      is_active: 1,
      dynamic_qr: 1,
      allowed_emails: 'student@srmist.edu.in,nandhakishore.hi@gmail.com',
      require_whitelist: 0
    });

    // 4. SRM Milan Cultural Fest & Keynote Gala
    const culturalDate = new Date(now.getTime() + 7 * 86400000);
    culturalDate.setHours(18, 0, 0, 0);
    const culturalEnd = new Date(culturalDate.getTime() + 4 * 3600000);
    createEvent({
      id: 'evt_cultural_milan',
      organizer_id: 'usr_org_default',
      title: 'SRM Milan 2026 Cultural Fest & Keynote Gala',
      description: 'Annual flagship university gathering featuring interactive tech exhibits, student performances, and keynote address.',
      venue_name: 'TP Ganesan Auditorium',
      static_code: 'MILAN-FEST-2026',
      latitude: 12.82315,
      longitude: 80.04420,
      radius_meters: 150,
      start_time: culturalDate.toISOString(),
      end_time: culturalEnd.toISOString(),
      category: 'Cultural',
      is_active: 1,
      dynamic_qr: 1,
      allowed_emails: 'student@srmist.edu.in,nandhakishore.hi@gmail.com',
      require_whitelist: 0
    });

    // 5. Cybersecurity & Zero-Trust Architecture Seminar
    const seminarDate = new Date(now.getTime() + 10 * 86400000);
    seminarDate.setHours(11, 0, 0, 0);
    const seminarEnd = new Date(seminarDate.getTime() + 2 * 3600000);
    createEvent({
      id: 'evt_seminar_cybersec',
      organizer_id: 'usr_org_default',
      title: 'Zero-Trust Architecture & Cryptographic Token Security',
      description: 'Academic lecture exploring HMAC sliding window tokens, OAuth 2.0 PKCE authentication, and anti-proxy gatekeeping.',
      venue_name: 'Bio-Tech Seminar Hall',
      static_code: 'SEMINAR-SEC-2026',
      latitude: 12.82150,
      longitude: 80.04280,
      radius_meters: 60,
      start_time: seminarDate.toISOString(),
      end_time: seminarEnd.toISOString(),
      category: 'Seminar',
      is_active: 1,
      dynamic_qr: 1,
      allowed_emails: 'student@srmist.edu.in,nandhakishore.hi@gmail.com',
      require_whitelist: 0
    });
  }
}

function getAttendeeHistoryByEmail(email) {
  if (!email) return [];
  const query = `
    SELECT 
      a.id AS attendee_id,
      a.checkin_time,
      a.status,
      a.distance_meters,
      e.id,
      e.title,
      e.venue_name,
      e.category,
      e.start_time,
      e.end_time,
      e.radius_meters
    FROM attendees a
    JOIN events e ON a.event_id = e.id
    WHERE LOWER(a.email) = LOWER(?)
    ORDER BY a.checkin_time DESC
  `;
  try {
    return db.prepare(query).all(email);
  } catch (e) {
    return [];
  }
}

seedDemoData();

module.exports = {
  db,
  createUser,
  getUserByEmail,
  getUserById,
  upsertGoogleUser,
  getAllEvents,
  getEventsByOrganizer,
  getEventById,
  getEventByCode,
  createEvent,
  updateEvent,
  deleteEvent,
  getEventWhitelist,
  isEmailWhitelisted,
  updateEventWhitelist,
  getAttendeesByEvent,
  getAttendeeById,
  findAttendee,
  addAttendee,
  updateAttendee,
  getEventStats,
  getAttendeeHistoryByEmail,
  logAudit,
  seedDemoData
};
