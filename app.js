/* ==============================================
   DLM BlueSteel Player — Dashboard App Logic v2.1
   ============================================== */
'use strict';

// ─── State ─────────────────────────────────────
let API_BASE_URL    = localStorage.getItem('dlm_api_url') || 'http://localhost:8080';
let selectedGuildId = null;
let nowPlayingData  = null;
let queueData       = [];
let isOnline        = false;
let npTimer         = null;
let queueTimer      = null;
let searchDebounce  = null;
let selectedSearchResult = null; // { url, title }

// ─── DOM ────────────────────────────────────────
const $ = id => document.getElementById(id);

// ─── Fetch ──────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const url = API_BASE_URL.replace(/\/$/, '') + path;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = JSON.parse(text); if (j.error) msg = j.error; } catch (_) {}
    throw new Error(msg);
  }
  return text ? JSON.parse(text) : null;
}

// ─── Connection Status ──────────────────────────
function setOnline(online) {
  if (isOnline === online) return;
  isOnline = online;
  $('statusDot').className  = online ? 'status-dot online'  : 'status-dot offline';
  $('statusText').textContent = online ? 'Connected' : 'Offline';
  refreshButtonStates();
}

// ─── Polling ────────────────────────────────────
function startPolling() {
  stopPolling();
  pollNowPlaying();
  pollQueue();
  npTimer    = setInterval(pollNowPlaying, 3000);
  queueTimer = setInterval(pollQueue,      5000);
}

function stopPolling() {
  clearInterval(npTimer);
  clearInterval(queueTimer);
}

async function pollNowPlaying() {
  if (!selectedGuildId) return;
  try {
    const data = await apiFetch(`/api/now-playing?guildId=${selectedGuildId}`);
    setOnline(true);
    updateNowPlaying(data);
  } catch {
    setOnline(false);
    updateNowPlaying(null);
  }
}

async function pollQueue() {
  if (!selectedGuildId) return;
  try {
    const data = await apiFetch(`/api/queue?guildId=${selectedGuildId}`);
    setOnline(true);
    queueData = Array.isArray(data) ? data : [];
    renderQueue();
  } catch {
    setOnline(false);
  }
}

// ─── Guilds ─────────────────────────────────────
async function loadGuilds() {
  const sel = $('guildSelect');
  sel.innerHTML = '<option value="">Loading...</option>';
  try {
    const guilds = await apiFetch('/guilds');
    setOnline(true);
    if (!guilds || guilds.length === 0) {
      sel.innerHTML = '<option value="">No servers found</option>';
      return;
    }
    sel.innerHTML = '';
    guilds.forEach(g => {
      const opt = document.createElement('option');
      opt.value = g.id; opt.textContent = g.name;
      sel.appendChild(opt);
    });
    const saved = localStorage.getItem('dlm_guild_id');
    if (saved && guilds.find(g => g.id === saved)) sel.value = saved;
    selectedGuildId = sel.value || null;
    if (selectedGuildId) startPolling();
  } catch (err) {
    setOnline(false);
    sel.innerHTML = '<option value="">Cannot reach bot</option>';
    showToast('Cannot connect to bot — check the API URL in Settings', 'error');
  }
}

