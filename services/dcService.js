/**
 * ====================================================================
 * SERVICE: DC (DOCUMENT CONTROL) - REST API PAPERLESS
 * ====================================================================
 * Mengambil data pemantauan pengerjaan dokumen dari REST API Paperless:
 * 1. Login: POST Auth/login (Bearer Token JWT)
 * 2. Ringkasan: POST PenyelesaianDokumen/ringkasan
 * 3. Detail: POST PenyelesaianDokumen/detail
 * 
 * Dilengkapi in-memory caching, auto re-login, dan fallback cache
 * persisten (data/dc_paperless_cache.json).
 * ====================================================================
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config/app.config');

const CACHE_DIR = path.join(__dirname, '..', 'data');
const PERSISTENT_CACHE_FILE = path.join(CACHE_DIR, 'dc_paperless_cache.json');

if (!fs.existsSync(CACHE_DIR)) {
    try {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    } catch {
        // ignore
    }
}

// In-memory cache
const cache = {
    summary: { data: null, timestamp: 0 },
    detailCache: new Map(), // key: tglawal_tglakhir
    authToken: null,
    tokenExpiresAt: 0,
    lastFetchedAt: null,
    isSyncing: false,
};

const CACHE_TTL_MS = 60 * 1000; // 60 detik

function getDateRange(customMonth, customYear) {
    const now = new Date();
    const year = customYear ? parseInt(customYear, 10) : now.getFullYear();
    const monthNum = customMonth ? parseInt(customMonth, 10) : (now.getMonth() + 1);
    const month = String(monthNum).padStart(2, '0');
    const isCurrent = (year === now.getFullYear() && monthNum === (now.getMonth() + 1));
    const lastDay = new Date(year, monthNum, 0).getDate();
    const endDay = isCurrent ? String(now.getDate()).padStart(2, '0') : String(lastDay).padStart(2, '0');

    const tglawal = `${year}-${month}-01`;
    const tglakhir = `${year}-${month}-${endDay}`;
    return { tglawal, tglakhir, year, month: monthNum, isCurrent };
}

function loadPersistentCache() {
    try {
        if (fs.existsSync(PERSISTENT_CACHE_FILE)) {
            const raw = fs.readFileSync(PERSISTENT_CACHE_FILE, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed) {
                cache.lastFetchedAt = parsed.lastFetchedAt || new Date().toISOString();
                return parsed;
            }
        }
    } catch (err) {
        console.warn('⚠️ [DC CACHE]: Gagal membaca cache cadangan:', err.message);
    }
    return null;
}

function savePersistentCache(summary, rows) {
    try {
        const payload = {
            lastFetchedAt: new Date().toISOString(),
            summary: summary || {},
            rows: rows || []
        };
        fs.writeFileSync(PERSISTENT_CACHE_FILE, JSON.stringify(payload, null, 2), 'utf8');
    } catch (err) {
        console.warn('⚠️ [DC CACHE]: Gagal menyimpan cache cadangan:', err.message);
    }
}

class DcService {
    constructor() {
        this.apiConfig = config.paperlessApi || {
            baseUrl: 'http://alpha_sna_medika_paperless.test/API/Dashboard/',
            username: 'ADMINDC@YOPMAIL.COM',
            password: '12345678',
            timeoutMs: 10000,
        };
        loadPersistentCache();
    }

    /**
     * Otentikasi ke Paperless API untuk mendapatkan JWT Bearer Token
     */
    async getToken(forceRefresh = false) {
        const now = Date.now();
        if (!forceRefresh && cache.authToken && cache.tokenExpiresAt > (now + 60000)) {
            return cache.authToken;
        }

        const loginUrl = `${this.apiConfig.baseUrl}Auth/login`;
        try {
            const res = await axios.post(loginUrl, {
                username: this.apiConfig.username,
                password: this.apiConfig.password
            }, {
                timeout: this.apiConfig.timeoutMs || 10000,
                headers: { 'Content-Type': 'application/json' }
            });

            if (res.data && res.data.success && res.data.data && res.data.data.token) {
                cache.authToken = res.data.data.token;
                cache.tokenExpiresAt = now + (2 * 60 * 60 * 1000); // 2 jam default
                return cache.authToken;
            }
            throw new Error(res.data?.message || 'Login Paperless gagal');
        } catch (err) {
            console.warn(`⚠️ [PAPERLESS AUTH]: Gagal login ke ${loginUrl}: ${err.message}`);
            return null;
        }
    }

    /**
     * Ringkasan KPI DC untuk Card Dashboard
     */
    async getSummary(force = false, customDates = null) {
        const now = Date.now();
        const dateRange = getDateRange(customDates?.bulan, customDates?.tahun);
        const cacheKey = `${dateRange.tglawal}_${dateRange.tglakhir}`;

        if (!force && cache.summary.data && (now - cache.summary.timestamp < CACHE_TTL_MS)) {
            return cache.summary.data;
        }

        let summaryData = null;
        const token = await this.getToken(force);

        if (token) {
            try {
                const ringkasanUrl = `${this.apiConfig.baseUrl}PenyelesaianDokumen/ringkasan`;
                const res = await axios.post(ringkasanUrl, {
                    tglawal: dateRange.tglawal,
                    tglakhir: dateRange.tglakhir
                }, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: this.apiConfig.timeoutMs || 10000
                });

                if (res.data && res.data.success && res.data.data) {
                    const d = res.data.data;
                    const total = Number(d.total_masuk || 0);
                    const selesai = Number(d.total_selesai || 0);
                    const belum = Number(d.total_belum || (total - selesai));
                    const persen = Number(d.persentase ?? (total > 0 ? (selesai / total * 100) : 0));

                    summaryData = {
                        success: true,
                        total,
                        total_masuk: total,
                        selesai,
                        total_selesai: selesai,
                        belum,
                        total_belum: belum,
                        persentase: Number(persen.toFixed(2)),
                        persentase_selesai: Number(persen.toFixed(2)),
                        tglawal: d.tglawal || dateRange.tglawal,
                        tglakhir: d.tglakhir || dateRange.tglakhir,
                        last_sync: new Date().toISOString(),
                        source: 'API Paperless'
                    };
                }
            } catch (apiErr) {
                console.warn(`⚠️ [DC API RINGKASAN ERROR]: ${apiErr.message}`);
            }
        }

        // Jika API tidak terjangkau atau gagal, gunakan fallback cache persisten
        if (!summaryData) {
            const diskCache = loadPersistentCache();
            if (diskCache && diskCache.summary) {
                // Filter rows untuk rentang waktu jika ada
                const allRows = diskCache.rows || [];
                const filtered = allRows.filter(r => {
                    if (!r.tgl_permohonan) return true;
                    return r.tgl_permohonan >= dateRange.tglawal && r.tgl_permohonan <= dateRange.tglakhir;
                });

                const targetRows = filtered.length > 0 ? filtered : allRows;
                const total = targetRows.length;
                const selesai = targetRows.filter(r => r.is_selesai || (r.status || '').toUpperCase() === 'SELESAI').length;
                const belum = total - selesai;
                const persentase = total > 0 ? Number(((selesai / total) * 100).toFixed(2)) : 0;

                summaryData = {
                    success: true,
                    total,
                    total_masuk: total,
                    selesai,
                    total_selesai: selesai,
                    belum,
                    total_belum: belum,
                    persentase,
                    persentase_selesai: persentase,
                    tglawal: dateRange.tglawal,
                    tglakhir: dateRange.tglakhir,
                    last_sync: diskCache.lastFetchedAt || new Date().toISOString(),
                    source: 'Cache Paperless (Offline Fallback)'
                };
            } else {
                summaryData = {
                    success: false,
                    total: 0,
                    selesai: 0,
                    belum: 0,
                    persentase: 0,
                    persentase_selesai: 0,
                    tglawal: dateRange.tglawal,
                    tglakhir: dateRange.tglakhir,
                    last_sync: new Date().toISOString(),
                    source: 'Default Standby'
                };
            }
        }

        cache.summary = { data: summaryData, timestamp: now };
        return summaryData;
    }

    /**
     * Mengambil detail rows untuk Modal Monitoring DC (Paperless)
     */
    async getModalData(options = {}) {
        const {
            range = 'month',
            status = 'all',
            jenis = 'all',
            search = '',
            bulan,
            tahun,
            tglawal,
            tglakhir,
            page = 1,
            pageSize = 15,
            force = false
        } = options;

        const dateRange = getDateRange(bulan, tahun);
        const token = await this.getToken(force);
        let rows = [];

        if (token) {
            try {
                const detailUrl = `${this.apiConfig.baseUrl}PenyelesaianDokumen/detail`;
                const body = range === 'month' ? {
                    tglawal: dateRange.tglawal,
                    tglakhir: dateRange.tglakhir
                } : {};

                const res = await axios.post(detailUrl, body, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: this.apiConfig.timeoutMs || 10000
                });

                if (res.data && res.data.success && res.data.data && Array.isArray(res.data.data.rows)) {
                    rows = res.data.data.rows.map((r, idx) => ({
                        id: idx + 1,
                        nomor_klausul: r.nomor_klausul || '-',
                        jenis_dokumen: r.jenis_dokumen || '-',
                        nama_dokumen: r.nama_dokumen || '-',
                        nomor_revisi: r.nomor_revisi ?? '-',
                        tgl_permohonan: r.tgl_permohonan || '',
                        bagian: r.bagian || '-',
                        tahap: r.tahap || '-',
                        status: (r.status || 'BELUM SELESAI').toUpperCase(),
                        is_selesai: (r.status || '').toUpperCase() === 'SELESAI'
                    }));

                    savePersistentCache(res.data.data, rows);
                }
            } catch (err) {
                console.warn(`⚠️ [DC API DETAIL ERROR]: ${err.message}`);
            }
        }

        // Fallback ke cache jika rows kosong
        if (rows.length === 0) {
            const diskCache = loadPersistentCache();
            if (diskCache && Array.isArray(diskCache.rows)) {
                rows = diskCache.rows;
            }
        }

        // 1. Filter Range Waktu
        let filtered = rows;
        if (range === 'custom' && (tglawal || tglakhir)) {
            filtered = filtered.filter(r => {
                if (!r.tgl_permohonan) return true;
                if (tglawal && r.tgl_permohonan < tglawal) return false;
                if (tglakhir && r.tgl_permohonan > tglakhir) return false;
                return true;
            });
        } else if (range === 'today') {
            const now = new Date();
            const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            const tFiltered = filtered.filter(r => r.tgl_permohonan === todayStr);
            filtered = tFiltered.length > 0 ? tFiltered : rows;
        } else if (range === 'month') {
            const mFiltered = filtered.filter(r => {
                if (!r.tgl_permohonan) return true;
                return r.tgl_permohonan >= dateRange.tglawal && r.tgl_permohonan <= dateRange.tglakhir;
            });
            // Fallback ke seluruh dataset jika pada bulan filter belum ada data transaksi baru
            filtered = mFiltered.length > 0 ? mFiltered : rows;
        }

        // 2. Filter Status (selesai / belum)
        if (status === 'selesai') {
            filtered = filtered.filter(r => r.is_selesai || r.status === 'SELESAI');
        } else if (status === 'belum') {
            filtered = filtered.filter(r => !r.is_selesai && r.status !== 'SELESAI');
        }

        // 3. Filter Jenis Dokumen
        if (jenis && jenis !== 'all') {
            const jLower = jenis.toLowerCase();
            filtered = filtered.filter(r => (r.jenis_dokumen || '').toLowerCase().includes(jLower));
        }

        // 4. Pencarian teks
        if (search && search.trim()) {
            const q = search.trim().toLowerCase();
            filtered = filtered.filter(r =>
                (r.nama_dokumen || '').toLowerCase().includes(q) ||
                (r.nomor_klausul || '').toLowerCase().includes(q) ||
                (r.bagian || '').toLowerCase().includes(q) ||
                (r.tahap || '').toLowerCase().includes(q) ||
                (r.jenis_dokumen || '').toLowerCase().includes(q)
            );
        }

        // KPI Ringkasan dari data hasil filter
        const totalItems = filtered.length;
        const selesaiCount = filtered.filter(r => r.is_selesai || r.status === 'SELESAI').length;
        const belumCount = totalItems - selesaiCount;
        const persentase = totalItems > 0 ? Number(((selesaiCount / totalItems) * 100).toFixed(2)) : 0;

        // Breakdown jenis dokumen
        const jenisBreakdown = {};
        filtered.forEach(r => {
            const j = r.jenis_dokumen || 'LAINNYA';
            jenisBreakdown[j] = (jenisBreakdown[j] || 0) + 1;
        });

        // Pagination
        const p = Math.max(1, parseInt(page, 10) || 1);
        const limit = Math.max(1, parseInt(pageSize, 10) || 15);
        const totalPages = Math.ceil(totalItems / limit) || 1;
        const offset = (p - 1) * limit;
        const pagedItems = filtered.slice(offset, offset + limit);

        return {
            success: true,
            kpi: {
                total: totalItems,
                selesai: selesaiCount,
                belum: belumCount,
                persentase,
                jenis_breakdown: jenisBreakdown
            },
            pagination: {
                page: p,
                pageSize: limit,
                totalItems,
                totalPages,
                hasNext: p < totalPages,
                hasPrev: p > 1
            },
            items: filtered,
paged_items: pagedItems,
            source: token ? 'API Paperless' : 'Cache Paperless (Offline Fallback)'
        };
    }
}

const dcService = new DcService();
module.exports = dcService;

