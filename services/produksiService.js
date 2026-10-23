/**
 * ====================================================================
 * SERVICE: PRODUKSI API CLIENT (ATENA ERP REST API)
 * ====================================================================
 * Menghubungkan Dashboard ke REST API Atena ERP untuk lini Produksi:
 * 1. Manajemen Token Auth otomatis (Login, Refresh saat expired)
 * 2. Mengambil ringkasan (PenyelesaianPP/ringkasan) 7 lini produksi
 *    untuk HARI INI dan BULAN INI.
 * 3. Mengambil detail (PenyelesaianPP/detail) per lini produksi khusus.
 * 4. Caching in-memory + fallback persistensi lokal (data/produksi_cache.json)
 * ====================================================================
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config/app.config');

// Path cache persistensi lokal
const CACHE_DIR = path.join(__dirname, '..', 'data');
const PERSISTENT_CACHE_FILE = path.join(CACHE_DIR, 'produksi_cache.json');

// Pastikan folder data/ ada
if (!fs.existsSync(CACHE_DIR)) {
    try {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    } catch {
        // ignore
    }
}

// Daftar 7 Lini Produksi resmi dari Atena ERP
const BAGIAN_CONFIG = [
    { key: 'stentor', code: 'PROD_FINISHING', name: 'Produksi Finishing', unit: 'Meter / PCS', icon: 'industry' },
    { key: 'antiseptik', code: 'PROD_ANTISEPTIK', name: 'Produksi Antiseptik', unit: 'Botol / PCS', icon: 'pump-medical' },
    { key: 'cw', code: 'PROD_CW', name: 'Produksi CW', unit: 'PCS', icon: 'prescription-bottle' },
    { key: 'sizing', code: 'PROD_SIZING', name: 'Produksi Sizing', unit: 'Meter / Beam', icon: 'ruler-combined' },
    { key: 'poligyp', code: 'PROD_POLIGYP', name: 'Produksi Poligyp', unit: 'Roll / PCS', icon: 'bandage' },
    { key: 'ironing', code: 'PROD_IRONING', name: 'Produksi Ironing', unit: 'PCS / Meter', icon: 'shirt' },
    { key: 'surgicalpacking', code: 'PROD_SURGICAL_PACKING', name: 'Produksi Surgical Packing', unit: 'Box / Karton', icon: 'box-tissue' }
];

// In-memory cache & state
const cache = {
    summary: { data: null, timestamp: 0 },
    detailCache: new Map(), // key: bagian_period_tglawal_tglakhir
    authToken: null,
    tokenExpiresAt: 0,
    lastFetchedAt: null,
    isSyncing: false,
};

const CACHE_TTL_MS = 60 * 1000; // 60 detik in-memory TTL

/**
 * Helper mendapatkan tanggal hari ini dan awal bulan dalam format YYYY-MM-DD
 */
function getDateParams() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const today = `${year}-${month}-${day}`;
    const monthStart = `${year}-${month}-01`;
    return { today, monthStart };
}

/**
 * Muat cache cadangan dari file lokal saat start
 */
function loadPersistentCache() {
    try {
        if (fs.existsSync(PERSISTENT_CACHE_FILE)) {
            const raw = fs.readFileSync(PERSISTENT_CACHE_FILE, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed && parsed.data) {
                cache.summary.data = parsed.data;
                cache.lastFetchedAt = parsed.lastFetchedAt || new Date().toISOString();
                return parsed.data;
            }
        }
    } catch (e) {
        console.warn('[PRODUKSI CACHE]: Gagal membaca file cadangan:', e.message);
    }
    return null;
}

/**
 * Simpan data ke cache lokal (file json)
 */
function savePersistentCache(data) {
    try {
        const payload = {
            lastFetchedAt: new Date().toISOString(),
            data
        };
        fs.writeFileSync(PERSISTENT_CACHE_FILE, JSON.stringify(payload, null, 2), 'utf8');
    } catch (e) {
        console.warn('[PRODUKSI CACHE]: Gagal menyimpan file cadangan:', e.message);
    }
}

// Inisialisasi awal dari file jika ada
loadPersistentCache();

class ProduksiService {
    constructor() {
        this.apiConfig = config.atenaApi;
    }

