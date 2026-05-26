const SCORE_COLUMNS = [
  'id',
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

export async function onRequestGet({ request, env }) {
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

  return jsonResponse({ round: normalizeRound(row) }, 200, request);
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

function normalizedString(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

function jsonResponse(payload, status = 200, request = null) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(request),
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
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
