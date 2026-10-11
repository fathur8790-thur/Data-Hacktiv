/**
 * ============================================================
 * Data Workbench – script.js
 * Vanilla JavaScript, modular, no framework
 * ============================================================
 *
 * Module structure:
 *  1. STATE           – central application state
 *  2. LOAD DATA       – fetch data.json / localStorage
 *  3. DATA CLEANING   – cleanData(), computeQualityReport()
 *  4. FILTERS         – applyFilters(), buildFilterOptions()
 *  5. TABLE & CRUD    – renderTable(), handleCRUD()
 *  6. CHARTS          – renderCharts(), switchMainChartType()
 *  7. IMPORT / EXPORT – importCSV/JSON, exportCSV/JSON
 *  8. UI HELPERS      – toast(), modal, dark mode, sidebar
 *  9. INIT            – bootstrap
 * ============================================================
 */

'use strict';

/* ============================================================
   1. STATE
============================================================ */
const STATE = {
  rawData:      [],      // original data from data.json
  cleanData:    [],      // cleaned version
  mode:         'raw',   // 'raw' | 'clean'
  filtered:     [],      // current display (after filters)
  sortCol:      'id',
  sortDir:      'asc',
  currentPage:  1,
  pageSize:     10,
  charts:       {},      // Chart.js instances keyed by canvas id
  mainChartType:'line',  // switchable chart type
  qualityReport: null,
  pendingImport: null,   // imported data awaiting confirmation
  deleteId:      null    // id pending deletion
};

/* ============================================================
   2. LOAD DATA
============================================================ */

/**
 * loadData – Fetch data.json; check localStorage first for overrides.
 */
async function loadData() {
  showTableSkeleton(true);

  try {
    // Check if user has saved data in localStorage
    const saved = localStorage.getItem('dw_rawData');
    if (saved) {
      STATE.rawData = JSON.parse(saved);
    } else {
      const res  = await fetch('data.json');
      if (!res.ok) throw new Error('Gagal memuat data.json');
      STATE.rawData = await res.json();
    }

    // Check for a cached clean version
    const savedClean = localStorage.getItem('dw_cleanData');
    if (savedClean) {
      STATE.cleanData  = JSON.parse(savedClean);
      STATE.qualityReport = JSON.parse(localStorage.getItem('dw_qualityReport') || 'null');
    }

    // Restore mode
    const savedMode = localStorage.getItem('dw_mode');
    if (savedMode) STATE.mode = savedMode;

  } catch (err) {
    showToast('Gagal memuat data: ' + err.message, 'error');
    STATE.rawData = [];
  }

  applyFilters();
  buildFilterOptions();
  updateCleanBanner();
  if (STATE.qualityReport) showQualityReport();
  showTableSkeleton(false);
}

/**
 * saveToLocalStorage – Persist state to localStorage after every mutation.
 */
function saveToLocalStorage() {
  localStorage.setItem('dw_rawData',  JSON.stringify(STATE.rawData));
  localStorage.setItem('dw_cleanData', JSON.stringify(STATE.cleanData));
  if (STATE.qualityReport) {
    localStorage.setItem('dw_qualityReport', JSON.stringify(STATE.qualityReport));
  }
  localStorage.setItem('dw_mode', STATE.mode);
}

/**
 * resetData – Reload from data.json and clear all overrides.
 */
async function resetData() {
  if (!confirm('Reset semua data ke kondisi awal? Perubahan Anda akan hilang.')) return;
  localStorage.removeItem('dw_rawData');
  localStorage.removeItem('dw_cleanData');
  localStorage.removeItem('dw_qualityReport');
  localStorage.removeItem('dw_mode');
  STATE.cleanData    = [];
  STATE.qualityReport = null;
  STATE.mode         = 'raw';
  updateModeUI();
  await loadData();
  showToast('Data berhasil direset ke kondisi awal', 'success');
}

/* ============================================================
   3. DATA CLEANING
============================================================ */

/**
 * cleanData – Run the automated cleaning pipeline on rawData.
 * Steps:
 *   a) Deduplicate
 *   b) Standardise text (trim + Title Case)
 *   c) Normalise date formats to YYYY-MM-DD
 *   d) Fill missing values (median for numbers, "Unknown" for text)
 *   e) Flag negative values & outliers (IQR method)
 */
