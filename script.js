// ── Live course search (autostrike-dashboard catalog API) ──
const API_BASE = 'https://autostrike-dashboard.vercel.app';
let searchDebounce = null;
let lastQuery = '';

async function fetchCourses(q) {
  const url = q
    ? `${API_BASE}/api/unmapped-courses?q=${encodeURIComponent(q)}&limit=20`
    : `${API_BASE}/api/unmapped-courses?limit=20`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('search failed');
  const data = await res.json();
  return Array.isArray(data.courses) ? data.courses : [];
}

function renderCourseResults(courses, isFallback) {
  const list = document.getElementById('course-list');
  if (!courses.length) {
    list.innerHTML = '<p class="course-empty">No matches. Try a different name.</p>';
    return;
  }
  list.innerHTML = courses.map(c => {
    const loc = c.location || c.country || '';
    return `<div class="course-result"><span class="course-name">${escapeHtml(c.name)}</span>${loc ? `<span class="course-loc">${escapeHtml(loc)}</span>` : ''}</div>`;
  }).join('');
  const hint = document.getElementById('course-search-hint');
  if (hint && isFallback) hint.textContent = 'A few examples from our 28,000+ catalog — search to find yours';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[ch]));
}

async function runSearch(q) {
  const hint = document.getElementById('course-search-hint');
  try {
    const courses = await fetchCourses(q);
    renderCourseResults(courses, !q);
    if (q) hint.textContent = `${courses.length} match${courses.length === 1 ? '' : 'es'}`;
  } catch (e) {
    hint.textContent = 'Search temporarily unavailable.';
  }
}

function onSearchInput(ev) {
  const q = ev.target.value.trim();
  if (q === lastQuery) return;
  lastQuery = q;
  if (searchDebounce) clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => runSearch(q), 220);
}

async function loadInitialCatalog() {
  // Show a curated mix of well-known courses on first paint.
  const SEEDS = ['Pebble Beach', 'Royal Melbourne', 'St Andrews', 'Augusta'];
  for (const seed of SEEDS) {
    try {
      const c = await fetchCourses(seed);
      if (c.length) { renderCourseResults(c.slice(0, 8), true); return; }
    } catch {}
  }
  renderCourseResults([], true);
}

// ── Scroll fade-in ──
const obs = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); } });
}, { threshold: 0.15 });
document.querySelectorAll('.fade-in').forEach(el => obs.observe(el));

// ── Mobile menu ──
const hamburger = document.querySelector('.hamburger');
const navLinks = document.querySelector('.nav-links');
hamburger.addEventListener('click', () => navLinks.classList.toggle('open'));
navLinks.querySelectorAll('a').forEach(a => a.addEventListener('click', () => navLinks.classList.remove('open')));

// ── Course search wiring ──
const searchInput = document.getElementById('course-search-input');
if (searchInput) {
  searchInput.addEventListener('input', onSearchInput);
}

// ── Fake slot counter (deterministic from date) ──
function getSlots() {
  const start = new Date('2026-04-21').getTime();
  const now = Date.now();
  const days = Math.floor((now - start) / 86400000);
  return Math.max(100, 847 - days * 3 - Math.floor(Math.random() * 5));
}
function updateSlots() {
  const n = getSlots();
  document.querySelectorAll('.slots-num').forEach(el => el.textContent = n);
}

// ── Beta modal ──
function openBetaModal() {
  document.getElementById('beta-modal').classList.add('open');
  document.getElementById('beta-email').focus();
}
function closeBetaModal() {
  document.getElementById('beta-modal').classList.remove('open');
  document.getElementById('beta-status').textContent = '';
  document.getElementById('beta-email').value = '';
}
// Close on overlay click
document.getElementById('beta-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeBetaModal();
});
// Close on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeBetaModal();
});

async function submitBeta(e) {
  e.preventDefault();
  const email = document.getElementById('beta-email').value.trim();
  const status = document.getElementById('beta-status');
  const btn = document.getElementById('beta-submit');

  btn.disabled = true;
  btn.textContent = 'Submitting…';
  status.textContent = '';
  status.className = 'modal-note';

  try {
    const res = await fetch('https://autostrike-dashboard.vercel.app/api/beta-signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (res.ok) {
      status.textContent = '🎉 You\'re in! We\'ll send your invite code via email.';
      status.className = 'modal-note success';
      document.getElementById('beta-email').value = '';
    } else {
      status.textContent = data.error || 'Something went wrong. Try again.';
      status.className = 'modal-note error';
    }
  } catch {
    status.textContent = 'Network error. Please try again.';
    status.className = 'modal-note error';
  }
  btn.disabled = false;
  btn.textContent = 'Get My Invite';
}

// Make functions global
window.openBetaModal = openBetaModal;
window.closeBetaModal = closeBetaModal;
window.submitBeta = submitBeta;

// ── Init ──
loadInitialCatalog();
updateSlots();
