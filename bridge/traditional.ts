import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// CoreFoundation uses ICU's Simplified-to-Traditional transliterator.
// The transcript is passed in a private temporary file, not command-line arguments.
const transform = String.raw`
import ctypes, sys
from pathlib import Path
cf = ctypes.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
cf.CFStringCreateMutable.argtypes = [ctypes.c_void_p, ctypes.c_long]
cf.CFStringCreateMutable.restype = ctypes.c_void_p
cf.CFStringCreateWithCString.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_uint]
cf.CFStringCreateWithCString.restype = ctypes.c_void_p
cf.CFStringAppendCString.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_uint]
cf.CFStringTransform.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_bool]
cf.CFStringTransform.restype = ctypes.c_bool
cf.CFStringGetLength.argtypes = [ctypes.c_void_p]
cf.CFStringGetLength.restype = ctypes.c_long
cf.CFStringGetMaximumSizeForEncoding.argtypes = [ctypes.c_long, ctypes.c_uint]
cf.CFStringGetMaximumSizeForEncoding.restype = ctypes.c_long
cf.CFStringGetCString.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_long, ctypes.c_uint]
cf.CFStringGetCString.restype = ctypes.c_bool
cf.CFRelease.argtypes = [ctypes.c_void_p]
encoding = 0x08000100
text = Path(sys.argv[1]).read_text(encoding='utf-8')
value = cf.CFStringCreateMutable(None, 0)
rule = cf.CFStringCreateWithCString(None, b'Hans-Hant', encoding)
if not value or not rule:
    raise RuntimeError('Unable to initialize text conversion')
try:
    cf.CFStringAppendCString(value, text.encode('utf-8'), encoding)
    if not cf.CFStringTransform(value, None, rule, False):
        raise RuntimeError('Text conversion failed')
    size = cf.CFStringGetMaximumSizeForEncoding(cf.CFStringGetLength(value), encoding) + 1
    result = ctypes.create_string_buffer(size)
    if not cf.CFStringGetCString(value, result, size, encoding):
        raise RuntimeError('Cannot encode converted text')
    sys.stdout.buffer.write(result.value)
finally:
    cf.CFRelease(rule)
    cf.CFRelease(value)
`;

export async function traditionalChinese(text: string, directory: string): Promise<string> {
  if (!text) return text;
  const file = join(directory, 'transcript.txt');
  await writeFile(file, text, { mode: 0o600 });
  return new Promise((resolve, reject) => execFile('/usr/bin/python3', ['-c', transform, file],
    { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) =>
      error ? reject(error) : resolve(String(stdout))));
}
