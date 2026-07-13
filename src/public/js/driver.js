/* ============================================================
   driver.js — Driver portal JS
   ============================================================ */
let gpsWatchId = null;
let driverTrackingSocket = null;
let driverLiveMap = null;
let driverBusMarker = null;

document.addEventListener('DOMContentLoaded', () => {
  if (window.liveTripData) return;

  initCurrentDate();
  initStatCounters();
  initTripControls();
  initRouteStopToggles();
  initAttendanceTable();
  initDriverLiveMap();
  startGPSTrackingIfActive();
});

/* ── Live GPS Tracking ── */
function startGPSTrackingIfActive() {
  const tripId = getActiveTripId();
  if (!tripId || !navigator.geolocation) return;

  loadSocketIO(() => {
    try {
      driverTrackingSocket = io();
    } catch (_) {
      driverTrackingSocket = null;
    }
  });

  gpsWatchId = navigator.geolocation.watchPosition(
    (pos) => broadcastDriverLocation(tripId, pos.coords),
    () => setGpsStatus('error', 'GPS unavailable'),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 }
  );
}

function getActiveTripId() {
  const explicitMap = document.getElementById('driverLiveMap');
  if (explicitMap?.dataset.liveTripId) return explicitMap.dataset.liveTripId;

  const endBtn = document.getElementById('endTripBtn') || document.getElementById('btnEndTrip');
  return endBtn?.dataset.tripId || '';
}

function broadcastDriverLocation(tripId, coords) {
  const latitude = Number(coords.latitude);
  const longitude = Number(coords.longitude);
  if (!tripId || Number.isNaN(latitude) || Number.isNaN(longitude)) return;

  const speedKmh = coords.speed && coords.speed > 0 ? coords.speed * 3.6 : 0;
  const mapEl = document.getElementById('driverLiveMap');
  const tripEl = document.getElementById('endTripBtn') || document.getElementById('btnEndTrip');
  const payload = {
    trip_id: tripId,
    latitude,
    longitude,
    speed: speedKmh,
    accuracy: coords.accuracy || null,
    heading: coords.heading || null,
    routeName: mapEl?.dataset.routeName || tripEl?.dataset.routeName || '',
    vehicleNumber: mapEl?.dataset.vehicleNumber || tripEl?.dataset.vehicleNumber || '',
    driverName: mapEl?.dataset.driverName || tripEl?.dataset.driverName || ''
  };

  updateGpsTelemetry(payload);
  updateDriverLiveMap(payload);
  setGpsStatus('active', 'Broadcasting GPS');

  if (driverTrackingSocket) {
    driverTrackingSocket.emit('update_location', payload);
  }

  const now = Date.now();
  if (!broadcastDriverLocation._lastPostAt || now - broadcastDriverLocation._lastPostAt > 18000) {
    broadcastDriverLocation._lastPostAt = now;
    fetch('/driver/transport/location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(() => {});
  }
}

function updateGpsTelemetry(data) {
  const lat = Number(data.latitude);
  const lng = Number(data.longitude);
  const speed = Number(data.speed || 0);
  const accuracy = data.accuracy ? `${Math.round(data.accuracy)} m` : '—';
  const updated = new Date(data.timestamp || Date.now()).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  setText('gpsDisplay', `Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`);
  setText('telLat', lat.toFixed(6));
  setText('telLng', lng.toFixed(6));
  setText('telSpeed', `${speed.toFixed(1)} km/h`);
  setText('telAcc', accuracy);
  setText('telUpdated', updated);
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setGpsStatus(state, message) {
  const badge = document.getElementById('gpsStatusBadge');
  const text = document.getElementById('gpsStatusText');
  if (badge) {
    badge.classList.remove('idle', 'active', 'error');
    badge.classList.add(state);
  }
  if (text) text.textContent = message;
}

function initDriverLiveMap() {
  const el = document.getElementById('driverLiveMap');
  if (!el || typeof L === 'undefined') {
    bindRefreshGpsButton();
    return;
  }

  // Prevent double-initialization when page includes another inline map initializer
  if (el._leaflet_id || el.dataset._leafletInit) {
    bindRefreshGpsButton();
    return;
  }
  el.dataset._leafletInit = '1';

  const defaultCoords = [23.0225, 72.5714];
  driverLiveMap = L.map(el).setView(defaultCoords, 13);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(driverLiveMap);

  bindRefreshGpsButton();
}

function bindRefreshGpsButton() {
  const refreshBtn = document.getElementById('btnRefreshGps');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      refreshBtn.disabled = true;
      refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Locating...';
      refreshDriverGps(() => {
        refreshBtn.disabled = false;
        refreshBtn.innerHTML = '<i class="fas fa-location-arrow"></i> Refresh GPS';
      });
    });
  }
}

