import type { FlowType, SectionSpec } from "../schemas";
import { rayconVoice, hardRulesGate } from "./voice";
import { buildSectionList, buildSectionExampleLines } from "./generate";
import { flowPlaybookBlock } from "../flow-playbooks";

// The FLOW "brain": a sibling to src/lib/prompts/generate.ts (the campaign brain)
// and src/lib/prompts/sms.ts (the SMS brain). It composes the SHARED brand voice
// (rayconVoice) and the SHARED hard-rules gate (hardRulesGate) — brand invariants
// never fork — but replaces the campaign broadcast strategy with FLOW strategy:
// triggered, evergreen, sequential, relationship-driven.
//
// Output shape is deliberately IDENTICAL to a campaign (JSONL: a meta line then
// one section line each, Subheader as a 3-option array), reusing buildSectionList
// + buildSectionExampleLines from the campaign brain. That is what lets the flow
// email render in the existing CampaignCanvas and stream through the same client
// parser with no special-casing.
//
// The per-flow-type playbook DATA (FLOW_PLAYBOOKS) and scaffolding live in the
// client-safe src/lib/flow-playbooks.ts (this module transitively imports `fs`
// via the voice, so it can't be bundled into the builder page).

// ---- The flow role instruction (system prompt) -----------------------------
export const flowRoleInstruction = `Your job in this step is to write ONE email inside an automated, TRIGGERED flow (Welcome, Abandoned Cart, Post-Purchase, and the like). A flow email is NOT a broadcast campaign — write it accordingly.

${rayconVoice()}

Flow psychology — how a flow email differs from a broadcast campaign:
- Triggered and evergreen. This email fires off the reader's OWN behavior (they just subscribed, left a cart, bought something, lapsed), not a calendar date. There is NO sitewide sale clock. Any urgency must be anchored to the reader's own action ("your cart is still saved", "it sold out last time"), never an invented deadline. Never write "ends tonight", "48 hours left", or a countdown unless the flow context explicitly supplies a real time window.
- A relationship arc. The email sits at a specific POSITION in a sequence. Earlier emails have already said certain things; this one must ADVANCE the relationship — pick up where the last left off, do a new job, and never simply restate an earlier email. You are given the jobs (and, where written, summaries) of the sibling emails; write this one so the sequence reads as a connected arc, not repeated sends.
- Trigger-state empathy. Write to the reader's actual state of mind for this flow: a brand-new subscriber is curious and cautious; a cart abandoner is hesitating over a specific product; a recent buyer wants reassurance, not another pitch; a lapsed customer needs a warm reason to look again with zero guilt. Match tone and content to that state.
- This email's highlights. When the writer specifies what THIS email should emphasize (its X/Y/Z), treat that as the spine of the email — lead with it and let the sections serve it.

Cohesion across sections. You are writing ONE email, not a stack of independent modules. Treat the sections as a single arc: each is aware of what the ones before it said and adds something new rather than restating it. Callbacks that advance the argument are cohesion; saying the same thing twice is repetition. When a section's focus note references another section, honor it literally.

Element craft (the output SHAPE the flow shares with campaigns — length caps live ONCE in the HARD RULES gate at the end; obey that table if anything here seems to imply a different number):
- Headline: the HOOK, within the Headline cap. Never a discount number, promo code, or urgency tag.
- Tagline (header sections): ONE line, the plain PAYOFF of the headline's hook. Headline and Tagline are a PAIR — one thought said out loud, not two competing hooks. In a flow, the tagline states the email's point (the welcome, the reassurance, the return-to-cart), which is usually NOT an offer.
- Subheader: a benefit FRAGMENT within the cap. This element is an array of EXACTLY 3 distinct options (one benefit-led, one product/feature-led, one occasion/emotion-led), each within the cap, ordered strongest-first. Never put offer mechanics in a subheader.
- Body copy: 2-4 short sentences in the voice, doing this email's specific job.
- One-liners: 5-12 words, benefit-led and plain. Never offer mechanics.
- Review (product_card_review only): a REAL customer review supplied to you below, used VERBATIM (trim length only). Keep any "— Name" attribution exactly. If none was supplied, leave the Review element empty. Never fabricate a review.
- CTAs: 2-4 word action phrases (4 words MAX). Flow CTAs are usually about the NEXT step, not a discount ("Finish Checkout", "Take Another Look", "Get Started"). Never put a promo code or a product name in a CTA.
- Closing line: one plain sentence, max 12 words.

Subject lines and preview texts. Produce THREE of each, distinct in rhythm and opening word, each within the caps (subject under 50 characters, preview under 90). Write them for a triggered email — they should read as a natural, personal follow-up to the reader's action, never as a promo blast. A preview text complements its subject line, it never just repeats it.

References. Any reference emails are for register and rhythm only — the lowest authority. They never override the hard rules or the flow context.

Number and unit formatting. Always numerals and symbols, never words ("56 hours", "30%", "$79.99", "Bluetooth 5.3", "IPX7").

Final pass. Every Subheader element is a JSON array of 3 genuinely distinct options, strongest first. Everything else (length caps, banned words and structures, offer integrity, catalogue accuracy) is governed by the HARD RULES: FINAL GATE at the very end of this prompt. Run that gate against your draft and fix anything that fails before returning.`;

/** Everything the flow brain needs about the ONE email being written and its
 * place in the sequence. Assembled by the /api/flows/generate route. */
