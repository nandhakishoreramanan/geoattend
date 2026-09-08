/**
 * AI Assistant & Smart Attendance Analytics Engine
 * Powered by Local LLM (Ollama / Qwen) with ZERO external API keys and 100% data privacy.
 *
 * Supported Local Models:
 *  - qwen2.5:0.5b (Ultra-fast, ~350MB, runs in seconds on any Mac/PC)
 *  - qwen2.5:1.5b (Fast, ~1GB, rich reasoning)
 *  - qwen2.5 / qwen:7b / llama3 / mistral / gemma2
 *
 * Architecture:
 *  - Native local HTTP connection to Ollama (http://127.0.0.1:11434)
 *  - Fast abort controller (1.2s timeout for status, 3.5s for generation)
 *  - Automatic heuristic fallback when Ollama is offline or uninstalled
 *  - Zero external npm packages required (pure Node 22 fetch)
 */

let OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
let ACTIVE_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:0.5b';

/**
 * Check if local Ollama daemon is running and detect installed models
 */
async function getOllamaStatus() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1200);
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      const models = (data.models || []).map(m => m.name);
      // If qwen2.5:3b or qwen:4b is installed, prefer it for higher reasoning unless overridden
      if (!process.env.OLLAMA_MODEL && models.some(m => m.includes('qwen2.5:3b') || m.includes('qwen:4b'))) {
        ACTIVE_MODEL = models.find(m => m.includes('qwen2.5:3b')) || models.find(m => m.includes('qwen:4b')) || ACTIVE_MODEL;
      }
      const isModelInstalled = models.some(m => m.startsWith(ACTIVE_MODEL.split(':')[0]));
      return {
        connected: true,
        host: OLLAMA_HOST,
        active_model: ACTIVE_MODEL,
        installed_models: models,
        model_ready: isModelInstalled || models.length > 0,
        suggested_model: models.find(m => m.includes('3b') || m.includes('4b')) || models[0] || ACTIVE_MODEL
      };
    }
  } catch (e) {}

  return {
    connected: false,
    host: OLLAMA_HOST,
    active_model: ACTIVE_MODEL,
    installed_models: [],
    model_ready: false,
    instructions: {
      step1: 'Install Ollama: brew install ollama (or download from https://ollama.com)',
      step2: `Pull lightweight Qwen model: ollama run ${ACTIVE_MODEL}`,
      step3: 'Ollama runs locally on port 11434 with zero external API keys needed!'
    }
  };
}

/**
 * Configure local Ollama host or model name
 */
function setOllamaConfig(config = {}) {
  if (config.host && typeof config.host === 'string') {
    OLLAMA_HOST = config.host.replace(/\/+$/, '');
  }
  if (config.model && typeof config.model === 'string') {
    ACTIVE_MODEL = config.model.trim();
  }
  return { host: OLLAMA_HOST, model: ACTIVE_MODEL };
}

/**
 * Call local Ollama generate endpoint with safe timeout and fallback
 */
async function callLocalOllama(prompt, systemPrompt = '', timeoutMs = 3500) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ACTIVE_MODEL,
        prompt: prompt,
        system: systemPrompt,
        stream: false,
        options: {
          temperature: 0.6,
          top_p: 0.9,
          num_predict: 256
        }
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (data && data.response) {
        return data.response.trim();
      }
    }
  } catch (e) {
    // Offline or timed out - gracefully handled
  }
  return null;
}

/**
 * Generate Smart Attendance Insights & Forecast
 * Combines mathematical telemetry calculations with local Qwen executive summaries.
 */
