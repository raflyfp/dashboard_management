/**
 * ====================================================================
 * ROUTES: DASHBOARD MANAGEMENT API
 * ====================================================================
 * Endpoint REST API untuk konsumsi frontend dashboard:
 * - GET /api/dashboard/stats   : Statistik 10 modul layanan & global KPI
 * - GET /api/dashboard/tickets : Detail daftar tiket per layanan
 * - GET /api/dashboard/config  : Konfigurasi frontend
 * ====================================================================
 */

const express = require('express');
const router = express.Router();
const config = require('../config/app.config');
const ticketingService = require('../services/ticketingService');
const subconService = require('../services/subconService');
const purchasingService = require('../services/purchasingService');
const produksiService = require('../services/produksiService');
const logistikService = require('../services/logistikService');

// In-memory cache sederhana untuk efisiensi beban server
const cache = {
    stats: { data: null, timestamp: 0 },
    tickets: new Map(),
};
const CACHE_TTL_MS = config.cacheTtlSeconds * 1000;

// Melacak status koneksi terakhir ke API Ticketing untuk pemberitahuan di console server
let lastApiStatus = null;

/**
 * Helper hitung persentase penyelesaian tiket.
 * Sesuai aturan manajemen: Tiket DITOLAK TIDAK IKUT dalam pembagi persentase!
 * Rumus: (selesai / (total - ditolak)) * 100
 */
function hitungPersentase(selesai, total, ditolak = 0) {
    const totalEfektif = Math.max(0, total - ditolak);
    if (totalEfektif <= 0) return 0;
    return Number(((selesai / totalEfektif) * 100).toFixed(1));
}

/**
 * Helper sanitasi kategori tiket.
 * Jika kosong atau terisi bawaan 'biasa', ganti dengan tanda strip '-'
 */
function sanitasiKategori(kategori) {
    if (!kategori) return '-';
    const clean = String(kategori).trim().toLowerCase();
    if (clean === '' || clean === 'biasa' || clean === '-' || clean === 'null' || clean === 'undefined') {
        return '-';
    }
    return kategori;
}

/**
 * GET /api/dashboard/config
 * Mengirim konfigurasi dasar ke frontend
 */
router.get('/config', (req, res) => {
    res.json({
        success: true,
        refresh_interval_seconds: config.refreshIntervalSeconds,
        api_connected: true,
    });
});

/**
 * GET /api/dashboard/stats
 * Mengumpulkan data dari API ticketing & API subcon serta modul lainnya
 */
