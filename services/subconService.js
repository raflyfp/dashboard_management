/**
 * ====================================================================
 * SERVICE: SUBCON API CLIENT
 * ====================================================================
 * Bertanggung jawab khusus untuk komunikasi ke API Monitoring Subcon.
 * Mengelola pemanggilan API, caching in-memory, dan agregasi data untuk
 * kebutuhan visualisasi grafik & tabel detail pengerjaan.
 * ====================================================================
 */

const axios = require('axios');
const config = require('../config/app.config');

// In-memory cache untuk meminimalkan beban request ke server e-subcon
const cache = {
    today: { data: null, timestamp: 0 },
    range: new Map(), // key: range_key -> { data, timestamp }
};

const CACHE_TTL_MS = config.cacheTtlSeconds * 1000;

/**
 * Format Date ke string YYYY-MM-DD
 */
function formatDate(date) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Format tanggal ke label singkat Indonesia (misal: "05 Okt")
 */
function formatShortDate(dateStr) {
    try {
        const parts = dateStr.split('-');
        if (parts.length === 3) {
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
            const day = parts[2];
            const monthIdx = parseInt(parts[1], 10) - 1;
            return `${day} ${months[monthIdx] || ''}`;
        }
    } catch {
        // fallback
    }
    return dateStr;
}

/**
 * Bangun URL lengkap dengan parameter query yang aman
 */
function buildSubconUrl(params = {}) {
    const rawUrl = config.subcon.url;
    if (!rawUrl) {
        throw new Error('SUBCON_API_URL belum dikonfigurasi di file .env');
    }

    const u = new URL(rawUrl.trim());
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
            u.searchParams.set(key, value);
        }
    }
    return u.toString();
}

/**
 * Buat instance Axios dengan konfigurasi timeout
 */
const httpClient = axios.create({
    timeout: config.subcon.timeoutMs || 10000,
    headers: {
        'Accept': 'application/json',
    }
});

