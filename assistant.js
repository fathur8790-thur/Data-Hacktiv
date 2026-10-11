/**
 * ============================================================
 * Data Workbench – assistant.js
 * AI Data Assistant: Rule-based intent parser + optional Gemini API
 * ============================================================
 *
 * Module structure:
 *  1. ASSISTANT STATE  – chat history, settings, mode
 *  2. UI CONTROLLER    – open/close panel, render bubbles, typing indicator
 *  3. MESSAGE ROUTER   – dispatch user input to intent or Gemini
 *  4. INTENT PARSER    – keyword/regex rule engine (offline mode)
 *  5. INTENT HANDLERS  – one function per intent (reads STATE from script.js)
 *  6. ACTION HANDLERS  – commands that mutate app state (clean, filter, etc.)
 *  7. GEMINI API       – summarise context + call API + parse response
 *  8. QUICK REPLIES    – suggestion chips after each answer
 *  9. SETTINGS PANEL   – API key input, mode toggle
 * 10. INIT             – bootstrap
 * ============================================================
 */

'use strict';

/* ============================================================
   1. ASSISTANT STATE
============================================================ */
const ASST = {
  history:    [],        // [{ role:'user'|'assistant', text, ts }]
  aiMode:     false,     // true = Gemini API, false = rule-based
  apiKey:     '',        // Gemini API key (never hardcoded)
  typing:     false,
  STORAGE_KEY:'dw_asstHistory',
  APIKEY_KEY: 'dw_asstApiKey',
  AIMODE_KEY: 'dw_asstAiMode'
};

/* ============================================================
   2. UI CONTROLLER
============================================================ */

/** toggleAssistant – Open / close the chat panel. */
function toggleAssistant() {
  const panel = document.getElementById('asstPanel');
  const fab   = document.getElementById('asstFab');
  const isOpen = !panel.classList.contains('asst-hidden');

  if (isOpen) {
    panel.classList.add('asst-hidden');
    fab.setAttribute('aria-expanded', 'false');
    fab.querySelector('.asst-fab-icon').textContent = '💬';
  } else {
    panel.classList.remove('asst-hidden');
    fab.setAttribute('aria-expanded', 'true');
    fab.querySelector('.asst-fab-icon').textContent = '✕';
    // Focus input
    setTimeout(() => document.getElementById('asstInput')?.focus(), 60);
    // Render welcome if empty
    if (ASST.history.length === 0) renderWelcome();
  }
}

