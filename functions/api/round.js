const SCORE_COLUMNS = [
  'id',
  'user_id',
  'updated_at',
  'course_id',
  'course_name',
  'front_nine_id',
  'back_nine_id',
  'tee_box_name',
  'tee_box_source_index',
  'total_score',
  'to_par',
  'slope_rating',
  'course_rating',
  'round_par',
  'playing_conditions_adjustment',
  'played_on',
  'source',
  'metadata',
].join(',');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const roundId = (url.searchParams.get('id') || url.searchParams.get('round_id') || url.searchParams.get('roundId') || '').trim();

  if (!roundId) {
    return jsonResponse({ error: 'Missing round ID.' }, 400, request);
  }

  if (!UUID_PATTERN.test(roundId)) {
    return jsonResponse({ error: 'Invalid round ID.' }, 400, request);
  }

  const supabaseUrl = supabaseBaseUrl(env);
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || env.SUPABASE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return jsonResponse({ error: 'Round sharing is not configured.' }, 500, request);
  }

  const requestUrl = new URL(`${supabaseUrl}/rest/v1/scores`);
  requestUrl.searchParams.set('select', SCORE_COLUMNS);
  requestUrl.searchParams.set('id', `eq.${roundId}`);
  requestUrl.searchParams.set('deleted_at', 'is.null');
  requestUrl.searchParams.set('limit', '1');

  const response = await fetch(requestUrl.toString(), {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    console.error('Failed to load shared round:', await response.text());
    return jsonResponse({ error: 'Failed to load round.' }, 500, request);
  }

  const rows = await response.json();
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    return jsonResponse({ error: 'Round not found.' }, 404, request);
  }

  const round = normalizeRound(row);
  round.courseHoles = await loadCourseHoles(supabaseUrl, supabaseKey, row.course_id);
  await refreshFriendScores(round, supabaseUrl, supabaseKey);

  if (!round.metadata.shared_scores_refreshed && needsTeamRoundSummary(round)) {
    const generation = requestTeamRoundSummary(env, supabaseKey, round.id);
    if (typeof waitUntil === 'function') {
      waitUntil(generation);
    } else {
      await generation;
    }
  }

  return jsonResponse({ round }, 200, request);
}

export async function onRequestOptions({ request }) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}

function supabaseBaseUrl(env) {
  const rawValue = env.SUPABASE_URL || env.PUBLIC_SUPABASE_URL || env.VITE_SUPABASE_URL || '';
  return rawValue.replace(/\/+$/, '');
}

function normalizeRound(row) {
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};

  return {
    id: row.id,
    courseId: row.course_id,
    courseName: normalizedString(row.course_name) || 'AutoStrike round',
    frontNineId: row.front_nine_id,
    backNineId: row.back_nine_id,
    teeBoxName:
      normalizedString(row.tee_box_name) ||
      normalizedString(metadata.tee_box_name) ||
      normalizedString(metadata.teeBoxName),
    teeBoxSourceIndex: row.tee_box_source_index,
    totalScore: row.total_score,
    toPar: row.to_par,
    slopeRating: row.slope_rating,
    courseRating: row.course_rating === null || row.course_rating === undefined ? null : Number(row.course_rating),
    roundPar: row.round_par,
    playingConditionsAdjustment:
      row.playing_conditions_adjustment === null || row.playing_conditions_adjustment === undefined
        ? 0
        : Number(row.playing_conditions_adjustment),
    playedOn: row.played_on,
    source: row.source,
    metadata,
  };
}

