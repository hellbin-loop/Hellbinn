// ─── PARTICLES ───────────────────────────────────────
(function spawnParticles() {
  const container = document.getElementById('particles');
  const canvas    = document.getElementById('particle-canvas');
  const ctx       = canvas.getContext('2d');

  const colors = ['#9d00ff', '#ff00aa', '#cc00ff', '#ff0088'];
  const COUNT          = 28;
  const ATTRACT_RADIUS = 150;
  const ATTRACT_STR    = 0.006;
  const LINE_RADIUS    = 180;
  const DAMPING        = 0.97;

  let mouseX = -9999, mouseY = -9999;
  let curX = -9999, curY = -9999;

  document.addEventListener('mousemove', e => { mouseX = e.clientX; mouseY = e.clientY; });

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  const particles = [];
  for (let i = 0; i < COUNT; i++) {
    const size  = Math.random() * 3 + 1;
    const color = colors[Math.floor(Math.random() * colors.length)];
    const el    = document.createElement('div');
    el.className  = 'particle';
    el.style.cssText = `width:${size}px;height:${size}px;background:${color};box-shadow:0 0 ${size*5}px ${color};opacity:0.7;`;
    container.appendChild(el);
    particles.push({
      el, color,
      x:  Math.random() * window.innerWidth,
      y:  Math.random() * window.innerHeight,
      vx: (Math.random() - 0.5) * 0.15,
      vy: -(0.08 + Math.random() * 0.18),
    });
  }

  function tick() {
    const w = window.innerWidth, h = window.innerHeight;

    curX += (mouseX - curX) * 0.035;
    curY += (mouseY - curY) * 0.035;

    ctx.clearRect(0, 0, w, h);

    for (const p of particles) {
      const dxM = mouseX - p.x, dyM = mouseY - p.y;
      const distM = Math.sqrt(dxM*dxM + dyM*dyM);
      if (distM < ATTRACT_RADIUS && distM > 0) {
        const force = (1 - distM / ATTRACT_RADIUS) * ATTRACT_STR;
        p.vx += dxM * force;
        p.vy += dyM * force;
      }

      p.vy -= 0.0012;
      p.vx += (Math.random() - 0.5) * 0.005;
      p.vx *= DAMPING;
      p.vy *= DAMPING;
      p.x  += p.vx;
      p.y  += p.vy;

      if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; p.vx = 0; p.vy = -(0.08 + Math.random() * 0.18); }
      if (p.x < -10)  p.x = w + 10;
      if (p.x > w+10) p.x = -10;

      p.el.style.transform = `translate(${p.x}px,${p.y}px)`;

      const dxC = curX - p.x, dyC = curY - p.y;
      const distC = Math.sqrt(dxC*dxC + dyC*dyC);
      if (distC < LINE_RADIUS && curX > 0) {
        const t = 1 - distC / LINE_RADIUS;
        const alpha = t * t * 0.5;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(curX, curY);
        ctx.strokeStyle = hexToRgba(p.color, alpha);
        ctx.lineWidth = 0.7;
        ctx.stroke();
      }
    }
    requestAnimationFrame(tick);
  }

  function hexToRgba(hex, a) {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${a})`;
  }

  requestAnimationFrame(tick);
})();

// ─── STATE ───────────────────────────────────────────
// ── API URL CONFIG ────────────────────────────────────
// When running locally with server.js, leave this as '/api'.
// When deploying the frontend to Cloudflare Pages separately,
// change this to your backend URL, e.g.:
//   const API = 'https://your-server.com/api';
const API = '/api';
let currentId = null;

// ─── CAPTCHA ─────────────────────────────────────────
let captchaDone = false;

function doCaptcha(e) {
  if (captchaDone) return;
  const widget = document.getElementById('captcha-widget');
  const label  = document.getElementById('captcha-label');

  const rect = widget.getBoundingClientRect();
  const rip = document.createElement('div');
  rip.className = 'ripple';
  const size = Math.max(rect.width, rect.height);
  rip.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX-rect.left-size/2}px;top:${e.clientY-rect.top-size/2}px`;
  widget.appendChild(rip);
  setTimeout(() => rip.remove(), 700);

  widget.classList.add('verifying');
  label.textContent = 'Verifying...';
  captchaDone = true;

  setTimeout(() => {
    widget.classList.remove('verifying');
    widget.classList.add('verified');
    label.textContent = 'Verified!';
    setTimeout(unlockApp, 900);
  }, 1400);
}

function unlockApp() {
  const vp = document.getElementById('verify-page');
  const ap = document.getElementById('app-page');
  vp.style.opacity = '0';
  vp.style.transition = 'opacity 0.4s ease';
  setTimeout(() => {
    vp.classList.add('hidden');
    ap.classList.remove('hidden');
    ap.style.opacity = '0';
    ap.style.transition = 'opacity 0.4s ease';
    requestAnimationFrame(() => { ap.style.opacity = '1'; });
    document.getElementById('auth-panel').classList.remove('hidden');
    loadPastes();
    loadCurrentUser();
  }, 400);
}

