/**
 * Interactive Geofence Map & Radar Component
 * Provides rich visualization of venue location, geofence radius boundary, and attendee pins.
 * Automatically falls back to high-resolution Canvas Radar if map tiles are blocked or offline.
 */

(function (global) {
  class GeofenceVisualizer {
    constructor(containerId, options = {}) {
      this.container = document.getElementById(containerId);
      this.options = Object.assign({
        venueLat: 37.78417,
        venueLng: -122.40156,
        radiusMeters: 80,
        interactive: false,
        onLocationSelected: null,
        theme: 'dark'
      }, options);

      this.attendees = [];
      this.userLocation = null;
      this.leafletMap = null;
      this.venueMarker = null;
      this.geofenceCircle = null;
      this.attendeeMarkersLayer = null;
      this.userMarker = null;

      this.init();
    }

    init() {
      if (!this.container) return;

      // Check if Leaflet is available
      if (typeof window.L !== 'undefined') {
        this.initLeaflet();
      } else {
        this.initCanvasRadar();
      }
    }

    initLeaflet() {
      try {
        this.leafletMap = window.L.map(this.container).setView(
          [this.options.venueLat, this.options.venueLng],
          17
        );

        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap contributors',
          maxZoom: 19
        }).addTo(this.leafletMap);

        // Geofence Circle
        this.geofenceCircle = window.L.circle([this.options.venueLat, this.options.venueLng], {
          color: '#3b82f6',
          fillColor: '#3b82f6',
          fillOpacity: 0.15,
          radius: this.options.radiusMeters,
          weight: 2
        }).addTo(this.leafletMap);

        // Venue Marker
        this.venueMarker = window.L.marker([this.options.venueLat, this.options.venueLng], {
          draggable: Boolean(this.options.interactive)
        }).addTo(this.leafletMap);

        this.venueMarker.bindPopup('<b>Event Venue</b><br>Geofence Center').openPopup();

        if (this.options.interactive) {
          this.venueMarker.on('dragend', (e) => {
            const pos = e.target.getLatLng();
            this.updateVenue(pos.lat, pos.lng, this.options.radiusMeters);
            if (this.options.onLocationSelected) {
              this.options.onLocationSelected(pos.lat, pos.lng);
            }
          });

          this.leafletMap.on('click', (e) => {
            this.updateVenue(e.latlng.lat, e.latlng.lng, this.options.radiusMeters);
            if (this.options.onLocationSelected) {
              this.options.onLocationSelected(e.latlng.lat, e.latlng.lng);
            }
          });
        }

        this.attendeeMarkersLayer = window.L.layerGroup().addTo(this.leafletMap);
        return;
      } catch (e) {
        console.warn('Leaflet initialization fallback to Canvas Radar:', e);
        this.initCanvasRadar();
      }
    }

    initCanvasRadar() {
      this.container.innerHTML = '';
      const canvas = document.createElement('canvas');
      canvas.className = 'w-full h-full rounded-xl';
      this.container.appendChild(canvas);
      this.canvas = canvas;

      const resize = () => {
        const rect = this.container.getBoundingClientRect();
        canvas.width = rect.width * (window.devicePixelRatio || 1);
        canvas.height = rect.height * (window.devicePixelRatio || 1);
        this.drawRadar();
      };

      window.addEventListener('resize', resize);
      setTimeout(resize, 50);

      // Radar sweep animation
      this.radarAngle = 0;
      const animate = () => {
        this.radarAngle = (this.radarAngle + 0.02) % (Math.PI * 2);
        this.drawRadar();
        this.animFrame = requestAnimationFrame(animate);
      };
      this.animFrame = requestAnimationFrame(animate);

      if (this.options.interactive) {
        canvas.addEventListener('click', (e) => {
          const rect = canvas.getBoundingClientRect();
          const x = (e.clientX - rect.left) / rect.width;
          const y = (e.clientY - rect.top) / rect.height;
          // Offset relative to center (-0.5 to +0.5)
          const dx = (x - 0.5) * 0.003;
          const dy = (0.5 - y) * 0.003;
          const newLat = this.options.venueLat + dy;
          const newLng = this.options.venueLng + dx;
          this.options.venueLat = newLat;
          this.options.venueLng = newLng;
          if (this.options.onLocationSelected) {
            this.options.onLocationSelected(newLat, newLng);
          }
          this.drawRadar();
        });
      }
    }

    updateVenue(lat, lng, radiusMeters) {
      this.options.venueLat = lat;
      this.options.venueLng = lng;
      if (radiusMeters !== undefined) this.options.radiusMeters = radiusMeters;

      if (this.leafletMap) {
        this.venueMarker.setLatLng([lat, lng]);
        this.geofenceCircle.setLatLng([lat, lng]);
        this.geofenceCircle.setRadius(this.options.radiusMeters);
        this.leafletMap.panTo([lat, lng]);
      } else {
        this.drawRadar();
      }
    }

    setAttendees(attendees = []) {
      this.attendees = attendees;

      if (this.leafletMap && this.attendeeMarkersLayer) {
        this.attendeeMarkersLayer.clearLayers();

        attendees.forEach(a => {
          if (!a.latitude || !a.longitude) return;
          const isVerified = a.status === 'VERIFIED';
          const markerColor = isVerified ? '#10b981' : '#ef4444';

          const marker = window.L.circleMarker([a.latitude, a.longitude], {
            radius: 6,
            fillColor: markerColor,
            color: '#ffffff',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.9
          });

          marker.bindPopup(`
            <div class="text-xs">
              <strong class="${isVerified ? 'text-emerald-600' : 'text-rose-600'}">${a.name}</strong><br>
              <span>${a.student_id}</span><br>
              <span>Distance: <b>${a.distance_meters}m</b> (${a.status})</span><br>
              <span class="text-gray-400">${new Date(a.checkin_time).toLocaleTimeString()}</span>
            </div>
          `);

          this.attendeeMarkersLayer.addLayer(marker);
        });
      } else {
        this.drawRadar();
      }
    }

    setUserLocation(lat, lng, distanceMeters, isWithin) {
      this.userLocation = { lat, lng, distanceMeters, isWithin };

      if (this.leafletMap) {
        if (this.userMarker) {
          this.leafletMap.removeLayer(this.userMarker);
        }
        this.userMarker = window.L.circleMarker([lat, lng], {
          radius: 8,
          fillColor: isWithin ? '#3b82f6' : '#f59e0b',
          color: '#ffffff',
          weight: 3,
          fillOpacity: 1
        }).addTo(this.leafletMap);

        this.userMarker.bindPopup(`<b>Your GPS Location</b><br>Distance: ${distanceMeters}m`).openPopup();
      } else {
        this.drawRadar();
      }
    }

    drawRadar() {
      if (!this.canvas) return;
      const ctx = this.canvas.getContext('2d');
      const w = this.canvas.width;
      const h = this.canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const maxRadius = Math.min(cx, cy) - 20;

      // Clear dark/tech radar background
      ctx.fillStyle = '#0b1120';
      ctx.fillRect(0, 0, w, h);

      // Grid concentric circles
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      for (let i = 1; i <= 4; i++) {
        ctx.beginPath();
        ctx.arc(cx, cy, (maxRadius / 4) * i, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Crosshairs
      ctx.beginPath();
      ctx.moveTo(cx, 10);
      ctx.lineTo(cx, h - 10);
      ctx.moveTo(10, cy);
      ctx.lineTo(w - 10, cy);
      ctx.stroke();

      // Geofence boundary circle (scaled: geofence radius = ~60% of radar)
      const fencePixelRadius = maxRadius * 0.55;
      ctx.beginPath();
      ctx.arc(cx, cy, fencePixelRadius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(59, 130, 246, 0.12)';
      ctx.fill();
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 6]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Rotating Radar Beam Sweep
      const beamGradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxRadius);
      beamGradient.addColorStop(0, 'rgba(59, 130, 246, 0)');
      beamGradient.addColorStop(1, 'rgba(59, 130, 246, 0.18)');

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, maxRadius, this.radarAngle, this.radarAngle + 0.5);
      ctx.closePath();
      ctx.fillStyle = beamGradient;
      ctx.fill();
      ctx.restore();

      // Venue center beacon
      ctx.beginPath();
      ctx.arc(cx, cy, 7, 0, Math.PI * 2);
      ctx.fillStyle = '#60a5fa';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Venue label
      ctx.fillStyle = '#93c5fd';
      ctx.font = 'bold 12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('VENUE CENTER', cx, cy - 14);
      ctx.font = '10px Inter, sans-serif';
      ctx.fillStyle = '#64748b';
      ctx.fillText(`Geofence: ${this.options.radiusMeters}m radius`, cx, cy + 24);

      // Plot attendees on radar
      const metersToPixels = fencePixelRadius / (this.options.radiusMeters || 100);

      this.attendees.forEach(a => {
        // Approximate local delta meters from coordinates
        const dLat = (a.latitude - this.options.venueLat) * 111000;
        const dLng = (a.longitude - this.options.venueLng) * (111000 * Math.cos((this.options.venueLat * Math.PI) / 180));

        const px = cx + dLng * metersToPixels;
        const py = cy - dLat * metersToPixels;

        // Clip to radar bounds
        const dist = Math.hypot(px - cx, py - cy);
        if (dist <= maxRadius) {
          const isVerified = a.status === 'VERIFIED';
          ctx.beginPath();
          ctx.arc(px, py, 5, 0, Math.PI * 2);
          ctx.fillStyle = isVerified ? '#10b981' : '#ef4444';
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.stroke();

          // Small tag
          ctx.font = '9px Inter, sans-serif';
          ctx.fillStyle = isVerified ? '#a7f3d0' : '#fca5a5';
          ctx.fillText(a.name.split(' ')[0], px, py - 8);
        }
      });

      // User location dot (if available)
      if (this.userLocation) {
        const dLat = (this.userLocation.lat - this.options.venueLat) * 111000;
        const dLng = (this.userLocation.lng - this.options.venueLng) * (111000 * Math.cos((this.options.venueLat * Math.PI) / 180));
        const ux = cx + dLng * metersToPixels;
        const uy = cy - dLat * metersToPixels;

        ctx.beginPath();
        ctx.arc(ux, uy, 8, 0, Math.PI * 2);
        ctx.fillStyle = '#f59e0b';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.font = 'bold 10px Inter, sans-serif';
        ctx.fillStyle = '#fde68a';
        ctx.fillText('YOU', ux, uy - 12);
      }
    }

    destroy() {
      if (this.animFrame) {
        cancelAnimationFrame(this.animFrame);
      }
      if (this.leafletMap) {
        this.leafletMap.remove();
        this.leafletMap = null;
      }
    }
  }

  global.GeofenceVisualizer = GeofenceVisualizer;
})(typeof window !== 'undefined' ? window : global);
