/**
 * ====================================================================
 * SERVICE: QA API CLIENT (ATENA ERP REST API)
 * ====================================================================
 * Menghubungkan Dashboard ke REST API resmi Atena ERP untuk QA:
 * - Endpoint: ReleaseQA/ringkasan & ReleaseQA/detail
 * - Khusus Release Material GRS (Goods Receipt Slip) berbasis PO & Supplier
 * - Manajemen Token JWT otomatis (Login & auto-refresh)
 * - Agregasi KPI (Total GRS, GRS Approve / Released, GRS Belum Approve, Persentase Capaian)
 * - Caching in-memory + fallback persistensi lokal (data/qa_cache.json)
 * ====================================================================
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config/app.config');

// Path cache persistensi lokal
const CACHE_DIR = path.join(__dirname, '..', 'data');
const PERSISTENT_CACHE_FILE = path.join(CACHE_DIR, 'qa_cache.json');

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
    detailCache: new Map(),
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
 * Helper tanggal hari ini dan awal bulan
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
        console.warn('⚠️ [QA]: Gagal membaca cache file lokal:', err.message);
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
        console.warn('⚠️ [QA]: Gagal menyimpan cache ke file:', err.message);
    }
}

// Inisialisasi awal dari disk
loadPersistentCache();

class QaService {
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
            console.error(`[ATENA AUTH QA ERROR]: ${errMsg}`);
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
                console.warn('[ATENA QA]: Token kedaluwarsa, melakukan login ulang...');
                await this.getToken(true);
                return this.requestWithAuth(endpoint, body, false);
            }
            throw error;
        }
    }

    /**
     * Mengambil ringkasan Release Material QA dari Atena ERP
     * Endpoint: ReleaseQA/ringkasan
     */
    async fetchRingkasan(dates = {}) {
        const body = { bagian: 'grsmaterial' };
        if (dates.tglawal && dates.tglakhir) {
            body.tglawal = dates.tglawal;
            body.tglakhir = dates.tglakhir;
        }

        try {
            const res = await this.requestWithAuth('ReleaseQA/ringkasan', body);
            if (res && res.success && res.data) {
                return {
                    bagian: res.data.bagian || 'grsmaterial',
                    judul: res.data.judul || 'Release Material (GRS)',
                    tglawal: res.data.tglawal || dates.tglawal,
                    tglakhir: res.data.tglakhir || dates.tglakhir,
                    total_grs: Number(res.data.total_grs || 0),
                    grs_approve: Number(res.data.grs_approve || 0),
                    grs_belum_approve: Number(res.data.grs_belum_approve || 0),
                    persentase: Number(res.data.persentase || 0),
                };
            }
        } catch (err) {
            console.error('[ATENA QA RINGKASAN ERROR]:', err.message);
        }

        return {
            bagian: 'grsmaterial',
            judul: 'Release Material (GRS)',
            tglawal: dates.tglawal,
            tglakhir: dates.tglakhir,
            total_grs: 0,
            grs_approve: 0,
            grs_belum_approve: 0,
            persentase: 0,
        };
    }

    /**
     * Mengambil detail baris Release Material QA dari Atena ERP
     * Endpoint: ReleaseQA/detail
     */
    async fetchDetails(dates = {}) {
        const body = { bagian: 'grsmaterial' };
        if (dates.tglawal && dates.tglakhir) {
            body.tglawal = dates.tglawal;
            body.tglakhir = dates.tglakhir;
        }

        try {
            const res = await this.requestWithAuth('ReleaseQA/detail', body);
            const rawRows = (res && res.success && Array.isArray(res.data?.rows)) ? res.data.rows : [];

            return rawRows.map((r, idx) => {
                const statusStr = String(r.status || '').trim();
                const isApprovedDoc = statusStr.toUpperCase().includes('SUDAH');
                const disposisi = String(r.disposisi_qc || '').trim().toUpperCase();

                // Logika status release yang benar:
                // Barang hanya RELEASED jika dokumen disetujui (SUDAH APPROVE) DAN disposisi QC adalah DITERIMA
                const isReleased = isApprovedDoc && disposisi === 'DITERIMA';
                const isRejected = disposisi === 'DITOLAK';
                const isHold = disposisi === 'DITAHAN';

                let statusCode = 'pending';
                let statusLabel = 'Pending';

                if (isReleased) {
                    statusCode = 'terpenuhi';
                    statusLabel = 'Released (Diterima)';
                } else if (isRejected) {
                    statusCode = 'ditolak';
                    statusLabel = 'Ditolak (Reject)';
                } else if (isHold) {
                    statusCode = 'ditahan';
                    statusLabel = 'Ditahan (Hold)';
                } else {
                    statusCode = 'pending';
                    statusLabel = 'Pending';
                }

                return {
                    no: idx + 1,
                    no_grs: r.no_grs || '-',
                    tanggal: r.tanggal || '',
                    tanggal_label: formatShortDate(r.tanggal),
                    no_po: r.no_po || '-',
                    kode_supplier: r.kode_supplier || '-',
                    supplier: r.supplier || '-',
                    status: statusLabel,
                    status_doc: statusStr,
                    status_code: statusCode,
                    is_approved: isApprovedDoc,
                    is_released: isReleased,
                    disposisi_qc: disposisi || '-',
                    disposisi_code: disposisi ? disposisi.toLowerCase() : 'none',
                    tgl_approve: r.tgl_approve || '-',
                };
            });
        } catch (err) {
            console.error('[ATENA QA DETAIL ERROR]:', err.message);
            return [];
        }
    }

    /**
     * Agregasi data item mentah menjadi struktur summary per No. PO dan ringkasan KPI
     */
    aggregateData(items = [], ringkasanKpi = {}, meta = {}) {
        const poMap = new Map();
        const suppliersSet = new Set();
        let totalReleased = 0;
        let totalDitolak = 0;
        let totalDitahan = 0;
        let totalPending = 0;

        items.forEach(item => {
            if (item.status_code === 'terpenuhi') totalReleased++;
            else if (item.status_code === 'ditolak') totalDitolak++;
            else if (item.status_code === 'ditahan') totalDitahan++;
            else totalPending++;

            if (item.supplier && item.supplier !== '-') {
                suppliersSet.add(item.supplier);
            }

            const poKey = item.no_po && item.no_po !== '-' ? item.no_po : 'TANPA_PO';
            if (!poMap.has(poKey)) {
                poMap.set(poKey, {
                    no_po: item.no_po || '-',
                    supplier: item.supplier || '-',
                    kode_supplier: item.kode_supplier || '-',
                    tanggal: item.tanggal,
                    tanggal_label: item.tanggal_label,
                    grs_list: [],
                    total_grs: 0,
                    grs_released: 0,
                    grs_ditolak: 0,
                    grs_ditahan: 0,
                    grs_pending: 0,
                });
            }

            const poGroup = poMap.get(poKey);
            poGroup.grs_list.push(item);
            poGroup.total_grs++;
            if (item.status_code === 'terpenuhi') poGroup.grs_released++;
            else if (item.status_code === 'ditolak') poGroup.grs_ditolak++;
            else if (item.status_code === 'ditahan') poGroup.grs_ditahan++;
            else poGroup.grs_pending++;
        });

        // Bentuk list PO
        const summaryByPo = Array.from(poMap.values()).map(po => {
            const isAllReleased = po.total_grs > 0 && po.grs_released === po.total_grs;
            const isAllRejected = po.total_grs > 0 && po.grs_ditolak === po.total_grs;
            const hasPartial = po.grs_released > 0 && po.grs_released < po.total_grs;

            let statusLabel = 'Pending';
            let statusCode = 'pending';

            if (isAllReleased) {
                statusLabel = 'Lengkap (Released)';
                statusCode = 'terpenuhi';
            } else if (isAllRejected) {
                statusLabel = 'Ditolak Semua';
                statusCode = 'ditolak';
            } else if (hasPartial) {
                statusLabel = `Parsial (${po.grs_released}/${po.total_grs} Released)`;
                statusCode = 'parsial';
            }

            return {
                ...po,
                grs_approve: po.grs_released,
                status: statusLabel,
                status_code: statusCode,
                persentase: po.total_grs > 0 ? Number(((po.grs_released / po.total_grs) * 100).toFixed(1)) : 0,
            };
        });

        const totalGrs = items.length;
        const persentase = totalGrs > 0 ? Number(((totalReleased / totalGrs) * 100).toFixed(2)) : 0;
        const validPoCount = Array.from(poMap.keys()).filter(k => k !== 'TANPA_PO').length;

        return {
            success: true,
            kpi: {
                total_grs: totalGrs,
                grs_released: totalReleased,
                grs_approve: totalReleased,
                grs_ditolak: totalDitolak,
                grs_ditahan: totalDitahan,
                grs_pending: totalPending,
                grs_belum_approve: totalPending + totalDitolak + totalDitahan,
                persentase: persentase,
                persentase_selesai: persentase,
                total_po: validPoCount,
                total_supplier: suppliersSet.size,
                total_item: items.length,
            },
            summary_by_po: summaryByPo,
            items: items,
            meta: {
                ...meta,
                bagian: 'grsmaterial',
                judul: 'Release Material (GRS) QA',
                tglawal: ringkasanKpi.tglawal || meta.tglawal,
                tglakhir: ringkasanKpi.tglakhir || meta.tglakhir,
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
            console.error('⚠️ [QA REST API ERROR]:', error.message);

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
            const aggregated = await this.fetchData(force, { tglawal: monthStart, tglakhir: today });
            return {
                success: true,
                kpi: aggregated.kpi,
                meta: aggregated.meta,
                lastFetchedAt: cache.lastFetchedAt,
            };
        } catch (error) {
            console.error('⚠️ [QA SUMMARY ERROR]:', error.message);
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
                kpi: { total_grs: 0, grs_approve: 0, grs_belum_approve: 0, persentase: 0 },
                error: error.message
            };
        }
    }

    /**
     * Mengambil data monitoring detail untuk modal frontend QA
     */
    async getMonitoringData(options = {}) {
        const {
            range = 'month',
            status = 'all', // 'all', 'terpenuhi' (approved), 'pending' (belum)
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

        // 1. Filter Status
        if (status && status !== 'all') {
            if (status === 'terpenuhi' || status === 'released') {
                items = items.filter(i => i.status_code === 'terpenuhi');
            } else if (status === 'ditolak') {
                items = items.filter(i => i.status_code === 'ditolak');
            } else if (status === 'ditahan') {
                items = items.filter(i => i.status_code === 'ditahan');
            } else if (status === 'pending' || status === 'belum') {
                items = items.filter(i => i.status_code === 'pending');
            }
        }

        // 2. Pencarian kata kunci (No GRS, No PO, Supplier, Disposisi QC, Surat Jalan)
        if (search && search.trim() !== '') {
            const q = search.trim().toLowerCase();
            items = items.filter(i =>
                (i.no_grs && i.no_grs.toLowerCase().includes(q)) ||
                (i.no_po && i.no_po.toLowerCase().includes(q)) ||
                (i.supplier && i.supplier.toLowerCase().includes(q)) ||
                (i.surat_jalan && i.surat_jalan.toLowerCase().includes(q)) ||
                (i.disposisi_qc && i.disposisi_qc.toLowerCase().includes(q))
            );
        }

        // Susun ulang agregasi dengan subset item terfilter
        const filteredAgg = this.aggregateData(items, data.kpi, {
            ...data.meta,
            active_filters: { range, status, search },
            filtered_count: items.length,
        });

        return filteredAgg;
    }
}

module.exports = new QaService();