function refreshDriverGps(done) {
  const tripId = getActiveTripId();
  if (!tripId || !navigator.geolocation) {
    if (done) done();
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      broadcastDriverLocation(tripId, pos.coords);
      if (done) done();
    },
    () => {
      setGpsStatus('error', 'GPS unavailable');
      if (done) done();
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

window.refreshDriverGps = refreshDriverGps;

function updateDriverLiveMap(data) {
  if (!driverLiveMap) return;
  const latlng = [Number(data.latitude), Number(data.longitude)];
  if (latlng.some(Number.isNaN)) return;

  const routeName = data.routeName || 'Current Trip';
  const vehicleNumber = data.vehicleNumber || 'Assigned Bus';
  const speed = Number(data.speed || 0).toFixed(1);
  const updated = new Date(data.timestamp || Date.now()).toLocaleTimeString('en-IN');

  if (!driverBusMarker) {
    driverBusMarker = L.marker(latlng, {
      icon: L.divIcon({
        className: '',
        html: '<div class="driver-bus-icon"><i class="fas fa-bus"></i></div>',
        iconSize: [46, 46],
        iconAnchor: [23, 23]
      })
    }).addTo(driverLiveMap);
    driverLiveMap.setView(latlng, 16);
  } else {
    driverBusMarker.setLatLng(latlng);
  }

  driverBusMarker.bindPopup(`
    <div style="min-width:150px;font-family:Inter,Arial,sans-serif;">
      <strong style="color:#EA580C;">${routeName}</strong><br>
      <span style="font-size:12px;color:#475569;">Vehicle: ${vehicleNumber}</span><br>
      <span style="font-size:12px;color:#475569;">Speed: ${speed} km/h</span><br>
      <span style="font-size:11px;color:#94A3B8;">Updated: ${updated}</span>
    </div>
  `);
}

function loadSocketIO(callback) {
  if (typeof io !== 'undefined') {
    callback();
    return;
  }
  const script = document.createElement('script');
  script.src = '/socket.io/socket.io.js';
  script.onload = callback;
  script.onerror = () => console.error('Failed to load socket.io client script');
  document.head.appendChild(script);
}

/* ── Current date & time ── */
function initCurrentDate() {
  const el = document.getElementById('currentDate');
  if (el) el.textContent = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  // Live clock
  const clock = document.getElementById('liveClock');
  if (clock) {
    function updateClock() {
      clock.textContent = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    updateClock();
    setInterval(updateClock, 1000);
  }
}

/* ── Stat counters ── */
function initStatCounters() {
  document.querySelectorAll('.stat-value[data-target], .counter[data-target]').forEach(el => {
    const target = parseInt(el.dataset.target) || 0;
    if (!target) return;
    const start = performance.now(), dur = 1100;
    el.textContent = '0';
    (function tick(now) {
      const p = Math.min((now - start) / dur, 1);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
    })(start);
  });
}

/* ── Trip start / end controls ── */
function initTripControls() {
  const startBtn = document.getElementById('startTripBtn');
  const endBtn   = document.getElementById('endTripBtn');

  if (startBtn) {
    startBtn.addEventListener('click', function () {
      const selectedRadio = document.querySelector('input[name="trip_type"]:checked');
      const tripType = selectedRadio ? selectedRadio.value : 'pickup';
      const labelText = tripType === 'pickup' ? 'Pick Up' : 'Drop';
      
      if (!confirm(`Start today's ${labelText} trip?`)) return;
      this.disabled = true;
      this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Starting…';
      fetch('/driver/trips/start', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trip_type: tripType })
      })
        .then(r => r.json())
        .then(d => {
          if (d.success) {
            window.showToast?.('Trip started! Stay safe 🚌', 'success');
            setTimeout(() => location.reload(), 900);
          } else {
            window.showToast?.(d.message || 'Could not start trip', 'error');
            this.disabled = false;
            this.innerHTML = '<i class="fas fa-play me-2"></i>Start Trip';
          }
        })
        .catch(() => {
          window.showToast?.('Network error', 'error');
          this.disabled = false;
          this.innerHTML = '<i class="fas fa-play me-2"></i>Start Trip';
        });
    });
  }

  if (endBtn) {
    endBtn.addEventListener('click', function () {
      if (window.confirmAction) {
        confirmAction('Are all students dropped? This will end today\'s trip.', () => endTrip(this), {
          title: 'End Trip',
          confirmText: 'End Trip',
        });
      } else if (confirm('End trip?')) {
        endTrip(this);
      }
    });
  }
}

