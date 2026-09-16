const APP_STORE_URL = 'https://apps.apple.com/us/app/autostrike-golf/id6762587973';

const root = document.getElementById('round-root');
const roundId = new URLSearchParams(window.location.search).get('id')?.trim() || '';
let activeRound = null;
let roundViewState = { scorecardMode: 'stroke_play', basis: 'gross', selectedPlayerId: null };

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
    activeRound = payload.round;
    roundViewState = initialRoundViewState(activeRound);
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
  let scorecard = buildScorecard(round, roundViewState.selectedPlayerId);
  const ownerScorecard = buildScorecard(round);
  const playerResults = window.AutoStrikeTeamResults?.buildIndividualResults(
    round,
    scorecard.holes,
    roundViewState,
  ) || null;
  if (playerResults?.individualResults.length && !playerResults.individualResults.some((player) => player.id === roundViewState.selectedPlayerId)) {
    roundViewState.selectedPlayerId = playerResults.individualResults[0].id;
    scorecard = buildScorecard(round, roundViewState.selectedPlayerId);
  }
  const selectedResult = playerResults?.individualResults.find((player) => player.id === roundViewState.selectedPlayerId) || null;
  const scoredSections = sectionsWithPlayerResults(scorecard.sections, selectedResult);
  const metrics = ownerScorecard.metrics || emptyMetrics();
  const teamResults = window.AutoStrikeTeamResults?.buildTeamResults(round, scorecard.holes) || null;
  const totalScore = metrics.totalScore ?? round.totalScore;
  const totalScoreText = numberText(totalScore);
  const toParValue = metrics.toPar ?? round.toPar;
  const toParText = typeof toParValue === 'number' ? formatToPar(toParValue) : '-';
  const teeText = teeBoxDisplayText(round);
  const sectionsMarkup = scoredSections.length
    ? scoredSections.map((section) => scorecardSectionMarkup(
      section,
      scorecard.playerName,
      roundViewState.scorecardMode,
      roundViewState.basis,
    )).join('')
    : '<p class="round-muted">Hole-by-hole details are unavailable for this round.</p>';
  const heroScoreMarkup = teamResults ? '' : `
      <div class="round-score">
        <span class="round-score-number">${escapeHtml(totalScoreText)}</span>
        <span class="round-to-par ${toParClassName(toParValue)}">${escapeHtml(toParText)}</span>
      </div>
    `;

  root.innerHTML = `
    <section class="round-card round-hero">
      <div class="round-heading">
        ${logoMarkup()}
        <p class="round-eyebrow">AutoStrike Golf round</p>
        <h1>${escapeHtml(round.courseName || 'AutoStrike round')}</h1>
        <div class="round-meta">
          <span class="round-played-on"><span>Played on</span><strong>${escapeHtml(formatPlayedOn(round.playedOn))}</strong></span>
          ${teeText ? `<span class="round-tee-pill">${escapeHtml(teeText)} tees</span>` : ''}
        </div>
      </div>
      ${heroScoreMarkup}
    </section>

    ${teamResults ? teamResultsMarkup(teamResults) : ''}

    ${teamResults ? teamSummaryMarkup(teamResults, round) : ''}

    ${playerResults?.individualResults.length ? playerLeaderboardMarkup(playerResults, roundViewState.selectedPlayerId) : ''}

    <section class="round-card">
      <p class="round-eyebrow">Scorecard</p>
      <h2>${escapeHtml(`${scorecard.playerName}'s scorecard`)}</h2>
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

    <section class="round-card round-individual-stats">
      <p class="round-eyebrow">Individual Stats</p>
      <h2>${escapeHtml(`${ownerScorecard.playerName}'s round`)}</h2>
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
  `;
  bindRoundInteractions();
}

function initialRoundViewState(round) {
  const metadata = isRecord(round.metadata) ? round.metadata : {};
  const scorecardMode = normalizedMode(
    metadata.multiplayer_scorecard_mode ?? metadata.multiplayerScorecardMode,
    ['stableford', 'stroke_play'],
    'stroke_play',
  );
  const basis = normalizedMode(
    metadata.multiplayer_scorecard_basis ?? metadata.multiplayerScorecardBasis,
    ['net', 'gross'],
    'gross',
  );
  return { scorecardMode, basis, selectedPlayerId: null };
}

function normalizedMode(value, allowed, fallback) {
  const token = typeof value === 'string' ? value.trim().toLowerCase().replace(/[ -]+/g, '_') : '';
  return allowed.includes(token) ? token : fallback;
}

function bindRoundInteractions() {
  root.querySelectorAll('[data-player-id]').forEach((button) => {
    button.addEventListener('click', () => {
      roundViewState.selectedPlayerId = button.dataset.playerId || null;
      renderRound(activeRound);
    });
  });
  root.querySelectorAll('[data-scorecard-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      roundViewState.scorecardMode = button.dataset.scorecardMode;
      renderRound(activeRound);
    });
  });
  root.querySelectorAll('[data-scorecard-basis]').forEach((button) => {
    button.addEventListener('click', () => {
      roundViewState.basis = button.dataset.scorecardBasis;
      renderRound(activeRound);
    });
  });
}

function teamResultsMarkup(results) {
  const formatLabel = results.scoringMode === 'scramble' ? 'Scramble' : 'Best ball';
  const scoreLabel = results.scorecardMode === 'stableford' ? 'Stableford' : 'Stroke play';
  const basisLabel = results.basis === 'net' ? 'Net' : 'Gross';
  const tiedLead = results.teams.filter((team) => team.rank === 1 && team.total !== null).length > 1;

  return `
    <section class="round-card round-team-results">
      <div class="round-section-heading">
        <div>
          <p class="round-eyebrow">Team Results</p>
          <h2>${escapeHtml(formatLabel)}</h2>
        </div>
        <span class="round-format-pill">${escapeHtml(`${basisLabel} ${scoreLabel}`)}</span>
      </div>
      ${results.isBasisFallback ? '<p class="round-team-note">Net results could not be reconstructed for this shared round, so gross scores are shown.</p>' : ''}
      <div class="round-team-grid">
        ${results.teams.map((team) => teamCardMarkup(team, results.scorecardMode, tiedLead)).join('')}
      </div>
    </section>
  `;
}

function teamCardMarkup(team, scorecardMode, tiedLead) {
  const resultText = team.total === null
    ? '-'
    : scorecardMode === 'stableford'
      ? `${team.total} pts`
      : `${team.total}${typeof team.toPar === 'number' ? ` (${formatToPar(team.toPar)})` : ''}`;
  const rankText = team.total === null
    ? 'No score'
    : team.rank === 1 && tiedLead
      ? 'Tied lead'
      : team.rank === 1
        ? 'Winner'
        : ordinal(team.rank);
  const memberNames = team.members.map((member) => member.name).join(' · ');
  const showMembers = team.displayName === team.name;

  return `
    <article class="round-team-card ${team.rank === 1 && team.total !== null ? 'round-team-card-leading' : ''}">
      <div class="round-team-card-heading">
        <span class="round-team-rank">${escapeHtml(rankText)}</span>
        <strong>${escapeHtml(team.displayName)}</strong>
      </div>
      <span class="round-team-score">${escapeHtml(resultText)}</span>
      ${showMembers ? `<span class="round-team-members">${escapeHtml(memberNames)}</span>` : ''}
      <span class="round-team-holes">${escapeHtml(`${team.completedHoleCount} holes scored`)}</span>
    </article>
  `;
}

function teamSummaryMarkup(results, round) {
  const storedSummary = round?.metadata?.ai_round_summary ?? round?.metadata?.aiRoundSummary;
  const storedSentences = Array.isArray(storedSummary?.sentences)
    ? storedSummary.sentences.filter((sentence) => typeof sentence === 'string' && sentence.trim())
    : [];
  const sentences = storedSummary?.version === 2 && storedSentences.length === 5
    ? storedSentences
    : Array.isArray(results.summarySentences) ? results.summarySentences : [];
  if (!sentences.length) return '';
  return `
    <section class="round-card round-ai-summary">
      <p class="round-eyebrow">AI Round Summary</p>
      <h2>How the match unfolded</h2>
      <p>${sentences.map((sentence) => escapeHtml(sentence)).join(' ')}</p>
      <span>Generated from the hole-by-hole scores.</span>
    </section>
  `;
}

function playerLeaderboardMarkup(results, selectedPlayerId) {
  const tiedLead = results.individualResults.filter((player) => player.rank === 1 && player.total !== null).length > 1;
  return `
    <section class="round-card round-individual-results">
      <div class="round-section-heading">
        <div>
          <p class="round-eyebrow">Players</p>
          <h2>Player leaderboard</h2>
        </div>
        <div class="round-view-controls" aria-label="Leaderboard scoring options">
          ${segmentedControlMarkup('Scoring', [
            { value: 'stableford', label: 'Stableford' },
            { value: 'stroke_play', label: 'Stroke' },
          ], results.scorecardMode, 'scorecard-mode')}
          ${segmentedControlMarkup('Handicap', [
            { value: 'net', label: 'On' },
            { value: 'gross', label: 'Off' },
          ], results.basis, 'scorecard-basis')}
        </div>
      </div>
      <div class="round-individual-list">
        ${results.individualResults.map((player) => individualResultMarkup(
          player,
          results.scorecardMode,
          tiedLead,
          player.id === selectedPlayerId,
        )).join('')}
      </div>
      <p class="round-player-hint">Select a player to view their scorecard.</p>
    </section>
  `;
}

function segmentedControlMarkup(label, options, selectedValue, dataAttribute) {
  return `
    <div class="round-control-group">
      <span>${escapeHtml(label)}</span>
      <div class="round-segmented" role="group" aria-label="${escapeHtml(label)}">
        ${options.map((option) => `
          <button
            type="button"
            data-${dataAttribute}="${escapeHtml(option.value)}"
            class="${option.value === selectedValue ? 'is-active' : ''}"
            aria-pressed="${option.value === selectedValue ? 'true' : 'false'}"
          >${escapeHtml(option.label)}</button>
        `).join('')}
      </div>
    </div>
  `;
}

function individualResultMarkup(player, scorecardMode, tiedLead, isSelected) {
  const resultText = player.total === null
    ? '-'
    : scorecardMode === 'stableford'
      ? `${player.total} pts`
      : `${player.total}${typeof player.toPar === 'number' ? ` (${formatToPar(player.toPar)})` : ''}`;
  const rankText = player.total === null
    ? 'No score'
    : player.rank === 1 && tiedLead
      ? 'Tied lead'
      : player.rank === 1
        ? '1st'
        : ordinal(player.rank);
  return `
    <button
      type="button"
      class="round-individual-row ${player.rank === 1 && player.total !== null ? 'round-individual-row-leading' : ''} ${isSelected ? 'round-individual-row-selected' : ''}"
      data-player-id="${escapeHtml(player.id)}"
      aria-pressed="${isSelected ? 'true' : 'false'}"
    >
      <span class="round-individual-rank">${escapeHtml(rankText)}</span>
      <strong>${escapeHtml(player.name)}</strong>
      <span class="round-individual-handicap">${escapeHtml(`Playing handicap ${player.playingHandicap}`)}</span>
      <span class="round-individual-score">${escapeHtml(resultText)}</span>
    </button>
  `;
}

function ordinal(value) {
  const remainder100 = value % 100;
  if (remainder100 >= 11 && remainder100 <= 13) return `${value}th`;
  if (value % 10 === 1) return `${value}st`;
  if (value % 10 === 2) return `${value}nd`;
  if (value % 10 === 3) return `${value}rd`;
  return `${value}th`;
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

function scorecardSectionMarkup(section, playerName, scorecardMode, basis) {
  const showNet = basis === 'net';
  const showPoints = scorecardMode === 'stableford';
  return `
    <div class="round-scorecard-section">
      <h3>${escapeHtml(section.title)}</h3>
      ${scorecardRowMarkup('Hole', section.holes, (hole) => escapeHtml(String(hole.playedNumber)), 'Tot', true)}
      ${scorecardRowMarkup('Par', section.holes, (hole) => escapeHtml(String(hole.par)), sumText(section.holes, 'par'), true)}
      ${scorecardRowMarkup('Strokes', section.holes, scoreCellMarkup, sumText(section.holes, 'score'))}
      ${showNet ? scorecardRowMarkup('Net', section.holes, netScoreCellMarkup, sumText(section.holes, 'adjustedScore'), true) : ''}
      ${showPoints ? scorecardRowMarkup('Points', section.holes, pointsCellMarkup, sumText(section.holes, 'points')) : ''}
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

