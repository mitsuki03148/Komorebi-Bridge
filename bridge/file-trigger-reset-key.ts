import type { KeychainRead } from './file-trigger-keychain';

/** Reset only after an explicit authenticated client action. The caller supplies the only key operations. */
export function resetWithKey<T extends { readable: boolean; stalePreview(): unknown; resetInvalid(): boolean }>(deps: {
  read(): KeychainRead; provisionMissing(): KeychainRead; createStore(key: Buffer): T;
}): T {
  let key = deps.read();
  if (key.state === 'missing') key = deps.provisionMissing();
  // A locked, denied, malformed, or unavailable Keychain item is never replaced.
  if (key.state !== 'available') throw new Error('無法讀取或建立 Keychain 金鑰。');
  const store = deps.createStore(key.key);
  if (store.readable || store.stalePreview()) throw new Error('設定有效，不能用無效設定重置。');
  if (!store.resetInvalid()) throw new Error('無法重新設定；請檢查 Keychain 及設定檔。');
  return store;
}