function cleanData() {
  showToast('Membersihkan data...', 'info');

  const original = [...STATE.rawData];
  let data = original.map(r => ({ ...r })); // deep-ish copy

  const stats = {
    originalCount:   original.length,
    duplicatesRemoved: 0,
    missingFixed:    0,
    outliersFlagged: 0,
    negativesFixed:  0
  };

  /* ---- a) Standardise text fields ---- */
  const textFields = ['produk','kategori','region','sales_rep','metode_pembayaran'];
  data.forEach(row => {
    textFields.forEach(f => {
      if (typeof row[f] === 'string') {
        row[f] = row[f].trim();
        // Title Case
        row[f] = row[f].replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
      }
    });
  });

  /* ---- b) Normalise date to YYYY-MM-DD ---- */
  data.forEach(row => {
    if (row.tanggal) {
      row.tanggal = normaliseDate(row.tanggal);
    }
  });

  /* ---- c) Fill missing / null values ---- */
  // Compute medians for numeric fields
  const numericFields = ['jumlah','harga','diskon'];
  const medians = {};
  numericFields.forEach(f => {
    const vals = data.map(r => r[f]).filter(v => v != null && v !== '' && !isNaN(v) && Number(v) > 0);
    vals.sort((a,b) => a - b);
    medians[f] = vals.length ? vals[Math.floor(vals.length / 2)] : 0;
  });

  data.forEach(row => {
    // Text fields
    textFields.forEach(f => {
      if (!row[f] || row[f].trim() === '') {
        row[f] = 'Unknown';
        stats.missingFixed++;
      }
    });
    // Numeric fields
    numericFields.forEach(f => {
      if (row[f] == null || row[f] === '' || isNaN(row[f])) {
        row[f] = medians[f];
        stats.missingFixed++;
      }
    });
    // Date
    if (!row.tanggal || row.tanggal === 'Invalid') {
      row.tanggal = '2024-01-01';
      stats.missingFixed++;
    }
  });

  /* ---- d) Fix negatives ---- */
  ['jumlah','harga'].forEach(f => {
    data.forEach(row => {
      if (Number(row[f]) < 0) {
        row[f] = Math.abs(row[f]);
        stats.negativesFixed++;
        row._issues = (row._issues || '') + `negative_${f} `;
      }
    });
  });
  // Fix diskon out of [0,1]
  data.forEach(row => {
    if (Number(row.diskon) > 1) {
      row.diskon = 1;
      stats.negativesFixed++;
    }
    if (Number(row.diskon) < 0) {
      row.diskon = 0;
      stats.negativesFixed++;
    }
  });

  /* ---- e) Remove duplicates ---- */
  const seen = new Set();
  const deduped = [];
  data.forEach(row => {
    // Key: tanggal + produk + sales_rep + jumlah
    const key = `${row.tanggal}|${row.produk}|${row.sales_rep}|${row.jumlah}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(row);
    } else {
      stats.duplicatesRemoved++;
    }
  });
  data = deduped;

  /* ---- f) Flag outliers (IQR on 'jumlah') ---- */
  const jumlahVals = data.map(r => Number(r.jumlah)).sort((a,b) => a - b);
  const q1 = jumlahVals[Math.floor(jumlahVals.length * 0.25)];
  const q3 = jumlahVals[Math.floor(jumlahVals.length * 0.75)];
  const iqr  = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;

  const hargaVals = data.map(r => Number(r.harga)).sort((a,b) => a - b);
  const hq1 = hargaVals[Math.floor(hargaVals.length * 0.25)];
  const hq3 = hargaVals[Math.floor(hargaVals.length * 0.75)];
  const hiqr  = hq3 - hq1;
  const hlower = hq1 - 1.5 * hiqr;
  const hupper = hq3 + 1.5 * hiqr;

  data.forEach(row => {
    const q = Number(row.jumlah);
    const h = Number(row.harga);
    if (q < lowerFence || q > upperFence || h < hlower || h > hupper) {
      row._outlier = true;
      stats.outliersFlagged++;
    }
  });

  // Re-assign sequential IDs
  data.forEach((row, i) => { row.id = i + 1; });

  STATE.cleanData     = data;
  STATE.qualityReport = {
    ...stats,
    cleanCount: data.length,
    score: computeQualityScore(stats, original.length)
  };

  saveToLocalStorage();

  /* Auto-switch to clean mode to show results */
  setDataMode('clean');
  showQualityReport();
  showToast(`Data berhasil dibersihkan! ${stats.duplicatesRemoved} duplikat dihapus, ${stats.missingFixed} nilai diperbaiki.`, 'success');
}

/**
 * normaliseDate – Converts various date formats to YYYY-MM-DD.
 */
function normaliseDate(raw) {
  if (!raw || typeof raw !== 'string') return 'Invalid';
  const s = raw.trim();

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // YYYY/MM/DD
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) return s.replace(/\//g, '-');
  // DD-MM-YYYY
  const dmy = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  // DD/MM/YYYY
  const dmys = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmys) return `${dmys[3]}-${dmys[2]}-${dmys[1]}`;
  // MM/DD/YYYY (ambiguous, treat as MM/DD/YYYY)
  const mdy = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1]}-${mdy[2]}`;

  // Try native Date parse
  const d = new Date(s);
  if (!isNaN(d)) {
    return d.toISOString().slice(0, 10);
  }
  return 'Invalid';
}

/**
 * computeQualityScore – Returns a 0-100 score based on problems found.
 */
function computeQualityScore(stats, totalRows) {
  if (!totalRows) return 0;
  const problems = stats.duplicatesRemoved + stats.missingFixed + stats.negativesFixed;
  const problemRatio = problems / (totalRows * 0.5); // normalise
  const score = Math.max(0, Math.round(100 - problemRatio * 100));
  return Math.min(score, 100);
}

/**
 * showQualityReport – Render the quality report banner.
 */
function showQualityReport() {
  const r = STATE.qualityReport;
  if (!r) return;
  const el = document.getElementById('qualityReport');
  el.classList.remove('hidden');

  document.getElementById('qualityScore').textContent = r.score + '% Bersih';
  document.getElementById('qualityScore').style.color = r.score >= 80 ? '#16a34a' : r.score >= 60 ? '#d97706' : '#dc2626';

  const statsEl = document.getElementById('qualityStats');
  const items = [
    { label: 'Baris Awal',         value: r.originalCount,       color: 'text-gray-700 dark:text-gray-200' },
    { label: 'Baris Setelah Clean',value: r.cleanCount,           color: 'text-primary-600' },
    { label: 'Duplikat Dihapus',   value: r.duplicatesRemoved,    color: 'text-amber-600' },
    { label: 'Nilai Kosong Diperbaiki', value: r.missingFixed,    color: 'text-red-600' },
    { label: 'Outlier Ditandai',   value: r.outliersFlagged,      color: 'text-purple-600' }
  ];
  statsEl.innerHTML = items.map(i =>
    `<div class="quality-stat">
       <div class="stat-value ${i.color}">${i.value}</div>
       <div class="stat-label">${i.label}</div>
     </div>`
  ).join('');
}

/**
 * Get the active dataset based on current mode.
 */
function getActiveData() {
  if (STATE.mode === 'clean' && STATE.cleanData.length > 0) {
    return STATE.cleanData;
  }
  return STATE.rawData;
}

/**
 * analyseRawIssues – Mark raw rows with badge flags for display.
 */
function analyseRawIssues(data) {
  // Detect duplicates
  const keyCount = {};
  data.forEach(row => {
    const key = `${row.tanggal}|${row.produk}|${row.sales_rep}|${row.jumlah}`;
    keyCount[key] = (keyCount[key] || 0) + 1;
  });

  return data.map(row => {
    const issues = [];
    const key = `${row.tanggal}|${row.produk}|${row.sales_rep}|${row.jumlah}`;
    if (keyCount[key] > 1) issues.push('duplicate');

    const textFields = ['produk','kategori','region','sales_rep','metode_pembayaran'];
    textFields.forEach(f => { if (!row[f]) issues.push('missing'); });
    ['jumlah','harga'].forEach(f => { if (row[f] == null) issues.push('missing'); });
    if (!row.tanggal) issues.push('missing');

    if (Number(row.jumlah) < 0 || Number(row.harga) < 0) issues.push('negative');
    if (Number(row.diskon) > 1) issues.push('outlier');
    if (Number(row.jumlah) > 50) issues.push('outlier');
    if (row._outlier) issues.push('outlier');

    return { ...row, _rawIssues: [...new Set(issues)] };
  });
}

/* ============================================================
   4. FILTERS
============================================================ */

/**
 * applyFilters – Filter + sort → update STATE.filtered → re-render.
 */
function applyFilters() {
  const query    = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const region   = document.getElementById('filterRegion')?.value   || '';
  const kategori = document.getElementById('filterKategori')?.value || '';
  const metode   = document.getElementById('filterMetode')?.value   || '';

  let data = getActiveData();
  if (STATE.mode === 'raw') data = analyseRawIssues(data);

  // Filter
  data = data.filter(row => {
    if (region   && normaliseText(row.region)   !== normaliseText(region))   return false;
    if (kategori && normaliseText(row.kategori) !== normaliseText(kategori)) return false;
    if (metode   && normaliseText(row.metode_pembayaran) !== normaliseText(metode)) return false;
    if (query) {
      const haystack = Object.values(row).join(' ').toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  // Sort
  data = sortData(data, STATE.sortCol, STATE.sortDir);

  STATE.filtered     = data;
  STATE.currentPage  = 1;

  renderTable();
  renderKPI();
  renderCharts();
  updateExportInfo();
}

function normaliseText(str) {
  return (str || '').trim().toLowerCase();
}

/**
 * buildFilterOptions – Populate filter <select> elements with unique values.
 */
function buildFilterOptions() {
  const active = getActiveData();
  const unique = (field) => [...new Set(active.map(r => {
    const v = r[field];
    return v ? toTitleCase(v.toString().trim()) : null;
  }).filter(Boolean))].sort();

  populateSelect('filterRegion',   unique('region'),            'Semua Region');
  populateSelect('filterKategori', unique('kategori'),          'Semua Kategori');
  populateSelect('filterMetode',   unique('metode_pembayaran'), 'Semua Metode');
}

function populateSelect(id, options, placeholder) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = el.value;
  el.innerHTML = `<option value="">${placeholder}</option>` +
    options.map(o => `<option value="${o}"${o === current ? ' selected' : ''}>${o}</option>`).join('');
}

function clearFilters() {
  document.getElementById('searchInput').value = '';
  ['filterRegion','filterKategori','filterMetode'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  applyFilters();
}

/* ============================================================
   5. TABLE & CRUD
============================================================ */

const COLUMNS = [
  { key:'id',              label:'ID',       sortable:true  },
  { key:'tanggal',         label:'Tanggal',  sortable:true  },
  { key:'produk',          label:'Produk',   sortable:true  },
  { key:'kategori',        label:'Kategori', sortable:true  },
  { key:'region',          label:'Region',   sortable:true  },
  { key:'sales_rep',       label:'Sales Rep',sortable:true  },
  { key:'jumlah',          label:'Jumlah',   sortable:true  },
  { key:'harga',           label:'Harga',    sortable:true  },
  { key:'diskon',          label:'Diskon',   sortable:true  },
  { key:'metode_pembayaran',label:'Metode',  sortable:true  },
  { key:'_actions',        label:'Aksi',     sortable:false }
];

/**
 * renderTable – Draw table head and visible page of rows.
 */
function renderTable() {
  renderTableHead();
  renderTableBody();
  renderPagination();
}

function renderTableHead() {
  const tr = document.getElementById('tableHead');
  if (!tr) return;
  tr.innerHTML = COLUMNS.map(col => {
    if (!col.sortable) return `<th class="px-4 py-3">${col.label}</th>`;
    let cls = '';
    if (STATE.sortCol === col.key) cls = STATE.sortDir === 'asc' ? 'sort-asc' : 'sort-desc';
    const arrow = STATE.sortDir === 'asc' ? '▲' : '▼';
    return `<th class="${cls}" onclick="setSort('${col.key}')" aria-sort="${STATE.sortCol === col.key ? STATE.sortDir + 'ending' : 'none'}">
      ${col.label}
      <span class="sort-icon">${STATE.sortCol === col.key ? arrow : '⇅'}</span>
    </th>`;
  }).join('');
}

function renderTableBody() {
  const tbody    = document.getElementById('tableBody');
  const empty    = document.getElementById('emptyState');
  const skeleton = document.getElementById('tableSkeleton');
  if (!tbody) return;

  skeleton?.classList.add('hidden');

  if (STATE.filtered.length === 0) {
    tbody.innerHTML = '';
    empty?.classList.remove('hidden');
    return;
  }
  empty?.classList.add('hidden');

  const start = (STATE.currentPage - 1) * STATE.pageSize;
  const page  = STATE.filtered.slice(start, start + STATE.pageSize);

  tbody.innerHTML = page.map(row => {
    const issues  = row._rawIssues || [];
    const rowCls  = issues.includes('missing') || issues.includes('negative') ? 'row-critical' :
                    issues.includes('duplicate') || issues.includes('outlier') ? 'row-issue' : '';

    const badges = STATE.mode === 'raw' ? issues.map(i =>
      `<span class="badge badge-${i === 'duplicate' ? 'duplicate' : i === 'missing' ? 'missing' : i === 'outlier' ? 'outlier' : 'negative'}">${i}</span>`
    ).join(' ') : (row._outlier ? `<span class="badge badge-outlier">outlier</span>` : '');

    return `<tr class="${rowCls}">
      <td class="px-4 py-2.5 text-gray-500 text-xs">${row.id}</td>
      <td class="px-4 py-2.5">${escHtml(row.tanggal || '—')}</td>
      <td class="px-4 py-2.5 font-medium">${escHtml(row.produk || '—')} ${badges}</td>
      <td class="px-4 py-2.5"><span class="badge badge-clean">${escHtml(toTitleCase(row.kategori || '—'))}</span></td>
      <td class="px-4 py-2.5">${escHtml(toTitleCase(row.region || '—'))}</td>
      <td class="px-4 py-2.5 text-xs">${escHtml(row.sales_rep ? row.sales_rep.trim() : '—')}</td>
      <td class="px-4 py-2.5 text-right">${row.jumlah ?? '—'}</td>
      <td class="px-4 py-2.5 text-right font-medium">${row.harga != null ? formatRp(row.harga) : '—'}</td>
      <td class="px-4 py-2.5 text-right">${row.diskon != null ? (Number(row.diskon) * 100).toFixed(0) + '%' : '—'}</td>
      <td class="px-4 py-2.5">${escHtml(toTitleCase(row.metode_pembayaran || '—'))}</td>
      <td class="px-4 py-2.5 whitespace-nowrap">
        <button class="btn-edit" onclick="openEditModal(${row.id})" aria-label="Edit baris ${row.id}">Edit</button>
        <button class="btn-delete" onclick="openDeleteModal(${row.id})" aria-label="Hapus baris ${row.id}">Hapus</button>
      </td>
    </tr>`;
  }).join('');
}

function renderPagination() {
  const info  = document.getElementById('paginationInfo');
  const ctrls = document.getElementById('paginationControls');
  if (!info || !ctrls) return;

  const total = STATE.filtered.length;
  const pages = Math.max(1, Math.ceil(total / STATE.pageSize));
  const cur   = STATE.currentPage;
  const start = Math.min((cur - 1) * STATE.pageSize + 1, total);
  const end   = Math.min(cur * STATE.pageSize, total);

  info.textContent = total ? `Menampilkan ${start}–${end} dari ${total} baris` : 'Tidak ada data';

  // Show up to 5 page buttons with ellipsis
  let btns = [];
  btns.push(makePgBtn('‹', cur - 1, cur === 1));
  const range = paginationRange(cur, pages);
  range.forEach(p => {
    if (p === '…') btns.push(`<span class="px-2 text-gray-400">…</span>`);
    else btns.push(makePgBtn(p, p, false, p === cur));
  });
  btns.push(makePgBtn('›', cur + 1, cur === pages));
  ctrls.innerHTML = btns.join('');
}

function makePgBtn(label, target, disabled, active = false) {
  const cls = `page-btn${active ? ' active' : ''}`;
  return `<button class="${cls}" ${disabled ? 'disabled' : ''} onclick="goToPage(${target})">${label}</button>`;
}

function paginationRange(cur, total) {
  if (total <= 7) return Array.from({length: total}, (_,i) => i + 1);
  if (cur <= 4) return [1,2,3,4,5,'…',total];
  if (cur >= total - 3) return [1,'…',total-4,total-3,total-2,total-1,total];
  return [1,'…',cur-1,cur,cur+1,'…',total];
}

function goToPage(p) {
  const pages = Math.ceil(STATE.filtered.length / STATE.pageSize);
  STATE.currentPage = Math.max(1, Math.min(p, pages));
  renderTableBody();
  renderPagination();
}

function setSort(col) {
  if (STATE.sortCol === col) {
    STATE.sortDir = STATE.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    STATE.sortCol = col;
    STATE.sortDir = 'asc';
  }
  applyFilters();
}

function sortData(data, col, dir) {
  return [...data].sort((a, b) => {
    let av = a[col], bv = b[col];
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') {
      return dir === 'asc' ? av - bv : bv - av;
    }
    av = String(av).toLowerCase();
    bv = String(bv).toLowerCase();
    return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
  });
}

/* --- CRUD --- */

function openAddModal() {
  document.getElementById('modalTitle').textContent = 'Tambah Data';
  document.getElementById('btnSubmitCRUD').textContent = 'Simpan';
  document.getElementById('formId').value = '';
  document.getElementById('crudForm').reset();
  clearFormErrors();
  openModal('crudModal');
}

function openEditModal(id) {
  const data = getActiveData();
  const row  = data.find(r => r.id === id);
  if (!row) { showToast('Data tidak ditemukan', 'error'); return; }

  document.getElementById('modalTitle').textContent = 'Edit Data';
  document.getElementById('btnSubmitCRUD').textContent = 'Simpan Perubahan';
  document.getElementById('formId').value    = id;
  document.getElementById('formTanggal').value  = (row.tanggal || '').slice(0, 10);
  document.getElementById('formProduk').value   = row.produk    || '';
  document.getElementById('formKategori').value = toTitleCase(row.kategori || '');
  document.getElementById('formRegion').value   = toTitleCase(row.region   || '');
  document.getElementById('formSalesRep').value = (row.sales_rep || '').trim();
  document.getElementById('formMetode').value   = toTitleCase(row.metode_pembayaran || '');
  document.getElementById('formJumlah').value   = row.jumlah  ?? '';
  document.getElementById('formHarga').value    = row.harga   ?? '';
  document.getElementById('formDiskon').value   = row.diskon  ?? '';
  clearFormErrors();
  openModal('crudModal');
}

function openDeleteModal(id) {
  STATE.deleteId = id;
  openModal('deleteModal');
}

function confirmDelete() {
  const id = STATE.deleteId;
  if (!id) return;

  if (STATE.mode === 'clean') {
    STATE.cleanData = STATE.cleanData.filter(r => r.id !== id);
  } else {
    STATE.rawData = STATE.rawData.filter(r => r.id !== id);
    STATE.cleanData = []; // invalidate clean cache
    STATE.qualityReport = null;
  }

  saveToLocalStorage();
  closeModal('deleteModal');
  buildFilterOptions();
  applyFilters();
  showToast('Data berhasil dihapus', 'success');
}

function submitCRUD(e) {
  e.preventDefault();
  if (!validateForm()) return;

  const id  = document.getElementById('formId').value;
  const row = {
    tanggal:          document.getElementById('formTanggal').value,
    produk:           document.getElementById('formProduk').value.trim(),
    kategori:         document.getElementById('formKategori').value,
    region:           document.getElementById('formRegion').value,
    sales_rep:        document.getElementById('formSalesRep').value.trim(),
    metode_pembayaran:document.getElementById('formMetode').value,
    jumlah:           Number(document.getElementById('formJumlah').value),
    harga:            Number(document.getElementById('formHarga').value),
    diskon:           Number(document.getElementById('formDiskon').value)
  };

  const targetArr = STATE.mode === 'clean' ? STATE.cleanData : STATE.rawData;

  if (id) {
    // Update
    const idx = targetArr.findIndex(r => r.id === Number(id));
    if (idx !== -1) {
      targetArr[idx] = { ...targetArr[idx], ...row };
      showToast('Data berhasil diperbarui', 'success');
    }
  } else {
    // Create
    const maxId = targetArr.reduce((m, r) => Math.max(m, r.id || 0), 0);
    targetArr.push({ id: maxId + 1, ...row });
    showToast('Data berhasil ditambahkan', 'success');
  }

  if (STATE.mode !== 'clean') {
    STATE.cleanData     = [];
    STATE.qualityReport = null;
    updateCleanBanner();
  }

  saveToLocalStorage();
  closeModal('crudModal');
  buildFilterOptions();
  applyFilters();
}

function validateForm() {
  let valid = true;
  clearFormErrors();

  const req = [
    { id:'formTanggal',  err:'errTanggal',  msg:'Tanggal wajib diisi' },
    { id:'formProduk',   err:'errProduk',   msg:'Produk wajib diisi' },
    { id:'formKategori', err:'errKategori', msg:'Kategori wajib dipilih' },
    { id:'formRegion',   err:'errRegion',   msg:'Region wajib dipilih' },
    { id:'formSalesRep', err:'errSalesRep', msg:'Sales rep wajib diisi' },
    { id:'formMetode',   err:'errMetode',   msg:'Metode wajib dipilih' }
  ];
  req.forEach(({ id, err, msg }) => {
    const el = document.getElementById(id);
    if (!el.value.trim()) {
      showFieldError(id, err, msg);
      valid = false;
    }
  });

  const jumlah = Number(document.getElementById('formJumlah').value);
  if (!document.getElementById('formJumlah').value || jumlah <= 0) {
    showFieldError('formJumlah','errJumlah','Jumlah harus angka positif');
    valid = false;
  }
  const harga = Number(document.getElementById('formHarga').value);
  if (!document.getElementById('formHarga').value || harga <= 0) {
    showFieldError('formHarga','errHarga','Harga harus angka positif');
    valid = false;
  }
  const diskon = Number(document.getElementById('formDiskon').value);
  if (document.getElementById('formDiskon').value === '' || diskon < 0 || diskon > 1) {
    showFieldError('formDiskon','errDiskon','Diskon antara 0.0 hingga 1.0');
    valid = false;
  }

  return valid;
}

function showFieldError(fieldId, errId, msg) {
  const field = document.getElementById(fieldId);
  const err   = document.getElementById(errId);
  if (field) field.classList.add('error');
  if (err)  { err.textContent = msg; err.classList.remove('hidden'); }
}

function clearFormErrors() {
  document.querySelectorAll('.form-error').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.input-field.error').forEach(el => el.classList.remove('error'));
}

/* ============================================================
   6. CHARTS
============================================================ */

/**
 * renderCharts – Build/update all Chart.js visualisations from STATE.filtered.
 */
function renderCharts() {
  renderKPI();
  renderTrendChart();
  renderRegionChart();
  renderKategoriChart();
  renderTopProdukChart();
  renderScatterChart();
  renderMetodeChart();
}

/* --- KPI Cards --- */
function renderKPI() {
  const data = STATE.filtered;
  const kpiGrid = document.getElementById('kpiGrid');
  if (!kpiGrid) return;

  const totalRevenue = data.reduce((s, r) => {
    const q = Number(r.jumlah) || 0;
    const h = Number(r.harga)  || 0;
    const d = Math.min(1, Math.max(0, Number(r.diskon) || 0));
    return s + q * h * (1 - d);
  }, 0);

  const totalTransaksi = data.length;
  const totalQty  = data.reduce((s, r) => s + (Number(r.jumlah) || 0), 0);
  const avgDiskon = data.length ? data.reduce((s, r) => s + (Number(r.diskon) || 0), 0) / data.length : 0;
  const avgOrder  = totalTransaksi ? totalRevenue / totalTransaksi : 0;

  const kpis = [
    { label:'Total Revenue',          value: formatRp(totalRevenue),            icon:'💰', color:'bg-primary-50 dark:bg-primary-900/20 text-primary-600' },
    { label:'Total Transaksi',         value: totalTransaksi.toLocaleString('id'), icon:'📋', color:'bg-accent-50 dark:bg-green-900/20 text-accent-600' },
    { label:'Total Quantity',          value: totalQty.toLocaleString('id'),      icon:'📦', color:'bg-amber-50 dark:bg-amber-900/20 text-amber-600' },
    { label:'Rata-rata Diskon',        value: (avgDiskon * 100).toFixed(1) + '%', icon:'🏷️', color:'bg-purple-50 dark:bg-purple-900/20 text-purple-600' },
    { label:'Rata-rata Nilai Transaksi',value: formatRp(avgOrder),               icon:'📊', color:'bg-red-50 dark:bg-red-900/20 text-red-600' }
  ];

  kpiGrid.innerHTML = kpis.map(k => `
    <div class="kpi-card">
      <div class="kpi-icon ${k.color}">${k.icon}</div>
      <div class="kpi-value">${k.value}</div>
      <div class="kpi-label">${k.label}</div>
    </div>
  `).join('');
}

/* --- Helpers for chart data aggregation --- */

function getMonthlyRevenue(data) {
  const months = {};
  data.forEach(r => {
    if (!r.tanggal) return;
    const m = r.tanggal.slice(0, 7); // YYYY-MM
    const rev = (Number(r.jumlah)||0) * (Number(r.harga)||0) * (1 - Math.min(1, Math.max(0, Number(r.diskon)||0)));
    months[m] = (months[m] || 0) + rev;
  });
  return Object.keys(months).sort().reduce((o, k) => {
    o.labels.push(formatMonth(k));
    o.values.push(Math.round(months[k]));
    return o;
  }, { labels: [], values: [] });
}

function getRevByField(data, field) {
  const agg = {};
  data.forEach(r => {
    const key = toTitleCase((r[field] || 'Unknown').toString().trim());
    const rev = (Number(r.jumlah)||0) * (Number(r.harga)||0) * (1 - Math.min(1, Math.max(0, Number(r.diskon)||0)));
    agg[key] = (agg[key] || 0) + rev;
  });
  const sorted = Object.entries(agg).sort((a,b) => b[1] - a[1]);
  return { labels: sorted.map(s=>s[0]), values: sorted.map(s=>Math.round(s[1])) };
}

function getTopProductsData(data, n = 10) {
  const r = getRevByField(data, 'produk');
  return { labels: r.labels.slice(0,n), values: r.values.slice(0,n) };
}

/* --- Chart factory --- */
function createOrUpdate(id, config) {
  if (STATE.charts[id]) {
    STATE.charts[id].data    = config.data;
    STATE.charts[id].options = config.options;
    STATE.charts[id].update();
  } else {
    const ctx = document.getElementById(id);
    if (!ctx) return;
    STATE.charts[id] = new Chart(ctx, config);
  }
}

function isDark() {
  return document.documentElement.classList.contains('dark');
}

function chartDefaults() {
  return {
    textColor: isDark() ? '#9ca3af' : '#6b7280',
    gridColor: isDark() ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    font: { family: '-apple-system, "Segoe UI", sans-serif', size: 11 }
  };
}

const PALETTE = ['#3b82f6','#22c55e','#f59e0b','#ef4444','#a855f7','#06b6d4','#ec4899','#84cc16'];

/* --- Sales Trend --- */
function renderTrendChart() {
  const { labels, values } = getMonthlyRevenue(STATE.filtered);
  const { textColor, gridColor, font } = chartDefaults();
  const type = STATE.mainChartType;

  // For pie type we need labels+values same structure
  let config;
  if (type === 'pie') {
    config = {
      type: 'pie',
      data: {
        labels,
        datasets: [{ data: values, backgroundColor: PALETTE.slice(0, labels.length), borderWidth: 2 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: textColor, font, boxWidth: 12 } },
                   tooltip: { callbacks: { label: ctx => `  ${formatRp(ctx.parsed)}` } } }
      }
    };
  } else {
    config = {
      type,
      data: {
        labels,
        datasets: [{
          label: 'Revenue (Rp)',
          data: values,
          backgroundColor: type === 'bar' ? '#3b82f6' : 'rgba(59,130,246,0.15)',
          borderColor: '#3b82f6',
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointHoverRadius: 6
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `  ${formatRp(ctx.parsed.y || ctx.raw)}` } } },
        scales: {
          x: { ticks: { color: textColor, font }, grid: { color: gridColor } },
          y: { ticks: { color: textColor, font, callback: v => formatRpShort(v) }, grid: { color: gridColor } }
        }
      }
    };
  }

  // Destroy and recreate when type changes
  if (STATE.charts['chartTrend'] && STATE.charts['chartTrend'].config.type !== type) {
    STATE.charts['chartTrend'].destroy();
    delete STATE.charts['chartTrend'];
  }
  createOrUpdate('chartTrend', config);
}

/* --- Revenue per Region --- */
function renderRegionChart() {
  const { labels, values } = getRevByField(STATE.filtered, 'region');
  const { textColor, gridColor, font } = chartDefaults();
  createOrUpdate('chartRegion', {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Revenue',
        data: values,
        backgroundColor: PALETTE,
        borderRadius: 6
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `  ${formatRp(ctx.parsed.y)}` } } },
      scales: {
        x: { ticks: { color: textColor, font }, grid: { display: false } },
        y: { ticks: { color: textColor, font, callback: v => formatRpShort(v) }, grid: { color: gridColor } }
      }
    }
  });
}

