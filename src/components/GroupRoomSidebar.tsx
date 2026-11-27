// Contents
// Identify groups and rooms
// Show ticket transfers
// Show member avatars and badges
// Render the group sidebar

import { useT } from '../i18n/useLang';
import { roomStatusLabel } from '../utils/roomUi';
import { WorkingSpark } from './WorkingIndicator';
import { Bug, ClipboardList, Crown, Palette, Plus, SearchCheck, ShieldCheck, Smartphone, Users, Wrench } from 'lucide-react';
import type { CharacterProfile, CLIModelId, GroupChat, TerminalRoom } from '../types/guild';
import type { GroupMemberRole, GroupRolePreset } from '../types/groupRoles';
import { AvatarExpression } from './AvatarExpression';
import { burstPetals } from '../utils/petals';
import { roleAccent } from '../utils/roleAccent';
import { memberRoleLabel } from './GroupMemberRoleEditor';
import { groupRoleIcons } from './groupRoleIcons';
import { isRoomPinned } from './RoomPin';

// Identify groups and rooms
// The group icon shows which models are present, and the lead heads the member list.
const roomStatus = roomStatusLabel;

/** The lead (the crown) always comes first; the others keep the order they were added in. */
export function crownFirst<T extends { roomId: string }>(members: T[], leaderRoomId?: string): T[] {
  const lead = leaderRoomId ? members.find(member => member.roomId === leaderRoomId) : undefined;
  return lead ? [lead, ...members.filter(member => member !== lead)] : members;
}

