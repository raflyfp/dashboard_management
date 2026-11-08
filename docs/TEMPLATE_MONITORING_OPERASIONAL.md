# 📊 DOKUMENTASI TEKNIS PENGAMBILAN & PENGOLAHAN DATA (21 MODUL LIVE)
**SNA Medika Management Monitoring Dashboard**

Dokumen ini memuat daftar lengkap seluruh **21 bagian/kartu monitoring operasional**, sumber data (endpoint API/Web/Spreadsheet), service pengolah di backend, serta rumus perhitungan KPI yang aktif secara **Live**.

---

## 📑 1. Matriks 21 Kartu Monitoring Operasional (Status, Sumber Data & Rumus KPI)

| No | ID Kartu | Bagian / Unit | Service Backend | Sumber Data & Endpoint | Rumus Perhitungan Persentase / KPI | Status |
|:---:|:---|:---|:---|:---|:---|:---:|
| **1** | `GA` | **Layanan GA (Sarpras)** | `ticketingService.js` | Helpdesk Ticketing API (`GET /helpdesk/api/monitoring`, kode `GA`) | `Tiket Selesai / (Total Tiket - Tiket Ditolak) × 100%` | 🟢 **Live** |
| **2** | `TEKNIK` | **Mekanik (Teknik)** | `ticketingService.js` | Helpdesk Ticketing API (`GET /helpdesk/api/monitoring`, kode `TEKNIK`) | `Tiket Selesai / (Total Tiket - Tiket Ditolak) × 100%` | 🟢 **Live** |
| **3** | `IT` | **Layanan IT** | `ticketingService.js` | Helpdesk Ticketing API (`GET /helpdesk/api/monitoring`, kode `IT`) | `Tiket Selesai / (Total Tiket - Tiket Ditolak) × 100%` | 🟢 **Live** |
| **4** | `PROD_FINISHING` | **Produksi Finishing (Stentor)** | `produksiService.js` | Atena ERP API (`POST PenyelesaianPP/ringkasan` & `detail`, `bagian: "stentor"`) | `PP Memenuhi (Realisasi >= Target) / Total PP × 100%` | 🟢 **Live** |
| **5** | `PROD_ANTISEPTIK` | **Produksi Antiseptik (Packing)** | `produksiService.js` | Atena ERP API (`POST PenyelesaianPP/ringkasan` & `detail`, `bagian: "packing"`) | `PP Memenuhi (Realisasi >= Target) / Total PP × 100%` | 🟢 **Live** |
| **6** | `PROD_CW` | **Produksi CW (CW Packing)** | `produksiService.js` | Atena ERP API (`POST PenyelesaianPP/ringkasan` & `detail`, `bagian: "cw"`) | `PP Memenuhi (Realisasi >= Target) / Total PP × 100%` | 🟢 **Live** |
| **7** | `PROD_SIZING` | **Produksi Sizing** | `produksiService.js` | Atena ERP API (`POST PenyelesaianPP/ringkasan` & `detail`, `bagian: "sizing"`) | `PP Memenuhi (Realisasi >= Target) / Total PP × 100%` | 🟢 **Live** |
| **8** | `PROD_POLIGYP` | **Produksi Poligyp** | `produksiService.js` | Atena ERP API (`POST PenyelesaianPP/ringkasan` & `detail`, `bagian: "poligyp"`) | `PP Memenuhi (Realisasi >= Target) / Total PP × 100%` | 🟢 **Live** |
| **9** | `PROD_IRONING` | **Produksi Ironing** | `produksiService.js` | Atena ERP API (`POST PenyelesaianPP/ringkasan` & `detail`, `bagian: "ironing"`) | `PP Memenuhi (Realisasi >= Target) / Total PP × 100%` | 🟢 **Live** |
| **10** | `PROD_SURGICAL_MESIN` | **Produksi Surgical Mesin** | `produksiService.js` | Atena ERP API (`POST PenyelesaianPP/ringkasan` & `detail`, `bagian: "surgical_mesin"`) | `PP Memenuhi (Realisasi >= Target) / Total PP × 100%` | 🟢 **Live** |
| **11** | `PROD_SURGICAL_PACKING` | **Produksi Surgical Packing** | `produksiService.js` | Atena ERP API (`POST PenyelesaianPP/ringkasan` & `detail`, `bagian: "surgical_packing"`) | `PP Memenuhi (Realisasi >= Target) / Total PP × 100%` | 🟢 **Live** |
| **12** | `PURCHASING` | **Purchasing (PR Mat & Non-Mat)** | `purchasingService.js` | Atena ERP API (`POST PemenuhanPR/ringkasan` & `detail`, `bagian: "material" & "nonmaterial"`) | Dual KPI: `PR Terpenuhi / Total PR × 100%` (Material & Non-Material) | 🟢 **Live** |
| **13** | `QA` | **QA (GRS, SCN & Accept BR)** | `qaService.js` | Atena ERP API (`ReleaseMaterial`, `ReleaseProdukJadi`, `JurnalBatchRecord`) | Triple KPI: `GRS Approve / Total GRS`, `SCN Approve / Total SCN`, `PRH Ada BR / Total PRH` | 🟢 **Live** |
| **14** | `LOGISTIK` | **Logistik (Pemenuhan Order)** | `logistikService.js` | Atena ERP API (`POST PemenuhanOrder/ringkasan` & `detail`) | Berbasis Rincian Barang: `Item Barang Memenuhi / Total Rincian Item Barang × 100%` | 🟢 **Live** |
| **15** | `WH_FG` | **WH FG (Gudang Barang Jadi)** | `whFgService.js` | Atena ERP API (`POST PenyelesaianDR/ringkasan` & `detail`) | `DR Sudah DN (Surat Jalan) / Total DR × 100%` | 🟢 **Live** |
| **16** | `WH_MAT` | **WH Mat (Gudang Bahan)** | `whMatService.js` | Atena ERP API (`POST PemenuhanWHMat/ringkasan` & `detail`, `bagian: "mr" & "dr"`) | Dual KPI: `MR Terpenuhi / Total MR` & `DR Paskot Selesai / Total DR` | 🟢 **Live** |
| **17** | `PBF` | **PBF (Distribusi Farmasi)** | `pbfService.js` | Atena ERP API (`POST PemenuhanOrderPBF/ringkasan` & `detail`) | `Order PBF Memenuhi / Total Order PBF × 100%` | 🟢 **Live** |
| **18** | `HR` | **HR (Kehadiran Karyawan)** | `hrService.js` | Atena ERP API (`POST KehadiranTK/ringkasan` & `detail`, `bagian: "tksna" & "marketing"`) | Dual KPI: `Jadwal Sesuai Plan / Total Jadwal × 100%` (TK SNA & Marketing) | 🟢 **Live** |
| **19** | `DC` | **DC (Document Control)** | `dcService.js` | Paperless Web (`http://snam.ddns.net:8069/`, Menu `PengesahanDokumen` `TRNS3`) | `Pengesahan Dibuat / (Pengesahan Dibuat + Pengajuan Masuk DC) × 100%` | 🟢 **Live** |
| **20** | `DEVELOPMENT` | **Development / R&D (BOM H+2)** | `developmentService.js` | Google Spreadsheet CSV Live (`output=csv`) | `Permintaan BOM Complete / Total Permintaan BOM × 100%` | 🟢 **Live** |
| **21** | `SUBCON` | **Monitoring Pengerjaan Subcon** | `subconService.js` | E-Subcon API (`GET /e-subcon/api/monitoring`) | Output PCS Produksi & `Karyawan Sudah Mengisi / Total Karyawan Aktif × 100%` | 🟢 **Live** |

