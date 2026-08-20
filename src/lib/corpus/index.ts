// Barrel for the recursive-learning corpus (docs/RECURSIVE_LEARNING_FRAMEWORK_SPEC.md).
//
//   signature   — form signatures + distance (pure)
//   extract     — copy → corpus elements (pure)
//   blocks      — the prompt blocks: form budget, in-flight, rotating references (pure)
//   repetition  — the form-level repetition scan (pure core)
//   types       — the data model
//   store       — persistence on the storage seam (server only)
//   ingest      — L1/L2 build from the planner + library + saved + SMS (server only)
//   ledger      — L5 evaluation of what the system believes (pure core)
//
// Server-only modules are NOT re-exported here, so a client component importing
// this barrel never drags fs/Redis into the bundle.

export * from "./signature";
export * from "./types";
export * from "./blocks";
export * from "./extract";
export * from "./ledger-types";
