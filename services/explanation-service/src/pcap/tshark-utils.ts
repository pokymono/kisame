export function safeInt(v: string | undefined): number | null {
  if (!v) return null;
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) ? n : null;
}

export function safeFloat(v: string | undefined): number | null {
  if (!v) return null;
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function sha1Hex12(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const hash = Bun.CryptoHasher ? new (Bun as any).CryptoHasher('sha1').update(bytes).digest('hex') : null;
  if (hash) return String(hash).slice(0, 12);
  let acc = 0;
  for (const b of bytes) acc = (acc * 31 + b) >>> 0;
  return acc.toString(16).padStart(8, '0').slice(0, 8);
}

export function canonicalEndpoint(ip: string, port: number | null): { ip: string; port: number | null } {
  return { ip, port };
}

export function canonicalPair(
  srcIp: string,
  srcPort: number | null,
  dstIp: string,
  dstPort: number | null
): { a: { ip: string; port: number | null }; b: { ip: string; port: number | null } } {
  const aKey = `${srcIp}:${srcPort ?? -1}`;
  const bKey = `${dstIp}:${dstPort ?? -1}`;
  if (aKey <= bKey) return { a: canonicalEndpoint(srcIp, srcPort), b: canonicalEndpoint(dstIp, dstPort) };
  return { a: canonicalEndpoint(dstIp, dstPort), b: canonicalEndpoint(srcIp, srcPort) };
}