/* --- Revenue per Kategori (Doughnut) --- */
function renderKategoriChart() {
  const { labels, values } = getRevByField(STATE.filtered, 'kategori');
  const { textColor, font } = chartDefaults();
  createOrUpdate('chartKategori', {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: PALETTE,
        borderWidth: 3,
        hoverOffset: 8
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '62%',
      plugins: {
        legend: { position: 'right', labels: { color: textColor, font, boxWidth: 12, padding: 10 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${formatRp(ctx.parsed)}` } }
      }
    }
  });
}

/* --- Top 10 Produk (Horizontal Bar) --- */
function renderTopProdukChart() {
  const { labels, values } = getTopProductsData(STATE.filtered, 10);
  const { textColor, gridColor, font } = chartDefaults();
  createOrUpdate('chartTopProduk', {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Revenue',
        data: values,
        backgroundColor: '#3b82f6',
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `  ${formatRp(ctx.parsed.x)}` } } },
      scales: {
        x: { ticks: { color: textColor, font, callback: v => formatRpShort(v) }, grid: { color: gridColor } },
        y: { ticks: { color: textColor, font } }
      }
    }
  });
}

/* --- Diskon vs Penjualan (Scatter) --- */
function renderScatterChart() {
  const scatterData = STATE.filtered.map(r => ({
    x: Number(r.diskon) * 100,
    y: (Number(r.jumlah)||0) * (Number(r.harga)||0) * (1 - Math.min(1,Number(r.diskon)||0))
  })).filter(p => !isNaN(p.x) && !isNaN(p.y));

  const { textColor, gridColor, font } = chartDefaults();
  createOrUpdate('chartScatter', {
    type: 'scatter',
    data: {
      datasets: [{
        label: 'Transaksi',
        data: scatterData,
        backgroundColor: 'rgba(59,130,246,0.4)',
        borderColor: '#3b82f6',
        pointRadius: 4,
        pointHoverRadius: 6
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: {
        label: ctx => `Diskon: ${ctx.parsed.x.toFixed(0)}% | Revenue: ${formatRp(ctx.parsed.y)}`
      }}},
      scales: {
        x: { title: { display: true, text: 'Diskon (%)', color: textColor, font }, ticks: { color: textColor, font }, grid: { color: gridColor } },
        y: { title: { display: true, text: 'Revenue',    color: textColor, font }, ticks: { color: textColor, font, callback: v => formatRpShort(v) }, grid: { color: gridColor } }
      }
    }
  });
}

/* --- Metode Pembayaran (Pie) --- */
function renderMetodeChart() {
  const { labels, values } = getRevByField(STATE.filtered, 'metode_pembayaran');
  const { textColor, font } = chartDefaults();
  createOrUpdate('chartMetode', {
    type: 'pie',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: PALETTE,
        borderWidth: 3,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: textColor, font, boxWidth: 12, padding: 10 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${formatRp(ctx.parsed)}` } }
      }
    }
  });
}