router.get('/stats', async (req, res) => {
    const now = Date.now();
    const forceRefresh = req.query.force === 'true';

    // 1. Cek Cache internal
    if (!forceRefresh && cache.stats.data && (now - cache.stats.timestamp < CACHE_TTL_MS)) {
        return res.json({
            ...cache.stats.data,
            _cached: true,
            _cache_age_seconds: Math.round((now - cache.stats.timestamp) / 1000)
        });
    }

    try {
        // 2. Ambil data dari Layanan Ticketing, Subcon, Purchasing, Produksi & Logistik secara paralel
        const [ticketingSettled, subconSettled, purchasingSettled, produksiSettled, logistikSettled] = await Promise.allSettled([
            ticketingService.getSummary(forceRefresh),
            subconService.getMonitoringToday(forceRefresh),
            purchasingService.getSummary(forceRefresh),
            produksiService.getRingkasanAll(forceRefresh),
            logistikService.getSummary(forceRefresh)
        ]);

        let apiData = null;
        if (ticketingSettled.status === 'fulfilled') {
            apiData = ticketingSettled.value;
            if (lastApiStatus !== 'online') {
                const timeStr = new Date().toLocaleTimeString('id-ID');
                console.log(`[${timeStr}] ✅ [API TICKETING]: Berhasil terhubung & sinkronisasi data dari ${config.ticketing.url}`);
                lastApiStatus = 'online';
            }
        } else {
            console.error(`❌ [API TICKETING ERROR]: ${ticketingSettled.reason?.message}`);
        }

        let subconData = null;
        if (subconSettled.status === 'fulfilled') {
            subconData = subconSettled.value;
        } else {
            console.error(`❌ [API SUBCON ERROR]: ${subconSettled.reason?.message}`);
        }

        let purchasingData = null;
        if (purchasingSettled.status === 'fulfilled') {
            purchasingData = purchasingSettled.value;
        } else {
            console.error(`❌ [API PURCHASING ERROR]: ${purchasingSettled.reason?.message}`);
        }
        const purchasingKpi = purchasingData?.kpi || {};

        let produksiData = null;
        if (produksiSettled.status === 'fulfilled') {
            produksiData = produksiSettled.value?.data || null;
        } else {
            console.error(`❌ [API PRODUKSI ERROR]: ${produksiSettled.reason?.message}`);
        }
        const prodModules = produksiData?.modules || {};
        const prodKpi = produksiData?.kpi || {};

        let logistikData = null;
        if (logistikSettled.status === 'fulfilled') {
            logistikData = logistikSettled.value;
        } else {
            console.error(`❌ [API LOGISTIK ERROR]: ${logistikSettled.reason?.message}`);
        }
        const logistikKpi = logistikData?.kpi || {};

        const summaryData = apiData?.data || {};
        const rawCards = summaryData.layanan_monitoring || {};
        if (Object.keys(rawCards).length === 0 && Array.isArray(summaryData.per_layanan)) {
            summaryData.per_layanan.forEach(item => {
                if (item?.kode) rawCards[item.kode] = item;
            });
        }

        const subconRaw = subconData?.data || {};
        const subconKpi = subconRaw.kpi || {};
        const subconList = subconRaw.per_subcon || [];
        const subconFirst = subconList[0] || {};

        // 3. Susunan 10 Modul Layanan (Sesuai Kebutuhan Manajemen SNA Medika)
        const servicesResult = {
            // --- Modul dari Ticketing (Aktif & Live) ---
            GA: {
                no: 1,
                kode: 'GA',
                nama: 'Layanan GA',
                kategori: 'layanan',
                kategori_label: 'Layanan Utama & Live',
                data_ditampilkan: 'Penyelesaian permintaan layanan sarpras',
                sub_nama: 'Gedung & Sarpras',
                icon: 'building-user',
                sumber_data: 'Aplikasi ticketing (total masuk vs total selesai)',
                sumber: 'Ticketing',
                is_active: true,
                metric_labels: { total: 'Total Masuk', selesai: 'Selesai', belum: 'Belum' },
                unit: 'Tiket',
                total_tiket: rawCards.GA?.total_tiket ?? 0,
                selesai: rawCards.GA?.selesai ?? 0,
                belum_selesai: rawCards.GA?.belum_selesai ?? 0,
                ditolak: rawCards.GA?.ditolak ?? 0,
                total_efektif: Math.max(0, (rawCards.GA?.total_tiket ?? 0) - (rawCards.GA?.ditolak ?? 0)),
                persentase_selesai: hitungPersentase(
                    rawCards.GA?.selesai ?? 0,
                    rawCards.GA?.total_tiket ?? 0,
                    rawCards.GA?.ditolak ?? 0
                ),
            },
            TK: {
                no: 2,
                kode: 'TK',
                nama: 'Layanan Teknik / Mekanik',
                kategori: 'layanan',
                kategori_label: 'Layanan Utama & Live',
                data_ditampilkan: 'Penyelesaian permintaan layanan mekanik',
                sub_nama: 'Mesin & Utilitas Mekanik',
                icon: 'screwdriver-wrench',
                sumber_data: 'Aplikasi ticketing (total masuk vs total selesai)',
                sumber: 'Ticketing',
                is_active: true,
                metric_labels: { total: 'Total Masuk', selesai: 'Selesai', belum: 'Belum' },
                unit: 'Tiket',
                total_tiket: rawCards.TK?.total_tiket ?? 0,
                selesai: rawCards.TK?.selesai ?? 0,
                belum_selesai: rawCards.TK?.belum_selesai ?? 0,
                ditolak: rawCards.TK?.ditolak ?? 0,
                total_efektif: Math.max(0, (rawCards.TK?.total_tiket ?? 0) - (rawCards.TK?.ditolak ?? 0)),
                persentase_selesai: hitungPersentase(
                    rawCards.TK?.selesai ?? 0,
                    rawCards.TK?.total_tiket ?? 0,
                    rawCards.TK?.ditolak ?? 0
                ),
            },
            IT: {
                no: 3,
                kode: 'IT',
                nama: 'Layanan IT',
                kategori: 'layanan',
                kategori_label: 'Layanan Utama & Live',
                data_ditampilkan: 'Penyelesaian permintaan layanan IT',
                sub_nama: 'Software, Jaringan & Hardware',
                icon: 'laptop-code',
                sumber_data: 'Aplikasi ticketing (total masuk vs total selesai)',
                sumber: 'Ticketing',
                is_active: true,
                metric_labels: { total: 'Total Masuk', selesai: 'Selesai', belum: 'Belum' },
                unit: 'Tiket',
                total_tiket: rawCards.IT?.total_tiket ?? 0,
                selesai: rawCards.IT?.selesai ?? 0,
                belum_selesai: rawCards.IT?.belum_selesai ?? 0,
                ditolak: rawCards.IT?.ditolak ?? 0,
                total_efektif: Math.max(0, (rawCards.IT?.total_tiket ?? 0) - (rawCards.IT?.ditolak ?? 0)),
                persentase_selesai: hitungPersentase(
                    rawCards.IT?.selesai ?? 0,
                    rawCards.IT?.total_tiket ?? 0,
                    rawCards.IT?.ditolak ?? 0
                ),
            },

            // --- Modul Pengerjaan Barang Subcon (Aktif & Live E-Subcon API) ---
            SUBCON: {
                no: 0,
                kode: 'SUBCON',
                nama: 'Pengerjaan Subcon',
                kategori: 'layanan',
                kategori_label: 'Layanan Utama & Live',
                data_ditampilkan: 'Monitoring Hasil Produksi Pengerjaan Subcon',
                sub_nama: 'Mitra & Pengemasan',
                icon: 'boxes-packing',
                sumber_data: 'E-Subcon (https://www.snam110.dpdns.org/e-subcon)',
                sumber: 'E-Subcon',
                is_active: true,
                is_production_metric: true, // Menandakan card memakai Hasil Produksi PCS
                total_output_pcs: subconKpi.total_output_pcs ?? 0,
                total_output_pcs_formatted: Number(subconKpi.total_output_pcs ?? 0).toLocaleString('id-ID'),
                total_durasi: subconKpi.total_durasi_formatted || '0 Menit',
                total_transaksi: subconKpi.total_transaksi ?? 0,
                total_subcon: subconKpi.total_subcon_aktif ?? subconList.length ?? 1,
                total_karyawan: subconKpi.total_karyawan_aktif ?? 0,
                sudah_mengisi: subconKpi.sudah_mengisi ?? 0,
                belum_mengisi: subconKpi.belum_mengisi ?? 0,
                subcon_nama: subconFirst.nama_lokasi || 'SIMAN',
                persentase_selesai: subconKpi.total_karyawan_aktif ? Number(((subconKpi.sudah_mengisi / subconKpi.total_karyawan_aktif) * 100).toFixed(1)) : 100,
            },

            // ==============================================================
            // 4. LINI PRODUKSI ATENA (LIVE REST API)
            // ==============================================================
            PROD_FINISHING: {
                no: 4,
                kode: 'PROD_FINISHING',
                nama: 'Produksi Finishing',
                kategori: 'produksi',
                kategori_label: 'Lini Produksi Atena',
                data_ditampilkan: 'Penyelesaian PP',
                sub_nama: 'PP Stentor vs Hasil Actual',
                sumber_data: 'Atena ERP REST API (PenyelesaianPP)',
                sumber: 'Atena ERP',
                catatan: 'Perbandingan PP Stentor dengan hasil aktual harian',
                icon: 'industry',
                is_active: prodModules.PROD_FINISHING ? Boolean(prodModules.PROD_FINISHING.is_active) : false,
                metric_labels: { total: 'Target PP', selesai: 'Memenuhi', belum: 'Belum' },
                unit: prodModules.PROD_FINISHING?.unit || 'Meter / PCS',
                total_tiket: prodModules.PROD_FINISHING?.total_tiket ?? 0,
                selesai: prodModules.PROD_FINISHING?.selesai ?? 0,
                belum_selesai: prodModules.PROD_FINISHING?.belum_selesai ?? 0,
                persentase_selesai: prodModules.PROD_FINISHING?.persentase_selesai ?? 0,
                bagian: 'stentor',
                tglawal: prodModules.PROD_FINISHING?.tglawal,
                tglakhir: prodModules.PROD_FINISHING?.tglakhir,
                today: prodModules.PROD_FINISHING?.today,
                month: prodModules.PROD_FINISHING?.month,
                today_total: prodModules.PROD_FINISHING?.today_total ?? 0,
                today_selesai: prodModules.PROD_FINISHING?.today_selesai ?? 0,
                today_belum: prodModules.PROD_FINISHING?.today_belum ?? 0,
                today_persentase: prodModules.PROD_FINISHING?.today_persentase ?? 0,
                month_total: prodModules.PROD_FINISHING?.month_total ?? 0,
                month_selesai: prodModules.PROD_FINISHING?.month_selesai ?? 0,
                month_belum: prodModules.PROD_FINISHING?.month_belum ?? 0,
                month_persentase: prodModules.PROD_FINISHING?.month_persentase ?? 0,
            },
            PROD_ANTISEPTIK: {
                no: 5,
                kode: 'PROD_ANTISEPTIK',
                nama: 'Produksi Antiseptik',
                kategori: 'produksi',
                kategori_label: 'Lini Produksi Atena',
                data_ditampilkan: 'Penyelesaian PP',
                sub_nama: 'PP Antis Packing vs Hasil Actual',
                sumber_data: 'Atena ERP REST API (PenyelesaianPP)',
                sumber: 'Atena ERP',
                catatan: 'Perbandingan PP Antis Packing dengan hasil aktual',
                icon: 'bottle-droplet',
                is_active: prodModules.PROD_ANTISEPTIK ? Boolean(prodModules.PROD_ANTISEPTIK.is_active) : false,
                metric_labels: { total: 'Target PP', selesai: 'Memenuhi', belum: 'Belum' },
                unit: prodModules.PROD_ANTISEPTIK?.unit || 'Botol / PCS',
                total_tiket: prodModules.PROD_ANTISEPTIK?.total_tiket ?? 0,
                selesai: prodModules.PROD_ANTISEPTIK?.selesai ?? 0,
                belum_selesai: prodModules.PROD_ANTISEPTIK?.belum_selesai ?? 0,
                persentase_selesai: prodModules.PROD_ANTISEPTIK?.persentase_selesai ?? 0,
                bagian: 'antiseptik',
                tglawal: prodModules.PROD_ANTISEPTIK?.tglawal,
                tglakhir: prodModules.PROD_ANTISEPTIK?.tglakhir,
                today: prodModules.PROD_ANTISEPTIK?.today,
                month: prodModules.PROD_ANTISEPTIK?.month,
                today_total: prodModules.PROD_ANTISEPTIK?.today_total ?? 0,
                today_selesai: prodModules.PROD_ANTISEPTIK?.today_selesai ?? 0,
                today_belum: prodModules.PROD_ANTISEPTIK?.today_belum ?? 0,
                today_persentase: prodModules.PROD_ANTISEPTIK?.today_persentase ?? 0,
                month_total: prodModules.PROD_ANTISEPTIK?.month_total ?? 0,
                month_selesai: prodModules.PROD_ANTISEPTIK?.month_selesai ?? 0,
                month_belum: prodModules.PROD_ANTISEPTIK?.month_belum ?? 0,
                month_persentase: prodModules.PROD_ANTISEPTIK?.month_persentase ?? 0,
            },
            PROD_CW: {
                no: 6,
                kode: 'PROD_CW',
                nama: 'Produksi CW',
                kategori: 'produksi',
                kategori_label: 'Lini Produksi Atena',
                data_ditampilkan: 'Penyelesaian PP',
                sub_nama: 'PP CW Packing vs Hasil Actual',
                sumber_data: 'Atena ERP REST API (PenyelesaianPP)',
                sumber: 'Atena ERP',
                catatan: 'Perbandingan PP CW Packing dengan hasil aktual',
                icon: 'box-open',
                is_active: prodModules.PROD_CW ? Boolean(prodModules.PROD_CW.is_active) : false,
                metric_labels: { total: 'Target PP', selesai: 'Memenuhi', belum: 'Belum' },
                unit: prodModules.PROD_CW?.unit || 'PCS',
                total_tiket: prodModules.PROD_CW?.total_tiket ?? 0,
                selesai: prodModules.PROD_CW?.selesai ?? 0,
                belum_selesai: prodModules.PROD_CW?.belum_selesai ?? 0,
                persentase_selesai: prodModules.PROD_CW?.persentase_selesai ?? 0,
                bagian: 'cw',
                tglawal: prodModules.PROD_CW?.tglawal,
                tglakhir: prodModules.PROD_CW?.tglakhir,
                today: prodModules.PROD_CW?.today,
                month: prodModules.PROD_CW?.month,
                today_total: prodModules.PROD_CW?.today_total ?? 0,
                today_selesai: prodModules.PROD_CW?.today_selesai ?? 0,
                today_belum: prodModules.PROD_CW?.today_belum ?? 0,
                today_persentase: prodModules.PROD_CW?.today_persentase ?? 0,
                month_total: prodModules.PROD_CW?.month_total ?? 0,
                month_selesai: prodModules.PROD_CW?.month_selesai ?? 0,
                month_belum: prodModules.PROD_CW?.month_belum ?? 0,
                month_persentase: prodModules.PROD_CW?.month_persentase ?? 0,
            },
            PROD_SIZING: {
                no: 7,
                kode: 'PROD_SIZING',
                nama: 'Produksi Sizing',
                kategori: 'produksi',
                kategori_label: 'Lini Produksi Atena',
                data_ditampilkan: 'Penyelesaian PP',
                sub_nama: 'PP Sizing vs Hasil Actual',
                sumber_data: 'Atena ERP REST API (PenyelesaianPP)',
                sumber: 'Atena ERP',
                catatan: 'Perbandingan PP Sizing dengan hasil aktual',
                icon: 'scroll',
                is_active: prodModules.PROD_SIZING ? Boolean(prodModules.PROD_SIZING.is_active) : false,
                metric_labels: { total: 'Target PP', selesai: 'Memenuhi', belum: 'Belum' },
                unit: prodModules.PROD_SIZING?.unit || 'Meter / Beam',
                total_tiket: prodModules.PROD_SIZING?.total_tiket ?? 0,
                selesai: prodModules.PROD_SIZING?.selesai ?? 0,
                belum_selesai: prodModules.PROD_SIZING?.belum_selesai ?? 0,
                persentase_selesai: prodModules.PROD_SIZING?.persentase_selesai ?? 0,
                bagian: 'sizing',
                tglawal: prodModules.PROD_SIZING?.tglawal,
                tglakhir: prodModules.PROD_SIZING?.tglakhir,
                today: prodModules.PROD_SIZING?.today,
                month: prodModules.PROD_SIZING?.month,
                today_total: prodModules.PROD_SIZING?.today_total ?? 0,
                today_selesai: prodModules.PROD_SIZING?.today_selesai ?? 0,
                today_belum: prodModules.PROD_SIZING?.today_belum ?? 0,
                today_persentase: prodModules.PROD_SIZING?.today_persentase ?? 0,
                month_total: prodModules.PROD_SIZING?.month_total ?? 0,
                month_selesai: prodModules.PROD_SIZING?.month_selesai ?? 0,
                month_belum: prodModules.PROD_SIZING?.month_belum ?? 0,
                month_persentase: prodModules.PROD_SIZING?.month_persentase ?? 0,
            },
            PROD_POLIGYP: {
                no: 8,
                kode: 'PROD_POLIGYP',
                nama: 'Produksi Poligyp',
                kategori: 'produksi',
                kategori_label: 'Lini Produksi Atena',
                data_ditampilkan: 'Penyelesaian PP',
                sub_nama: 'PP Poligyp Packing vs Hasil Actual',
                sumber_data: 'Atena ERP REST API (PenyelesaianPP)',
                sumber: 'Atena ERP',
                catatan: 'Perbandingan PP Poligyp Packing dengan hasil aktual',
                icon: 'bandage',
                is_active: prodModules.PROD_POLIGYP ? Boolean(prodModules.PROD_POLIGYP.is_active) : false,
                metric_labels: { total: 'Target PP', selesai: 'Memenuhi', belum: 'Belum' },
                unit: prodModules.PROD_POLIGYP?.unit || 'Roll / PCS',
                total_tiket: prodModules.PROD_POLIGYP?.total_tiket ?? 0,
                selesai: prodModules.PROD_POLIGYP?.selesai ?? 0,
                belum_selesai: prodModules.PROD_POLIGYP?.belum_selesai ?? 0,
                persentase_selesai: prodModules.PROD_POLIGYP?.persentase_selesai ?? 0,
                bagian: 'poligyp',
                tglawal: prodModules.PROD_POLIGYP?.tglawal,
                tglakhir: prodModules.PROD_POLIGYP?.tglakhir,
                today: prodModules.PROD_POLIGYP?.today,
                month: prodModules.PROD_POLIGYP?.month,
                today_total: prodModules.PROD_POLIGYP?.today_total ?? 0,
                today_selesai: prodModules.PROD_POLIGYP?.today_selesai ?? 0,
                today_belum: prodModules.PROD_POLIGYP?.today_belum ?? 0,
                today_persentase: prodModules.PROD_POLIGYP?.today_persentase ?? 0,
                month_total: prodModules.PROD_POLIGYP?.month_total ?? 0,
                month_selesai: prodModules.PROD_POLIGYP?.month_selesai ?? 0,
                month_belum: prodModules.PROD_POLIGYP?.month_belum ?? 0,
                month_persentase: prodModules.PROD_POLIGYP?.month_persentase ?? 0,
            },
            PROD_IRONING: {
                no: 10,
                kode: 'PROD_IRONING',
                nama: 'Produksi Ironing',
                kategori: 'produksi',
                kategori_label: 'Lini Produksi Atena',
                data_ditampilkan: 'Penyelesaian PP',
                sub_nama: 'PP Ironing vs Hasil Actual',
                sumber_data: 'Atena ERP REST API (PenyelesaianPP)',
                sumber: 'Atena ERP',
                catatan: 'Perbandingan PP Ironing dengan hasil aktual',
                icon: 'temperature-high',
                is_active: prodModules.PROD_IRONING ? Boolean(prodModules.PROD_IRONING.is_active) : false,
                metric_labels: { total: 'Target PP', selesai: 'Memenuhi', belum: 'Belum' },
                unit: prodModules.PROD_IRONING?.unit || 'PCS / Meter',
                total_tiket: prodModules.PROD_IRONING?.total_tiket ?? 0,
                selesai: prodModules.PROD_IRONING?.selesai ?? 0,
                belum_selesai: prodModules.PROD_IRONING?.belum_selesai ?? 0,
                persentase_selesai: prodModules.PROD_IRONING?.persentase_selesai ?? 0,
                bagian: 'ironing',
                tglawal: prodModules.PROD_IRONING?.tglawal,
                tglakhir: prodModules.PROD_IRONING?.tglakhir,
                today: prodModules.PROD_IRONING?.today,
                month: prodModules.PROD_IRONING?.month,
                today_total: prodModules.PROD_IRONING?.today_total ?? 0,
                today_selesai: prodModules.PROD_IRONING?.today_selesai ?? 0,
                today_belum: prodModules.PROD_IRONING?.today_belum ?? 0,
                today_persentase: prodModules.PROD_IRONING?.today_persentase ?? 0,
                month_total: prodModules.PROD_IRONING?.month_total ?? 0,
                month_selesai: prodModules.PROD_IRONING?.month_selesai ?? 0,
                month_belum: prodModules.PROD_IRONING?.month_belum ?? 0,
                month_persentase: prodModules.PROD_IRONING?.month_persentase ?? 0,
            },
            PROD_SURGICAL_MESIN: {
                no: 11,
                kode: 'PROD_SURGICAL_MESIN',
                nama: 'Produksi Surgical Mesin',
                kategori: 'produksi',
                kategori_label: 'Lini Produksi Atena',
                data_ditampilkan: 'Penyelesaian PP',
                sub_nama: 'PP Surgical Mesin vs Hasil Actual',
                sumber_data: 'Program Atena (PP Surgical Mesin vs haasil actual)',
                sumber: 'Program Atena',
                catatan: 'Perbandingan PP Surgical Mesin dengan hasil aktual',
                icon: 'gears',
                is_active: false,
                metric_labels: { total: 'Target PP', selesai: 'Memenuhi', belum: 'Belum' },
                unit: 'PCS / Box',
                total_tiket: 0,
                selesai: 0,
                belum_selesai: 0,
                persentase_selesai: 0,
            },
            PROD_SURGICAL_PACKING: {
                no: 12,
                kode: 'PROD_SURGICAL_PACKING',
                nama: 'Produksi Surgical Packing',
                kategori: 'produksi',
                kategori_label: 'Lini Produksi Atena',
                data_ditampilkan: 'Penyelesaian PP',
                sub_nama: 'PP Surgical Packing vs Hasil Actual',
                sumber_data: 'Atena ERP REST API (PenyelesaianPP)',
                sumber: 'Atena ERP',
                catatan: 'Perbandingan PP Surgical Packing dengan hasil aktual',
                icon: 'boxes-stacked',
                is_active: prodModules.PROD_SURGICAL_PACKING ? Boolean(prodModules.PROD_SURGICAL_PACKING.is_active) : false,
                metric_labels: { total: 'Target PP', selesai: 'Memenuhi', belum: 'Belum' },
                unit: prodModules.PROD_SURGICAL_PACKING?.unit || 'Box / Karton',
                total_tiket: prodModules.PROD_SURGICAL_PACKING?.total_tiket ?? 0,
                selesai: prodModules.PROD_SURGICAL_PACKING?.selesai ?? 0,
                belum_selesai: prodModules.PROD_SURGICAL_PACKING?.belum_selesai ?? 0,
                persentase_selesai: prodModules.PROD_SURGICAL_PACKING?.persentase_selesai ?? 0,
                bagian: 'surgicalpacking',
                tglawal: prodModules.PROD_SURGICAL_PACKING?.tglawal,
                tglakhir: prodModules.PROD_SURGICAL_PACKING?.tglakhir,
                today: prodModules.PROD_SURGICAL_PACKING?.today,
                month: prodModules.PROD_SURGICAL_PACKING?.month,
                today_total: prodModules.PROD_SURGICAL_PACKING?.today_total ?? 0,
                today_selesai: prodModules.PROD_SURGICAL_PACKING?.today_selesai ?? 0,
                today_belum: prodModules.PROD_SURGICAL_PACKING?.today_belum ?? 0,
                today_persentase: prodModules.PROD_SURGICAL_PACKING?.today_persentase ?? 0,
                month_total: prodModules.PROD_SURGICAL_PACKING?.month_total ?? 0,
                month_selesai: prodModules.PROD_SURGICAL_PACKING?.month_selesai ?? 0,
                month_belum: prodModules.PROD_SURGICAL_PACKING?.month_belum ?? 0,
                month_persentase: prodModules.PROD_SURGICAL_PACKING?.month_persentase ?? 0,
            },

            // ==============================================================
            // 5. HR, DC & QA (TEMPLATE STANDBY SIAP INTEGRASI)
            // ==============================================================
            HR: {
                no: 14,
                kode: 'HR',
                nama: 'HR (SDM)',
                kategori: 'support_qa',
                kategori_label: 'HR, Dokumen & Mutu',
                data_ditampilkan: 'Kehadiran TK vs Jadwal',
                sub_nama: 'Presensi Tenaga Kerja vs Roster',
                sumber_data: 'Sistem Absensi HR & Jadwal Kerja',
                sumber: 'Aplikasi Absensi HR',
                catatan: 'Kehadiran Tenaga Kerja harian dibandingkan jadwal kerja',
                icon: 'users-line',
                is_active: false,
                metric_labels: { total: 'Jadwal TK', selesai: 'Hadir', belum: 'Absen' },
                unit: 'Orang',
                total_tiket: 0,
                selesai: 0,
                belum_selesai: 0,
                persentase_selesai: 0,
            },
            DC: {
                no: 15,
                kode: 'DC',
                nama: 'DC (Document Control)',
                kategori: 'support_qa',
                kategori_label: 'HR, Dokumen & Mutu',
                data_ditampilkan: 'Penyelesaian Pengerjaan Dokumen',
                sub_nama: 'Menu Pengajuan vs Pengesahan',
                sumber_data: 'Aplikasi Paperless (total masuk menu pengajuan vs total selesai menu pengesahan)',
                sumber: 'Aplikasi Paperless',
                catatan: 'Total masuk (menu pengajuan) vs total selesai dikerjakan (menu pengesahan)',
                icon: 'file-signature',
                is_active: false,
                metric_labels: { total: 'Pengajuan', selesai: 'Disahkan', belum: 'Proses' },
                unit: 'Dokumen',
                total_tiket: 0,
                selesai: 0,
                belum_selesai: 0,
                persentase_selesai: 0,
            },
            QA: {
                no: 17,
                kode: 'QA',
                nama: 'QA (Quality Assurance)',
                kategori: 'support_qa',
                kategori_label: 'HR, Dokumen & Mutu',
                data_ditampilkan: 'Release Material & Produk Jadi',
                sub_nama: 'GRS, SCN & Accept BR',
                sumber_data: 'GRS (Goods Receipt Slip), SCN dan Accept BR',
                sumber: 'Sistem QA / GRS & SCN',
                catatan: 'Release material (GRS) & Release produk jadi (SCN dan Accept BR)',
                icon: 'clipboard-check',
                is_active: false,
                metric_labels: { total: 'Inspeksi', selesai: 'Released', belum: 'Pending' },
                unit: 'Batch / Lot',
                total_tiket: 0,
                selesai: 0,
                belum_selesai: 0,
                persentase_selesai: 0,
            },

            // ==============================================================
            // 6. SUPPLY CHAIN & GUDANG (LIVE ATENA REST API & TEMPLATE)
            // ==============================================================
            PURCHASING: {
                no: 16,
                kode: 'PURCHASING',
                nama: 'Purchasing',
                kategori: 'supply_chain',
                kategori_label: 'Supply Chain & Gudang',
                data_ditampilkan: 'Pemenuhan PR Mat & PR Non Mat',
                sub_nama: 'PR Material & PR Non-Mat Atena',
                sumber_data: 'Atena ERP REST API (PemenuhanPR)',
                sumber: 'Atena ERP',
                catatan: 'Pemenuhan Purchase Requisition Material & Non-Material',
                icon: 'cart-shopping',
                is_active: true,
                metric_labels: { total: 'Total PR', selesai: 'Terpenuhi', belum: 'Belum' },
                unit: 'PR',
                total_tiket: purchasingKpi.total_pr ?? 0,
                selesai: purchasingKpi.pr_terpenuhi ?? 0,
                belum_selesai: purchasingKpi.pr_belum ?? 0,
                ditolak: 0,
                total_efektif: purchasingKpi.total_pr ?? 0,
                persentase_selesai: purchasingKpi.persentase_selesai ?? 0,
                total_item: purchasingKpi.total_item ?? 0,
                material: purchasingKpi.material || {},
                non_material: purchasingKpi.non_material || {},
                total_qty_request: purchasingKpi.total_qty_request ?? 0,
                total_qty_po: purchasingKpi.total_qty_po ?? 0,
                total_qty_grs: purchasingKpi.total_qty_grs ?? 0,
                total_qty_os: purchasingKpi.total_qty_os ?? 0,
            },
            LOGISTIK: {
                no: 18,
                kode: 'LOGISTIK',
                nama: 'Logistik',
                kategori: 'supply_chain',
                kategori_label: 'Supply Chain & Gudang',
                data_ditampilkan: 'Pemenuhan Order',
                sub_nama: 'Realisasi Pengiriman Pesanan',
                sumber_data: 'Atena ERP REST API (PemenuhanOrder)',
                sumber: 'Atena ERP',
                catatan: 'Pemenuhan order pengiriman tepat waktu',
                icon: 'truck-fast',
                is_active: true,
                metric_labels: { total: 'Total Order', selesai: 'Terpenuhi', belum: 'Belum' },
                unit: 'Order',
                total_tiket: logistikKpi.total_order ?? 0,
                selesai: logistikKpi.order_terpenuhi ?? 0,
                belum_selesai: logistikKpi.order_belum_terpenuhi ?? 0,
                ditolak: 0,
                total_efektif: logistikKpi.total_order ?? 0,
                persentase_selesai: logistikKpi.persentase_selesai ?? 0,
                total_item: logistikKpi.total_item ?? 0,
                today: logistikData?.today || {},
                month: logistikData?.month || {},
                today_total: logistikData?.today?.total_order ?? 0,
                today_selesai: logistikData?.today?.order_terpenuhi ?? 0,
                today_belum: logistikData?.today?.order_belum_terpenuhi ?? 0,
                today_persentase: logistikData?.today?.persentase_selesai ?? 0,
                month_total: logistikData?.month?.total_order ?? 0,
                month_selesai: logistikData?.month?.order_terpenuhi ?? 0,
                month_belum: logistikData?.month?.order_belum_terpenuhi ?? 0,
                month_persentase: logistikData?.month?.persentase_selesai ?? 0,
            },
            WH_FG: {
                no: 19,
                kode: 'WH_FG',
                nama: 'WH FG (Gudang Jadi)',
                kategori: 'supply_chain',
                kategori_label: 'Supply Chain & Gudang',
                data_ditampilkan: 'Penyelesaian DR',
                sub_nama: 'Delivery Receipt Barang Jadi',
                sumber_data: 'Sistem Warehouse Finished Goods (WH FG)',
                sumber: 'Sistem WH FG',
                catatan: 'Penyelesaian Delivery Receipt (DR) Barang Jadi',
                icon: 'warehouse',
                is_active: false,
                metric_labels: { total: 'Total DR', selesai: 'Selesai', belum: 'Pending' },
                unit: 'DR',
                total_tiket: 0,
                selesai: 0,
                belum_selesai: 0,
                persentase_selesai: 0,
            },
            WH_MAT: {
                no: 20,
                kode: 'WH_MAT',
                nama: 'WH Mat (Gudang Bahan)',
                kategori: 'supply_chain',
                kategori_label: 'Supply Chain & Gudang',
                data_ditampilkan: 'Pemenuhan DR & Permintaan Barang',
                sub_nama: 'DR Paskot & MR Bahan (MR +1)',
                sumber_data: 'Realisasi DR lain & DR customer paskot sesuai jadwal, Realisasi permintaan bahan (hari MR +1 & sesuai tanggal kirim)',
                sumber: 'Sistem WH Mat & MR',
                catatan: 'Realisasi DR lain & DR customer paskot sesuai jadwal. Realisasi permintaan bahan hari MR+1 & sesuai tgl kirim (Sabtu & Minggu tidak dihitung)',
                icon: 'dolly',
                is_active: false,
                metric_labels: { total: 'Permintaan', selesai: 'Realisasi', belum: 'Outstanding' },
                unit: 'Item / MR',
                total_tiket: 0,
                selesai: 0,
                belum_selesai: 0,
                persentase_selesai: 0,
            },
            PBF: {
                no: 21,
                kode: 'PBF',
                nama: 'PBF (Distribusi)',
                kategori: 'supply_chain',
                kategori_label: 'Supply Chain & Gudang',
                data_ditampilkan: 'Pemenuhan Order',
                sub_nama: 'Fulfillment Order PBF Farmasi',
                sumber_data: 'Sistem Distribusi / Order Penjualan PBF',
                sumber: 'Sistem Order PBF',
                catatan: 'Pemenuhan order Pedagang Besar Farmasi',
                icon: 'prescription-bottle-medical',
                is_active: false,
                metric_labels: { total: 'Total Order', selesai: 'Terpenuhi', belum: 'Proses' },
                unit: 'Order',
                total_tiket: 0,
                selesai: 0,
                belum_selesai: 0,
                persentase_selesai: 0,
            },
            DEVELOPMENT: {
                no: 22,
                kode: 'DEVELOPMENT',
                nama: 'Development (R&D)',
                kategori: 'supply_chain',
                kategori_label: 'Supply Chain & Gudang',
                data_ditampilkan: 'Penyelesaian BOM H+2 dari Permintaan',
                sub_nama: 'SLA Pembuatan BOM Maks H+2',
                sumber_data: 'Sistem R&D / Development Atena',
                sumber: 'Sistem R&D Atena',
                catatan: 'Penyelesaian Bill of Materials (BOM) paling lambat H+2 setelah permintaan masuk',
                icon: 'compass-drafting',
                is_active: false,
                metric_labels: { total: 'Req BOM', selesai: 'On-Time H+2', belum: 'Overdue' },
                unit: 'Item BOM',
                total_tiket: 0,
                selesai: 0,
                belum_selesai: 0,
                persentase_selesai: 0,
            }
        };

        // Alias backward compatibility untuk kode lama jika masih ada yang mengakses
        servicesResult.ESYS = servicesResult.PURCHASING;
        servicesResult.SIMRS = servicesResult.LOGISTIK;
        servicesResult.FARMASI = servicesResult.HR;
        servicesResult.LAB = servicesResult.PROD_FINISHING;
        servicesResult.BILLING = servicesResult.PROD_ANTISEPTIK;
        servicesResult.SDM = servicesResult.DC;

        // 4. Hitung Akumulasi Global KPI (Persentase mengecualikan tiket ditolak)
        const totalSemua = servicesResult.IT.total_tiket + servicesResult.TK.total_tiket + servicesResult.GA.total_tiket;
        const totalSelesai = servicesResult.IT.selesai + servicesResult.TK.selesai + servicesResult.GA.selesai;
        const totalBelum = servicesResult.IT.belum_selesai + servicesResult.TK.belum_selesai + servicesResult.GA.belum_selesai;
        const totalDitolak = servicesResult.IT.ditolak + servicesResult.TK.ditolak + servicesResult.GA.ditolak;
        const totalEfektifGlobal = Math.max(0, totalSemua - totalDitolak);
        const persentaseGlobal = hitungPersentase(totalSelesai, totalSemua, totalDitolak);

        // Sanitasi tiket perlu_perhatian agar kategori 'biasa' menjadi tanda strip '-'
        const sanitizedPerluPerhatian = (summaryData.perlu_perhatian || []).map(item => ({
            ...item,
            kategori: sanitasiKategori(item.kategori)
        }));

        const result = {
            success: true,
            server_time: apiData?.server_time || new Date().toISOString(),
            kpi_global: {
                total_tiket: totalSemua,
                total_selesai: totalSelesai,
                total_belum_selesai: totalBelum,
                total_ditolak: totalDitolak,
                total_efektif: totalEfektifGlobal,
                persentase_selesai: persentaseGlobal,
                total_aktif: summaryData.kpi?.total_tiket_aktif ?? summaryData.total_tiket_aktif ?? 0,
            },
            kpi_produksi: prodKpi,
            kpi_purchasing: purchasingKpi,
            kpi_logistik: logistikKpi,
            layanan: servicesResult,
            perlu_perhatian: sanitizedPerluPerhatian,
        };

        // Simpan ke Cache
        cache.stats.data = result;
        cache.stats.timestamp = now;

        return res.json({ ...result, _cached: false });

    } catch (error) {
        const timeStr = new Date().toLocaleTimeString('id-ID');
        if (lastApiStatus !== 'offline') {
            console.error(`[${timeStr}] ❌ [API TICKETING TERPUTUS]: Gagal terhubung ke API (${error.message})`);
            lastApiStatus = 'offline';
        } else {
            console.error(`[${timeStr}] ⚠️ [API TICKETING RETRY]: Masih gagal menghubungi server (${error.message})`);
        }

        // Fallback: Kirim data cache lama jika API luar sedang tidak merespon
        if (cache.stats.data) {
            return res.json({
                ...cache.stats.data,
                _cached: true,
                _warning: 'Menggunakan data cadangan: Server ticketing sedang sibuk',
            });
        }

        return res.status(502).json({
            success: false,
            message: 'Gagal terhubung ke API Ticketing. Pastikan Laravel aktif.',
            error: error.message
        });
    }
});

