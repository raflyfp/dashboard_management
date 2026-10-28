/**
 * ====================================================================
 * SERVICE: QA API CLIENT (ATENA ERP REST API)
 * ====================================================================
 * Menghubungkan Dashboard ke REST API resmi Atena ERP untuk QA:
 * 1. Release Material (GRS): GRS masuk sudah approve / total GRS per bulan
 * 2. Release Produk Jadi - Subcon (SCN): Sample test jenis SC status release
 * 3. Release Produk Jadi - Accept BR: Jurnal batch record transaksi bulan ini
 * Endpoint:
 * - ReleaseQA/ringkasan
 * - ReleaseQA/detail
 * Parameter bagian: 'grsmaterial' | 'scn' | 'acceptbr'
 * ====================================================================
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config/app.config');

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
    detailCache: new Map(), // key: bagian_tglawal_tglakhir
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
        console.warn('⚠️ [QA CACHE]: Gagal memuat file cache cadangan:', err.message);
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
        console.warn('⚠️ [QA CACHE]: Gagal menyimpan file cache cadangan:', err.message);
    }
}

class QaService {
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
            console.error(`[ATENA AUTH QA ERROR]: ${errMsg}`);
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
                console.warn('[ATENA QA]: Token kedaluwarsa, melakukan login ulang...');
                await this.getToken(true);
                return this.requestWithAuth(endpoint, body, false);
            }
            throw error;
        }
    }

    /**
     * Mengambil ringkasan QA dari Atena ERP per bagian: 'grsmaterial' | 'scn' | 'acceptbr'
     */
    async fetchRingkasan(bagian = 'grsmaterial', dates = {}) {
        const body = { bagian };
        if (dates.tglawal && dates.tglakhir) {
            body.tglawal = dates.tglawal;
            body.tglakhir = dates.tglakhir;
        }

        try {
            const res = await this.requestWithAuth('ReleaseQA/ringkasan', body);
            if (res && res.success && res.data) {
                const d = res.data;
                if (bagian === 'grsmaterial') {
                    return {
                        bagian: 'grsmaterial',
                        judul: d.judul || 'Release Material (GRS)',
                        tglawal: d.tglawal || dates.tglawal,
                        tglakhir: d.tglakhir || dates.tglakhir,
                        total_grs: Number(d.total_grs || 0),
                        grs_approve: Number(d.grs_approve || 0),
                        grs_belum_approve: Number(d.grs_belum_approve || 0),
                        persentase: Number(d.persentase || 0),
                    };
                } else if (bagian === 'scn') {
                    return {
                        bagian: 'scn',
                        judul: d.judul || 'Release Subcon (SCN)',
                        tglawal: d.tglawal || dates.tglawal,
                        tglakhir: d.tglakhir || dates.tglakhir,
                        total_scn: Number(d.total_scn || 0),
                        scn_sudah_release: Number(d.scn_sudah_release || 0),
                        scn_belum_release: Number(d.scn_belum_release || 0),
                        scn_ditolak: Number(d.scn_ditolak || 0),
                        persentase: Number(d.persentase || 0),
                    };
                } else if (bagian === 'acceptbr') {
                    const totalBr = Number(d.total_br || 0);
                    const brBelum = Number(d.br_belum || 0);
                    const brSudah = Math.max(0, totalBr - brBelum);
                    const persentase = totalBr > 0 ? Number(((brSudah / totalBr) * 100).toFixed(2)) : 100;
                    return {
                        bagian: 'acceptbr',
                        judul: d.judul || 'Accept BR',
                        tglawal: d.tglawal || dates.tglawal,
                        tglakhir: d.tglakhir || dates.tglakhir,
                        total_br: totalBr,
                        br_belum: brBelum,
                        br_sudah: brSudah,
                        persentase_api: Number(d.persentase || 0),
                        persentase: persentase,
                    };
                }
            }
        } catch (err) {
            console.error(`[ATENA QA RINGKASAN ${bagian} ERROR]:`, err.message);
        }

        return {
            bagian,
            tglawal: dates.tglawal,
            tglakhir: dates.tglakhir,
            total: 0,
            persentase: 0
        };
    }

    /**
     * Mengambil detail baris QA dari Atena ERP per bagian: 'grsmaterial' | 'scn' | 'acceptbr'
     */
    async fetchDetails(bagian = 'grsmaterial', dates = {}) {
        const body = { bagian };
        if (dates.tglawal && dates.tglakhir) {
            body.tglawal = dates.tglawal;
            body.tglakhir = dates.tglakhir;
        }

        try {
            const res = await this.requestWithAuth('ReleaseQA/detail', body);
            const rawRows = (res && res.success && Array.isArray(res.data?.rows)) ? res.data.rows : [];

            if (bagian === 'grsmaterial') {
                return rawRows.map((r, idx) => {
                    const statusStr = String(r.status || '').trim();
                    const isApprovedDoc = statusStr.toUpperCase().includes('SUDAH');
                    const disposisi = String(r.disposisi_qc || '').trim().toUpperCase();

                    const isReleased = isApprovedDoc && disposisi === 'DITERIMA';
                    const isRejected = disposisi === 'DITOLAK';
                    const isHold = disposisi === 'DITAHAN';

                    let statusCode = 'pending';
                    let statusLabel = 'Pending';

                    if (isReleased) {
                        statusCode = 'terpenuhi';
                        statusLabel = 'Approved / Released';
                    } else if (isRejected) {
                        statusCode = 'ditolak';
                        statusLabel = 'Ditolak';
                    } else if (isHold) {
                        statusCode = 'ditahan';
                        statusLabel = 'Ditahan';
                    } else {
                        statusCode = 'pending';
                        statusLabel = 'Belum Approve';
                    }

                    return {
                        no: idx + 1,
                        no_grs: r.no_grs || '-',
                        tanggal: r.tanggal || '',
                        tanggal_label: formatShortDate(r.tanggal),
                        no_po: r.no_po || '-',
                        kode_supplier: r.kode_supplier || '-',
                        supplier: r.supplier || '-',
                        surat_jalan: r.surat_jalan || '-',
                        status: statusLabel,
                        status_doc: statusStr,
                        status_code: statusCode,
                        is_approved: isApprovedDoc,
                        is_released: isReleased,
                        disposisi_qc: disposisi || '-',
                        tgl_approve: r.tgl_approve || '-',
                        tgl_approve_label: formatShortDate(r.tgl_approve),
                    };
                });
            } else if (bagian === 'scn') {
                return rawRows.map((r, idx) => {
                    const statusRaw = String(r.status || '').trim().toUpperCase();
                    const isSudahRelease = statusRaw === 'SUDAH RELEASE';
                    const isDitolak = statusRaw === 'DITOLAK';

                    let statusCode = 'belum';
                    let statusLabel = 'Belum Release';

                    if (isSudahRelease) {
                        statusCode = 'terpenuhi';
                        statusLabel = 'Sudah Release';
                    } else if (isDitolak) {
                        statusCode = 'ditolak';
                        statusLabel = 'Ditolak';
                    }

                    return {
                        no: idx + 1,
                        no_subcon: r.no_subcon || '-',
                        tanggal: r.tanggal || '',
                        tanggal_label: formatShortDate(r.tanggal),
                        supplier: r.supplier || '-',
                        kode_barang: r.kode_barang || '-',
                        nama_barang: r.nama_barang || '-',
                        batch: r.batch || '-',
                        jumlah: Number(r.jumlah || 0),
                        satuan: r.satuan || 'PCS',
                        no_qc: r.no_qc || '-',
                        disposisi_1: r.disposisi_1 || '-',
                        tgl_approve_1: r.tgl_approve_1 || '-',
                        disposisi_2: r.disposisi_2 || '-',
                        tgl_approve_2: r.tgl_approve_2 || '-',
                        status: statusLabel,
                        status_code: statusCode,
                    };
                });
            } else if (bagian === 'acceptbr') {
                return rawRows.map((r, idx) => {
                    return {
                        no: idx + 1,
                        no_prh: r.no_prh || '-',
                        tgl_prh: r.tgl_prh || '',
                        tgl_prh_label: formatShortDate(r.tgl_prh),
                        tgl_kirim_sample: r.tgl_kirim_sample || '',
                        tgl_kirim_sample_label: formatShortDate(r.tgl_kirim_sample),
                        no_hasil_produksi: r.no_hasil_produksi || '-',
                        divisi: r.divisi || '-',
                        kode_barang: r.kode_barang || '-',
                        nama_barang: r.nama_barang || '-',
                        batch: r.batch || '-',
                        jumlah: Number(r.jumlah || 0),
                        user_entry: r.user_entry || '-',
                        status: 'Belum Batch Record',
                        status_code: 'belum',
                    };
                });
            }

            return [];
        } catch (err) {
            console.error(`[ATENA QA DETAIL ${bagian} ERROR]:`, err.message);
            return [];
        }
    }

    /**
     * Agregasi data item QA per bagian
     */
    aggregateData(bagian = 'grsmaterial', items = [], ringkasanKpi = {}, meta = {}) {
        if (bagian === 'grsmaterial') {
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

            const summaryByPo = Array.from(poMap.values()).map(po => {
                let statusCode = 'pending';
                let statusLabel = 'Pending';
                if (po.total_grs > 0 && po.grs_released === po.total_grs) {
                    statusCode = 'terpenuhi';
                    statusLabel = 'Approved (Lengkap)';
                } else if (po.grs_ditolak > 0) {
                    statusCode = 'ditolak';
                    statusLabel = 'Ditolak';
                }

                return {
                    ...po,
                    grs_approve: po.grs_released,
                    status: statusLabel,
                    status_code: statusCode,
                    persentase: po.total_grs > 0 ? Number(((po.grs_released / po.total_grs) * 100).toFixed(1)) : 0,
                };
            });

            const totalGrs = ringkasanKpi.total_grs || items.length;
            const released = ringkasanKpi.grs_approve ?? totalReleased;
            const pending = ringkasanKpi.grs_belum_approve ?? (totalPending + totalDitolak + totalDitahan);
            const persentase = ringkasanKpi.persentase ?? (totalGrs > 0 ? Number(((released / totalGrs) * 100).toFixed(1)) : 0);

            return {
                success: true,
                bagian: 'grsmaterial',
                kpi: {
                    total_grs: totalGrs,
                    grs_released: released,
                    grs_approve: released,
                    grs_ditolak: totalDitolak,
                    grs_ditahan: totalDitahan,
                    grs_pending: pending,
                    grs_belum_approve: pending,
                    persentase: persentase,
                    persentase_selesai: persentase,
                    total_po: Array.from(poMap.keys()).filter(k => k !== 'TANPA_PO').length,
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
        } else if (bagian === 'scn') {
            const totalScn = ringkasanKpi.total_scn || items.length;
            const sudahRelease = ringkasanKpi.scn_sudah_release ?? items.filter(i => i.status_code === 'terpenuhi').length;
            const belumRelease = ringkasanKpi.scn_belum_release ?? items.filter(i => i.status_code === 'belum').length;
            const ditolak = ringkasanKpi.scn_ditolak ?? items.filter(i => i.status_code === 'ditolak').length;
            const persentase = ringkasanKpi.persentase ?? (totalScn > 0 ? Number(((sudahRelease / totalScn) * 100).toFixed(1)) : 0);

            return {
                success: true,
                bagian: 'scn',
                kpi: {
                    total_scn: totalScn,
                    scn_sudah_release: sudahRelease,
                    scn_belum_release: belumRelease,
                    scn_ditolak: ditolak,
                    persentase: persentase,
                    persentase_selesai: persentase,
                    total_item: items.length,
                },
                items: items,
                meta: {
                    ...meta,
                    bagian: 'scn',
                    judul: 'Release Subcon (SCN)',
                    tglawal: ringkasanKpi.tglawal || meta.tglawal,
                    tglakhir: ringkasanKpi.tglakhir || meta.tglakhir,
                    last_updated: new Date().toISOString(),
                }
            };
        } else if (bagian === 'acceptbr') {
            const totalBr = ringkasanKpi.total_br || 0;
            const brBelum = ringkasanKpi.br_belum || items.length;
            const brSudah = ringkasanKpi.br_sudah || Math.max(0, totalBr - brBelum);
            const persentase = ringkasanKpi.persentase ?? (totalBr > 0 ? Number(((brSudah / totalBr) * 100).toFixed(1)) : 0);

            return {
                success: true,
                bagian: 'acceptbr',
                kpi: {
                    total_br: totalBr,
                    br_belum: brBelum,
                    br_sudah: brSudah,
                    persentase: persentase,
                    persentase_selesai: persentase,
                    total_item: items.length,
                },
                items: items,
                meta: {
                    ...meta,
                    bagian: 'acceptbr',
                    judul: 'Accept Batch Record (BR)',
                    tglawal: ringkasanKpi.tglawal || meta.tglawal,
                    tglakhir: ringkasanKpi.tglakhir || meta.tglakhir,
                    last_updated: new Date().toISOString(),
                }
            };
        }
    }

    /**
     * Ambil data lengkap (Ringkasan + Detail) dari Atena API atau Cache untuk bagian tertentu
     */
    async fetchData(bagian = 'grsmaterial', force = false, dates = {}) {
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

            cache.detailCache.set(cacheKey, { data: aggregated, timestamp: now });
            cache.lastFetchedAt = new Date().toISOString();

            return aggregated;
        } catch (error) {
            console.error(`⚠️ [QA REST API ${bagian} ERROR]:`, error.message);

            if (cache.detailCache.has(cacheKey)) {
                return cache.detailCache.get(cacheKey).data;
            }
            throw error;
        }
    }

    /**
     * Ringkasan KPI gabungan untuk kartu utama dashboard
     * Mengambil ringkasan dari 3 bagian: GRS Material, SCN, dan Accept BR
     */
    async getSummary(force = false) {
        const { today, monthStart } = getDateParams();
        const dateParams = { tglawal: monthStart, tglakhir: today };

        try {
            const [grsSummary, scnSummary, brSummary] = await Promise.all([
                this.fetchRingkasan('grsmaterial', dateParams),
                this.fetchRingkasan('scn', dateParams),
                this.fetchRingkasan('acceptbr', dateParams)
            ]);

            const totalGrs = Number(grsSummary.total_grs || 0);
            const grsApprove = Number(grsSummary.grs_approve || 0);
            const grsBelum = Number(grsSummary.grs_belum_approve || 0);

            const totalScn = Number(scnSummary.total_scn || 0);
            const scnSudah = Number(scnSummary.scn_sudah_release || 0);
            const scnBelum = Number(scnSummary.scn_belum_release || 0);
            const scnDitolak = Number(scnSummary.scn_ditolak || 0);

            const totalBr = Number(brSummary.total_br || 0);
            const brBelum = Number(brSummary.br_belum || 0);
            const brSudah = Number(brSummary.br_sudah || Math.max(0, totalBr - brBelum));

            // Gabungan KPI QA (Release Material + Release Produk Jadi)
            const combinedTotal = totalGrs + totalScn + totalBr;
            const combinedSelesai = grsApprove + scnSudah + brSudah;
            const combinedBelum = grsBelum + scnBelum + brBelum;
            const combinedPersen = combinedTotal > 0 ? Number(((combinedSelesai / combinedTotal) * 100).toFixed(1)) : 0;

            const summaryPayload = {
                success: true,
                kpi: {
                    // Gabungan KPI Utama untuk Card
                    total_dokumen: combinedTotal,
                    total_selesai: combinedSelesai,
                    total_belum: combinedBelum,
                    total_ditolak: scnDitolak,
                    persentase_selesai: combinedPersen,

                    // Sub-KPI GRS Material
                    grs: grsSummary,
                    total_grs: totalGrs,
                    grs_approve: grsApprove,
                    grs_released: grsApprove,
                    grs_belum_approve: grsBelum,
                    persentase_grs: grsSummary.persentase || 0,

                    // Sub-KPI SCN Subcon
                    scn: scnSummary,
                    total_scn: totalScn,
                    scn_sudah_release: scnSudah,
                    scn_belum_release: scnBelum,
                    scn_ditolak: scnDitolak,
                    persentase_scn: scnSummary.persentase || 0,

                    // Sub-KPI Accept BR
                    acceptbr: brSummary,
                    total_br: totalBr,
                    br_belum: brBelum,
                    br_sudah: brSudah,
                    persentase_br: brSummary.persentase || 0,
                },
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
            console.error('⚠️ [QA SUMMARY ERROR]:', error.message);
            if (cache.summary.data) {
                return {
                    ...cache.summary.data,
                    cached: true,
                };
            }
            const disk = loadPersistentCache();
            if (disk) return { ...disk, cached: true };

            return {
                success: false,
                kpi: {
                    total_dokumen: 0,
                    total_selesai: 0,
                    total_belum: 0,
                    persentase_selesai: 0,
                    grs: {},
                    scn: {},
                    acceptbr: {}
                },
                error: error.message
            };
        }
    }

    /**
     * Mengambil data monitoring detail untuk modal frontend QA
     */
    async getMonitoringData(options = {}) {
        const {
            bagian = 'grsmaterial', // 'grsmaterial' | 'scn' | 'acceptbr'
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

        const data = await this.fetchData(bagian, force, dateParams);
        let items = data.items || [];

        // 1. Filter Status
        if (status && status !== 'all') {
            if (status === 'terpenuhi' || status === 'released') {
                items = items.filter(i => i.status_code === 'terpenuhi');
            } else if (status === 'ditolak') {
                items = items.filter(i => i.status_code === 'ditolak');
            } else if (status === 'ditahan') {
                items = items.filter(i => i.status_code === 'ditahan');
            } else if (status === 'belum' || status === 'pending') {
                items = items.filter(i => i.status_code === 'belum' || i.status_code === 'pending');
            }
        }

        // 2. Pencarian kata kunci
        if (search && search.trim() !== '') {
            const q = search.trim().toLowerCase();
            if (bagian === 'grsmaterial') {
                items = items.filter(i =>
                    (i.no_grs && i.no_grs.toLowerCase().includes(q)) ||
                    (i.no_po && i.no_po.toLowerCase().includes(q)) ||
                    (i.supplier && i.supplier.toLowerCase().includes(q)) ||
                    (i.surat_jalan && i.surat_jalan.toLowerCase().includes(q)) ||
                    (i.disposisi_qc && i.disposisi_qc.toLowerCase().includes(q))
                );
            } else if (bagian === 'scn') {
                items = items.filter(i =>
                    (i.no_subcon && i.no_subcon.toLowerCase().includes(q)) ||
                    (i.supplier && i.supplier.toLowerCase().includes(q)) ||
                    (i.kode_barang && i.kode_barang.toLowerCase().includes(q)) ||
                    (i.nama_barang && i.nama_barang.toLowerCase().includes(q)) ||
                    (i.batch && i.batch.toLowerCase().includes(q)) ||
                    (i.no_qc && i.no_qc.toLowerCase().includes(q)) ||
                    (i.status && i.status.toLowerCase().includes(q))
                );
            } else if (bagian === 'acceptbr') {
                items = items.filter(i =>
                    (i.no_prh && i.no_prh.toLowerCase().includes(q)) ||
                    (i.no_hasil_produksi && i.no_hasil_produksi.toLowerCase().includes(q)) ||
                    (i.divisi && i.divisi.toLowerCase().includes(q)) ||
                    (i.kode_barang && i.kode_barang.toLowerCase().includes(q)) ||
                    (i.nama_barang && i.nama_barang.toLowerCase().includes(q)) ||
                    (i.batch && i.batch.toLowerCase().includes(q)) ||
                    (i.user_entry && i.user_entry.toLowerCase().includes(q))
                );
            }
        }

        const filteredAgg = this.aggregateData(bagian, items, data.kpi, {
            ...data.meta,
            active_filters: { range, status, search, bagian },
            filtered_count: items.length,
        });

        return filteredAgg;
    }
}

module.exports = new QaService();
