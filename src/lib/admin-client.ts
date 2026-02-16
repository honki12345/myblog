const ADMIN_CSRF_COOKIE_NAME = "admin_csrf";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }

  const encodedName = `${encodeURIComponent(name)}=`;
  const parts = document.cookie.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(encodedName)) {
      continue;
    }
    return decodeURIComponent(trimmed.slice(encodedName.length));
  }
  return null;
}

export function getAdminCsrfToken(): string | null {
  return readCookie(ADMIN_CSRF_COOKIE_NAME);
}

export async function adminFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers ?? {});
  const isStateChanging =
    method !== "GET" && method !== "HEAD" && method !== "OPTIONS";

  if (isStateChanging) {
    const csrfToken = getAdminCsrfToken();
    if (csrfToken) {
      headers.set("x-csrf-token", csrfToken);
    }
  }

  return fetch(input, {
    ...init,
    headers,
    credentials: "same-origin",
  });
}
