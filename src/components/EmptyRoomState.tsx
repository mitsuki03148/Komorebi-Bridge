import { useT } from '../i18n/useLang';
import type { I18nKey } from '../i18n';
import { useEffect, useState } from 'react';
import type { CharacterProfile, CLIModelId, TerminalRoom } from '../types/guild';
import { GUILD_HALL_BANNER, GUILD_HALL_NIGHT_BANNER, INITIAL_CHARACTERS } from '../data/initialGuildData';
import { useTheme } from '../utils/theme';
import { CornerFloralSprig } from './BotanicalAccents';
import { GuildQuestBoard } from './GuildQuestBoard';

export const chibi: Record<CLIModelId, string> = {
  AGY: '/avatars/hitomi-chibi.webp',
  CODEX: '/avatars/hikaru-chibi.webp',
  CLAUDE: '/avatars/hibiki-chibi.webp',
};

export const debutMeta: Record<CLIModelId, {
  modelLabel: string;
  kana: string;
  accent: string;
  accentSoft: string;
  halo: string;
  petal: string;
  border: string;
  cornerOffsetClass: string;
  extraLines: I18nKey[];
}> = {
  AGY: {
    modelLabel: 'Gemini',
    kana: 'HITOMI · ひとみ',
    accent: '#C86D7D',
    accentSoft: 'rgba(224, 122, 134, 0.16)',
    halo: 'rgba(224, 122, 134, 0.22)',
    petal: '#F3C7D0',
    border: 'rgba(200, 109, 125, 0.45)',
    cornerOffsetClass: '-left-1.5 -bottom-1',
    extraLines: [
      'voice.hitomi.inspect',
      'voice.hitomi.sunny',
    ],
  },
  CODEX: {
    modelLabel: 'Codex',
    kana: 'HIKARU · ひかる',
    accent: '#5B8763',
    accentSoft: 'rgba(107, 147, 114, 0.16)',
    halo: 'rgba(107, 147, 114, 0.22)',
    petal: '#C6DDC2',
    border: 'rgba(91, 135, 99, 0.45)',
    cornerOffsetClass: '-left-1.5 -bottom-1',
    extraLines: [
      'voice.hikaru.compare',
      'voice.hikaru.draft',
    ],
  },
  CLAUDE: {
    modelLabel: 'Claude',
    kana: 'HIBIKI · ひびき',
    accent: '#5C82AD',
    accentSoft: 'rgba(107, 142, 184, 0.16)',
    halo: 'rgba(107, 142, 184, 0.22)',
    petal: '#C8D6EE',
    border: 'rgba(92, 130, 173, 0.45)',
    cornerOffsetClass: '-left-4 -bottom-1',
    extraLines: [
      'voice.hibiki.bookmark',
      'voice.hibiki.details',
    ],
  },
};

const chibiFaces: Record<CLIModelId, {
  skinColor: string;
  skin: string;
  crease: string;
  lids: string;
  cheeks: [number, number][];
  sparkles: [number, number][];
  smileGlow: string;
  lantern: [number, number];
}> = {
  AGY: {
    skinColor: '#F8E0D0',
    skin: 'M273 208 Q300 170 324 203 Q301 245 273 208Z M353 193 Q380 152 407 185 Q380 230 353 193Z',
    crease: 'M281 200 Q301 192 318 199 M360 184 Q380 175 399 182',
    lids: 'M277 210 Q301 222 321 205 M356 195 Q380 206 403 187',
    cheeks: [[295, 226], [386, 213]],
    sparkles: [[297, 200], [374, 185]],
    smileGlow: 'M333 248 Q348 254 363 243',
    lantern: [270, 560],
  },
  CODEX: {
    skinColor: '#F7E5D2',
    skin: 'M278 204 Q302 174 324 202 Q302 230 278 204Z M350 191 Q373 162 396 188 Q373 218 350 191Z',
    crease: 'M285 198 Q302 192 318 198 M356 185 Q373 179 389 185',
    lids: 'M282 205 Q302 214 321 203 M353 192 Q373 201 393 189',
    cheeks: [[294, 222], [380, 211]],
    sparkles: [[299, 199], [370, 186]],
    smileGlow: 'M331 250 Q350 253 367 244',
    lantern: [210, 470],
  },
  CLAUDE: {
    skinColor: '#F6DEC9',
    skin: 'M268 221 Q289 193 308 219 Q289 245 268 221Z M342 205 Q363 177 382 203 Q363 230 342 205Z',
    crease: 'M275 215 Q289 209 303 215 M349 199 Q363 193 377 199',
    lids: 'M272 222 Q289 231 306 220 M346 206 Q363 215 380 204',
    cheeks: [[284, 240], [370, 224]],
    sparkles: [[284, 214], [358, 198]],
    smileGlow: 'M321 268 Q341 271 359 261',
    lantern: [235, 665],
  },
};

