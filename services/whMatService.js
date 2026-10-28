/**
 * ====================================================================
 * SERVICE: WH MAT API CLIENT (ATENA ERP REST API)
 * ====================================================================
 * Menghubungkan Dashboard ke REST API resmi Atena ERP untuk Warehouse Material (WH Mat):
 * - Endpoint: PemenuhanWHMat/ringkasan & PemenuhanWHMat/detail
 * - Mendukung 2 Bagian Operasional:
 *   1. Permintaan Bahan (MR) -> bagian: 'permintaanbahan'
 *   2. Pemenuhan DR (DR Paskot & DR Lain) -> bagian: 'dr'
 * - Manajemen Token JWT otomatis (Login & auto-refresh)
 * - Caching in-memory + fallback persistensi lokal (data/wh_mat_cache.json)
 * ====================================================================
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config/app.config');

// Path cache persistensi lokal
const CACHE_DIR = path.join(__dirname, '..', 'data');
const PERSISTENT_CACHE_FILE = path.join(CACHE_DIR, 'wh_mat_cache.json');

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
    detailCache: new Map(), // key: bagian_range/dates
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
        console.warn('⚠️ [WH MAT]: Gagal membaca cache file lokal:', err.message);
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
        console.warn('⚠️ [WH MAT]: Gagal menyimpan cache ke file:', err.message);
    }
}

// Inisialisasi awal dari disk
loadPersistentCache();

class WhMatService {
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
                cache.tokenExpiresAt = now + (60 * 60 * 1000);
                return cache.authToken;
            }

            throw new Error(response.data?.message || 'Login ke Atena API gagal: Token tidak ditemukan');
        } catch (error) {
            const errMsg = error.response?.data?.message || error.message;
            console.error(`[ATENA AUTH WH MAT ERROR]: ${errMsg}`);
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
                console.warn('[ATENA WH MAT]: Token kedaluwarsa, melakukan login ulang...');
                await this.getToken(true);
                return this.requestWithAuth(endpoint, body, false);
            }
            throw error;
        }
    }

    /**
     * Mengambil ringkasan Pemenuhan WH Mat dari Atena ERP
     * @param {string} bagian 'permintaanbahan' | 'dr'
     * @param {Object} dates { tglawal, tglakhir }
     */
    async fetchRingkasan(bagian = 'permintaanbahan', dates = {}) {
        const body = { bagian };
        if (dates.tglawal && dates.tglakhir) {
            body.tglawal = dates.tglawal;
            body.tglakhir = dates.tglakhir;
        }

        try {
            const res = await this.requestWithAuth('PemenuhanWHMat/ringkasan', body);
            if (res && res.success && res.data) {
                const d = res.data;
                if (bagian === 'permintaanbahan') {
                    return {
                        bagian: 'permintaanbahan',
                        judul: d.judul || 'Pemenuhan Permintaan Barang',
                        total_mr: Number(d.total_mr || 0),
                        mr_terpenuhi: Number(d.mr_terpenuhi || 0),
                        mr_belum_terpenuhi: Number(d.mr_belum_terpenuhi || 0),
                        persentase_selesai: Number(d.persentase || 0),
                        tglawal: d.tglawal || dates.tglawal,
                        tglakhir: d.tglakhir || dates.tglakhir,
                    };
                } else {
                    return {
                        bagian: 'dr',
                        judul: d.judul || 'Pemenuhan DR',
                        total_dr: Number(d.total_dr || 0),
                        dr_sudah_dn: Number(d.dr_sudah_dn || 0),
                        dr_belum_dn: Number(d.dr_belum_dn || 0),
                        persentase_selesai: Number(d.persentase || 0),
                        tglawal: d.tglawal || dates.tglawal,
                        tglakhir: d.tglakhir || dates.tglakhir,
                    };
                }
            }
        } catch (err) {
            console.error(`⚠️ [WH MAT RINGKASAN ${bagian} ERROR]:`, err.message);
        }

        if (bagian === 'permintaanbahan') {
            return {
                bagian: 'permintaanbahan',
                judul: 'Pemenuhan Permintaan Barang',
                total_mr: 0,
                mr_terpenuhi: 0,
                mr_belum_terpenuhi: 0,
                persentase_selesai: 0,
                tglawal: dates.tglawal,
                tglakhir: dates.tglakhir,
            };
        } else {
            return {
                bagian: 'dr',
                judul: 'Pemenuhan DR',
                total_dr: 0,
                dr_sudah_dn: 0,
                dr_belum_dn: 0,
                persentase_selesai: 0,
                tglawal: dates.tglawal,
                tglakhir: dates.tglakhir,
            };
        }
    }

    /**
     * Mengambil detail rows Pemenuhan WH Mat dari Atena ERP
     * @param {string} bagian 'permintaanbahan' | 'dr'
     * @param {Object} dates { tglawal, tglakhir }
     */
    async fetchDetails(bagian = 'permintaanbahan', dates = {}) {
        const body = { bagian };
        if (dates.tglawal && dates.tglakhir) {
            body.tglawal = dates.tglawal;
            body.tglakhir = dates.tglakhir;
        }

        try {
            const res = await this.requestWithAuth('PemenuhanWHMat/detail', body);
            if (res && res.success && res.data?.rows) {
                const rows = res.data.rows;
                const items = [];

                if (bagian === 'permintaanbahan') {
                    rows.forEach((r, idx) => {
                        const statusMrRaw = String(r.status_mr || '').toUpperCase().trim();
                        const isTerpenuhi = statusMrRaw === 'TERPENUHI';
                        const jml = Number(r.jml || 0);
                        const terpenuhi = Number(r.terpenuhi || 0);
                        const sisa = Number(r.sisa || 0);
                        const jmlTerima = Number(r.jml_terima || 0);
                        const progress = jml > 0
                            ? Math.min(100, Number(((terpenuhi / jml) * 100).toFixed(1)))
                            : (terpenuhi > 0 ? 100 : 0);

                        items.push({
                            no: idx + 1,
                            no_trans: r.no_trans || '-',
                            tgl_kirim: r.tgl_kirim || '',
                            tgl_kirim_label: formatShortDate(r.tgl_kirim),
                            lokasi_asal: r.lokasi_asal || '-',
                            lokasi_tujuan: r.lokasi_tujuan || '-',
                            kode_barang: r.kode_barang || '-',
                            nama_barang: r.nama_barang || '-',
                            rak: r.rak || '-',
                            batch: r.batch || '-',
                            jml: jml,
                            terpenuhi: terpenuhi,
                            sisa: sisa,
                            no_transfer: r.no_transfer || '-',
                            tgl_transfer: r.tgl_transfer || '',
                            tgl_transfer_label: formatShortDate(r.tgl_transfer),
                            no_terima: r.no_terima || '-',
                            tgl_terima: r.tgl_terima || '',
                            tgl_terima_label: formatShortDate(r.tgl_terima),
                            jml_terima: jmlTerima,
                            status: r.status || 'BELUM DITERIMA',
                            status_mr: isTerpenuhi ? 'TERPENUHI' : 'BELUM TERPENUHI',
                            status_code: isTerpenuhi ? 'terpenuhi' : 'belum',
                            progress_percent: progress,
                        });
                    });
                } else {
                    // Bagian DR (WH Mat)
                    rows.forEach((r, idx) => {
                        const statusRaw = String(r.status || r.status_dr || '').toUpperCase().trim();
                        const isSudahDn = statusRaw === 'SUDAH DN';
                        const jml = Number(r.jml || 0);
                        const terpenuhi = Number(r.terpenuhi || 0);
                        const sisa = Number(r.sisa || 0);
                        const progress = jml > 0
                            ? Math.min(100, Number(((terpenuhi / jml) * 100).toFixed(1)))
                            : (terpenuhi > 0 ? 100 : 0);

                        items.push({
                            no: idx + 1,
                            sumber: r.sumber || '-',
                            no_trans: r.no_trans || '-',
                            tgl_kirim: r.tgl_kirim || '',
                            tgl_kirim_label: formatShortDate(r.tgl_kirim),
                            catatan: r.catatan || '-',
                            ekspedisi: r.ekspedisi || 'DI AMBIL SENDIRI',
                            kode_barang: r.kode_barang || '-',
                            nama_barang: r.nama_barang || '-',
                            satuan: r.satuan || 'PCS',
                            batch: r.batch || '-',
                            jml: jml,
                            terpenuhi: terpenuhi,
                            sisa: sisa,
                            no_dn: r.no_dn || '-',
                            tgl_dn: r.tgl_dn || '',
                            tgl_dn_label: formatShortDate(r.tgl_dn),
                            kode_ref: r.kode_ref || '-',
                            status: isSudahDn ? 'SUDAH DN' : 'BELUM DN',
                            status_code: isSudahDn ? 'sudah_dn' : 'belum_dn',
                            status_dr: isSudahDn ? 'SUDAH DN' : 'BELUM DN',
                            progress_percent: progress,
                        });
                    });
                }

                return items;
            }
        } catch (err) {
            console.error(`⚠️ [WH MAT DETAIL ${bagian} ERROR]:`, err.message);
        }

        return [];
    }

    /**
     * Agregasi data item mentah & KPI
     */
    aggregateData(bagian, items, ringkasanKpi = {}, meta = {}) {
        let totalJml = 0;
        let totalTerpenuhi = 0;
        let totalSisa = 0;
        let countSelesai = 0;
        let countBelum = 0;

        items.forEach(item => {
            totalJml += item.jml;
            totalTerpenuhi += item.terpenuhi;
            totalSisa += item.sisa;

            if (item.status_code === 'terpenuhi' || item.status_code === 'sudah_dn') {
                countSelesai++;
            } else {
                countBelum++;
            }
        });

        // Pengelompokan unik per No. Trans (No. MR atau No. DR)
        const transSet = new Set(items.map(i => i.no_trans));
        const totalTrans = transSet.size;

        const summaryByDoc = [];
        if (bagian === 'permintaanbahan') {
            const mrMap = new Map();
            items.forEach(it => {
                const key = it.no_trans || '-';
                if (!mrMap.has(key)) {
                    mrMap.set(key, {
                        no_trans: key,
                        tgl_kirim: it.tgl_kirim,
                        tgl_kirim_label: it.tgl_kirim_label,
                        lokasi_asal: it.lokasi_asal,
                        lokasi_tujuan: it.lokasi_tujuan,
                        tgl_transfer: it.tgl_transfer,
                        tgl_transfer_label: it.tgl_transfer_label,
                        tgl_terima: it.tgl_terima,
                        tgl_terima_label: it.tgl_terima_label,
                        total_item: 0,
                        jml: 0,
                        terpenuhi: 0,
                        sisa: 0,
                        has_terlambat: false,
                        has_belum_terima: false,
                        all_terpenuhi: true,
                    });
                }
                const entry = mrMap.get(key);
                entry.total_item++;
                entry.jml += it.jml;
                entry.terpenuhi += it.terpenuhi;
                entry.sisa += it.sisa;
                if (it.status === 'TERLAMBAT') entry.has_terlambat = true;
                if (it.status === 'BELUM DITERIMA') entry.has_belum_terima = true;
                if (it.status_code !== 'terpenuhi') entry.all_terpenuhi = false;
                if (!entry.tgl_transfer && it.tgl_transfer) {
                    entry.tgl_transfer = it.tgl_transfer;
                    entry.tgl_transfer_label = it.tgl_transfer_label;
                }
                if (!entry.tgl_terima && it.tgl_terima) {
                    entry.tgl_terima = it.tgl_terima;
                    entry.tgl_terima_label = it.tgl_terima_label;
                }
            });

            mrMap.forEach(m => {
                let leadtime = 'TEPAT WAKTU';
                if (m.has_terlambat) leadtime = 'TERLAMBAT';
                else if (m.has_belum_terima) leadtime = 'BELUM DITERIMA';

                summaryByDoc.push({
                    no_trans: m.no_trans,
                    tgl_kirim: m.tgl_kirim,
                    tgl_kirim_label: m.tgl_kirim_label,
                    lokasi_asal: m.lokasi_asal,
                    lokasi_tujuan: m.lokasi_tujuan,
                    tgl_transfer: m.tgl_transfer,
                    tgl_transfer_label: m.tgl_transfer_label,
                    tgl_terima: m.tgl_terima,
                    tgl_terima_label: m.tgl_terima_label,
                    total_item: m.total_item,
                    jml: m.jml,
                    terpenuhi: m.terpenuhi,
                    sisa: m.sisa,
                    leadtime: leadtime,
                    status: leadtime,
                    status_mr: m.all_terpenuhi ? 'TERPENUHI' : 'BELUM TERPENUHI',
                    status_code: m.all_terpenuhi ? 'terpenuhi' : 'belum',
                });
            });
        } else {
            const drMap = new Map();
            items.forEach(it => {
                const key = it.no_trans || '-';
                if (!drMap.has(key)) {
                    drMap.set(key, {
                        sumber: it.sumber,
                        no_trans: key,
                        tgl_kirim: it.tgl_kirim,
                        tgl_kirim_label: it.tgl_kirim_label,
                        catatan: it.catatan,
                        ekspedisi: it.ekspedisi,
                        no_dn: it.no_dn,
                        tgl_dn: it.tgl_dn,
                        tgl_dn_label: it.tgl_dn_label,
                        kode_ref: it.kode_ref,
                        total_item: 0,
                        jml: 0,
                        terpenuhi: 0,
                        sisa: 0,
                        all_sudah_dn: true,
                    });
                }
                const entry = drMap.get(key);
                entry.total_item++;
                entry.jml += it.jml;
                entry.terpenuhi += it.terpenuhi;
                entry.sisa += it.sisa;
                if (it.status_code !== 'sudah_dn') entry.all_sudah_dn = false;
                if ((!entry.no_dn || entry.no_dn === '-') && it.no_dn && it.no_dn !== '-') {
                    entry.no_dn = it.no_dn;
                    entry.tgl_dn = it.tgl_dn;
                    entry.tgl_dn_label = it.tgl_dn_label;
                }
                if ((!entry.kode_ref || entry.kode_ref === '-') && it.kode_ref && it.kode_ref !== '-') {
                    entry.kode_ref = it.kode_ref;
                }
            });

            drMap.forEach(d => {
                summaryByDoc.push({
                    sumber: d.sumber,
                    no_trans: d.no_trans,
                    tgl_kirim: d.tgl_kirim,
                    tgl_kirim_label: d.tgl_kirim_label,
                    catatan: d.catatan,
                    ekspedisi: d.ekspedisi,
                    total_item: d.total_item,
                    jml: d.jml,
                    terpenuhi: d.terpenuhi,
                    sisa: d.sisa,
                    no_dn: d.no_dn || '-',
                    tgl_dn: d.tgl_dn || '',
                    tgl_dn_label: d.tgl_dn_label || '-',
                    kode_ref: d.kode_ref || '-',
                    status: d.all_sudah_dn ? 'SUDAH DN' : 'BELUM DN',
                    status_code: d.all_sudah_dn ? 'sudah_dn' : 'belum_dn',
                    status_dr: d.all_sudah_dn ? 'SUDAH DN' : 'BELUM DN',
                });
            });
        }

        const kpi = bagian === 'permintaanbahan' ? {
            total_mr: ringkasanKpi.total_mr ?? totalTrans,
            mr_terpenuhi: ringkasanKpi.mr_terpenuhi ?? 0,
            mr_belum_terpenuhi: ringkasanKpi.mr_belum_terpenuhi ?? 0,
            persentase_selesai: ringkasanKpi.persentase_selesai ?? 0,
            total_dokumen: totalTrans,
            total_item: items.length,
            total_jml: totalJml,
            total_terpenuhi: totalTerpenuhi,
            total_sisa: totalSisa,
        } : {
            total_dr: ringkasanKpi.total_dr ?? totalTrans,
            dr_sudah_dn: ringkasanKpi.dr_sudah_dn ?? 0,
            dr_belum_dn: ringkasanKpi.dr_belum_dn ?? 0,
            persentase_selesai: ringkasanKpi.persentase_selesai ?? 0,
            total_dokumen: totalTrans,
            total_item: items.length,
            total_jml: totalJml,
            total_terpenuhi: totalTerpenuhi,
            total_sisa: totalSisa,
        };

        return {
            bagian,
            meta: {
                ...meta,
                bagian,
                total_data: items.length,
                total_trans: totalTrans,
                generated_at: new Date().toISOString(),
            },
            kpi,
            items,
            summary_by_doc: summaryByDoc,
        };
    }

    /**
     * Ambil data lengkap untuk satu bagian (Ringkasan + Detail)
     */
    async fetchData(force = false, dates = {}, bagian = 'permintaanbahan') {
        const now = Date.now();
        const cacheKey = `${bagian}_${dates.tglawal || 'default'}_${dates.tglakhir || 'default'}`;

        if (!force && cache.detailCache.has(cacheKey)) {
            const cached = cache.detailCache.get(cacheKey);
            if (now - cached.timestamp < CACHE_TTL_MS) {
                return cached.data;
            }
        }

        try {
            const [ringkasan, items] = await Promise.all([
                this.fetchRingkasan(bagian, dates),
                this.fetchDetails(bagian, dates)
            ]);

            const aggregated = this.aggregateData(bagian, items, ringkasan, {
                source: 'atena-rest-api',
                cached: false,
                sync_time: new Date().toISOString(),
                tglawal: ringkasan.tglawal,
                tglakhir: ringkasan.tglakhir
            });

            // Simpan cache
            cache.detailCache.set(cacheKey, { data: aggregated, timestamp: now });
            return aggregated;
        } catch (error) {
            console.error(`⚠️ [WH MAT REST API ${bagian} ERROR]:`, error.message);
            throw error;
        }
    }

    /**
     * Ringkasan KPI untuk kartu utama dashboard (MR & DR)
     */
    async getSummary(force = false) {
        const { today, monthStart } = getDateParams();

        try {
            // Ambil MR (Permintaan Bahan) & DR untuk Hari Ini dan Bulan Ini secara paralel
            const [mrTodayRes, mrMonthRes, drTodayRes, drMonthRes] = await Promise.allSettled([
                this.fetchRingkasan('permintaanbahan', { tglawal: today, tglakhir: today }),
                this.fetchRingkasan('permintaanbahan', { tglawal: monthStart, tglakhir: today }),
                this.fetchRingkasan('dr', { tglawal: today, tglakhir: today }),
                this.fetchRingkasan('dr', { tglawal: monthStart, tglakhir: today })
            ]);

            const mrToday = mrTodayRes.status === 'fulfilled' ? mrTodayRes.value : {
                total_mr: 0, mr_terpenuhi: 0, mr_belum_terpenuhi: 0, persentase_selesai: 0
            };

            const mrMonth = mrMonthRes.status === 'fulfilled' ? mrMonthRes.value : {
                total_mr: 0, mr_terpenuhi: 0, mr_belum_terpenuhi: 0, persentase_selesai: 0
            };

            const drToday = drTodayRes.status === 'fulfilled' ? drTodayRes.value : {
                total_dr: 0, dr_sudah_dn: 0, dr_belum_dn: 0, persentase_selesai: 0
            };

            const drMonth = drMonthRes.status === 'fulfilled' ? drMonthRes.value : {
                total_dr: 0, dr_sudah_dn: 0, dr_belum_dn: 0, persentase_selesai: 0
            };

            const pctMr = Number(mrMonth.persentase_selesai || 0);
            const pctDr = Number(drMonth.persentase_selesai || 0);
            let avgPersentase = 0;
            if (mrMonth.total_mr > 0 && drMonth.total_dr > 0) {
                avgPersentase = Number(((pctMr + pctDr) / 2).toFixed(2));
            } else if (mrMonth.total_mr > 0) {
                avgPersentase = pctMr;
            } else if (drMonth.total_dr > 0) {
                avgPersentase = pctDr;
            }

            const payload = {
                success: true,
                kpi: {
                    total_mr: mrMonth.total_mr,
                    mr_terpenuhi: mrMonth.mr_terpenuhi,
                    mr_belum_terpenuhi: mrMonth.mr_belum_terpenuhi,
                    persentase_mr: pctMr,
                    persentase_dr: pctDr,
                    persentase_selesai: avgPersentase,
                    total_dr: drMonth.total_dr,
                    dr_sudah_dn: drMonth.dr_sudah_dn,
                    dr_belum_dn: drMonth.dr_belum_dn,
                    dr: drMonth,
                    mr: mrMonth,
                },
                today: mrToday,
                month: mrMonth,
                mr_today: mrToday,
                mr_month: mrMonth,
                dr_today: drToday,
                dr_month: drMonth,
                persentase_mr: pctMr,
                persentase_dr: pctDr,
                persentase_selesai: avgPersentase,
                persentase_rata_rata: avgPersentase,
                lastFetchedAt: new Date().toISOString(),
            };

            if (mrMonthRes.status === 'fulfilled' || drMonthRes.status === 'fulfilled') {
                savePersistentCache(payload);
            }

            return payload;
        } catch (error) {
            console.error('⚠️ [WH MAT SUMMARY ERROR]:', error.message);
            const disk = loadPersistentCache();
            if (disk && disk.month) {
                return {
                    ...disk,
                    cached: true,
                };
            }

            return {
                success: false,
                kpi: { total_mr: 0, mr_terpenuhi: 0, mr_belum_terpenuhi: 0, persentase_selesai: 0 },
                error: error.message
            };
        }
    }

    /**
     * Mengambil data monitoring detail untuk modal frontend
     * Mendukung filter: bagian ('permintaanbahan' | 'dr'), range, status, search, tglawal, tglakhir
     */
    async getMonitoringData(options = {}) {
        const {
            bagian = 'permintaanbahan',
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

        const data = await this.fetchData(force, dateParams, bagian);
        return data;
    }
}

module.exports = new WhMatService();
