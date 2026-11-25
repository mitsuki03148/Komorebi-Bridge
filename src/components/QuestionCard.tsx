import { useT } from '../i18n/useLang';
import { useEffect, useState } from 'react';
import { MessageCircleQuestion } from 'lucide-react';
import type { PendingQuestion } from '../types/guild';

const short = (title: string) => {
  const line = title.replace(/\s+/g, ' ').trim();
  return line.length > 28 ? `${line.slice(0, 28)}…` : line;
};

/** The message that goes back to the agent: it names each question so the reply cannot be taken for something else. */
export function questionAnswerText(pending: PendingQuestion, answers: string[]) {
  if (pending.questions.length === 1) return `回答你的問題「${short(pending.questions[0].title)}」：${answers[0]}`;
  return `回答你的問題：\n${pending.questions.map((question, index) => `${index + 1}.「${short(question.title)}」：${answers[index]}`).join('\n')}`;
}

export interface QuestionAnswerDetail {
  choice?: number;
  choices?: number[];
  text?: string;
  answers?: { choice?: number; choices?: number[]; text?: string }[];
}

/**
 * Shown while an agent waits for an answer. Tapping Answer opens it: a choice to tap where the agent offered some,
 * and always a box to type in. The answer goes back as an ordinary message.
 */
export function QuestionCard({ pending, name, disabled, onAnswer }: {
  pending: PendingQuestion;
  /** Who is asking, for example 光. */
  name: string;
  disabled?: boolean;
  /** The reply as a message, and which listed answer(s) were picked or what was typed, for a CLI that can be answered directly. */
  onAnswer: (message: string, detail?: QuestionAnswerDetail) => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<(string | undefined)[]>([]);
  const [multiPicked, setMultiPicked] = useState<string[][]>([]);
  const [typed, setTyped] = useState<string[]>([]);
  const [sent, setSent] = useState<string | undefined>();
  useEffect(() => { setOpen(false); setPicked([]); setMultiPicked([]); setTyped([]); }, [pending.id]);
  // If it is still waiting a few seconds after sending, the answer did not go through: show the card again.
  useEffect(() => {
    if (!sent) return;
    const timer = setTimeout(() => setSent(undefined), 8_000);
    return () => clearTimeout(timer);
  }, [sent]);
  if (sent === pending.id) return null;

  const itemDetail = (question: PendingQuestion['questions'][number], index: number): { choice?: number; choices?: number[]; text?: string } | undefined => {
    const own = typed[index]?.trim();
    if (question.multiSelect) {
      const choices = (multiPicked[index] ?? [])
        .map(opt => (question.options?.indexOf(opt) ?? -1) + 1)
        .filter(n => n > 0);
      if (!choices.length && !own) return undefined;
      return {
        ...(choices.length ? { choices } : {}),
        ...(own ? { text: own } : {}),
      };
    }
    if (own) return { text: own };
    if (picked[index] && question.options) return { choice: question.options.indexOf(picked[index]!) + 1 };
    return undefined;
  };

  const answers = pending.questions.map((question, index) => {
    const own = typed[index]?.trim();
    if (question.multiSelect) {
      return [...(multiPicked[index] ?? []), ...(own ? [own] : [])].join(', ');
    }
    return own || picked[index] || '';
  });
  const complete = answers.every(Boolean);
  const submit = () => {
    if (!complete || disabled) return;
    const only = pending.questions.length === 1 ? pending.questions[0] : undefined;
    const detail: QuestionAnswerDetail | undefined = only
      ? itemDetail(only, 0)
      // Several questions go together, one answer each: the CLI only takes them once the last one is in.
      : { answers: pending.questions.map((question, index) => itemDetail(question, index) ?? {}) };
    onAnswer(questionAnswerText(pending, answers), detail);
    setSent(pending.id);
  };

  return (
    <section aria-label={t('question.waiting', { name })} data-question-id={pending.id}
      className="relative my-1.5 w-full overflow-hidden rounded-2xl border border-[#E8D8DC]/90 dark:border-[#343E5E]/90 bg-[#FFFDFB]/92 dark:bg-[#171E33]/92 p-3 sm:p-3.5 text-xs shadow-[0_8px_22px_-12px_rgba(140,100,112,0.16),inset_0_1px_0_rgba(255,255,255,0.9)] dark:shadow-[0_10px_26px_-12px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.07)] backdrop-blur-md">
      <div className="space-y-2.5">
        {/* Clean, airy header matching the chatroom theme with a subtle sakura accent */}
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border border-[#F0D6DC] bg-[#FFF4F6] text-[#C26A7E] shadow-2xs dark:border-[#4B3648] dark:bg-[#2B2030] dark:text-[#EFA4B2]">
              <MessageCircleQuestion className="h-3.5 w-3.5" aria-hidden="true" />
              <svg viewBox="0 0 20 20" aria-hidden="true" className="pointer-events-none absolute -top-1 -right-1 h-2.5 w-2.5">
                {[0, 71, 145, 215, 289].map(angle => (
                  <path key={angle} d="M10 9.4 C7.2 8.1 6.6 3.7 8.9 1.7 C9.6 1.3 10 1.9 10 2.3 C10 1.9 10.5 1.3 11.1 1.7 C13.4 3.7 12.8 8.1 10 9.4 Z" transform={`rotate(${angle} 10 10)`} fill="#E89AA8" />
                ))}
                <circle cx="9.9" cy="10" r="2.05" fill="#FBE79C" />
              </svg>
            </span>
            <strong className="min-w-0 flex-1 truncate text-[13px] font-bold text-[#4A3E36] dark:text-[#ECE7DF]">{t('question.waiting', { name })}</strong>
          </div>
          <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open}
            className="min-h-8 shrink-0 rounded-full border border-[#E5D5D9] dark:border-[#3B4568] bg-white dark:bg-[#232B45] px-3.5 py-1 text-xs font-semibold text-[#7A525E] dark:text-[#E2E7F5] shadow-2xs transition hover:bg-[#FFF7F9] dark:hover:bg-[#2B3554] active:scale-[0.98] cursor-pointer">{open ? t('question.collapse') : t('question.answer')}</button>
        </div>

        {!open && (
          <p className="line-clamp-2 whitespace-pre-wrap rounded-xl border border-[#EFE5DC] dark:border-[#2A324D] bg-[#FAF6F1]/75 dark:bg-[#131829]/70 px-3 py-2 text-[12.5px] leading-relaxed text-[#6E5D52] dark:text-[#C5CDE3]">
            {pending.questions.map(question => question.title).join('　')}
          </p>
        )}

        {open && <form onSubmit={event => { event.preventDefault(); submit(); }} className="max-h-[46dvh] space-y-2.5 overflow-y-auto pr-0.5">
          {pending.questions.map((question, index) => (
            <fieldset key={index} className="space-y-2 rounded-xl border border-[#EFE5DC] dark:border-[#2B3350] bg-[#FAF6F1]/75 dark:bg-[#131829]/75 p-2.5 sm:p-3">
              <legend className="px-0.5 whitespace-pre-wrap break-words text-[13px] font-bold leading-snug text-[#43362E] dark:text-[#ECE7DF]">{pending.questions.length > 1 ? `${index + 1}. ` : ''}{question.title}</legend>
              {question.options && <div className="flex flex-wrap gap-1.5">
                {question.options.map(option => {
                  const on = question.multiSelect
                    ? (multiPicked[index] ?? []).includes(option)
                    : picked[index] === option && !typed[index]?.trim();
                  return <button key={option} type="button" aria-pressed={on} disabled={disabled}
                    onClick={() => {
                      if (question.multiSelect) {
                        setMultiPicked(current => {
                          const next = [...current];
                          const list = next[index] ?? [];
                          next[index] = list.includes(option) ? list.filter(item => item !== option) : [...list, option];
                          return next;
                        });
                      } else {
                        setPicked(current => { const next = [...current]; next[index] = option; return next; });
                        setTyped(current => { const next = [...current]; next[index] = ''; return next; });
                      }
                    }}
                    className={`group flex min-h-9 items-center gap-2 rounded-xl border px-3 py-1.5 text-left text-[12.5px] font-semibold leading-snug transition active:scale-[0.99] cursor-pointer ${
                      on
                        ? 'border-[#D8899A] bg-[#FFF1F4] text-[#6E3545] ring-1 ring-[#E8A6B5]/55 shadow-2xs dark:border-[#E295A6] dark:bg-[#352233] dark:text-[#FADCE4] dark:ring-[#E295A6]/40'
                        : 'border-[#E4D9CC] bg-white text-[#4A3E36] shadow-2xs hover:border-[#D9BCC3] hover:bg-[#FFF9FA] dark:border-[#343E5E] dark:bg-[#1E263F] dark:text-[#DCE2F2] dark:hover:border-[#53608A] dark:hover:bg-[#252F4D]'
                    }`}>
                    <span aria-hidden="true" className={`flex h-4 w-4 shrink-0 items-center justify-center ${question.multiSelect ? 'rounded-[5px]' : 'rounded-full'} border transition ${
                      on
                        ? 'border-[#C86B7E] bg-[#C86B7E] text-white dark:border-[#EFA4B2] dark:bg-[#EFA4B2] dark:text-[#2A1B28]'
                        : 'border-[#CCC0B4] bg-white group-hover:border-[#D89AA7] dark:border-[#53608A] dark:bg-[#171E33]'
                    }`}>
                      {on && (
                        <svg viewBox="0 0 12 12" className="guild-hand-check h-2.5 w-2.5 overflow-visible" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M2.2 6.4 Q 4.1 8.4, 4.9 9.1 C 6.4 6.3, 8.2 4.1, 10.1 2.5" />
                        </svg>
                      )}
                    </span>
                    <span>{option}</span>
                  </button>;
                })}
              </div>}
              <input type="text" value={typed[index] ?? ''} disabled={disabled} aria-label={question.options ? t('question.input.alternative') : t('question.input.label')}
                placeholder={question.options ? t('question.input.placeholder.alternative') : t('question.input.placeholder')}
                onChange={event => setTyped(current => { const next = [...current]; next[index] = event.target.value; return next; })}
                className="min-h-9 w-full rounded-xl border border-[#E4D9CC] dark:border-[#343E5E] bg-white/90 dark:bg-[#161C30] px-3 text-base sm:text-sm text-[#4A3E36] dark:text-[#ECE7DF] placeholder:text-xs placeholder:text-[#9A897C] dark:placeholder:text-[#7E89A8] outline-none focus:border-[#D8899A] dark:focus:border-[#EFA4B2]" />
            </fieldset>
          ))}
          <button type="submit" disabled={!complete || disabled}
            className="min-h-9 w-full rounded-xl bg-[#B56579] hover:bg-[#A6576B] dark:bg-[#C06E82] dark:hover:bg-[#CC798D] px-4 text-xs font-bold tracking-wide text-white shadow-xs transition active:scale-[0.99] disabled:opacity-45 cursor-pointer">{t('question.submit')}</button>
        </form>}
      </div>
    </section>
  );
}