/**
 * switchMainChartType – Change the trend chart between line/bar/pie.
 */
function switchMainChartType(type) {
  STATE.mainChartType = type;
  document.querySelectorAll('.chart-type-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === type);
  });
  renderTrendChart();
}

/**
 * downloadChart – Trigger PNG download of a chart canvas.
 */
function downloadChart(chartId) {
  const chart = STATE.charts[chartId];
  if (!chart) return;
  const link = document.createElement('a');
  link.download = `${chartId}-${Date.now()}.png`;
  link.href = chart.toBase64Image();
  link.click();
  showToast('Grafik berhasil diunduh', 'success');
}

/* ============================================================
   7. IMPORT / EXPORT
============================================================ */

/* --- Import --- */

function handleDragOver(e) {
  e.preventDefault();
  document.getElementById('dropzone').classList.add('dropzone-active');
}

function handleDrop(e) {
  e.preventDefault();
  document.getElementById('dropzone').classList.remove('dropzone-active');
  const file = e.dataTransfer.files[0];
  if (file) processImportFile(file);
}

function handleFileImport(e) {
  const file = e.target.files[0];
  if (file) processImportFile(file);
  e.target.value = '';
}

function processImportFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['csv','json'].includes(ext)) {
    showToast('Format file tidak didukung. Gunakan CSV atau JSON.', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      let data;
      if (ext === 'json') {
        data = JSON.parse(e.target.result);
      } else {
        data = parseCSV(e.target.result);
      }
      validateImport(data);
    } catch (err) {
      showToast('Gagal memproses file: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}

function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) throw new Error('File CSV kosong atau tidak valid');
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g,''));
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim().replace(/"/g,''));
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
    return obj;
  });
}

