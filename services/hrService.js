/**
 * ====================================================================
 * SERVICE: HR API CLIENT (ATENA ERP REST API)
 * ====================================================================
 * Menghubungkan Dashboard ke REST API resmi Atena ERP untuk Kehadiran Karyawan:
 * 1. TK SNA: Kehadiran Tenaga Kerja SNA vs Jadwal (Roster)
 * 2. Marketing (Non-SNAM): Kehadiran Tenaga Kerja Marketing vs Jadwal
 * Endpoint:
 * - KehadiranTK/ringkasan
 * - KehadiranTK/detail
 * Parameter bagian: 'tksna' | 'marketing'
 * ====================================================================
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config/app.config');

const CACHE_DIR = path.join(__dirname, '..', 'data');
const PERSISTENT_CACHE_FILE = path.join(CACHE_DIR, 'hr_cache.json');

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
    summaryMap: new Map(), // key: cacheKey -> { data, timestamp }
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

function getDateParams(customMonth, customYear) {
    const now = new Date();
    const year = customYear ? parseInt(customYear, 10) : now.getFullYear();
    const monthNum = customMonth ? parseInt(customMonth, 10) : (now.getMonth() + 1);
    const month = String(monthNum).padStart(2, '0');
    const isCurrent = (year === now.getFullYear() && monthNum === (now.getMonth() + 1));
    const lastDay = new Date(year, monthNum, 0).getDate();
    const day = isCurrent ? String(now.getDate()).padStart(2, '0') : String(lastDay).padStart(2, '0');
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
        console.warn('⚠️ [HR CACHE]: Gagal memuat file cache cadangan:', err.message);
    }
    return null;
}

function savePersistentCache(data) {
    try {
        const payload = {
            data,
            lastFetchedAt: new Date().toISOString(),
        };
        fs.writeFileSync(PERSISTENT_CACHE_FILE, JSON.stringify(payload, null, 2), 'utf8');
    } catch (err) {
        console.warn('⚠️ [HR CACHE]: Gagal menyimpan file cache cadangan:', err.message);
    }
}

class HrService {
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
            console.error(`[ATENA AUTH HR ERROR]: ${errMsg}`);
            throw new Error(`Gagal otentikasi ke Atena API: ${errMsg}`);
        }
    }

    async requestWithAuth(endpoint, body = {}, retry = true) {
        const token = await this.getToken();
        const url = `${this.apiConfig.baseUrl}${endpoint}`;

        try {
            const response = await axios.post(url, body, {
                timeout: this.apiConfig.timeoutMs || 45000,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            });

            return response.data;
        } catch (error) {
            if (retry && error.response && (error.response.status === 401 || error.response.status === 403)) {
                console.warn('[ATENA HR]: Token kedaluwarsa, melakukan login ulang...');
                await this.getToken(true);
                return this.requestWithAuth(endpoint, body, false);
            }
            throw error;
        }
    }

    /**
     * Mengambil ringkasan Kehadiran TK dari Atena ERP per bagian: 'tksna' | 'marketing'
     */
    async fetchRingkasan(bagian = 'tksna', dates = {}) {
        const body = { bagian };
        if (dates.tglawal && dates.tglakhir) {
            body.tglawal = dates.tglawal;
            body.tglakhir = dates.tglakhir;
        }

        try {
            const res = await this.requestWithAuth('KehadiranTK/ringkasan', body);
            if (res && res.success && res.data) {
                const d = res.data;
                const totalJadwal = Number(d.total_jadwal || 0);
                const jadwalSesuai = Number(d.jadwal_sesuai || 0);
                const jadwalTidakSesuai = Number(d.jadwal_tidak_sesuai || 0);
                const persentase = totalJadwal > 0 ? Number(((jadwalSesuai / totalJadwal) * 100).toFixed(2)) : 0;

                return {
                    bagian,
                    judul: d.judul || (bagian === 'tksna' ? 'Kehadiran TK SNA vs Jadwal' : 'Kehadiran Marketing (Non-SNAM) vs Jadwal'),
                    tglawal: d.tglawal || dates.tglawal,
                    tglakhir: d.tglakhir || dates.tglakhir,
                    total_karyawan: Number(d.total_karyawan || 0),
                    total_jadwal: totalJadwal,
                    jadwal_sesuai: jadwalSesuai,
                    jadwal_tidak_sesuai: jadwalTidakSesuai,
                    sesuai: jadwalSesuai,
                    tidak_sesuai: jadwalTidakSesuai,
                    persentase: persentase,
                };
            }
        } catch (err) {
            console.error(`[ATENA HR RINGKASAN ${bagian} ERROR]:`, err.message);
        }

        return {
            bagian,
            judul: bagian === 'tksna' ? 'Kehadiran TK SNA vs Jadwal' : 'Kehadiran Marketing (Non-SNAM) vs Jadwal',
            tglawal: dates.tglawal,
            tglakhir: dates.tglakhir,
            total_karyawan: 0,
            total_jadwal: 0,
            jadwal_sesuai: 0,
            jadwal_tidak_sesuai: 0,
            persentase: 0
        };
    }

    /**
     * Analisis alasan ketidaksesuaian kehadiran terhadap plan
     */
    analisisAlasan(plan, aktual, status) {
        const p = String(plan || '').trim().toUpperCase();
        const a = String(aktual || '').trim().toUpperCase();
        const s = String(status || '').trim().toUpperCase();

        if (s === 'SESUAI' || p === a) {
            return {
                is_sesuai: true,
                keterangan: 'Sesuai Jadwal Plan',
                kategori_alasan: 'sesuai'
            };
        }

        // Ketidaksesuaian
        if (a === 'A') {
            return {
                is_sesuai: false,
                keterangan: 'Alpha (Tidak Hadir Tanpa Keterangan)',
                kategori_alasan: 'alpha'
            };
        }
        if (a === 'IK') {
            return {
                is_sesuai: false,
                keterangan: 'Izin Keluar / Tidak Masuk Penuh',
                kategori_alasan: 'izin'
            };
        }
        if (a === 'C') {
            return {
                is_sesuai: false,
                keterangan: 'Cuti',
                kategori_alasan: 'cuti'
            };
        }
        if (a === 'S') {
            return {
                is_sesuai: false,
                keterangan: 'Sakit',
                kategori_alasan: 'sakit'
            };
        }
        if (a.includes('.')) {
            const shiftName = a.replace('.', '');
            return {
                is_sesuai: false,
                keterangan: `Terlambat Masuk (${shiftName})`,
                kategori_alasan: 'terlambat'
            };
        }
        if (p === 'OFF' && a !== 'OFF') {
            return {
                is_sesuai: false,
                keterangan: `Masuk Saat Libur / Lembur (${a})`,
                kategori_alasan: 'lembur_off'
            };
        }
        if (p !== 'OFF' && a === 'OFF') {
            return {
                is_sesuai: false,
                keterangan: `Libur Saat Jadwal Kerja (${p})`,
                kategori_alasan: 'mangkir_off'
            };
        }
        if (p !== a) {
            return {
                is_sesuai: false,
                keterangan: `Beda Shift (Plan: ${p} → Aktual: ${a})`,
                kategori_alasan: 'beda_shift'
            };
        }

        return {
            is_sesuai: false,
            keterangan: 'Tidak Sesuai Jadwal',
            kategori_alasan: 'lainnya'
        };
    }

    /**
     * Mengambil detail baris Kehadiran TK dari Atena ERP per bagian: 'tksna' | 'marketing'
     */
    async fetchDetails(bagian = 'tksna', dates = {}) {
        const body = { bagian };
        if (dates.tglawal && dates.tglakhir) {
            body.tglawal = dates.tglawal;
            body.tglakhir = dates.tglakhir;
        }

        try {
            const res = await this.requestWithAuth('KehadiranTK/detail', body);
            const rawRows = (res && res.success && Array.isArray(res.data?.rows)) ? res.data.rows : [];

            return rawRows.map((r, idx) => {
                const planStr = String(r.plan || '').trim();
                const aktualStr = String(r.aktual || '').trim();
                const statusStr = String(r.status || '').trim().toUpperCase();

                const isSesuai = statusStr === 'SESUAI';
                const analisis = this.analisisAlasan(planStr, aktualStr, statusStr);

                return {
                    no: idx + 1,
                    tanggal: r.tanggal || '',
                    tanggal_label: formatShortDate(r.tanggal),
                    nkk: r.nkk || '-',
                    nama: r.nama || '-',
                    nama_karyawan: r.nama || '-',
                    jabatan: r.jabatan || '-',
                    plan: planStr || '-',
                    aktual: aktualStr || '-',
                    jenis_scan: r.jenis_scan || '-',
                    jam_scan: r.jam_scan || '-',
                    status: isSesuai ? 'SESUAI' : 'TIDAK SESUAI',
                    status_code: isSesuai ? 'sesuai' : 'tidak_sesuai',
                    keterangan_alasan: analisis.keterangan,
                    alasan: analisis.keterangan,
                    is_sesuai: isSesuai,
                    is_alpha: analisis.kategori_alasan === 'alpha',
                    terlambat: analisis.kategori_alasan === 'terlambat',
                    kategori_alasan: analisis.kategori_alasan,
                    bagian: bagian
                };
            });
        } catch (err) {
            console.error(`[ATENA HR DETAIL ${bagian} ERROR]:`, err.message);
            return [];
        }
    }

    /**
     * Agregasi data item Kehadiran TK
     */
    aggregateData(bagian = 'tksna', items = [], ringkasanKpi = {}) {
        const totalJadwal = items.length;
        let totalSesuai = 0;
        let totalTidakSesuai = 0;
        let totalAlpha = 0;
        let totalTerlambat = 0;
        let totalBedaShift = 0;
        let totalIzin = 0;
        const karyawanSet = new Set();

        items.forEach(item => {
            if (item.nkk && item.nkk !== '-') karyawanSet.add(item.nkk);
            if (item.status_code === 'sesuai') {
                totalSesuai++;
            } else {
                totalTidakSesuai++;
                if (item.kategori_alasan === 'alpha') totalAlpha++;
                else if (item.kategori_alasan === 'terlambat') totalTerlambat++;
                else if (item.kategori_alasan === 'beda_shift') totalBedaShift++;
                else if (item.kategori_alasan === 'izin') totalIzin++;
            }
        });

        const persentase = totalJadwal > 0 ? Number(((totalSesuai / totalJadwal) * 100).toFixed(2)) : (ringkasanKpi.persentase || 0);

        return {
            total_jadwal: totalJadwal || ringkasanKpi.total_jadwal || 0,
            jadwal_sesuai: totalSesuai || ringkasanKpi.jadwal_sesuai || 0,
            jadwal_tidak_sesuai: totalTidakSesuai || ringkasanKpi.jadwal_tidak_sesuai || 0,
            sesuai: totalSesuai || ringkasanKpi.jadwal_sesuai || 0,
            tidak_sesuai: totalTidakSesuai || ringkasanKpi.jadwal_tidak_sesuai || 0,
            total_karyawan: karyawanSet.size || ringkasanKpi.total_karyawan || 0,
            persentase: persentase,
            total_alpha: totalAlpha,
            total_terlambat: totalTerlambat,
            total_beda_shift: totalBedaShift,
            total_izin: totalIzin
        };
    }

    /**
     * Ambil data lengkap (Ringkasan + Detail) dari Atena API atau Cache untuk bagian tertentu
     */
    async fetchData(bagian = 'tksna', force = false, dates = {}) {
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

            const kpi = this.aggregateData(bagian, items, ringkasan);

            const result = {
                bagian,
                judul: ringkasan.judul,
                tglawal: dates.tglawal || ringkasan.tglawal,
                tglakhir: dates.tglakhir || ringkasan.tglakhir,
                kpi,
                items,
                last_updated: new Date().toISOString()
            };

            cache.detailCache.set(cacheKey, { data: result, timestamp: now });
            return result;
        } catch (err) {
            console.error(`[HR FETCH DATA ${bagian} ERROR]:`, err.message);
            if (cache.detailCache.has(cacheKey)) {
                console.warn(`[HR FETCH DATA ${bagian}]: Menggunakan cache in-memory yang ada karena koneksi bermasalah.`);
                return cache.detailCache.get(cacheKey).data;
            }
            const persistent = loadPersistentCache();
            if (persistent && persistent[bagian]) {
                console.warn(`[HR FETCH DATA ${bagian}]: Menggunakan file cache cadangan.`);
                return persistent[bagian];
            }
            throw err;
        }
    }

    /**
     * Mengambil ringkasan dari kedua bagian (TK SNA & Marketing) untuk Card Dashboard
     */
    async getSummary(force = false, customDates = null) {
        const { today, monthStart } = (customDates && customDates.tglawal)
            ? { today: customDates.tglakhir, monthStart: customDates.tglawal }
            : (customDates && (customDates.bulan || customDates.tahun))
                ? getDateParams(customDates.bulan, customDates.tahun)
                : getDateParams();

        const isCurrentMonth = customDates ? customDates.isCurrentMonth !== false : true;
        const cacheKey = customDates
            ? `${customDates.tahun || 'cur'}_${String(customDates.bulan || 'cur').padStart(2, '0')}_${isCurrentMonth ? 'today' : 'month'}`
            : 'default';
        const now = Date.now();
        // 60 detik untuk bulan ini, 1 jam untuk bulan historis (karena data lampau tidak berubah)
        const ttl = isCurrentMonth ? CACHE_TTL_MS : (60 * 60 * 1000);

        // 1. Cek In-Memory Cache (Respons Instan 0ms)
        if (!force && cache.summaryMap && cache.summaryMap.has(cacheKey)) {
            const cached = cache.summaryMap.get(cacheKey);
            if (now - cached.timestamp < ttl) {
                return cached.data;
            }
        }

        const todayParams = { tglawal: today, tglakhir: today };
        const monthParams = { tglawal: monthStart, tglakhir: today };

        try {
            // Optimasi: Hanya query yang relevan dengan tampilan aktif
            // Bulan ini -> hanya butuh data Hari Ini (TK SNA & Marketing)
            // Bulan historis -> hanya butuh data Bulan tersebut (TK SNA & Marketing)
            let todayTk = { total_jadwal: 0, jadwal_sesuai: 0, jadwal_tidak_sesuai: 0, total_karyawan: 0, persentase: 0 };
            let todayMkt = { total_jadwal: 0, jadwal_sesuai: 0, jadwal_tidak_sesuai: 0, total_karyawan: 0, persentase: 0 };
            let monthTk = { total_jadwal: 0, jadwal_sesuai: 0, jadwal_tidak_sesuai: 0, total_karyawan: 0, persentase: 0 };
            let monthMkt = { total_jadwal: 0, jadwal_sesuai: 0, jadwal_tidak_sesuai: 0, total_karyawan: 0, persentase: 0 };

            if (isCurrentMonth) {
                [todayTk, todayMkt] = await Promise.all([
                    this.fetchRingkasan('tksna', todayParams),
                    this.fetchRingkasan('marketing', todayParams)
                ]);
            } else {
                [monthTk, monthMkt] = await Promise.all([
                    this.fetchRingkasan('tksna', monthParams),
                    this.fetchRingkasan('marketing', monthParams)
                ]);
            }

            // Metrik Hari Ini (Today)
            const todayTotalJadwal = (todayTk.total_jadwal || 0) + (todayMkt.total_jadwal || 0);
            const todayJadwalSesuai = (todayTk.jadwal_sesuai || 0) + (todayMkt.jadwal_sesuai || 0);
            const todayJadwalTidakSesuai = (todayTk.jadwal_tidak_sesuai || 0) + (todayMkt.jadwal_tidak_sesuai || 0);
            const todayTotalKaryawan = (todayTk.total_karyawan || 0) + (todayMkt.total_karyawan || 0);
            const todayPersen = todayTotalJadwal > 0 ? Number(((todayJadwalSesuai / todayTotalJadwal) * 100).toFixed(1)) : 0;

            // Metrik Bulan Ini (Month)
            const monthTotalJadwal = (monthTk.total_jadwal || 0) + (monthMkt.total_jadwal || 0);
            const monthJadwalSesuai = (monthTk.jadwal_sesuai || 0) + (monthMkt.jadwal_sesuai || 0);
            const monthJadwalTidakSesuai = (monthTk.jadwal_tidak_sesuai || 0) + (monthMkt.jadwal_tidak_sesuai || 0);
            const monthTotalKaryawan = (monthTk.total_karyawan || 0) + (monthMkt.total_karyawan || 0);
            const monthPersen = monthTotalJadwal > 0 ? Number(((monthJadwalSesuai / monthTotalJadwal) * 100).toFixed(1)) : 0;

            // Tampilkan data sesuai mode aktif
            const activeTotal = isCurrentMonth ? todayTotalJadwal : monthTotalJadwal;
            const activeSesuai = isCurrentMonth ? todayJadwalSesuai : monthJadwalSesuai;
            const activeTidakSesuai = isCurrentMonth ? todayJadwalTidakSesuai : monthJadwalTidakSesuai;
            const activeKaryawan = isCurrentMonth ? todayTotalKaryawan : monthTotalKaryawan;
            const activePersen = isCurrentMonth ? todayPersen : monthPersen;

            const summaryPayload = {
                success: true,
                kpi: {
                    total_jadwal: activeTotal,
                    jadwal_sesuai: activeSesuai,
                    jadwal_tidak_sesuai: activeTidakSesuai,
                    total_karyawan: activeKaryawan,
                    persentase: activePersen,
                    persentase_selesai: activePersen,

                    today: {
                        total_jadwal: todayTotalJadwal,
                        jadwal_sesuai: todayJadwalSesuai,
                        jadwal_tidak_sesuai: todayJadwalTidakSesuai,
                        total_karyawan: todayTotalKaryawan,
                        persentase: todayPersen,
                        tksna: todayTk,
                        marketing: todayMkt
                    },
                    month: {
                        total_jadwal: monthTotalJadwal,
                        jadwal_sesuai: monthJadwalSesuai,
                        jadwal_tidak_sesuai: monthJadwalTidakSesuai,
                        total_karyawan: monthTotalKaryawan,
                        persentase: monthPersen,
                        tksna: monthTk,
                        marketing: monthMkt
                    },

                    tksna: isCurrentMonth ? todayTk : monthTk,
                    marketing: isCurrentMonth ? todayMkt : monthMkt
                },
                meta: {
                    tglawal: isCurrentMonth ? today : monthStart,
                    tglakhir: today,
                    is_today: isCurrentMonth,
                    last_updated: new Date().toISOString()
                },
                lastFetchedAt: new Date().toISOString()
            };

            cache.summary.data = summaryPayload;
            cache.summary.timestamp = Date.now();
            if (!cache.summaryMap) cache.summaryMap = new Map();
            cache.summaryMap.set(cacheKey, { data: summaryPayload, timestamp: Date.now() });
            savePersistentCache(summaryPayload);
            return summaryPayload;
        } catch (err) {
            console.error('[HR GET SUMMARY ERROR]:', err.message);
            if (cache.summaryMap?.has(cacheKey)) return cache.summaryMap.get(cacheKey).data;
            if (cache.summary.data) return cache.summary.data;
            const persistent = loadPersistentCache();
            if (persistent) return persistent;
            throw err;
        }
    }

    /**
     * Mengambil data monitoring detail untuk modal frontend HR
     */
    async getMonitoringData(options = {}) {
        const {
            bagian = 'tksna', // 'tksna' | 'marketing'
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
            const d = new Date();
            d.setDate(d.getDate() - 7);
            dateParams = { tglawal: formatDate(d), tglakhir: today };
        } else if (range === 'month') {
            dateParams = { tglawal: monthStart, tglakhir: today };
        } else if (range === 'all') {
            dateParams = { tglawal: '2024-01-01', tglakhir: today };
        }

        const data = await this.fetchData(bagian, force, dateParams);
        let items = data.items || [];

        // 1. Filter Status Kesesuaian
        if (status && status !== 'all') {
            if (status === 'sesuai') {
                items = items.filter(i => i.status_code === 'sesuai');
            } else if (status === 'tidak_sesuai') {
                items = items.filter(i => i.status_code === 'tidak_sesuai');
            } else if (status === 'alpha') {
                items = items.filter(i => i.kategori_alasan === 'alpha');
            } else if (status === 'terlambat') {
                items = items.filter(i => i.kategori_alasan === 'terlambat');
            } else if (status === 'beda_shift') {
                items = items.filter(i => i.kategori_alasan === 'beda_shift');
            }
        }

        // 2. Filter Pencarian
        if (search && search.trim()) {
            const q = search.trim().toLowerCase();
            items = items.filter(i =>
                (i.nama && i.nama.toLowerCase().includes(q)) ||
                (i.nkk && i.nkk.toLowerCase().includes(q)) ||
                (i.jabatan && i.jabatan.toLowerCase().includes(q)) ||
                (i.plan && i.plan.toLowerCase().includes(q)) ||
                (i.aktual && i.aktual.toLowerCase().includes(q))
            );
        }

        return {
            ...data,
            items,
            total_filtered: items.length
        };
    }
}

module.exports = new HrService();