/** renderWelcome – Show starter chips on first open. */
function renderWelcome() {
  const suggestions = [
    'Berapa total revenue?',
    'Region mana yang paling tinggi?',
    'Produk terlaris apa?',
    'Bagaimana kualitas data?',
    'Tampilkan top 5 sales rep'
  ];

  const html =
    `<div class="asst-welcome">
       <div class="asst-avatar">🤖</div>
       <p class="asst-welcome-title">Halo! Saya <strong>Data Assistant</strong></p>
       <p class="asst-welcome-sub">Tanya apa saja tentang data aktif, atau gunakan perintah untuk memanipulasi data.</p>
       <div class="asst-chips-row" role="list">
         ${suggestions.map(s =>
           `<button class="asst-chip" onclick="sendMessage('${s.replace(/'/g,"\\'")}', true)" role="listitem">${s}</button>`
         ).join('')}
       </div>
     </div>`;

  appendBubble('assistant', html, false);
}

/**
 * appendBubble – Append a chat message bubble to the messages container.
 * @param {'user'|'assistant'} role
 * @param {string}             content  – plain text or HTML (trusted)
 * @param {boolean}            isText   – if true, escape content as plain text
 */
function appendBubble(role, content, isText = true) {
  const container = document.getElementById('asstMessages');
  if (!container) return;

  const wrap = document.createElement('div');
  wrap.className = `asst-bubble-wrap asst-${role}`;

  const ts = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  const body = isText ? escAsstHtml(content) : content;

  wrap.innerHTML =
    `<div class="asst-bubble asst-bubble-${role}" role="${role === 'assistant' ? 'status' : 'none'}">
       <div class="asst-bubble-body">${body}</div>
       <div class="asst-bubble-time">${ts}</div>
     </div>`;

  container.appendChild(wrap);
  container.scrollTop = container.scrollHeight;
  return wrap;
}

/** showTyping – Show animated "..." typing indicator. */
function showTyping() {
  if (ASST.typing) return;
  ASST.typing = true;
  const container = document.getElementById('asstMessages');
  const el = document.createElement('div');
  el.id = 'asstTyping';
  el.className = 'asst-bubble-wrap asst-assistant';
  el.innerHTML =
    `<div class="asst-bubble asst-bubble-assistant asst-typing-bubble" aria-label="Sedang mengetik">
       <span class="asst-dot"></span><span class="asst-dot"></span><span class="asst-dot"></span>
     </div>`;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

/** hideTyping – Remove the typing indicator. */
function hideTyping() {
  ASST.typing = false;
  document.getElementById('asstTyping')?.remove();
}

/** appendQuickReplies – Render quick reply chips after an assistant response. */
function appendQuickReplies(chips) {
  if (!chips || chips.length === 0) return;
  const container = document.getElementById('asstMessages');
  const row = document.createElement('div');
  row.className = 'asst-chips-row asst-chips-reply';
  row.innerHTML = chips.map(c =>
    `<button class="asst-chip asst-chip-sm" onclick="sendMessage('${escAsstAttr(c)}', true)">${escAsstHtml(c)}</button>`
  ).join('');
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
}

/** clearHistory – Wipe all chat messages and localStorage history. */
function clearAsstHistory() {
  ASST.history = [];
  localStorage.removeItem(ASST.STORAGE_KEY);
  const container = document.getElementById('asstMessages');
  if (container) container.innerHTML = '';
  renderWelcome();
  showToast('Riwayat chat dihapus', 'info');
}

/* ============================================================
   3. MESSAGE ROUTER
============================================================ */

/**
 * sendMessage – Main entry point for user input.
 * @param {string}  text         – message text
 * @param {boolean} fromChip     – came from a chip button (skip input field)
 */
async function sendMessage(text, fromChip = false) {
  const input = document.getElementById('asstInput');

  if (!fromChip && input) {
    text = input.value.trim();
    input.value = '';
  }
  if (!text) return;

  // Record + render user bubble
  ASST.history.push({ role: 'user', text, ts: Date.now() });
  appendBubble('user', text, true);

  // Remove leftover quick-reply chips
  document.querySelectorAll('.asst-chips-reply').forEach(el => el.remove());

  showTyping();

  // Artificial delay for UX realism
  await sleep(400 + Math.random() * 300);

  let response;

  if (ASST.aiMode && ASST.apiKey) {
    response = await callGemini(text);
  } else {
    response = parseIntent(text);
  }

  hideTyping();

  ASST.history.push({ role: 'assistant', text: response.text, ts: Date.now() });
  appendBubble('assistant', response.html || escAsstHtml(response.text), false);

  if (response.chips && response.chips.length) appendQuickReplies(response.chips);

  saveAsstHistory();
}

/** handleAsstKeydown – Submit on Enter (not Shift+Enter). */
function handleAsstKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage('', false);
  }
}

/* ============================================================
   4. INTENT PARSER  (rule-based, offline)
============================================================ */

/**
 * parseIntent – Match input text against ordered intent rules.
 * Returns a response object: { text, html, chips }
 */
function parseIntent(raw) {
  const t = raw.toLowerCase().trim();

  /* ---------- ACTION intents (mutate app) ---------- */
  if (/bersih(kan)?\s+data|clean\s+data/.test(t))
    return intentCleanData();

  if (/reset\s+(data|ke\s+awal)|kembalikan\s+data/.test(t))
    return intentResetData();

  if (/filter\s+region\s+(.+)/.test(t)) {
    const m = t.match(/filter\s+region\s+(.+)/);
    return intentFilterRegion(m[1].trim());
  }

  if (/filter\s+kategori\s+(.+)/.test(t)) {
    const m = t.match(/filter\s+kategori\s+(.+)/);
    return intentFilterKategori(m[1].trim());
  }

  if (/hapus\s+filter|clear\s+filter|reset\s+filter|semua\s+filter/.test(t))
    return intentClearFilters();

  if (/export\s+(ke\s+)?csv/.test(t))
    return intentExportCSV();

  if (/export\s+(ke\s+)?json/.test(t))
    return intentExportJSON();

  if (/tampilkan\s+grafik\s+tren|buka\s+grafik|scroll\s+grafik/.test(t))
    return intentShowCharts();

  if (/urutkan\s+(berdasarkan\s+)?revenue|sort\s+revenue|sortir\s+revenue/.test(t))
    return intentSortRevenue();

  if (/urutkan\s+(berdasarkan\s+)?harga|sort\s+harga/.test(t))
    return intentSortHarga();

  if (/urutkan\s+(berdasarkan\s+)?tanggal|sort\s+tanggal/.test(t))
    return intentSortTanggal();

  /* ---------- QUERY intents (read data) ---------- */
  if (/total\s+revenue|pendapatan\s+total|total\s+pendapatan/.test(t))
    return intentTotalRevenue();

  if (/total\s+transaksi|jumlah\s+transaksi|berapa\s+transaksi/.test(t))
    return intentTotalTransaksi();

  if (/total\s+(kuantitas|qty|quantity|jumlah\s+produk)/.test(t))
    return intentTotalQty();

  if (/rata.?rata\s+diskon|avg\s+diskon|diskon\s+rata/.test(t))
    return intentAvgDiskon();

  if (/rata.?rata\s+(nilai|order|transaksi)|avg\s+order/.test(t))
    return intentAvgOrder();

  if (/(region|kota)\s+.*(tertinggi|terbesar|terbanyak|paling\s+tinggi)|tertinggi.*region|best.*region/.test(t))
    return intentTopRegion();

  if (/(region|kota)\s+.*(terendah|terkecil|paling\s+rendah)|worst.*region/.test(t))
    return intentBottomRegion();

  if (/bandingkan\s+(revenue\s+)?(.+)\s+dan\s+(.+)|compare\s+(.+)\s+(and|dan)\s+(.+)/.test(t))
    return intentCompareRegions(t);

  if (/produk\s+(ter)?laris|terlaris|best.?seller|produk\s+terbaik|produk\s+tertinggi/.test(t))
    return intentTopProduct();

  if (/top\s+(\d+)\s+(produk|product)/.test(t)) {
    const m = t.match(/top\s+(\d+)\s+(produk|product)/);
    return intentTopNProducts(parseInt(m[1]));
  }

  if (/kategori\s+(tertinggi|terbaik|terlaris)|terlaris.*kategori/.test(t))
    return intentTopKategori();

  if (/(penjualan|revenue)\s+per\s+(bulan|month)|tren\s+penjualan|trend\s+penjualan/.test(t))
    return intentMonthlyTrend();

  if (/(penjualan|revenue)\s+per\s+region|perbandingan\s+region/.test(t))
    return intentRevenueByRegion();

  if (/sales\s+rep\s+(terbaik|tertinggi|terlaris)|top\s+sales/.test(t))
    return intentTopSalesRep();

  if (/top\s+(\d+)\s+sales/.test(t)) {
    const m = t.match(/top\s+(\d+)\s+sales/);
    return intentTopNSalesRep(parseInt(m[1]));
  }

  if (/metode\s+pembayaran\s+(terpopuler|terbanyak)|metode\s+terbanyak|cara\s+bayar/.test(t))
    return intentTopMetode();

  if (/kualitas\s+data|data\s+quality|kualitas\s+berapa|score.*data/.test(t))
    return intentDataQuality();

  if (/duplikat|duplicate/.test(t))
    return intentDuplicates();

  if (/(nilai\s+)?kosong|missing\s+value/.test(t))
    return intentMissingValues();

  if (/outlier/.test(t))
    return intentOutliers();

  if (/berapa\s+baris|jumlah\s+baris|total\s+baris|berapa\s+data/.test(t))
    return intentRowCount();

  if (/diskon\s+(tertinggi|terbesar)|max\s+diskon/.test(t))
    return intentMaxDiskon();

  if (/harga\s+(tertinggi|termahal)|produk\s+termahal/.test(t))
    return intentMostExpensive();

  if (/harga\s+(terendah|termurah)|produk\s+termurah/.test(t))
    return intentCheapest();

  if (/ringkasan|summary|ikhtisar|overview/.test(t))
    return intentSummary();

  if (/halo|hai|hi|hello|selamat/.test(t))
    return intentGreeting();

  if (/terima\s+kasih|thanks|makasih/.test(t))
    return intentThanks();

  if (/bantuan|help|apa\s+(yang\s+bisa|saja)|fitur\s+apa/.test(t))
    return intentHelp();

  // Not recognized
  return intentUnknown(raw);
}

/* ============================================================
   5. INTENT HANDLERS  (read-only, query STATE)
============================================================ */

/* --- Helper: compute revenue for a row --- */
function rowRevenue(r) {
  const q = Number(r.jumlah) || 0;
  const h = Number(r.harga)  || 0;
  const d = Math.min(1, Math.max(0, Number(r.diskon) || 0));
  return q * h * (1 - d);
}

/* --- Helper: aggregate revenue by a field --- */
function aggRevByField(data, field) {
  const map = {};
  data.forEach(r => {
    const k = toTitleCase((r[field] || 'Unknown').toString().trim());
    map[k] = (map[k] || 0) + rowRevenue(r);
  });
  return Object.entries(map).sort((a,b) => b[1] - a[1]);
}

/* --- Helper: format Rp --- */
function fmtRp(n) {
  return 'Rp ' + Math.round(n).toLocaleString('id-ID');
}

/* --- Helper: build ordered list HTML --- */
function buildList(items, labelFn, valueFn) {
  return `<ol class="asst-list">${items.map((item, i) =>
    `<li><span class="asst-rank">${i+1}</span> ${escAsstHtml(labelFn(item))} — <strong>${escAsstHtml(valueFn(item))}</strong></li>`
  ).join('')}</ol>`;
}

/* --- Basic stat intents --- */

function intentTotalRevenue() {
  const data = STATE.filtered;
  const rev = data.reduce((s, r) => s + rowRevenue(r), 0);
  const n   = data.length;
  return {
    text: `Total Revenue: ${fmtRp(rev)} dari ${n} transaksi`,
    html: `<p>💰 <strong>Total Revenue</strong></p><p class="asst-highlight">${fmtRp(rev)}</p><p class="asst-muted">dari ${n.toLocaleString('id-ID')} transaksi yang ditampilkan</p>`,
    chips: ['Revenue per region?', 'Produk terlaris apa?', 'Rata-rata diskon?']
  };
}

function intentTotalTransaksi() {
  const n = STATE.filtered.length;
  return {
    text: `Total transaksi: ${n}`,
    html: `<p>📋 <strong>Total Transaksi</strong></p><p class="asst-highlight">${n.toLocaleString('id-ID')}</p>`,
    chips: ['Total revenue?', 'Total quantity?']
  };
}

function intentTotalQty() {
  const qty = STATE.filtered.reduce((s, r) => s + (Number(r.jumlah) || 0), 0);
  return {
    text: `Total quantity: ${qty.toLocaleString('id-ID')}`,
    html: `<p>📦 <strong>Total Quantity</strong></p><p class="asst-highlight">${qty.toLocaleString('id-ID')} unit</p>`,
    chips: ['Produk terlaris?', 'Total revenue?']
  };
}

function intentAvgDiskon() {
  const data = STATE.filtered;
  if (!data.length) return noDataResponse();
  const avg = data.reduce((s,r) => s + (Number(r.diskon)||0), 0) / data.length;
  return {
    text: `Rata-rata diskon: ${(avg*100).toFixed(1)}%`,
    html: `<p>🏷️ <strong>Rata-rata Diskon</strong></p><p class="asst-highlight">${(avg*100).toFixed(1)}%</p>`,
    chips: ['Diskon tertinggi?', 'Revenue per kategori?']
  };
}

function intentAvgOrder() {
  const data = STATE.filtered;
  if (!data.length) return noDataResponse();
  const rev  = data.reduce((s,r) => s + rowRevenue(r), 0);
  const avg  = rev / data.length;
  return {
    text: `Rata-rata nilai transaksi: ${fmtRp(avg)}`,
    html: `<p>📊 <strong>Rata-rata Nilai Transaksi</strong></p><p class="asst-highlight">${fmtRp(avg)}</p>`,
    chips: ['Total revenue?', 'Produk terlaris?']
  };
}

function intentTopRegion() {
  const data = STATE.filtered;
  if (!data.length) return noDataResponse();
  const agg = aggRevByField(data, 'region');
  if (!agg.length) return noDataResponse();
  const [name, rev] = agg[0];
  const pct = ((rev / data.reduce((s,r)=>s+rowRevenue(r),0))*100).toFixed(1);
  const list = buildList(agg.slice(0,5), x=>x[0], x=>fmtRp(x[1]));
  return {
    text: `Region dengan revenue tertinggi: ${name} (${fmtRp(rev)})`,
    html: `<p>🏆 <strong>Revenue per Region</strong></p>${list}<p class="asst-muted">Top region: <strong>${escAsstHtml(name)}</strong> (${pct}% dari total)</p>`,
    chips: [`Filter region ${name}?`, 'Bandingkan revenue Jakarta dan Bandung', 'Kategori terlaris?']
  };
}

function intentBottomRegion() {
  const data = STATE.filtered;
  if (!data.length) return noDataResponse();
  const agg = aggRevByField(data, 'region');
  if (!agg.length) return noDataResponse();
  const [name, rev] = agg[agg.length - 1];
  return {
    text: `Region dengan revenue terendah: ${name} (${fmtRp(rev)})`,
    html: `<p>📉 <strong>Region Terendah</strong></p><p><strong>${escAsstHtml(name)}</strong> — ${fmtRp(rev)}</p>`,
    chips: ['Region tertinggi?', 'Produk terlaris?']
  };
}

function intentCompareRegions(t) {
  const data = STATE.filtered;
  if (!data.length) return noDataResponse();
  // Extract two region names from text
  const m1 = t.match(/bandingkan\s+(?:revenue\s+)?(.+?)\s+dan\s+(.+)/i);
  const m2 = t.match(/compare\s+(.+?)\s+(?:and|dan)\s+(.+)/i);
  const m = m1 || m2;
  if (!m) return { text: 'Sebutkan dua region yang ingin dibandingkan, misal: "Bandingkan Jakarta dan Bandung"', chips: ['Bandingkan Jakarta dan Bandung', 'Revenue per region?'] };

  const r1 = m[1].trim().toLowerCase();
  const r2 = m[2].trim().toLowerCase();
  const revMap = {};
  data.forEach(row => {
    const k = (row.region||'').trim().toLowerCase();
    revMap[k] = (revMap[k] || 0) + rowRevenue(row);
  });
  const v1 = revMap[r1] || 0;
  const v2 = revMap[r2] || 0;
  const winner = v1 >= v2 ? toTitleCase(r1) : toTitleCase(r2);
  const diff   = Math.abs(v1 - v2);
  return {
    text: `${toTitleCase(r1)}: ${fmtRp(v1)} vs ${toTitleCase(r2)}: ${fmtRp(v2)}`,
    html: `<p>⚖️ <strong>Perbandingan Region</strong></p>
           <table class="asst-table"><tr><th>Region</th><th>Revenue</th></tr>
           <tr><td>${escAsstHtml(toTitleCase(r1))}</td><td>${fmtRp(v1)}</td></tr>
           <tr><td>${escAsstHtml(toTitleCase(r2))}</td><td>${fmtRp(v2)}</td></tr>
           </table>
           <p class="asst-muted">🏆 <strong>${escAsstHtml(winner)}</strong> unggul selisih ${fmtRp(diff)}</p>`,
    chips: ['Region mana yang paling tinggi?', 'Produk terlaris?']
  };
}

function intentTopProduct() {
  const data = STATE.filtered;
  if (!data.length) return noDataResponse();
  const agg = aggRevByField(data, 'produk');
  const [name, rev] = agg[0];
  const list = buildList(agg.slice(0,5), x=>x[0], x=>fmtRp(x[1]));
  return {
    text: `Produk terlaris: ${name} (${fmtRp(rev)})`,
    html: `<p>🥇 <strong>Top 5 Produk by Revenue</strong></p>${list}`,
    chips: ['Top 10 produk?', 'Kategori terlaris?', 'Produk termahal?']
  };
}

function intentTopNProducts(n) {
  const data = STATE.filtered;
  if (!data.length) return noDataResponse();
  const agg  = aggRevByField(data, 'produk').slice(0, n);
  const list = buildList(agg, x=>x[0], x=>fmtRp(x[1]));
  return {
    text: `Top ${n} produk by revenue`,
    html: `<p>📦 <strong>Top ${n} Produk by Revenue</strong></p>${list}`,
    chips: ['Kategori terlaris?', 'Sales rep terbaik?']
  };
}

function intentTopKategori() {
  const data = STATE.filtered;
  if (!data.length) return noDataResponse();
  const agg  = aggRevByField(data, 'kategori');
  const list = buildList(agg, x=>x[0], x=>fmtRp(x[1]));
  return {
    text: `Kategori terlaris: ${agg[0][0]} (${fmtRp(agg[0][1])})`,
    html: `<p>🗂️ <strong>Revenue per Kategori</strong></p>${list}`,
    chips: ['Produk terlaris?', 'Revenue per region?']
  };
}

function intentMonthlyTrend() {
  const data = STATE.filtered;
  if (!data.length) return noDataResponse();
  const months = {};
  data.forEach(r => {
    if (!r.tanggal) return;
    const m = r.tanggal.slice(0, 7);
    months[m] = (months[m]||0) + rowRevenue(r);
  });
  const sorted = Object.keys(months).sort();
  const best   = sorted.reduce((bm, m) => months[m] > (months[bm]||0) ? m : bm, sorted[0]);
  const list   = sorted.map(m => `<li>${formatMonthShort(m)}: <strong>${fmtRp(months[m])}</strong></li>`).join('');
  return {
    text: `Tren bulanan tersedia. Bulan terbaik: ${formatMonthShort(best)}`,
    html: `<p>📈 <strong>Revenue per Bulan</strong></p><ul class="asst-list">${list}</ul>
           <p class="asst-muted">🏆 Bulan terbaik: <strong>${formatMonthShort(best)}</strong> (${fmtRp(months[best])})</p>`,
    chips: ['Region tertinggi?', 'Tampilkan grafik tren']
  };
}

function intentRevenueByRegion() {
  const data = STATE.filtered;
  if (!data.length) return noDataResponse();
  const agg  = aggRevByField(data, 'region');
  const list = buildList(agg, x=>x[0], x=>fmtRp(x[1]));
  return {
    text: `Revenue per region tersedia`,
    html: `<p>🗺️ <strong>Revenue per Region</strong></p>${list}`,
    chips: [`Filter region ${agg[0]?.[0]}?`, 'Bandingkan Jakarta dan Surabaya']
  };
}

function intentTopSalesRep() {
  const data = STATE.filtered;
  if (!data.length) return noDataResponse();
  const agg  = aggRevByField(data, 'sales_rep');
  const list = buildList(agg.slice(0,5), x=>x[0], x=>fmtRp(x[1]));
  return {
    text: `Sales rep terbaik: ${agg[0]?.[0]} (${fmtRp(agg[0]?.[1])})`,
    html: `<p>👤 <strong>Top 5 Sales Rep</strong></p>${list}`,
    chips: ['Top 10 sales rep?', 'Produk terlaris?']
  };
}

function intentTopNSalesRep(n) {
  const data = STATE.filtered;
  if (!data.length) return noDataResponse();
  const agg  = aggRevByField(data, 'sales_rep').slice(0, n);
  const list = buildList(agg, x=>x[0], x=>fmtRp(x[1]));
  return {
    text: `Top ${n} sales rep`,
    html: `<p>👤 <strong>Top ${n} Sales Rep</strong></p>${list}`,
    chips: ['Produk terlaris?', 'Revenue per region?']
  };
}

function intentTopMetode() {
  const data = STATE.filtered;
  if (!data.length) return noDataResponse();
  const agg  = aggRevByField(data, 'metode_pembayaran');
  const list = buildList(agg, x=>x[0], x=>fmtRp(x[1]));
  return {
    text: `Metode terpopuler: ${agg[0]?.[0]} (${fmtRp(agg[0]?.[1])})`,
    html: `<p>💳 <strong>Metode Pembayaran</strong></p>${list}`,
    chips: ['Total revenue?', 'Region terbaik?']
  };
}

function intentDataQuality() {
  const qr = STATE.qualityReport;
  if (!qr) {
    const raw = STATE.rawData;
    const dupeMap = {};
    raw.forEach(r => {
      const k = `${r.tanggal}|${r.produk}|${r.sales_rep}|${r.jumlah}`;
      dupeMap[k] = (dupeMap[k]||0)+1;
    });
    const dupes   = raw.filter((r,_,a) => {
      const k = `${r.tanggal}|${r.produk}|${r.sales_rep}|${r.jumlah}`;
      return dupeMap[k] > 1;
    }).length;
    const missing = raw.filter(r =>
      !r.produk || !r.tanggal || !r.sales_rep || r.jumlah == null || r.harga == null
    ).length;
    return {
      text: `Data belum dibersihkan. Estimasi: ${dupes} duplikat, ${missing} nilai kosong.`,
      html: `<p>⚠️ <strong>Status Kualitas Data</strong></p>
             <p>Data belum dibersihkan. Estimasi:</p>
             <ul class="asst-list"><li>~${dupes} baris duplikat</li><li>~${missing} nilai kosong/null</li></ul>
             <p class="asst-muted">Gunakan tombol "Bersihkan Data" atau ketik <em>bersihkan data</em> untuk otomatisasi.</p>`,
      chips: ['Bersihkan data', 'Berapa baris data?']
    };
  }
  return {
    text: `Skor kualitas: ${qr.score}%`,
    html: `<p>✅ <strong>Data Quality Report</strong></p>
           <table class="asst-table">
             <tr><td>Skor Kualitas</td><td><strong>${qr.score}%</strong></td></tr>
             <tr><td>Baris Awal</td><td>${qr.originalCount}</td></tr>
             <tr><td>Baris Setelah Clean</td><td>${qr.cleanCount}</td></tr>
             <tr><td>Duplikat Dihapus</td><td>${qr.duplicatesRemoved}</td></tr>
             <tr><td>Nilai Kosong Diperbaiki</td><td>${qr.missingFixed}</td></tr>
             <tr><td>Outlier Ditandai</td><td>${qr.outliersFlagged}</td></tr>
           </table>`,
    chips: ['Total revenue?', 'Berapa baris data?']
  };
}

function intentDuplicates() {
  const data = STATE.rawData;
  const map  = {};
  data.forEach(r => {
    const k = `${r.tanggal}|${r.produk}|${r.sales_rep}|${r.jumlah}`;
    map[k] = (map[k]||0)+1;
  });
  const dupes = Object.values(map).filter(v => v > 1).reduce((s,v) => s + v - 1, 0);
  return {
    text: `Estimasi ${dupes} baris duplikat di data mentah.`,
    html: `<p>🔁 <strong>Duplikat Data</strong></p><p>Terdapat estimasi <strong>${dupes} baris duplikat</strong> di data raw.</p>
           <p class="asst-muted">Jalankan pembersihan untuk menghapus otomatis.</p>`,
    chips: ['Bersihkan data', 'Kualitas data?']
  };
}

function intentMissingValues() {
  const data = STATE.rawData;
  const textF = ['produk','kategori','region','sales_rep','metode_pembayaran'];
  let count = 0;
  data.forEach(r => {
    textF.forEach(f => { if (!r[f] || r[f].toString().trim() === '') count++; });
    ['jumlah','harga','diskon'].forEach(f => { if (r[f] == null) count++; });
    if (!r.tanggal) count++;
  });
  return {
    text: `Terdapat ${count} nilai kosong/null di data raw.`,
    html: `<p>❌ <strong>Nilai Kosong</strong></p><p>Total <strong>${count} nilai kosong/null</strong> ditemukan di data mentah.</p>`,
    chips: ['Bersihkan data', 'Kualitas data?']
  };
}

function intentOutliers() {
  const data  = STATE.filtered;
  const vals  = data.map(r => Number(r.jumlah)).filter(v => !isNaN(v)).sort((a,b)=>a-b);
  const q1    = vals[Math.floor(vals.length*0.25)];
  const q3    = vals[Math.floor(vals.length*0.75)];
  const fence = q3 + 1.5*(q3-q1);
  const outs  = data.filter(r => Number(r.jumlah) > fence || Number(r.harga) < 0);
  return {
    text: `Terdapat ${outs.length} potensi outlier (jumlah > ${fence}).`,
    html: `<p>📊 <strong>Outlier</strong></p><p>Terdeteksi <strong>${outs.length} potensi outlier</strong> berdasarkan metode IQR pada kolom <em>jumlah</em>.</p>
           <p class="asst-muted">Batas atas: ${fence.toFixed(0)} unit</p>`,
    chips: ['Bersihkan data', 'Kualitas data?']
  };
}

function intentRowCount() {
  const total   = getActiveData().length;
  const filtered = STATE.filtered.length;
  const mode    = STATE.mode === 'clean' ? 'Clean' : 'Raw';
  return {
    text: `Jumlah baris: ${total} total (${filtered} tampil setelah filter)`,
    html: `<p>🔢 <strong>Jumlah Baris</strong></p>
           <table class="asst-table">
             <tr><td>Total data (${mode})</td><td><strong>${total}</strong></td></tr>
             <tr><td>Setelah filter</td><td><strong>${filtered}</strong></td></tr>
           </table>`,
    chips: ['Total revenue?', 'Kualitas data?']
  };
}

function intentMaxDiskon() {
  const data = STATE.filtered;
  if (!data.length) return noDataResponse();
  const max  = data.reduce((m, r) => Math.max(m, Number(r.diskon)||0), 0);
  const rows = data.filter(r => Number(r.diskon) === max);
  return {
    text: `Diskon tertinggi: ${(max*100).toFixed(0)}% (${rows.length} transaksi)`,
    html: `<p>🏷️ <strong>Diskon Tertinggi</strong></p><p><strong>${(max*100).toFixed(0)}%</strong> — ditemukan pada ${rows.length} transaksi</p>`,
    chips: ['Rata-rata diskon?', 'Revenue per kategori?']
  };
}

function intentMostExpensive() {
  const data = STATE.filtered;
  if (!data.length) return noDataResponse();
  const row  = data.reduce((m, r) => Number(r.harga) > Number(m.harga||0) ? r : m, data[0]);
  return {
    text: `Produk termahal: ${row.produk} (${fmtRp(row.harga)})`,
    html: `<p>💎 <strong>Produk Termahal</strong></p><p><strong>${escAsstHtml(row.produk)}</strong></p><p class="asst-highlight">${fmtRp(row.harga)}</p>`,
    chips: ['Produk terlaris?', 'Produk termurah?']
  };
}

function intentCheapest() {
  const data = STATE.filtered;
  if (!data.length) return noDataResponse();
  const positives = data.filter(r => Number(r.harga) > 0);
  if (!positives.length) return noDataResponse();
  const row = positives.reduce((m, r) => Number(r.harga) < Number(m.harga) ? r : m, positives[0]);
  return {
    text: `Produk termurah: ${row.produk} (${fmtRp(row.harga)})`,
    html: `<p>💸 <strong>Produk Termurah</strong></p><p><strong>${escAsstHtml(row.produk)}</strong></p><p class="asst-highlight">${fmtRp(row.harga)}</p>`,
    chips: ['Produk terlaris?', 'Produk termahal?']
  };
}

function intentSummary() {
  const data = STATE.filtered;
  const rev  = data.reduce((s,r) => s+rowRevenue(r), 0);
  const qty  = data.reduce((s,r) => s+(Number(r.jumlah)||0), 0);
  const topR = aggRevByField(data,'region')[0];
  const topP = aggRevByField(data,'produk')[0];
  const mode = STATE.mode === 'clean' ? 'Clean ✅' : 'Raw ⚠️';
  return {
    text: `Ringkasan: ${data.length} transaksi, Revenue ${fmtRp(rev)}, Mode: ${STATE.mode}`,
    html: `<p>📊 <strong>Ringkasan Data</strong></p>
           <table class="asst-table">
             <tr><td>Mode</td><td><strong>${mode}</strong></td></tr>
             <tr><td>Total Transaksi</td><td>${data.length.toLocaleString('id-ID')}</td></tr>
             <tr><td>Total Revenue</td><td><strong>${fmtRp(rev)}</strong></td></tr>
             <tr><td>Total Quantity</td><td>${qty.toLocaleString('id-ID')} unit</td></tr>
             <tr><td>Top Region</td><td>${topR ? escAsstHtml(topR[0]) : '—'}</td></tr>
             <tr><td>Top Produk</td><td>${topP ? escAsstHtml(topP[0]) : '—'}</td></tr>
           </table>`,
    chips: ['Tren penjualan per bulan?', 'Kualitas data?', 'Region tertinggi?']
  };
}

function intentGreeting() {
  const mode = STATE.mode === 'clean' ? 'Clean' : 'Raw';
  return {
    text: 'Halo! Ada yang bisa saya bantu?',
    html: `<p>👋 Halo! Saya <strong>Data Assistant</strong>.</p><p>Data aktif saat ini: mode <strong>${mode}</strong> dengan <strong>${STATE.filtered.length}</strong> baris.</p><p>Tanyakan apa saja tentang data atau ketik <em>bantuan</em> untuk melihat contoh.</p>`,
    chips: ['Berapa total revenue?', 'Ringkasan data', 'Bantuan']
  };
}

function intentThanks() {
  return {
    text: 'Sama-sama! Ada yang bisa dibantu lagi?',
    html: `<p>😊 Sama-sama! Ada yang lain?</p>`,
    chips: ['Ringkasan data', 'Produk terlaris?']
  };
}

function intentHelp() {
  return {
    text: 'Berikut contoh pertanyaan yang didukung.',
    html: `<p>🆘 <strong>Contoh Pertanyaan</strong></p>
           <ul class="asst-list">
             <li>Berapa total revenue?</li>
             <li>Region mana yang paling tinggi?</li>
             <li>Produk terlaris apa?</li>
             <li>Bandingkan Jakarta dan Bandung</li>
             <li>Bagaimana kualitas data?</li>
             <li>Top 5 sales rep</li>
             <li>Tren penjualan per bulan</li>
           </ul>
           <p class="asst-muted"><strong>Perintah:</strong> bersihkan data • filter region Jakarta • urutkan berdasarkan revenue • export ke CSV</p>`,
    chips: ['Total revenue?', 'Produk terlaris?', 'Kualitas data?']
  };
}

function intentUnknown(raw) {
  return {
    text: 'Maaf, saya tidak mengerti pertanyaan tersebut.',
    html: `<p>🤔 Maaf, saya belum memahami: <em>"${escAsstHtml(raw)}"</em></p>
           <p>Coba tanyakan:</p>
           <ul class="asst-list">
             <li>Total revenue?</li>
             <li>Produk terlaris apa?</li>
             <li>Region mana yang tertinggi?</li>
             <li>Kualitas data?</li>
           </ul>
           <p class="asst-muted">Atau ketik <em>bantuan</em> untuk melihat semua contoh.</p>`,
    chips: ['Bantuan', 'Ringkasan data', 'Total revenue?']
  };
}

function noDataResponse() {
  return {
    text: 'Tidak ada data yang ditampilkan saat ini.',
    html: `<p>📭 Tidak ada data. Coba hapus filter atau ganti mode data.</p>`,
    chips: ['Hapus filter', 'Berapa baris data?']
  };
}

/* ============================================================
   6. ACTION HANDLERS  (mutate app STATE, then query)
============================================================ */

function intentCleanData() {
  if (typeof cleanData === 'function') {
    cleanData();
  }
  return {
    text: 'Proses pembersihan data dimulai.',
    html: `<p>🧹 <strong>Bersihkan Data</strong></p><p>Pipeline pembersihan dijalankan. Cek Data Quality Report di dashboard.</p>`,
    chips: ['Kualitas data?', 'Total revenue?']
  };
}

function intentResetData() {
  // Confirm via the app's existing function
  if (typeof resetData === 'function') resetData();
  return {
    text: 'Reset data ke kondisi awal.',
    html: `<p>🔄 <strong>Reset Data</strong></p><p>Dialog konfirmasi telah dibuka.</p>`,
    chips: ['Berapa baris data?', 'Kualitas data?']
  };
}

function intentFilterRegion(regionRaw) {
  const region = toTitleCase(regionRaw.replace(/\?$/, '').trim());
  const sel    = document.getElementById('filterRegion');
  if (!sel) return { text: 'Filter tidak tersedia.', chips: [] };

  // Find closest match in options
  const opts  = Array.from(sel.options).map(o => o.value);
  const match = opts.find(o => o.toLowerCase().includes(region.toLowerCase()));
  if (match) {
    sel.value = match;
    if (typeof applyFilters === 'function') applyFilters();
    return {
      text: `Filter region diterapkan: ${match}`,
      html: `<p>🗺️ <strong>Filter Diterapkan</strong></p><p>Region: <strong>${escAsstHtml(match)}</strong></p><p class="asst-muted">${STATE.filtered.length} baris ditampilkan</p>`,
      chips: ['Total revenue?', 'Produk terlaris?', 'Hapus filter']
    };
  }
  return {
    text: `Region "${region}" tidak ditemukan.`,
    html: `<p>⚠️ Region <strong>"${escAsstHtml(region)}"</strong> tidak ditemukan dalam data. Cek ejaan atau ketik <em>semua region</em>.</p>`,
    chips: ['Hapus filter', 'Region mana yang ada?']
  };
}

function intentFilterKategori(katRaw) {
  const kat = toTitleCase(katRaw.replace(/\?$/, '').trim());
  const sel = document.getElementById('filterKategori');
  if (!sel) return { text: 'Filter tidak tersedia.', chips: [] };
  const opts  = Array.from(sel.options).map(o => o.value);
  const match = opts.find(o => o.toLowerCase().includes(kat.toLowerCase()));
  if (match) {
    sel.value = match;
    if (typeof applyFilters === 'function') applyFilters();
    return {
      text: `Filter kategori diterapkan: ${match}`,
      html: `<p>🗂️ <strong>Filter Diterapkan</strong></p><p>Kategori: <strong>${escAsstHtml(match)}</strong></p><p class="asst-muted">${STATE.filtered.length} baris ditampilkan</p>`,
      chips: ['Total revenue?', 'Produk terlaris?', 'Hapus filter']
    };
  }
  return {
    text: `Kategori "${kat}" tidak ditemukan.`,
    html: `<p>⚠️ Kategori <strong>"${escAsstHtml(kat)}"</strong> tidak ditemukan.</p>`,
    chips: ['Hapus filter', 'Kategori terlaris?']
  };
}

function intentClearFilters() {
  if (typeof clearFilters === 'function') clearFilters();
  return {
    text: 'Semua filter telah dihapus.',
    html: `<p>🧽 <strong>Filter Dihapus</strong></p><p>Menampilkan semua ${STATE.filtered.length} baris data.</p>`,
    chips: ['Total revenue?', 'Region tertinggi?']
  };
}

function intentExportCSV() {
  if (typeof exportCSV === 'function') exportCSV();
  return {
    text: 'Export CSV dimulai.',
    html: `<p>📥 <strong>Export CSV</strong></p><p>File CSV sedang diunduh (${STATE.filtered.length} baris).</p>`,
    chips: ['Export JSON?', 'Total revenue?']
  };
}

function intentExportJSON() {
  if (typeof exportJSON === 'function') exportJSON();
  return {
    text: 'Export JSON dimulai.',
    html: `<p>📥 <strong>Export JSON</strong></p><p>File JSON sedang diunduh (${STATE.filtered.length} baris).</p>`,
    chips: ['Export CSV?', 'Total revenue?']
  };
}

function intentShowCharts() {
  document.getElementById('charts')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.querySelectorAll('.nav-link').forEach(l => l.classList.toggle('active', l.dataset.section === 'charts'));
  return {
    text: 'Membawa Anda ke halaman Visualisasi.',
    html: `<p>📊 Menampilkan <strong>grafik visualisasi</strong>.</p><p class="asst-muted">Scroll ke seksi Visualisasi atau klik tombol "Visualisasi" di sidebar.</p>`,
    chips: ['Tren penjualan per bulan?', 'Revenue per region?']
  };
}

function intentSortRevenue() {
  // Sort by computed revenue (jumlah * harga * (1-diskon))
  // We add a virtual revenue field temporarily, sort, then apply
  STATE.sortCol = 'harga'; // closest proxy
  STATE.sortDir = 'desc';
  if (typeof applyFilters === 'function') applyFilters();
  return {
    text: 'Data diurutkan berdasarkan harga tertinggi (proxy revenue).',
    html: `<p>↕️ <strong>Data Diurutkan</strong></p><p>Kolom <strong>Harga</strong> diurutkan dari tertinggi ke terendah.</p><p class="asst-muted">Untuk revenue tepat (harga × jumlah × diskon), lihat grafik Top Produk.</p>`,
    chips: ['Produk terlaris?', 'Total revenue?']
  };
}

function intentSortHarga() {
  STATE.sortCol = 'harga';
  STATE.sortDir = 'desc';
  if (typeof applyFilters === 'function') applyFilters();
  return {
    text: 'Data diurutkan berdasarkan harga tertinggi.',
    html: `<p>↕️ Data diurutkan: <strong>Harga ↓</strong></p>`,
    chips: ['Produk termahal?', 'Total revenue?']
  };
}

function intentSortTanggal() {
  STATE.sortCol = 'tanggal';
  STATE.sortDir = 'desc';
  if (typeof applyFilters === 'function') applyFilters();
  return {
    text: 'Data diurutkan berdasarkan tanggal terbaru.',
    html: `<p>↕️ Data diurutkan: <strong>Tanggal ↓ (terbaru)</strong></p>`,
    chips: ['Tren penjualan per bulan?', 'Total revenue?']
  };
}

/* ============================================================
   7. GEMINI API  (optional AI mode)
============================================================ */

/**
 * buildDataContext – Create a compact JSON summary of active data
 * to pass as context to Gemini (NOT the full 200 rows).
 */
function buildDataContext() {
  const data = STATE.filtered;
  const rev  = data.reduce((s,r)=>s+rowRevenue(r),0);
  const qty  = data.reduce((s,r)=>s+(Number(r.jumlah)||0),0);
  const topRegions = aggRevByField(data,'region').slice(0,5);
  const topProds   = aggRevByField(data,'produk').slice(0,10);
  const topCats    = aggRevByField(data,'kategori');
  const topMetodes = aggRevByField(data,'metode_pembayaran');

  return {
    mode:         STATE.mode,
    totalRows:    data.length,
    totalRevenue: Math.round(rev),
    totalQty:     qty,
    avgDiskon:    data.length ? (data.reduce((s,r)=>s+(Number(r.diskon)||0),0)/data.length).toFixed(3) : 0,
    qualityScore: STATE.qualityReport?.score ?? null,
    topRegions:   topRegions.map(([k,v])=>({ region:k, revenue:Math.round(v) })),
    topProducts:  topProds.map(([k,v])=>({ produk:k, revenue:Math.round(v) })),
    byKategori:   topCats.map(([k,v])=>({ kategori:k, revenue:Math.round(v) })),
    byMetode:     topMetodes.map(([k,v])=>({ metode:k, revenue:Math.round(v) }))
  };
}

const GEMINI_SYSTEM_PROMPT = `
Kamu adalah Data Assistant untuk aplikasi "Data Workbench".
---
ROLE: Analis data bisnis yang memahami konteks data penjualan Indonesia.
TASK: Jawab pertanyaan pengguna HANYA berdasarkan statistik data yang diberikan dalam konteks JSON. Jangan mengarang angka.
CONSTRAINTS:
- Jawab dalam Bahasa Indonesia yang singkat dan jelas (maks 150 kata).
- Format jawaban: teks naratif ringkas + bullet poin jika perlu angka.
- Di akhir jawaban, sertakan tepat 2 saran pertanyaan lanjutan dalam format JSON: {"chips":["...", "..."]}
- Jangan menyebutkan "JSON", "prompt", atau detail teknis internal.
- Jika pertanyaan tidak bisa dijawab dari data, katakan jujur.
`.trim();

/**
 * callGemini – Send user message + data context to Gemini API.
 * Falls back to rule-based if API fails.
 */
async function callGemini(userText) {
  const ctx  = buildDataContext();
  const body = {
    contents: [{
      parts: [{
        text: `${GEMINI_SYSTEM_PROMPT}\n\n` +
              `DATA KONTEKS (JSON ringkasan):\n${JSON.stringify(ctx, null, 2)}\n\n` +
              `PERTANYAAN PENGGUNA: ${userText}`
      }]
    }]
  };

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${ASST.apiKey}`,
      { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }
    );

    if (!res.ok) {
      const err = await res.json().catch(()=>({}));
      throw new Error(err?.error?.message || `HTTP ${res.status}`);
    }

    const json    = await res.json();
    const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Extract optional chips JSON
    let chips = [];
    const chipsMatch = rawText.match(/\{"chips"\s*:\s*\[([^\]]+)\]\}/);
    if (chipsMatch) {
      try {
        const parsed = JSON.parse(`{"chips":[${chipsMatch[1]}]}`);
        chips = parsed.chips || [];
      } catch {}
    }

    // Remove chips JSON from display text
    const cleanText = rawText.replace(/\{"chips"\s*:\s*\[[^\]]+\]\}/, '').trim();

    return {
      text: cleanText,
      html: `<p class="asst-ai-badge">✨ AI Mode</p><p>${escAsstHtml(cleanText).replace(/\n/g,'<br/>')}</p>`,
      chips: chips.length ? chips : ['Total revenue?', 'Region tertinggi?']
    };

  } catch (err) {
    console.warn('[Assistant] Gemini API error, falling back to rule-based:', err.message);
    // Disable AI mode for this session to avoid further failed calls
    const fallback = parseIntent(userText);
    fallback.html = `<p class="asst-warning">⚠️ AI Mode error: ${escAsstHtml(err.message)}. Menggunakan mode aturan.</p>` + (fallback.html || escAsstHtml(fallback.text));
    return fallback;
  }
}

