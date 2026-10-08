/**
 * ====================================================================
 * KONFIGURASI TERPUSAT APLIKASI DASHBOARD
 * ====================================================================
 * Mengambil nilai dari file .env dengan nilai fallback default.
 * ====================================================================
 */

require('dotenv').config();

const defaultTicketingUrl = 'https://www.snam110.dpdns.org/helpdesk/api/monitoring?api_key=ticketing-monitoring-2026';
const defaultSubconUrl = 'https://www.snam110.dpdns.org/e-subcon/api/monitoring?api_key=subcon-management-monitoring-2026';

// Ambil URL ticketing dari .env atau fallback default
let ticketingUrl = (process.env.TICKETING_API_URL || defaultTicketingUrl).trim();

// Dukung jika API key ditulis terpisah di TICKETING_API_KEY
if (process.env.TICKETING_API_KEY && !ticketingUrl.includes('api_key=')) {
    const separator = ticketingUrl.includes('?') ? '&' : '?';
    ticketingUrl = `${ticketingUrl}${separator}api_key=${encodeURIComponent(process.env.TICKETING_API_KEY.trim())}`;
}

module.exports = {
    // Port server Express
    port: parseInt(process.env.PORT, 10) || 3000,

    // Konfigurasi API Ticketing Laravel (Format sama seperti Subcon API)
    ticketing: {
        url: ticketingUrl,
        baseUrl: ticketingUrl, // Backward-compatibility
        timeoutMs: 10000,
    },

    // Konfigurasi API Subcon Laravel
    subcon: {
        url: (process.env.SUBCON_API_URL || defaultSubconUrl).trim(),
        timeoutMs: 10000,
    },

    // Cache internal Express (detik)
    cacheTtlSeconds: parseInt(process.env.CACHE_TTL_SECONDS, 10) || 5,

    // Interval auto-refresh data di frontend (detik)
    refreshIntervalSeconds: parseInt(process.env.REFRESH_INTERVAL_SECONDS, 10) || 15,
};

