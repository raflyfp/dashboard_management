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

    // Konfigurasi REST API Dashboard Atena ERP (Produksi, QA, Logistik, Purchasing, Gudang, PBF)
    atenaApi: {
        baseUrl: (process.env.ATENA_API_BASE_URL || 'https://erpsna.atena.id/API/Dashboard/').trim().replace(/\/?$/, '/'),
        username: (process.env.ATENA_API_USERNAME || 'SNATEST@EMAIL.COM').trim(),
        password: (process.env.ATENA_API_PASSWORD || 'admin123').trim(),
        timeoutMs: parseInt(process.env.ATENA_API_TIMEOUT_MS, 10) || 45000,
    },

    // Konfigurasi REST API Paperless Document Control (DC)
    paperlessApi: {
        baseUrl: (process.env.PAPERLESS_API_BASE_URL || 'http://alpha_sna_medika_paperless.test/API/Dashboard/').trim().replace(/\/?$/, '/'),
        username: (process.env.PAPERLESS_API_USERNAME || 'ADMINDC@YOPMAIL.COM').trim(),
        password: (process.env.PAPERLESS_API_PASSWORD || '12345678').trim(),
        timeoutMs: 10000,
    },

    // Konfigurasi Google Spreadsheet Monitoring (Development / R&D)
    development: {
        spreadsheetUrl: (process.env.DEVELOPMENT_SPREADSHEET_URL || 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRtFe47B-ncyoQP_1X6ol4L0dvyp0b_z2GXroVTo5TSK-phM4CaLYhqqRPw6tCxPgNI_eoIgJJuhTiJ/pub?gid=0&single=true&output=csv').trim(),
        htmlUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRtFe47B-ncyoQP_1X6ol4L0dvyp0b_z2GXroVTo5TSK-phM4CaLYhqqRPw6tCxPgNI_eoIgJJuhTiJ/pubhtml?gid=0&single=true',
        timeoutMs: 15000,
    },

    // Cache internal Express (detik)
    cacheTtlSeconds: parseInt(process.env.CACHE_TTL_SECONDS, 10) || 5,

    // Interval auto-refresh data di frontend (detik)
    refreshIntervalSeconds: parseInt(process.env.REFRESH_INTERVAL_SECONDS, 10) || 15,
};
