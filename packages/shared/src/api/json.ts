export const jsonResponse = (payload: unknown, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json; charset=utf-8");
  }
  return new Response(JSON.stringify(payload, null, 2), {
    ...init,
    headers,
  });
};

export const methodNotAllowed = (allowed: string[]) =>
  jsonResponse(
    {
      ok: false,
      error: "method_not_allowed",
      allowed,
    },
    {
      status: 405,
      headers: {
        Allow: allowed.join(", "),
      },
    }
  );

export const parseJsonBody = async <T>(request: Request): Promise<T | null> => {
  try {
    const value = (await request.json()) as T;
    return value;
  } catch {
    return null;
  }
};