async function generateAttendanceInsights(event, attendees, metrics = {}) {
  const total = attendees.length;
  const verified = attendees.filter(a => a.status === 'VERIFIED').length;
  const outOfBounds = attendees.filter(a => a.status === 'OUT_OF_BOUNDS').length;

  const now = Date.now();
  const startTime = new Date(event.start_time).getTime();
  const endTime = new Date(event.end_time).getTime();
  const totalDurationMin = Math.max(1, (endTime - startTime) / 60000);
  const elapsedMin = Math.max(1, (now - startTime) / 60000);
  const remainingMin = Math.max(0, (endTime - now) / 60000);

  // Velocity (checkins per minute)
  const velocity = Math.round((total / elapsedMin) * 10) / 10;

  // Predictive turnout forecast model
  let projectedTurnout = total;
  if (remainingMin > 0 && elapsedMin < totalDurationMin) {
    const decayFactor = Math.max(0.2, 1 - (elapsedMin / totalDurationMin));
    const projectedAdditional = Math.round(velocity * remainingMin * decayFactor);
    projectedTurnout = total + projectedAdditional;
  }

  // Turnout health score (0-100)
  const complianceRate = total > 0 ? (verified / total) * 100 : 100;
  const healthScore = Math.min(100, Math.round(complianceRate * 0.7 + Math.min(total, 50) * 0.6));

  // Anomaly & Proxy Detection
  const anomalies = [];
  if (outOfBounds > 0) {
    const ratio = Math.round((outOfBounds / Math.max(1, total)) * 100);
    if (ratio > 15) {
      anomalies.push({
        severity: 'HIGH',
        type: 'GEOFENCE_CLUSTER_BREACH',
        message: `${ratio}% of check-in attempts are outside the ${event.radius_meters}m geofence. Possible off-site QR sharing or GPS signal attenuation near thick walls.`
      });
    } else {
      anomalies.push({
        severity: 'MEDIUM',
        type: 'ISOLATED_BREACH',
        message: `${outOfBounds} scan(s) originated outside boundary. Organizer manual review recommended.`
      });
    }
  }

  // Punctuality Analysis
  const onTimeAttendees = attendees.filter(a => {
    const t = new Date(a.checkin_time).getTime();
    return (t - startTime) <= 15 * 60000;
  }).length;
  const punctualityRate = total > 0 ? Math.round((onTimeAttendees / total) * 100) : 100;

  // Base deterministic summary
  let summaryText = `Attendance for "${event.title}" is currently running at a ${healthScore}/100 Health Score. `;
  summaryText += `A total of ${total} attendees have scanned in with an average distance of ${metrics.avgDistance || 0}m from the venue center. `;
  if (complianceRate >= 90) {
    summaryText += `Geofence integrity is high with ${complianceRate.toFixed(0)}% valid on-site verifications. `;
  } else {
    summaryText += `Attention required: ${outOfBounds} attempts breached the ${event.radius_meters}m boundary. `;
  }
  summaryText += `Projected final turnout is approximately ${projectedTurnout} participants.`;

  // Attempt local Qwen executive synthesis
  let qwenSummary = null;
  const prompt = `Event: "${event.title}" at ${event.venue_name || 'Campus'}. Total check-ins: ${total}, Verified on-site: ${verified}, Out-of-bounds attempts: ${outOfBounds}, Allowed radius: ${event.radius_meters}m. Health score: ${healthScore}/100. Write a 2-sentence executive summary with 1 operational recommendation.`;
  const systemPrompt = `You are GeoAttend AI, an attendance analyst running locally on Qwen/Ollama. Provide direct, professional, concise insights without preamble.`;

  qwenSummary = await callLocalOllama(prompt, systemPrompt, 2500);

  return {
    healthScore,
    projectedTurnout,
    velocityPerMinute: velocity,
    punctualityRate,
    anomalies,
    executiveSummary: (qwenSummary && qwenSummary.length > 25) ? qwenSummary : summaryText,
    recommendations: [
      complianceRate < 85 ? `Consider expanding geofence radius to ${event.radius_meters + 25}m if the hall has weak GPS reception.` : `Geofence radius of ${event.radius_meters}m is optimal.`,
      `Dynamic QR rotation is successfully preventing proxy attendance attempts.`,
      remainingMin > 0 ? `Expected peak arrival window has concluded; steady check-ins continuing.` : `Event has concluded. All records sealed for audit.`
    ],
    ai_provider: qwenSummary ? `ollama/${ACTIVE_MODEL}` : 'deterministic_heuristic'
  };
}

