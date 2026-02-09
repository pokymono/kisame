import { existsSync } from 'fs';

export function resolveTsharkPath(): string | null {
  const envPath = process.env.TSHARK_PATH?.trim();
  if (envPath) return envPath;

  const candidates = [
    '/Applications/Wireshark.app/Contents/MacOS/tshark',
    '/Applications/Wireshark.app/Contents/Resources/bin/tshark',
    '/opt/homebrew/bin/tshark',
    '/usr/local/bin/tshark',
    '/usr/bin/tshark',
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  try {
    const which = Bun.spawnSync(['which', 'tshark']);
    if (which.exitCode === 0) {
      const output = new TextDecoder().decode(which.stdout).trim();
      if (output) return output;
    }
  } catch {
  }

  return null;
}

export async function tsharkVersion(tsharkPath: string | null): Promise<string | null> {
  if (!tsharkPath) return null;
  try {
    const proc = Bun.spawn([tsharkPath, '--version'], { stdout: 'pipe', stderr: 'pipe' });
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    const firstLine = text.split('\n')[0]?.trim();
    return firstLine || null;
  } catch {
    return null;
  }
}

export async function getTsharkInfo(): Promise<{
  tshark_path: string | null;
  tshark_version: string | null;
  resolved: boolean;
}> {
  const tsharkPath = resolveTsharkPath();
  const version = await tsharkVersion(tsharkPath);
  return { tshark_path: tsharkPath, tshark_version: version, resolved: Boolean(tsharkPath) };
}
