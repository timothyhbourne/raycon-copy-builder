# Reviews — Manual Entry Is Unreachable

**Status:** diagnosed, fix proposed. **Blocking** — the reviews module cannot
currently be used with a hand-entered review.
**Amends:** `docs/REVIEWS_MODULE_SPEC.md` §4.2 and §5, which specified manual
entry as the always-works escape hatch. The escape hatch was specified but its
write path was never built.

---

## 1. What happens

Type a review into a Review slot on the canvas and you get:

> "This review has no source on record, so nothing verified a customer said it.
> It has to be replaced or cleared before this campaign can be finalised."

Save Final is then blocked. There is no control anywhere that clears the warning,
so the only ways forward are to fetch a different review or delete the slot. The
module is unusable for any review the fetcher cannot reach — which is the exact
case manual entry was designed for.

## 2. Root cause

`origin: "manual"` is written in **exactly one place** in the codebase —
`src/lib/reviews/resolve.ts:47`:

```ts
provenance: { origin: "manual", ...(slot.manual_author ? { author: slot.manual_author } : {}) },
```

That is the **server-side pre-generation resolver**. It fires only when a
`ReviewSlot` was configured with `source: "manual"` and `manual_text` filled in,
in the Section Structure builder, **before the campaign was generated**.

Nothing on the canvas ever sets it. So:

- `provenance.ts:132` — `if (prov && prov.origin !== "unverified") continue;` — a
  review with **no** provenance record falls through as unverified.
- `ReviewProvenanceLine.tsx:50` — `const unverified = hasText && (!origin || origin === "unverified")` — absent provenance renders the warning.
- `copy-builder/page.tsx:990` — that blocks Save Final.

`ORIGIN_LABEL.manual = "Entered by hand"` exists in the UI
(`ReviewProvenanceLine.tsx:15`) and is unreachable. The label was built; the door
to it was not.

So the manual path is real, but only through a door you had to walk through
before you started. Typing a review where you are looking at it — the obvious
action — is the one path with no way out.

## 3. The fix

### 3.1 The principle

**The gate should block anonymity, not manual entry.**

Right now it blocks anything the machine didn't fetch, which conflates two very
different things. There are three states, not two:

| State | Meaning | Finalise? |
|---|---|---|
| `fetched` | Machine-verified: pulled from a source and matched verbatim | ✅ |
| `manual` — **attested** | A person entered it and recorded where it came from | ✅ |
| `unverified` | Text with no record and nobody accounting for it | ❌ blocked |

A hand-entered review does not need *verification*. It needs an **attestation** —
someone saying where it came from and standing behind it. That satisfies the
honesty rule (no invented customers) without requiring the fetcher to reach
sources it cannot.

### 3.2 The attest flow

When a Review element has text with no provenance, the warning becomes an
**action**, not a dead end:

> ⚠ No source recorded yet. **Add source** · **Fetch a real one** · **Clear**

**Add source** opens a small inline form:

| Field | Required | Notes |
|---|---|---|
| Where is this from? | yes | Judge.me · Amazon · Trustpilot · Support ticket · Social · Other |
| Source URL | no | If given, enables §3.3 |
| Reviewer first name | no | Stamped as `author`; the hard rules already forbid inventing one |
| Rating | no | |

On save, stamp:

```ts
{
  origin: "manual",
  source_note: "Amazon",
  source_url?: string,
  author?: string,
  rating?: number,
  attested_at: string,     // ISO
}
```

Warning clears, Save Final unblocks, and the provenance line reads
**"Entered by hand · Amazon · 24 Aug"**. The claim is now attributable, which is
the thing that actually matters.

### 3.3 "Check this source" — optional upgrade, never a gate

If a URL was given, show a **Check source** button. It runs the verification
already specified in `REVIEWS_MODULE_SPEC.md` §4.1: fetch the page, confirm the
review text appears **verbatim**, and on a match upgrade `origin` to `fetched`
with `fetched_at` and the matched URL.

Critically: **a failed or unreachable check does not downgrade or re-block.** It
reports *"Couldn't reach that page — the review stays as entered by hand"* and
leaves the attestation intact. Amazon will block us; that must not make the
review unusable.

This gives the button Tim is missing, while keeping it an enhancement rather than
a requirement.

### 3.4 Canvas-level review actions

Every Review element gets a consistent small action set, not just the refresh
control that exists today:

- **Fetch a real review** — cycles the fetched list (already built)
- **Add source** — §3.2
- **Check source** — §3.3, only when a URL is present
- **Clear**

Reachable from the element's hover controls and from the right-click menu, so it
matches how the rest of the canvas behaves.

### 3.5 Fix the warning copy

Current text states the problem and offers no route:

> "This review has no source on record, so nothing verified a customer said it.
> It has to be replaced or cleared before this campaign can be finalised."

Replace with:

> "No source recorded. Add where this came from, or fetch a real one."

And the Save Final blocker (`page.tsx:990`) should name the slots and link
straight to them, rather than describing the problem in the abstract.

Same principle as the body-copy placeholders: say what to do, not what is
missing.

### 3.6 Keep the gate honest

Everything else about the gate stays. `unverified` still blocks Save Final, and
that is still correct — a fabricated customer quote in a marketing email is the
one case where interrupting the writer beats shipping. The change is only that a
human can now *account for* a review instead of being told to delete it.

Two guards worth keeping:

- Attestation is per-review and stamped at the moment it is given. Editing the
  text after attesting **clears** the provenance and re-flags the slot — an
  attestation covers the words that were attested, not the slot.
- `migrateLegacy` (`provenance.ts:170`) stamps old records `curated`. Leave it.
  Do not let a reload launder an unverified review into `curated` — the existing
  comment at `:161` already guards this.

---

## 4. Acceptance criteria

- Typing a review into a slot and clicking **Add source** clears the warning and
  unblocks Save Final.
- A hand-entered, attested review survives a save and reload with its source
  intact.
- **Check source** on a matching URL upgrades the review to `fetched`.
- **Check source** on an unreachable URL leaves the review attested and usable —
  never re-blocks it.
- Editing an attested review's text re-flags it until re-attested.
- A review with text and no attestation still blocks Save Final.
- The blocking message names which slots are unresolved and links to them.
- No warning message in the reviews module states a problem without offering an
  action.
- Regression: the pre-generation manual path (`resolve.ts:47`) still works and
  still stamps `manual`.

---

## 5. Why this happened, for the record

`REVIEWS_MODULE_SPEC.md` §4.2 described manual entry as "the always-works escape
hatch" and §5.1 listed `manual` as a valid origin — but the spec described it as
a **slot source** configured before generation, and never said explicitly that
the canvas needed its own write path. The implementation followed the spec
literally and built only the pre-generation route.

Worth carrying into future specs: when a gate blocks an action, the spec has to
name **every** route past it and where each one lives in the UI. A permitted
state with no reachable control is the same as a forbidden one.
