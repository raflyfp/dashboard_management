/**
 * ====================================================================
 * SERVICE: PURCHASING API CLIENT (ATENA ERP REST API)
 * ====================================================================
 * Menghubungkan Dashboard ke REST API resmi Atena ERP untuk Purchasing:
 * - Endpoint: PemenuhanPR/ringkasan & PemenuhanPR/detail
 * - Mendukung kategori Material & Non-Material
 * - Manajemen Token JWT otomatis (Login & auto-refresh)
 * - Agregasi KPI (Total PR, PR Terpenuhi, PR Belum, Persentase Capaian)
 * - Caching in-memory + fallback persistensi lokal (data/purchasing_cache.json)
 * ====================================================================
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config/app.config');

// Path cache persistensi lokal
const CACHE_DIR = path.join(__dirname, '..', 'data');
const PERSISTENT_CACHE_FILE = path.join(CACHE_DIR, 'purchasing_cache.json');

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
        console.warn('⚠️ [PURCHASING]: Gagal membaca cache file lokal:', err.message);
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
        console.warn('⚠️ [PURCHASING]: Gagal menyimpan cache ke file:', err.message);
    }
}

// Inisialisasi awal dari disk
loadPersistentCache();

class PurchasingService {
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
            console.error(`[ATENA AUTH PURCHASING ERROR]: ${errMsg}`);
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
                console.warn('[ATENA PURCHASING]: Token kedaluwarsa, melakukan login ulang...');
                await this.getToken(true);
                return this.requestWithAuth(endpoint, body, false);
            }
            throw error;
        }
    }

    /**
     * Mengambil ringkasan Material & Non-Material dari Atena ERP
     * @param {Object} dates { tglawal, tglakhir }
     */
    async fetchRingkasan(dates = {}) {
        const bodyMat = { jenis: 'material' };
        const bodyNonMat = { jenis: 'nonmaterial' };

        if (dates.tglawal && dates.tglakhir) {
            bodyMat.tglawal = dates.tglawal;
            bodyMat.tglakhir = dates.tglakhir;
            bodyNonMat.tglawal = dates.tglawal;
            bodyNonMat.tglakhir = dates.tglakhir;
        }

        const [resMat, resNonMat] = await Promise.allSettled([
            this.requestWithAuth('PemenuhanPR/ringkasan', bodyMat),
            this.requestWithAuth('PemenuhanPR/ringkasan', bodyNonMat)
        ]);

        const matData = resMat.status === 'fulfilled' && resMat.value?.success
            ? resMat.value.data
            : { total_pr: 0, pr_terpenuhi: 0, pr_belum_terpenuhi: 0, persentase: 0 };

        const nonMatData = resNonMat.status === 'fulfilled' && resNonMat.value?.success
            ? resNonMat.value.data
            : { total_pr: 0, pr_terpenuhi: 0, pr_belum_terpenuhi: 0, persentase: 0 };

        const totalPr = (matData.total_pr || 0) + (nonMatData.total_pr || 0);
        const prTerpenuhi = (matData.pr_terpenuhi || 0) + (nonMatData.pr_terpenuhi || 0);
        const prBelum = (matData.pr_belum_terpenuhi || 0) + (nonMatData.pr_belum_terpenuhi || 0);
        const persentase = totalPr > 0 ? Number(((prTerpenuhi / totalPr) * 100).toFixed(1)) : 0;

        return {
            total_pr: totalPr,
            pr_terpenuhi: prTerpenuhi,
            pr_belum: prBelum,
            pr_pending: prBelum,
            persentase_selesai: persentase,
            material: {
                total_pr: matData.total_pr || 0,
                pr_terpenuhi: matData.pr_terpenuhi || 0,
                pr_belum: matData.pr_belum_terpenuhi || 0,
                persentase: Number(matData.persentase || 0)
            },
            non_material: {
                total_pr: nonMatData.total_pr || 0,
                pr_terpenuhi: nonMatData.pr_terpenuhi || 0,
                pr_belum: nonMatData.pr_belum_terpenuhi || 0,
                persentase: Number(nonMatData.persentase || 0)
            },
            tglawal: matData.tglawal || dates.tglawal,
            tglakhir: matData.tglakhir || dates.tglakhir,
        };
    }

    /**
     * Mengambil detail rows Material & Non-Material dari Atena ERP
     * @param {Object} dates { tglawal, tglakhir }
     */
    async fetchDetails(dates = {}) {
        const bodyMat = { jenis: 'material' };
        const bodyNonMat = { jenis: 'nonmaterial' };

        if (dates.tglawal && dates.tglakhir) {
            bodyMat.tglawal = dates.tglawal;
            bodyMat.tglakhir = dates.tglakhir;
            bodyNonMat.tglawal = dates.tglawal;
            bodyNonMat.tglakhir = dates.tglakhir;
        }

        const [resMat, resNonMat] = await Promise.allSettled([
            this.requestWithAuth('PemenuhanPR/detail', bodyMat),
            this.requestWithAuth('PemenuhanPR/detail', bodyNonMat)
        ]);

        const matRows = resMat.status === 'fulfilled' && resMat.value?.success
            ? (resMat.value.data?.rows || [])
            : [];

        const nonMatRows = resNonMat.status === 'fulfilled' && resNonMat.value?.success
            ? (resNonMat.value.data?.rows || [])
            : [];

        const items = [];
        let rowIdx = 1;

        // Proses baris Material
        matRows.forEach(r => {
            const isMemenuhi = String(r.status || '').toUpperCase() === 'MEMENUHI';
            const progress = (r.request > 0)
                ? Math.min(100, Number(((r.total_grs / r.request) * 100).toFixed(1)))
                : (r.total_grs > 0 ? 100 : 0);

            items.push({
                no: rowIdx++,
                no_pr: r.no_pr || '-',
                jenis: 'Material',
                jenis_code: 'material',
                tanggal: r.tanggal || '',
                tanggal_label: formatShortDate(r.tanggal),
                kode_barang: r.kode_barang || '-',
                nama_barang: r.nama_barang || '-',
                satuan: r.satuan || 'PCS',
                qty_request: Number(r.request || 0),
                qty_po: Number(r.total_po || 0),
                qty_grs: Number(r.total_grs || 0),
                qty_os: Number(r.outstanding || 0),
                progress_percent: progress,
                status: isMemenuhi ? 'Terpenuhi (Sesuai)' : 'Pending (Belum Memenuhi)',
                status_code: isMemenuhi ? 'terpenuhi' : 'pending',
                status_pr: r.status_pr || r.status,
            });
        });

        // Proses baris Non-Material
        nonMatRows.forEach(r => {
            const isMemenuhi = String(r.status || '').toUpperCase() === 'MEMENUHI';
            const progress = (r.request > 0)
                ? Math.min(100, Number(((r.total_grs / r.request) * 100).toFixed(1)))
                : (r.total_grs > 0 ? 100 : 0);

            items.push({
                no: rowIdx++,
                no_pr: r.no_pr || '-',
                jenis: 'Non-Material',
                jenis_code: 'non_material',
                tanggal: r.tanggal || '',
                tanggal_label: formatShortDate(r.tanggal),
                kode_barang: r.kode_barang || '-',
                nama_barang: r.nama_barang || '-',
                satuan: r.satuan || 'PCS',
                qty_request: Number(r.request || 0),
                qty_po: Number(r.total_po || 0),
                qty_grs: Number(r.total_grs || 0),
                qty_os: Number(r.outstanding || 0),
                progress_percent: progress,
                status: isMemenuhi ? 'Terpenuhi (Sesuai)' : 'Pending (Belum Memenuhi)',
                status_code: isMemenuhi ? 'terpenuhi' : 'pending',
                status_pr: r.status_pr || r.status,
            });
        });

        return items;
    }

    /**
     * Agregasi data item mentah menjadi struktur per No. PR dan ringkasan KPI
     */
    aggregateData(items, ringkasanKpi = {}, meta = {}) {
        const prMap = new Map();
        let totalQtyRequest = 0;
        let totalQtyPo = 0;
        let totalQtyGrs = 0;
        let totalQtyOs = 0;
        let itemTerpenuhi = 0;
        let itemPending = 0;

        items.forEach(item => {
            totalQtyRequest += item.qty_request;
            totalQtyPo += item.qty_po;
            totalQtyGrs += item.qty_grs;
            totalQtyOs += item.qty_os;

            if (item.status_code === 'terpenuhi') itemTerpenuhi++;
            else itemPending++;

            if (!prMap.has(item.no_pr)) {
                prMap.set(item.no_pr, {
                    no_pr: item.no_pr,
                    tanggal: item.tanggal,
                    tanggal_label: item.tanggal_label,
                    jenis: item.jenis,
                    jenis_code: item.jenis_code,
                    items: [],
                    total_request: 0,
                    total_po: 0,
                    total_grs: 0,
                    total_os: 0,
                    status_pr: item.status_pr,
                });
            }

            const pr = prMap.get(item.no_pr);
            pr.items.push(item);
            pr.total_request += item.qty_request;
            pr.total_po += item.qty_po;
            pr.total_grs += item.qty_grs;
            pr.total_os += item.qty_os;
        });

        // Bentuk list PR dengan status sesuai status_pr dari Atena ERP
        const prList = Array.from(prMap.values()).map(pr => {
            const isMemenuhi = String(pr.status_pr || '').toUpperCase() === 'MEMENUHI';
            return {
                no_pr: pr.no_pr,
                tanggal: pr.tanggal,
                tanggal_label: pr.tanggal_label,
                jenis: pr.jenis,
                jenis_code: pr.jenis_code,
                item_count: pr.items.length,
                total_request: pr.total_request,
                total_po: pr.total_po,
                total_grs: pr.total_grs,
                total_os: pr.total_os,
                status: isMemenuhi ? 'Terpenuhi' : 'Pending (Belum Memenuhi)',
                status_code: isMemenuhi ? 'terpenuhi' : 'pending',
                items: pr.items,
            };
        });

        // Urutkan tanggal terbaru
        prList.sort((a, b) => (b.tanggal || '').localeCompare(a.tanggal || '') || b.no_pr.localeCompare(a.no_pr));

        const totalPr = prList.length;
        const prTerpenuhi = prList.filter(p => p.status_code === 'terpenuhi').length;
        const prPending = prList.filter(p => p.status_code === 'pending').length;
        const persentasePr = totalPr > 0 ? Number(((prTerpenuhi / totalPr) * 100).toFixed(1)) : 0;

        const matPrList = prList.filter(p => p.jenis_code === 'material');
        const nonMatPrList = prList.filter(p => p.jenis_code === 'non_material');
        const matCompleted = matPrList.filter(p => p.status_code === 'terpenuhi').length;
        const nonMatCompleted = nonMatPrList.filter(p => p.status_code === 'terpenuhi').length;

        // KPI terpadu: Utamakan ringkasan resmi dari server jika tersedia, atau hasil kalkulasi
        const kpi = {
            total_pr: ringkasanKpi.total_pr ?? totalPr,
            pr_terpenuhi: ringkasanKpi.pr_terpenuhi ?? prTerpenuhi,
            pr_belum: ringkasanKpi.pr_belum ?? prPending,
            pr_pending: ringkasanKpi.pr_belum ?? prPending,
            persentase_selesai: ringkasanKpi.persentase_selesai ?? persentasePr,
            material: {
                total_pr: ringkasanKpi.material?.total_pr ?? matPrList.length,
                pr_terpenuhi: ringkasanKpi.material?.pr_terpenuhi ?? matCompleted,
                pr_belum: ringkasanKpi.material?.pr_belum ?? (matPrList.length - matCompleted),
                persentase: ringkasanKpi.material?.persentase ?? (matPrList.length > 0 ? Number(((matCompleted / matPrList.length) * 100).toFixed(1)) : 0),
                total_item: items.filter(i => i.jenis_code === 'material').length,
            },
            non_material: {
                total_pr: ringkasanKpi.non_material?.total_pr ?? nonMatPrList.length,
                pr_terpenuhi: ringkasanKpi.non_material?.pr_terpenuhi ?? nonMatCompleted,
                pr_belum: ringkasanKpi.non_material?.pr_belum ?? (nonMatPrList.length - nonMatCompleted),
                persentase: ringkasanKpi.non_material?.persentase ?? (nonMatPrList.length > 0 ? Number(((nonMatCompleted / nonMatPrList.length) * 100).toFixed(1)) : 0),
                total_item: items.filter(i => i.jenis_code === 'non_material').length,
            },
            total_item: items.length,
            item_terpenuhi: itemTerpenuhi,
            item_pending: itemPending,
            total_qty_request: totalQtyRequest,
            total_qty_po: totalQtyPo,
            total_qty_grs: totalQtyGrs,
            total_qty_os: totalQtyOs,
        };

        return {
            meta: {
                ...meta,
                total_pr: kpi.total_pr,
                total_item: items.length,
                generated_at: new Date().toISOString(),
            },
            kpi,
            summary_by_pr: prList,
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

            // Simpan ke in-memory & file
            cache.detailCache.set(cacheKey, { data: aggregated, timestamp: now });
            cache.summary.data = aggregated;
            cache.summary.timestamp = now;
            cache.lastFetchedAt = new Date().toISOString();

            savePersistentCache(aggregated);
            return aggregated;
        } catch (error) {
            console.error('⚠️ [PURCHASING REST API ERROR]:', error.message);

            // Coba fallback dari in-memory cache
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
            // Ambil data bulan ini secara default (karena monitoring PR operasional berjalan bulanan)
            const aggregated = await this.fetchData(force, { tglawal: monthStart, tglakhir: today });
            return {
                success: true,
                kpi: aggregated.kpi,
                meta: aggregated.meta,
                lastFetchedAt: cache.lastFetchedAt,
            };
        } catch (error) {
            console.error('⚠️ [PURCHASING SUMMARY ERROR]:', error.message);
            if (cache.summary.data) {
                return {
                    success: true,
                    kpi: cache.summary.data.kpi,
                    meta: cache.summary.data.meta,
                    cached: true,
                };
            }
            return {
                success: false,
                kpi: { total_pr: 0, pr_terpenuhi: 0, pr_belum: 0, persentase_selesai: 0 },
                error: error.message
            };
        }
    }

    /**
     * Mengambil data monitoring detail untuk modal frontend
     * Mendukung filter: range, jenis, status, search
     */
    async getMonitoringData(options = {}) {
        const {
            range = 'month', // 'today', 'week', 'month', 'all'
            jenis = 'all', // 'all', 'material', 'non_material'
            status = 'all', // 'all', 'terpenuhi', 'pending'
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
            // Sejak awal tahun atau periode data aktif
            dateParams = { tglawal: '2026-01-01', tglakhir: today };
        }

        const data = await this.fetchData(force, dateParams);
        return data;
    }
}

module.exports = new PurchasingService();
