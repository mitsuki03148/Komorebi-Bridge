import { setAudioSession } from './audioSession';

type Recorder = Pick<MediaRecorder, 'state' | 'stop'> & { ondataavailable: unknown; onstop: unknown };
type Stream = Pick<MediaStream, 'getTracks'>;

/**
 * Let the microphone go, whatever state the recording is in: stop a recorder that is still running (without running its handlers),
 * stop every track, and put the page's audio session back so other apps' music can play. Each step is tried even if an earlier one fails.
 */
export function releaseMic(entry?: { recorder?: Recorder; stream: Stream }): void {
  if (entry) {
    try {
      const recorder = entry.recorder;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        if (recorder.state !== 'inactive') recorder.stop();
      }
    } catch { /* Already stopped or in a state that cannot stop: the tracks below are what hold the microphone. */ }
    try { for (const track of entry.stream.getTracks()) { try { track.stop(); } catch { /* Try the next track. */ } } } catch { /* No tracks to list. */ }
  }
  setAudioSession('ambient');
}