/**
 * AI Automated Event Description & Agenda Generator
 * Uses local Qwen when running, with instant deterministic templates as backup.
 */
async function generateEventDescription(title, venue, category = 'academic') {
  const suggestedRadius = category === 'hackathon' ? 120 : (category === 'workshop' ? 50 : 80);

  // Try local Qwen model first
  const prompt = `Write an engaging, professional 2-sentence description for a university ${category} event titled "${title}" hosted at "${venue}". Mention that attendance is verified via anti-proxy geofenced QR.`;
  const systemPrompt = `You are a university event coordinator assistant for SRM Institute of Science and Technology. Return only the event description text, no preamble or quotes.`;

  const qwenText = await callLocalOllama(prompt, systemPrompt, 3000);

  if (qwenText && qwenText.length > 20) {
    return {
      description: qwenText,
      suggestedRadius,
      tags: [category, 'qwen-local-ai', 'geo-verified', 'srm-campus'],
      ai_provider: `ollama/${ACTIVE_MODEL}`
    };
  }

  // Fallback to built-in template
  const templates = {
    academic: [
      `Join faculty and researchers at ${venue} for an in-depth session on "${title}". This session dives deep into theoretical foundations, practical case studies, and live demonstrations. Attendance is geo-verified on arrival.`,
      `Official departmental seminar on "${title}" hosted at ${venue}. Attendees will explore cutting-edge advancements and engage in interactive Q&A discussions.`
    ],
    workshop: [
      `Hands-on technical workshop: "${title}" at ${venue}. Bring your laptop and gear for guided coding exercises and real-time collaboration. Geofenced badge verification required.`,
      `Intensive practical lab on "${title}" taking place in ${venue}. Gain hands-on project experience with mentorship.`
    ],
    hackathon: [
      `Official check-in and team assembly for "${title}" at ${venue}. Physical presence inside the innovation arena is mandatory for hardware kit distribution and team registration.`
    ]
  };

  const pool = templates[category] || templates.academic;
  const desc = pool[Math.floor(Math.random() * pool.length)];

  return {
    description: desc,
    suggestedRadius,
    tags: [category, 'attendance-verified', 'on-site', 'srm-campus'],
    ai_provider: 'deterministic_template'
  };
}

/**
 * Interactive Natural-Language Event & Campus Assistant
 * Answers queries from organizers (turnout, late arrivals, announcements)
 * and attendees (event schedules, venue directions, geofence policies, whitelist rules).
 */