// Friend rounds are saved as snapshots on each phone. Overlay each remote
// participant's own latest submitted score, without mutating any saved row.
async function refreshFriendScores(round, supabaseUrl, supabaseKey) {
  const meta = round.metadata;
  const gameId = meta.friend_game_id ?? meta.friendGameID;
  if (!UUID_PATTERN.test(gameId || '') || !Array.isArray(meta.players)) return;
  const primaryId = meta.primary_player_id ?? meta.primaryPlayerID;
  if (!UUID_PATTERN.test(primaryId || '')) return;
  const holeIds = new Set((Array.isArray(meta.round_holes) ? meta.round_holes : []).map(hole => hole?.id).filter(Boolean));
  if (!holeIds.size) return;
  const ids = meta.players.map(player => player?.id).filter(id => id !== primaryId && UUID_PATTERN.test(id || ''));
  if (!ids.length) return;
  const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, Accept: 'application/json' };
  try {
    const participantsUrl = new URL(`${supabaseUrl}/rest/v1/friend_game_participants`);
    participantsUrl.searchParams.set('select', 'id,user_id,score_by_hole,completed_hole_ids,updated_at');
    participantsUrl.searchParams.set('game_id', `eq.${gameId}`);
    participantsUrl.searchParams.set('id', `in.(${ids.join(',')})`);
    const response = await fetch(participantsUrl.toString(), { headers });
    if (!response.ok) throw new Error(`Participant lookup failed (${response.status})`);
    const participants = await response.json();
    if (!Array.isArray(participants)) return;
    const users = [...new Set(participants.map(p => p.user_id).filter(id => UUID_PATTERN.test(id || '')))];
    let completed = [];
    if (users.length) {
      const scoresUrl = new URL(`${supabaseUrl}/rest/v1/scores`);
      scoresUrl.searchParams.set('select', 'user_id,updated_at,metadata');
      scoresUrl.searchParams.set('metadata->>friend_game_id', `eq.${gameId}`);
      scoresUrl.searchParams.set('user_id', `in.(${users.join(',')})`);
      scoresUrl.searchParams.set('deleted_at', 'is.null');
      scoresUrl.searchParams.set('order', 'updated_at.desc');
      scoresUrl.searchParams.set('limit', '100');
      const scoreResponse = await fetch(scoresUrl.toString(), { headers });
      if (!scoreResponse.ok) throw new Error(`Player score lookup failed (${scoreResponse.status})`);
      const rows = await scoreResponse.json();
      if (Array.isArray(rows)) completed = rows;
    }
    let changed = false;
    meta.players = meta.players.map(player => {
      const participant = participants.find(p => p.id === player?.id && p.user_id);
      if (!participant) return player;
      const ownRound = completed.find(s => s.user_id === participant.user_id
        && (s.metadata?.primary_player_id ?? s.metadata?.primaryPlayerID) === participant.id
        && s.metadata?.is_incomplete !== true && s.metadata?.isIncomplete !== true);
      const savedScores = ownRound?.metadata?.score_by_hole ?? ownRound?.metadata?.scoreByRoundHoleID;
      const useSaved = savedScores && Date.parse(ownRound.updated_at) >= Date.parse(participant.updated_at);
      const fresh = useSaved ? savedScores : participant.score_by_hole;
      const valid = fresh && typeof fresh === 'object' && !Array.isArray(fresh);
      if (!valid || !Object.keys(fresh).length) return player;
      const previous = player.score_by_hole ?? player.scoreByRoundHoleID ?? {};
      const verified = Object.fromEntries(Object.entries(fresh).filter(([id, value]) => holeIds.has(id) && Number.isInteger(value) && value > 0));
      const combined = { ...previous, ...verified };
      if (JSON.stringify(combined) !== JSON.stringify(previous)) changed = true;
      return { ...player, score_by_hole: combined };
    });
    if (changed) meta.shared_scores_refreshed = true;
  } catch (error) {
    // Degrade to the original shared snapshot; never fail the page for a transient lookup error.
    console.error('Failed to refresh shared player scores:', error);
  }
}

async function loadCourseHoles(supabaseUrl, supabaseKey, courseId) {
  if (!courseId) return [];

  try {
    const requestUrl = new URL(`${supabaseUrl}/rest/v1/courses`);
    requestUrl.searchParams.set('select', 'holes');
    requestUrl.searchParams.set('id', `eq.${courseId}`);
    requestUrl.searchParams.set('limit', '1');

    const response = await fetch(requestUrl.toString(), {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      console.error('Failed to load shared round course holes:', await response.text());
      return [];
    }

    const rows = await response.json();
    const holes = Array.isArray(rows?.[0]?.holes) ? rows[0].holes : [];
    return holes.flatMap((hole) => {
      if (!hole || typeof hole !== 'object' || Array.isArray(hole)) return [];
      const holeNumber = positiveInteger(hole.holeNumber ?? hole.hole_number ?? hole.number);
      const par = positiveInteger(hole.par);
      const strokeIndex = positiveInteger(hole.strokeIndex ?? hole.stroke_index ?? hole.index);
      return holeNumber && par ? [{ holeNumber, par, strokeIndex }] : [];
    });
  } catch (error) {
    console.error('Failed to load shared round course holes:', error);
    return [];
  }
}

function positiveInteger(value) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

function normalizedString(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

function needsTeamRoundSummary(round) {
  const metadata = round?.metadata && typeof round.metadata === 'object' ? round.metadata : {};
  const teamSettings = metadata.team_settings ?? metadata.teamSettings;
  const sentences = metadata.ai_round_summary?.sentences ?? metadata.aiRoundSummary?.sentences;
  const summaryVersion = metadata.ai_round_summary?.version ?? metadata.aiRoundSummary?.version;
  return teamSettings?.enabled === true
    && metadata.is_incomplete !== true
    && metadata.isIncomplete !== true
    && !(summaryVersion === 2 && Array.isArray(sentences) && sentences.length === 5);
}

async function requestTeamRoundSummary(env, supabaseKey, scoreId) {
  const workerUrl = env.ROUND_SUMMARY_WORKER_URL || 'https://score-import.autostrikegolf.com/round-summary';
  try {
    const response = await fetch(workerUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ score_id: scoreId }),
    });
    if (!response.ok) {
      console.error('Failed to generate team round summary:', response.status, await response.text());
    }
  } catch (error) {
    console.error('Failed to request team round summary:', error);
  }
}

function jsonResponse(payload, status = 200, request = null) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(request),
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow, noarchive, nosnippet',
      'referrer-policy': 'no-referrer',
    },
  });
}

const ALLOWED_WEB_ORIGINS = [
  'https://autostrikegolf.com',
  'https://www.autostrikegolf.com',
  'https://dashboard.autostrikegolf.com',
];

function corsHeaders(request) {
  const origin = request?.headers?.get?.('origin') || '';
  const allowed = ALLOWED_WEB_ORIGINS.includes(origin) ? origin : ALLOWED_WEB_ORIGINS[0];
  return {
    'access-control-allow-origin': allowed,
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'vary': 'Origin',
  };
}
