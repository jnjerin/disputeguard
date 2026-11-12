/**
 * PURPOSE
 * A cheap, deterministic prompt-injection pre-scan for buyer-written text.
 *
 * It is a second opinion next to the model's own `injection.detected` flag, not a replacement:
 * regexes miss clever attacks, and models can be fooled, so the UI shows a warning if EITHER fires.
 * The real defence is structural: buyer text is wrapped as untrusted data, the agent has no
 * PayPal write tools at all, and every write needs a human click.
 */
const PATTERNS: [RegExp, string][] = [
  [/ignore (all |any |your |the )?(previous |prior |above )?(instructions|rules|prompts?)/i, "asks the AI to ignore its instructions"],
  [/(system|developer) (note|prompt|message|instruction)s?/i, "pretends to be a system message"],
  [/\b(ai|assistant|agent|model|llm|chatgpt|bot)\b.{0,40}\b(must|should|need to|have to)\b/i, "gives orders to the AI"],
  [/(issue|approve|grant|process) (a )?(full )?refund (immediately|now|automatically)/i, "demands an automatic refund"],
  [/you are now|act as|pretend to be|jailbreak/i, "tries to change the AI's role"],
  [/<\/?(untrusted|system|instructions?)>/i, "tries to break out of the untrusted-data wrapper"],
];

export type InjectionHit = { pattern: string; quote: string };

/** Returns every suspicious phrase found in the given texts. */
export function scanForInjection(texts: string[]): InjectionHit[] {
  const hits: InjectionHit[] = [];
  for (const text of texts) {
    for (const [re, label] of PATTERNS) {
      const m = text.match(re);
      if (m) {
        const start = Math.max(0, (m.index ?? 0) - 30);
        hits.push({ pattern: label, quote: text.slice(start, (m.index ?? 0) + m[0].length + 60).trim() });
      }
    }
  }
  return hits;
}

/** Neutralises attempts to close our wrapper tags inside untrusted text. */
export function escapeUntrusted(text: string): string {
  return text.replace(/<\/?\s*untrusted[^>]*>/gi, "[removed tag]");
}
