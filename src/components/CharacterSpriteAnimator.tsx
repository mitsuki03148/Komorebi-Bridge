import { useT } from '../i18n/useLang';
import { useRef, type MouseEvent } from 'react';
import type { CLIModelId } from '../types/guild';
import { AvatarExpression } from './AvatarExpression';
import { PORTRAIT_URLS } from '../data/initialGuildData';

interface CharacterSpriteAnimatorProps {
  modelId: CLIModelId;
  avatarUrl?: string;
  working?: boolean;
  unread?: boolean;
  waiting?: boolean;
  size?: 'sm' | 'md' | 'lg';
  onClickSprite?: () => void;
}

export function CharacterSpriteAnimator({
  modelId, avatarUrl, working, unread, waiting, size = 'md', onClickSprite,
}: CharacterSpriteAnimatorProps) {
  const { t } = useT();
  const portraitRef = useRef<HTMLDivElement>(null);
  const poke = useRef<Animation | undefined>(undefined);
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onClickSprite?.();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    poke.current?.cancel();
    poke.current = portraitRef.current?.animate(
      [{ transform: 'none' }, { transform: 'translateY(-2px) rotate(-2deg)' }, { transform: 'none' }],
      { duration: 360, easing: 'ease-out' },
    );
  };

  const boxSizeClass = size === 'sm' ? 'w-11 h-11 rounded-2xl' :
    size === 'lg' ? 'w-24 h-24 rounded-3xl' : 'w-[76px] h-[76px] rounded-2xl';
  const border = waiting ? 'border-[#E89B48] shadow-xs' : modelId === 'AGY' ? 'border-[#EBC5CA]' :
    modelId === 'CODEX' ? 'border-[#B8D4BE]' : 'border-[#BDD0E4]';
  const imgSrc = avatarUrl || PORTRAIT_URLS[modelId];
  const className = `relative ${boxSizeClass} ${border} shrink-0 select-none overflow-hidden bg-[#FAF4EB] border-2`;
  const portrait = <>
    <div ref={portraitRef} className={`absolute pointer-events-none origin-bottom ${size === 'sm' ? 'inset-1' : 'inset-0 translate-y-px'}`}>
      <img src={imgSrc} alt="" referrerPolicy="no-referrer" className="h-full w-full object-contain" />
      <AvatarExpression modelId={modelId} src={imgSrc} working={working} unread={unread} />
    </div>
    {waiting && size !== 'sm' && <span aria-hidden="true" className="absolute bottom-0.5 left-0.5 rounded-full bg-[#A8652B] px-1 text-[8px] font-bold leading-3 text-white">{t('avatar.approval')}</span>}
    {unread && <span aria-hidden="true" className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-[#D9828B] ring-1 ring-white" />}
  </>;

  return onClickSprite
    ? <button type="button" onClick={handleClick} aria-label={unread ? t('avatar.hello.unread') : t('avatar.hello')} className={`${className} cursor-pointer`}>{portrait}</button>
    : <div aria-hidden="true" className={className}>{portrait}</div>;
}
