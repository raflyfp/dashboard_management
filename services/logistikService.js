/**
 * ====================================================================
 * SERVICE: LOGISTIK API CLIENT (ATENA ERP REST API)
 * ====================================================================
 * Menghubungkan Dashboard ke REST API resmi Atena ERP untuk Logistik:
 * - Endpoint: PemenuhanOrder/ringkasan & PemenuhanOrder/detail
 * - Monitoring realisasi pemenuhan order & pengiriman ke customer
 * - Manajemen Token JWT otomatis (Login & auto-refresh)
 * - Agregasi KPI (Total Order, Terpenuhi, Belum, Persentase Capaian)
 * - Caching in-memory + fallback persistensi lokal (data/logistik_cache.json)
 * ====================================================================
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config/app.config');

// Path cache persistensi lokal
const CACHE_DIR = path.join(__dirname, '..', 'data');
const PERSISTENT_CACHE_FILE = path.join(CACHE_DIR, 'logistik_cache.json');

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
        console.warn('⚠️ [LOGISTIK]: Gagal membaca cache file lokal:', err.message);
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
        console.warn('⚠️ [LOGISTIK]: Gagal menyimpan cache ke file:', err.message);
    }
}

// Inisialisasi awal dari disk
loadPersistentCache();

class LogistikService {
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
            console.error(`[ATENA AUTH LOGISTIK ERROR]: ${errMsg}`);
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
                console.warn('[ATENA LOGISTIK]: Token kedaluwarsa, melakukan login ulang...');
                await this.getToken(true);
                return this.requestWithAuth(endpoint, body, false);
            }
            throw error;
        }
    }

    /**
     * Mengambil ringkasan Pemenuhan Order dari Atena ERP
     * @param {Object} dates { tglawal, tglakhir }
     */
    async fetchRingkasan(dates = {}) {
        const body = {};
        if (dates.tglawal && dates.tglakhir) {
            body.tglawal = dates.tglawal;
            body.tglakhir = dates.tglakhir;
        }

        try {
            const res = await this.requestWithAuth('PemenuhanOrder/ringkasan', body);
            if (res && res.success && res.data) {
                const d = res.data;
                return {
                    total_order: Number(d.total_order || 0),
                    order_terpenuhi: Number(d.order_terpenuhi || 0),
                    order_belum_terpenuhi: Number(d.order_belum_terpenuhi || 0),
                    persentase_selesai: Number(d.persentase || 0),
                    judul: d.judul || 'Pemenuhan Order',
                    tglawal: d.tglawal || dates.tglawal,
                    tglakhir: d.tglakhir || dates.tglakhir,
                };
            }
        } catch (err) {
            console.error('⚠️ [LOGISTIK RINGKASAN ERROR]:', err.message);
        }

        return {
            total_order: 0,
            order_terpenuhi: 0,
            order_belum_terpenuhi: 0,
            persentase_selesai: 0,
            tglawal: dates.tglawal,
            tglakhir: dates.tglakhir,
        };
    }

    /**
     * Mengambil detail rows Pemenuhan Order dari Atena ERP
     * @param {Object} dates { tglawal, tglakhir }
     */
    async fetchDetails(dates = {}) {
        const body = {};
        if (dates.tglawal && dates.tglakhir) {
            body.tglawal = dates.tglawal;
            body.tglakhir = dates.tglakhir;
        }

        try {
            const res = await this.requestWithAuth('PemenuhanOrder/detail', body);
            if (res && res.success && res.data?.rows) {
                const rows = res.data.rows;
                const items = [];

                rows.forEach((r, idx) => {
                    const isMemenuhi = String(r.status || '').toUpperCase() === 'MEMENUHI';
                    const isOrderMemenuhi = String(r.status_order || '').toUpperCase() === 'MEMENUHI';
                    const jumlah = Number(r.jumlah || 0);
                    const jumlahDn = Number(r.jumlah_dn || 0);
                    const progress = jumlah > 0
                        ? Math.min(100, Number(((jumlahDn / jumlah) * 100).toFixed(1)))
                        : (jumlahDn > 0 ? 100 : 0);

                    items.push({
                        no: idx + 1,
                        no_order: r.no_order || '-',
                        no_pesanan: r.no_pesanan || '-',
                        customer: r.customer || '-',
                        tgl_jatuh_tempo: r.tgl_jatuh_tempo || '',
                        tgl_jatuh_tempo_label: formatShortDate(r.tgl_jatuh_tempo),
                        kode_barang: r.kode_barang || '-',
                        nama_barang: r.nama_barang || '-',
                        satuan: r.satuan || 'PCS',
                        jumlah: jumlah,
                        jumlah_dn: jumlahDn,
                        no_dr: r.no_dr || '-',
                        no_dn: r.no_dn || '-',
                        ekspedisi: r.ekspedisi || 'DI AMBIL SENDIRI',
                        status: isMemenuhi ? 'Memenuhi' : 'Belum Memenuhi',
                        status_code: isMemenuhi ? 'memenuhi' : 'belum',
                        status_order: isOrderMemenuhi ? 'Memenuhi' : 'Belum Memenuhi',
                        status_order_code: isOrderMemenuhi ? 'memenuhi' : 'belum',
                        progress_percent: progress,
                    });
                });

                return items;
            }
        } catch (err) {
            console.error('⚠️ [LOGISTIK DETAIL ERROR]:', err.message);
        }

        return [];
    }

    /**
     * Agregasi item mentah menjadi struktur per Order (SO) dan KPI terpadu
     */
    aggregateData(items, ringkasanKpi = {}, meta = {}) {
        const orderMap = new Map();
        let totalJumlah = 0;
        let totalJumlahDn = 0;
        let itemMemenuhi = 0;
        let itemBelum = 0;

        items.forEach(item => {
            totalJumlah += item.jumlah;
            totalJumlahDn += item.jumlah_dn;

            if (item.status_code === 'memenuhi') itemMemenuhi++;
            else itemBelum++;

            if (!orderMap.has(item.no_order)) {
                orderMap.set(item.no_order, {
                    no_order: item.no_order,
                    no_pesanan: item.no_pesanan,
                    customer: item.customer,
                    tgl_jatuh_tempo: item.tgl_jatuh_tempo,
                    tgl_jatuh_tempo_label: item.tgl_jatuh_tempo_label,
                    ekspedisi: item.ekspedisi,
                    status_order: item.status_order,
                    status_order_code: item.status_order_code,
                    items: [],
                    total_jumlah: 0,
                    total_jumlah_dn: 0,
                    dr_set: new Set(),
                    dn_set: new Set(),
                });
            }

            const ord = orderMap.get(item.no_order);
            ord.items.push(item);
            ord.total_jumlah += item.jumlah;
            ord.total_jumlah_dn += item.jumlah_dn;
            if (item.no_dr && item.no_dr !== '-') {
                String(item.no_dr).split(',').map(s => s.trim()).filter(Boolean).forEach(s => ord.dr_set.add(s));
            }
            if (item.no_dn && item.no_dn !== '-') {
                String(item.no_dn).split(',').map(s => s.trim()).filter(Boolean).forEach(s => ord.dn_set.add(s));
            }
        });

        // Bentuk list Order
        const orderList = Array.from(orderMap.values()).map(ord => {
            const isMemenuhi = ord.status_order_code === 'memenuhi';
            const progress = ord.total_jumlah > 0
                ? Math.min(100, Number(((ord.total_jumlah_dn / ord.total_jumlah) * 100).toFixed(1)))
                : (ord.total_jumlah_dn > 0 ? 100 : 0);

            return {
                no_order: ord.no_order,
                no_pesanan: ord.no_pesanan,
                customer: ord.customer,
                tgl_jatuh_tempo: ord.tgl_jatuh_tempo,
                tgl_jatuh_tempo_label: ord.tgl_jatuh_tempo_label,
                ekspedisi: ord.ekspedisi,
                item_count: ord.items.length,
                total_jumlah: ord.total_jumlah,
                total_jumlah_dn: ord.total_jumlah_dn,
                progress_percent: progress,
                status_order: isMemenuhi ? 'Memenuhi' : 'Belum Memenuhi',
                status_order_code: isMemenuhi ? 'memenuhi' : 'belum',
                no_dr: Array.from(ord.dr_set).join(', ') || '-',
                no_dn: Array.from(ord.dn_set).join(', ') || '-',
                items: ord.items,
            };
        });

        // Urutkan tanggal jatuh tempo terbaru
        orderList.sort((a, b) => (b.tgl_jatuh_tempo || '').localeCompare(a.tgl_jatuh_tempo || '') || b.no_order.localeCompare(a.no_order));

        const totalOrder = orderList.length;
        const orderTerpenuhi = orderList.filter(o => o.status_order_code === 'memenuhi').length;
        const orderBelum = orderList.filter(o => o.status_order_code === 'belum').length;
        const persentaseOrder = totalOrder > 0 ? Number(((orderTerpenuhi / totalOrder) * 100).toFixed(1)) : 0;

        // KPI terpadu
        const kpi = {
            total_order: ringkasanKpi.total_order ?? totalOrder,
            order_terpenuhi: ringkasanKpi.order_terpenuhi ?? orderTerpenuhi,
            order_belum_terpenuhi: ringkasanKpi.order_belum_terpenuhi ?? orderBelum,
            persentase_selesai: ringkasanKpi.persentase_selesai ?? persentaseOrder,
            total_item: items.length,
            item_memenuhi: itemMemenuhi,
            item_belum: itemBelum,
            total_jumlah: totalJumlah,
            total_jumlah_dn: totalJumlahDn,
        };

        return {
            meta: {
                ...meta,
                total_order: kpi.total_order,
                total_item: items.length,
                generated_at: new Date().toISOString(),
            },
            kpi,
            summary_by_order: orderList,
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
            console.error('⚠️ [LOGISTIK REST API ERROR]:', error.message);

            // Coba fallback in-memory
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

            // Fallback disk cache
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
            // Ambil Hari Ini dan Bulan Ini secara paralel
            const [resToday, resMonth] = await Promise.allSettled([
                this.fetchRingkasan({ tglawal: today, tglakhir: today }),
                this.fetchRingkasan({ tglawal: monthStart, tglakhir: today })
            ]);

            const todayData = resToday.status === 'fulfilled' ? resToday.value : {
                total_order: 0, order_terpenuhi: 0, order_belum_terpenuhi: 0, persentase_selesai: 0
            };

            const monthData = resMonth.status === 'fulfilled' ? resMonth.value : {
                total_order: 0, order_terpenuhi: 0, order_belum_terpenuhi: 0, persentase_selesai: 0
            };

            // Simpan data bulan ini ke disk jika berhasil
            if (resMonth.status === 'fulfilled') {
                savePersistentCache({
                    today: todayData,
                    month: monthData,
                });
            }

            return {
                success: true,
                kpi: {
                    total_order: monthData.total_order,
                    order_terpenuhi: monthData.order_terpenuhi,
                    order_belum_terpenuhi: monthData.order_belum_terpenuhi,
                    persentase_selesai: monthData.persentase_selesai,
                },
                today: todayData,
                month: monthData,
                lastFetchedAt: new Date().toISOString(),
            };
        } catch (error) {
            console.error('⚠️ [LOGISTIK SUMMARY ERROR]:', error.message);
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
                kpi: { total_order: 0, order_terpenuhi: 0, order_belum_terpenuhi: 0, persentase_selesai: 0 },
                error: error.message
            };
        }
    }

    /**
     * Mengambil data monitoring detail untuk modal frontend
     * Mendukung filter: range, status, search
     */
    async getMonitoringData(options = {}) {
        const {
            range = 'month', // 'today', 'week', 'month', 'all'
            status = 'all', // 'all', 'memenuhi', 'belum'
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
        } else if (range === 'last_month') {
            const now = new Date();
            const year = now.getFullYear();
            const month = now.getMonth();
            const prevYear = month === 0 ? year - 1 : year;
            const prevMonth = month === 0 ? 12 : month;
            const lastDay = new Date(year, month, 0).getDate();
            const s = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;
            const e = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
            dateParams = { tglawal: s, tglakhir: e };
        } else if (range === 'all') {
            // Sejak awal tahun / periode aktif
            dateParams = { tglawal: '2026-01-01', tglakhir: today };
        }

        const data = await this.fetchData(force, dateParams);
        return data;
    }
}

module.exports = new LogistikService();