function endTrip(btn) {
  // Accept either the button element, an Event, or nothing (will resolve button by id)
  let elBtn = null;
  if (!btn) elBtn = document.getElementById('btnEndTrip');
  else if (btn instanceof Event) elBtn = btn.currentTarget || btn.target || document.getElementById('btnEndTrip');
  else if (btn && btn.dataset) elBtn = btn;
  else elBtn = document.getElementById('btnEndTrip');

  if (!elBtn) {
    console.warn('[endTrip] End trip button not found');
    return;
  }

  const original = elBtn.innerHTML;
  elBtn.disabled = true;
  elBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Ending…';

  const tripId = elBtn.dataset.tripId || getActiveTripId() || '';
  if (!tripId) {
    console.warn('[endTrip] No tripId available');
    window.showToast?.('No running trip found.', 'error');
    elBtn.disabled = false;
    elBtn.innerHTML = original;
    return;
  }

  fetch(`/driver/trips/${tripId}/end`, { 
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ tripId })
  })
    .then(r => r.json())
    .then(d => {
      if (d.success) {
        window.showToast?.('Trip completed. Good work! ✅', 'success');
        setTimeout(() => location.reload(), 900);
      } else {
        window.showToast?.(d.message || 'Could not end trip', 'error');
        elBtn.disabled = false;
        elBtn.innerHTML = original;
      }
    })
    .catch((err) => {
      console.error('[endTrip] Network error', err);
      window.showToast?.('Network error', 'error');
      elBtn.disabled = false;
      elBtn.innerHTML = original;
    });
}

/* ── Route stop pick-up / drop-off toggles ── */
function initRouteStopToggles() {
  document.querySelectorAll('.route-dot[data-stop-id]').forEach(dot => {
    dot.addEventListener('click', function () {
      const tripId = getActiveTripId();
      if (!tripId) return;
      const stopId = this.dataset.stopId;
      const status = this.classList.contains('picked') ? 'dropped' : 'picked';
      fetch(`/driver/transport/trips/${tripId}/stops/mark`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ stopId, status })
      })
        .then(r => r.json())
        .then(d => {
          if (d.success) {
            this.classList.toggle('picked', status === 'picked');
            this.classList.toggle('dropped', status === 'dropped');
            updateStudentCount();
          } else {
            window.showToast?.(d.message || 'Update failed', 'error');
          }
        })
        .catch(() => window.showToast?.('Network error', 'error'));
    });
  });
}

function updateStudentCount() {
  const picked = document.querySelectorAll('.route-dot.picked').length;
  const el = document.querySelector('.stat-box [data-picked]');
  if (el) el.textContent = picked;
}

/* ── Student attendance checkboxes (per-trip) ── */
function initAttendanceTable() {
  const checkboxes = document.querySelectorAll('.student-att-check[data-student-id]');
  if (!checkboxes.length) return;
  checkboxes.forEach(cb => {
    cb.addEventListener('change', function () {
      const studentId = this.dataset.studentId;
      const present   = this.checked;
      const row       = this.closest('tr');
      if (row) row.style.background = present ? '#F0FDF4' : '#FEF2F2';
    });
  });

  /* Submit all attendance */
  const submitBtn = document.getElementById('submitAttendanceBtn');
  if (!submitBtn) return;
  const tripId = getActiveTripId();
  if (!tripId) return;
  submitBtn.addEventListener('click', function () {
    const records = [];
    checkboxes.forEach(cb => {
      records.push({ studentId: cb.dataset.studentId, present: cb.checked });
    });
    this.disabled = true;
    this.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Saving…';
    Promise.all(records.map(record => fetch(`/driver/transport/trips/${tripId}/students/${record.studentId}/mark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ status: record.present ? 'picked' : 'absent' }),
    }).then(r => r.json())))
      .then(results => {
        const failed = results.find(d => !d.success);
        if (failed) throw new Error(failed.message || 'Save failed');
        window.showToast?.('Attendance saved', 'success');
        this.innerHTML = '<i class="fas fa-check me-2"></i>Saved';
      })
      .catch((err) => {
        window.showToast?.(err.message || 'Network error', 'error');
        this.disabled = false;
        this.innerHTML = 'Save Attendance';
      });
  });
}

/* ── SOS / Emergency button ── */
window.triggerSOS = function() {
  if (!confirm('🚨 Send emergency alert to school admin?')) return;
  navigator.geolocation.getCurrentPosition(pos => {
    fetch('/driver/sos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      }),
    })
      .then(r => r.json())
      .then(d => window.showToast?.(d.success ? '🚨 SOS sent to school!' : 'SOS failed', d.success ? 'warning' : 'error'));
  }, () => {
    fetch('/driver/sos', { method: 'POST' })
      .then(r => r.json())
      .then(d => window.showToast?.(d.success ? '🚨 SOS sent!' : 'SOS failed', d.success ? 'warning' : 'error'));
  });
};
