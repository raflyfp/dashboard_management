# 📊 SNA Medika — Management Monitoring Dashboard

Dashboard Monitoring Operasional Terpadu **PT. Sinaraya Nugraha Ahmadaris Medika (SNA Medika)** berbasis **Node.js (Express)** & **Vanilla JS**. Menampilkan **21 Kartu KPI Departemen/Lini secara Live** yang terintegrasi langsung dengan **5 Sistem Eksternal**:
1. **Atena ERP REST API** (`https://erpsna.atena.id/API/Dashboard/`)
2. **Aplikasi Paperless Document Control** (`http://snam.ddns.net:8069/`)
3. **Aplikasi Helpdesk Ticketing** (`https://www.snam110.dpdns.org/helpdesk/api/monitoring`)
4. **Aplikasi E-Subcon** (`https://www.snam110.dpdns.org/e-subcon/api/monitoring`)
5. **Google Spreadsheet R&D / Development BOM** (Live CSV Feed)

---

## 📑 Daftar Isi
1. [Arsitektur & Alur Data Sistem](#-1-arsitektur--alur-data-sistem)
2. [Penjelasan Lengkap Modul DC (Document Control - Paperless)](#-2-penjelasan-lengkap-modul-dc-document-control---paperless)
3. [Dokumentasi Teknis Seluruh 21 Kartu Monitoring (Sumber & Rumus Pengolahan Data)](#-3-dokumentasi-teknis-seluruh-21-kartu-monitoring-sumber--rumus-pengolahan-data)
4. [Strategi Caching, Fallback Offline & Optimasi Performa](#-4-strategi-caching-fallback-offline--optimasi-performa)
5. [Struktur Folder Project](#-5-struktur-folder-project)
6. [Konfigurasi & Cara Menjalankan](#-6-konfigurasi--cara-menjalankan)

---

## 🏗️ 1. Arsitektur & Alur Data Sistem

```text
[ Browser / Smart TV Display ]
       │
       ├── GET /api/dashboard/stats?bulan=MM&tahun=YYYY (Auto-Polling 15 Detik & Filter Periode Bulan)
       └── GET /api/dashboard/<modul>                   (Data Detail Modal Interaktif, Filter & Pagination)
       │
       ▼
[ Express.js Server (routes/dashboardRoutes.js) ]
       │
       ├── 1. ticketingService.js   ──► Helpdesk Ticketing API (GA, Teknik, IT)
       ├── 2. produksiService.js    ──► Atena ERP API: PenyelesaianPP (8 Lini Produksi)
       ├── 3. purchasingService.js  ──► Atena ERP API: PemenuhanPR (Material & Non-Material)
       ├── 4. qaService.js          ──► Atena ERP API: ReleaseMaterial, ReleaseProdukJadi, JurnalBatchRecord
       ├── 5. logistikService.js    ──► Atena ERP API: PemenuhanOrder (Berbasis Rincian Item Terpenuhi)
       ├── 6. whFgService.js        ──► Atena ERP API: PenyelesaianDR (Gudang Barang Jadi)
       ├── 7. whMatService.js       ──► Atena ERP API: PemenuhanWHMat (MR Bahan & DR Paskot/Lain)
       ├── 8. pbfService.js         ──► Atena ERP API: PemenuhanOrderPBF (Distribusi Farmasi)
       ├── 9. hrService.js          ──► Atena ERP API: KehadiranTK (TK SNA & Marketing)
       ├── 10. dcService.js         ──► Paperless Web API: PengesahanDokumen (Pengajuan Masuk vs Pengesahan Dibuat)
       ├── 11. developmentService.js──► Google Spreadsheet CSV: Monitoring Permintaan BOM R&D
       └── 12. subconService.js     ──► E-Subcon API: Output Hasil Produksi PCS & Mitra Subcon
```

---

## 📄 2. Penjelasan Lengkap Modul DC (Document Control - Paperless)

File Service: [`services/dcService.js`](file:///c:/laragon/www/dashboard_management/services/dcService.js)  
File Cache: [`data/dc_paperless_cache.json`](file:///c:/laragon/www/dashboard_management/data/dc_paperless_cache.json)  
Server Sumber: `http://snam.ddns.net:8069/`

### A. Alur Bisnis Dokumen di Aplikasi Paperless SNA Medika
Di dalam aplikasi Paperless (`http://snam.ddns.net:8069/`), siklus dokumen terbagi menjadi **2 tahap utama**:
1. **Tahap Internal Departemen Pemohon (Menu *Pengajuan Dokumen*)**:
   - Staf departemen mengajukan dokumen baru/revisi, lalu menunggu persetujuan (*Diketahui*, *Diperiksa*, *Disetujui*) dari Supervisor/Manager/Direktur departemen terkait.
   - Selama masih menunggu persetujuan internal departemen, dokumen **belum masuk ke meja Document Control (DC)** sehingga **tidak dihitung sebagai beban/tunggakan kerja DC**.
2. **Tahap Pengerjaan Document Control (Menu *Pengesahan Dokumen* — `kode=TRNS3`)**:
   - Begitu pengajuan disetujui penuh oleh pimpinan (`ubahstatus = 1`), dokumen otomatis masuk ke menu **Pengesahan Dokumen (`TRNS3`)** milik akun **Document Controller**.
   - Di menu **Pengesahan Dokumen (`TRNS3`)** terdapat **2 Tab**:
     - **Tab 1: `Pengajuan Masuk`** → Dokumen yang sudah selesai di-approve pimpinan dan **masuk ke meja DC**, tetapi **belum dibuatkan pengesahan oleh DC**.
     - **Tab 2: `Pengesahan Dibuat`** → Dokumen yang **sudah dikerjakan oleh DC** (sudah diberikan **Nomor Klausul**, **Nomor Revisi**, **Tanggal Pengerjaan**, dan diunggah dokumen terkendalinya untuk disahkan).

### B. Proses Pengambilan Data (Technical Fetching Flow)
1. **Autentikasi Sesi (`getWebSessionCookie`)**:
   - Melakukan `POST /Auth/Login/cekLogin` (`application/x-www-form-urlencoded`) menggunakan kredensial dari environment variable (`PAPERLESS_API_USERNAME` & `PAPERLESS_API_PASSWORD`).
   - Menyimpan cookie `ci_session` dari header `set-cookie` di memori selama 1 jam (auto re-login jika expired).
2. **Penarikan Daftar Master Jenis Dokumen**:
   - Melakukan `POST http://snam.ddns.net:8069/Master/Data/JenisDokumen/comboGrid` untuk mendapatkan daftar 20 UUID jenis dokumen (`BATCH RECORD`, `FORMULIR`, `WORK INSTRUCTION`, `QUALITY PROCEDURE`, `QUALITY MANUAL`, `JOB DESCRIPTION`, `IBAL`, `DICM`, dll.).
3. **Penarikan Paralel 2 Tab Pengesahan Dokumen (`fetchLiveRows`)**:
   - Untuk setiap `uuidjenisdokumen`, sistem memanggil secara paralel:
     1. **`POST /Transaksi/Transaksi/PengesahanDokumen/dataGrid`** (*Tab Pengesahan Dibuat*):
        - Parameter: `page: 1, limit: 2500, jenis: 'pengajuan', kodemenu: 'TRNS3', uuidjenisdokumen: <id>`
     2. **`POST /Transaksi/Transaksi/PengesahanDokumen/dataGridDokumenMasuk`** (*Tab Pengajuan Masuk*):
        - Parameter: `page: 1, limit: 2500, uuidjenisdokumen: <id>`

### C. Aturan Pengolahan, Pemetaan Field & Rumus KPI DC
1. **Penyaringan Data Valid**:
   - Mengabaikan dokumen yang **dibatalkan** (`status === 'D'` atau `userbatal !== null`) dan dokumen yang **ditolak** (`status === 'R'` atau `ubahstatus === '2'`).
2. **Klasifikasi Status Penyelesaian DC**:
   - **Selesai (`status: 'SELESAI'`, `is_selesai: true`)**:
     - Seluruh dokumen valid pada **Tab `Pengesahan Dibuat` (`dataGrid`)**, karena DC telah menyelesaikan pembuatan pengesahan dokumen tersebut (`tglpengerjaan` & `kodepengesahandokumen` telah terbit).
     - Keterangan `tahap`:
       - Jika `ubahstatus === '1'`: `"Selesai (Disahkan oleh <lastuserapprove>)"`
       - Jika `ubahstatus === '0'`: `"Pengesahan Dibuat DC (<tglpengerjaan>) - Sirkulasi Approval"`
   - **Belum Selesai (`status: 'BELUM SELESAI'`, `is_selesai: false`)**:
     - Seluruh dokumen valid pada **Tab `Pengajuan Masuk` (`dataGridDokumenMasuk`)**, yaitu dokumen yang sudah masuk ke meja DC namun belum dibuatkan pengesahan oleh DC.
     - Keterangan `tahap`: `"Pengajuan Masuk DC (Disetujui <lastuserapprove>) - Menunggu Pengesahan DC"`
3. **Pemetaan Kolom Tabel Modal DC**:
   - `tgl_permohonan`: `row.tglpermohonan` (format `YYYY-MM-DD`, digunakan sebagai acuan filter periode bulan/tanggal).
   - `bagian`: `row.bagian` (departemen asli pemohon seperti `QA`, `GA`, `WAREHOUSE`, `MRDC`, `SUPERVISOR ORTHOPAEDIC`).
   - `jenis_dokumen`: `row.namajenisdokumen`.
   - `nomor_klausul`: `row.kodepengesahandokumen || row.nomorklausul || row.kodepengajuandokumen`.
   - `nama_dokumen`: `row.namapengajuandokumen`.
   - `nomor_revisi`: `row.norevisi || row.nomorrevisidokumen`.
4. **Rumus Persentase KPI DC**:
   $$\text{Total Masuk DC} = \text{Jumlah Pengesahan Dibuat} + \text{Jumlah Pengajuan Masuk DC}$$
   $$\text{Persentase Selesai (\%)} = \left(\frac{\text{Jumlah Pengesahan Dibuat}}{\text{Total Masuk DC}}\right) \times 100\%$$
   - *Contoh Oktober 2026 (`2026-10-01` s/d `2026-10-31`)*:
     - Pengesahan Dibuat (Selesai): **25 Dokumen**
     - Pengajuan Masuk (Belum Selesai): **1 Dokumen**
     - Total Masuk DC: **26 Dokumen** → Persentase: **`25 / 26 = 96,15%`**

---

## 📊 3. Dokumentasi Teknis Seluruh 21 Kartu Monitoring (Sumber & Rumus Pengolahan Data)

### 1–3. Layanan GA, Teknik (Mekanik), dan IT
- **Service**: [`services/ticketingService.js`](file:///c:/laragon/www/dashboard_management/services/ticketingService.js)
- **Sumber Data**: Helpdesk Ticketing API (`GET /helpdesk/api/monitoring`)
- **Pengolahan Data**:
  - Menyaring daftar tiket berdasarkan kode layanan (`GA`, `TEKNIK`, `IT`) dan rentang tanggal pembuatan tiket (`created_at` / `tanggal`) sesuai bulan & tahun yang dipilih.
  - Status tiket dibagi menjadi:
    - **Selesai**: `closed`, `done`, `selesai`, `resolved`
    - **Ditolak**: `rejected`, `ditolak`, `cancel`
    - **Belum Selesai (Proses)**: `open`, `in_progress`, `checking`, `pending`, `waiting`
  - **Rumus Persentase** (Tiket ditolak tidak masuk pembagi efektif):
    $$\text{Total Efektif} = \text{Total Tiket} - \text{Tiket Ditolak}$$
    $$\text{Persentase Selesai (\%)} = \left(\frac{\text{Tiket Selesai}}{\text{Total Efektif}}\right) \times 100\%$$

---

### 4–11. Delapan (8) Lini Produksi Atena ERP
- **Service**: [`services/produksiService.js`](file:///c:/laragon/www/dashboard_management/services/produksiService.js)
- **Sumber Data**: Atena ERP REST API
  - Login: `POST https://erpsna.atena.id/API/Dashboard/Auth/login` (Bearer Token JWT)
  - Ringkasan: `POST PenyelesaianPP/ringkasan` (`{ bagian, tglawal, tglakhir }`)
  - Detail: `POST PenyelesaianPP/detail` (`{ bagian, tglawal, tglakhir }`)
- **Pemetaan 8 Kartu Lini & Tahap Pekerjaan**:
  | No Urut | ID Kartu | Nama Kartu | Parameter `bagian` API | Label Tahap Pekerjaan |
  | :---: | :--- | :--- | :--- | :--- |
  | 4 | `PROD_FINISHING` | Produksi Finishing | `stentor` | `STENTOR` |
  | 5 | `PROD_ANTISEPTIK` | Produksi Antiseptik | `packing` | `PACKING` |
  | 6 | `PROD_CW` | Produksi Cotton Wool (CW) | `cw` | `CW PACKING` |
  | 7 | `PROD_SIZING` | Produksi Sizing | `sizing` | `SIZING` |
  | 8 | `PROD_POLIGYP` | Produksi Poligyp | `poligyp` | `POLIGYP PACKING` |
  | 9 | `PROD_IRONING` | Produksi Ironing | `ironing` | `IRONING` |
  | 10 | `PROD_SURGICAL_MESIN` | Produksi Surgical Mesin | `surgical_mesin` | `SURGICAL MESIN` |
  | 11 | `PROD_SURGICAL_PACKING` | Produksi Surgical Packing | `surgical_packing` | `SURGICAL PACKING` |
- **Pengolahan Data**:
  - Membandingkan jumlah Perintah Produksi (**Target Plan PP**) terhadap realisasi hasil produksi (**Actual PRH**).
  - Suatu item/nomor PP berstatus **Memenuhi** apabila `realisasi >= target` (atau `status === 'MEMENUHI'`).
  - **Rumus Persentase**:
    $$\text{Persentase (\%)} = \left(\frac{\text{PP Memenuhi}}{\text{Total PP}}\right) \times 100\%$$

---

### 12. Purchasing (Pemenuhan PR Material & Non-Material)
- **Service**: [`services/purchasingService.js`](file:///c:/laragon/www/dashboard_management/services/purchasingService.js)
- **Sumber Data**: Atena ERP REST API
  - `POST PemenuhanPR/ringkasan` & `POST PemenuhanPR/detail` dengan `bagian: "material"` dan `bagian: "nonmaterial"`.
- **Pengolahan Data**:
  - Mengelompokkan baris item PR berdasarkan nomor dokumen `no_pr` (`kodepr`) serta menyediakan tampilan rincian per item barang (`kode_barang`, `nama_barang`, `qty_request`, `qty_po`, `qty_grs`, `qty_os`).
  - Menampilkan Dual-Hero KPI pada kartu dashboard:
    1. **PR Material**: Persentase pemenuhan PR Material (`pr_terpenuhi / total_pr`).
    2. **PR Non-Material**: Persentase pemenuhan PR Non-Material (`pr_terpenuhi / total_pr`).
  - Pada level rincian item di modal, persentase pemenuhan item dihitung dari:
    $$\text{Pemenuhan Item (\%)} = \left(\frac{\text{Realisasi GRS}}{\text{Realisasi GRS} + \text{Sisa OS}}\right) \times 100\%$$

---

### 13. Quality Assurance / QA (GRS, SCN & Accept Batch Record)
- **Service**: [`services/qaService.js`](file:///c:/laragon/www/dashboard_management/services/qaService.js)
- **Sumber Data**: Atena ERP REST API (3 Endpoint berbeda):
  1. **Release Material (GRS)**: `POST ReleaseMaterial/ringkasan` & `POST ReleaseMaterial/detail`
  2. **Release Produk Jadi Subcon (SCN)**: `POST ReleaseProdukJadi/ringkasan` & `POST ReleaseProdukJadi/detail`
  3. **Accept Batch Record (Acc BR)**: `POST JurnalBatchRecord/ringkasan` & `POST JurnalBatchRecord/detail`
- **Pengolahan Data**:
  - Menampilkan Triple-Hero KPI di kartu QA:
    - **GRS**: Persentase barang datang (`GRS`) yang sudah di-approve/release oleh QC (`sudah_approve / total_grs`).
    - **SCN**: Persentase transaksi Subcon (`SCN`) yang sudah di-approve QC (`sudah_approve / total_scn`).
    - **Acc BR**: Persentase transaksi hasil produksi (`PRH`) yang sudah memiliki Batch Record (`sudah_ada_br / total_prh`).

---

### 14. Logistik (Pemenuhan Order Pengiriman)
- **Service**: [`services/logistikService.js`](file:///c:/laragon/www/dashboard_management/services/logistikService.js)
- **Sumber Data**: Atena ERP REST API (`POST PemenuhanOrder/ringkasan` & `POST PemenuhanOrder/detail`)
- **Pengolahan Data**:
  - Setiap Sales Order (`SO`) terdiri dari satu atau beberapa **Rincian Item Barang** (`items`).
  - Setiap baris item barang berstatus **Memenuhi (`is_memenuhi: true`)** apabila `status === 'MEMENUHI'` atau `terpenuhi >= jml` (dan `sisa <= 0`).
  - **Rumus Persentase Utama (Berbasis Rincian Item Barang Terpenuhi)**:
    $$\text{Persentase Selesai (\%)} = \left(\frac{\text{Jumlah Item Barang Memenuhi}}{\text{Total Rincian Item Barang}}\right) \times 100\%$$
  - *Contoh Oktober 2026*: Dari `863` rincian item barang (dalam `194` SO), terdapat `829` item memenuhi dan `34` item belum memenuhi → **`829 / 863 = 96,06%`**.

---

### 15. WH FG — Gudang Barang Jadi (Penyelesaian DR)
- **Service**: [`services/whFgService.js`](file:///c:/laragon/www/dashboard_management/services/whFgService.js)
- **Sumber Data**: Atena ERP REST API (`POST PenyelesaianDR/ringkasan` & `POST PenyelesaianDR/detail`)
- **Pengolahan Data**:
  - Memantau penyelesaian dokumen **Delivery Receipt (DR)** di Gudang Barang Jadi hingga diterbitkan menjadi **Delivery Note (DN / Surat Jalan)**.
  - **Rumus Persentase**:
    $$\text{Persentase Selesai (\%)} = \left(\frac{\text{DR Sudah DN}}{\text{Total DR}}\right) \times 100\%$$

---

### 16. WH Mat — Gudang Bahan (Pemenuhan MR & DR Paskot/Lain)
- **Service**: [`services/whMatService.js`](file:///c:/laragon/www/dashboard_management/services/whMatService.js)
- **Sumber Data**: Atena ERP REST API (`POST PemenuhanWHMat/ringkasan` & `POST PemenuhanWHMat/detail` untuk `bagian: "mr"` dan `bagian: "dr"`)
- **Pengolahan Data**:
  - Menampilkan Dual-Hero KPI pada kartu Gudang Bahan:
    1. **MR Bahan (`bagian: "mr"`)**: Pemenuhan Material Request (permintaan bahan baku/kemas ke gudang) yang sudah ditransfer & diterima (`mr_terpenuhi / total_mr`).
    2. **DR Paskot / Lain (`bagian: "dr"`)**: Penyelesaian Delivery Receipt cabang/subcon (`dr_sudah_dn / total_dr`).

---

### 17. PBF — Distribusi Farmasi (Pemenuhan Order +7 Hari)
- **Service**: [`services/pbfService.js`](file:///c:/laragon/www/dashboard_management/services/pbfService.js)
- **Sumber Data**: Atena ERP REST API (`POST PemenuhanOrderPBF/ringkasan` & `POST PemenuhanOrderPBF/detail`)
- **Pengolahan Data**:
  - Memantau pemenuhan Sales Order distribusi PBF dibandingkan pengiriman Surat Jalan (`no_surat_jalan`) dengan indikator *leadtime* SLA H+7.
  - **Rumus Persentase**:
    $$\text{Persentase Selesai (\%)} = \left(\frac{\text{Order PBF Memenuhi}}{\text{Total Order PBF}}\right) \times 100\%$$

---

### 18. HR — Kehadiran Karyawan (TK SNA & Marketing)
- **Service**: [`services/hrService.js`](file:///c:/laragon/www/dashboard_management/services/hrService.js)
- **Sumber Data**: Atena ERP REST API (`POST KehadiranTK/ringkasan` & `POST KehadiranTK/detail` untuk `bagian: "tksna"` dan `bagian: "marketing"`)
- **Pengolahan Data**:
  - Membandingkan jadwal shift rencana (`plan`, misal `S1`, `S2`, `S3`, `OFF`) dengan kehadiran aktual (`aktual` & `jam_scan`).
  - Baris jadwal berstatus **Sesuai Plan (`is_sesuai: true`)** apabila `status === 'SESUAI'` (hadir tepat waktu sesuai shift dan tidak terlambat/alpha).
  - Menampilkan Dual-Hero KPI:
    1. **TK SNA**: `(jadwal_sesuai / total_jadwal) * 100%`
    2. **Marketing / Non-SNAM**: `(jadwal_sesuai / total_jadwal) * 100%`

---

### 19. DC — Document Control (Paperless)
- **Service**: [`services/dcService.js`](file:///c:/laragon/www/dashboard_management/services/dcService.js)
- **Sumber Data**: Aplikasi Paperless SNA Medika (`http://snam.ddns.net:8069/`)
- **Ringkasan**: Membandingkan dokumen pada **Tab `Pengesahan Dibuat`** vs **Tab `Pengajuan Masuk`** di menu **Pengesahan Dokumen (`TRNS3`)**. Lihat [Bagian 2](#-2-penjelasan-lengkap-modul-dc-document-control---paperless) untuk detail lengkap.

---

### 20. Development / R&D (Penyelesaian Permintaan BOM H+2)
- **Service**: [`services/developmentService.js`](file:///c:/laragon/www/dashboard_management/services/developmentService.js)
- **Sumber Data**: Google Spreadsheet CSV Live (`DEVELOPMENT_SPREADSHEET_URL`)
- **Pengolahan Data**:
  - Mem-parsing baris CSV permintaan pembuatan BOM Baru maupun Perubahan BOM.
  - Mengklasifikasikan status menjadi:
    - **Complete / Selesai (`is_selesai: true`)**: Status `COMPLETE` / `SELESAI` / `DONE`.
    - **On Progress (`is_on_progress: true`)**: Status `ON PROGRESS` / `PROSES` / kosong.
    - **Blocked (`is_blocked: true`)**: Status `BLOCKED` / `HOLD` / `PENDING`.
  - Menghitung selisih hari pengerjaan (`lama_proses_hari`) terhadap target SLA maksimal H+2.

---

### 21. Monitoring Pengerjaan Subcon
- **Service**: [`services/subconService.js`](file:///c:/laragon/www/dashboard_management/services/subconService.js)
- **Sumber Data**: E-Subcon API (`GET /e-subcon/api/monitoring`)
- **Pengolahan Data**:
  - Menampilkan **Total Output Produksi (PCS)**, **Total Durasi Pengerjaan**, **Jumlah Mitra Subcon Aktif**, serta **Persentase Keaktifan Pengisian Karyawan Subcon** (`sudah_mengisi / total_karyawan_aktif`).

---

## ⚡ 4. Strategi Caching, Fallback Offline & Optimasi Performa

Untuk memastikan dashboard berjalan mulus di layar TV maupun saat berpindah periode bulan tanpa membebani server ERP/Paperless:
1. **Multi-Layer In-Memory Cache (`statsMap` per `YYYY_MM`)**:
   - [`routes/dashboardRoutes.js`](file:///c:/laragon/www/dashboard_management/routes/dashboardRoutes.js) menyimpan *snapshot* respons per periode bulan (`2026_10`, `2026_11`, dst.).
2. **Stale-While-Revalidate pada Modul Arsip (`dcService.js` & `developmentService.js`)**:
   - Seluruh 3.624 dokumen Paperless dan data BOM disimpan di memori (`cache.liveRows`) saat startup dari [`data/dc_paperless_cache.json`](file:///c:/laragon/www/dashboard_management/data/dc_paperless_cache.json).
   - Saat pengguna mengganti bulan (misal ke Oktober 2026), penyaringan dilakukan langsung di memori dalam **`< 5 ms`**, sementara pembaruan ke server Paperless dilakukan secara asinkron di *background*.
3. **Persistent Disk Cache (`data/*_cache.json`)**:
   - Setiap modul menyimpan hasil sinkronisasi sukses terakhirnya ke folder [`data/`](file:///c:/laragon/www/dashboard_management/data/). Apabila jaringan internet/VPN ke salah satu server eksternal sedang terputus, dashboard otomatis menggunakan data *cache* terakhir tanpa menampilkan layar kosong/error.
4. **Prioritas Perpindahan Periode di Frontend (`public/js/app.js`)**:
   - Saat pengguna memilih bulan baru di *Header Month Picker*, *request* *auto-refresh* lama otomatis di-`abort` (`PERIOD_SWITCH`) sehingga *request* periode baru langsung dieksekusi tanpa antre.

---

## 📁 5. Struktur Folder Project

```text
dashboard_management/
├── config/
│   └── app.config.js                 # Konfigurasi terpusat (Port, URL API, Kredensial, Timeout)
├── data/                             # Penyimpanan cache persisten JSON (Offline Fallback)
│   ├── dc_paperless_cache.json
│   ├── development_sheet_cache.json
│   ├── hr_cache.json
│   ├── logistik_cache.json
│   ├── pbf_cache.json
│   ├── produksi_cache.json
│   ├── purchasing_cache.json
│   ├── qa_cache.json
│   ├── wh_fg_cache.json
│   └── wh_mat_cache.json
├── docs/
│   └── TEMPLATE_MONITORING_OPERASIONAL.md
├── public/                           # Frontend Web Statis
│   ├── index.html                    # Layout 21 Kartu KPI & 11 Modal Interaktif
│   ├── css/style.css                 # Styling Responsif Desktop, TV Display & Mobile
│   └── js/app.js                     # Logic Fetch, Filter Periode, Render Tabel & Pagination
├── routes/
│   └── dashboardRoutes.js            # Endpoint Express (/api/dashboard/*)
├── services/                         # 13 Service Modular Backend
│   ├── apiHealthService.js
│   ├── dcService.js
│   ├── developmentService.js
│   ├── hrService.js
│   ├── logistikService.js
│   ├── pbfService.js
│   ├── produksiService.js
│   ├── purchasingService.js
│   ├── qaService.js
│   ├── subconService.js
│   ├── ticketingService.js
│   ├── whFgService.js
│   └── whMatService.js
├── server.js                         # Entry point Express Server
└── README.md                         # Dokumentasi Utama
```

---

## ⚙️ 6. Konfigurasi & Cara Menjalankan

### Konfigurasi (`.env` / `config/app.config.js`)
```env
PORT=3000

# API Ticketing & E-Subcon
TICKETING_API_URL=https://www.snam110.dpdns.org/helpdesk/api/monitoring?api_key=<YOUR_API_KEY>
SUBCON_API_URL=https://www.snam110.dpdns.org/e-subcon/api/monitoring?api_key=<YOUR_API_KEY>

# API Atena ERP
ATENA_API_BASE_URL=https://erpsna.atena.id/API/Dashboard/
ATENA_API_USERNAME=<YOUR_ATENA_USERNAME>
ATENA_API_PASSWORD=<YOUR_ATENA_PASSWORD>

# Aplikasi Paperless Document Control (DC)
PAPERLESS_WEB_BASE_URL=http://snam.ddns.net:8069/
PAPERLESS_API_USERNAME=<YOUR_PAPERLESS_USERNAME>
PAPERLESS_API_PASSWORD=<YOUR_PAPERLESS_PASSWORD>

# Google Spreadsheet Development (R&D BOM)
DEVELOPMENT_SPREADSHEET_URL=<YOUR_GOOGLE_SHEET_CSV_URL>
```

### Menjalankan Server
```bash
# Mode Produksi
npm start

# Mode Development (Auto-restart saat file berubah)
npm run dev
```
Buka di browser: **`http://localhost:3000`**
