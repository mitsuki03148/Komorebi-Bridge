import { readFileSync, writeFileSync } from 'node:fs';
import type { Ticket } from './bench';
import type { GroupChat, TerminalRoom } from '../src/types/guild';
import { finalResult } from '../src/utils/attentionDiff';

/**
 * A task that came from a persona (奏, 墨 …) ends with a report that points at `<workspace>/Inbox/<persona>/<folder>/`.
 * When the group's lead posts such a report, the Bridge itself sends the clerk the "please notify <persona>" ticket,
 * so it does not depend on any agent remembering the step or asking for permission.
 */
export interface PersonaReport { persona: string; folder?: string; status: 'DONE' | 'STOP'; reason?: string; links: string[] }

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function legacyInboxTarget(text: string, root: string) {
  const where = new RegExp(`${escape(root)}/([^/\\s\`'"()（）]+)(?:/([^/\`\\n]+))?`).exec(text);
  if (!where) return;
  return { persona: where[1], ...(where[2] ? { folder: [root, where[1], where[2].trim()].join('/') } : {}) };
}

/** For a scoped completion the evidence field must name exactly one Inbox HANDOFF. */
function inboxHandoff(text: string, root: string) {
  const evidence = [...text.matchAll(/^[ \t]*(?:\*\*)?Evidence(?:\*\*)?[ \t]*[:：—–-][ \t]*(.+)$/gim)];
  if (evidence.length !== 1) return;
  const paths = new Set<string>();
  for (const match of evidence[0][1].matchAll(/`([^`\r\n]+)`|\]\(<([^<>\r\n]+)>\)|\]\((\/[^\s()]+)\)/g)) {
    const path = match[1] ?? match[2] ?? match[3];
    if (path.startsWith(root + '/') && path.endsWith('/HANDOFF.md')) paths.add(path);
  }
  if (paths.size !== 1) return;
  const path = [...paths][0];
  const parts = path.slice(root.length + 1).split('/');
  const persona = parts[0];
  if (parts.length < 3 || /[\s<>'"()（）]/.test(persona) ||
      parts.some(part => !part || part === '.' || part === '..' || /[`<>\\\x00-\x1f\x7f]/.test(part))) return;
  return { persona, folder: path.slice(0, -'/HANDOFF.md'.length) };
}

