import { mkdtemp } from './test-temp';
import assert from 'node:assert/strict'
import { chmod, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { cleanTranscript, transcribeAudio, transcribeAvailable, whisperArgs, maxAudioBytes, type Runner } from './transcribe'

// Other suites can transcribe at the same time, so count only this process's temporary recordings.
const originalTmpdir = process.env.TMPDIR
const suiteTmpdir = await mkdtemp(join(tmpdir(), 'komorebi-stt-suite-'))
process.env.TMPDIR = suiteTmpdir
after(async () => {
  if (originalTmpdir === undefined) delete process.env.TMPDIR
  else process.env.TMPDIR = originalTmpdir
  await rm(suiteTmpdir, { recursive: true, force: true })
})

const audio = Buffer.from('not really audio').toString('base64')

async function toolbox(programs: string[] = ['whisper-cli', 'afconvert', 'ffmpeg']) {
  const dir = await mkdtemp(join(tmpdir(), 'komorebi-stt-'))
  const bin = join(dir, 'bin')
  await mkdir(bin)
  for (const name of programs) { await writeFile(join(bin, name), '#!/bin/sh\n'); await chmod(join(bin, name), 0o755) }
  const model = join(dir, 'model.bin')
  await writeFile(model, 'x')
  return { dir, bin, model, close: () => rm(dir, { recursive: true, force: true }) }
}

const recorder = (text = '我想問下 Claude 的設定\n') => {
  const calls: { file: string; args: string[] }[] = []
  const run: Runner = async (file, args) => { calls.push({ file, args }); return { stdout: file.endsWith('whisper-cli') ? text : '' } }
  return { calls, run }
}

test('a recording becomes 16 kHz mono wave, then text, with the Hong Kong prompt and forced Cantonese by default', async () => {
  const t = await toolbox()
  try {
    const { calls, run } = recorder()
    const text = await transcribeAudio({ mime: 'audio/mp4;codecs=mp4a.40.2', data: audio }, { model: t.model, path: t.bin, run })
    assert.equal(text, '我想問下 Claude 的設定', 'the written transcript is preserved')
    assert.equal(calls.length, 2)
    assert.ok(calls[0].file.endsWith('afconvert'))
    assert.deepEqual(calls[0].args.slice(0, 5), ['-f', 'WAVE', '-d', 'LEI16@16000', '-c'])
    assert.ok(calls[0].args.at(-2)!.endsWith('in.m4a'))
    const whisper = calls[1].args
    assert.ok(calls[1].file.endsWith('whisper-cli'))
    assert.equal(whisper[whisper.indexOf('-l') + 1], 'yue')
    assert.ok(whisper.includes('-nt'))
    assert.equal(whisper[whisper.indexOf('-m') + 1], t.model)
    assert.match(whisper[whisper.indexOf('--prompt') + 1], /Claude Code.*Tailscale/)
  } finally { await t.close() }
})

test('five language choices pass their code and common terms; unknown values fall back to Cantonese', async () => {
  const t = await toolbox()
  try {
    const run = async (language: unknown) => { const r = recorder(); await transcribeAudio({ mime: 'audio/mp4', data: audio, language }, { model: t.model, path: t.bin, run: r.run }); return r.calls[1].args }
    const en = await run('en')
    assert.equal(en[en.indexOf('-l') + 1], 'en')
    assert.match(en[en.indexOf('--prompt') + 1], /Claude Code.*Codex.*Bridge.*Tailscale/)
    const auto = await run('auto')
    assert.equal(auto[auto.indexOf('-l') + 1], 'auto')
    assert.equal((await run('klingon; rm -rf /'))[(await run('x')).indexOf('-l') + 1], 'yue')
    for (const code of ['zh', 'yue', 'en', 'ja', 'auto'] as const) {
      const args = await run(code)
      assert.equal(args[args.indexOf('-l') + 1], code)
      assert.match(args[args.indexOf('--prompt') + 1], /Claude Code.*Codex.*Bridge.*Tailscale/)
    }
    assert.equal(whisperArgs('/m', '/w', 'en')[6], 'en')
  } finally { await t.close() }
})

test('silence and the lines the model invents for it come back as nothing, real speech is kept tidy', () => {
  assert.equal(cleanTranscript(' [BLANK_AUDIO] \n'), '')
  assert.equal(cleanTranscript('(音樂)'), '')
  assert.equal(cleanTranscript('字幕由 Amara.org 社群提供'), '')
  assert.equal(cleanTranscript('Thanks for watching!'), '')
  assert.equal(cleanTranscript('謝謝收看。'), '')
  assert.equal(cleanTranscript(''), '')
  assert.equal(cleanTranscript('  幫我 check\n\n  下個 test  '), '幫我 check 下個 test')
  assert.equal(cleanTranscript('謝謝你幫我 check'), '謝謝你幫我 check', 'a real sentence that only starts like a ghost is kept')
})

test('bad input is refused before anything is run: format, size, characters', async () => {
  const t = await toolbox()
  try {
    const { calls, run } = recorder()
    const opts = { model: t.model, path: t.bin, run }
    await assert.rejects(transcribeAudio({ mime: 'application/pdf', data: audio }, opts), /格式/)
    await assert.rejects(transcribeAudio({ mime: 'audio/mp4', data: '' }, opts), /無效/)
    await assert.rejects(transcribeAudio({ mime: 'audio/mp4', data: 'not base64!!' }, opts), /無效/)
    await assert.rejects(transcribeAudio({ mime: 'audio/mp4', data: 'A'.repeat(Math.ceil(maxAudioBytes / 3) * 4 + 4) }, opts), /太長/)
    await assert.rejects(transcribeAudio({ mime: 'audio/mp4', data: 42 }, opts))
    assert.equal(calls.length, 0)
  } finally { await t.close() }
})

test('a missing model or program, an unreadable recording or a failed run each say what is wrong, and temporary files are always removed', async () => {
  const t = await toolbox()
  try {
    const before = (await readdir(tmpdir())).filter(name => name.startsWith('komorebi-voice-')).length
    const base = { mime: 'audio/mp4', data: audio }
    await assert.rejects(transcribeAudio(base, { model: join(t.dir, 'nope.bin'), path: t.bin, run: recorder().run }), /語音模型/)
    const bare = await toolbox(['afconvert'])
    try { await assert.rejects(transcribeAudio(base, { model: bare.model, path: bare.bin, run: recorder().run }), /whisper-cli/) } finally { await bare.close() }
    let n = 0
    const failConvert: Runner = async () => { throw new Error('afconvert broke') }
    await assert.rejects(transcribeAudio(base, { model: t.model, path: t.bin, run: failConvert }), /讀不到這段錄音/)
    const failWhisper: Runner = async file => { if (file.endsWith('whisper-cli')) { n++; const error = new Error('killed') as Error & { killed: boolean }; error.killed = true; throw error } return { stdout: '' } }
    await assert.rejects(transcribeAudio(base, { model: t.model, path: t.bin, run: failWhisper }), /太久/)
    assert.equal(n, 1)
    const after = (await readdir(tmpdir())).filter(name => name.startsWith('komorebi-voice-')).length
    assert.equal(after, before, 'no temporary recordings are left behind')
  } finally { await t.close() }
})

test('browsers that record webm need ffmpeg, and Safari recordings never do', async () => {
  const t = await toolbox()
  const noFfmpeg = await toolbox(['whisper-cli', 'afconvert'])
  try {
    const { calls, run } = recorder()
    await transcribeAudio({ mime: 'audio/webm;codecs=opus', data: audio }, { model: t.model, path: t.bin, run })
    assert.ok(calls[0].file.endsWith('ffmpeg'))
    assert.deepEqual(calls[0].args.slice(0, 1), ['-y'])
    await assert.rejects(transcribeAudio({ mime: 'audio/webm', data: audio }, { model: noFfmpeg.model, path: noFfmpeg.bin, run: recorder().run }), /ffmpeg|Safari/)
    const safari = recorder()
    await transcribeAudio({ mime: 'audio/mp4', data: audio }, { model: noFfmpeg.model, path: noFfmpeg.bin, run: safari.run })
    assert.ok(safari.calls[0].file.endsWith('afconvert'))
  } finally { await t.close(); await noFfmpeg.close() }
})

test('recordings are handled one at a time, and a long queue is turned away instead of piling up', async () => {
  const t = await toolbox()
  try {
    let running = 0, peak = 0
    const run: Runner = async file => {
      if (file.endsWith('whisper-cli')) { running++; peak = Math.max(peak, running); await new Promise(resolve => setTimeout(resolve, 40)); running--; return { stdout: '好' } }
      return { stdout: '' }
    }
    const opts = { model: t.model, path: t.bin, run }
    const jobs = [1, 2, 3].map(() => transcribeAudio({ mime: 'audio/mp4', data: audio }, opts))
    await assert.rejects(transcribeAudio({ mime: 'audio/mp4', data: audio }, opts), /稍候/)
    assert.deepEqual(await Promise.all(jobs), ['好', '好', '好'])
    assert.equal(peak, 1)
    assert.equal(await transcribeAudio({ mime: 'audio/mp4', data: audio }, opts), '好', 'the queue is free again afterwards')
  } finally { await t.close() }
})

test('the Mac says whether it can transcribe: the model and whisper-cli must both be there', async () => {
  const t = await toolbox()
  const bare = await toolbox(['afconvert'])
  try {
    assert.equal(await transcribeAvailable({ model: t.model, path: t.bin }), true)
    assert.equal(await transcribeAvailable({ model: join(t.dir, 'no.bin'), path: t.bin }), false)
    assert.equal(await transcribeAvailable({ model: bare.model, path: bare.bin }), false)
  } finally { await t.close(); await bare.close() }
})

test('old style is ignored, Chinese becomes traditional and the recognition dictionary remains active', async () => {
  const t = await toolbox()
  try {
    const opts = { model: t.model, path: t.bin, run: recorder('这个 Cloud Code 和 Git hub 已经完成').run }
    for (const style of [undefined, 'colloquial', 'written']) {
      const text = await transcribeAudio({ mime: 'audio/mp4', data: audio, language: 'yue', style }, opts)
      assert.equal(text, '這個 Claude Code 和 GitHub 已經完成')
    }
    assert.equal(await transcribeAudio({ mime: 'audio/mp4', data: audio, language: 'zh' }, opts), '這個 Claude Code 和 GitHub 已經完成')
    assert.equal(await transcribeAudio({ mime: 'audio/mp4', data: audio, language: 'ja' }, opts), '这个 Claude Code 和 GitHub 已经完成', 'Japanese is not converted as Chinese')
    assert.equal(await transcribeAudio({ mime: 'audio/mp4', data: audio, language: 'auto' }, opts), '这个 Claude Code 和 GitHub 已经完成', 'automatic language is not guessed after transcription')
  } finally { await t.close() }
})
test('conversion failure does not return a misleading unconverted Chinese transcript', async () => {
  const t = await toolbox()
  try {
    await assert.rejects(transcribeAudio({ mime: 'audio/mp4', data: audio }, { model: t.model, path: t.bin, run: recorder('这个').run, convertTraditional: async () => { throw new Error('failed') } }), /繁體轉換失敗/)
  } finally { await t.close() }
})
