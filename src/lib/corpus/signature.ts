// Form signatures — repetition the way a reader experiences it.
// Spec: docs/RECURSIVE_LEARNING_FRAMEWORK_SPEC.md §2.3.
//
// The lexical checker in src/lib/constructions.ts catches "Summer Just Got
// Louder" vs "Fall Just Got Louder". It cannot catch "Motion Never Stops" vs
// "Sound Never Quits": near-zero shared characters, identical construction. A
// reader does not experience repetition lexically — they experience it as "these
// all sound the same". This module measures the second thing.
//
// PURE and DETERMINISTIC, in the spirit of hard-rules-check.ts: no LLM, no
// network, no fs. A rule-based shape extractor is enough for the 3-8 word lines
// this runs on, and it is inspectable and debuggable in a way an embedding is
// not (spec §5, Out of scope).
//
// On the tagger's accuracy: it is a small lexicon plus suffix rules, not a real
// POS tagger, and it will mislabel words. That matters far less than it looks,
// because BOTH sides of every comparison go through the same tagger: a
// consistent mislabel still produces matching signatures for matching
// constructions, which is the only thing the distance function reads. Accuracy
// would matter if a human read the tags as grammar; they don't.

/** The element kinds the corpus carries a signature for. */
export type ElementKind =
  | "headline" | "tagline" | "subject" | "preview" | "subheader"
  | "one_liner" | "opener" | "cta" | "closing"
  // The spec's kind list is email-shaped; an SMS message is a whole send in one
  // line and folding it into "opener" would corrupt that bucket, so it gets its
  // own kind. SMS is otherwise handled with no special case at all (§2.2).
  | "sms";

/** The four named headline patterns from data/copy-system.md, plus the escape
 * hatch for lines the classifier can't place (and for non-headline elements). */
export type HeadlinePattern = "idiom_remix" | "product_truth" | "rhyme" | "bold_claim" | "unclassified";

export const HEADLINE_PATTERNS: HeadlinePattern[] = ["idiom_remix", "product_truth", "rhyme", "bold_claim"];

export function isHeadlinePattern(v: unknown): v is HeadlinePattern {
  return typeof v === "string" && (HEADLINE_PATTERNS as string[]).includes(v);
}

export interface FormSignature {
  /** Named construction pattern. Declared by the writer when the slate carries a
   * label (§1.3); classified heuristically otherwise. */
  pattern: HeadlinePattern;
  /** Coarse grammatical shape, e.g. "NOUN + NEG + VERB". */
  template: string;
  word_count: number;
  /** First noun, naively singularised. "" when the line has none. */
  head_noun: string;
  /** First verb, naively lemmatised. "" when the line has none. */
  verb_lemma: string;
  /** Rhetorical devices in play — the highest-weighted field alongside `pattern`. */
  devices: string[];
  /** Tag of the opening token: the "opening move". */
  opening_pos: string;
}