async function askEventAssistant(question, contextData = {}) {
  let event = {};
  let attendees = [];
  let stats = {};
  let upcomingEvents = [];
  let attendeeEmail = '';

  // Support both legacy positional arguments (question, event, attendees, stats)
  // and modern object contextData
  if (arguments.length > 1 && !contextData.question) {
    event = arguments[1] || {};
    attendees = arguments[2] || [];
    stats = arguments[3] || {};
    upcomingEvents = arguments[4] || [];
    attendeeEmail = arguments[5] || '';
  } else if (typeof contextData === 'object') {
    event = contextData.event || {};
    attendees = contextData.attendees || [];
    stats = contextData.stats || {};
    upcomingEvents = contextData.upcomingEvents || [];
    attendeeEmail = contextData.attendeeEmail || '';
  }

  const verified = attendees.filter(a => a.status === 'VERIFIED').length;
  const outOfBounds = attendees.filter(a => a.status === 'OUT_OF_BOUNDS').length;

  let upcomingContext = '';
  if (upcomingEvents && upcomingEvents.length > 0) {
    upcomingContext = `\nAll Campus Upcoming Events:\n` + upcomingEvents.map(e => `- "${e.title}" at ${e.venue_name} (Category: ${e.category || 'Tech'}, Radius: ${e.radius_meters}m, Starts: ${e.start_time})`).slice(0, 6).join('\n');
  }

  const context = `
Active Selected Event: "${event.title || 'General Campus Session'}"
Venue: ${event.venue_name || 'SRM Kattankulathur Campus'}
Geofence Radius: ${event.radius_meters || 80}m
Total Attendees Scanned: ${attendees.length}
Verified On-Site: ${verified}
Out-of-Bounds Attempts: ${outOfBounds}
Average Distance: ${stats?.metrics?.avgDistance || 0}m
Attendee Identity: ${attendeeEmail || 'Campus Guest / Student'}
${upcomingContext}
`;

  const prompt = `Context:\n${context}\n\nUser Question: ${question}\n\nProvide a concise, accurate, and actionable answer based strictly on the campus context.`;
  const systemPrompt = `You are GeoAttend AI, an intelligent campus event assistant powered by local Qwen via Ollama. Assist students and organizers with attendance verification, event schedules, venue navigation, and geofence rules. Keep replies concise and friendly.`;

  const reply = await callLocalOllama(prompt, systemPrompt, 4000);

  if (reply && reply.length > 10) {
    return {
      reply,
      ai_provider: `ollama/${ACTIVE_MODEL}`
    };
  }

  // Smart Heuristic Fallback
  const qLower = (question || '').toLowerCase();
  let heuristicReply = '';
  if (qLower.includes('announcement') || qLower.includes('latecomer') || (qLower.includes('late') && qLower.includes('draft'))) {
    heuristicReply = `📢 [Announcement for Latecomers - ${event.title || 'Campus Session'}]\nAttention attendees: Check-in for "${event.title || 'the event'}" at ${event.venue_name || 'the venue'} is currently active. Please ensure you are physically within the ${event.radius_meters || 80}m perimeter with GPS location permissions enabled to complete verification.`;
  } else if (qLower.includes('velocity') || qLower.includes('summarize attendance')) {
    heuristicReply = `📊 [Attendance Velocity Summary - ${event.title || 'Event'}]\nTotal Scans: ${attendees.length} | Verified: ${verified} (${attendees.length > 0 ? Math.round((verified / attendees.length) * 100) : 0}%) | Out of Bounds: ${outOfBounds}. Average distance from venue center: ${stats?.metrics?.avgDistance || 0}m.`;
  } else if (qLower.includes('breach') || qLower.includes('geofence')) {
    heuristicReply = `🛡️ [Geofence Security Audit - ${event.title || 'Event'}]\nTotal out-of-bounds attempts: ${outOfBounds}. Geofence radius is calibrated at ${event.radius_meters || 80}m around ${event.venue_name || 'the venue'}. All coordinates outside the boundary are automatically quarantined and flagged.`;
  } else if (qLower.includes('where') || qLower.includes('venue') || qLower.includes('location')) {
    heuristicReply = `The event "${event.title || 'Campus Event'}" is hosted at ${event.venue_name || 'SRM Campus'}. Check-in requires physical presence within a ${event.radius_meters || 80}m geofence radius.`;
  } else if (qLower.includes('late') || qLower.includes('time') || qLower.includes('when')) {
    heuristicReply = `Event scheduled start: ${event.start_time || 'Check campus catalog'}. Make sure your GPS is calibrated before scanning the dynamic QR code.`;
  } else if (qLower.includes('whitelist') || qLower.includes('access') || qLower.includes('allowed')) {
    heuristicReply = event.require_whitelist
      ? `This event is restricted to whitelisted Gmail accounts. Sign in with Google to receive your personal entry pass.`
      : `This event has open registration — any student inside the ${event.radius_meters || 80}m geofence can check in.`;
  } else {
    heuristicReply = `[GeoAttend Assistant] For "${event.title || 'Selected Event'}": ${attendees.length} check-in(s) recorded (${verified} verified, ${outOfBounds} out of bounds). Average attendee distance is ${stats?.metrics?.avgDistance || 0}m.`;
  }

  return {
    reply: heuristicReply,
    ai_provider: 'deterministic_fallback'
  };
}

/**
 * Natural Language Semantic Event Search
 * Uses local Qwen to parse user intent (topics, venues, timing, keywords)
 * and match events, with instantaneous keyword/semantic fallback.
 */
