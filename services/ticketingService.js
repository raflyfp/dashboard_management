/**
 * ====================================================================
 * SERVICE: TICKETING API CLIENT
 * ====================================================================
 * Bertanggung jawab khusus untuk komunikasi ke API Ticketing Laravel.
 * Terpisah dari logika Express agar mudah di-maintain dan di-test.
 * ====================================================================
 */

const axios = require('axios');
const config = require('../config/app.config');

// Normalisasi Base URL agar terhindar dari double slash (//) atau trailing slash
function normalizeBaseUrl(rawUrl) {
    if (!rawUrl) return '';
    try {
        const u = new URL(rawUrl.trim());
        u.pathname = u.pathname.replace(/\/+/g, '/').replace(/\/$/, '');
        return u.toString().replace(/\/$/, '');
    } catch {
        return rawUrl.trim().replace(/\/+$/, '');
    }
}

// Inisialisasi Axios instance dengan Base URL dan Header API Key
const apiClient = axios.create({
    baseURL: normalizeBaseUrl(config.ticketing.baseUrl),
    timeout: config.ticketing.timeoutMs,
    headers: {
        'Accept': 'application/json',
        'X-API-KEY': config.ticketing.apiKey,
    }
});

const ticketingService = {
    /**
     * Mengambil ringkasan statistik (summary) dari Laravel Ticketing
     */
    async getSummary() {
        const response = await apiClient.get('/monitoring/summary');
        if (!response.data || !response.data.success) {
            throw new Error(response.data?.message || 'Gagal mengambil summary dari sistem ticketing');
        }
        return response.data;
    },

    /**
     * Mengambil daftar tiket dengan filter spesifik
     * @param {Object} params - { service, status, limit }
     */
    async getTickets({ service, status, limit = 50 }) {
        // Normalisasi status jika dari frontend mengirim 'ditolak'
        let targetStatus = status;
        if (status === 'ditolak') targetStatus = 'rejected';

        const response = await apiClient.get('/monitoring/tickets', {
            params: {
                service: service || undefined,
                status: targetStatus || undefined,
                limit: Math.min(parseInt(limit, 10) || 50, 200)
            }
        });
        return response.data;
    },

    /**
     * Health check koneksi ke Laravel Ticketing
     */
    async ping() {
        const response = await apiClient.get('/ping', { timeout: 3000 });
        return response.data;
    }
};

module.exports = ticketingService;
