# 📊 DOKUMENTASI SPESIFIKASI & TEMPLATE MONITORING OPERASIONAL (22 BAGIAN)
**SNA Medika Management Monitoring Dashboard**

Dokumen ini memuat standarisasi data, sumber data resmi, metrik KPI, dan format payload JSON siap pakai untuk seluruh 22 modul operasional sesuai ketetapan manajemen SNA Medika.

---

## 📑 1. Daftar 22 Bagian Monitoring Operasional

| No | Bagian / Unit | Data Yang Ditampilkan | Sumber Data Resmi | Kategori | Status Saat Ini |
|:---:|:---|:---|:---|:---|:---:|
| **1** | **GA** | Penyelesaian permintaan layanan sarpras | Aplikasi ticketing (total masuk vs total selesai) | Layanan Utama | 🟢 **Live** |
| **2** | **Mekanik (Teknik)** | Penyelesaian permintaan layanan mekanik | Aplikasi ticketing (total masuk vs total selesai) | Layanan Utama | 🟢 **Live** |
| **3** | **IT** | Penyelesaian permintaan layanan IT | Aplikasi ticketing (total masuk vs total selesai) | Layanan Utama | 🟢 **Live** |
| **-** | **Pengerjaan Subcon** | Monitoring output hasil produksi & mitra | Aplikasi E-Subcon (PCS hasil produksi, mitra & karyawan) | Layanan Utama | 🟢 **Live** |
| **4** | **Produksi Finishing** | Penyelesaian PP (PP stentor vs actual) | Program Atena (PP stentor vs haasil actual) | Lini Produksi Atena | 🟡 **Template Standby** |
| **5** | **Produksi Antiseptik** | Penyelesaian PP (PP antis packing vs actual) | Program Atena (PP antis packing vs haasil actual) | Lini Produksi Atena | 🟡 **Template Standby** |
| **6** | **Produksi CW** | Penyelesaian PP (PP CW packing vs actual) | Program Atena (PP CW packing vs haasil actual) | Lini Produksi Atena | 🟡 **Template Standby** |
| **7** | **Produksi Sizing** | Penyelesaian PP (PP Sizing vs actual) | Program Atena (PP Sizing vs haasil actual) | Lini Produksi Atena | 🟡 **Template Standby** |
| **8** | **Produksi Poligyp** | Penyelesaian PP (PP Poligyp packing vs actual) | Program Atena (PP Poligyp packing vs haasil actual) | Lini Produksi Atena | 🟡 **Template Standby** |
| **9** | **Produksi Sizing (Lini 2)** | Penyelesaian PP (PP Sizing Lini 2 vs actual) | Program Atena (PP Sizing vs haasil actual) | Lini Produksi Atena | 🟡 **Template Standby** |
| **10** | **Produksi Ironing** | Penyelesaian PP (PP Ironing vs actual) | Program Atena (PP Ironing vs haasil actual) | Lini Produksi Atena | 🟡 **Template Standby** |
| **11** | **Produksi Surgical Mesin** | Penyelesaian PP (PP Surgical Mesin vs actual) | Program Atena (PP Surgical Mesin vs haasil actual) | Lini Produksi Atena | 🟡 **Template Standby** |
| **12** | **Produksi Surgical Packing** | Penyelesaian PP (PP Surgical Packing vs actual) | Program Atena (PP Surgical Packing vs haasil actual) | Lini Produksi Atena | 🟡 **Template Standby** |
| **14** | **HR (SDM)** | Kehadiran TK vs jadwal | Sistem Absensi HR / Jadwal Kerja | HR, DC & QA | 🟡 **Template Standby** |
| **15** | **DC (Document Control)** | Penyelesaian pengerjaan dokumen | Aplikasi Paperless (menu pengajuan vs pengesahan) | HR, DC & QA | 🟡 **Template Standby** |
| **16** | **Purchasing** | Pemenuhan PR Material & PR Non-Material | Laporan PR Material, Lap PR nonmat Atena | Supply Chain & Gudang | 🟡 **Template Standby** |
| **17** | **QA (Quality)** | Release material & Release produk jadi | GRS, SCN dan Accept BR | HR, DC & QA | 🟡 **Template Standby** |
| **18** | **Logistik** | Pemenuhan order pengiriman | Sistem Logistik & Distribusi Pengiriman | Supply Chain & Gudang | 🟡 **Template Standby** |
| **19** | **WH FG (Gudang Jadi)** | Penyelesaian DR Barang Jadi | Sistem Warehouse Finished Goods (WH FG) | Supply Chain & Gudang | 🟡 **Template Standby** |
| **20** | **WH Mat (Gudang Bahan)** | Pemenuhan DR & Pemenuhan Permintaan barang | Realisasi DR paskot & Permintaan bahan (MR +1) | Supply Chain & Gudang | 🟡 **Template Standby** |
| **21** | **PBF (Distribusi Farmasi)** | Pemenuhan order pelanggan PBF | Sistem Distribusi / Order Penjualan PBF | Supply Chain & Gudang | 🟡 **Template Standby** |
| **22** | **Development (R&D)** | Penyelesaian BOM H+2 dari Permintaan | Sistem R&D / Development Atena | Supply Chain & Gudang | 🟡 **Template Standby** |

---

## 🔌 2. Standar Format JSON Payload (REST API)

Bagi pengembang sistem terkait (Atena, Paperless, GRS/SCN, Absensi HR, dll), data dapat dikirim atau disiapkan dengan format JSON baku berikut:

```json
{
  "success": true,
  "service_code": "PROD_FINISHING",
  "data": {
    "target_total": 12500,
    "actual_completed": 11800,
    "pending_difference": 700,
    "percentage": 94.4,
    "unit": "Meter",
    "updated_at": "2026-10-09T11:00:00+07:00",
    "notes": "Target shift 1 & 2 tercapai 94.4%"
  }
}
```

---

## 🛠️ 3. Panduan Integrasi ke Dashboard Express

1. Buka file [`routes/dashboardRoutes.js`](file:///c:/laragon/www/dashboard_management/routes/dashboardRoutes.js).
2. Temukan objek modul yang dituju di dalam `servicesResult` (misal `PROD_FINISHING` atau `DC`).
3. Buatkan pemanggilan API service (menggunakan Axios) atau query database (MySQL/PostgreSQL/SQL Server).
4. Masukkan nilainya:
   ```javascript
   servicesResult.PROD_FINISHING.total_tiket = atenaData.target_pp;
   servicesResult.PROD_FINISHING.selesai = atenaData.actual_pp;
   servicesResult.PROD_FINISHING.belum_selesai = Math.max(0, atenaData.target_pp - atenaData.actual_pp);
   servicesResult.PROD_FINISHING.persentase_selesai = Number(((atenaData.actual_pp / atenaData.target_pp) * 100).toFixed(1));
   servicesResult.PROD_FINISHING.is_active = true; // Otomatis mengubah badge menjadi Live!
   ```
5. Simpan file, dashboard akan langsung merefresh datanya secara otomatis!
