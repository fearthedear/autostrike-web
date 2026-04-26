// ── Live course search (autostrike-dashboard catalog API) ──
const API_BASE = 'https://autostrike-dashboard.vercel.app';
let searchDebounce = null;
let searchSeq = 0;        // discard out-of-order responses
let selectedCountry = '';

async function fetchCourses(q) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (selectedCountry) params.set('country', selectedCountry);
  params.set('limit', '20');
  const res = await fetch(`${API_BASE}/api/unmapped-courses?${params.toString()}`);
  if (!res.ok) throw new Error('search failed');
  const data = await res.json();
  return Array.isArray(data.courses) ? data.courses : [];
}

function renderCourseResults(courses) {
  const list = document.getElementById('course-list');
  if (!courses.length) {
    list.innerHTML = '<p class="course-empty">No matches. Try a different name.</p>';
    return;
  }
  list.innerHTML = courses.map(c => {
    const loc = c.location || c.country || '';
    return `<div class="course-result"><span class="course-name">${escapeHtml(c.name)}</span>${loc ? `<span class="course-loc">${escapeHtml(loc)}</span>` : ''}</div>`;
  }).join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[ch]));
}

function setHint(text) {
  const hint = document.getElementById('course-search-hint');
  if (hint) hint.textContent = text;
}

async function runQuery() {
  const q = (searchInput && searchInput.value.trim()) || '';
  const seq = ++searchSeq;
  setHint(q ? 'Searching…' : (selectedCountry ? `Loading ${selectedCountry} courses…` : 'Loading…'));
  try {
    const courses = await fetchCourses(q);
    if (seq !== searchSeq) return; // a newer query started
    renderCourseResults(courses);
    if (q) {
      setHint(`${courses.length} match${courses.length === 1 ? '' : 'es'}${selectedCountry ? ` in ${selectedCountry}` : ''}`);
    } else if (selectedCountry) {
      setHint(`Sample courses in ${selectedCountry} — type to search`);
    } else {
      setHint('Live search across 28,000+ courses worldwide');
    }
  } catch {
    if (seq !== searchSeq) return;
    setHint('Search temporarily unavailable.');
  }
}

function scheduleQuery(delay = 220) {
  if (searchDebounce) clearTimeout(searchDebounce);
  searchDebounce = setTimeout(runQuery, delay);
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
const searchBox = document.getElementById('course-search-box');
const searchClear = document.getElementById('course-search-clear');

function syncClearVisibility() {
  if (!searchBox || !searchInput) return;
  searchBox.classList.toggle('has-value', searchInput.value.length > 0);
}

if (searchInput) {
  searchInput.addEventListener('input', () => {
    syncClearVisibility();
    scheduleQuery(220);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      searchInput.value = '';
      syncClearVisibility();
      scheduleQuery(0);
    }
  });
}
if (searchClear) {
  searchClear.addEventListener('click', () => {
    if (!searchInput) return;
    searchInput.value = '';
    syncClearVisibility();
    searchInput.focus();
    scheduleQuery(0);
  });
}

// ── Country tab wiring ──
document.querySelectorAll('.country-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.country-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    selectedCountry = tab.dataset.country || '';
    scheduleQuery(0);
  });
});

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
runQuery();
updateSlots();
