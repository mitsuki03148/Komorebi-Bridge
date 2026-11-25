import schema from './bench-acceptance.schema.json';

export function acceptanceOptions(raw: string) {
  const report = JSON.parse(raw);
  if (!report || typeof report !== 'object' || Array.isArray(report) ||
      Object.keys(report).length !== schema.required.length || !schema.required.every(key => Object.hasOwn(report, key))) {
    throw new Error('驗收欄位必須為 commit、branch、check、exitCode、result、evidence。');
  }
  const { commit, branch, check, exitCode, result, evidence } = report;
  const fields = schema.properties;
  if (commit !== null && (typeof commit !== 'string' || commit.length !== 40 || !new RegExp(fields.commit.pattern).test(commit))) throw new Error('commit 要完整 SHA 或 null。');
  if (typeof check !== 'string' || !check.trim() || [...check].length > fields.check.maxLength) throw new Error('請寫實際驗收項目。');
  if (!fields.result.enum.includes(result)) throw new Error('驗收結果無效。');
  if (typeof evidence !== 'string' || evidence.length > fields.evidence.maxLength || !new RegExp(fields.evidence.pattern).test(evidence) || evidence.trim() !== evidence) throw new Error('evidence 要本機絕對路徑。');
  if (branch !== null && (typeof branch !== 'string' || !branch.trim() || branch.length > 255)) throw new Error('branch 要分支名或 null。');
  if (exitCode !== null && (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255)) throw new Error('exitCode 要 0–255 或 null。');
  if (result === 'PASS' && exitCode !== null && exitCode !== 0 || result === 'SKIP' && exitCode !== null) throw new Error('結果同 exitCode 矛盾。');
  return { note: JSON.stringify({ commit, branch, check, exitCode, result, evidence }), receipt: evidence };
}
