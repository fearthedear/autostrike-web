// Hole-by-hole public API data for the reported recap; identifiers shortened for the fixture.
// https://autostrikegolf.com/round/?id=a0e09bac-c2d8-414a-bab7-b0ea62e97cc1
const pars = [4, 5, 4, 3, 4, 5, 3, 3, 5, 4, 3, 5, 4, 4, 3, 4, 5, 4];
const indexes = [3, 9, 13, 17, 5, 1, 11, 7, 15, 14, 6, 2, 16, 4, 12, 10, 18, 8];
const holes = pars.map((par, index) => ({ id: `h${index + 1}`, par, strokeIndex: indexes[index], playedNumber: index + 1 }));
const player = (id, name, handicap, scores) => ({
  id, name, playing_handicap: handicap,
  score_by_hole: Object.fromEntries(scores.map((score, index) => [holes[index].id, score])),
});
const courseHoles = holes.map((hole) => ({ holeNumber: hole.playedNumber, par: hole.par, strokeIndex: hole.strokeIndex }));
const round = {
  metadata: {
    multiplayer_scorecard_mode: 'stableford',
    multiplayer_scorecard_basis: 'net',
    shared_scores_refreshed: true,
    round_holes: holes.map((hole, index) => ({
      id: hole.id, par: hole.par, hole_number: hole.playedNumber, sequence: index, stroke_index: hole.strokeIndex,
    })),
    players: [
      player('linus', 'Linus', 17, [5, 7, 6, 4, 6, 5, 4, 4, 7, 5, 4, 6, 5, 5, 3, 6, 7, 7]),
      player('luca', 'Luca', 18, [5, 6, 4, 4, 4, 7, 4, 3, 5, 6, 3, 8, 5, 5, 3, 5, 6, 6]),
      player('rustin', 'Rustin', 22, [8, 9, 6, 5, 7, 7, 5, 5, 7, 6, 6, 7, 6, 5, 6, 7, 7, 6]),
      player('toby', 'Toby Smith', 20, [6, 7, 5, 4, 7, 8, 4, 4, 7, 6, 6, 8, 5, 5, 6, 4, 6, 5]),
    ],
    team_settings: {
      enabled: true, scoring_mode: 'best_ball',
      teams: [{ id: 'a', name: 'Team A' }, { id: 'b', name: 'Team B' }],
      assignments_by_participant_id: { linus: 'a', toby: 'a', luca: 'b', rustin: 'b' },
    },
  },
};
module.exports = { round, holes, courseHoles };
