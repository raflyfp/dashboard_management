# 📊 Management Monitoring Dashboard (Express.js)

Dashboard monitoring real-time untuk manajemen operasional yang menampilkan performa layanan **IT**, **Teknik**, dan **General Affairs (GA)**. Dirancang khusus untuk tampilan **Layar TV Besar (TV Wall Display / Ruang Rapat / Ruang Manajemen)** dengan antarmuka modern (Dark Glassmorphism).

---

## 🌟 Fitur Utama

1. **10 Card Monitoring Terpadu (Format 5x2)**:
   - **Baris 1 (5 Card)**:
     - 💻 **Layanan IT** *(Live Ticketing API)*: Software, Jaringan & Hardware.
     - 🔧 **Layanan Teknik** *(Live Ticketing API)*: Maintenance Mesin Pabrik, Utilitas & Listrik.
     - 🏢 **Layanan GA** *(Live Ticketing API)*: Sarana Prasarana, Gedung & Fasilitas Umum.
     - 💡 **Pelaporan Kaizen** *(Aplikasi Kaizen)*: Continuous Improvement & Ide Karyawan.
     - 🖥️ **E-System ERP** *(Aplikasi E-System)*: Enterprise Core System & Logistik.
   - **Baris 2 (5 Card)**:
     - 🏥 **SIMRS & EMR** *(Aplikasi SIMRS)*: Rekam Medis Elektronik & Pasien.
     - 💊 **Farmasi & Obat** *(Aplikasi Farmasi)*: Resep, Stok Obat & Distribusi Depo.
     - 🧪 **Lab & Diagnostik** *(Aplikasi LIS/RIS)*: Pemeriksaan Laboratorium & Radiologi.
     - 💳 **Keuangan & Kasir** *(Aplikasi Billing)*: Kasir, Billing & Klaim BPJS.
     - 👔 **SDM & Personalia** *(Aplikasi HRD)*: Kehadiran, Presensi & Cuti Karyawan.

2. **Indikator KPI di Setiap Card**:
   - ⭕ **Circular Progress Gauge**: Persentase tiket selesai (`XX.X%`).
   - 📁 **Total Semua Tiket**: Akumulasi tiket pada masing-masing layanan.
   - ✅ **Tiket Selesai**: Jumlah tiket dengan status `closed` atau `done`.
   - ⏳ **Tiket Belum Selesai**: Jumlah tiket yang masih dalam proses (`open`, `checking`, `in_progress`, dll).
   - 📊 **Mini Breakdown Bar**: Proporsi status tiket aktif (Open, In Progress, Checking).
   - 📋 **Modal Daftar Tiket Interaktif**: Klik tombol *"Lihat Daftar Tiket"* untuk membuka tabel rincian tiket lengkap dengan filter tab (*Semua Tiket*, *Selesai*, *Belum Selesai*) serta kotak pencarian instan.

3. **Optimal untuk Layar Besar (TV Display)**:
   - 🕒 **Digital Clock & Tanggal Live**: Jam besar real-time berstandar WIB dengan tanggal Bahasa Indonesia.
   - 🔄 **Auto-Polling 15 Detik**: Sinkronisasi otomatis data secara background dilengkapi indikator visual hitung mundur (*countdown*).
   - 🖥️ **Mode Layar Penuh (Fullscreen)**: Tombol expand untuk menghilangkan navbar browser di Smart TV.
   - 🚨 **Running Attention Ticker**: Marquee berjalan di bagian bawah layar yang secara otomatis menampilkan tiket darurat / tiket yang menggantung paling lama.
   - ⚡ **In-Memory Cache Resilient**: Express menyimpan cache ringan (5 detik) sehingga server ticketing Laravel tidak terbebani saat diakses banyak layar monitor.

---

## 📁 Struktur Folder Project

Struktur dibuat bersih dan terstandarisasi agar sangat mudah dipahami programmer junior:

