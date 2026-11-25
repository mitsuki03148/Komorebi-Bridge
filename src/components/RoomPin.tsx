import React from 'react';
import { Pin, PinOff } from 'lucide-react';
import { useT } from '../i18n/useLang';
import type { TerminalRoom } from '../types/guild';

type RoomKey = Pick<TerminalRoom, 'id' | 'modelId' | 'sessionId'>;

function pinIndex(room: RoomKey, keys: readonly string[]) {
  const sessionKey = room.sessionId && `session-${room.modelId.toLowerCase()}-${room.sessionId}`;
  return keys.findIndex(key => key === room.id || key === sessionKey);
}

export function isRoomPinned(room: RoomKey, keys: readonly string[]) {
  return pinIndex(room, keys) >= 0;
}

/** Call on one role's list; unpinned rooms keep their original order. */
export function orderPinnedRooms<Room extends RoomKey>(rooms: Room[], keys: readonly string[]) {
  const rank = (room: Room) => {
    const index = pinIndex(room, keys);
    return index < 0 ? keys.length : index;
  };
  return keys.length ? [...rooms].sort((a, b) => rank(a) - rank(b)) : rooms;
}

export function RoomPinBadge() {
  const { t } = useT();
  return <span role="img" aria-label={t('room.pin.badge')} title={t('room.pin.badge')} className="shrink-0 text-[#8C7263] dark:text-[#A4AECC]">
    <Pin size={11} aria-hidden="true" />
  </span>;
}

export function RoomPinAction({ supported, pinned, onToggle }: {
  supported: boolean;
  pinned: boolean;
  onToggle: () => void;
}) {
  const { t } = useT();
  if (!supported) return null;
  const Icon = pinned ? PinOff : Pin;
  return <button type="button" onClick={onToggle}
    className="flex min-h-11 w-full items-center gap-3 rounded-2xl border border-[#E5D7C6] dark:border-[#343D5E] bg-white dark:bg-[#1E253D] px-3.5 py-2 text-left shadow-2xs transition hover:bg-[#FAF5EE] dark:hover:bg-[#252D49] active:scale-[0.99]">
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#F7F1E8] dark:bg-[#27304D] text-[#6E5D52] dark:text-[#B5BED6]">
      <Icon size={14} aria-hidden="true" />
    </span>
    <span className="text-sm font-bold text-[#4A3E36] dark:text-[#ECE7DF]">{t(pinned ? 'room.pin.remove' : 'room.pin.add')}</span>
  </button>;
}
