/**
 * ====================================================================
 * SERVICE: PBF API CLIENT (ATENA ERP REST API)
 * ====================================================================
 * Menghubungkan Dashboard ke REST API resmi Atena ERP untuk PBF:
 * - Pemenuhan Order +7 Hari (PBF)
 * Endpoint:
 * - PemenuhanOrderPBF/ringkasan : Ringkasan total order, memenuhi, belum, & persentase
 * - PemenuhanOrderPBF/detail    : Rincian item Sales Order (SO) & Surat Jalan (DN)
 * ====================================================================
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config/app.config');

const CACHE_DIR = path.join(__dirname, '..', 'data');
const PERSISTENT_CACHE_FILE = path.join(CACHE_DIR, 'pbf_cache.json');

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
    detailCache: new Map(), // key: tglawal_tglakhir
    authToken: null,
    tokenExpiresAt: 0,
    lastFetchedAt: null,
    isSyncing: false,
};

const CACHE_TTL_MS = 60 * 1000; // 60 detik in-memory TTL

function formatDate(date) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatShortDate(dateStr) {
    if (!dateStr) return '-';
    try {
        const parts = String(dateStr).split(' ')[0].split('-');
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

function getDateParams() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const today = `${year}-${month}-${day}`;
    const monthStart = `${year}-${month}-01`;
    return { today, monthStart };
}

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
        console.warn('⚠️ [PBF CACHE]: Gagal memuat file cache cadangan:', err.message);
    }
    return null;
}

function savePersistentCache(data) {
    try {
        const payload = {
            lastFetchedAt: new Date().toISOString(),
            data: data
        };
        fs.writeFileSync(PERSISTENT_CACHE_FILE, JSON.stringify(payload, null, 2), 'utf8');
    } catch (err) {
        console.warn('⚠️ [PBF CACHE]: Gagal menyimpan file cache cadangan:', err.message);
    }
}

class PbfService {
    constructor() {
        this.apiConfig = config.atenaApi || {
            baseUrl: 'https://erpsna.atena.id/API/Dashboard/',
            username: process.env.ATENA_API_USERNAME || 'SNATEST@EMAIL.COM',
            password: process.env.ATENA_API_PASSWORD || 'admin123',
            timeoutMs: 15000,
        };
        loadPersistentCache();
    }

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

            throw new Error(response.data?.message || 'Login ke Atena API gagal: Token tidak ditemukan');
        } catch (error) {
            const errMsg = error.response?.data?.message || error.message;
            console.error(`[ATENA AUTH PBF ERROR]: ${errMsg}`);
            throw new Error(`Gagal otentikasi ke Atena API: ${errMsg}`);
        }
    }

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
                console.warn('[ATENA PBF]: Token kedaluwarsa, login ulang...');
                await this.getToken(true);
                return this.requestWithAuth(endpoint, body, false);
            }
            throw error;
        }
    }

    /**
     * Mengambil ringkasan Pemenuhan Order PBF dari Atena ERP
     */
    async fetchRingkasan(dates = {}) {
        const body = {};
        if (dates.tglawal && dates.tglakhir) {
            body.tglawal = dates.tglawal;
            body.tglakhir = dates.tglakhir;
        }

        try {
            const res = await this.requestWithAuth('PemenuhanOrderPBF/ringkasan', body);
            if (res && res.success && res.data) {
                const d = res.data;
                const totalOrder = Number(d.total_order || 0);
                const orderMemenuhi = Number(d.order_memenuhi || 0);
                const orderBelum = Number(d.order_belum_memenuhi || 0);
                const persentase = d.persentase !== undefined
                    ? Number(d.persentase)
                    : (totalOrder > 0 ? Number(((orderMemenuhi / totalOrder) * 100).toFixed(2)) : 0);

                return {
                    judul: d.judul || 'Pemenuhan Order +7 Hari (PBF)',
                    tglawal: d.tglawal || dates.tglawal,
                    tglakhir: d.tglakhir || dates.tglakhir,
                    total_order: totalOrder,
                    order_memenuhi: orderMemenuhi,
                    order_belum_memenuhi: orderBelum,
                    persentase: persentase,
                };
            }
        } catch (err) {
            console.error('[ATENA PBF RINGKASAN ERROR]:', err.message);
        }

        return {
            judul: 'Pemenuhan Order +7 Hari (PBF)',
            tglawal: dates.tglawal,
            tglakhir: dates.tglakhir,
            total_order: 0,
            order_memenuhi: 0,
            order_belum_memenuhi: 0,
            persentase: 0,
        };
    }

    /**
     * Mengambil detail baris Sales Order PBF dari Atena ERP
     */
    async fetchDetails(dates = {}) {
        const body = {};
        if (dates.tglawal && dates.tglakhir) {
            body.tglawal = dates.tglawal;
            body.tglakhir = dates.tglakhir;
        }

        try {
            const res = await this.requestWithAuth('PemenuhanOrderPBF/detail', body);
            const rawRows = (res && res.success && Array.isArray(res.data?.rows)) ? res.data.rows : [];

            return rawRows.map((r, idx) => {
                const statusOrder = String(r.status_order || '').trim().toUpperCase();
                const isMemenuhi = statusOrder.includes('MEMENUHI') && !statusOrder.includes('BELUM');
                const statusKirim = String(r.status || '').trim().toUpperCase();
                const isTepatWaktu = statusKirim.includes('TEPAT');

                const jml = Number(r.jml || 0);
                const terpenuhi = Number(r.terpenuhi || 0);
                const sisa = Number(r.sisa || Math.max(0, jml - terpenuhi));
                const capaianPct = jml > 0 ? Number(((terpenuhi / jml) * 100).toFixed(1)) : 100;

                return {
                    no: idx + 1,
                    tgl_trans: r.tgl_trans || '',
                    tgl_trans_label: formatShortDate(r.tgl_trans),
                    no_trans: r.no_trans || '-',
                    customer: r.customer || '-',
                    kota: r.kota || '-',
                    kode_barang: r.kode_barang || '-',
                    nama_barang: r.nama_barang || '-',
                    satuan: r.satuan || 'PCS',
                    jml: jml,
                    terpenuhi: terpenuhi,
                    sisa: sisa,
                    capaian_pct: capaianPct,
                    leadtime: r.leadtime || '-',
                    leadtime_label: formatShortDate(r.leadtime),
                    tgl_surat_jalan: r.tgl_surat_jalan || '-',
                    tgl_surat_jalan_label: formatShortDate(r.tgl_surat_jalan),
                    no_surat_jalan: r.no_surat_jalan || '-',
                    status_kirim: statusKirim || '-',
                    is_tepat_waktu: isTepatWaktu,
                    status_order: statusOrder || (isMemenuhi ? 'MEMENUHI' : 'BELUM MEMENUHI'),
                    is_memenuhi: isMemenuhi,
                    status_code: isMemenuhi ? 'memenuhi' : 'belum',
                };
            });
        } catch (err) {
            console.error('[ATENA PBF DETAIL ERROR]:', err.message);
            return [];
        }
    }

    /**
     * Agregasi data PBF untuk disajikan ke frontend
     */
    aggregateData(items = [], ringkasan = {}, meta = {}) {
        const totalItems = items.length;
        const totalOrder = ringkasan.total_order || (new Set(items.map(i => i.no_trans).filter(n => n && n !== '-')).size || totalItems);
        const orderMemenuhi = ringkasan.order_memenuhi ?? items.filter(i => i.is_memenuhi).length;
        const orderBelum = ringkasan.order_belum_memenuhi ?? items.filter(i => !i.is_memenuhi).length;

        const totalQtyOrder = items.reduce((sum, i) => sum + (Number(i.jml) || 0), 0);
        const totalQtyTerpenuhi = items.reduce((sum, i) => sum + (Number(i.terpenuhi) || 0), 0);
        const totalQtySisa = items.reduce((sum, i) => sum + (Number(i.sisa) || 0), 0);
        const persentaseQty = totalQtyOrder > 0 ? Number(((totalQtyTerpenuhi / totalQtyOrder) * 100).toFixed(2)) : 0;

        const tepatWaktuCount = items.filter(i => i.is_tepat_waktu).length;
        const terlambatCount = items.filter(i => !i.is_tepat_waktu && i.no_surat_jalan !== '-').length;

        const persentase = ringkasan.persentase !== undefined
            ? Number(ringkasan.persentase)
            : (totalOrder > 0 ? Number(((orderMemenuhi / totalOrder) * 100).toFixed(2)) : 0);

        return {
            success: true,
            kpi: {
                total_order: totalOrder,
                order_memenuhi: orderMemenuhi,
                order_belum_memenuhi: orderBelum,
                persentase: persentase,
                persentase_selesai: persentase,
                total_item: totalItems,
                total_qty_order: totalQtyOrder,
                total_qty_terpenuhi: totalQtyTerpenuhi,
                total_qty_sisa: totalQtySisa,
                persentase_qty: persentaseQty,
                tepat_waktu: tepatWaktuCount,
                terlambat: terlambatCount,
            },
            ringkasan: {
                judul: ringkasan.judul || 'Pemenuhan Order +7 Hari (PBF)',
                total_order: totalOrder,
                order_memenuhi: orderMemenuhi,
                order_belum_memenuhi: orderBelum,
                persentase_selesai: persentase,
                tglawal: ringkasan.tglawal || meta.tglawal,
                tglakhir: ringkasan.tglakhir || meta.tglakhir,
            },
            items: items,
            meta: {
                ...meta,
                judul: 'Pemenuhan Order +7 Hari (PBF)',
                tglawal: ringkasan.tglawal || meta.tglawal,
                tglakhir: ringkasan.tglakhir || meta.tglakhir,
                last_updated: new Date().toISOString(),
            }
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
                tglawal: ringkasan.tglawal || dates.tglawal,
                tglakhir: ringkasan.tglakhir || dates.tglakhir,
            });

            cache.detailCache.set(cacheKey, { data: aggregated, timestamp: now });
            cache.lastFetchedAt = new Date().toISOString();

            return aggregated;
        } catch (error) {
            console.error('⚠️ [PBF REST API ERROR]:', error.message);
            if (cache.detailCache.has(cacheKey)) {
                return cache.detailCache.get(cacheKey).data;
            }
            throw error;
        }
    }

    /**
     * Ringkasan KPI gabungan untuk kartu dashboard utama (Hari Ini & Bulan Ini)
     */
    async getSummary(force = false) {
        const { today, monthStart } = getDateParams();
        const monthParams = { tglawal: monthStart, tglakhir: today };
        const todayParams = { tglawal: today, tglakhir: today };

        try {
            const [monthData, todayRingkasan] = await Promise.all([
                this.fetchData(force, monthParams),
                this.fetchRingkasan(todayParams)
            ]);

            const monthKpi = monthData.kpi || {};
            const todayKpi = {
                total_order: Number(todayRingkasan.total_order || 0),
                order_memenuhi: Number(todayRingkasan.order_memenuhi || 0),
                order_belum_memenuhi: Number(todayRingkasan.order_belum_memenuhi || 0),
                persentase: Number(todayRingkasan.persentase || 0),
                tglawal: today,
                tglakhir: today,
            };

            const summaryPayload = {
                success: true,
                kpi: {
                    total_order: monthKpi.total_order || 0,
                    order_memenuhi: monthKpi.order_memenuhi || 0,
                    order_belum_memenuhi: monthKpi.order_belum_memenuhi || 0,
                    persentase: monthKpi.persentase || 0,
                    persentase_selesai: monthKpi.persentase || 0,
                    today: todayKpi,
                    month: monthKpi,
                },
                today_total: todayKpi.total_order,
                today_selesai: todayKpi.order_memenuhi,
                today_belum: todayKpi.order_belum_memenuhi,
                today_persentase: todayKpi.persentase,
                month_total: monthKpi.total_order || 0,
                month_selesai: monthKpi.order_memenuhi || 0,
                month_belum: monthKpi.order_belum_memenuhi || 0,
                month_persentase: monthKpi.persentase || 0,
                meta: {
                    tglawal: monthStart,
                    tglakhir: today,
                    last_updated: new Date().toISOString(),
                },
                lastFetchedAt: new Date().toISOString()
            };

            cache.summary.data = summaryPayload;
            cache.summary.timestamp = Date.now();
            savePersistentCache(summaryPayload);

            return summaryPayload;
        } catch (error) {
            console.error('⚠️ [PBF SUMMARY ERROR]:', error.message);
            if (cache.summary.data) {
                return { ...cache.summary.data, cached: true };
            }
            const disk = loadPersistentCache();
            if (disk) return { ...disk, cached: true };

            return {
                success: false,
                kpi: {
                    total_order: 0,
                    order_memenuhi: 0,
                    order_belum_memenuhi: 0,
                    persentase: 0,
                    persentase_selesai: 0,
                    today: {},
                    month: {},
                },
                error: error.message
            };
        }
    }

    /**
     * Mengambil data monitoring detail untuk modal frontend PBF
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
        let items = data.items || [];

        // Filter Status (memenuhi / belum / tepat_waktu / terlambat)
        if (status && status !== 'all') {
            const st = status.toLowerCase();
            if (st === 'memenuhi') {
                items = items.filter(i => i.is_memenuhi);
            } else if (st === 'belum') {
                items = items.filter(i => !i.is_memenuhi);
            } else if (st === 'tepat_waktu') {
                items = items.filter(i => i.is_tepat_waktu);
            } else if (st === 'terlambat') {
                items = items.filter(i => !i.is_tepat_waktu);
            }
        }

        // Pencarian kata kunci
        if (search && search.trim() !== '') {
            const q = search.trim().toLowerCase();
            items = items.filter(i =>
                (i.no_trans && i.no_trans.toLowerCase().includes(q)) ||
                (i.customer && i.customer.toLowerCase().includes(q)) ||
                (i.kota && i.kota.toLowerCase().includes(q)) ||
                (i.nama_barang && i.nama_barang.toLowerCase().includes(q)) ||
                (i.kode_barang && i.kode_barang.toLowerCase().includes(q)) ||
                (i.no_surat_jalan && i.no_surat_jalan.toLowerCase().includes(q))
            );
        }

        return this.aggregateData(items, data.ringkasan, {
            ...data.meta,
            active_filters: { range, status, search },
            filtered_count: items.length,
        });
    }
}

module.exports = new PbfService();

