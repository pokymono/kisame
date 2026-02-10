const DEFAULT_CORS_ORIGIN = process.env.CORS_ORIGIN ?? '*';

function buildCorsHeaders(): HeadersInit {
  return {
    'access-control-allow-origin': DEFAULT_CORS_ORIGIN,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type, x-filename, x-client-id',
    'access-control-max-age': '86400',
  };
}

export function corsHeaders(): HeadersInit {
  return buildCorsHeaders();
}

function mergeHeaders(base: HeadersInit, override?: HeadersInit): Headers {
  const headers = new Headers(base);
  if (!override) return headers;
  const next = new Headers(override);
  next.forEach((value, key) => {
    headers.set(key, value);
  });
  return headers;
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = mergeHeaders(
    {
      'content-type': 'application/json; charset=utf-8',
      ...buildCorsHeaders(),
    },
    init.headers
  );
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers,
  });
}

export function noContent(init: ResponseInit = {}): Response {
  const headers = mergeHeaders(buildCorsHeaders(), init.headers);
  return new Response(null, { ...init, status: 204, headers });
}

export function utcNowIso(): string {
  return new Date().toISOString();
}
