import { t } from '../i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientEvent, ServerEvent } from '../types/bridge';
import { sendFileUpload } from './fileAttachments';

const pairingKey = 'komorebi-pairing';

// localStorage keeps the pairing across iOS home-screen app relaunches; sessionStorage is the fallback.
function savedPairing() {
  try { return localStorage.getItem(pairingKey) ?? sessionStorage.getItem(pairingKey); } catch { return null; }
}

function savePairing(value: string | undefined) {
  try {
    if (value) localStorage.setItem(pairingKey, value);
    else { localStorage.removeItem(pairingKey); sessionStorage.removeItem(pairingKey); }
  } catch { /* storage unavailable */ }
}

export function useBridge(onEvent: (event: ServerEvent) => void) {
  const socket = useRef<WebSocket>(null);
  const fileUploadSocket = useRef<WebSocket | null>(null);
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const [state, setState] = useState<'connecting' | 'pair' | 'connected'>('connecting');
  const [attempt, reconnect] = useState(0);
  const [key, setKey] = useState('');
  const [pairError, setPairError] = useState<string>();
  const [everConnected, setEverConnected] = useState(false);
  const send = useCallback((event: ClientEvent) => {
    if (socket.current?.readyState !== WebSocket.OPEN) return false;
    if (event.type === 'INPUT' && event.files?.length && fileUploadSocket.current !== socket.current) return false;
    socket.current.send(JSON.stringify(event));
    return true;
  }, []);
  const sendFiles = useCallback((event: Extract<ClientEvent, { type: 'INPUT' }>, encoded: string) =>
    sendFileUpload(socket.current, fileUploadSocket.current, event, encoded), []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active = true;
    let nextDelay = 500;
    const connect = () => {
      setState('connecting');
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      socket.current = ws;
      ws.onmessage = event => {
        if (!active) return;
        const message = JSON.parse(event.data) as ServerEvent;
        if (message.type === 'AUTH_REQUIRED') {
          const savedKey = key || savedPairing();
          // With a saved key, stay in "connecting" instead of flashing the pairing form.
          if (savedKey) ws.send(JSON.stringify({ type: 'AUTH', key: savedKey }));
          else setState('pair');
          return;
        }
        if (message.type === 'SNAPSHOT') {
          fileUploadSocket.current = message.fileUploadSupported === true ? ws : null;
          if (key) savePairing(key);
          setPairError(undefined);
          setEverConnected(true);
          setState('connected');
          nextDelay = 500;
        }
        handler.current(message);
      };
      ws.onclose = event => {
        if (!active) return;
        if (event.code === 1008) {
          const hadKey = Boolean(key || savedPairing());
          savePairing(undefined);
          if (hadKey) setPairError(t('utils.pairing.invalid'));
          setKey('');
          setState('pair');
          return;
        }
        setState('connecting');
        timer = setTimeout(connect, nextDelay);
        nextDelay = Math.min(nextDelay * 2, 8_000);
      };
    };
    connect();
    return () => {
      active = false;
      clearTimeout(timer);
      socket.current?.close();
    };
  }, [attempt, key]);

  return { state, send, sendFiles, pairError, everConnected, pair: (value: string) => { setPairError(undefined); setKey(value.trim()); reconnect(n => n + 1); } };
}
