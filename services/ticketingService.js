/**
 * ====================================================================
 * SERVICE: TICKETING API CLIENT
 * ====================================================================
 * Bertanggung jawab khusus untuk komunikasi ke API Monitoring Ticketing.
 * Dibangun dengan arsitektur & pola yang sama persis seperti subconService:
 * - Menggunakan URL tunggal dengan api_key (?api_key=...)
 * - Caching in-memory untuk efisiensi beban server
 * - Agregasi data untuk kebutuhan kartu layanan (IT, TK, GA) & modal tiket
 * ====================================================================
 */

const axios = require('axios');
const config = require('../config/app.config');

// In-memory cache untuk meminimalkan beban request ke server ticketing
const cache = {
    summary: { data: null, timestamp: 0 },
    summaries: new Map(), // key: YYYY-MM -> { data, timestamp }
    tickets: new Map(), // key: cacheKey -> { data, timestamp }
};

// Durasi cache summary (10 detik) dan tiket (15 detik) agar tetap sangat responsif & selalu fresh
const SUMMARY_CACHE_TTL_MS = Math.max(config.cacheTtlSeconds * 1000, 10000);
const TICKET_CACHE_TTL_MS = 15 * 1000;

/**
 * Bangun URL lengkap dengan parameter query yang aman (identik dengan buildSubconUrl)
 */
function buildTicketingUrl(params = {}) {
    const rawUrl = config.ticketing.url;
    if (!rawUrl) {
        throw new Error('TICKETING_API_URL belum dikonfigurasi di file .env');
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
    timeout: config.ticketing.timeoutMs || 20000,
    headers: {
        'Accept': 'application/json',
    }
});