export function ChibiExpression({ modelId, active }: { modelId: CLIModelId; active: boolean }) {
  const face = chibiFaces[modelId];
  const glowId = `chibi-lantern-${modelId}`;
  return (
    <svg aria-hidden="true" viewBox="0 0 672 900" preserveAspectRatio="xMinYMax meet" data-chibi-expression={modelId}
      className="pointer-events-none absolute inset-0 h-full w-full">
      <defs>
        <radialGradient id={glowId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFE89E" stopOpacity="0.65" />
          <stop offset="55%" stopColor="#F6C868" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#F6C868" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={face.lantern[0]} cy={face.lantern[1]} r="42" fill={`url(#${glowId})`} className="guild-chibi-lantern" />
      <g data-cli={modelId} className="guild-chibi-blink">
        <path d={face.skin} fill={face.skinColor} />
        <path d={face.crease} fill="none" stroke="#B98E76" strokeWidth="2.2" strokeLinecap="round" opacity="0.6" />
        <path d={face.lids} fill="none" stroke="#4D3328" strokeWidth="4.2" strokeLinecap="round" />
      </g>
      <g data-cli={modelId} className="guild-chibi-smile" style={active ? { opacity: 1 } : undefined}>
        {face.cheeks.map(([cx, cy]) => (
          <ellipse key={cx} cx={cx} cy={cy} rx="15" ry="8" fill="#E88580" opacity={active ? '0.48' : '0.34'} />
        ))}
        {face.sparkles.map(([sx, sy]) => (
          <circle key={sx} cx={sx} cy={sy} r={active ? '4.2' : '3.4'} fill="#FFFDF9" opacity="0.95" />
        ))}
        <path d={face.smileGlow} fill="none" stroke="#DF827A" strokeWidth="2.6" strokeLinecap="round" opacity="0.45" />
      </g>
    </svg>
  );
}

export const IDLE_QUOTE_INTERVAL_MS = 7500;

export function nextQuoteIndex(current: number, total: number) {
  return total > 1 ? (current + 1) % total : 0;
}

/**
 * What is on screen when no room is open: a sunlit Komorebi stage with soft window rays, drifting petals and motes,
 * a grounded 3/4-body anime portrait in the bottom-left corner with calibrated blinks, a clean speech bubble that
 * gently cycles lines over time, and a slim stationery nameplate.
 */
export function EmptyRoomState({
  modelId,
  character,
  working = false,
  rooms = [],
  pinnedKeys,
  onSelectRoom,
  workingRooms,
}: {
  modelId: CLIModelId;
  character: CharacterProfile;
  working?: boolean;
  rooms?: TerminalRoom[];
  pinnedKeys?: readonly string[];
  onSelectRoom?: (roomId: string) => void;
  workingRooms?: Record<string, string>;
}) {
  const { t } = useT();
  const { isDark } = useTheme();
  const meta = debutMeta[modelId];
  const [lineIndex, setLineIndex] = useState(0);
  const idleKeys = { AGY: 'voice.hitomi.idle', CODEX: 'voice.hikaru.idle', CLAUDE: 'voice.hibiki.idle' } as const;
  const idle = character.quotes.idle === INITIAL_CHARACTERS[modelId].quotes.idle ? t(idleKeys[modelId]) : character.quotes.idle;
  const lines = [idle, ...meta.extraLines.map(key => t(key))];

  useEffect(() => {
    setLineIndex(0);
    if (lines.length <= 1) return;
    const timer = window.setInterval(() => {
      setLineIndex(prev => nextQuoteIndex(prev, lines.length));
    }, IDLE_QUOTE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [modelId, lines.length]);

  return (
    <div data-empty-state={modelId}
      className="relative flex min-h-0 flex-1 flex-col justify-between overflow-hidden select-none">
      {/* Komorebi conservatory depth-of-field scrim, window rays, dreamy bokeh orbs, role halo, and stars/petals */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <img
          src={isDark ? GUILD_HALL_NIGHT_BANNER : GUILD_HALL_BANNER}
          alt=""
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover opacity-22 dark:opacity-50"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#FBF8F3]/74 via-[#FBF8F3]/34 to-[#FBF8F3]/84 dark:from-[#121624]/68 dark:via-[#151B2E]/26 dark:to-[#121624]/82" />
        {/* Subtle arched window lattice reflection in the upper-right */}
        <svg viewBox="0 0 260 260" className="absolute -top-6 -right-6 h-60 w-60 text-[#FFF8E8] dark:text-[#9CB0EE] opacity-45 dark:opacity-20 blur-[1px] sm:h-72 sm:w-72">
          <path d="M40 0 L260 0 L260 220 Q130 210 40 0 Z" fill="currentColor" fillOpacity="0.38" />
          <line x1="115" y1="0" x2="260" y2="145" stroke="#E5D2B5" strokeOpacity="0.45" strokeWidth="2" />
          <line x1="175" y1="0" x2="70" y2="180" stroke="#E5D2B5" strokeOpacity="0.38" strokeWidth="1.5" />
        </svg>
        {/* Diagonal sunbeams (day) / moonlight beams (night) swaying gently from upper-right */}
        <div className="guild-sunbeam-sway absolute -top-24 right-[-10%] h-[130%] w-48 origin-top bg-gradient-to-b from-[#FFF5D6]/60 via-[#FFF2C9]/20 dark:from-[#9CB0EE]/22 dark:via-[#7C8CE0]/8 to-transparent blur-xl sm:w-72" />
        <div className="guild-sunbeam-sway absolute -top-16 right-[18%] h-[120%] w-28 origin-top bg-gradient-to-b from-[#FFEFC2]/46 via-[#FFF5D6]/14 dark:from-[#B4C4F5]/16 dark:via-[#899AE5]/6 to-transparent blur-lg sm:w-44"
          style={{ animationDelay: '-4.2s' }} />
        {/* Dreamy out-of-focus Komorebi bokeh orbs (玉ボケ) */}
        <div className="guild-bokeh-float absolute top-[12%] left-[10%] h-28 w-28 rounded-full bg-[radial-gradient(circle,rgba(255,244,208,0.42)_0%,transparent_72%)] dark:bg-[radial-gradient(circle,rgba(247,227,163,0.14)_0%,transparent_72%)] blur-2xl sm:h-36 sm:w-36" />
        <div className="guild-bokeh-float absolute top-[36%] right-[12%] h-32 w-32 rounded-full blur-3xl sm:h-40 sm:w-40"
          style={{ background: `radial-gradient(circle, ${meta.halo} 0%, transparent 72%)`, animationDelay: '-3.1s' }} />
        <div className="guild-bokeh-float absolute top-[20%] right-[34%] h-20 w-20 rounded-full bg-[radial-gradient(circle,rgba(255,246,220,0.45)_0%,transparent_72%)] dark:bg-[radial-gradient(circle,rgba(196,214,255,0.14)_0%,transparent_72%)] blur-2xl"
          style={{ animationDelay: '-5.4s' }} />
        {/* Warm role-tinted / lantern halo behind the seated character */}
        <div className="absolute -bottom-16 -left-16 h-[28rem] w-[26rem] rounded-full blur-3xl sm:h-[34rem] sm:w-[32rem]"
          style={{ background: isDark
            ? `radial-gradient(circle, ${meta.halo} 0%, rgba(244,199,126,0.16) 46%, transparent 72%)`
            : `radial-gradient(circle, ${meta.halo} 0%, rgba(255,244,214,0.32) 46%, transparent 72%)` }} />
        {/* Warm floor grounding shadow beneath the seated character */}
        <div className="absolute -bottom-5 left-2 h-14 w-64 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(110,84,64,0.22)_0%,rgba(110,84,64,0.08)_52%,transparent_78%)] dark:bg-[radial-gradient(ellipse_at_center,rgba(8,10,20,0.55)_0%,rgba(8,10,20,0.2)_52%,transparent_78%)] blur-md sm:w-76" />
        {/* Night soft twinkling stars */}
        {isDark && [
          { left: 16, top: 12, size: 3, delay: '0.2s' },
          { left: 39, top: 8, size: 2.5, delay: '1.4s' },
          { left: 68, top: 15, size: 3.5, delay: '2.6s' },
          { left: 86, top: 10, size: 2.5, delay: '0.9s' },
        ].map(star => (
          <span key={`${star.left}-${star.top}`}
            className="guild-star-twinkle absolute rounded-full bg-[#F7E3A3]/65 blur-[0.5px] shadow-[0_0_10px_rgba(247,227,163,0.45)]"
            style={{ left: `${star.left}%`, top: `${star.top}%`, width: star.size, height: star.size, animationDelay: star.delay }} />
        ))}
        {/* Subtle diffused drifting light-and-shadow halos */}
        {[
          { left: 9, top: 8, size: 36, delay: 0 },
          { left: 24, top: 26, size: 48, delay: 1.4 },
          { left: 38, top: 14, size: 32, delay: 2.7 },
          { left: 53, top: 32, size: 52, delay: 0.8 },
          { left: 67, top: 18, size: 40, delay: 3.5 },
          { left: 79, top: 38, size: 44, delay: 2.1 },
          { left: 88, top: 11, size: 34, delay: 4.3 },
        ].map(orb => (
          <span key={orb.left} data-mote
            className="guild-empty-mote absolute rounded-full blur-md"
            style={{
              left: `${orb.left}%`,
              top: `${orb.top}%`,
              width: orb.size,
              height: orb.size,
              background: isDark
                ? 'radial-gradient(circle, rgba(247,227,163,0.18) 0%, rgba(190,210,255,0.08) 45%, transparent 72%)'
                : 'radial-gradient(circle, rgba(255,244,210,0.48) 0%, rgba(255,232,184,0.18) 45%, transparent 72%)',
              animationDelay: `${orb.delay}s`,
            }} />
        ))}
        {/* Soft role-tinted botanical petals drifting across the room */}
        {[18, 58, 82].map((left, index) => (
          <span key={left}
            className="guild-empty-petal absolute top-0 h-2.5 w-1.5 rounded-[70%_30%_70%_30%] opacity-0"
            style={{ left: `${left}%`, backgroundColor: meta.petal, animationDelay: `${index * 3.4}s` }} />
        ))}
      </div>

      <div key={modelId} className="guild-stage-enter relative mx-auto h-full w-full max-w-2xl">
        {/* Top-Left Cute Guild Quest Board for this character's pinned rooms (max 4) */}
        <GuildQuestBoard
          rooms={rooms.filter(room => room.modelId === modelId)}
          pinnedKeys={pinnedKeys}
          onSelectRoom={onSelectRoom}
          working={workingRooms}
          className="absolute top-3 left-3 z-20 w-[13.5rem] sm:top-5 sm:left-6 sm:w-[15.5rem]"
        />

        {/* Clean Stationery Speech Bubble beside the character, above the nameplate */}
        <div data-speech-bubble={modelId}
          className="absolute right-3.5 bottom-[7.3rem] z-20 max-w-[12.25rem] sm:right-7 sm:bottom-[9.25rem] sm:max-w-[16rem]">
          <div
            className="relative rounded-2xl border border-[#DDD0C0] dark:border-[#364062] bg-[#FFFDF9]/95 dark:bg-[#1A2036]/95 px-3.5 pt-2.5 pb-2 text-left shadow-[0_12px_28px_-12px_rgba(92,75,64,0.16)] dark:shadow-[0_14px_30px_-10px_rgba(4,6,16,0.55)] backdrop-blur-sm sm:px-4 sm:pt-3 sm:pb-2.5">
            <p key={lineIndex} className="guild-quote-fade text-[12.5px] leading-relaxed font-semibold text-[#524035] dark:text-[#ECE7DF] sm:text-sm">
              {lines[lineIndex]}
            </p>
            {/* Subtle progress dots showing idle quote rotation */}
            <div aria-hidden="true" className="mt-1.5 flex items-center justify-end gap-1">
              {lines.map((_, idx) => (
                <span key={idx}
                  className={`h-1 rounded-full transition-all duration-300 ${idx === lineIndex ? 'w-3' : 'w-1 opacity-30'}`}
                  style={{ backgroundColor: idx === lineIndex ? meta.accent : (isDark ? '#8E98B8' : '#8C7A6E') }} />
              ))}
            </div>
            {/* Single-contour speech bubble tail pointing left toward the seated character */}
            <svg aria-hidden="true" viewBox="0 0 22 26"
              className="pointer-events-none absolute top-1/2 -left-[16px] h-5 w-5 -translate-y-1/2 overflow-visible">
              <path d="M22 4 C14 7, 7 11, 1 15 C8 16, 15 17, 22 19 Z"
                className="fill-[#FFFDF9]/95 stroke-[#DDD0C0] dark:fill-[#1A2036]/95 dark:stroke-[#364062]" strokeWidth="1.4" strokeLinejoin="round" />
              <path d="M22 4.5 L22 18.5" className="stroke-[#FFFDF9] dark:stroke-[#1A2036]" strokeWidth="3" />
            </svg>
          </div>
        </div>

        {/* Grounded 3/4-Body Seated Anime Character Stage (stays calmly seated, with natural blinks & lantern glow) */}
        <div className={`pointer-events-none absolute z-10 h-[25.5rem] w-[19rem] sm:h-[29.5rem] sm:w-[22rem] ${meta.cornerOffsetClass}`}>
          <div className="relative h-full w-full select-none">
            <img src={chibi[modelId]} alt={character.characterName} draggable={false}
              className="h-full w-full select-none object-contain object-bottom-left drop-shadow-[0_14px_22px_rgba(92,68,48,0.2)] dark:drop-shadow-[0_14px_26px_rgba(6,8,20,0.55)] dark:brightness-[0.95] dark:contrast-[1.02]" />
            <ChibiExpression modelId={modelId} active={working} />
          </div>
        </div>

        {/* Slim Stationery Bookmark Nameplate (Bottom-Right) */}
        <div data-character-intro={modelId}
          className="pointer-events-none absolute right-3.5 bottom-4 z-20 flex flex-col items-end sm:right-7 sm:bottom-7">
          <div className="relative rounded-2xl border border-[#E4D7C7]/85 dark:border-[#364062]/85 bg-[#FFFDF9]/82 dark:bg-[#192036]/86 px-3.5 py-2 shadow-[0_8px_22px_-12px_rgba(92,75,64,0.16)] dark:shadow-[0_10px_26px_-10px_rgba(4,6,16,0.5)] backdrop-blur-md">
            <CornerFloralSprig modelId={modelId} size={16} className="absolute -top-1.5 -right-1.5 opacity-90" />
            <div className="flex items-stretch gap-2.5">
              <span aria-hidden="true" className="w-[3px] shrink-0 rounded-full"
                style={{ backgroundColor: meta.accent }} />
              <div className="flex flex-col items-start pr-0.5">
                <span className="font-mono text-[9px] font-bold tracking-[0.18em] uppercase"
                  style={{ color: meta.accent }}>
                  {meta.kana}
                </span>
                <div className="mt-0.5 flex items-baseline gap-2">
                  <span className="font-display text-3xl leading-none font-bold tracking-tight text-[#4A3A30] dark:text-[#F2EDE4] sm:text-4xl">
                    {character.characterName}
                  </span>
                  <span className="text-[10.5px] font-semibold tracking-wide text-[#8C7A6E] dark:text-[#A4AECC]">{character.roleTitle}</span>
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-[10px] tracking-wider text-[#8C7A6E] dark:text-[#A4AECC]">
                  <span className="font-bold" style={{ color: meta.accent }}>{meta.modelLabel}</span>
                  <span aria-hidden="true" className="opacity-50">·</span>
                  <span className={working ? 'font-bold' : 'font-medium text-[#9A897D] dark:text-[#98A3C2]'}
                    style={working ? { color: meta.accent } : undefined}>{working ? t('room.working.japanese') : t('room.idle.japanese')}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
