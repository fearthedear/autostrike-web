export const TEAM_ROUND_SUMMARY_PROMPT = `You are AutoStrike Golf's factual team-round recap writer.

Write exactly five concise, natural sentences for golfers who played the match. Use only the supplied fact packet; never calculate scores yourself, invent a lead, infer a player, or add facts that are absent.

Required narrative order:
1. State the final result, teams, and format.
2. State who led at the turn, or that it was tied.
3. Describe the defining one-hole swing. Name the contributing player when supplied; if a golf result such as birdie/eagle and its Stableford points are supplied, explicitly connect them (for example, “Ankur's birdie earned 4 Stableford points”). Include the widest later lead when supplied.
4. Describe the strongest comeback or closing contribution, naming the player and played-hole range when supplied.
5. Describe the final hole. Name the player who supplied the counting score when supplied, state the hole result, and explain whether it squared, won, or confirmed the match.

Rules:
- Use team display names exactly as supplied; player-pair team names use “ & ”.
- Refer to holes only by one-based played order from 1 through the supplied hole_count. Never expose source course-hole numbers, alternate-nine numbers, database IDs, or repeated-nine labels.
- Match the supplied scoring mode and basis. Use “points” for Stableford and “strokes” for stroke play.
- Prefer specific turning points, cumulative leads, individual contributions, and final-hole drama over generic praise.
- Do not call ordinary deterministic scoring “lucky”, “heroic”, “dominant”, or “AI”.
- Do not use headings, bullets, markdown, or commentary outside the five sentences.
- Return JSON matching the requested schema.`;

type RecordValue = Record<string, any>;

type RoundHole = {
  id: string;
  playedNumber: number;
  sourceHoleNumber: number;
  par: number;
  strokeIndex: number | null;
};

type Player = {
  id: string;
  name: string;
  playingHandicap: number;
  scoreByHole: Record<string, number>;
};

type HoleResult = {
  playedNumber: number;
  par: number;
  value: number | null;
  grossScore: number | null;
  contributorIds: string[];
};

type TeamResult = {
  id: string;
  displayName: string;
  configuredOrder: number;
  members: Player[];
  holeResults: HoleResult[];
  total: number | null;
};

export type TeamRoundFactPacket = {
  hole_count: number;
  format: {
    scoring_mode: string;
    scorecard_mode: "stableford" | "stroke_play";
    basis: "net" | "gross";
    label: string;
  };
  final_result: RecordValue;
  turn: RecordValue;
  defining_swing: RecordValue | null;
  closing_contribution: RecordValue | null;
  final_hole: RecordValue;
  allowed_team_names: string[];
  allowed_player_names: string[];
};

export function isCompletedTeamRound(row: RecordValue): boolean {
  const metadata = record(row?.metadata);
  const teamSettings = record(metadata.team_settings ?? metadata.teamSettings);
  const players = Array.isArray(metadata.players) ? metadata.players.filter(isRecord) : [];
  const roundHoles = orderedRoundHoleRecords(metadata);
  const isIncomplete = metadata.is_incomplete === true || metadata.isIncomplete === true;
  return teamSettings.enabled === true && !isIncomplete && players.length >= 2 && roundHoles.length > 0;
}

