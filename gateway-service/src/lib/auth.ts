import { createHmac, timingSafeEqual } from "crypto";

// ---------------------------------------------------------------------------
// JWT_SECRET — HS256 signing secret.
// Required when REQUIRE_AUTH=true. Must be at least 32 characters.
// Generate a suitable secret with:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
// ---------------------------------------------------------------------------
const JWT_SECRET = process.env.JWT_SECRET ?? "";

// ---------------------------------------------------------------------------
// verifyJwt
// ---------------------------------------------------------------------------
// Minimal, zero-dependency HS256 JWT verifier built on Node.js crypto.
// Returns the decoded payload on success, or throws a descriptive Error.
//
// Limitations (intentional for simplicity):
//   - Only HS256 algorithm is accepted.
//   - `exp` is validated if present; `nbf` and `iat` are not.
//   - No JWKS / asymmetric key support — production systems that need RS256
//     should replace this with the `jose` npm package.
// ---------------------------------------------------------------------------

type JwtPayload = {
  sub?: string;
  userId?: string;
  exp?: number;
  [key: string]: unknown;
};

function base64urlDecode(input: string): string {
  // Convert base64url → base64 standard, then decode as UTF-8
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function base64urlDecodeBytes(input: string): Buffer {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64");
}

export function verifyJwt(token: string): JwtPayload {
  if (!JWT_SECRET) {
    throw new Error(
      "JWT_SECRET is not configured. Set it in gateway-service/.env before enabling REQUIRE_AUTH."
    );
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed JWT: expected 3 dot-separated segments.");
  }

  const [rawHeader, rawPayload, rawSignature] = parts;

  // ── Verify header ──────────────────────────────────────────────────────────
  let header: { alg?: string; typ?: string };
  try {
    header = JSON.parse(base64urlDecode(rawHeader)) as { alg?: string; typ?: string };
  } catch {
    throw new Error("JWT header is not valid JSON.");
  }

  if (header.alg !== "HS256") {
    throw new Error(`Unsupported JWT algorithm: ${header.alg ?? "none"}. Only HS256 is accepted.`);
  }

  // ── Verify signature ───────────────────────────────────────────────────────
  const signingInput = `${rawHeader}.${rawPayload}`;
  const expectedSig = createHmac("sha256", JWT_SECRET).update(signingInput).digest();
  const receivedSig = base64urlDecodeBytes(rawSignature);

  if (
    expectedSig.length !== receivedSig.length ||
    !timingSafeEqual(expectedSig, receivedSig)
  ) {
    throw new Error("JWT signature verification failed.");
  }

  // ── Decode payload ─────────────────────────────────────────────────────────
  let payload: JwtPayload;
  try {
    payload = JSON.parse(base64urlDecode(rawPayload)) as JwtPayload;
  } catch {
    throw new Error("JWT payload is not valid JSON.");
  }

  // ── Validate expiry ────────────────────────────────────────────────────────
  if (typeof payload.exp === "number" && Date.now() / 1000 > payload.exp) {
    throw new Error("JWT has expired.");
  }

  return payload;
}

// ---------------------------------------------------------------------------
// extractUserId
// ---------------------------------------------------------------------------
// Pulls userId from a verified JWT payload, checking common claim names in
// order of preference: `userId` (custom claim) → `sub` (OIDC standard).
// ---------------------------------------------------------------------------
export function extractUserId(payload: JwtPayload): string {
  const id =
    typeof payload.userId === "string"
      ? payload.userId
      : typeof payload.sub === "string"
      ? payload.sub
      : "";

  if (!id) {
    throw new Error(
      "JWT payload does not contain a userId or sub claim."
    );
  }
  return id;
}
