import { useEffect, useState } from 'react';
import { StoragePanel } from './StorageUsage';
import type { StorageUsage } from '../../bridge/storage-usage';
import { Bell, ChevronUp, Clock, RotateCw, Folder, Languages, FolderOpen, Mic, Minimize2, MonitorSmartphone, MoonStar, ShieldCheck, QrCode, Settings2, Smartphone, Sparkles, Sun, SunMoon, Volume2, X } from 'lucide-react';
import type { CharacterProfile, CLIModelId, TerminalRoom } from '../types/guild';
import { QrCodeMatrix } from './QrCodeMatrix';
import { useEscape } from '../utils/roomUi';
import { focusScope } from '../utils/focusScope';
import type { PushControl } from '../utils/usePush';
import type { LaunchModes } from '../types/bridge';
import { languages, setLang } from '../i18n';
import { useT } from '../i18n/useLang';
import type { I18nKey } from '../i18n';
import type { ConfirmOptions } from './ConfirmDialog';
import { translateServerNotice } from '../i18n/serverNotice';
import { themeModes, useTheme, type ThemeMode } from '../utils/theme';
import { readVoiceLanguage, voiceLanguages, writeVoiceLanguage, type VoiceLanguage } from '../utils/voice';

function Shell({ title, icon, onClose, children, headerAction, wide = false }: {
  title: string; icon: React.ReactNode; onClose: () => void; children: React.ReactNode; headerAction?: React.ReactNode; wide?: boolean;
}) {
  const { t } = useT();
  useEscape(true, onClose);
  return (
    <div onClick={event => { if (event.target === event.currentTarget) onClose(); }}
      className="guild-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-[#4A3E36]/40 dark:bg-[#090C16]/68 p-4 backdrop-blur-xs">
      <section ref={focusScope} role="dialog" aria-modal="true" aria-label={title}
        className={`guild-dialog-in w-full ${wide ? 'max-w-2xl' : 'max-w-md'} flex max-h-[90dvh] flex-col overflow-hidden rounded-3xl border border-[#E2D6C5] dark:border-[#313958] bg-[#FBF8F3] dark:bg-[#171D31] shadow-2xl`}>
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#E5DAC9] dark:border-[#2C3450] bg-[#F5EFE6] dark:bg-[#1C233A] px-4 py-3.5 sm:px-6 sm:py-4">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <h3 className="flex min-w-0 items-center gap-2 font-display text-[15px] leading-snug font-bold text-[#4A3E36] dark:text-[#ECE7DF] sm:text-base">{icon}<span className="min-w-0 truncate">{title}</span></h3>
            {headerAction}
          </div>
          <button type="button" aria-label={t('settings.close')} onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#E2D6C5] dark:border-[#364062] bg-white dark:bg-[#232B45] text-[#7D6D61] dark:text-[#B5BED6]"><X className="h-4 w-4" /></button>
        </div>
        {/* The rounded frame clips, and only the body scrolls, so the scroll bar stays inside the corners. */}
        <div data-modal-body className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6 text-xs text-[#4A3E36] dark:text-[#E2DDD4] [&::-webkit-scrollbar-track]:my-2 [&::-webkit-scrollbar-track]:bg-transparent">{children}</div>
      </section>
    </div>
  );
}

function Toggle({ icon, title, detail, on, onChange, disabled }: {
  icon: React.ReactNode; title: string; detail: string; on: boolean; onChange: (value: boolean) => void; disabled?: boolean;
}) {
  const { t } = useT();
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#E6DCD0] dark:border-[#2E3654] bg-white dark:bg-[#1E253D] p-3.5">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5 shrink-0 text-[#D9828B] dark:text-[#EFA4B2]">{icon}</span>
        <div><div className="font-bold text-[#4A3E36] dark:text-[#ECE7DF]">{title}</div><div className="mt-0.5 [overflow-wrap:anywhere] text-[#7D6D61] dark:text-[#A4AECC]">{detail}</div></div>
      </div>
      <button type="button" role="switch" aria-checked={on} aria-label={title} disabled={disabled} onClick={() => onChange(!on)}
        className={`shrink-0 rounded-full px-3.5 py-1.5 font-bold disabled:opacity-40 ${on ? 'bg-[#D9828B] dark:bg-[#C9788A] text-white' : 'bg-[#F3ECE1] dark:bg-[#27304D] text-[#7D6D61] dark:text-[#A7B0CA]'}`}>
        {on ? t('settings.toggle.on') : t('settings.toggle.off')}
      </button>
    </div>
  );
}

