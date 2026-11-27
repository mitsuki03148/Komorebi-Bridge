// Contents
// Guild Hall welcome — Show the illustrated landing page and room status.
// Choose a group on mobile — Open a group from the edge of the screen.

import { useEffect, useRef, useState } from 'react';
import { Check, Users } from 'lucide-react';
import { useT } from '../i18n/useLang';
import { GUILD_HALL_BANNER, GUILD_HALL_NIGHT_BANNER } from '../data/initialGuildData';
import type { CharacterProfile, CLIModelId, GroupChat, TerminalRoom } from '../types/guild';
import { burstPetals } from '../utils/petals';
import { useTheme } from '../utils/theme';
import { CornerFloralSprig } from './BotanicalAccents';
import { debutMeta } from './EmptyRoomState';

// ── Guild Hall welcome ───────────────────────────────────────────────
// Show room status over day or night artwork when no room is selected.

export function GuildHallHome({
  characters,
  rooms,
  working,
  groups,
  onSelectGroup,
}: {
  characters: Record<CLIModelId, CharacterProfile>;
  rooms: TerminalRoom[];
  working: Record<string, 'working' | 'stalled'>;
  groups?: GroupChat[];
  onSelectGroup?: (group: GroupChat) => void;
}) {
  const { t } = useT();
  const { isDark } = useTheme();
  const workingCount = Object.keys(working).length;
  const waitingApprovalCount = rooms.filter(room => room.status === 'waiting_approval').length;

  return (
    <div data-guild-hall-home
      className="relative flex min-h-0 flex-1 flex-col justify-between overflow-hidden select-none bg-[#FBF8F3] dark:bg-[#121624]">
      {/* Sunlit conservatory (day) / Starry midnight conservatory (night) scrim + depth layers */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <img
          src={isDark ? GUILD_HALL_NIGHT_BANNER : GUILD_HALL_BANNER}
          alt=""
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover opacity-24 sm:opacity-55 dark:opacity-55 dark:sm:opacity-72 sm:blur-[2px]"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#FBF8F3]/78 via-[#FBF8F3]/42 to-[#FBF8F3]/86 dark:from-[#121624]/70 dark:via-[#151B2E]/28 dark:to-[#121624]/84" />
        {/* Arched window lattice light reflection in upper-right */}
        <svg viewBox="0 0 260 260" className="absolute -top-6 -right-4 h-72 w-72 text-[#FFF8E8] dark:text-[#9CB0EE] opacity-55 dark:opacity-22 blur-[1px]">
          <path d="M40 0 L260 0 L260 220 Q130 210 40 0 Z" fill="currentColor" fillOpacity="0.42" />
          <line x1="115" y1="0" x2="260" y2="145" stroke="#E5D2B5" strokeOpacity="0.48" strokeWidth="2" />
          <line x1="175" y1="0" x2="70" y2="180" stroke="#E5D2B5" strokeOpacity="0.4" strokeWidth="1.5" />
        </svg>
        {/* Diagonal sunbeams (day) / moonlight beams (night) swaying gently */}
        <div className="guild-sunbeam-sway absolute -top-24 right-[-6%] h-[135%] w-64 origin-top bg-gradient-to-b from-[#FFF5D6]/62 via-[#FFF2C9]/20 dark:from-[#9CB0EE]/22 dark:via-[#7C8CE0]/8 to-transparent blur-xl" />
        <div className="guild-sunbeam-sway absolute -top-16 right-[22%] h-[125%] w-40 origin-top bg-gradient-to-b from-[#FFEFC2]/46 via-[#FFF5D6]/14 dark:from-[#B4C4F5]/16 dark:via-[#899AE5]/6 to-transparent blur-lg"
          style={{ animationDelay: '-4.2s' }} />
        {/* Dreamy Komorebi bokeh orbs */}
        <div className="guild-bokeh-float absolute top-[18%] left-[15%] h-24 w-24 rounded-full bg-[#FFF3CD]/52 dark:bg-[#F7E3A3]/14 blur-xl" />
        <div className="guild-bokeh-float absolute top-[30%] right-[14%] h-28 w-28 rounded-full bg-[#F5D0D8]/35 dark:bg-[#8E9CE6]/16 blur-2xl"
          style={{ animationDelay: '-3.1s' }} />
        <div className="guild-bokeh-float absolute top-[14%] right-[36%] h-16 w-16 rounded-full bg-[#FFF6DC]/55 dark:bg-[#F7E3A3]/18 blur-lg"
          style={{ animationDelay: '-5.4s' }} />
        {/* Warm lantern / sunlit aura behind the trio */}
        <div className="absolute -bottom-24 left-1/2 h-[26rem] w-[52rem] -translate-x-1/2 rounded-full blur-3xl dark:opacity-70"
          style={{ background: isDark
            ? 'radial-gradient(ellipse, rgba(244,199,126,0.22) 0%, rgba(142,156,230,0.14) 48%, transparent 74%)'
            : 'radial-gradient(ellipse, rgba(255,241,206,0.68) 0%, rgba(242,202,210,0.22) 45%, transparent 74%)' }} />
        {isDark && [
          { left: 11, top: 14, size: 3, delay: '0s' },
          { left: 26, top: 9, size: 2.5, delay: '1.1s' },
          { left: 41, top: 18, size: 3.5, delay: '2.4s' },
          { left: 58, top: 11, size: 2.5, delay: '0.6s' },
          { left: 73, top: 16, size: 3, delay: '1.9s' },
          { left: 86, top: 8, size: 3.5, delay: '3.1s' },
          { left: 92, top: 24, size: 2.5, delay: '1.5s' },
        ].map(star => (
          <span key={`${star.left}-${star.top}`}
            className="guild-star-twinkle absolute rounded-full bg-[#F7E3A3] shadow-[0_0_8px_rgba(247,227,163,0.75)]"
            style={{ left: `${star.left}%`, top: `${star.top}%`, width: star.size, height: star.size, animationDelay: star.delay }} />
        ))}
        {/* Full-stage drifting sunlight motes (day) / starlight motes (night) */}
        {[9, 20, 34, 48, 62, 77, 90].map((left, index) => (
          <span key={left} data-mote
            className="guild-empty-mote absolute top-4 h-1.5 w-1.5 rounded-full bg-[#F6DBA6] dark:bg-[#F7E3A3]/75"
            style={{ left: `${left}%`, animationDelay: `${index * 1.1}s` }} />
        ))}
        {/* Soft drifting petals in three character colors */}
        {[
          { left: 16, color: debutMeta.CODEX.petal, delay: '0s' },
          { left: 48, color: debutMeta.AGY.petal, delay: '3.4s' },
          { left: 82, color: debutMeta.CLAUDE.petal, delay: '6.8s' },
        ].map(petal => (
          <span key={petal.left}
            className="guild-empty-petal absolute top-0 h-2.5 w-1.5 rounded-[70%_30%_70%_30%] opacity-0"
            style={{ left: `${petal.left}%`, backgroundColor: petal.color, animationDelay: petal.delay }} />
        ))}
      </div>

      <div className="guild-stage-enter pointer-events-none absolute top-2 left-2.5 right-auto z-20 sm:top-5 sm:left-7">
        <div className="relative flex w-fit max-w-full items-center gap-2 rounded-xl border border-[#E2D5C3]/85 dark:border-[#343D5E]/85 bg-[#FFFDF9]/68 dark:bg-[#171D31]/76 px-2.5 py-1.5 sm:gap-3 sm:rounded-2xl sm:px-4 sm:py-2.5 shadow-[0_8px_22px_rgba(92,75,64,0.08)] dark:shadow-[0_12px_28px_rgba(6,8,18,0.45)] backdrop-blur-md">
          <CornerFloralSprig modelId="AGY" size={18} className="absolute -top-1.5 -right-1.5 opacity-90 sm:h-5 sm:w-5" />
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#E2D5C3]/90 bg-[#FFFDF9]/85 p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] dark:border-[#6C7BA8]/35 dark:bg-[#1D243C]/90 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] sm:h-10 sm:w-10 sm:p-1" aria-hidden="true">
            <img src="/avatars/komorebi-crest.webp" alt="" draggable={false} className="h-full w-full select-none object-contain dark:brightness-110" />
          </span>
          <div className="min-w-0">
          <div className="hidden sm:flex items-center gap-2">
            <span className="flex items-center gap-1" aria-hidden="true">
              <span className="h-2 w-2 rounded-full bg-[#5B8763] dark:bg-[#8FB897]" />
              <span className="h-2 w-2 rounded-full bg-[#C86D7D] dark:bg-[#EFA4B2]" />
              <span className="h-2 w-2 rounded-full bg-[#5C82AD] dark:bg-[#9CB2E5]" />
            </span>
            <span className="font-mono text-[9.5px] font-extrabold tracking-[0.22em] text-[#8C7A6E] dark:text-[#A4AECC] uppercase">
              {t('guild.hall.english')}
            </span>
          </div>
          <h1 className="font-display text-sm font-bold tracking-wide text-[#4A3A30] dark:text-[#F2EDE4] sm:mt-0.5 sm:text-xl">
            {t('guild.hall.title')}
          </h1>
          <p className="text-[9.5px] font-medium text-[#7D6D61] dark:text-[#A7B0CA] sm:mt-0.5 sm:text-[11px]">
            {rooms.length === 0
              ? t('guild.hall.empty')
              : waitingApprovalCount > 0
              ? t('guild.hall.approvals', { rooms: rooms.length, waiting: waitingApprovalCount })
              : workingCount > 0
              ? t('guild.hall.working', { rooms: rooms.length, working: workingCount })
              : t('guild.hall.idle', { rooms: rooms.length, codex: characters.CODEX.characterName, agy: characters.AGY.characterName, claude: characters.CLAUDE.characterName })}
          </p>
          </div>
        </div>
      </div>

      {/* Full-Team 16-Member Komorebi Guild Hall Illustration Stage (16:9 desktop + 9:16 multi-tier mobile, single-download <picture>) */}
      <div data-guild-trio className="guild-stage-enter pointer-events-none absolute inset-0 z-[1] select-none overflow-hidden">
        <picture className="contents">
          <source
            media="(min-width: 640px)"
            srcSet={isDark ? '/avatars/guild-team-desktop-night.webp' : '/avatars/guild-team-desktop.webp'}
          />
          <img
            src={isDark ? '/avatars/guild-team-mobile-night.webp' : '/avatars/guild-team-mobile.webp'}
            alt={t('guild.hall.trio', { codex: characters.CODEX.characterName, agy: characters.AGY.characterName, claude: characters.CLAUDE.characterName })}
            draggable={false}
            fetchPriority="high"
            decoding="async"
            className="guild-hall-stage-img h-full w-full select-none object-cover object-bottom sm:absolute sm:bottom-0 sm:left-0 sm:right-0 sm:h-auto sm:max-h-full sm:aspect-video dark:brightness-[0.96] dark:contrast-[1.02]"
          />
        </picture>
        {/* Soft atmospheric edge scrim so top-left nameplate and night stars stay legible */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-b from-[#FBF8F3]/35 via-transparent to-transparent dark:from-[#0C101E]/55 dark:via-[#101629]/15 dark:to-[#0A0E1B]/35"
        />
      </div>

      {/* Foreground Komorebi Light Rhythm: Sunlit Flare & Swaying Beams (Day) / Irregular Medieval Oil-Lamp Breathing (Night) */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-[3] overflow-hidden">
        {!isDark ? (
          <>
            {/* Warm golden sun-source lens flare bloom at upper glass ceiling */}
            <div className="guild-flare-pulse absolute -top-16 right-[4%] h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(255,246,190,0.88)_0%,rgba(255,208,110,0.48)_38%,rgba(255,184,92,0.16)_62%,transparent_78%)] blur-xl sm:right-[10%] sm:h-96 sm:w-96" />
            <div className="guild-flare-pulse absolute top-[8%] left-[20%] h-44 w-44 rounded-full bg-[radial-gradient(circle,rgba(255,244,188,0.68)_0%,rgba(255,212,120,0.28)_48%,transparent_75%)] blur-xl sm:h-60 sm:w-60" style={{ animationDelay: '-3.2s' }} />
            {/* Swaying dappled Komorebi sunbeam shafts streaming through the conservatory roof */}
            <div className="guild-sunbeam-sway absolute -top-24 left-[14%] h-[115%] w-36 origin-top bg-gradient-to-b from-[#FFF1B2]/62 via-[#FFE396]/26 to-transparent blur-xl sm:w-56" />
            <div className="guild-sunbeam-sway absolute -top-20 right-[12%] h-[120%] w-44 origin-top bg-gradient-to-b from-[#FFF3BA]/68 via-[#FFE49C]/28 to-transparent blur-xl sm:w-72" style={{ animationDelay: '-4.2s' }} />
            <div className="guild-sunbeam-sway absolute -top-16 left-[46%] h-[100%] w-28 origin-top bg-gradient-to-b from-[#FFF6C8]/52 via-[#FFE8A6]/18 to-transparent blur-lg sm:w-44" style={{ animationDelay: '-2.1s' }} />
            {/* Crisp luminous Komorebi lens-flare bokeh rings (玉ボケ) drifting along the sunbeam path */}
            <div className="guild-bokeh-float absolute top-[18%] right-[22%] h-16 w-16 rounded-full border border-[#FFFBE0]/65 bg-[radial-gradient(circle,rgba(255,250,215,0.62)_0%,rgba(255,216,125,0.26)_62%,transparent_100%)] blur-[1px] sm:h-20 sm:w-20" />
            <div className="guild-bokeh-float absolute top-[30%] left-[32%] h-11 w-11 rounded-full border border-[#FFFBE0]/55 bg-[radial-gradient(circle,rgba(255,248,208,0.56)_0%,rgba(255,210,120,0.22)_65%,transparent_100%)] blur-[1px] sm:h-14 sm:w-14" style={{ animationDelay: '-2.4s' }} />
            <div className="guild-bokeh-float absolute top-[40%] right-[36%] h-20 w-20 rounded-full bg-[radial-gradient(circle,rgba(255,240,182,0.48)_0%,rgba(255,204,108,0.18)_58%,transparent_80%)] blur-md sm:h-24 sm:w-24" style={{ animationDelay: '-4.6s' }} />
            {/* Drifting petals in front of the conservatory light */}
            {[
              { left: 22, color: debutMeta.CODEX.petal, delay: '0.8s' },
              { left: 54, color: debutMeta.AGY.petal, delay: '4.1s' },
              { left: 84, color: debutMeta.CLAUDE.petal, delay: '7.4s' },
            ].map(petal => (
              <span key={`fg-${petal.left}`}
                className="guild-empty-petal absolute top-0 h-2.5 w-1.5 rounded-[70%_30%_70%_30%] opacity-0"
                style={{ left: `${petal.left}%`, backgroundColor: petal.color, animationDelay: petal.delay }} />
            ))}
          </>
        ) : (
          <>
            {/* Subtle medieval guild ambient oil-lamp vignette */}
            <div className="guild-oillamp-flicker absolute inset-0 bg-[radial-gradient(ellipse_at_55%_65%,rgba(255,184,76,0.14)_0%,transparent_65%)]" />
            {/* Irregular oil-lamp & candle breathing glow pools over the lanterns, table candles, and hearth */}
            <div className="guild-oillamp-flicker absolute bottom-[4%] left-[50%] h-56 w-64 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,196,92,0.44)_0%,rgba(238,136,44,0.18)_46%,transparent_74%)] mix-blend-screen blur-2xl sm:bottom-[14%] sm:left-[78%] sm:h-72 sm:w-72" />
            <div className="guild-oillamp-flicker absolute bottom-[38%] left-[52%] h-44 w-44 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,202,104,0.38)_0%,rgba(235,142,50,0.15)_48%,transparent_75%)] mix-blend-screen blur-xl sm:bottom-[8%] sm:left-[34%] sm:h-56 sm:w-56" style={{ animationDelay: '-1.7s', animationDuration: '5.3s' }} />
            <div className="guild-oillamp-flicker absolute top-[24%] right-[8%] h-40 w-40 rounded-full bg-[radial-gradient(circle,rgba(255,198,98,0.34)_0%,rgba(230,134,46,0.13)_50%,transparent_76%)] mix-blend-screen blur-xl sm:top-[16%] sm:right-[12%] sm:h-52 sm:w-52" style={{ animationDelay: '-3.1s', animationDuration: '3.9s' }} />
            {/* Gentle twinkling stars confined strictly to the upper-left starry sky glass */}
            {[
              { left: 8, top: 22, size: 3, delay: '0.4s' },
              { left: 16, top: 30, size: 2.5, delay: '1.7s' },
              { left: 26, top: 18, size: 3, delay: '2.6s' },
              { left: 34, top: 26, size: 2.5, delay: '1.1s' },
            ].map(star => (
              <span key={`fg-star-${star.left}`}
                className="guild-star-twinkle absolute rounded-full bg-[#FFF0B8] shadow-[0_0_8px_rgba(247,227,163,0.85)]"
                style={{ left: `${star.left}%`, top: `${star.top}%`, width: star.size, height: star.size, animationDelay: star.delay }} />
            ))}
          </>
        )}
      </div>
      {onSelectGroup && (
        <MobileGroupScrollDrawer
          groups={groups ?? []}
          working={working}
          onSelectGroup={onSelectGroup}
        />
      )}
    </div>
  );
}

// ── Choose a group on mobile ─────────────────────────────────────────
// Keep groups within reach in views without the desktop sidebar.

const SCROLL_SHEET_WIDTH = 236;

function GroupCloverIcon({ group }: { group: GroupChat }) {
  const present = new Set(group.members.map(member => member.modelId));
  if (group.members.length === 0) {
    return <Users className="h-3.5 w-3.5 text-[#8A6420] dark:text-[#E8C27A]" aria-hidden="true" />;
  }
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden="true">
      <circle cx="12" cy="7.4" r="4.1" fill="#7FA889" fillOpacity={present.has('CODEX') ? 0.94 : 0.22} />
      <circle cx="8" cy="14.3" r="4.1" fill="#E3A0AC" fillOpacity={present.has('AGY') ? 0.94 : 0.22} />
      <circle cx="16" cy="14.3" r="4.1" fill="#8FA8DC" fillOpacity={present.has('CLAUDE') ? 0.94 : 0.22} />
      <circle cx="12" cy="12" r="2.1" fill="#F8DF99" />
    </svg>
  );
}

export function MobileGroupScrollDrawer({
  groups,
  working,
  onSelectGroup,
}: {
  groups: GroupChat[];
  working: Record<string, 'working' | 'stalled'>;
  onSelectGroup: (group: GroupChat) => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [dragUnroll, setDragUnroll] = useState<number | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const dragState = useRef<{ startX: number; startY: number; baseOpen: boolean; moved: boolean } | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => () => { timers.current.forEach(window.clearTimeout); }, []);

  const anyGroupWorking = groups.some(group => group.members.some(member => Boolean(working[member.roomId])));
  const currentUnroll = dragUnroll !== null ? dragUnroll : open ? SCROLL_SHEET_WIDTH : 0;
  const translateX = Math.max(0, SCROLL_SHEET_WIDTH - currentUnroll);
  const isShowing = open || dragUnroll !== null;

  const beginDrag = (clientX: number, clientY: number) => {
    if (pickedId) return;
    dragState.current = { startX: clientX, startY: clientY, baseOpen: open, moved: false };
  };

  const moveDrag = (clientX: number, clientY: number) => {
    const state = dragState.current;
    if (!state) return;
    const dx = state.startX - clientX;
    const dy = clientY - state.startY;
    if (!state.moved && Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
    if (!state.moved && Math.abs(dy) > Math.abs(dx) * 1.35) {
      dragState.current = null;
      return;
    }
    state.moved = true;
    if (!state.baseOpen) {
      // Viscous parchment unrolling resistance when pulling left from closed
      const raw = Math.max(0, dx);
      const damped = SCROLL_SHEET_WIDTH * (1 - Math.exp(-raw / (SCROLL_SHEET_WIDTH * 0.72)));
      setDragUnroll(Math.min(SCROLL_SHEET_WIDTH + 10, damped));
    } else {
      // Damped roll-back when pushing right from open
      const rawRight = Math.max(0, -dx);
      const damped = Math.max(0, SCROLL_SHEET_WIDTH - rawRight * 0.78);
      setDragUnroll(damped);
    }
  };

  const endDrag = () => {
    const state = dragState.current;
    dragState.current = null;
    if (!state) return;
    if (!state.moved) {
      navigator.vibrate?.(8);
      setOpen(prev => !prev);
      setDragUnroll(null);
      return;
    }
    const finalUnroll = dragUnroll ?? (state.baseOpen ? SCROLL_SHEET_WIDTH : 0);
    const shouldOpen = state.baseOpen
      ? finalUnroll > SCROLL_SHEET_WIDTH * 0.68
      : finalUnroll > SCROLL_SHEET_WIDTH * 0.26;
    navigator.vibrate?.(6);
    setOpen(shouldOpen);
    setDragUnroll(null);
  };

  const handlePickGroup = (group: GroupChat, button: HTMLButtonElement) => {
    if (pickedId) return;
    burstPetals(button, { count: 5 });
    navigator.vibrate?.(14);
    setPickedId(group.id);
    const t1 = window.setTimeout(() => {
      setOpen(false);
      setDragUnroll(null);
    }, 35);
    const t2 = window.setTimeout(() => {
      setPickedId(null);
      onSelectGroup(group);
    }, 150);
    timers.current.push(t1, t2);
  };

  return (
    <div className="sm:hidden">
      {/* Tap empty space to dismiss and roll the parchment scroll back in */}
      {isShowing && currentUnroll > 4 && (
        <div
          aria-hidden="true"
          onClick={() => {
            if (pickedId) return;
            navigator.vibrate?.(6);
            setOpen(false);
            setDragUnroll(null);
          }}
          style={{ opacity: Math.min(1, currentUnroll / SCROLL_SHEET_WIDTH) * 0.32 }}
          className=" absolute inset-0 z-20 bg-[#2C1F14] dark:bg-[#060812] transition-opacity duration-300"
        />
      )}

      {/* Right-edge invisible touch swipe zone so swiping left from anywhere near the right lantern edge pulls the scroll out */}
      {!open && (
        <div
          aria-hidden="true"
          onTouchStart={e => beginDrag(e.touches[0].clientX, e.touches[0].clientY)}
          onTouchMove={e => moveDrag(e.touches[0].clientX, e.touches[0].clientY)}
          onTouchEnd={endDrag}
          onTouchCancel={endDrag}
          className="absolute top-[24%] right-0 bottom-[18%] z-20 w-8"
        />
      )}

      <aside
        data-mobile-group-scroll
        aria-label={t('topbar.group.menu')}
        onTouchStart={e => beginDrag(e.touches[0].clientX, e.touches[0].clientY)}
        onTouchMove={e => moveDrag(e.touches[0].clientX, e.touches[0].clientY)}
        onTouchEnd={endDrag}
        onTouchCancel={endDrag}
        style={{
          transform: `translate3d(${translateX}px, -50%, 0)`,
          transition: dragUnroll !== null
            ? 'none'
            : pickedId
              ? 'transform 135ms cubic-bezier(0.35, 0, 0.25, 1)'
              : 'transform 280ms cubic-bezier(0.22, 1.04, 0.36, 1)',
        }}
        className="absolute top-[42%] right-0 z-30 flex items-center select-none"
      >
        {/* Leading Left Cylindrical Parchment Roller Handle (always peeking out at right edge when rolled up) */}
        <button
          type="button"
          aria-expanded={open}
          aria-label={t('topbar.group.choose')}
          title={t('topbar.group.choose')}
          onPointerDown={e => {
            if (e.pointerType === 'touch') return;
            e.currentTarget.setPointerCapture?.(e.pointerId);
            beginDrag(e.clientX, e.clientY);
          }}
          onPointerMove={e => {
            if (e.pointerType === 'touch' || !dragState.current) return;
            moveDrag(e.clientX, e.clientY);
          }}
          onPointerUp={e => {
            if (e.pointerType === 'touch') return;
            endDrag();
          }}
          className="relative z-20 -mr-1.5 flex h-28 w-7 shrink-0 flex-col items-center justify-between rounded-l-2xl border-[1.5px] border-[#A88246] dark:border-[#785E38] bg-[linear-gradient(90deg,#DFC28F_0%,#FFF8E8_36%,#F1DEB8_74%,#C29D61_100%)] dark:bg-[linear-gradient(90deg,#231B12_0%,#3D3020_38%,#2A2015_76%,#18120B_100%)] py-1 shadow-[-4px_4px_14px_rgba(70,48,20,0.32),inset_1px_0_0_rgba(255,253,244,0.85)] dark:shadow-[-5px_4px_16px_rgba(0,0,0,0.68)] cursor-grab active:cursor-grabbing"
        >
          {/* Top turned-wood scroll finial cap */}
          <span aria-hidden="true" className="-mt-2.5 h-2.5 w-5 rounded-t-full border border-[#4E3316] bg-[linear-gradient(90deg,#5C3D1C_0%,#9E723D_48%,#472E14_100%)] shadow-xs" />
          {/* Inner vertical stitch lines */}
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-2.5 left-1 right-1 rounded-l-xl border-l border-dashed border-[#B99252]/75 dark:border-[#8C6E42]/60" />

          {/* Embroidered Gold-Thread Stitched Chevron Emblem on the Roller (no number badge) */}
          <span className="relative flex items-center justify-center">
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className={`h-5 w-5 text-[#9C6E21] drop-shadow-[0_1px_0_rgba(255,252,240,0.85)] transition-transform duration-300 dark:text-[#DFB968] dark:drop-shadow-[0_1px_1px_rgba(0,0,0,0.75)] ${open ? 'rotate-180' : ''}`}
            >
              {/* Outer embroidered running-stitch medallion ring */}
              <circle
                cx="12"
                cy="12"
                r="9.2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.25"
                strokeDasharray="2.3 1.9"
                strokeLinecap="round"
                opacity="0.72"
              />
              {/* Hand-stitched embroidered chevron arrow (<) */}
              <path
                d="M14.4 7.2 L9.2 12 L14.4 16.8"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.1"
                strokeDasharray="2.4 1.55"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Tiny French-knot stitch dots at top & bottom */}
              <circle cx="12" cy="4.9" r="0.85" fill="currentColor" opacity="0.75" />
              <circle cx="12" cy="19.1" r="0.85" fill="currentColor" opacity="0.75" />
            </svg>
            {anyGroupWorking && (
              <svg viewBox="0 0 12 12" aria-hidden="true" className="guild-crown-sparkle pointer-events-none absolute -top-1 -left-0.5 h-2.5 w-2.5 text-[#F4BE37] dark:text-[#FFE48F]">
                <path d="M6 0.5 C6.45 4 8 5.55 11.5 6 C8 6.45 6.45 8 6 11.5 C5.55 8 4 6.45 0.5 6 C4 5.55 5.55 4 6 0.5 Z" fill="currentColor" />
              </svg>
            )}
          </span>

          {/* Bottom turned-wood scroll finial cap */}
          <span aria-hidden="true" className="-mb-2.5 h-2.5 w-5 rounded-b-full border border-[#4E3316] bg-[linear-gradient(90deg,#5C3D1C_0%,#9E723D_48%,#472E14_100%)] shadow-xs" />
        </button>

        {/* Unfurled Parchment Scroll Sheet holding the Group Chat Room List */}
        <div
          style={{ width: SCROLL_SHEET_WIDTH }}
          className="relative overflow-hidden rounded-l-[20px] border-y-[1.5px] border-l-[1.5px] border-[#B69256] dark:border-[#785E38] bg-[linear-gradient(165deg,#FFF9EB_0%,#F6E9CE_52%,#EEDBB8_100%)] dark:bg-[linear-gradient(165deg,#2D2419_0%,#231C13_55%,#1C160F_100%)] py-3 pr-3 pl-4 shadow-[-10px_12px_28px_-8px_rgba(70,48,20,0.38),inset_0_1.5px_0_rgba(255,253,245,0.9)] dark:shadow-[-12px_14px_32px_-6px_rgba(0,0,0,0.78),inset_0_1px_0_rgba(255,230,180,0.12)]"
        >
          {/* Inner dashed parchment stitch border */}
          <span aria-hidden="true" className="pointer-events-none absolute inset-1.5 rounded-l-[14px] border border-r-0 border-dashed border-[#C9A86A]/85 dark:border-[#856A3F]/60" />
          {/* Right edge rolled-paper shadow depth */}
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-2.5 bg-[linear-gradient(90deg,transparent_0%,rgba(140,100,45,0.22)_100%)] dark:bg-[linear-gradient(90deg,transparent_0%,rgba(0,0,0,0.48)_100%)]" />

          <div className="relative mb-2 flex items-center justify-between gap-2 rounded-xl border border-[#DEC492]/90 bg-[#FFFDF6]/82 px-2.5 py-1.5 shadow-[0_2px_0_rgba(140,104,52,0.12)] dark:border-[#5E4B2E] dark:bg-[#19140E]/78">
            <div className="flex min-w-0 items-center gap-1.5">
              <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3.5 w-3.5 shrink-0">
                {[0, 72, 144, 216, 288].map(angle => (
                  <ellipse key={angle} cx="10" cy="5.3" rx="2.9" ry="4.3" transform={`rotate(${angle} 10 10)`} fill="#E69AA8" />
                ))}
                <circle cx="10" cy="10" r="2.1" fill="#FBE79C" />
              </svg>
              <span className="truncate font-display text-xs font-extrabold tracking-wide text-[#43321B] dark:text-[#F3E6CA]">
                {t('topbar.group.label')}
              </span>
            </div>
            <span className="shrink-0 rounded-full border border-[#DEC492]/80 bg-[#F3E4C4]/80 px-2 py-0.5 font-mono text-[10px] font-bold text-[#6B5527] dark:border-[#5C492C] dark:bg-[#33291A]/85 dark:text-[#D6C390]">
              {groups.length}
            </span>
          </div>

          {/* Scrollable Group Chat Room Cards */}
          <div className="relative max-h-[46dvh] space-y-1.5 overflow-y-auto pr-0.5">
            {groups.map(group => {
              const isPicked = pickedId === group.id;
              const groupWorking = group.members.some(member => Boolean(working[member.roomId]));
              return (
                <button
                  key={group.id}
                  type="button"
                  data-scroll-group-id={group.id}
                  onClick={e => handlePickGroup(group, e.currentTarget)}
                  className={`relative flex w-full items-center gap-2 rounded-xl border-[1.5px] px-2.5 py-2 text-left transition-all duration-200 cursor-pointer ${
                    isPicked
                      ? 'scale-[1.03] border-[#C86D7D] bg-[linear-gradient(165deg,#FFF2F5_0%,#FAD9E1_100%)] text-[#5C2432] ring-2 ring-[#D9828B]/65 shadow-[2px_3px_0_rgba(166,87,114,0.32)] dark:border-[#EFA4B2] dark:bg-[linear-gradient(165deg,#3E2434_0%,#2E1A26_100%)] dark:text-[#FADCE4]'
                      : 'border-[#DEC9A0] bg-[#FFFDF8]/90 text-[#43321B] shadow-[1.5px_2px_0_rgba(130,96,48,0.16)] hover:border-[#C7A66B] active:scale-[0.98] dark:border-[#54432B] dark:bg-[#171310]/82 dark:text-[#F2E9D8] dark:shadow-[1.5px_2px_0_rgba(0,0,0,0.42)]'
                  }`}
                >
                  <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#E5D2B0] bg-[#FFFBF2] shadow-2xs dark:border-[#4F3F29] dark:bg-[#231C14]">
                    <GroupCloverIcon group={group} />
                    {groupWorking && (
                      <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#D99B26] opacity-75" />
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#E5A93B]" />
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-[12.5px] font-bold leading-tight">
                      {group.name}
                    </span>
                    <span className="block truncate text-[10px] font-semibold text-[#7A6430] dark:text-[#CDBA88]">
                      {t('topbar.group.members', { count: group.members.length })}
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-transform ${
                      isPicked
                        ? 'scale-110 border-[#B84A5E] bg-[#C85A6E] text-white shadow-xs'
                        : 'border-[#DEC492] bg-[#F6E8CC] text-[#7A5B2B] dark:border-[#5C492C] dark:bg-[#2E2417] dark:text-[#D6C390]'
                    }`}
                  >
                    {isPicked ? <Check className="h-3 w-3 stroke-[2.8]" /> : <span className="text-[10px] leading-none">✦</span>}
                  </span>
                </button>
              );
            })}
            {groups.length === 0 && (
              <p className="rounded-xl border border-dashed border-[#D6BE92] bg-[#FFFDF8]/75 px-3 py-3 text-center text-xs font-semibold text-[#7A6430] dark:border-[#54432B] dark:bg-[#171310]/65 dark:text-[#CDBA88]">
                {t('topbar.group.empty')}
              </p>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
