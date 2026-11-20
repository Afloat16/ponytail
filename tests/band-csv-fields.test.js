const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const { pathToFileURL } = require('node:url');

let parseCsv, tasksFrom, resume;
test.before(async () => {
  const source = path.join(__dirname, '..', 'hooks', 'band');
  const moduleUrl = (file, from, to) => 'data:text/javascript;base64,' + Buffer.from(
    stripTypeScriptTypes(fs.readFileSync(path.join(source, file), 'utf8').replace(from, JSON.stringify(to)))
  ).toString('base64');
  const board = moduleUrl('board.ts', "'./logo'", pathToFileURL(path.join(source, 'logo.ts')).href);
  ({ parseCsv, tasksFrom } = await import(board));
  ({ resume } = await import(moduleUrl('metrics.ts', "'./board'", board)));
});

test('retains quoted commas, doubled quotes, embedded CRLF and empty fields', () => {
  assert.deepEqual(parseCsv('"quoted, field","a""b","line1\r\nline2"\r\n,plain,\r\n'), [
    ['quoted, field', 'a"b', 'line1\r\nline2'], ['', 'plain', ''],
  ]);
  assert.deepEqual(parseCsv('"""","a""""b"'), [['"', 'a""b']]);
});

test('keeps existing behavior for empty records, unclosed quotes and mixed quoted runs', () => {
  assert.deepEqual(parseCsv(',,\n\r\n'), []);
  assert.deepEqual(parseCsv('"ab"cd,a"b,c"d'), [['abcd', 'ab,cd']]);
  assert.deepEqual(parseCsv('"unterminated\nfield'), [['unterminated\nfield']]);
  assert.deepEqual(parseCsv('a\rb\nc\r\nd,'), [['a'], ['b'], ['c'], ['d', '']]);
});

test('preserves Unicode, BOMs inside fields and long field runs', () => {
  const text = '\u{1f680}\uFEFF' + 'long field '.repeat(10000);
  assert.deepEqual(parseCsv('"' + text + '",tail'), [[text, 'tail']]);
});

test('round-trips varied ledger fields through an independent RFC-style encoder', () => {
  const choices = ['', ',', '"', '\r', '\n', '\r\n', '\u{1f680}', '\\', 'plain', ' '];
  const rows = Array.from({ length: 256 }, (_, i) => [String(i), ...Array.from({ length: 10 }, (_, j) =>
    choices[(i + j) % choices.length] + choices[(i * 3 + j * 7) % choices.length] + choices[(i * 11 + j) % choices.length])]);
  const field = value => /[",\r\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value;
  const csv = rows.map(row => row.map(field).join(',')).join('\r\n');
  assert.deepEqual(parseCsv(csv), rows);
});

test('uses the parsed values when displaying tasks and restoring Band counters', () => {
  const csv = 'key,started,project,name,cost_usd,turns,agent_minutes,tokens_total,tokens_output,reuse_pct,reused,new,callers_open,tests,level,model\r\n' +
    'session-1,2026-11-20 10:00,project,"Fix ""quoted"",\r\nmultiline name",0.25,4,2.5,12345,345,75,3,1,0,14 passed,full,claude-opus-5-5\r\n';
  const tasks = tasksFrom(csv);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].name, 'Fix "quoted",\r\nmultiline name');
  assert.equal(tasks[0].tokens, 12345);
  const restored = resume({ name: '', busyMs: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }, csv, 'session-1');
  assert.equal(restored.name, tasks[0].name);
  assert.equal(restored.busyMs, 150000);
  assert.deepEqual(restored.tokens, { input: 12000, output: 345, cacheRead: 0, cacheWrite: 0 });
});