---

## 📄 2. Detail Arsitektur Pengambilan & Pengolahan Data DC (Document Control)

### A. Mengapa Mengambil dari Menu `Pengesahan Dokumen (TRNS3)`?
Pada aplikasi Paperless (`http://snam.ddns.net:8069/`), dokumen yang baru diajukan oleh departemen pemohon harus melewati *approval* internal departemen terlebih dahulu (*Menunggu Diketahui*, *Menunggu Diperiksa*, *Menunggu Disetujui*). Selama tahap tersebut belum tuntas, dokumen **belum masuk ke meja DC**.

Begitu pengajuan disetujui penuh oleh pimpinan (`ubahstatus = 1`), dokumen otomatis masuk ke menu **Pengesahan Dokumen (`kode=TRNS3`)** milik akun **Document Controller** yang memiliki 2 tab:
1. **Tab `Pengajuan Masuk` (`POST Transaksi/Transaksi/PengesahanDokumen/dataGridDokumenMasuk`)**:
   - Berisi dokumen yang sudah selesai di-approve pimpinan dan **masuk ke meja DC**, namun **belum dibuatkan pengesahan oleh DC**.
   - Diolah menjadi status: **`BELUM SELESAI`** (`is_selesai: false`).
2. **Tab `Pengesahan Dibuat` (`POST Transaksi/Transaksi/PengesahanDokumen/dataGrid`)**:
   - Berisi dokumen yang **sudah dikerjakan / dibuatkan pengesahan oleh DC** (sudah memiliki `kodepengesahandokumen` / Nomor Klausul, `norevisi`, dan `tglpengerjaan`).
   - Diolah menjadi status: **`SELESAI`** (`is_selesai: true`).

### B. Alur Teknis Penarikan Data di `services/dcService.js`
1. **Login Otomatis (`getWebSessionCookie`)**:
   - Mengirim `POST /Auth/Login/cekLogin` menggunakan kredensial dari environment variable (`PAPERLESS_API_USERNAME` & `PAPERLESS_API_PASSWORD`).
   - Menyimpan cookie sesi `ci_session` selama 1 jam.
2. **Ambil Master Jenis Dokumen**:
   - Mengirim `POST Master/Data/JenisDokumen/comboGrid` untuk mengambil 20 UUID jenis dokumen (`BATCH RECORD`, `FORMULIR`, `WORK INSTRUCTION`, `QUALITY PROCEDURE`, dll.).
3. **Penarikan Paralel per Jenis Dokumen**:
   - Menarik `PengesahanDokumen/dataGrid` (Selesai) dan `PengesahanDokumen/dataGridDokumenMasuk` (Belum Selesai) untuk setiap `uuidjenisdokumen`.
   - Mengabaikan dokumen yang dibatalkan (`status === 'D'` atau `userbatal !== null`) dan dokumen yang ditolak (`status === 'R'` atau `ubahstatus === '2'`).
4. **Filter Tanggal & Perhitungan KPI**:
   - Difilter berdasarkan `tgl_permohonan` (`YYYY-MM-DD`) sesuai periode bulan atau rentang tanggal yang dipilih pengguna.
   - Menghitung:
     - `total_dokumen = selesai + belum_selesai`
     - `persentase_selesai = (selesai / total_dokumen) * 100`
5. **In-Memory Cache & Disk Fallback**:
   - Seluruh baris dokumen disimpan di memori (`cache.liveRows`) dan di file [`data/dc_paperless_cache.json`](file:///c:/laragon/www/dashboard_management/data/dc_paperless_cache.json) sehingga perpindahan bulan (misalnya ke Oktober 2026) dapat disaring secara instan (`~4 ms`) tanpa mengalami *timeout*.
