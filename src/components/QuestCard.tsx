import { FilePlus2, FileMinus2, FilePenLine, ScrollText, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useT } from '../i18n/useLang';
import type { FileQuest, QuestKind } from '../utils/questNotice';

const shown = 4;
const kindStyle: Record<QuestKind, { Icon: typeof FilePlus2; tone: string }> = {
  add: { Icon: FilePlus2, tone: 'bg-[#E6F1E6] text-[#4E7F59] dark:bg-[#1F3328] dark:text-[#9AD0A6]' },
  change: { Icon: FilePenLine, tone: 'bg-[#F6EBD3] text-[#8A6420] dark:bg-[#392E1A] dark:text-[#E8C27A]' },
  delete: { Icon: FileMinus2, tone: 'bg-[#F8E3E6] text-[#A44B5A] dark:bg-[#3A2230] dark:text-[#EFA4B2]' },
  gap: { Icon: TriangleAlert, tone: 'bg-[#EDE6F6] text-[#6A58A0] dark:bg-[#2B2542] dark:text-[#B9A9EC]' },
};
const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1) || path;

/** Tiny five-petal sakura blossom for guild parchment corners and wax seals. */
function MiniFlower({ className, petal = '#E69AA8', core = '#FBE79C' }: { className?: string; petal?: string; core?: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={className}>
      {[0, 72, 144, 216, 288].map(angle => (
        <ellipse key={angle} cx="10" cy="5.3" rx="2.9" ry="4.3" transform={`rotate(${angle} 10 10)`} fill={petal} />
      ))}
      <circle cx="10" cy="10" r="2.1" fill={core} />
    </svg>
  );
}

/** Tiny 4-point sparkle star for subtle bling-bling accents. */
function SparkleStar({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className={className}>
      <path d="M6 0.5 C6.45 4 8 5.55 11.5 6 C8 6.45 6.45 8 6 11.5 C5.55 8 4 6.45 0.5 6 C4 5.55 5.55 4 6 0.5 Z" fill="currentColor" />
    </svg>
  );
}

