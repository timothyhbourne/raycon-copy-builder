# SMS Copy Mode — build & verification notes

Implements `SMS_COPY_BUILDER_PROMPT.md`. Landed in these commits:

1. **SMS 1/5** — `src/lib/sms-format.ts`, `src/lib/sms.ts`, `/api/sms`, data model in `schemas.ts`.
2. **SMS 2/5** — `src/lib/prompts/sms.ts`, `/api/sms-generate`, construction-index hookup.
3. **SMS 3/5 (partial + wiring)** — `src/components/sms/SmsForm.tsx`, `SmsCanvas.tsx`, Sidebar SMS tab; then channel switch + SMS state/handlers/render in `copy-builder/page.tsx`.
4. **SMS 4/5** — planner hookup (`planner/page.tsx`, `CopyDocModal`, `/api/planner/copy`, `/api/planner/link`).

## Verified

- **`npm run build`** — ✓ Compiled successfully; all routes present incl. `/api/sms`, `/api/sms-generate`, `/copy-builder`, `/planner`.
- **`tsc --noEmit`** — 0 errors across the project.
- **Character math** (exercised against the real `sms-format` module):
  - 161-char GSM-7 string → `GSM-7`, **2 segments** ✓
  - 160-char GSM-7 → 1 segment ✓
  - 70 chars + emoji (72 UTF-16 units) → `Unicode`, **2 segments** ✓
  - 71 units → `Unicode`, 2 segments ✓
  - em dash → encoding flips to `Unicode`, `offendingChar` reported for the UI hint ✓
  - `TARGET_CHARS = 145` ✓
- **Email mode untouched** — all email state/logic is gated behind `channel === "email"`; the email brief form, conceit/canvas stages, autosave, and repetition checker render exactly as before.

## Not exercised here (needs a running server + Anthropic key + browser)

The generation and end-to-end round-trips (from-email distill, from-scratch generate, live counter turning amber/red as you type an emoji, SMS planner row → Write copy → Save Final → chip + viewer modal) are wired and type-check/build clean, but were not driven live in this environment. The `/api/sms-generate` route re-checks each variant server-side with `smsLength` and does one corrective round-trip if any variant exceeds 160 chars.

## Deviations

- **Commit shape.** A concurrent process was rewriting shared files (`copy-builder/page.tsx`, construction index, planner prompts) during this work, so it was paused after the isolated pieces and resumed once settled. Result: 5 SMS commits (1, 2, 3-partial, 3-wiring, 4) rather than the prompt's exact 5. The `copy-builder/page.tsx` wiring commit necessarily carries co-resident, then-uncommitted changes from the parallel construction-index work (same file, same branch).
- **Construction index.** The prompt hedged "if the construction index exists" — it does (`src/lib/constructions.ts`), so SMS is fully hooked in: a `sms` field per campaign, `recordSms` on final save, `buildSmsAvoidBlock` injected into the SMS prompt, and index cleanup on delete.
