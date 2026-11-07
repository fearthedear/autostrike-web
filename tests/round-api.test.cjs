const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const test = require('node:test');

async function loadModule() {
  const source = await readFile(new URL('../functions/api/round.js', `file://${__filename}`), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

test('shared-round API returns sanitized course stroke indexes', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });

  const requests = [];
  global.fetch = async (url) => {
    requests.push(String(url));
    if (requests.length === 1) {
      return new Response(JSON.stringify([{
        id: 'dd5a8b5f-c99d-47f1-b3cd-b17560abbd90',
        course_id: 'course-1',
        course_name: 'KGPA',
        metadata: {},
      }]), { status: 200 });
    }
    return new Response(JSON.stringify([{
      holes: [{ holeNumber: 19, par: 4, index: '8', greenCoordinates: { center: { latitude: 1 } } }],
    }]), { status: 200 });
  };

  const { onRequestGet } = await loadModule();
  const response = await onRequestGet({
    request: new Request('https://autostrikegolf.com/api/round?id=dd5a8b5f-c99d-47f1-b3cd-b17560abbd90'),
    env: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-key' },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive, nosnippet');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.deepEqual(body.round.courseHoles, [{ holeNumber: 19, par: 4, strokeIndex: 8 }]);
  assert.equal(requests.length, 2);
  assert.match(requests[1], /\/rest\/v1\/courses/);
  assert.doesNotMatch(JSON.stringify(body.round.courseHoles), /greenCoordinates/);
});

test('shared-round API schedules backend generation for a completed team round', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });

  const requests = [];
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).includes('/rest/v1/scores')) {
      return new Response(JSON.stringify([{
        id: 'dd5a8b5f-c99d-47f1-b3cd-b17560abbd90',
        user_id: 'owner-1',
        course_id: 'course-1',
        course_name: 'KGPA',
        metadata: {
          round_holes: [{ id: 'h1', hole_number: 19, sequence: 0, par: 4 }],
          players: [{ id: 'p1' }, { id: 'p2' }],
          team_settings: { enabled: true },
        },
      }]), { status: 200 });
    }
    if (String(url).includes('/rest/v1/courses')) {
      return new Response(JSON.stringify([{ holes: [{ holeNumber: 19, par: 4, index: 8 }] }]), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  let backgroundTask;
  const { onRequestGet } = await loadModule();
  const response = await onRequestGet({
    request: new Request('https://autostrikegolf.com/api/round?id=dd5a8b5f-c99d-47f1-b3cd-b17560abbd90'),
    env: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-key' },
    waitUntil(task) { backgroundTask = task; },
  });
  assert.equal(response.status, 200);
  await backgroundTask;

  const generation = requests.find(({ url }) => url === 'https://score-import.autostrikegolf.com/round-summary');
  assert.ok(generation);
  assert.equal(generation.options.method, 'POST');
  assert.equal(generation.options.headers.Authorization, 'Bearer test-key');
  assert.equal(JSON.parse(generation.options.body).score_id, 'dd5a8b5f-c99d-47f1-b3cd-b17560abbd90');
  const source = await readFile(new URL('../functions/api/round.js', `file://${__filename}`), 'utf8');
  assert.match(source, /summaryVersion === 2/);
});

test('refreshes only matched remote player scores and leaves owner and guest untouched', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const owner = '00000000-0000-4000-8000-000000000001';
  const player = '00000000-0000-4000-8000-000000000002';
  const guest = '00000000-0000-4000-8000-000000000003';
  const user = '00000000-0000-4000-8000-000000000004';
  const game = '00000000-0000-4000-8000-000000000005';
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    const u = new URL(String(url));
    if (u.pathname.endsWith('/courses')) return Response.json([{ holes: [] }]);
    if (u.pathname.endsWith('/friend_game_participants')) return Response.json([{ id: player, user_id: user, score_by_hole: { h1: 5 }, updated_at: '2026-01-01T10:00:00Z' }]);
    if (u.pathname.endsWith('/scores') && u.searchParams.has('metadata->>friend_game_id')) return Response.json([
      { user_id: user, updated_at: '2026-01-01T11:00:00Z', metadata: { primary_player_id: player, score_by_hole: { h1: 6, secret: 99 } } },
    ]);
    return Response.json([{ id: 'dd5a8b5f-c99d-47f1-b3cd-b17560abbd90', course_id: 'course', metadata: {
      friend_game_id: game, primary_player_id: owner, round_holes: [{ id: 'h1', par: 4 }],
      players: [{ id: owner, score_by_hole: { h1: 3 } }, { id: player, score_by_hole: { h1: 4 } }, { id: guest, score_by_hole: { h1: 7 } }],
      team_settings: { enabled: true }, ai_round_summary: { version: 2, sentences: ['1','2','3','4','5'] },
    } }]);
  };
  const { onRequestGet } = await loadModule();
  const response = await onRequestGet({ request: new Request('https://autostrikegolf.com/api/round?id=dd5a8b5f-c99d-47f1-b3cd-b17560abbd90'), env: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-key' } });
  const { round } = await response.json();
  assert.equal(round.metadata.players[0].score_by_hole.h1, 3);
  assert.equal(round.metadata.players[1].score_by_hole.h1, 6);
  assert.equal(round.metadata.players[1].score_by_hole.secret, undefined);
  assert.equal(round.metadata.players[2].score_by_hole.h1, 7);
  assert.equal(round.metadata.shared_scores_refreshed, true);
  assert.ok(calls.some(url => url.includes('/friend_game_participants')));
});
