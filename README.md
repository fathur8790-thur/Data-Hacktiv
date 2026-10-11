# Data Workbench 📊

Aplikasi manajemen dan analitik data penjualan modern yang dibangun dengan **HTML**, **Tailwind CSS**, dan **Vanilla JavaScript**.

---

## 🚀 Cara Menjalankan

### Prasyarat
- Browser modern (Chrome, Firefox, Edge, Safari)
- Ekstensi [Live Server](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer) (VS Code) **atau** server HTTP lokal lainnya

> ⚠️ Aplikasi harus dijalankan melalui web server (bukan buka langsung `index.html` dari file explorer) karena membutuhkan `fetch('data.json')`.

### Langkah

1. Buka folder `data-workbench/` di VS Code
2. Klik kanan `index.html` → **"Open with Live Server"**
3. Browser akan membuka `http://127.0.0.1:5500/`

**Alternatif (Python):**
```bash
cd data-workbench
python -m http.server 5500
# Buka http://localhost:5500
```

**Alternatif (Node.js):**
```bash
npx serve data-workbench
```

---

## 📁 Struktur File

```
data-workbench/
├── index.html     → Struktur HTML (sidebar, tabel, grafik, modal, chat panel)
├── style.css      → Custom styling (komplemen Tailwind CSS + Assistant UI)
├── script.js      → Logika aplikasi (modular, tanpa framework)
├── assistant.js   → AI Data Assistant (intent parser + Gemini API)
├── data.json      → 200 baris data penjualan mentah
└── README.md      → Dokumentasi ini
```

---

## ✨ Fitur Lengkap

### 🔄 Data Mode Toggle (Raw / Clean)
- **Raw Mode**: Tampilkan data asli dari `data.json` dengan badge peringatan untuk setiap masalah kualitas (duplikat, nilai kosong, negatif, outlier)
- **Clean Mode**: Tampilkan data yang sudah dibersihkan; ikon toggle di header atas

### 🧹 Data Cleaning Otomatis
Klik tombol **"Bersihkan Data"** untuk menjalankan pipeline pembersihan:
| Langkah | Deskripsi |
|---------|-----------|
| Standardisasi teks | Trim spasi + Title Case (region, kategori, dll) |
| Normalisasi tanggal | Semua format → `YYYY-MM-DD` |
| Isi nilai kosong | Median untuk angka, "Unknown" untuk teks |
| Perbaiki negatif | Nilai negatif diambil absolutnya |
| Hapus duplikat | Berdasarkan kombinasi tanggal+produk+sales_rep+jumlah |
| Tandai outlier | Metode IQR pada kolom `jumlah` dan `harga` |

### 📋 Tabel Data
- **Sorting**: Klik header kolom untuk sort asc/desc (indikator panah)
- **Pencarian global**: Cari di semua kolom sekaligus
- **Filter**: Per Region, Kategori, dan Metode Pembayaran
- **Pagination**: 10 baris per halaman dengan navigasi cerdas
- **Empty state**: Tampilan informatif saat tidak ada hasil

### ✏️ CRUD Lengkap
| Operasi | Cara |
|---------|------|
| **Create** | Tombol "Tambah Data" → isi form modal |
| **Read** | Tabel utama dengan sorting & filter |
| **Update** | Tombol "Edit" di setiap baris |
| **Delete** | Tombol "Hapus" → dialog konfirmasi |

Semua perubahan **tersimpan otomatis** di `localStorage` dan bertahan setelah refresh.

### 📊 Visualisasi (Chart.js)
| Grafik | Jenis | Deskripsi |
|--------|-------|-----------|
| Sales Trend per Bulan | Line / Bar / Pie *(switchable)* | Revenue bulanan sepanjang 2024 |
| Revenue per Region | Bar | Perbandingan pendapatan antar kota |
| Revenue per Kategori | Doughnut | Proporsi revenue per kategori produk |
| Top 10 Produk | Horizontal Bar | Produk dengan revenue tertinggi |
| Diskon vs Penjualan | Scatter | Korelasi besar diskon dengan revenue |
| Metode Pembayaran | Pie | Kontribusi setiap metode pembayaran |

