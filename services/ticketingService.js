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
    timeout: config.ticketing.timeoutMs || 10000,
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

        // Ambil tiket seluruh layanan secara paralel untuk agregasi bulanan yang akurat
        const services = ['IT', 'TK', 'GA'];
        const ticketsByService = {};
        await Promise.all(services.map(async (srv) => {
            try {
                const res = await ticketingService.getTickets({ service: srv, status: 'all', limit: 'all', force });
                ticketsByService[srv] = res.tickets || res.data || [];
            } catch (err) {
                console.warn(`[TICKETING] Gagal fetch tiket ${srv}:`, err.message);
                ticketsByService[srv] = [];
            }
        }));

        const layananMap = {};
        for (const srv of services) {
            const allTickets = ticketsByService[srv] || [];
            // Filter tiket sesuai target bulan (YYYY-MM)
            const monthTickets = allTickets.filter(t => {
                const dt = (t.tanggal || t.created_at || '').trim();
                return dt.startsWith(targetMonthStr);
            });

            const total = monthTickets.length;
            const selesai = monthTickets.filter(t => t.status === 'closed' || t.status === 'selesai' || t.status_label?.toLowerCase() === 'selesai').length;
            const ditolak = monthTickets.filter(t => t.status === 'rejected' || t.status === 'ditolak' || t.status_label?.toLowerCase() === 'ditolak').length;
            const belum = total - selesai - ditolak;
            const efektif = Math.max(0, total - ditolak);
            const persentase = efektif > 0 ? Math.round((selesai / efektif) * 1000) / 10 : 0;

            layananMap[srv] = {
                kode: srv,
                nama: srv === 'IT' ? 'Layanan IT' : srv === 'TK' ? 'Layanan Teknik' : 'Layanan GA',
                deskripsi: srv === 'IT' ? 'Information Technology & Software' : srv === 'TK' ? 'Maintenance, Mesin & Utilitas' : 'General Affairs, Fasilitas & Sarpras',
                icon: srv === 'IT' ? 'laptop' : srv === 'TK' ? 'wrench' : 'building',
                total_tiket: total,
                selesai: selesai,
                belum_selesai: Math.max(0, belum),
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
     * Mengambil daftar tiket dengan filter spesifik (termasuk bulan & tahun)
     * @param {Object} params - { service, status, limit, search, bulan, tahun, force }
     */
    async getTickets({ service, status, limit = 'all', search, bulan, tahun, force = false } = {}) {
        const now = Date.now();
        let targetStatus = status || 'all';
        if (targetStatus === 'ditolak') targetStatus = 'rejected';

        let targetMonthStr = '';
        if (tahun && bulan) {
            targetMonthStr = `${tahun}-${String(bulan).padStart(2, '0')}`;
        }

        const effectiveLimit = (limit === 'all' || limit === 0 || limit === '0' || !limit) ? 'all' : (parseInt(limit, 10) || 'all');
        const cacheKey = `${service || 'ALL'}_${targetStatus}_${effectiveLimit}_${search || ''}_${targetMonthStr}`;

        const cached = cache.tickets.get(cacheKey);
        if (!force && cached && (now - cached.timestamp < TICKET_CACHE_TTL_MS)) {
            return cached.data;
        }

        // Ambil tiket dari API remote (selalu minta status: all jika filter bulan aktif agar tidak terpotong)
        const targetUrl = buildTicketingUrl({
            service: service || undefined,
            status: targetMonthStr ? 'all' : targetStatus,
            limit: effectiveLimit,
            search: search || undefined
        });

        const response = await httpClient.get(targetUrl);
        const json = response.data;

        if (!json || !json.success) {
            throw new Error(json?.message || 'Gagal memuat daftar tiket dari API Monitoring Ticketing');
        }

        let tickets = json.data?.tickets || [];

        // Filter per bulan jika targetMonthStr ditentukan
        if (targetMonthStr) {
            tickets = tickets.filter(t => {
                const dt = (t.tanggal || t.created_at || '').trim();
                return dt.startsWith(targetMonthStr);
            });

            // Terapkan filter status jika diperlukan
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
        }

        const resultPayload = {
            success: true,
            data: tickets,
            tickets: tickets,
            total_tickets: tickets.length,
            target_month: targetMonthStr || null,
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

