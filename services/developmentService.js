/**
 * ====================================================================
 * SERVICE: DEVELOPMENT & DOCUMENT CONTROL (GOOGLE SPREADSHEET SYNC)
 * ====================================================================
 * Menghubungkan Dashboard ke Google Spreadsheet Monitoring Permintaan &
 * Perubahan BOM (Bill of Materials) untuk modul Development (R&D) dan
 * Document Control (DC).
 * 
 * Sumber Data:
 * URL: https://docs.google.com/spreadsheets/d/e/2PACX-1vRtFe47B-ncyoQP_1X6ol4L0dvyp0b_z2GXroVTo5TSK-phM4CaLYhqqRPw6tCxPgNI_eoIgJJuhTiJ/pubhtml?gid=0&single=true
 * Format CSV: output=csv
 * ====================================================================
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config/app.config');

const CACHE_DIR = path.join(__dirname, '..', 'data');
const PERSISTENT_CACHE_FILE = path.join(CACHE_DIR, 'development_sheet_cache.json');

if (!fs.existsSync(CACHE_DIR)) {
    try {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    } catch {
        // ignore
    }
}

// In-memory cache & state
const cache = {
    rawCsv: null,
    items: [],
    timestamp: 0,
    lastFetchedAt: null,
    isSyncing: false,
};

const CACHE_TTL_MS = 60 * 1000; // 60 detik

const MONTH_NAMES = {
    'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
    'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12,
    'mei': 5, 'agu': 8, 'okt': 10, 'des': 12
};

function parseSheetDate(str) {
    if (!str || typeof str !== 'string') return null;
    const parts = str.trim().split('-');
    if (parts.length !== 3) return null;
    const day = parseInt(parts[0], 10);
    const mStr = parts[1].toLowerCase();
    const month = MONTH_NAMES[mStr] || null;
    const year = parseInt(parts[2], 10);
    if (!day || !month || !year) return null;
    const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return { day, month, year, isoDate };
}

function parseCSV(text) {
    const rows = [];
    let currentRow = [];
    let inQuotes = false;
    let currentCell = '';

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const nextChar = text[i + 1];

        if (char === '"' && inQuotes && nextChar === '"') {
            currentCell += '"';
            i++;
        } else if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            currentRow.push(currentCell.trim());
            currentCell = '';
        } else if ((char === '\r' || char === '\n') && !inQuotes) {
            if (char === '\r' && nextChar === '\n') i++;
            currentRow.push(currentCell.trim());
            rows.push(currentRow);
            currentRow = [];
            currentCell = '';
        } else {
            currentCell += char;
        }
    }
    if (currentRow.length > 0) rows.push(currentRow);
    return rows;
}

function loadPersistentCache() {
    try {
        if (fs.existsSync(PERSISTENT_CACHE_FILE)) {
            const raw = fs.readFileSync(PERSISTENT_CACHE_FILE, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.items)) {
                cache.items = parsed.items;
                cache.lastFetchedAt = parsed.lastFetchedAt || new Date().toISOString();
                return parsed.items;
            }
        }
    } catch (err) {
        console.warn('⚠️ [DEV CACHE]: Gagal memuat file cache cadangan:', err.message);
    }
    return [];
}

function savePersistentCache(items) {
    try {
        const payload = {
            items,
            lastFetchedAt: new Date().toISOString()
        };
        fs.writeFileSync(PERSISTENT_CACHE_FILE, JSON.stringify(payload, null, 2), 'utf8');
    } catch (err) {
        console.warn('⚠️ [DEV CACHE]: Gagal menyimpan file cache cadangan:', err.message);
    }
}

// Inisialisasi awal dari disk
loadPersistentCache();

const developmentService = {
    /**
     * Mengambil & mem-parse seluruh data baris dari Google Spreadsheet
     */
    async fetchAllItems(force = false) {
        const now = Date.now();
        if (!force && cache.items.length > 0 && (now - cache.timestamp < CACHE_TTL_MS)) {
            return cache.items;
        }

        const url = config.development?.spreadsheetUrl;
        if (!url) {
            if (cache.items.length > 0) return cache.items;
            throw new Error('DEVELOPMENT_SPREADSHEET_URL belum dikonfigurasi');
        }

        try {
            cache.isSyncing = true;
            const res = await axios.get(url, {
                timeout: config.development.timeoutMs || 15000,
                headers: { 'Accept': 'text/csv,text/plain,*/*' }
            });

            const csvText = String(res.data || '');
            if (!csvText.includes('PERMINTAAN BOM')) {
                throw new Error('Format spreadsheet tidak sesuai dengan template Permintaan BOM');
            }

            const rawRows = parseCSV(csvText);
            const items = [];

            // Baris 0-4 adalah header, data dimulai baris ke-5
            rawRows.slice(5).forEach((r, idx) => {
                const tglRaw = r[0] || '';
                const dateParsed = parseSheetDate(tglRaw);
                // Lewati baris kosong
                if (!dateParsed && !r[2] && !r[7]) return;

                const statusPpic = (r[6] || '').trim();
                const statusDev = (r[13] || '').trim();
                const jenis = (r[4] || '').trim();
                const priority = (r[3] || '').trim();
                const lamaProses = parseInt(r[15], 10);

                const isSelesai = statusPpic.toLowerCase() === 'complete' || statusDev.toLowerCase() === 'complete';
                const isBlocked = statusPpic.toLowerCase() === 'blocked';
                const isOnProgress = statusPpic.toLowerCase() === 'on progress' || (!isSelesai && !isBlocked);

                items.push({
                    id: idx + 1,
                    tanggal_raw: tglRaw,
                    tanggal: dateParsed ? dateParsed.isoDate : '',
                    month: dateParsed ? dateParsed.month : null,
                    year: dateParsed ? dateParsed.year : null,
                    jam: r[1] || '',
                    kode_produk: r[2] || '-',
                    priority: priority || 'Normal',
                    is_urgent: priority.toUpperCase().includes('URGENT'),
                    is_important: priority.toUpperCase().includes('IMPORTANT'),
                    jenis_bom: jenis || 'Baru',
                    is_perubahan: jenis.toLowerCase().includes('perubahan'),
                    is_baru: jenis.toLowerCase().includes('baru'),
                    detail_permintaan: r[5] || '-',
                    status_ppic: statusPpic || (isSelesai ? 'Complete' : 'On Progress'),
                    kode_bom: r[7] || '-',
                    nama_bom: r[8] || '-',
                    detail_perubahan: r[9] || '-',
                    tgl_kirim_bom: r[10] || '-',
                    jam_kirim_bom: r[11] || '-',
                    pic_input: r[12] || '-',
                    status_dev: statusDev || (isSelesai ? 'Complete' : 'Pending'),
                    tgl_input: r[14] || '-',
                    lama_proses_hari: isNaN(lamaProses) || lamaProses < 0 ? null : lamaProses,
                    is_selesai: isSelesai,
                    is_on_time: !isNaN(lamaProses) && lamaProses >= 0 && lamaProses <= 2,
                    is_overdue: !isNaN(lamaProses) && lamaProses > 2,
                    is_blocked: isBlocked,
                    is_on_progress: isOnProgress
                });
            });

            cache.rawCsv = csvText;
            cache.items = items;
            cache.timestamp = now;
            cache.lastFetchedAt = new Date().toISOString();
            savePersistentCache(items);

            return items;
        } catch (err) {
            console.error('❌ [DEVELOPMENT SERVICE ERROR]:', err.message);
            if (cache.items.length > 0) return cache.items;
            const fallback = loadPersistentCache();
            if (fallback.length > 0) return fallback;
            throw err;
        } finally {
            cache.isSyncing = false;
        }
    },

    /**
     * Ringkasan KPI untuk Card Dashboard DEVELOPMENT
     */
    async getSummary(force = false, customDates = null) {
        const items = await this.fetchAllItems(force);

        const now = new Date();
        const curYear = now.getFullYear();
        const curMonth = now.getMonth() + 1;

        const targetYear = customDates?.tahun ? parseInt(customDates.tahun, 10) : curYear;
        const targetMonth = customDates?.bulan ? parseInt(customDates.bulan, 10) : curMonth;
        const isCurrentMonth = customDates ? customDates.isCurrentMonth !== false : (targetYear === curYear && targetMonth === curMonth);

        // Filter items berdasarkan periode bulan terpilih
        let filtered = items.filter(it => it.year === targetYear && it.month === targetMonth);
        if (filtered.length === 0 && items.length > 0 && !customDates) {
            // Jika bulan berjalan belum ada data, ambil data 30 hari terakhir atau semua
            filtered = items.slice(-30);
        }

        const total = filtered.length;
        const selesai = filtered.filter(it => it.is_selesai).length;
        const belum = total - selesai;
        const persentase = total > 0 ? Number(((selesai / total) * 100).toFixed(1)) : 0;

        const baruCount = filtered.filter(it => it.is_baru).length;
        const perubahanCount = filtered.filter(it => it.is_perubahan).length;
        const urgentCount = filtered.filter(it => it.is_urgent).length;
        const onTimeCount = filtered.filter(it => it.is_selesai && it.is_on_time).length;
        const overdueCount = filtered.filter(it => it.is_overdue).length;

        // Metrik Hari Ini jika ada
        const todayStr = `${curYear}-${String(curMonth).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const todayItems = items.filter(it => it.tanggal === todayStr);
        const todayTotal = todayItems.length;
        const todaySelesai = todayItems.filter(it => it.is_selesai).length;
        const todayBelum = todayTotal - todaySelesai;
        const todayPersen = todayTotal > 0 ? Number(((todaySelesai / todayTotal) * 100).toFixed(1)) : 0;

        return {
            success: true,
            kpi: {
                total,
                selesai,
                belum,
                persentase,
                baru_count: baruCount,
                perubahan_count: perubahanCount,
                urgent_count: urgentCount,
                on_time_count: onTimeCount,
                overdue_count: overdueCount,
                today: {
                    total: todayTotal,
                    selesai: todaySelesai,
                    belum: todayBelum,
                    persentase: todayPersen
                },
                month: {
                    total,
                    selesai,
                    belum,
                    persentase
                }
            },
            meta: {
                tahun: targetYear,
                bulan: targetMonth,
                is_current_month: isCurrentMonth,
                total_all_records: items.length,
                last_updated: cache.lastFetchedAt || new Date().toISOString()
            }
        };
    },

    /**
     * Ringkasan KPI untuk Card Dashboard DC (Document Control - Perubahan Dokumen BOM)
     */
    async getDcSummary(force = false, customDates = null) {
        const items = await this.fetchAllItems(force);

        const now = new Date();
        const curYear = now.getFullYear();
        const curMonth = now.getMonth() + 1;

        const targetYear = customDates?.tahun ? parseInt(customDates.tahun, 10) : curYear;
        const targetMonth = customDates?.bulan ? parseInt(customDates.bulan, 10) : curMonth;
        const isCurrentMonth = customDates ? customDates.isCurrentMonth !== false : (targetYear === curYear && targetMonth === curMonth);

        // DC memfokuskan pengerjaan revisi / perubahan dokumen BOM
        let filtered = items.filter(it => it.year === targetYear && it.month === targetMonth && it.is_perubahan);
        if (filtered.length === 0 && items.length > 0 && !customDates) {
            filtered = items.filter(it => it.is_perubahan).slice(-30);
        }

        const total = filtered.length;
        const selesai = filtered.filter(it => it.is_selesai).length;
        const belum = total - selesai;
        const persentase = total > 0 ? Number(((selesai / total) * 100).toFixed(1)) : 0;
        const blockedCount = filtered.filter(it => it.is_blocked).length;
        const progressCount = filtered.filter(it => it.is_on_progress).length;

        return {
            success: true,
            kpi: {
                total,
                selesai,
                belum,
                persentase,
                blocked_count: blockedCount,
                progress_count: progressCount,
                month: {
                    total,
                    selesai,
                    belum,
                    persentase
                }
            },
            meta: {
                tahun: targetYear,
                bulan: targetMonth,
                is_current_month: isCurrentMonth,
                total_all_dc: items.filter(it => it.is_perubahan).length,
                last_updated: cache.lastFetchedAt || new Date().toISOString()
            }
        };
    },

    /**
     * Mengambil item untuk modal detail Development & DC
     */
    async getModalData(options = {}) {
        const {
            module = 'development', // 'development' | 'dc'
            range = 'month',
            status = 'all', // 'all' | 'complete' | 'progress' | 'blocked'
            jenis = 'all',  // 'all' | 'baru' | 'perubahan'
            search = '',
            bulan,
            tahun,
            tglawal,
            tglakhir,
            force = false
        } = options;

        const allItems = await this.fetchAllItems(force);

        const now = new Date();
        const targetYear = tahun ? parseInt(tahun, 10) : now.getFullYear();
        const targetMonth = bulan ? parseInt(bulan, 10) : (now.getMonth() + 1);

        let filtered = allItems;

        // Filter modul DC fokus ke perubahan dokumen
        if (module === 'dc') {
            filtered = filtered.filter(it => it.is_perubahan);
        }

        // Filter rentang waktu
        if (range === 'custom' && (tglawal || tglakhir)) {
            filtered = filtered.filter(it => {
                if (!it.tanggal) return true;
                if (tglawal && it.tanggal < tglawal) return false;
                if (tglakhir && it.tanggal > tglakhir) return false;
                return true;
            });
        } else if (range === 'month') {
            const mFiltered = filtered.filter(it => it.year === targetYear && it.month === targetMonth);
            filtered = mFiltered.length > 0 ? mFiltered : (allItems.length > 0 ? allItems.slice(-30) : []);
        } else if (range === 'today') {
            const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            const tFiltered = filtered.filter(it => it.tanggal === todayStr);
            filtered = tFiltered.length > 0 ? tFiltered : (allItems.length > 0 ? allItems.slice(-30) : []);
        }

        // Filter status
        if (status === 'complete' || status === 'selesai') {
            filtered = filtered.filter(it => it.is_selesai);
        } else if (status === 'progress' || status === 'on_progress') {
            filtered = filtered.filter(it => it.is_on_progress);
        } else if (status === 'blocked') {
            filtered = filtered.filter(it => it.is_blocked);
        }

        // Filter jenis BOM
        if (jenis === 'baru') {
            filtered = filtered.filter(it => it.is_baru);
        } else if (jenis === 'perubahan') {
            filtered = filtered.filter(it => it.is_perubahan);
        }

        // Filter pencarian
        if (search) {
            const q = search.toLowerCase().trim();
            filtered = filtered.filter(it =>
                it.kode_produk.toLowerCase().includes(q) ||
                it.nama_bom.toLowerCase().includes(q) ||
                it.kode_bom.toLowerCase().includes(q) ||
                it.detail_permintaan.toLowerCase().includes(q) ||
                it.pic_input.toLowerCase().includes(q) ||
                it.tanggal_raw.toLowerCase().includes(q)
            );
        }

        // Hitung ringkasan dari filtered data
        const total = filtered.length;
        const selesai = filtered.filter(it => it.is_selesai).length;
        const belum = total - selesai;
        const persentase = total > 0 ? Number(((selesai / total) * 100).toFixed(1)) : 0;
        const onProgressCount = filtered.filter(it => it.is_on_progress).length;
        const blockedCount = filtered.filter(it => it.is_blocked).length;

        return {
            success: true,
            module,
            kpi: {
                total,
                selesai,
                belum,
                persentase,
                on_progress_count: onProgressCount,
                blocked_count: blockedCount
            },
            items: filtered,
            last_updated: cache.lastFetchedAt || new Date().toISOString()
        };
    }
};

module.exports = developmentService;

