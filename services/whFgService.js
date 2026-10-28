/**
 * ====================================================================
 * SERVICE: WH FG API CLIENT (ATENA ERP REST API)
 * ====================================================================
 * Menghubungkan Dashboard ke REST API resmi Atena ERP untuk Warehouse Finished Goods (WH FG):
 * - Endpoint: PenyelesaianDR/ringkasan & PenyelesaianDR/detail
 * - Monitoring realisasi Delivery Receipt (DR) ke Delivery Note (DN) Barang Jadi
 * - Manajemen Token JWT otomatis (Login & auto-refresh)
 * - Agregasi KPI (Total DR, DR Sudah DN, DR Belum DN, Persentase Capaian, Total Qty)
 * - Caching in-memory + fallback persistensi lokal (data/wh_fg_cache.json)
 * ====================================================================
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config/app.config');

// Path cache persistensi lokal
const CACHE_DIR = path.join(__dirname, '..', 'data');
const PERSISTENT_CACHE_FILE = path.join(CACHE_DIR, 'wh_fg_cache.json');

// Pastikan folder data/ ada
if (!fs.existsSync(CACHE_DIR)) {
    try {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    } catch {
        // ignore
    }
}

// In-memory cache & state
const cache = {
    summary: { data: null, timestamp: 0 },
    detailCache: new Map(), // key: range/dates
    authToken: null,
    tokenExpiresAt: 0,
    lastFetchedAt: null,
    isSyncing: false,
};

const CACHE_TTL_MS = 60 * 1000; // 60 detik in-memory TTL

/**
 * Helper format Date ke YYYY-MM-DD
 */
function formatDate(date) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Format tanggal ke label singkat Indonesia (misal: "15 Okt 2026")
 */
function formatShortDate(dateStr) {
    if (!dateStr) return '-';
    try {
        const parts = String(dateStr).split('-');
        if (parts.length === 3) {
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
            const year = parts[0];
            const monthIdx = parseInt(parts[1], 10) - 1;
            const day = parts[2];
            return `${day} ${months[monthIdx] || ''} ${year}`;
        }
    } catch {
        // fallback
    }
    return dateStr;
}

/**
 * Helper mendapatkan parameter tanggal hari ini dan awal bulan
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
 * Muat fallback persistensi dari file disk jika ada
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
    } catch (err) {
        console.warn('⚠️ [WH FG]: Gagal membaca cache file lokal:', err.message);
    }
    return null;
}

/**
 * Simpan data ke disk cache
 */
function savePersistentCache(data) {
    try {
        const payload = {
            lastFetchedAt: new Date().toISOString(),
            data
        };
        fs.writeFileSync(PERSISTENT_CACHE_FILE, JSON.stringify(payload, null, 2), 'utf8');
    } catch (err) {
        console.warn('⚠️ [WH FG]: Gagal menyimpan cache ke file:', err.message);
    }
}

// Inisialisasi awal dari disk
loadPersistentCache();

class WhFgService {
    constructor() {
        this.apiConfig = config.atenaApi;
    }

