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
          window.location.hash = '';
          setTimeout(() => {
            if (err === 'no_client_id') {
              this.openGoogleAuthModal(true);
              this.showToast('Google OAuth Client ID required for accounts.google.com redirection.', 'warning');
            } else {
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

      // Theme toggle in drawer
      const btnToggleTheme = document.getElementById('drawerToggleTheme');
      if (btnToggleTheme) {
        btnToggleTheme.addEventListener('click', () => {
          const current = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
          const next = current === 'dark' ? 'light' : 'dark';
          this.setTheme(next);
          this.showToast(`${next === 'dark' ? '🌙 Dark Mode' : '☀️ Light Mode'} Activated`, 'info');
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
      const isDark = document.documentElement.classList.contains('dark');
      const themeIcon = document.getElementById('drawerThemeIcon');
      const themeText = document.getElementById('drawerThemeText');
      if (themeIcon) themeIcon.textContent = isDark ? '🌙' : '☀️';
      if (themeText) themeText.textContent = isDark ? 'Dark Mode' : 'Light Mode';
    },

    initTheme() {
      const saved = localStorage.getItem('geoattend_theme');
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      const initialTheme = saved ? saved : (prefersDark ? 'dark' : 'light');
      this.setTheme(initialTheme);

      const toggleBtn = document.getElementById('btnToggleDarkMode');
      if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
          const current = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
          const next = current === 'dark' ? 'light' : 'dark';
          this.setTheme(next);
          this.showToast(`${next === 'dark' ? '🌙 Dark Mode' : '☀️ Light Mode'} Activated`, 'info');
        });
      }
    },

    setTheme(theme) {
      const moon = document.getElementById('iconDarkModeMoon');
      const sun = document.getElementById('iconDarkModeSun');
      if (theme === 'dark') {
        document.documentElement.classList.add('dark');
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('geoattend_theme', 'dark');
        if (moon) moon.classList.add('hidden');
        if (sun) sun.classList.remove('hidden');
      } else {
        document.documentElement.classList.remove('dark');
        document.documentElement.setAttribute('data-theme', 'light');
        localStorage.setItem('geoattend_theme', 'light');
        if (moon) moon.classList.remove('hidden');
        if (sun) sun.classList.add('hidden');
      }
      this.updateDrawerThemeUI();
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
              this.showToast('Google OAuth Client ID required. Follow the steps below or use instant test accounts.', 'warning');
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
          this.showToast('Redirecting to Google sign-in page...', 'info');
          window.location.href = '/api/auth/google/login';
        } else {
          this.openGoogleAuthModal(true);
        }
      } catch (e) {
        window.location.href = '/api/auth/google/login';
      }
    },

    openGoogleAuthModal(showSetup = false) {
      const modal = document.getElementById('googleAuthModal');
      if (modal) modal.classList.remove('hidden');
      this.checkGoogleOAuthConfig();
      const setupSection = document.getElementById('googleSetupSection');
      if (setupSection && showSetup) {
        setupSection.classList.remove('hidden');
      }
    },

    closeGoogleAuthModal() {
      const modal = document.getElementById('googleAuthModal');
      if (modal) modal.classList.add('hidden');
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

        this.updateAuthUI();
        if (showFeedback) {
          this.showToast(`Signed in as ${data.user.name} (${data.user.email})`, 'success');
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

        // Refresh attendee upcoming events and pass card immediately
        if (global.Attendee && typeof global.Attendee.loadUpcomingEvents === 'function') {
          global.Attendee.loadUpcomingEvents();
        }
        if (global.Attendee && typeof global.Attendee.refreshPassCard === 'function') {
          global.Attendee.refreshPassCard();
        }
      }

      this.updateDrawerUI();
    },

    showToast(message, type = 'info') {
      const toastContainer = document.getElementById('toastContainer');
      if (!toastContainer) return;

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

      // Remove after 3.5s
      setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => toast.remove(), 300);
      }, 3500);
    }
  };

  global.App = App;

  document.addEventListener('DOMContentLoaded', () => {
    App.init();
  });
})(typeof window !== 'undefined' ? window : global);
