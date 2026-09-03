# Planner: A/B tests, and four editor fixes

Status: implemented (2026-09-03).

Two things at once, because they land in the same file: the planner learns what an
A/B test is, and the campaign editor stops wasting space.

---

## 1. What an A/B test is here

A planner row is ONE planned send (`planned_send_at`, `isEffectivelySent`). An A/B
test does not make it two sends. It makes it **one send with two treatments**.

That distinction decides the whole design. The obvious alternative — a second
planner row for variant B — would double every denominator the planner feeds:
metrics sync would try to match two rows to one Klaviyo campaign, Copy Performance
counts planner rows, and the corpus tiers on `status === "scheduled"` rows. One send
would be counted twice, forever, and the fix would be a special case in each of
those places. So: **one row, an optional `ab_test` field.**

### 1.1 The invariant: variant A *is* the row

The row already has a copy link — `copy_campaign_id` / `copy_status` /
`copy_linked_at`. Those stay exactly what they were and **are variant A**. Nothing
new is written beside them, and there is no second field meaning the same thing.

Consequently every existing consumer of "the copy for this row" keeps working with
no change and no risk:

| Consumer | Reads | Sees |
| --- | --- | --- |
| `corpus/ingest.ts` | `row.copy_campaign_id` | variant A |
| `performance-records.ts` | `row.copy_campaign_id` | variant A |
| Calendar copy glyph, table copy chip | `row.copy_campaign_id` | variant A |
| `/api/planner/sync` | `klaviyo_campaign_id` | the one send |

Variant B lives inside `ab_test` and is deliberately **invisible** to all of them.
Turning a row into an A/B test therefore cannot double-count revenue, cannot inject a
second record into the corpus, and cannot change any number already on screen.

This asymmetry is the point, not an accident. It is the smallest change that adds the
capability without touching anything that already works.

### 1.2 The shape

```ts
type AbTestKind = "subject_line" | "content";

interface AbTest {
  kind: AbTestKind;
  // kind: "subject_line" — same email, two subjects.
  subject_line?: string;   // variant B's alternate
  preview_text?: string;   // variant B's alternate
  // kind: "content" — two different emails.
  copy_campaign_id?: string;
  copy_status?: "draft" | "final";
  copy_linked_at?: string | null;
}
```

`PlannerRow.ab_test?: AbTest`. **Absent means "not an A/B test"** — every row ever
saved is already correct under that default, so this is purely additive and needs no
migration and no `SCHEMA_VERSION` bump.

Two kinds, because the two tests are genuinely different objects:

- **Subject line.** Same email, two subject lines. Variant B's alternate is two
  strings on the row. Variant A's subject line is *not* copied here — it is whatever
  the linked copy already says, and duplicating it would create exactly the
  two-sources-of-truth problem `PLANNER_AUDIENCE_BRIEF_SPEC` was written to fix.
- **Content.** Two different emails. Variant B gets its own Copy Builder campaign,
  linked to this same row.

No hypothesis field, no winner field, no per-variant metrics: the flag, the kind, and
the two copies. Learnings keep going in `notes`, which is where they already live.

### 1.3 Links are per variant

`/api/planner/link` takes an optional `variant: "a" | "b"` (default `"a"`), and so do
`linkCopyCampaign` / `unlinkCopyCampaign`. The single-owner discipline from
`PLANNER_AUTOLINK_BUGFIX_SPEC` is preserved and now sweeps **both slots** on every
row. Four guards:

1. Variant B requires `ab_test.kind === "content"` — 400 otherwise. You cannot
   smuggle a second copy onto a row that is not a content test.
2. One copy cannot fill both slots of the same row — 400. A campaign is not an A/B
   test against itself.
3. Taking a slot another copy owns still answers 409 unless `reassign: true`, per
   slot.
4. The row, not the client, decides which slot a copy is in.
   `variantHolding(row, copyId)` is consulted first, so re-saving variant B's copy
   weeks later re-links it to **B** even though the saved copy record only remembers
   its row id. Without this, reopening B and hitting save would silently evict A.

### 1.4 Switching off

`ab_test` is cleared by POSTing `ab_test: null` — explicit, because `JSON.stringify`
drops `undefined`, so an omitted key has to keep meaning "leave it alone". Turning a
content test off (or switching it to a subject-line test) while variant B has copy
attached asks first, then unlinks through the link route so the copy record's
`planner_row_id` back-reference is cleaned up rather than orphaned.

### 1.5 Where it shows

"Is this an A/B test?" is answerable without opening anything:

- **Drawer title** — an `A/B · Subject line` / `A/B · Content` chip beside
  "Edit campaign".
- **Calendar pill** — a tight `A/B` marker.
- **Table** — an `A/B` chip in the Campaign cell next to the `flow` chip, and the
  expanded detail row spells out the variant.

---

## 2. Editor fixes

Same drawer, four complaints.

### 2.1 The segments section is too tall

`Target audience` and `Built in Klaviyo` become collapsible sections with a summary
line that still shows the chosen audiences as chips, so collapsed is not blind.

Defaults are chosen so the section is open exactly when there is something to do:

- **Target audience** — collapsed when the brief already has audiences (or, on SMS, a
  note), expanded when it is empty. Writing a new brief costs no extra click;
  reopening a finished one costs no extra scroll.
- **Built in Klaviyo** — collapsed when it matches the brief, expanded when it
  differs. The exception is the thing worth reading.

### 2.2 Include vs exclude is not obvious enough

Audience chips are tinted: included = `success-50` / `success-200`, excluded =
`danger-50` / `danger-200`, both from the semantic tokens in `DESIGN_SYSTEM_SPEC`
(no new colours). The Include/Exclude mode toggle takes the same tint, and the search
result list hovers in the colour of whichever mode is armed — so the consequence of a
click is visible before the click.

### 2.3 Notes needs a drag handle

Replaced with `ui/AutoTextarea`, which grows to fit its content. No resize grip, no
dragging, no scrollbar inside a 70px box.

### 2.4 The A/B test itself

Covered above. In the drawer it is a `Test` section between Offer and the Klaviyo
link, and — for a content test — the Copy section becomes two variant panels.

---

## 3. What deliberately did not change

- Metrics sync, Northbeam matching, Copy Performance, the corpus, the audience
  brief/actual split, and every existing test.
- `SCHEMA_VERSION` stays 4: `ab_test` absent is a correct row.
- Variant B never reaches any metric, denominator or corpus record.
