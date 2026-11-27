import { useEffect, useRef, useState } from 'react';
import type { CharacterProfile, TerminalRoom } from '../types/guild';
import { getLang, localeOf, t } from '../i18n';

/** One shared status vocabulary for room lists, rails and sidebars. */
export function roomStatusLabel(room: TerminalRoom) {
  if (room.pendingApproval) return t('room.status.approval');
  if (!room.live) return t('room.status.off');
  if (room.menu) return t('room.status.menu');
  const background = Boolean(room.backgroundTasks);
  if (room.ready) return t(background ? 'room.status.readyBackground' : 'room.status.ready');
  return t(background ? 'room.status.background' : 'room.status.working');
}

/** Why the composer cannot send a normal prompt right now, if it cannot. */
export function composerBlock(room: TerminalRoom): string | undefined {
  if (!room.live) return t('room.block.off');
  if (room.pendingApproval || room.menu) return undefined;
  // An open input box accepts a prompt mid-turn; older Bridges do not report it.
  if (!room.ready && !room.steerable) return t('room.block.working');
  return undefined;
}

/** A prompt can resume a known group session without giving commands or menu choices a new route. */
export function groupPromptCanResume(room: TerminalRoom, text: string) {
  return !room.live && Boolean(room.sessionId && room.resumable && room.repoPath) &&
    !room.pendingApproval && !room.pendingQuestion && !room.menu && !text.trim().startsWith('/');
}

/** Commands need the CLI at its prompt, even when plain prompts and images can steer it. */
export function atPromptOnlyBlock(room: TerminalRoom, text: string): string | undefined {
  if (room.ready || room.pendingApproval || room.menu) return undefined;
  if (text.trim().startsWith('/')) return t('room.block.command');
  return undefined;
}

export function composerHint(room: TerminalRoom): string | undefined {
  if (room.pendingApproval) return t('room.hint.approval');
  if (room.menu) return t('room.hint.menu');
  // A steerable, working room shows no hint: the line appeared and vanished on every state change and made the footer jump.
  if (room.live && !room.ready && room.steerable) return undefined;
  return composerBlock(room);
}

/** Controls that only make sense when the CLI is at its prompt. */
export function roomCapabilities(room: TerminalRoom, pending = false) {
  const atPrompt = room.live && room.ready && !room.pendingApproval && !pending;
  return {
    compact: atPrompt,
    settings: room.live && !pending,
    reason: !room.live ? t('room.reason.off') : !room.ready ? t('room.reason.working') : room.pendingApproval ? t('room.reason.approval') : undefined,
  };
}

export function formatPct(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? '—' : `${Math.round(value)}%`;
}

export const weeklyQuota = (character: CharacterProfile) => character.mpWeekly.current;
export const fiveHourQuota = (character: CharacterProfile) => character.hp5h.current;

export function formatClock(value: string | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (!/\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(date.getTime())) return value;
  const now = new Date();
  const locale = localeOf(getLang());
  const time = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
  if (date.toDateString() === now.toDateString()) return time;
  if (getLang() === 'zh') return `${date.getMonth() + 1}/${date.getDate()} ${time}`;
  return `${new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric' }).format(date)} ${time}`;
}

/** Layers that listen for Escape, oldest first. Only the newest one reacts, so a confirm box does not close the panel under it. */
const escapeLayers: { current: () => void }[] = [];
let escapeListening = false;
const escapeKey = (event: KeyboardEvent) => { if (event.key === 'Escape') escapeLayers.at(-1)?.current(); };

export function useEscape(active: boolean, onEscape: () => void) {
  const latest = useRef(onEscape);
  latest.current = onEscape;
  useEffect(() => {
    if (!active) return;
    escapeLayers.push(latest);
    if (!escapeListening) { document.addEventListener('keydown', escapeKey); escapeListening = true; }
    return () => {
      const at = escapeLayers.indexOf(latest);
      if (at >= 0) escapeLayers.splice(at, 1);
      if (!escapeLayers.length) { document.removeEventListener('keydown', escapeKey); escapeListening = false; }
    };
  }, [active]);
}

export function readPreference(key: string, fallback: boolean) {
  try { const value = localStorage.getItem(key); return value == null ? fallback : value === '1'; } catch { return fallback; }
}
export function writePreference(key: string, value: boolean) {
  try { localStorage.setItem(key, value ? '1' : '0'); } catch { /* storage unavailable */ }
}