Semua grafik **auto-update** ketika:
- Data di-CRUD
- Filter berubah
- Mode Raw/Clean diganti
- Dark mode diaktifkan

### 📥 Import Data
- Drag & drop atau klik area upload
- Mendukung format **CSV** dan **JSON**
- Preview 5 baris pertama sebelum konfirmasi
- Validasi kolom wajib

### 📤 Export Data
- Export data aktif (sesuai filter) ke **CSV** atau **JSON**
- Download grafik sebagai **PNG** (ikon ⬇ di pojok setiap grafik)

### 🌙 Dark Mode
- Toggle di header kanan atas
- Preferensi tersimpan di `localStorage`
- Semua grafik auto-refresh dengan skema warna baru

---

## 🗂️ Data Quality Issues (Data Mentah)

Data `data.json` sengaja mengandung masalah berikut untuk keperluan edukasi:

| Masalah | Contoh | Baris |
|---------|--------|-------|
| Duplikat | Baris 1 & 11 (data identik) | #1, #11, #196-200 |
| Format tanggal campur | `2024/01/10`, `10-01-2024`, `02/05/2024` | Tersebar |
| Huruf tidak konsisten | `"JAKARTA"`, `"jakarta"`, `"Jakarta"` | Tersebar |
| Spasi berlebih | `"  Doni Pratama  "` | Tersebar |
| Nilai negatif | `jumlah: -1`, `harga: -5500000` | #19, #162 |
| Outlier | `jumlah: 999` | #161 |
| Diskon > 1 | `diskon: 1.5` | #163 |
| Nilai kosong | `sales_rep: ""`, `produk: ""`, `tanggal: ""` | #165-173 |

---

## 🏗️ Arsitektur Kode (script.js)

```
script.js
├── STATE              → Objek pusat state aplikasi
├── loadData()         → Fetch data.json / localStorage
├── saveToLocalStorage()
├── resetData()        → Kembalikan ke data awal
├── cleanData()        → Pipeline pembersihan data otomatis
├── normaliseDate()    → Normalisasi format tanggal
├── applyFilters()     → Filter + sort + re-render
├── buildFilterOptions()
├── renderTable()      → Render tabel + pagination
├── CRUD functions     → openAddModal, openEditModal, submitCRUD, confirmDelete
├── renderCharts()     → Semua 6 grafik Chart.js
├── renderKPI()        → 5 KPI cards
├── switchMainChartType()
├── downloadChart()
├── exportCSV/JSON()
├── importCSV/JSON()
└── UI Helpers         → toast, modal, dark mode, sidebar
```

---

## 🤖 AI Data Assistant

### Cara Pakai

1. Klik tombol **💬** di pojok kanan bawah halaman
2. Panel chat akan terbuka dengan 5 contoh pertanyaan siap pakai
3. Ketik pertanyaan atau klik chip, tekan **Enter** untuk kirim
4. Klik **✕** di header panel atau tombol FAB untuk menutup

### Mode Default (Rule-based, tanpa API key)

Tidak perlu konfigurasi apapun — langsung bisa digunakan offline.

### Mode AI (Gemini API — opsional)