/* ============================================================
   8. SETTINGS PANEL
============================================================ */

function toggleAsstSettings() {
  const panel = document.getElementById('asstSettingsPanel');
  if (!panel) return;
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) {
    document.getElementById('asstApiKeyInput').value = ASST.apiKey;
    document.getElementById('asstAiModeToggle').checked = ASST.aiMode;
  }
}

function saveAsstSettings() {
  const key  = document.getElementById('asstApiKeyInput').value.trim();
  const mode = document.getElementById('asstAiModeToggle').checked;

  ASST.apiKey = key;
  ASST.aiMode = mode && !!key;

  if (key) localStorage.setItem(ASST.APIKEY_KEY, key);
  else     localStorage.removeItem(ASST.APIKEY_KEY);
  localStorage.setItem(ASST.AIMODE_KEY, ASST.aiMode ? '1' : '0');

  toggleAsstSettings();
  const modeLabel = ASST.aiMode ? 'AI Mode (Gemini) aktif ✨' : 'Mode Aturan aktif';
  showToast(modeLabel, ASST.aiMode ? 'success' : 'info');
  updateAsstModeIndicator();
}

function updateAsstModeIndicator() {
  const el = document.getElementById('asstModeLabel');
  if (!el) return;
  if (ASST.aiMode && ASST.apiKey) {
    el.textContent = '✨ AI';
    el.className   = 'asst-mode-label asst-mode-ai';
    el.title       = 'Gemini AI Mode aktif';
  } else {
    el.textContent = '⚙️ Rule';
    el.className   = 'asst-mode-label asst-mode-rule';
    el.title       = 'Rule-based Mode';
  }
}

