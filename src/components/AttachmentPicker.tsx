import { useT } from '../i18n/useLang';
import { useEffect, useState } from 'react';
import { FileText, Paperclip, X } from 'lucide-react';
import { maxImageBytes, maxSourceBytes, type ImageSize } from '../utils/prepareImage';
import { cleanUploadName, isImageAttachment, maxAttachments, maxFileBytes, maxFiles, nativeImageTypes, selectionCountIssue } from '../utils/fileAttachments';

export const maxImages = maxAttachments;

export function AttachmentPicker({ files, size, onSize, onChange, onError, supported, fileUploadSupported = false, preparing, disabled, mode = 'button' }: {
  files: File[]; onChange: (files: File[]) => void; onError: (message: string) => void;
  size: ImageSize; onSize: (size: ImageSize) => void;
  supported: boolean; fileUploadSupported?: boolean; preparing?: boolean; disabled?: boolean; mode?: 'button' | 'preview';
}) {
  const { t } = useT();
  const [urls, setUrls] = useState<(string | undefined)[]>([]);
  useEffect(() => {
    if (!files.length || mode !== 'preview') { setUrls([]); return; }
    const objectUrls = files.map(file => isImageAttachment(file) ? URL.createObjectURL(file) : undefined);
    setUrls(objectUrls);
    return () => objectUrls.forEach(url => { if (url) URL.revokeObjectURL(url); });
  }, [files, mode]);
  if (mode === 'preview' && !files.length) return null;
  const pictures = files.filter(isImageAttachment);
  const originalOk = pictures.every(file => file.size <= maxImageBytes && nativeImageTypes.includes(file.type));
  return <div className="flex items-center gap-2 min-w-0">
    {mode === 'button' && <label className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#A07583] dark:text-[#C996A8] hover:bg-[#F8E9EE] dark:hover:bg-[#2A2238] focus-within:outline-2 focus-within:outline-[#965069] ${disabled ? 'opacity-50' : 'cursor-pointer'}`} title={t('attachment.add.title', { count: maxImages })}>
      <Paperclip className="h-4 w-4" aria-hidden="true" />
      <input className="sr-only" type="file" multiple disabled={disabled}
        aria-label={t('attachment.add')} onChange={event => {
          const picked = [...(event.target.files ?? [])];
          event.target.value = '';
          if (!picked.length) return;
          const issue = selectionCountIssue([...files, ...picked.filter(file => fileUploadSupported || isImageAttachment(file))]);
          if (issue) {
            onError(issue === 'files' ? t('attachment.files.toomany', { count: maxFiles }) : t('attachment.toomany', { count: maxImages }));
            return;
          }
          let notice: string | undefined;
          const valid = picked.filter(file => {
            const image = isImageAttachment(file);
            const key = !image && !fileUploadSupported ? 'attachment.files.bridge'
              : image && !supported ? 'attachment.bridge'
              : !file.size ? 'attachment.files.empty'
              : !cleanUploadName(file.name) ? 'attachment.files.name'
              : file.size > (image ? maxSourceBytes : maxFileBytes) ? image ? 'attachment.toobig' : 'attachment.files.limit'
              : undefined;
            if (key) notice ??= t(key);
            return key === undefined;
          });
          if (notice) onError(notice);
          const next = [...files, ...valid];
          if (next.length === files.length) return;
          onChange(next);
          // Original quality only works when every image is small enough and already a format the CLI reads.
          if (!next.filter(isImageAttachment).every(file => file.size <= maxImageBytes && nativeImageTypes.includes(file.type))) onSize('medium');
          else if (!files.length) onSize('medium');
        }} />
    </label>}
    {mode === 'preview' && files.length > 0 && <div className="flex min-w-0 items-center gap-2 overflow-x-auto rounded-xl border border-[#E6DCD0] dark:border-[#2E3654] bg-white dark:bg-[#192038] p-1">
      {files.map((file, index) => <div key={`${file.name}-${file.size}-${index}`} className="relative shrink-0">
        {isImageAttachment(file)
          ? urls[index] && <img src={urls[index]} alt={t('attachment.selected', { index: index + 1 })} className="h-9 w-9 rounded-lg object-cover" />
          : <span title={file.name} className="flex h-9 max-w-[12rem] items-center gap-1.5 rounded-lg bg-[#F7F2E9] dark:bg-[#232B45] pl-2 pr-3 text-xs text-[#6E5D52] dark:text-[#ECE7DF]">
              <FileText className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="truncate">{file.name}</span>
            </span>}
        <button type="button" aria-label={isImageAttachment(file) ? t('attachment.remove', { index: index + 1 }) : t('attachment.files.remove', { name: file.name })} disabled={disabled} onClick={() => onChange(files.filter((_, at) => at !== index))}
          className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#6E5D52] dark:bg-[#3A456A] text-white disabled:opacity-50"><X className="h-3 w-3" /></button>
      </div>)}
      {pictures.length > 0 && <select aria-label={t('attachment.resolution')} disabled={disabled} value={size} onChange={event => onSize(event.target.value as ImageSize)} className="ml-1 max-w-24 shrink-0 rounded-lg bg-[#F7F2E9] dark:bg-[#232B45] p-1 text-xs text-[#6E5D52] dark:text-[#ECE7DF]">
        <option value="original" disabled={!originalOk}>{t('attachment.original')}</option>
        <option value="large">{t('attachment.large')}</option>
        <option value="medium">{t('attachment.medium')}</option>
        <option value="small">{t('attachment.small')}</option>
      </select>}
      {preparing && <span role="status" className="shrink-0 text-xs text-[#6E5D52] dark:text-[#A4AECC]">{t('attachment.files.reading')}</span>}
    </div>}
  </div>;
}
