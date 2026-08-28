# Planner — Segment Selection as a Brief, Not a Readout

**Status:** proposed, not started.
**Surface:** `src/app/planner/page.tsx` (row editor), `src/lib/planner-types.ts`,
`src/app/api/klaviyo/audiences/route.ts`, `src/app/api/planner/audiences/route.ts`,
`src/lib/klaviyo.ts`.
**Driver:** a new handover workflow — copy is written by one person, built and
scheduled in Klaviyo by someone else.

---

## 1. The workflow this has to support

1. Copy is written in the Copy Builder and attached to a planner row.
2. **In the planner row, the target segments are selected** — from the live list
   of Klaviyo segments and lists. This is the **brief**: it tells the VA which
   audiences to send to.
3. The VA reads the row, builds the campaign in Klaviyo against those segments,
   and schedules it.
4. The VA links the live Klaviyo campaign back to the row.
5. **Only then** do the campaign's real audiences appear — as confirmation of
   what was actually built.

The direction of travel is reversed from today. Audiences stop being something
the app *reads out of Klaviyo* and become something the app *sends to Klaviyo*,
via a person.

---

## 2. Why it can't work today

### 2.1 The audience section is gated on the wrong event

`planner/page.tsx:964`:

```ts
if (!klaviyoId) return hasAud ? <>{audChips}{audMicro("manual")}</> : audBlocked("Link a Klaviyo campaign to pull audiences.");
```

With no Klaviyo campaign linked, the audience section renders a blocked message.
That is what "the audience section is broken" is — it isn't broken, it is gated
on the step that now comes **last**. At the moment the brief is being written
there is no Klaviyo campaign, so there is nothing to show and nothing to do.

### 2.2 There is no picker at all

Audiences are only ever *pulled from* a linked campaign
(`fetchAudiencesFromKlaviyo`, `:752-769`), writing into
`audience_included` / `audience_excluded`. Nothing anywhere lets a person
**choose** an audience. There is no way to express intent, only to record what
already happened.

The picker endpoint exists — `/api/klaviyo/audiences` returns every segment and
list — and nothing consumes it in this flow.

### 2.3 One field is being asked to mean two things

`PlannerRow.audience_included` / `audience_excluded` currently hold *derived*
values, and `:964` also has a "manual" branch for hand-entered ones. So the same
field means "what I intend to send to" and "what Klaviyo says was sent to,"
depending on how it got filled. Those are different facts and they need to be
compared, not merged.

### 2.4 The segment list is slow enough to look broken

`/api/klaviyo/audiences` caches **in-process for 10 minutes**
(`route.ts:6-8`), and `listAudienceResource` (`klaviyo.ts:225-237`) paginates up
to **30 pages each** for segments and lists, sequentially. On Vercel every cold
lambda starts with an empty cache, so a cold open can fire up to 60 sequential
Klaviyo requests before the picker renders. That will often exceed the function
timeout, and to the user it reads as a hang.

These endpoints are cheap on quota — `/segments/` and `/lists/` are 10/s, 150/min
with no daily cap — so this is a latency and caching problem, not a rate-limit
one. It still needs fixing before a picker can sit on top of it.

---

## 3. Data model

Split intent from actual.

```ts
interface PlannerRow {
  // … existing fields

  /** THE BRIEF. Segments/lists the VA should build this campaign against.
   *  Chosen by hand from the synced Klaviyo audience list. Never overwritten
   *  by a sync. */
  audience_planned_included: AudienceRef[];
  audience_planned_excluded: AudienceRef[];
  audience_planned_note?: string;   // free text, e.g. "cap at 3 sends/week"

  /** WHAT WAS BUILT. Derived from the linked Klaviyo campaign, read-only.
   *  Absent until a campaign is linked. */
  audience_actual_included?: AudienceRef[];
  audience_actual_excluded?: AudienceRef[];
  audience_actual_synced_at?: string;
}
```

`AudienceRef { id, name, type }` is unchanged and already carries real Klaviyo
ids (`planner-types.ts:40-44`), which is what makes the comparison in §5.3
possible.

**Migration:** existing `audience_included` / `audience_excluded` carry derived
values for linked rows and hand-entered values for unlinked ones. At the read
boundary, copy them into `audience_actual_*` when the row has a
`klaviyo_campaign_id`, and into `audience_planned_*` when it does not. Stamp the
new `schema_version`. Keep the old fields for one release, written from
`audience_actual_* ?? audience_planned_*`, then drop them.

**Mind the standing gotcha:** the planner read boundary drops records that don't
parse (`validation/schemas.ts`), so ship the zod change with the type change.

---

## 4. Daily segment sync

Replace the in-process cache with a real one.

