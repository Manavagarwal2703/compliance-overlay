/** Turn raw HTTP error bodies into human-readable UI messages. */
export function formatApiError(status: number, body: string): string {
  if (status === 401) {
    return "Authentication failed. Please check your session.";
  }

  const trimmed = body.trim();
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed) as {
        error?: unknown;
        message?: unknown;
      };
      if (typeof parsed.error === "string" && parsed.error.trim()) {
        if (status === 401 || /unauthorized/i.test(parsed.error)) {
          return "Authentication failed. Please check your session.";
        }
        return parsed.error;
      }
      if (typeof parsed.message === "string" && parsed.message.trim()) {
        return parsed.message;
      }
    } catch {
      if (/unauthorized/i.test(trimmed)) {
        return "Authentication failed. Please check your session.";
      }
      return trimmed;
    }
  }

  return `Request failed (${status})`;
}
