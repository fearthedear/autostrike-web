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

test('team games place team results and the AI summary before individual content', async () => {
  const source = await readFile(new URL('../round/round.js', `file://${__filename}`), 'utf8');
  const renderStart = source.indexOf('root.innerHTML = `');
  const teamResults = source.indexOf('teamResultsMarkup(teamResults)', renderStart);
  const aiSummary = source.indexOf('teamSummaryMarkup(teamResults)', renderStart);
  const individualStats = source.indexOf('Individual Stats', renderStart);
  const individualResults = source.indexOf('individualResultsMarkup(teamResults)', renderStart);

  assert.ok(teamResults > renderStart);
  assert.ok(aiSummary > teamResults);
  assert.ok(individualStats > aiSummary);
  assert.ok(individualResults > individualStats);
});
