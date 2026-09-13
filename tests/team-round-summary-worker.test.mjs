import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TEAM_ROUND_SUMMARY_PROMPT,
  buildTeamRoundFactPacket,
  isCompletedTeamRound,
  validateGeneratedSummary,
} from '../workers/score-import/src/team-round-summary.ts';

const ids = Array.from({ length: 18 }, (_, index) => `h${index + 1}`);
const pars = [4, 4, 5, 3, 4, 4, 5, 3, 4, 4, 4, 5, 3, 4, 4, 5, 3, 4];
const strokeIndexes = [8, 14, 4, 12, 2, 16, 18, 10, 6, 8, 14, 4, 12, 2, 16, 18, 10, 6];
const scoreMap = (scores) => Object.fromEntries(ids.map((id, index) => [id, scores[index]]));

const row = {
  id: 'dd5a8b5f-c99d-47f1-b3cd-b17560abbd90',
  course_id: 'kgpa',
  metadata: {
    multiplayer_scorecard_mode: 'stableford',
    multiplayer_scorecard_basis: 'net',
    round_holes: ids.map((id, index) => ({
      id,
      sequence: index,
      hole_number: 19 + (index % 9),
      par: pars[index],
    })),
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

const courseHoles = Array.from({ length: 9 }, (_, index) => ({
  holeNumber: 19 + index,
  par: pars[index],
  strokeIndex: strokeIndexes[index],
}));

test('recognizes only completed team rounds', () => {
  assert.equal(isCompletedTeamRound(row), true);
  assert.equal(isCompletedTeamRound({ metadata: { ...row.metadata, is_incomplete: true } }), false);
  assert.equal(isCompletedTeamRound({ metadata: { ...row.metadata, team_settings: { enabled: false } } }), false);
});

test('builds a factual KGPA packet using played order rather than source hole numbers', () => {
  const packet = buildTeamRoundFactPacket(row, courseHoles);
  assert.ok(packet);
  assert.deepEqual(packet.allowed_team_names, ['Andre & Ankur', 'Linus & Toby']);
  assert.equal(packet.final_result.score, '44-44');
  assert.equal(packet.turn.team, 'Linus & Toby');
  assert.equal(packet.turn.margin, 2);
  assert.equal(packet.defining_swing.played_hole, 10);
  assert.deepEqual(packet.defining_swing.contributor_names, ['Ankur']);
  assert.equal(packet.defining_swing.golf_result, 'birdie');
  assert.equal(packet.defining_swing.counting_value, 4);
  assert.deepEqual(packet.defining_swing.widest_later_lead, { margin: 3, played_hole: 13 });
  assert.equal(packet.closing_contribution.player, 'Toby');
  assert.equal(packet.closing_contribution.start_played_hole, 13);
  assert.equal(packet.closing_contribution.end_played_hole, 17);
  assert.deepEqual(packet.final_hole.contributor_names, ['Andre']);
  assert.equal(packet.final_hole.played_hole, 18);
  assert.equal(packet.final_hole.outcome, 'squared the match');
  assert.doesNotMatch(JSON.stringify(packet), /"played_hole":(?:19|2[0-7])/);
});

test('prompt captures the recap constraints', () => {
  assert.match(TEAM_ROUND_SUMMARY_PROMPT, /exactly five concise, natural sentences/i);
  assert.match(TEAM_ROUND_SUMMARY_PROMPT, /one-based played order/i);
  assert.match(TEAM_ROUND_SUMMARY_PROMPT, /Never expose source course-hole numbers/i);
  assert.match(TEAM_ROUND_SUMMARY_PROMPT, /\[Player\] scored \[value\] points\/strokes for \[Team\]/i);
  assert.match(TEAM_ROUND_SUMMARY_PROMPT, /birdie\/eagle/i);
});

test('rejects malformed or source-hole-number summaries', () => {
  const packet = buildTeamRoundFactPacket(row, courseHoles);
  const valid = [
    'The match finished tied at 44-44.',
    'Linus & Toby led by two points at the turn.',
    "Ankur's birdie earned four Stableford points on hole 10.",
    'Toby counted across holes 13-17.',
    'Andre scored three points on hole 18 to square the match.',
  ];
  assert.deepEqual(validateGeneratedSummary(valid, packet), valid);
  assert.equal(validateGeneratedSummary(valid.slice(0, 4), packet), null);
  assert.equal(validateGeneratedSummary([...valid.slice(0, 4), 'Andre squared it on hole 27 at 44-44.'], packet), null);
});
