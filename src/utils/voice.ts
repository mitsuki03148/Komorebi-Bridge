import { t } from '../i18n';
import type { ClientEvent, ServerEvent } from '../types/bridge';

export type VoiceLanguage = 'zh' | 'yue' | 'en' | 'ja' | 'auto';
export const voiceLanguages: VoiceLanguage[] = ['zh', 'yue', 'en', 'ja', 'auto'];
const languageKey = 'komorebi-voice-language';

export function readVoiceLanguage(): VoiceLanguage {
  try {
    const value = localStorage.getItem(languageKey);
    if (voiceLanguages.includes(value as VoiceLanguage)) return value as VoiceLanguage;
  } catch { /* storage unavailable */ }
  return 'yue';
}
export function writeVoiceLanguage(language: VoiceLanguage) {
  try { localStorage.setItem(languageKey, language); } catch { /* storage unavailable */ }
}

/** The longest dictation: long enough for a long task, short enough to stay well inside the upload and transcription limits. */
export const maxRecordSeconds = 240;

/** The recording formats to try, best first: Safari records AAC in MP4, Chrome and Firefox record WebM. */
export const recordingTypes = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
export const pickRecordingType = (isSupported: (type: string) => boolean) => recordingTypes.find(type => { try { return isSupported(type); } catch { return false; } });

export const clockText = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds) % 60).padStart(2, '0')}`;

export type VoiceState =
  | { phase: 'idle' }
  | { phase: 'recording'; seconds: number }
  | { phase: 'transcribing' };
export type VoiceAction = { type: 'start' } | { type: 'tick' } | { type: 'stop' } | { type: 'done' } | { type: 'cancel' };

/** idle → recording (counting seconds) → transcribing → idle. Recording stops by itself at the limit. */
export function voiceStep(state: VoiceState, action: VoiceAction): VoiceState {
  switch (action.type) {
    case 'start': return state.phase === 'idle' ? { phase: 'recording', seconds: 0 } : state;
    case 'tick': return state.phase === 'recording' ? (state.seconds + 1 >= maxRecordSeconds ? { phase: 'transcribing' } : { phase: 'recording', seconds: state.seconds + 1 }) : state;
    case 'stop': return state.phase === 'recording' ? { phase: 'transcribing' } : state;
    case 'done': return state.phase === 'transcribing' ? { phase: 'idle' } : state;
    case 'cancel': return { phase: 'idle' };
  }
}

/** Why a microphone could not be used, in words that say what to do. */
export function micProblem(error: unknown, secure: boolean, hasMedia: boolean): string {
  if (!secure) return t('utils.voice.https');
  if (!hasMedia) return t('utils.voice.unsupported');
  const name = (error as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return t('utils.voice.permission');
  if (name === 'NotFoundError') return t('utils.voice.microphone');
  return t('utils.voice.open');
}

/** Sends recordings to the Bridge and waits for the text that comes back. */
export function createTranscriber(send: (event: ClientEvent) => boolean, timeoutMs = 10 * 60_000) {
  const waiting = new Map<string, { resolve: (text: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  let counter = 0;
  return {
    request(audio: { mime: string; data: string }, language: VoiceLanguage) {
      return new Promise<string>((resolve, reject) => {
        const requestId = `v${Date.now().toString(36)}${(counter++).toString(36)}`;
        const timer = setTimeout(() => { waiting.delete(requestId); reject(new Error(t('utils.voice.timeout'))); }, timeoutMs);
        waiting.set(requestId, { resolve, reject, timer });
        if (!send({ type: 'TRANSCRIBE', requestId, mime: audio.mime, data: audio.data, language })) {
          clearTimeout(timer);
          waiting.delete(requestId);
          reject(new Error(t('utils.bridge.disconnected')));
        }
      });
    },
    receive(event: ServerEvent) {
      if (event.type !== 'TRANSCRIBE_RESULT') return false;
      const entry = waiting.get(event.requestId);
      if (!entry) return true;
      clearTimeout(entry.timer);
      waiting.delete(event.requestId);
      if (event.ok) entry.resolve(event.text ?? ''); else entry.reject(new Error(event.message ?? t('utils.voice.transcribe')));
      return true;
    },
    /** Called when the connection drops: nothing will answer now. */
    fail(message = t('utils.connection.interrupted')) {
      for (const [id, entry] of waiting) { clearTimeout(entry.timer); entry.reject(new Error(message)); waiting.delete(id); }
    },
    get pending() { return waiting.size; },
  };
}
export type Transcriber = ReturnType<typeof createTranscriber>;

/** Adds dictated text to what is already typed, with a space between when needed. */
export const appendDictation = (draft: string, text: string) => {
  const spoken = text.trim();
  if (!spoken) return draft;
  return draft && !/\s$/.test(draft) ? `${draft} ${spoken}` : `${draft}${spoken}`;
};
