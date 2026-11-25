import { useT } from '../i18n/useLang';
import { WorkingSpark } from './WorkingIndicator';
import { formatPct, formatReset, roomStatusLabel, fiveHourQuota, weeklyQuota } from '../utils/roomUi';
import React from 'react';
import {
  Plus,
  Sparkles,
  AlertTriangle,
  ChevronDown,
  Crown,
  MessageCircle,
} from 'lucide-react';
import { CharacterProfile, CLIModelId, GroupChat, TerminalRoom } from '../types/guild';
import { CharacterSpriteAnimator } from './CharacterSpriteAnimator';
import { RibbonTipBloom } from './BotanicalAccents';
import { isRoomPinned, orderPinnedRooms, RoomPinBadge } from './RoomPin';
import { ShieldCheck } from 'lucide-react';

interface LeftCharacterMenuProps {
  characters: Record<CLIModelId, CharacterProfile>;
  rooms: TerminalRoom[];
  pinnedKeys?: readonly string[];
  protectedKeys?: readonly string[];
  selectedRoomId: string;
  onSelectRoom: (roomId: string) => void;
  onOpenNewRoomModal: (modelId: CLIModelId) => void;
  /** Rooms with a reply that arrived while they were not open. */
  unread?: Record<string, true>;
  working?: Record<string, 'working' | 'stalled'>;
  onOpenUsageModal: (modelId: CLIModelId) => void;
  onPokeCharacter: (modelId: CLIModelId) => void;
  /** Collaboration groups, one tap away from the room list. */
  groups?: GroupChat[];
  onSelectGroup?: (group: GroupChat) => void;
}

const MODEL_ORDER: CLIModelId[] = ['AGY', 'CODEX', 'CLAUDE'];

const selectedRoomTone: Record<CLIModelId, { card: string; icon: string }> = {
  AGY: {
    card: 'bg-[#FFFDFB] dark:bg-[#2B1F2E] border-[#C86475] dark:border-[#E89AAC] shadow-[2.5px_3px_0_rgba(200,100,117,0.28)] ring-1 ring-[#D9828B]/35 dark:ring-[#E89AAC]/35',
    icon: 'bg-[#FCE8EB] dark:bg-[#3A2433] text-[#C85A68] dark:text-[#EFA4B2] border border-[#E8B2BC] dark:border-[#633B52]',
  },
  CODEX: {
    card: 'bg-[#FFFDFB] dark:bg-[#1B2B28] border-[#5E8867] dark:border-[#8BC096] shadow-[2.5px_3px_0_rgba(94,136,103,0.28)] ring-1 ring-[#6F9778]/35 dark:ring-[#8BC096]/35',
    icon: 'bg-[#E8F1E7] dark:bg-[#233832] text-[#4E7A55] dark:text-[#96C7A3] border border-[#B5D1B8] dark:border-[#3D5E52]',
  },
  CLAUDE: {
    card: 'bg-[#FFFDFB] dark:bg-[#202644] border-[#6680AA] dark:border-[#9CA6E8] shadow-[2.5px_3px_0_rgba(102,128,170,0.28)] ring-1 ring-[#7891B8]/35 dark:ring-[#9CA6E8]/35',
    icon: 'bg-[#E8EDF9] dark:bg-[#2B3359] text-[#4A6191] dark:text-[#B4BCF2] border border-[#BCCAE2] dark:border-[#48558A]',
  },
};