    /**
     * Mendapatkan token JWT yang masih valid dari Atena ERP
     */
    async getToken(forceRefresh = false) {
        const now = Date.now();
        if (!forceRefresh && cache.authToken && (cache.tokenExpiresAt - now > 60000)) {
            return cache.authToken;
        }

        const loginUrl = `${this.apiConfig.baseUrl}Auth/login`;
        try {
            const response = await axios.post(
                loginUrl,
                {
                    username: this.apiConfig.username,
                    password: this.apiConfig.password,
                },
                {
                    timeout: this.apiConfig.timeoutMs || 10000,
                    headers: { 'Content-Type': 'application/json' }
                }
            );

            if (response.data && response.data.success && response.data.data?.token) {
                cache.authToken = response.data.data.token;
                cache.tokenExpiresAt = now + (60 * 60 * 1000);
                return cache.authToken;
            }

            throw new Error(response.data?.message || 'Login ke Atena API gagal: Format respons tidak sesuai');
        } catch (error) {
            const errMsg = error.response?.data?.message || error.message;
            console.error(`[ATENA AUTH ERROR]: ${errMsg}`);
            throw new Error(`Gagal otentikasi ke Atena API: ${errMsg}`);
        }
    }

    /**
     * Helper request dengan auto-retry jika token kedaluwarsa (HTTP 401)
     */
    async requestWithAuth(endpoint, body = {}, retry = true) {
        const token = await this.getToken();
        const url = `${this.apiConfig.baseUrl}${endpoint}`;

        try {
            const response = await axios.post(url, body, {
                timeout: this.apiConfig.timeoutMs || 15000,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            });

            return response.data;
        } catch (error) {
            if (retry && error.response && (error.response.status === 401 || error.response.status === 403)) {
                console.warn('[ATENA API]: Token tidak valid/kedaluwarsa, melakukan login ulang...');
                await this.getToken(true);
                return this.requestWithAuth(endpoint, body, false);
            }
            throw error;
        }
    }

