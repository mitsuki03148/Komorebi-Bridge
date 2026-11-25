import { useT } from '../../i18n/useLang';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Search } from 'lucide-react';

export interface PickItem { key: string; label: string; sub?: string; mark?: ReactNode }

/** A button that opens a list with a search box on top; typing narrows the list. */
export function SearchPicker({ icon, value, items, onPick, placeholder, emptyLabel, loading, emptyText, title, initiallyOpen = false }: {
  icon?: ReactNode; value: string; items: PickItem[]; onPick: (key: string) => void; placeholder: string;
  /** What the button shows while nothing is picked (for example <repo>). */
  emptyLabel?: string; loading?: boolean; emptyText?: string; title?: string; initiallyOpen?: boolean;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(initiallyOpen);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const needle = query.trim().toLowerCase();
  const shown = needle ? items.filter(item => `${item.label} ${item.sub ?? ''}`.toLowerCase().includes(needle)) : items;
  return <div ref={root} className="relative min-w-0">
    <button type="button" aria-haspopup="listbox" aria-expanded={open} title={title ?? value} onClick={() => { setOpen(!open); setQuery(''); }}
      className="flex min-h-9 w-full min-w-0 items-center gap-1.5 rounded-full border border-[#E5D7C6] dark:border-[#364062] bg-white/90 dark:bg-[#1E253D] px-3 text-xs font-semibold text-[#4A3E36] dark:text-[#ECE7DF] shadow-[0_1px_2px_rgba(90,70,50,0.03)] transition hover:bg-white dark:hover:bg-[#252D49]">
      {icon}<span className="min-w-0 flex-1 truncate text-left">{value || emptyLabel || placeholder}</span><ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#9A887C] dark:text-[#8E98B8]" aria-hidden="true" />
    </button>
    {open && <div role="listbox" data-picker-list className="absolute left-0 top-full z-40 mt-1.5 w-[min(22rem,calc(100vw-2.5rem))] rounded-[24px] border border-[#E5D7C6] dark:border-[#343D5E] bg-[#FFFDF9]/96 dark:bg-[#1B2238]/96 p-2 shadow-[0_18px_40px_-10px_rgba(74,62,54,0.28)] backdrop-blur-md">
      <label className="flex items-center gap-1.5 rounded-full border border-[#E6DCD0] dark:border-[#364062] bg-white dark:bg-[#141A2C] px-2.5">
        <Search className="h-3.5 w-3.5 text-[#9A887C] dark:text-[#8E98B8]" aria-hidden="true" />
        <input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={placeholder} aria-label={placeholder} spellCheck={false} autoCapitalize="none" autoCorrect="off"
          onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } if (event.key === 'Enter' && shown[0]) { onPick(shown[0].key); setOpen(false); } }}
          className="min-h-9 min-w-0 flex-1 bg-transparent text-base text-[#4A3E36] dark:text-[#ECE7DF] placeholder:text-[#9A887C] dark:placeholder:text-[#7E89A8] outline-none sm:text-xs" />
      </label>
      <ul className="mt-1.5 max-h-72 overflow-y-auto">
        {loading && <li className="px-2 py-2 text-xs text-[#7D6D61] dark:text-[#A4AECC]">{t('github.loading')}</li>}
        {!loading && !shown.length && <li className="px-2 py-2 text-xs text-[#7D6D61] dark:text-[#A4AECC]">{emptyText ?? t('github.picker.empty')}</li>}
        {shown.map(item => <li key={item.key}><button type="button" role="option" aria-selected={item.label === value} data-pick={item.key} onClick={() => { onPick(item.key); setOpen(false); }}
          className="flex w-full items-center gap-1.5 rounded-xl px-2 py-1.5 text-left hover:bg-[#F3ECE1] dark:hover:bg-[#27304D]">
          <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-[#4A3E36] dark:text-[#ECE7DF]">{item.label}</span>{item.sub && <span className="block truncate text-[10px] text-[#8C7A6E] dark:text-[#98A3C2]">{item.sub}</span>}</span>{item.mark}
        </button></li>)}
      </ul>
    </div>}
  </div>;
}
