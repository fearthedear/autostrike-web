const APP_STORE_URL = 'https://apps.apple.com/us/app/autostrike-golf/id6762587973';

const root = document.getElementById('round-root');
const roundId = new URLSearchParams(window.location.search).get('id')?.trim() || '';

if (!roundId) {
  renderError('This round link is missing a round ID.');
} else {
  loadRound(roundId);
}

async function loadRound(id) {
  renderLoading();
  try {
    const response = await fetch(`/api/round?id=${encodeURIComponent(id)}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.round) {
      throw new Error(payload.error || 'Round not found.');
    }
    renderRound(payload.round);
  } catch (error) {
    renderError(error instanceof Error ? error.message : 'Could not load this round.');
  }
}

function renderLoading() {
  root.innerHTML = statusCard('Loading round...');
}

function renderError(message) {
  root.innerHTML = `
    <section class="round-card round-status-card">
      ${logoMarkup()}
      <p class="round-eyebrow">AutoStrike Golf</p>
      <h1>Round unavailable</h1>
      <p class="round-muted">${escapeHtml(message)}</p>
      ${actionsMarkup()}
    </section>
  `;
}

function statusCard(title) {
  return `
    <section class="round-card round-status-card">
      ${logoMarkup()}
      <p class="round-eyebrow">Shared round</p>
      <h1>${escapeHtml(title)}</h1>
    </section>
  `;
}

function renderRound(round) {
  const scorecard = buildScorecard(round);
  const metrics = scorecard.metrics || emptyMetrics();
  const totalScore = metrics.totalScore ?? round.totalScore;
  const totalScoreText = numberText(totalScore);
  const toParValue = metrics.toPar ?? round.toPar;
  const toParText = typeof toParValue === 'number' ? formatToPar(toParValue) : '-';
  const teeText = teeBoxDisplayText(round);
  const sectionsMarkup = scorecard.sections.length
    ? scorecard.sections.map(scorecardSectionMarkup).join('')
    : '<p class="round-muted">Hole-by-hole details are unavailable for this round.</p>';

  root.innerHTML = `
    <section class="round-card round-hero">
      <div class="round-heading">
        ${logoMarkup()}
        <p class="round-eyebrow">AutoStrike Golf round</p>
        <h1>${escapeHtml(round.courseName || 'AutoStrike round')}</h1>
        <div class="round-meta">
          ${teeText ? `<span><strong>Tees played:</strong> ${escapeHtml(teeText)}</span>` : ''}
          <span>${escapeHtml(formatPlayedOn(round.playedOn))}</span>
        </div>
      </div>
      <div class="round-score">
        <span class="round-score-number">${escapeHtml(totalScoreText)}</span>
        <span class="round-to-par ${toParClassName(toParValue)}">${escapeHtml(toParText)}</span>
      </div>
    </section>

    <section class="round-card">
      <p class="round-eyebrow">Player Stats</p>
      <h2>Round summary</h2>
      <div class="round-stats-grid">
        ${metricMarkup('Score', `${totalScoreText} (${toParText})`)}
        ${metricMarkup('Holes Played', String(metrics.scoredHoleCount))}
        ${metricMarkup('Total Putts', numberText(metrics.totalPutts))}
        ${metricMarkup('GIR', metrics.girText)}
        ${metricMarkup('Birdies+', String(metrics.birdieOrBetterCount))}
        ${metricMarkup('Pars', String(metrics.parCount))}
        ${metricMarkup('Bogeys', String(metrics.bogeyCount))}
        ${metricMarkup('Double+', String(metrics.doubleBogeyOrWorseCount))}
      </div>
    </section>

    <section class="round-card">
      <p class="round-eyebrow">Scorecard</p>
      <h2>Hole by hole</h2>
      <div class="round-scorecard-stack">${sectionsMarkup}</div>
    </section>

    <section class="round-card round-download-card">
      <div>
        <p class="round-eyebrow">Play smarter golf</p>
        <h2>Track your next round with AutoStrike</h2>
        <p class="round-muted">Shot tracking, smart club suggestions, scorecards, and round summaries built for iPhone and Apple Watch.</p>
      </div>
      ${actionsMarkup()}
    </section>
  `;
}

function logoMarkup() {
  return `
    <a class="round-logo" href="/">
      <img src="/logo.webp" alt="AutoStrike Golf">
      <span>AutoStrike <strong>Golf</strong></span>
    </a>
  `;
}

function actionsMarkup() {
  return `
    <div class="round-actions">
      <a class="round-button round-button-primary" href="${APP_STORE_URL}" onclick="return handleDownloadClick(event)">Download AutoStrike</a>
    </div>
    <div class="round-modal-overlay" id="round-download-modal" onclick="closeRoundModal(event)">
      <div class="round-modal">
        <button class="round-modal-close" onclick="closeRoundModal()">&times;</button>
        <h2>AutoStrike Golf</h2>
        <p>Scan with your iPhone camera to open or install</p>
        <div class="round-modal-qr"><img src="https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=8&data=https%3A%2F%2Fapps.apple.com%2Fus%2Fapp%2Fautostrike-golf%2Fid6762587973" alt="QR Code for App Store"></div>
        <a href="${APP_STORE_URL}" target="_blank" rel="noopener">
          <img src="/app-store-badge.svg" alt="Download on the App Store" style="height:44px">
        </a>
      </div>
    </div>
  `;
}

function metricMarkup(label, value) {
  return `
    <div class="round-stat">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function scorecardSectionMarkup(section) {
  return `
    <div class="round-scorecard-section">
      <h3>${escapeHtml(section.title)}</h3>
      ${scorecardRowMarkup('Hole', section.holes, (hole) => escapeHtml(String(hole.holeNumber)), 'Tot', true)}
      ${scorecardRowMarkup('Par', section.holes, (hole) => escapeHtml(String(hole.par)), sumText(section.holes, 'par'), true)}
      ${scorecardRowMarkup('You', section.holes, scoreCellMarkup, sumText(section.holes, 'score'))}
      ${scorecardRowMarkup('Putts', section.holes, (hole) => escapeHtml(numberText(hole.putts)), sumText(section.holes, 'putts'), true)}
    </div>
  `;
}

function scorecardRowMarkup(label, holes, value, total, muted = false) {
  return `
    <div class="round-scorecard-row ${muted ? 'round-scorecard-row-muted' : ''}">
      <span class="round-scorecard-label">${escapeHtml(label)}</span>
      ${holes.map((hole) => `<span class="round-scorecard-cell">${value(hole)}</span>`).join('')}
      <span class="round-scorecard-total">${escapeHtml(total)}</span>
    </div>
  `;
}

function scoreCellMarkup(hole) {
  if (!hole.score) {
    return '-';
  }
  const relativeToPar = hole.score - hole.par;
  const className =
    relativeToPar <= -2
      ? 'round-score-eagle'
      : relativeToPar === -1
        ? 'round-score-birdie'
        : relativeToPar === 1
          ? 'round-score-bogey'
          : relativeToPar >= 2
            ? 'round-score-double'
            : '';
  return `<span class="round-score-mark ${className}">${escapeHtml(String(hole.score))}</span>`;
}

function buildScorecard(round) {
  const holes = scorecardHoles(round);
  return {
    sections: groupedSections(holes),
    metrics: playerMetrics(holes),
  };
}

function scorecardHoles(round) {
  const metadata = isRecord(round.metadata) ? round.metadata : {};
  const roundHoleSources = holeSourcesFrom(metadata.round_holes ?? metadata.roundHoles);
  const breakdownSources = holeSourcesFrom(metadata.hole_breakdown ?? metadata.holeBreakdown ?? metadata.holes);
  const scoreByHole = intMapFrom(metadata.score_by_hole ?? metadata.scoreByHole);
  const puttsByHole = intMapFrom(metadata.putts_by_hole ?? metadata.puttsByHole);
  const breakdownById = new Map();
  const breakdownByHoleNumber = new Map();

  breakdownSources.forEach(({ record, fallbackHoleNumber }) => {
    const id = stringField(record, ['id']);
    const holeNumber = intField(record, ['hole_number', 'holeNumber', 'hole', 'number']) ?? fallbackHoleNumber;
    if (id) breakdownById.set(id, record);
    if (holeNumber) breakdownByHoleNumber.set(holeNumber, record);
  });

  const sources = roundHoleSources.length > 0 ? roundHoleSources : breakdownSources;

  return sources
    .map(({ record, fallbackHoleNumber }, index) => {
      const holeNumber = intField(record, ['hole_number', 'holeNumber', 'hole', 'number']) ?? fallbackHoleNumber ?? index + 1;
      const id = stringField(record, ['id']) ?? `hole-${holeNumber}`;
      const breakdown = breakdownById.get(id) ?? breakdownByHoleNumber.get(holeNumber);
      const par = intField(record, ['par']) ?? intField(breakdown, ['par']) ?? 4;
      const score = scoreByHole[id] ?? intField(breakdown, ['score', 'strokes', 'gross_score', 'grossScore']) ?? null;
      const putts = puttsByHole[id] ?? intField(breakdown, ['putts', 'putt_count', 'puttCount']) ?? null;
      const nineName =
        stringField(record, ['nine_name', 'nineName']) ??
        stringField(breakdown, ['nine_name', 'nineName']) ??
        (holeNumber <= 9 ? 'Front Nine' : 'Back Nine');

      return {
        id,
        sequence: intField(record, ['sequence']) ?? index,
        holeNumber,
        nineName,
        par,
        score,
        putts,
      };
    })
    .sort((left, right) => left.sequence - right.sequence || left.holeNumber - right.holeNumber);
}

function groupedSections(holes) {
  const sections = [];
  holes.forEach((hole) => {
    const title = hole.nineName.trim() || (hole.holeNumber <= 9 ? 'Front Nine' : 'Back Nine');
    const lastSection = sections[sections.length - 1];
    if (lastSection?.title === title) {
      lastSection.holes.push(hole);
      return;
    }
    sections.push({ id: `${sections.length}-${title}`, title, holes: [hole] });
  });
  return sections;
}

function playerMetrics(holes) {
  let scoredHoleCount = 0;
  let runningScore = 0;
  let runningPar = 0;
  let runningPutts = 0;
  let girCount = 0;
  let girEligibleHoleCount = 0;
  let birdieOrBetterCount = 0;
  let parCount = 0;
  let bogeyCount = 0;
  let doubleBogeyOrWorseCount = 0;

  holes.forEach((hole) => {
    if (!hole.score || hole.score <= 0) return;

    scoredHoleCount += 1;
    runningScore += hole.score;
    runningPar += hole.par;

    const holeToPar = hole.score - hole.par;
    if (holeToPar <= -1) {
      birdieOrBetterCount += 1;
    } else if (holeToPar === 0) {
      parCount += 1;
    } else if (holeToPar === 1) {
      bogeyCount += 1;
    } else {
      doubleBogeyOrWorseCount += 1;
    }

    if (typeof hole.putts === 'number' && hole.putts >= 0) {
      runningPutts += hole.putts;
      girEligibleHoleCount += 1;
      const strokesToReachGreen = Math.max(0, hole.score - hole.putts);
      const girThreshold = Math.max(1, hole.par - 2);
      if (strokesToReachGreen <= girThreshold) {
        girCount += 1;
      }
    }
  });

  const girPercentage = girEligibleHoleCount > 0 ? Math.round((girCount / girEligibleHoleCount) * 100) : null;

  return {
    scoredHoleCount,
    totalScore: scoredHoleCount > 0 ? runningScore : null,
    toPar: scoredHoleCount > 0 && runningPar > 0 ? runningScore - runningPar : null,
    totalPutts: girEligibleHoleCount > 0 ? runningPutts : null,
    girText: girPercentage === null ? '-' : `${girCount}/${girEligibleHoleCount} (${girPercentage}%)`,
    birdieOrBetterCount,
    parCount,
    bogeyCount,
    doubleBogeyOrWorseCount,
  };
}

function emptyMetrics() {
  return {
    scoredHoleCount: 0,
    totalScore: null,
    toPar: null,
    totalPutts: null,
    girText: '-',
    birdieOrBetterCount: 0,
    parCount: 0,
    bogeyCount: 0,
    doubleBogeyOrWorseCount: 0,
  };
}

function holeSourcesFrom(value) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => (isRecord(item) ? [{ record: item, fallbackHoleNumber: null }] : []));
  }

  if (!isRecord(value)) {
    return [];
  }

  return Object.entries(value).flatMap(([key, item]) =>
    isRecord(item) ? [{ record: item, fallbackHoleNumber: toInteger(key) }] : [],
  );
}

