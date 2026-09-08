# 📍 GeoAttend — QR-Based Geo-Tagged Attendance Management System

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests: 41 Passed](https://img.shields.io/badge/Tests-41%2F41%20Passing-emerald.svg)](tests/api.test.js)
[![AI Engine: Qwen 2.5 3B / Ollama](https://img.shields.io/badge/AI-Qwen%202.5%203B%20%7C%20Ollama-blueviolet.svg)](ai.js)
[![Architecture: Zero External Dependencies](https://img.shields.io/badge/Dependencies-0%20External%20NPM-purple.svg)](package.json)
[![Database: SQLite WAL](https://img.shields.io/badge/Database-SQLite%20WAL-blue.svg)](db.js)

> A full-stack, enterprise-grade attendance management system combining **unique event-specific & dynamic HMAC QR codes**, **high-precision Haversine geofencing ($d \le R$)**, **cryptographically enforced Google OAuth 2.0 authentication**, **organizer-restricted Gmail whitelist gatekeeping**, **real-time Server-Sent Events (SSE) telemetry**, **quarantined security breach tracking**, and a **local Qwen 2.5 3B AI intelligence engine**.
>
> Built with pure native Node.js (`node:http`, `node:crypto`, `node:sqlite`), zero external npm frameworks, and strictly zero Supabase / Firebase dependencies.

---

## 📑 Table of Contents
- [System Architecture](#-system-architecture)
- [3-Pillar Verification Framework](#-3-pillar-verification-framework)
- [Features Implemented](#-features-implemented)
- [Additional Features Added (Bonus ⭐)](#-additional-features-added-bonus-)
- [Security Breach Tracking & Quarantining](#-security-breach-tracking--quarantining)
- [Important Implementation Decisions](#-important-implementation-decisions)
- [Concepts Learned](#-concepts-learned)
- [API Reference](#-api-reference)
- [Setup & Running Instructions](#-setup--running-instructions)
- [Database Configuration & Schema](#-database-configuration--schema)
- [Deployment Guide](#-deployment-guide)
- [Automated Testing Suite (41/41 Passing)](#-automated-testing-suite-4141-passing)
- [Demo Video Walkthrough](#-demo-video-walkthrough)

---

## 🏛 System Architecture

GeoAttend operates on a dual-portal single-page application (SPA) architecture with an event-driven, high-performance native backend:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Vanilla ES6 SPA)                       │
│  ┌─────────────────────────────────┐ ┌────────────────────────────────┐  │
│  │     Organizer Control Portal    │ │     Attendee Check-in Portal   │  │
│  │  - Real-time SSE Live Monitor   │ │  - Live Event Catalog & Search │  │
│  │  - 20s Dynamic QR Projector     │ │  - High-Accuracy GPS Acquire   │  │
│  │  - Whitelist Management Modal   │ │  - WebRTC Camera / Upload QR   │  │
│  │  - AI Insights & CSV Export     │ │  - Personal Digital Pass (QR)  │  │
│  │  - Event Scheduler & Categories │ │  - AI Semantic Search & Recs   │  │
│  └─────────────────────────────────┘ └────────────────────────────────┘  │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │ HTTP REST + SSE Stream
┌────────────────────────────────────▼─────────────────────────────────────┐
│                   NATIVE NODE.JS BACKEND (Zero Dependencies)             │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  Server Core (node:http)                                           │  │
│  │  - REST API Router & Static File Pipeline                          │  │
│  │  - Server-Sent Events (SSE) Pub/Sub Multi-Client Broadcaster       │  │
│  ├────────────────────────────────────────────────────────────────────┤  │
│  │  Security & Cryptography (node:crypto)                             │  │
│  │  - RFC 7519 Compliant HMAC-SHA256 JWT Token Engine                 │  │
│  │  - Time-Sliced Dynamic QR Token Generator (20s Sliding Window)     │  │
│  │  - PBKDF2 / scrypt Password Salted Hashing                         │  │
│  │  - Google OAuth 2.0 Authorization Code Exchange (accounts.google)  │  │
│  ├────────────────────────────────────────────────────────────────────┤  │
│  │  Spatial Geodesy Engine (geo.js)                                   │  │
│  │  - Haversine Spherical Distance Computation ($d \le R$)           │  │
│  │  - Breach Distance & Boundary Compliance Calculator                │  │
│  ├────────────────────────────────────────────────────────────────────┤  │
│  │  AI Analytics & Synthesis Engine (ai.js)                           │  │
│  │  - Qwen 2.5 3B Local LLM (~3.4B params, Metal GPU accelerated)    │  │
│  │  - Natural-Language Semantic Event Search & Query Intent           │  │
│  │  - Personalized Event Recommendations (Match % & Rationale)        │  │
│  │  - Turnout Prediction, Punctuality Scoring & Anomaly Alerts        │  │
│  │  - Contextual Campus AI Concierge (Attendee Q&A & Organizer Audit) │  │
│  │  - Structured Event Description & Agenda Synthesizer               │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │ node:sqlite DatabaseSync (WAL Mode)
┌────────────────────────────────────▼─────────────────────────────────────┐
│                   LOCAL SQLITE DATABASE (attendance.db)                  │
│  - users (id, email, google_id, name, avatar_url, role, password_hash)    │
│  - events (id, title, venue, category, start_time, end_time, lat, lng...) │
│  - attendees (id, event_id, name, student_id, email, dist, status, hash)  │
│  - audit_logs (id, event_id, action, details, timestamp)                 │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 🏛️ 3-Pillar Verification Framework

To eliminate buddy-punching, off-site attendance fraud, and stolen credential abuse, attendance check-in strictly requires concurrent passage of all three pillars:

| Pillar | Verification Vector | Anti-Fraud Mechanism |
|---|---|---|
| **Pillar 1: Verified Google Identity** | Authenticated Google OAuth 2.0 account matching organizer's authorized whitelist. | Readonly email field; no manual email spoofing. Rejects unauthorized accounts with `status: 'FLAGGED'`. |
| **Pillar 2: Geofence Location Boundary** | Real-time device GPS coordinates calculated via backend Haversine formula ($d \le R$). | Device GPS must fall strictly within venue boundary (e.g. 50m–100m). Prevents off-site proxies. |
| **Pillar 3: Event-Specific QR Matching** | Scanned event QR token matching the specific event (`GEO:<eventId>:<staticCode>`). | Cross-event tokens and invalid codes are strictly rejected. |

---

## ✨ Features Implemented

### 1. 📅 Upcoming Campus Events Display with Comprehensive Details
- **Full Event Information**: Every event displays its **Name**, **Venue**, formatted **Date** (e.g. `Sep 15, 2026`), **Time Range** (e.g. `09:30 AM – 12:30 PM`), **Track/Category badge** (e.g. `💻 Tech / AI`, `⚡ Hackathon`, `🛠️ Workshop`, `🎓 Seminar`), **Geofence Radius** (e.g. `📍 50m radius`), **QR Type**, and **Whitelist Entry Status** (`🔒 Whitelisted` or `🌐 Open Entry`).
- **Instant Synchronization**: When an organizer creates a new event with schedule and track details, it immediately displays in the Attendee catalog across all clients without a reload.

### 2. 🛡️ Event-Specific QR Codes & Dynamic Rotating Tokens
- **Unique Event QR Codes (`GEO:<eventId>:<staticCode>`)**: Each event generates its own distinct static token. Cross-event QR tokens are rejected immediately.
- **Anti-Proxy via Geofencing**: Because attendance verification requires the user's live physical GPS coordinates to be inside the venue perimeter ($d \le R$), organizers can use high-reliability static event QR codes without fear of off-site proxy sharing, resolving camera focus delays or image upload expiration timeouts.
- **Dynamic 20-Second Sliding HMAC Support**: Organizers can also toggle 20-second dynamic rotating tokens (`GEO:<eventId>:<timeSlice>:<signature>`) for high-security auditorium projector presentations.

### 3. 📍 High-Precision Geofencing (Haversine Formula)
- **Server-Side Distance Authority**: Coordinates are computed strictly on the backend to prevent client tampering.
- **Dynamic Radius Boundary**: Organizers can configure geofence radii from **15m** (small classroom) to **500m** (campus lawn).
- **Status Classification**:
  - `VERIFIED`: Coordinates within the allowed boundary ($d \le R$).
  - `OUT_OF_BOUNDS`: Coordinates outside the allowed boundary ($d > R$) with exact breach distance in meters.

### 4. 📷 Multi-Modal QR Scanner
- **WebRTC Camera Stream**: Scans directly using device webcam/phone camera with animated laser reticle and front/rear camera flip.
- **Image File Drag-and-Drop**: Upload QR screenshots or images directly with multi-engine decoding (`BarcodeDetector` + native `jsQR` engine fallback).
- **Real-Time 3-Pillar Feedback**: Shows live status indicators for Google Identity, Device Location, and Event QR Code.

### 5. ⚡ Real-Time Attendance Monitoring via Server-Sent Events (SSE)
- **Zero-Latency Telemetry**: Organizers receive instant live push updates (`GET /api/events/:id/live-stream`) when attendees check in.
- **Bento Stat Cards**:
  - **Total Scans**: All submitted check-in attempts.
  - **Verified**: Verified attendees inside the geofence with authorized credentials.
  - **Pass Rate %**: Dynamically calculated as $\frac{\text{Verified}}{\text{Total}} \times 100$.
  - **Breach**: Combined count of spatial breaches (`OUT_OF_BOUNDS`) and identity/whitelist breaches (`FLAGGED`).
  - **Avg Distance**: Average attendee distance in meters from the venue center.
- **Interactive Attendee Table**: Search, filter by status (`ALL`, `VERIFIED`, `BREACHES`), and view timestamps, registration IDs, and GPS distances.

### 6. 📊 Downloadable Audit Reports
- **One-Click CSV Export**: Download complete records via `GET /api/events/:id/export/csv` containing `Name, Registration ID, Email, Attendance Status, Timestamp, Distance, Venue`.
- **Print / PDF Summary**: Clean printable executive summary styled with dedicated print media queries.
- **Manual Organizer Override**: Organizers can manually change verification status with full audit trail logging.

---

## 🌟 Additional Features Added (Bonus ⭐)

### 1. 🤖 Local Qwen 2.5 3B AI Engine (will use cloud api keys once I am rich enough :) )
- **100% On-Device Privacy • No Paid Cloud API Keys**: Runs local inference via **Ollama** using `qwen2.5:3b` (~3.4B parameters, ~1.9GB) accelerated by Apple Silicon Metal GPU (~45-60 tokens/sec on MacBook Air M1). Supports hot-swapping to `qwen2.5:0.5b` (~350MB) for ultra-low latency.
- **Zero-Cloud-Cost Guarantee**: All natural language queries, summaries, recommendations, and security audits run 100% on localhost. No OpenAI or cloud API bills.
- **Smart Deterministic Fallback**: If the local Ollama daemon is offline, a built-in deterministic heuristic engine automatically provides 100% uptime with zero crashes or error states.

### 2. 🔍 Natural-Language Semantic Event Search (`POST /api/ai/search-events`)
- Plain English search queries (e.g., *"morning hackathons in TP Ganesan"*, *"hands-on robotics lab"*, *"afternoon workshops"*).
- The AI extracts search intent, filters matching events semantically, and returns an explanation of why the events were matched.
- Includes 1-tap interactive preset prompt chips in the UI (*Morning tech*, *Hackathons*, *TP Ganesan*).

### 3. ⭐ Personalized Event Recommendations (`POST /api/ai/recommendations`)
- Analyzes an attendee's verified check-in history and academic tracks to recommend relevant upcoming sessions.
- Generates a **Match Percentage** (e.g. `⭐ 95% Match`) and personalized AI **rationale** explaining why the event fits their profile.
- Includes a 1-tap "Check in Pass" button to immediately focus and activate the recommended session.

### 4. 💬 Campus AI Concierge / Assistant (`POST /api/ai/chat`)
- Contextual dual-mode assistant for both organizers (turnout velocity, attendance velocity, geofence breach analysis, announcement drafting) and attendees (venue directions, pass requirements, schedule inquiries).
- Live context of scheduled events, attendee records, and geofence parameters are injected into the prompt.

### 5. 🔒 Strict Google OAuth 2.0 Security & Whitelist Gatekeeper
- **Official Google Redirection**: Direct redirect to `accounts.google.com/o/oauth2/v2/auth` via native authorization code exchange.
- **No Manual Email Typing**: The attendee email field is permanently `readonly`. Attendees cannot type, fake, or spoof emails.
- **Organizer Whitelist Enforcement**: Organizers specify allowed attendee Gmails per event. The backend gatekeeper (`GET /api/events/:id/my-pass`) verifies the user's Google JWT:
  - Whitelisted users receive an authorized personal digital pass.
  - Non-whitelisted users are rejected with HTTP 403 `Access Denied`.
- **Anti-Pass Hijacking**: If an attendee scans another student's pass, the system detects the email mismatch, quarantines the attempt as `status: 'FLAGGED'`, logs a security breach, and alerts the organizer in real time.

### 6. 🎟️ Personal Digital Attendance Pass (1-Tap Check-In)
- Whitelisted attendees automatically receive a personalized pass QR code (`PASS:eventId:email:dynamicToken`) rendered on an HTML5 canvas.
- Includes a **1-Tap "Use My Pass & Check In"** button for immediate verification.

### 7. 🛰️ Laptop / Desktop GPS Simulator
- Integrated presets for laptops lacking active satellite GPS:
  - `Inside Venue (~14m away)`
  - `Geofence Boundary (~65m away)`
  - `Outside Venue / Campus Canteen (~380m away)`
  - `Remote / Off-Campus (~4.5km away)`

---

## 🚨 Security Breach Tracking & Quarantining

When unauthorized check-in attempts occur, GeoAttend captures and quarantines the security event in real time rather than silently discarding it:

1. **Unauthorized Email Check-in**:
   - If an attendee signs in with a Google account not listed on the event's authorized whitelist, their attempt is recorded in the `attendees` table with `status: 'FLAGGED'`.
   - Audit notes document the exact violation: `Access Denied: Your verified Google email (...) is not authorized for this event. Whitelist breach.`
2. **Pass Hijacking Prevention**:
   - If an attendee scans a personal pass issued to another student's email, the attempt is quarantined as `status: 'FLAGGED'`.
3. **Telemetry & Pass Rate Impact**:
   - The **Breach** metric card on the organizer dashboard counts all violations:
     $$\text{Breaches} = \text{Out of Bounds} + \text{Flagged}$$
   - The **Pass Rate** accurately reflects all attempts:
     $$\text{Pass Rate} = \frac{\text{Verified}}{\text{Total Attempts}} \times 100$$
   - The organizer's **Attendee Roster** immediately displays the flagged record with a red badge, audit details, and options to manually review or override.
   - The **3D Geofence Radar** maps the breach with a red marker at the attendee's reported coordinates.

---

## 📐 Important Implementation Decisions

1. **Zero External Dependencies / Pure Native Node.js**:
   - Rather than relying on Express, Fastify, or heavy npm trees, the entire backend is built with native Node.js standard libraries (`node:http`, `node:crypto`, `node:sqlite`, `node:fs`).
   - *Rationale*: Zero vulnerability surface, instantaneous cold startup (<100ms), zero dependency deprecation risk, and full platform portability.

2. **Strictly Zero Firebase / Zero Supabase**:
   - Replaced third-party BaaS platforms with custom RFC 7519 compliant HMAC-SHA256 JWT tokens and local SQLite database storage.
   - *Rationale*: Guarantees data privacy, eliminates cloud vendor lock-in, and allows offline/local intranet deployment in campus environments.

3. **Event-Specific QR Codes Coupled with Geofencing**:
   - Replaced strict 20-second dynamic expiration with unique event-specific static QR codes (`GEO:<eventId>:<staticCode>`) combined with spatial GPS coordinates ($d \le R$).
   - *Rationale*: Eliminates false-negative check-in rejections caused by phone camera focus lag or image upload delays, while preserving uncompromised anti-proxy security (attendees cannot check in from home even if they have a screenshot of the QR).

4. **Server-Side Distance Authority**:
   - Geolocation verification is computed strictly on the backend using the Haversine formula. The client sends raw `(latitude, longitude)` coordinates along with browser accuracy; the server computes distance and assigns `status`.
   - *Rationale*: Prevents client-side script inspection or DOM manipulation from faking a `VERIFIED` status.

5. **Two-Window Sliding HMAC Verification**:
   - The token validator accepts dynamic tokens generated for time window $t$ (current 20s slice) and $t-1$ (previous 20s slice).
   - *Rationale*: Accommodates network latency and camera focus delay without falsely rejecting an attendee who scanned right as the counter rolled over, while still strictly rejecting older screenshots.

6. **Server-Sent Events (SSE) over WebSockets**:
   - Utilized unidirectional SSE (`text/event-stream`) for real-time organizer telemetry instead of bi-directional WebSockets.
   - *Rationale*: SSE uses standard HTTP, automatically handles reconnections, has lower server memory overhead, works seamlessly across HTTP/2 proxies, and perfectly models the unidirectional nature of check-in events.

7. **SQLite Write-Ahead Logging (WAL) Mode**:
   - Initialized database connection with `PRAGMA journal_mode = WAL;`.
   - *Rationale*: Allows concurrent read transactions to execute without blocking write transactions during high-frequency check-in surges.

---

## 🎓 Concepts Learned

1. **Spherical Geodesy via the Haversine Formula**:
   - Realized that planar Euclidean distance ($d = \sqrt{\Delta x^2 + \Delta y^2}$) introduces significant distortion over GPS coordinates.
   - Formulated the spherical distance calculation:
     $$\Delta\sigma = 2 \arcsin \left( \sqrt{\sin^2\left(\frac{\Delta\phi}{2}\right) + \cos\phi_1 \cos\phi_2 \sin^2\left(\frac{\Delta\lambda}{2}\right)} \right)$$
     $$d = R \cdot \Delta\sigma \quad (\text{where } R = 6,371,000\text{ m})$$

2. **Native OAuth 2.0 Protocol Flow Without SDKs**:
   - Mastered the multi-stage OAuth 2.0 Authorization Code Grant: building redirection URIs with `scope=openid email profile`, receiving redirect callbacks, performing backend-to-backend authorization code exchange via `https://oauth2.googleapis.com/token`, and fetching profile info from Google's UserInfo endpoint.

3. **Cryptographic Token Sliding Windows**:
   - Learned how TOTP algorithms (RFC 6238) discretize Unix epoch timestamps into time slices ($\lfloor \text{now} / T \rfloor$) and hash them with a shared secret key via HMAC-SHA256 to create rotating proof-of-presence tokens.

4. **Streaming HTTP and Server-Sent Events**:
   - Managed persistent HTTP connections without closing the response stream (`Transfer-Encoding: chunked`), writing structured message frames (`event: ...\ndata: ...\n\n`), and implementing connection keep-alive heartbeats.

---

## 🌐 API Reference

### Authentication Endpoints
| Method | Endpoint | Description | Auth Required |
|---|---|---|:---:|
| `POST` | `/api/auth/login` | Authenticate organizer with password & return JWT | No |
| `POST` | `/api/auth/register` | Register new participant or organizer account | No |
| `GET` | `/api/auth/me` | Retrieve authenticated user profile from JWT Bearer | Yes |
| `GET` | `/api/auth/google/config` | Check if Google OAuth Client ID is configured | No |
| `GET` | `/api/auth/google/login` | Redirect user to `accounts.google.com` OAuth consent | No |
| `GET` | `/api/auth/google/callback` | Handle OAuth 2.0 callback and issue session JWT | No |

### Event Management Endpoints
| Method | Endpoint | Description | Auth Required |
|---|---|---|:---:|
| `GET` | `/api/events` | List all upcoming events with attendance statistics | No |
| `POST` | `/api/events` | Create a new event with geofence and whitelist settings | Yes (Organizer) |
| `GET` | `/api/events/:id` | Get details for a specific event | No |
| `PUT` | `/api/events/:id` | Update event parameters (title, venue, radius, pin) | Yes (Organizer) |
| `DELETE` | `/api/events/:id` | Delete event and associated attendance records | Yes (Organizer) |
| `GET` | `/api/events/search?q=...`| Natural language search across upcoming events | No |

### Check-in, Passes & Whitelist Endpoints
| Method | Endpoint | Description | Auth Required |
|---|---|---|:---:|
| `GET` | `/api/events/:id/qr-token` | Get active rotating dynamic QR token (20s window) | No |
| `GET` | `/api/events/:id/my-pass` | Verify Google account whitelist and return pass QR | Yes (Google User) |
| `POST` | `/api/events/:id/whitelist` | Update authorized attendee Gmail list for an event | Yes (Organizer) |
| `GET` | `/api/events/:id/whitelist` | Retrieve current whitelisted attendee Gmails | No |
| `POST` | `/api/check-in` | Submit attendance check-in (validates QR + GPS) | Yes (when whitelisted) |

### Telemetry, Analytics & Reporting Endpoints
| Method | Endpoint | Description | Auth Required |
|---|---|---|:---:|
| `GET` | `/api/events/:id/live-stream`| Server-Sent Events (SSE) real-time check-in stream | No |
| `GET` | `/api/events/:id/stats` | Aggregated metrics, velocity & distance breakdown | No |
| `GET` | `/api/events/:id/attendees` | Retrieve check-in attendee list with filter params | No |
| `PATCH`| `/api/attendees/:id` | Manually override attendee status with audit log | Yes (Organizer) |
| `GET` | `/api/events/:id/export/csv` | Download attendance records in RFC 4180 CSV format | No |
| `GET` | `/api/events/:id/ai-insights` | AI turnout forecast, punctuality score & alerts | No |
| `POST` | `/api/ai/generate-description` | Synthesize structured event description and radius | No |
| `GET` | `/api/ai/status` | Check local Ollama daemon status & active model | No |
| `POST` | `/api/ai/config` | Configure Ollama model name & host endpoint | No |
| `POST` | `/api/ai/chat` | Interactive contextual Qwen AI event assistant | No |
| `POST` | `/api/ai/search-events` | Semantic natural-language event search via Qwen 2.5 3B | No |
| `POST` | `/api/ai/recommendations` | Personalized event recommendations with Match % & rationale | No |

---

## 🚀 Setup & Running Instructions

### Prerequisites
- **Node.js**: `v22.0.0` or higher (Node 25 recommended for native SQLite `DatabaseSync`).
- **Web Browser**: Modern browser with JavaScript enabled (Chrome, Firefox, Safari, Edge).

### 1. Clone & Navigate to Repository
```bash
git clone https://github.com/nandhakishoreramanan/geoattend.git
cd geoattend
```

### 2. Configure Environment Variables
Copy the sample environment file:
```bash
cp .env.example .env
```
Edit `.env` (optional for Google OAuth 2.0):
```ini
PORT=3000

# Google Cloud OAuth 2.0 Credentials (Optional - app runs fully out of the box)
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_client_secret
```

### 3. Run Automated Tests
```bash
npm test
# or: node tests/api.test.js
```
*Executes all 35 integration tests validating Haversine math, sliding HMAC windows, Google OAuth redirects, geofenced check-in, and CSV downloads.*

### 4. Start the Application
```bash
npm start
# or: node server.js
```
Open your browser and navigate to:
```
http://localhost:3000
```

---

## 🗄️ Database Configuration & Schema

The application uses an embedded SQLite database (`attendance.db`) in **Write-Ahead Logging (WAL)** mode.

Tables are automatically created and seeded on initial launch:
- **`users`**: User accounts, Google profile identities, and salted password hashes.
- **`events`**: Event titles, coordinates (`latitude`, `longitude`), `radius_meters`, `secret_key`, and `allowed_emails`.
- **`attendees`**: Check-in records, GPS coordinates, computed `distance_meters`, verification `status`, and sha256 receipt hashes.
- **`audit_logs`**: System audit trail logging all event creations, status overrides, and check-in attempts.

---

## 🚢 Deployment Guide

### Deploying to Vercel (Live Production)
- **Live Production URL**: [https://geoattend-live.vercel.app](https://geoattend-live.vercel.app) *(or [https://geoattend-inky.vercel.app](https://geoattend-inky.vercel.app))*

1. Deploy directly with the Vercel CLI:
   ```bash
   npx vercel --prod
   ```
2. The project includes pre-configured `vercel.json` running `server.js` natively on Node 22, featuring automatic `/tmp` SQLite writable database migration and edge asset delivery for the single-page frontend.

### Deploying to Render (Free Cloud Hosting)
1. Push this repository to your GitHub account.
2. Sign in to [Render](https://render.com/) and click **New + &rarr; Web Service**.
3. Select your repository.
4. Render automatically detects `render.yaml` or you can specify:
   - **Environment**: `Node`
   - **Build Command**: *(leave empty)*
   - **Start Command**: `node server.js`
   - **Plan**: `Free`
5. Add Environment Variables:
   - `PORT`: `3000`
   - `GOOGLE_CLIENT_ID`: *(Your Google Cloud Client ID)*
   - `GOOGLE_CLIENT_SECRET`: *(Your Google Cloud Client Secret)*
6. Click **Deploy Web Service**. Render provides a live public HTTPS URL!

### Deploying with Docker
```bash
docker build -t geoattend .
docker run -p 3000:3000 geoattend
```

---

## 🧪 Automated Testing Suite (41/41 Passing)

The project includes an end-to-end automated testing suite with **100% test pass rate (41/41 tests passing)**:

```text
=== STARTING TEST SUITE: Geo-Tagged Attendance System ===

[1/6] Testing Haversine & Geofence Verification...
  ✓ calculateDistance should return 0 for identical coordinates
  ✓ calculateDistance accurately computes ~50-80m distance
  ✓ verifyGeofence flags within boundary and out of boundary correctly

[2/6] Testing Anti-Proxy QR Token Generation & Validation...
  ✓ generateDynamicToken produces time-sliced HMAC token
  ✓ validateToken accepts fresh token matching event
  ✓ validateToken rejects tampered or expired token

[3/6] Testing JWT Authentication & Password Hashing...
  ✓ hashPassword and verifyPassword work correctly
  ✓ POST /api/auth/login authenticates organizer and returns JWT
  ✓ POST /api/auth/login rejects invalid credentials
  ✓ GET /api/auth/me returns authenticated user with valid JWT
  ✓ POST /api/auth/google authenticates Google user and assigns JWT
  ✓ GET /api/auth/google/config returns OAuth configuration status
  ✓ GET /api/auth/google/login redirects to #google_error when client_id is missing
  ✓ POST /api/auth/google/config updates client_id and login redirects to accounts.google.com

[4/6] Testing Server REST Endpoints & Geofenced Check-in...
  ✓ GET /api/events returns event list
  ✓ POST /api/events creates a new event with geofence settings
  ✓ GET /api/events/:id/qr-token returns dynamic rotating token
  ✓ POST /api/check-in VERIFIED when attendee is inside geofence
  ✓ POST /api/check-in OUT_OF_BOUNDS when attendee is outside geofence
  ✓ POST /api/check-in recognizes duplicate registration
  ✓ POST /api/events/:id/whitelist updates authorized Gmails
  ✓ GET /api/events/:id/my-pass returns personal QR entry pass for whitelisted Google user
  ✓ GET /api/events/:id/my-pass denies pass without verified Google token (401)
  ✓ GET /api/events/:id/my-pass denies pass for non-whitelisted Google email (403)
  ✓ POST /api/check-in rejects check-in when not authenticated with Google (403)
  ✓ POST /api/check-in rejects unwhitelisted attendee when whitelist is enabled (403)
  ✓ POST /api/check-in accepts personal pass token for whitelisted attendee

[5/6] Testing Real-Time Statistics, AI Insights & CSV Export...
  ✓ GET /api/events/:id/stats aggregates live metrics
  ✓ GET /api/events/:id/ai-insights returns AI analytics & forecast
  ✓ POST /api/ai/generate-description generates smart event content
  ✓ GET /api/ai/status returns Ollama configuration and status
  ✓ POST /api/ai/config updates local Ollama model configuration
  ✓ POST /api/ai/chat returns intelligent contextual attendance answer
  ✓ POST /api/ai/search-events searches events semantically
  ✓ POST /api/ai/recommendations generates personalized recommendations for attendees
  ✓ POST /api/events creates an event with category and formatted schedule date/time
  ✓ GET /api/events/:id/export/csv exports required columns (Name, Registration ID, Email, Timestamp)

[6/6] Testing Frontend Single Page Application & Static Assets...
  ✓ GET / serves index.html single-page application shell
  ✓ GET /css/style.css serves valid stylesheet
  ✓ GET /vendor/jsqr.min.js serves valid QR decoder engine
  ✓ GET /js/qr-scanner.js serves robust scanner with dynamic engine fallback

======================================================
  TEST RESULTS: 41 PASSED, 0 FAILED
======================================================
```

---

## 📹 Demo Video Walkthrough

A structured demonstration walkthrough for evaluators:

1. **System Introduction & Google Sign-In**:
   - Click **"Sign in with Google"** &rarr; redirects to `accounts.google.com`.
   - Sign in with verified Google account (`nandhakishore.hi@gmail.com`).
   - Observe the locked `readonly` email field with verified identity badge.
2. **Organizer Control & Event QR Projection**:
   - Open **Organizer Portal**.
   - Show event-specific QR code projection with venue geofence perimeter.
   - Click **Presenter Mode** to show full-screen projector view.
   - Demonstrate the **Whitelist Manager** modal adding authorized attendee Gmails.
3. **3-Pillar Attendee Verification (Verified vs Breach)**:
   - Switch to **Attendee Portal**.
   - Scan event QR code with live camera or upload QR image &rarr; Pillars turn green.
   - Submit check-in inside venue boundary &rarr; celebrate confetti, green `VERIFIED` pass, and cryptographic receipt.
   - Attempt check-in with an unauthorized Google email &rarr; show immediate `FLAGGED` security breach quarantine card.
4. **Real-time SSE Telemetry, Breach Counting & CSV Export**:
   - Switch back to Organizer Portal: observe live **Breach** counter incrementing and **Pass Rate** adjusting.
   - Review AI Attendance Forecast and anomaly alerts.
   - Filter table by **Breaches** to view quarantined attempts.
   - Click **Export CSV Report** to download the complete audit trail.

---

## 📄 License
This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
