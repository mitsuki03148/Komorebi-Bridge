import { t } from '../i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClientEvent } from '../types/bridge';
import { currentSubscription, pushSupport, subscribeToPush, unsubscribeFromPush, type PushSupport } from './pushClient';

const preference = 'komorebi-push';
const remembered = () => { try { return localStorage.getItem(preference) === '1'; } catch { return false; } };
const remember = (on: boolean) => { try { localStorage.setItem(preference, on ? '1' : '0'); } catch { /* storage unavailable */ } };

export interface PushControl {
  /** False when the Bridge has no push support yet (it needs restarting). */
  bridgeReady: boolean;
  support: PushSupport;
  enabled: boolean;
  busy: boolean;
  message?: string;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  test: () => void;
  receive: (event: { ok: boolean; message: string; enabled?: boolean }) => void;
}

/**
 * Lock-screen push for this device. Once on, every new connection re-announces the subscription (the Bridge
 * forgets which socket belongs to which device) and says whether the page is on screen, so the Bridge does
 * not push to a device that is already showing the app.
 */
export function usePushNotifications(publicKey: string | undefined, send: (event: ClientEvent) => boolean, connected: boolean): PushControl {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const support = useMemo(pushSupport, [enabled, busy, message]);
  const sendRef = useRef(send);
  sendRef.current = send;

  useEffect(() => {
    if (!connected || !publicKey) return;
    let active = true;
    void (async () => {
      if (!remembered() || !pushSupport().ok || Notification.permission !== 'granted') { if (active) setEnabled(false); return; }
      const subscription = await currentSubscription().catch(() => null);
      if (!active) return;
      if (!subscription) { remember(false); setEnabled(false); return; }
      setEnabled(true);
      sendRef.current({ type: 'PUSH_SUBSCRIBE', subscription: subscription.toJSON() as never, visible: !document.hidden });
    })();
    sendRef.current({ type: 'PUSH_VISIBLE', visible: !document.hidden });
    return () => { active = false; };
  }, [connected, publicKey]);

  useEffect(() => {
    const tell = () => sendRef.current({ type: 'PUSH_VISIBLE', visible: !document.hidden });
    document.addEventListener('visibilitychange', tell);
    window.addEventListener('pagehide', tell);
    return () => { document.removeEventListener('visibilitychange', tell); window.removeEventListener('pagehide', tell); };
  }, []);

  return {
    bridgeReady: Boolean(publicKey), support, enabled, busy, message,
    enable: async () => {
      if (!publicKey) return;
      setBusy(true);
      setMessage(undefined);
      try {
        const subscription = await subscribeToPush(publicKey);
        if (!sendRef.current({ type: 'PUSH_SUBSCRIBE', subscription, visible: !document.hidden })) throw new Error(t('utils.bridge.disconnected'));
        remember(true);
        setEnabled(true);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : t('utils.push.failed'));
      } finally { setBusy(false); }
    },
    disable: async () => {
      setBusy(true);
      try { await unsubscribeFromPush(); } catch { /* the Bridge is told either way */ }
      sendRef.current({ type: 'PUSH_UNSUBSCRIBE' });
      remember(false);
      setEnabled(false);
      setBusy(false);
    },
    test: () => { setMessage(undefined); if (!sendRef.current({ type: 'PUSH_TEST' })) setMessage(t('utils.bridge.disconnected')); },
    receive: event => setMessage(event.message),
  };
}
