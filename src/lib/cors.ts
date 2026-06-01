// Cross-origin support for the public booking endpoint. The browser form lives
// on https://triumf-tenis.ro, a different origin than this Vercel deployment,
// so responses must carry CORS headers scoped to the allowed origin(s).
//
// Override the allowlist with the ALLOWED_ORIGINS env var (comma-separated).
const DEFAULT_ALLOWED = [
  'https://triumf-tenis.ro',
  'https://www.triumf-tenis.ro',
  'http://localhost:3000',
];

function allowedOrigins(): string[] {
  const env = process.env.ALLOWED_ORIGINS;
  if (env) return env.split(',').map((s) => s.trim()).filter(Boolean);
  return DEFAULT_ALLOWED;
}

export function isAllowedOrigin(origin: string | null): boolean {
  return !!origin && allowedOrigins().includes(origin);
}

// Headers to attach to every response from the endpoint. Access-Control-Allow-
// Origin can't be a list, so we echo the request origin when it's allowed.
export function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
  if (isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin as string;
  }
  return headers;
}
