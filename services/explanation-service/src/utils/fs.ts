import { mkdir } from 'fs/promises';

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export function getDataDir(): string {
  return process.env.KISAME_DATA_DIR ?? `${process.cwd()}/.data`;
}

export function getPcapDir(): string {
  return `${getDataDir()}/pcaps`;
}
