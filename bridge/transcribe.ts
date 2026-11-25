import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { traditionalChinese } from './traditional';
import { fixTerms } from './terms';

export type VoiceLanguage = 'zh' | 'yue' | 'en' | 'ja' | 'auto';
export const voiceLanguages: VoiceLanguage[] = ['zh', 'yue', 'en', 'ja', 'auto'];

export const maxAudioBytes = 8 * 1024 * 1024;
const maxWaiting = 3;
const mimeExtensions: Record<string, string> = {
  'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a', 'audio/aac': 'aac', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  'audio/mpeg': 'mp3', 'audio/webm': 'webm', 'audio/ogg': 'ogg',
};
// Formats the system converter cannot read; they need ffmpeg when it is installed.
const needsFfmpeg = new Set(['webm', 'ogg']);

// Keep the shared recognition vocabulary in every language prompt.
const terms = 'Claude Code、Claude、Codex、Gemini、Komorebi、Bridge、Tailscale、GitHub、pull request、PR、merge、commit、push、branch、CI、test case、fail、deploy、staging、room、session、API、iPhone、Mac、terminal、build、bug、Orchestrator、worktree、HANDOFF、bench、Xcode、Simulator、smoke test、crash、reviewer、tester、Opus、model、effort、Whisper、evidence、工作台、工單、大佬、崗位';
const prompts: Record<VoiceLanguage, string> = {
  yue: `以下是廣東話與英文的對話，請用繁體書面中文轉錄，英文專有名詞保持原文。常用字詞：${terms}。例：我們的 PR 已經 merge 了，但 CI 仍然 fail，請先檢查 test case。`,
  zh: `以下是普通話與英文的對話，請用繁體書面中文轉錄，英文專有名詞保持原文。常用字詞：${terms}。例：請先檢查這個 test case 和 GitHub 的 PR。`,
  en: `Technical conversation. Preserve English proper names and technical terms: ${terms}.`,
  ja: `日本語の会話です。英語の固有名詞と技術用語は原語のまま記載してください。用語：${terms}。例：GitHub の PR と test case を確認してください。`,
  auto: `自動辨識對話語言；中文使用繁體書面語，英文專有名詞保持原文。Common technical terms: ${terms}.`,
};

export const defaultModelPath = () => process.env.KOMOREBI_WHISPER_MODEL || join(homedir(), 'Library/Application Support/komorebi/whisper/ggml-large-v3-turbo-q5_0.bin');

export type Runner = (file: string, args: string[], options: { timeout: number }) => Promise<{ stdout: string }>;
const defaultRunner: Runner = (file, args, options) => new Promise((resolve, reject) => {
  execFile(file, args, { timeout: options.timeout, maxBuffer: 4 * 1024 * 1024, killSignal: 'SIGKILL' }, (error, stdout) => error ? reject(error) : resolve({ stdout: String(stdout) }));
});

export interface TranscribeOptions {
  model?: string;
  /** Where to look for programs (defaults to PATH plus Homebrew's folder). */
  path?: string;
  run?: Runner;
  timeoutMs?: number;
  convertTraditional?: (text: string, directory: string) => Promise<string>;
}

async function findProgram(name: string, path = `${process.env.PATH ?? ''}${delimiter}/opt/homebrew/bin${delimiter}/usr/local/bin`) {
  for (const directory of path.split(delimiter).filter(Boolean)) {
    const candidate = join(directory, name);
    try { await access(candidate, constants.X_OK); return candidate; } catch { /* Not here. */ }
  }
  return undefined;
}

/** Whether this Mac can turn speech into text: the model file is there and whisper-cli can be found. */
export async function transcribeAvailable(options: Pick<TranscribeOptions, 'model' | 'path'> = {}) {
  try { await access(options.model ?? defaultModelPath(), constants.R_OK); } catch { return false; }
  return Boolean(await findProgram('whisper-cli', options.path));
}

export function whisperArgs(model: string, wav: string, language: VoiceLanguage) {
  const prompt = prompts[language];
  return ['-m', model, '-f', wav, '-nt', '-l', language, ...(prompt ? ['--prompt', prompt] : [])];
}

