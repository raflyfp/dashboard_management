/**
 * ====================================================================
 * DASHBOARD MANAGEMENT - MONITORING LAYANAN IT, TEKNIK & GA
 * ====================================================================
 * Backend: Node.js + Express
 * Fungsi:
 * 1. Mengambil data real-time dari API Ticketing Laravel menggunakan API Key.
 * 2. Mengolah & mengagregasikan statistik 3 unit layanan (IT, Teknik, GA).
 * 3. Menyediakan cache internal untuk efisiensi beban server saat ditampilkan di TV/Layar besar.
 * 4. Menyajikan Web Dashboard statis (HTML, CSS, JS) di layar monitor.
 * 
 * Dibuat dengan struktur yang bersih dan ramah untuk developer junior.
 * ====================================================================
 */

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');

// Inisialisasi Express App
const app = express();

// ====================================================================
// 1. KONFIGURASI DARI .ENV (DENGAN NILAI DEFAULT JIKA BELUM ADA)
// ====================================================================
const PORT = parseInt(process.env.PORT, 10) || 3000;
const TICKETING_API_URL = process.env.TICKETING_API_URL || 'http://127.0.0.1:8002/api/v1';
const TICKETING_API_KEY = process.env.TICKETING_API_KEY || 'tk_live_UQ6LbgRmq2dSldzeTuSkZbAezAr1aDaV';
const CACHE_TTL_MS = (parseInt(process.env.CACHE_TTL_SECONDS, 10) || 5) * 1000;
const REFRESH_INTERVAL_SECONDS = parseInt(process.env.REFRESH_INTERVAL_SECONDS, 10) || 15;

// ====================================================================
// 2. MIDDLEWARE DASAR
// ====================================================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sajikan folder public/ untuk tampilan web (HTML, CSS, JS, Gambar/Icon)
app.use(express.static(path.join(__dirname, 'public')));

// ====================================================================
// 3. CACHE IN-MEMORY SEDERHANA
// ====================================================================
// Mencegah request berlebihan ke Laravel jika banyak layar TV membuka dashboard bersamaan
const cache = {
    stats: {
        data: null,
        timestamp: 0,
    },
    tickets: new Map(), // Menyimpan cache tiket per query key
};

/**
 * Helper untuk membuat instance Axios dengan header API Key bawaan
 */
const apiClient = axios.create({
    baseURL: TICKETING_API_URL,
    timeout: 8000, // Timeout 8 detik jika server lambat
    headers: {
        'Accept': 'application/json',
        'X-API-KEY': TICKETING_API_KEY,
    }
});

// ====================================================================
// 4. API ENDPOINTS (UNTUK KONSUMSI FRONTEND DASHBOARD)
// ====================================================================

/**
 * Endpoint: GET /api/dashboard/config
 * Mengirimkan konfigurasi ke frontend (seperti interval refresh)
 */
app.get('/api/dashboard/config', (req, res) => {
    res.json({
        success: true,
        refresh_interval_seconds: REFRESH_INTERVAL_SECONDS,
        api_connected: true,
        services: [
            { code: 'IT', label: 'Layanan IT', color: '#06b6d4' },
            { code: 'TK', label: 'Layanan Teknik', color: '#f59e0b' },
            { code: 'GA', label: 'Layanan GA', color: '#10b981' }
        ]
    });
});

/**
 * Endpoint: GET /api/dashboard/stats
 * Mengambil ringkasan statistik untuk 3 Card Utama (IT, Teknik, GA):
 * - Total semua tiket
 * - Tiket yang sudah selesai (closed + done)
 * - Tiket yang belum selesai (open, checking, in_progress, dll)
 * - Persentase penyelesaian (%)
 * - Daftar tiket yang butuh perhatian manajemen (urgent / lama menggantung)
 */