// ---------------------------------------------------------------------------
// Lexicons. Deliberately small and hand-picked for retail audio copy.
// ---------------------------------------------------------------------------
const DET = new Set([
  "the", "a", "an", "this", "these", "those", "every", "all", "some", "any",
  "our", "your", "my", "its", "their", "his", "her", "both", "each", "no",
]);
const PRON = new Set([
  "you", "we", "they", "it", "i", "us", "them", "me", "he", "she", "yours", "ours",
  // Indefinites. Without these the -ing rule below tags "everything" as a verb.
  "everyone", "everybody", "everything", "something", "anything", "anyone",
  "someone", "somebody", "anybody", "these", "those", "this", "that", "all",
]);
const PREP = new Set([
  "for", "of", "in", "on", "at", "to", "with", "from", "by", "into", "over",
  "under", "past", "through", "like", "without", "as", "about", "off", "up",
  "down", "out", "before", "after", "until", "till", "than",
]);
const CONJ = new Set(["and", "or", "but", "so", "yet", "plus", "nor"]);
const REL = new Set(["that", "which", "who", "whose", "whom", "where", "when"]);
const NEG = new Set(["not", "never", "none", "nothing", "nobody", "neither"]);
const AUX = new Set([
  "is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did",
  "has", "have", "had", "will", "shall", "can", "could", "would", "should",
  "might", "must", "may", "let",
]);
const ADV = new Set([
  "just", "still", "always", "almost", "already", "only", "really", "very",
  "too", "now", "again", "ever", "here", "there", "hardly", "barely", "quite",
  "right", "soon", "back", "even", "yet", "instead", "finally", "meanwhile",
  "everywhere", "anywhere", "somehow",
]);
const ADJ = new Set([
  "good", "great", "best", "better", "big", "bigger", "biggest", "loud",
  "louder", "loudest", "open", "ready", "worth", "new", "free", "quiet",
  "quieter", "small", "smaller", "whole", "real", "full", "easy", "easier",
  "fresh", "next", "last", "first", "same", "own", "more", "most", "less",
  "least", "sweet", "smart", "smarter", "bold", "bolder", "warm", "warmer",
  "light", "lighter", "long", "longer", "short", "shorter", "serious", "sure",
  "clear", "close", "closer", "happy", "happier", "busy", "busier", "cheap",
  "cheaper", "strong", "stronger", "tough", "tougher", "wireless", "waterproof",
  "sweatproof", "comfortable", "favorite", "favourite", "popular", "everyday",
  "all-day", "no-budge", "pocket-sized", "gone", "almost-gone",
]);
const VERB = new Set([
  "got", "get", "gets", "getting", "stop", "stops", "stopped", "stopping",
  "quit", "quits", "keep", "keeps", "keeping", "deserve", "deserves", "go",
  "goes", "going", "make", "makes", "making", "need", "needs", "love", "loves",
  "bring", "brings", "take", "takes", "say", "says", "give", "gives", "meet",
  "meets", "shop", "ships", "shipped", "listen", "listens", "hear", "hears",
  "sleep", "sleeps", "celebrate", "celebrates", "celebrating", "know", "knows",
  "think", "thinks", "want", "wants", "come", "comes", "coming", "wear",
  "wears", "grab", "grabs", "pick", "picks", "skip", "skips", "try", "tries",
  "add", "adds", "tap", "taps", "upgrade", "upgrades", "beat", "beats",
  "handle", "handles", "shrug", "shrugs", "approve", "approves", "disappear",
  "disappears", "count", "counts", "sound", "sounds", "look", "looks",
  "feel", "feels", "hold", "holds", "wait", "waits",
]);
/** Words that are a noun and a verb in equal measure in this register. Tagged
 * NOUN unless a negation, auxiliary or adverb immediately in front of them makes
 * the verb reading the only possible one ("won't QUIT", "never STOPS"). This one
 * rule is what keeps "Fit That Won't Quit" from parsing as an imperative. */
const AMBIG = new Set([
  "fit", "sound", "sounds", "play", "plays", "work", "works", "move", "moves",
  "charge", "charges", "drop", "drops", "run", "runs", "hit", "hits", "save",
  "saves", "start", "starts", "end", "ends", "win", "wins", "last", "lasts",
  "wear", "hold", "holds", "look", "looks", "feel", "feels", "call", "calls",
  "walk", "walks", "rest", "rests", "back",
]);
const SUPERLATIVE = new Set(["best", "worst", "most", "greatest", "biggest", "loudest", "finest", "top"]);
/** Markers of the idiom-remix pattern: the words that signal a familiar phrase
 * is being borrowed and one word swapped ("Summer Just Got Louder"). */
const IDIOM_MARKERS = new Set(["just", "still", "already", "almost", "again", "ready", "all", "back", "time", "times", "one", "everything"]);

/** Rhyme keys that are really just a shared suffix. "Summer" and "louder" both
 * end "-er"; that is morphology, not a chime, and counting it made every
 * comparative headline read as a rhyme. */
