// Contents
// Create a room — Set up a character and workspace for a new room.
// Move a room — Change the working folder of an existing room.
// Check quota use — See today’s usage and when quotas reset.

import { FolderPicker, type FolderListing } from './FolderPicker';
import { useKeyboardViewport } from '../utils/useKeyboardViewport';
import { useT } from '../i18n/useLang';
import React, { useEffect, useState } from 'react';
import {
  X,
  Plus,
  Sparkles,
  FlaskConical,
  TrendingDown,
  Folder,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { CharacterProfile, CLIModelId } from '../types/guild';
import { fiveHourQuota, formatPct, formatReset, useEscape, weeklyQuota } from '../utils/roomUi';
import { focusScope } from '../utils/focusScope';
import { useTheme } from '../utils/theme';

// ── Create a room ────────────────────────────────────────────────────
// When opening a new room, choose its character, working folder and launch settings.

interface NewRoomModalProps {
  isOpen: boolean;
  initialModelId: CLIModelId;
  characters: Record<CLIModelId, CharacterProfile>;
  workspaceRoot: string;
  /** The sub-folders of a folder, as the Bridge last listed them, for the folder picker. */
  folderListing?: FolderListing;
  onBrowseFolder: (path: string) => void;
  fixedRoomDirectorySupported: boolean;
  agyAutoSupported: boolean;
  roomLaunchOptionsSupported: boolean;
  /** The no-approval mode each CLI starts with unless the room is told otherwise. */
  launchDefaults?: Record<CLIModelId, boolean>;
  busy?: boolean;
  onClose: () => void;
  onCreateRoom: (
    modelId: CLIModelId,
    roomName: string,
    repoPath: string,
    remote: boolean,
    agyAuto: boolean,
    fullAccess: boolean
  ) => void;
}

export const NewRoomModal: React.FC<NewRoomModalProps> = ({
  isOpen,
  initialModelId,
  characters,
  workspaceRoot,
  folderListing,
  onBrowseFolder,
  fixedRoomDirectorySupported,
  agyAutoSupported,
  roomLaunchOptionsSupported,
  launchDefaults,
  busy = false,
  onClose,
  onCreateRoom,
}) => {
  const { t } = useT();
  const [modelId, setModelId] = useState<CLIModelId>(initialModelId);
  const [roomName, setRoomName] = useState('');
  const [folder, setFolder] = useState(workspaceRoot.replace(/\/$/, '') || '/');
  const [remote, setRemote] = useState(false);
  const [agyAuto, setAgyAuto] = useState(launchDefaults?.[initialModelId] ?? false);
  const [fullAccess, setFullAccess] = useState(launchDefaults?.[initialModelId] ?? false);
  // Picking another CLI starts from that CLI's default.
  // Depends on the preset's value, not the defaults object, so a refresh from the Bridge does not undo a box the user ticked.
  const preset = launchDefaults?.[modelId] ?? false;
  useEffect(() => {
    setAgyAuto(preset);
    setFullAccess(preset);
  }, [modelId, preset]);
  const remoteSupported = modelId !== 'CODEX' || roomLaunchOptionsSupported;
  useEscape(isOpen, onClose);

  if (!isOpen) return null;


  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomName.trim() || !fixedRoomDirectorySupported || busy) return;
    onCreateRoom(
      modelId,
      roomName.trim(),
      folder.trim() === (workspaceRoot.replace(/\/$/, '') || '/') ? '' : folder.trim(),
      remoteSupported && remote,
      modelId === 'AGY' && agyAutoSupported && agyAuto,
      modelId !== 'AGY' && roomLaunchOptionsSupported && fullAccess
    );
  };

  // With the phone keyboard open, the dialog takes only the part of the screen the keyboard leaves free, so the field and the buttons stay in view.
  const area = useKeyboardViewport();
  return (
    <div onClick={event => { if (event.target === event.currentTarget) onClose(); }} style={area ? { top: area.top, height: area.height } : { top: 0, bottom: 0 }}
      className="guild-backdrop-in fixed inset-x-0 z-50 bg-[#4A3E36]/40 dark:bg-[#090C16]/68 backdrop-blur-xs flex items-end sm:items-center justify-center p-2 sm:p-4 select-none">
      <form ref={focusScope} style={area ? { maxHeight: Math.max(240, area.height - 16) } : undefined} role="dialog" aria-modal="true" aria-label={t('guild.modal.new.title')} aria-busy={busy}
        onSubmit={handleSubmit}
        className="guild-dialog-in flex w-full max-w-lg max-h-[90dvh] flex-col rounded-3xl bg-[#FBF8F3] dark:bg-[#171D31] border border-[#E2D6C5] dark:border-[#313958] text-[#4A3E36] dark:text-[#ECE7DF] shadow-2xl overflow-hidden"
      >
        <div className="shrink-0 px-4 py-3.5 sm:px-6 sm:py-4 bg-[#F5EFE6] dark:bg-[#1C233A] border-b border-[#E5DAC9] dark:border-[#2C3450] flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Sparkles className="w-4.5 h-4.5 sm:w-5 sm:h-5 shrink-0 text-[#D9828B] dark:text-[#EFA4B2]" />
            <h3 className="min-w-0 text-[15px] sm:text-base font-bold leading-snug text-[#4A3E36] dark:text-[#ECE7DF] font-display">
              {t('guild.modal.new.title')}
            </h3>
          </div>
          <button
            type="button"
            aria-label={t('guild.modal.close')}
            onClick={onClose}
            className="w-8 h-8 shrink-0 rounded-full bg-white dark:bg-[#232B45] border border-[#E2D6C5] dark:border-[#364062] text-[#7D6D61] dark:text-[#B5BED6] flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#5C4D43] dark:text-[#B5BED6] mb-1.5">
              {t('guild.modal.new.character')}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['AGY', 'CODEX', 'CLAUDE'] as CLIModelId[]).map((m) => {
                const c = characters[m];
                const active = m === modelId;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      if (m === modelId) return;
                      setModelId(m);
                      setRemote(false);
                      setFullAccess(false);
                    }}
                    className={`p-2 rounded-2xl border text-left flex items-center gap-2 transition-all cursor-pointer ${
                      active
                        ? 'bg-white dark:bg-[#232B47] border-[#D9828B] dark:border-[#EFA4B2] text-[#4A3E36] dark:text-[#ECE7DF] shadow-2xs'
                        : 'bg-[#F5EFE6] dark:bg-[#1C233A] border-[#E5DAC9] dark:border-[#2E3654] text-[#7D6D61] dark:text-[#98A3C2]'
                    }`}
                  >
                    <img
                      src={c.avatarUrl}
                      alt={c.characterName}
                      referrerPolicy="no-referrer"
                      className="w-10 h-10 rounded-xl object-contain bg-[#FAF4EB] dark:bg-[#222A45] shrink-0 mix-blend-multiply dark:mix-blend-normal"
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-bold font-display truncate">
                        {c.characterName}
                      </div>
                      <div className="text-[11px] font-mono opacity-80 truncate">
                        {t('guild.modal.new.weekly', { pct: formatPct(weeklyQuota(c)) })}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <label className="block space-y-1 text-xs font-semibold">
            <span>{t('guild.modal.new.name')}</span>
            <input required autoFocus={typeof window === 'undefined' || !window.matchMedia?.('(pointer: coarse)').matches} maxLength={80} value={roomName} disabled={busy} onChange={event => setRoomName(event.target.value)}
              className="w-full rounded-xl border border-[#DFD3C3] dark:border-[#343D5E] bg-white dark:bg-[#141A2C] px-3 py-2 text-base font-normal text-[#4A3E36] dark:text-[#ECE7DF] sm:text-sm" />
          </label>
          <div className="block space-y-1 text-xs">
            <p className="font-semibold">{t('guild.modal.new.folder')}</p>
            <FolderPicker label={t('guild.modal.new.folder')} value={folder} onChange={setFolder} onBrowse={onBrowseFolder} listing={folderListing} />
            {!fixedRoomDirectorySupported && <p className="text-[#A94D5A]">{t('guild.modal.new.fixedfolder')}</p>}
          </div>
          <label className="flex items-start gap-2 text-xs leading-relaxed">
            <input type="checkbox" disabled={!remoteSupported} checked={remoteSupported && remote} onChange={event => setRemote(event.target.checked)} className="mt-0.5" />
            <span><strong>{t('guild.modal.new.remote')}</strong>{modelId === 'CODEX' && <span className="block">{t('guild.modal.new.codexremote')}</span>}</span>
          </label>
          {modelId !== 'AGY' && <label className="flex items-start gap-2 text-xs leading-relaxed">
            <input type="checkbox" disabled={!roomLaunchOptionsSupported} checked={roomLaunchOptionsSupported && fullAccess} onChange={event => setFullAccess(event.target.checked)} className="mt-0.5" />
            <span><strong>{t('guild.modal.new.fullaccess')}</strong><span className="block">{t('guild.modal.new.fullaccessdetail')}</span></span>
          </label>}
          {modelId !== 'AGY' && !roomLaunchOptionsSupported && <p className="text-xs text-[#A94D5A]">{t('guild.modal.new.options')}</p>}
          {modelId === 'AGY' && <label className="flex items-start gap-2 text-xs leading-relaxed">
            <input type="checkbox" disabled={!agyAutoSupported} checked={agyAutoSupported && agyAuto} onChange={event => setAgyAuto(event.target.checked)} className="mt-0.5" />
            <span>{t('guild.modal.new.turbofull', { label: '\u0000' }).split('\u0000').map((part, index) => <React.Fragment key={index}>{index > 0 && <strong>{t('guild.modal.new.turbo')}</strong>}{part}</React.Fragment>)}{!agyAutoSupported && t('guild.modal.new.restart')}</span>
          </label>}
        </div>

        <div className="shrink-0 flex justify-end gap-2 border-t border-[#E5DAC9] dark:border-[#2C3450] bg-[#FBF8F3]/95 dark:bg-[#171D31]/95 px-5 py-3.5 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="guild-tap px-4 py-2 rounded-full bg-[#F3ECE1] dark:bg-[#27304D] text-xs font-semibold text-[#6E5D52] dark:text-[#B5BED6] hover:bg-[#EAE1D3] dark:hover:bg-[#313C60] cursor-pointer"
          >
            {t('guild.modal.cancel')}
          </button>
          <button
            type="submit"
            disabled={!fixedRoomDirectorySupported || busy || !roomName.trim()}
            className="guild-tap px-5 py-2 rounded-full bg-[#D9828B] hover:bg-[#C86E78] text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-40"
          >
            <Plus className="w-4 h-4" />
            <span>{busy ? t('guild.modal.new.busy') : t('guild.modal.new.create')}</span>
          </button>
        </div>
      </form>
    </div>
  );
};

