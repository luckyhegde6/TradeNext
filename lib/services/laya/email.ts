/**
 * Email cleaning + state shaping for Laya inbound-email triage (spec 18, P1
 * verbatim port of `laya/email.py`).
 *
 * Deviation (documented): Python defines an identical `email_questions` in both
 * email.py and presets.py; the canonical JS copy lives in `presets.ts`
 * (`emailQuestions`) to avoid drift — email.ts exports only the two functions
 * below.
 */

const QUOTE_HEADERS = [
  /^\s*On .{0,300}wrote:\s*$/i,
  /^\s*-{2,}\s*(Original|Forwarded) Message\s*-{2,}/i,
  /^\s*_{8,}\s*$/,
  /^\s*From:\s.+$/i,
];

const SIGNATURE_MARKERS = [
  /^\s*--\s*$/,
  /^\s*(best|kind|warm|many thanks|thanks|thank you|regards|cheers|sincerely)[\w ,!.]*$/i,
  /^\s*sent from my (iphone|android|mobile|ipad)/i,
];

const DISCLAIMER = /(confidential|intended (solely )?for the (use of the )?(named )?(addressee|recipient)|if you (have )?received this (e-?mail|message) in error)/i;

const SENTENCE = /(?<=[.!?])\s+/;

function stripDisclaimer(paragraph: string): string {
  if (!DISCLAIMER.test(paragraph)) return paragraph;
  const parts = paragraph
    .split(SENTENCE)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return parts.filter((p) => !DISCLAIMER.test(p)).join(" ");
}

/**
 * `clean_email_body(body, max_chars)`: drop quoted history, signatures and
 * boilerplate disclaimers so the model reads the sender's actual request.
 */
export function cleanEmailBody(body: string | null | undefined, maxChars = 3000): string {
  let text = (body ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\\n/g, "\n");
  const lines: string[] = [];
  for (const line of text.split("\n")) {
    if (QUOTE_HEADERS.some((p) => p.test(line)) && lines.length) break;
    if (line.trimStart().startsWith(">")) continue;
    lines.push(line.trimEnd());
  }
  let cut = lines.length;
  const scanStart = Math.max(1, Math.min(Math.floor(lines.length * 0.6), lines.length - 8));
  for (let i = scanStart; i < lines.length; i++) {
    if (lines[i].trim().length <= 40 && SIGNATURE_MARKERS.some((p) => p.test(lines[i]))) {
      cut = i;
      break;
    }
  }
  const kept = lines.slice(0, cut);
  const paragraphs = kept.join("\n").split(/\n\s*\n/).map(stripDisclaimer);
  text = paragraphs
    .filter((p) => p.trim().length > 0)
    .map((p) => p.trim())
    .join("\n\n")
    .replace(/[ \t]+/g, " ");
  return text.slice(0, maxChars);
}

/**
 * `email_state(subject, body, sender?, clean?, **extra)`: clean subject/body
 * state dict for the email-triage presets.
 */
export function emailState(
  subject: string | null | undefined,
  body: string | null | undefined,
  sender?: string | null,
  clean = true,
  extra?: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const state: Record<string, string | number | boolean> = {
    subject: (subject ?? "").trim(),
    body: clean ? cleanEmailBody(body) : (body ?? ""),
  };
  if (sender) state.from = sender;
  if (extra) {
    // Python keeps ANY non-None extra value; TS narrows to the declared
    // union since extras are string/number/boolean by contract.
    for (const [k, v] of Object.entries(extra)) {
      if (v !== null && v !== undefined && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")) {
        state[k] = v;
      }
    }
  }
  return state;
}