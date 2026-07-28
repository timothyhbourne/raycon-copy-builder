# Daily update — Thursday, July 23, 2026

* Audited why the copy builder's header/tagline/subheader quality wasn't landing and why only one of three product cards was pulling a real review, traced both to root cause, and wrote up findings with fixes (~45 mins)
* Found the real bug behind the recurring "Last Call" headline: the internal campaign filename (e.g. "FS - 30% OFF E95 + H20 + H10 - LAST CALL") was leaking into the model's conceit instead of a real creative angle — no amount of prompt tweaking could have fixed it (~30 mins)
* Curated real customer reviews for Pro Earbuds and Everyday Headphones so all three product cards in a campaign now pull genuine reviews instead of two going blank (~20 mins)
* Speced and scoped a flash-sale occasion type (start/end date inputs, decoupled from the promo calendar) with date-aware deadline language so "last call" copy says "tomorrow night" or "48 hours" instead of a false "tonight" when sent early (~30 mins)
* Fixed the occasion picker pulling in the entire promo calendar archive back to 2023 plus undated planner rows — scoped it to current/upcoming only (~15 mins)
* Built out the dial 4-5 "voice v2" spec with a full set of approved example headlines/taglines/subject lines anchored to real shipped campaigns, so future iterations stop guessing at what "playful" means (~30 mins)
* Banned the "pairs" and "one code/one deal" counting constructions and fixed the tagline rule so 2-product sends name both products instead of defaulting to a generic bucket noun (~20 mins)
* Built a first-principles Northbeam sandbox probe in the app to fetch one real number (Klaviyo revenue) and reconcile it against the CRM Campaign (v2) dashboard view (~40 mins)
* Chased down why the probe was off by tens of thousands of dollars — wrong attribution model id, wrong endpoint paths, WEEKLY granularity bleeding across window edges, an unpinned end date, and Northbeam's export queue intermittently 500'ing mid-poll — fixed all five and got platform-level revenue matching to the dollar (~1.5 hrs)
* Extended the sandbox probe to campaign level, confirmed the real Northbeam export shape (level=campaign, not a campaign breakdown) straight from their API docs, and got a single campaign's revenue matching correctly (~45 mins)
* Wrote the retrofit spec to carry the confirmed Northbeam recipe into the planner's existing (never-working) "NB rev" column (~20 mins)
* Discovered Postscript's public API has no campaign/flow/analytics endpoints at all — the planner's SMS campaign-ID field was wired to nothing and could never have worked — and speced the fix: Northbeam covers SMS revenue by campaign name, recipients/click-rate/revenue become properly formatted manual-entry fields for SMS rows (~40 mins)

**Total: ~6.5 hrs**