function netScoreCellMarkup(hole) {
  return escapeHtml(numberText(hole.adjustedScore));
}

function pointsCellMarkup(hole) {
  return escapeHtml(numberText(hole.points));
}

function sectionsWithPlayerResults(sections, playerResult) {
  const resultByHoleId = new Map((playerResult?.holeResults || []).map((hole) => [hole.holeId, hole]));
  return sections.map((section) => ({
    ...section,
    holes: section.holes.map((hole) => {
      const result = resultByHoleId.get(hole.id);
      return {
        ...hole,
        adjustedScore: typeof result?.adjustedScore === 'number' ? result.adjustedScore : null,
        points: typeof result?.value === 'number' ? result.value : null,
      };
    }),
  }));
}

function buildScorecard(round, playerId = null) {
  const holes = scorecardHoles(round, playerId);
  const player = playerForRound(round, playerId);
  return {
    holes,
    sections: groupedSections(holes),
    metrics: playerMetrics(holes),
    playerName: stringField(player, ['name']) || primaryPlayerName(round),
    playerId: stringField(player, ['id']),
  };
}

function primaryPlayerName(round) {
  const metadata = isRecord(round.metadata) ? round.metadata : {};
  const players = Array.isArray(metadata.players) ? metadata.players.filter(isRecord) : [];
  const primaryPlayerId = stringField(metadata, ['primary_player_id', 'primaryPlayerId']);
  const primaryPlayer = players.find((player) => stringField(player, ['id']) === primaryPlayerId);
  return stringField(primaryPlayer, ['name']) || 'You';
}

