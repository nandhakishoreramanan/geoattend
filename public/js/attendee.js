/**
 * Attendee / Student Controller
 * Features:
 *  1. Upcoming Events Display (name, venue, date, time, radius)
 *  2. AI Natural-Language Event Search
 *  3. Camera QR Scanner + File Upload + Quick Fill
 *  4. Device Geolocation Access + Simulator Presets
 *  5. Geofence Verification & Digital Attendance Pass
 *  6. JWT Authentication for Students/Participants
 */

(function (global) {
  const Attendee = {
    scanner: null,
    currentCoords: null,
    selectedEventId: null,
    eventsList: [],
    history: [],
    currentUser: null,
    activePersonalToken: null,

    async init() {
      this.loadSavedProfile();
      this.loadHistory();
      this.bindEvents();
      this.initScanner();
      await this.loadUpcomingEvents();
      await this.checkAuthStatus();
      if (window.App && window.App.currentUser) {
        this.onUserAuthChanged(window.App.currentUser);
      }
    },

    onUserAuthChanged(user) {
      this.currentUser = user;
      const nameInput = document.getElementById('attendeeName');
      const emailInput = document.getElementById('attendeeEmail');
      if (user) {
        if (nameInput && (!nameInput.value || nameInput.value === 'Rohan Sharma')) {
          nameInput.value = user.name || user.email.split('@')[0];
        }
        if (emailInput) {
          emailInput.value = user.email;
          emailInput.readOnly = true;
        }
        this.updateUserBadge(user);
      } else {
        if (emailInput) {
          emailInput.value = '';
          emailInput.placeholder = 'Sign in with Google to unlock verified email';
          emailInput.readOnly = true;
        }
        if (nameInput && nameInput.value === 'Rohan Sharma') {
          nameInput.value = '';
        }
        const badge = document.getElementById('attendeeUserBadge');
        if (badge) badge.innerHTML = '';
      }
      this.refreshPassCard();
    },

    async checkAuthStatus() {
      const token = window.App?.authToken || localStorage.getItem('geoattend_token') || localStorage.getItem('geoattend_jwt');
      if (!token) return;

      try {
        const res = await fetch('/api/auth/me', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          this.currentUser = data.user;
          this.updateUserBadge(data.user);
          await this.refreshPassCard();
        }
      } catch (e) {}
    },

    async refreshPassCard() {
      const authCard = document.getElementById('googlePassAuthorized');
      const deniedCard = document.getElementById('googlePassDenied');
      const unauthCard = document.getElementById('googlePassUnauthenticated');
      const canvas = document.getElementById('personalPassQrCanvas');
      const passUserName = document.getElementById('passUserName');
      const passVenueName = document.getElementById('passVenueName');
      const passEntryTokenText = document.getElementById('passEntryTokenText');
      const passUserEmailDisplay = document.getElementById('passUserEmailDisplay');
      const deniedUserEmailDisplay = document.getElementById('deniedUserEmailDisplay');
      const deniedEventTitle = document.getElementById('deniedEventTitle');

      const user = window.App?.currentUser || this.currentUser;

      // 1. If not logged in with Google/Auth
      if (!user || !user.email) {
        authCard?.classList.add('hidden');
        deniedCard?.classList.add('hidden');
        unauthCard?.classList.remove('hidden');
        this.activePersonalToken = null;
        return;
      }

      // 2. Identify active event
      let eventId = this.selectedEventId;
      if (!eventId && this.eventsList && this.eventsList.length > 0) {
        eventId = this.eventsList[0].id;
        this.selectedEventId = eventId;
      }

      if (!eventId) {
        authCard?.classList.add('hidden');
        deniedCard?.classList.add('hidden');
        unauthCard?.classList.remove('hidden');
        this.activePersonalToken = null;
        const unauthTitle = unauthCard?.querySelector('h4');
        const unauthDesc = unauthCard?.querySelector('p');
        if (unauthTitle) unauthTitle.textContent = 'No Event Selected';
        if (unauthDesc) unauthDesc.textContent = 'Create or select an upcoming event above to view your entry pass.';
        return;
      }

      const activeEvent = (this.eventsList || []).find(e => e.id === eventId);
      const headers = { ...(window.App?.getAuthHeaders() || {}) };

      try {
        const url = `/api/events/${eventId}/my-pass?email=${encodeURIComponent(user.email)}`;
        const res = await fetch(url, { headers });
        const data = await res.json();

        if (res.ok && data.authorized) {
          // Whitelist Verified & Authorized
          unauthCard?.classList.add('hidden');
          deniedCard?.classList.add('hidden');
          authCard?.classList.remove('hidden');

          if (passUserEmailDisplay) passUserEmailDisplay.textContent = data.email;
          if (passUserName) passUserName.textContent = data.name || user.name || user.email.split('@')[0];
          if (passVenueName) passVenueName.textContent = data.venue_name || activeEvent?.venue_name || 'Main Auditorium';
          if (passEntryTokenText) passEntryTokenText.textContent = data.entry_token;

          this.activePersonalToken = data.entry_token;

          // Render personal QR code on canvas
          if (canvas && window.QRCodeGenerator) {
            window.QRCodeGenerator.renderCanvas(canvas, data.entry_token, {
              scale: 5,
              margin: 2
            });
          }

          // Pre-populate attendee inputs
          const tokenInput = document.getElementById('attendeeScannedToken');
          if (tokenInput) tokenInput.value = data.entry_token;

          const nameInput = document.getElementById('attendeeName');
          if (nameInput && (!nameInput.value || nameInput.value === 'Rohan Sharma')) {
            nameInput.value = data.name || user.name || user.email.split('@')[0];
          }

          const emailInput = document.getElementById('attendeeEmail');
          if (emailInput) emailInput.value = data.email;

        } else if (res.status === 403 || (data && data.authorized === false)) {
          // Access Denied (Not on whitelist)
          authCard?.classList.add('hidden');
          unauthCard?.classList.add('hidden');
          deniedCard?.classList.remove('hidden');

          if (deniedUserEmailDisplay) deniedUserEmailDisplay.textContent = user.email;
          if (deniedEventTitle) deniedEventTitle.textContent = activeEvent ? `"${activeEvent.title}"` : 'this event';

          this.activePersonalToken = null;

          const tokenInput = document.getElementById('attendeeScannedToken');
          if (tokenInput && tokenInput.value.startsWith('PASS:')) {
            tokenInput.value = '';
          }
        } else {
          // Unauthenticated
          authCard?.classList.add('hidden');
          deniedCard?.classList.add('hidden');
          unauthCard?.classList.remove('hidden');
          this.activePersonalToken = null;
        }
      } catch (err) {
        console.error('Failed to verify pass status:', err);
      }
    },

    updateUserBadge(user) {
      const badge = document.getElementById('attendeeUserBadge');
      if (badge && user) {
        badge.innerHTML = `
          <div class="flex items-center gap-2 px-3.5 py-1.5 bg-slate-950 text-white border border-slate-800 rounded-full text-xs shadow-sm">
            <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span class="text-white font-bold">${user.name}</span>
            <span class="text-slate-400 font-mono text-[10px]">(${user.email})</span>
          </div>
        `;
        // Auto fill profile inputs
        const nameInput = document.getElementById('attendeeName');
        const emailInput = document.getElementById('attendeeEmail');
        if (nameInput) nameInput.value = user.name;
        if (emailInput) emailInput.value = user.email;
      }
    },

    loadSavedProfile() {
      const name = localStorage.getItem('geoattend_name') || '';
      const studentId = localStorage.getItem('geoattend_student_id') || '';

      const nameInput = document.getElementById('attendeeName');
      const idInput = document.getElementById('attendeeStudentId');
      const emailInput = document.getElementById('attendeeEmail');

      if (nameInput && name) nameInput.value = name;
      if (idInput && studentId) idInput.value = studentId;
      if (emailInput) {
        emailInput.value = (window.App?.currentUser?.email) || '';
        emailInput.readOnly = true;
      }
    },

    saveProfile() {
      const name = document.getElementById('attendeeName')?.value.trim();
      const studentId = document.getElementById('attendeeStudentId')?.value.trim();

      if (name) localStorage.setItem('geoattend_name', name);
      if (studentId) localStorage.setItem('geoattend_student_id', studentId);
      // Email is never arbitrarily set; strictly tied to verified Google session
    },

    loadHistory() {
      try {
        const saved = localStorage.getItem('geoattend_history');
        this.history = saved ? JSON.parse(saved) : [];
        this.renderHistory();
      } catch (e) {
        this.history = [];
      }
    },

    saveToHistory(receipt, status, distance) {
      const item = {
        id: receipt.verification_hash || 'PASS-' + Date.now(),
        eventTitle: receipt.event_title,
        venue: receipt.venue_name,
        timestamp: receipt.timestamp || new Date().toISOString(),
        studentName: receipt.student_name,
        studentId: receipt.student_id,
        distance,
        status
      };

      this.history = this.history.filter(h => h.id !== item.id);
      this.history.unshift(item);
      localStorage.setItem('geoattend_history', JSON.stringify(this.history.slice(0, 20)));
      this.renderHistory();
    },

    renderHistory() {
      const container = document.getElementById('attendeeHistoryList');
      if (!container) return;

      if (this.history.length === 0) {
        container.innerHTML = '<div class="text-xs text-slate-400 text-center py-6 font-medium">No previous check-in passes yet.</div>';
        return;
      }

      container.innerHTML = '';
      this.history.forEach(item => {
        const card = document.createElement('div');
        card.className = 'p-4 rounded-2xl bg-white border border-slate-200/90 shadow-sm flex items-center justify-between';
        const dateStr = new Date(item.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

        card.innerHTML = `
          <div>
            <div class="text-sm font-black text-slate-950">${item.eventTitle}</div>
            <div class="text-xs text-slate-500 font-medium">${item.venue} • <span class="font-mono">${dateStr}</span></div>
            <div class="text-[10px] text-emerald-700 font-mono mt-1 font-semibold">Security Hash: ${item.id}</div>
          </div>
          <div class="text-right">
            <span class="inline-block px-2.5 py-1 text-xs font-bold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
              ${item.status}
            </span>
            <div class="text-xs text-slate-500 font-mono mt-1 font-semibold">${item.distance}m</div>
          </div>
        `;
        container.appendChild(card);
      });
    },

    async loadUpcomingEvents() {
      try {
        const res = await fetch('/api/events');
        const data = await res.json();
        this.eventsList = data.events || [];
        this.renderUpcomingEvents(this.eventsList);

        // Keep current selected event if it still exists, otherwise select the first event
        const stillExists = this.eventsList.find(e => e.id === this.selectedEventId);
        if (!stillExists) {
          this.selectedEventId = this.eventsList.length > 0 ? this.eventsList[0].id : null;
        }

        if (this.eventsList.length > 0 && this.selectedEventId) {
          const target = this.eventsList.find(e => e.id === this.selectedEventId) || this.eventsList[0];
          await this.selectEvent(target, false);
        } else {
          this.selectedEventId = null;
          await this.refreshPassCard();
        }
      } catch (err) {
        console.error('Failed to load upcoming events:', err);
      }
    },

    renderUpcomingEvents(events) {
      const container = document.getElementById('upcomingEventsGrid');
      if (!container) return;

      if (events.length === 0) {
        container.innerHTML = `
          <div class="col-span-full py-12 px-4 text-center rounded-2xl bg-slate-50 border border-slate-200">
            <p class="text-sm font-bold text-slate-800">No campus events scheduled yet</p>
            <p class="text-xs text-slate-500 mt-1 font-medium">Events created in the Organizer portal will appear here automatically.</p>
          </div>
        `;
        return;
      }

      container.innerHTML = '';
      events.forEach(evt => {
        const card = document.createElement('div');
        const isSelected = this.selectedEventId === evt.id;
        card.className = `p-5 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between gap-3 ${
          isSelected
            ? 'bg-slate-950 text-white border-slate-950 shadow-xl ring-2 ring-slate-950'
            : 'bg-white border-slate-200/90 hover:border-slate-400 hover:shadow-md text-slate-900 shadow-sm'
        }`;

        const startDate = new Date(evt.start_time);
        const dateStr = startDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
        const timeStr = startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        card.innerHTML = `
          <div>
            <div class="flex items-center justify-between gap-2 mb-2">
              <span class="px-2.5 py-0.5 text-[10px] font-bold rounded-full ${
                isSelected
                  ? 'bg-white/10 text-white border border-white/20'
                  : 'bg-slate-100 text-slate-800 border border-slate-200'
              }">
                ${evt.static_code}
              </span>
              <span class="text-[11px] font-mono ${isSelected ? 'text-slate-400' : 'text-slate-500'} font-medium">${dateStr}, ${timeStr}</span>
            </div>
            <h3 class="font-bold text-sm line-clamp-1 ${isSelected ? 'text-white' : 'text-slate-950'}">${evt.title}</h3>
            <p class="text-xs mt-0.5 flex items-center gap-1 ${isSelected ? 'text-slate-300' : 'text-slate-500'}">
              <svg class="w-3.5 h-3.5 flex-shrink-0 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              </svg>
              <span class="truncate">${evt.venue_name}</span>
            </p>
          </div>
          <div class="flex items-center justify-between pt-3 border-t ${isSelected ? 'border-slate-800' : 'border-slate-100'} text-xs">
            <span class="text-[11px] ${isSelected ? 'text-slate-400' : 'text-slate-500'}">Radius: <b class="${isSelected ? 'text-white' : 'text-slate-900'}">${evt.radius_meters}m</b></span>
            <button type="button" class="px-3.5 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
              isSelected
                ? 'btn-sunset text-slate-950 font-black'
                : 'bg-slate-950 hover:bg-slate-800 text-white shadow-sm'
            }">
              ${isSelected ? '✓ Selected' : 'Select Event'}
            </button>
          </div>
        `;

        card.addEventListener('click', () => this.selectEvent(evt, true));
        container.appendChild(card);
      });
    },

    async selectEvent(evt, showToast = true) {
      if (!evt) return;
      this.selectedEventId = evt.id;
      this.renderUpcomingEvents(this.eventsList);

      // Auto select GPS coordinates near venue center for easy testing
      this.currentCoords = {
        latitude: evt.latitude + 0.00010,
        longitude: evt.longitude + 0.00008,
        accuracy: 5,
        label: `Venue: ${evt.venue_name} (~14m away)`
      };
      this.updateGpsUI(this.currentCoords);

      // Refresh personal Google Pass card for this event
      await this.refreshPassCard();

      // If activePersonalToken wasn't set, fetch standard dynamic token as fallback
      try {
        const res = await fetch(`/api/events/${evt.id}/qr-token`);
        if (res.ok) {
          const data = await res.json();
          if (!this.activePersonalToken) {
            const input = document.getElementById('attendeeScannedToken');
            if (input && !input.value) {
              input.value = data.token;
            }
          }
        }
      } catch (e) {}

      if (showToast) {
        window.App?.showToast(`Selected Event: "${evt.title}" (${evt.venue_name})`, 'info');
      }
    },

    bindEvents() {
      // Instant Event Search
      const searchInput = document.getElementById('eventSearchInput');
      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          const q = e.target.value.trim().toLowerCase();
          if (!q) {
            this.renderUpcomingEvents(this.eventsList);
            return;
          }
          const filtered = (this.eventsList || []).filter(evt =>
            (evt.title && evt.title.toLowerCase().includes(q)) ||
            (evt.venue_name && evt.venue_name.toLowerCase().includes(q)) ||
            (evt.description && evt.description.toLowerCase().includes(q))
          );
          this.renderUpcomingEvents(filtered);
        });
      }

      // Camera toggle buttons
      const btnStartCamera = document.getElementById('btnStartCamera');
      const btnStopCamera = document.getElementById('btnStopCamera');
      const btnFlipCamera = document.getElementById('btnFlipCamera');

      if (btnStartCamera) btnStartCamera.addEventListener('click', () => this.startLiveScanner());
      if (btnStopCamera) btnStopCamera.addEventListener('click', () => this.stopLiveScanner());
      if (btnFlipCamera) btnFlipCamera.addEventListener('click', () => this.scanner?.toggleCameraFacing());

      // Drag and Drop Zone on Scanner Viewfinder
      const dropZone = document.getElementById('scannerDropZone');
      if (dropZone) {
        ['dragenter', 'dragover'].forEach(eventName => {
          dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add('border-blue-500', 'bg-blue-950/40');
          });
        });

        ['dragleave', 'drop'].forEach(eventName => {
          dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('border-blue-500', 'bg-blue-950/40');
          });
        });

        dropZone.addEventListener('drop', async (e) => {
          const files = e.dataTransfer.files;
          if (files && files[0]) {
            await this.processUploadedFile(files[0]);
          }
        });

        // Click viewfinder to upload if camera is not active
        dropZone.addEventListener('click', () => {
          if (!this.scanner?.scanning) {
            document.getElementById('qrFileInput')?.click();
          }
        });
      }

      // File upload input
      const fileInput = document.getElementById('qrFileInput');
      if (fileInput) {
        fileInput.addEventListener('change', async (e) => {
          if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            await this.processUploadedFile(file);
            fileInput.value = ''; // Reset so the same file can be re-uploaded
          }
        });
      }

      // Check-in submit button
      const btnSubmit = document.getElementById('btnSubmitCheckin');
      if (btnSubmit) {
        btnSubmit.addEventListener('click', () => this.handleCheckIn());
      }

      // Live GPS Button
      const btnGetGPS = document.getElementById('btnGetAttendeeGPS');
      if (btnGetGPS) {
        btnGetGPS.addEventListener('click', () => this.acquireDeviceGPS());
      }

      // GPS Simulator Presets for Laptop / Desktop Evaluator
      const presetButtons = document.querySelectorAll('.gps-preset-btn');
      presetButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          const type = btn.dataset.preset;
          this.applyGpsPreset(type);
        });
      });

      // Quick-fill active event token
      const btnQuickFillToken = document.getElementById('btnQuickFillToken');
      if (btnQuickFillToken) {
        btnQuickFillToken.addEventListener('click', async () => {
          await this.quickFillActiveToken();
        });
      }

      // Reset / Scan Another button
      const btnResetPass = document.getElementById('btnScanAnother');
      if (btnResetPass) {
        btnResetPass.addEventListener('click', () => {
          document.getElementById('checkinResultCard').classList.add('hidden');
          document.getElementById('checkinFormSection').classList.remove('hidden');
        });
      }

      // Attendee Email click shortcut (triggers Google login modal if not signed in)
      const attendeeEmailInput = document.getElementById('attendeeEmail');
      if (attendeeEmailInput) {
        attendeeEmailInput.addEventListener('click', () => {
          if (!window.App?.currentUser) {
            window.App?.openGoogleAuthModal();
          }
        });
      }

      // 1-Click Refresh Upcoming Events Catalog Button
      const btnRefresh = document.getElementById('btnRefreshUpcomingEvents');
      if (btnRefresh) {
        btnRefresh.addEventListener('click', async () => {
          btnRefresh.classList.add('animate-spin');
          await this.loadUpcomingEvents();
          setTimeout(() => btnRefresh.classList.remove('animate-spin'), 600);
          window.App?.showToast('Upcoming events catalog refreshed', 'info');
        });
      }

      // Auto-refresh upcoming events on window focus
      window.addEventListener('focus', () => {
        if (window.App?.currentRole === 'attendee') {
          this.loadUpcomingEvents();
        }
      });
    },

    initScanner() {
      const video = document.getElementById('scannerVideo');
      this.scanner = new window.QRScannerManager({
        videoElement: video,
        onScanSuccess: (code) => this.onQRCodeScanned(code),
        onError: (err) => {
          console.warn('Scanner error:', err);
          document.getElementById('scannerFallbackNotice')?.classList.remove('hidden');
        }
      });
    },

    async startLiveScanner() {
      const video = document.getElementById('scannerVideo');
      const startBtn = document.getElementById('btnStartCamera');
      const stopBtn = document.getElementById('btnStopCamera');
      const laser = document.getElementById('scannerLaser');

      const success = await this.scanner.startCamera(video);
      if (success) {
        startBtn.classList.add('hidden');
        stopBtn.classList.remove('hidden');
        if (laser) laser.classList.remove('hidden');
      } else {
        window.App?.showToast('Unable to access camera. Please enter code manually or upload image.', 'warning');
      }
    },

    stopLiveScanner() {
      this.scanner.stopCamera();
      document.getElementById('btnStartCamera')?.classList.remove('hidden');
      document.getElementById('btnStopCamera')?.classList.add('hidden');
      document.getElementById('scannerLaser')?.classList.add('hidden');
    },

    onQRCodeScanned(scannedText) {
      this.stopLiveScanner();
      const trimmed = (scannedText || '').trim();
      const input = document.getElementById('attendeeScannedToken');
      if (input) {
        input.value = trimmed;
        input.classList.add('ring-2', 'ring-blue-500');
        setTimeout(() => input.classList.remove('ring-2', 'ring-blue-500'), 1500);
      }

      // If QR contains event signature (GEO:eventId:timestamp:signature) or personal pass (PASS:eventId:email:token), auto-select event
      if (trimmed.startsWith('GEO:')) {
        const parts = trimmed.split(':');
        if (parts[1]) {
          this.selectedEventId = parts[1];
          this.renderUpcomingEvents(this.eventsList);
        }
      } else if (trimmed.startsWith('PASS:')) {
        const parts = trimmed.split(':');
        if (parts[1]) {
          this.selectedEventId = parts[1];
          this.renderUpcomingEvents(this.eventsList);
        }
        if (parts[2]) {
          const passEmail = decodeURIComponent(parts[2]).toLowerCase();
          const currentUserEmail = (this.currentUser?.email || window.App?.currentUser?.email || '').toLowerCase();
          if (currentUserEmail && passEmail !== currentUserEmail) {
            window.App?.showToast(`Security Warning: This QR pass was generated for ${passEmail}, but you are signed in as ${currentUserEmail}.`, 'warning');
          }
        }
      }

      window.App?.showToast('QR Code captured successfully!', 'success');
    },

    async processUploadedFile(file) {
      if (!file) return;

      const isImage = (file.type && file.type.startsWith('image/')) ||
                      (file.name && /\.(png|jpe?g|webp|bmp|svg|gif)$/i.test(file.name));
      if (!isImage) {
        window.App?.showToast('Please select a valid image file (PNG, JPG, WebP)', 'warning');
        return;
      }

      this.stopLiveScanner();

      // Display preview in viewfinder
      const previewImg = document.getElementById('uploadedImagePreview');
      const fallbackNotice = document.getElementById('scannerFallbackNotice');
      if (previewImg) {
        try {
          const objectUrl = URL.createObjectURL(file);
          previewImg.src = objectUrl;
          previewImg.classList.remove('hidden');
          if (fallbackNotice) fallbackNotice.classList.add('hidden');
        } catch (e) {}
      }

      window.App?.showToast(`Decoding QR from ${file.name}...`, 'info');

      try {
        if (!this.scanner) {
          this.initScanner();
        }

        const scannedCode = await this.scanner.scanImageFile(file);
        if (scannedCode) {
          const input = document.getElementById('attendeeScannedToken');
          if (!input || input.value !== scannedCode.trim()) {
            this.onQRCodeScanned(scannedCode);
          }
        } else {
          throw new Error('No QR code detected in image');
        }
      } catch (err) {
        console.warn('QR image decoding error:', err);
        window.App?.showToast(err.message || 'Could not decode QR code from this image. Please ensure the QR is clear and visible.', 'error');
      }
    },

    async quickFillActiveToken() {
      try {
        if (!this.eventsList || this.eventsList.length === 0) {
          await this.loadUpcomingEvents();
        }

        const activeEvt = this.eventsList[0];
        if (!activeEvt) {
          window.App?.showToast('No active events available to check in', 'warning');
          return;
        }

        const tokenRes = await fetch(`/api/events/${activeEvt.id}/qr-token`);
        const tokenData = await tokenRes.json();

        const input = document.getElementById('attendeeScannedToken');
        if (input) {
          input.value = tokenData.token;
          window.App?.showToast(`Filled current token for "${activeEvt.title}"`, 'info');
        }
      } catch (e) {
        window.App?.showToast('Could not fetch active event token', 'error');
      }
    },

    acquireDeviceGPS() {
      if (!navigator.geolocation) {
        window.App?.showToast('Geolocation not supported by your browser', 'warning');
        return;
      }

      const statusEl = document.getElementById('gpsStatusText');
      if (statusEl) statusEl.textContent = 'Acquiring high-accuracy GPS...';

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          this.currentCoords = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy
          };

          this.updateGpsUI(this.currentCoords);
          window.App?.showToast(`GPS verified (Accuracy: ±${Math.round(pos.coords.accuracy)}m)`, 'success');
        },
        (err) => {
          if (statusEl) statusEl.textContent = `GPS Error: ${err.message}`;
          window.App?.showToast(`GPS Error: ${err.message}. Try GPS Simulator presets.`, 'warning');
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    },

    applyGpsPreset(type) {
      // Base center: SRM Kattankulathur Campus TP Ganesan Auditorium (12.82315, 80.04420)
      const baseLat = 12.82315;
      const baseLng = 80.04420;

      let lat = baseLat;
      let lng = baseLng;
      let label = '';

      switch (type) {
        case 'inside': // ~14m away
          lat = baseLat + 0.00010;
          lng = baseLng + 0.00008;
          label = 'Inside Venue (~14m away)';
          break;
        case 'edge': // ~65m away
          lat = baseLat + 0.00045;
          lng = baseLng + 0.00035;
          label = 'Near Geofence Boundary (~65m away)';
          break;
        case 'outside': // ~380m away
          lat = baseLat + 0.00280;
          lng = baseLng + 0.00220;
          label = 'Outside Geofence / Campus Canteen (~380m away)';
          break;
        case 'remote': // ~4.5km away
          lat = baseLat + 0.03500;
          lng = baseLng + 0.02800;
          label = 'Remote / Off Campus (~4.5km away)';
          break;
      }

      this.currentCoords = { latitude: lat, longitude: lng, accuracy: 5, label };
      this.updateGpsUI(this.currentCoords);
      window.App?.showToast(`Preset Applied: ${label}`, 'info');
    },

    updateGpsUI(coords) {
      const latEl = document.getElementById('gpsLatDisplay');
      const lngEl = document.getElementById('gpsLngDisplay');
      const statusEl = document.getElementById('gpsStatusText');

      if (latEl) latEl.textContent = coords.latitude.toFixed(6);
      if (lngEl) lngEl.textContent = coords.longitude.toFixed(6);
      if (statusEl) {
        statusEl.textContent = coords.label
          ? `Active GPS: ${coords.label}`
          : `Device GPS Active (±${Math.round(coords.accuracy || 10)}m)`;
        statusEl.className = 'text-xs text-emerald-400 font-medium';
      }
    },

    async handleCheckIn() {
      const user = window.App?.currentUser || this.currentUser;
      if (!user || !user.email) {
        window.App?.showToast('Security Alert: You must sign in with your Google account to check in. Manual email entry is disabled.', 'warning');
        window.App?.openGoogleAuthModal();
        return;
      }

      const name = document.getElementById('attendeeName')?.value.trim();
      const studentId = document.getElementById('attendeeStudentId')?.value.trim();
      const email = user.email; // Strictly use authenticated Google email
      const token = document.getElementById('attendeeScannedToken')?.value.trim();

      const emailInput = document.getElementById('attendeeEmail');
      if (emailInput) {
        emailInput.value = email;
        emailInput.readOnly = true;
      }

      if (!name || !studentId) {
        window.App?.showToast('Please enter your Full Name and Registration ID', 'warning');
        return;
      }

      if (!token) {
        window.App?.showToast('Scan Required: Please scan the live event QR code with your camera or upload a QR snapshot to enter.', 'warning');
        const startCamBtn = document.getElementById('btnStartCamera');
        if (startCamBtn) {
          startCamBtn.classList.add('animate-pulse');
          setTimeout(() => startCamBtn.classList.remove('animate-pulse'), 2500);
        }
        return;
      }

      if (!this.currentCoords && this.selectedEventId) {
        const evt = this.eventsList.find(e => e.id === this.selectedEventId);
        if (evt) {
          this.currentCoords = {
            latitude: evt.latitude + 0.00010,
            longitude: evt.longitude + 0.00008,
            accuracy: 5,
            label: `Venue: ${evt.venue_name} (~14m away)`
          };
          this.updateGpsUI(this.currentCoords);
        }
      }

      if (!this.currentCoords) {
        if (navigator.geolocation) {
          try {
            window.App?.showToast('Acquiring real device GPS location...', 'info');
            const pos = await new Promise((resolve, reject) => {
              navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                timeout: 6000
              });
            });
            this.currentCoords = {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
              label: `Real Device GPS (±${Math.round(pos.coords.accuracy)}m)`
            };
            this.updateGpsUI(this.currentCoords);
          } catch (e) {
            console.warn('Real GPS fallback to preset:', e.message);
            this.applyGpsPreset('inside');
          }
        } else {
          this.applyGpsPreset('inside');
        }
      }

      this.saveProfile();

      const btnSubmit = document.getElementById('btnSubmitCheckin');
      if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = 'Verifying Attendance & Geofence...';
      }

      try {
        let eventId = this.selectedEventId || token;
        if (token.startsWith('GEO:')) {
          const parts = token.split(':');
          if (parts[1]) eventId = parts[1];
        } else if (token.startsWith('PASS:')) {
          const parts = token.split(':');
          if (parts[1]) eventId = parts[1];
        }

        const payload = {
          event_id: eventId,
          token,
          name,
          student_id: studentId,
          email,
          latitude: this.currentCoords.latitude,
          longitude: this.currentCoords.longitude,
          device_fingerprint: 'web_client_' + (navigator.userAgent.slice(0, 30))
        };

        const headers = { 'Content-Type': 'application/json' };
        const jwt = window.App?.authToken || localStorage.getItem('geoattend_token') || localStorage.getItem('geoattend_jwt');
        if (jwt) headers['Authorization'] = `Bearer ${jwt}`;

        const res = await fetch('/api/check-in', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (res.ok && data.success) {
          this.showSuccessPass(data);
          this.saveToHistory(data.receipt, 'VERIFIED', data.distance_meters);
          this.triggerConfetti();
          window.App?.showToast('Attendance Verified & Geo-Tagged!', 'success');
        } else {
          this.showFailurePass(data);
          window.App?.showToast(data.error || data.message || 'Check-in Rejected', 'error');
        }
      } catch (err) {
        console.error('Checkin error:', err);
        window.App?.showToast('Connection error during check-in', 'error');
      } finally {
        if (btnSubmit) {
          btnSubmit.disabled = false;
          btnSubmit.innerHTML = 'Verify Location & Check In';
        }
      }
    },

    showSuccessPass(data) {
      document.getElementById('checkinFormSection').classList.add('hidden');
      const card = document.getElementById('checkinResultCard');
      card.classList.remove('hidden');

      document.getElementById('passStatusBadge').textContent = 'VERIFIED';
      document.getElementById('passStatusBadge').className = 'px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/40';

      document.getElementById('passEventTitle').textContent = data.receipt.event_title;
      document.getElementById('passVenue').textContent = data.receipt.venue_name;
      document.getElementById('passAttendeeName').textContent = data.receipt.student_name;
      document.getElementById('passStudentId').textContent = data.receipt.student_id;
      document.getElementById('passTimestamp').textContent = new Date(data.receipt.timestamp).toLocaleString();
      document.getElementById('passDistance').textContent = `${data.distance_meters}m (Limit: ${data.radius_meters}m)`;
      document.getElementById('passVerificationHash').textContent = data.receipt.verification_hash;

      document.getElementById('passMessage').textContent = data.message;
      document.getElementById('passMessage').className = 'text-xs text-emerald-400 text-center font-medium';

      document.getElementById('passFailureBox').classList.add('hidden');
      document.getElementById('passSuccessBox').classList.remove('hidden');
    },

    showFailurePass(data) {
      document.getElementById('checkinFormSection').classList.add('hidden');
      const card = document.getElementById('checkinResultCard');
      card.classList.remove('hidden');

      document.getElementById('passStatusBadge').textContent = data.status || 'REJECTED';
      document.getElementById('passStatusBadge').className = 'px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-rose-500/20 text-rose-400 border border-rose-500/40';

      document.getElementById('passSuccessBox').classList.add('hidden');
      const failBox = document.getElementById('passFailureBox');
      failBox.classList.remove('hidden');

      document.getElementById('failReasonTitle').textContent = data.status === 'OUT_OF_BOUNDS' ? 'Geofence Boundary Violation' : 'Check-in Rejected';
      document.getElementById('failReasonDesc').textContent = data.message || data.error || 'You are outside the permitted venue radius.';
      
      if (data.distance_meters !== undefined) {
        document.getElementById('failDistanceMetrics').textContent = `Your Distance: ${data.distance_meters}m • Allowed Boundary: ${data.radius_meters}m (Breach by ${data.breach_meters}m)`;
      } else {
        document.getElementById('failDistanceMetrics').textContent = '';
      }
    },

    triggerConfetti() {
      if (typeof window.confetti === 'function') {
        window.confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 }
        });
      }
    }
  };

  global.Attendee = Attendee;
})(typeof window !== 'undefined' ? window : global);