export function buildTeamRoundFactPacket(row: RecordValue, courseHoles: unknown[]): TeamRoundFactPacket | null {
  if (!isCompletedTeamRound(row)) return null;

  const metadata = record(row.metadata);
  const teamSettings = record(metadata.team_settings ?? metadata.teamSettings);
  const scorecardMode = normalizedToken(
    metadata.multiplayer_scorecard_mode ?? metadata.multiplayerScorecardMode,
    "stroke_play",
  ) === "stableford" ? "stableford" : "stroke_play";
  const scoringMode = normalizedToken(teamSettings.scoring_mode ?? teamSettings.scoringMode, "best_ball");
  const requestedBasis = normalizedToken(
    metadata.multiplayer_scorecard_basis ?? metadata.multiplayerScorecardBasis,
    "gross",
  );
  const basis = scoringMode === "scramble" ? "gross" : requestedBasis === "net" ? "net" : "gross";
  const holes = normalizeRoundHoles(metadata, courseHoles);
  if (!holes.length) return null;

  const players: Player[] = (Array.isArray(metadata.players) ? metadata.players : [])
    .filter(isRecord)
    .map((player) => ({
      id: stringValue(player.id) ?? "",
      name: stringValue(player.name) ?? "Player",
      playingHandicap: integerValue(player.playing_handicap ?? player.playingHandicap) ?? 0,
      scoreByHole: integerMap(player.score_by_hole ?? player.scoreByHole),
    }))
    .filter((player) => player.id);
  const assignments = record(
    teamSettings.assignments_by_participant_id ?? teamSettings.assignmentsByParticipantId,
  );
  const scorekeepers = record(
    teamSettings.scramble_scorekeeper_by_team_id ?? teamSettings.scrambleScorekeeperByTeamId,
  );
  const configuredTeams = Array.isArray(teamSettings.teams) ? teamSettings.teams.filter(isRecord) : [];
  const adjustmentsByPlayer = new Map(players.map((player) => [
    player.id,
    strokeAdjustments(player.playingHandicap, holes),
  ]));

  const teams: TeamResult[] = configuredTeams.flatMap((rawTeam, configuredOrder) => {
    const id = stringValue(rawTeam.id);
    if (!id) return [];
    const members = players.filter((player) => assignments[player.id] === id);
    if (!members.length) return [];
    const scorekeeperId = stringValue(scorekeepers[id]);
    const scorekeeper = scorekeeperId ? players.find((player) => player.id === scorekeeperId) : null;
    const candidatesForTeam = scoringMode === "scramble" && scorekeeper ? [scorekeeper] : members;

    const holeResults = holes.map((hole, holeIndex): HoleResult => {
      const scored = candidatesForTeam.flatMap((player) => {
        const grossScore = positiveInteger(player.scoreByHole[hole.id]);
        if (!grossScore) return [];
        const handicapStrokes = basis === "net" ? adjustmentsByPlayer.get(player.id)?.[holeIndex] ?? 0 : 0;
        const adjustedScore = Math.max(1, grossScore - handicapStrokes);
        const value = scorecardMode === "stableford"
          ? stablefordPoints(adjustedScore - hole.par)
          : adjustedScore;
        return [{ playerId: player.id, grossScore, value }];
      });
      if (!scored.length || (scoringMode !== "scramble" && scored.length !== members.length)) {
        return { playedNumber: hole.playedNumber, par: hole.par, value: null, grossScore: null, contributorIds: [] };
      }
      if (scoringMode === "all_scores") {
        return {
          playedNumber: hole.playedNumber,
          par: hole.par,
          value: scored.reduce((sum, result) => sum + result.value, 0),
          grossScore: null,
          contributorIds: scored.map((result) => result.playerId),
        };
      }
      const target = scorecardMode === "stableford"
        ? Math.max(...scored.map((result) => result.value))
        : Math.min(...scored.map((result) => result.value));
      const contributors = scored.filter((result) => result.value === target);
      return {
        playedNumber: hole.playedNumber,
        par: hole.par,
        value: target,
        grossScore: contributors.length === 1 ? contributors[0]!.grossScore : null,
        contributorIds: contributors.map((result) => result.playerId),
      };
    });
    const completed = holeResults.filter((hole) => typeof hole.value === "number");
    const storedName = stringValue(rawTeam.name) ?? `Team ${configuredOrder + 1}`;
    return [{
      id,
      configuredOrder,
      displayName: defaultTeamName(storedName) ? members.map((member) => member.name).join(" & ") : storedName,
      members,
      holeResults,
      total: completed.length ? completed.reduce((sum, hole) => sum + (hole.value ?? 0), 0) : null,
    }];
  });

  if (teams.length < 2) return null;
  teams.sort((left, right) => compareNullableScores(left.total, right.total, scorecardMode)
    || left.displayName.localeCompare(right.displayName));
  const first = teams[0]!;
  const second = teams[1]!;
  if (first.total === null || second.total === null) return null;

  const holeCount = Math.min(first.holeResults.length, second.holeResults.length);
  const turnIndex = Math.min(9, Math.ceil(holeCount / 2));
  const turn = cumulativeCheckpoint(first, second, turnIndex, scorecardMode);
  const swing = definingSwing(first, second, scorecardMode);
  const widest = widestLead(first, second, scorecardMode);
  const closing = strongestClosingContribution(first, second, turnIndex, scorecardMode);
  const lastIndex = holeCount - 1;
  const firstLast = first.holeResults[lastIndex]!;
  const secondLast = second.holeResults[lastIndex]!;
  const lastWinner = typeof firstLast.value === "number" && typeof secondLast.value === "number" && firstLast.value !== secondLast.value
    ? (compareScores(firstLast.value, secondLast.value, scorecardMode) < 0 ? first : second)
    : null;
  const lastLoser = lastWinner?.id === first.id ? second : first;
  const winnerHole = lastWinner?.holeResults[lastIndex] ?? null;
  const loserHole = lastLoser?.holeResults[lastIndex] ?? null;

  return {
    hole_count: holeCount,
    format: {
      scoring_mode: scoringMode,
      scorecard_mode: scorecardMode,
      basis,
      label: `${basis} ${scorecardMode === "stableford" ? "Stableford" : "stroke-play"} ${scoringMode === "scramble" ? "scramble" : scoringMode === "all_scores" ? "team aggregate" : "best-ball"}`,
    },
    final_result: {
      tied: first.total === second.total,
      leader_or_winner: first.displayName,
      opponent: second.displayName,
      score: `${first.total}-${second.total}`,
      margin: Math.abs(first.total - second.total),
    },
    turn: {
      played_through_hole: turnIndex,
      state: turn.margin === 0 ? "tied" : "lead",
      team: turn.leadingTeam?.displayName ?? null,
      margin: turn.margin,
      scores: turn.scores,
    },
    defining_swing: swing ? {
      played_hole: swing.index + 1,
      team: swing.winner.displayName,
      contributor_names: contributorNames(swing.winner, swing.winner.holeResults[swing.index]!),
      golf_result: golfScoreName(swing.winner.holeResults[swing.index]!.grossScore, swing.winner.holeResults[swing.index]!.par),
      counting_value: swing.winnerValue,
      opponent_value: swing.loserValue,
      swing: swing.swing,
      position_before: scorePosition(swing.beforeWinner, swing.beforeLoser, scorecardMode),
      position_after: scorePosition(swing.afterWinner, swing.afterLoser, scorecardMode),
      widest_later_lead: widest && widest.team.id === swing.winner.id && widest.index > swing.index
        ? { margin: widest.margin, played_hole: widest.index + 1 }
        : null,
    } : null,
    closing_contribution: closing,
    final_hole: {
      played_hole: holeCount,
      winning_team: lastWinner?.displayName ?? null,
      contributor_names: lastWinner && winnerHole ? contributorNames(lastWinner, winnerHole) : [],
      winning_value: winnerHole?.value ?? null,
      opponent_value: loserHole?.value ?? null,
      outcome: first.total === second.total ? "squared the match" : lastWinner?.id === first.id ? "confirmed the win" : "reduced the final margin",
      final_score: `${first.total}-${second.total}`,
    },
    allowed_team_names: teams.map((team) => team.displayName),
    allowed_player_names: players.map((player) => player.name),
  };
}

