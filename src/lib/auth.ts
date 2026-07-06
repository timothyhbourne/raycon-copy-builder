import { createHmac, timingSafeEqual } from "crypto";

// Shared auth logic for the login route handler and the proxy. Credentials come
// from env; a successful login sets a signed HttpOnly cookie whose value is an
// HMAC the proxy re-derives and compares. Without the secret the token can't be
// forged, so possession of a valid cookie proves a prior correct login.

const USER = process.env.BASIC_AUTH_USER;
const PASSWORD = process.env.BASIC_AUTH_PASSWORD;

// Dedicated secret if provided, else derive one from the credentials so the
// gate works with zero extra config. Rotating the password invalidates cookies.
const SECRET =
  process.env.AUTH_SECRET || (USER && PASSWORD ? `${USER}:${PASSWORD}` : "");

export const AUTH_COOKIE = "rc_auth";
export const AUTH_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

// Gate is active only when both credentials are configured.
export const authEnabled = Boolean(USER && PASSWORD);

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function credentialsValid(user: string, pass: string) {
  if (!USER || !PASSWORD) return false;
  // Evaluate both to keep timing uniform.
  const okUser = safeEqual(user, USER);
  const okPass = safeEqual(pass, PASSWORD);
  return okUser && okPass;
}

export function makeToken() {
  return createHmac("sha256", SECRET).update(`v1:${USER}`).digest("base64url");
}

export function tokenValid(token: string | undefined) {
  if (!token || !SECRET) return false;
  return safeEqual(token, makeToken());
}