/**
 * GET /api/dashboard/tickets
 * Mengambil daftar tiket spesifik
 */
router.get('/tickets', async (req, res) => {
    const { service, status = 'all', limit = 'all', force } = req.query;
    const isForce = force === 'true' || force === true;
    let targetStatus = status;
    if (status === 'ditolak') targetStatus = 'rejected';

    const cacheKey = `${service || 'ALL'}_${targetStatus}_${limit}`;
    const now = Date.now();

    // Cache tiket 15 detik agar instan saat dibuka dari frontend, tapi bisa di-bypass dengan ?force=true
    const cachedItem = cache.tickets.get(cacheKey);
    if (!isForce && cachedItem && (now - cachedItem.timestamp < 15000)) {
        return res.json(cachedItem.data);
    }

    try {
        const result = await ticketingService.getTickets({ service, status: targetStatus, limit, force: isForce });
        const rawTickets = result.data || result.tickets || [];
        const sanitizedTickets = rawTickets.map(t => ({
            ...t,
            kategori: sanitasiKategori(t.kategori)
        }));

        const responsePayload = {
            success: true,
            total_data: sanitizedTickets.length,
            data: sanitizedTickets
        };

        cache.tickets.set(cacheKey, { data: responsePayload, timestamp: now });
        return res.json(responsePayload);
    } catch (error) {
        console.error('[API ERROR /tickets]:', error.message);
        return res.status(502).json({
            success: false,
            message: 'Gagal mengambil daftar tiket.',
            error: error.message
        });
    }
});