const REQUIRED_COLUMNS = ['tanggal','produk','kategori','region','sales_rep','jumlah','harga','diskon','metode_pembayaran'];

function validateImport(data) {
  if (!Array.isArray(data) || data.length === 0) {
    showToast('File tidak berisi data yang valid', 'error');
    return;
  }
  const cols = Object.keys(data[0]).map(k => k.toLowerCase());
  const missing = REQUIRED_COLUMNS.filter(c => !cols.includes(c));

  STATE.pendingImport = data;
  renderImportPreview(data, missing);
}

function renderImportPreview(data, missingCols) {
  const preview = document.getElementById('importPreview');
  const head    = document.getElementById('previewHead');
  const body    = document.getElementById('previewBody');
  const valEl   = document.getElementById('importValidation');

  preview.classList.remove('hidden');

  const cols = Object.keys(data[0]);
  head.innerHTML = `<tr>${cols.map(c => `<th class="px-3 py-2 text-left">${c}</th>`).join('')}</tr>`;
  body.innerHTML = data.slice(0, 5).map(row =>
    `<tr class="border-t border-gray-100 dark:border-gray-700">
      ${cols.map(c => `<td class="px-3 py-1.5 text-gray-700 dark:text-gray-300">${escHtml(String(row[c] ?? ''))}</td>`).join('')}
     </tr>`
  ).join('');

  if (missingCols.length > 0) {
    valEl.innerHTML = `<span class="text-amber-600">⚠ Kolom tidak ditemukan: ${missingCols.join(', ')}</span>`;
    document.getElementById('btnConfirmImport').textContent = `Import Anyway (${data.length} baris)`;
  } else {
    valEl.innerHTML = `<span class="text-accent-600">✓ ${data.length} baris valid, semua kolom ditemukan</span>`;
    document.getElementById('btnConfirmImport').textContent = `Import Data (${data.length} baris)`;
  }
}

