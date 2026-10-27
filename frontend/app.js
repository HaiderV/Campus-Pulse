const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const icons = { Teaching: 'graduation-cap', Facilities: 'building-2', Library: 'book-open', 'Food & Dining': 'utensils', Administration: 'clipboard-list', 'Campus Life': 'trees' };
const sentimentIcons = { positive: 'smile', neutral: 'meh', negative: 'frown' };
const colors = { positive: '#168777', neutral: '#d3a13e', negative: '#d47474' };
const state = { view: 'dashboard', page: 1, total: 0, pageSize: 8, search: '', sentiment: '', category: '', department: '', days: '30', items: [], config: null, requestId: 0 };
let donutChart;
let trendChart;
let controller;
let toastTimeout;
let searchTimeout;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
function icon(name) { return `<i data-lucide="${name}"></i>`; }
function refreshIcons() { if (window.lucide) lucide.createIcons(); }
function capitalize(value) { return value.charAt(0).toUpperCase() + value.slice(1); }
function formatNumber(value) { return new Intl.NumberFormat().format(value); }
function formatDate(value, full = false) {
  return new Intl.DateTimeFormat(undefined, full ? { dateStyle: 'medium', timeStyle: 'short' } : { month: 'short', day: 'numeric' }).format(new Date(value));
}
function badge(sentiment) { return `<span class="sentiment-badge sentiment-${sentiment}">${icon(sentimentIcons[sentiment])}${capitalize(sentiment)}</span>`; }
function toast(message, error = false) {
  clearTimeout(toastTimeout);
  $('#toast').textContent = message;
  $('#toast').classList.toggle('error', error);
  $('#toast').hidden = false;
  toastTimeout = setTimeout(() => { $('#toast').hidden = true; }, 4500);
}
async function api(path, options = {}) {
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
  return result;
}
function queryString() {
  const parameters = new URLSearchParams({ days: state.days });
  for (const key of ['search', 'sentiment', 'category', 'department']) if (state[key]) parameters.set(key, state[key]);
  return parameters;
}

function initializeCharts() {
  Chart.defaults.font.family = 'DM Sans';
  Chart.defaults.font.size = 10;
  Chart.defaults.color = '#98a490';
  Chart.defaults.plugins.legend.display = false;
  Chart.defaults.plugins.tooltip.backgroundColor = '#2c4632';
  Chart.defaults.plugins.tooltip.padding = 11;
  Chart.defaults.plugins.tooltip.cornerRadius = 5;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  Chart.defaults.animation = reducedMotion ? false : { duration: 400 };
  donutChart = new Chart($('#sentiment-chart'), {
    type: 'doughnut',
    data: { labels: ['No feedback'], datasets: [{ data: [1], backgroundColor: ['#edf2e9'], borderWidth: 0, spacing: 0, hoverOffset: 3 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '79%', plugins: { tooltip: { enabled: false } } },
  });
  trendChart = new Chart($('#trend-chart'), {
    type: 'line',
    data: { labels: [], datasets: ['positive', 'neutral', 'negative'].map(sentiment => ({
      label: capitalize(sentiment), data: [], borderColor: colors[sentiment],
      backgroundColor: `${colors[sentiment]}08`, fill: true, borderWidth: 2,
      pointRadius: 2.5, pointHoverRadius: 4, pointBackgroundColor: '#fff', pointBorderWidth: 1.5, tension: 0.3,
    })) },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: { tooltip: { enabled: true } },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 9 }, padding: 8, maxRotation: 0 } },
        y: { beginAtZero: true, suggestedMax: 3, border: { display: false }, grid: { color: '#edf2e9', drawTicks: false }, ticks: { precision: 0, padding: 10, maxTicksLimit: 5, font: { size: 9 } } },
      },
    },
  });
}