/**
 * GET /api/dashboard/subcon
 * Mengambil detail monitoring pengerjaan barang subcon lengkap dengan grafik harian & rincian barang
 * Query params:
 * - range: 'today' | 'week' | 'month' (default: 'today')
 * - tanggal_mulai: YYYY-MM-DD
 * - tanggal_akhir: YYYY-MM-DD
 * - search: pencarian barang atau karyawan
 */
router.get('/subcon', async (req, res) => {
    const { range = 'today', tanggal_mulai, tanggal_akhir, search } = req.query;
    try {
        const data = await subconService.getMonitoringData({
            range,
            tanggal_mulai,
            tanggal_akhir,
            search
        });

        return res.json({
            success: true,
            data
        });
    } catch (error) {
        console.error('[API ERROR /subcon]:', error.message);
        return res.status(502).json({
            success: false,
            message: 'Gagal mengambil data monitoring pengerjaan subcon.',
            error: error.message
        });
    }
});

/**
 * GET /api/dashboard/purchasing
 * Mengambil data pemenuhan Purchase Request Atena ERP dalam format JSON
 * Query params:
 * - range: 'all' | 'today' | 'week' | 'month' (default: 'all')
 * - jenis: 'all' | 'material' | 'non_material'
 * - status: 'all' | 'terpenuhi' | 'proses_po' | 'parsial' | 'pending' | 'belum_terpenuhi'
 * - search: pencarian No PR, kode barang, atau nama barang
 */
