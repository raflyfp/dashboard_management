/**
 * ====================================================================
 * KONFIGURASI TERPUSAT APLIKASI DASHBOARD
 * ====================================================================
 * Mengambil nilai dari file .env dengan nilai fallback default.
 * Memudahkan programmer junior mengganti pengaturan di satu tempat.
 * ====================================================================
 */

require('dotenv').config();

module.exports = {
    // Port server Express
    port: parseInt(process.env.PORT, 10) || 3000,

    // Konfigurasi API Ticketing Laravel
    ticketing: {
        baseUrl: process.env.TICKETING_API_URL || 'http://127.0.0.1:8002/api/v1',
        apiKey: process.env.TICKETING_API_KEY || 'tk_live_UQ6LbgRmq2dSldzeTuSkZbAezAr1aDaV',
        timeoutMs: 8000,
    },

    // Cache internal Express (detik)
    cacheTtlSeconds: parseInt(process.env.CACHE_TTL_SECONDS, 10) || 5,

    // Interval auto-refresh data di frontend (detik)
    refreshIntervalSeconds: parseInt(process.env.REFRESH_INTERVAL_SECONDS, 10) || 15,
};
