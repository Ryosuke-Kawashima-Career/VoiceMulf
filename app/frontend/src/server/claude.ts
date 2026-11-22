import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { getEnv } from "./env";

/**
 * Claude calls for the Voice AI Agent (backend spec 4.1): single requests with all
 * context included, typed JSON via structured outputs, server-side refusal fallback on.
 */
let client: Anthropic | null = null;

function getClient(): Anthropic {
  const apiKey = getEnv("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  client ??= new Anthropic({ apiKey, maxRetries: 1 });
  return client;
}

export function claudeModel(): string {
  return getEnv("CLAUDE_MODEL") || "claude-opus-5-5";
}

export const LANGUAGE_NAMES = { "hi-IN": "Hindi", "ta-IN": "Tamil", "en-IN": "English (India)" } as const;

export async function askJson<S extends z.ZodType>(opts: {
  system: string;
  user: string;
  schema: S;
  effort: "low" | "medium";
  maxTokens: number;
  timeoutMs: number;
}): Promise<z.infer<S>> {
  const res = await getClient().beta.messages.parse(
    {
      model: claudeModel(),
      max_tokens: opts.maxTokens,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
      output_config: { effort: opts.effort, format: betaZodOutputFormat(opts.schema) },
    },
    { timeout: opts.timeoutMs },
  );
  if (res.stop_reason === "refusal") throw new Error("Claude declined the request");
  if (res.parsed_output == null) throw new Error(`No parsed output (stop_reason: ${res.stop_reason})`);
  return res.parsed_output as z.infer<S>;
}
