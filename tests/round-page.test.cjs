const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const test = require('node:test');

test('shared rounds are excluded from search indexing and the sitemap', async () => {
  const [html, sitemap, headers] = await Promise.all([
    readFile(new URL('../round/index.html', `file://${__filename}`), 'utf8'),
    readFile(new URL('../sitemap.xml', `file://${__filename}`), 'utf8'),
    readFile(new URL('../_headers', `file://${__filename}`), 'utf8'),
  ]);

  assert.match(html, /name="robots" content="noindex, nofollow, noarchive, nosnippet"/);
  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.doesNotMatch(sitemap, /\/round\/?</);
  assert.match(headers, /\/round\/\*[\s\S]*X-Robots-Tag: noindex/);
});

test('team games place the player leaderboard above scorecard and individual stats last', async () => {
  const source = await readFile(new URL('../round/round.js', `file://${__filename}`), 'utf8');
  const renderStart = source.indexOf('root.innerHTML = `');
  const teamResults = source.indexOf('teamResultsMarkup(teamResults)', renderStart);
  const aiSummary = source.indexOf('teamSummaryMarkup(teamResults, round)', renderStart);
  const leaderboard = source.indexOf('playerLeaderboardMarkup(playerResults', renderStart);
  const scorecard = source.indexOf('<p class="round-eyebrow">Scorecard</p>', renderStart);
  const download = source.indexOf('round-download-card', renderStart);
  const individualStats = source.indexOf('Individual Stats', renderStart);

  assert.ok(teamResults > renderStart);
  assert.ok(aiSummary > teamResults);
  assert.ok(leaderboard > aiSummary);
  assert.ok(scorecard > leaderboard);
  assert.ok(download > scorecard);
  assert.ok(individualStats > download);
});

test('player leaderboard exposes scoring, handicap, and player-selection controls', async () => {
  const source = await readFile(new URL('../round/round.js', `file://${__filename}`), 'utf8');
  assert.match(source, /data-scorecard-mode/);
  assert.match(source, /data-scorecard-basis/);
  assert.match(source, /data-player-id/);
  assert.match(source, /Select a player to view their scorecard\./);
  assert.match(source, /const ownerScorecard = buildScorecard\(round\)/);
  assert.match(source, /ownerScorecard\.playerName/);
});

test('scorecards label holes by play order and separate date from tee metadata', async () => {
  const [source, css] = await Promise.all([
    readFile(new URL('../round/round.js', `file://${__filename}`), 'utf8'),
    readFile(new URL('../round/round.css', `file://${__filename}`), 'utf8'),
  ]);

  assert.match(source, /playedNumber: index \+ 1/);
  assert.match(source, /String\(hole\.playedNumber\)/);
  assert.match(source, /class="round-played-on"/);
  assert.match(source, /<span>Played on<\/span><strong>/);
  assert.match(source, /class="round-tee-pill"/);
  assert.match(source, /\$\{escapeHtml\(teeText\)\} tees/);
  assert.match(css, /\.round-meta \{[\s\S]*flex-direction: column/);
});

test('team recap prefers a valid backend-generated summary with deterministic fallback', async () => {
  const source = await readFile(new URL('../round/round.js', `file://${__filename}`), 'utf8');
  assert.match(source, /teamSummaryMarkup\(teamResults, round\)/);
  assert.match(source, /metadata\?\.ai_round_summary/);
  assert.match(source, /storedSummary\?\.version === 2 && storedSentences\.length === 5/);
  assert.match(source, /results\.summarySentences/);
});

test('production workflow deploys the authenticated summary worker', async () => {
  const [workflow, worker, workerConfig] = await Promise.all([
    readFile(new URL('../.github/workflows/deploy.yml', `file://${__filename}`), 'utf8'),
    readFile(new URL('../workers/score-import/src/index.ts', `file://${__filename}`), 'utf8'),
    readFile(new URL('../workers/score-import/wrangler.jsonc', `file://${__filename}`), 'utf8'),
  ]);
  assert.match(workflow, /deploy --config workers\/score-import\/wrangler\.jsonc/);
  assert.match(worker, /url\.pathname === "\/round-summary"/);
  assert.match(worker, /authenticatedUserId\(env, req\)/);
  assert.match(worker, /score\.user_id/);
  assert.match(worker, /generateRecentCompletedTeamRoundSummaries/);
  assert.match(worker, /ai_round_summary_attempts/);
  assert.match(workerConfig, /"crons": \["\* \* \* \* \*"\]/);
});

test('download popup sits outside filtered cards and iOS follows the App Store link', async () => {
  const [html, source, css, qrCode] = await Promise.all([
    readFile(new URL('../round/index.html', `file://${__filename}`), 'utf8'),
    readFile(new URL('../round/round.js', `file://${__filename}`), 'utf8'),
    readFile(new URL('../round/round.css', `file://${__filename}`), 'utf8'),
    readFile(new URL('../app-store-qr.png', `file://${__filename}`)),
  ]);
  const renderStart = source.indexOf('root.innerHTML = `');
  const downloadCard = source.indexOf('round-download-card', renderStart);
  const individualStats = source.indexOf('round-individual-stats', renderStart);
  const roundRoot = html.indexOf('id="round-root"');
  const modal = html.indexOf('id="round-download-modal"');

  assert.ok(downloadCard > renderStart);
  assert.ok(individualStats > downloadCard);
  assert.ok(roundRoot > 0);
  assert.ok(modal > roundRoot);
  assert.doesNotMatch(source, /id="round-download-modal"/);
  assert.match(source, /iPhone\|iPad\|iPod/);
  assert.match(source, /navigator\.platform === 'MacIntel'/);
  assert.match(source, /return true; \/\/ follow the href to App Store/);
  assert.match(css, /max-height: calc\(100dvh - 32px\)/);
  assert.match(css, /body\.round-modal-open/);
  assert.match(html, /src="\/app-store-qr\.png"/);
  assert.ok(qrCode.length > 0);
});

test('round page keeps an always-visible download button on mobile and desktop', async () => {
  const [html, css] = await Promise.all([
    readFile(new URL('../round/index.html', `file://${__filename}`), 'utf8'),
    readFile(new URL('../round/round.css', `file://${__filename}`), 'utf8'),
  ]);
  const roundRoot = html.indexOf('id="round-root"');
  const fixedButton = html.indexOf('class="round-download-fixed"');

  assert.ok(roundRoot > 0);
  assert.ok(fixedButton > roundRoot);
  assert.match(html, /class="round-download-fixed"[\s\S]*Download AutoStrike/);
  assert.match(html, /round\.css\?v=downloadbar1/);
  assert.match(html, /round\.js\?v=downloadbar1/);
  assert.match(css, /\.round-download-fixed \{[\s\S]*position: fixed/);
  assert.match(css, /@media \(max-width: 760px\) \{[\s\S]*\.round-download-fixed \{[\s\S]*bottom: 0/);
  assert.match(css, /@media \(min-width: 761px\) \{[\s\S]*\.round-download-fixed \{[\s\S]*top: 24px/);
});
