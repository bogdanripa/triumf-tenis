// CORS for the public booking + schedule endpoints. These carry no cookies or
// credentials, so they are open to any origin.
export function isAllowedOrigin(_origin: string | null): boolean {
  return true;
}

export function corsHeaders(_origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}