```text
dashboard_management/
├── .env                     # File konfigurasi utama (Port, API URL, API Key)
├── .env.example             # Contoh template konfigurasi
├── package.json             # Dependensi Node.js (express, axios, dotenv)
├── server.js                # Backend Express (API Proxy, Cache, Static Hosting)
├── public/                  # Frontend Web Statis
│   ├── index.html           # Struktur layout HTML5 dashboard
│   ├── css/
│   │   └── style.css        # Desain visual, dark mode, animasi & responsif
│   └── js/
│       └── app.js           # Logika frontend, auto-polling, counter, modal
└── README.md                # Panduan dokumentasi lengkap
```

---

## ⚙️ Konfigurasi (`.env`)

File [`.env`](file:///c:/laragon/www/dashboard_management/.env) menyimpan parameter konfigurasi:

```env
# Port tempat aplikasi Dashboard Express berjalan
PORT=3000

# Base URL API Ticketing Laravel (di Laragon)
TICKETING_API_URL=http://127.0.0.1:8002/api/v1

# API Key resmi sistem ticketing
TICKETING_API_KEY=tk_live_UQ6LbgRmq2dSldzeTuSkZbAezAr1aDaV

# Durasi Cache internal Express (detik) untuk efisiensi beban server
CACHE_TTL_SECONDS=5

# Interval auto-refresh data di layar TV/browser (detik)
REFRESH_INTERVAL_SECONDS=15
```

---

## 🚀 Cara Menjalankan Aplikasi

### 1. Pastikan Server Ticketing (Laravel) Aktif
Pastikan aplikasi Laravel di Laragon berjalan (default port `8002`):
- Health check URL: `http://127.0.0.1:8002/api/v1/ping`

### 2. Menjalankan Dashboard Express
Buka terminal di folder project `c:\laragon\www\dashboard_management`:

```bash
# Menjalankan server
node server.js
```

Atau menggunakan npm:
```bash
npm start
```

### 3. Membuka di Browser / Layar TV
- **Di Komputer Lokal**: Buka `http://localhost:3000`
- **Di Layar TV / Smart TV / Komputer Lain dalam 1 Jaringan Wi-Fi/LAN**:
  1. Cek alamat IP komputer server (misal: `192.168.1.50`).
  2. Buka browser di Smart TV dan ketik: `http://192.168.1.50:3000`
  3. Klik tombol **Fullscreen** di pojok kanan atas dashboard untuk tampilan TV tanpa batas.

---

## 🛠️ Panduan Maintenance untuk Developer Junior

### 1. Bagaimana jika alamat API Ticketing atau API Key berubah?
Cukup buka file [`.env`](file:///c:/laragon/www/dashboard_management/.env) dan ubah baris `TICKETING_API_URL` atau `TICKETING_API_KEY`. **Tidak perlu mengubah kode di dalam `server.js`!**

### 2. Bagaimana cara mengubah kecepatan auto-refresh?
Ubah nilai `REFRESH_INTERVAL_SECONDS` di [`.env`](file:///c:/laragon/www/dashboard_management/.env) (misal: ubah menjadi `10` untuk 10 detik atau `30` untuk 30 detik), lalu restart server.

### 3. Menambah Card Layanan Baru di Masa Depan
Jika manajemen ingin menambah divisi lain (misal: **HRD** atau **Purchasing**):
1. Tambahkan kode divisi di objek `servicesResult` pada [server.js](file:///c:/laragon/www/dashboard_management/server.js).
2. Tambahkan satu blok `<section class="service-card">` baru di [public/index.html](file:///c:/laragon/www/dashboard_management/public/index.html).
3. Tambahkan kode divisinya di array `services` di dalam fungsi `renderServiceCards()` pada [public/js/app.js](file:///c:/laragon/www/dashboard_management/public/js/app.js).

---

## 🔌 Dokumentasi REST API Internal Express

| Endpoint | Method | Keterangan |
| :--- | :--- | :--- |
| `/api/dashboard/stats` | `GET` | Mengambil data akumulasi KPI 3 card (IT, Teknik, GA) beserta tiket darurat |
| `/api/dashboard/tickets` | `GET` | Mengambil daftar tiket dengan query `?service=IT&status=selesai&limit=50` |
| `/api/dashboard/config` | `GET` | Mengambil pengaturan frontend (interval refresh, warna tema layanan) |
| `/api/health` | `GET` | Health check koneksi Express dan API Laravel Ticketing |
