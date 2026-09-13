/// <reference types="@cloudflare/workers-types" />

import {
  TEAM_ROUND_SUMMARY_PROMPT,
  type TeamRoundFactPacket,
  buildTeamRoundFactPacket,
  isCompletedTeamRound,
  validateGeneratedSummary,
} from "./team-round-summary";

interface SendEmailBinding {
  send(message: any): Promise<{ messageId: string }>;
}

export interface Env {
  EMAIL: SendEmailBinding;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;
  ROUND_SUMMARY_MODEL?: string;
  WEBHOOK_HMAC_SECRET: string;
  EMAIL_FROM_ADDR: string;
  EMAIL_FROM_NAME: string;
  TEST_EMAIL_TO?: string;
}

// One image may contain ONE scorecard or MANY rounds (e.g. an in-app round-history
// list). We always return an array.
const ROUND_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    played_on: { type: ["string", "null"], description: "YYYY-MM-DD or null" },
    course_name: { type: ["string", "null"] },
    tee_box_name: { type: ["string", "null"] },
    total_score: { type: ["integer", "null"] },
    to_par: { type: ["integer", "null"] },
    holes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          hole_number: { type: "integer", minimum: 1, maximum: 18 },
          par: { type: ["integer", "null"] },
          score: { type: ["integer", "null"] },
          putts: { type: ["integer", "null"] },
          penalties: { type: ["integer", "null"] },
          fairway_hit: {
            type: ["string", "null"],
            enum: ["yes", "no", "na", null],
            description: "yes if drive hit the fairway, no if missed, na for par-3 holes",
          },
          gir: { type: ["boolean", "null"], description: "green in regulation" },
          sand_saves: { type: ["integer", "null"] },
          drive_distance_yards: { type: ["integer", "null"] },
          tee_club: { type: ["string", "null"], description: "e.g. 1W, 3W, 7i, Pw, Lw" },
        },
        required: [
          "hole_number",
          "par",
          "score",
          "putts",
          "penalties",
          "fairway_hit",
          "gir",
          "sand_saves",
          "drive_distance_yards",
          "tee_club",
        ],
      },
    },
    round_stats: {
      type: "object",
      additionalProperties: false,
      properties: {
        total_putts: { type: ["integer", "null"] },
        total_penalties: { type: ["integer", "null"] },
        fairways_hit: { type: ["integer", "null"], description: "count of fairways hit" },
        fairways_hit_pct: { type: ["number", "null"] },
        gir_count: { type: ["integer", "null"] },
        gir_pct: { type: ["number", "null"] },
        sand_shots: { type: ["integer", "null"] },
        total_distance_yards: { type: ["integer", "null"] },
        out_score: { type: ["integer", "null"] },
        in_score: { type: ["integer", "null"] },
        pace_of_play_minutes: { type: ["integer", "null"] },
        course_handicap: { type: ["number", "null"] },
        course_rating: { type: ["number", "null"] },
        slope_rating: { type: ["integer", "null"] },
        playing_conditions_adjustment: {
          type: ["number", "null"],
          description: "PCC / playing conditions adjustment, usually 0 if shown as zero.",
        },
        play_format: { type: ["string", "null"], description: "e.g. stroke, stableford, match" },
      },
      required: [
        "total_putts",
        "total_penalties",
        "fairways_hit",
        "fairways_hit_pct",
        "gir_count",
        "gir_pct",
        "sand_shots",
        "total_distance_yards",
        "out_score",
        "in_score",
        "pace_of_play_minutes",
        "course_handicap",
        "course_rating",
        "slope_rating",
        "playing_conditions_adjustment",
        "play_format",
      ],
    },
  },
  required: [
    "confidence",
    "played_on",
    "course_name",
    "tee_box_name",
    "total_score",
    "to_par",
    "holes",
    "round_stats",
  ],
} as const;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    image_kind: {
      type: "string",
      enum: ["scorecard", "round_history", "stats", "other"],
    },
    image_confidence: { type: "string", enum: ["high", "medium", "low"] },
    rounds: { type: "array", items: ROUND_SCHEMA },
  },
  required: ["image_kind", "image_confidence", "rounds"],
} as const;

const SYSTEM_PROMPT =
  "You extract golf round results from a photo of a paper scorecard or a screenshot of a golf app. " +
  "An image can contain ONE round (a single scorecard) or MANY rounds (a scrollable list of past rounds). " +
  "Return EVERY round you can clearly read in the `rounds` array. " +
  "For each round, fill in only what you can clearly read; use null otherwise. " +
  "If the total isn't shown but per-hole scores are clear, sum them yourself. " +
  "to_par should be the score relative to course par (negative=under, 0=even, positive=over). " +
  "Per-hole: capture par, score, putts, penalties, fairway_hit ('yes'/'no'/'na' — use 'na' on par-3s), " +
  "gir (true if green in regulation, false otherwise), sand_saves, drive_distance_yards, tee_club. " +
  "Use null for any per-hole stat that is blank/dash/not visible (don't invent zeros). " +
  "In round_stats, fill out totals/percentages exactly as shown on the card; calculate only when a value is missing AND the per-hole data is complete. " +
  "If course rating, slope rating, or PCC/playing conditions adjustment is shown, capture it in round_stats; use null otherwise. " +
  "Set per-round confidence='low' to drop ambiguous rounds. " +
  "Set image_kind='other' and rounds=[] if the image isn't a scorecard or score list.";