function confirmImport() {
  if (!STATE.pendingImport) return;
  const incoming = STATE.pendingImport.map((r, i) => ({
    id: STATE.rawData.length + i + 1, ...r,
    jumlah: Number(r.jumlah) || 0,
    harga:  Number(r.harga)  || 0,
    diskon: Number(r.diskon) || 0
  }));
  STATE.rawData = [...STATE.rawData, ...incoming];
  STATE.cleanData = []; STATE.qualityReport = null;
  saveToLocalStorage();
  STATE.pendingImport = null;
  document.getElementById('importPreview').classList.add('hidden');
  document.getElementById('fileInput').value = '';
  buildFilterOptions();
  applyFilters();
  showToast(`${incoming.length} baris berhasil diimport`, 'success');
}

/* --- Export --- */

function exportCSV() {
  const data = STATE.filtered;
  if (!data.length) { showToast('Tidak ada data untuk diekspor', 'warning'); return; }
  const keys = ['id','tanggal','produk','kategori','region','sales_rep','jumlah','harga','diskon','metode_pembayaran'];
  const header = keys.join(',');
  const rows   = data.map(r => keys.map(k => `"${(r[k] ?? '').toString().replace(/"/g,'""')}"`).join(','));
  downloadBlob([header, ...rows].join('\n'), `data-workbench-${Date.now()}.csv`, 'text/csv');
  showToast('Data berhasil diekspor sebagai CSV', 'success');
}

