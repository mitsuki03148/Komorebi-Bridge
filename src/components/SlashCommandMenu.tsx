import { useT } from '../i18n/useLang';
import { matchSlashCommands, type CLISlashCommandItem } from '../data/cliCommands';
import type { CLIModelId } from '../types/guild';

export function SlashCommandMenu({ modelId, draft, onSelect }: {
  modelId: CLIModelId;
  draft: string;
  onSelect: (item: CLISlashCommandItem) => void;
}) {
  const { t } = useT();
  const matches = matchSlashCommands(modelId, draft);
  if (!matches.length) return null;
  return <div role="group" aria-label={t('slash.menu.aria')} className="absolute inset-x-2 bottom-full z-30 mb-1.5 overflow-hidden rounded-2xl border border-[#DFD3C3] bg-[#FFFDF9] shadow-xl dark:border-[#343D5E] dark:bg-[#171D31] dark:shadow-[0_18px_40px_-12px_rgba(0,0,0,0.6)]">
    <div className="border-b border-[#E5DAC9] bg-[#F5EFE6] px-3 py-1 text-xs font-semibold dark:border-[#2C3450] dark:bg-[#1C233A] dark:text-[#ECE7DF]">{t('slash.menu.title')}</div>
    <div className="max-h-44 divide-y divide-[#F3ECE1] overflow-y-auto dark:divide-[#262E4A]">
      {matches.map(item => <button key={item.cmd} type="button" onClick={() => onSelect(item)}
        className="flex min-h-9 w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-[#FFF5F6] dark:hover:bg-[#232B47]">
        <code className="shrink-0 rounded bg-[#382F2A] px-1.5 py-0.5 text-[#F9EFE4] dark:bg-[#2B3352] dark:text-[#F4E9DA]">{item.cmd}</code>
        <span className="truncate text-[#5C4D43] dark:text-[#C5CDE3]">{item.desc}</span>
      </button>)}
    </div>
  </div>;
}