    /**
     * Ambil ringkasan seluruh lini produksi (7 lini) untuk HARI INI dan BULAN INI secara paralel
     */
    async getRingkasanAll(forceRefresh = false) {
        const now = Date.now();

        if (!forceRefresh && cache.summary.data && (now - cache.summary.timestamp < CACHE_TTL_MS)) {
            return {
                data: cache.summary.data,
                cached: true,
                lastFetchedAt: cache.lastFetchedAt
            };
        }

        const { today, monthStart } = getDateParams();

        try {
            // Ambil ringkasan Hari Ini & Bulan Ini untuk 7 lini secara paralel
            const fetchPromises = BAGIAN_CONFIG.map(async (bagian) => {
                try {
                    const [resToday, resMonth] = await Promise.allSettled([
                        this.requestWithAuth('PenyelesaianPP/ringkasan', {
                            bagian: bagian.key,
                            tglawal: today,
                            tglakhir: today
                        }),
                        this.requestWithAuth('PenyelesaianPP/ringkasan', {
                            bagian: bagian.key,
                            tglawal: monthStart,
                            tglakhir: today
                        })
                    ]);

                    const todayData = resToday.status === 'fulfilled' && resToday.value?.success
                        ? resToday.value.data
                        : { total_pp: 0, pp_memenuhi: 0, pp_belum_memenuhi: 0, persentase: 0 };

                    const monthData = resMonth.status === 'fulfilled' && resMonth.value?.success
                        ? resMonth.value.data
                        : { total_pp: 0, pp_memenuhi: 0, pp_belum_memenuhi: 0, persentase: 0 };

                    return {
                        bagianKey: bagian.key,
                        code: bagian.code,
                        name: bagian.name,
                        unit: bagian.unit,
                        icon: bagian.icon,
                        today: todayData,
                        month: monthData
                    };
                } catch (err) {
                    console.error(`[PRODUKSI ERROR ${bagian.name}]:`, err.message);
                }

                return {
                    bagianKey: bagian.key,
                    code: bagian.code,
                    name: bagian.name,
                    unit: bagian.unit,
                    icon: bagian.icon,
                    today: { total_pp: 0, pp_memenuhi: 0, pp_belum_memenuhi: 0, persentase: 0 },
                    month: { total_pp: 0, pp_memenuhi: 0, pp_belum_memenuhi: 0, persentase: 0 }
                };
            });

            const results = await Promise.allSettled(fetchPromises);
            const summaryMap = {};

            // Global KPI akumulasi
            let totalPpToday = 0, memenuhiToday = 0, belumToday = 0;
            let totalPpMonth = 0, memenuhiMonth = 0, belumMonth = 0;

            results.forEach((res) => {
                if (res.status === 'fulfilled' && res.value) {
                    const item = res.value;
                    const td = item.today || {};
                    const mo = item.month || {};

                    summaryMap[item.code] = {
                        is_active: true,
                        bagian: item.bagianKey,
                        nama_bagian: item.name,
                        judul: mo.judul || `Penyelesaian PP ${item.name}`,
                        unit: item.unit,
                        icon: item.icon,

                        // Metrik Hari Ini
                        today: {
                            total_pp: td.total_pp || 0,
                            pp_memenuhi: td.pp_memenuhi || 0,
                            pp_belum_memenuhi: td.pp_belum_memenuhi || 0,
                            persentase: td.persentase || 0,
                            tglawal: today,
                            tglakhir: today
                        },

                        // Metrik Bulan Ini
                        month: {
                            total_pp: mo.total_pp || 0,
                            pp_memenuhi: mo.pp_memenuhi || 0,
                            pp_belum_memenuhi: mo.pp_belum_memenuhi || 0,
                            persentase: mo.persentase || 0,
                            tglawal: monthStart,
                            tglakhir: today
                        },

                        // Direct fields (bawaan Bulan Ini agar backward-compatible)
                        total_tiket: mo.total_pp || 0,
                        selesai: mo.pp_memenuhi || 0,
                        belum_selesai: mo.pp_belum_memenuhi || 0,
                        persentase_selesai: mo.persentase || 0,

                        // Direct fields Hari Ini & Bulan Ini untuk kemudahan binding frontend
                        today_total: td.total_pp || 0,
                        today_selesai: td.pp_memenuhi || 0,
                        today_belum: td.pp_belum_memenuhi || 0,
                        today_persentase: td.persentase || 0,

                        month_total: mo.total_pp || 0,
                        month_selesai: mo.pp_memenuhi || 0,
                        month_belum: mo.pp_belum_memenuhi || 0,
                        month_persentase: mo.persentase || 0,
                    };

                    totalPpToday += (td.total_pp || 0);
                    memenuhiToday += (td.pp_memenuhi || 0);
                    belumToday += (td.pp_belum_memenuhi || 0);

                    totalPpMonth += (mo.total_pp || 0);
                    memenuhiMonth += (mo.pp_memenuhi || 0);
                    belumMonth += (mo.pp_belum_memenuhi || 0);
                }
            });

            const persentaseToday = totalPpToday > 0
                ? Number(((memenuhiToday / totalPpToday) * 100).toFixed(1))
                : 0;
            const persentaseMonth = totalPpMonth > 0
                ? Number(((memenuhiMonth / totalPpMonth) * 100).toFixed(1))
                : 0;

            const finalPayload = {
                modules: summaryMap,
                kpi: {
                    today: {
                        total_pp: totalPpToday,
                        total_memenuhi: memenuhiToday,
                        total_belum: belumToday,
                        persentase: persentaseToday
                    },
                    month: {
                        total_pp: totalPpMonth,
                        total_memenuhi: memenuhiMonth,
                        total_belum: belumMonth,
                        persentase: persentaseMonth
                    },
                    // Default kpi
                    total_pp: totalPpMonth,
                    total_memenuhi: memenuhiMonth,
                    total_belum: belumMonth,
                    persentase: persentaseMonth
                }
            };

            // Simpan cache
            cache.summary.data = finalPayload;
            cache.summary.timestamp = now;
            cache.lastFetchedAt = new Date().toISOString();
            savePersistentCache(finalPayload);

            return {
                data: finalPayload,
                cached: false,
                lastFetchedAt: cache.lastFetchedAt
            };

        } catch (error) {
            console.error('[PRODUKSI GET ALL ERROR]:', error.message);

            if (cache.summary.data) {
                return {
                    data: cache.summary.data,
                    cached: true,
                    fallback: true,
                    warning: 'Menggunakan data cadangan: Server Atena sedang sibuk',
                    lastFetchedAt: cache.lastFetchedAt
                };
            }

            throw error;
        }
    }

