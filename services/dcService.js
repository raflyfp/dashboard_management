/**
 * ====================================================================
 * SERVICE: DC (DOCUMENT CONTROL) - PAPERLESS SNA MEDIKA
 * ====================================================================
 * Mengambil data pemantauan pengerjaan dokumen DC dari Paperless SNA Medika
 * (http://snam.ddns.net:8069/) pada Menu Pengesahan Dokumen (TRNS3):
 * 1. Login: POST Auth/Login/cekLogin (email: DC@SINARAYA.CO.ID)
 * 2. Jenis Dokumen: POST Master/Data/JenisDokumen/comboGrid
 * 3. Tab "Pengajuan Masuk" (Belum dibuat pengesahan oleh DC):
 *    POST Transaksi/Transaksi/PengesahanDokumen/dataGridDokumenMasuk
 * 4. Tab "Pengesahan Dibuat" (Sudah dikerjakan / disahkan oleh DC):
 *    POST Transaksi/Transaksi/PengesahanDokumen/dataGrid
 * 
 * Dilengkapi in-memory caching, auto re-login, dan fallback cache
 * persisten (data/dc_paperless_cache.json).
 * ====================================================================
 */

const axios = require('axios');
const qs = require('querystring');
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
    summaryMap: new Map(), // key: tglawal_tglakhir -> { data, timestamp }
    liveRows: null,
    liveRowsTimestamp: 0,
    sessionCookie: null,
    sessionExpiresAt: 0,
    lastFetchedAt: null,
    isSyncing: false,
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 menit

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
                if (Array.isArray(parsed.rows) && parsed.rows.length > 0 && !cache.liveRows) {
                    cache.liveRows = parsed.rows;
                    cache.liveRowsTimestamp = Date.now();
                }
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
            baseUrl: 'http://snam.ddns.net:8069/API/Dashboard/',
            webBaseUrl: 'http://snam.ddns.net:8069/',
            username: 'DC@SINARAYA.CO.ID',
            password: 'ADMIN',
            timeoutMs: 20000,
        };
        loadPersistentCache();
    }

    /**
     * Otentikasi ke Web Paperless (http://snam.ddns.net:8069/Auth/Login/cekLogin)
     * menggunakan akun DC@SINARAYA.CO.ID / ADMIN untuk mendapatkan session cookie ci_session.
     */
    async getWebSessionCookie(forceRefresh = false) {
        const now = Date.now();
        if (!forceRefresh && cache.sessionCookie && cache.sessionExpiresAt > (now + 60000)) {
            return cache.sessionCookie;
        }

        const webBaseUrl = (this.apiConfig.webBaseUrl || 'http://snam.ddns.net:8069/').replace(/\/?$/, '/');
        const loginUrl = `${webBaseUrl}Auth/Login/cekLogin`;

        try {
            const res = await axios.post(loginUrl, qs.stringify({
                email: this.apiConfig.username,
                password: this.apiConfig.password
            }), {
                timeout: this.apiConfig.timeoutMs || 15000,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            const setCookies = res.headers['set-cookie'];
            if (res.data && res.data.success && Array.isArray(setCookies) && setCookies.length > 0) {
                cache.sessionCookie = setCookies.map(c => c.split(';')[0]).join('; ');
                cache.sessionExpiresAt = now + (60 * 60 * 1000); // 1 jam
                return cache.sessionCookie;
            }
        } catch (err) {
            console.warn(`⚠️ [PAPERLESS WEB AUTH]: Gagal login ke ${loginUrl}: ${err.message}`);
        }
        return null;
    }

    /**
     * Mengambil data live pengerjaan dokumen DC dari Menu Pengesahan Dokumen (TRNS3):
     * - Tab "Pengajuan Masuk" (dataGridDokumenMasuk) -> Belum dibuat pengesahan oleh DC
     * - Tab "Pengesahan Dibuat" (dataGrid) -> Sudah dibuatkan pengesahan / disahkan oleh DC
     */
    async fetchLiveRows(force = false) {
        const now = Date.now();
        if (!force && Array.isArray(cache.liveRows) && cache.liveRows.length > 0 && (now - cache.liveRowsTimestamp < CACHE_TTL_MS)) {
            return { rows: cache.liveRows, source: 'Live Paperless (snam.ddns.net:8069)' };
        }

        const cookie = await this.getWebSessionCookie(force);
        if (cookie) {
            const webBaseUrl = (this.apiConfig.webBaseUrl || 'http://snam.ddns.net:8069/').replace(/\/?$/, '/');
            try {
                // 1. Ambil daftar seluruh Jenis Dokumen
                const jdRes = await axios.post(`${webBaseUrl}Master/Data/JenisDokumen/comboGrid`, '', {
                    timeout: this.apiConfig.timeoutMs || 15000,
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Cookie': cookie
                    }
                });
                const jenisList = Array.isArray(jdRes.data?.rows) ? jdRes.data.rows : [];

                if (jenisList.length > 0) {
                    // 2. Tarik paralel "Pengesahan Dibuat" (dataGrid) & "Pengajuan Masuk" (dataGridDokumenMasuk)
                    const results = await Promise.all(jenisList.map(async (jd) => {
                        const [rDibuat, rMasuk] = await Promise.all([
                            axios.post(`${webBaseUrl}Transaksi/Transaksi/PengesahanDokumen/dataGrid`, qs.stringify({
                                page: 1,
                                limit: 2500,
                                search: '',
                                jenis: 'pengajuan',
                                uuidjenisdokumen: jd.id,
                                kodemenu: 'TRNS3',
                                asaldokumen: '',
                                status: ''
                            }), {
                                timeout: this.apiConfig.timeoutMs || 20000,
                                headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookie }
                            }).catch(() => ({ data: { rows: [] } })),
                            axios.post(`${webBaseUrl}Transaksi/Transaksi/PengesahanDokumen/dataGridDokumenMasuk`, qs.stringify({
                                page: 1,
                                limit: 2500,
                                search: '',
                                uuidjenisdokumen: jd.id,
                                status: ''
                            }), {
                                timeout: this.apiConfig.timeoutMs || 20000,
                                headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookie }
                            }).catch(() => ({ data: { rows: [] } }))
                        ]);
                        return {
                            dibuat: Array.isArray(rDibuat.data?.rows) ? rDibuat.data.rows : [],
                            masuk: Array.isArray(rMasuk.data?.rows) ? rMasuk.data.rows : []
                        };
                    }));

                    const parsedRows = [];

                    // A. Proses baris "Pengesahan Dibuat" (exclude Batal status='D' dan Reject status='R')
                    for (const group of results) {
                        for (const r of group.dibuat) {
                            if (r.status === 'D' || r.status === 'R' || r.ubahstatus === '2' || r.userbatal) {
                                continue;
                            }
                            const klausul = r.kodepengesahandokumen || r.nomorklausul || r.kodepengajuandokumen || '-';
                            const revisi = r.norevisi || r.nomorrevisidokumen || '-';
                            const bagian = r.bagian || r.userbuat || '-';
                            const tgl = r.tglpermohonan || r.tglpengerjaan || '';

                            let tahap = 'Selesai (Pengesahan Dibuat DC)';
                            if (r.ubahstatus === '1') {
                                tahap = r.lastuserapprove
                                    ? `Selesai (Disahkan oleh ${r.lastuserapprove})`
                                    : 'Selesai (Disahkan)';
                            } else {
                                tahap = r.tglpengerjaan
                                    ? `Pengesahan Dibuat DC (${r.tglpengerjaan}) - Sirkulasi Approval`
                                    : 'Pengesahan Dibuat DC';
                            }

                            parsedRows.push({
                                id: parsedRows.length + 1,
                                nomor_klausul: klausul,
                                jenis_dokumen: r.namajenisdokumen || '-',
                                nama_dokumen: r.namapengajuandokumen || '-',
                                nomor_revisi: revisi,
                                tgl_permohonan: tgl,
                                tgl_pengerjaan: r.tglpengerjaan || '',
                                bagian,
                                pemohon: r.userbuat || '-',
                                tahap,
                                status: 'SELESAI',
                                is_selesai: true
                            });
                        }

                        // B. Proses baris "Pengajuan Masuk" (Sudah masuk DC, belum dibuat pengesahan oleh DC)
                        for (const r of group.masuk) {
                            if (r.ubahstatus === '2' || r.userbatal) {
                                continue;
                            }
                            const codeMatch = (r.namapengajuandokumen || '').match(/\(([A-Z0-9.\-/]+)\)\s*$/i);
                            const klausul = r.kodepengajuandokumen || (codeMatch ? codeMatch[1] : '-');
                            const revisi = r.norevisi || r.nomorrevisidokumen || '-';
                            const bagian = r.bagian || r.userbuat || '-';
                            const tgl = r.tglpermohonan || '';

                            const tahap = r.lastuserapprove
                                ? `Pengajuan Masuk DC (Disetujui ${r.lastuserapprove}) - Menunggu Pengesahan DC`
                                : 'Pengajuan Masuk DC - Menunggu Pengesahan DC';

                            parsedRows.push({
                                id: parsedRows.length + 1,
                                nomor_klausul: klausul,
                                jenis_dokumen: r.namajenisdokumen || '-',
                                nama_dokumen: r.namapengajuandokumen || '-',
                                nomor_revisi: revisi,
                                tgl_permohonan: tgl,
                                tgl_pengerjaan: '',
                                bagian,
                                pemohon: r.userbuat || '-',
                                tahap,
                                status: 'BELUM SELESAI',
                                is_selesai: false
                            });
                        }
                    }

                    if (parsedRows.length > 0) {
                        // Urutkan dari tanggal permohonan terbaru ke terlama
                        parsedRows.sort((a, b) => (b.tgl_permohonan || '').localeCompare(a.tgl_permohonan || ''));
                        parsedRows.forEach((r, idx) => { r.id = idx + 1; });

                        cache.liveRows = parsedRows;
                        cache.liveRowsTimestamp = now;
                        cache.lastFetchedAt = new Date().toISOString();

                        const totalAll = parsedRows.length;
                        const selesaiAll = parsedRows.filter(r => r.is_selesai).length;
                        savePersistentCache({
                            total_masuk: totalAll,
                            total_selesai: selesaiAll,
                            total_belum: totalAll - selesaiAll,
                            persentase: totalAll > 0 ? Number(((selesaiAll / totalAll) * 100).toFixed(2)) : 0
                        }, parsedRows);

                        return { rows: parsedRows, source: 'Live Paperless (snam.ddns.net:8069)' };
                    }
                }
            } catch (err) {
                console.warn(`⚠️ [DC LIVE WEB FETCH ERROR]: ${err.message}`);
            }
        }

        // Fallback ke cache persisten jika gagal
        const diskCache = loadPersistentCache();
        if (diskCache && Array.isArray(diskCache.rows) && diskCache.rows.length > 0) {
            return { rows: diskCache.rows, source: 'Cache Paperless (Offline Fallback)' };
        }

        return { rows: [], source: 'Default Standby' };
    }

    /**
     * Ringkasan KPI DC untuk Card Dashboard
     */
    async getSummary(force = false, customDates = null) {
        const now = Date.now();
        const dateRange = getDateRange(customDates?.bulan, customDates?.tahun);
        const cacheKey = `${dateRange.tglawal}_${dateRange.tglakhir}`;

        const cached = cache.summaryMap?.get(cacheKey);
        if (!force && cached && (now - cached.timestamp < CACHE_TTL_MS)) {
            return cached.data;
        }

        // Gunakan liveRows di memori jika sudah tersedia agar perpindahan bulan instan (< 5ms)
        let allRows = cache.liveRows;
        let source = 'Live Paperless (snam.ddns.net:8069)';
        if (!Array.isArray(allRows) || allRows.length === 0) {
            const fetched = await this.fetchLiveRows(force);
            allRows = fetched.rows;
            source = fetched.source;
        } else if (force || (now - cache.liveRowsTimestamp >= CACHE_TTL_MS)) {
            // Segarkan di background tanpa memblokir response perpindahan bulan
            if (!cache.isSyncing) {
                cache.isSyncing = true;
                this.fetchLiveRows(true).finally(() => { cache.isSyncing = false; });
            }
        }

        const filtered = allRows.filter(r => {
            if (!r.tgl_permohonan) return false;
            return r.tgl_permohonan >= dateRange.tglawal && r.tgl_permohonan <= dateRange.tglakhir;
        });

        const total = filtered.length;
        const selesai = filtered.filter(r => r.is_selesai || (r.status || '').toUpperCase() === 'SELESAI').length;
        const belum = total - selesai;
        const persentase = total > 0 ? Number(((selesai / total) * 100).toFixed(2)) : 0;

        const summaryData = {
            success: allRows.length > 0,
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
            last_sync: cache.lastFetchedAt || new Date().toISOString(),
            source
        };

        if (!cache.summaryMap) cache.summaryMap = new Map();
        cache.summaryMap.set(cacheKey, { data: summaryData, timestamp: now });
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
            pageSize = 10,
            force = false
        } = options;

        const dateRange = getDateRange(bulan, tahun);
        let rows = cache.liveRows;
        let source = 'Live Paperless (snam.ddns.net:8069)';
        if (!Array.isArray(rows) || rows.length === 0 || force) {
            const fetched = await this.fetchLiveRows(force);
            rows = fetched.rows;
            source = fetched.source;
        } else if (Date.now() - cache.liveRowsTimestamp >= CACHE_TTL_MS) {
            if (!cache.isSyncing) {
                cache.isSyncing = true;
                this.fetchLiveRows(true).finally(() => { cache.isSyncing = false; });
            }
        }

        // 1. Filter Range Waktu
        let filtered = rows;
        if (range === 'all') {
            filtered = rows;
        } else if (tglawal && tglakhir) {
            filtered = filtered.filter(r => {
                if (!r.tgl_permohonan) return false;
                return r.tgl_permohonan >= tglawal && r.tgl_permohonan <= tglakhir;
            });
        } else if (range === 'today') {
            const now = new Date();
            const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            filtered = filtered.filter(r => r.tgl_permohonan === todayStr);
        } else if (range === 'month') {
            filtered = filtered.filter(r => {
                if (!r.tgl_permohonan) return false;
                return r.tgl_permohonan >= dateRange.tglawal && r.tgl_permohonan <= dateRange.tglakhir;
            });
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
            source
        };
    }
}

const dcService = new DcService();
module.exports = dcService;
