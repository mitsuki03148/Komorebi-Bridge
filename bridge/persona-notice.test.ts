import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { GroupChat, TerminalRoom } from '../src/types/guild'
import { reportIsDone } from '../src/utils/attentionDiff'
import { HandledReports, personaReport, personaTicket, sendPersonaNotices } from './persona-notice'

const root = '/Volumes/Komorebi/Inbox'
const report = (extra = '', status = 'DONE') => `Result: ${status} 已完成。\nEvidence: \`${root}/奏/2026-11-19-music fix/HANDOFF.md\`\n${extra}\nRESULT — ${status}`

test('a lead report that names an Inbox folder gives the persona, the folder, the status and the links', () => {
  const found = personaReport(report('https://github.com/example-org/example-repo/commit/abc123.'), root)!
  assert.equal(found.persona, '奏')
  assert.equal(found.folder, `${root}/奏/2026-11-19-music fix`)
  assert.equal(found.status, 'DONE')
  assert.deepEqual(found.links, ['https://github.com/example-org/example-repo/commit/abc123'])
  assert.equal(personaReport(report('', 'STOP'), root)!.status, 'STOP')
  assert.equal(personaReport('Result: DONE\nEvidence: `/repo/Review/X/HANDOFF.md`\nRESULT — DONE', root), undefined, 'no Inbox path: not a persona task')
  assert.equal(personaReport(`見 ${root}/奏/x/HANDOFF.md`, root), undefined, 'a path without the closing report line is not a report')
})

test('the clerk ticket carries the standing authorisation and the fixed text for the status', () => {
  const done = personaTicket(personaReport(report(), root)!, root)
  assert.match(done.title, /通知 奏：DONE/)
  assert.match(done.body, /Do not ask the Founder for permission/)
  assert.match(done.body, /工程部郵差回報：工作已完成，請查看自己的inbox/)
  assert.ok(done.body.includes(`${root}/奏/2026-11-19-music fix`))
  const stop = personaTicket(personaReport(report('', 'STOP'), root)!, root)
  assert.match(stop.body, /工程部郵差回報：工作暫停（STOP）：.*請查看自己的inbox/)
})

const room = (id: string, text?: string, createdAt = new Date(Date.now() + 1000).toISOString()): TerminalRoom =>
  ({ id, roomName: id, modelId: 'CODEX', logs: text ? [{ id: `${id}-1`, sender: 'agent', text, timestamp: '', createdAt }] : [] }) as unknown as TerminalRoom
const group = { id: 'g', name: 'G', createdAt: '', orchestratorRoomId: 'lead', members: [{ modelId: 'CODEX', roomId: 'lead' }, { modelId: 'CODEX', roomId: 'clerk', role: { key: 'clerk' } }] } as GroupChat

function setup(lead: TerminalRoom, send?: (...args: any[]) => any) {
  const tickets: { title: string; body: string }[] = []
  const told: string[] = []
  const handled = new Set<string>()
  const deps = {
    inboxRoot: root, since: Date.now() - 60_000, groups: () => [group], room: (id: string) => id === 'lead' ? lead : undefined,
    handled: { has: (id: string) => handled.has(id), add: (id: string) => void handled.add(id) },
    send: send ?? ((_g: GroupChat, _l: TerminalRoom, ticket: { title: string; body: string }) => { tickets.push(ticket); return { sent: true as const, roomId: 'clerk' } }),
    tell: (_l: TerminalRoom, text: string) => void told.push(text),
  }
  return { deps, tickets, told }
}

test('one report makes one clerk ticket, and the same report is never sent again', () => {
  const { deps, tickets } = setup(room('lead', report()))
  assert.equal(sendPersonaNotices(deps).length, 1)
  assert.equal(tickets.length, 1)
  assert.equal(sendPersonaNotices(deps).length, 0, 'handled')
  assert.equal(tickets.length, 1)
})

test('a bounded inventory is started before dispatch, and scan setup failure does not block the clerk', () => {
  const order: string[] = [];
  const { deps } = setup(room('lead', report()), () => { order.push('send'); return { sent: true as const }; });
  const result = sendPersonaNotices({ ...deps, beforeNotice: () => { order.push('scan'); throw new Error('unavailable'); } });
  assert.deepEqual(order, ['scan', 'send']);
  assert.equal(result.length, 1);
});

