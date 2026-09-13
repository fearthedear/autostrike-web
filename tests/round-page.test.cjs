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
  const aiSummary = source.indexOf('teamSummaryMarkup(teamResults)', renderStart);
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
  assert.match(source, /Select a player to view their scorecard and stats/);
});