/** Copies text with a selection fallback for browsers (iOS Safari over HTTP) without the async Clipboard API. */
export async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back to selection */ }
  }
  const input = document.createElement('textarea');
  input.value = text;
  input.readOnly = true;
  input.style.cssText = 'position:fixed;left:-9999px;top:0;font-size:16px';
  document.body.appendChild(input);
  try {
    input.focus({ preventScroll: true });
    input.select();
    input.setSelectionRange(0, input.value.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    input.remove();
  }
}

/** Keep copy feedback tied to the most recent click, including when clipboard permission takes time. */
export function useCopyFeedback(durationMs: number) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const attempt = useRef(0);

  useEffect(() => () => {
    attempt.current += 1;
    clearTimeout(timer.current);
  }, []);

  const copy = async (text: string) => {
    const current = ++attempt.current;
    clearTimeout(timer.current);
    setStatus('idle');
    const ok = await copyText(text);
    if (current !== attempt.current) return;
    setStatus(ok ? 'copied' : 'error');
    timer.current = setTimeout(() => setStatus('idle'), durationMs);
  };

  return { copy, status };
}

/** "11:59 · 約 1 小時 5 分後" for today, "11/14 08:30 · 約 1 日 13 小時後" for later days; empty when unknown. */
export function formatReset(resetsAt: number | null | undefined, now = Date.now()) {
  if (resetsAt == null || !Number.isFinite(resetsAt)) return '';
  const when = new Date(resetsAt);
  const clock = when.toLocaleTimeString(localeOf(getLang()), { hour: '2-digit', minute: '2-digit', hour12: false });
  const sameDay = when.toDateString() === new Date(now).toDateString();
  const label = sameDay ? clock : `${when.getMonth() + 1}/${when.getDate()} ${clock}`;
  const minutes = Math.round((resetsAt - now) / 60_000);
  if (minutes <= 0) return t('time.reset.soon', { label });
  const days = Math.floor(minutes / 1440), hours = Math.floor((minutes % 1440) / 60), rest = minutes % 60;
  const part = (key: 'time.unit.day' | 'time.unit.hour' | 'time.unit.minute' | 'time.unit.minutes', n: number) => t(key, { n });
  const remaining = days > 0 ? `${part('time.unit.day', days)}${hours ? ` ${part('time.unit.hour', hours)}` : ''}` : hours > 0 ? `${part('time.unit.hour', hours)}${rest ? ` ${part('time.unit.minute', rest)}` : ''}` : part('time.unit.minutes', rest);
  return t('time.reset.about', { label, remaining });
}

const cap = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** The reset-voucher potion on the control bar shows only while there is at least one voucher; with none (or no count known) it is hidden. */
export const hasResetVouchers = (character: { hp5h: { resetVouchers?: number | null } }) => typeof character.hp5h.resetVouchers === 'number' && character.hp5h.resetVouchers > 0;

/** The model name as it fits on the control bar: Codex's "GPT-6.1-Sol" becomes "6.1 Sol" and "GPT-6 Astra" "6 Astra". The other CLIs' names are already short. */
export function barModelName(modelId: CharacterProfile['id'], name: string) {
  if (modelId !== 'CODEX') return name;
  const bare = name.trim().replace(/^gpt[-\s]*/i, '');
  const match = bare.match(/^(\d+(?:\.\d+)*)[-\s]+([A-Za-z].*)$/);
  return match ? `${match[1]} ${match[2]}` : bare;
}

/** One short, consistent model name for the three CLIs: "Opus 5.5", "GPT-6.1 Terra", "Gemini 3.8 Flash". */
export function shortModelName(modelId: CharacterProfile['id'], raw: string) {
  const text = raw.replace(/\[[^\]]*\]\s*$/, '').replace(/\s*\((?:low|medium|high|xhigh|max|ultra)\)\s*$/i, '').trim();
  if (!text || text === '—') return '';
  if (modelId === 'CLAUDE') {
    const match = text.match(/^(?:claude[- ]+)?(opus|sonnet|haiku|fable|mythos)(?:[- ]+(\d+(?:[-.]\d+)*))?/i);
    if (match) return `${cap(match[1].toLowerCase())}${match[2] ? ` ${match[2].replace(/-/g, '.')}` : ''}`;
  }
  if (modelId === 'CODEX') {
    const match = text.match(/^gpt-(\d+(?:\.\d+)?)(?:-([a-z0-9]+))?$/i);
    if (match) return `GPT-${match[1]}${match[2] ? ` ${cap(match[2].toLowerCase())}` : ''}`;
  }
  return text;
}
