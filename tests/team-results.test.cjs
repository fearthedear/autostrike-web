const assert = require('node:assert/strict');
const test = require('node:test');
const { buildTeamResults, buildIndividualResults, strokeAdjustments, strokesReceived } = require('../round/team-results.js');

const holes = [
  { id: 'h1', par: 4, strokeIndex: 1 },
  { id: 'h2', par: 4, strokeIndex: 18 },
];

function sampleRound(overrides = {}) {
  return {
    metadata: {
      multiplayer_scorecard_mode: 'stableford',
      multiplayer_scorecard_basis: 'net',
      players: [
        { id: 'p1', name: 'Linus', playing_handicap: 18, score_by_hole: { h1: 5, h2: 4 } },
        { id: 'p2', name: 'Toby', playing_handicap: 0, score_by_hole: { h1: 4, h2: 5 } },
        { id: 'p3', name: 'Andre', playing_handicap: 0, score_by_hole: { h1: 5, h2: 4 } },
      ],
      team_settings: {
        enabled: true,
        scoring_mode: 'best_ball',
        teams: [{ id: 'a', name: 'Team A' }, { id: 'b', name: 'Team B' }],
        assignments_by_participant_id: { p1: 'a', p2: 'a', p3: 'b' },
        scramble_scorekeeper_by_team_id: {},
      },
      ...overrides,
    },
  };
}

test('best-ball net Stableford ranks the highest team points first', () => {
  const result = buildTeamResults(sampleRound(), holes);
  assert.equal(result.basis, 'net');
  assert.equal(result.scorecardMode, 'stableford');
  assert.deepEqual(result.teams.map((team) => [team.name, team.total, team.rank]), [
    ['Team A', 10, 1],
    ['Team B', 3, 2],
  ]);
  assert.equal(result.teams[0].displayName, 'Linus & Toby');
});

test('individual leaderboard can switch scoring mode and handicap basis', () => {
  const stablefordNet = buildIndividualResults(sampleRound(), holes, {
    scorecardMode: 'stableford',
    basis: 'net',
  });
  assert.deepEqual(stablefordNet.individualResults.map((player) => [player.name, player.total]), [
    ['Linus', 10],
    ['Andre', 3],
    ['Toby', 3],
  ]);

  const strokeGross = buildIndividualResults(sampleRound(), holes, {
    scorecardMode: 'stroke_play',
    basis: 'gross',
  });
  assert.deepEqual(strokeGross.individualResults.map((player) => [player.name, player.total]), [
    ['Andre', 9],
    ['Linus', 9],
    ['Toby', 9],
  ]);
});

test('gross stroke play ranks the lowest best-ball score first', () => {
  const result = buildTeamResults(sampleRound({
    multiplayer_scorecard_mode: 'stroke_play',
    multiplayer_scorecard_basis: 'gross',
  }), holes);
  assert.deepEqual(result.teams.map((team) => [team.name, team.total, team.toPar]), [
    ['Team A', 8, 0],
    ['Team B', 9, 1],
  ]);
});

test('net scoring mirrors the app order fallback when stroke indexes are unavailable', () => {
  const result = buildTeamResults(sampleRound(), holes.map(({ id, par }) => ({ id, par })));
  assert.equal(result.basis, 'net');
  assert.equal(result.isBasisFallback, false);
});

test('scramble uses the configured team scorekeeper', () => {
  const round = sampleRound({
    multiplayer_scorecard_mode: 'stroke_play',
    multiplayer_scorecard_basis: 'gross',
    team_settings: {
      enabled: true,
      scoring_mode: 'scramble',
      teams: [{ id: 'a', name: 'Team A' }],
      assignments_by_participant_id: { p1: 'a', p2: 'a' },
      scramble_scorekeeper_by_team_id: { a: 'p1' },
    },
  });
  assert.equal(buildTeamResults(round, holes).teams[0].total, 9);
});