app.get('/api/dashboard/stats', async (req, res) => {
    const now = Date.now();
    const forceRefresh = req.query.force === 'true';

    // 1. Cek apakah cache masih berlaku (kurang dari CACHE_TTL_MS)
    if (!forceRefresh && cache.stats.data && (now - cache.stats.timestamp < CACHE_TTL_MS)) {
        return res.json({
            ...cache.stats.data,
            _cached: true,
            _cache_age_seconds: Math.round((now - cache.stats.timestamp) / 1000)
        });
    }

    try {
        // 2. Request ke API Laravel Ticketing
        const response = await apiClient.get('/monitoring/summary');
        const apiData = response.data;

        if (!apiData.success) {
            throw new Error(apiData.message || 'Gagal mengambil data dari API ticketing');
        }

        const summaryData = apiData.data;

        // 3. Normalisasi data khusus untuk 3 Card Layanan (IT, Teknik [TK], GA)
        // Jika data dari Laravel belum ada format 'layanan_monitoring', kita buat fallback otomatis
        const rawCards = summaryData.layanan_monitoring || {};

        const servicesResult = {
            IT: {
                kode: 'IT',
                nama: 'Layanan IT',
                sub_nama: 'Software, Jaringan & Hardware',
                icon: 'laptop-code',
                sumber: 'Ticketing',
                is_active: true,
                total_tiket: rawCards.IT?.total_tiket ?? 0,
                selesai: rawCards.IT?.selesai ?? 0,
                belum_selesai: rawCards.IT?.belum_selesai ?? 0,
                ditolak: rawCards.IT?.ditolak ?? 0,
                persentase_selesai: rawCards.IT?.persentase_selesai ?? 0,
                status_detail: rawCards.IT?.status_detail ?? { open: 0, in_progress: 0, checking: 0 },
            },
            TK: {
                kode: 'TK',
                nama: 'Layanan Teknik',
                sub_nama: 'Mesin, Listrik & Utilitas',
                icon: 'screwdriver-wrench',
                sumber: 'Ticketing',
                is_active: true,
                total_tiket: rawCards.TK?.total_tiket ?? 0,
                selesai: rawCards.TK?.selesai ?? 0,
                belum_selesai: rawCards.TK?.belum_selesai ?? 0,
                ditolak: rawCards.TK?.ditolak ?? 0,
                persentase_selesai: rawCards.TK?.persentase_selesai ?? 0,
                status_detail: rawCards.TK?.status_detail ?? { open: 0, in_progress: 0, checking: 0 },
            },
            GA: {
                kode: 'GA',
                nama: 'Layanan GA',
                sub_nama: 'Gedung, Kebersihan & Sarpras',
                icon: 'building-user',
                sumber: 'Ticketing',
                is_active: true,
                total_tiket: rawCards.GA?.total_tiket ?? 0,
                selesai: rawCards.GA?.selesai ?? 0,
                belum_selesai: rawCards.GA?.belum_selesai ?? 0,
                ditolak: rawCards.GA?.ditolak ?? 0,
                persentase_selesai: rawCards.GA?.persentase_selesai ?? 0,
                status_detail: rawCards.GA?.status_detail ?? { open: 0, in_progress: 0, checking: 0 },
            },
            KAIZEN: {
                kode: 'KAIZEN',
                nama: 'Pelaporan Kaizen',
                sub_nama: 'Continuous Improvement & Ide',
                icon: 'lightbulb',
                sumber: 'Aplikasi Kaizen',
                is_active: false,
                total_tiket: 0,
                selesai: 0,
                belum_selesai: 0,
                ditolak: 0,
                persentase_selesai: 0,
                status_detail: { open: 0, in_progress: 0, checking: 0 },
            },
            ESYS: {
                kode: 'ESYS',
                nama: 'E-System ERP',
                sub_nama: 'Enterprise Core & Logistik',
                icon: 'server',
                sumber: 'Aplikasi E-System',
                is_active: false,
                total_tiket: 0,
                selesai: 0,
                belum_selesai: 0,
                ditolak: 0,
                persentase_selesai: 0,
                status_detail: { open: 0, in_progress: 0, checking: 0 },
            },
            SIMRS: {
                kode: 'SIMRS',
                nama: 'SIMRS & EMR',
                sub_nama: 'Rekam Medis & Pelayanan Pasien',
                icon: 'hospital',
                sumber: 'Aplikasi SIMRS',
                is_active: false,
                total_tiket: 0,
                selesai: 0,
                belum_selesai: 0,
                ditolak: 0,
                persentase_selesai: 0,
                status_detail: { open: 0, in_progress: 0, checking: 0 },
            },
            FARMASI: {
                kode: 'FARMASI',
                nama: 'Farmasi & Obat',
                sub_nama: 'Resep, Stok & Distribusi Depo',
                icon: 'pills',
                sumber: 'Aplikasi Farmasi',
                is_active: false,
                total_tiket: 0,
                selesai: 0,
                belum_selesai: 0,
                ditolak: 0,
                persentase_selesai: 0,
                status_detail: { open: 0, in_progress: 0, checking: 0 },
            },
            LAB: {
                kode: 'LAB',
                nama: 'Lab & Diagnostik',
                sub_nama: 'Pemeriksaan Sampel & Radiologi',
                icon: 'flask-vial',
                sumber: 'Aplikasi Lab',
                is_active: false,
                total_tiket: 0,
                selesai: 0,
                belum_selesai: 0,
                ditolak: 0,
                persentase_selesai: 0,
                status_detail: { open: 0, in_progress: 0, checking: 0 },
            },
            BILLING: {
                kode: 'BILLING',
                nama: 'Keuangan & Kasir',
                sub_nama: 'Klaim BPJS & Pembayaran Pasien',
                icon: 'money-bill-wave',
                sumber: 'Aplikasi Keuangan',
                is_active: false,
                total_tiket: 0,
                selesai: 0,
                belum_selesai: 0,
                ditolak: 0,
                persentase_selesai: 0,
                status_detail: { open: 0, in_progress: 0, checking: 0 },
            },
            SDM: {
                kode: 'SDM',
                nama: 'SDM & Personalia',
                sub_nama: 'Kehadiran, Cuti & Kinerja Staf',
                icon: 'user-tie',
                sumber: 'Aplikasi SDM',
                is_active: false,
                total_tiket: 0,
                selesai: 0,
                belum_selesai: 0,
                ditolak: 0,
                persentase_selesai: 0,
                status_detail: { open: 0, in_progress: 0, checking: 0 },
            }
        };

        // 4. Hitung Akumulasi Total Keseluruhan (Global KPI)
        const totalSemuaTiket = servicesResult.IT.total_tiket + servicesResult.TK.total_tiket + servicesResult.GA.total_tiket;
        const totalSemuaSelesai = servicesResult.IT.selesai + servicesResult.TK.selesai + servicesResult.GA.selesai;
        const totalSemuaBelum = servicesResult.IT.belum_selesai + servicesResult.TK.belum_selesai + servicesResult.GA.belum_selesai;
        const persentaseGlobal = totalSemuaTiket > 0 ? Number(((totalSemuaSelesai / totalSemuaTiket) * 100).toFixed(1)) : 0;

        const result = {
            success: true,
            server_time: apiData.server_time || new Date().toISOString(),
            kpi_global: {
                total_tiket: totalSemuaTiket,
                total_selesai: totalSemuaSelesai,
                total_belum_selesai: totalSemuaBelum,
                persentase_selesai: persentaseGlobal,
                total_aktif: summaryData.total_tiket_aktif || 0,
            },
            layanan: servicesResult,
            perlu_perhatian: summaryData.perlu_perhatian || [],
            source_api: TICKETING_API_URL,
        };

        // Simpan ke memory cache
        cache.stats.data = result;
        cache.stats.timestamp = now;

        return res.json({
            ...result,
            _cached: false
        });

    } catch (error) {
        console.error('[API ERROR /stats]:', error.message);

        // Jika API Laravel sedang error/down tapi kita punya data cache lama, kirimkan cache lama agar TV tidak kosong
        if (cache.stats.data) {
            return res.json({
                ...cache.stats.data,
                _cached: true,
                _warning: 'Menggunakan data cadangan: Server ticketing sedang sibuk/offline',
                _error_detail: error.message
            });
        }

        return res.status(502).json({
            success: false,
            message: 'Gagal terhubung ke API Ticketing. Pastikan Laravel di Laragon aktif di port 8002.',
            error: error.message
        });
    }
});

