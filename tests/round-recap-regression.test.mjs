import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import teamResults from '../round/team-results.js';
import fixture from './fixtures/kgpa-2026-11-07.cjs';
import { buildTeamRoundFactPacket } from '../workers/score-import/src/team-round-summary.ts';

const { buildTeamResults } = teamResults;
const { round, holes, courseHoles } = fixture;

test('reported KGPA recap chooses Toby’s improving finish instead of Linus’s longer losing stretch', () => {
  const result = buildTeamResults(round, holes);
  assert.deepEqual(result.teams.map((team) => [team.displayName, team.total]), [
    ['Luca & Rustin', 41], ['Linus & Toby Smith', 36],
  ]);
  assert.match(result.summarySentences[1], /6-point lead at the turn/);
  assert.match(result.summarySentences[2], /gross par earned 3 net Stableford points/);
  assert.match(result.summarySentences[2], /one of the biggest one-hole swings on hole 5/);
  assert.match(result.summarySentences[3], /Toby Smith's scores counted on 3 consecutive holes from 16–18/);
  assert.match(result.summarySentences[3], /from 7 points behind to 5 points behind/);
  assert.doesNotMatch(result.summarySentences.join(' '), /from 6 points behind to 7 points behind/);

  const packet = buildTeamRoundFactPacket(round, courseHoles);
  assert.equal(packet.final_result.score, '41-36');
  assert.deepEqual(packet.turn.scores, { 'Luca & Rustin': 22, 'Linus & Toby Smith': 16 });
  assert.equal(packet.defining_swing.shared_largest, true);
  assert.equal(packet.defining_swing.golf_result_basis, 'gross');
  assert.deepEqual(packet.closing_contribution, {
    player: 'Toby Smith', team: 'Linus & Toby Smith', length: 3,
    start_played_hole: 16, end_played_hole: 18, net_gain: 2,
    position_before: '7 points behind', position_after: '5 points behind',
  });
});

for (const scoringMode of ['best_ball', 'all_scores', 'scramble']) {
  for (const scorecardMode of ['stableford', 'stroke_play']) {
    for (const basis of ['net', 'gross']) {
      test(`recap facts agree with scorecards: ${scoringMode}, ${scorecardMode}, ${basis}`, () => {
        const selected = structuredClone(round);
        selected.metadata.multiplayer_scorecard_mode = scorecardMode;
        selected.metadata.multiplayer_scorecard_basis = basis;
        selected.metadata.team_settings.scoring_mode = scoringMode;
        selected.metadata.team_settings.scramble_scorekeeper_by_team_id = { a: 'linus', b: 'luca' };
        const result = buildTeamResults(selected, holes);
        const packet = buildTeamRoundFactPacket(selected, courseHoles);
        assert.equal(packet.final_result.score, result.teams.map((team) => team.total).join('-'));
        assert.equal(packet.format.basis, result.basis);
        assert.equal(result.summarySentences.length, 5);
        if (scoringMode !== 'best_ball') {
          assert.equal(packet.closing_contribution, null);
          assert.doesNotMatch(result.summarySentences[3], /'s scores counted/);
        } else if (packet.closing_contribution) {
          // Recompute the actual improvement independently from the selected team hole values.
          const contribution = packet.closing_contribution;
          const team = result.teams.find((team) => team.displayName === contribution.team);
          const opponent = result.teams.find((other) => other.id !== team.id);
          const start = contribution.start_played_hole - 1;
          const end = contribution.end_played_hole;
          const sum = (holes) => holes.reduce((total, hole) => total + hole.value, 0);
          const rawGain = sum(team.holeResults.slice(start, end)) - sum(opponent.holeResults.slice(start, end));
          assert.equal(contribution.net_gain, scorecardMode === 'stableford' ? rawGain : -rawGain);
          assert.ok(contribution.net_gain > 0);
          assert.ok(contribution.length >= 2);
          assert.ok(team.holeResults.slice(start, end).every((hole) => {
            const member = team.members.find((member) => member.name === contribution.player);
            return hole.contributorIds.includes(member.id);
          }));
        }
        for (const team of result.teams) {
          assert.equal(packet.closing_stretch.scores[team.displayName],
            team.holeResults.slice(9).reduce((sum, hole) => sum + hole.value, 0));
        }
      });
    }
  }
}

test('tied counting streaks are described as a level closing stretch, not an improvement', () => {
  const tied = structuredClone(round);
  for (const player of tied.metadata.players) {
    player.playing_handicap = 0;
    player.score_by_hole = Object.fromEntries(holes.map((hole) => [hole.id, hole.par]));
  }
  const result = buildTeamResults(tied, holes);
  const packet = buildTeamRoundFactPacket(tied, courseHoles);
  assert.equal(packet.closing_contribution, null);
  assert.match(result.summarySentences[3], /matched each other.*18 points/);
  assert.doesNotMatch(result.summarySentences[3], /improve|comeback/);
});

test('recap labels reflect actual AI use and bypass cached text after a score or mode change', () => {
  const context = vm.createContext({
    URLSearchParams,
    document: { getElementById: () => ({ innerHTML: '' }), addEventListener() {} },
    window: { location: { search: '' } },
  });
  vm.runInContext(readFileSync(new URL('../round/round.js', import.meta.url), 'utf8'), context);
  const result = buildTeamResults(round, holes);
  const cached = structuredClone(round);
  cached.metadata.shared_scores_refreshed = false;
  cached.metadata.ai_round_summary = { version: 2, sentences: Array.from({ length: 5 }, (_, i) => `Stored AI sentence ${i + 1}.`) };
  const ai = context.teamSummaryMarkup(result, cached);
  assert.match(ai, />AI Round Summary</);
  assert.match(ai, /Stored AI sentence 1/);
  for (const changed of [
    { ...cached, metadata: { ...cached.metadata, shared_scores_refreshed: true } },
    { ...cached, metadata: { ...cached.metadata, ai_round_summary: null } },
    { ...cached, metadata: { ...cached.metadata, multiplayer_scorecard_mode: 'stroke_play' } },
    { ...cached, metadata: { ...cached.metadata, multiplayer_scorecard_basis: 'gross' } },
  ]) {
    const markup = context.teamSummaryMarkup(result, changed);
    assert.match(markup, />Round Summary</);
    assert.doesNotMatch(markup, /AI Round Summary|Stored AI sentence/);
    assert.match(markup, /Toby Smith&#39;s scores counted/);
  }
});