/** The Bridge's file-trigger notice, shown the way a medieval guild posts a new quest: a centered parchment plaque with scalloped wax seal, corner flourishes, what changed, and the standing safety rule. */
export function QuestCard({ quest, time }: { quest: FileQuest; time?: string }) {
  const { t } = useT();
  return <article data-sender="quest" aria-label={`${t('quest.title')} · ${t('quest.source')}`}
    className="relative mx-auto my-2 w-full max-w-[92%] sm:max-w-[27rem] overflow-hidden rounded-[22px] border-[1.5px] border-[#B69256] dark:border-[#785E38] bg-[linear-gradient(165deg,#FFF9EB_0%,#F6E9CE_52%,#EEDBB8_100%)] dark:bg-[linear-gradient(165deg,#2D2419_0%,#231C13_55%,#1C160F_100%)] shadow-[3px_4px_0_rgba(120,88,42,0.22),0_12px_26px_-10px_rgba(110,80,30,0.32),inset_0_1.5px_0_rgba(255,253,245,0.9)] dark:shadow-[3px_4px_0_rgba(6,8,16,0.6),0_12px_28px_-10px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,230,180,0.12)]">
    {/* Inner ornamental parchment stitch frame */}
    <span aria-hidden="true" className="pointer-events-none absolute inset-1.5 rounded-[16px] border border-dashed border-[#C9A86A]/85 dark:border-[#856A3F]/60" />
    {/* Four vintage guild corner flourishes with delicate blossom & sparkle */}
    <span aria-hidden="true" className="pointer-events-none absolute top-2 left-2.5 text-[10px] leading-none text-[#B88B3A] dark:text-[#C8A25A]">✦</span>
    <MiniFlower className="pointer-events-none absolute top-2 right-2.5 h-3 w-3 opacity-85" />
    <MiniFlower className="pointer-events-none absolute bottom-2 left-2.5 h-3 w-3 opacity-85" />
    <span aria-hidden="true" className="pointer-events-none absolute bottom-2 right-2.5 text-[10px] leading-none text-[#B88B3A] dark:text-[#C8A25A]">✦</span>

    <div className="relative px-4 py-3.5 sm:px-5">
      {/* Compact Scalloped Wax Seal + Ribbon Header */}
      <div className="flex items-center justify-between gap-2.5 rounded-2xl border border-[#DEC492]/90 bg-[#FFFDF6]/80 px-3 py-2 shadow-[0_2px_0_rgba(140,104,52,0.14),inset_0_1px_0_#fff] dark:border-[#5E4B2E] dark:bg-[#19140E]/75 dark:shadow-[0_2px_0_rgba(0,0,0,0.35)]">
        <div className="flex min-w-0 items-center gap-2.5">
          {/* Illustrated Scalloped Crimson-Gold Wax Seal with blossom & bling */}
          <span className="relative flex h-9 w-9 shrink-0 items-center justify-center">
            <svg viewBox="0 0 40 40" className="pointer-events-none absolute inset-0 h-full w-full drop-shadow-[0_2px_4px_rgba(110,30,25,0.42)]" aria-hidden="true">
              <path d="M20 1.5 L24.2 4.3 L29.2 3.8 L31.6 8.2 L36.2 10.6 L35.7 15.6 L38.5 19.8 L35.7 24.2 L36.2 29.2 L31.6 31.6 L29.2 36.2 L24.2 35.7 L20 38.5 L15.8 35.7 L10.8 36.2 L8.4 31.6 L3.8 29.2 L4.3 24.2 L1.5 19.8 L4.3 15.6 L3.8 10.6 L8.4 8.2 L10.8 3.8 L15.8 4.3 Z"
                fill="url(#waxGrad)" stroke="#E7C278" strokeWidth="1.2" />
              <circle cx="20" cy="20" r="12.5" fill="none" stroke="#F4D799" strokeWidth="0.9" strokeDasharray="2 1.5" opacity="0.85" />
              <defs>
                <radialGradient id="waxGrad" cx="35%" cy="30%" r="70%">
                  <stop offset="0%" stopColor="#D85B56" />
                  <stop offset="65%" stopColor="#A53533" />
                  <stop offset="100%" stopColor="#7C2222" />
                </radialGradient>
              </defs>
            </svg>
            <ScrollText className="relative z-10 h-4 w-4 text-[#FFF5E1]" aria-hidden="true" />
            <MiniFlower className="pointer-events-none absolute -bottom-0.5 -left-0.5 z-20 h-3.5 w-3.5 drop-shadow-[0_1px_1px_rgba(80,20,20,0.45)]" petal="#F6B8C4" core="#FFF3B8" />
            <SparkleStar className="guild-crown-sparkle pointer-events-none absolute -top-1 -right-1 z-20 h-3 w-3 text-[#F4BE37] dark:text-[#FFE48F]" />
            <SparkleStar className="guild-crown-sparkle guild-crown-sparkle--delayed pointer-events-none absolute -bottom-1 right-0 z-20 h-2 w-2 text-[#F5C84C] dark:text-[#FFF0B8]" />
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-1 font-display text-[9.5px] font-extrabold uppercase tracking-[0.22em] text-[#8E6319] dark:text-[#DFB864]">
              <MiniFlower className="h-2.5 w-2.5 shrink-0" petal="#E397A7" core="#F6D56B" />
              <span>{t('quest.title')}</span>
              <span aria-hidden="true" className="text-[#C8963E] dark:text-[#E8C36E]">✦</span>
            </p>
            <p className="truncate font-display text-[13.5px] font-bold leading-tight text-[#43321B] dark:text-[#F3E6CA]">
              {t('quest.source')}
            </p>
          </div>
        </div>
        {time && <span className="shrink-0 rounded-full border border-[#DEC492]/80 bg-[#F3E4C4]/75 px-2 py-0.5 tabular-nums text-[10.5px] font-bold text-[#6B5527] dark:border-[#5C492C] dark:bg-[#33291A]/85 dark:text-[#D6C390]">{time}</span>}
      </div>

      <ul className="mt-2.5 space-y-1.5">
        {quest.events.slice(0, shown).map((event, index) => {
          const { Icon, tone } = kindStyle[event.kind];
          const name = fileName(event.path);
          return <li key={index} className="flex items-center justify-center gap-2 rounded-xl border-[1.5px] border-[#DEC9A0] bg-[#FFFDF8]/88 px-3 py-2 shadow-[1.5px_2px_0_rgba(130,96,48,0.16)] dark:border-[#54432B] dark:bg-[#171310]/80 dark:shadow-[1.5px_2px_0_rgba(0,0,0,0.4)]">
            <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border border-current/20 px-2 py-0.5 text-[10.5px] font-bold leading-none ${tone}`}><Icon className="h-3 w-3" aria-hidden="true" />{t(`quest.kind.${event.kind}`)}</span>
            <span className="min-w-0 truncate font-display text-[13.5px] font-bold leading-snug text-[#46372B] dark:text-[#F2E9D8]" title={event.path}>{name}</span>
          </li>;
        })}
      </ul>
      {quest.hint && <p className="mt-2 rounded-xl border border-[#E6D6B0] bg-[#FFF8E6]/85 px-2.5 py-1.5 text-[12px] leading-snug text-[#6B5A36] dark:border-[#5B4A2E] dark:bg-[#2F271A]/85 dark:text-[#E3D3AE]"><span className="font-bold">{t('quest.hint')}</span>　<span className="break-words">{quest.hint}</span></p>}
      <p className="mt-2.5 flex items-start gap-1.5 border-t border-dashed border-[#D3B67D]/75 pt-2 text-[11.5px] leading-snug text-[#76612F] dark:border-[#6A5432]/65 dark:text-[#CDBA88]"><ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span>{t('quest.safety')}</span></p>
    </div>
  </article>;
}