/* ============================================================
   9. PERSISTENCE
============================================================ */

function saveAsstHistory() {
  // Store last 50 messages only
  const recent = ASST.history.slice(-50);
  localStorage.setItem(ASST.STORAGE_KEY, JSON.stringify(recent));
}

function loadAsstHistory() {
  try {
    const raw = localStorage.getItem(ASST.STORAGE_KEY);
    if (!raw) return;
    ASST.history = JSON.parse(raw);
    const container = document.getElementById('asstMessages');
    if (!container) return;
    // Replay messages visually
    ASST.history.forEach(msg => {
      appendBubble(msg.role, msg.text, true);
    });
    // If no history, show welcome
    if (ASST.history.length === 0) renderWelcome();
  } catch {
    ASST.history = [];
  }
}

/* ============================================================
   10. UTILITIES
============================================================ */

function escAsstHtml(s) {
  return String(s||'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function escAsstAttr(s) {
  return String(s||'').replace(/'/g,"\\'");
}

function formatMonthShort(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  const names = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  return `${names[parseInt(m,10)-1] || m} ${y}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* ============================================================
   11. INIT
============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  // Load saved API key & mode
  ASST.apiKey = localStorage.getItem(ASST.APIKEY_KEY) || '';
  ASST.aiMode = localStorage.getItem(ASST.AIMODE_KEY) === '1' && !!ASST.apiKey;

  updateAsstModeIndicator();
  loadAsstHistory();
});