test('INCOMPLETE never makes a clerk ticket, and a later completed report sends once', () => {
  // #2011: the preceding ticket had closed and the next validation ticket was not open yet.
  const lead = room('lead', report('', 'INCOMPLETE'))
  const { deps, tickets, told } = setup(lead)
  assert.deepEqual(sendPersonaNotices(deps), [])
  assert.deepEqual(sendPersonaNotices(deps), [], 'the maintenance tick cannot ship the progress note')
  assert.equal(tickets.length, 0)
  assert.equal(told.length, 0)
  lead.logs.push({ ...lead.logs[0], id: 'lead-final', text: report() })
  assert.equal(sendPersonaNotices(deps).length, 1)
  assert.equal(tickets[0].title, '通知 奏：DONE')
  assert.deepEqual(sendPersonaNotices(deps), [])
})

test('the final status governs dispatch and mentions in the report body do not count', () => {
  const incomplete = report('Member verdict: RESULT — DONE', 'INCOMPLETE')
  assert.equal(personaReport(incomplete, root), undefined)
  const quoted = report().replace('RESULT — DONE', 'The earlier reply said RESULT — DONE.')
  assert.deepEqual(sendPersonaNotices(setup(room('lead', quoted)).deps), [])
  const stop = setup(room('lead', report('Earlier status: RESULT — INCOMPLETE', 'STOP')))
  assert.equal(sendPersonaNotices(stop.deps).length, 1, 'an explicit final STOP remains a pause notice')
  assert.equal(stop.tickets[0].title, '通知 奏：STOP')
})

test('an explicit Inbox closeout creates one clerk ticket without a room-wide DONE', () => {
  const folder = `${root}/律/task/first-download`
  const message = `**Result** — DONE，首下載。\n**Evidence** — [正式 HANDOFF](<${folder}/HANDOFF.md>)\n**Next** — #2072 continues.\n\nINBOX — DONE`
  assert.equal(reportIsDone(message), false, 'a DONE in the Result field cannot cancel #2072')
  const { deps, tickets } = setup(room('lead', message))
  assert.equal(sendPersonaNotices(deps).length, 1)
  assert.equal(tickets[0].title, '通知 律：DONE')
  assert.match(tickets[0].body, /Inbox\/律\/task\/first-download/)
  assert.deepEqual(sendPersonaNotices(deps), [])
})

test('an Inbox closeout needs the exact final line and one scoped HANDOFF in Evidence', () => {
  const message = report().replace('RESULT — DONE', 'INBOX — DONE')
  assert.equal(personaReport(message, root)?.persona, '奏')
  assert.equal(personaReport(message.replace('Result: DONE', 'Result: INCOMPLETE'), root), undefined)
  assert.equal(personaReport(message.replace('INBOX — DONE', 'Quote: INBOX — DONE'), root), undefined)
  assert.equal(personaReport(message + '\n仍在驗證', root), undefined)
  assert.equal(personaReport(message.replace('Evidence:', 'Next:'), root), undefined)
  assert.equal(personaReport(message.replace('2026-11-19-music fix/', '../'), root), undefined)
  assert.equal(personaReport(message.replace('HANDOFF.md`', `HANDOFF.md\` \`${root}/律/other/HANDOFF.md\``), root), undefined)
  assert.equal(personaReport(message.replace('HANDOFF.md', 'notes.md'), root), undefined)
})

test('an old report, a lead with no persona path and a room with no report send nothing', () => {
  assert.equal(sendPersonaNotices(setup(room('lead', report(), '2020-01-01T00:00:00Z')).deps).length, 0, 'older than the Bridge start')
  assert.equal(sendPersonaNotices(setup(room('lead', 'Result: DONE\nRESULT — DONE')).deps).length, 0)
  assert.equal(sendPersonaNotices(setup(room('lead')).deps).length, 0)
})

test('when no clerk can take it, the lead and the Founder are told and the report is not retried forever', () => {
  const { deps, told } = setup(room('lead', report()), () => ({ sent: false as const, why: '@clerk 暫無合資格房' }))
  assert.equal(sendPersonaNotices(deps).length, 0)
  assert.equal(told.length, 1)
  assert.match(told[0], /通知 奏.*派唔到文員/)
  assert.equal(sendPersonaNotices(deps).length, 0)
  assert.equal(told.length, 1, 'told once')
})

test('handled reports survive a restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'persona-'))
  try {
    const file = join(dir, 'handled.json')
    new HandledReports(file).add('r1')
    assert.equal(new HandledReports(file).has('r1'), true)
    assert.equal(new HandledReports(file).has('r2'), false)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
