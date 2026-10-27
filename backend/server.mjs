import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'csv-stringify/sync';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { SentimentModel } from './sentiment.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const CATEGORIES = ['Teaching', 'Facilities', 'Library', 'Food & Dining', 'Administration', 'Campus Life'];
export const DEPARTMENTS = ['Computer Science', 'Engineering', 'Business', 'Arts & Sciences', 'Other'];
const SENTIMENTS = ['positive', 'neutral', 'negative'];
const feedbackSchema = z.object({
  text: z.string().trim().min(10, 'Please write at least 10 characters.').max(2000),
  category: z.enum(CATEGORIES),
  department: z.enum(DEPARTMENTS),
  student_name: z.string().trim().max(80).default(''),
});
const filterSchema = z.object({
  search: z.string().trim().max(200).default(''),
  sentiment: z.enum(SENTIMENTS).optional(),
  category: z.enum(CATEGORIES).optional(),
  department: z.enum(DEPARTMENTS).optional(),
  days: z.coerce.number().int().min(0).max(3650).default(30),
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(8),
});

function parseFilters(query) {
  const filters = filterSchema.parse(query);
  const clauses = [];
  const parameters = [];
  for (const column of ['sentiment', 'category', 'department']) {
    if (filters[column]) {
      clauses.push(`${column} = ?`);
      parameters.push(filters[column]);
    }
  }
  if (filters.search) {
    clauses.push('(instr(lower(text), lower(?)) > 0 OR instr(lower(student_name), lower(?)) > 0)');
    parameters.push(filters.search, filters.search);
  }
  if (filters.days) {
    clauses.push('created_at >= ?');
    parameters.push(new Date(Date.now() - filters.days * 86400000).toISOString());
  }
  return { ...filters, where: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', parameters };
}

export function createApp({ databasePath = process.env.FEEDBACK_DB || resolve(ROOT, 'data/feedback.db'), model = new SentimentModel() } = {}) {
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      category TEXT NOT NULL,
      department TEXT NOT NULL,
      student_name TEXT NOT NULL DEFAULT '',
      sentiment TEXT NOT NULL,
      confidence REAL NOT NULL,
      created_at TEXT NOT NULL,
      is_demo INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS feedback_created_at ON feedback(created_at);
  `);
  const app = express();
  app.disable('x-powered-by');
  app.locals.close = () => database.close();
  app.use((request, response, next) => {
    response.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' });
    if (request.path.startsWith('/api/')) response.set('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '16kb' }));

  function insertFeedback(feedback, createdAt = new Date().toISOString(), isDemo = false) {
    const prediction = model.predict(feedback.text);
    const result = database.prepare(`INSERT INTO feedback
      (text, category, department, student_name, sentiment, confidence, created_at, is_demo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      feedback.text, feedback.category, feedback.department, feedback.student_name,
      prediction.sentiment, prediction.confidence, createdAt, Number(isDemo),
    );
    return database.prepare('SELECT * FROM feedback WHERE id = ?').get(Number(result.lastInsertRowid));
  }

  app.get('/api/health', (request, response) => response.json({ status: 'ok' }));
  app.get('/api/config', (request, response) => response.json({ categories: CATEGORIES, departments: DEPARTMENTS, model: model.metadata() }));
  app.post('/api/feedback', (request, response) => response.status(201).json(insertFeedback(feedbackSchema.parse(request.body))));

  app.get('/api/feedback', (request, response) => {
    const filters = parseFilters(request.query);
    const { total } = database.prepare(`SELECT COUNT(*) AS total FROM feedback${filters.where}`).get(...filters.parameters);
    const items = database.prepare(`SELECT * FROM feedback${filters.where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
      .all(...filters.parameters, filters.page_size, (filters.page - 1) * filters.page_size);
    response.json({ items, total, page: filters.page, page_size: filters.page_size });
  });

  app.get('/api/dashboard', (request, response) => {
    const filters = parseFilters(request.query);
    const rows = database.prepare(`SELECT sentiment, category, created_at FROM feedback${filters.where}`).all(...filters.parameters);
    const { total: allTimeTotal } = database.prepare('SELECT COUNT(*) AS total FROM feedback').get();
    const { total: demoTotal } = database.prepare('SELECT COUNT(*) AS total FROM feedback WHERE is_demo = 1').get();
    const counts = { positive: 0, neutral: 0, negative: 0 };
    const categories = CATEGORIES.map(category => ({ category, positive: 0, neutral: 0, negative: 0, total: 0 }));
    const trend = Array.from({ length: 7 }, (_, index) => ({
      date: new Date(Date.now() - (6 - index) * 86400000).toISOString().slice(0, 10),
      positive: 0, neutral: 0, negative: 0, total: 0,
    }));
    for (const row of rows) {
      counts[row.sentiment]++;
      const category = categories.find(item => item.category === row.category);
      category[row.sentiment]++;
      category.total++;
      const day = trend.find(item => item.date === row.created_at.slice(0, 10));
      if (day) { day[row.sentiment]++; day.total++; }
    }
    const concerns = categories.filter(category => category.negative)
      .sort((first, second) => second.negative - first.negative || first.category.localeCompare(second.category)).slice(0, 3);
    response.json({
      total: rows.length, counts, satisfaction: rows.length ? Math.round(counts.positive / rows.length * 100) : 0,
      categories, trend, concerns, all_time_total: allTimeTotal, demo_total: demoTotal,
    });
  });

  app.get('/api/export', (request, response) => {
    const filters = parseFilters(request.query);
    const rows = database.prepare(`SELECT * FROM feedback${filters.where} ORDER BY created_at DESC`).all(...filters.parameters);
    const csv = stringify(rows, {
      header: true, bom: true, escape_formulas: true,
      columns: ['id', 'created_at', 'category', 'department', 'student_name', 'text', 'sentiment', 'confidence', 'is_demo'],
    });
    response.attachment('campus-feedback.csv').type('text/csv').send(csv);
  });

  app.post('/api/demo', (request, response) => {
    if (database.prepare('SELECT COUNT(*) AS total FROM feedback').get().total) {
      return response.status(409).json({ error: 'Demo data can only be loaded into an empty database.' });
    }
    const training = parse(readFileSync(resolve(ROOT, 'data/training.csv'), 'utf8'), { columns: true, skip_empty_lines: true });
    const selections = [
      [0, 'Teaching'], [44, 'Facilities'], [8, 'Library'], [45, 'Food & Dining'],
      [1, 'Teaching'], [22, 'Campus Life'], [49, 'Administration'], [64, 'Teaching'],
      [13, 'Facilities'], [61, 'Library'], [46, 'Food & Dining'], [2, 'Teaching'],
      [24, 'Campus Life'], [19, 'Administration'], [40, 'Facilities'], [4, 'Teaching'],
      [80, 'Library'], [15, 'Food & Dining'], [3, 'Teaching'], [23, 'Campus Life'],
      [11, 'Facilities'], [70, 'Administration'], [36, 'Teaching'], [9, 'Library'],
    ];
    database.exec('BEGIN');
    try {
      selections.forEach(([index, category], position) => {
        insertFeedback({
          text: training[index].text, category, department: DEPARTMENTS[position % DEPARTMENTS.length], student_name: '',
        }, new Date(Date.now() - (position % 7) * 86400000 - (position % 5) * 3600000).toISOString(), true);
      });
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    response.status(201).json({ inserted: selections.length });
  });
  app.delete('/api/demo', (request, response) => {
    response.json({ deleted: Number(database.prepare('DELETE FROM feedback WHERE is_demo = 1').run().changes) });
  });

  app.use('/api', (request, response) => response.status(404).json({ error: 'API endpoint not found.' }));
  app.use('/static', express.static(resolve(ROOT, 'frontend')));
  app.get('/', (request, response) => response.sendFile(resolve(ROOT, 'frontend/index.html')));
  app.use((error, request, response, next) => {
    if (error instanceof z.ZodError) return response.status(422).json({ error: error.issues[0]?.message || 'Invalid input.', details: error.issues });
    if (error.type === 'entity.too.large') return response.status(413).json({ error: 'Request is too large.' });
    if (error instanceof SyntaxError && 'body' in error) return response.status(400).json({ error: 'Invalid JSON body.' });
    console.error(error);
    response.status(500).json({ error: 'Something went wrong. Please try again.' });
  });
  return app;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp();
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  const server = app.listen(port, host, () => console.log(`Campus Pulse is running at http://${host}:${server.address().port}`));
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use. Set PORT to another port and try again.` : error.message);
    app.locals.close();
    process.exitCode = 1;
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(() => { app.locals.close(); process.exit(0); }));
  }
}
