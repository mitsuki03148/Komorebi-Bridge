import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

export const keychainAccount = 'komorebi';
export const keychainService = 'komorebi-pairing-key';
const minimumLength = 24;

type Reader = () => Promise<string | undefined>;

/** Reads the fixed pairing key from the macOS login Keychain without printing it. */
export const readKeychainKey: Reader = async () => {
  if (process.platform !== 'darwin') return undefined;
  try {
    const { stdout } = await promisify(execFile)('security',
      ['find-generic-password', '-a', keychainAccount, '-s', keychainService, '-w'], { timeout: 5_000 });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
};

export type PairingSource = 'environment' | 'keychain' | 'random';

/**
 * Environment wins, then Keychain, then a per-start random key.
 * A fixed key keeps paired phones connected across Bridge restarts.
 */
export async function resolvePairingKey(env: string | undefined, readKeychain: Reader = readKeychainKey) {
  if (env) {
    if (env.length < minimumLength) throw new Error(`KOMOREBI_PAIRING_KEY 須至少 ${minimumLength} 個字元。`);
    return { key: env, source: 'environment' as PairingSource };
  }
  const stored = await readKeychain();
  if (stored && stored.length >= minimumLength) return { key: stored, source: 'keychain' as PairingSource };
  return {
    key: randomBytes(18).toString('base64url'),
    source: 'random' as PairingSource,
    warning: stored ? `Keychain「${keychainService}」的配對碼少過 ${minimumLength} 個字元，這次改用隨機配對碼。` : undefined,
  };
}

export function pairingBanner(source: PairingSource, key: string) {
  if (source === 'keychain') return `iPhone 配對碼 · 使用 Mac Keychain「${keychainService}」（固定，不會顯示）`;
  if (source === 'environment') return 'iPhone 配對碼 · 使用 KOMOREBI_PAIRING_KEY（固定，不會顯示）';
  return `iPhone 配對碼 · ${key}（今次啟動隨機產生；想固定可存入 Mac Keychain「${keychainService}」）`;
}