test('the supplied KGPA round produces the expected team leaderboard', () => {
  const ids = Array.from({ length: 18 }, (_, index) => `h${index + 1}`);
  const pars = [4, 4, 5, 3, 4, 4, 5, 3, 4, 4, 4, 5, 3, 4, 4, 5, 3, 4];
  const strokeIndexes = [8, 14, 4, 12, 2, 16, 18, 10, 6, 8, 14, 4, 12, 2, 16, 18, 10, 6];
  const scoreMap = (scores) => Object.fromEntries(ids.map((id, index) => [id, scores[index]]));
  const round = {
    metadata: {
      multiplayer_scorecard_mode: 'stableford',
      multiplayer_scorecard_basis: 'net',
      players: [
        { id: 'andre', name: 'Andre', playing_handicap: 14, score_by_hole: scoreMap([4, 4, 6, 4, 4, 6, 7, 4, 8, 4, 4, 5, 3, 4, 5, 9, 3, 4]) },
        { id: 'ankur', name: 'Ankur', playing_handicap: 18, score_by_hole: scoreMap([5, 6, 10, 3, 6, 6, 6, 4, 6, 3, 4, 6, 5, 6, 5, 8, 3, 7]) },
        { id: 'linus', name: 'Linus', playing_handicap: 15, score_by_hole: scoreMap([5, 4, 5, 4, 6, 6, 8, 5, 5, 7, 5, 5, 4, 5, 8, 7, 3, 5]) },
        { id: 'toby', name: 'Toby', playing_handicap: 21, score_by_hole: scoreMap([6, 6, 6, 3, 5, 8, 6, 3, 5, 7, 4, 6, 4, 4, 4, 6, 3, 7]) },
      ],
      team_settings: {
        enabled: true,
        scoring_mode: 'best_ball',
        teams: [{ id: 'a', name: 'Team A' }, { id: 'b', name: 'Team B' }],
        assignments_by_participant_id: { linus: 'a', toby: 'a', andre: 'b', ankur: 'b' },
      },
    },
  };
  const kgpaHoles = ids.map((id, index) => ({
    id,
    par: pars[index],
    strokeIndex: strokeIndexes[index],
    holeNumber: 19 + (index % 9),
    playedNumber: index + 1,
  }));

  const result = buildTeamResults(round, kgpaHoles);
  assert.deepEqual(result.teams.map((team) => [team.name, team.total, team.rank]), [
    ['Team B', 44, 1],
    ['Team A', 44, 1],
  ]);
  assert.deepEqual(result.teams.map((team) => team.displayName), [
    'Andre & Ankur',
    'Linus & Toby',
  ]);
  assert.equal(result.summarySentences.length, 5);
  assert.match(result.summarySentences[0], /finished all square at 44–44/i);
  assert.match(result.summarySentences[2], /Ankur's birdie earned 4 Stableford points/i);
  assert.match(result.summarySentences[2], /biggest one-hole swing/i);
  assert.match(result.summarySentences[2], /stretched that advantage to 3 points/i);
  assert.match(result.summarySentences[2], /on hole 13/i);
  assert.doesNotMatch(result.summarySentences.join(' '), /hole (?:19|2[0-7])/i);
  assert.match(result.summarySentences[3], /Toby then counted on 5 straight holes/i);
  assert.match(result.summarySentences[4], /Andre scored 3 points/i);
  assert.match(result.summarySentences[4], /on hole 18/i);
  assert.match(result.summarySentences[4], /to square the match at 44–44/i);
});

test('handicap strokes are allocated once across repeated nines like the app', () => {
  const repeatedNine = [8, 14, 4, 12, 2, 16, 18, 10, 6, 8, 14, 4, 12, 2, 16, 18, 10, 6]
    .map((strokeIndex, index) => ({ id: `h${index + 1}`, par: 4, strokeIndex }));
  const adjustments = strokeAdjustments(14, repeatedNine);
  assert.equal(adjustments.reduce((sum, value) => sum + value, 0), 14);
  assert.equal(adjustments.filter((value) => value === 1).length, 14);
  assert.equal(adjustments.filter((value) => value === 0).length, 4);
});

test('handicap strokes follow the stored stroke index', () => {
  assert.equal(strokesReceived(18, 18), 1);
  assert.equal(strokesReceived(19, 1), 2);
  assert.equal(strokesReceived(19, 2), 1);
  assert.equal(strokesReceived(0, 1), 0);
});