// ── Move a room ──────────────────────────────────────────────────────
// When a room needs a different working folder, open the move dialog from its menu and choose the destination.

export function RoomMoveAction({
  room,
  supported = room.modelId === 'CLAUDE' || room.modelId === 'CODEX' || room.modelId === 'AGY',
  onMove,
}: {
  room: { id: string; modelId: CLIModelId; repoPath: string };
  supported?: boolean;
  onMove: () => void;
}) {
  const { t } = useT();
  return (
    <button
      type="button"
      data-move-room={room.id}
      disabled={!supported}
      onClick={supported ? onMove : undefined}
      className="flex w-full items-center gap-3 rounded-2xl border border-[#E5D7C6] dark:border-[#343D5E] bg-white dark:bg-[#1E253D] px-3.5 py-2.5 text-left shadow-2xs transition hover:bg-[#FAF5EE] dark:hover:bg-[#252D49] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-55"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#F5EFE6] dark:bg-[#27304D] text-[#8C6D58] dark:text-[#B5BED6]">
        <Folder className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-[#4A3E36] dark:text-[#ECE7DF]">{t('room.move.action')}</span>
        <span className="block truncate text-[10.5px] text-[#8C7A6E] dark:text-[#98A3C2]">
          {supported ? (room.repoPath || t('room.move.detail')) : t('room.move.unsupported')}
        </span>
      </span>
      {!supported && (
        <span data-move-room-unsupported className="shrink-0 rounded-full border border-[#E2D6C5] dark:border-[#364062] bg-[#F7F2E9] dark:bg-[#141A2C] px-2 py-0.5 text-[10px] font-semibold text-[#7D6D61] dark:text-[#A4AECC]">
          {t('room.move.unsupported')}
        </span>
      )}
    </button>
  );
}

export function MoveRoomModal({
  isOpen,
  modelId = 'CLAUDE',
  roomName,
  currentFolder,
  workspaceRoot,
  folderListing,
  onBrowseFolder,
  busy = false,
  onClose,
  onMoveRoom,
}: {
  isOpen: boolean;
  modelId?: CLIModelId;
  roomName: string;
  currentFolder: string;
  workspaceRoot: string;
  folderListing?: FolderListing;
  onBrowseFolder: (path: string) => void;
  busy?: boolean;
  onClose: () => void;
  onMoveRoom: (folder: string, copyMemory: boolean) => void;
}) {
  const { t } = useT();
  const initialFolder = currentFolder || workspaceRoot.replace(/\/$/, '') || '/';
  const [folder, setFolder] = useState(initialFolder);
  const [copyMemory, setCopyMemory] = useState(false);
  useEscape(isOpen && !busy, onClose);
  const area = useKeyboardViewport();
  if (!isOpen) return null;
  const trimmed = folder.trim();
  const canSubmit = Boolean(trimmed && trimmed !== currentFolder && !busy);
  const hasMemoryCheckbox = modelId === 'CLAUDE';
  return (
    <div
      onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}
      style={area ? { top: area.top, height: area.height } : { top: 0, bottom: 0 }}
      className="guild-backdrop-in fixed inset-x-0 z-[85] bg-[#4A3E36]/40 dark:bg-[#090C16]/68 backdrop-blur-xs flex items-end sm:items-center justify-center p-2 sm:p-4 select-none"
    >
      <form
        ref={focusScope}
        style={area ? { maxHeight: Math.max(240, area.height - 16) } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={t('room.move.title')}
        aria-busy={busy}
        onSubmit={event => {
          event.preventDefault();
          if (!canSubmit) return;
          onMoveRoom(trimmed, hasMemoryCheckbox && copyMemory);
        }}
        className="guild-dialog-in flex w-full max-w-lg max-h-[90dvh] flex-col rounded-3xl bg-[#FBF8F3] dark:bg-[#171D31] border border-[#E2D6C5] dark:border-[#313958] text-[#4A3E36] dark:text-[#ECE7DF] shadow-2xl overflow-hidden"
      >
        <div className="shrink-0 px-4 py-3.5 sm:px-6 sm:py-4 bg-[#F5EFE6] dark:bg-[#1C233A] border-b border-[#E5DAC9] dark:border-[#2C3450] flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Folder className="w-4.5 h-4.5 sm:w-5 sm:h-5 shrink-0 text-[#D9828B] dark:text-[#EFA4B2]" />
            <div className="min-w-0">
              <h3 className="min-w-0 truncate text-[15px] sm:text-base font-bold leading-snug text-[#4A3E36] dark:text-[#ECE7DF] font-display">
                {t('room.move.title')}
              </h3>
              <p className="truncate text-[11px] text-[#7D6D61] dark:text-[#A4AECC]">{roomName}</p>
            </div>
          </div>
          <button
            type="button"
            aria-label={t('guild.modal.close')}
            disabled={busy}
            onClick={onClose}
            className="w-8 h-8 shrink-0 rounded-full bg-white dark:bg-[#232B45] border border-[#E2D6C5] dark:border-[#364062] text-[#7D6D61] dark:text-[#B5BED6] flex items-center justify-center cursor-pointer disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
          {currentFolder && (
            <p className="break-all rounded-xl border border-[#EAE0D3] dark:border-[#2E3654] bg-[#FAF5EE]/85 dark:bg-[#141A2C] px-3 py-2 font-mono text-[11px] text-[#6E5D52] dark:text-[#A4AECC]">
              {t('room.move.current', { path: currentFolder })}
            </p>
          )}
          <div className="block space-y-1 text-xs">
            <p className="font-semibold">{t('room.move.folder')}</p>
            <FolderPicker label={t('room.move.folder')} value={folder} onChange={setFolder} onBrowse={onBrowseFolder} listing={folderListing} />
          </div>
          {hasMemoryCheckbox ? (
            <label className="flex items-start gap-2 text-xs leading-relaxed">
              <input
                type="checkbox"
                data-move-copy-memory
                checked={copyMemory}
                disabled={busy}
                onChange={event => setCopyMemory(event.target.checked)}
                className="mt-0.5"
              />
              <span>
                <strong>{t('room.move.copyMemory')}</strong>
                <span className="block text-[#7D6D61] dark:text-[#A4AECC]">{t('room.move.copyMemoryDetail')}</span>
              </span>
            </label>
          ) : (
            <p data-move-project-memory className="rounded-xl border border-[#EAE0D3] dark:border-[#2E3654] bg-[#FAF5EE]/65 dark:bg-[#141A2C]/80 px-3 py-2 text-xs leading-relaxed text-[#7D6D61] dark:text-[#A4AECC]">
              {t('room.move.projectMemory')}
            </p>
          )}
        </div>

        <div className="shrink-0 flex justify-end gap-2 border-t border-[#E5DAC9] dark:border-[#2C3450] bg-[#FBF8F3]/95 dark:bg-[#171D31]/95 px-5 py-3.5 sm:px-6">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="guild-tap px-4 py-2 rounded-full bg-[#F3ECE1] dark:bg-[#27304D] text-xs font-semibold text-[#6E5D52] dark:text-[#B5BED6] hover:bg-[#EAE1D3] dark:hover:bg-[#313C60] cursor-pointer disabled:opacity-40"
          >
            {t('guild.modal.cancel')}
          </button>
          <button
            type="submit"
            data-move-room-confirm
            disabled={!canSubmit}
            className="guild-tap px-5 py-2 rounded-full bg-[#D9828B] hover:bg-[#C86E78] text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-40"
          >
            <span>{busy ? t('room.move.busyButton') : t('room.move.confirm')}</span>
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Check quota use ──────────────────────────────────────────────────
// When someone opens the quota dialog, show today’s chart and the next quota reset for each character.

interface UsageCalibrationModalProps {
  isOpen: boolean;
  characters: Record<CLIModelId, CharacterProfile>;
  onClose: () => void;
}

const dayMs = 24 * 60 * 60 * 1000;

export function todayAxis(now: number) {
  const date = new Date(now);
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return { start, ticks: [0, 6, 12, 18, 24].map(hour => start + hour * 3_600_000) };
}

export const todayPoints = (history: CharacterProfile['usageHistory'], dayStart: number) =>
  history.filter(point => typeof point.at === 'number' && point.at >= dayStart && point.at <= dayStart + dayMs);

export function clockLabel(value: number, dayStart: number, seconds = false) {
  if (value >= dayStart + dayMs) return '24:00';
  const date = new Date(value);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(date.getHours())}:${two(date.getMinutes())}${seconds ? `:${two(date.getSeconds())}` : ''}`;
}

export const UsageCalibrationModal: React.FC<UsageCalibrationModalProps> = ({
  isOpen,
  characters,
  onClose,
}) => {
  const { t } = useT();
  const { resolved } = useTheme();
  const isDark = resolved === 'dark';
  useEscape(isOpen, onClose);
  if (!isOpen) return null;
  const { start: dayStart, ticks: dayTicks } = todayAxis(Date.now());

  return (
    <div onClick={event => { if (event.target === event.currentTarget) onClose(); }} className="guild-backdrop-in fixed inset-0 z-50 bg-[#4A3E36]/40 dark:bg-[#090C16]/68 backdrop-blur-xs flex items-center justify-center p-4 select-none">
      <div ref={focusScope} role="dialog" aria-modal="true" aria-label={t('guild.modal.quota.title')} className="guild-dialog-in w-full max-w-2xl max-h-[88vh] rounded-3xl bg-[#FBF8F3] dark:bg-[#171D31] border border-[#E2D6C5] dark:border-[#313958] shadow-2xl flex flex-col overflow-hidden">
        <div className="px-4 py-3 sm:px-6 sm:py-3.5 bg-[#F5EFE6] dark:bg-[#1C233A] border-b border-[#E5DAC9] dark:border-[#2C3450] flex items-center justify-between gap-2 shrink-0">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <FlaskConical className="w-4.5 h-4.5 sm:w-5 sm:h-5 shrink-0 text-[#D9828B] dark:text-[#EFA4B2]" />
            <div className="min-w-0 flex-1">
              <h3 className="text-[13.5px] sm:text-base font-bold leading-snug text-[#4A3E36] dark:text-[#ECE7DF] font-display">
                {t('guild.modal.quota.chart')}
              </h3>
              <p className="text-[11px] text-[#7D6D61] dark:text-[#A4AECC]">{t('guild.modal.quota.daily')}</p>
            </div>
          </div>
          <button
            type="button"
            aria-label={t('guild.modal.close')}
            onClick={onClose}
            className="w-8 h-8 shrink-0 rounded-full bg-white dark:bg-[#232B45] border border-[#E2D6C5] dark:border-[#364062] text-[#7D6D61] dark:text-[#B5BED6] flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-3.5">
          {(['AGY', 'CODEX', 'CLAUDE'] as CLIModelId[]).map((m) => {
            const c = characters[m];
            const hpStroke =
              m === 'AGY' ? '#D9828B' : m === 'CODEX' ? '#689B73' : '#C85A68';
            const mpStroke = '#6B8EB8';

            return (
              <div
                key={m}
                className="p-4 rounded-2xl bg-white dark:bg-[#1E253D] border border-[#E6DCD0] dark:border-[#2E3654] space-y-3 shadow-2xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <img
                      src={c.avatarUrl}
                      alt={c.characterName}
                      referrerPolicy="no-referrer"
                      className="w-10 h-10 rounded-xl object-contain bg-[#FAF4EB] dark:bg-[#252D49] p-0.5 border border-[#E5DAC9] dark:border-[#364062] shrink-0 mix-blend-multiply dark:mix-blend-normal"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-[#4A3E36] dark:text-[#ECE7DF] font-display whitespace-nowrap">
                        {c.characterName} · {m === 'AGY' ? 'AGY' : m === 'CODEX' ? 'Codex' : 'Claude'}
                      </div>
                      <span className="mt-0.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#F7F2E9] dark:bg-[#141A2C] text-[10px] font-mono text-[#7D6D61] dark:text-[#A4AECC] whitespace-nowrap">
                        <TrendingDown className="w-3 h-3 text-[#D9828B] dark:text-[#EFA4B2]" />
                        <span>{t('guild.modal.quota.trend')}</span>
                      </span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right font-mono text-xs leading-snug text-[#4A3E36] dark:text-[#ECE7DF] whitespace-nowrap">
                    <div>MP 5h <span className="font-bold">{formatPct(fiveHourQuota(c))}</span></div>
                    <div>{t('guild.modal.quota.hpweekly', { percent: '\u0000' }).split('\u0000').map((part, index) => <React.Fragment key={index}>{index > 0 && <span className="font-bold">{formatPct(weeklyQuota(c))}</span>}{part}</React.Fragment>)}</div>
                  </div>
                </div>

                <div className="h-28 w-full rounded-xl bg-[#FBF8F3] dark:bg-[#141A2C] border border-[#EFE7DA] dark:border-[#2E3654] px-2 pt-2 pb-1">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={todayPoints(c.usageHistory, dayStart)}
                      margin={{ top: 4, right: 8, left: -24, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient
                          id={`hpGrad-${m}`}
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor={hpStroke}
                            stopOpacity={0.35}
                          />
                          <stop
                            offset="95%"
                            stopColor={hpStroke}
                            stopOpacity={0.02}
                          />
                        </linearGradient>
                        <linearGradient
                          id={`mpGrad-${m}`}
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor={mpStroke}
                            stopOpacity={0.28}
                          />
                          <stop
                            offset="95%"
                            stopColor={mpStroke}
                            stopOpacity={0.02}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={isDark ? '#2C3554' : '#E6DCD0'}
                        vertical={false}
                      />
                      <XAxis
                        dataKey="at"
                        type="number"
                        domain={[dayStart, dayStart + dayMs]}
                        ticks={dayTicks}
                        tickFormatter={value => clockLabel(value, dayStart)}
                        tick={{ fontSize: 10, fill: isDark ? '#98A3C2' : '#8C7A6E' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        domain={[0, 100]}
                        ticks={[0, 50, 100]}
                        tick={{ fontSize: 10, fill: isDark ? '#98A3C2' : '#8C7A6E' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: isDark ? '#192038' : '#FFFDF9',
                          borderColor: isDark ? '#364062' : '#E2D6C5',
                          borderRadius: '12px',
                          fontSize: '11px',
                          color: isDark ? '#ECE7DF' : '#4A3E36',
                        }}
                        labelFormatter={value => clockLabel(Number(value), dayStart, true)}
                        formatter={(value, name) => [
                          `${value}%`,
                          name === 'hp' ? t('guild.modal.quota.hp') : t('guild.modal.quota.mp'),
                        ]}
                      />
                      <Area
                        type="monotone"
                        dataKey="hp"
                        stroke={hpStroke}
                        strokeWidth={2}
                        fillOpacity={1}
                        fill={`url(#hpGrad-${m})`}
                      />
                      <Area
                        type="monotone"
                        dataKey="mp"
                        stroke={mpStroke}
                        strokeWidth={1.75}
                        strokeDasharray="4 2"
                        fillOpacity={1}
                        fill={`url(#mpGrad-${m})`}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                <div className="space-y-1 text-left text-[11px] font-mono text-[#7D6D61] dark:text-[#B5BED6]">
                  <p>{formatReset(c.hp5h.resetsAt) ? t('guild.modal.quota.fivehour.reset', { time: formatReset(c.hp5h.resetsAt) }) : t('guild.modal.quota.fivehour.unknown')}</p>
                  <p>{formatReset(c.mpWeekly.resetsAt) ? t('guild.modal.quota.weekly.reset', { time: formatReset(c.mpWeekly.resetsAt) }) : t('guild.modal.quota.weekly.unknown')}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
