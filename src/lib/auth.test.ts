import { describe, it, expect, vi } from "vitest";

// auth.ts reads credentials from env at module-load time, so each case sets env
// then re-imports the module fresh.
async function loadAuth(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const k of ["BASIC_AUTH_USER", "BASIC_AUTH_PASSWORD", "AUTH_SECRET"]) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  return import("./auth");
}

const CONFIGURED = { BASIC_AUTH_USER: "tim", BASIC_AUTH_PASSWORD: "secret", AUTH_SECRET: undefined };

describe("credentialsValid", () => {
  it("accepts an exact user+password match", async () => {
    const a = await loadAuth(CONFIGURED);
    expect(a.credentialsValid("tim", "secret")).toBe(true);
  });
  it("rejects a wrong password or user", async () => {
    const a = await loadAuth(CONFIGURED);
    expect(a.credentialsValid("tim", "nope")).toBe(false);
    expect(a.credentialsValid("eve", "secret")).toBe(false);
  });
  it("rejects everything when the gate is unconfigured", async () => {
    const a = await loadAuth({ BASIC_AUTH_USER: undefined, BASIC_AUTH_PASSWORD: undefined, AUTH_SECRET: undefined });
    expect(a.authEnabled).toBe(false);
    expect(a.credentialsValid("tim", "secret")).toBe(false);
  });
});

describe("makeToken / tokenValid", () => {
  it("round-trips a freshly minted token", async () => {
    const a = await loadAuth({ ...CONFIGURED, AUTH_SECRET: "dedicated-secret" });
    const token = a.makeToken();
    expect(a.tokenValid(token)).toBe(true);
  });
  it("rejects a tampered or missing token", async () => {
    const a = await loadAuth({ ...CONFIGURED, AUTH_SECRET: "dedicated-secret" });
    const token = a.makeToken();
    expect(a.tokenValid(token + "tampered")).toBe(false);
    expect(a.tokenValid(undefined)).toBe(false);
  });
  it("rejects any token when there is no secret", async () => {
    const a = await loadAuth({ BASIC_AUTH_USER: undefined, BASIC_AUTH_PASSWORD: undefined, AUTH_SECRET: undefined });
    expect(a.tokenValid("anything")).toBe(false);
  });
  it("a token minted under one password does not validate after rotation", async () => {
    const a1 = await loadAuth({ BASIC_AUTH_USER: "tim", BASIC_AUTH_PASSWORD: "old", AUTH_SECRET: undefined });
    const stale = a1.makeToken();
    const a2 = await loadAuth({ BASIC_AUTH_USER: "tim", BASIC_AUTH_PASSWORD: "new", AUTH_SECRET: undefined });
    expect(a2.tokenValid(stale)).toBe(false);
  });
});