export function validateGeneratedSummary(sentences: unknown, packet: TeamRoundFactPacket): string[] | null {
  if (!Array.isArray(sentences) || sentences.length !== 5) return null;
  const clean = sentences.map((sentence) => typeof sentence === "string" ? sentence.trim() : "");
  if (clean.some((sentence) => !sentence || sentence.length > 500)) return null;
  const sourceHolePattern = /\bhole\s+(\d+)\b/gi;
  for (const sentence of clean) {
    for (const match of sentence.matchAll(sourceHolePattern)) {
      const hole = Number(match[1]);
      if (!Number.isInteger(hole) || hole < 1 || hole > packet.hole_count) return null;
    }
  }
  const combined = clean.join(" ");
  const normalizedCombined = combined.replace(/[–—]/g, "-").toLowerCase();
  if (!normalizedCombined.includes(String(packet.final_result.score).toLowerCase())) return null;

  const swing = packet.defining_swing;
  if (swing?.contributor_names?.length === 1 && swing.golf_result) {
    const contributor = String(swing.contributor_names[0]).toLowerCase();
    if (!normalizedCombined.includes(contributor)
      || !normalizedCombined.includes(String(swing.golf_result).toLowerCase())
      || !normalizedCombined.includes(String(swing.counting_value))) return null;
  }
  if (packet.final_hole?.contributor_names?.length === 1) {
    if (!normalizedCombined.includes(String(packet.final_hole.contributor_names[0]).toLowerCase())) return null;
  }
  return clean;
}

