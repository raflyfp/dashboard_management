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
 * Mengumpulkan data dari API ticketing & modul aplikasi lainnya
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
        // 2. Ambil data dari Layanan Ticketing
        const apiData = await ticketingService.getSummary();

        // Pemberitahuan status koneksi berhasil ke terminal server
        if (lastApiStatus !== 'online') {
            const timeStr = new Date().toLocaleTimeString('id-ID');
            console.log(`[${timeStr}] ✅ [API TICKETING]: Berhasil terhubung & sinkronisasi data dari ${config.ticketing.baseUrl}`);
            lastApiStatus = 'online';
        }

        const summaryData = apiData.data || {};
        const rawCards = summaryData.layanan_monitoring || {};

        // 3. Susunan 10 Modul Layanan (Sesuai Kebutuhan Manajemen SNA Medika)
        const servicesResult = {
            // --- Modul dari Ticketing (Aktif & Live) ---
            IT: {
                kode: 'IT',
                nama: 'Layanan IT',
                sub_nama: 'Software & Jaringan',
                icon: 'laptop-code',
                sumber: 'Ticketing',
                is_active: true,
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
            TK: {
                kode: 'TK',
                nama: 'Layanan Teknik',
                sub_nama: 'Mesin & Utilitas',
                icon: 'screwdriver-wrench',
                sumber: 'Ticketing',
                is_active: true,
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
            GA: {
                kode: 'GA',
                nama: 'Layanan GA',
                sub_nama: 'Gedung & Sarpras',
                icon: 'building-user',
                sumber: 'Ticketing',
                is_active: true,
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

            // --- Modul Aplikasi Lain (Siap Dihubungkan / Standby) ---
            KAIZEN: {
                kode: 'KAIZEN',
                nama: 'Pelaporan Kaizen',
                sub_nama: 'Ide & Improvement',
                icon: 'lightbulb',
                sumber: 'Aplikasi Kaizen',
                is_active: false,
                total_tiket: 0,
                selesai: 0,
                belum_selesai: 0,
                persentase_selesai: 0,
            },
            ESYS: {
                kode: 'ESYS',
                nama: 'Purchasing',
                sub_nama: 'Pengadaan & PO',
                icon: 'cart-shopping',
                sumber: 'Aplikasi Purchasing',
                is_active: false,
                total_tiket: 0,
                selesai: 0,
                belum_selesai: 0,
                persentase_selesai: 0,
            },
            SIMRS: {
                kode: 'SIMRS',
                nama: 'PPIC',
                sub_nama: 'Perencanaan Produksi',
                icon: 'calendar-check',
                sumber: 'Aplikasi PPIC',
                is_active: false,
                total_tiket: 0,
                selesai: 0,
                belum_selesai: 0,
                persentase_selesai: 0,
            },
            FARMASI: {
                kode: 'FARMASI',
                nama: 'Penilaian Karyawan',
                sub_nama: 'Evaluasi & Kinerja SDM',
                icon: 'clipboard-user',
                sumber: 'Aplikasi Penilaian',
                is_active: false,
                total_tiket: 0,
                selesai: 0,
                belum_selesai: 0,
                persentase_selesai: 0,
            },
            LAB: {
                kode: 'LAB',
                nama: 'Produksi 1',
                sub_nama: 'Lini Manufaktur 1',
                icon: 'industry',
                sumber: 'Aplikasi Produksi 1',
                is_active: false,
                total_tiket: 0,
                selesai: 0,
                belum_selesai: 0,
                persentase_selesai: 0,
            },
            BILLING: {
                kode: 'BILLING',
                nama: 'Produksi 2',
                sub_nama: 'Lini Manufaktur 2',
                icon: 'industry',
                sumber: 'Aplikasi Produksi 2',
                is_active: false,
                total_tiket: 0,
                selesai: 0,
                belum_selesai: 0,
                persentase_selesai: 0,
            },
            SDM: {
                kode: 'SDM',
                nama: 'Produksi 3',
                sub_nama: 'Lini Manufaktur 3',
                icon: 'industry',
                sumber: 'Aplikasi Produksi 3',
                is_active: false,
                total_tiket: 0,
                selesai: 0,
                belum_selesai: 0,
                persentase_selesai: 0,
            }
        };

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
            server_time: apiData.server_time || new Date().toISOString(),
            kpi_global: {
                total_tiket: totalSemua,
                total_selesai: totalSelesai,
                total_belum_selesai: totalBelum,
                total_ditolak: totalDitolak,
                total_efektif: totalEfektifGlobal,
                persentase_selesai: persentaseGlobal,
                total_aktif: summaryData.total_tiket_aktif || 0,
            },
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
    const { service, status, limit = 30 } = req.query;
    const cacheKey = `${service || 'ALL'}_${status || 'DEFAULT'}_${limit}`;
    const now = Date.now();

    // Cache tiket 5 detik
    const cachedItem = cache.tickets.get(cacheKey);
    if (cachedItem && (now - cachedItem.timestamp < 5000)) {
        return res.json(cachedItem.data);
    }

    try {
        const result = await ticketingService.getTickets({ service, status, limit });
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

module.exports = router;
