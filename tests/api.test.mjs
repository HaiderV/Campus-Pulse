import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import { createApp } from '../backend/server.mjs';
import { SentimentModel } from '../backend/sentiment.mjs';

let model;
let app;
let server;
let base;
before(() => { model = new SentimentModel(); });
beforeEach(async () => {
  app = createApp({ databasePath: ':memory:', model });
  server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => {
  await new Promise(resolve => server.close(resolve));
  app.locals.close();
});
const payload = updates => ({ text: 'The teachers are excellent and helpful.', category: 'Teaching', department: 'Computer Science', ...updates });
const submit = updates => fetch(`${base}/api/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload(updates)) });
const get = async path => (await fetch(base + path)).json();

test('submission updates the list, dashboard, and export', async () => {
  const response = await submit();
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(created.sentiment, 'positive');
  assert.equal(created.student_name, '');
  assert.equal((await get('/api/feedback')).total, 1);
  const dashboard = await get('/api/dashboard');
  assert.equal(dashboard.counts.positive, 1);
  assert.equal(dashboard.satisfaction, 100);
  assert.equal(dashboard.trend.reduce((total, day) => total + day.total, 0), 1);
  const csv = await (await fetch(`${base}/api/export`)).text();
  assert.equal(parse(csv, { columns: true, bom: true }).length, 1);
});

test('rejects invalid input without storing anything', async () => {
  for (const update of [{ text: 'short' }, { text: ' '.repeat(20) }, { text: 'a'.repeat(2001) }, { category: 'Unknown' }, { department: 'Unknown' }, { student_name: 'x'.repeat(81) }]) {
    assert.equal((await submit(update)).status, 422);
  }
  assert.equal((await get('/api/feedback')).total, 0);
});

test('filters and pagination share consistent results', async () => {
  await submit();
  await submit({ text: 'The food is terrible and overpriced.', category: 'Food & Dining' });
  for (const endpoint of ['/api/feedback', '/api/dashboard']) {
    assert.equal((await get(`${endpoint}?sentiment=negative`)).total, 1);
    assert.equal((await get(`${endpoint}?category=Teaching&search=excellent`)).total, 1);
    assert.equal((await get(`${endpoint}?search=%25`)).total, 0);
    assert.equal((await fetch(base + endpoint + '?days=-1')).status, 422);
    assert.equal((await fetch(base + endpoint + '?category=Unknown')).status, 422);
  }
  const page = await get('/api/feedback?page_size=1&page=2');
  assert.equal(page.items.length, 1);
  assert.equal(page.total, 2);
  assert.equal(page.items[0].category, 'Teaching');
  const csv = await (await fetch(`${base}/api/export?sentiment=negative`)).text();
  assert.equal(parse(csv, { columns: true, bom: true }).length, 1);
});

test('demo data is explicit and removable without deleting real submissions', async () => {
  assert.equal((await get('/api/dashboard')).total, 0);
  assert.equal((await (await fetch(base + '/api/demo', { method: 'POST' })).json()).inserted, 24);
  assert.equal((await fetch(base + '/api/demo', { method: 'POST' })).status, 409);
  await submit();
  assert.equal((await (await fetch(base + '/api/demo', { method: 'DELETE' })).json()).deleted, 24);
  assert.equal((await get('/api/feedback')).total, 1);
});

test('CSV export escapes spreadsheet formula injection', async () => {
  await submit({ student_name: '=1+1', text: '+This feedback is about the library.' });
  const rows = parse(await (await fetch(base + '/api/export')).text(), { columns: true, bom: true });
  assert.equal(rows[0].student_name, "'=1+1");
  assert.ok(rows[0].text.startsWith("'+"));
});

test('stored feedback survives reopening the database', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'campus-pulse-'));
  const path = join(folder, 'test.db');
  try {
    const persistent = createApp({ databasePath: path, model });
    const first = await new Promise(resolve => { const listening = persistent.listen(0, '127.0.0.1', () => resolve(listening)); });
    await fetch(`http://127.0.0.1:${first.address().port}/api/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()) });
    await new Promise(resolve => first.close(resolve));
    persistent.locals.close();
    const reopened = createApp({ databasePath: path, model });
    const second = await new Promise(resolve => { const listening = reopened.listen(0, '127.0.0.1', () => resolve(listening)); });
    const result = await (await fetch(`http://127.0.0.1:${second.address().port}/api/feedback`)).json();
    assert.equal(result.total, 1);
    await new Promise(resolve => second.close(resolve));
    reopened.locals.close();
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
