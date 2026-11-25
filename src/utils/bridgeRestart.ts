/** Only a new process identity confirms a restart; reconnecting to the same process does not. */
export const restartTimeoutMs = 90_000;

type Timer = ReturnType<typeof setTimeout>;
type Clock = { set: (callback: () => void, delay: number) => Timer; clear: (timer: Timer) => void };
const clock: Clock = { set: (callback, delay) => setTimeout(callback, delay), clear: timer => clearTimeout(timer) };

export function beginRestartAttempt(instanceId: string, onTimeout: () => void, timerClock: Clock = clock) {
  let active = true;
  const timer = timerClock.set(() => {
    if (!active) return;
    active = false;
    onTimeout();
  }, restartTimeoutMs);
  const cancel = () => {
    if (!active) return;
    active = false;
    timerClock.clear(timer);
  };
  return {
    observe(nextId: string | undefined) {
      if (!active || !nextId || nextId === instanceId) return false;
      cancel();
      return true;
    },
    cancel,
  };
}
