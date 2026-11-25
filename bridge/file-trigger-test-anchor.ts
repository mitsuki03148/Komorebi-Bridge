/** Test-only persistent stand-in for Keychain; stores SHA metadata in a temporary directory. */
import {readFileSync,writeFileSync} from 'node:fs';
import type {TriggerAnchor, TriggerAnchorState} from './file-trigger-store';
export function testAnchor(path:string): TriggerAnchor {
 const name = `${path}.mock-anchor`;
 return {read() { try { return JSON.parse(readFileSync(name,'utf8')) as TriggerAnchorState; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {committed:null,pending:null}; throw e; } },
 write(value) { writeFileSync(name,JSON.stringify(value)); }};
}