function renderDashboard(data) {
  $('#stat-total').textContent = formatNumber(data.total);
  $('#nav-count').textContent = formatNumber(data.all_time_total);
  for (const sentiment of ['positive', 'neutral', 'negative']) {
    $(`#stat-${sentiment}`).textContent = formatNumber(data.counts[sentiment]);
    $(`#percent-${sentiment}`).textContent = `${data.total ? Math.round(data.counts[sentiment] / data.total * 100) : 0}%`;
  }
  $('#donut-total').textContent = formatNumber(data.total);
  $('#satisfaction').textContent = `${data.satisfaction}%`;
  $('#demo-banner').hidden = !data.demo_total;
  $('#load-demo').hidden = data.all_time_total > 0;
  $('#sentiment-legend').innerHTML = ['positive', 'neutral', 'negative'].map(sentiment => `<div class="legend-item"><span class="legend-dot ${sentiment}-dot"></span><span>${capitalize(sentiment)}</span><strong>${data.total ? Math.round(data.counts[sentiment] / data.total * 100) : 0}%</strong></div>`).join('');
  donutChart.data.labels = data.total ? ['Positive', 'Neutral', 'Negative'] : ['No feedback'];
  donutChart.data.datasets[0].data = data.total ? [data.counts.positive, data.counts.neutral, data.counts.negative] : [1];
  donutChart.data.datasets[0].backgroundColor = data.total ? Object.values(colors) : ['#edf2e9'];
  donutChart.data.datasets[0].spacing = data.total ? 3 : 0;
  donutChart.options.plugins.tooltip.enabled = data.total > 0;
  donutChart.update();
  $('#sentiment-chart').setAttribute('aria-label', `Sentiment distribution: ${data.counts.positive} positive, ${data.counts.neutral} neutral, ${data.counts.negative} negative.`);
  trendChart.data.labels = data.trend.map(day => new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' }).format(new Date(day.date + 'T12:00:00Z')));
  trendChart.data.datasets.forEach(dataset => { dataset.data = data.trend.map(day => day[dataset.label.toLowerCase()]); });
  trendChart.update();
  $('#trend-chart').setAttribute('aria-label', 'Daily feedback (UTC): ' + data.trend.map(day => `${day.date}: ${day.positive} positive, ${day.neutral} neutral, ${day.negative} negative`).join('; '));
  const maximum = Math.max(1, ...data.categories.map(category => category.total));
  $('#category-bars').innerHTML = data.categories.map(category => `<div class="category-bar-row"><span class="category-bar-label">${icon(icons[category.category])}${escapeHtml(category.category)}</span><div class="bar-track" role="img" aria-label="${escapeHtml(category.category)}: ${category.positive} positive, ${category.neutral} neutral, ${category.negative} negative">${['positive', 'neutral', 'negative'].map(sentiment => `<span class="bar-${sentiment}" style="width:${category[sentiment] / maximum * 100}%"></span>`).join('')}</div><span class="category-bar-count">${category.total}</span></div>`).join('');
  $('#concerns-list').innerHTML = data.concerns.length ? data.concerns.map((category, index) => `<div class="concern-item"><div class="concern-info"><span class="concern-rank">0${index + 1}</span><div><h3>${escapeHtml(category.category)}</h3><p>${category.negative} negative ${category.negative === 1 ? 'response' : 'responses'}</p></div></div><button class="text-button review-concern" data-category="${escapeHtml(category.category)}" aria-label="Review negative ${escapeHtml(category.category)} feedback">Review${icon('arrow-up-right')}</button></div>`).join('') : `<div class="concerns-empty">${icon('circle-check')}<span>${data.total ? 'No negative feedback in this selection.' : 'No concerns to review yet.'}</span></div>`;
  $('#empty-title').textContent = data.all_time_total ? 'No matching feedback' : 'A fresh start for student voices';
  $('#empty-description').textContent = data.all_time_total ? 'Try another filter or search term.' : 'No feedback has been submitted yet.';
}

function renderFeedback(data) {
  state.items = data.items;
  state.total = data.total;
  $('#table-count').textContent = formatNumber(data.total);
  $('#empty-state').hidden = data.total !== 0;
  $('#feedback-body').innerHTML = data.items.map(item => `<tr><td><p class="feedback-snippet">${escapeHtml(item.text)}</p><div class="feedback-meta"><span>${escapeHtml(item.student_name || 'Anonymous')}</span><span class="meta-dot"></span><span>${escapeHtml(item.department)}</span>${item.is_demo ? '<span class="demo-tag">SAMPLE</span>' : ''}</div></td><td>${escapeHtml(item.category)}</td><td>${badge(item.sentiment)}</td><td><time datetime="${escapeHtml(item.created_at)}" title="${escapeHtml(formatDate(item.created_at, true))}">${formatDate(item.created_at)}</time></td><td><button class="row-detail" data-id="${item.id}" aria-label="View feedback ${item.id}" title="View full feedback">${icon('chevron-right')}</button></td></tr>`).join('');
  const start = data.total ? (data.page - 1) * data.page_size + 1 : 0;
  const end = Math.min(data.page * data.page_size, data.total);
  $('#pagination-label').textContent = data.total ? `Showing ${start}-${end} of ${formatNumber(data.total)} responses` : 'No responses to display';
  $('#page-number').textContent = data.page;
  $('#previous-page').disabled = data.page <= 1;
  $('#next-page').disabled = end >= data.total;
}

async function loadData() {
  const requestId = ++state.requestId;
  controller?.abort();
  controller = new AbortController();
  $('#data-view').classList.add('loading-state');
  $('#refresh-button').querySelector('svg')?.classList.add('spinning');
  $('#data-view').setAttribute('aria-busy', 'true');
  $('#load-error').hidden = true;
  $('#export-button').disabled = true;
  const parameters = queryString();
  try {
    const [dashboard, feedback] = await Promise.all([
      api(`/api/dashboard?${parameters}`, { signal: controller.signal }),
      api(`/api/feedback?${parameters}&page=${state.page}&page_size=${state.pageSize}`, { signal: controller.signal }),
    ]);
    if (requestId !== state.requestId) return;
    const lastPage = Math.max(1, Math.ceil(feedback.total / state.pageSize));
    if (state.page > lastPage) { state.page = lastPage; return loadData(); }
    renderDashboard(dashboard);
    renderFeedback(feedback);
    $('#last-updated').textContent = `Updated ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date())}`;
    $('#clear-filters').hidden = !state.search && !state.category && !state.department && !state.sentiment && state.days === '30';
    refreshIcons();
  } catch (error) {
    if (error.name === 'AbortError' || requestId !== state.requestId) return;
    $('#load-error-text').textContent = `Couldn't load feedback. ${error.message}`;
    $('#load-error').hidden = false;
  } finally {
    if (requestId === state.requestId) {
      $('#data-view').classList.remove('loading-state');
      $('#data-view').setAttribute('aria-busy', 'false');
      $('#refresh-button').querySelector('svg')?.classList.remove('spinning');
      $('#export-button').disabled = false;
    }
  }
}

function syncFilters() {
  for (const key of ['category', 'department', 'days']) $(`#${key}-filter`).value = state[key];
  $('#search-input').value = state.search;
  $$('[data-sentiment]').forEach(button => {
    const selected = button.dataset.sentiment === state.sentiment;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}
function resetFilters() {
  clearTimeout(searchTimeout);
  Object.assign(state, { page: 1, search: '', sentiment: '', category: '', department: '', days: '30' });
  syncFilters();
}
function closeMenu() {
  $('#sidebar').classList.remove('open');
  $('#sidebar-scrim').hidden = true;
  $('#menu-button').setAttribute('aria-expanded', 'false');
}
function route() {
  const view = location.hash.slice(1);
  state.view = ['dashboard', 'feedback', 'submit'].includes(view) ? view : 'dashboard';
  const submit = state.view === 'submit';
  $('#data-view').hidden = submit;
  $('#submit-view').hidden = !submit;
  $('#analytics-view').hidden = state.view !== 'dashboard';
  $('#dashboard-actions').hidden = submit;
  $('#view-all-link').hidden = state.view === 'feedback';
  $('#feedback-title').textContent = state.view === 'feedback' ? 'All feedback' : 'Recent feedback';
  const titles = {
    dashboard: ['THE BIG PICTURE', 'Feedback overview', 'Every voice is a step toward a better campus.', 'Overview'],
    feedback: ['THE CAMPUS CONVERSATION', 'All feedback', 'A little perspective from the people who matter.', 'All feedback'],
    submit: ['YOUR CAMPUS. YOUR VOICE.', 'Tell us about your experience', 'The good, the not-so-good, and everything in between.', 'Submit feedback'],
  };
  const [eyebrow, title, subtitle, breadcrumb] = titles[state.view];
  $('#page-eyebrow').textContent = eyebrow;
  $('#page-title').textContent = title;
  $('#page-subtitle').textContent = subtitle;
  $('#breadcrumb-current').textContent = breadcrumb;
  document.title = `${breadcrumb} | Campus Pulse`;
  $$('[data-view]').forEach(link => {
    link.classList.toggle('active', link.dataset.view === state.view);
    if (link.dataset.view === state.view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  closeMenu();
  if (!submit && state.config) { loadData(); requestAnimationFrame(() => { donutChart.resize(); trendChart.resize(); }); }
}

function showDetails(id) {
  const item = state.items.find(feedback => feedback.id === Number(id));
  if (!item) return;
  $('#detail-content').innerHTML = `${badge(item.sentiment)}${item.is_demo ? ' <span class="demo-tag">SAMPLE FEEDBACK</span>' : ''}<p class="detail-text">${escapeHtml(item.text)}</p><dl class="detail-facts"><div><dt>Submitted by</dt><dd>${escapeHtml(item.student_name || 'Anonymous')}</dd></div><div><dt>Department</dt><dd>${escapeHtml(item.department)}</dd></div><div><dt>Category</dt><dd>${escapeHtml(item.category)}</dd></div><div><dt>Submitted</dt><dd>${escapeHtml(formatDate(item.created_at, true))}</dd></div><div><dt>Model score</dt><dd>${Math.round(item.confidence * 100)}%</dd></div><div><dt>Feedback ID</dt><dd>#${item.id}</dd></div></dl><p class="detail-caveat">Automated classification from a small demonstration dataset. Scores are not calibrated probabilities. Review the original text before making decisions.</p>`;
  refreshIcons();
  $('#detail-dialog').showModal();
}

async function loadDemo() {
  $('#load-demo').disabled = true;
  try {
    const result = await api('/api/demo', { method: 'POST' });
    resetFilters();
    await loadData();
    toast(`${result.inserted} sample responses loaded.`);
  } catch (error) { toast(error.message, true); }
  finally { $('#load-demo').disabled = false; }
}

async function exportCsv() {
  $('#export-button').disabled = true;
  try {
    const response = await fetch(`/api/export?${queryString()}`);
    if (!response.ok) throw new Error('Export failed. Please try again.');
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = 'campus-feedback.csv';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Feedback exported.');
  } catch (error) { toast(error.message, true); }
  finally { $('#export-button').disabled = false; }
}

async function submitFeedback(event) {
  event.preventDefault();
  if ($('#submit-button').disabled) return;
  $('#form-error').hidden = true;
  const data = Object.fromEntries(new FormData(event.currentTarget));
  if (data.text.trim().length < 10) {
    $('#form-error').textContent = 'Please write at least 10 non-space characters.';
    $('#form-error').hidden = false;
    $('#feedback-text').focus();
    return;
  }
  $('#submit-button').disabled = true;
  $('#submit-button').innerHTML = `${icon('loader-circle')}Submitting...`;
  refreshIcons();
  $('#submit-button svg')?.classList.add('spinning');
  try {
    const result = await api('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    $('#feedback-form').hidden = true;
    $('#submission-success').hidden = false;
    $('#submission-result').innerHTML = badge(result.sentiment);
    $('#submission-success').focus();
    refreshIcons();
    $('#nav-count').textContent = formatNumber(Number($('#nav-count').textContent.replace(/\D/g, '')) + 1);
  } catch (error) {
    $('#form-error').textContent = error.message;
    $('#form-error').hidden = false;
  } finally {
    $('#submit-button').disabled = false;
    $('#submit-button').innerHTML = `Submit feedback${icon('arrow-right')}`;
    refreshIcons();
  }
}

function setupEvents() {
  window.addEventListener('hashchange', route);
  for (const key of ['category', 'department', 'days']) {
    $(`#${key}-filter`).addEventListener('change', event => { state[key] = event.target.value; state.page = 1; loadData(); });
  }
  $('#search-input').addEventListener('input', event => {
    state.search = event.target.value.trim();
    state.page = 1;
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(loadData, 250);
  });
  $$('[data-sentiment]').forEach(button => button.addEventListener('click', () => {
    state.sentiment = button.dataset.sentiment;
    state.page = 1;
    syncFilters();
    loadData();
  }));
  $('#clear-filters').addEventListener('click', () => { resetFilters(); loadData(); });
  $('#refresh-button').addEventListener('click', loadData);
  $('#retry-button').addEventListener('click', () => state.config ? loadData() : loadConfiguration());
  $('#previous-page').addEventListener('click', () => { if (state.page > 1) { state.page--; loadData(); } });
  $('#next-page').addEventListener('click', () => { if (state.page * state.pageSize < state.total) { state.page++; loadData(); } });
  $('#feedback-body').addEventListener('click', event => { const button = event.target.closest('[data-id]'); if (button) showDetails(button.dataset.id); });
  $('#concerns-list').addEventListener('click', event => {
    const button = event.target.closest('.review-concern');
    if (!button) return;
    state.category = button.dataset.category;
    state.sentiment = 'negative';
    state.page = 1;
    syncFilters();
    if (location.hash === '#feedback') loadData();
    else location.hash = 'feedback';
  });
  $('#load-demo').addEventListener('click', loadDemo);
  $('#remove-demo').addEventListener('click', () => $('#confirm-dialog').showModal());
  $('#cancel-remove').addEventListener('click', () => $('#confirm-dialog').close());
  $('#confirm-remove').addEventListener('click', async () => {
    $('#confirm-remove').disabled = true;
    try {
      await api('/api/demo', { method: 'DELETE' });
      $('#confirm-dialog').close();
      state.page = 1;
      await loadData();
      toast('Sample feedback removed. Real submissions kept.');
    } catch (error) { toast(error.message, true); }
    finally { $('#confirm-remove').disabled = false; }
  });
  $('#export-button').addEventListener('click', exportCsv);
  $('#feedback-form').addEventListener('submit', submitFeedback);
  $('#feedback-text').addEventListener('input', event => { $('#character-count').textContent = `${formatNumber(event.target.value.length)} / 2,000`; });
  $('#submit-another').addEventListener('click', () => {
    $('#feedback-form').reset();
    $('#character-count').textContent = '0 / 2,000';
    $('#form-error').hidden = true;
    $('#submission-success').hidden = true;
    $('#feedback-form').hidden = false;
    $('#feedback-text').focus();
  });
  $('#model-button').addEventListener('click', () => {
    if (!state.config) return toast('Model details are unavailable. Try refreshing.', true);
    const model = state.config.model;
    $('#model-content').innerHTML = `<p class="model-algorithm">${escapeHtml(model.name)}</p><dl class="detail-facts"><div><dt>Training examples</dt><dd>${model.training_samples}</dd></div><div><dt>Held-out accuracy</dt><dd>${Math.round(model.holdout_accuracy * 100)}% on ${model.test_samples} examples</dd></div><div><dt>Classes</dt><dd>Positive, negative, neutral</dd></div><div><dt>Language</dt><dd>English</dd></div></dl><p class="model-explanation">${escapeHtml(model.dataset)}. Accuracy is measured on a fixed 20% holdout before refitting on all examples; it is not evidence of real-world performance. New submissions are stored, not used to retrain the model.</p><p class="model-notice">${escapeHtml(model.notice)} Train and evaluate with a larger, representative, labeled dataset before real use.</p>`;
    $('#model-dialog').showModal();
  });
  $$('.dialog-close').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
  $$('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } }));
  $('#menu-button').addEventListener('click', () => {
    const open = $('#sidebar').classList.toggle('open');
    $('#sidebar-scrim').hidden = !open;
    $('#menu-button').setAttribute('aria-expanded', String(open));
  });
  $('#sidebar-scrim').addEventListener('click', closeMenu);
  window.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
}

async function initialize() {
  refreshIcons();
  setupEvents();
  route();
  await loadConfiguration();
}

async function loadConfiguration() {
  try {
    const config = await api('/api/config');
    for (const [select, values] of [[$('#department-filter'), config.departments], [$('#category-filter'), config.categories], [$('#student-department'), config.departments]]) {
      for (const value of values) select.add(new Option(value, value));
    }
    $('#category-options').innerHTML = config.categories.map((category, index) => `<label class="category-option"><input type="radio" name="category" value="${escapeHtml(category)}" ${index === 0 ? 'checked' : ''} required><span>${icon(icons[category])}${escapeHtml(category)}</span></label>`).join('');
    initializeCharts();
    state.config = config;
    $('#submit-button').disabled = false;
    $('#load-error').hidden = true;
    refreshIcons();
    if (state.view !== 'submit') await loadData();
  } catch (error) {
    $('#load-error-text').textContent = `Couldn't initialize the workspace. ${error.message}`;
    $('#load-error').hidden = false;
    $('#submit-button').disabled = true;
    toast('Could not connect to the server. Refresh the page to retry.', true);
  }
}

initialize();
