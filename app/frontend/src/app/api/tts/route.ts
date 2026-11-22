import { getMurfKey } from "@/server/env";
import { VOICES, type Lang } from "@/lib/types";

const MURF_URL = "https://global.api.murf.ai/v1/speech/stream";

export async function POST(req: Request) {
  const { text, language, voice } = (await req.json()) as { text?: string; language?: Lang; voice?: string };
  if (!text || !language || !(language in VOICES)) {
    return new Response("text and a supported language are required", { status: 400 });
  }
  const key = getMurfKey();
  if (!key) return new Response("MURF_API_KEY is not set", { status: 503 });

  const upstream = await fetch(MURF_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": key },
    body: JSON.stringify({
      text,
      voiceId: voice ?? VOICES[language],
      model: "falcon-2.1",
      locale: language,
      format: "MP3",
      sampleRate: 24000,
      channelType: "MONO",
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return new Response(`Murf error ${upstream.status}: ${detail.slice(0, 300)}`, { status: 502 });
  }

  // Stream the audio straight through to the browser.
  return new Response(upstream.body, {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
  });
}