1. Klik ikon ⚙️ di header panel chat
2. Masukkan API key Gemini (dapatkan gratis di [Google AI Studio](https://aistudio.google.com/app/apikey))
3. Centang "Aktifkan AI Mode" → klik **Simpan**
4. Badge di header berubah jadi **✨ AI**
5. Jika API error, sistem otomatis fallback ke mode aturan

> API key **hanya tersimpan di `localStorage` browser Anda** — tidak pernah dikirim ke server manapun selain Google API.

### Pertanyaan yang Didukung

| Kategori | Contoh |
|----------|--------|
| **Statistik dasar** | "Berapa total revenue?" · "Total transaksi?" · "Total quantity?" |
| **Analisis region** | "Region mana yang paling tinggi?" · "Bandingkan Jakarta dan Bandung" |
| **Produk** | "Produk terlaris apa?" · "Top 10 produk?" · "Produk termahal?" |
| **Kategori & Sales** | "Kategori terlaris?" · "Top 5 sales rep?" · "Metode pembayaran terpopuler?" |
| **Tren** | "Tren penjualan per bulan?" · "Revenue per region?" |
| **Kualitas data** | "Bagaimana kualitas data?" · "Berapa duplikat?" · "Ada nilai kosong?" · "Outlier?" |
| **Ringkasan** | "Ringkasan data" · "Overview" |

### Perintah Aksi (mengubah data/tampilan)

| Perintah | Efek |
|---------|------|
| `bersihkan data` | Menjalankan pipeline data cleaning |
| `filter region Jakarta` | Menerapkan filter region |
| `filter kategori Elektronik` | Menerapkan filter kategori |
| `hapus filter` | Menghapus semua filter aktif |
| `urutkan berdasarkan revenue` | Sort kolom harga desc |
| `urutkan berdasarkan tanggal` | Sort kolom tanggal desc |
| `export ke CSV` | Mengunduh file CSV |
| `export ke JSON` | Mengunduh file JSON |
| `tampilkan grafik tren` | Scroll ke seksi Visualisasi |

### Arsitektur assistant.js

```
assistant.js
├── ASST               → State chat (history, apiKey, aiMode)
├── toggleAssistant()  → Buka/tutup panel
├── sendMessage()      → Router: rule-based atau Gemini
├── parseIntent()      → Regex/keyword engine (30+ intents)
├── Intent Handlers    → intentTotalRevenue, intentTopRegion, dll.
├── Action Handlers    → intentCleanData, intentFilterRegion, dll.
├── callGemini()       → Gemini API + 3-layer system prompt
├── buildDataContext() → Ringkasan statistik (bukan raw rows)
├── Settings Panel     → saveAsstSettings, toggleAsstSettings
└── Persistence        → loadAsstHistory, saveAsstHistory
```

---

## 🏗️ Arsitektur Kode (script.js)

```
script.js
├── STATE              → Objek pusat state aplikasi
├── loadData()         → Fetch data.json / localStorage
├── saveToLocalStorage()
├── resetData()        → Kembalikan ke data awal
├── cleanData()        → Pipeline pembersihan data otomatis
├── normaliseDate()    → Normalisasi format tanggal
├── applyFilters()     → Filter + sort + re-render
├── buildFilterOptions()
├── renderTable()      → Render tabel + pagination
├── CRUD functions     → openAddModal, openEditModal, submitCRUD, confirmDelete
├── renderCharts()     → Semua 6 grafik Chart.js
├── renderKPI()        → 5 KPI cards
├── switchMainChartType()
├── downloadChart()
├── exportCSV/JSON()
├── importCSV/JSON()
└── UI Helpers         → toast, modal, dark mode, sidebar
```

---

## 🛠️ Teknologi

- **HTML5** – Semantik, aksesibel (ARIA labels, keyboard navigation)
- **Tailwind CSS v3** (CDN) – Utility-first styling
- **Chart.js v4** (CDN) – Visualisasi data interaktif
- **Vanilla JavaScript** – ES6+, modular, tanpa framework
- **Gemini API** (opsional) – Google Generative Language AI
- **localStorage** – Persistensi data di browser

---

## ♿ Aksesibilitas

- Semua form input memiliki `<label>` yang terhubung
- Tombol memiliki `aria-label` yang deskriptif
- Modal menggunakan `role="dialog"` dan `aria-modal`
- Dark mode mempertahankan kontras WCAG AA
- Keyboard navigation: `Tab` untuk navigasi, `Escape` untuk tutup modal

---

*Dibuat sebagai contoh aplikasi Data Workbench dengan HTML + Tailwind CSS + Chart.js*
