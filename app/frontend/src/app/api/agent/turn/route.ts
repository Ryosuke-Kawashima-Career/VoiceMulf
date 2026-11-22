import { z } from "zod";
import { askJson, LANGUAGE_NAMES } from "@/server/claude";

/** POST /api/agent/turn: trip questions (backend spec 4.2). */

const TripSchema = z
  .object({
    destination: z.string(),
    remaining_m: z.number(),
    remaining_s: z.number(),
    arrival_time: z.string(),
    next_maneuver: z.object({ text: z.string(), distance_m: z.number() }).nullable(),
    region: z.string().nullable(),
    next_landmark: z.object({ name: z.string(), distance_m: z.number() }).nullable(),
  })
  .nullable();

const RequestSchema = z.object({
  language: z.enum(["hi-IN", "ta-IN", "en-IN"]),
  utterance: z.string().min(1).max(500),
  trip: TripSchema,
});

const ReplySchema = z.object({
  intent: z.enum(["trip_question", "start_quiz", "other"]),
  reply: z.string(),
});

const SYSTEM = `You are the voice co-driver in a car navigation and quiz app. The driver speaks to you while driving; your reply is read aloud by a text-to-speech voice.

Classify the driver's utterance and reply:
- "trip_question": about the trip (distance or time left, arrival time, next turn, where we are, next landmark). Answer only from the trip data given. Never invent traffic, places, road names or times that are not in the data. If the data does not have the answer, say so briefly.
- "start_quiz": the driver wants a quiz question or to play. Reply with a short, cheerful confirmation; the app asks the question next.
- "other": anything else. Say briefly and kindly that you can help with the trip and quizzes.

Reply rules:
- At most 2 short sentences, written natively in the requested language and its usual script.
- Spoken style: round numbers (e.g. "about 48 kilometres", "about 40 minutes"), say distances under 1 km in metres.
- Never ask the driver to look at, read or touch the screen.
- If the trip data is null, there is no route (quiz-only mode).`;

export async function POST(req: Request) {
  const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response("Invalid request", { status: 400 });
  const { language, utterance, trip } = parsed.data;
  const started = Date.now();
  try {
    const out = await askJson({
      system: SYSTEM,
      user: JSON.stringify({ language: LANGUAGE_NAMES[language], utterance, trip }),
      schema: ReplySchema,
      effort: "low",
      maxTokens: 2000,
      timeoutMs: 10000,
    });
    return Response.json({ ...out, ms: Date.now() - started });
  } catch (e) {
    return new Response(`Agent failed: ${String(e)}`, { status: 502 });
  }
}
