import { readFile } from "node:fs/promises";
import path from "node:path";
import { PROJECT_ROOT } from "@/server/env";
import type { Question } from "@/lib/types";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const language = url.searchParams.get("language");
  const type = url.searchParams.get("type");

  const raw = await readFile(path.join(PROJECT_ROOT, "app", "data", "questions.json"), "utf8");
  let questions = JSON.parse(raw) as Question[];
  if (language) questions = questions.filter((q) => q.language === language);
  if (type) questions = questions.filter((q) => q.type === type);
  return Response.json(questions);
}
