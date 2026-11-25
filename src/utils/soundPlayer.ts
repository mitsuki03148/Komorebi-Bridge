/**
 * Lightweight Web Audio API Synthesizer for "木漏れ日" (Komorebi) Guild Chimes
 * Plays soft music-box and wind-chime sounds.
 */

import { setAudioSession } from './audioSession';

let sharedAudioCtx: AudioContext | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * A running AudioContext keeps the page's audio session active, which on iOS holds other apps' music silent for as long as the app is open.
 * So it is suspended as soon as the chime has finished and woken again by the next one, and whenever the page goes to the background.
 */
export function suspendGuildAudio(): void {
  clearTimeout(idleTimer);
  idleTimer = undefined;
  try { if (sharedAudioCtx && sharedAudioCtx.state === 'running') void sharedAudioCtx.suspend().catch(() => {}); } catch { /* Nothing running. */ }
}
const suspendSoon = (ms: number) => { clearTimeout(idleTimer); idleTimer = setTimeout(suspendGuildAudio, ms); };
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') suspendGuildAudio(); });

/** Called directly by a tap or keypress so iOS can activate Web Audio. */
export function unlockGuildAudio(enabled: boolean): void {
  if (!enabled) return;
  try { getAudioContext(); suspendSoon(1500); } catch { /* The next interaction can retry. */ }
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!sharedAudioCtx) {
    const AudioCtxClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (AudioCtxClass) {
      // Chimes mix with other apps' music instead of taking over the speaker.
      setAudioSession('ambient');
      sharedAudioCtx = new AudioCtxClass();
    }
  }
  if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

function playBellTone(
  ctx: AudioContext,
  freq: number,
  startTime: number,
  duration: number,
  peakGain = 0.11
) {
  const osc = ctx.createOscillator();
  const harmonic = ctx.createOscillator();
  const gainNode = ctx.createGain();

  // Sine + soft triangle overtone for a warm music-box / wind-chime timbre
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, startTime);

  harmonic.type = 'triangle';
  harmonic.frequency.setValueAtTime(freq * 2, startTime);

  const harmonicGain = ctx.createGain();
  harmonicGain.gain.setValueAtTime(0.18, startTime);

  gainNode.gain.setValueAtTime(0.0001, startTime);
  gainNode.gain.linearRampToValueAtTime(peakGain, startTime + 0.015);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  osc.connect(gainNode);
  harmonic.connect(harmonicGain);
  harmonicGain.connect(gainNode);
  gainNode.connect(ctx.destination);

  osc.start(startTime);
  harmonic.start(startTime);
  osc.stop(startTime + duration + 0.02);
  harmonic.stop(startTime + duration + 0.02);
}

export type GuildSoundType = 'approve' | 'compact' | 'potion' | 'poke';

export function playGuildChime(type: GuildSoundType, enabled = true): void {
  if (!enabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    suspendSoon(1500); // the longest chime ends within about 0.7 s

    if (type === 'approve') {
      // Crisp, warm two-note "叮叮~" (E6 -> B6) wind chime for Approve completion
      playBellTone(ctx, 1318.51, now, 0.36, 0.11); // E6
      playBellTone(ctx, 1975.53, now + 0.11, 0.52, 0.13); // B6
    } else if (type === 'compact') {
      // Soft descending-then-rising sparkle chime (A5 -> E6 -> A6) for /compact
      playBellTone(ctx, 880.0, now, 0.25, 0.09); // A5
      playBellTone(ctx, 1318.51, now + 0.08, 0.3, 0.1); // E6
      playBellTone(ctx, 1760.0, now + 0.16, 0.45, 0.11); // A6
    } else if (type === 'potion') {
      // Magical HP potion refill arpeggio (C6 -> E6 -> G6 -> C7)
      playBellTone(ctx, 1046.5, now, 0.22, 0.09);
      playBellTone(ctx, 1318.51, now + 0.07, 0.25, 0.1);
      playBellTone(ctx, 1567.98, now + 0.14, 0.3, 0.1);
      playBellTone(ctx, 2093.0, now + 0.21, 0.48, 0.12);
    } else if (type === 'poke') {
      // Cute single soft bell (G6)
      playBellTone(ctx, 1567.98, now, 0.32, 0.08);
    }
  } catch {
    // Ignore audio context autoplay errors if user hasn't interacted yet
  }
}
