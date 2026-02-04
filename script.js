// script.js - GPS-based Step Counter
// Note: a website cannot access Apple Health on iPhone. This app estimates steps
// from GPS distance (Haversine). GPS accuracy varies and may consume battery.

const STORAGE_KEYS = {
  distance: 'gps_distance_m',
  goal: 'gps_goal',
  stride: 'gps_stride_m',
  date: 'gps_date'
};

const DEFAULT_GOAL = 10000;
const DEFAULT_STRIDE = 0.78; // meters

// guardrails
const MAX_ACCEPTABLE_ACCURACY = 25; // meters
const MAX_SPEED_MPS = 8; // 8 m/s (~28.8 km/h)

// DOM elements
let stepCountEl, statusEl, distanceEl, speedEl, accuracyEl;
let goalLabelEl, remainingLabelEl, progressFillEl, progressBarEl, progressPercentEl, goalMessageEl;
let goalInputEl, strideInputEl, startBtn, pauseBtn, resetBtn, saveSettingsBtn;

// runtime vars
let watchId = null;
let lastPos = null; // {lat, lon, timestamp}

function todayString() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function loadState() {
  const rawDist = parseFloat(localStorage.getItem(STORAGE_KEYS.distance));
  const goal = parseInt(localStorage.getItem(STORAGE_KEYS.goal), 10);
  const stride = parseFloat(localStorage.getItem(STORAGE_KEYS.stride));
  const storedDate = localStorage.getItem(STORAGE_KEYS.date);

  const state = {
    distance: Number.isFinite(rawDist) && rawDist >= 0 ? rawDist : 0,
    goal: Number.isFinite(goal) && goal >= 100 ? goal : DEFAULT_GOAL,
    stride: Number.isFinite(stride) && stride > 0 ? stride : DEFAULT_STRIDE,
    date: storedDate || todayString()
  };

  // auto-reset daily
  if (state.date !== todayString()) {
    state.distance = 0;
    state.date = todayString();
    saveState(state);
  }

  state.steps = Math.floor(state.distance / state.stride);
  return state;
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEYS.distance, String(state.distance));
  localStorage.setItem(STORAGE_KEYS.goal, String(state.goal));
  localStorage.setItem(STORAGE_KEYS.stride, String(state.stride));
  localStorage.setItem(STORAGE_KEYS.date, state.date || todayString());
}

// Haversine formula
function distanceInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const toRad = v => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function formatDistance(m) {
  if (m >= 1000) return (m / 1000).toFixed(2) + ' km';
  return Math.round(m) + ' m';
}

function updateUI(state, extras = {}) {
  const steps = Math.floor(state.distance / state.stride);
  stepCountEl.textContent = steps.toLocaleString();
  goalLabelEl.textContent = state.goal.toLocaleString();

  const remaining = Math.max(state.goal - steps, 0);
  remainingLabelEl.textContent = remaining.toLocaleString();

  const percentRaw = state.goal > 0 ? Math.round((steps / state.goal) * 100) : 0;
  const percent = Math.min(percentRaw, 100);
  progressFillEl.style.width = percent + '%';
  progressBarEl.setAttribute('aria-valuenow', String(percent));
  progressPercentEl.textContent = percent + '%';

  goalMessageEl.textContent = steps >= state.goal ? 'Goal reached!' : '';

  distanceEl.textContent = formatDistance(state.distance);
  speedEl.textContent = extras.speed != null ? (extras.speed.toFixed(2) + ' m/s') : '—';
  accuracyEl.textContent = extras.accuracy != null ? (Math.round(extras.accuracy) + ' m') : '—';
  statusEl.textContent = extras.status || statusEl.textContent;

  goalInputEl.value = String(state.goal);
  strideInputEl.value = String(state.stride);
}