const ticketingService = {
    /**
     * Mengambil ringkasan statistik (summary) monitoring ticketing
     * Mendukung filter per bulan sesuai pemilihan periode dashboard
     * Mengembalikan data KPI dan layanan_monitoring { IT, TK, GA }
     */
    async getSummary(force = false, customDates = null) {
        const now = Date.now();

        // Tentukan target bulan (format YYYY-MM)
        let targetMonthStr = '';
        if (customDates) {
            if (customDates.tglawal) {
                targetMonthStr = customDates.tglawal.slice(0, 7);
            } else if (customDates.tahun && customDates.bulan) {
                targetMonthStr = `${customDates.tahun}-${String(customDates.bulan).padStart(2, '0')}`;
            }
        }
        if (!targetMonthStr) {
            const nowObj = new Date();
            targetMonthStr = `${nowObj.getFullYear()}-${String(nowObj.getMonth() + 1).padStart(2, '0')}`;
        }

        const cacheKey = `summary_${targetMonthStr}`;
        if (!force && cache.summaries && cache.summaries.has(cacheKey)) {
            const cached = cache.summaries.get(cacheKey);
            if (now - cached.timestamp < SUMMARY_CACHE_TTL_MS) {
                return cached.data;
            }
        }

        // Ambil tiket seluruh layanan sekaligus (1 HTTP call untuk efisiensi & menghindari timeout WAN)
        const services = ['IT', 'TK', 'GA'];
        const ticketsByService = { IT: [], TK: [], GA: [] };
        
        try {
            const res = await ticketingService.getTickets({ service: 'ALL', status: 'all', limit: 'all', force });
            const allTickets = res.tickets || res.data || [];
            allTickets.forEach(t => {
                const srv = String(t.service || t.kategori || '').toUpperCase().trim();
                if (ticketsByService[srv]) {
                    ticketsByService[srv].push(t);
                }
            });
        } catch (err) {
            console.warn(`[TICKETING] Gagal fetch tiket ALL:`, err.message);
            // Fallback: Jika ada cache sebelumnya, kembalikan cache daripada mengembalikan 0
            if (cache.summaries && cache.summaries.has(cacheKey)) {
                return cache.summaries.get(cacheKey).data;
            }
        }

        const layananMap = {};
        for (const srv of services) {
            const allTickets = ticketsByService[srv] || [];
            // Filter tiket sesuai target bulan (YYYY-MM)
            const monthTickets = allTickets.filter(t => {
                const dt = (t.tanggal || t.created_at || '').trim();
                return dt.startsWith(targetMonthStr);
            });

            const totalMasuk = monthTickets.length;
            const selesai = monthTickets.filter(t => t.status === 'closed' || t.status === 'selesai' || t.status_label?.toLowerCase() === 'selesai').length;
            const ditolak = monthTickets.filter(t => t.status === 'rejected' || t.status === 'ditolak' || t.status_label?.toLowerCase() === 'ditolak').length;
            const efektif = Math.max(0, totalMasuk - ditolak);
            const belum = Math.max(0, efektif - selesai);
            const persentase = efektif > 0 ? Math.round((selesai / efektif) * 1000) / 10 : 0;

            layananMap[srv] = {
                kode: srv,
                nama: srv === 'IT' ? 'Layanan IT' : srv === 'TK' ? 'Layanan Teknik' : 'Layanan GA',
                deskripsi: srv === 'IT' ? 'Information Technology & Software' : srv === 'TK' ? 'Maintenance, Mesin & Utilitas' : 'General Affairs, Fasilitas & Sarpras',
                icon: srv === 'IT' ? 'laptop' : srv === 'TK' ? 'wrench' : 'building',
                total_masuk: totalMasuk,
                total_tiket: efektif, // Tiket ditolak TIDAK dihitung ke total tiket
                selesai: selesai,
                belum_selesai: belum,
                ditolak: ditolak,
                total_efektif: efektif,
                persentase_selesai: persentase,
                target_month: targetMonthStr
            };
        }

        const totalAktif = (layananMap.IT.belum_selesai + layananMap.TK.belum_selesai + layananMap.GA.belum_selesai);
        const resultPayload = {
            success: true,
            message: 'Berhasil memuat ringkasan monitoring ticketing bulanan',
            server_time: new Date().toISOString(),
            data: {
                total_masuk: layananMap.IT.total_masuk + layananMap.TK.total_masuk + layananMap.GA.total_masuk,
                total_tickets: layananMap.IT.total_tiket + layananMap.TK.total_tiket + layananMap.GA.total_tiket,
                total_tiket_aktif: totalAktif,
                layanan_monitoring: layananMap,
                per_layanan: Object.values(layananMap),
                target_month: targetMonthStr
            }
        };

        if (!cache.summaries) cache.summaries = new Map();
        cache.summaries.set(cacheKey, { data: resultPayload, timestamp: now });
        cache.summary.data = resultPayload;
        cache.summary.timestamp = now;

        // Otomatis pre-warm data tiket di background
        setTimeout(() => {
            ticketingService.prewarmTickets().catch(() => { });
        }, 200);

        return resultPayload;
    },

    /**
     * Background pre-warming tiket per layanan untuk semua tab filter
     */
    async prewarmTickets() {
        const services = ['IT', 'TK', 'GA'];
        const statuses = ['all', 'selesai', 'belum', 'rejected'];

        for (const service of services) {
            for (const status of statuses) {
                const cacheKey = `${service}_${status}_all_`;
                const cached = cache.tickets.get(cacheKey);
                if (!cached || (Date.now() - cached.timestamp > 15000)) {
                    try {
                        await ticketingService.getTickets({ service, status, limit: 'all' });
                    } catch {
                        // ignore background prewarm error
                    }
                }
            }
        }
    },

    /**
     * Mengambil daftar tiket dengan filter spesifik (termasuk rentang tanggal startDate, endDate, bulan & tahun)
     * @param {Object} params - { service, status, limit, search, bulan, tahun, startDate, endDate, force }
     */
    async getTickets({ service, status, limit = 'all', search, bulan, tahun, startDate, endDate, force = false } = {}) {
        const now = Date.now();
        let targetStatus = status || 'all';
        if (targetStatus === 'ditolak') targetStatus = 'rejected';

        let targetMonthStr = '';
        if (tahun && bulan) {
            targetMonthStr = `${tahun}-${String(bulan).padStart(2, '0')}`;
        }

        const effectiveLimit = (limit === 'all' || limit === 0 || limit === '0' || !limit) ? 'all' : (parseInt(limit, 10) || 'all');
        const cacheKey = `${service || 'ALL'}_${targetStatus}_${effectiveLimit}_${search || ''}_${targetMonthStr}_${startDate || ''}_${endDate || ''}`;

        const cached = cache.tickets.get(cacheKey);
        if (!force && cached && (now - cached.timestamp < TICKET_CACHE_TTL_MS)) {
            return cached.data;
        }

        // Ambil tiket dari API remote (selalu minta status: all jika filter tanggal/bulan aktif agar tidak terpotong)
        const isAllService = !service || service.toUpperCase() === 'ALL';
        const targetUrl = buildTicketingUrl({
            service: isAllService ? undefined : service,
            status: (targetMonthStr || startDate || endDate) ? 'all' : targetStatus,
            limit: effectiveLimit,
            search: search || undefined
        });

        const response = await httpClient.get(targetUrl);
        const json = response.data;

        if (!json || !json.success) {
            throw new Error(json?.message || 'Gagal memuat daftar tiket dari API Monitoring Ticketing');
        }

        let tickets = json.data?.tickets || [];

        // 1. Filter per rentang tanggal (startDate & endDate) atau per bulan jika targetMonthStr ditentukan
        if (startDate || endDate) {
            tickets = tickets.filter(t => {
                const dt = (t.tanggal || t.created_at || '').trim();
                const tgl = dt.slice(0, 10);
                if (startDate && tgl < startDate) return false;
                if (endDate && tgl > endDate) return false;
                return true;
            });
        } else if (targetMonthStr) {
            tickets = tickets.filter(t => {
                const dt = (t.tanggal || t.created_at || '').trim();
                return dt.startsWith(targetMonthStr);
            });
        }

        // 2. Hitung statistik untuk rentang tanggal/periode ini sebelum difilter per tab status
        const totalMasuk = tickets.length;
        const totalSelesai = tickets.filter(t => t.status === 'closed' || t.status === 'selesai' || t.status_label?.toLowerCase() === 'selesai').length;
        const totalDitolak = tickets.filter(t => t.status === 'rejected' || t.status === 'ditolak' || t.status_label?.toLowerCase() === 'ditolak').length;
        const totalEfektif = Math.max(0, totalMasuk - totalDitolak);
        const totalBelum = Math.max(0, totalEfektif - totalSelesai);
        const persentase = totalEfektif > 0 ? Math.round((totalSelesai / totalEfektif) * 1000) / 10 : 0;

        const stats = {
            total_masuk: totalMasuk,
            total_tiket: totalEfektif,
            total_efektif: totalEfektif,
            selesai: totalSelesai,
            belum_selesai: totalBelum,
            ditolak: totalDitolak,
            persentase_selesai: persentase
        };

        // 3. Terapkan filter status tab jika diminta
        if (targetStatus && targetStatus !== 'all') {
            if (targetStatus === 'selesai' || targetStatus === 'closed') {
                tickets = tickets.filter(t => t.status === 'closed' || t.status === 'selesai' || t.status_label?.toLowerCase() === 'selesai');
            } else if (targetStatus === 'rejected' || targetStatus === 'ditolak') {
                tickets = tickets.filter(t => t.status === 'rejected' || t.status === 'ditolak' || t.status_label?.toLowerCase() === 'ditolak');
            } else if (targetStatus === 'belum') {
                tickets = tickets.filter(t =>
                    t.status !== 'closed' && t.status !== 'selesai' && t.status_label?.toLowerCase() !== 'selesai' &&
                    t.status !== 'rejected' && t.status !== 'ditolak' && t.status_label?.toLowerCase() !== 'ditolak'
                );
            }
        }

        const resultPayload = {
            success: true,
            data: tickets,
            tickets: tickets,
            total_tickets: tickets.length,
            stats: stats,
            target_month: targetMonthStr || null,
            startDate: startDate || null,
            endDate: endDate || null,
            kpi: json.data?.kpi,
            per_layanan: json.data?.per_layanan
        };

        cache.tickets.set(cacheKey, { data: resultPayload, timestamp: now });
        return resultPayload;
    },

    /**
     * Mengambil data monitoring mentah lengkap
     */
    async getMonitoringData(params = {}) {
        const targetUrl = buildTicketingUrl(params);
        const response = await httpClient.get(targetUrl);
        return response.data;
    },

    /**
     * Health check koneksi ke API Ticketing
     */
    async ping() {
        const targetUrl = buildTicketingUrl({ limit: 1 });
        const res = await httpClient.get(targetUrl, { timeout: 5000 });
        return {
            status: res.data?.success ? 'online' : 'error',
            system: 'Ticketing Monitoring API',
            message: res.data?.message || 'OK'
        };
    }
};

module.exports = ticketingService;