router.get('/purchasing', async (req, res) => {
    try {
        const { range = 'all', jenis = 'all', status = 'all', search = '', force = false } = req.query;
        const data = await purchasingService.getMonitoringData({
            range,
            jenis,
            status,
            search,
            force: force === 'true'
        });

        return res.json({
            success: true,
            data
        });
    } catch (error) {
        console.error('[API ERROR /purchasing]:', error.message);
        return res.status(502).json({
            success: false,
            message: 'Gagal mengambil data monitoring purchasing Atena ERP.',
            error: error.message
        });
    }
});

/**
 * POST /api/dashboard/purchasing/sync
 * Memaksa sinkronisasi data terbaru langsung dari server Atena ERP
 */
router.post('/purchasing/sync', async (req, res) => {
    try {
        const data = await purchasingService.fetchData(true);
        return res.json({
            success: true,
            message: 'Sinkronisasi data Purchase Request dari Atena ERP berhasil',
            data
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Gagal sinkronisasi data dari Atena ERP: ' + error.message
        });
    }
});

/**
 * GET /api/dashboard/produksi
 * Mengambil detail data Penyelesaian PP (Perintah Produksi) per bagian lini produksi
 * Query params:
 * - bagian: 'stentor' | 'antiseptik' | 'cw' | 'sizing' | 'poligyp' | 'ironing' | 'surgicalpacking' (default: 'stentor')
 * - tglawal: YYYY-MM-DD
 * - tglakhir: YYYY-MM-DD
 * - status: 'all' | 'memenuhi' | 'belum'
 * - search: pencarian No. PP, kode, atau nama barang
 * - force: boolean
 */
