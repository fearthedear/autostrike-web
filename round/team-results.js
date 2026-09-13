(function exposeTeamResults(global) {
  function buildTeamResults(round, holes, options = {}) {
    const metadata = record(round?.metadata);
    const settings = record(metadata.team_settings ?? metadata.teamSettings);
    const configuredTeams = Array.isArray(settings.teams) ? settings.teams : [];
    const assignments = record(
      settings.assignments_by_participant_id ?? settings.assignmentsByParticipantId,
    );
    const players = Array.isArray(metadata.players) ? metadata.players.filter(isRecord).map(normalizePlayer) : [];

    if (settings.enabled !== true || configuredTeams.length === 0 || players.length === 0 || !holes.length) {
      return null;
    }

    const scorecardMode = normalizedToken(
      options.scorecardMode ?? metadata.multiplayer_scorecard_mode ?? metadata.multiplayerScorecardMode,
      'stroke_play',
    );
    const requestedBasis = normalizedToken(
      options.basis ?? metadata.multiplayer_scorecard_basis ?? metadata.multiplayerScorecardBasis,
      'gross',
    );
    const scoringMode = normalizedToken(settings.scoring_mode ?? settings.scoringMode, 'best_ball');
    const isScramble = scoringMode === 'scramble';
    const basis = requestedBasis === 'net' && !isScramble ? 'net' : 'gross';
    const scorekeepers = record(
      settings.scramble_scorekeeper_by_team_id ?? settings.scrambleScorekeeperByTeamId,
    );
    const playerById = new Map(players.flatMap((player) => (player.id ? [[player.id, player]] : [])));
    const adjustmentsByPlayerId = new Map(players.map((player) => [
      player.id,
      strokeAdjustments(player.playingHandicap, holes),
    ]));

    const teams = configuredTeams.flatMap((rawTeam, teamIndex) => {
      if (!isRecord(rawTeam)) return [];
      const id = stringValue(rawTeam.id);
      if (!id) return [];

      const members = players.filter((player) => assignments[player.id] === id);
      if (members.length === 0) return [];

      const scorekeeperId = stringValue(scorekeepers[id]);
      const scorekeeper = scorekeeperId ? playerById.get(scorekeeperId) : null;
      const holeResults = holes.map((hole, holeIndex) => {
        const candidates = isScramble && scorekeeper ? [scorekeeper] : members;
        const scoredCandidates = candidates.flatMap((player) => {
          const grossScore = positiveInteger(player.scoreByHole[hole.id]);
          if (!grossScore) return [];

          const handicapStrokes = basis === 'net'
            ? (adjustmentsByPlayerId.get(player.id)?.[holeIndex] ?? 0)
            : 0;
          const adjustedScore = Math.max(1, grossScore - handicapStrokes);
          const value = scorecardMode === 'stableford'
            ? stablefordPoints(adjustedScore - hole.par)
            : adjustedScore;

          return [{ playerId: player.id, grossScore, adjustedScore, handicapStrokes, value }];
        });

        // The app only resolves a team hole when every ball required by that format is present.
        if (scoredCandidates.length === 0 || (!isScramble && scoredCandidates.length !== members.length)) {
          return holeResultBase(hole, holeIndex);
        }

        if (scoringMode === 'all_scores') {
          return {
            ...holeResultBase(hole, holeIndex),
            value: scoredCandidates.reduce((sum, candidate) => sum + candidate.value, 0),
            contributorIds: scoredCandidates.map((candidate) => candidate.playerId),
          };
        }

        const targetValue = scorecardMode === 'stableford'
          ? Math.max(...scoredCandidates.map((candidate) => candidate.value))
          : Math.min(...scoredCandidates.map((candidate) => candidate.value));
        const contributors = scoredCandidates.filter((candidate) => candidate.value === targetValue);
        return {
          ...holeResultBase(hole, holeIndex),
          ...contributors[0],
          value: targetValue,
          contributorIds: contributors.map((candidate) => candidate.playerId),
        };
      });
      const completedHoles = holeResults.filter((hole) => typeof hole.value === 'number');
      const total = completedHoles.reduce((sum, hole) => sum + hole.value, 0);
      const completedPar = completedHoles.reduce((sum, hole) => {
        const multiplier = scoringMode === 'all_scores' ? members.length : 1;
        return sum + (hole.par * multiplier);
      }, 0);
      const storedName = stringValue(rawTeam.name) || `Team ${teamIndex + 1}`;

      return [{
        id,
        configuredOrder: teamIndex,
        name: storedName,
        displayName: defaultTeamName(storedName)
          ? members.map((member) => member.name).join(' & ')
          : storedName,
        members,
        holeResults,
        completedHoleCount: completedHoles.length,
        total: completedHoles.length ? total : null,
        toPar: scorecardMode === 'stableford' || completedHoles.length === 0 ? null : total - completedPar,
      }];
    });

    if (teams.length === 0) return null;

    rankResults(teams, scorecardMode, 'displayName');

    const individualResults = buildIndividualResults(round, holes, { scorecardMode, basis }).individualResults;

    const results = {
      teams,
      individualResults,
      holes,
      scorecardMode,
      scoringMode,
      requestedBasis,
      basis,
      isBasisFallback: false,
    };
    results.summarySentences = buildTeamSummary(results);
    return results;
  }

  function buildIndividualResults(round, holes, options = {}) {
    const metadata = record(round?.metadata);
    const players = Array.isArray(metadata.players) ? metadata.players.filter(isRecord).map(normalizePlayer) : [];
    const scorecardMode = normalizedToken(
      options.scorecardMode ?? metadata.multiplayer_scorecard_mode ?? metadata.multiplayerScorecardMode,
      'stroke_play',
    );
    const basis = normalizedToken(
      options.basis ?? metadata.multiplayer_scorecard_basis ?? metadata.multiplayerScorecardBasis,
      'gross',
    ) === 'net' ? 'net' : 'gross';
    const adjustmentsByPlayerId = new Map(players.map((player) => [
      player.id,
      strokeAdjustments(player.playingHandicap, holes),
    ]));

    const individualResults = players.map((player, configuredOrder) => {
      const adjustments = adjustmentsByPlayerId.get(player.id) || [];
      const holeResults = holes.map((hole, holeIndex) => {
        const grossScore = positiveInteger(player.scoreByHole[hole.id]);
        if (!grossScore) return holeResultBase(hole, holeIndex);
        const handicapStrokes = basis === 'net' ? (adjustments[holeIndex] ?? 0) : 0;
        const adjustedScore = Math.max(1, grossScore - handicapStrokes);
        const value = scorecardMode === 'stableford'
          ? stablefordPoints(adjustedScore - hole.par)
          : adjustedScore;
        return {
          ...holeResultBase(hole, holeIndex),
          grossScore,
          adjustedScore,
          handicapStrokes,
          value,
        };
      });
      const completedHoles = holeResults.filter((hole) => typeof hole.value === 'number');
      const total = completedHoles.reduce((sum, hole) => sum + hole.value, 0);
      const completedPar = completedHoles.reduce((sum, hole) => sum + hole.par, 0);
      return {
        id: player.id,
        configuredOrder,
        name: player.name,
        playingHandicap: player.playingHandicap,
        holeResults,
        completedHoleCount: completedHoles.length,
        total: completedHoles.length ? total : null,
        toPar: scorecardMode === 'stableford' || completedHoles.length === 0 ? null : total - completedPar,
      };
    });
    rankResults(individualResults, scorecardMode, 'name');

    return {
      individualResults,
      holes,
      scorecardMode,
      basis,
    };
  }

  function buildTeamSummary(results) {
    const teams = Array.isArray(results?.teams) ? results.teams.filter((team) => team.total !== null) : [];
    if (teams.length < 2) return [];

    const scorecardMode = results.scorecardMode;
    const isStableford = scorecardMode === 'stableford';
    const metric = isStableford ? 'points' : 'strokes';
    const scoreText = (value) => `${value} ${isStableford ? 'points' : value === 1 ? 'stroke' : 'strokes'}`;
    const format = `${results.basis === 'net' ? 'net' : 'gross'} ${isStableford ? 'Stableford' : 'stroke-play'} ${results.scoringMode === 'scramble' ? 'scramble' : results.scoringMode === 'all_scores' ? 'team aggregate' : 'best-ball'}`;
    const tiedLeaders = teams.filter((team) => team.total === teams[0].total);
    const sentences = [];

    if (tiedLeaders.length > 1) {
      sentences.push(`The match finished all square at ${teams[0].total}–${teams[1].total}, leaving ${tiedLeaders[0].displayName} level with ${tiedLeaders[1].displayName} after a ${format} contest.`);
    } else {
      const runnerUp = teams[1];
      const margin = Math.abs(teams[0].total - runnerUp.total);
      sentences.push(`${teams[0].displayName} won the ${format} contest by ${scoreText(margin)}, ${teams[0].total} to ${runnerUp.total}.`);
    }

    const holeCount = Math.max(...teams.map((team) => team.holeResults.length));
    const turnIndex = Math.min(9, Math.ceil(holeCount / 2));
    const turnTotals = teams.map((team) => ({
      team,
      value: sumHoleValues(team.holeResults.slice(0, turnIndex)),
    })).sort((left, right) => compareScores(left.value, right.value, scorecardMode));
    const turnMargin = Math.abs(turnTotals[0].value - turnTotals[1].value);
    if (turnMargin === 0) {
      sentences.push(`The match was all square at the turn, with both sides on ${scoreText(turnTotals[0].value)}.`);
    } else {
      const marginUnit = isStableford ? 'point' : 'stroke';
      sentences.push(`${turnTotals[0].team.displayName} held a ${turnMargin}-${marginUnit} lead at the turn.`);
    }

    const biggestSwing = biggestMomentumSwing(teams[0], teams[1], scorecardMode);
    sentences.push(biggestSwing || 'Neither side found a decisive one-hole swing, keeping the match finely balanced throughout.');

    const comeback = comebackSentence(teams[0], teams[1], scorecardMode, turnIndex);
    sentences.push(comeback || backNineSentence(teams[0], teams[1], scorecardMode, turnIndex));

    const first = teams[0];
    const second = teams[1];
    const lastIndex = Math.min(first.holeResults.length, second.holeResults.length) - 1;
    const firstLast = first.holeResults[lastIndex]?.value;
    const secondLast = second.holeResults[lastIndex]?.value;
    const finalHoleNumber = lastIndex + 1;
    const finalIsTie = first.total === second.total;
    const lastHoleWinner = typeof firstLast === 'number' && typeof secondLast === 'number' && firstLast !== secondLast
      ? (compareScores(firstLast, secondLast, scorecardMode) < 0 ? first : second)
      : null;

    if (lastHoleWinner && finalIsTie) {
      const winnerValue = lastHoleWinner.id === first.id ? firstLast : secondLast;
      const loserValue = lastHoleWinner.id === first.id ? secondLast : firstLast;
      const finalHole = lastHoleWinner.holeResults[lastIndex];
      const contributors = contributorNames(lastHoleWinner, finalHole);
      const scorer = contributors.length === 1 ? contributors[0] : lastHoleWinner.displayName;
      const valueUnit = scorecardMode === 'stableford' ? (winnerValue === 1 ? 'point' : 'points') : (winnerValue === 1 ? 'stroke' : 'strokes');
      sentences.push(`${scorer} scored ${winnerValue} ${valueUnit} for ${lastHoleWinner.displayName} on the final hole, winning it ${winnerValue}–${loserValue} on hole ${finalHoleNumber} to square the match at ${first.total}–${second.total}.`);
    } else if (lastHoleWinner) {
      const winnerValue = lastHoleWinner.id === first.id ? firstLast : secondLast;
      const loserValue = lastHoleWinner.id === first.id ? secondLast : firstLast;
      const outcome = lastHoleWinner.id === first.id ? 'seal the result' : `trim the final margin to ${Math.abs(first.total - second.total)} ${metric}`;
      sentences.push(`${lastHoleWinner.displayName} won the final hole ${winnerValue}–${loserValue} on hole ${finalHoleNumber} to ${outcome}.`);
    } else {
      const lastValue = typeof firstLast === 'number' ? firstLast : '—';
      const outcome = finalIsTie ? `leave the match tied at ${first.total}–${second.total}` : `confirm the ${Math.abs(first.total - second.total)}-${metric} result`;
      sentences.push(`The final hole was halved at ${lastValue} on hole ${finalHoleNumber} to ${outcome}.`);
    }

    return sentences.slice(0, 5);
  }

  function biggestMomentumSwing(first, second, scorecardMode) {
    let biggest = null;
    const holeCount = Math.min(first.holeResults.length, second.holeResults.length);
    for (let index = 0; index < holeCount; index += 1) {
      const firstValue = first.holeResults[index]?.value;
      const secondValue = second.holeResults[index]?.value;
      if (typeof firstValue !== 'number' || typeof secondValue !== 'number' || firstValue === secondValue) continue;
      const winner = compareScores(firstValue, secondValue, scorecardMode) < 0 ? first : second;
      const loser = winner.id === first.id ? second : first;
      const winnerValue = winner.id === first.id ? firstValue : secondValue;
      const loserValue = winner.id === first.id ? secondValue : firstValue;
      const swing = Math.abs(firstValue - secondValue);
      if (!biggest || swing > biggest.swing) {
        const beforeWinner = sumHoleValues(winner.holeResults.slice(0, index));
        const beforeLoser = sumHoleValues(loser.holeResults.slice(0, index));
        const afterWinner = beforeWinner + winnerValue;
        const afterLoser = beforeLoser + loserValue;
        biggest = { index, winner, loser, winnerValue, loserValue, swing, beforeWinner, beforeLoser, afterWinner, afterLoser };
      }
    }
    if (!biggest) return null;

    const winnerHole = biggest.winner.holeResults[biggest.index];
    const contributors = contributorNames(biggest.winner, winnerHole);
    const grossResult = contributors.length === 1 ? golfScoreName(winnerHole.grossScore, winnerHole.par) : null;
    const playerText = grossResult && scorecardMode === 'stableford'
      ? `${contributors[0]}'s ${grossResult} earned ${winnerHole.value} Stableford points and produced`
      : contributors.length
        ? `${joinNames(contributors)} delivered`
        : `${biggest.winner.displayName} produced`;
    const unit = scorecardMode === 'stableford' ? 'point' : 'stroke';
    const before = scorePosition(biggest.beforeWinner, biggest.beforeLoser, scorecardMode);
    const after = scorePosition(biggest.afterWinner, biggest.afterLoser, scorecardMode);
    let sentence = `${playerText} the biggest one-hole swing on ${holeLabel(winnerHole, biggest.index)}, a ${biggest.swing}-${unit} gain that took ${biggest.winner.displayName} from ${before} to ${after}`;
    const widest = widestLead(first, second, scorecardMode);
    const afterMargin = Math.abs(scoreMargin(biggest.afterWinner, biggest.afterLoser, scorecardMode));
    if (widest?.team.id === biggest.winner.id && widest.index > biggest.index && widest.margin > afterMargin) {
      const marginUnit = widest.margin === 1 ? unit : `${unit}s`;
      sentence += `; ${widest.team.displayName} then stretched that advantage to ${widest.margin} ${marginUnit} on ${holeLabel(widest.hole, widest.index)}`;
    }
    return `${sentence}.`;
  }

  function widestLead(first, second, scorecardMode) {
    let firstTotal = 0;
    let secondTotal = 0;
    let widest = null;
    const holeCount = Math.min(first.holeResults.length, second.holeResults.length);
    for (let index = 0; index < holeCount; index += 1) {
      firstTotal += typeof first.holeResults[index]?.value === 'number' ? first.holeResults[index].value : 0;
      secondTotal += typeof second.holeResults[index]?.value === 'number' ? second.holeResults[index].value : 0;
      const margin = scoreMargin(firstTotal, secondTotal, scorecardMode);
      if (margin !== 0 && (!widest || Math.abs(margin) > widest.margin)) {
        widest = {
          team: margin > 0 ? first : second,
          margin: Math.abs(margin),
          index,
          hole: first.holeResults[index] ?? second.holeResults[index],
        };
      }
    }
    return widest;
  }

  function comebackSentence(first, second, scorecardMode, startIndex) {
    const candidates = [first, second].flatMap((team) => {
      const opponent = team.id === first.id ? second : first;
      const contributor = leadingContributor(team, startIndex);
      if (!contributor || contributor.stretch.length < 2) return [];
      const start = contributor.stretch.startIndex;
      const end = contributor.stretch.endIndex;
      const beforeTeam = sumHoleValues(team.holeResults.slice(0, start));
      const beforeOpponent = sumHoleValues(opponent.holeResults.slice(0, start));
      const afterTeam = sumHoleValues(team.holeResults.slice(0, end + 1));
      const afterOpponent = sumHoleValues(opponent.holeResults.slice(0, end + 1));
      return [{ team, opponent, contributor, beforeTeam, beforeOpponent, afterTeam, afterOpponent }];
    });
    if (!candidates.length) return null;

    candidates.sort((left, right) => right.contributor.stretch.length - left.contributor.stretch.length || right.contributor.count - left.contributor.count);
    const chosen = candidates[0];
    const before = scorePosition(chosen.beforeTeam, chosen.beforeOpponent, scorecardMode);
    const after = scorePosition(chosen.afterTeam, chosen.afterOpponent, scorecardMode);
    const stretch = chosen.contributor.stretch;
    return `${chosen.contributor.member.name} then counted on ${stretch.length} straight holes from ${stretch.startHole}–${stretch.endHole}, driving ${chosen.team.displayName} from ${before} to ${after}.`;
  }

  function backNineSentence(first, second, scorecardMode, startIndex) {
    const firstTotal = sumHoleValues(first.holeResults.slice(startIndex));
    const secondTotal = sumHoleValues(second.holeResults.slice(startIndex));
    if (firstTotal === secondTotal) {
      return `The teams matched each other across the closing stretch, each adding ${firstTotal} ${scorecardMode === 'stableford' ? 'points' : 'strokes'}.`;
    }
    const stronger = compareScores(firstTotal, secondTotal, scorecardMode) < 0 ? first : second;
    const weaker = stronger.id === first.id ? second : first;
    const strongerTotal = stronger.id === first.id ? firstTotal : secondTotal;
    const weakerTotal = stronger.id === first.id ? secondTotal : firstTotal;
    return `${stronger.displayName} had the stronger closing stretch, ${strongerTotal}–${weakerTotal} against ${weaker.displayName}.`;
  }

  function leadingContributor(team, startIndex) {
    const backNine = team.holeResults.slice(startIndex);
    const counts = new Map();
    backNine.forEach((hole) => {
      (hole.contributorIds || []).forEach((playerId) => {
        counts.set(playerId, (counts.get(playerId) || 0) + 1);
      });
    });
    const contributor = team.members
      .map((member) => ({ member, count: counts.get(member.id) || 0 }))
      .sort((left, right) => right.count - left.count || left.member.name.localeCompare(right.member.name))[0];
    if (!contributor || contributor.count === 0) return null;
    return {
      ...contributor,
      stretch: longestContributionStretch(team.holeResults, contributor.member.id, startIndex),
    };
  }

  function longestContributionStretch(holes, playerId, startIndex = 0) {
    let best = { length: 0, startHole: null, endHole: null, startIndex: null, endIndex: null };
    let current = { length: 0, startHole: null, endHole: null, startIndex: null, endIndex: null };
    holes.forEach((hole, index) => {
      if (index >= startIndex && (hole.contributorIds || []).includes(playerId)) {
        if (current.length === 0) {
          current.startHole = index + 1;
          current.startIndex = index;
        }
        current.length += 1;
        current.endHole = index + 1;
        current.endIndex = index;
        if (current.length > best.length) best = { ...current };
      } else {
        current = { length: 0, startHole: null, endHole: null, startIndex: null, endIndex: null };
      }
    });
    return best;
  }

  function scoreMargin(teamScore, opponentScore, scorecardMode) {
    return scorecardMode === 'stableford' ? teamScore - opponentScore : opponentScore - teamScore;
  }

  function scorePosition(teamScore, opponentScore, scorecardMode) {
    const margin = scoreMargin(teamScore, opponentScore, scorecardMode);
    if (margin === 0) return 'level';
    const singular = scorecardMode === 'stableford' ? 'point' : 'stroke';
    const unit = Math.abs(margin) === 1 ? singular : `${singular}s`;
    return `${Math.abs(margin)} ${unit} ${margin > 0 ? 'ahead' : 'behind'}`;
  }

  function holeLabel(hole, index) {
    return `hole ${index + 1}`;
  }

  function contributorNames(team, hole) {
    return team.members
      .filter((member) => (hole?.contributorIds || []).includes(member.id))
      .map((member) => member.name);
  }

  function golfScoreName(grossScore, par) {
    if (!Number.isFinite(grossScore) || !Number.isFinite(par)) return null;
    const toPar = grossScore - par;
    if (toPar <= -2) return 'eagle';
    if (toPar === -1) return 'birdie';
    if (toPar === 0) return 'par';
    if (toPar === 1) return 'bogey';
    return null;
  }

  function rankResults(entries, scorecardMode, nameKey) {
    entries.sort((left, right) => {
      if (left.total === null && right.total === null) return left.configuredOrder - right.configuredOrder;
      if (left.total === null) return 1;
      if (right.total === null) return -1;
      const scoreComparison = compareScores(left.total, right.total, scorecardMode);
      if (scoreComparison !== 0) return scoreComparison;
      return String(left[nameKey]).localeCompare(String(right[nameKey]), undefined, { sensitivity: 'base' });
    });

    let previousTotal = null;
    let previousRank = 0;
    entries.forEach((entry, index) => {
      const rank = entry.total !== null && entry.total === previousTotal ? previousRank : index + 1;
      entry.rank = rank;
      previousTotal = entry.total;
      previousRank = rank;
    });
  }

  function compareScores(left, right, scorecardMode) {
    return scorecardMode === 'stableford' ? right - left : left - right;
  }

  function normalizePlayer(player) {
    return {
      id: stringValue(player.id),
      name: stringValue(player.name) || 'Player',
      playingHandicap: integerValue(player.playing_handicap ?? player.playingHandicap) ?? 0,
      scoreByHole: integerMap(player.score_by_hole ?? player.scoreByHole),
    };
  }

  // Mirrors the app's WHS allocation across the actual round-hole list. This matters
  // for repeated nines: a 14 handicap receives 14 strokes total, not 14 on each nine.
  function strokeAdjustments(playingHandicap, holes) {
    const handicap = integerValue(playingHandicap) ?? 0;
    const holeCount = holes.length;
    if (!holeCount || handicap === 0) return Array(holeCount).fill(0);

    const ranked = holes.map((hole, order) => ({
      order,
      strokeIndex: positiveInteger(hole.strokeIndex) ?? order + 1,
    }));
    const magnitude = Math.abs(handicap);
    const baseAllowance = Math.floor(magnitude / holeCount);
    const remainder = magnitude % holeCount;
    const direction = handicap > 0 ? 1 : -1;
    const adjustments = Array(holeCount).fill(baseAllowance * direction);
    ranked.sort((left, right) => {
      const indexDifference = handicap > 0
        ? left.strokeIndex - right.strokeIndex
        : right.strokeIndex - left.strokeIndex;
      return indexDifference || left.order - right.order;
    });
    ranked.slice(0, remainder).forEach((hole) => {
      adjustments[hole.order] += direction;
    });
    return adjustments;
  }

  function strokesReceived(playingHandicap, strokeIndex) {
    const handicap = integerValue(playingHandicap);
    const index = positiveInteger(strokeIndex);
    if (handicap === null || handicap <= 0 || !index) return 0;
    return Math.max(0, Math.floor((handicap - index) / 18) + 1);
  }

  function stablefordPoints(toPar) {
    return Math.min(5, Math.max(0, 2 - toPar));
  }

  function holeResultBase(hole, holeIndex) {
    return {
      holeId: hole.id,
      holeIndex,
      holeNumber: positiveInteger(hole.holeNumber) ?? holeIndex + 1,
      playedNumber: positiveInteger(hole.playedNumber) ?? holeIndex + 1,
      value: null,
      par: hole.par,
      contributorIds: [],
    };
  }

  function sumHoleValues(holes) {
    return holes.reduce((sum, hole) => sum + (typeof hole.value === 'number' ? hole.value : 0), 0);
  }

  function defaultTeamName(name) {
    return /^team\s+(?:a|b)$/i.test(String(name).trim());
  }

  function joinNames(names) {
    if (names.length <= 1) return names[0] || '';
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
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

  const api = { buildTeamResults, buildIndividualResults, buildTeamSummary, strokeAdjustments, strokesReceived };
  global.AutoStrikeTeamResults = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
