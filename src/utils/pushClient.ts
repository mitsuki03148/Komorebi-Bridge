import { t } from '../i18n';
export type PushSupport = { ok: true } | { ok: false; reason: 'insecure' | 'unsupported' | 'not-installed' | 'denied' };

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isInstalled = () => (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia('(display-mode: standalone)').matches;

/** Whether this page can receive push, or the one thing that stands in the way. */
export function pushSupport(): PushSupport {
  if (!window.isSecureContext) return { ok: false, reason: 'insecure' };
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return { ok: false, reason: 'unsupported' };
  // iOS only allows push for a web app that was added to the Home Screen and opened from there.
  if (isIos() && !isInstalled()) return { ok: false, reason: 'not-installed' };
  if (Notification.permission === 'denied') return { ok: false, reason: 'denied' };
  return { ok: true };
}

export function urlBase64ToUint8Array(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, character => character.charCodeAt(0));
}

export async function currentSubscription() {
  if (!('serviceWorker' in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration('/');
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/** Asks permission (this must follow a tap) and subscribes this device with the Bridge's public key. */
export async function subscribeToPush(publicKey: string) {
  await navigator.serviceWorker.register('/sw.js');
  const registration = await navigator.serviceWorker.ready;
  if ((await Notification.requestPermission()) !== 'granted') throw new Error(t('utils.push.denied'));
  const subscription = (await registration.pushManager.getSubscription()) ?? await registration.pushManager.subscribe({
    userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  return subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
}

export async function unsubscribeFromPush() {
  const subscription = await currentSubscription();
  await subscription?.unsubscribe();
}