// ─── HELPERS ──────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function relTime(ts) {
  const diff = Date.now() - new Date(ts).getTime();
  const s = Math.floor(diff/1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}

// ─── API ──────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...opts,
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message ?? `Request failed (${res.status})`);
  return data;
}

// ─── LOAD & RENDER ────────────────────────────────────
let allPastes = [];

async function loadPastes() {
  const grid = document.getElementById('pastes-grid');
  grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon" style="animation:pulse-ring 1.5s infinite">◈</div><div class="empty-title">LOADING...</div></div>`;
  try {
    allPastes = await apiFetch('/pastes');
    renderPastes();
    loadStats();
  } catch(e) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-title" style="color:#ff4488">CONNECTION ERROR</div><div class="empty-sub">Could not reach the server</div></div>`;
  }
}

async function loadStats() {
  try {
    const stats = await apiFetch('/pastes/stats');
    document.getElementById('stat-total').textContent = stats.total;
    document.getElementById('stat-views').textContent = stats.totalViews;
  } catch(e) {}
}

function renderPastes() {
  const grid = document.getElementById('pastes-grid');
  if (!allPastes.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="empty-icon">◈</div>
      <div class="empty-title">NO PASTES YET</div>
      <div class="empty-sub">Be the first to create one</div>
    </div>`;
    return;
  }
  grid.innerHTML = allPastes.map((p, i) => `
    <div class="paste-card" style="animation-delay:${Math.min(i,10)*0.05}s" onclick="openView('${p.id}')">
      <div class="card-main">
        <div class="card-title">${escHtml(p.title)}</div>
        <div class="card-preview">${escHtml(p.content)}</div>
      </div>
      <div class="card-right-meta">
        <span class="card-date">${relTime(p.createdAt)}</span>
        <span class="card-views">👁 ${p.views}</span>
      </div>
    </div>
  `).join('');
}

// ─── NEW PASTE MODAL ──────────────────────────────────
function openNewModal() {
  document.getElementById('new-modal').classList.remove('hidden');
  document.getElementById('new-title').focus();
}
function closeNewModal() {
  const m = document.getElementById('new-modal');
  m.style.animation = 'fadeOut 0.2s ease forwards';
  setTimeout(() => { m.classList.add('hidden'); m.style.animation = ''; }, 200);
}
document.getElementById('new-modal').addEventListener('click', function(e) {
  if (e.target === this) closeNewModal();
});

async function submitPaste() {
  const title = document.getElementById('new-title').value.trim() || 'Untitled';
  const content = document.getElementById('new-content').value.trim();
  const expiresIn = document.getElementById('new-expires').value;
  if (!content) { document.getElementById('new-content').focus(); return; }

  const btn = document.querySelector('.btn-submit');
  btn.textContent = 'SAVING...';
  btn.style.opacity = '0.6';

  try {
    const paste = await apiFetch('/pastes', {
      method: 'POST',
      body: JSON.stringify({ title, content, language: 'text', expiresIn: expiresIn === 'never' ? null : expiresIn }),
    });
    allPastes.unshift(paste);
    renderPastes();
    loadStats();
    closeNewModal();
    document.getElementById('new-title').value = '';
    document.getElementById('new-content').value = '';
    document.getElementById('new-expires').value = 'never';
  } catch(e) {
    alert('Failed to save paste. Try again.');
  } finally {
    btn.textContent = 'CREATE PASTE';
    btn.style.opacity = '';
  }
}

// ─── VIEW PASTE MODAL ─────────────────────────────────
async function openView(id) {
  currentId = id;
  document.getElementById('view-title').textContent = '...';
  document.getElementById('view-code').textContent = 'Loading...';
  document.getElementById('view-modal').classList.remove('hidden');

  try {
    const paste = await apiFetch(`/pastes/${id}`);
    document.getElementById('view-title').textContent = paste.title.toUpperCase();
    document.getElementById('view-code').textContent = paste.content;
    document.getElementById('view-meta').innerHTML = `
      <span>📅 ${new Date(paste.createdAt).toLocaleString()}</span>
      <span>👁 ${paste.views} views</span>
      ${paste.expiresAt ? `<span>⏰ expires ${relTime(paste.expiresAt)}</span>` : ''}
    `;
    const idx = allPastes.findIndex(p => p.id === id);
    if (idx !== -1) allPastes[idx].views = paste.views;
    renderPastes();
    loadStats();
  } catch(e) {
    document.getElementById('view-code').textContent = 'Error loading paste.';
  }
  document.getElementById('copy-btn').textContent = 'Copy';
  document.getElementById('copy-btn').classList.remove('copied');
}

function closeViewModal() {
  const m = document.getElementById('view-modal');
  m.style.animation = 'fadeOut 0.2s ease forwards';
  setTimeout(() => { m.classList.add('hidden'); m.style.animation = ''; currentId = null; }, 200);
}
document.getElementById('view-modal').addEventListener('click', function(e) {
  if (e.target === this) closeViewModal();
});

function copyContent() {
  const code = document.getElementById('view-code').textContent;
  navigator.clipboard.writeText(code).then(() => {
    const btn = document.getElementById('copy-btn');
    btn.textContent = 'Copied ✓';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
  });
}

async function deleteCurrent() {
  if (!currentId) return;
  await apiFetch(`/pastes/${currentId}`, { method: 'DELETE' });
  allPastes = allPastes.filter(p => p.id !== currentId);
  renderPastes();
  loadStats();
  closeViewModal();
}

// ─── KEYBOARD ─────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!document.getElementById('view-modal').classList.contains('hidden')) closeViewModal();
    else if (!document.getElementById('new-modal').classList.contains('hidden')) closeNewModal();
    else if (!document.getElementById('auth-modal').classList.contains('hidden')) closeAuthModal();
  }
});

// ─── AUTO REFRESH every 30s ───────────────────────────
setInterval(() => {
  if (!document.getElementById('app-page').classList.contains('hidden')) loadPastes();
}, 30000);

// ─── AUTH ─────────────────────────────────────────────
let authMode = 'login';
let currentUser = null;

async function loadCurrentUser() {
  try {
    const user = await apiFetch('/auth/me');
    setUser(user);
  } catch(e) {
    setUser(null);
  }
}

function setUser(user) {
  currentUser = user;
  const guest = document.getElementById('auth-guest');
  const userEl = document.getElementById('auth-user');
  const usernameEl = document.getElementById('auth-username');
  if (user) {
    guest.classList.add('hidden');
    userEl.classList.remove('hidden');
    usernameEl.textContent = user.username;
  } else {
    guest.classList.remove('hidden');
    userEl.classList.add('hidden');
  }
}

function openAuthModal(mode) {
  authMode = mode;
  updateAuthModal();
  document.getElementById('auth-username-input').value = '';
  document.getElementById('auth-password-input').value = '';
  document.getElementById('auth-error').classList.add('hidden');
  document.getElementById('auth-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('auth-username-input').focus(), 80);
}

function closeAuthModal() {
  const m = document.getElementById('auth-modal');
  m.style.animation = 'fadeOut 0.2s ease forwards';
  setTimeout(() => { m.classList.add('hidden'); m.style.animation = ''; }, 200);
}

function toggleAuthMode() {
  authMode = authMode === 'login' ? 'register' : 'login';
  updateAuthModal();
  document.getElementById('auth-error').classList.add('hidden');
}

function updateAuthModal() {
  const isLogin = authMode === 'login';
  document.getElementById('auth-modal-title').textContent = isLogin ? 'LOG IN' : 'REGISTER';
  document.getElementById('auth-submit-btn').textContent = isLogin ? 'LOG IN' : 'CREATE ACCOUNT';
  document.getElementById('auth-switch-text').textContent = isLogin ? "Don't have an account?" : 'Already have an account?';
  document.getElementById('auth-switch-btn').textContent = isLogin ? 'Register' : 'Log in';
  document.getElementById('auth-password-input').autocomplete = isLogin ? 'current-password' : 'new-password';
}

async function submitAuth() {
  const username = document.getElementById('auth-username-input').value.trim();
  const password = document.getElementById('auth-password-input').value;
  const errEl = document.getElementById('auth-error');
  const btn = document.getElementById('auth-submit-btn');

  if (!username || !password) {
    errEl.textContent = 'Please fill in all fields.';
    errEl.classList.remove('hidden');
    return;
  }

  btn.textContent = '...';
  btn.style.opacity = '0.6';
  errEl.classList.add('hidden');

  try {
    const endpoint = authMode === 'login' ? '/auth/login' : '/auth/register';
    const user = await apiFetch(endpoint, {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    setUser(user);
    closeAuthModal();
  } catch(e) {
    errEl.textContent = e?.message ?? 'Something went wrong. Try again.';
    errEl.classList.remove('hidden');
  } finally {
    btn.textContent = authMode === 'login' ? 'LOG IN' : 'CREATE ACCOUNT';
    btn.style.opacity = '';
  }
}

async function doLogout() {
  await apiFetch('/auth/logout', { method: 'POST', credentials: 'include' });
  setUser(null);
}

// Close auth modal on backdrop click
document.getElementById('auth-modal').addEventListener('click', function(e) {
  if (e.target === this) closeAuthModal();
});

// Enter key in auth modal
document.getElementById('auth-password-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') submitAuth();
});
document.getElementById('auth-username-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') submitAuth();
});