const themeIcons: Record<ThemeMode, React.ComponentType<{ className?: string }>> = {
  auto: Clock,
  system: MonitorSmartphone,
  light: Sun,
  dark: MoonStar,
};

/** Compact 4-icon day/night selector matching Komorebi's soft capsule language. */
export function ThemePanel() {
  const { t } = useT();
  const { mode, setMode } = useTheme();
  return (
    <div className="space-y-1.5 rounded-2xl border border-[#E6DCD0] dark:border-[#2E3654] bg-white dark:bg-[#1E253D] p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 font-bold text-[#4A3E36] dark:text-[#ECE7DF]">
          <SunMoon className="h-3.5 w-3.5 text-[#D9828B] dark:text-[#F7E3A3]" aria-hidden="true" />
          <span>{t('settings.theme.title')}</span>
        </div>
        <div role="radiogroup" aria-label={t('settings.theme.title')}
          className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-[#E2D6C5] dark:border-[#343D5E] bg-[#F7F2E9] dark:bg-[#141A2C] p-0.5">
          {themeModes.map(id => {
            const Icon = themeIcons[id];
            const label = t(`settings.theme.${id}.label`);
            const active = mode === id;
            return (
              <button key={id} type="button" role="radio" aria-checked={active} aria-label={label} title={label} data-theme-mode={id}
                onClick={() => setMode(id)}
                className={`flex h-8 w-8 items-center justify-center rounded-full transition-[background-color,color,transform] duration-150 active:scale-90 cursor-pointer ${
                  active
                    ? 'bg-white text-[#C46F7F] shadow-[0_1px_3px_rgba(90,70,50,0.12)] dark:bg-[#283152] dark:text-[#F7E3A3] dark:shadow-none'
                    : 'text-[#8C7A6E] hover:text-[#4A3E36] dark:text-[#8E98B8] dark:hover:text-[#ECE7DF]'
                }`}>
                <Icon className="h-[15px] w-[15px]" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </div>
      <p className="px-0.5 text-[11px] text-[#8C7A6E] dark:text-[#A4AECC]">
        <strong className="font-semibold text-[#5C4E44] dark:text-[#ECE7DF]">{t(`settings.theme.${mode}.label`)}</strong>
        <span aria-hidden="true" className="mx-1.5 opacity-60">·</span>
        <span>{t(`settings.theme.${mode}.detail`)}</span>
      </p>
    </div>
  );
}

/** Lock-screen notifications for rooms that need an approval or have finished. */
export function PushPanel({ push }: { push: PushControl }) {
  const { t } = useT();
  const reason = !push.bridgeReady ? t('settings.push.bridge') : push.support.ok ? undefined : t(({ insecure: 'settings.push.insecure', 'not-installed': 'settings.push.notinstalled', unsupported: 'settings.push.unsupported', denied: 'settings.push.denied' } as const)[push.support.reason]);
  return (
    <div className="space-y-2">
      <Toggle icon={<Bell className="h-4 w-4" />} title={t('settings.push.title')}
        detail={t('settings.push.detail')}
        on={push.enabled} disabled={Boolean(reason) || push.busy} onChange={on => void (on ? push.enable() : push.disable())} />
      {reason && <p role="status" className="px-1 text-[#8D3F48] dark:text-[#F09AA6]">{reason}</p>}
      {push.enabled && (
        <div className="flex items-center gap-2 px-1">
          <button type="button" onClick={push.test} className="min-h-9 rounded-full border border-[#E2D6C5] dark:border-[#364062] bg-white dark:bg-[#232B45] px-4 font-semibold text-[#6E5D52] dark:text-[#C5CDE3] hover:bg-[#FAF5EE] dark:hover:bg-[#2B3554]">{t('settings.push.test')}</button>
          <span className="text-[#7D6D61] dark:text-[#A4AECC]">{t('settings.push.testnote')}</span>
        </div>
      )}
      {push.message && <p role="status" className="px-1 text-[#6E5D52] dark:text-[#A4AECC]">{translateServerNotice(push.message, t)}</p>}
    </div>
  );
}

/** Which language the microphone listens for. Cantonese with English words is the default and works best for that way of talking. */
export function LanguagePanel() {
  const { t, lang } = useT();
  return (
    <div className="space-y-2 rounded-2xl border border-[#E6DCD0] dark:border-[#2E3654] bg-white dark:bg-[#1E253D] p-3.5">
      <div className="flex items-center gap-1.5 font-bold text-[#4A3E36] dark:text-[#ECE7DF]"><Languages className="h-3.5 w-3.5 text-[#7A9580] dark:text-[#96BD9F]" aria-hidden="true" />{t('settings.language.title')}</div>
      <div role="radiogroup" aria-label={t('settings.language.title')} className="flex gap-1">
        {languages.map(id => (
          <button key={id} type="button" role="radio" aria-checked={lang === id} onClick={() => setLang(id)}
            className={`min-h-9 flex-1 rounded-xl px-3 py-2 text-center font-semibold ${lang === id ? 'bg-[#FDECEF] dark:bg-[#312338] text-[#C46F7F] dark:text-[#EFA4B2]' : 'text-[#6E5D52] dark:text-[#A4AECC] hover:bg-[#F3ECE1] dark:hover:bg-[#262E4B]'}`}>{t(`settings.language.${id}`)}</button>
        ))}
      </div>
      <p className="px-1 text-[11px] text-[#8C7A6E] dark:text-[#9AA4C2]">{t('settings.language.note')}</p>
    </div>
  );
}

const voiceIcons: Record<VoiceLanguage, React.ReactNode> = {
  zh: <span aria-hidden="true" className="font-display text-[12px] font-bold leading-none">普</span>,
  yue: <span aria-hidden="true" className="font-display text-[12px] font-bold leading-none">粵</span>,
  en: <span aria-hidden="true" className="font-display text-[11px] font-bold leading-none tracking-tight">Aa</span>,
  ja: <span aria-hidden="true" className="font-display text-[12px] font-bold leading-none">あ</span>,
  auto: <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />,
};

export function VoicePanel({ supported }: { supported: boolean }) {
  const { t } = useT();
  const [language, setLanguage] = useState<VoiceLanguage>(() => readVoiceLanguage());
  return (
    <div className="space-y-1.5 rounded-2xl border border-[#E6DCD0] dark:border-[#2E3654] bg-white dark:bg-[#1E253D] p-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 font-bold text-[#4A3E36] dark:text-[#ECE7DF]">
          <Mic className="h-3.5 w-3.5 shrink-0 text-[#D9828B] dark:text-[#EFA4B2]" aria-hidden="true" />
          <span className="truncate">{t('settings.voice.title')}</span>
        </div>
        <div role="radiogroup" aria-label={t('settings.voice.title')}
          className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-[#E2D6C5] dark:border-[#343D5E] bg-[#F7F2E9] dark:bg-[#141A2C] p-0.5">
          {voiceLanguages.map(id => {
            const label = t(`settings.voice.${id}.label`);
            const active = language === id;
            return (
              <button key={id} type="button" role="radio" aria-checked={active} aria-label={label} title={label} data-voice-lang={id}
                onClick={() => { setLanguage(id); writeVoiceLanguage(id); }}
                className={`flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-full transition-[background-color,color,transform] duration-150 active:scale-90 cursor-pointer ${
                  active
                    ? 'bg-white dark:bg-[#273052] text-[#C46F7F] dark:text-[#F7E3A3] shadow-[0_1px_4px_rgba(74,62,54,0.14)] dark:shadow-[0_0_12px_rgba(247,227,163,0.18)]'
                    : 'text-[#8C7A6E] dark:text-[#8E98B8] hover:text-[#4A3E36] dark:hover:text-[#ECE7DF]'
                }`}>
                {voiceIcons[id]}
              </button>
            );
          })}
        </div>
      </div>
      {!supported && <p role="status" className="text-[#8D3F48] dark:text-[#F09AA6]">{t('settings.voice.unsupported')}</p>}
      <p className="text-[11px] text-[#7D6D61] dark:text-[#A4AECC]">
        <span className="font-semibold text-[#5E4E43] dark:text-[#E6E0D6]">{t(`settings.voice.${language}.label`)}</span>
      </p>
    </div>
  );
}

/** Which CLIs start without asking for approval, for every room nobody chose a mode for. */
export function LaunchModePanel({ characters, modes, onDefault }: {
  characters: Record<CLIModelId, CharacterProfile>; modes: LaunchModes; onDefault: (modelId: CLIModelId, auto: boolean) => void;
}) {
  const { t } = useT();
  return (
    <div className="space-y-2">
      {(['CLAUDE', 'CODEX', 'AGY'] as CLIModelId[]).map(id => (
        <Toggle key={id} icon={<ShieldCheck className="h-4 w-4" />} title={t('settings.launch.title', { character: characters[id].characterName, mode: id === 'AGY' ? 'Turbo' : t('settings.launch.noapproval') })}
          detail={id === 'AGY' ? t('settings.launch.agydetail') : t('settings.launch.detail')}
          on={modes.defaults[id]} onChange={on => onDefault(id, on)} />
      ))}
    </div>
  );
}

/** Describes the effect before a privileged restart. Danger tone gives Cancel initial focus. */
export function restartConfirmOptions(t: (key: I18nKey, params?: Record<string, string | number>) => string, activeCount: number): ConfirmOptions {
  return {
    title: t('settings.restart.title'),
    message: t('settings.restart.confirm') + (activeCount ? `\n${t('settings.restart.active', { count: activeCount })}` : ''),
    confirmLabel: t('settings.restart.action'),
    tone: 'danger',
  };
}

export function RestartButton({ supported, pending, onRestart }: { supported: boolean; pending: boolean; onRestart: () => void }) {
  const { t } = useT();
  if (!supported) return null;
  const label = pending ? t('settings.restart.pending') : t('settings.restart.title');
  return <button type="button" data-bridge-restart disabled={pending} onClick={onRestart} aria-label={label} title={label}
    className="guild-tap -my-2 inline-flex min-h-11 w-11 shrink-0 items-center justify-center rounded-full text-[#7D6D61] hover:bg-white/75 disabled:opacity-50 dark:text-[#B5BED6] dark:hover:bg-[#232B45]/80">
    <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[#E2D6C5] bg-white dark:border-[#364062] dark:bg-[#232B45]">
      <RotateCw aria-hidden="true" className={`h-4 w-4 ${pending ? 'animate-spin' : ''}`} />
    </span>
  </button>;
}

type AutoCompactControl = {
  room?: Pick<TerminalRoom, 'id' | 'roomName' | 'modelId' | 'live' | 'autoCompact' | 'autoCompactActive'>;
  disabled: boolean;
  onChange: (roomId: string, enabled: boolean) => void;
  /** Present when the Bridge supports the all-rooms switch. */
  all?: { enabled: boolean; onChange: (enabled: boolean) => void };
};

const autoCompactDetails = {
  AGY: 'settings.autoCompact.agy',
  CODEX: 'settings.autoCompact.codex',
  CLAUDE: 'settings.autoCompact.claude',
} as const;

function AutoCompactPanel(control: AutoCompactControl) {
  const { t } = useT();
  const { all, disabled } = control;
  return <div className="space-y-2">
    {all && <Toggle icon={<Minimize2 aria-hidden="true" className="h-4 w-4" />} title={t('settings.autoCompact.allTitle')}
      detail={t('settings.autoCompact.allDetail')} on={all.enabled} disabled={disabled} onChange={all.onChange} />}
    <RoomAutoCompact {...control} />
  </div>;
}

function RoomAutoCompact({ room, disabled, onChange, all }: AutoCompactControl) {
  const { t } = useT();
  const title = t('settings.autoCompact.title');
  const icon = <Minimize2 aria-hidden="true" className="h-4 w-4" />;
  if (!room && all?.enabled) return null;
  if (!room) {
    return <div className="flex items-start gap-2.5 rounded-2xl border border-[#E6DCD0] bg-white p-3.5 dark:border-[#2E3654] dark:bg-[#1E253D]">
      <span className="mt-0.5 shrink-0 text-[#D9828B] dark:text-[#EFA4B2]">{icon}</span>
      <div className="min-w-0">
        <div className="font-bold text-[#4A3E36] dark:text-[#ECE7DF]">{title}</div>
        <div className="mt-0.5 text-[#7D6D61] dark:text-[#A4AECC]">{t('settings.autoCompact.selectRoom')}</div>
      </div>
    </div>;
  }
  const enabled = room.autoCompact === true;
  const detail = t(room.live && room.autoCompactActive && enabled ? 'settings.autoCompact.active' : all?.enabled ? 'settings.autoCompact.byAll' : autoCompactDetails[room.modelId], { room: room.roomName });
  return <Toggle icon={icon} title={title} detail={detail} on={enabled} disabled={disabled || all?.enabled} onChange={value => onChange(room.id, value)} />;
}

export function SettingsModal({ characters, soundEnabled, onSound, push, launchModes, onDefaultMode, voiceSupported,
  phonePreview, onPhonePreview, onClose, restartSupported = false, restartPending = false, restartMessage, onRestart, autoCompact, storage }: {
  /** Where a new room starts; the Bridge sends it, and an older Bridge does not. */
  launchModes?: LaunchModes | null; onDefaultMode?: (modelId: CLIModelId, auto: boolean) => void;
  /** The Mac can write recordings out as text. */
  voiceSupported?: boolean;
  characters: Record<CLIModelId, CharacterProfile>;
  soundEnabled: boolean; onSound: (value: boolean) => void; push?: PushControl;
  phonePreview: boolean; onPhonePreview: (value: boolean) => void; onClose: () => void;
  restartSupported?: boolean; restartPending?: boolean; restartMessage?: string; onRestart?: () => void;
  autoCompact?: AutoCompactControl;
  storage?: { data?: StorageUsage; request: (days: number) => void };
}) {
  const { t } = useT();
  return (
    <Shell title={t('settings.title')} icon={<Settings2 className="h-5 w-5 text-[#D9828B] dark:text-[#EFA4B2]" />} onClose={onClose} headerAction={<RestartButton supported={restartSupported} pending={restartPending} onRestart={() => onRestart?.()} />} wide>
      {restartMessage && <p role="status" className="rounded-xl bg-[#FFF3DC] p-3 dark:bg-[#343047]">{restartMessage}</p>}
      <ThemePanel />
      <Toggle icon={<Volume2 className="h-4 w-4" />} title={t('settings.sound.title')} detail={t('settings.sound.detail')} on={soundEnabled} onChange={onSound} />
      {push && <PushPanel push={push} />}
      <LanguagePanel />
      {voiceSupported !== undefined && <VoicePanel supported={voiceSupported} />}
      {autoCompact && <AutoCompactPanel {...autoCompact} />}
      {storage && <StoragePanel {...storage} />}
      {launchModes && onDefaultMode && <LaunchModePanel characters={characters} modes={launchModes} onDefault={onDefaultMode} />}
      <div className="hidden sm:block">
        <Toggle icon={<Smartphone className="h-4 w-4" />} title={t('settings.phone.title')} detail={t('settings.phone.detail')} on={phonePreview} onChange={onPhonePreview} />
      </div>
    </Shell>
  );
}

export function TailscaleQrModal({ tailscaleUrl, onClose }: { tailscaleUrl: string | null; onClose: () => void }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const url = tailscaleUrl ? new URL('/', tailscaleUrl).href : null;
  return (
    <Shell title={t('settings.tailscale.title')} icon={<QrCode className="h-5 w-5 text-[#D9828B] dark:text-[#EFA4B2]" />} onClose={onClose}>
      <div className="flex flex-col items-center rounded-2xl border border-[#E6DCD0] dark:border-[#2E3654] bg-white dark:bg-[#1E253D] p-4 text-center">
        {url ? <>
          <QrCodeMatrix value={url} />
          <p className="mt-2 text-[#7D6D61] dark:text-[#A4AECC]">{t('settings.tailscale.instructions')}</p>
          <div className="mt-3 flex w-full items-center gap-2">
            <input aria-label={t('settings.tailscale.url')} readOnly value={url} className="min-w-0 flex-1 rounded-full border border-[#E6DCD0] dark:border-[#343D5E] bg-[#F7F2E9] dark:bg-[#141A2C] px-3 py-1.5 font-mono text-[#4A3E36] dark:text-[#ECE7DF]" />
            {navigator.clipboard && <button type="button" onClick={() => { void navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {}); }}
              className="rounded-full bg-[#F3ECE1] dark:bg-[#27304D] dark:text-[#ECE7DF] px-3 py-1.5">{copied ? t('settings.tailscale.copied') : t('settings.tailscale.copy')}</button>}
          </div>
        </> : <p className="text-sm">{t('settings.tailscale.missing')}</p>}
      </div>
      <p className="rounded-2xl border border-[#C5DEC8] dark:border-[#345443] bg-[#E6F2E8] dark:bg-[#192A22] p-3.5 leading-relaxed text-[#3F6846] dark:text-[#A7D3B1]">
        {t('settings.tailscale.safety')}
      </p>
    </Shell>
  );
}
