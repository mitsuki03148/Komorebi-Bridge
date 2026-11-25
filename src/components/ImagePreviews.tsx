import { useT } from '../i18n/useLang';
import { createPortal } from 'react-dom';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Copy, ImageOff, X } from 'lucide-react';
import { extractImagePaths, imageFileName } from '../utils/imagePaths';
import { copyText, useEscape } from '../utils/roomUi';
import { focusScope } from '../utils/focusScope';
import { PreviewLoader, type PreviewReply, type PreviewRequest, type PreviewState } from '../utils/previewLoader';

interface ImagePreviewApi {
  supported: boolean;
  get: (roomId: string, path: string) => PreviewState | undefined;
  request: (roomId: string, path: string) => void;
}

const ImagePreviewContext = createContext<ImagePreviewApi>({ supported: false, get: () => undefined, request: () => {} });
export const ImagePreviewProvider = ImagePreviewContext.Provider;
/** Owns the preview loader for the app and exposes it to the thumbnails. */
export function useImagePreviews(supported: boolean, send: (request: PreviewRequest) => boolean) {
  const sendRef = useRef(send);
  sendRef.current = send;
  const loader = useRef<PreviewLoader>(null);
  if (!loader.current) loader.current = new PreviewLoader(request => sendRef.current(request));
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const current = loader.current!;
    const unsubscribe = current.subscribe(() => setVersion(current.version));
    return () => { unsubscribe(); };
  }, []);
  useEffect(() => () => loader.current?.dispose(), []);
  return useMemo(() => ({
    supported,
    get: (roomId: string, path: string) => loader.current!.get(roomId, path),
    request: (roomId: string, path: string) => loader.current!.request(roomId, path),
    receive: (reply: PreviewReply) => loader.current!.receive(reply),
  }), [supported, version]);
}

function Lightbox({ name, path, dataUrl, onClose }: { name: string; path: string; dataUrl: string; onClose: () => void }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  useEscape(true, onClose);
  // Drawn on the page itself, not inside the message, so the header and other layers cannot cover its close button.
  const dialog = (
    <div ref={focusScope} role="dialog" aria-modal="true" aria-label={t('image.preview', { name })} onClick={onClose}
      className="fixed inset-0 z-[95] flex flex-col bg-[#2B231F]/85 dark:bg-[#090C16]/88 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-xs">
      <div className="flex shrink-0 items-center justify-between gap-2 text-xs text-white" onClick={event => event.stopPropagation()}>
        <span className="min-w-0 truncate font-semibold" title={path}>{name}</span>
        <span className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={() => void copyText(path).then(ok => { if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1500); } })}
            className="flex min-h-9 items-center gap-1 rounded-full bg-white/15 px-3"><Copy className="h-3.5 w-3.5" />{copied ? t('image.copy.done') : t('image.copy.path')}</button>
          <button type="button" aria-label={t('image.close')} onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15"><X className="h-4 w-4" /></button>
        </span>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto pt-2">
        <img src={dataUrl} alt={name} onClick={event => event.stopPropagation()} className="max-h-full max-w-full rounded-lg object-contain" />
      </div>
    </div>
  );
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
}

function ImageThumb({ roomId, path }: { roomId: string; path: string }) {
  const { t } = useT();
  const api = useContext(ImagePreviewContext);
  const [open, setOpen] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  const name = imageFileName(path);
  const state = api.get(roomId, path);

  useEffect(() => {
    const element = holder.current;
    if (!element || state) return;
    // Ask only once the thumbnail is on screen, so a long history does not request every image at once.
    if (typeof IntersectionObserver === 'undefined') { api.request(roomId, path); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); api.request(roomId, path); }
    }, { rootMargin: '200px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [roomId, path, state === undefined]);

  return (
    <div ref={holder} className="mt-2 max-w-full" data-image-path={path}>
      {state?.status === 'ready' ? (
        <>
          <button type="button" onClick={() => setOpen(true)} aria-label={t('image.enlarge', { name })} className="block max-w-full overflow-hidden rounded-xl border border-[#E6DCD0] dark:border-[#364062] bg-[#FAF4EB] dark:bg-[#192038] focus-visible:outline-2 focus-visible:outline-[#965069]">
            <img src={state.dataUrl} alt={name} loading="lazy" className="max-h-56 max-w-full object-contain" />
          </button>
          <div className="mt-0.5 truncate text-[10px] text-[#8C7A6E] dark:text-[#A4AECC]" title={path}>{name}</div>
          {open && <Lightbox name={name} path={path} dataUrl={state.dataUrl} onClose={() => setOpen(false)} />}
        </>
      ) : state?.status === 'error' ? (
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-[#DFD3C3] dark:border-[#364062] px-2.5 py-2 text-[11px] text-[#8C7A6E] dark:text-[#A4AECC]">
          <ImageOff className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0"><span className="block truncate font-semibold" title={path}>{name}</span>{state.message}</span>
        </div>
      ) : (
        <div className="flex h-24 w-40 items-center justify-center rounded-xl border border-[#E6DCD0] dark:border-[#364062] bg-[#F7F2E9] dark:bg-[#1E253D] px-2 text-center text-[11px] text-[#8C7A6E] dark:text-[#A4AECC]" aria-busy="true">
          {name}
        </div>
      )}
    </div>
  );
}

/** Thumbnails for the images a message mentions by path. Renders nothing when the Bridge cannot preview. */
export function MessageImages({ roomId, text, codeBlock, images }: { roomId: string | undefined; text: string; codeBlock?: string; images?: string[] }) {
  const api = useContext(ImagePreviewContext);
  const paths = useMemo(() => [...new Set([...(images ?? []), ...extractImagePaths(`${text}\n${codeBlock ?? ''}`)])], [text, codeBlock, images]);
  if (!api.supported || !roomId || paths.length === 0) return null;
  return <div className="flex flex-wrap gap-2">{paths.map(path => <ImageThumb key={path} roomId={roomId} path={path} />)}</div>;
}
