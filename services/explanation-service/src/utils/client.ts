export function getClientId(req: Request): string {
  const header = req.headers.get('x-client-id')?.trim();
  if (header) return header;

  const forwarded = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip');
  const ip = forwarded?.split(',')[0]?.trim();
  if (ip) return `ip:${ip}`;

  return 'unknown';
}