function intMapFrom(value) {
  if (!isRecord(value)) {
    return {};
  }

  return Object.entries(value).reduce((result, [key, rawValue]) => {
    const parsedValue = toInteger(rawValue);
    if (typeof parsedValue === 'number') {
      result[key] = parsedValue;
    }
    return result;
  }, {});
}

function stringField(record, keys) {
  if (!isRecord(record)) {
    return null;
  }

  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function intField(record, keys) {
  if (!isRecord(record)) {
    return null;
  }

  for (const key of keys) {
    const value = toInteger(record[key]);
    if (typeof value === 'number') {
      return value;
    }
  }

  return null;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toInteger(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value);
  }

  if (typeof value === 'string' && value.trim()) {
    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) ? Math.round(parsedValue) : null;
  }

  return null;
}

function teeBoxDisplayText(round) {
  if (typeof round.teeBoxName === 'string' && round.teeBoxName.trim()) {
    return round.teeBoxName.trim();
  }
  if (typeof round.teeBoxSourceIndex === 'number') {
    return `Tee ${Math.max(0, round.teeBoxSourceIndex) + 1}`;
  }
  return null;
}

function sumText(holes, key) {
  const values = holes.map((hole) => hole[key]).filter((value) => typeof value === 'number' && Number.isFinite(value));
  return values.length > 0 ? String(values.reduce((total, value) => total + value, 0)) : '-';
}

function numberText(value) {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '-';
}

function formatToPar(toPar) {
  if (toPar === 0) {
    return 'E';
  }
  return toPar > 0 ? `+${toPar}` : `${toPar}`;
}

function toParClassName(toPar) {
  if (typeof toPar !== 'number') {
    return '';
  }
  if (toPar > 0) {
    return 'round-to-par-over';
  }
  if (toPar < 0) {
    return 'round-to-par-under';
  }
  return '';
}

function formatPlayedOn(value) {
  if (!value) {
    return 'Round date unavailable';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

// ── Download modal (same behavior as landing page) ──
function handleDownloadClick(event) {
  if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
    return true; // follow the href to App Store
  }
  event.preventDefault();
  document.getElementById('round-download-modal').classList.add('open');
  return false;
}

function closeRoundModal(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById('round-download-modal').classList.remove('open');
}

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    const modal = document.getElementById('round-download-modal');
    if (modal) modal.classList.remove('open');
  }
});