const TEAM_SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    sentences: {
      type: "array",
      minItems: 5,
      maxItems: 5,
      items: { type: "string" },
    },
  },
  required: ["sentences"],
} as const;

type Hole = {
  hole_number: number;
  par: number | null;
  score: number | null;
  putts: number | null;
  penalties: number | null;
  fairway_hit: "yes" | "no" | "na" | null;
  gir: boolean | null;
  sand_saves: number | null;
  drive_distance_yards: number | null;
  tee_club: string | null;
};

type RoundStats = {
  total_putts: number | null;
  total_penalties: number | null;
  fairways_hit: number | null;
  fairways_hit_pct: number | null;
  gir_count: number | null;
  gir_pct: number | null;
  sand_shots: number | null;
  total_distance_yards: number | null;
  out_score: number | null;
  in_score: number | null;
  pace_of_play_minutes: number | null;
  course_handicap: number | null;
  course_rating: number | null;
  slope_rating: number | null;
  playing_conditions_adjustment: number | null;
  play_format: string | null;
};

type Round = {
  confidence: "high" | "medium" | "low";
  played_on: string | null;
  course_name: string | null;
  tee_box_name: string | null;
  total_score: number | null;
  to_par: number | null;
  holes: Hole[];
  round_stats: RoundStats;
};

type Extracted = {
  image_kind: "scorecard" | "round_history" | "stats" | "other";
  image_confidence: "high" | "medium" | "low";
  rounds: Round[];
};

type TeeMetric = { slope?: unknown; courseRating?: unknown; course_rating?: unknown };
type MatchedCourse = {
  id: string;
  name: string;
  front_nine_id: string;
  nines?: any[];
  teeBoxes?: any[];
  nineComboRatings?: any[];
  holes?: any[];
};

