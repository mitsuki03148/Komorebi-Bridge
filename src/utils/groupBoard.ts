export const groupBoardPathMaxLength = 1024;

/** The roster is pasted into a PTY, so a path must be printable on one line. */
export function validGroupBoardPath(path: unknown): path is string {
  return typeof path === 'string' && path.startsWith('/') && path.length <= groupBoardPathMaxLength &&
    !/[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(path);
}