function GroupAvatar({ group }: { group: GroupChat }) {
  const present = new Set(group.members.map(member => member.modelId));
  if (group.members.length === 0) {
    return (
      <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border border-[#E5D7C6] bg-[#FFFBF4] text-[#A8787E] shadow-2xs dark:border-[#343D5E] dark:bg-[#1C233A] dark:text-[#C5CDE3]">
        <Users className="h-3.5 w-3.5" />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border border-[#E5D7C6] bg-[#FFFBF4] shadow-2xs dark:border-[#343D5E] dark:bg-[#1C233A]">
      <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" aria-hidden="true">
        {/* Top petal: CODEX (Hikaru sage) */}
        <circle cx="12" cy="7.4" r="4.1" fill="#7FA889" fillOpacity={present.has('CODEX') ? 0.92 : 0.2} />
        {/* Bottom-left petal: AGY (Hitomi rose) */}
        <circle cx="8" cy="14.3" r="4.1" fill="#E3A0AC" fillOpacity={present.has('AGY') ? 0.92 : 0.2} />
        {/* Bottom-right petal: CLAUDE (Hibiki misty blue) */}
        <circle cx="16" cy="14.3" r="4.1" fill="#8FA8DC" fillOpacity={present.has('CLAUDE') ? 0.92 : 0.2} />
        {/* Warm center */}
        <circle cx="12" cy="12" r="2.1" fill="#F8DF99" />
      </svg>
    </span>
  );
}

// Show ticket transfers
// Workbench events drive the overlays on the member avatars.
/** One ticket on its way: a heart leaves the room that sent it and another lands on the room that got it. */
export interface BenchFlow { id: number; from: string; to: string; kind: 'task' | 'done' }

/** A five-petal flower in the colour of whoever sent the ticket (光 green, 響 blue-violet, 瞳 rose), whether it hands work over or brings it back. */
function Flower({ done, color }: { done: boolean; color: string }) {
  return <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" data-flower={done ? 'done' : 'task'}>
    {[0, 72, 144, 216, 288].map(angle => <ellipse key={angle} cx="10" cy="5.2" rx="3.1" ry="4.6" transform={`rotate(${angle} 10 10)`} fill={color} />)}
    <circle cx="10" cy="10" r="2.2" fill={done ? '#F7F1D8' : '#FBE9A8'} />
  </svg>;
}

function Hearts({ roomId, flows, modelOf }: { roomId: string; flows: BenchFlow[]; modelOf: (roomId: string) => CLIModelId | undefined }) {
  const mine = flows.filter(flow => flow.from === roomId || flow.to === roomId);
  if (!mine.length) return null;
  return <>{mine.map(flow => {
    const sending = flow.from === roomId;
    return <span key={`${flow.id}-${sending ? 'out' : 'in'}`} aria-hidden="true" data-heart={sending ? 'out' : 'in'}
      className={`pointer-events-none absolute -top-1 right-0 z-10 text-sm leading-none ${sending ? 'guild-heart-out' : 'guild-heart-in'}`}><Flower done={flow.kind === 'done'} color={roleAccent[modelOf(flow.from) ?? 'CODEX'].stripe} /></span>;
  })}</>;
}

// Show member avatars and badges
// Both layouts use the same avatar to show activity, pending decisions, leadership and assigned roles.
const ROLE_BADGE_TONE: Partial<Record<GroupRolePreset, { Icon: typeof Wrench; tone: string }>> = {
  debug: {
    Icon: Bug,
    tone: 'border-[#C98C8C] bg-[#FBE8E8] text-[#8A3434] dark:border-[#AA6666] dark:bg-[#3C2121] dark:text-[#F5B3B3]',
  },
  implement: {
    Icon: Wrench,
    tone: 'border-[#84B892] bg-[#E5F4E8] text-[#2F6A42] dark:border-[#5D9B70] dark:bg-[#1E3B2B] dark:text-[#A6E3B6]',
  },
  review: {
    Icon: SearchCheck,
    tone: 'border-[#8EA8D8] bg-[#E6EEFB] text-[#325188] dark:border-[#6380BD] dark:bg-[#1E2B4A] dark:text-[#B2C9FF]',
  },
  'art-copy': {
    Icon: Palette,
    tone: 'border-[#D98EA6] bg-[#FCE9F0] text-[#8B3A57] dark:border-[#B66A84] dark:bg-[#3E2031] dark:text-[#F8B6CC]',
  },
  'native-test': {
    Icon: Smartphone,
    tone: 'border-[#DF9D6B] bg-[#FFF0E2] text-[#8E4E20] dark:border-[#BA7A4B] dark:bg-[#3D2719] dark:text-[#F7C297]',
  },
  cybersecurity: {
    Icon: ShieldCheck,
    tone: 'border-[#7FA3B0] bg-[#E3F0F4] text-[#2B5A69] dark:border-[#5C8796] dark:bg-[#1B343D] dark:text-[#A5D3E1]',
  },
  clerk: {
    Icon: ClipboardList,
    tone: 'border-[#C9AF89] bg-[#F7EFE2] text-[#6B5030] dark:border-[#9E8460] dark:bg-[#332A1E] dark:text-[#E7D1B0]',
  },
};

export function RoleIconBadge({ role, assignment, leading = false, inline = false }: { role?: GroupMemberRole; assignment: string; leading?: boolean; inline?: boolean }) {
  if (!assignment || !role) return null;
  const key = role.key as GroupRolePreset;
  const preset = ROLE_BADGE_TONE[key] ?? (key in groupRoleIcons ? { Icon: groupRoleIcons[key], tone: 'border-[#C9AF89] bg-[#F7EFE2] text-[#6B5030] dark:border-[#9E8460] dark:bg-[#332A1E] dark:text-[#E7D1B0]' } : null);
  const placement = inline ? 'shrink-0' : `pointer-events-none absolute ${leading ? '-top-1 -right-1' : '-bottom-1 -right-1'} z-10`;
  if (preset) {
    const { Icon, tone } = preset;
    return (
      <span
        data-role-icon-badge={role.key}
        aria-hidden="true"
        title={assignment}
        className={`${placement} flex h-4 w-4 items-center justify-center rounded-full border shadow-sm ${tone}`}
      >
        <Icon size={9} strokeWidth={2.4} aria-hidden="true" />
      </span>
    );
  }
  const initial = Array.from(assignment.trim())[0] ?? '•';
  return (
    <span
      data-role-icon-badge="custom"
      aria-hidden="true"
      title={assignment}
      className={`${placement} flex h-4 w-4 items-center justify-center rounded-full border border-[#C9B9A6] bg-[#F2ECE4] text-[8.5px] font-extrabold leading-none text-[#5A4A3E] shadow-sm dark:border-[#5D688E] dark:bg-[#282E45] dark:text-[#D5DCF2]`}
    >
      {initial}
    </span>
  );
}

function MemberAvatar({ member, room, character, working, flows, modelOf, size = 'h-11 w-11', leading, circular = false, assignment = '' }: {
  member: { roomId: string; modelId: CLIModelId; role?: GroupMemberRole }; room?: TerminalRoom; character: CharacterProfile;
  working: Record<string, 'working' | 'stalled'>; flows: BenchFlow[]; modelOf: (roomId: string) => CLIModelId | undefined; size?: string; leading: boolean; circular?: boolean; assignment?: string;
}) {
  const { t } = useT();
  const radius = circular ? 'rounded-full' : 'rounded-2xl';
  return <span className={`relative block shrink-0 ${size}`}>
    <span className={`relative block h-full w-full overflow-hidden ${radius} border border-[#E7DACA] bg-[#FBF7EF] dark:border-[#343D5E] dark:bg-[#192036]`}>
      <img src={character.avatarUrl} alt="" className={`h-full w-full ${radius} object-contain`} />
      <AvatarExpression modelId={member.modelId} src={character.avatarUrl} working={Boolean(working[member.roomId])} />
      {room?.pendingApproval && <span aria-hidden="true" className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center rounded-full bg-[#B45F62] text-[10px] text-white">!</span>}
      {room?.pendingQuestion && !room.pendingApproval && <span aria-hidden="true" data-question-mark className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center rounded-full bg-[#C98A2B] text-[10px] text-white">?</span>}
    </span>
    {working[member.roomId] && <span className="pointer-events-none absolute -left-0.5 -top-0.5 z-10 flex drop-shadow-[0_0_2px_rgba(255,255,255,0.95)]" data-working-spark={working[member.roomId]}><WorkingSpark stalled={working[member.roomId] === 'stalled'} background={Boolean(room?.backgroundTasks)} /></span>}
    {leading && (
      <span
        data-orchestrator="true"
        aria-hidden="true"
        title={t('group.sidebar.leader')}
        className="guild-crown-badge pointer-events-none absolute -bottom-1 -right-1 z-10 flex h-4 w-4 items-center justify-center rounded-full border border-[#D9B15F] bg-[#FFF5D6] text-[#8F6514] shadow-sm dark:border-[#C89E46] dark:bg-[#3B2E16] dark:text-[#F8D67A]"
      >
        <Crown size={9} strokeWidth={2.4} aria-hidden="true" className="guild-crown-icon" />
        <svg viewBox="0 0 12 12" aria-hidden="true" className="guild-crown-sparkle pointer-events-none absolute -top-1 -right-1 h-2.5 w-2.5 text-[#F2B830] dark:text-[#FFE28A]">
          <path d="M6 0.5 C6.45 4 8 5.55 11.5 6 C8 6.45 6.45 8 6 11.5 C5.55 8 4 6.45 0.5 6 C4 5.55 5.55 4 6 0.5 Z" fill="currentColor" />
        </svg>
        <svg viewBox="0 0 12 12" aria-hidden="true" className="guild-crown-sparkle guild-crown-sparkle--delayed pointer-events-none absolute -bottom-0.5 -left-1 h-2 w-2 text-[#F5C84C] dark:text-[#FFF0B8]">
          <path d="M6 0.5 C6.45 4 8 5.55 11.5 6 C8 6.45 6.45 8 6 11.5 C5.55 8 4 6.45 0.5 6 C4 5.55 5.55 4 6 0.5 Z" fill="currentColor" />
        </svg>
      </span>
    )}
    <RoleIconBadge role={member.role} assignment={assignment} leading={leading} />
    <Hearts roomId={member.roomId} flows={flows} modelOf={modelOf} />
  </span>;
}

// Render the group sidebar
// The compact strip shows the current group's members, while the wide sidebar also lists groups.
const memberCardTone: Record<CLIModelId, { idle: string; active: string }> = {
  AGY: { idle: 'border-[#EBC5CA] bg-[#FFF9FA] text-[#5C3A47] dark:border-[#49324B] dark:bg-[#221A2A] dark:text-[#E7C6CE]', active: 'border-[#AD5E7E] bg-[#F8E1EB] text-[#71364E] ring-2 ring-inset ring-[#AD5E7E] shadow-sm dark:border-[#D67C8E] dark:bg-[#382336] dark:text-[#FADCE4]' },
  CODEX: { idle: 'border-[#B8D4BE] bg-[#F7FBF7] text-[#35523A] dark:border-[#2E4440] dark:bg-[#192424] dark:text-[#B9D9BF]', active: 'border-[#6F9778] bg-[#E8F1E7] text-[#3B5940] ring-2 ring-inset ring-[#6F9778] shadow-sm dark:border-[#7FA889] dark:bg-[#223531] dark:text-[#D5EEDB]' },
  CLAUDE: { idle: 'border-[#BDD0E4] bg-[#F7F9FD] text-[#364B6E] dark:border-[#343C60] dark:bg-[#1B2036] dark:text-[#C1CAEE]', active: 'border-[#7891B8] bg-[#E8EDF9] text-[#3D5378] ring-2 ring-inset ring-[#7891B8] shadow-sm dark:border-[#8488C4] dark:bg-[#282F54] dark:text-[#E1E6FC]' },
};

export function GroupRoomSidebar({ onAddMember, groups, rooms, characters, selectedGroupId, selectedRoomId, onSelectGroup, onSelectRoom, compact = false, working = {}, flows = [], showMemberRoles = false, protectedKeys = [] }: {
  groups: GroupChat[];
  rooms: TerminalRoom[];
  protectedKeys?: readonly string[];
  characters: Record<CLIModelId, CharacterProfile>;
  selectedGroupId: string | null;
  selectedRoomId?: string;
  onSelectGroup: (group: GroupChat) => void;
  onSelectRoom: (roomId: string) => void;
  compact?: boolean;
  showMemberRoles?: boolean;
  /** On the phone, a plus at the end of the member row; it opens the add-member menu. */
  onAddMember?: () => void;
  working?: Record<string, 'working' | 'stalled'>;
  /** Tickets that just moved between members (see BENCH_FLOW). */
  flows?: BenchFlow[];
}) {
  const { t } = useT();
  const activeGroup = groups.find(group => group.id === selectedGroupId);
  const members = crownFirst(activeGroup?.members ?? [], activeGroup?.orchestratorRoomId);
  const modelOf = (roomId: string) => members.find(member => member.roomId === roomId)?.modelId ?? rooms.find(item => item.id === roomId)?.modelId;
  const memberCards = members.map(member => {
    const room = rooms.find(item => item.id === member.roomId);
    const character = characters[member.modelId];
    const status = room ? roomStatus(room) : t('group.sidebar.unready');
    const name = room?.roomName ?? member.roomId.slice(0, 8);
    const leading = activeGroup?.orchestratorRoomId === member.roomId;
    const baseLabel = t('group.sidebar.memberlabel', {
      character: character.characterName, name, status, id: room?.sessionId ?? t('group.sidebar.unconfirmed'),
      leader: leading ? t('group.sidebar.leadersuffix') : '',
    });
    const assignment = showMemberRoles && member.role ? memberRoleLabel(member.role, t) : '';
    const label = assignment ? `${baseLabel} · ${t('group.memberRole.label')}: ${assignment}` : baseLabel;
    const pressed = selectedRoomId === member.roomId;
    const tone = memberCardTone[member.modelId];
    const accent = roleAccent[member.modelId];
    if (compact) {
      return <button key={member.roomId} type="button" data-room-id={member.roomId} data-cli={member.modelId}
        aria-label={label} aria-pressed={pressed} title={label}
        onClick={event => { if (!pressed) { burstPetals(event.currentTarget, { count: 3 }); navigator.vibrate?.(8); } onSelectRoom(member.roomId); }}
        className={`guild-selection relative flex shrink-0 flex-col items-center justify-center rounded-full p-0.5 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#965069] ${
          pressed
            ? `${tone.active} scale-[1.1] opacity-100 saturate-100 ring-2 ring-offset-2 ring-offset-[#FBF8F3] dark:ring-offset-[#101524] shadow-[0_0_0_2px_var(--selection-edge),0_6px_16px_-2px_color-mix(in_srgb,var(--selection-edge)_65%,transparent)]`
            : `${tone.idle} opacity-70 saturate-[0.88] hover:opacity-95`
        }`}>
        <MemberAvatar member={member} room={room} character={character} working={working} flows={flows} modelOf={modelOf} size="h-9 w-9" leading={leading} circular assignment={assignment} />
        {room && isRoomPinned(room, protectedKeys) && (
          <span aria-label={t('room.protect.badge')} title={t('room.protect.badge')}
            className="pointer-events-none absolute -bottom-0.5 -left-0.5 z-10 flex h-4 w-4 items-center justify-center rounded-full border border-[#B5D1B8] bg-[#E6F2E8] text-[#4E7A55] shadow-xs dark:border-[#3D5E52] dark:bg-[#20332C] dark:text-[#96C7A3]">
            <ShieldCheck size={9} strokeWidth={2.4} aria-hidden="true" />
          </span>
        )}
        {assignment && <span data-member-assignment className="sr-only">{assignment}</span>}
        {pressed && <span aria-hidden="true" className="pointer-events-none absolute -bottom-1.5 left-1/2 h-1 w-4 -translate-x-1/2 rounded-full shadow-xs" style={{ backgroundColor: accent.stripe }} />}
      </button>;
    }
    return <button key={member.roomId} type="button" data-room-id={member.roomId} data-cli={member.modelId}
      aria-label={label} aria-pressed={pressed} title={label}
      onClick={event => { if (!pressed) { burstPetals(event.currentTarget, { count: 3 }); navigator.vibrate?.(8); } onSelectRoom(member.roomId); }}
      className={`guild-selection flex w-full flex-col items-center justify-center gap-1 rounded-2xl border px-1.5 py-2 text-center cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#965069] ${pressed ? `${tone.active} shadow-[0_4px_12px_-4px_color-mix(in_srgb,var(--selection-edge)_45%,transparent)]` : `${tone.idle} opacity-85 hover:opacity-100`}`}>
      <MemberAvatar member={member} room={room} character={character} working={working} flows={flows} modelOf={modelOf} size="h-10 w-10" leading={leading} circular assignment={assignment} />
      <span className="flex w-full min-w-0 items-center justify-center gap-1">
        <span className="truncate text-[11px] font-bold leading-tight">{character.characterName}</span>
        {room && isRoomPinned(room, protectedKeys) && <ShieldCheck size={12} aria-label={t('room.protect.badge')} className="shrink-0 text-[#4E7A55] dark:text-[#96C7A3]" />}
        {assignment && <span data-member-assignment aria-hidden="true" className="truncate rounded border border-current/20 px-1 text-[9px] font-semibold leading-tight opacity-85">{assignment}</span>}
      </span>
    </button>;
  });
  if (compact) {
    // On the phone the members float directly over the single background picture with zero opaque band.
    return <aside aria-label={t('group.sidebar.groupsandrooms')} data-member-strip className="pointer-events-auto relative z-20 flex shrink-0 flex-col gap-1 bg-transparent px-2.5 pt-1 pb-0.5">
      <nav aria-label={t('group.sidebar.memberrooms')} className="flex items-center gap-2.5 overflow-x-auto px-1 pt-0.5 pb-2.5">{memberCards}
        {onAddMember && <button type="button" onClick={onAddMember} aria-label={t('group.sidebar.addmember')} title={t('group.sidebar.addmember')} data-add-member
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-dashed border-[#C9B8A6] dark:border-[#3A4366] bg-white/85 dark:bg-[#1D243C] text-[#6E5D52] dark:text-[#B5BED6] hover:bg-[#F3ECE1] dark:hover:bg-[#27304D] active:scale-95 transition cursor-pointer"><Plus size={15} aria-hidden="true" /></button>}
      </nav>
    </aside>;
  }
  return <aside aria-label={t('group.sidebar.groupsandrooms')} className={`flex h-full shrink-0 flex-col overflow-hidden border-r border-[#E6DCD0]/70 dark:border-[#2E3654]/75 bg-[#FBF8F3]/68 dark:bg-[#13182A]/74 backdrop-blur-md w-44`}>
    {!compact && <div className="shrink-0 border-b border-[#E6DCD0] dark:border-[#2E3654] px-4 py-3 text-xs font-bold text-[#6E5D52] dark:text-[#B5BED6]">{t('group.sidebar.rooms.title')}</div>}
    <nav className={`min-h-0 flex-1 space-y-3 overflow-y-auto py-2 ${compact ? 'px-1' : 'px-2'}`} aria-label={t('group.sidebar.rooms.select')}>
      <section aria-label={t('group.sidebar.groups.title')}>
        <h2 className="px-2 pb-1 text-[13px] font-extrabold tracking-wide text-[#7D6A5E] dark:text-[#98A3C2]">{compact ? t('group.sidebar.groups.short') : t('group.sidebar.groups.title')}</h2>
        <div className="space-y-1">{groups.map(group => {
          const active = group.id === selectedGroupId;
          const label = t('group.sidebar.group.label', { name: group.name, count: group.members.length });
          return <button key={group.id} type="button" data-group-id={group.id} aria-label={label} aria-current={active ? 'page' : undefined} title={label} onClick={() => { navigator.vibrate?.(8); onSelectGroup(group); }}
            className={`guild-tap flex min-h-10 w-full min-w-0 items-center gap-2 rounded-xl px-2 py-1 text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#965069] ${active ? 'bg-[#E6E9F7] dark:bg-[#262D50] text-[#4D557E] dark:text-[#C8CEFC] ring-1 ring-inset ring-[#9AA3D6]' : 'text-[#6E5D52] dark:text-[#B5BED6] hover:bg-[#EEE6DC] dark:hover:bg-[#1E253D]'}`}>
              <GroupAvatar group={group} />
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold">{group.name}</span>
              <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${active ? 'bg-white/80 text-[#4D557E] dark:bg-[#192036] dark:text-[#C8CEFC]' : 'bg-[#EFE7DB]/90 text-[#8C7A6E] dark:bg-[#1F2640] dark:text-[#98A3C2]'}`}>{group.members.length}</span>
          </button>;
        })}</div>
        {groups.length === 0 && !compact && <p className="px-2 py-1 text-xs text-[#A39284] dark:text-[#7E89A8]">{t('group.sidebar.groups.empty')}</p>}
      </section>
      <section aria-label={t('group.sidebar.memberrooms')}>
        <h2 className="px-2 pb-1 text-[13px] font-extrabold tracking-wide text-[#7D6A5E] dark:text-[#98A3C2]">{compact ? t('group.sidebar.rooms.short') : t('group.sidebar.memberrooms')}</h2>
        <div className="grid grid-cols-2 gap-1.5">{memberCards}</div>
      </section>
    </nav>
  </aside>;
}