const subconService = {
    /**
     * Mengambil ringkasan hari ini untuk kartu utama dashboard
     */
    async getMonitoringToday(force = false) {
        const now = Date.now();
        if (!force && cache.today.data && (now - cache.today.timestamp < CACHE_TTL_MS)) {
            return cache.today.data;
        }

        const todayStr = formatDate(new Date());
        const targetUrl = buildSubconUrl({
            tanggal: todayStr,
            tanggal_mulai: todayStr,
            tanggal_akhir: todayStr,
        });

        const response = await httpClient.get(targetUrl);
        const json = response.data;

        if (!json || !json.success) {
            throw new Error(json?.message || 'Gagal memuat data dari API Monitoring Subcon');
        }

        cache.today.data = json;
        cache.today.timestamp = now;
        return json;
    },

    /**
     * Mengambil data monitoring dengan rentang waktu tertentu
     * @param {Object} options - { range: 'today'|'week'|'month', tanggal_mulai, tanggal_akhir, search }
     */
    async getMonitoringData({ range = 'today', tanggal_mulai, tanggal_akhir, search } = {}) {
        const now = Date.now();
        const today = new Date();
        let startDate = formatDate(today);
        let endDate = formatDate(today);

        if (tanggal_mulai && tanggal_akhir) {
            startDate = tanggal_mulai;
            endDate = tanggal_akhir;
        } else if (range === 'week') {
            const past7 = new Date();
            past7.setDate(today.getDate() - 6);
            startDate = formatDate(past7);
            endDate = formatDate(today);
        } else if (range === 'month') {
            const past30 = new Date();
            past30.setDate(today.getDate() - 29);
            startDate = formatDate(past30);
            endDate = formatDate(today);
        }

        const cacheKey = `${startDate}_${endDate}_${search || ''}`;
        const cached = cache.range.get(cacheKey);
        if (cached && (now - cached.timestamp < CACHE_TTL_MS)) {
            return cached.data;
        }

        const targetUrl = buildSubconUrl({
            tanggal_mulai: startDate,
            tanggal_akhir: endDate,
            search: search || undefined,
        });

        const response = await httpClient.get(targetUrl);
        const json = response.data;

        if (!json || !json.success) {
            throw new Error(json?.message || 'Gagal memuat data dari API Monitoring Subcon');
        }

        const rawData = json.data || {};
        const kpi = rawData.kpi || {};
        const perSubcon = rawData.per_subcon || [];
        const perBarang = rawData.per_barang || [];
        const karyawanList = rawData.karyawan || [];

        // 1. Kumpulkan semua transaksi pengerjaan dari seluruh karyawan
        const allPengerjaan = [];
        const dailyAggMap = new Map(); // date -> { total_pcs, total_menit, count }

        // Inisialisasi rentang tanggal jika multi-hari agar hari dengan 0 pcs tetap ada di grafik
        const startD = new Date(startDate);
        const endD = new Date(endDate);
        if (range === 'week' || range === 'month' || startDate !== endDate) {
            const curr = new Date(startD);
            while (curr <= endD) {
                const curStr = formatDate(curr);
                dailyAggMap.set(curStr, {
                    date: curStr,
                    label: formatShortDate(curStr),
                    total_pcs: 0,
                    total_durasi_menit: 0,
                    total_transaksi: 0,
                });
                curr.setDate(curr.getDate() + 1);
            }
        }

        karyawanList.forEach(karyawan => {
            (karyawan.pengerjaan || []).forEach(p => {
                const itemTanggal = p.tanggal || startDate;
                allPengerjaan.push({
                    id: p.id,
                    tanggal: itemTanggal,
                    tanggal_label: formatShortDate(itemTanggal),
                    jam_mulai: p.jam_mulai,
                    jam_selesai: p.jam_selesai,
                    durasi_menit: p.durasi_menit,
                    durasi_text: p.durasi_text,
                    jumlah_pcs: p.jumlah,
                    jenis_pekerjaan: p.jenis_pekerjaan,
                    barang_id: p.barang_id,
                    kode_barang: p.kode_barang,
                    nama_barang: p.nama_barang,
                    satuan: p.satuan || 'PCS',
                    karyawan_id: karyawan.karyawan_id,
                    no_karyawan: karyawan.no_karyawan,
                    nama_karyawan: karyawan.nama_karyawan,
                    subcon_nama: karyawan.lokasi_subcon?.nama || 'SIMAN',
                });

                // Agregasi harian untuk grafik
                if (!dailyAggMap.has(itemTanggal)) {
                    dailyAggMap.set(itemTanggal, {
                        date: itemTanggal,
                        label: formatShortDate(itemTanggal),
                        total_pcs: 0,
                        total_durasi_menit: 0,
                        total_transaksi: 0,
                    });
                }
                const dayObj = dailyAggMap.get(itemTanggal);
                dayObj.total_pcs += (p.jumlah || 0);
                dayObj.total_durasi_menit += (p.durasi_menit || 0);
                dayObj.total_transaksi += 1;
            });
        });

        // Urutkan transaksi pengerjaan terbaru di paling atas
        allPengerjaan.sort((a, b) => {
            const tComp = (b.tanggal || '').localeCompare(a.tanggal || '');
            if (tComp !== 0) return tComp;
            return (b.id || 0) - (a.id || 0);
        });

        // Susun dataset untuk Chart (diurutkan kronologis tanggal)
        const dailyChart = Array.from(dailyAggMap.values())
            .sort((a, b) => a.date.localeCompare(b.date))
            .map(item => ({
                ...item,
                total_durasi_jam: Number((item.total_durasi_menit / 60).toFixed(1)),
            }));

        // Jika hari ini dan belum ada data multi-hari, buat distribusi per barang untuk grafik
        const perBarangChart = (perBarang || []).map(b => ({
            label: b.nama_barang,
            kode: b.kode_barang,
            total_pcs: b.total_pcs || 0,
        }));

        const resultPayload = {
            range,
            tanggal_mulai: startDate,
            tanggal_akhir: endDate,
            kpi: {
                total_output_pcs: kpi.total_output_pcs || 0,
                total_durasi_formatted: kpi.total_durasi_formatted || '0 Menit',
                total_transaksi: kpi.total_transaksi || 0,
                total_karyawan_aktif: kpi.total_karyawan_aktif || 0,
                sudah_mengisi: kpi.sudah_mengisi || 0,
                belum_mengisi: kpi.belum_mengisi || 0,
                persentase_pengisian: kpi.persentase_pengisian || 0,
            },
            daily_chart: dailyChart,
            per_barang_chart: perBarangChart,
            per_subcon: perSubcon,
            per_barang: perBarang,
            karyawan: karyawanList,
            pengerjaan: allPengerjaan,
            total_transaksi_detail: allPengerjaan.length,
        };

        cache.range.set(cacheKey, { data: resultPayload, timestamp: now });
        return resultPayload;
    },

    /**
     * Pengecekan koneksi ke API Subcon
     */
    async ping() {
        const todayStr = formatDate(new Date());
        const targetUrl = buildSubconUrl({
            tanggal: todayStr,
        });
        const res = await httpClient.get(targetUrl, { timeout: 4000 });
        return {
            status: res.data?.success ? 'online' : 'error',
            message: res.data?.message || 'OK'
        };
    }
};

module.exports = subconService;
