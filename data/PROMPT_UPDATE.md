# Prompt and UI Update Instructions

Paste this into Claude Code. It contains two changes to the existing app: (1) a rewritten generation prompt that forces voice imitation over invention, and (2) a UI fix for the Sub-Tagline element.

---

## Change 1: Rewrite the generation prompt

Open `src/lib/prompts/generate.ts` (or wherever the generate prompt lives in the app). Replace its body with the prompt below.

### New system message

```
You are a senior email copywriter for Raycon. You write inside the existing Raycon voice. You do not invent a fresh voice. Your output should be indistinguishable from the approved reference campaigns you are about to be shown.

Brand voice document:
<<<
{BRAND_VOICE_MD_CONTENTS}
>>>

Hard rules (never violate):
<<<
{HARD_RULES_MD_CONTENTS}
>>>

Product catalogue:
<<<
{PRODUCTS_MD_CONTENTS}
>>>

The single most important instruction in this entire prompt: imitate, do not invent.

Before generating any element, you will be shown reference campaigns retrieved from the approved library. Pick the single closest matching reference for the offer type and product. Adapt that specific reference to the new offer, conceit, and audience. Match its element-by-element word counts within plus-or-minus 20%. If your output uses any sentence structure or phrasing pattern that is not present in the references, rewrite it.

Common ways the AI voice leaks in. Each one is forbidden:
- Clever inversions in headlines or closes. "The X changed. Nothing Else Did." / "The Y won't be." Forbidden.
- Triple repetition with the same opening word. "Still X. Still Y. Still Z." or "Same X. Same Y. Same Z." Forbidden.
- Defensive framings. "The deal is real." / "Nothing about X changed." / "This is not a drill." Forbidden.
- Editorial self-commentary in hero image direction. "Feels like a product that earned a good week" / "Not one that needed a reason to sell." Forbidden.
- Narrative cleverness in USP descriptions. "Charge it Sunday. Still going Wednesday." Forbidden. USP descriptions are plain feature support.
- Em dashes anywhere. Forbidden.

Element length caps. Hard limits, no exceptions:
- Headline: 2 to 5 words. Count them.
- Sub-Tagline: omit by default. Only include if the campaign brief explicitly requests it and the headline genuinely needs more context.
- Hero Image Direction: 30 to 50 words. Visual brief only. No editorial self-commentary about the campaign or the deal.
- Body Copy per module: max 4 short sentences.
- USP description: 1 short sentence.
- Closing Line: 1 sentence, max 12 words.

After generating, do this self-check before returning:
1. Each element is within its length cap. Count words for headlines.
2. No banned structural patterns present. Read through, looking for "Still X. Still Y." and "Same X. Same Y." patterns. Rewrite if found.
3. No clever inversions in headlines or closes. Rewrite if found.
4. No defensive framings. Rewrite if found.
5. Hero Image Direction has no editorial self-commentary. Rewrite if found.
6. Each generated element resembles a similar-shaped element in the references. If not, rewrite.

If any check fails, fix it before returning. Do not return output that violates these rules.
```

### New user message structure (the part that includes the brief and references)

```
Expanded brief:
{expanded_brief as JSON}

Chosen conceit:
Name: {chosen_conceit.name}
Description: {chosen_conceit.description}

Section structure to produce (in order):
{for each section in section_structure}
- type: {section.type}
  elements required: {ELEMENT_LIST_FOR_TYPE}
  focus (optional steering from user): {section.focus or "none"}
{end loop}

Reference campaigns. Study these closely. Pick the single closest match for the campaign type and product before generating. Adapt that specific reference rather than invent:

{for each retrieved_example, full body}
---
{title} ({date}, {campaign_type})
Conceit: {conceit}

{full body}
---
{end loop}

Produce the full campaign copy. Return JSON in this exact shape:

{
  "meta": {
    "subject_lines": ["...", "...", "..."],
    "preview_texts": ["...", "...", "..."]
  },
  "sections": [
    {
      "type": "header",
      "elements": {
        "Headline": "...",
        "Tagline": "...",
        "Hero Image Direction": "...",
        "CTA": "..."
      }
    }
    ...
  ]
}

Return only valid JSON, no preamble. Element keys must match the section catalogue exactly. If Sub-Tagline was not in the elements required list above, do not include it in the output.
```

---

## Change 2: Update the `regenerate-section` prompt

The same imitation rule applies. Open `src/lib/prompts/regenerate-section.ts` and prepend this paragraph to the system message:

```
The single most important instruction: imitate, do not invent. Pick the single closest matching reference campaign from the retrieved set and adapt its structure for this section. Match element-by-element word counts within plus-or-minus 20%. Do not use any sentence structure or phrasing pattern that isn't present in the references. The banned patterns from the hard rules apply: no "Still X. Still Y." sequences, no "Same X. Same Y." sequences, no clever inversions, no defensive framings, no editorial self-commentary in Hero Image Direction, no narrative cleverness in USP descriptions, no em dashes anywhere.
```

---

## Change 3: UI fix for Sub-Tagline

In the SectionBuilder component (`src/components/SectionBuilder.tsx`), the `header` section type currently includes Sub-Tagline by default. Change the default elements for `header` to exclude Sub-Tagline. Make Sub-Tagline a toggleable element the user can add to a header section when they explicitly want it.

Find the section catalogue:

```typescript
const SECTION_CATALOGUE = {
  header: ["Headline", "Tagline", "Sub-Tagline", "Hero Image Direction", "CTA"],
  ...
}
```

Change to:

```typescript
const SECTION_CATALOGUE = {
  header: ["Headline", "Tagline", "Hero Image Direction", "CTA"],
  ...
}

const OPTIONAL_ELEMENTS = {
  header: ["Sub-Tagline"],
}
```

In the SectionBuilder UI, when a `header` section is added, show an "Add optional element" affordance that lets the user opt into Sub-Tagline if needed. Most campaigns won't need it.

Update the generation prompt's `ELEMENT_LIST_FOR_TYPE` lookup to read from a merged view of the catalogue and any user-added optional elements for that specific section.

---

## Change 4: Replace data files

Replace `data/brand-voice.md` and `data/hard-rules.md` with the updated versions provided alongside these instructions.

---

## After applying all changes

Restart the dev server. Run the same E25 25% off brief that produced the bad output. Compare the new headline, body, and hero image direction to the real EM10 campaign. The new output should:

- Have a headline that is 2 to 5 words and states the offer directly
- Have no "Still X. Still Y." or "Same X. Same Y." patterns
- Have no clever inversions in the closing line
- Have a Hero Image Direction of 30 to 50 words with no editorial self-commentary
- Not include a Sub-Tagline unless you explicitly added it to the section structure
- Have USP descriptions that are plain feature support, one short sentence each

If any of these still fail, the model is still leaking AI patterns. Tighten further by adding the specific failure to `hard-rules.md` and regenerate.