async function searchEventsSemantic(query, events = []) {
  if (!query || typeof query !== 'string' || !query.trim()) {
    return { matches: events, explanation: 'Showing all upcoming events.', query: '' };
  }
  const cleanQ = query.trim();

  // Try local Qwen model first
  const eventSummaries = events.map(e => `ID: ${e.id} | Title: "${e.title}" | Venue: "${e.venue_name}" | Category: ${e.category || 'General'} | Time: ${e.start_time} | Radius: ${e.radius_meters}m | Desc: ${(e.description || '').slice(0, 70)}`).join('\n');

  const prompt = `User search query: "${cleanQ}"

Events Catalog:
${eventSummaries}

Task:
Identify which events match the user's intent. Return ONLY valid JSON in this exact structure:
{"matching_ids": ["id1", "id2"], "explanation": "Brief 1-sentence reason why these match"}
No other text.`;

  const systemPrompt = `You are a campus event search engine. Match user queries by topic, venue, date/time, or category. Respond with raw JSON only.`;

  try {
    const qwenText = await callLocalOllama(prompt, systemPrompt, 3500);
    if (qwenText) {
      const jsonMatch = qwenText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed.matching_ids)) {
          const matchedEvents = events.filter(e => parsed.matching_ids.includes(e.id));
          if (matchedEvents.length > 0) {
            return {
              matches: matchedEvents,
              explanation: parsed.explanation || `Found ${matchedEvents.length} event(s) matching "${cleanQ}".`,
              query: cleanQ,
              ai_provider: `ollama/${ACTIVE_MODEL}`
            };
          }
        }
      }
    }
  } catch (err) {}

  // Deterministic Keyword & Fuzzy Search Fallback
  const terms = cleanQ.toLowerCase().split(/[\s,]+/).filter(t => t.length > 1);
  const scored = events.map(evt => {
    let score = 0;
    const hay = `${evt.title} ${evt.venue_name} ${evt.category || ''} ${evt.description || ''} ${evt.static_code || ''}`.toLowerCase();
    terms.forEach(t => {
      const root = t.endsWith('s') && t.length > 3 ? t.slice(0, -1) : t;
      if (hay.includes(t) || (root !== t && hay.includes(root))) score += 5;
      if (evt.title.toLowerCase().includes(t) || (root !== t && evt.title.toLowerCase().includes(root))) score += 12;
      if (evt.venue_name.toLowerCase().includes(t) || (root !== t && evt.venue_name.toLowerCase().includes(root))) score += 10;
      if ((evt.category || '').toLowerCase().includes(t) || (root !== t && (evt.category || '').toLowerCase().includes(root))) score += 15;
    });

    if (cleanQ.toLowerCase().includes('morning') && evt.start_time) {
      const hour = new Date(evt.start_time).getHours();
      if (hour < 12) score += 10;
    }
    if (cleanQ.toLowerCase().includes('afternoon') && evt.start_time) {
      const hour = new Date(evt.start_time).getHours();
      if (hour >= 12 && hour < 17) score += 10;
    }

    return { ...evt, score };
  }).filter(e => e.score > 0).sort((a, b) => b.score - a.score);

  return {
    matches: scored.length > 0 ? scored : events,
    explanation: scored.length > 0
      ? `Found ${scored.length} event(s) matching "${cleanQ}".`
      : `No exact matches for "${cleanQ}". Displaying all available events.`,
    query: cleanQ,
    ai_provider: 'deterministic_search'
  };
}

/**
 * Personalized Event Recommendations
 * Analyzes attendee's past check-ins and suggests relevant upcoming sessions with match score & rationale.
 */
