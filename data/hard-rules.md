# Raycon Hard Rules (retired, moved)

The hard rules now live in `copy-system.md`, in the `RULES` section, stated once as a pass/fail gate, with a matching `SELFCHECK`. They are enforced two ways:

1. In the prompt, injected LAST (after the reference campaigns) so they win on recency. See `src/lib/prompts/voice.ts` (`hardRulesGate()`).
2. In code, by the deterministic checker `src/lib/hard-rules-check.ts` and the `/api/hard-rules-check` route, which scans generated copy for em dashes, banned phrases and hype words, the retired "Classic" name, emoji, stacked exclamations, and length-cap violations.

This file is no longer read by the prompt assembly. Edit `copy-system.md` to change a rule; update `src/lib/hard-rules-check.ts` if the rule is mechanically checkable.
