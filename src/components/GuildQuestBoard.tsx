import type { CharacterProfile, CLIModelId, TerminalRoom } from '../types/guild';
import { useT } from '../i18n/useLang';
import { roleAccent } from '../utils/roleAccent';
import { isRoomPinned, orderPinnedRooms } from './RoomPin';

const SLIP_TILTS = ['-rotate-[0.7deg]', 'rotate-[0.6deg]', '-rotate-[0.4deg]', 'rotate-[0.7deg]'] as const;

/**
 * Cute wooden guild quest board with pinned parchment slips for up to 4 pinned rooms.
 */
export function GuildQuestBoard({
  rooms,
  pinnedKeys,
  onSelectRoom,
  characters,
  working = {},
  showCharacter = false,
  className = '',
}: {
  rooms: TerminalRoom[];
  pinnedKeys?: readonly string[];
  onSelectRoom?: (roomId: string) => void;
  characters?: Record<CLIModelId, CharacterProfile>;
  working?: Record<string, string>;
  showCharacter?: boolean;
  className?: string;
}) {
  const { t } = useT();
  if (!pinnedKeys?.length || !onSelectRoom) return null;
  const pinnedRooms = orderPinnedRooms(
    rooms.filter(room => isRoomPinned(room, pinnedKeys)),
    pinnedKeys,
  ).slice(0, 4);
  if (!pinnedRooms.length) return null;

  return (
    <section
      data-guild-quest-board
      aria-label={t('guild.questBoard.title')}
      className={`pointer-events-auto relative overflow-hidden rounded-[20px] border-[1.5px] border-[#7A5435] bg-gradient-to-b from-[#E7C79C] via-[#D8B182] to-[#C79B6B] p-2.5 shadow-[3px_4px_0_rgba(88,58,32,0.28),0_14px_26px_-12px_rgba(90,62,36,0.38),inset_0_1.5px_0_rgba(255,248,232,0.78)] dark:border-[#7B5F47] dark:from-[#4C3A2F] dark:via-[#3D2E25] dark:to-[#30231C] dark:shadow-[3px_4px_0_rgba(6,8,18,0.6),0_16px_30px_-12px_rgba(4,6,16,0.75),inset_0_1px_0_rgba(255,228,196,0.18)] ${className}`}
    >
      {/* Delicate horizontal wood-grain sheen + inner stitched manga frame */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-35 dark:opacity-25"
        style={{
          backgroundImage: 'repeating-linear-gradient(180deg, rgba(255,248,232,0.22) 0px, rgba(255,248,232,0.22) 1px, transparent 1px, transparent 8px)',
        }}
      />
      <span aria-hidden="true" className="pointer-events-none absolute inset-1 rounded-[15px] border border-dashed border-[#FFF7E8]/55 dark:border-[#9E7D5E]/35" />
      {/* Tiny corner brass studs */}
      <span aria-hidden="true" className="pointer-events-none absolute top-2 left-2 h-1.5 w-1.5 rounded-full border border-[#7A5435]/60 bg-[#FBE4B2] shadow-2xs dark:bg-[#C9A36B]" />
      <span aria-hidden="true" className="pointer-events-none absolute top-2 right-2 h-1.5 w-1.5 rounded-full border border-[#7A5435]/60 bg-[#FBE4B2] shadow-2xs dark:bg-[#C9A36B]" />

      {/* Manga-style carved wooden ribbon header */}
      <div className="relative z-10 mb-2 flex items-center justify-between rounded-xl border border-[#A6794B]/70 bg-[#FDF5E6]/92 px-2.5 py-1 shadow-[0_2px_0_rgba(110,74,40,0.2),inset_0_1px_0_#fff] dark:border-[#6A523F] dark:bg-[#261D18]/92 dark:shadow-[0_2px_0_rgba(0,0,0,0.4)]">
        <span className="flex items-center gap-1.5 font-display text-[10.5px] font-extrabold tracking-[0.12em] text-[#5B3E26] uppercase dark:text-[#F2E2C9]">
          <span aria-hidden="true" className="text-[10px] text-[#C86D51] dark:text-[#E7B67B]">✦</span>
          {t('guild.questBoard.title')}
        </span>
        <span className="rounded-full border border-[#D9BE96] bg-[#FFFDF8] px-1.5 py-0.2 text-[9.5px] font-extrabold tabular-nums text-[#6E4D31] shadow-2xs dark:border-[#5C4738] dark:bg-[#382B23] dark:text-[#EAD6B8]">
          {pinnedRooms.length}
        </span>
      </div>

      <div className="relative z-10 space-y-1.5">
        {pinnedRooms.map((room, index) => {
          const accent = roleAccent[room.modelId];
          const isWorking = Boolean(working[room.id]);
          const isWaiting = Boolean(room.pendingApproval || room.pendingQuestion);
          return (
            <button
              key={room.id}
              type="button"
              data-quest-room={room.id}
              onClick={() => onSelectRoom(room.id)}
              className={`group relative flex w-full items-center gap-2 rounded-xl border-[1.5px] border-[#B8956A] bg-[linear-gradient(180deg,#FFFDF7_0%,#FBF1DC_100%)] px-2.5 py-1.5 text-left shadow-[2px_2.5px_0_rgba(104,72,38,0.24),inset_0_1px_0_rgba(255,255,255,0.95)] transition duration-150 hover:rotate-0 hover:-translate-y-0.5 hover:bg-[#FFFDF8] active:translate-y-[1px] active:scale-[0.98] active:shadow-none dark:border-[#6E5846] dark:bg-[linear-gradient(180deg,#362D2A_0%,#2A2220_100%)] dark:shadow-[2px_2.5px_0_rgba(6,8,16,0.55),inset_0_1px_0_rgba(255,236,210,0.1)] dark:hover:bg-[#3B312E] ${SLIP_TILTS[index % SLIP_TILTS.length]}`}
            >
              {/* Illustrated 3D manga wax-pin badge */}
              <span
                aria-hidden="true"
                className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-[#5C3D24]/55 shadow-[0_1.5px_2px_rgba(60,40,20,0.36)] dark:border-white/25"
                style={{ backgroundColor: accent.stripe }}
              >
                <span className="h-1 w-1 -translate-x-[1px] -translate-y-[1px] rounded-full bg-white/90" />
              </span>
              <span className="min-w-0 flex-1 truncate font-display text-xs font-bold tracking-tight text-[#463322] dark:text-[#F5ECD9]">
                {room.roomName}
              </span>
              {showCharacter && characters && (
                <span className="shrink-0 text-[10px] font-bold" style={{ color: accent.name }}>
                  {characters[room.modelId].characterName}
                </span>
              )}
              {(isWaiting || isWorking) ? (
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${isWaiting ? 'animate-pulse bg-[#D97706]' : 'animate-pulse'}`}
                  style={isWaiting ? undefined : { backgroundColor: accent.stripe }}
                />
              ) : (
                <span aria-hidden="true" className="shrink-0 font-mono text-[11px] font-bold text-[#B5966E] transition-transform group-hover:translate-x-0.5 dark:text-[#8E7762]">›</span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
