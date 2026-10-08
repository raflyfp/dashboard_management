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
     * Mengembalikan data KPI dan layanan_monitoring { IT, TK, GA }
     */
    async getSummary(force = false) {
        const now = Date.now();
        if (!force && cache.summary.data && (now - cache.summary.timestamp < SUMMARY_CACHE_TTL_MS)) {
            return cache.summary.data;
        }

        const targetUrl = buildTicketingUrl();
        const response = await httpClient.get(targetUrl);
        const json = response.data;

        if (!json || !json.success) {
            throw new Error(json?.message || 'Gagal memuat summary dari API Monitoring Ticketing');
        }

        const rawData = json.data || {};

        // Bentuk layanan_monitoring map { IT: {...}, TK: {...}, GA: {...} }
        // agar kompatibel langsung dengan dashboardRoutes & frontend
        const layananMap = {};
        if (Array.isArray(rawData.per_layanan)) {
            rawData.per_layanan.forEach(item => {
                if (item && item.kode) {
                    layananMap[item.kode] = {
                        ...item,
                        total_tiket: item.total_tiket ?? 0,
                        selesai: item.selesai ?? 0,
                        belum_selesai: item.belum_selesai ?? 0,
                        ditolak: item.ditolak ?? 0,
                        persentase_selesai: item.persentase_selesai ?? 0,
                    };
                }
            });
        }

        const resultPayload = {
            success: true,
            message: json.message,
            server_time: json.meta?.timestamp || new Date().toISOString(),
            data: {
                ...rawData,
                total_tiket_aktif: rawData.kpi?.total_tiket_aktif ?? 0,
                layanan_monitoring: layananMap,
            }
        };

        cache.summary.data = resultPayload;
        cache.summary.timestamp = now;

        // Otomatis pre-warm data tiket di background agar saat tombol "Lihat Detail" ditekan,
        // responnya langsung instan (0 ms) tanpa menunggu pemanggilan API ke WAN!
        setTimeout(() => {
            ticketingService.prewarmTickets().catch(() => {});
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
     * Mengambil daftar tiket dengan filter spesifik
     * @param {Object} params - { service, status, limit, search, force }
     */
    async getTickets({ service, status, limit = 'all', search, force = false } = {}) {
        const now = Date.now();
        let targetStatus = status || 'all';
        if (targetStatus === 'ditolak') targetStatus = 'rejected';

        const effectiveLimit = (limit === 'all' || limit === 0 || limit === '0' || !limit) ? 'all' : (parseInt(limit, 10) || 'all');
        const cacheKey = `${service || 'ALL'}_${targetStatus}_${effectiveLimit}_${search || ''}`;

        const cached = cache.tickets.get(cacheKey);
        if (!force && cached && (now - cached.timestamp < TICKET_CACHE_TTL_MS)) {
            return cached.data;
        }

        const targetUrl = buildTicketingUrl({
            service: service || undefined,
            status: targetStatus,
            limit: effectiveLimit,
            search: search || undefined
        });

        const response = await httpClient.get(targetUrl);
        const json = response.data;

        if (!json || !json.success) {
            throw new Error(json?.message || 'Gagal memuat daftar tiket dari API Monitoring Ticketing');
        }

        const tickets = json.data?.tickets || [];
        const resultPayload = {
            success: true,
            data: tickets,
            tickets: tickets,
            total_tickets: json.data?.total_tickets || tickets.length,
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