function exportJSON() {
  const data = STATE.filtered;
  if (!data.length) { showToast('Tidak ada data untuk diekspor', 'warning'); return; }
  const clean = data.map(r => {
    const { _rawIssues, _outlier, _issues, ...rest } = r;
    return rest;
  });
  downloadBlob(JSON.stringify(clean, null, 2), `data-workbench-${Date.now()}.json`, 'application/json');
  showToast('Data berhasil diekspor sebagai JSON', 'success');
}

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function updateExportInfo() {
  const el = document.getElementById('exportInfo');
  if (el) el.textContent = `${STATE.filtered.length} baris akan diekspor (mode: ${STATE.mode === 'clean' ? 'Clean' : 'Raw'})`;
}

/* ============================================================
   8. UI HELPERS
============================================================ */

/* --- Toast --- */
function showToast(msg, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  const icons = { success:'✓', error:'✗', warning:'⚠', info:'ℹ' };
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span style="font-size:1rem;line-height:1">${icons[type]||'ℹ'}</span><span>${escHtml(msg)}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

/* --- Modal --- */
function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('hidden');
  // Focus first focusable
  setTimeout(() => {
    const focusable = el.querySelector('input:not([type=hidden]),select,button:not([disabled])');
    if (focusable) focusable.focus();
  }, 50);
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

// Close modals on overlay click or Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    ['crudModal','deleteModal'].forEach(id => {
      const el = document.getElementById(id);
      if (el && !el.classList.contains('hidden')) closeModal(id);
    });
  }
});
document.addEventListener('click', e => {
  ['crudModal','deleteModal'].forEach(id => {
    const el = document.getElementById(id);
    if (el && e.target === el) closeModal(id);
  });
});