/**
 * Endpoint: GET /api/dashboard/tickets
 * Mengambil daftar tiket spesifik per service (IT / TK / GA)
 * Query params yang didukung:
 * - service: 'IT' / 'TK' / 'GA' (opsional)
 * - status: 'all', 'selesai', 'belum', 'open', 'in_progress', 'checking', dll
 * - limit: default 30 (max 100)
 */
app.get('/api/dashboard/tickets', async (req, res) => {
    const { service, status, limit = 30 } = req.query;
    const cacheKey = `${service || 'ALL'}_${status || 'DEFAULT'}_${limit}`;
    const now = Date.now();

    // Cek cache tiket (TTL 5 detik)
    const cachedItem = cache.tickets.get(cacheKey);
    if (cachedItem && (now - cachedItem.timestamp < 5000)) {
        return res.json(cachedItem.data);
    }

    try {
        const response = await apiClient.get('/monitoring/tickets', {
            params: {
                service: service || undefined,
                status: status || undefined,
                limit: Math.min(parseInt(limit, 10) || 30, 100)
            }
        });

        const result = response.data;
        cache.tickets.set(cacheKey, { data: result, timestamp: now });

        return res.json(result);
    } catch (error) {
        console.error('[API ERROR /tickets]:', error.message);
        return res.status(502).json({
            success: false,
            message: 'Gagal mengambil daftar tiket dari sistem ticketing.',
            error: error.message
        });
    }
});

/**
 * Endpoint: GET /api/health
 * Pengecekan status server Express & koneksi ke Laravel
 */
app.get('/api/health', async (req, res) => {
    let apiStatus = 'unknown';
    try {
        const ping = await apiClient.get('/ping', { timeout: 3000 });
        apiStatus = ping.data?.status === 'online' ? 'online' : 'connected';
    } catch (e) {
        apiStatus = 'offline (' + e.message + ')';
    }

    res.json({
        status: 'ok',
        uptime_seconds: Math.floor(process.uptime()),
        ticketing_api: {
            url: TICKETING_API_URL,
            status: apiStatus
        },
        timestamp: new Date().toISOString()
    });
});

// ====================================================================
// 5. MENJALANKAN SERVER
// ====================================================================
app.listen(PORT, '0.0.0.0', () => {
    console.log('====================================================');
    console.log('🚀 MANAGEMENT MONITORING DASHBOARD TELAH AKTIF!');
    console.log(`📡 URL Lokal     : http://localhost:${PORT}`);
    console.log(`📺 URL Layar TV   : http://localhost:${PORT} (atau gunakan IP Komputer)`);
    console.log(`🔗 API Ticketing : ${TICKETING_API_URL}`);
    console.log('====================================================');
});