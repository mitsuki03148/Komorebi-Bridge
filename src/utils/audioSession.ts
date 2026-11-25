/**
 * The page's audio session (WebKit's `navigator.audioSession`, iOS 16.4 and later; absent elsewhere, where nothing happens).
 *  - 'ambient'         the app's chimes mix with other apps' music and do not take over the speaker;
 *  - 'play-and-record' only while the microphone is open, then back to 'ambient' so music can play again.
 * A page that leaves the session in a recording or playback state silences other apps' audio for as long as it is open.
 */
export type PageAudioSession = 'ambient' | 'play-and-record' | 'auto';

export function setAudioSession(type: PageAudioSession): void {
  try {
    const session = typeof navigator === 'undefined' ? undefined : (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (session && session.type !== type) session.type = type;
  } catch { /* An older browser or a refused change: nothing to do. */ }
}