router.get('/produksi', async (req, res) => {
    try {
        const { bagian = 'stentor', period = 'today', tglawal, tglakhir, status = 'all', search = '', force = false } = req.query;
        const data = await produksiService.getDetail(bagian, {
            period,
            tglawal,
            tglakhir,
            status,
            search,
            force: force === 'true'
        });

        return res.json({
            success: true,
            data
        });
    } catch (error) {
        console.error('[API ERROR /produksi]:', error.message);
        return res.status(502).json({
            success: false,
            message: 'Gagal mengambil data monitoring produksi Atena ERP: ' + error.message,
            error: error.message
        });
    }
});

/**
 * POST /api/dashboard/produksi/sync
 * Memaksa sinkronisasi ulang data produksi langsung dari server Atena ERP REST API
 */
router.post('/produksi/sync', async (req, res) => {
    try {
        const ringkasan = await produksiService.getRingkasanAll(true);
        return res.json({
            success: true,
            message: 'Sinkronisasi data Produksi dari Atena ERP berhasil',
            data: ringkasan.data
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Gagal sinkronisasi data produksi Atena ERP: ' + error.message
        });
    }
});

/**
 * GET /api/dashboard/logistik
 * Mengambil detail data Pemenuhan Order pengiriman logistik dari Atena ERP REST API
 * Query params:
 * - range: 'today' | 'week' | 'month' | 'all' (default: 'month')
 * - status: 'all' | 'memenuhi' | 'belum'
 * - search: pencarian No. Order, Customer, Nama Barang, No. Resi DR/DN
 * - force: boolean
 */
router.get('/logistik', async (req, res) => {
    try {
        const { range = 'month', status = 'all', search = '', force = false, tglawal, tglakhir } = req.query;
        const data = await logistikService.getMonitoringData({
            range,
            status,
            search,
            force: force === 'true',
            tglawal,
            tglakhir,
        });

        return res.json({
            success: true,
            data
        });
    } catch (error) {
        console.error('[API ERROR /logistik]:', error.message);
        return res.status(502).json({
            success: false,
            message: 'Gagal mengambil data monitoring logistik Atena ERP: ' + error.message,
            error: error.message
        });
    }
});

/**
 * POST /api/dashboard/logistik/sync
 * Memaksa sinkronisasi ulang data logistik langsung dari server Atena ERP REST API
 */
router.post('/logistik/sync', async (req, res) => {
    try {
        const data = await logistikService.fetchData(true);
        return res.json({
            success: true,
            message: 'Sinkronisasi data Logistik dari Atena ERP berhasil',
            data
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Gagal sinkronisasi data logistik Atena ERP: ' + error.message
        });
    }
});

module.exports = router;