// ─── Now Playing ────────────────────────────────
function updateNowPlaying(np) {
  nowPlayingData = np;
  const title       = $('npTitle');
  const artist      = $('npArtist');
  const artImg      = $('npArtworkImg');
  const artWrap     = $('npArtwork');
  const placeholder = artWrap.querySelector('.np-artwork-placeholder');
  const bgArt       = $('npBgArt');
  const fill        = $('progressFill');
  const curTime     = $('currentTime');
  const totTime     = $('totalTime');
  const viz         = $('visualizer');

  if (!np) {
    title.textContent       = 'Nothing Playing';
    artist.textContent      = 'Queue is empty';
    artImg.style.display    = 'none';
    placeholder.style.display = 'flex';
    artWrap.classList.remove('playing');
    bgArt.classList.remove('visible');
    bgArt.style.backgroundImage = '';
    fill.style.width        = '0%';
    curTime.textContent     = '0:00';
    totTime.textContent     = '0:00';
    viz.classList.remove('active');
    refreshButtonStates();
    return;
  }

  title.textContent  = np.title || 'Unknown Track';
  artist.textContent = 'DLM BlueSteel Player';

  if (np.thumbnail) {
    artImg.src                  = np.thumbnail;
    artImg.style.display        = 'block';
    placeholder.style.display   = 'none';
    bgArt.style.backgroundImage = `url('${np.thumbnail}')`;
    bgArt.classList.add('visible');
  } else {
    artImg.style.display      = 'none';
    placeholder.style.display = 'flex';
    bgArt.classList.remove('visible');
  }

  artWrap.classList.toggle('playing', !np.paused);
  viz.classList.toggle('active', !np.paused);

  const durationSecs = parseDurationSecs(np.duration);
  const pos = Number(np.position) || 0;
  const pct = durationSecs > 0 ? Math.min(100, (pos / durationSecs) * 100) : 0;
  fill.style.width    = pct.toFixed(1) + '%';
  curTime.textContent = formatTime(pos);
  totTime.textContent = np.duration || '0:00';

  const iconPlay  = $('iconPlay');
  const iconPause = $('iconPause');
  iconPlay.style.display  = np.paused ? '' : 'none';
  iconPause.style.display = np.paused ? 'none' : '';

  refreshButtonStates();
}

function refreshButtonStates() {
  const hasGuild  = !!selectedGuildId;
  const isPlaying = !!nowPlayingData;
  $('btnPlayPause').disabled = !hasGuild || !isPlaying;
  $('btnSkip').disabled      = !hasGuild || !isPlaying;
  $('btnStop').disabled      = !hasGuild || !isPlaying;
  $('clearQueueBtn').disabled = !hasGuild;
  $('quickAddBtn').disabled  = !hasGuild;
}

// ─── Queue Render ────────────────────────────────
function renderQueue() {
  const list  = $('queueList');
  const count = $('queueCount');
  count.textContent = `${queueData.length} track${queueData.length !== 1 ? 's' : ''} in queue`;

  if (queueData.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>
        <p>Queue is empty</p>
        <span>Add songs using Quick Play or the Add Song tab</span>
      </div>`;
    return;
  }

  list.innerHTML = queueData.map((track, i) => `
    <div class="queue-item" data-index="${i}">
      <span class="queue-index">${i + 1}</span>
      <div class="queue-thumb">
        ${track.thumbnail
          ? `<img src="${esc(track.thumbnail)}" alt="" loading="lazy" />`
          : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`}
      </div>
      <div class="queue-info">
        <div class="queue-title">${esc(track.title || 'Unknown')}</div>
        <div class="queue-duration">${esc(track.duration || '')}</div>
      </div>
      <button class="queue-item-remove" data-index="${i}" title="Remove from queue">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `).join('');

  // Wire up remove buttons
  list.querySelectorAll('.queue-item-remove').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      removeFromQueue(parseInt(btn.dataset.index));
    });
  });
}

// ─── Controls ───────────────────────────────────
async function handlePlayPause() {
  if (!selectedGuildId || !nowPlayingData) return;
  $('btnPlayPause').disabled = true;
  try {
    const endpoint = nowPlayingData.paused ? '/api/queue/resume' : '/api/queue/pause';
    await apiFetch(endpoint, { method: 'POST', body: JSON.stringify({ guildId: selectedGuildId }) });
    // Optimistic update
    nowPlayingData.paused = !nowPlayingData.paused;
    const viz    = $('visualizer');
    const art    = $('npArtwork');
    const iPlay  = $('iconPlay');
    const iPause = $('iconPause');
    if (nowPlayingData.paused) {
      iPlay.style.display = ''; iPause.style.display = 'none';
      viz.classList.remove('active'); art.classList.remove('playing');
      showToast('Paused ⏸', 'info');
    } else {
      iPlay.style.display = 'none'; iPause.style.display = '';
      viz.classList.add('active'); art.classList.add('playing');
      showToast('Resumed ▶️', 'info');
    }
  } catch (err) {
    showToast('Playback error: ' + err.message, 'error');
  } finally {
    $('btnPlayPause').disabled = false;
  }
  setTimeout(pollNowPlaying, 700);
}

