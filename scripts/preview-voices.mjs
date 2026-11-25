// Preview only: generates three short files, never changes the running app.
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const key = process.env.OPENAI_API_KEY;
if (!key) throw new Error('OPENAI_API_KEY 未設定。請使用本機安全環境提供 API key，唔好貼喺對話。');
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = join(project, 'Review', 'VOICE-PREVIEW');
await mkdir(outputRoot, { recursive: true });
const output = await mkdtemp(join(outputRoot, 'sample-'));

const samples = [
  { name: 'hitomi', voice: 'coral', line: 'できたよ！', style: 'A bright, cheerful young adult woman, playful and warm, natural Japanese. No exaggerated cartoon or child voice.' },
  { name: 'hikari', voice: 'sage', line: 'お仕事、完了です。', style: 'A gentle, thoughtful, clear and calm voice, warm and reassuring, natural Japanese.' },
  { name: 'hibiki', voice: 'ash', line: '任務、完了。', style: 'A quiet, composed adult masculine voice, steady and softly confident, natural Japanese.' },
];

function wav(pcm) {
  if (!pcm.length || pcm.length % 2) throw new Error('音訊資料為空或不完整。');
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28); header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function generate(sample) {
  return new Promise((resolveAudio, rejectAudio) => {
    const socket = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1-mini', {
      headers: { Authorization: `Bearer ${key}` }, handshakeTimeout: 20_000,
    });
    const chunks = [];
    let bytes = 0, transcript = '', finished = false, requested = false;
    const timeout = setTimeout(() => finish(new Error('語音生成逾時；已保留之前成功嘅試聽檔。')), 60_000);
    function finish(error) {
      if (finished) return;
      let audio;
      if (!error) {
        try { audio = wav(Buffer.concat(chunks)); }
        catch (failure) { error = failure instanceof Error ? failure : new Error('音訊資料無效。'); }
      }
      finished = true;
      clearTimeout(timeout);
      socket.close();
      if (error) rejectAudio(error);
      else resolveAudio({ audio, transcript });
    }
    socket.on('open', () => socket.send(JSON.stringify({
      type: 'session.update', session: { type: 'realtime', output_modalities: ['audio'],
        audio: { output: { format: { type: 'audio/pcm', rate: 24000 }, voice: sample.voice } },
        instructions: `${sample.style} Say only the exact Japanese line, with no extra words or sound effects: ${sample.line}` },
    })));
    socket.on('message', raw => {
      try {
        const event = JSON.parse(raw.toString());
        if (event.type === 'session.updated' && !requested) {
          requested = true;
          socket.send(JSON.stringify({ type: 'response.create', response: { output_modalities: ['audio'] } }));
        } else if (event.type === 'response.output_audio.delta') {
          const chunk = Buffer.from(event.delta, 'base64');
          bytes += chunk.length;
          if (bytes > 4_000_000) return finish(new Error('生成嘅音訊過長，已停止。'));
          chunks.push(chunk);
        } else if (event.type === 'response.output_audio_transcript.done') transcript = event.transcript ?? '';
        else if (event.type === 'response.done') {
          if (event.response?.status !== 'completed') return finish(new Error(`語音生成未完成（${event.response?.status ?? 'unknown'}）。`));
          finish();
        } else if (event.type === 'error') finish(new Error(`OpenAI 語音請求失敗：${String(event.error?.message ?? 'unknown error').replaceAll(key, '[redacted]')}`));
      } catch (error) { finish(error instanceof Error ? error : new Error('讀取語音回應失敗。')); }
    });
    socket.on('error', () => finish(new Error('無法連接 OpenAI 語音 API，請檢查網絡同 API 權限。')));
    socket.on('close', () => { if (!finished) finish(new Error('語音連線中斷；未完成嘅聲音不會保存。')); });
  });
}

console.log(`試聽檔位置：${output}`);
for (const sample of samples) {
  const result = await generate(sample);
  const file = join(output, `${sample.name}.wav`);
  await writeFile(file, result.audio, { flag: 'wx', mode: 0o600 });
  console.log(`${sample.name}: ${file} · ${result.transcript || '未回傳逐字稿，請聽檔確認'}`);
}
