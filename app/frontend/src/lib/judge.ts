/** Answer judging, spec section 6.3. */

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function chars(s: string): string[] {
  return Array.from(s);
}

export function levenshtein(a: string, b: string): number {
  const x = chars(a);
  const y = chars(b);
  if (!x.length) return y.length;
  if (!y.length) return x.length;
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length];
}

function tolerance(answer: string): number {
  const n = chars(answer.replace(/ /g, "")).length;
  if (n <= 3) return 0;
  if (n <= 6) return 1;
  return 2;
}

export interface JudgeResult {
  correct: boolean;
  matched?: string;
  how?: "exact" | "partial" | "fuzzy";
  normalized: string;
}

export function judge(transcript: string, answers: string[]): JudgeResult {
  const said = normalize(transcript);
  const saidTokens = said.split(" ").filter(Boolean);
  const saidNoSpace = said.replace(/ /g, "");

  for (const raw of answers) {
    const ans = normalize(raw);
    if (!ans) continue;
    if (said === ans || saidNoSpace === ans.replace(/ /g, "")) {
      return { correct: true, matched: raw, how: "exact", normalized: said };
    }
    if (` ${said} `.includes(` ${ans} `)) {
      return { correct: true, matched: raw, how: "partial", normalized: said };
    }
    const tol = tolerance(ans);
    if (tol === 0) continue;
    if (levenshtein(said, ans) <= tol) {
      return { correct: true, matched: raw, how: "fuzzy", normalized: said };
    }
    // Compare against each window of the same word count in a longer sentence.
    const k = ans.split(" ").length;
    for (let i = 0; i + k <= saidTokens.length; i++) {
      const win = saidTokens.slice(i, i + k).join(" ");
      if (levenshtein(win, ans) <= tol) {
        return { correct: true, matched: raw, how: "fuzzy", normalized: said };
      }
    }
  }
  return { correct: false, normalized: said };
}
