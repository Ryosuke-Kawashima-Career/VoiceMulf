import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Lang, Question } from "@/lib/types";
import { askJson, LANGUAGE_NAMES } from "@/server/claude";
import { PROJECT_ROOT } from "@/server/env";
import { findPlacesAlongRoute, type CuratedPlace, type FoundPlaces } from "@/server/places";

/**
 * POST /api/agent/quiz: quizzes from the route (backend spec 3.2 + 4.3).
 * Finds towns and cities along the route, then writes questions for them plus fresh trivia.
 * Generated questions are saved for human review and reused on later trips.
 */

const RequestSchema = z.object({
  language: z.enum(["hi-IN", "ta-IN", "en-IN"]),
  path: z.array(z.tuple([z.number(), z.number()])).max(20000).nullable(),
  trivia_count: z.number().int().min(0).max(10).default(5),
});

const GeneratedSchema = z.object({
  questions: z.array(
    z.object({
      place_id: z.string().nullable(),
      type: z.enum(["landmark", "region", "trivia"]),
      prompt: z.string(),
      clues: z.array(z.string()),
      answers: z.array(z.string()),
      fun_fact: z.string(),
      welcome: z.string().nullable(),
      greeting: z.string().nullable(),
    }),
  ),
});

const SYSTEM = `You write questions for a voice quiz that a driver and passengers play during a road trip in India. A text-to-speech voice reads every question aloud and the answer is spoken back, so everything must work by ear.

You get the language, a list of places the car passes (towns become "landmark" questions, cities become "region" questions) and how many general trivia questions to add.

For every question:
- Write natively in the requested language and its usual script. Do not translate word by word from English.
- Use only well-known, widely agreed facts. If you are not sure about a place, leave that place out entirely. Fewer good questions are better than a doubtful one.
- No disputed borders, politics, religion-based comparisons or other sensitive topics.
- Never ask the listener to look at, spot or read anything. Say "we are near", never "on your left".
- The answer is one or two words.
- "answers": the main answer first, then accepted variants: the answer in the language's script, in Latin letters, and common spellings.
- "fun_fact": one short sentence.

Landmark (place_id = the town's id): "prompt" is the hardest clue and must not name the town; "clues" has up to 2 easier clues, easiest last. The answer can be the town itself or something it is famous for. "welcome" and "greeting" are null.
Region (place_id = the city's id): one easy question about the city in "prompt"; "clues" is empty. "welcome" is one short welcome line naming the city. "greeting" is the usual greeting of the local language (for example "Namaskara!" in Karnataka), written in the requested language's script.
Trivia (place_id null): short questions about cricket, cinema, food or Indian geography, varied topics. "clues" is empty, "welcome" and "greeting" are null.`;

const REVIEW_FILE = path.join(PROJECT_ROOT, "app", "data", "generated-questions.json");
const PLACES_FILE = path.join(PROJECT_ROOT, "app", "data", "places.json");

interface ReviewEntry {
  place_id: string | null;
  place_name: string | null;
  language: Lang;
  created_at: string;
  model_output: z.infer<typeof GeneratedSchema>["questions"][number];
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function toQuestion(g: ReviewEntry["model_output"], language: Lang, id: string): Question {
  return {
    id,
    type: g.type,
    language,
    prompt: g.prompt,
    clues: g.clues.slice(0, 2),
    answers: g.answers,
    fun_fact: g.fun_fact,
    source: "generated",
  };
}

export async function POST(req: Request) {
  const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response("Invalid request", { status: 400 });
  const { language, path: routePath, trivia_count } = parsed.data;
  const started = Date.now();

  // 1. Places along the route (curated places.json items win).
  let found: FoundPlaces = { landmarks: [], regions: [], source: "none", error: null };
  if (routePath && routePath.length > 1) {
    type P = { lat: number; lon: number; name: Record<string, string> };
    const curatedFile = await readJson<{ landmarks: P[]; regions: P[] }>(PLACES_FILE, { landmarks: [], regions: [] });
    const curated: CuratedPlace[] = [...curatedFile.landmarks, ...curatedFile.regions].map((p) => ({
      lat: p.lat,
      lon: p.lon,
      name: p.name["en-IN"],
    }));
    try {
      found = await findPlacesAlongRoute(routePath, curated);
    } catch (e) {
      found.error = String(e);
    }
  }

  // 2. Reuse questions generated on earlier trips; generate only what is missing.
  const review = await readJson<ReviewEntry[]>(REVIEW_FILE, []);
  const places = [
    ...found.landmarks.map((l) => ({ id: l.question_id, name: l.name["en-IN"], kind: "landmark" as const })),
    ...found.regions.map((g) => ({ id: g.question_id, name: g.name["en-IN"], kind: "region" as const })),
  ];
  const reused = new Map<string, ReviewEntry>();
  const onRoute = new Set(places.map((p) => p.id));
  for (const e of review) if (e.place_id && e.language === language && onRoute.has(e.place_id)) reused.set(e.place_id, e);
  const missing = places.filter((p) => !reused.has(p.id));

  let fresh: ReviewEntry[] = [];
  let agentError: string | null = null;
  if (missing.length || trivia_count) {
    try {
      const out = await askJson({
        system: SYSTEM,
        user: JSON.stringify({ language: LANGUAGE_NAMES[language], places: missing, trivia_count }),
        schema: GeneratedSchema,
        effort: "medium",
        maxTokens: 16000,
        timeoutMs: 120000,
      });
      const known = new Map(missing.map((p) => [p.id, p]));
      const now = new Date().toISOString();
      fresh = out.questions
        .filter((q) => (q.place_id ? known.has(q.place_id) && known.get(q.place_id)!.kind === q.type : q.type === "trivia"))
        .map((q) => ({ place_id: q.place_id, place_name: q.place_id ? known.get(q.place_id)!.name : null, language, created_at: now, model_output: q }));
      if (fresh.length) await writeFile(REVIEW_FILE, JSON.stringify([...review, ...fresh], null, 2) + "\n", "utf8");
    } catch (e) {
      agentError = String(e);
    }
  }

  // 3. Questions for the app, and the route places that have one.
  const byPlace = new Map<string, ReviewEntry>([...reused, ...fresh.filter((e) => e.place_id).map((e) => [e.place_id!, e] as const)]);
  const questions: Question[] = [];
  for (const [placeId, e] of byPlace) questions.push(toQuestion(e.model_output, language, placeId));
  fresh
    .filter((e) => !e.place_id)
    .forEach((e, i) => questions.push(toQuestion(e.model_output, language, `gen_trivia_${started}_${i}`)));

  const landmarks = found.landmarks.filter((l) => byPlace.has(l.question_id));
  const regions = found.regions
    .filter((g) => byPlace.has(g.question_id))
    .map((g) => {
      const out = byPlace.get(g.question_id)!.model_output;
      return {
        ...g,
        welcome: out.welcome ? { ...g.welcome, [language]: out.welcome } : g.welcome,
        greeting: out.greeting ? { ...g.greeting, [language]: out.greeting } : g.greeting,
      };
    });

  return Response.json({
    landmarks,
    regions,
    questions,
    stats: {
      places_found: places.length,
      reused: reused.size,
      generated: fresh.length,
      ms: Date.now() - started,
      places_source: found.source,
      places_error: found.error,
      agent_error: agentError,
    },
  });
}
