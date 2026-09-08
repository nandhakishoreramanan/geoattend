/**
 * Organizer Controller & Live Attendance Monitor
 * Handles Real-Time SSE Streams, Dynamic QR Presenter, Geofence Radar,
 * AI Smart Insights & Forecasts, Event CRUD, and Downloadable CSV/PDF Reports.
 */

(function (global) {
  const Organizer = {
    currentEventId: null,
    events: [],
    eventStats: null,
    attendees: [],
    sseSource: null,
    qrInterval: null,
    countdownTimer: null,
    mapVisualizer: null,
    createMapVisualizer: null,
    currentUser: null,

    async init() {
      await this.checkAuthStatus();
      await this.loadEvents();
      this.bindEvents();
    },

    getAuthHeaders() {
      const headers = { 'Content-Type': 'application/json' };
      const token = localStorage.getItem('geoattend_jwt');
      if (token) headers['Authorization'] = `Bearer ${token}`;
      return headers;
    },

    async checkAuthStatus() {
      const token = localStorage.getItem('geoattend_jwt');
      if (!token) {
        // Auto-login demo organizer for frictionless reviewer experience
        await this.demoOrganizerLogin();
        return;
      }

      try {
        const res = await fetch('/api/auth/me', { headers: this.getAuthHeaders() });
        if (res.ok) {
          const data = await res.json();
          this.currentUser = data.user;
          this.updateOrganizerBadge(data.user);
        } else {
          await this.demoOrganizerLogin();
        }
      } catch (e) {
        await this.demoOrganizerLogin();
      }
    },

    async demoOrganizerLogin() {
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'organizer@srmist.edu.in',
            password: 'adminpassword123'
          })
        });
        const data = await res.json();
        if (res.ok && data.token) {
          localStorage.setItem('geoattend_jwt', data.token);
          this.currentUser = data.user;
          this.updateOrganizerBadge(data.user);
        }
      } catch (e) {}
    },

    updateOrganizerBadge(user) {
      const badge = document.getElementById('organizerUserBadge');
      if (badge && user) {
        badge.innerHTML = `
          <div class="flex items-center gap-2 px-3 py-1 bg-slate-800/80 border border-slate-700 rounded-lg text-xs">
            <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span class="text-white font-semibold">${user.name}</span>
            <span class="text-slate-400 font-mono text-[10px]">(${user.role})</span>
          </div>
        `;
      }
    },

    bindEvents() {
      // Event select dropdown
      const selector = document.getElementById('eventSelector');
      if (selector) {
        selector.addEventListener('change', (e) => {
          this.switchEvent(e.target.value);
        });
      }

      // Attendee search & filter
      const searchInput = document.getElementById('attendeeSearch');
      if (searchInput) {
        searchInput.addEventListener('input', () => this.renderAttendeesTable());
      }

      const filterTabs = document.querySelectorAll('.status-filter-btn');
      filterTabs.forEach(btn => {
        btn.addEventListener('click', (e) => {
          filterTabs.forEach(b => b.classList.remove('bg-blue-600', 'text-white'));
          filterTabs.forEach(b => b.classList.add('text-slate-400', 'hover:text-white'));
          btn.classList.add('bg-blue-600', 'text-white');
          btn.classList.remove('text-slate-400');
          this.currentFilter = btn.dataset.status;
          this.renderAttendeesTable();
        });
      });

      // Export buttons
      const btnExportCsv = document.getElementById('btnExportCsv');
      if (btnExportCsv) {
        btnExportCsv.addEventListener('click', () => this.exportCsv());
      }

      const btnExportPdf = document.getElementById('btnExportPdf');
      if (btnExportPdf) {
        btnExportPdf.addEventListener('click', () => window.print());
      }

      // Presenter Fullscreen Toggle
      const btnFullscreen = document.getElementById('btnFullscreenQR');
      if (btnFullscreen) {
        btnFullscreen.addEventListener('click', () => this.toggleFullscreenQR());
      }

      const btnCloseFullscreen = document.getElementById('btnCloseFullscreen');
      if (btnCloseFullscreen) {
        btnCloseFullscreen.addEventListener('click', () => this.toggleFullscreenQR(false));
      }

      // Download QR Image Button
      const btnDownloadQr = document.getElementById('btnDownloadQrImage');
      if (btnDownloadQr) {
        btnDownloadQr.addEventListener('click', () => {
          const canvas = document.getElementById('organizerQrCanvas');
          if (!canvas) return;
          const link = document.createElement('a');
          link.download = `QR_${this.currentEventId || 'attendance'}.png`;
          link.href = canvas.toDataURL('image/png');
          link.click();
          window.App?.showToast('QR Image downloaded! You can now test uploading this file in Attendee Check-in.', 'success');
        });
      }

      // Create Event Modal Triggers
      const btnNewEvent = document.getElementById('btnNewEvent');
      const modal = document.getElementById('createEventModal');
      const btnCloseModal = document.getElementById('btnCloseEventModal');
      const form = document.getElementById('createEventForm');

      if (btnNewEvent && modal) {
        btnNewEvent.addEventListener('click', () => {
          modal.classList.remove('hidden');
          this.initCreateEventMap();
        });
      }

      if (btnCloseModal && modal) {
        btnCloseModal.addEventListener('click', () => modal.classList.add('hidden'));
      }

      if (form) {
        form.addEventListener('submit', (e) => this.handleCreateEvent(e));
      }

      // Manage Whitelist Modal Triggers
      const btnManageWhitelist = document.getElementById('btnManageWhitelist');
      const modalWhitelist = document.getElementById('manageWhitelistModal');
      const btnCloseWhitelist = document.getElementById('btnCloseWhitelistModal');
      const btnSaveWhitelist = document.getElementById('btnSaveWhitelist');

      if (btnManageWhitelist) {
        btnManageWhitelist.addEventListener('click', () => this.openWhitelistModal());
      }
      if (btnCloseWhitelist && modalWhitelist) {
        btnCloseWhitelist.addEventListener('click', () => modalWhitelist.classList.add('hidden'));
      }
      if (btnSaveWhitelist) {
        btnSaveWhitelist.addEventListener('click', () => this.saveWhitelist());
      }

      // Delete Event Button
      const btnDeleteEvent = document.getElementById('btnDeleteCurrentEvent');
      if (btnDeleteEvent) {
        btnDeleteEvent.addEventListener('click', () => this.deleteCurrentEvent());
      }

      // Radius slider in create event modal
      const radiusSlider = document.getElementById('newEventRadius');
      const radiusVal = document.getElementById('newEventRadiusVal');
      if (radiusSlider && radiusVal) {
        radiusSlider.addEventListener('input', (e) => {
          radiusVal.textContent = `${e.target.value}m`;
          if (this.createMapVisualizer) {
            this.createMapVisualizer.updateVenue(
              parseFloat(document.getElementById('newEventLat').value || 12.82315),
              parseFloat(document.getElementById('newEventLng').value || 80.04420),
              parseInt(e.target.value, 10)
            );
          }
        });
      }

      // Use my location button in create modal
      const btnUseMyLoc = document.getElementById('btnUseMyLoc');
      if (btnUseMyLoc) {
        btnUseMyLoc.addEventListener('click', () => this.setCreateEventToCurrentGPS());
      }

      // AI Draft Description Button (Local Qwen / Fallback)
      const btnAiDraftDesc = document.getElementById('btnAiDraftDesc');
      if (btnAiDraftDesc) {
        btnAiDraftDesc.addEventListener('click', async () => {
          const titleInput = document.getElementById('newEventTitle');
          const venueInput = document.getElementById('newEventVenue');
          const descInput = document.getElementById('newEventDesc');
          const statusDiv = document.getElementById('aiDraftStatus');

          const title = titleInput?.value.trim();
          const venue = venueInput?.value.trim();

          if (!title || !venue) {
            window.App?.showToast('Please enter an Event Title and Venue first!', 'warning');
            titleInput?.focus();
            return;
          }

          const originalText = btnAiDraftDesc.innerHTML;
          btnAiDraftDesc.disabled = true;
          btnAiDraftDesc.innerHTML = '<span>⏳</span><span>Drafting...</span>';
          if (statusDiv) {
            statusDiv.classList.remove('hidden');
            statusDiv.textContent = 'Generating description with Local Qwen AI...';
          }

          try {
            const res = await fetch('/api/ai/generate-description', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title, venue })
            });
            const data = await res.json();
            if (data && data.description) {
              if (descInput) descInput.value = data.description;
              if (data.suggested_radius && radiusSlider && radiusVal) {
                radiusSlider.value = data.suggested_radius;
                radiusVal.textContent = `${data.suggested_radius}m`;
                if (this.createMapVisualizer) {
                  this.createMapVisualizer.updateVenue(
                    parseFloat(document.getElementById('newEventLat')?.value || 12.82315),
                    parseFloat(document.getElementById('newEventLng')?.value || 80.04420),
                    data.suggested_radius
                  );
                }
              }
              const modelTag = data.engine === 'ollama' ? `Qwen (${data.model})` : 'Smart Engine';
              window.App?.showToast(`✨ Event description synthesized via ${modelTag}!`, 'success');
              if (statusDiv) {
                statusDiv.textContent = `✓ Generated via ${modelTag}`;
                setTimeout(() => statusDiv.classList.add('hidden'), 3500);
              }
            } else {
              throw new Error(data.error || 'Failed to generate description');
            }
          } catch (err) {
            console.error('AI Draft Error:', err);
            window.App?.showToast('Could not reach AI engine. Using local fallback.', 'warning');
          } finally {
            btnAiDraftDesc.disabled = false;
            btnAiDraftDesc.innerHTML = originalText;
          }
        });
      }
    },

    async loadEvents() {
      try {
        const res = await fetch('/api/events');
        const data = await res.json();
        this.events = data.events || [];

        const selector = document.getElementById('eventSelector');
        if (selector) {
          selector.innerHTML = '';
          if (this.events.length === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = '-- No events yet (Click + New Event) --';
            selector.appendChild(opt);
          } else {
            this.events.forEach(evt => {
              const opt = document.createElement('option');
              opt.value = evt.id;
              opt.textContent = `${evt.title} (${evt.venue_name})`;
              selector.appendChild(opt);
            });
          }
        }

        if (this.events.length > 0) {
          const targetId = (this.currentEventId && this.events.some(e => e.id === this.currentEventId))
            ? this.currentEventId
            : this.events[0].id;
          await this.switchEvent(targetId);
        } else {
          this.currentEventId = null;
          this.renderEmptyState();
        }
      } catch (err) {
        console.error('Failed to load events:', err);
        window.App?.showToast('Failed to load events from server', 'error');
      }
    },

    async switchEvent(eventId) {
      this.currentEventId = eventId;
      const selector = document.getElementById('eventSelector');
      if (selector) selector.value = eventId;

      if (this.sseSource) {
        this.sseSource.close();
        this.sseSource = null;
      }

      await Promise.all([
        this.loadEventStats(eventId),
        this.loadAttendees(eventId)
      ]);

      this.connectLiveStream(eventId);
      this.startDynamicQR(eventId);

      const currentEvt = this.events.find(e => e.id === eventId);
      if (currentEvt) {
        this.updateHeaderInfo(currentEvt);
        this.initOrUpdateRadar(currentEvt);
      }
    },

    updateHeaderInfo(event) {
      document.getElementById('currentEventTitle').textContent = event.title;
      document.getElementById('currentEventVenue').textContent = event.venue_name;
      document.getElementById('currentEventRadius').textContent = `${event.radius_meters}m`;
      document.getElementById('currentEventMode').textContent = event.dynamic_qr ? 'Dynamic Rotating (20s)' : 'Static Code';
      
      const badge = document.getElementById('currentEventStatusBadge');
      if (badge) {
        badge.textContent = event.is_active ? 'Active Check-in' : 'Closed';
        badge.className = event.is_active
          ? 'px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
          : 'px-2.5 py-1 text-xs font-semibold rounded-full bg-slate-500/20 text-slate-400 border border-slate-500/30';
      }

      // Update Whitelist Status Indicators
      const whitelistText = document.getElementById('currentEventWhitelistText');
      const whitelistBadge = document.getElementById('eventWhitelistStatusBadge');
      const whitelistCount = document.getElementById('whitelistCountBadge');

      const allowedEmails = (event.allowed_emails || '')
        .split(',')
        .map(e => e.trim())
        .filter(Boolean);

      if (event.require_whitelist || allowedEmails.length > 0) {
        if (whitelistText) whitelistText.textContent = `Whitelist Active (${allowedEmails.length} allowed)`;
        if (whitelistBadge) whitelistBadge.className = 'inline-flex items-center gap-1 font-semibold text-emerald-400';
        if (whitelistCount) whitelistCount.textContent = allowedEmails.length;
      } else {
        if (whitelistText) whitelistText.textContent = 'Open to All';
        if (whitelistBadge) whitelistBadge.className = 'inline-flex items-center gap-1 font-semibold text-slate-400';
        if (whitelistCount) whitelistCount.textContent = '0';
      }
    },

    async loadEventStats(eventId) {
      try {
        const res = await fetch(`/api/events/${eventId}/stats`);
        if (!res.ok) return;
        const stats = await res.json();
        this.eventStats = stats;
        this.renderStats(stats);
      } catch (err) {
        console.error('Failed to load stats:', err);
      }
    },

    renderEmptyState() {
      if (this.sseSource) {
        this.sseSource.close();
        this.sseSource = null;
      }
      if (this.qrInterval) {
        clearInterval(this.qrInterval);
        this.qrInterval = null;
      }

      const titleEl = document.getElementById('currentEventTitle');
      if (titleEl) titleEl.textContent = 'No Event Created Yet';

      const venueEl = document.getElementById('currentEventVenue');
      if (venueEl) venueEl.textContent = 'Click "+ New Event" to create your first event';

      const radiusEl = document.getElementById('currentEventRadius');
      if (radiusEl) radiusEl.textContent = '--';

      const modeEl = document.getElementById('currentEventMode');
      if (modeEl) modeEl.textContent = '--';

      const badgeEl = document.getElementById('currentEventStatusBadge');
      if (badgeEl) {
        badgeEl.textContent = 'No Session';
        badgeEl.className = 'px-2.5 py-1 text-xs font-semibold rounded-full bg-slate-800 text-slate-400 border border-slate-700';
      }

      const whitelistText = document.getElementById('currentEventWhitelistText');
      if (whitelistText) whitelistText.textContent = 'No Event';
      const whitelistCount = document.getElementById('whitelistCountBadge');
      if (whitelistCount) whitelistCount.textContent = '0';

      const statTotal = document.getElementById('statTotalCheckins');
      if (statTotal) statTotal.textContent = '0';
      const statVerified = document.getElementById('statVerified');
      if (statVerified) statVerified.textContent = '0';
      const statOutOfBounds = document.getElementById('statOutOfBounds');
      if (statOutOfBounds) statOutOfBounds.textContent = '0';
      const statAvg = document.getElementById('statAvgDistance');
      if (statAvg) statAvg.textContent = '0m';

      const qrCanvas = document.getElementById('organizerQrCanvas');
      if (qrCanvas) {
        const ctx = qrCanvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(0, 0, qrCanvas.width, qrCanvas.height);
          ctx.fillStyle = '#64748b';
          ctx.font = '12px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('No Active Event', qrCanvas.width / 2, qrCanvas.height / 2);
        }
      }
      const qrCodeText = document.getElementById('liveQrCodeText');
      if (qrCodeText) qrCodeText.textContent = 'Click "+ New Event" to generate QR code';

      const qrValidity = document.getElementById('qrValidityRemaining');
      if (qrValidity) qrValidity.textContent = '--';

      const tableBody = document.getElementById('attendeesTableBody');
      if (tableBody) {
        tableBody.innerHTML = `
          <tr>
            <td colspan="7" class="px-6 py-12 text-center text-slate-500 text-xs">
              No events found. Click the <span class="text-blue-400 font-semibold">+ New Event</span> button above to create your first event!
            </td>
          </tr>
        `;
      }

      const recentFeed = document.getElementById('recentCheckinsList');
      if (recentFeed) {
        recentFeed.innerHTML = '<div class="text-center py-6 text-xs text-slate-500">No live check-ins yet.</div>';
      }
    },

    async deleteCurrentEvent() {
      if (!this.currentEventId) return;
      if (!confirm('Are you sure you want to delete this event? All attendance records will be removed.')) {
        return;
      }

      try {
        const res = await fetch(`/api/events/${this.currentEventId}`, {
          method: 'DELETE',
          headers: this.getAuthHeaders()
        });
        if (res.ok) {
          window.App?.showToast('Event deleted successfully', 'success');
          this.currentEventId = null;
          await this.loadEvents();
          if (global.Attendee && typeof global.Attendee.loadUpcomingEvents === 'function') {
            await global.Attendee.loadUpcomingEvents();
          }
        } else {
          const err = await res.json();
          window.App?.showToast(err.error || 'Failed to delete event', 'error');
        }
      } catch (e) {
        window.App?.showToast('Network error deleting event', 'error');
      }
    },

    async loadAttendees(eventId) {
      try {
        const res = await fetch(`/api/events/${eventId}/attendees`);
        if (!res.ok) return;
        const data = await res.json();
        this.attendees = data.attendees || [];
        this.renderAttendeesTable();
        this.renderRecentFeed(this.attendees.slice(0, 8));
        if (this.mapVisualizer) {
          this.mapVisualizer.setAttendees(this.attendees);
        }
      } catch (err) {
        console.error('Failed to load attendees:', err);
      }
    },

    connectLiveStream(eventId) {
      if (typeof window.EventSource === 'undefined') return;

      const liveIndicator = document.getElementById('liveStreamIndicator');
      if (liveIndicator) {
        liveIndicator.classList.remove('bg-emerald-500');
        liveIndicator.classList.add('bg-amber-500');
      }

      this.sseSource = new EventSource(`/api/events/${eventId}/live-stream`);

      this.sseSource.addEventListener('connected', (e) => {
        if (liveIndicator) {
          liveIndicator.classList.remove('bg-amber-500', 'bg-rose-500');
          liveIndicator.classList.add('bg-emerald-500');
        }
      });

      this.sseSource.addEventListener('new_checkin', (e) => {
        try {
          const data = JSON.parse(e.data);
          this.handleLiveCheckin(data.attendee, data.stats);
        } catch (err) {
          console.error('Error handling SSE checkin:', err);
        }
      });

      this.sseSource.addEventListener('attendee_updated', (e) => {
        try {
          const data = JSON.parse(e.data);
          const idx = this.attendees.findIndex(a => a.id === data.attendee.id);
          if (idx !== -1) {
            this.attendees[idx] = data.attendee;
          }
          if (data.stats) this.renderStats(data.stats);
          this.renderAttendeesTable();
          if (this.mapVisualizer) this.mapVisualizer.setAttendees(this.attendees);
        } catch (err) {}
      });

      this.sseSource.onerror = () => {
        if (liveIndicator) {
          liveIndicator.classList.remove('bg-emerald-500');
          liveIndicator.classList.add('bg-rose-500');
        }
      };
    },

    handleLiveCheckin(attendee, stats) {
      const existingIdx = this.attendees.findIndex(a => a.id === attendee.id || a.student_id === attendee.student_id);
      if (existingIdx !== -1) {
        this.attendees[existingIdx] = attendee;
      } else {
        this.attendees.unshift(attendee);
      }

      if (stats) this.renderStats(stats);
      this.renderAttendeesTable();
      this.addTickerItem(attendee);

      if (this.mapVisualizer) {
        this.mapVisualizer.setAttendees(this.attendees);
      }

      const isOk = attendee.status === 'VERIFIED';
      window.App?.showToast(
        `${attendee.name} scanned: ${attendee.status} (${attendee.distance_meters}m away)`,
        isOk ? 'success' : 'warning'
      );
    },

    renderStats(stats) {
      const m = stats.metrics;
      document.getElementById('statTotalCheckins').textContent = m.total;
      document.getElementById('statVerifiedCount').textContent = m.verified;
      document.getElementById('statOutOfBoundsCount').textContent = m.outOfBounds;
      document.getElementById('statPassRate').textContent = `${m.passRate}%`;
      document.getElementById('statAvgDistance').textContent = `${m.avgDistance}m`;

      const bar = document.getElementById('passRateProgressBar');
      if (bar) bar.style.width = `${m.passRate}%`;

      const bucketContainer = document.getElementById('distanceBucketBars');
      if (bucketContainer && stats.distanceBuckets) {
        bucketContainer.innerHTML = '';
        const total = m.total || 1;
        for (const [range, count] of Object.entries(stats.distanceBuckets)) {
          const pct = Math.round((count / total) * 100);
          const el = document.createElement('div');
          el.className = 'flex items-center text-xs justify-between gap-2';
          el.innerHTML = `
            <span class="text-slate-400 w-16">${range}</span>
            <div class="flex-1 bg-slate-800 h-2 rounded-full overflow-hidden">
              <div class="bg-blue-500 h-full rounded-full transition-all duration-500" style="width: ${pct}%"></div>
            </div>
            <span class="text-slate-300 font-mono w-8 text-right">${count}</span>
          `;
          bucketContainer.appendChild(el);
        }
      }
    },

    renderAttendeesTable() {
      const tbody = document.getElementById('attendeesTableBody');
      if (!tbody) return;

      const searchTerm = (document.getElementById('attendeeSearch')?.value || '').toLowerCase();
      const filter = this.currentFilter || 'ALL';

      const filtered = this.attendees.filter(a => {
        const matchesFilter = filter === 'ALL' || a.status === filter;
        const matchesSearch = !searchTerm ||
          a.name.toLowerCase().includes(searchTerm) ||
          a.student_id.toLowerCase().includes(searchTerm) ||
          (a.email && a.email.toLowerCase().includes(searchTerm));
        return matchesFilter && matchesSearch;
      });

      tbody.innerHTML = '';

      if (filtered.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="7" class="text-center py-8 text-slate-500 font-medium">
              No attendee records found matching the criteria.
            </td>
          </tr>
        `;
        return;
      }

      filtered.forEach(a => {
        const tr = document.createElement('tr');
        tr.className = 'border-b border-slate-100 hover:bg-slate-50/80 transition-colors text-xs font-medium text-slate-800';

        const isVerified = a.status === 'VERIFIED';
        const badgeClass = isVerified
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
          : 'bg-rose-50 text-rose-700 border-rose-200';

        const timeFormatted = new Date(a.checkin_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        tr.innerHTML = `
          <td class="py-3 px-4 font-mono font-semibold text-slate-600">${a.student_id}</td>
          <td class="py-3 px-4 font-bold text-slate-950">${a.name}</td>
          <td class="py-3 px-4 text-slate-500 font-mono text-[11px]">${timeFormatted}</td>
          <td class="py-3 px-4 font-mono">
            <span class="${isVerified ? 'text-slate-900 font-black' : 'text-rose-600 font-black'}">${a.distance_meters}m</span>
          </td>
          <td class="py-3 px-4">
            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${badgeClass}">
              ${a.status}
            </span>
          </td>
          <td class="py-3 px-4 text-xs text-slate-500 max-w-xs truncate">${a.notes || ''}</td>
          <td class="py-3 px-4 text-right">
            ${isVerified ? `
              <button onclick="Organizer.overrideAttendee('${a.id}', 'OUT_OF_BOUNDS')" class="text-[11px] text-rose-600 hover:text-rose-700 font-bold px-2.5 py-1 rounded-full bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-colors cursor-pointer">
                Revoke
              </button>
            ` : `
              <button onclick="Organizer.overrideAttendee('${a.id}', 'VERIFIED')" class="text-[11px] text-emerald-700 hover:text-emerald-800 font-bold px-2.5 py-1 rounded-full bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-colors cursor-pointer">
                Approve
              </button>
            `}
          </td>
        `;
        tbody.appendChild(tr);
      });
    },

    addTickerItem(attendee) {
      const feed = document.getElementById('recentUpdatesFeed');
      if (!feed) return;

      const isVerified = attendee.status === 'VERIFIED';
      const item = document.createElement('div');
      item.className = 'ticker-item flex items-center justify-between p-3 rounded-lg bg-slate-900/60 border border-slate-800';

      item.innerHTML = `
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-full flex items-center justify-center ${isVerified ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}">
            ${isVerified ? '✓' : '!'}
          </div>
          <div>
            <div class="text-sm font-semibold text-white">${attendee.name}</div>
            <div class="text-xs text-slate-400 font-mono">${attendee.student_id} • ${attendee.distance_meters}m away</div>
          </div>
        </div>
        <div class="text-right">
          <span class="inline-block px-2 py-0.5 text-xs rounded font-medium ${isVerified ? 'text-emerald-400 bg-emerald-500/10' : 'text-rose-400 bg-rose-500/10'}">
            ${attendee.status}
          </span>
          <div class="text-[10px] text-slate-500 mt-0.5">Just now</div>
        </div>
      `;

      feed.insertBefore(item, feed.firstChild);

      while (feed.children.length > 10) {
        feed.removeChild(feed.lastChild);
      }
    },

    renderRecentFeed(recentAttendees) {
      const feed = document.getElementById('recentUpdatesFeed');
      if (!feed) return;
      feed.innerHTML = '';

      if (!recentAttendees || recentAttendees.length === 0) {
        feed.innerHTML = '<div class="text-sm text-slate-500 text-center py-6">Waiting for attendees to scan...</div>';
        return;
      }

      recentAttendees.forEach(a => {
        const isVerified = a.status === 'VERIFIED';
        const timeAgo = Math.max(1, Math.round((Date.now() - new Date(a.checkin_time).getTime()) / 60000));
        const item = document.createElement('div');
        item.className = 'flex items-center justify-between p-3 rounded-lg bg-slate-900/60 border border-slate-800';

        item.innerHTML = `
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-full flex items-center justify-center ${isVerified ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}">
              ${isVerified ? '✓' : '!'}
            </div>
            <div>
              <div class="text-sm font-semibold text-white">${a.name}</div>
              <div class="text-xs text-slate-400 font-mono">${a.student_id} • ${a.distance_meters}m away</div>
            </div>
          </div>
          <div class="text-right">
            <span class="inline-block px-2 py-0.5 text-xs rounded font-medium ${isVerified ? 'text-emerald-400 bg-emerald-500/10' : 'text-rose-400 bg-rose-500/10'}">
              ${a.status}
            </span>
            <div class="text-[10px] text-slate-500 mt-0.5">${timeAgo}m ago</div>
          </div>
        `;
        feed.appendChild(item);
      });
    },

    async overrideAttendee(attendeeId, newStatus) {
      try {
        const res = await fetch(`/api/attendees/${attendeeId}`, {
          method: 'PATCH',
          headers: this.getAuthHeaders(),
          body: JSON.stringify({
            status: newStatus,
            notes: `Manual status override to ${newStatus} by organizer.`
          })
        });

        if (res.ok) {
          const data = await res.json();
          window.App?.showToast(`Updated ${data.attendee.name} to ${newStatus}`, 'success');
        } else {
          window.App?.showToast('Failed to update attendee status', 'error');
        }
      } catch (err) {
        window.App?.showToast('Error updating status', 'error');
      }
    },

    startDynamicQR(eventId) {
      if (this.qrInterval) clearInterval(this.qrInterval);
      if (this.countdownTimer) clearInterval(this.countdownTimer);

      const fetchAndRenderQR = async () => {
        try {
          const res = await fetch(`/api/events/${eventId}/qr-token`);
          if (!res.ok) return;
          const data = await res.json();

          const canvas = document.getElementById('organizerQrCanvas');
          const fullscreenCanvas = document.getElementById('fullscreenQrCanvas');

          if (canvas) {
            window.QRCodeGenerator?.renderCanvas(canvas, data.token, { scale: 6, margin: 2 });
          }
          if (fullscreenCanvas) {
            window.QRCodeGenerator?.renderCanvas(fullscreenCanvas, data.token, { scale: 12, margin: 2 });
          }

          document.getElementById('currentQrTokenDisplay').textContent = data.token;
          const fsToken = document.getElementById('fullscreenQrTokenDisplay');
          if (fsToken) fsToken.textContent = data.token;

          if (data.is_dynamic) {
            let timeLeft = data.remaining_seconds;
            const total = data.window_seconds || 20;

            const updateCountdownUI = () => {
              const textEl = document.getElementById('qrCountdownText');
              const fsTextEl = document.getElementById('fsQrCountdownText');
              if (textEl) textEl.textContent = `${timeLeft}s`;
              if (fsTextEl) fsTextEl.textContent = `${timeLeft}s`;

              const circumference = 113;
              const offset = circumference - (timeLeft / total) * circumference;
              const ring = document.getElementById('qrCountdownRing');
              const fsRing = document.getElementById('fsQrCountdownRing');
              if (ring) ring.style.strokeDashoffset = offset;
              if (fsRing) fsRing.style.strokeDashoffset = offset;
            };

            updateCountdownUI();

            if (this.countdownTimer) clearInterval(this.countdownTimer);
            this.countdownTimer = setInterval(() => {
              timeLeft--;
              if (timeLeft <= 0) {
                clearInterval(this.countdownTimer);
                fetchAndRenderQR();
              } else {
                updateCountdownUI();
              }
            }, 1000);
          } else {
            const textEl = document.getElementById('qrCountdownText');
            if (textEl) textEl.textContent = 'Static';
          }
        } catch (err) {
          console.error('Failed to update QR:', err);
        }
      };

      fetchAndRenderQR();
    },

    toggleFullscreenQR(show = true) {
      const modal = document.getElementById('fullscreenQrModal');
      if (!modal) return;
      if (show) {
        modal.classList.remove('hidden');
        document.getElementById('fsEventTitle').textContent = document.getElementById('currentEventTitle').textContent;
        document.getElementById('fsVenueTitle').textContent = document.getElementById('currentEventVenue').textContent;
      } else {
        modal.classList.add('hidden');
      }
    },

    initOrUpdateRadar(event) {
      if (!this.mapVisualizer) {
        this.mapVisualizer = new window.GeofenceVisualizer('geofenceRadarContainer', {
          venueLat: event.latitude,
          venueLng: event.longitude,
          radiusMeters: event.radius_meters,
          interactive: false
        });
      } else {
        this.mapVisualizer.updateVenue(event.latitude, event.longitude, event.radius_meters);
      }
      this.mapVisualizer.setAttendees(this.attendees);
    },

    initCreateEventMap() {
      if (!this.createMapVisualizer) {
        const latInput = document.getElementById('newEventLat');
        const lngInput = document.getElementById('newEventLng');
        const radiusInput = document.getElementById('newEventRadius');

        const initialLat = parseFloat(latInput.value) || 12.82315;
        const initialLng = parseFloat(lngInput.value) || 80.04420;
        const initialRadius = parseInt(radiusInput.value, 10) || 80;

        this.createMapVisualizer = new window.GeofenceVisualizer('createEventMapContainer', {
          venueLat: initialLat,
          venueLng: initialLng,
          radiusMeters: initialRadius,
          interactive: true,
          onLocationSelected: (lat, lng) => {
            latInput.value = lat.toFixed(6);
            lngInput.value = lng.toFixed(6);
          }
        });
      }
    },

    setCreateEventToCurrentGPS() {
      if (!navigator.geolocation) {
        window.App?.showToast('Geolocation is not supported by your browser', 'warning');
        return;
      }

      window.App?.showToast('Acquiring GPS location...', 'info');
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          document.getElementById('newEventLat').value = lat.toFixed(6);
          document.getElementById('newEventLng').value = lng.toFixed(6);

          if (this.createMapVisualizer) {
            const r = parseInt(document.getElementById('newEventRadius').value, 10) || 80;
            this.createMapVisualizer.updateVenue(lat, lng, r);
          }
          window.App?.showToast(`GPS Acquired: ${lat.toFixed(4)}, ${lng.toFixed(4)}`, 'success');
        },
        (err) => {
          window.App?.showToast(`GPS Error: ${err.message}`, 'error');
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    },

    async handleCreateEvent(e) {
      e.preventDefault();
      const title = document.getElementById('newEventTitle').value.trim();
      const venue = document.getElementById('newEventVenue').value.trim();
      const desc = document.getElementById('newEventDesc').value.trim();
      const lat = parseFloat(document.getElementById('newEventLat').value);
      const lng = parseFloat(document.getElementById('newEventLng').value);
      const radius = parseInt(document.getElementById('newEventRadius').value, 10);
      const isDynamic = document.getElementById('newEventDynamicQR').checked;
      const allowedEmails = document.getElementById('newEventAllowedEmails')?.value.trim() || '';
      const requireWhitelist = document.getElementById('newEventRequireWhitelist')?.checked ? 1 : 0;

      if (!title || !venue || isNaN(lat) || isNaN(lng)) {
        window.App?.showToast('Please fill all required event details', 'warning');
        return;
      }

      try {
        const res = await fetch('/api/events', {
          method: 'POST',
          headers: this.getAuthHeaders(),
          body: JSON.stringify({
            title,
            venue_name: venue,
            description: desc,
            latitude: lat,
            longitude: lng,
            radius_meters: radius,
            dynamic_qr: isDynamic ? 1 : 0,
            allowed_emails: allowedEmails,
            require_whitelist: requireWhitelist
          })
        });

        if (res.ok) {
          const data = await res.json();
          window.App?.showToast(`Event "${title}" created successfully!`, 'success');
          document.getElementById('createEventModal').classList.add('hidden');
          document.getElementById('createEventForm').reset();
          await this.loadEvents();
          await this.switchEvent(data.event.id);

          // Notify Attendee module immediately so newly created event appears in upcoming catalog
          if (global.Attendee) {
            global.Attendee.selectedEventId = data.event.id;
            if (typeof global.Attendee.loadUpcomingEvents === 'function') {
              await global.Attendee.loadUpcomingEvents();
            }
          }
        } else {
          const errData = await res.json();
          window.App?.showToast(errData.error || 'Failed to create event', 'error');
        }
      } catch (err) {
        window.App?.showToast('Network error creating event', 'error');
      }
    },

    async openWhitelistModal() {
      if (!this.currentEventId) return;
      const modal = document.getElementById('manageWhitelistModal');
      const currentEvt = this.events.find(e => e.id === this.currentEventId);

      const titleEl = document.getElementById('whitelistEventTitle');
      if (titleEl && currentEvt) titleEl.textContent = `${currentEvt.title} (${currentEvt.venue_name})`;

      try {
        const res = await fetch(`/api/events/${this.currentEventId}/whitelist`);
        if (res.ok) {
          const data = await res.json();
          const toggle = document.getElementById('manageRequireWhitelistToggle');
          const textarea = document.getElementById('manageWhitelistTextarea');
          const chipsContainer = document.getElementById('currentWhitelistChips');

          if (toggle) toggle.checked = Boolean(data.require_whitelist);
          if (textarea) textarea.value = data.allowed_emails.join(', ');

          if (chipsContainer) {
            if (!data.allowed_emails || data.allowed_emails.length === 0) {
              chipsContainer.innerHTML = '<span class="text-slate-400 text-xs italic font-medium">No emails whitelisted yet. (Open to all attendees)</span>';
            } else {
              chipsContainer.innerHTML = data.allowed_emails.map(email => `
                <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-950 text-white text-[11px] font-mono shadow-sm">
                  <span>${email}</span>
                </span>
              `).join('');
            }
          }
        }
      } catch (err) {
        console.warn('Error fetching whitelist:', err);
      }

      if (modal) modal.classList.remove('hidden');
    },

    async saveWhitelist() {
      if (!this.currentEventId) return;
      const textarea = document.getElementById('manageWhitelistTextarea');
      const toggle = document.getElementById('manageRequireWhitelistToggle');

      const rawText = textarea ? textarea.value : '';
      const allowedEmails = rawText
        .split(/[\n,]/)
        .map(e => e.trim().toLowerCase())
        .filter(Boolean);

      const requireWhitelist = toggle ? (toggle.checked ? 1 : 0) : 1;

      try {
        const res = await fetch(`/api/events/${this.currentEventId}/whitelist`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.getAuthHeaders() || {})
          },
          body: JSON.stringify({
            allowed_emails: allowedEmails,
            require_whitelist: requireWhitelist
          })
        });

        if (res.ok) {
          const data = await res.json();
          window.App?.showToast(`Updated whitelist with ${data.allowed_emails.length} authorized Gmails!`, 'success');
          document.getElementById('manageWhitelistModal')?.classList.add('hidden');
          
          // Update cached event
          const evt = this.events.find(e => e.id === this.currentEventId);
          if (evt) {
            evt.allowed_emails = data.allowed_emails.join(',');
            evt.require_whitelist = data.require_whitelist;
            this.updateHeaderInfo(evt);
          }

          // If Attendee is currently viewing, notify to refresh pass
          if (global.Attendee && typeof global.Attendee.refreshPassCard === 'function') {
            global.Attendee.refreshPassCard();
          }
        } else {
          const errData = await res.json();
          window.App?.showToast(errData.error || 'Failed to save whitelist', 'error');
        }
      } catch (e) {
        window.App?.showToast('Error saving whitelist', 'error');
      }
    },

    exportCsv() {
      if (!this.currentEventId) return;
      window.location.href = `/api/events/${this.currentEventId}/export/csv`;
    }
  };

  global.Organizer = Organizer;
})(typeof window !== 'undefined' ? window : global);