    /**
     * Ambil data detail & ringkasan untuk SATU lini produksi tertentu
     * Mendukung filter rentang waktu: 'today' (hari ini) atau 'month' (bulan ini)
     */
    async getDetail(bagian, options = {}) {
        const { period = 'month', tglawal: customTglAwal, tglakhir: customTglAkhir, search = '', status = 'all', force = false } = options;
        const { today, monthStart } = getDateParams();

        let tglawal = customTglAwal;
        let tglakhir = customTglAkhir;

        if (!tglawal || !tglakhir) {
            if (period === 'today') {
                tglawal = today;
                tglakhir = today;
            } else {
                tglawal = monthStart;
                tglakhir = today;
            }
        }

        // Normalisasi key bagian
        let normalizedBagian = String(bagian).toLowerCase();
        const foundByCode = BAGIAN_CONFIG.find(b => b.code.toLowerCase() === normalizedBagian || b.key.toLowerCase() === normalizedBagian);
        if (foundByCode) {
            normalizedBagian = foundByCode.key;
        }

        const cacheKey = `${normalizedBagian}_${tglawal}_${tglakhir}`;
        const now = Date.now();

        let detailData = null;
        if (!force && cache.detailCache.has(cacheKey)) {
            const cachedItem = cache.detailCache.get(cacheKey);
            if (now - cachedItem.timestamp < CACHE_TTL_MS) {
                detailData = cachedItem.data;
            }
        }

        if (!detailData) {
            // Panggil detail untuk rentang terpilih, serta ringkasan rentang terpilih, Hari Ini & Bulan Ini
            const [detailRes, summaryRangeRes, summaryTodayRes, summaryMonthRes] = await Promise.allSettled([
                this.requestWithAuth('PenyelesaianPP/detail', {
                    bagian: normalizedBagian,
                    tglawal,
                    tglakhir
                }),
                this.requestWithAuth('PenyelesaianPP/ringkasan', {
                    bagian: normalizedBagian,
                    tglawal,
                    tglakhir
                }),
                this.requestWithAuth('PenyelesaianPP/ringkasan', {
                    bagian: normalizedBagian,
                    tglawal: today,
                    tglakhir: today
                }),
                this.requestWithAuth('PenyelesaianPP/ringkasan', {
                    bagian: normalizedBagian,
                    tglawal: monthStart,
                    tglakhir: today
                })
            ]);

            const rows = detailRes.status === 'fulfilled' && detailRes.value?.success && Array.isArray(detailRes.value.data?.rows)
                ? detailRes.value.data.rows
                : [];

            const summaryRange = summaryRangeRes.status === 'fulfilled' && summaryRangeRes.value?.success
                ? summaryRangeRes.value.data
                : null;

            const summaryToday = summaryTodayRes.status === 'fulfilled' && summaryTodayRes.value?.success
                ? summaryTodayRes.value.data
                : { total_pp: 0, pp_memenuhi: 0, pp_belum_memenuhi: 0, persentase: 0 };

            const summaryMonth = summaryMonthRes.status === 'fulfilled' && summaryMonthRes.value?.success
                ? summaryMonthRes.value.data
                : { total_pp: 0, pp_memenuhi: 0, pp_belum_memenuhi: 0, persentase: 0 };

            const currentSummary = summaryRange || (period === 'today' ? summaryToday : summaryMonth);

            detailData = {
                bagian: normalizedBagian,
                config: foundByCode || { key: normalizedBagian, name: currentSummary?.nama_bagian || normalizedBagian },
                period,
                tglawal,
                tglakhir,
                summary_today: summaryToday,
                summary_month: summaryMonth,
                ringkasan: currentSummary,
                rows
            };

            cache.detailCache.set(cacheKey, { data: detailData, timestamp: now });
        }

        // Terapkan filter status & pencarian kata kunci pada level memori
        let filteredRows = [...detailData.rows];

        if (status && status !== 'all') {
            const stUpper = status.toUpperCase();
            if (stUpper === 'MEMENUHI') {
                filteredRows = filteredRows.filter(r => (r.status || '').toUpperCase().includes('MEMENUHI') && !(r.status || '').toUpperCase().includes('BELUM'));
            } else if (stUpper === 'BELUM' || stUpper === 'BELUM MEMENUHI') {
                filteredRows = filteredRows.filter(r => (r.status || '').toUpperCase().includes('BELUM'));
            }
        }

        if (search && search.trim() !== '') {
            const q = search.trim().toLowerCase();
            filteredRows = filteredRows.filter(r => {
                const noPp = String(r.nomor_pp || '').toLowerCase();
                const nama = String(r.nama_barang || '').toLowerCase();
                const kode = String(r.kode_barang || '').toLowerCase();
                const divisi = String(r.divisi || '').toLowerCase();
                return noPp.includes(q) || nama.includes(q) || kode.includes(q) || divisi.includes(q);
            });
        }

        const totalRows = filteredRows.length;
        const totalPlan = filteredRows.reduce((acc, cur) => acc + (Number(cur.total_plan) || 0), 0);
        const totalActual = filteredRows.reduce((acc, cur) => acc + (Number(cur.total_actual) || 0), 0);

        return {
            bagian: detailData.bagian,
            config: detailData.config,
            period: detailData.period,
            tglawal: detailData.tglawal,
            tglakhir: detailData.tglakhir,
            summary_today: detailData.summary_today,
            summary_month: detailData.summary_month,
            ringkasan: detailData.ringkasan,
            total_data: totalRows,
            total_plan: totalPlan,
            total_actual: totalActual,
            rows: filteredRows
        };
    }

    /**
     * Mengambil daftar semua opsi bagian produksi
     */
    getBagianList() {
        return BAGIAN_CONFIG;
    }
}

module.exports = new ProduksiService();