    /**
     * Mendapatkan token JWT yang valid dari Atena ERP
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
                cache.tokenExpiresAt = now + (60 * 60 * 1000); // 1 jam
                return cache.authToken;
            }

            throw new Error(response.data?.message || 'Login ke Atena API gagal: Token tidak ditemukan');
        } catch (error) {
            const errMsg = error.response?.data?.message || error.message;
            console.error(`[ATENA AUTH WH FG ERROR]: ${errMsg}`);
            throw new Error(`Gagal otentikasi ke Atena API: ${errMsg}`);
        }
    }

    /**
     * Helper request dengan auto-retry jika token kedaluwarsa (HTTP 401/403)
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
                console.warn('[ATENA WH FG]: Token kedaluwarsa, melakukan login ulang...');
                await this.getToken(true);
                return this.requestWithAuth(endpoint, body, false);
            }
            throw error;
        }
    }

    /**
     * Mengambil ringkasan Penyelesaian DR dari Atena ERP
     * @param {Object} dates { tglawal, tglakhir }
     */
    async fetchRingkasan(dates = {}) {
        const body = {};
        if (dates.tglawal && dates.tglakhir) {
            body.tglawal = dates.tglawal;
            body.tglakhir = dates.tglakhir;
        }

        try {
            const res = await this.requestWithAuth('PenyelesaianDR/ringkasan', body);
            if (res && res.success && res.data) {
                const d = res.data;
                return {
                    total_dr: Number(d.total_dr || 0),
                    dr_sudah_dn: Number(d.dr_sudah_dn || 0),
                    dr_belum_dn: Number(d.dr_belum_dn || 0),
                    persentase_selesai: Number(d.persentase || 0),
                    judul: d.judul || 'Penyelesaian DR',
                    tglawal: d.tglawal || dates.tglawal,
                    tglakhir: d.tglakhir || dates.tglakhir,
                };
            }
        } catch (err) {
            console.error('⚠️ [WH FG RINGKASAN ERROR]:', err.message);
        }

        return {
            total_dr: 0,
            dr_sudah_dn: 0,
            dr_belum_dn: 0,
            persentase_selesai: 0,
            tglawal: dates.tglawal,
            tglakhir: dates.tglakhir,
        };
    }

    /**
     * Mengambil detail rows Penyelesaian DR dari Atena ERP
     * @param {Object} dates { tglawal, tglakhir }
     */
    async fetchDetails(dates = {}) {
        const body = {};
        if (dates.tglawal && dates.tglakhir) {
            body.tglawal = dates.tglawal;
            body.tglakhir = dates.tglakhir;
        }

        try {
            const res = await this.requestWithAuth('PenyelesaianDR/detail', body);
            if (res && res.success && res.data?.rows) {
                const rows = res.data.rows;
                const items = [];

                rows.forEach((r, idx) => {
                    const statusRaw = String(r.status || r.status_dr || '').toUpperCase().trim();
                    const isSudahDn = statusRaw === 'SUDAH DN';
                    const jumlah = Number(r.jumlah || 0);
                    const jumlahDn = Number(r.jumlah_dn || 0);
                    const progress = jumlah > 0
                        ? Math.min(100, Number(((jumlahDn / jumlah) * 100).toFixed(1)))
                        : (jumlahDn > 0 ? 100 : 0);

                    items.push({
                        no: idx + 1,
                        no_trans: r.no_trans || '-',
                        tanggal: r.tanggal || '',
                        tanggal_label: formatShortDate(r.tanggal),
                        customer: r.customer || '-',
                        ekspedisi: r.ekspedisi || 'DI AMBIL SENDIRI',
                        kode_barang: r.kode_barang || '-',
                        nama_barang: r.nama_barang || '-',
                        satuan: r.satuan || 'PCS',
                        batch: r.batch || '-',
                        jumlah: jumlah,
                        no_dn: r.no_dn || '-',
                        jumlah_dn: jumlahDn,
                        tgl_dn: r.tgl_dn || '',
                        tgl_dn_label: formatShortDate(r.tgl_dn),
                        no_pesanan: r.no_pesanan || '-',
                        tgl_konfirmasi: r.tgl_konfirmasi || '',
                        status: isSudahDn ? 'SUDAH DN' : 'BELUM DN',
                        status_code: isSudahDn ? 'sudah_dn' : 'belum_dn',
                        status_dr: isSudahDn ? 'SUDAH DN' : 'BELUM DN',
                        progress_percent: progress,
                    });
                });

                return items;
            }
        } catch (err) {
            console.error('⚠️ [WH FG DETAIL ERROR]:', err.message);
        }

        return [];
    }