const SUFFIX_KEYS = new Set([
  "er", "ers", "ing", "ings", "ed", "es", "s", "ly", "y", "en", "on", "al",
  "ion", "ions", "ance", "ence", "est", "or", "ors", "ie", "ies", "ry", "ity",
  "ous", "ful", "less", "able", "ible", "ive", "ish", "ment", "ness",
]);

const CONTENT_TAGS = new Set(["NOUN", "NOUN-POSS", "VERB", "ADJ", "ADV"]);

/** Tokens a signature looks at. Long body openers are truncated — the opening
 * move is the repeatable part, the tail is not. */
const MAX_TOKENS = 10;

function words(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9'’\-\s]/g, " ")
    .replace(/[’]/g, "'")
    .split(/\s+/)
    .filter(Boolean);
}

function tag(w: string, prev: string | null): string {
  if (/\d/.test(w)) return "NUM";
  if (/n't$/.test(w)) return "NEG-VERB";
  const poss = /'s$/.test(w);
  const bare = poss ? w.replace(/'s$/, "") : w;
  if (NEG.has(bare)) return "NEG";
  if (REL.has(bare)) return "REL";
  if (DET.has(bare) && !poss) return "DET";
  if (PRON.has(bare)) return "PRON";
  if (AUX.has(bare)) return "AUX";
  if (CONJ.has(bare)) return "CONJ";
  if (ADV.has(bare) && !AMBIG.has(bare)) return "ADV";
  if (PREP.has(bare)) return "PREP";
  if (AMBIG.has(bare)) {
    // Only a negation / auxiliary / negating adverb immediately before it forces
    // the verb reading.
    const forcesVerb = prev === "NEG" || prev === "NEG-VERB" || prev === "AUX";
    return forcesVerb ? "VERB" : poss ? "NOUN-POSS" : "NOUN";
  }
  if (VERB.has(bare)) return "VERB";
  if (ADJ.has(bare) || SUPERLATIVE.has(bare)) return "ADJ";
  if (/(est|ous|ful|less|able|ible|ive|ish)$/.test(bare) && bare.length > 4) return "ADJ";
  // -thing / -body compounds are pronouns, never verbs, whatever they end in.
  if (/(thing|body)$/.test(bare)) return "PRON";
  if (/ing$/.test(bare) && bare.length > 5) return "VERB";
  // Grammar, not vocabulary: a word sitting immediately after a negation or an
  // auxiliary is a verb whatever the lexicon knows about it. This is what keeps
  // "Comfort Never FADES" in the same construction bucket as "Motion Never
  // STOPS" — the alternative is a verb list that has to be complete, which it
  // never will be.
  if (prev === "NEG" || prev === "NEG-VERB" || prev === "AUX") return "VERB";
  if (poss) return "NOUN-POSS";
  return "NOUN";
}

function singular(w: string): string {
  if (/(ss|us|is)$/.test(w)) return w;
  if (/ies$/.test(w)) return w.replace(/ies$/, "y");
  if (/(ches|shes|xes|zes|ses)$/.test(w)) return w.replace(/es$/, "");
  if (/s$/.test(w)) return w.replace(/s$/, "");
  return w;
}

function lemma(w: string): string {
  const bare = w.replace(/n't$/, "").replace(/'s$/, "");
  if (/ing$/.test(bare) && bare.length > 5) return bare.replace(/ing$/, "");
  if (/ied$/.test(bare)) return bare.replace(/ied$/, "y");
  if (/ed$/.test(bare) && bare.length > 4) return bare.replace(/ed$/, "");
  return singular(bare);
}

/** Crude rhyme key: everything from the last vowel of the word onward, so
 * "quit"/"fit" → "it" and "night"/"tonight" → "ight". Good enough to notice that
 * two lines are chiming; never used for anything that must be linguistically
 * true. */
function rhymeKey(w: string): string {
  // Strip the possessive / contraction before looking for the rhyme, or
  // "Tonight's" ("...ights") fails to chime with "Night" ("...ight").
  const bare = w.replace(/n't$/, "").replace(/'s$/, "").replace(/[^a-z]/g, "");
  const m = bare.match(/[aeiouy][^aeiouy]*$/);
  return m ? m[0] : bare;
}

function detectDevices(text: string, toks: string[], tags: string[]): string[] {
  const devices = new Set<string>();
  const hasLexicalVerb = tags.includes("VERB");
  // "Class Is In Session" is a clause, not a noun phrase: an auxiliary alone still
  // makes a sentence, and calling it a fragment erased a real distinction between
  // "Class Is In Session" and "Gym Bag Essentials".
  const hasCopula = !hasLexicalVerb && tags.includes("AUX");
  const negated = tags.some((t) => t === "NEG" || t === "NEG-VERB");

  if (negated) devices.add("negation");
  if (/\?\s*$/.test(text)) devices.add("question");
  if (tags[0] === "VERB") devices.add("imperative");
  else if (hasLexicalVerb || hasCopula) devices.add("declarative");
  if (hasCopula) devices.add("copula");
  if (!hasLexicalVerb && !hasCopula) devices.add("fragment");
  if (tags.includes("NUM")) devices.add("numeral");
  if (tags.includes("NOUN-POSS")) devices.add("possessive");
  if (toks.some((w) => SUPERLATIVE.has(w)) || toks.some((w) => /est$/.test(w) && w.length > 4)) devices.add("superlative");
  if (toks.some((w) => w === "you" || w === "your" || w === "yours")) devices.add("second_person");
  if (/[:]/.test(text)) devices.add("colon");

  const content = toks.filter((_, i) => CONTENT_TAGS.has(tags[i]));
  // Repeated content word → the parallel/echo construction ("Great Moms Deserve
  // Great Sound").
  const seen = new Set<string>();
  for (const w of content) {
    if (seen.has(w)) { devices.add("repetition"); break; }
    seen.add(w);
  }
  // Rhyme between any two distinct content words.
  for (let i = 0; i < content.length; i++) {
    for (let j = i + 1; j < content.length; j++) {
      if (content[i] === content[j]) continue;
      const a = rhymeKey(content[i]);
      const b = rhymeKey(content[j]);
      if (a.length >= 2 && a === b && !SUFFIX_KEYS.has(a)) { devices.add("rhyme"); i = content.length; break; }
    }
  }
  // Alliteration between any two distinct content words.
  for (let i = 0; i < content.length && !devices.has("alliteration"); i++) {
    for (let j = i + 1; j < content.length; j++) {
      if (content[i] === content[j]) continue;
      if (content[i][0] === content[j][0]) { devices.add("alliteration"); break; }
    }
  }
  return [...devices].sort();
}

function classifyPattern(toks: string[], tags: string[], devices: string[]): HeadlinePattern {
  // Order matters: the most distinctive form wins. rhyme and repetition are the
  // "rhyme / parallel" pattern in data/copy-system.md.
  if (devices.includes("rhyme") || devices.includes("repetition")) return "rhyme";
  if (devices.includes("superlative")) return "bold_claim";
  if (toks.some((w) => IDIOM_MARKERS.has(w))) return "idiom_remix";
  // A copula assertion ("Class Is In Session") is a plain confident claim. A
  // lexical verb doing work ("Motion Never Stops") is a product truth.
  if (devices.includes("copula")) return "bold_claim";
  if (devices.includes("declarative")) return "product_truth";
  if (devices.includes("imperative")) return "product_truth";
  return "bold_claim";
}

/**
 * Compute a line's form signature. `declaredPattern` is the writer's own label,
 * carried by the headline slate (§1.3) — it always wins over the classifier.
 */
export function formSignature(text: string, declaredPattern?: HeadlinePattern | string): FormSignature {
  const raw = (text || "").trim();
  const toks = words(raw).slice(0, MAX_TOKENS);
  if (!toks.length) {
    return { pattern: "unclassified", template: "", word_count: 0, head_noun: "", verb_lemma: "", devices: [], opening_pos: "" };
  }
  const tags: string[] = [];
  for (let i = 0; i < toks.length; i++) tags.push(tag(toks[i], i === 0 ? null : tags[i - 1]));

  const devices = detectDevices(raw, toks, tags);
  const nounIdx = tags.findIndex((t) => t === "NOUN" || t === "NOUN-POSS");
  const verbIdx = tags.findIndex((t) => t === "VERB");

  return {
    pattern: isHeadlinePattern(declaredPattern) ? declaredPattern : classifyPattern(toks, tags, devices),
    template: tags.join(" + "),
    word_count: words(raw).length,
    head_noun: nounIdx === -1 ? "" : singular(toks[nounIdx].replace(/'s$/, "")),
    verb_lemma: verbIdx === -1 ? "" : lemma(toks[verbIdx]),
    devices,
    opening_pos: tags[0],
  };
}

// ---------------------------------------------------------------------------
// Distance — weighted FIELD AGREEMENT, not string distance (§2.3).
// ---------------------------------------------------------------------------
const WEIGHTS = {
  pattern: 0.22,
  devices: 0.26,
  template: 0.24,
  word_count: 0.10,
  opening_pos: 0.08,
  head_noun: 0.05,
  verb_lemma: 0.05,
} as const;

/** Two lines at or above this score are the same construction wearing different
 * words. Calibrated on the 11 shipped reference headlines: "Motion Never Stops"
 * vs "Sound Never Quits" scores ~0.90; "Fit That Won't Quit" vs "Motion Never
 * Stops" (which share negation and a shape but not a pattern) scores ~0.46. */
export const FORM_SIMILARITY_THRESHOLD = 0.72;

function jaccard(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 0.5; // both featureless: weak evidence either way
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / (sa.size + sb.size - inter);
}

function templateScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = a.split(" + ");
  const tb = b.split(" + ");
  if (ta.length === tb.length) {
    // Same length → positional agreement, which is what "same shape" means.
    return ta.filter((t, i) => t === tb[i]).length / ta.length;
  }
  return jaccard(ta, tb);
}

function countScore(a: number, b: number): number {
  const d = Math.abs(a - b);
  return d === 0 ? 1 : d === 1 ? 0.6 : d === 2 ? 0.25 : 0;
}

/**
 * Form similarity in [0,1]: how much of the construction two lines share.
 * Deliberately blind to shared words except as a small bonus — lexical overlap is
 * the other checker's job (src/lib/constructions.ts similarity()).
 */
export function signatureSimilarity(a: FormSignature, b: FormSignature): number {
  if (!a.template || !b.template) return 0;
  const unknown = a.pattern === "unclassified" || b.pattern === "unclassified";
  return (
    WEIGHTS.pattern * (unknown ? 0 : a.pattern === b.pattern ? 1 : 0) +
    WEIGHTS.devices * jaccard(a.devices, b.devices) +
    WEIGHTS.template * templateScore(a.template, b.template) +
    WEIGHTS.word_count * countScore(a.word_count, b.word_count) +
    WEIGHTS.opening_pos * (a.opening_pos === b.opening_pos ? 1 : 0) +
    WEIGHTS.head_noun * (a.head_noun && a.head_noun === b.head_noun ? 1 : 0) +
    WEIGHTS.verb_lemma * (a.verb_lemma && a.verb_lemma === b.verb_lemma ? 1 : 0)
  );
}

/** Convenience: similarity straight from two strings. */
export function formSimilarity(a: string, b: string): number {
  return signatureSimilarity(formSignature(a), formSignature(b));
}

/** One-line, human-readable rendering of a signature, for the AVOID/ledger
 * blocks and the in-app inspector. Never shows the line itself. */
export function describeSignature(sig: FormSignature): string {
  const parts = [sig.pattern !== "unclassified" ? sig.pattern : null, `${sig.word_count} words`, sig.template];
  if (sig.devices.length) parts.push(sig.devices.join("+"));
  return parts.filter(Boolean).join(", ");
}
