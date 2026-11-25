import { t, translate, type Lang } from './index';

type TranslateFn = typeof t;

/**
 * Translates known Bridge server NOTICE strings into the active client UI language,
 * falling back to the original message for unrecognized or dynamic diagnostics.
 */
export function translateServerNotice(message: string, translateFn: TranslateFn = t): string {
  const fixed: Record<string, Parameters<TranslateFn>[0]> = {
    "設定確認無效。": "notice.extra.confirmInvalid",
    "恢復確認無效。": "notice.extra.resumeInvalid",
    "提示無效。": "notice.extra.hintInvalid",
    "路徑無效。": "notice.extra.pathInvalid",
    "設定無效。": "notice.extra.settingsInvalid",
    "請先確認恢復離線監察。": "notice.extra.offlineResume",
    '檔案觸發設定或 Keychain 錨點無效；監察已停止，通知不會送出。': 'notice.extra.integrity',
    '檔案觸發未能遞送；請檢查設定。': 'notice.extra.delivery',
    '檔案觸發積壓已達上限，請檢查。': 'notice.extra.overflow',
    '已刪除群組，但未能移除檔案監察設定；請檢查設定檔。': 'notice.extra.deleted',
    '設定確認已失效，請重新檢查。': 'notice.extra.confirmStale',
    '無法驗證檔案觸發設定或金鑰。': 'notice.extra.keyInvalid',
    '恢復確認已失效，請重新查看。': 'notice.extra.resumeStale',
    '未能安全恢復監察，請檢查路徑。': 'notice.extra.resumeFailed',
    '找不到監察項。': 'notice.extra.missing',
    '離線中請先確認恢復或取消監察。': 'notice.extra.offline',
  };
  if (fixed[message]) return translateFn(fixed[message]);
  for (const [suffix, key] of [
    [' 工作台工單仍留在輸入框，請查看終端', 'notice.blocker.draft'],
    [' 對話正在其他程式開啟，請查看終端', 'notice.blocker.locked'],
    [' 正在等你確認答案，請查看終端', 'notice.blocker.answers'],
  ] as const) {
    if (message.endsWith(suffix)) return translateFn(key, { room: message.slice(0, -suffix.length) });
  }
  const stalled = /^(.+?) 畫面長時間沒有變化，可能需要你處理$/.exec(message);
  if (stalled) return translateFn('notice.extra.stalled', { room: stalled[1] });
  let m = /^(已封存|已刪除)的房間仍在群組「(.+?)」內（群組至少要保留一間成員房），請稍後自行處理。$/.exec(message);
  if (m) return translateFn(m[1] === '已刪除' ? 'notice.group.keptDeleted' : 'notice.group.keptArchived', { group: m[2] });

  if (message === '房間已合併，但群組關聯未能更新；請檢查群組資料。') {
    return translateFn('notice.group.mergeFailed');
  }

  m = /^房間已還原，但未能加返群組：(.+?)（群組已滿或房間未能加入）。$/.exec(message);
  if (m) return translateFn('notice.group.restoreSkipped', { groups: m[1] });

  m = /^「(.+?)」已取消「(.+?)」的總指揮。$/.exec(message);
  if (m) return translateFn('notice.group.leadCleared', { group: m[1], room: m[2] });

  m = /^「(.+?)」沒有總指揮。$/.exec(message);
  if (m) return translateFn('notice.group.leadNone', { group: m[1] });

  m = /^「(.+?)」的總指揮已設為「(.+?)」。$/.exec(message);
  if (m) return translateFn('notice.group.leadSet', { group: m[1], room: m[2] });

  if (message === '這間房的 CLI 已開啟。') return translateFn('notice.group.wakeOpen');
  if (message === '這間房的 CLI 正在啟動。') return translateFn('notice.group.wakeStarting');
  if (message === '請先解除封存，再開啟 CLI。') return translateFn('notice.group.wakeArchived');
  if (message === '未有已核實又可續接的 Session。請先確認原房。') return translateFn('notice.group.wakeUnverified');
  if (message === '已開啟 12 個 CLI，請先關閉一間。') return translateFn('notice.group.wakeLimit');

  m = /^預設工作資料夾已改為 (.+?)。新房由此開始，舊房不變。$/.exec(message);
  if (m) return translateFn('notice.folder.changed', { path: m[1] });

  m = /^(\d+) 張超過 (\d+) 日的上傳圖片已移到垃圾桶。$/.exec(message);
  if (m) return translateFn('notice.attachment.expired', { count: Number(m[1]), days: Number(m[2]) });

  m = /^已經載入到上限（(\d+) 則）。更早的對話請在 CLI 以原生 \/resume 查看。$/.exec(message);
  if (m) return translateFn('notice.history.limit', { count: Number(m[1]) });

  if (message === '已開啟鎖屏推送。') return translateFn('notice.push.enabled');
  if (message === '已關閉鎖屏推送。') return translateFn('notice.push.disabled');
  if (message === '這部裝置未開啟通知。') return translateFn('notice.push.notEnabled');
  if (message === '這部裝置未訂閱，請先開啟通知。') return translateFn('notice.push.notSubscribed');
  if (message === '已發出測試通知，幾秒內應該會收到。') return translateFn('notice.push.testSent');
  if (message === '這部裝置的訂閱已失效，請關閉再重新開啟通知。') return translateFn('notice.push.subscriptionGone');
  if (message === '推送服務沒有回應，請確認 Mac 有連網。') return translateFn('notice.push.serviceUnreachable');
  if (message === '正關閉選單，返到輸入位置後會送出指令。') return translateFn('notice.menu.closingForCommand');
  if (message === '已記住新模式，但這間房未有可續接的 Session，下次開房才生效。') return translateFn('notice.mode.savedNextOpen');
  if (message === 'Codex Remote Control 啟動失敗，已開啟本地 CLI；請稍後檢查遠端連線。') return translateFn('notice.remote.failedFallback');
  if (message === '無法保存這間房的速度設定，重啟 Bridge 後可能跟返標準速度。') return translateFn('notice.save.fastFailed');
  if (message === '無法保存這間房的模型選擇，重啟 Bridge 後可能跟返預設。') return translateFn('notice.save.modelFailed');
  if (message === '無法保存這間房的權限模式，重連後可能改用預設。') return translateFn('notice.save.permissionFailed');
  if (message === '無法保存房間的 Session ID，重啟後可能要重新選擇房。') return translateFn('notice.save.sessionFailed');

  m = /^(.+?) 未確認可以續接，CLI 暫時保持開啟。$/.exec(message);
  if (m) return translateFn('notice.room.unconfirmedKeepOpen', { room: m[1] });

  m = /^(.+?) 未能自動結束 CLI。$/.exec(message);
  if (m) return translateFn('notice.room.closeFailed', { room: m[1] });

  m = /^(.+?)：CLI 輸入框仍然有你剛才的訊息，似乎未送出。(它有一條問題等你回答（可以用手動按鍵的 ⇧← 打開），答完或者它自己逾時後才會收到。)?請核對終端。$/.exec(message);
  if (m) return translateFn(m[2] ? 'notice.room.stillTypedAsking' : 'notice.room.stillTyped', { room: m[1] });

  m = /^已從 Komorebi 移除 (\d+) 間封存房間，CLI 原有資料保留。(?:　(\d+) [張個](?:上傳圖片|附件)已移到垃圾桶(?:，(\d+) [張個]未能移動，仍在 Komorebi Attachments)?。)?$/.exec(message);
  if (m) {
    if (m[3]) return translateFn('notice.archive.removedWithPartialTrash', { count: Number(m[1]), moved: Number(m[2]), failed: Number(m[3]) });
    if (m[2]) return translateFn('notice.archive.removedWithTrash', { count: Number(m[1]), moved: Number(m[2]) });
    return translateFn('notice.archive.removed', { count: Number(m[1]) });
  }

  m = /^工作台 #(\d+)：(.+?) → (.+?)，對方本小時已收 (\d+) 次提示，這張要等對方工作時收到或由你處理。$/.exec(message);
  if (m) return translateFn('notice.bench.pingLimitTicket', { id: Number(m[1]), from: m[2], to: m[3], limit: Number(m[4]) });

  m = /^工作台已停止：(.+)$/.exec(message);
  if (m) return translateFn('notice.bench.stopped', { error: m[1] });

  m = /^工作台：(.+?) 有 (\d+) 張未讀工單，但本小時提示已達上限，等對方下次工作或由你處理。$/.exec(message);
  if (m) return translateFn('notice.bench.pingLimitRoom', { room: m[1], count: Number(m[2]) });

  m = /^已轉用 (.+?)（只影響這間房，對話照舊(?:續接|接續)）。$/.exec(message);
  if (m) return translateFn('notice.room.modelSwitched', { model: m[1] });

  return message;
}

export function translateServerNoticeFor(lang: Lang, message: string): string {
  return translateServerNotice(message, (key, vars) => translate(lang, key, vars));
}