    /**
     * Agregasi data item mentah menjadi struktur per DR & KPI terpadu
     */
    aggregateData(items, ringkasanKpi = {}, meta = {}) {
        const drMap = new Map();
        let totalJumlah = 0;
        let totalJumlahDn = 0;
        let itemSudahDn = 0;
        let itemBelumDn = 0;

        items.forEach(item => {
            totalJumlah += item.jumlah;
            totalJumlahDn += item.jumlah_dn;

            if (item.status_code === 'sudah_dn') itemSudahDn++;
            else itemBelumDn++;

            if (!drMap.has(item.no_trans)) {
                drMap.set(item.no_trans, {
                    no_trans: item.no_trans,
                    tanggal: item.tanggal,
                    tanggal_label: item.tanggal_label,
                    customer: item.customer,
                    ekspedisi: item.ekspedisi,
                    no_pesanan: item.no_pesanan,
                    item_count: 0,
                    total_jumlah: 0,
                    total_jumlah_dn: 0,
                    dn_set: new Set(),
                    items: [],
                    all_sudah_dn: true,
                });
            }

            const dr = drMap.get(item.no_trans);
            dr.items.push(item);
            dr.item_count++;
            dr.total_jumlah += item.jumlah;
            dr.total_jumlah_dn += item.jumlah_dn;
            if (item.status_code !== 'sudah_dn') {
                dr.all_sudah_dn = false;
            }
            if (item.no_dn && item.no_dn !== '-') {
                String(item.no_dn).split(',').map(s => s.trim()).filter(Boolean).forEach(s => dr.dn_set.add(s));
            }
        });

        // Bentuk list DR ringkas
        const drList = Array.from(drMap.values()).map(dr => {
            const isSudahDn = dr.all_sudah_dn;
            const progress = dr.total_jumlah > 0
                ? Math.min(100, Number(((dr.total_jumlah_dn / dr.total_jumlah) * 100).toFixed(1)))
                : (dr.total_jumlah_dn > 0 ? 100 : 0);

            return {
                no_trans: dr.no_trans,
                tanggal: dr.tanggal,
                tanggal_label: dr.tanggal_label,
                customer: dr.customer,
                ekspedisi: dr.ekspedisi,
                no_pesanan: dr.no_pesanan,
                item_count: dr.item_count,
                total_jumlah: dr.total_jumlah,
                total_jumlah_dn: dr.total_jumlah_dn,
                progress_percent: progress,
                status: isSudahDn ? 'SUDAH DN' : 'BELUM DN',
                status_code: isSudahDn ? 'sudah_dn' : 'belum_dn',
                no_dn: Array.from(dr.dn_set).join(', ') || '-',
                items: dr.items,
            };
        });

        // Urutkan tanggal terbaru
        drList.sort((a, b) => (b.tanggal || '').localeCompare(a.tanggal || '') || b.no_trans.localeCompare(a.no_trans));

        const totalDr = drList.length;
        const drSudah = drList.filter(d => d.status_code === 'sudah_dn').length;
        const drBelum = drList.filter(d => d.status_code === 'belum_dn').length;
        const persentaseDr = totalDr > 0 ? Number(((drSudah / totalDr) * 100).toFixed(1)) : 0;

        const kpi = {
            total_dr: ringkasanKpi.total_dr ?? totalDr,
            dr_sudah_dn: ringkasanKpi.dr_sudah_dn ?? drSudah,
            dr_belum_dn: ringkasanKpi.dr_belum_dn ?? drBelum,
            persentase_selesai: ringkasanKpi.persentase_selesai ?? persentaseDr,
            total_item: items.length,
            item_sudah_dn: itemSudahDn,
            item_belum_dn: itemBelumDn,
            total_jumlah: totalJumlah,
            total_jumlah_dn: totalJumlahDn,
        };

        return {
            meta: {
                ...meta,
                total_dr: kpi.total_dr,
                total_item: items.length,
                generated_at: new Date().toISOString(),
            },
            kpi,
            summary_by_dr: drList,
            items,
        };
    }