async function handleSkip() {
  if (!selectedGuildId) return;
  $('btnSkip').disabled = true;
  try {
    await apiFetch('/api/queue/skip', { method: 'POST', body: JSON.stringify({ guildId: selectedGuildId }) });
    showToast('Skipped ⏭', 'success');
    setTimeout(() => { pollNowPlaying(); pollQueue(); }, 500);
  } catch (err) {
    showToast('Skip failed: ' + err.message, 'error');
  } finally {
    setTimeout(() => { $('btnSkip').disabled = !nowPlayingData || !selectedGuildId; }, 800);
  }
}

async function handleStop() {
  if (!selectedGuildId) return;
  $('btnStop').disabled = true;
  try {
    await apiFetch('/api/queue/stop', { method: 'POST', body: JSON.stringify({ guildId: selectedGuildId }) });
    showToast('Stopped ⏹', 'info');
    nowPlayingData = null;
    queueData = [];
    updateNowPlaying(null);
    renderQueue();
  } catch (err) {
    showToast('Stop failed: ' + err.message, 'error');
  } finally {
    $('btnStop').disabled = true; // stays disabled until something plays
  }
}

async function handleClearQueue() {
  if (!selectedGuildId) return;
  $('clearQueueBtn').disabled = true;
  try {
    await apiFetch('/api/queue/clear', { method: 'POST', body: JSON.stringify({ guildId: selectedGuildId }) });
    showToast('Queue cleared 🗑️', 'info');
    queueData = [];
    renderQueue();
  } catch (err) {
    showToast('Clear failed: ' + err.message, 'error');
  } finally {
    $('clearQueueBtn').disabled = false;
  }
}

async function removeFromQueue(index) {
  if (!selectedGuildId) return;
  try {
    await apiFetch('/api/queue/remove', { method: 'POST', body: JSON.stringify({ guildId: selectedGuildId, index }) });
    queueData.splice(index, 1);
    renderQueue();
    showToast('Removed from queue', 'info');
  } catch (err) {
    showToast('Remove failed: ' + err.message, 'error');
    setTimeout(pollQueue, 500);
  }
}

async function addSong(queryOrUrl, statusEl, inputEl, btnEl) {
  if (!selectedGuildId) { showToast('No server selected', 'error'); return false; }
  if (!queryOrUrl || !queryOrUrl.trim()) return false;
  if (btnEl)    btnEl.disabled    = true;
  if (statusEl) { statusEl.className = 'add-status loading'; statusEl.textContent = 'Adding to queue...'; }
  try {
    await apiFetch('/api/queue/add', {
      method: 'POST',
      body: JSON.stringify({ guildId: selectedGuildId, query: queryOrUrl.trim() }),
    });
    if (inputEl)  inputEl.value = '';
    if (statusEl) {
      statusEl.className   = 'add-status success';
      statusEl.textContent = '✓ Added to queue!';
      setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'add-status'; }, 3000);
    }
    showToast('Added to queue 🎵', 'success');
    setTimeout(pollQueue, 800);
    return true;
  } catch (err) {
    if (statusEl) { statusEl.className = 'add-status error'; statusEl.textContent = '✗ ' + err.message; }
    showToast('Add failed: ' + err.message, 'error');
    return false;
  } finally {
    if (btnEl) btnEl.disabled = !selectedGuildId;
  }
}

// ─── YouTube Search ──────────────────────────────
function isUrl(str) {
  return str.startsWith('http://') || str.startsWith('https://');
}