/* --- Dark Mode --- */
function toggleDarkMode() {
  const html = document.documentElement;
  html.classList.toggle('dark');
  const dark = html.classList.contains('dark');
  localStorage.setItem('dw_darkMode', dark ? 'dark' : 'light');
  document.getElementById('iconSun').classList.toggle('hidden', !dark);
  document.getElementById('iconMoon').classList.toggle('hidden', dark);

  // Redraw charts with new colour scheme
  Object.keys(STATE.charts).forEach(id => {
    STATE.charts[id]?.destroy();
    delete STATE.charts[id];
  });
  renderCharts();
}

function initDarkMode() {
  const pref = localStorage.getItem('dw_darkMode') ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  if (pref === 'dark') {
    document.documentElement.classList.add('dark');
    document.getElementById('iconSun').classList.remove('hidden');
    document.getElementById('iconMoon').classList.add('hidden');
  }
}

/* --- Sidebar --- */
function toggleSidebar() {
  const sb  = document.getElementById('sidebar');
  const ov  = document.getElementById('sidebarOverlay');
  sb.classList.toggle('open');
  ov.classList.toggle('hidden');
}

/* --- Data Mode Toggle --- */
function setDataMode(mode) {
  STATE.mode = mode;
  updateModeUI();
  buildFilterOptions();
  applyFilters();
  saveToLocalStorage();

  if (mode === 'clean' && STATE.cleanData.length === 0) {
    showToast('Data belum dibersihkan. Gunakan tombol "Bersihkan Data" terlebih dahulu.', 'warning');
  }
}

function updateModeUI() {
  const btnRaw   = document.getElementById('btnRaw');
  const btnClean = document.getElementById('btnClean');
  btnRaw.classList.toggle('active-mode',   STATE.mode === 'raw');
  btnClean.classList.toggle('active-mode', STATE.mode === 'clean');
  btnRaw.setAttribute('aria-pressed',   STATE.mode === 'raw');
  btnClean.setAttribute('aria-pressed', STATE.mode === 'clean');
}

function updateCleanBanner() {
  const banner = document.getElementById('cleanBanner');
  if (!banner) return;
  banner.classList.toggle('hidden', STATE.mode === 'clean' || STATE.cleanData.length > 0);
}

/* --- Skeleton loader --- */
function showTableSkeleton(show) {
  const s = document.getElementById('tableSkeleton');
  const b = document.getElementById('tableBody');
  if (!s || !b) return;
  if (show) { s.classList.remove('hidden'); b.innerHTML = ''; }
  else       { s.classList.add('hidden'); }
}

/* --- Navigation highlight --- */
function initNavHighlight() {
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
      link.classList.add('active');
      // Update page title
      const label = link.textContent.trim();
      const pt    = document.getElementById('pageTitle');
      if (pt) pt.textContent = label;
      // Close sidebar on mobile
      if (window.innerWidth < 1024) {
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('sidebarOverlay').classList.add('hidden');
      }
    });
  });
}

/* --- Scroll spy for nav active state --- */
function initScrollSpy() {
  const sections = document.querySelectorAll('.page-section');
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.id;
        document.querySelectorAll('.nav-link').forEach(l => {
          const active = l.dataset.section === id;
          l.classList.toggle('active', active);
        });
      }
    });
  }, { threshold: 0.3 });
  sections.forEach(s => observer.observe(s));
}

/* ============================================================
   9. UTILITY FUNCTIONS
============================================================ */

function formatRp(n) {
  return 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
}

function formatRpShort(n) {
  if (n >= 1_000_000_000) return `Rp ${(n/1_000_000_000).toFixed(1)}M`;
  if (n >= 1_000_000)     return `Rp ${(n/1_000_000).toFixed(1)}jt`;
  if (n >= 1_000)         return `Rp ${(n/1_000).toFixed(0)}rb`;
  return `Rp ${n}`;
}

function formatMonth(ym) {
  const [y, m] = ym.split('-');
  const names  = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  return `${names[parseInt(m,10)-1]} ${y.slice(2)}`;
}

function toTitleCase(str) {
  if (!str) return '';
  return str.toString().trim().replace(/\w\S*/g, w =>
    w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  );
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

/* ============================================================
   10. INIT
============================================================ */

document.addEventListener('DOMContentLoaded', async () => {
  initDarkMode();
  initNavHighlight();
  initScrollSpy();
  await loadData();
  updateModeUI();
  updateExportInfo();
});