    /**
     * Ambil data lengkap (Ringkasan + Detail) dari Atena API atau Cache
     */
    async fetchData(force = false, dates = {}) {
        const now = Date.now();
        const cacheKey = `${dates.tglawal || 'default'}_${dates.tglakhir || 'default'}`;

        if (!force && cache.detailCache.has(cacheKey)) {
            const cached = cache.detailCache.get(cacheKey);
            if (now - cached.timestamp < CACHE_TTL_MS) {
                return cached.data;
            }
        }

        try {
            const [ringkasan, items] = await Promise.all([
                this.fetchRingkasan(dates),
                this.fetchDetails(dates)
            ]);

            const aggregated = this.aggregateData(items, ringkasan, {
                source: 'atena-rest-api',
                cached: false,
                sync_time: new Date().toISOString(),
                tglawal: ringkasan.tglawal,
                tglakhir: ringkasan.tglakhir
            });

            // Simpan ke in-memory & disk
            cache.detailCache.set(cacheKey, { data: aggregated, timestamp: now });
            cache.summary.data = aggregated;
            cache.summary.timestamp = now;
            cache.lastFetchedAt = new Date().toISOString();

            savePersistentCache(aggregated);
            return aggregated;
        } catch (error) {
            console.error('⚠️ [WH FG REST API ERROR]:', error.message);

            if (cache.summary.data) {
                return {
                    ...cache.summary.data,
                    meta: {
                        ...cache.summary.data.meta,
                        source: 'in-memory-fallback',
                        cached: true,
                        warning: `Gagal refresh dari Atena: ${error.message}`
                    }
                };
            }

            const disk = loadPersistentCache();
            if (disk) {
                return {
                    ...disk,
                    meta: {
                        ...disk.meta,
                        source: 'disk-cache-fallback',
                        cached: true,
                        warning: `Gagal refresh dari Atena: ${error.message}`
                    }
                };
            }

            throw error;
        }
    }

    /**
     * Ringkasan KPI untuk kartu utama dashboard
     */
    async getSummary(force = false) {
        const { today, monthStart } = getDateParams();

        try {
            const [resToday, resMonth] = await Promise.allSettled([
                this.fetchRingkasan({ tglawal: today, tglakhir: today }),
                this.fetchRingkasan({ tglawal: monthStart, tglakhir: today })
            ]);

            const todayData = resToday.status === 'fulfilled' ? resToday.value : {
                total_dr: 0, dr_sudah_dn: 0, dr_belum_dn: 0, persentase_selesai: 0
            };

            const monthData = resMonth.status === 'fulfilled' ? resMonth.value : {
                total_dr: 0, dr_sudah_dn: 0, dr_belum_dn: 0, persentase_selesai: 0
            };

            if (resMonth.status === 'fulfilled') {
                savePersistentCache({
                    today: todayData,
                    month: monthData,
                });
            }

            return {
                success: true,
                kpi: {
                    total_dr: monthData.total_dr,
                    dr_sudah_dn: monthData.dr_sudah_dn,
                    dr_belum_dn: monthData.dr_belum_dn,
                    persentase_selesai: monthData.persentase_selesai,
                },
                today: todayData,
                month: monthData,
                lastFetchedAt: new Date().toISOString(),
            };
        } catch (error) {
            console.error('⚠️ [WH FG SUMMARY ERROR]:', error.message);
            const disk = loadPersistentCache();
            if (disk && disk.month) {
                return {
                    success: true,
                    kpi: disk.month,
                    today: disk.today || {},
                    month: disk.month || {},
                    cached: true,
                };
            }

            return {
                success: false,
                kpi: { total_dr: 0, dr_sudah_dn: 0, dr_belum_dn: 0, persentase_selesai: 0 },
                error: error.message
            };
        }
    }

    /**
     * Mengambil data monitoring detail untuk modal frontend
     * Mendukung filter: range, status, search, tglawal, tglakhir
     */
    async getMonitoringData(options = {}) {
        const {
            range = 'month',
            status = 'all',
            search = '',
            force = false,
            tglawal,
            tglakhir,
        } = options;

        const { today, monthStart } = getDateParams();
        let dateParams = {};

        if (tglawal && tglakhir) {
            dateParams = { tglawal, tglakhir };
        } else if (range === 'today') {
            dateParams = { tglawal: today, tglakhir: today };
        } else if (range === 'week') {
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            dateParams = { tglawal: formatDate(sevenDaysAgo), tglakhir: today };
        } else if (range === 'month') {
            dateParams = { tglawal: monthStart, tglakhir: today };
        } else if (range === 'all') {
            dateParams = { tglawal: '2026-01-01', tglakhir: today };
        }

        const data = await this.fetchData(force, dateParams);
        return data;
    }
}

module.exports = new WhFgService();