- New nightly cron: `POST /api/klaviyo/audiences/sync` — fetches all segments and
  lists once and writes them to the storage seam (`getAdapter`, namespace
  `klaviyo-audiences`) as `{ audiences: AudienceItem[], synced_at }`.
- `GET /api/klaviyo/audiences` reads the store. No Klaviyo call on the read path,
  so the picker opens instantly and identically on every instance.
- A **Refresh** control on the picker triggers a sync on demand, for when a
  segment was created five minutes ago. Rate-limit it to once a minute.
- Show `synced_at` in the picker ("Segments as of 09:00") so a missing new
  segment has an obvious explanation and an obvious fix.
- Serve stale on failure rather than erroring, matching how `/api/promotions`
  already behaves.
- Store the audience's **size** alongside it where Klaviyo returns it (segments
  expose a profile count). Choosing between two segments without knowing whether
  one has 400 people in it is the main thing that makes this decision hard today.

Add the cron to `vercel.json` alongside the weekly report. This is a cheap tier
(no daily cap), so nightly is comfortable.

---

## 5. The row editor

### 5.1 Target audience — always available, always editable

A new section at the top of the audience area, present from the moment a row
exists. No Klaviyo campaign required.

- **Include** — multi-select from the synced list, searchable, showing each
  audience's type (segment/list) and size.
- **Exclude** — the same, separate control.
- **Note** — one free-text line for anything the picker can't express.

This is the field the VA reads. It should be the most prominent thing in the
audience area, and it should be obvious it is an instruction rather than a
record — label it **Target audience (brief)**.

### 5.2 Built audience — hidden until a campaign is linked

The derived audiences keep their current behaviour (`fetchAudiencesFromKlaviyo`,
`:752-769`) with one change: they write to `audience_actual_*`, never over the
plan, and **the whole section is hidden while `klaviyo_campaign_id` is unset**.
No blocked message, no empty state — if there is no campaign yet, there is
nothing to say. Label it **Built in Klaviyo**, with the sync time.

### 5.3 The match check — the part that earns its keep

Once both exist, compare them by `AudienceRef.id` and show one line:

- **Matches the brief** — quiet green.
- **Differs from the brief** — name the difference precisely: *"Built with US
  Subscribers L90D. Brief asked for US Subscribers L30D. Missing exclusion:
  Purchasers Last 30 Days."*

This is the reason to separate the two fields at all. A handover workflow's main
failure mode is a campaign built against the wrong audience, and that is
invisible today because the app overwrites the intent with the reality and shows
only one number. Catching it before send is worth more than the picker itself.

Do not auto-correct either side. Surface the difference and let a person decide
which is right.

### 5.4 Status flow

`ready_for_design` currently means "copy is done, hand it over." With a VA in the
loop the row now needs to carry the brief too. Gate the handoff on the brief
being present: **a row cannot move to `ready_for_design` with an empty
`audience_planned_included`.** Handing over a campaign with no stated audience is
the thing this whole change exists to prevent.

### 5.5 The table

The planner table's audience column (`:416-417`) should show the **planned**
audiences, with a small marker when the built audience differs. The plan is what
someone scanning the week needs to see; the discrepancy is the exception worth
flagging.

---

## 6. Acceptance criteria

- A planner row with no Klaviyo campaign shows an editable target-audience
  picker. *(Fails today — it shows "Link a Klaviyo campaign to pull audiences.")*
- The picker lists every Klaviyo segment and list, searchable, with type and size.
- The picker opens without a Klaviyo API call and without a perceptible wait.
- Selected audiences persist on the row and survive a reload.
- Linking a Klaviyo campaign **never** overwrites the planned audiences.
- The "Built in Klaviyo" section is completely hidden until a campaign is linked.
- With both present, a mismatch is named specifically, not just flagged.
- A row cannot reach `ready_for_design` with no planned audience.
- Existing rows migrate with their audiences landing in the right field —
  derived into actual for linked rows, manual into planned for unlinked ones —
  and no rows are dropped on read.
- The nightly sync runs and `synced_at` is visible in the picker.
- Refresh pulls a newly created segment into the list.

---

## 7. Out of scope

- **Creating segments from the app.** Selection only; segments are built in
  Klaviyo.
- **Creating the Klaviyo campaign from the app.** Still the VA's job. When the
  Klaviyo write work in `FEATURE_OPPORTUNITIES.md` lands, the planned audience
  becomes its input and most of this handover disappears — the data model here is
  deliberately shaped for that.
- **Audience overlap / frequency capping.** Real and valuable, and it needs the
  planned audiences to exist first. Follow-on.
- **SMS/Postscript audiences.** Postscript has no usable API; the note field
  covers it for now.