function playerForRound(round, playerId) {
  const metadata = isRecord(round.metadata) ? round.metadata : {};
  const players = Array.isArray(metadata.players) ? metadata.players.filter(isRecord) : [];
  const primaryPlayerId = stringField(metadata, ['primary_player_id', 'primaryPlayerId']);
  return players.find((player) => stringField(player, ['id']) === playerId) ??
    players.find((player) => stringField(player, ['id']) === primaryPlayerId) ??
    players[0] ??
    null;
}

function scorecardHoles(round, playerId = null) {
  const metadata = isRecord(round.metadata) ? round.metadata : {};
  const roundHoleSources = holeSourcesFrom(metadata.round_holes ?? metadata.roundHoles);
  const breakdownSources = holeSourcesFrom(metadata.hole_breakdown ?? metadata.holeBreakdown ?? metadata.holes);
  const player = playerForRound(round, playerId);
  const primaryPlayerId = stringField(metadata, ['primary_player_id', 'primaryPlayerId']);
  const selectedPlayerId = stringField(player, ['id']);
  const useRoundFallback = !selectedPlayerId || selectedPlayerId === primaryPlayerId;
  const scoreByHole = intMapFrom(
    player?.score_by_hole ?? player?.scoreByHole ??
    (useRoundFallback ? metadata.score_by_hole ?? metadata.scoreByHole : null),
  );
  const puttsByHole = intMapFrom(
    player?.putts_by_hole ?? player?.puttsByHole ??
    (useRoundFallback ? metadata.putts_by_hole ?? metadata.puttsByHole : null),
  );
  const breakdownById = new Map();
  const breakdownByHoleNumber = new Map();
  const courseHoleByNumber = new Map(
    (Array.isArray(round.courseHoles) ? round.courseHoles : []).flatMap((hole) => {
      if (!isRecord(hole)) return [];
      const holeNumber = intField(hole, ['holeNumber', 'hole_number', 'number']);
      return holeNumber ? [[holeNumber, hole]] : [];
    }),
  );

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
      const courseHole = courseHoleByNumber.get(holeNumber);
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
        strokeIndex: intField(record, ['stroke_index', 'strokeIndex', 'index']) ??
          intField(courseHole, ['stroke_index', 'strokeIndex', 'index']),
        score,
        putts,
      };
    })
    .sort((left, right) => left.sequence - right.sequence || left.holeNumber - right.holeNumber)
    .map((hole, index) => ({ ...hole, playedNumber: index + 1 }));
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
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOS) {
    return true; // follow the href to App Store
  }
  event.preventDefault();
  document.getElementById('round-download-modal').classList.add('open');
  document.body.classList.add('round-modal-open');
  return false;
}

function closeRoundModal(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById('round-download-modal').classList.remove('open');
  document.body.classList.remove('round-modal-open');
}

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    const modal = document.getElementById('round-download-modal');
    if (modal) closeRoundModal();
  }
});