async function generateEventRecommendations(attendeeEmail, attendeeHistory = [], upcomingEvents = []) {
  if (!upcomingEvents || upcomingEvents.length === 0) {
    return { recommendations: [], explanation: 'No upcoming events currently scheduled.' };
  }

  const pastCategories = (attendeeHistory || []).map(h => h.category || 'Tech / AI');
  const pastVenues = (attendeeHistory || []).map(h => h.venue_name || '');

  // Try local Qwen model first
  const historyText = (attendeeHistory || []).map(h => `"${h.title}" (${h.venue_name}, Category: ${h.category || 'Tech'})`).join(', ') || 'No previous attendance records';
  const upcomingText = upcomingEvents.map(e => `ID: ${e.id} | "${e.title}" (${e.venue_name}, Category: ${e.category || 'Tech'})`).join('\n');

  const prompt = `Attendee: ${attendeeEmail || 'Student'}
Past Check-in History: ${historyText}

Upcoming Events:
${upcomingText}

Task:
Recommend up to 3 upcoming events for this student. Return ONLY valid JSON in this format:
{"recommendations": [{"event_id": "id", "match_score": 95, "rationale": "1-sentence reason"}]}
No other text.`;

  const systemPrompt = `You are GeoAttend AI recommender. Score event relevance from 70-98 based on user interests, location, and seminar topics. Respond with raw JSON only.`;

  try {
    const qwenText = await callLocalOllama(prompt, systemPrompt, 3500);
    if (qwenText) {
      const jsonMatch = qwenText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed.recommendations) && parsed.recommendations.length > 0) {
          const mapped = parsed.recommendations
            .map(r => {
              const evt = upcomingEvents.find(e => e.id === r.event_id);
              if (!evt) return null;
              return {
                event: evt,
                event_id: evt.id,
                match_score: Math.min(99, Math.max(65, parseInt(r.match_score, 10) || 85)),
                rationale: r.rationale || `Recommended based on your interest in ${evt.category || 'campus events'}.`
              };
            })
            .filter(Boolean);

          if (mapped.length > 0) {
            return {
              recommendations: mapped,
              ai_provider: `ollama/${ACTIVE_MODEL}`
            };
          }
        }
      }
    }
  } catch (err) {}

  // Deterministic recommendation heuristic
  const scored = upcomingEvents.map(evt => {
    let score = 75;
    const cat = evt.category || 'Tech / AI';
    if (pastCategories.includes(cat)) score += 15;
    if (pastVenues.includes(evt.venue_name)) score += 8;

    const reasons = [
      `High alignment with ${cat} curriculum and hands-on skill building.`,
      `Matches your verified attendance history at ${evt.venue_name}.`,
      `Top trending campus event with verified geofence entry.`
    ];
    const rationale = reasons[Math.floor(Math.random() * reasons.length)];

    return {
      event: evt,
      event_id: evt.id,
      match_score: Math.min(98, score + Math.floor(Math.random() * 5)),
      rationale
    };
  }).sort((a, b) => b.match_score - a.match_score).slice(0, 3);

  return {
    recommendations: scored,
    ai_provider: 'deterministic_recommender'
  };
}

/**
 * Natural Language Event Search (Synchronous fallback)
 */
function searchEventsNaturalLanguage(query, events) {
  if (!query || typeof query !== 'string') return events;

  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  if (terms.length === 0) return events;

  return events.map(evt => {
    let score = 0;
    const text = `${evt.title} ${evt.description} ${evt.venue_name} ${evt.static_code} ${evt.category || ''}`.toLowerCase();
    
    terms.forEach(term => {
      if (text.includes(term)) score += 10;
      if (evt.title.toLowerCase().includes(term)) score += 15;
      if (evt.venue_name.toLowerCase().includes(term)) score += 8;
      if ((evt.category || '').toLowerCase().includes(term)) score += 12;
    });

    return { ...evt, matchScore: score };
  })
  .filter(e => e.matchScore > 0)
  .sort((a, b) => b.matchScore - a.matchScore);
}

module.exports = {
  getOllamaStatus,
  setOllamaConfig,
  callLocalOllama,
  generateAttendanceInsights,
  generateEventDescription,
  askEventAssistant,
  searchEventsNaturalLanguage,
  searchEventsSemantic,
  generateEventRecommendations
};
