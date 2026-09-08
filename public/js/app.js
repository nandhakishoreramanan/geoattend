/**
 * Main Application Hub & State Manager
 * Handles navigation switching between Organizer Portal and Attendee Portal,
 * global toasts, and initialization.
 */

(function (global) {
  const App = {
    currentRole: 'organizer', // 'organizer' | 'attendee'
    currentUser: null,
    authToken: null,

    init() {
      this.initTheme();
      this.loadStoredAuth();
      this.bindNav();
      this.bindGoogleAuth();
      this.bindNavDrawer();
      this.bindLocalAiModal();

      // Initialize sub-controllers
      if (global.Organizer) global.Organizer.init();
      if (global.Attendee) global.Attendee.init();

      // Check URL hash for role: #attendee or #organizer
      const hash = window.location.hash.replace('#', '');
      if (hash === 'attendee' || hash === 'student') {
        this.switchRole('attendee');
      } else {
        this.switchRole('organizer');
      }

      this.updateAuthUI();
    },

    loadStoredAuth() {
      try {
        // Check for Google OAuth redirect callback tokens in URL hash
        const hash = window.location.hash.replace(/^#/, '');
        const hashParams = new URLSearchParams(hash);
        if (hashParams.has('google_token')) {
          const token = hashParams.get('google_token');
          const userStr = hashParams.get('user');
          if (token && userStr) {
            try {
              const user = JSON.parse(decodeURIComponent(userStr));
              this.authToken = token;
              this.currentUser = user;
              localStorage.setItem('geoattend_token', token);
              localStorage.setItem('geoattend_user', JSON.stringify(user));
              window.location.hash = 'attendee';
              this.updateAuthUI();
              this.showToast(`Signed in with Google as ${user.name} (${user.email})`, 'success');
              if (global.Attendee?.onUserAuthChanged) global.Attendee.onUserAuthChanged(user);
              return;
            } catch (e) {}
          }
        } else if (hashParams.has('google_error')) {
          const err = hashParams.get('google_error');
          try {
            history.replaceState(null, '', window.location.pathname + '#attendee');
          } catch (e) {
            window.location.hash = 'attendee';
          }
          setTimeout(() => {
            const isFetchError = err.includes('fetch') || err.includes('offline') || err.includes('ENOTFOUND');
            if (isFetchError) {
              this.openGoogleAuthModal(false, 'Google OAuth token endpoint could not be reached from this local environment (fetch failed). Choose an instant 1-click Google account or enter your email below to continue seamlessly.');
              this.showToast('Google OAuth offline: Use instant 1-click accounts or custom email below', 'warning');
            } else if (err === 'no_client_id') {
              this.openGoogleAuthModal(true);
              this.showToast('Google OAuth Client ID required for accounts.google.com redirection.', 'warning');
            } else {
              this.openGoogleAuthModal(false, `Notice: ${decodeURIComponent(err)}`);
              this.showToast(`Google Sign-In Notice: ${decodeURIComponent(err)}`, 'error');
            }
          }, 300);
        }

        const storedToken = localStorage.getItem('geoattend_token');
        const storedUser = localStorage.getItem('geoattend_user');
        if (storedToken && storedUser) {
          this.authToken = storedToken;
          this.currentUser = JSON.parse(storedUser);
        } else {
          this.authToken = null;
          this.currentUser = null;
        }
      } catch (e) {
        console.warn('Error loading auth state from localStorage:', e);
      }
    },

    bindNav() {
      const btnRoleOrganizer = document.getElementById('btnRoleOrganizer');
      const btnRoleAttendee = document.getElementById('btnRoleAttendee');

      if (btnRoleOrganizer) {
        btnRoleOrganizer.addEventListener('click', () => this.switchRole('organizer'));
      }
      if (btnRoleAttendee) {
        btnRoleAttendee.addEventListener('click', () => this.switchRole('attendee'));
      }
    },

    bindNavDrawer() {
      const btnHamburger = document.getElementById('btnHamburgerMenu');
      const btnCloseDrawer = document.getElementById('btnCloseNavDrawer');
      const drawerPanel = document.getElementById('navDrawerPanel');
      const drawerBackdrop = document.getElementById('navDrawerBackdrop');

      const openDrawer = () => {
        if (!drawerPanel || !drawerBackdrop) return;
        drawerBackdrop.classList.remove('opacity-0', 'pointer-events-none');
        drawerBackdrop.classList.add('opacity-100', 'pointer-events-auto');
        drawerPanel.classList.remove('translate-x-full');
        drawerPanel.classList.add('translate-x-0');
        this.updateDrawerUI();
      };

      const closeDrawer = () => {
        if (!drawerPanel || !drawerBackdrop) return;
        drawerPanel.classList.remove('translate-x-0');
        drawerPanel.classList.add('translate-x-full');
        drawerBackdrop.classList.remove('opacity-100', 'pointer-events-auto');
        drawerBackdrop.classList.add('opacity-0', 'pointer-events-none');
      };

      if (btnHamburger) btnHamburger.addEventListener('click', openDrawer);
      if (btnCloseDrawer) btnCloseDrawer.addEventListener('click', closeDrawer);
      if (drawerBackdrop) drawerBackdrop.addEventListener('click', closeDrawer);

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && drawerPanel && !drawerPanel.classList.contains('translate-x-full')) {
          closeDrawer();
        }
      });

      // Role Switchers in Drawer
      const navOrg = document.getElementById('drawerNavOrganizer');
      if (navOrg) {
        navOrg.addEventListener('click', () => {
          this.switchRole('organizer');
          closeDrawer();
        });
      }

      const navAtt = document.getElementById('drawerNavAttendee');
      if (navAtt) {
        navAtt.addEventListener('click', () => {
          this.switchRole('attendee');
          closeDrawer();
        });
      }

      // Quick Actions in Drawer
      const btnNewEvent = document.getElementById('drawerBtnNewEvent');
      if (btnNewEvent) {
        btnNewEvent.addEventListener('click', () => {
          this.switchRole('organizer');
          closeDrawer();
          const modal = document.getElementById('createEventModal');
          if (modal) {
            modal.classList.remove('hidden');
            if (global.Organizer && typeof global.Organizer.initCreateEventMap === 'function') {
              global.Organizer.initCreateEventMap();
            }
          }
        });
      }

      const btnManageWhitelist = document.getElementById('drawerBtnManageWhitelist');
      if (btnManageWhitelist) {
        btnManageWhitelist.addEventListener('click', () => {
          this.switchRole('organizer');
          closeDrawer();
          if (global.Organizer && typeof global.Organizer.openWhitelistModal === 'function') {
            global.Organizer.openWhitelistModal();
          }
        });
      }

      const btnFullscreen = document.getElementById('drawerBtnFullscreen');
      if (btnFullscreen) {
        btnFullscreen.addEventListener('click', () => {
          this.switchRole('organizer');
          closeDrawer();
          if (global.Organizer && typeof global.Organizer.toggleFullscreenQR === 'function') {
            global.Organizer.toggleFullscreenQR();
          }
        });
      }

      const btnExportCsv = document.getElementById('drawerBtnExportCsv');
      if (btnExportCsv) {
        btnExportCsv.addEventListener('click', () => {
          closeDrawer();
          if (global.Organizer && typeof global.Organizer.exportCsv === 'function') {
            global.Organizer.exportCsv();
          }
        });
      }

      const btnLocalAi = document.getElementById('drawerBtnLocalAi');
      if (btnLocalAi) {
        btnLocalAi.addEventListener('click', () => {
          closeDrawer();
          this.openLocalAiModal();
        });
      }

      // Auth action in drawer
      const btnDrawerAuth = document.getElementById('drawerAuthActionBtn');
      if (btnDrawerAuth) {
        btnDrawerAuth.addEventListener('click', () => {
          if (this.currentUser) {
            this.signOutGoogle();
            closeDrawer();
          } else {
            closeDrawer();
            this.triggerGoogleLogin();
          }
        });
      }

      this.updateDrawerUI();
    },

    updateDrawerUI() {
      const avatar = document.getElementById('drawerUserAvatar');
      const name = document.getElementById('drawerUserName');
      const email = document.getElementById('drawerUserEmail');
      const btnAuth = document.getElementById('drawerAuthActionBtn');

      if (this.currentUser) {
        if (avatar) avatar.src = this.currentUser.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(this.currentUser.name || this.currentUser.email)}`;
        if (name) name.textContent = this.currentUser.name || this.currentUser.email.split('@')[0];
        if (email) email.textContent = this.currentUser.email;
        if (btnAuth) {
          btnAuth.textContent = 'Sign Out';
          btnAuth.className = 'px-3 py-1 rounded-full text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white cursor-pointer shadow-sm transition-colors';
        }
      } else {
        if (avatar) avatar.src = 'https://api.dicebear.com/7.x/initials/svg?seed=Guest';
        if (name) name.textContent = 'Guest';
        if (email) email.textContent = 'Not signed in';
        if (btnAuth) {
          btnAuth.textContent = 'Sign In';
          btnAuth.className = 'px-3 py-1 rounded-full text-xs font-bold bg-slate-950 dark:bg-white text-white dark:text-slate-900 cursor-pointer shadow-sm hover:opacity-90 transition-all';
        }
      }

      this.updateDrawerThemeUI();

      // Highlight active role
      const navOrg = document.getElementById('drawerNavOrganizer');
      const navAtt = document.getElementById('drawerNavAttendee');
      if (this.currentRole === 'organizer') {
        navOrg?.classList.add('bg-slate-100', 'dark:bg-slate-800', 'font-extrabold');
        navAtt?.classList.remove('bg-slate-100', 'dark:bg-slate-800', 'font-extrabold');
      } else {
        navAtt?.classList.add('bg-slate-100', 'dark:bg-slate-800', 'font-extrabold');
        navOrg?.classList.remove('bg-slate-100', 'dark:bg-slate-800', 'font-extrabold');
      }
    },

    updateDrawerThemeUI() {
      // Light theme permanently enforced
    },

    initTheme() {
      document.documentElement.classList.remove('dark');
      document.documentElement.setAttribute('data-theme', 'light');
      try {
        localStorage.removeItem('geoattend_theme');
        localStorage.setItem('geoattend_theme', 'light');
      } catch (e) {}
    },

    setTheme() {
      document.documentElement.classList.remove('dark');
      document.documentElement.setAttribute('data-theme', 'light');
    },

    bindGoogleAuth() {
      const btnNav = document.getElementById('btnGoogleSignInNav');
      const btnPrompt = document.getElementById('btnPromptGoogleSignIn');
      const btnSwitchDenied = document.getElementById('btnSwitchAccountFromDenied');
      const btnCloseModal = document.getElementById('btnCloseGoogleModal');
      const btnSignOut = document.getElementById('btnSignOutGoogle');
      const googlePill = document.getElementById('googleUserPill');

      if (btnNav) btnNav.addEventListener('click', () => this.triggerGoogleLogin());
      if (btnPrompt) btnPrompt.addEventListener('click', () => this.triggerGoogleLogin());
      if (btnSwitchDenied) btnSwitchDenied.addEventListener('click', () => this.openGoogleAuthModal());
      if (btnCloseModal) btnCloseModal.addEventListener('click', () => this.closeGoogleAuthModal());

      if (googlePill) {
        googlePill.addEventListener('click', (e) => {
          if (e.target.id !== 'btnSignOutGoogle') {
            this.openGoogleAuthModal();
          }
        });
      }

      if (btnSignOut) {
        btnSignOut.addEventListener('click', (e) => {
          e.stopPropagation();
          this.signOutGoogle();
        });
      }

      // 1-Click Instant Google Accounts
      document.querySelectorAll('.btn-google-preset').forEach(btn => {
        btn.addEventListener('click', () => {
          const email = btn.dataset.email;
          const name = btn.dataset.name;
          const role = btn.dataset.role || 'participant';
          this.loginWithGoogleProfile({ email, name, role });
        });
      });

      // Custom Google / SRM Email Form
      const formCustomGoogle = document.getElementById('formCustomGoogleAuth');
      if (formCustomGoogle) {
        formCustomGoogle.addEventListener('submit', (e) => {
          e.preventDefault();
          const emailInput = document.getElementById('customGoogleEmail');
          const nameInput = document.getElementById('customGoogleName');
          const email = emailInput ? emailInput.value.trim() : '';
          const name = nameInput ? nameInput.value.trim() : '';
          if (!email) {
            this.showToast('Please enter a Google or SRM email address', 'warning');
            return;
          }
          if (!email.includes('@')) {
            this.showToast('Please enter a valid email address with @', 'warning');
            return;
          }
          this.loginWithGoogleProfile({
            email,
            name: name || email.split('@')[0],
            role: email.includes('organizer') ? 'organizer' : 'participant'
          });
        });
      }

      // Official Google OAuth Redirect button
      const btnRedirect = document.getElementById('btnTriggerGoogleRedirect');
      if (btnRedirect) {
        btnRedirect.addEventListener('click', async () => {
          try {
            const res = await fetch('/api/auth/google/config');
            const data = await res.json();
            if (data.configured) {
              this.showToast('Redirecting to accounts.google.com...', 'info');
              window.location.href = '/api/auth/google/login';
            } else {
              const setupSection = document.getElementById('googleSetupSection');
              if (setupSection) setupSection.classList.remove('hidden');
              this.showToast('Google OAuth Client ID required. Enter your client ID or use 1-click login.', 'warning');
            }
          } catch (e) {
            window.location.href = '/api/auth/google/login';
          }
        });
      }

      // Save Client ID button
      const btnSaveClientId = document.getElementById('btnSaveGoogleClientId');
      const inputClientId = document.getElementById('inputSaveGoogleClientId');
      if (btnSaveClientId && inputClientId) {
        btnSaveClientId.addEventListener('click', async () => {
          const clientId = inputClientId.value.trim();
          if (!clientId) {
            this.showToast('Please paste a valid Google Client ID', 'warning');
            return;
          }
          try {
            const res = await fetch('/api/auth/google/config', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ client_id: clientId })
            });
            const data = await res.json();
            if (data.success) {
              this.showToast('Google Client ID saved! Redirecting to accounts.google.com...', 'success');
              setTimeout(() => {
                window.location.href = '/api/auth/google/login';
              }, 600);
            }
          } catch (err) {
            this.showToast('Error saving Google Client ID', 'error');
          }
        });
      }

      // Modal Sign Out button (inside active Google session card)
      const btnModalSignOut = document.getElementById('btnModalSignOut');
      if (btnModalSignOut) {
        btnModalSignOut.addEventListener('click', () => {
          this.signOutGoogle();
          this.closeGoogleAuthModal();
        });
      }

      // Check config on start
      this.checkGoogleOAuthConfig();
    },

    async checkGoogleOAuthConfig() {
      try {
        const res = await fetch('/api/auth/google/config');
        const data = await res.json();
        const badge = document.getElementById('googleConfigBadge');
        const inputClientId = document.getElementById('inputSaveGoogleClientId');
        if (badge) {
          if (data.configured) {
            badge.textContent = 'Active';
            badge.className = 'px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
          } else {
            badge.textContent = 'Setup Needed';
            badge.className = 'px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30';
          }
        }
        if (inputClientId && data.client_id) {
          inputClientId.value = data.client_id;
        }
      } catch (e) {}
    },

    async triggerGoogleLogin() {
      try {
        const res = await fetch('/api/auth/google/config');
        const data = await res.json();
        if (data.configured) {
          this.showToast('Redirecting to Google sign-in...', 'info');
          window.location.href = '/api/auth/google/login';
        } else {
          this.openGoogleAuthModal(true);
        }
      } catch (e) {
        this.openGoogleAuthModal(true);
      }
    },

    openGoogleAuthModal(showSetup = false, alertMessage = null) {
      const modal = document.getElementById('googleAuthModal');
      if (modal) modal.classList.remove('hidden');
      this.checkGoogleOAuthConfig();

      const alertBanner = document.getElementById('googleAuthModalAlert');
      const alertDesc = document.getElementById('googleAuthModalAlertDesc');
      if (alertBanner) {
        if (alertMessage) {
          alertBanner.classList.remove('hidden');
          if (alertDesc) alertDesc.textContent = alertMessage;
        } else {
          alertBanner.classList.add('hidden');
        }
      }

      const setupSection = document.getElementById('googleSetupSection');
      if (setupSection && showSetup) {
        setupSection.classList.remove('hidden');
      }

      this.updateAuthUI();
    },

    closeGoogleAuthModal() {
      const modal = document.getElementById('googleAuthModal');
      if (modal) modal.classList.add('hidden');
      const alertBanner = document.getElementById('googleAuthModalAlert');
      if (alertBanner) alertBanner.classList.add('hidden');
    },

    async loginWithGoogleProfile(profile, showFeedback = true) {
      try {
        const res = await fetch('/api/auth/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profile, role: profile.role })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Google login failed');

        this.authToken = data.token;
        this.currentUser = data.user;

        localStorage.setItem('geoattend_token', data.token);
        localStorage.setItem('geoattend_user', JSON.stringify(data.user));

        this.closeGoogleAuthModal();
        this.updateAuthUI();
        if (showFeedback) {
          this.showToast(`Signed in with Google as ${data.user.name} (${data.user.email})`, 'success');
        }

        // Notify controllers
        if (global.Attendee && typeof global.Attendee.onUserAuthChanged === 'function') {
          global.Attendee.onUserAuthChanged(data.user);
        }
        if (global.Organizer && typeof global.Organizer.onUserAuthChanged === 'function') {
          global.Organizer.onUserAuthChanged(data.user);
        }
      } catch (err) {
        console.error('Google login error:', err);
        if (showFeedback) {
          this.showToast(err.message || 'Google sign-in error', 'error');
        }
      }
    },

    async loginWithGoogleCredential(credentialString) {
      try {
        const res = await fetch('/api/auth/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential: credentialString })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Google login failed');

        this.authToken = data.token;
        this.currentUser = data.user;

        localStorage.setItem('geoattend_token', data.token);
        localStorage.setItem('geoattend_user', JSON.stringify(data.user));

        this.updateAuthUI();
        this.showToast(`Signed in as ${data.user.name} (${data.user.email})`, 'success');

        if (global.Attendee && typeof global.Attendee.onUserAuthChanged === 'function') {
          global.Attendee.onUserAuthChanged(data.user);
        }
      } catch (err) {
        this.showToast(err.message || 'Google sign-in error', 'error');
      }
    },

    signOutGoogle() {
      const email = this.currentUser ? this.currentUser.email : '';
      this.currentUser = null;
      this.authToken = null;
      localStorage.removeItem('geoattend_token');
      localStorage.removeItem('geoattend_user');
      localStorage.removeItem('geoattend_jwt');
      localStorage.removeItem('geoattend_email');

      this.updateAuthUI();
      this.showToast(email ? `Signed out of Google (${email})` : 'Signed out', 'info');

      if (global.Attendee && typeof global.Attendee.onUserAuthChanged === 'function') {
        global.Attendee.onUserAuthChanged(null);
      }
    },

    updateAuthUI() {
      const btnNav = document.getElementById('btnGoogleSignInNav');
      const userPill = document.getElementById('googleUserPill');
      const userName = document.getElementById('googleUserName');
      const userEmail = document.getElementById('googleUserEmail');
      const userAvatar = document.getElementById('googleUserAvatar');

      // Modal active session card
      const modalActive = document.getElementById('modalGoogleAccountActive');
      const modalName = document.getElementById('modalGoogleUserName');
      const modalEmail = document.getElementById('modalGoogleUserEmail');
      const modalAvatar = document.getElementById('modalGoogleUserAvatar');

      if (this.currentUser) {
        btnNav?.classList.add('hidden');
        userPill?.classList.remove('hidden');
        if (userName) userName.textContent = this.currentUser.name || this.currentUser.email.split('@')[0];
        if (userEmail) userEmail.textContent = this.currentUser.email;
        if (userAvatar) {
          userAvatar.src = this.currentUser.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(this.currentUser.name || this.currentUser.email)}`;
        }

        if (modalActive) modalActive.classList.remove('hidden');
        if (modalName) modalName.textContent = this.currentUser.name || this.currentUser.email.split('@')[0];
        if (modalEmail) modalEmail.textContent = this.currentUser.email;
        if (modalAvatar) {
          modalAvatar.src = this.currentUser.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(this.currentUser.name || this.currentUser.email)}`;
        }
      } else {
        btnNav?.classList.remove('hidden');
        userPill?.classList.add('hidden');
        if (modalActive) modalActive.classList.add('hidden');
      }

      this.updateDrawerUI();
    },

    getAuthHeaders() {
      return this.authToken ? { 'Authorization': `Bearer ${this.authToken}` } : {};
    },

    switchRole(role) {
      this.currentRole = role;
      window.location.hash = role;

      const organizerPortal = document.getElementById('organizerPortal');
      const attendeePortal = document.getElementById('attendeePortal');
      const btnOrg = document.getElementById('btnRoleOrganizer');
      const btnAtt = document.getElementById('btnRoleAttendee');

      if (role === 'organizer') {
        organizerPortal?.classList.remove('hidden');
        attendeePortal?.classList.add('hidden');

        btnOrg?.classList.add('bg-slate-950', 'text-white', 'shadow-sm');
        btnOrg?.classList.remove('text-slate-600');
        btnAtt?.classList.remove('bg-slate-950', 'text-white', 'shadow-sm');
        btnAtt?.classList.add('text-slate-600');

        // Stop attendee camera if running
        if (global.Attendee) global.Attendee.stopLiveScanner();

        // Refresh organizer events
        if (global.Organizer && typeof global.Organizer.loadEvents === 'function') {
          global.Organizer.loadEvents();
        }
      } else {
        organizerPortal?.classList.add('hidden');
        attendeePortal?.classList.remove('hidden');

        btnAtt?.classList.add('bg-slate-950', 'text-white', 'shadow-sm');
        btnAtt?.classList.remove('text-slate-600');
        btnOrg?.classList.remove('bg-slate-950', 'text-white', 'shadow-sm');
        btnOrg?.classList.add('text-slate-600');

        // Refresh attendee upcoming events, pass card, and acquire GPS immediately
        if (global.Attendee && typeof global.Attendee.loadUpcomingEvents === 'function') {
          global.Attendee.loadUpcomingEvents();
        }
        if (global.Attendee && typeof global.Attendee.refreshPassCard === 'function') {
          global.Attendee.refreshPassCard();
        }
        if (global.Attendee && typeof global.Attendee.acquireDeviceGPS === 'function') {
          global.Attendee.acquireDeviceGPS(false);
        }
      }

      this.updateDrawerUI();
    },

    showToast(message, type = 'info') {
      const toastContainer = document.getElementById('toastContainer');
      if (!toastContainer) return;

      // Prevent duplicate toasts within 4 seconds
      const now = Date.now();
      if (!this._recentToasts) this._recentToasts = new Map();
      const lastTime = this._recentToasts.get(message) || 0;
      if (now - lastTime < 4000) {
        return;
      }
      this._recentToasts.set(message, now);

      // Clean up old entries from recentToasts
      for (const [msg, time] of this._recentToasts.entries()) {
        if (now - time > 10000) this._recentToasts.delete(msg);
      }

      // Limit max visible toasts to 2 to eliminate screen clutter
      while (toastContainer.children.length >= 2) {
        toastContainer.firstElementChild?.remove();
      }

      const toast = document.createElement('div');
      const colors = {
        success: 'bg-emerald-600/90 text-white border-emerald-400/30',
        error: 'bg-rose-600/90 text-white border-rose-400/30',
        warning: 'bg-amber-600/90 text-white border-amber-400/30',
        info: 'bg-blue-600/90 text-white border-blue-400/30'
      };

      toast.className = `flex items-center gap-2.5 px-4 py-3 rounded-lg shadow-lg border text-sm backdrop-blur-md transition-all duration-300 transform translate-y-2 opacity-0 ${colors[type] || colors.info}`;
      
      const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : type === 'warning' ? '⚠' : 'ℹ';
      toast.innerHTML = `<span class="font-bold">${icon}</span><span>${message}</span>`;

      toastContainer.appendChild(toast);

      // Animate in
      requestAnimationFrame(() => {
        toast.classList.remove('translate-y-2', 'opacity-0');
      });

      // Remove after 2.2s
      setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => toast.remove(), 300);
      }, 2200);
    },

    bindLocalAiModal() {
      const modal = document.getElementById('localAiModal');
      const btnClose = document.getElementById('btnCloseLocalAiModal');
      const btnRefresh = document.getElementById('btnRefreshAiStatus');
      const btnOpen = document.getElementById('btnOpenLocalAi');
      const btnSaveConfig = document.getElementById('btnSaveAiConfig');
      const btnNarrative = document.getElementById('btnFetchAiNarrative');
      const chatForm = document.getElementById('aiChatForm');
      const chatInput = document.getElementById('aiChatInput');

      const btnOpenAttendee = document.getElementById('btnOpenAttendeeAiChat');
      if (btnOpen) {
        btnOpen.addEventListener('click', () => this.openLocalAiModal());
      }
      if (btnOpenAttendee) {
        btnOpenAttendee.addEventListener('click', () => this.openLocalAiModal());
      }

      if (btnClose && modal) {
        btnClose.addEventListener('click', () => this.closeLocalAiModal());
      }

      if (modal) {
        modal.addEventListener('click', (e) => {
          if (e.target === modal) this.closeLocalAiModal();
        });
      }

      if (btnRefresh) {
        btnRefresh.addEventListener('click', () => {
          this.checkAiStatus(true);
        });
      }

      // Copy command buttons
      document.querySelectorAll('.btn-copy-cmd').forEach((btn) => {
        btn.addEventListener('click', () => {
          const cmd = btn.getAttribute('data-cmd');
          if (cmd) {
            navigator.clipboard?.writeText(cmd).then(() => {
              const prev = btn.textContent;
              btn.textContent = 'Copied!';
              setTimeout(() => { btn.textContent = prev; }, 1800);
              this.showToast(`Copied to clipboard: "${cmd}"`, 'info');
            }).catch(() => {
              this.showToast(`Command: ${cmd}`, 'info');
            });
          }
        });
      });

      // Update AI config
      if (btnSaveConfig) {
        btnSaveConfig.addEventListener('click', async () => {
          const model = document.getElementById('aiConfigModel')?.value.trim() || 'qwen2.5:0.5b';
          const host = document.getElementById('aiConfigHost')?.value.trim() || 'http://127.0.0.1:11434';
          try {
            btnSaveConfig.textContent = 'Saving...';
            const res = await fetch('/api/ai/config', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ model, host })
            });
            const data = await res.json();
            if (data.success) {
              this.showToast(`Local AI configured: ${data.config.model}`, 'success');
              await this.checkAiStatus(false);
            }
          } catch (e) {
            this.showToast('Failed to update AI configuration', 'error');
          } finally {
            btnSaveConfig.textContent = 'Update Model Config';
          }
        });
      }

      // Model preset quick switch chips
      document.querySelectorAll('.btn-model-preset').forEach(btn => {
        btn.addEventListener('click', () => {
          const modelName = btn.getAttribute('data-model');
          const inputModel = document.getElementById('aiConfigModel');
          if (inputModel && modelName) {
            inputModel.value = modelName;
            btnSaveConfig?.click();
          }
        });
      });

      // Fetch AI narrative
      if (btnNarrative) {
        btnNarrative.addEventListener('click', async () => {
          await this.fetchEventAiNarrative();
        });
      }

      // Suggestion chips
      document.querySelectorAll('.ai-chat-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          if (chatInput) {
            chatInput.value = chip.textContent.trim();
            chatForm?.dispatchEvent(new Event('submit', { cancelable: true }));
          }
        });
      });

      // Chat Form submission
      if (chatForm) {
        chatForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const q = chatInput?.value.trim();
          if (!q) return;

          chatInput.value = '';
          this.appendAiChatMessage('user', q);

          // Get active event ID
          const selector = document.getElementById('eventSelector');
          const eventId = selector?.value || null;

          const typingId = this.appendAiChatMessage('ai', 'Thinking with Qwen AI...', true);

          try {
            const res = await fetch('/api/ai/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: q, question: q, prompt: q, event_id: eventId })
            });
            const data = await res.json();
            const reply = data.reply || data.answer || data.message || data.error || 'No response generated.';
            const modelTag = data.engine === 'ollama' || (data.ai_provider && data.ai_provider.startsWith('ollama'))
              ? `Qwen (${data.model || 'qwen2.5:3b'})`
              : 'Smart Engine';
            this.updateAiChatMessage(typingId, reply, modelTag);
          } catch (err) {
            this.updateAiChatMessage(typingId, 'Error connecting to AI service. Please try again.', 'Error');
          }
        });
      }

      // Initial check on page load
      this.checkAiStatus(false);
    },

    openLocalAiModal() {
      const modal = document.getElementById('localAiModal');
      if (modal) {
        modal.classList.remove('hidden');
        this.checkAiStatus(false);
      }
    },

    closeLocalAiModal() {
      const modal = document.getElementById('localAiModal');
      if (modal) modal.classList.add('hidden');
    },

    async checkAiStatus(notify = false) {
      try {
        const res = await fetch('/api/ai/status');
        const data = await res.json();
        const isOnline = data && data.connected;

        // Drawer badge
        const drawerBadge = document.getElementById('drawerAiStatusBadge');
        if (drawerBadge) {
          if (isOnline) {
            drawerBadge.textContent = 'Qwen Online';
            drawerBadge.className = 'text-[9px] font-mono px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700';
          } else {
            drawerBadge.textContent = 'Fallback Mode';
            drawerBadge.className = 'text-[9px] font-mono px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-700';
          }
        }

        // Hero badge
        const heroBadge = document.getElementById('btnOpenLocalAiBadge');
        if (heroBadge) {
          heroBadge.className = isOnline
            ? 'absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-900 animate-pulse'
            : 'absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-400 ring-2 ring-white dark:ring-slate-900';
        }

        // Modal badge
        const modalBadge = document.getElementById('aiModalStatusBadge');
        if (modalBadge) {
          if (isOnline) {
            modalBadge.textContent = `● Ollama Online (${data.active_model})`;
            modalBadge.className = 'text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 font-bold';
          } else {
            modalBadge.textContent = '● Ollama Daemon Offline (Fallback active)';
            modalBadge.className = 'text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700 font-bold';
          }
        }

        const statusDot = document.getElementById('aiStatusDot');
        if (statusDot) {
          statusDot.className = isOnline
            ? 'w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse'
            : 'w-2.5 h-2.5 rounded-full bg-amber-500';
        }

        const headline = document.getElementById('aiStatusHeadline');
        if (headline) {
          if (isOnline) {
            headline.textContent = `Ollama Daemon Connected • Model: ${data.active_model}`;
          } else {
            headline.textContent = 'Ollama Daemon Offline (Smart Heuristic Fallback Active)';
          }
        }

        const inputModel = document.getElementById('aiConfigModel');
        if (inputModel && data.active_model) inputModel.value = data.active_model;

        const inputHost = document.getElementById('aiConfigHost');
        if (inputHost && data.ollama_host) inputHost.value = data.ollama_host;

        if (notify) {
          if (isOnline) {
            this.showToast(`Connected to Ollama! Active model: ${data.active_model}`, 'success');
          } else {
            this.showToast('Ollama daemon is offline. Running on smart built-in fallback.', 'info');
          }
        }

        return data;
      } catch (err) {
        console.warn('AI status check failed:', err);
      }
    },

    async fetchEventAiNarrative() {
      const selector = document.getElementById('eventSelector');
      const eventId = selector?.value;
      const box = document.getElementById('aiNarrativeBox');
      const btn = document.getElementById('btnFetchAiNarrative');

      if (!eventId) {
        this.showToast('Please create or select an event first!', 'warning');
        if (box) box.innerHTML = '<span class="text-slate-400 italic">No active event found. Create an event to synthesize insights.</span>';
        return;
      }

      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Synthesizing...';
      }
      if (box) {
        box.innerHTML = '<span class="text-slate-500 italic animate-pulse">Consulting Qwen AI engine with live attendance telemetry...</span>';
      }

      try {
        const res = await fetch(`/api/events/${eventId}/ai-insights`);
        const data = await res.json();
        if (data && data.insights) {
          const ins = data.insights;
          const engineTag = data.engine === 'ollama' ? `Qwen (${data.model})` : 'Smart Engine';
          if (box) {
            box.innerHTML = `
              <div class="space-y-2 w-full">
                <div class="flex items-center justify-between text-[11px] font-bold pb-1 border-b border-slate-200 dark:border-slate-800">
                  <span class="text-slate-900 dark:text-white">Session Analysis • ${ins.turnout_health || 'NORMAL'}</span>
                  <span class="text-[10px] font-mono text-emerald-600 dark:text-emerald-400">Generated by ${engineTag}</span>
                </div>
                <p class="text-slate-800 dark:text-slate-200 text-xs leading-relaxed">${ins.summary_narrative || 'Attendance telemetry is steady.'}</p>
                <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 text-[11px] font-mono">
                  <div class="p-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                    <span class="text-[9px] text-slate-400 block uppercase">Projected Total</span>
                    <span class="font-bold text-slate-900 dark:text-white">${ins.projected_final_turnout || 0}</span>
                  </div>
                  <div class="p-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                    <span class="text-[9px] text-slate-400 block uppercase">Velocity</span>
                    <span class="font-bold text-slate-900 dark:text-white">${ins.peak_scan_velocity || 'Steady'}</span>
                  </div>
                  <div class="p-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 col-span-2 sm:col-span-1">
                    <span class="text-[9px] text-slate-400 block uppercase">Breach Risk</span>
                    <span class="font-bold text-slate-900 dark:text-white">${ins.anomaly_alert || 'Low'}</span>
                  </div>
                </div>
                ${ins.action_recommendation ? `<p class="text-[11px] font-medium text-amber-700 dark:text-amber-400 pt-1">💡 <b>Recommendation:</b> ${ins.action_recommendation}</p>` : ''}
              </div>
            `;
          }
          this.showToast(`Turnout synthesized with ${engineTag}`, 'success');
        } else {
          throw new Error('Failed to retrieve insights');
        }
      } catch (err) {
        console.error('Fetch AI narrative error:', err);
        if (box) box.innerHTML = '<span class="text-rose-500 text-xs">Error generating narrative. Check connection and try again.</span>';
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Synthesize Live Narrative';
        }
      }
    },

    appendAiChatMessage(role, text, isTyping = false) {
      const container = document.getElementById('aiChatConversation');
      if (!container) return null;

      const id = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
      const isUser = role === 'user';

      const bubble = document.createElement('div');
      bubble.id = id;
      bubble.className = isUser
        ? 'p-2.5 rounded-xl bg-slate-900 text-white ml-6 text-right'
        : 'p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 mr-6 text-slate-800 dark:text-slate-200';

      const label = isUser ? 'You' : '🤖 Qwen AI';
      bubble.innerHTML = `
        <span class="block text-[10px] font-bold uppercase tracking-wider mb-0.5 ${isUser ? 'text-slate-300' : 'text-slate-500 dark:text-slate-400'}">${label}</span>
        <div class="message-content text-xs whitespace-pre-wrap leading-relaxed ${isTyping ? 'animate-pulse italic text-slate-400' : ''}">${this.escapeHtml(text)}</div>
      `;

      container.appendChild(bubble);
      container.scrollTop = container.scrollHeight;
      return id;
    },

    updateAiChatMessage(id, text, tag = '') {
      const el = document.getElementById(id);
      if (!el) return;
      const contentEl = el.querySelector('.message-content');
      if (contentEl) {
        contentEl.classList.remove('animate-pulse', 'italic', 'text-slate-400');
        contentEl.textContent = text;
      }
      if (tag) {
        const tagSpan = document.createElement('span');
        tagSpan.className = 'block text-[9px] font-mono text-slate-400 mt-1';
        tagSpan.textContent = `via ${tag}`;
        el.appendChild(tagSpan);
      }
      const container = document.getElementById('aiChatConversation');
      if (container) container.scrollTop = container.scrollHeight;
    },

    escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }
  };

  global.App = App;

  document.addEventListener('DOMContentLoaded', () => {
    App.init();
  });
})(typeof window !== 'undefined' ? window : global);
