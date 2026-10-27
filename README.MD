# Campus Pulse

A college feedback sentiment-analysis project with a student submission page and a staff-style analytics dashboard.

## Run locally

Requires **Node.js 22.13 or newer** and npm. No Python installation, external API key, or database server is needed.

```powershell
npm install
npm start
```

Open **http://127.0.0.1:3000**. Both the frontend and API are served from this address. On Windows, use `npm.cmd` instead of `npm` if PowerShell blocks the npm script.

If the port is occupied:

```powershell
$env:PORT = "3002"
npm start
```

The app starts with an empty database. Select **Load sample feedback** at the bottom of the dashboard to explore 24 clearly marked sample responses. **Remove samples** deletes only those entries and preserves real submissions. Sample loading is available only when the database is empty.

## What works

- Student feedback with six categories, department selection, and optional anonymous submission.
- Automatic positive, negative, or neutral predictions on submission.
- Dashboard counts, sentiment distribution, seven-day UTC activity, category breakdown, and negative-feedback priorities.
- Shared department, category, sentiment, date, and text filters across charts, table, and export.
- Paginated feedback, full-text detail dialogs, and formula-safe CSV exports.
- SQLite persistence, responsive layouts, locally bundled fonts/icons/charts, loading states, and recoverable error messages.

## How the model works

`data/training.csv` contains **90 hand-written illustrative English-language examples**, balanced across the three labels. Natural provides TF-IDF statistics for word and two-word features. Features are normalized and passed to `ml-logistic-regression` for a one-vs-rest Logistic Regression model.

At startup, a deterministic 20% holdout is used to report an illustrative accuracy in **Sentiment model**, then the final model is refitted on all examples. The evaluation vectorizer sees only the training partition. Submitted feedback is stored but **does not automatically retrain the model**. To retrain, add labeled examples to the CSV and restart the app. Preserve the `text,sentiment` columns and use only `positive`, `negative`, and `neutral` labels. Quote CSV fields containing commas.

**This is a demonstration model, not a validated production classifier.** The tiny synthetic dataset and held-out accuracy do not establish real-world performance. Sarcasm, negation, mixed opinions, unseen vocabulary, and non-English text can be misclassified. Displayed model scores are normalized one-vs-rest scores, not calibrated probabilities. Human review is required before acting on predictions. Use a larger, representative, consented dataset and a genuinely independent test set for real deployments.

## Project layout

```text
backend/
  server.mjs          Express API, SQLite storage, validation, aggregation
  sentiment.mjs       TF-IDF and Logistic Regression training/prediction
data/
  training.csv        Editable labeled demonstration corpus
  feedback.db         Created automatically; excluded from version control
frontend/
  index.html          Dashboard and student feedback views
  styles.css          Responsive styling
  app.js              API integration, charts, navigation, interactions
  vendor/             Generated local fonts, Lucide icons, Chart.js
scripts/
  vendor.mjs          Copies assets after npm install
tests/
  api.test.mjs        Submission, validation, filters, exports, persistence
  sentiment.test.mjs  Classifier and model metadata checks
```

## Tests

```powershell
npm test
npm run check
npm audit
```

Tests use isolated databases, not your saved feedback. Node 22 may print an experimental warning for its built-in SQLite module; this does not prevent the project from running.

For the full browser smoke test, install Microsoft Edge (or set `BROWSER_PATH` to an installed Chromium-based browser executable) and run:

```powershell
npm run test:browser
```

This launches an isolated in-memory server, checks submission, filtering, CSV downloads, error recovery, safe text rendering, chart pixels, and mobile layouts, then shuts down. Desktop and mobile screenshots are saved under `.artifacts/`.

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Health check |
| GET | `/api/config` | Categories, departments, model details |
| POST | `/api/feedback` | Validate, classify, and save feedback |
| GET | `/api/feedback` | Filtered, paginated feedback |
| GET | `/api/dashboard` | Filtered analytics |
| GET | `/api/export` | Filtered CSV export |
| POST | `/api/demo` | Add samples to an empty database |
| DELETE | `/api/demo` | Remove only sample entries |

Submission JSON:

```json
{
  "text": "The teachers are excellent and explain topics clearly.",
  "category": "Teaching",
  "department": "Computer Science",
  "student_name": ""
}
```

Feedback must be 10-2,000 characters after trimming; names are optional and limited to 80 characters. Categories and departments must match values from `/api/config`.

List, dashboard, and export accept `search`, `category`, `department`, `sentiment`, and `days` (default 30; 0 means all time). List also accepts `page` (default 1) and `page_size` (default 8, maximum 100). Trend dates are UTC; displayed submission timestamps use the browser's locale and timezone.

## Storage And Deployment

SQLite is stored at `data/feedback.db`. Override the location with the `FEEDBACK_DB` environment variable. Stop the app before copying a database backup, or use a SQLite-aware backup tool that handles WAL files. Prefer a local, non-synced database path for real use rather than an actively synced OneDrive folder.

The server binds to `127.0.0.1` by default. **This local academic prototype has no login or role-based authorization.** Anyone with access to the app can view feedback, export it, and remove samples. Anonymous means the name field is blank, not that identifying text is automatically removed. Feedback is processed locally and is not sent to a third-party sentiment service.

Before exposing this publicly, add staff authentication and authorization, student submission abuse protection/rate limits, HTTPS, a privacy and retention policy, and a production database/backup strategy. Protect the analytics, export, and demo routes. Do not collect sensitive student information in this prototype.
