/**
 * Decode the payload portion of a JWT without verification.
 * Used only for display name extraction — not for auth decisions.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = atob(padded);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Extract a display name from common JWT claim fields. */
export function extractUserNameFromJwt(token: string): string | null {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;

  const candidate =
    payload.name ?? payload.userName ?? payload.userId ?? payload.sub;

  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : null;
}