export function personaReport(text: string, inboxRoot: string): PersonaReport | undefined {
  const root = inboxRoot.replace(/\/+$/, '');
  const scoped = text.trimEnd().split(/\r?\n/).at(-1) === 'INBOX — DONE';
  const status = scoped ? 'DONE' : finalResult(text);
  if (status !== 'DONE' && status !== 'STOP') return;
  const reason = /^[ \t]*[-*]?[ \t]*\**Result\**[ \t]*[:：—–-][ \t]*(.+)$/im.exec(text)?.[1]?.replace(/\s+/g, ' ').trim();
  if (scoped && !/^DONE\b/i.test(reason ?? '')) return;
  const target = scoped ? inboxHandoff(text, root) : legacyInboxTarget(text, root);
  if (!target) return;
  const links = [...new Set((text.match(/https:\/\/(?:github\.com|drive\.google\.com|docs\.google\.com)\/[^\s`'"<>)）\]]+/g) ?? []).map(link => link.replace(/[.,;、。]+$/, '')))];
  return { ...target, status, ...(reason ? { reason: reason.slice(0, 160) } : {}), links };
}

/** The ticket body for the clerk. The authorisation line is there on purpose: the clerk must not stop to ask the Founder. */
export function personaTicket(report: PersonaReport, inboxRoot: string) {
  const line1 = report.status === 'DONE'
    ? '工程部郵差回報：工作已完成，請查看自己的inbox。❤️'
    : `工程部郵差回報：工作暫停（${report.status}）：${report.reason ?? '見 HANDOFF'}，請查看自己的inbox`;
  const place = report.folder ?? `${inboxRoot.replace(/\/+$/, '')}/${report.persona}/`;
  return {
    title: `通知 ${report.persona}：${report.status}`,
    body: [
      `Please notify ${report.persona} that the task is ${report.status}${report.reason ? `: ${report.reason}` : ''}.`,
      '',
      '**Authorisation (the Founder\'s standing authorisation, role-clerk "Persona completion notice"):** send this notice now. Do not ask the Founder for permission or for the wording. It covers only the persona named above, in the conversation that already exists, with the fixed text below. The Bridge line "sending outside needs Founder confirmation" does not apply to this notice.',
      '',
      'Use the `persona-completion-notify` skill. Fixed text:',
      '```text',
      line1,
      place,
      ...report.links,
      '```',
      '',
      'Return with `bench done` when the notice is confirmed sent. If you cannot find the conversation or the sending fails, do not guess: report STOP with the reason.',
    ].join('\n'),
  };
}

/** The reports already handled, kept in a small file so a restart does not send the same notice twice. */
export class HandledReports {
  private ids: string[] = [];
  constructor(private readonly path?: string) {
    if (path) try { const saved = JSON.parse(readFileSync(path, 'utf8')); if (Array.isArray(saved?.ids)) this.ids = saved.ids.filter((id: unknown): id is string => typeof id === 'string').slice(-300); } catch { /* Nothing saved yet. */ }
  }
  has(id: string) { return this.ids.includes(id); }
  add(id: string) {
    this.ids = [...this.ids.filter(known => known !== id), id].slice(-300);
    if (this.path) try { writeFileSync(this.path, JSON.stringify({ ids: this.ids }), { mode: 0o600 }); } catch { /* A failed save at worst repeats one notice after a restart. */ }
  }
}

/** Manual clerk work uses the same persona/folder identity, even after it is completed. */
export function manualPersonaNotice(report: PersonaReport, group: GroupChat, tickets: readonly Ticket[], room: (id: string) => TerminalRoom | undefined) {
  if (!report.folder) return;
  const folder = new RegExp(`(?:^|[\\s\\x60'"(<:：])${escape(report.folder)}(?:/HANDOFF\\.md)?/?(?=$|[\\s\\x60'">)\\]。，,;:：])`);
  return tickets.find(ticket => {
    if (ticket.kind !== 'task' || ticket.purpose || ticket.groupId !== group.id || ticket.cancelledAt || ticket.expiredAt || ticket.worktree?.state === 'failed') return false;
    const outcome = finalResult(ticket.note ?? '');
    if (outcome === 'STOP' || outcome === 'INCOMPLETE') return false;
    const clerk = ticket.route?.roleKey === 'clerk' || group.members.some(member => member.role?.key === 'clerk' &&
      (ticket.to.sessionId === member.roomId || ticket.to.sessionId === room(member.roomId)?.sessionId || ticket.fixed?.toRoomId === member.roomId));
    return clerk && /\bnotify\b|通知/i.test(ticket.body) && folder.test(ticket.body);
  });
}

export interface PersonaNoticeDeps {
  inboxRoot: string;
  /** Reports older than this (the Bridge's start) are ignored, so a restart never replays an old report. */
  since: number;
  groups(): GroupChat[];
  room(roomId: string): TerminalRoom | undefined;
  /** Retained group tasks, including completed manual notifications. */
  tickets(groupId: string): readonly Ticket[];
  handled: Pick<HandledReports, 'has' | 'add'>;
  /** Start a bounded, read-only Inbox inventory before the clerk is notified. */
  beforeNotice?: (report: PersonaReport) => void;
  /** Sends the ticket from the lead to `@clerk` of the group. Returns a message when it was refused. */
  send(group: GroupChat, lead: TerminalRoom, ticket: { title: string; body: string }): { sent: true; roomId?: string } | { sent: false; why: string };
  tell(lead: TerminalRoom, text: string): void;
}

/** Look at each group's lead: a new report that names an Inbox folder becomes one clerk ticket. Returns what was sent. */
export function sendPersonaNotices(deps: PersonaNoticeDeps) {
  const sent: { group: string; persona: string; status: string; roomId?: string }[] = [];
  for (const group of deps.groups()) {
    const lead = group.orchestratorRoomId ? deps.room(group.orchestratorRoomId) : undefined;
    if (!lead) continue;
    const entry = lead.logs.findLast(item => item.sender === 'agent');
    if (!entry || deps.handled.has(entry.id)) continue;
    const at = Date.parse(entry.createdAt ?? '');
    if (!Number.isFinite(at) || at < deps.since) continue;
    const report = personaReport(entry.text, deps.inboxRoot);
    if (!report) continue;
    const identity = report.folder ? `persona:${JSON.stringify([report.persona, report.folder, report.status])}` : undefined;
    if (identity && deps.handled.has(identity)) { deps.handled.add(entry.id); continue; }
    const manual = manualPersonaNotice(report, group, deps.tickets(group.id), deps.room);
    if (manual) {
      deps.handled.add(entry.id);
      deps.tell(lead, `已有人手通知 #${manual.id}，Bridge 唔再重派。`);
      continue;
    }
    try { deps.beforeNotice?.(report); } catch { /* A scan must never block the notice. */ }
    deps.handled.add(entry.id);
    const ticket = personaTicket(report, deps.inboxRoot);
    const result = deps.send(group, lead, ticket);
    if (result.sent) {
      if (identity) deps.handled.add(identity);
      sent.push({ group: group.name, persona: report.persona, status: report.status, roomId: result.roomId });
    }
    else deps.tell(lead, `要通知 ${report.persona}（${report.status}），但派唔到文員：${result.why}。請 Founder 處理或自己通知。`);
  }
  return sent;
}