async function doSearch(query) {
  const resultsEl   = $('searchResults');
  const spinner     = $('searchSpinner');
  const directRow   = $('directAddRow');
  const status      = $('addStatus');

  // URL — show direct add button instead
  if (isUrl(query)) {
    resultsEl.style.display  = 'none';
    directRow.style.display  = 'block';
    spinner.classList.remove('spinning');
    status.textContent       = '';
    return;
  }

  directRow.style.display  = 'none';
  resultsEl.style.display  = 'none';
  spinner.classList.add('spinning');
  status.textContent        = '';
  selectedSearchResult      = null;

  try {
    const results = await apiFetch(
      `/api/search?q=${encodeURIComponent(query)}&guildId=${selectedGuildId || ''}`
    );
    spinner.classList.remove('spinning');

    if (!results || results.length === 0) {
      resultsEl.style.display = 'block';
      resultsEl.innerHTML     = `<div class="search-no-results">No results found for "${esc(query)}"</div>`;
      return;
    }

    resultsEl.style.display = 'block';
    resultsEl.innerHTML     = results.map((r, i) => `
      <div class="search-result-item" data-index="${i}" data-url="${esc(r.url)}" data-title="${esc(r.title)}">
        <div class="sr-thumb">
          ${r.thumbnail
            ? `<img src="${esc(r.thumbnail)}" alt="" loading="lazy" />`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`}
        </div>
        <div class="sr-info">
          <div class="sr-title">${esc(r.title)}</div>
          <div class="sr-duration">${esc(r.duration)}</div>
        </div>
        <button class="sr-add-btn" title="Add to queue">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
      </div>
    `).join('');

    // Wire up result items
    resultsEl.querySelectorAll('.search-result-item').forEach(item => {
      // Click row → select it
      item.addEventListener('click', e => {
        if (e.target.closest('.sr-add-btn')) return; // handled below
        resultsEl.querySelectorAll('.search-result-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        selectedSearchResult = { url: item.dataset.url, title: item.dataset.title };
      });

      // Click + button → add directly
      item.querySelector('.sr-add-btn').addEventListener('click', async e => {
        e.stopPropagation();
        const btn = e.currentTarget;
        btn.style.opacity = '0.5';
        btn.disabled = true;
        await addSong(item.dataset.url, $('addStatus'), null, null);
        btn.style.opacity = '';
        btn.disabled = false;
      });
    });

    // Auto-select first
    const first = resultsEl.querySelector('.search-result-item');
    if (first) {
      first.classList.add('selected');
      selectedSearchResult = { url: first.dataset.url, title: first.dataset.title };
    }
  } catch (err) {
    spinner.classList.remove('spinning');
    resultsEl.style.display = 'block';
    resultsEl.innerHTML     = `<div class="search-no-results">Search failed: ${esc(err.message)}</div>`;
  }
}

// ─── PIN Lock ───────────────────────────────────
const PIN_CORRECT    = '1973';
const PIN_MGMT       = '120195';
const PIN_PUZZLE_ANS = 'A1B2C3';
const ROBOT_MS       = 80;   // keystroke gap below this = suspicious

let pinUnlocked     = false;   // stays true until page reload
let pinBuf          = '';      // current digits entered
let pinAttempts     = 0;       // wrong attempts
let pinKeytimes     = [];      // timestamps for robot detection
let pinMode         = 'pin';   // 'pin' | 'mgmt' | 'puzzle'

function openPinOverlay() {
  pinBuf = ''; pinKeytimes = [];
  pinMode = 'mgmt' === pinMode ? 'mgmt' : 'pin'; // preserve if already mgmt
  pinMode = 'pin';
  showPinState('pin');
  updateDots();
  $('pinAttempts').textContent = '';
  $('pinOverlay').style.display = 'flex';
}

function closePinOverlay() {
  $('pinOverlay').style.display = 'none';
  pinBuf = ''; pinKeytimes = [];
}

function showPinState(mode) {
  pinMode = mode;
  $('pinState').style.display   = mode === 'pin'    ? 'flex' : 'none';
  $('mgmtState').style.display  = mode === 'mgmt'   ? 'flex' : 'none';
  $('puzzleState').style.display= mode === 'puzzle' ? 'flex' : 'none';
  if (mode === 'mgmt')   { $('mgmtInput').value = '';   $('mgmtError').textContent = '';   setTimeout(() => $('mgmtInput').focus(),   80); }
  if (mode === 'puzzle') { $('puzzleInput').value = ''; $('puzzleError').textContent = ''; setTimeout(() => $('puzzleInput').focus(), 80); }
}

function shakePinBox() {
  const box = $('pinBox');
  box.classList.remove('shake');
  void box.offsetWidth; // reflow
  box.classList.add('shake');
  setTimeout(() => box.classList.remove('shake'), 500);
}

function updateDots() {
  for (let i = 0; i < 4; i++) {
    const dot = $(`d${i}`);
    dot.classList.toggle('filled', i < pinBuf.length);
    dot.classList.remove('error');
  }
}

function flashErrorDots() {
  for (let i = 0; i < 4; i++) {
    $(`d${i}`).classList.add('error');
    $(`d${i}`).classList.remove('filled');
  }
  setTimeout(updateDots, 700);
}

function isRoboticInput() {
  if (pinKeytimes.length < 2) return false;
  for (let i = 1; i < pinKeytimes.length; i++) {
    if (pinKeytimes[i] - pinKeytimes[i-1] < ROBOT_MS) return true;
  }
  return false;
}

function pressDigit(d) {
  if (pinBuf.length >= 4) return;
  const now = Date.now();
  pinKeytimes.push(now);

  // Robot check after 2+ presses
  if (pinKeytimes.length >= 2 && isRoboticInput()) {
    pinBuf = '';
    showPinState('mgmt');
    return;
  }

  pinBuf += d;
  updateDots();

  if (pinBuf.length === 4) {
    setTimeout(checkPin, 120);
  }
}

function checkPin() {
  if (pinBuf === PIN_CORRECT) {
    // Correct!
    pinUnlocked = true;
    closePinOverlay();
    pinAttempts = 0;
    setView('settings');
    showToast('Settings unlocked ✓', 'success');
  } else {
    // Wrong
    pinAttempts++;
    flashErrorDots();
    shakePinBox();
    pinBuf = '';
    pinKeytimes = [];

    if (pinAttempts >= 3) {
      $('pinAttempts').textContent = '';
      showPinState('puzzle');
    } else {
      const rem = 3 - pinAttempts;
      $('pinAttempts').textContent = `Incorrect PIN — ${rem} attempt${rem !== 1 ? 's' : ''} remaining`;
      setTimeout(updateDots, 700);
    }
  }
}

// Navigation
function setView(name) {
  document.querySelectorAll('.view').forEach(v => {
    v.classList.remove('active');
    v.style.display = '';
  });
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  const view   = $(`view-${name}`);
  const navBtn = $(`nav-${name}`);
  if (view) {
    view.style.display = 'block';
    requestAnimationFrame(() => requestAnimationFrame(() => view.classList.add('active')));
  }
  if (navBtn) navBtn.classList.add('active');
  const titles = { player: 'Player', queue: 'Queue', search: 'Add Song', settings: 'Settings' };
  $('pageTitle').textContent = titles[name] || name;
}

// ─── Toast ──────────────────────────────────────
function showToast(message, type = 'info') {
  const container = $('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-dot"></span><span>${esc(message)}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('removing');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, 3500);
}

// ─── Utils ──────────────────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function formatTime(secs) {
  secs = Math.floor(Number(secs) || 0);
  return `${Math.floor(secs/60)}:${(secs%60).toString().padStart(2,'0')}`;
}
function parseDurationSecs(str) {
  if (!str) return 0;
  const parts = String(str).split(':').map(Number);
  if (parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2];
  if (parts.length === 2) return parts[0]*60 + parts[1];
  return 0;
}

// ─── Init ───────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  $('apiUrlInput').value = API_BASE_URL;

  // Navigation — intercept Settings with PIN lock
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      if (view === 'settings' && !pinUnlocked) {
        openPinOverlay();
        return;
      }
      // Re-lock settings when leaving it
      if (view !== 'settings') pinUnlocked = false;
      setView(view);
      if (window.innerWidth <= 768) $('sidebar').classList.remove('open');
    });
  });

  // PIN Keypad
  document.querySelectorAll('.pin-key[data-digit]').forEach(btn => {
    btn.addEventListener('click', () => pressDigit(btn.dataset.digit));
  });
  $('pinClear').addEventListener('click', () => { pinBuf = ''; pinKeytimes = []; updateDots(); $('pinAttempts').textContent = ''; });
  $('pinDel').addEventListener('click', () => { if (pinBuf.length) { pinBuf = pinBuf.slice(0, -1); pinKeytimes.pop(); updateDots(); } });
  $('pinCancel').addEventListener('click', closePinOverlay);

  // Physical keyboard support for PIN (digits only, no speed bypassing)
  document.addEventListener('keydown', e => {
    if ($('pinOverlay').style.display === 'none') return;
    if (pinMode !== 'pin') return;
    if (e.key >= '0' && e.key <= '9') pressDigit(e.key);
    if (e.key === 'Backspace') { if (pinBuf.length) { pinBuf = pinBuf.slice(0,-1); pinKeytimes.pop(); updateDots(); } }
    if (e.key === 'Escape') closePinOverlay();
  });

  // Management PIN
  $('mgmtSubmit').addEventListener('click', () => {
    const val = $('mgmtInput').value.trim();
    if (val === PIN_MGMT) {
      pinAttempts = 0; pinBuf = ''; pinKeytimes = [];
      showPinState('pin');
      updateDots();
      showToast('Management access granted', 'info');
    } else {
      $('mgmtError').textContent = 'Incorrect management PIN';
      $('mgmtInput').value = '';
      shakePinBox();
    }
  });
  $('mgmtInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('mgmtSubmit').click(); });

  // Puzzle verify
  $('puzzleSubmit').addEventListener('click', () => {
    const val = $('puzzleInput').value.trim();
    if (val === PIN_PUZZLE_ANS) {
      pinAttempts = 0; pinBuf = ''; pinKeytimes = [];
      showPinState('pin');
      updateDots();
      showToast('Puzzle solved — try your PIN again', 'info');
    } else {
      $('puzzleError').textContent = 'Incorrect — type exactly: A1B2C3';
      $('puzzleInput').value = '';
      shakePinBox();
    }
  });
  $('puzzleInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('puzzleSubmit').click(); });

  // Guild select
  $('guildSelect').addEventListener('change', e => {
    selectedGuildId = e.target.value || null;
    if (selectedGuildId) localStorage.setItem('dlm_guild_id', selectedGuildId);
    stopPolling(); nowPlayingData = null; queueData = [];
    updateNowPlaying(null); renderQueue(); refreshButtonStates();
    if (selectedGuildId) startPolling();
  });

  // Playback controls
  $('btnPlayPause').addEventListener('click', handlePlayPause);
  $('btnSkip').addEventListener('click', handleSkip);
  $('btnStop').addEventListener('click', handleStop);
  $('clearQueueBtn').addEventListener('click', handleClearQueue);
  $('shuffleQueueBtn').addEventListener('click', () => showToast('Shuffle coming soon 🔀', 'info'));

  // Quick Play (Player tab)
  $('quickPlayForm').addEventListener('submit', async e => {
    e.preventDefault();
    const input = $('quickSearchInput');
    await addSong(input.value, null, input, $('quickAddBtn'));
  });

  // Add Song — search input with debounce
  $('songInput').addEventListener('input', e => {
    const q = e.target.value.trim();
    clearTimeout(searchDebounce);
    if (!q) {
      $('searchResults').style.display = 'none';
      $('directAddRow').style.display  = 'none';
      $('searchSpinner').classList.remove('spinning');
      return;
    }
    searchDebounce = setTimeout(() => doSearch(q), 600);
  });

  // Direct URL add button
  $('addSongBtn').addEventListener('click', async () => {
    const q = $('songInput').value.trim();
    if (!q) return;
    await addSong(q, $('addStatus'), $('songInput'), $('addSongBtn'));
    $('searchResults').style.display = 'none';
    $('directAddRow').style.display  = 'none';
    selectedSearchResult = null;
  });

  // Settings
  $('saveApiBtn').addEventListener('click', () => {
    const url = $('apiUrlInput').value.trim();
    if (!url) { showToast('Enter a URL first', 'error'); return; }
    API_BASE_URL = url;
    localStorage.setItem('dlm_api_url', url);
    showToast('Saved ✓', 'success');
    stopPolling(); nowPlayingData = null; selectedGuildId = null;
    loadGuilds();
  });

  $('testApiBtn').addEventListener('click', async () => {
    const url    = $('apiUrlInput').value.trim() || API_BASE_URL;
    const result = $('apiTestResult');
    result.className = 'test-result'; result.textContent = 'Testing...';
    try {
      const res = await fetch(url.replace(/\/$/, '') + '/api/health', { headers: { 'ngrok-skip-browser-warning': 'true' } });
      if (res.ok) { result.className = 'test-result success'; result.textContent = '✓ Connection successful!'; }
      else throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      result.className = 'test-result error'; result.textContent = `✗ Failed — ${err.message}`;
    }
  });

  // Sidebar toggle
  $('sidebarToggle').addEventListener('click', () => $('sidebar').classList.toggle('open'));
  document.addEventListener('click', e => {
    const sb = $('sidebar'), tog = $('sidebarToggle');
    if (window.innerWidth <= 768 && sb.classList.contains('open')
        && !sb.contains(e.target) && !tog.contains(e.target)) sb.classList.remove('open');
  });

  // Boot
  refreshButtonStates();
  setView('player');
  loadGuilds();
});
