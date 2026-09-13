(function exposeTeamResults(global) {
  function buildTeamResults(round, holes) {
    const metadata = record(round?.metadata);
    const settings = record(metadata.team_settings ?? metadata.teamSettings);
    const configuredTeams = Array.isArray(settings.teams) ? settings.teams : [];
    const assignments = record(
      settings.assignments_by_participant_id ?? settings.assignmentsByParticipantId,
    );
    const players = Array.isArray(metadata.players) ? metadata.players.filter(isRecord) : [];

    if (settings.enabled !== true || configuredTeams.length === 0 || players.length === 0 || !holes.length) {
      return null;
    }

    const scorecardMode = normalizedToken(
      metadata.multiplayer_scorecard_mode ?? metadata.multiplayerScorecardMode,
      'stroke_play',
    );
    const requestedBasis = normalizedToken(
      metadata.multiplayer_scorecard_basis ?? metadata.multiplayerScorecardBasis,
      'gross',
    );
    const scoringMode = normalizedToken(settings.scoring_mode ?? settings.scoringMode, 'best_ball');
    const scorekeepers = record(
      settings.scramble_scorekeeper_by_team_id ?? settings.scrambleScorekeeperByTeamId,
    );
    const playerById = new Map(
      players.flatMap((player) => {
        const id = stringValue(player.id);
        return id ? [[id, normalizePlayer(player)]] : [];
      }),
    );
    const hasStrokeIndexes = holes.every((hole) => positiveInteger(hole.strokeIndex));
    const basis = requestedBasis === 'net' && hasStrokeIndexes ? 'net' : 'gross';
    const isBasisFallback = requestedBasis === 'net' && basis !== requestedBasis;

    const teams = configuredTeams.flatMap((rawTeam, teamIndex) => {
      if (!isRecord(rawTeam)) return [];
      const id = stringValue(rawTeam.id);
      if (!id) return [];

      const members = Array.from(playerById.values()).filter((player) => assignments[player.id] === id);
      if (members.length === 0) return [];

      const scorekeeperId = stringValue(scorekeepers[id]);
      const scorekeeper = scorekeeperId ? playerById.get(scorekeeperId) : null;
      const holeResults = holes.map((hole) => {
        const candidates = scoringMode === 'scramble' && scorekeeper ? [scorekeeper] : members;
        const scoredCandidates = candidates.flatMap((player) => {
          const grossScore = positiveInteger(player.scoreByHole[hole.id]);
          if (!grossScore) return [];

          const handicapStrokes = basis === 'net'
            ? strokesReceived(player.playingHandicap, hole.strokeIndex)
            : 0;
          const adjustedScore = grossScore - handicapStrokes;
          const value = scorecardMode === 'stableford'
            ? Math.max(0, 2 + hole.par - adjustedScore)
            : adjustedScore;

          return [{ playerId: player.id, grossScore, adjustedScore, handicapStrokes, value }];
        });

        if (scoredCandidates.length === 0) {
          return { holeId: hole.id, value: null, par: hole.par };
        }

        const chosen = scoredCandidates.reduce((best, candidate) => {
          if (!best) return candidate;
          return scorecardMode === 'stableford'
            ? (candidate.value > best.value ? candidate : best)
            : (candidate.value < best.value ? candidate : best);
        }, null);

        return { holeId: hole.id, par: hole.par, ...chosen };
      });
      const completedHoles = holeResults.filter((hole) => typeof hole.value === 'number');
      const total = completedHoles.reduce((sum, hole) => sum + hole.value, 0);
      const completedPar = completedHoles.reduce((sum, hole) => sum + hole.par, 0);

      return [{
        id,
        configuredOrder: teamIndex,
        name: stringValue(rawTeam.name) || `Team ${teamIndex + 1}`,
        members,
        holeResults,
        completedHoleCount: completedHoles.length,
        total: completedHoles.length ? total : null,
        toPar: scorecardMode === 'stableford' || completedHoles.length === 0 ? null : total - completedPar,
      }];
    });

    if (teams.length === 0) return null;

    const direction = scorecardMode === 'stableford' ? -1 : 1;
    teams.sort((left, right) => {
      if (left.total === null && right.total === null) return left.configuredOrder - right.configuredOrder;
      if (left.total === null) return 1;
      if (right.total === null) return -1;
      return (left.total - right.total) * direction || left.configuredOrder - right.configuredOrder;
    });

    let previousTotal = null;
    let previousRank = 0;
    teams.forEach((team, index) => {
      const rank = team.total !== null && team.total === previousTotal ? previousRank : index + 1;
      team.rank = rank;
      previousTotal = team.total;
      previousRank = rank;
    });

    return {
      teams,
      scorecardMode,
      scoringMode,
      requestedBasis,
      basis,
      isBasisFallback,
    };
  }

  function normalizePlayer(player) {
    return {
      id: stringValue(player.id),
      name: stringValue(player.name) || 'Player',
      playingHandicap: integerValue(player.playing_handicap ?? player.playingHandicap) ?? 0,
      scoreByHole: integerMap(player.score_by_hole ?? player.scoreByHole),
    };
  }

  function strokesReceived(playingHandicap, strokeIndex) {
    const handicap = integerValue(playingHandicap);
    const index = positiveInteger(strokeIndex);
    if (handicap === null || handicap <= 0 || !index) return 0;
    return Math.max(0, Math.floor((handicap - index) / 18) + 1);
  }

  function integerMap(value) {
    const source = record(value);
    return Object.entries(source).reduce((result, [key, rawValue]) => {
      const parsed = integerValue(rawValue);
      if (parsed !== null) result[key] = parsed;
      return result;
    }, {});
  }

  function normalizedToken(value, fallback) {
    const token = stringValue(value);
    return token ? token.toLowerCase().replace(/[ -]+/g, '_') : fallback;
  }

  function record(value) {
    return isRecord(value) ? value : {};
  }

  function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function stringValue(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  function integerValue(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? Math.round(parsed) : null;
    }
    return null;
  }

  function positiveInteger(value) {
    const parsed = integerValue(value);
    return parsed !== null && parsed > 0 ? parsed : null;
  }

  const api = { buildTeamResults, strokesReceived };
  global.AutoStrikeTeamResults = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