function normalizeRoundHoles(metadata: RecordValue, courseHoles: unknown[]): RoundHole[] {
  const courseByNumber = new Map<number, RecordValue>();
  courseHoles.filter(isRecord).forEach((hole) => {
    const number = positiveInteger(hole.holeNumber ?? hole.hole_number ?? hole.number);
    if (number) courseByNumber.set(number, hole);
  });
  return orderedRoundHoleRecords(metadata).map((record, index) => {
    const sourceHoleNumber = positiveInteger(record.hole_number ?? record.holeNumber ?? record.number) ?? index + 1;
    const courseHole = courseByNumber.get(sourceHoleNumber);
    return {
      id: stringValue(record.id) ?? `hole-${index + 1}`,
      playedNumber: index + 1,
      sourceHoleNumber,
      par: positiveInteger(record.par) ?? positiveInteger(courseHole?.par) ?? 4,
      strokeIndex: positiveInteger(record.stroke_index ?? record.strokeIndex ?? courseHole?.strokeIndex ?? courseHole?.stroke_index ?? courseHole?.index),
    };
  });
}

function orderedRoundHoleRecords(metadata: RecordValue): RecordValue[] {
  const raw = metadata.round_holes ?? metadata.roundHoles;
  const records = Array.isArray(raw)
    ? raw.filter(isRecord)
    : isRecord(raw) ? Object.values(raw).filter(isRecord) : [];
  return records
    .map((record, index) => ({ record, sequence: integerValue(record.sequence) ?? index }))
    .sort((left, right) => left.sequence - right.sequence)
    .map(({ record }) => record);
}

function strokeAdjustments(playingHandicap: number, holes: RoundHole[]): number[] {
  if (!holes.length || playingHandicap === 0) return Array(holes.length).fill(0);
  const magnitude = Math.abs(playingHandicap);
  const direction = playingHandicap > 0 ? 1 : -1;
  const base = Math.floor(magnitude / holes.length);
  const remainder = magnitude % holes.length;
  const result = Array(holes.length).fill(base * direction);
  holes.map((hole, order) => ({ order, strokeIndex: hole.strokeIndex ?? order + 1 }))
    .sort((left, right) => (playingHandicap > 0 ? left.strokeIndex - right.strokeIndex : right.strokeIndex - left.strokeIndex) || left.order - right.order)
    .slice(0, remainder)
    .forEach(({ order }) => { result[order] += direction; });
  return result;
}

function definingSwing(first: TeamResult, second: TeamResult, mode: string): RecordValue | null {
  let biggest: RecordValue | null = null;
  const count = Math.min(first.holeResults.length, second.holeResults.length);
  for (let index = 0; index < count; index += 1) {
    const firstValue = first.holeResults[index]?.value;
    const secondValue = second.holeResults[index]?.value;
    if (typeof firstValue !== "number" || typeof secondValue !== "number" || firstValue === secondValue) continue;
    const winner = compareScores(firstValue, secondValue, mode) < 0 ? first : second;
    const loser = winner.id === first.id ? second : first;
    const winnerValue = winner.id === first.id ? firstValue : secondValue;
    const loserValue = winner.id === first.id ? secondValue : firstValue;
    const swing = Math.abs(firstValue - secondValue);
    if (!biggest || swing > biggest.swing) {
      const beforeWinner = sumValues(winner.holeResults.slice(0, index));
      const beforeLoser = sumValues(loser.holeResults.slice(0, index));
      biggest = { index, winner, loser, winnerValue, loserValue, swing, beforeWinner, beforeLoser, afterWinner: beforeWinner + winnerValue, afterLoser: beforeLoser + loserValue };
    }
  }
  return biggest;
}

function widestLead(first: TeamResult, second: TeamResult, mode: string): RecordValue | null {
  let firstTotal = 0;
  let secondTotal = 0;
  let widest: RecordValue | null = null;
  for (let index = 0; index < Math.min(first.holeResults.length, second.holeResults.length); index += 1) {
    firstTotal += first.holeResults[index]?.value ?? 0;
    secondTotal += second.holeResults[index]?.value ?? 0;
    const margin = scoreMargin(firstTotal, secondTotal, mode);
    if (margin && (!widest || Math.abs(margin) > widest.margin)) {
      widest = { team: margin > 0 ? first : second, margin: Math.abs(margin), index };
    }
  }
  return widest;
}