type Skip = { path: string; reason: string };
type Imported = {
  score_id: string;
  course_name: string;
  played_on: string;
  total_score: number;
  to_par: number;
  matched_course_id: string;
  source_path: string;
  confidence: string;
};

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/healthz") {
      return new Response("ok", { status: 200 });
    }
    if (req.method === "POST" && url.pathname === "/round-summary") {
      const secret = req.headers.get("x-webhook-secret");
      const authorization = req.headers.get("authorization") ?? "";
      const authorizedByWebhook = Boolean(secret && secret === env.WEBHOOK_HMAC_SECRET);
      const authorizedByServiceRole = authorization === `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`;
      const userId = authorizedByWebhook || authorizedByServiceRole ? null : await authenticatedUserId(env, req);
      if (!authorizedByWebhook && !authorizedByServiceRole && !userId) {
        return new Response("unauthorized", { status: 401 });
      }
      let body: any;
      try {
        body = await req.json();
      } catch {
        return new Response("bad json", { status: 400 });
      }
      const scoreId = body?.score_id;
      if (!scoreId || typeof scoreId !== "string") {
        return new Response("missing score_id", { status: 400 });
      }
      try {
        if (userId) {
          const score = await fetchScore(env, scoreId);
          if (!score) return new Response("not found", { status: 404 });
          if (String(score.user_id ?? "") !== userId) return new Response("forbidden", { status: 403 });
        }
        const result = await processTeamRoundSummary(env, scoreId);
        return new Response(JSON.stringify({ ok: true, score_id: scoreId, ...result }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      } catch (e: any) {
        console.error("processTeamRoundSummary threw", e?.message ?? e);
        return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
    }
    if (req.method === "POST" && url.pathname === "/webhook") {
      const secret = req.headers.get("x-webhook-secret");
      if (!secret || secret !== env.WEBHOOK_HMAC_SECRET) {
        return new Response("forbidden", { status: 403 });
      }
      let body: any;
      try {
        body = await req.json();
      } catch {
        return new Response("bad json", { status: 400 });
      }
      const jobId = body?.job_id;
      if (!jobId || typeof jobId !== "string") {
        return new Response("missing job_id", { status: 400 });
      }
      // Run the work *inside* the request lifetime instead of leaving it on
      // ctx.waitUntil(). pg_net.http_post in Postgres is async (non-blocking),
      // so the trigger doesn't care if we take 30-60s to respond. waitUntil is
      // unreliable past ~10s on this account/plan; we saw multi-image jobs
      // getting cancelled mid-flight.
      try {
        const result = await processJob(env, jobId);
        return new Response(JSON.stringify({ ok: true, job_id: jobId, ...result }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      } catch (e: any) {
        console.error("processJob threw", e?.message ?? e);
        return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
    }
    return new Response("not found", { status: 404 });
  },
};

async function processTeamRoundSummary(
  env: Env,
  scoreId: string,
): Promise<{ status: string; sentence_count?: number }> {
  const score = await fetchScore(env, scoreId);
  if (!score) return { status: "not_found" };
  if (!isCompletedTeamRound(score)) return { status: "not_completed_team_round" };

  const metadata = score.metadata && typeof score.metadata === "object" ? score.metadata : {};
  if (validStoredSummary(metadata.ai_round_summary)) return { status: "already_generated" };

  const courseHoles = await fetchCourseHoles(env, score.course_id);
  const factPacket = buildTeamRoundFactPacket(score, courseHoles);
  if (!factPacket) return { status: "insufficient_round_data" };

  const model = env.ROUND_SUMMARY_MODEL?.trim() || "gpt-4o-mini";
  const sentences = await generateTeamRoundSummary(env, model, factPacket);
  const validated = validateGeneratedSummary(sentences, factPacket);
  if (!validated) throw new Error("OpenAI returned an invalid team-round summary");

  await patchScoreMetadata(env, scoreId, {
    ...metadata,
    ai_round_summary: {
      version: 1,
      model,
      generated_at: new Date().toISOString(),
      sentences: validated,
    },
  });
  return { status: "generated", sentence_count: validated.length };
}

function validStoredSummary(value: any): boolean {
  return Array.isArray(value?.sentences)
    && value.sentences.length === 5
    && value.sentences.every((sentence: unknown) => typeof sentence === "string" && sentence.trim());
}

// ----- pipeline ---------------------------------------------------------------

async function processJob(
  env: Env,
  jobId: string
): Promise<{ imported: number; skipped: number; status: string }> {
  console.log(`processJob start ${jobId}`);
  const job = await fetchJob(env, jobId);
  if (!job) {
    console.log(`job ${jobId} not found`);
    return { imported: 0, skipped: 0, status: "not_found" };
  }
  if (job.status !== "queued") {
    console.log(`job ${jobId} status=${job.status}, skipping`);
    return { imported: 0, skipped: 0, status: `already_${job.status}` };
  }

  await patchJob(env, jobId, { status: "processing" });

  const imported: Imported[] = [];
  const skipped: Skip[] = [];

  try {
    const paths: string[] = Array.isArray(job.uploaded_paths) ? job.uploaded_paths : [];

    // Run all images in parallel — extracts are independent and each takes 10-25s.
    const perImage = await Promise.all(
      paths.map(async (path) => {
        try {
          const dataUrl = await downloadAsDataUrl(env, path);
          const extracted = await extractFromOpenAI(env, dataUrl);
          console.log(
            `extracted ${path}`,
            JSON.stringify({
              kind: extracted.image_kind,
              conf: extracted.image_confidence,
              n_rounds: extracted.rounds.length,
            })
          );
          return { path, extracted, error: null as string | null };
        } catch (e: any) {
          console.error(`extract error ${path}`, e?.message ?? e);
          return {
            path,
            extracted: null as Extracted | null,
            error: truncate(String(e?.message ?? e), 250),
          };
        }
      })
    );

    // Now insert sequentially (DB writes are fast, parallelism not worth the risk).
    for (const r of perImage) {
      if (r.error) {
        skipped.push({ path: r.path, reason: `Processing error: ${r.error}` });
        continue;
      }
      const ex = r.extracted!;
      if (ex.image_kind === "other" || ex.rounds.length === 0) {
        skipped.push({
          path: r.path,
          reason:
            ex.image_kind === "other"
              ? "Image didn't look like a scorecard or score list."
              : "No rounds detected in image.",
        });
        continue;
      }
      let importedFromThisImage = 0;
      for (const round of ex.rounds) {
        if (round.confidence === "low" || round.total_score == null) {
          continue; // silently drop low-confidence rounds (logged in metadata)
        }
        try {
          const matched = await fuzzyMatchCourse(env, round.course_name);
          const courseId = matched?.id ?? "";
          const courseName = matched?.name ?? round.course_name ?? "";
          const frontNineId = matched?.front_nine_id ?? "";
          const playedOn = round.played_on ?? new Date().toISOString().slice(0, 10);
          const roundSnapshot = buildRoundSnapshot(round, matched);

          // Dedupe: same user + same day + same total + same course (matched id
          // when available, otherwise extracted name) is treated as a duplicate.
          const dup = await findDuplicateScore(env, {
            user_id: job.user_id,
            played_on: playedOn,
            total_score: round.total_score,
            course_id: courseId,
            course_name: courseName,
          });
          if (dup) {
            console.log(`dedupe skip ${r.path} ${courseName}/${playedOn}/${round.total_score} -> existing ${dup}`);
            skipped.push({
              path: r.path,
              reason: `Already imported: ${courseName || "(unknown)"} on ${playedOn} — score ${round.total_score}.`,
            });
            continue;
          }

          const scoreRow = {
            user_id: job.user_id,
            course_id: courseId,
            course_name: courseName,
            front_nine_id: frontNineId,
            back_nine_id: null as string | null,
            tee_box_name: round.tee_box_name ?? "",
            tee_box_source_index: 0,
            total_score: round.total_score,
            to_par: round.to_par ?? 0,
            slope_rating: roundSnapshot.slope_rating,
            course_rating: roundSnapshot.course_rating,
            round_par: roundSnapshot.round_par,
            playing_conditions_adjustment: roundSnapshot.playing_conditions_adjustment,
            source: "import",
            played_on: playedOn,
            metadata: {
              import_job_id: jobId,
              source_path: r.path,
              openai_confidence: round.confidence,
              openai_model: env.OPENAI_MODEL,
              image_kind: ex.image_kind,
              extracted_course_name: round.course_name,
              hole_breakdown: round.holes,
              round_stats: round.round_stats,
              round_snapshot: roundSnapshot,
            },
          };
          const scoreId = await insertScore(env, scoreRow);
          imported.push({
            score_id: scoreId,
            course_name: courseName,
            played_on: playedOn,
            total_score: round.total_score,
            to_par: round.to_par ?? 0,
            matched_course_id: courseId,
            source_path: r.path,
            confidence: round.confidence,
          });
          importedFromThisImage++;
        } catch (insertErr: any) {
          console.error("insert err", insertErr?.message ?? insertErr);
        }
      }
      if (importedFromThisImage === 0) {
        skipped.push({
          path: r.path,
          reason: `Found ${ex.rounds.length} round(s) but none with high enough confidence.`,
        });
      }
    }

    // email
    let recipient = await fetchUserEmail(env, job.user_id);
    if (env.TEST_EMAIL_TO && env.TEST_EMAIL_TO.trim()) {
      console.log(`overriding recipient ${recipient} -> ${env.TEST_EMAIL_TO}`);
      recipient = env.TEST_EMAIL_TO.trim();
    }

    let emailSkipped = false;
    let emailError: string | null = null;
    if (recipient) {
      try {
        const { html, text } = buildSummaryEmail(imported, skipped);
        await env.EMAIL.send({
          to: recipient,
          from: { email: env.EMAIL_FROM_ADDR, name: env.EMAIL_FROM_NAME },
          subject:
            imported.length > 0
              ? `Your scorecard import results — ${imported.length} round${imported.length === 1 ? "" : "s"} added`
              : "Your scorecard import results",
          html,
          text,
        });
        console.log(`email sent to ${recipient}`);
      } catch (e: any) {
        const code = e?.code ?? "";
        emailError = `${code} ${e?.message ?? e}`;
        if (code === "E_SENDER_NOT_VERIFIED" || code === "E_SENDER_DOMAIN_NOT_AVAILABLE") {
          emailSkipped = true;
          console.warn(`email skipped: ${code}`);
        } else {
          console.error("email send failed", emailError);
        }
      }
    } else {
      emailSkipped = true;
      emailError = "no recipient email";
    }

    await patchJob(env, jobId, {
      status: "completed",
      result_score_ids: imported.map((i) => i.score_id),
      error_message: null,
      metadata: {
        ...(job.metadata ?? {}),
        imported_count: imported.length,
        skipped_count: skipped.length,
        skipped,
        email_recipient: recipient ?? null,
        email_skipped: emailSkipped,
        email_error: emailError,
        finished_at: new Date().toISOString(),
      },
    });
    console.log(`job ${jobId} completed: ${imported.length} imported, ${skipped.length} skipped`);
    return { imported: imported.length, skipped: skipped.length, status: "completed" };
  } catch (e: any) {
    const fatalErr = truncate(String(e?.message ?? e), 800);
    console.error(`job ${jobId} fatal`, fatalErr);
    await patchJob(env, jobId, {
      status: "failed",
      error_message: fatalErr,
      metadata: { ...(job.metadata ?? {}), failed_at: new Date().toISOString() },
    });
    try {
      const recipient = (env.TEST_EMAIL_TO?.trim() || (await fetchUserEmail(env, job.user_id))) ?? null;
      if (recipient) {
        await env.EMAIL.send({
          to: recipient,
          from: { email: env.EMAIL_FROM_ADDR, name: env.EMAIL_FROM_NAME },
          subject: "We couldn't process your scorecard upload",
          text: "We hit an error while processing your scorecard upload. Our team will look into it. You don't need to do anything — feel free to try again later.",
          html: "<p>We hit an error while processing your scorecard upload. Our team will look into it.</p><p>You don't need to do anything — feel free to try again later.</p>",
        });
      }
    } catch {}
    throw e;
  }
}

// ----- supabase REST helpers --------------------------------------------------

function srHeaders(env: Env, extra: Record<string, string> = {}): HeadersInit {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    Accept: "application/json",
    ...extra,
  };
}

async function fetchJob(env: Env, id: string): Promise<any | null> {
  const r = await fetch(
    `${env.SUPABASE_URL}/rest/v1/score_import_jobs?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,
    { headers: srHeaders(env) }
  );
  if (!r.ok) {
    console.error("fetchJob non-ok", r.status, await r.text());
    return null;
  }
  const arr = (await r.json()) as any[];
  return arr[0] ?? null;
}

async function fetchScore(env: Env, id: string): Promise<any | null> {
  const fields = [
    "id",
    "user_id",
    "course_id",
    "course_name",
    "played_on",
    "metadata",
  ].join(",");
  const r = await fetch(
    `${env.SUPABASE_URL}/rest/v1/scores?id=eq.${encodeURIComponent(id)}&select=${fields}&limit=1`,
    { headers: srHeaders(env) },
  );
  if (!r.ok) throw new Error(`fetchScore failed ${r.status}: ${truncate(await r.text(), 400)}`);
  const rows = (await r.json()) as any[];
  return rows[0] ?? null;
}

async function authenticatedUserId(env: Env, request: Request): Promise<string | null> {
  const authorization = request.headers.get("authorization") ?? "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) return null;
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: authorization,
      Accept: "application/json",
    },
  });
  if (!r.ok) return null;
  const user = (await r.json()) as any;
  return typeof user?.id === "string" && user.id ? user.id : null;
}

async function fetchCourseHoles(env: Env, courseId: string): Promise<unknown[]> {
  if (!courseId) return [];
  const r = await fetch(
    `${env.SUPABASE_URL}/rest/v1/courses?id=eq.${encodeURIComponent(courseId)}&select=holes&limit=1`,
    { headers: srHeaders(env) },
  );
  if (!r.ok) throw new Error(`fetchCourseHoles failed ${r.status}: ${truncate(await r.text(), 400)}`);
  const rows = (await r.json()) as any[];
  return Array.isArray(rows[0]?.holes) ? rows[0].holes : [];
}

async function patchScoreMetadata(env: Env, id: string, metadata: Record<string, any>): Promise<void> {
  const r = await fetch(
    `${env.SUPABASE_URL}/rest/v1/scores?id=eq.${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: srHeaders(env, { "Content-Type": "application/json", Prefer: "return=minimal" }),
      body: JSON.stringify({ metadata }),
    },
  );
  if (!r.ok) throw new Error(`patchScoreMetadata failed ${r.status}: ${truncate(await r.text(), 400)}`);
}

async function patchJob(env: Env, id: string, patch: Record<string, any>): Promise<void> {
  const r = await fetch(
    `${env.SUPABASE_URL}/rest/v1/score_import_jobs?id=eq.${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: srHeaders(env, { "Content-Type": "application/json", Prefer: "return=minimal" }),
      body: JSON.stringify(patch),
    }
  );
  if (!r.ok) {
    console.error("patchJob non-ok", r.status, await r.text());
  }
}

async function downloadAsDataUrl(env: Env, path: string): Promise<string> {
  const url = `${env.SUPABASE_URL}/storage/v1/object/score-imports/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  const r = await fetch(url, { headers: srHeaders(env) });
  if (!r.ok) {
    throw new Error(`storage download failed ${r.status}: ${await r.text()}`);
  }
  const ct = r.headers.get("content-type") ?? "image/jpeg";
  const buf = new Uint8Array(await r.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + 0x8000)) as any);
  }
  return `data:${ct};base64,${btoa(bin)}`;
}

async function fuzzyMatchCourse(
  env: Env,
  rawName: string | null
): Promise<MatchedCourse | null> {
  if (!rawName) return null;
  // Strip trailing nine-combo suffix like " - Lake / Forest" or " (Lake/Forest)"
  // so the matcher works against the base club name.
  let base = rawName
    .replace(/\s*[\-\u2013\u2014\(\[][^\-\u2013\u2014\(\)\[\]]*[\/&][^\-\u2013\u2014\(\)\[\]]*[\)\]]?\s*$/u, "")
    .trim();
  if (!base) base = rawName;
  const cleaned = base.replace(/[%,()'"]/g, " ").trim();
  if (!cleaned) return null;
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;

  const STOP = new Set([
    "club", "golf", "country", "resort", "the", "and", "of", "at",
    "course", "links", "national", "sdn", "bhd",
  ]);
  const significant = words.filter((w) => w.length >= 3 && !STOP.has(w.toLowerCase()));

  // Acronym from significant initials, e.g. "Kelab Golf Perkhidmatan Awam" -> "KPA"
  // (and full "KGPA" from all initials). Try both.
  const acronymFull = words
    .filter((w) => /^[A-Za-z]/.test(w))
    .map((w) => w[0]!.toUpperCase())
    .join("");
  const acronymSig = significant
    .map((w) => w[0]!.toUpperCase())
    .join("");
  const acronyms = [acronymFull, acronymSig].filter((a) => a.length >= 3);

  // Build candidate pool: acronym exact + ilike probes.
  const seen = new Map<string, any>();
  const addAll = (arr: any[]) => {
    for (const c of arr) if (c?.id && !seen.has(c.id)) seen.set(c.id, c);
  };

  // 1) Acronym exact-match on name.
  for (const acr of acronyms) {
    const url = `${env.SUPABASE_URL}/rest/v1/courses?name=eq.${encodeURIComponent(
      acr
    )}&select=id,name,nines,tee_box_names,nine_combo_ratings,holes&limit=5`;
    const r = await fetch(url, { headers: srHeaders(env) });
    if (r.ok) addAll((await r.json()) as any[]);
  }

  // 2) Probe by significant word pairs / single significant word.
  const probes: string[] = [];
  if (significant.length >= 2) probes.push(significant.slice(0, 2).join(" "));
  if (significant.length >= 1) probes.push(significant[0]!);
  for (const p of probes) {
    const ilike = `%${p}%`;
    const url = `${env.SUPABASE_URL}/rest/v1/courses?or=(name.ilike.${encodeURIComponent(
      ilike
    )},location_name.ilike.${encodeURIComponent(ilike)})&select=id,name,nines,tee_box_names,nine_combo_ratings,holes&limit=20`;
    const r = await fetch(url, { headers: srHeaders(env) });
    if (r.ok) addAll((await r.json()) as any[]);
  }

  if (seen.size === 0) return null;

  const wantTokensAll = new Set(cleaned.toLowerCase().split(/\s+/).filter(Boolean));
  const wantTokensSig = new Set(significant.map((w) => w.toLowerCase()));
  const acronymsLower = new Set(acronyms.map((a) => a.toLowerCase()));

  let best: { c: any; score: number; tier: number } | null = null;
  for (const c of seen.values()) {
    const haveName = String(c.name ?? "").toLowerCase();
    const haveTokens = new Set(haveName.split(/\s+/).filter(Boolean));
    let overlapSig = 0;
    for (const t of wantTokensSig) if (haveTokens.has(t)) overlapSig++;
    let overlapAll = 0;
    for (const t of wantTokensAll) if (haveTokens.has(t)) overlapAll++;
    // Tier 0: exact acronym match (e.g. KGPA == KGPA)
    // Tier 1: >=1 significant non-stopword overlap
    // Tier 2: stopword-only overlap (Kelab/Golf) — REJECT
    let tier = 2;
    if (acronymsLower.has(haveName)) tier = 0;
    else if (overlapSig >= 1) tier = 1;
    const score = overlapSig * 10 + overlapAll;
    if (
      tier < 2 &&
      (!best || tier < best.tier || (tier === best.tier && score > best.score))
    ) {
      best = { c, score, tier };
    }
  }
  if (!best) {
    console.warn(
      `fuzzyMatchCourse: no significant overlap for "${rawName}" (base="${base}", acronyms=${acronyms.join(
        ","
      )}); rejecting ${seen.size} weak candidate(s)`
    );
    return null;
  }
  const nines = Array.isArray(best.c.nines) ? best.c.nines : [];
  const firstNineId = nines[0]?.id ?? nines[0]?.nine_id ?? "";
  return {
    id: String(best.c.id),
    name: String(best.c.name ?? ""),
    front_nine_id: String(firstNineId),
    nines,
    teeBoxes: Array.isArray(best.c.tee_box_names) ? best.c.tee_box_names : [],
    nineComboRatings: Array.isArray(best.c.nine_combo_ratings) ? best.c.nine_combo_ratings : [],
    holes: Array.isArray(best.c.holes) ? best.c.holes : [],
  };
}

function buildRoundSnapshot(round: Round, matched: MatchedCourse | null): {
  slope_rating: number | null;
  course_rating: number | null;
  round_par: number | null;
  playing_conditions_adjustment: number;
} {
  const stats = round.round_stats ?? ({} as RoundStats);
  const fallback = inferMetricsFromCourse(round, matched);
  return {
    slope_rating: positiveInt(stats.slope_rating) ?? fallback.slope_rating,
    course_rating: positiveNumber(stats.course_rating) ?? fallback.course_rating,
    round_par: inferRoundPar(round, matched),
    playing_conditions_adjustment: finiteNumber(stats.playing_conditions_adjustment) ?? 0,
  };
}

function inferRoundPar(round: Round, matched: MatchedCourse | null): number | null {
  const holePars = round.holes
    .map((h) => positiveInt(h.par))
    .filter((par): par is number => par != null);
  if (holePars.length > 0 && holePars.length === round.holes.length) {
    return holePars.reduce((sum, par) => sum + par, 0);
  }
  if (round.total_score != null && round.to_par != null) {
    return round.total_score - round.to_par;
  }
  const matchedPar = inferRoundParFromCourse(round, matched);
  return matchedPar;
}

function inferRoundParFromCourse(round: Round, matched: MatchedCourse | null): number | null {
  if (!matched?.nines?.length) return null;
  const neededHoles = Math.max(round.holes.length || 0, round.total_score != null && round.to_par != null ? 18 : 0);
  const nines = matched.nines;
  const selected = neededHoles <= 9 ? nines.slice(0, 1) : nines.slice(0, 2);
  const pars = selected.flatMap((nine) => {
    const holeNumbers = Array.isArray(nine?.holeNumbers) ? nine.holeNumbers : [];
    const holes = Array.isArray(matched.holes) ? matched.holes : [];
    return holeNumbers
      .map((n: unknown) => holes.find((h: any) => Number(h?.holeNumber ?? h?.hole_number) === Number(n)))
      .map((h: any) => positiveInt(h?.par))
      .filter((p: number | null): p is number => p != null);
  });
  return pars.length > 0 ? pars.reduce((sum, par) => sum + par, 0) : null;
}

function inferMetricsFromCourse(round: Round, matched: MatchedCourse | null): {
  slope_rating: number | null;
  course_rating: number | null;
} {
  if (!matched) return { slope_rating: null, course_rating: null };
  const teeIndex = findTeeBoxIndex(matched, round.tee_box_name);
  if (teeIndex == null) return { slope_rating: null, course_rating: null };

  const holesPlayed = round.holes.length || (round.total_score != null ? 18 : 0);
  if (holesPlayed > 9) {
    const combo = findSafeNineCombo(matched);
    const metric = metricAt(combo?.teeMetrics, teeIndex);
    if (metric.slope_rating != null || metric.course_rating != null) return metric;
  }

  const nines = Array.isArray(matched.nines) ? matched.nines : [];
  if (holesPlayed <= 9 && nines.length >= 1) return metricAt(nines[0]?.teeMetrics, teeIndex);
  return { slope_rating: null, course_rating: null };
}

function findSafeNineCombo(matched: MatchedCourse): any | null {
  const combos = Array.isArray(matched.nineComboRatings) ? matched.nineComboRatings : [];
  const nines = Array.isArray(matched.nines) ? matched.nines : [];
  if (nines.length < 2) return null;
  const expected = new Set(nines.slice(0, 2).map((n) => String(n?.id)).filter(Boolean));
  return (
    combos.find((combo) => {
      const ids = Array.isArray(combo?.nineIds) ? combo.nineIds.map(String) : [];
      return ids.length === expected.size && ids.every((id: string) => expected.has(id));
    }) ?? null
  );
}

function findTeeBoxIndex(matched: MatchedCourse, teeName: string | null): number | null {
  if (!teeName) return null;
  const want = normalizeName(teeName);
  const tees = Array.isArray(matched.teeBoxes) ? matched.teeBoxes : [];
  const idx = tees.findIndex((t) => normalizeName(String(t?.name ?? "")) === want);
  return idx >= 0 ? idx : null;
}

function metricAt(metrics: unknown, index: number): { slope_rating: number | null; course_rating: number | null } {
  if (!Array.isArray(metrics)) return { slope_rating: null, course_rating: null };
  const m = metrics[index] as TeeMetric | undefined;
  return {
    slope_rating: positiveInt(m?.slope),
    course_rating: positiveNumber(m?.courseRating ?? m?.course_rating),
  };
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

function finiteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function positiveNumber(value: unknown): number | null {
  const n = finiteNumber(value);
  return n != null && n > 0 ? n : null;
}

function positiveInt(value: unknown): number | null {
  const n = finiteNumber(value);
  return n != null && n > 0 ? Math.round(n) : null;
}

async function insertScore(env: Env, row: Record<string, any>): Promise<string> {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/scores`, {
    method: "POST",
    headers: srHeaders(env, {
      "Content-Type": "application/json",
      Prefer: "return=representation",
    }),
    body: JSON.stringify(row),
  });
  if (!r.ok) {
    throw new Error(`insertScore failed ${r.status}: ${await r.text()}`);
  }
  const arr = (await r.json()) as any[];
  return String(arr[0]?.id ?? "");
}

async function findDuplicateScore(
  env: Env,
  q: { user_id: string; played_on: string; total_score: number; course_id: string; course_name: string }
): Promise<string | null> {
  // Match on user + played_on + total_score; AND either matching course_id
  // (when we resolved one) or matching course_name (when unmatched).
  const params = [
    `user_id=eq.${encodeURIComponent(q.user_id)}`,
    `played_on=eq.${encodeURIComponent(q.played_on)}`,
    `total_score=eq.${q.total_score}`,
    `select=id`,
    `limit=1`,
  ];
  if (q.course_id) {
    params.push(`course_id=eq.${encodeURIComponent(q.course_id)}`);
  } else if (q.course_name) {
    params.push(`course_name=eq.${encodeURIComponent(q.course_name)}`);
  } else {
    // No course context at all — be conservative; treat as duplicate only if
    // user/day/score collide.
  }
  const url = `${env.SUPABASE_URL}/rest/v1/scores?${params.join("&")}`;
  const r = await fetch(url, { headers: srHeaders(env) });
  if (!r.ok) {
    console.warn("dedupe lookup non-ok", r.status, await r.text());
    return null;
  }
  const arr = (await r.json()) as any[];
  return arr[0]?.id ?? null;
}

async function fetchUserEmail(env: Env, userId: string): Promise<string | null> {
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    headers: srHeaders(env),
  });
  if (!r.ok) {
    console.warn("fetchUserEmail non-ok", r.status, await r.text());
    return null;
  }
  const u = (await r.json()) as any;
  return u?.email ?? null;
}

// ----- OpenAI vision ----------------------------------------------------------

async function generateTeamRoundSummary(
  env: Env,
  model: string,
  factPacket: TeamRoundFactPacket,
): Promise<unknown> {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      response_format: {
        type: "json_schema",
        json_schema: { name: "team_round_summary", strict: true, schema: TEAM_SUMMARY_SCHEMA },
      },
      messages: [
        { role: "system", content: TEAM_ROUND_SUMMARY_PROMPT },
        {
          role: "user",
          content: `Write the recap from this verified fact packet:\n${JSON.stringify(factPacket)}`,
        },
      ],
    }),
  });
  if (!r.ok) throw new Error(`round summary OpenAI non-ok ${r.status}: ${truncate(await r.text(), 400)}`);
  const response = (await r.json()) as any;
  const content = response?.choices?.[0]?.message?.content;
  if (!content) throw new Error("round summary OpenAI returned empty content");
  const parsed = JSON.parse(content) as { sentences?: unknown };
  return parsed.sentences;
}

async function extractFromOpenAI(env: Env, dataUrl: string): Promise<Extracted> {
  const tryModel = async (model: string) => {
    const body = {
      model,
      response_format: {
        type: "json_schema",
        json_schema: { name: "scorecard_extract", strict: true, schema: SCHEMA },
      },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract every round visible in this scorecard / golf-app screenshot.",
            },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    };
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
    return r;
  };

  let r = await tryModel(env.OPENAI_MODEL);
  if (!r.ok && (r.status === 400 || r.status === 404)) {
    const t = await r.text();
    console.warn(
      `openai ${env.OPENAI_MODEL} failed (${r.status}): ${truncate(t, 400)} — falling back to gpt-4o`
    );
    r = await tryModel("gpt-4o");
  }
  if (!r.ok) {
    throw new Error(`openai non-ok ${r.status}: ${truncate(await r.text(), 400)}`);
  }
  const j = (await r.json()) as any;
  const content = j?.choices?.[0]?.message?.content;
  if (!content) throw new Error("openai empty content");
  return JSON.parse(content) as Extracted;
}

// ----- email body -------------------------------------------------------------

const APP_LINK_URL = "https://app.autostrikegolf.com";
const SUPPORT_URL = "https://autostrikegolf.com/support.html";

function buildSummaryEmail(imported: Imported[], skipped: Skip[]): { html: string; text: string } {
  const fmtToPar = (n: number) => (n === 0 ? "E" : n > 0 ? `+${n}` : `${n}`);
  const importedRows = imported
    .map(
      (i) => `
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(i.course_name || "(unknown)")}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(i.played_on)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;"><b>${i.total_score}</b> (${fmtToPar(i.to_par)})</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;color:#888;font-size:12px;">${escapeHtml(i.confidence)}${
            i.matched_course_id ? "" : " · unmatched course"
          }</td>
        </tr>`
    )
    .join("");

  const skippedRows = skipped
    .map(
      (s) => `
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;font-family:monospace;font-size:12px;color:#666;">${escapeHtml(s.path.split("/").pop() || s.path)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(s.reason)}</td>
        </tr>`
    )
    .join("");

  const buttons = `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px auto 8px;"><tr>
      <td style="padding-right:10px;">
        <a href="${APP_LINK_URL}" style="display:inline-block;background:#0a7d2c;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px;font-size:14px;">Open in app</a>
      </td>
      <td>
        <a href="${SUPPORT_URL}" style="display:inline-block;background:#f4f4f4;color:#222;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px;border:1px solid #ddd;font-size:14px;">Get support</a>
      </td>
    </tr></table>`;

  const html = `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#222;max-width:640px;margin:0 auto;padding:20px;">
  <h2 style="margin:0 0 4px;">AutoStrike scorecard import</h2>
  <p style="color:#666;margin:0 0 24px;">${imported.length} round${imported.length === 1 ? "" : "s"} added · ${skipped.length} image${skipped.length === 1 ? "" : "s"} skipped</p>

  ${
    imported.length > 0
      ? `<h3 style="margin:24px 0 8px;">Rounds added</h3>
         <table style="border-collapse:collapse;width:100%;font-size:14px;">
           <thead><tr style="text-align:left;color:#666;">
             <th style="padding:6px 10px;border-bottom:2px solid #ddd;">Course</th>
             <th style="padding:6px 10px;border-bottom:2px solid #ddd;">Date</th>
             <th style="padding:6px 10px;border-bottom:2px solid #ddd;text-align:right;">Score</th>
             <th style="padding:6px 10px;border-bottom:2px solid #ddd;">Notes</th>
           </tr></thead>
           <tbody>${importedRows}</tbody>
         </table>
         <p style="color:#666;font-size:13px;margin:12px 0 0;">You can adjust or delete scores in the app.</p>`
      : `<p>We didn't find any scores we were confident enough to add.</p>`
  }

  ${
    skipped.length > 0
      ? `<h3 style="margin:24px 0 8px;">Images skipped</h3>
         <table style="border-collapse:collapse;width:100%;font-size:13px;">
           <tbody>${skippedRows}</tbody>
         </table>
         <p style="color:#888;font-size:12px;margin-top:8px;">If we missed something, you can add it manually in the AutoStrike app.</p>`
      : ""
  }

  ${buttons}

  <p style="color:#aaa;font-size:12px;margin-top:32px;text-align:center;">— AutoStrike (auto-generated, replies not monitored)</p>
</body></html>`;

  const text =
    `AutoStrike scorecard import\n` +
    `${imported.length} round(s) added, ${skipped.length} image(s) skipped\n\n` +
    (imported.length
      ? "Rounds added:\n" +
        imported
          .map(
            (i) =>
              `  - ${i.course_name || "(unknown)"} on ${i.played_on}: ${i.total_score} (${fmtToPar(i.to_par)}) [${i.confidence}${
                i.matched_course_id ? "" : ", unmatched course"
              }]`
          )
          .join("\n") +
        "\n"
      : "We didn't find any scores we were confident enough to add.\n") +
    (skipped.length
      ? "\nImages skipped:\n" + skipped.map((s) => `  - ${s.path.split("/").pop()}: ${s.reason}`).join("\n") + "\n"
      : "") +
    (imported.length ? `\nYou can adjust or delete scores in the app.\n` : "") +
    `\nOpen the app: ${APP_LINK_URL}\nGet support: ${SUPPORT_URL}\n` +
    "\n— AutoStrike";

  return { html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
