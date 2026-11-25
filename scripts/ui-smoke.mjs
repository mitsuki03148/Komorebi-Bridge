// UI smoke test: opens the running Bridge's page in headless Chrome and checks the basics a person would notice first.
//
//   npm run smoke                 (Bridge must be running; KOMOREBI_URL overrides http://localhost:3000)
//
// Run it before a release or after a change that touches the page's loading, rooms list or unread dots.
// It is NOT part of `npm test`, and a small change does not need it. It never types into a room and never writes the Founder's
// read state (every report a page sends to the Bridge is dropped). Opening the page only registers as a viewer, like any browser tab.
// Uses the Chrome installed on this Mac (no browser download). Prints PASS / FAIL / SKIP per check; exit code 1 if any check FAILs.
// A SKIP is not a PASS.
import { chromium } from 'playwright-core';
import WebSocket from 'ws';

const url = process.env.KOMOREBI_URL ?? `http://localhost:${process.env.KOMOREBI_PORT ?? 3000}`;
const marksKey = 'komorebi-read-marks-v1';
const longAgo = '2000-01-01T00:00:00.000Z';
// The unread dot's accessible name in zh / en / ja.
const unreadDot = ['有新回覆', 'New reply', '新着返信あり', '新しい返信'].map(name => `[aria-label="${name}"]`).join(',');

const results = [];
const record = (status, name, detail = '') => { results.push(status); console.log(`${status}  ${name}${detail ? ' — ' + detail : ''}`); };
const check = (ok, name, detail) => record(ok ? 'PASS' : 'FAIL', name, detail);

/** What the Bridge says: does it keep the read marks, and how many rooms have a reply newer than the mark; and how many rooms replied since `since`. */
const askBridge = since => new Promise(resolve => {
  const socket = new WebSocket(url.replace(/^http/, 'ws') + '/ws', { headers: { Origin: new URL(url).origin } });
  const fail = setTimeout(() => { socket.terminate(); resolve(undefined); }, 8_000);
  let snapshot;
  const replied = room => (room.logs ?? []).findLast(entry => entry.sender === 'agent' && Date.parse(entry.createdAt ?? '') > since);
  const done = marks => { clearTimeout(fail); socket.close(); resolve({ shared: snapshot.readMarksSupported === true, repliedSince: snapshot.rooms.filter(replied).length,
    unread: marks ? snapshot.rooms.filter(room => { const last = (room.logs ?? []).findLast(entry => entry.sender === 'agent'); const mark = marks[room.id];
      return last && mark !== undefined && (mark === '' || Date.parse(last.createdAt ?? '') > Date.parse(mark)); }).length : undefined }); };
  socket.on('error', () => { clearTimeout(fail); resolve(undefined); });
  socket.on('message', data => {
    const event = JSON.parse(data.toString());
    if (event.type === 'SNAPSHOT') { snapshot = event; if (!event.readMarksSupported) done(undefined); }
    else if (event.type === 'READ_MARKS' && snapshot) done(event.marks);
  });
});

const browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(error => {
  console.error(`Cannot start Chrome (${error.message.split('\n')[0]}). Install Google Chrome, then run again.`);
  process.exit(2);
});
try {
  const startedAt = Date.now();
  const bridge = await askBridge(startedAt);
  const shared = bridge?.shared === true;
  console.log(`(Bridge keeps read marks for all devices: ${shared ? `yes, ${bridge.unread} room(s) unread` : 'no, each browser keeps its own'})`);
  const problems = [];

  /** A fresh browser. Reports to the Bridge are dropped; `oldServerMarks` makes the page believe it has read nothing recently. */
  const openPage = async ({ oldServerMarks = false, size = { width: 1280, height: 800 } } = {}) => {
    const context = await browser.newContext({ viewport: size });
    const page = await context.newPage();
    page.on('pageerror', error => problems.push(`pageerror: ${String(error).slice(0, 160)}`));
    page.on('console', message => { if (message.type() === 'error') problems.push(`console: ${message.text().slice(0, 160)}`); });
    await page.routeWebSocket(/\/ws$/, socket => {
      const server = socket.connectToServer();
      socket.onMessage(message => { try { if (JSON.parse(String(message)).type === 'READ_MARKS_SET') return; } catch { /* Not JSON: pass it on. */ } server.send(message); });
      server.onMessage(message => {
        if (oldServerMarks) {
          try { const event = JSON.parse(String(message)); if (event.type === 'READ_MARKS') { for (const id of Object.keys(event.marks)) event.marks[id] = longAgo; socket.send(JSON.stringify(event)); return; } } catch { /* Pass it on. */ }
        }
        socket.send(message);
      });
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(error => { console.error(`Cannot open ${url}: ${error.message.split('\n')[0]}`); process.exit(2); });
    await page.waitForTimeout(4_500);
    return page;
  };
  const dotsOn = page => page.locator(unreadDot).count();
  const overflows = page => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  // The page does not show a dot for the room it has open, so one unread room cannot be told apart from none.
  const expectation = unread => unread === undefined || unread === 0 ? 'none' : unread === 1 ? 'either' : 'some';
  const dotsMatch = (dots, unread) => ({ none: dots === 0, either: true, some: dots > 0 })[expectation(unread)];
  const dotCheck = async (name, page, noteIfSkipped) => {
    const dots = await dotsOn(page);
    const after = await askBridge(startedAt);
    if (after && after.repliedSince > 0) return record('SKIP', name, `${dots} dots, but ${after.repliedSince} room(s) replied during the test, so the expected dots changed. Run again when the Bridge is quiet`);
    if (!after) return check(false, name, `${dots} dots, and the Bridge could not be asked`);
    const unread = shared ? after.unread : 0;
    check(dotsMatch(dots, unread), name, `${dots} dots; ${shared ? `the Bridge says ${unread} room(s) unread` : 'no saved state, so none expected'}${noteIfSkipped ?? ''}`);
  };

  let page = await openPage();
  const buttons = await page.locator('button').count();
  check(Boolean(await page.title()) && buttons > 0, 'page loads with controls', `${buttons} buttons`);
  check(!(await overflows(page)), 'no horizontal overflow at 1280×800');
  await dotCheck(shared ? 'a new browser shows the dots the Bridge says' : 'a browser with no saved state shows no unread dots', page);

  const marks = await page.evaluate(key => Object.keys(JSON.parse(localStorage.getItem(key) ?? '{}')).length, marksKey);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4_500);
  await dotCheck(shared ? 'a refresh shows the same dots as the Bridge, not old ones' : 'a refresh does not bring unread dots back', page, ` (${marks} rooms remembered)`);

  if (shared) {
    // A device that was last used long ago: its own browser marks are very old. The Bridge's marks decide, so it shows the same dots.
    await page.evaluate(([key, old]) => {
      const saved = JSON.parse(localStorage.getItem(key) ?? '{}');
      for (const id of Object.keys(saved)) saved[id] = old;
      localStorage.setItem(key, JSON.stringify(saved));
    }, [marksKey, longAgo]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4_500);
    await dotCheck('a device with very old browser marks shows the Bridge\'s dots, not a dot for every old reply', page);
    // Positive control: the Bridge reports nothing read recently. If the detector never finds a dot, the checks above prove nothing.
    await page.context().close();
    page = await openPage({ oldServerMarks: true });
    const seen = await dotsOn(page);
    check(seen > 0, 'the dot detector sees dots when the Bridge says replies are unseen', `${seen} dots`);
  } else if (marks === 0) record('SKIP', 'the dot detector sees dots when replies are unseen', 'no room has a reply yet');
  else {
    await page.evaluate(([key, old]) => {
      const saved = JSON.parse(localStorage.getItem(key) ?? '{}');
      for (const id of Object.keys(saved)) saved[id] = old;
      localStorage.setItem(key, JSON.stringify(saved));
    }, [marksKey, longAgo]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4_500);
    const seen = await dotsOn(page);
    check(seen > 0, 'the dot detector sees dots when replies are unseen', `${seen} dots`);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  check(!(await overflows(page)), 'no horizontal overflow at phone width 390×844');
  check(problems.length === 0, 'no console errors or page errors', problems.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}
const failed = results.filter(status => status === 'FAIL').length;
console.log(`\n${results.filter(status => status === 'PASS').length} PASS, ${failed} FAIL, ${results.filter(status => status === 'SKIP').length} SKIP`);
process.exit(failed ? 1 : 0);
