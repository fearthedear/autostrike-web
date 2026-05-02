// ── Live course search (autostrike-dashboard catalog API) ──
const API_BASE = 'https://autostrike-dashboard.vercel.app';
const PAGE_SIZE = 10;
let searchDebounce = null;
let searchSeq = 0;        // discard out-of-order responses
let selectedCountry = '';
let currentOffset = 0;
let currentTotal = 0;

async function fetchCourses(q, offset) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (selectedCountry) params.set('country', selectedCountry);
  params.set('limit', String(PAGE_SIZE));
  params.set('offset', String(offset || 0));
  const res = await fetch(`${API_BASE}/api/unmapped-courses?${params.toString()}`);
  if (!res.ok) throw new Error('search failed');
  return res.json();
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

function clearCourseList() {
  const list = document.getElementById('course-list');
  if (list) list.innerHTML = '';
  const pager = document.getElementById('course-pager');
  if (pager) pager.hidden = true;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[ch]));
}

function setHint(text) {
  const hint = document.getElementById('course-search-hint');
  if (hint) hint.textContent = text;
}

function updatePager(q) {
  const pager = document.getElementById('course-pager');
  const info = document.getElementById('pager-info');
  const prev = document.getElementById('pager-prev');
  const next = document.getElementById('pager-next');
  if (!pager) return;
  if (currentTotal <= PAGE_SIZE) {
    pager.hidden = true;
    return;
  }
  pager.hidden = false;
  const start = currentOffset + 1;
  const end = Math.min(currentOffset + PAGE_SIZE, currentTotal);
  info.textContent = `${start.toLocaleString()}–${end.toLocaleString()} of ${currentTotal.toLocaleString()}`;
  prev.disabled = currentOffset === 0;
  next.disabled = currentOffset + PAGE_SIZE >= currentTotal;
}

async function runQuery() {
  const q = (searchInput && searchInput.value.trim()) || '';

  // Default state: nothing selected, nothing typed -> show nothing.
  if (!q && !selectedCountry) {
    searchSeq++;
    currentOffset = 0;
    currentTotal = 0;
    clearCourseList();
    setHint('Pick a country or search for a course to explore the catalog.');
    return;
  }

  const seq = ++searchSeq;
  setHint(q ? 'Searching…' : `Loading ${selectedCountry} courses…`);
  try {
    const data = await fetchCourses(q, currentOffset);
    if (seq !== searchSeq) return; // a newer query started
    const courses = Array.isArray(data.courses) ? data.courses : [];
    currentTotal = typeof data.total === 'number' ? data.total : courses.length;
    renderCourseResults(courses);
    updatePager(q);
    if (q && selectedCountry) {
      setHint(`${currentTotal.toLocaleString()} match${currentTotal === 1 ? '' : 'es'} in ${selectedCountry}`);
    } else if (q) {
      setHint(`${currentTotal.toLocaleString()} match${currentTotal === 1 ? '' : 'es'} worldwide`);
    } else {
      setHint(`${currentTotal.toLocaleString()} courses in ${selectedCountry} — type to narrow`);
    }
  } catch {
    if (seq !== searchSeq) return;
    setHint('Search temporarily unavailable.');
  }
}

function scheduleQuery(delay = 220, resetOffset = true) {
  if (resetOffset) currentOffset = 0;
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

// ── Country tab wiring (toggle on / off) ──
document.querySelectorAll('.country-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const country = tab.dataset.country || '';
    if (selectedCountry === country) {
      // toggle off
      tab.classList.remove('active');
      selectedCountry = '';
    } else {
      document.querySelectorAll('.country-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      selectedCountry = country;
    }
    scheduleQuery(0);
  });
});

// ── Pager wiring ──
const pagerPrev = document.getElementById('pager-prev');
const pagerNext = document.getElementById('pager-next');
if (pagerPrev) pagerPrev.addEventListener('click', () => {
  if (currentOffset === 0) return;
  currentOffset = Math.max(0, currentOffset - PAGE_SIZE);
  scheduleQuery(0, false);
});
if (pagerNext) pagerNext.addEventListener('click', () => {
  if (currentOffset + PAGE_SIZE >= currentTotal) return;
  currentOffset += PAGE_SIZE;
  scheduleQuery(0, false);
});

// ── Init ──
runQuery();   // shows the default empty hint, no list