function startTracking() {
  if (!navigator.geolocation) {
    statusEl.textContent = 'Geolocation not available';
    return;
  }

  if (watchId != null) return; // already tracking

  statusEl.textContent = 'Requesting permission...';

  const options = { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 };

  watchId = navigator.geolocation.watchPosition(pos => {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    const acc = pos.coords.accuracy; // meters
    const reportedSpeed = pos.coords.speed; // may be null
    const timestamp = pos.timestamp || Date.now();

    // update accuracy display immediately
    const state = loadState();

    if (acc > MAX_ACCEPTABLE_ACCURACY) {
      // ignore low-accuracy point but show accuracy
      updateUI(state, { accuracy: acc, speed: reportedSpeed, status: 'Low accuracy' });
      return;
    }

    if (lastPos) {
      const dt = (timestamp - lastPos.timestamp) / 1000; // seconds
      if (dt <= 0) {
        updateUI(state, { accuracy: acc, speed: reportedSpeed, status: 'Tracking' });
        return;
      }

      const d = distanceInMeters(lastPos.lat, lastPos.lon, lat, lon);
      const impliedSpeed = d / dt; // m/s

      // ignore unrealistic jumps
      if (impliedSpeed > MAX_SPEED_MPS) {
        updateUI(state, { accuracy: acc, speed: reportedSpeed || impliedSpeed, status: 'Tracking (ignoring jump)' });
        // do not update lastPos here so next good point can be compared to previous
        return;
      }

      // ignore tiny noise
      if (d >= 0.5) {
        state.distance += d;
        saveState(state);
      }

      updateUI(state, { accuracy: acc, speed: reportedSpeed || impliedSpeed, status: 'Tracking' });
    } else {
      // first accepted position
      updateUI(state, { accuracy: acc, speed: reportedSpeed || null, status: 'Tracking' });
    }

    // accept this position as lastPos (only when accuracy good)
    lastPos = { lat, lon, timestamp };
  }, err => {
    if (err.code === err.PERMISSION_DENIED) {
      statusEl.textContent = 'Permission denied';
    } else if (err.code === err.POSITION_UNAVAILABLE) {
      statusEl.textContent = 'Position unavailable';
    } else {
      statusEl.textContent = 'Error: ' + err.message;
    }
    watchId = null;
  }, options);
}

function pauseTracking() {
  if (watchId != null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    statusEl.textContent = 'Paused';
  }
}

function resetData() {
  if (!confirm('Reset steps and distance for today?')) return;
  const state = loadState();
  state.distance = 0;
  state.date = todayString();
  saveState(state);
  lastPos = null;
  updateUI(state, { status: 'Waiting for permission', accuracy: null, speed: null });
}

function saveSettings() {
  const rawGoal = parseInt(goalInputEl.value, 10);
  const rawStride = parseFloat(strideInputEl.value);
  if (!Number.isFinite(rawGoal) || rawGoal < 100 || rawGoal > 100000) {
    alert('Please enter a valid goal between 100 and 100000.');
    const st = loadState();
    goalInputEl.value = st.goal;
    return;
  }
  if (!Number.isFinite(rawStride) || rawStride < 0.2 || rawStride > 2) {
    alert('Please enter a reasonable stride length (0.2 - 2 meters).');
    const st = loadState();
    strideInputEl.value = st.stride;
    return;
  }

  const state = loadState();
  state.goal = rawGoal;
  state.stride = rawStride;
  saveState(state);
  updateUI(state);
}

function init() {
  stepCountEl = document.getElementById('stepCount');
  statusEl = document.getElementById('status');
  distanceEl = document.getElementById('distance');
  speedEl = document.getElementById('speed');
  accuracyEl = document.getElementById('accuracy');

  goalLabelEl = document.getElementById('goalLabel');
  remainingLabelEl = document.getElementById('remainingLabel');
  progressFillEl = document.getElementById('progressFill');
  progressBarEl = document.getElementById('progressBar');
  progressPercentEl = document.getElementById('progressPercent');
  goalMessageEl = document.getElementById('goalMessage');

  goalInputEl = document.getElementById('goalInput');
  strideInputEl = document.getElementById('strideInput');

  startBtn = document.getElementById('startBtn');
  pauseBtn = document.getElementById('pauseBtn');
  resetBtn = document.getElementById('resetBtn');
  saveSettingsBtn = document.getElementById('saveSettings');

  startBtn.addEventListener('click', () => {
    // start on first user gesture — required on iOS Safari
    startTracking();
  });
  pauseBtn.addEventListener('click', pauseTracking);
  resetBtn.addEventListener('click', resetData);
  saveSettingsBtn.addEventListener('click', saveSettings);

  const state = loadState();
  saveState(state); // persist defaults
  updateUI(state, { status: 'Waiting for permission' });
}

document.addEventListener('DOMContentLoaded', init);
