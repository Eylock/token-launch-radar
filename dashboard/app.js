// Token Radar dashboard — sortable, filterable board with a detail view.
// Reads window.TOKEN_RADAR from ../data.js, written by main.ts from the same
// board.json. No network: every byte the page needs is local.
(function () {
  'use strict';
  var D = window.TOKEN_RADAR;
  if (!D) return;

  var params = new URLSearchParams(window.location.search);
  var state = {
    q: params.get('q') || '',
    cat: params.get('cat') || '',
    wl: params.get('wl') === '1',
    sort: params.get('sort') || 'implied',
    slug: params.get('slug') || '',
  };

  var $ = function (id) { return document.getElementById(id); };
  var rowsEl = $('rows');
  var detailEl = $('detail');

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtUsd(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n;
  }
  function fmtPct(x) {
    if (x === null || x === undefined) return '—';
    var sign = x > 0 ? '+' : '';
    return sign + x.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return '—';
    if (days < 365) return days + 'd';
    return (days / 365).toFixed(1) + 'y';
  }
  function pctClass(x) {
    if (x === null || x === undefined || x === 0) return '';
    return x > 0 ? 'up' : 'down';
  }

  // ---- header stats -------------------------------------------------------
  var stats = $('stats');
  stats.innerHTML =
    '<dt>Protocols ranked</dt><dd>' + D.rows_total + '</dd>' +
    '<dt>Watchlist covered</dt><dd>' + D.watchlist_size + ' / ' + D.watchlist_size + '</dd>' +
    '<dt>Snapshot</dt><dd>' + esc(D.as_of) + '</dd>' +
    '<dt>Model</dt><dd>' + esc(D.model) + '</dd>';

  // ---- category filter ----------------------------------------------------
  var catSel = $('cat');
  var cats = {};
  D.rows.forEach(function (r) { cats[r.category || 'Uncategorised'] = true; });
  Object.keys(cats).sort().forEach(function (c) {
    var opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    catSel.appendChild(opt);
  });

  // ---- filtering and sorting ----------------------------------------------
  function filtered() {
    var q = state.q.trim().toLowerCase();
    var list = D.rows.filter(function (r) {
      if (state.wl && !r.watchlist) return false;
      if (state.cat && (r.category || 'Uncategorised') !== state.cat) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0 &&
          (r.category || '').toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort;
    var by = {
      implied: function (a, b) { return b.implied_value_usd - a.implied_value_usd; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      growth: function (a, b) { return (b.change_7d === null ? -Infinity : b.change_7d) - (a.change_7d === null ? -Infinity : a.change_7d); },
      age: function (a, b) { return (b.age_days === null ? -1 : b.age_days) - (a.age_days === null ? -1 : a.age_days); },
      name: function (a, b) { return a.name < b.name ? -1 : 1; },
      rank: function (a, b) { return a.rank - b.rank; },
      category: function (a, b) { return (a.category || '') < (b.category || '') ? -1 : 1; },
      chains: function (a, b) { return b.chain_count - a.chain_count; },
    }[key] || by.implied;
    return list.slice().sort(by);
  }

  // ---- table ---------------------------------------------------------------
  function renderTable() {
    var list = filtered();
    $('count').textContent = list.length + ' of ' + D.rows_total + ' protocols';
    $('empty').hidden = list.length > 0;
    var html = '';
    list.forEach(function (r) {
      html += '<tr data-slug="' + esc(r.slug) + '"' + (r.slug === state.slug ? ' class="selected"' : '') + '>' +
        '<td class="rank">' + r.rank + '</td>' +
        '<td><strong>' + esc(r.name) + '</strong>' +
        (r.watchlist ? '<span class="wl">Watchlist</span>' : '') + '</td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + pctClass(r.change_7d) + '">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td class="num">' + r.chain_count + '</td>' +
        '<td class="num value">' + fmtUsd(r.implied_value_usd) + '</td>' +
        '</tr>';
    });
    rowsEl.innerHTML = html;
  }

  // ---- detail view ----------------------------------------------------------
  function findRow(slug) {
    for (var i = 0; i < D.rows.length; i++) if (D.rows[i].slug === slug) return D.rows[i];
    return null;
  }
  function renderDetail() {
    var r = state.slug ? findRow(state.slug) : null;
    if (!r) { detailEl.hidden = true; detailEl.innerHTML = ''; return; }
    var f = r.factors;
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    detailEl.innerHTML =
      '<button class="close" id="closeDetail">Close ×</button>' +
      '<h2>' + esc(r.name) + (r.watchlist ? '<span class="wl">Watchlist</span>' : '') + '</h2>' +
      '<p class="sub">Rank #' + r.rank + ' of ' + D.rows_total + ' · ' + esc(r.category || 'Uncategorised') +
      ' · main chain ' + esc(r.main_chain) + ' · snapshot ' + esc(D.as_of) + '</p>' +
      '<dl class="facts">' +
      '<div><dt>Implied value</dt><dd>' + fmtUsd(r.implied_value_usd) + '</dd></div>' +
      '<div><dt>TVL</dt><dd>' + fmtUsd(r.tvl_usd) + '</dd></div>' +
      '<div><dt>7-day change</dt><dd class="' + pctClass(r.change_7d) + '">' + fmtPct(r.change_7d) + '</dd></div>' +
      '<div><dt>Age with no token</dt><dd>' + fmtAge(r.age_days) + '</dd></div>' +
      '<div><dt>Category multiple</dt><dd>×' + f.category_multiple.toFixed(4) + '</dd></div>' +
      '<div><dt>Growth factor</dt><dd>×' + f.growth.toFixed(2) + '</dd></div>' +
      '<div><dt>Maturity factor</dt><dd>×' + f.maturity.toFixed(2) + '</dd></div>' +
      '<div><dt>Breadth factor</dt><dd>×' + f.breadth.toFixed(2) + ' (' + r.chain_count + ' chains)</dd></div>' +
      '</dl>' +
      '<h3>How to farm it — 7 steps</h3>' +
      '<ol class="steps">' + steps + '</ol>' +
      '<p class="caveat">Implied value is this entry\u2019s own claim from the snapshot\u2019s ' +
      'figures (TVL × category multiple × growth × maturity × breadth). It is not a ' +
      'launch prediction, and this protocol may never issue a token.</p>';
    detailEl.hidden = false;
    $('closeDetail').addEventListener('click', function () {
      state.slug = '';
      syncUrl();
      renderDetail();
      renderTable();
    });
  }

  // ---- methodology ----------------------------------------------------------
  $('rankableCount').textContent = D.rows_total;
  $('overallMedian').textContent = D.overall_median.toFixed(4);
  $('btCal').textContent = D.backtest.calibrated_median.toFixed(3);
  $('btFlat').textContent = D.backtest.flat_median.toFixed(3);
  $('btFull').textContent = D.backtest.full_median.toFixed(3);
  var calibRows = Object.keys(D.category_medians).sort(function (a, b) {
    return D.category_medians[b] - D.category_medians[a];
  }).map(function (c) {
    return '<tr><td>' + esc(c) + '</td><td class="num">' + D.category_counts[c] +
      '</td><td class="num">×' + D.category_medians[c].toFixed(4) + '</td></tr>';
  }).join('');
  calibRows += '<tr><td>All other categories (fewer than 5 comparables)</td><td class="num">—</td>' +
    '<td class="num">×' + D.overall_median.toFixed(4) + ' (overall median)</td></tr>';
  document.querySelector('#calib tbody').innerHTML = calibRows;

  // ---- controls ---------------------------------------------------------------
  function syncUrl() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.cat) p.set('cat', state.cat);
    if (state.wl) p.set('wl', '1');
    if (state.sort !== 'implied') p.set('sort', state.sort);
    if (state.slug) p.set('slug', state.slug);
    var qs = p.toString();
    var url = window.location.pathname + (qs ? '?' + qs : '');
    window.history.replaceState(null, '', url);
  }

  var qEl = $('q');
  qEl.value = state.q;
  qEl.addEventListener('input', function () { state.q = qEl.value; syncUrl(); renderTable(); });
  catSel.value = state.cat;
  catSel.addEventListener('change', function () { state.cat = catSel.value; syncUrl(); renderTable(); });
  var wlEl = $('wl');
  wlEl.checked = state.wl;
  wlEl.addEventListener('change', function () { state.wl = wlEl.checked; syncUrl(); renderTable(); });
  var sortEl = $('sort');
  sortEl.value = state.sort;
  sortEl.addEventListener('change', function () { state.sort = sortEl.value; syncUrl(); renderTable(); });

  document.querySelectorAll('#board thead th').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      state.sort = key;
      sortEl.value = ['implied', 'tvl', 'growth', 'age', 'name'].indexOf(key) >= 0 ? key : 'implied';
      syncUrl();
      renderTable();
    });
  });

  rowsEl.addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr');
    if (!tr) return;
    state.slug = tr.getAttribute('data-slug');
    syncUrl();
    renderDetail();
    renderTable();
    detailEl.scrollIntoView({ block: 'nearest' });
  });

  renderTable();
  renderDetail();
})();
