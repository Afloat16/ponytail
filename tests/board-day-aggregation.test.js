const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { pathToFileURL } = require('node:url');

let perDay, inDays;
test.before(async () => {
  const file = path.join(__dirname, '../hooks/band/board.ts');
  const logo = pathToFileURL(path.join(__dirname, '../hooks/band/logo.ts')).href;
  const source = stripTypeScriptTypes(fs.readFileSync(file, 'utf8').replace("'./logo'", JSON.stringify(logo)));
  const { boardHtml } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const script = /<script>([\s\S]*)<\/script>/.exec(boardHtml([], Date.UTC(2026, 10, 20)))[1];
  // Keep the production helpers and stop before DOM event registration/rendering.
  const cut = script.indexOf("  byId('q').addEventListener");
  const context = { document: { getElementById: () => ({ textContent: '{"tasks":[],"now":0}' }) } };
  vm.runInNewContext(script.slice(0, cut) + '\nthis.helpers = { perDay, inDays };\n})()', context);
  ({ perDay, inDays } = context.helpers);
});

test('daily totals keep requested order, repeated dates, empty dates and each metric', () => {
  const rows = [
    { started: '2026-11-19 13:00', cost: 0.1, tokens: 20 },
    { started: '2026-11-18 12:00', cost: 9, tokens: 10 },
    { started: '2026-11-19 14:00', cost: 0.2, tokens: 30 },
    { started: '2026-11-20 00:01', cost: 0, tokens: 40 },
  ];
  const keys = ['2026-11-20', '2026-11-19', '2026-11-17', '2026-11-19'];
  assert.deepEqual(Array.from(perDay(rows, keys, r => r.cost)), [0, 0.1 + 0.2, 0, 0.1 + 0.2]);
  assert.deepEqual(Array.from(perDay(rows, keys, r => r.tokens)), [40, 50, 0, 50]);
  assert.deepEqual(Array.from(perDay([], keys, () => 1)), [0, 0, 0, 0]);
  assert.deepEqual(Array.from(perDay(rows, [], () => 1)), []);
  assert.deepEqual(Array.from(inDays(rows, keys)), [rows[0], rows[2], rows[3]]);
  assert.deepEqual(Array.from(inDays(rows, [])), []);
});

test('daily aggregation reads each session date once as the period grows', () => {
  let reads = 0;
  const rows = Array.from({ length: 500 }, (_, i) => ({
    get started() { reads++; return `2026-11-${String(i % 20 + 1).padStart(2, '0')} 12:00`; },
    tokens: i,
  }));
  const keys = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`);
  const totals = Array.from(perDay(rows, keys, r => r.tokens));
  assert.equal(totals.reduce((a, b) => a + b, 0), 499 * 500 / 2);
  assert.equal(reads, rows.length, 'aggregate once, not once per displayed day');
});
