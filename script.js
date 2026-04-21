// ── Course data by country ──
const COURSES = {
  Malaysia: [
    'KLGCC East', 'KLGCC West', 'KGPA', 'Saujana Palm', 'Saujana Bunga Raya',
    'Glenmarie Garden', 'Glenmarie Valley', 'Templer Park', 'Rahman Putra Hills',
    'Rahman Putra Lakes', 'Kota Permai', 'Kota Seriemas', 'The Mines Resort',
    'Seri Selangor', 'Bukit Jalil', 'Nilai Springs', 'Palm Garden',
    'KGNS Kelana', 'KGNS Putra', 'KGSAAS', 'Damai Laut',
    'Bangi Golf Resort', 'Els Club Desaru Valley', 'Els Club Teluk Datai',
    'Kinrara Golf Club', 'Bukit Unggul Country Club',
  ],
  Singapore: [
    'Coming soon…'
  ],
  Indonesia: [
    'Coming soon…'
  ]
};

let activeCountry = 'Malaysia';

function renderCourses(country) {
  activeCountry = country;
  const list = document.getElementById('course-list');
  list.innerHTML = COURSES[country].map(c =>
    `<span class="course-tag">${c}</span>`
  ).join('');
  document.querySelectorAll('.country-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.country === country);
  });
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

// ── Country tabs ──
document.querySelectorAll('.country-tab').forEach(tab => {
  tab.addEventListener('click', () => renderCourses(tab.dataset.country));
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
renderCourses('Malaysia');
updateSlots();