export const LeftCharacterMenu: React.FC<LeftCharacterMenuProps> = ({
  characters,
  rooms,
  pinnedKeys = [],
  protectedKeys = [],
  selectedRoomId,
  onSelectRoom,
  onOpenNewRoomModal,
  unread = {},
  working = {},
  onOpenUsageModal,
  onPokeCharacter,
  groups = [],
  onSelectGroup,
}) => {
  const { t } = useT();
  const orderedRooms = MODEL_ORDER.flatMap(id => orderPinnedRooms(rooms.filter(room => room.modelId === id), pinnedKeys));
  // Folding keeps pinned rooms, the open one and any that wait, work or have news.
  const [folded, setFolded] = React.useState<Partial<Record<CLIModelId, boolean>>>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem('komorebi-folded-roles') ?? '{}');
      // Anything but a plain object (null, a list, a number) is ignored.
      return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved as Partial<Record<CLIModelId, boolean>> : {};
    } catch { return {}; }
  });
  const toggleFold = (modelId: CLIModelId) => setFolded(current => {
    const next = { ...current, [modelId]: !current[modelId] };
    try { localStorage.setItem('komorebi-folded-roles', JSON.stringify(next)); } catch { /* A private window keeps it for this visit only. */ }
    return next;
  });
  return (
    <aside className="w-[30%] min-w-[300px] max-w-[390px] h-full border-r border-[#E6DCD0] dark:border-[#2E3654] bg-[#F7F2E9]/90 dark:bg-[#151B2E]/92 backdrop-blur-md flex flex-col select-none overflow-hidden shrink-0">
      {/* Sub-header for the 3-Character Guild Roster */}
      <div className="px-4 py-2 border-b border-[#E6DCD0] dark:border-[#2E3654] bg-[#FBF8F3]/80 dark:bg-[#181F35]/85 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5 text-xs text-[#6E5D52] dark:text-[#A4AECC]">
          <Sparkles className="w-3.5 h-3.5 text-[#D9828B] dark:text-[#EFA4B2] shrink-0" />
          <span className="font-bold text-[#4A3E36] dark:text-[#ECE7DF] font-display">{t('sidebar.title')}</span>
        </div>
        <span className="text-[11px] font-mono text-[#8C7A6E] dark:text-[#98A3C2] tabular-nums">
          {t('sidebar.rooms.summary', { rooms: rooms.length, live: rooms.filter(room => room.live).length })}
          {rooms.some(room => room.pendingApproval) && <span className="text-[#C85A68] dark:text-[#F09AA6] font-bold">{t('sidebar.rooms.approvals', { count: rooms.filter(room => room.pendingApproval).length })}</span>}
        </span>
      </div>

      {onSelectGroup && groups.length > 0 && <nav aria-label={t('sidebar.groups')} data-group-chips className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-[#E6DCD0]/70 dark:border-[#2E3654]/70 px-3 py-1.5">
        {groups.map(group => <button key={group.id} type="button" onClick={() => onSelectGroup(group)} title={t('sidebar.group.title', { name: group.name, count: group.members.length })}
          className="max-w-[10rem] shrink-0 cursor-pointer truncate rounded-full border border-[#D3D9EE] dark:border-[#3A4369] bg-[#EEF0FA] dark:bg-[#222947] px-2.5 py-0.5 text-[11px] font-semibold text-[#4D557E] dark:text-[#B8BFF0]">{t('sidebar.group.name', { name: group.name })}</button>)}
      </nav>}

      {/* 3 Character Compartments (三格：瞳 AGY / 光 Codex / 響 Claude Code) */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
        {MODEL_ORDER.map((modelId) => {
          const char = characters[modelId];
          const modelRooms = orderedRooms.filter((r) => r.modelId === modelId);
          const hasWaitingApproval = modelRooms.some(
            (r) => r.status === 'waiting_approval'
          );
          const hasWork = modelRooms.some(room => working[room.id]);
          const hasUnread = modelRooms.some(room => unread[room.id]);
          const kept = (room: TerminalRoom) => isRoomPinned(room, pinnedKeys) || room.id === selectedRoomId || Boolean(room.pendingApproval) || Boolean(working[room.id]) || Boolean(unread[room.id]);
          const hiddenCount = modelRooms.filter(room => !kept(room)).length;
          const foldable = modelRooms.length > 3 && hiddenCount > 0;
          const isFolded = foldable && Boolean(folded[modelId]);
          const isShown = (room: TerminalRoom) => !isFolded || kept(room);

          const cardTheme =
            modelId === 'AGY'
              ? 'bg-[#FFF9FA] dark:bg-[#211A29] border-[#F0D4D8] dark:border-[#432F47] hover:border-[#E4B5BC] dark:hover:border-[#5D3F61]'
              : modelId === 'CODEX'
              ? 'bg-[#F8FBF8] dark:bg-[#192324] border-[#D3E4D5] dark:border-[#2C403D] hover:border-[#B5D1B8] dark:hover:border-[#3D5B55]'
              : 'bg-[#F8FAFD] dark:bg-[#1B2036] border-[#D4DFEC] dark:border-[#31395C] hover:border-[#B6C9E0] dark:hover:border-[#465282]';

          const badgeColor =
            modelId === 'AGY'
              ? 'bg-[#FCE8EB] dark:bg-[#3A2433] text-[#C85A68] dark:text-[#EFA4B2] border-[#F3C6CD] dark:border-[#59354B]'
              : modelId === 'CODEX'
              ? 'bg-[#E6F2E8] dark:bg-[#20332C] text-[#4E7A55] dark:text-[#96C7A3] border-[#C5DEC8] dark:border-[#335446]'
              : 'bg-[#E8F0F8] dark:bg-[#232A4A] text-[#4F729B] dark:text-[#A9B7E8] border-[#C6D7EA] dark:border-[#394575]';

          return (
            <section
              key={modelId}
              className={`rounded-3xl border ${cardTheme} p-3 transition-all shadow-xs`}
            >
              {/* Top Row: Contained Hand-Drawn Watercolor Chibi Sprite + Character Info & Compact Icon Actions */}
              <div className="flex items-center gap-3">
                <CharacterSpriteAnimator
                  modelId={modelId}
                  avatarUrl={char.avatarUrl}
                  waiting={hasWaitingApproval}
                  working={hasWork}
                  unread={hasUnread}
                  size="md"
                  onClickSprite={() => onPokeCharacter(modelId)}
                />

                {/* Right Column: Name, Icon Toolbar & Soft HP/MP Bars */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="text-sm font-bold text-[#4A3E36] dark:text-[#ECE7DF] font-display">
                        {char.characterName}
                      </span>
                      <span
                        className={`px-1.5 py-0.2 rounded-full text-[10px] font-semibold border ${badgeColor}`}
                      >
                        {char.id === 'AGY'
                          ? 'AGY'
                          : char.id === 'CODEX'
                          ? 'Codex'
                          : 'Claude'}
                      </span>
                    </div>

                    {/* Icon-only buttons: Sync Folder, Usage/Potion, New Room */}
                    <div className="flex items-center gap-1 shrink-0">
                      {foldable && <button type="button" onClick={() => toggleFold(modelId)} aria-expanded={!isFolded} data-fold-rooms
                        aria-label={isFolded ? t('sidebar.expand.aria', { name: char.characterName }) : t('sidebar.collapse.aria', { name: char.characterName })} title={isFolded ? t('sidebar.expand') : t('sidebar.collapse')}
                        className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-[#8C7A6E] dark:text-[#98A3C2] transition-colors hover:bg-white/80 dark:hover:bg-[#27304D]">
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isFolded ? '-rotate-90' : ''}`} aria-hidden="true" />
                      </button>}
                      <button
                        onClick={() => onOpenNewRoomModal(modelId)}
                        title={t('sidebar.addroom', { name: char.characterName })}
                        className="w-6 h-6 rounded-full bg-[#4A3E36] dark:bg-[#2C3557] hover:bg-[#635348] dark:hover:bg-[#3A4673] text-[#FBF8F3] dark:text-[#ECE7DF] flex items-center justify-center transition-colors cursor-pointer shadow-xs"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Soft Pastel HP (Weekly) & MP (5h) Bars */}
                  <button
                    type="button"
                    onClick={() => onOpenUsageModal(modelId)}
                    title={[t('sidebar.quota.vouchers', { count: char.hp5h.resetVouchers ?? '—' }),
                      formatReset(char.hp5h.resetsAt) && t('sidebar.quota.fivehour', { time: formatReset(char.hp5h.resetsAt) }),
                      formatReset(char.mpWeekly.resetsAt) && t('sidebar.quota.weekly', { time: formatReset(char.mpWeekly.resetsAt) })].filter(Boolean).join('\n')}
                    aria-label={t('sidebar.quota.aria', { name: char.characterName, weekly: formatPct(weeklyQuota(char)), fivehour: formatPct(fiveHourQuota(char)) })}
                    className="mt-2 block w-full space-y-1.5 cursor-pointer rounded-lg text-left hover:bg-white/60 dark:hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-[#965069]"
                  >
                    {/* HP Bar (Weekly Quota) */}
                    <div className="flex items-center gap-1.5 text-[10px] font-mono tabular-nums">
                      <span className="w-6 text-[#C85A68] dark:text-[#EFA4B2] font-bold shrink-0">
                        HP
                      </span>
                      <div className="relative flex-1 h-2 rounded-full bg-[#EFE7DA] dark:bg-[#141A2C] border border-[#E2D6C5] dark:border-[#2E3654]">
                        <div className="h-full w-full overflow-hidden rounded-full">
                          <div
                            className="h-full bg-gradient-to-r from-[#E58A95] to-[#F3B199] rounded-full transition-all duration-300"
                            style={{ width: `${weeklyQuota(char) ?? 0}%` }}
                          />
                        </div>
                        {typeof weeklyQuota(char) === 'number' && <RibbonTipBloom kind="hp" pct={weeklyQuota(char)!} subtle />}
                      </div>
                      <span className="w-9 text-right text-[#6E5D52] dark:text-[#A4AECC] shrink-0">
                        {formatPct(weeklyQuota(char))}
                      </span>
                    </div>

                    {/* MP Bar (5h Rolling Limit) */}
                    <div className="flex items-center gap-1.5 text-[10px] font-mono tabular-nums">
                      <span className="w-6 text-[#5B82A6] dark:text-[#8FB4DB] font-bold shrink-0">
                        MP
                      </span>
                      <div className="relative flex-1 h-2 rounded-full bg-[#EFE7DA] dark:bg-[#141A2C] border border-[#E2D6C5] dark:border-[#2E3654]">
                        <div className="h-full w-full overflow-hidden rounded-full">
                          <div
                            className="h-full bg-gradient-to-r from-[#7AA2C4] to-[#8CB89F] rounded-full transition-all duration-300"
                            style={{ width: `${fiveHourQuota(char) ?? 0}%` }}
                          />
                        </div>
                        {typeof fiveHourQuota(char) === 'number' && <RibbonTipBloom kind="mp" pct={fiveHourQuota(char)!} subtle />}
                      </div>
                      <span className="w-9 text-right text-[#6E5D52] dark:text-[#A4AECC] shrink-0">
                        {formatPct(fiveHourQuota(char))}
                      </span>
                    </div>
                  </button>
                </div>
              </div>

              {/* Nested Chat Bubbles representing each room */}
              <div className="mt-2.5 space-y-1.5">
                {modelRooms.filter(isShown).map((room) => {
                  const isSelected = room.id === selectedRoomId;
                  const shortcut = orderedRooms.indexOf(room) + 1;
                  const isWaiting = room.status === 'waiting_approval';

                  return (
                    <button
                      key={room.id}
                      data-room-id={room.id}
                      onClick={() => onSelectRoom(room.id)}
                      title={shortcut <= 9 ? `${room.roomName}（⌥${shortcut}）` : room.roomName}
                      className={`w-full text-left relative rounded-2xl px-3 py-2 transition-all duration-150 cursor-pointer border-[1.5px] flex items-center gap-2.5 active:translate-y-[1px] ${
                        isSelected
                          ? selectedRoomTone[modelId].card
                          : isWaiting
                          ? 'bg-[#FFF5E9] dark:bg-[#2C241E] border-[#DFAB6B] dark:border-[#785B38] shadow-[2px_2.5px_0_rgba(184,115,36,0.18)] hover:bg-[#FFF0DE] dark:hover:bg-[#342A23]'
                          : 'bg-[#FFFDF9]/88 dark:bg-[#171D32]/90 border-[#D9CBB8] dark:border-[#343E61] shadow-[2px_2.5px_0_rgba(110,86,62,0.12)] dark:shadow-[2px_2.5px_0_rgba(6,8,18,0.45)] hover:bg-white dark:hover:bg-[#1E253D] hover:border-[#C5B39D] dark:hover:border-[#495685]'
                      }`}
                    >
                      {/* Bubble Status Icon */}
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                          isWaiting
                            ? 'bg-[#FDE6C4] dark:bg-[#433322] text-[#B87324] dark:text-[#F0B870]'
                            : isSelected
                            ? selectedRoomTone[modelId].icon
                            : 'bg-[#F2ECE1] dark:bg-[#232B45] text-[#7D6D61] dark:text-[#A4AECC]'
                        }`}
                      >
                        {isWaiting ? (
                          <AlertTriangle className="w-3.5 h-3.5" />
                        ) : working[room.id] ? (
                          <WorkingSpark stalled={working[room.id] === 'stalled'} background={Boolean(room.backgroundTasks)} />
                        ) : (
                          <MessageCircle className="w-3.5 h-3.5" />
                        )}
                      </div>
                      {unread[room.id] && !isSelected && <span aria-label={t('sidebar.unread')} className="absolute left-2 top-1.5 h-2 w-2 rounded-full bg-[#D9828B] ring-2 ring-white dark:ring-[#171D32]" />}

                      {/* Room Name & Snippet */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1.5">
                          <div className="flex min-w-0 items-center gap-1">
                            <span className="truncate text-xs font-bold text-[#4A3E36] dark:text-[#ECE7DF]">{room.roomName}</span>
                            {isRoomPinned(room, pinnedKeys) && <RoomPinBadge />}
                            {isRoomPinned(room, protectedKeys) && <ShieldCheck size={12} aria-label={t('room.protect.badge')} className="shrink-0 text-[#4E7A55] dark:text-[#96C7A3]" />}
                          </div>
                          {groups.some(group => group.orchestratorRoomId === room.id) && <Crown size={12} aria-label={t('group.sidebar.leader')} className="shrink-0 text-[#B88A2A]" />}
                          <span className={`text-[10px] shrink-0 ${room.live ? 'text-[#4E7A55] dark:text-[#96BD9F] font-semibold' : 'text-[#9A8778] dark:text-[#8E98B8]'}`}>
                            {roomStatusLabel(room)}
                          </span>
                        </div>

                        <p
                          className={`text-[11px] truncate ${
                            isWaiting
                              ? 'text-[#B86B24] dark:text-[#F0B870] font-medium'
                              : 'text-[#7D6D61] dark:text-[#A4AECC]'
                          }`}
                        >
                          {room.bubbleSnippet}
                        </p>
                      </div>
                    </button>
                  );
                })}
                {isFolded && <button type="button" onClick={() => toggleFold(modelId)}
                  className="w-full cursor-pointer rounded-2xl py-1 text-center text-[11px] font-semibold text-[#8C7A6E] dark:text-[#98A3C2] hover:bg-white/60 dark:hover:bg-[#1E253D]">
                  {t('sidebar.hidden', { count: hiddenCount })}
                </button>}
              </div>
            </section>
          );
        })}
      </div>
    </aside>
  );
};