// What the model tends to "hear" in silence; a transcript made only of these means nobody spoke.
const silenceGhosts = [
  /^\[?\(?(?:blank[_ ]audio|silence|music|音樂|靜音|沉默)\)?\]?$/i,
  /^(?:字幕由?\s*amara\.org\s*社群提供|由\s*amara\.org\s*社群提供字幕|請不吝點贊訂閱轉發打賞支持明鏡與點點欄目|謝謝(?:大家)?(?:收看|觀看)[。！.]?|thanks for watching[.!]?|thank you[.!]?)$/i,
];

/** The text as it should go into the message box, or '' when the recording held no speech. */
export function cleanTranscript(raw: string) {
  const text = raw.replace(/\s*\n+\s*/g, ' ').replace(/[ \t]{2,}/g, ' ').trim();
  if (!text) return '';
  return silenceGhosts.some(pattern => pattern.test(text)) ? '' : text;
}

export class TranscribeError extends Error {}

let queue: Promise<unknown> = Promise.resolve();
let waiting = 0;

export interface AudioInput { mime: unknown; data: unknown; language?: unknown; style?: unknown }

/** One recording to text. Recordings are handled one at a time so a small Mac is not asked for two models at once. */
export function transcribeAudio(input: AudioInput, options: TranscribeOptions = {}): Promise<string> {
  const language = (voiceLanguages as unknown[]).includes(input.language) ? input.language as VoiceLanguage : 'yue';
  const mime = typeof input.mime === 'string' ? input.mime.split(';')[0].trim().toLowerCase() : '';
  const extension = mimeExtensions[mime];
  if (!extension) return Promise.reject(new TranscribeError('這種錄音格式未支援，請用 Safari 錄音。'));
  if (typeof input.data !== 'string' || !input.data || input.data.length > Math.ceil(maxAudioBytes / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.data)) {
    return Promise.reject(new TranscribeError('錄音無效或者太長（上限約 8 MB），請錄短些。'));
  }
  if (waiting >= maxWaiting) return Promise.reject(new TranscribeError('正在處理其他錄音，請稍候再試。'));
  const data = Buffer.from(input.data, 'base64');
  waiting++;
  const job = queue.then(() => run(data, extension, language, options));
  queue = job.catch(() => undefined).finally(() => { waiting--; });
  return job;
}

async function run(data: Buffer, extension: string, language: VoiceLanguage, options: TranscribeOptions) {
  const model = options.model ?? defaultModelPath();
  const runner = options.run ?? defaultRunner;
  // A long dictation takes a while: a base allowance plus time in proportion to the size of the recording (at most ten minutes).
  const timeout = options.timeoutMs ?? Math.min(600_000, 90_000 + Math.round(data.length / 1024) * 400);
  const whisper = await findProgram('whisper-cli', options.path);
  try { await access(model, constants.R_OK); } catch { throw new TranscribeError('Mac 未有語音模型，請先安裝（見說明）。'); }
  if (!whisper) throw new TranscribeError('Mac 未安裝 whisper-cli（brew install whisper-cpp）。');
  const directory = await mkdtemp(join(tmpdir(), 'komorebi-voice-'));
  try {
    const source = join(directory, `in.${extension}`);
    const wav = join(directory, 'out.wav');
    await writeFile(source, data, { mode: 0o600 });
    // Everything is turned into the 16 kHz mono wave file the model reads.
    const converter = needsFfmpeg.has(extension) ? await findProgram('ffmpeg', options.path) : await findProgram('afconvert', options.path);
    if (!converter) throw new TranscribeError(needsFfmpeg.has(extension) ? '這個瀏覽器的錄音格式要 ffmpeg，請用 Safari 錄音。' : '找不到 afconvert。');
    const convertArgs = needsFfmpeg.has(extension)
      ? ['-y', '-i', source, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav]
      : ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', source, wav];
    try { await runner(converter, convertArgs, { timeout: 30_000 }); }
    catch { throw new TranscribeError('讀不到這段錄音，請再錄一次。'); }
    let stdout: string;
    try { ({ stdout } = await runner(whisper, whisperArgs(model, wav, language), { timeout })); }
    catch (error) { throw new TranscribeError((error as { killed?: boolean })?.killed ? '轉文字太久，已停止，請錄短些。' : '轉文字失敗，請再試。'); }
    const text = cleanTranscript(stdout);
    let written = text;
    if ((language === 'yue' || language === 'zh') && text) {
      try { written = await (options.convertTraditional ?? traditionalChinese)(text, directory); }
      catch { throw new TranscribeError('繁體轉換失敗，請重試。'); }
    }
    return fixTerms(written);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
