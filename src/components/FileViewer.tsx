import { useT } from '../i18n/useLang';
import { useState } from 'react';
import { Check, Copy, Film, FileText, FolderSearch, Image as ImageIcon, X } from 'lucide-react';
import { Markdown } from './Markdown';
import { copyText, useEscape } from '../utils/roomUi';
import { focusScope } from '../utils/focusScope';

export interface FileView { text: string; truncated: boolean; size: number }
export interface FileVideo { url: string; expiresAt: number }

/** A file from the Mac, read in the app: Markdown is shown as a page in the same look as the chat, anything else as plain text. */
export function FileViewer({ path, file, video, error, onReveal, onClose }: { path: string; file?: FileView; video?: FileVideo; error?: string; onReveal?: () => void; onClose: () => void }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const [videoFailure, setVideoFailure] = useState<{ url: string; expired: boolean }>();
  useEscape(true, onClose);
  const name = path.split('/').pop() || path;
  const isMarkdown = /\.(?:md|markdown)$/i.test(path);
  const isImage = /\.(?:png|jpe?g|webp|gif)$/i.test(path);
  const FileIcon = video ? (isImage ? ImageIcon : Film) : FileText;
  const videoFailed = video && videoFailure?.url === video.url;
  return (
    <div onClick={event => { if (event.target === event.currentTarget) onClose(); }}
      className="guild-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-[#3A2E27]/30 dark:bg-[#090C16]/68 p-2 backdrop-blur-xs sm:p-3">
      <section ref={focusScope} role="dialog" aria-modal="true" aria-label={name}
        className="guild-dialog-in flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden rounded-[26px] border border-[#E5D7C6] dark:border-[#313958] bg-[#FFFCF7]/96 dark:bg-[#171D31]/96 shadow-[0_22px_50px_-12px_rgba(74,62,54,0.28)] backdrop-blur-md">
        <div className="flex shrink-0 items-center gap-2.5 border-b border-[#EADFD1]/80 dark:border-[#2C3450] bg-[#F7F1E8]/80 dark:bg-[#1C233A]/90 px-4 py-3 backdrop-blur-md">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#EBC5CA]/80 dark:border-[#59354B] bg-[#FCEEF2] dark:bg-[#312338] text-[#C4668A] dark:text-[#EFA4B2]">
            <FileIcon className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-display text-[15px] font-semibold text-[#4A3E36] dark:text-[#ECE7DF]">{name}</h3>
            <p className="truncate font-mono text-[10px] text-[#8C7A6E] dark:text-[#98A3C2]" title={path}>{path}</p>
          </div>
          {onReveal && (
            <button type="button" aria-label={t('file.reveal')} title={t('file.reveal')} onClick={onReveal}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#E5D7C6] dark:border-[#364062] bg-white/90 dark:bg-[#232B45] text-[#7D6D61] dark:text-[#B5BED6] transition hover:bg-white dark:hover:bg-[#2B3554] active:scale-95"><FolderSearch className="h-4 w-4" /></button>
          )}
          <button type="button" aria-label={copied ? t('file.copy.done') : t('file.copy.path')}
            onClick={() => void copyText(path).then(ok => { setCopied(ok); setTimeout(() => setCopied(false), 1_800); })}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#E5D7C6] dark:border-[#364062] bg-white/90 dark:bg-[#232B45] text-[#7D6D61] dark:text-[#B5BED6] transition hover:bg-white dark:hover:bg-[#2B3554] active:scale-95">
            {copied ? <Check className="h-4 w-4 text-[#689B73]" /> : <Copy className="h-4 w-4" />}
          </button>
          <button type="button" aria-label={t('file.close')} onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#E5D7C6] dark:border-[#364062] bg-white/90 dark:bg-[#232B45] text-[#7D6D61] dark:text-[#B5BED6] transition hover:bg-white dark:hover:bg-[#2B3554] active:scale-95"><X className="h-4 w-4" /></button>
        </div>
        <div data-file-body className="min-h-0 flex-1 overflow-y-auto px-4 py-5 text-[14px] leading-relaxed text-[#4A3E36] dark:text-[#EAE5DC] select-text sm:px-7">
          {error ? <p role="alert" className="text-[#A94D5A] dark:text-[#F09AA6]">{error}</p>
            : videoFailed ? <p role="alert" className="text-[#A94D5A] dark:text-[#F09AA6]">{t(isImage ? 'file.image.failed' : videoFailure.expired ? 'file.video.expired' : 'file.video.failed')}</p>
            : video && isImage ? <img key={video.url} src={video.url} alt={name} onError={() => setVideoFailure({ url: video.url, expired: Date.now() >= video.expiresAt })}
                className="mx-auto max-h-[78dvh] w-auto max-w-full rounded-2xl bg-[#241E1C]/5 object-contain" />
            : video ? <video key={video.url} src={video.url} controls playsInline preload="metadata" aria-label={name}
                onError={() => setVideoFailure({ url: video.url, expired: Date.now() >= video.expiresAt })}
                className="mx-auto max-h-[72dvh] w-full rounded-2xl bg-[#241E1C]" />
            : !file ? <p role="status" className="text-[#7D6D61] dark:text-[#A4AECC]">{t('file.loading')}</p>
            : <>
              {file.truncated && <p className="mx-auto mb-4 max-w-[65ch] rounded-2xl border border-[#F0D9B5] dark:border-[#785B38] bg-[#FFF6E8] dark:bg-[#2B2219] px-3.5 py-2 text-xs text-[#8A5A1F] dark:text-[#F0C882]">{t('file.truncated', { size: Math.round(file.size / 1024), shown: Math.round(file.text.length / 1024) })}</p>}
              {isMarkdown ? <Markdown variant="doc" text={file.text} />
                : <pre className="whitespace-pre-wrap break-words rounded-2xl border border-[#E6DCD0] dark:border-[#2E3654] bg-white/80 dark:bg-[#141A2C] p-4 font-mono text-[12px] leading-[1.65]">{file.text}</pre>}
            </>}
        </div>
      </section>
    </div>
  );
}
