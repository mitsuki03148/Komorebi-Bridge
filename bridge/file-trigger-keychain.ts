import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { TriggerAnchor, TriggerAnchorState } from './file-trigger-store';

export const fileTriggerKeychainService = 'komorebi-file-trigger-hmac';
export const fileTriggerKeychainAccount = 'komorebi';
export type KeychainRead = { state: 'available'; key: Buffer } | { state: 'missing' | 'unavailable' };
type Item = { version: 1; key: string; committed: string | null; pending: string | null };
const validHash = (value: unknown): value is string | null => value === null || (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value));
function readItem(): { state: 'available'; item: Item } | { state: 'missing' | 'unavailable' } {
 if (process.platform !== 'darwin') return {state:'unavailable'};
 try {
  const value = execFileSync('/usr/bin/security', ['find-generic-password','-a',fileTriggerKeychainAccount,'-s',fileTriggerKeychainService,'-w'], {encoding:'utf8',timeout:5000,stdio:['ignore','pipe','ignore']}).trim();
  // Old HMAC-only item has no pinned SHA. Its existing config needs explicit confirmation.
  if (/^[a-f0-9]{64}$/.test(value)) return {state:'available',item:{version:1,key:value,committed:null,pending:null}};
  const item: unknown = JSON.parse(value);
  if (!item || typeof item !== 'object') return {state:'unavailable'};
  const candidate = item as Item;
  if (candidate.version !== 1 || !/^[a-f0-9]{64}$/.test(candidate.key) || !validHash(candidate.committed) || !validHash(candidate.pending)) return {state:'unavailable'};
  return {state:'available',item:candidate};
 } catch (error) { return {state:(error as {status?:number}).status === 44 ? 'missing' : 'unavailable'}; }
}
function writeItem(item: Item, update: boolean): void {
 // Only validated hex and null fields enter interactive security's stdin. No secret goes in argv or log.
 const serialized = JSON.stringify(item);
 const line = `add-generic-password ${update ? '-U ' : ''}-a ${fileTriggerKeychainAccount} -s ${fileTriggerKeychainService} -w '${serialized}'\n`;
 const result = spawnSync('/usr/bin/security',['-i'],{input:line,encoding:'utf8',timeout:5000,stdio:['pipe','ignore','ignore']});
 if (result.error || result.status !== 0) throw Error('Keychain update failed');
 const checked = readItem();
 if (checked.state !== 'available' || JSON.stringify(checked.item) !== serialized) throw Error('Keychain update could not be verified');
}
export function readFileTriggerKey(): KeychainRead {
 const result = readItem(); return result.state === 'available' ? {state:'available',key:Buffer.from(result.item.key,'hex')} : result;
}
/** Binds anchor operations to one HMAC key; wrong/missing key fails closed. */
export function fileTriggerKeychainAnchor(key: Buffer): TriggerAnchor {
 const current = () => {
  const result = readItem();
  if (result.state !== 'available') throw Error('Keychain unavailable');
  const got = Buffer.from(result.item.key,'hex');
  if (key.length !== got.length || !timingSafeEqual(key,got)) throw Error('Keychain key changed');
  return result.item;
 };
 return {
  read() { const item = current(); return {committed:item.committed,pending:item.pending}; },
  write(value: TriggerAnchorState) {
   if (!validHash(value.committed) || !validHash(value.pending)) throw Error('Invalid anchor');
   const item = current(); writeItem({...item,committed:value.committed,pending:value.pending},true);
  },
 };
}
/** Only explicit setup with no existing configuration can create the dedicated Keychain item. */
export function provisionFileTriggerKey(configAbsent: boolean): KeychainRead {
 if (!configAbsent) return {state:'unavailable'};
 return createMissingFileTriggerKey();
}

/** Only call after the user explicitly confirms recovery; never replaces an existing item. */
export function provisionFileTriggerResetKey(): KeychainRead { return createMissingFileTriggerKey(); }

function createMissingFileTriggerKey(): KeychainRead {
 if (process.platform !== 'darwin') return {state:'unavailable'};
 const prior = readFileTriggerKey(); if (prior.state !== 'missing') return prior;
 const key = randomBytes(32);
 try { writeItem({version:1,key:key.toString('hex'),committed:null,pending:null},false); return {state:'available',key}; }
 catch { return {state:'unavailable'}; }
}
