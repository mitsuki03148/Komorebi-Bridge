/** Names and tool words people say inside Cantonese that the speech model mishears; each is put back to its real spelling. */
const terms: [RegExp, string][] = [
  [/\bclou?d[ -]?cod?e?s?\b|\bclaude?[ -]?cod[ae]?\b|\bclaud[ -]?code\b|\bcloud[ -]?cut\b/gi, 'Claude Code'],
  [/\bclou?d(?= (?:room|房|嘅|的|session))|\bclaud\b/gi, 'Claude'],
  [/\b(?:jail|jill|tail|jale?|te[ie]l)[ -]?scale\b|\btailskill\b/gi, 'Tailscale'],
  [/\bgit[ -]?hub\b/gi, 'GitHub'],
  [/\bkomorebi\b|\bkomo[ -]?re?bi\b|\bcomorebi\b/gi, 'Komorebi'],
  [/\bcodecs\b|\bcodex\b/gi, 'Codex'],
  [/\bpill request\b|\bpool request\b|\bpull[ -]?request\b/gi, 'pull request'],
  [/\btale[ -]?scale\b/gi, 'Tailscale'],
  [/\bwh?[iy]sper\b/gi, 'Whisper'],
  [/\bpoll request\b/gi, 'pull request'],
  [/\bsmooth[ -]?test\b/gi, 'smoke test'],
  [/\b(?:web|work)[ -]?tree\b/gi, 'worktree'],
  [/\bstaging\b/gi, 'staging'],
  [/\bi[ -]?phone\b/gi, 'iPhone'],
  [/\bmac ?book\b/gi, 'MacBook'],
];

export const fixTerms = (text: string) => terms.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), text);