export interface FlowEmailContext {
  flowType: FlowType;
  flowName: string;
  channel: "email" | "sms";
  /** What fires the flow — the reader's state when this email lands. */
  trigger?: string;
  goal?: string;
  position: number;
  totalEmails: number;
  job: string;
  delay?: string;
  highlights?: string;
  /**
   * The reader's journey to THIS email, branch conditions included — built by
   * pathContext() in lib/flow-graph.ts (spec §5). On a branched flow this is the
   * difference between writing to someone who read the last email and writing to
   * someone who demonstrably did not, which the brain previously had no way to
   * know. Absent for a flow with no graph yet.
   */
  pathContext?: string;
  /**
   * The emails BEFORE this one, for arc cohesion. On a branched flow these come
   * from this email's own path — feeding it the other branch's emails would tell
   * the writer the reader received messages they never did.
   */
  siblings: { position: number; job: string; summary?: string }[];
}

export function flowUserPrompt(
  ctx: FlowEmailContext,
  sectionStructure: SectionSpec[],
  avoidBlock = "",
  /** Real reviews per product SKU (best-first), used VERBATIM for product_card_review. */
  reviewsBySlug: Record<string, string[]> = {},
  /** The recursive-learning blocks (docs/RECURSIVE_LEARNING_FRAMEWORK_SPEC.md
   * §2.6). A flow email is evergreen, so it is REPELLED from broadcast copy in
   * flight (a welcome email echoing Thursday's promo headline is the same defect)
   * and shares the account-level performance context. Flow-level attribution is
   * explicitly out of scope (§5): nothing here claims to know what a flow MESSAGE
   * earned, only what the account's angles and structures have earned. */
  learning: { formBudget?: string; inFlight?: string; performance?: string } = {},
  /** Real reviews resolved PER STANDALONE `reviews` SECTION, keyed by section id
   * (docs/REVIEWS_MODULE_SPEC.md §5.2). Without this a flow's reviews section is
   * told "leave every slot empty" — safe, but it means a flow can never carry a
   * real review, which is the wrong half of the fix to have. */
  reviewsBySection: Record<string, string[]> = {}
): string {
  const sectionList = buildSectionList(sectionStructure, reviewsBySlug, { reviewsBySection });
  const exampleLines = buildSectionExampleLines(sectionStructure);

  const siblingBlock = ctx.siblings.length
    ? `Emails this reader has ALREADY RECEIVED on the way to this one (for arc cohesion — do NOT restate these; advance from them):\n${ctx.siblings
        .map((s) => `- Email ${s.position} , job: ${s.job}${s.summary ? `\n    what it says: ${s.summary}` : " (not written yet)"}`)
        .join("\n")}`
    : "This reader has not received any earlier email on this path — this is the first thing they get.";

  // The path block replaces "position N of M" as the primary orientation on a
  // branched flow: which branch this email sits on, and what the reader did (or
  // didn't do) to get here, is the thing that changes how it must be written.
  const pathBlock = ctx.pathContext?.trim()
    ? `\nTHE READER'S PATH TO THIS EMAIL (follow it literally — it says what they have and have not done):\n${ctx.pathContext.trim()}\nWrite to that state. If the path says they did NOT open or click something, never write as though they did.\n`
    : "";

  const highlightBlock = ctx.highlights?.trim()
    ? `\nWHAT THIS EMAIL MUST EMPHASIZE (the writer's instruction for THIS email — treat it as the spine, lead with it):\n${ctx.highlights.trim()}\n`
    : "";

  return `You are writing EMAIL ${ctx.position} of ${ctx.totalEmails} in the "${ctx.flowName}" flow (type: ${ctx.flowType}).

${flowPlaybookBlock(ctx.flowType)}
${ctx.trigger ? `\nThis flow fires when: ${ctx.trigger}. Write to the reader's state of mind at that moment.\n` : ""}${ctx.goal ? `\nFlow goal (the author's, follow it): ${ctx.goal}\n` : ""}
THIS EMAIL:
- Position: ${ctx.position} of ${ctx.totalEmails}${ctx.delay ? ` (fires ${ctx.delay})` : ""}
- Its job in the sequence: ${ctx.job}
${pathBlock}${highlightBlock}
${siblingBlock}
${avoidBlock ? `\n${avoidBlock}\n` : ""}${learning.formBudget ? `\n${learning.formBudget}\n` : ""}${learning.inFlight ? `\n${learning.inFlight}\n` : ""}${learning.performance ? `\n${learning.performance}\n` : ""}
Section structure to produce (in order):
${sectionList}

${hardRulesGate()}

Produce the full email copy. Return JSONL, one complete JSON object per line, nothing else.

Line 1 must be the meta block:
{"meta":{"subject_lines":["...","...","..."],"preview_texts":["...","...","..."]}}

Lines 2+ are sections in order, one per line:
${exampleLines}

Critical output rules: the very first character you output must be "{". No preamble, no commentary, no markdown fences, no trailing text. Each line must be valid, self-contained JSON. Element keys must match the section catalogue exactly. The "Subheader" element, wherever it appears, must be a JSON array of EXACTLY 3 distinct option strings , never a single string. The "Headline" element, wherever it appears, must be a JSON array of EXACTLY 4 objects , one per headline pattern , in this shape: {"pattern":"idiom_remix","text":"the headline","tagline":"the tagline that pays it off"}, with pattern one of idiom_remix, product_truth, rhyme, bold_claim. When a section has both a Headline and a Tagline, do NOT emit a separate "Tagline" key: the taglines live inside the headline candidates. All other elements are single strings.

COMPLETENESS REQUIREMENT. The section structure above lists ${sectionStructure.length} section${sectionStructure.length === 1 ? "" : "s"}. Your output must contain exactly ${sectionStructure.length + 1} JSON lines: the meta block, then one line per section, in order, every section included. Do not stop early. Before you finish, count your output lines and confirm there are ${sectionStructure.length + 1}.`;
}
