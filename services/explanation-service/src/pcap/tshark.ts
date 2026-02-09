import { existsSync } from 'fs';

const isWindows = process.platform === 'win32';

export function resolveTsharkPath(): string | null {
  const envPath = process.env.TSHARK_PATH?.trim();
  if (envPath) return envPath;

  // Platform-specific candidate paths
  const candidates: string[] = isWindows
    ? [
        // Windows: Wireshark default install locations
        'C:\\Program Files\\Wireshark\\tshark.exe',
        'C:\\Program Files (x86)\\Wireshark\\tshark.exe',
        `${process.env.LOCALAPPDATA ?? ''}\\Programs\\Wireshark\\tshark.exe`,
      ].filter(Boolean)
    : [
        // macOS: App bundle and Homebrew locations
        '/Applications/Wireshark.app/Contents/MacOS/tshark',
        '/Applications/Wireshark.app/Contents/Resources/bin/tshark',
        '/opt/homebrew/bin/tshark',
        '/usr/local/bin/tshark',
        // Linux
        '/usr/bin/tshark',
      ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  // Try to find in PATH using platform-appropriate command
  try {
    const cmd = isWindows ? ['where', 'tshark'] : ['which', 'tshark'];
    const result = Bun.spawnSync(cmd);
    if (result.exitCode === 0) {
      const output = new TextDecoder().decode(result.stdout).trim();
      // 'where' on Windows may return multiple lines; take the first
      const firstLine = output.split(/\r?\n/)[0]?.trim();
      if (firstLine) return firstLine;
    }
  } catch {
    // Ignore errors from spawn
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
