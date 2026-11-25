// Absolute Mac paths to text files, up to a space, quote, bracket or CJK punctuation.
const pathPattern = '\\/(?:Volumes|Users)\\/[^\\s`\'"<>()\\[\\]\\u3000-\\u303f\\uff00-\\uffef]+?\\.(?:md|markdown|txt|log|json)';
// Inside backticks the ends are clear, so spaces are fine (e.g. "/Volumes/ExampleApp Repo/…").
const spacedPattern = '\\/(?:Volumes|Users)\\/[^`\'"<>()\\[\\]\\n\\u3000-\\u303f\\uff00-\\uffef]+?\\.(?:md|markdown|txt|log|json)';
const whole = new RegExp(`^${spacedPattern}$`, 'i');
/** Videos and images open through the media link, so a backticked path to one is a button too. */
const mediaExtensions = 'mp4|m4v|mov|png|jpe?g|webp|gif';
const videoSpaced = spacedPattern.replace('(?:Volumes|Users)\\/', '(?!\\/)').replace('md|markdown|txt|log|json', mediaExtensions);
const videoBare = pathPattern.replace('(?:Volumes|Users)\\/', '(?!\\/)').replace('md|markdown|txt|log|json', mediaExtensions);
const wholeVideo = new RegExp(`^${videoSpaced}$`, 'i');
// Markdown links already carry a destination. Preserve both ](/path) and ](</path>).
const withBoundaries = (pattern: string) => new RegExp(`(?<![\\w\`/.:<-])(?<!\\]\\()(${pattern})(?![\\w/.-])`, 'gi');
const bare = withBoundaries(pathPattern);
const bareWithVideos = withBoundaries(`${pathPattern}|${videoBare}`);

/** A video or an image (the name is older than the images). */
export const videoPath = (text: string) => wholeVideo.test(text);

const locationSuffix = /:(\d+)(?::(\d+))?$/;
/** A path as editors and agents write it, with an optional :line or :line:column on the end. The file is opened without the suffix. */
export function fileLocation(text: string, videoSupported = false): { path: string; line?: number } | undefined {
  const match = locationSuffix.exec(text);
  const path = match ? text.slice(0, match.index) : text;
  if (!(whole.test(path) || (videoSupported && videoPath(path)))) return undefined;
  return match ? { path, line: Number(match[1]) } : { path };
}

/** Whether the text is exactly one absolute path to a file the reader can open. */
export const readablePath = (text: string, videoSupported = false) => whole.test(text) || (videoSupported && videoPath(text));

/** Put backticks round bare paths in a message (outside code blocks) so they show as code, which the reader turns into a button. */
export function linkFilePaths(text: string, videoSupported = false): string {
  return text.split(/(```[\s\S]*?```)/g).map((part, index) => index % 2 ? part : part.replace(videoSupported ? bareWithVideos : bare, '`$1`')).join('');
}