function strongestClosingContribution(first: TeamResult, second: TeamResult, startIndex: number, mode: string): RecordValue | null {
  const candidates = [first, second].flatMap((team) => {
    const opponent = team.id === first.id ? second : first;
    return team.members.flatMap((member) => {
      const stretch = longestStretch(team.holeResults, member.id, startIndex);
      if (stretch.length < 2) return [];
      const beforeTeam = sumValues(team.holeResults.slice(0, stretch.startIndex));
      const beforeOpponent = sumValues(opponent.holeResults.slice(0, stretch.startIndex));
      const afterTeam = sumValues(team.holeResults.slice(0, stretch.endIndex + 1));
      const afterOpponent = sumValues(opponent.holeResults.slice(0, stretch.endIndex + 1));
      return [{ team, member, stretch, beforeTeam, beforeOpponent, afterTeam, afterOpponent }];
    });
  });
  candidates.sort((left, right) => right.stretch.length - left.stretch.length || left.member.name.localeCompare(right.member.name));
  const chosen = candidates[0];
  return chosen ? {
    player: chosen.member.name,
    team: chosen.team.displayName,
    length: chosen.stretch.length,
    start_played_hole: chosen.stretch.startIndex + 1,
    end_played_hole: chosen.stretch.endIndex + 1,
    position_before: scorePosition(chosen.beforeTeam, chosen.beforeOpponent, mode),
    position_after: scorePosition(chosen.afterTeam, chosen.afterOpponent, mode),
  } : null;
}

function longestStretch(holes: HoleResult[], playerId: string, startIndex: number): { length: number; startIndex: number; endIndex: number } {
  let best = { length: 0, startIndex: 0, endIndex: 0 };
  let current = { length: 0, startIndex: 0, endIndex: 0 };
  holes.forEach((hole, index) => {
    if (index >= startIndex && hole.contributorIds.includes(playerId)) {
      if (!current.length) current.startIndex = index;
      current.length += 1;
      current.endIndex = index;
      if (current.length > best.length) best = { ...current };
    } else current = { length: 0, startIndex: 0, endIndex: 0 };
  });
  return best;
}

function cumulativeCheckpoint(first: TeamResult, second: TeamResult, count: number, mode: string): RecordValue {
  const firstValue = sumValues(first.holeResults.slice(0, count));
  const secondValue = sumValues(second.holeResults.slice(0, count));
  const margin = Math.abs(scoreMargin(firstValue, secondValue, mode));
  return {
    margin,
    leadingTeam: margin ? (compareScores(firstValue, secondValue, mode) < 0 ? first : second) : null,
    scores: { [first.displayName]: firstValue, [second.displayName]: secondValue },
  };
}

function contributorNames(team: TeamResult, hole: HoleResult): string[] {
  return team.members.filter((member) => hole.contributorIds.includes(member.id)).map((member) => member.name);
}

function golfScoreName(score: number | null, par: number): string | null {
  if (typeof score !== "number") return null;
  const toPar = score - par;
  if (toPar <= -2) return "eagle";
  if (toPar === -1) return "birdie";
  if (toPar === 0) return "par";
  if (toPar === 1) return "bogey";
  return null;
}

function scorePosition(teamScore: number, opponentScore: number, mode: string): string {
  const margin = scoreMargin(teamScore, opponentScore, mode);
  if (!margin) return "level";
  const unit = mode === "stableford" ? "point" : "stroke";
  return `${Math.abs(margin)} ${Math.abs(margin) === 1 ? unit : `${unit}s`} ${margin > 0 ? "ahead" : "behind"}`;
}

function scoreMargin(teamScore: number, opponentScore: number, mode: string): number {
  return mode === "stableford" ? teamScore - opponentScore : opponentScore - teamScore;
}

function compareScores(left: number, right: number, mode: string): number {
  return mode === "stableford" ? right - left : left - right;
}

function compareNullableScores(left: number | null, right: number | null, mode: string): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return compareScores(left, right, mode);
}

function sumValues(holes: HoleResult[]): number {
  return holes.reduce((sum, hole) => sum + (hole.value ?? 0), 0);
}

function stablefordPoints(toPar: number): number {
  return Math.min(5, Math.max(0, 2 - toPar));
}

function defaultTeamName(name: string): boolean {
  return /^team\s+(?:a|b)$/i.test(name.trim());
}

function normalizedToken(value: unknown, fallback: string): string {
  const text = stringValue(value);
  return text ? text.toLowerCase().replace(/[ -]+/g, "_") : fallback;
}

function integerMap(value: unknown): Record<string, number> {
  return Object.fromEntries(Object.entries(record(value)).flatMap(([key, raw]) => {
    const parsed = integerValue(raw);
    return parsed === null ? [] : [[key, parsed]];
  }));
}

function integerValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = integerValue(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function record(value: unknown): RecordValue {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
