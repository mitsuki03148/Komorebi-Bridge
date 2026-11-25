import { t as translateNow } from '../i18n';
import { useT } from '../i18n/useLang';
import { useEffect, useReducer, useRef, type CSSProperties } from 'react';
import { Loader2, Mic, Square, X } from 'lucide-react';
import type { CLIModelId } from '../types/guild';
import { burstPetals } from '../utils/petals';
import { roleAccent } from '../utils/roleAccent';
import { setAudioSession } from '../utils/audioSession';
import { releaseMic } from '../utils/micCapture';
import { suspendGuildAudio } from '../utils/soundPlayer';
import {
  clockText, micProblem, pickRecordingType, readVoiceLanguage, voiceStep, type Transcriber, type VoiceState,
} from '../utils/voice';

const toBase64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error(translateNow('record.readfailed')));
  reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result.split(',')[1] ?? '') : reject(new Error(translateNow('record.readfailed')));
  reader.readAsDataURL(blob);
});

/**
 * The microphone next to the message box. Tap to record, tap again to stop: the recording goes to the Mac,
 * which writes it out as text, and the text is added to the message box ready to read over and send.
 */
export function VoiceButton({ supported, transcriber, onText, onError, disabled, role }: {
  /** The Bridge can transcribe (its Whisper model is installed). */
  supported: boolean;
  transcriber: Transcriber;
  onText: (text: string) => void;
  onError: (message: string) => void;
  disabled?: boolean;
  role?: CLIModelId;
}) {
  const { t } = useT();
  const accent = role ? roleAccent[role] : undefined;
  const [state, dispatch] = useReducer(voiceStep, { phase: 'idle' } as VoiceState);
  const media = useRef<{ recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; cancelled: boolean } | undefined>(undefined);
  const button = useRef<HTMLButtonElement>(null);
  const finish = useRef<() => void>(() => {});
  const mounted = useRef(true);

  // One second at a time while recording; the reducer ends it at the limit.
  useEffect(() => {
    if (state.phase !== 'recording') return;
    const timer = setInterval(() => dispatch({ type: 'tick' }), 1000);
    return () => clearInterval(timer);
  }, [state.phase]);
  // Recording stops by itself at the limit: the phase turns to "transcribing" without a tap.
  useEffect(() => { if (state.phase === 'transcribing' && media.current?.recorder.state === 'recording') finish.current(); }, [state.phase]);
  // The microphone must never outlive this button: leaving the screen, or the page going to the background, lets it go.
  useEffect(() => {
    mounted.current = true;
    const leave = () => { releaseMic(media.current); media.current = undefined; };
    window.addEventListener('pagehide', leave);
    return () => { mounted.current = false; window.removeEventListener('pagehide', leave); leave(); };
  }, []);
  // A page that goes to the background while recording keeps what was said: the recording ends and is transcribed, which lets the microphone go.
  useEffect(() => {
    const hidden = () => { if (document.visibilityState === 'hidden' && media.current?.recorder.state === 'recording') finish.current(); };
    document.addEventListener('visibilitychange', hidden);
    return () => document.removeEventListener('visibilitychange', hidden);
  }, []);

  const release = () => { releaseMic(media.current); media.current = undefined; };

  const starting = useRef(false);
  const start = async () => {
    // A second tap while the microphone permission is pending would open a second stream that is never closed.
    if (starting.current || media.current) return;
    const secure = typeof window !== 'undefined' && window.isSecureContext;
    const hasMedia = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined';
    if (!secure || !hasMedia) { onError(micProblem(undefined, secure, hasMedia)); return; }
    let stream: MediaStream;
    starting.current = true;
    // The chimes' audio context is put to sleep and the session is made ready to record; both are undone when the microphone is released.
    suspendGuildAudio();
    setAudioSession('play-and-record');
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch (error) { setAudioSession('ambient'); onError(micProblem(error, true, true)); return; }
    finally { starting.current = false; }
    // The screen was left while the permission prompt was open: nobody is going to use this microphone, so let it go at once.
    if (!mounted.current) { releaseMic({ stream }); return; }
    const type = pickRecordingType(candidate => MediaRecorder.isTypeSupported(candidate));
    let recorder: MediaRecorder;
    try { recorder = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream); }
    catch (error) { releaseMic({ stream }); onError(micProblem(error, true, true)); return; }
    const entry = { recorder, stream, chunks: [] as Blob[], cancelled: false };
    media.current = entry;
    // The system can take the microphone away (a call, Siri, another app): end the recording and release instead of waiting for a tap.
    for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => { if (media.current === entry && recorder.state === 'recording') finish.current(); });
    recorder.ondataavailable = event => { if (event.data.size) entry.chunks.push(event.data); };
    recorder.onstop = async () => {
      const cancelled = entry.cancelled;
      const blob = new Blob(entry.chunks, { type: recorder.mimeType || type || 'audio/mp4' });
      release();
      if (cancelled) { dispatch({ type: 'cancel' }); return; }
      if (blob.size < 1500) { dispatch({ type: 'cancel' }); onError(t('record.short')); return; }
      try {
        const text = await transcriber.request({ mime: blob.type, data: await toBase64(blob) }, readVoiceLanguage());
        if (text) onText(text); else onError(t('record.noaudio'));
      } catch (error) { onError(error instanceof Error ? error.message : t('record.failed')); }
      finally { dispatch({ type: 'done' }); }
    };
    try { recorder.start(); }
    catch (error) { release(); onError(micProblem(error, true, true)); return; }
    dispatch({ type: 'start' });
    if (button.current) burstPetals(button.current, { count: 3 });
  };

  const stop = () => {
    const entry = media.current;
    if (!entry || entry.recorder.state !== 'recording') return;
    dispatch({ type: 'stop' });
    entry.recorder.stop();
  };
  finish.current = stop;
  const cancel = () => {
    const entry = media.current;
    if (!entry) { dispatch({ type: 'cancel' }); return; }
    entry.cancelled = true;
    // A recorder that is not recording will not fire its stop handler, so the microphone is let go here.
    if (entry.recorder.state === 'recording') entry.recorder.stop(); else { release(); dispatch({ type: 'cancel' }); }
  };

  if (state.phase === 'recording') {
    return <span style={accent ? { backgroundColor: accent.soft, color: accent.name } : undefined}
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#FDECEF] pl-2.5 pr-1 text-[#C46F7F]" role="group" aria-label={t('record.recording')}>
      <span className="relative flex h-2 w-2"><span style={accent ? { backgroundColor: accent.stripe } : undefined} className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#E3A0AC] opacity-75" /><span style={accent ? { backgroundColor: accent.name } : undefined} className="relative inline-flex h-2 w-2 rounded-full bg-[#C46F7F]" /></span>
      <span className="font-mono text-[11px] tabular-nums" aria-live="off">{clockText(state.seconds)}</span>
      <button type="button" aria-label={t('record.stop')} onClick={stop} className="flex h-8 w-8 items-center justify-center rounded-full active:scale-90"><Square size={12} fill="currentColor" strokeWidth={0} /></button>
      <button type="button" aria-label={t('record.cancel')} onClick={cancel} className="flex h-8 w-6 items-center justify-center rounded-full opacity-70 active:scale-90"><X size={14} /></button>
    </span>;
  }
  if (state.phase === 'transcribing') {
    return <span style={accent ? { backgroundColor: accent.soft, color: accent.mic } : undefined}
      className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-[#F8E9EE] px-3 text-[11px] text-[#A07583]" role="status">
      <Loader2 size={14} className="animate-spin" aria-hidden="true" />{t('record.transcribing')}
    </span>;
  }
  return <button ref={button} type="button" disabled={disabled || !supported} onClick={() => void start()}
    aria-label={t('record.label')} title={supported ? t('record.supported') : t('record.unsupported')}
    style={accent ? { color: accent.mic, '--mic-hover': accent.soft } as CSSProperties : undefined}
    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#A07583] transition-transform hover:bg-[var(--mic-hover,#F8E9EE)] active:scale-90 disabled:opacity-40">
    <Mic className="h-4 w-4" aria-hidden="true" />
  </button>;
}
