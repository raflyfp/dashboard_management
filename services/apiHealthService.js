/**
 * ====================================================================
 * SERVICE: API HEALTH TRACKER (ATENA ERP, TICKETING, SUBCON)
 * ====================================================================
 * Melacak dan memonitor ketersediaan & latensi koneksi API eksternal:
 * 1. Atena ERP REST API (Produksi, Purchasing, QA, Logistik, Gudang, PBF)
 * 2. Helpdesk & Ticketing API (IT, Teknik, GA, HR)
 * 3. E-Subcon API (Pengerjaan Subcon)
 * ====================================================================
 */

const axios = require('axios');
const config = require('../config/app.config');

const healthState = {
    atena: {
        status: 'unknown', // 'online' | 'offline' | 'degraded'
        name: 'Atena ERP REST API',
        baseUrl: config.atenaApi.baseUrl,
        latencyMs: 0,
        httpStatus: null,
        lastChecked: null,
        lastOnline: null,
        message: 'Menunggu pemeriksaan awal...',
        consecutiveFailures: 0,
        services: {
            purchasing: { status: 'unknown', lastSync: null },
            produksi: { status: 'unknown', lastSync: null },
            qa: { status: 'unknown', lastSync: null },
            logistik: { status: 'unknown', lastSync: null },
            whFg: { status: 'unknown', lastSync: null },
            whMat: { status: 'unknown', lastSync: null },
            pbf: { status: 'unknown', lastSync: null },
            hr: { status: 'unknown', lastSync: null },
        }
    },
    ticketing: {
        status: 'unknown',
        name: 'Helpdesk & Ticketing API',
        url: config.ticketing.url,
        latencyMs: 0,
        lastChecked: null,
        lastOnline: null,
        message: 'Menunggu pemeriksaan awal...',
        consecutiveFailures: 0
    },
    paperless: {
        status: 'unknown',
        name: 'Paperless REST API (DC)',
        baseUrl: config.paperlessApi?.baseUrl || '',
        latencyMs: 0,
        httpStatus: null,
        lastChecked: null,
        lastOnline: null,
        message: 'Menunggu pemeriksaan awal...',
        consecutiveFailures: 0
    },
    subcon: {
        status: 'unknown',
        name: 'E-Subcon API',
        url: config.subcon.url,
        latencyMs: 0,
        lastChecked: null,
        lastOnline: null,
        message: 'Menunggu pemeriksaan awal...',
        consecutiveFailures: 0
    }
};

class ApiHealthService {
    /**
     * Ping aktif ke Atena ERP REST API (Auth/login)
     */
    /**
     * Ping aktif ke Paperless REST API (Auth/login)
     */
    async pingPaperless() {
        const start = Date.now();
        const loginUrl = `${config.paperlessApi?.baseUrl || ''}Auth/login`;

        try {
            const response = await axios.post(
                loginUrl,
                {
                    username: config.paperlessApi.username,
                    password: config.paperlessApi.password,
                },
                {
                    timeout: 8000,
                    headers: { 'Content-Type': 'application/json' }
                }
            );

            const latency = Date.now() - start;
            const isOk = response.status === 200 && (response.data?.success || response.data?.data?.token);

            healthState.paperless.status = isOk ? 'online' : 'degraded';
            healthState.paperless.latencyMs = latency;
            healthState.paperless.httpStatus = response.status;
            healthState.paperless.lastChecked = new Date().toISOString();
            if (isOk) {
                healthState.paperless.lastOnline = healthState.paperless.lastChecked;
                healthState.paperless.consecutiveFailures = 0;
                healthState.paperless.message = `Paperless REST API berjalan normal (${latency}ms)`;
            } else {
                healthState.paperless.message = response.data?.message || 'Respons tidak terduga dari Paperless API';
            }

            return {
                success: isOk,
                status: healthState.paperless.status,
                latencyMs: latency,
                httpStatus: response.status,
                message: healthState.paperless.message
            };
        } catch (error) {
            const latency = Date.now() - start;
            healthState.paperless.status = 'offline';
            healthState.paperless.latencyMs = latency;
            healthState.paperless.httpStatus = error.response?.status || null;
            healthState.paperless.lastChecked = new Date().toISOString();
            healthState.paperless.consecutiveFailures += 1;
            healthState.paperless.message = error.response?.data?.message || error.message || 'Tidak dapat terhubung ke Paperless API';

            return {
                success: false,
                status: 'offline',
                latencyMs: latency,
                httpStatus: error.response?.status || null,
                message: healthState.paperless.message
            };
        }
    }

    async pingAtena() {
        const start = Date.now();
        const loginUrl = `${config.atenaApi.baseUrl}Auth/login`;

        try {
            const response = await axios.post(
                loginUrl,
                {
                    username: config.atenaApi.username,
                    password: config.atenaApi.password,
                },
                {
                    timeout: 8000,
                    headers: { 'Content-Type': 'application/json' }
                }
            );

            const latency = Date.now() - start;
            const isOk = response.status === 200 && (response.data?.success || response.data?.data?.token);

            healthState.atena.status = isOk ? 'online' : 'degraded';
            healthState.atena.latencyMs = latency;
            healthState.atena.httpStatus = response.status;
            healthState.atena.lastChecked = new Date().toISOString();
            if (isOk) {
                healthState.atena.lastOnline = healthState.atena.lastChecked;
                healthState.atena.consecutiveFailures = 0;
                healthState.atena.message = `Atena ERP REST API berjalan normal (${latency}ms)`;
            } else {
                healthState.atena.message = response.data?.message || 'Respons tidak terduga dari Atena API';
            }

            return {
                success: isOk,
                status: healthState.atena.status,
                latencyMs: latency,
                httpStatus: response.status,
                message: healthState.atena.message
            };
        } catch (error) {
            const latency = Date.now() - start;
            healthState.atena.status = 'offline';
            healthState.atena.latencyMs = latency;
            healthState.atena.httpStatus = error.response?.status || null;
            healthState.atena.lastChecked = new Date().toISOString();
            healthState.atena.consecutiveFailures += 1;
            healthState.atena.message = error.response?.data?.message || error.message || 'Tidak dapat terhubung ke Atena ERP';

            return {
                success: false,
                status: 'offline',
                latencyMs: latency,
                httpStatus: error.response?.status || null,
                message: healthState.atena.message
            };
        }
    }

    /**
     * Ping aktif ke Ticketing API
     */
    async pingTicketing() {
        const start = Date.now();
        try {
            const ticketingService = require('./ticketingService');
            const res = await ticketingService.ping();
            const latency = Date.now() - start;

            healthState.ticketing.status = 'online';
            healthState.ticketing.latencyMs = latency;
            healthState.ticketing.lastChecked = new Date().toISOString();
            healthState.ticketing.lastOnline = healthState.ticketing.lastChecked;
            healthState.ticketing.consecutiveFailures = 0;
            healthState.ticketing.message = `Ticketing API terhubung normal (${latency}ms)`;

            return { success: true, status: 'online', latencyMs: latency };
        } catch (error) {
            const latency = Date.now() - start;
            healthState.ticketing.status = 'offline';
            healthState.ticketing.latencyMs = latency;
            healthState.ticketing.lastChecked = new Date().toISOString();
            healthState.ticketing.consecutiveFailures += 1;
            healthState.ticketing.message = error.message || 'Gagal terhubung ke Ticketing API';

            return { success: false, status: 'offline', latencyMs: latency, message: error.message };
        }
    }

    /**
     * Ping aktif ke Subcon API
     */
    async pingSubcon() {
        const start = Date.now();
        try {
            const subconService = require('./subconService');
            const res = await subconService.ping();
            const latency = Date.now() - start;

            healthState.subcon.status = 'online';
            healthState.subcon.latencyMs = latency;
            healthState.subcon.lastChecked = new Date().toISOString();
            healthState.subcon.lastOnline = healthState.subcon.lastChecked;
            healthState.subcon.consecutiveFailures = 0;
            healthState.subcon.message = `E-Subcon API terhubung normal (${latency}ms)`;

            return { success: true, status: 'online', latencyMs: latency };
        } catch (error) {
            const latency = Date.now() - start;
            healthState.subcon.status = 'offline';
            healthState.subcon.latencyMs = latency;
            healthState.subcon.lastChecked = new Date().toISOString();
            healthState.subcon.consecutiveFailures += 1;
            healthState.subcon.message = error.message || 'Gagal terhubung ke Subcon API';

            return { success: false, status: 'offline', latencyMs: latency, message: error.message };
        }
    }

    /**
     * Jalankan pemeriksaan ke seluruh API eksternal secara paralel
     */
    async pingAll() {
        const [atenaRes, ticketingRes, subconRes] = await Promise.allSettled([
            this.pingAtena(),
            this.pingTicketing(),
            this.pingSubcon()
        ]);

        return this.getStatusSummary();
    }

    /**
     * Catat hasil pemanggilan dari modul/service spesifik (Purchasing, Produksi, QA, dll)
     * Ini memperbarui status Atena secara otomatis dan live setiap kali ada request data!
     */
    updateModuleStatus(moduleKey, isSuccess, latencyMs = 0, errorMsg = null) {
        const now = new Date().toISOString();

        if (healthState.atena.services[moduleKey]) {
            healthState.atena.services[moduleKey] = {
                status: isSuccess ? 'online' : 'offline',
                lastSync: now,
                latencyMs,
                error: errorMsg || null
            };
        }

        // Jika salah satu modul Atena sukses mengambil data live, berarti Atena API online!
        if (isSuccess) {
            healthState.atena.status = 'online';
            healthState.atena.lastOnline = now;
            healthState.atena.lastChecked = now;
            healthState.atena.consecutiveFailures = 0;
            if (latencyMs > 0) {
                healthState.atena.latencyMs = latencyMs;
            }
            healthState.atena.message = 'Atena ERP REST API berjalan normal';
        }
    }

    /**
     * Ambil ringkasan status seluruh API untuk response frontend
     */
    getStatusSummary() {
        const now = new Date();
        const atenaOnline = healthState.atena.status === 'online';

        return {
            timestamp: now.toISOString(),
            overall: atenaOnline ? 'healthy' : 'degraded',
            atena: {
                status: healthState.atena.status,
                name: healthState.atena.name,
                url: healthState.atena.baseUrl,
                latency_ms: healthState.atena.latencyMs,
                http_status: healthState.atena.httpStatus,
                last_checked: healthState.atena.lastChecked,
                last_online: healthState.atena.lastOnline,
                message: healthState.atena.message,
                consecutive_failures: healthState.atena.consecutiveFailures,
                services: healthState.atena.services
            },
            ticketing: {
                status: healthState.ticketing.status,
                name: healthState.ticketing.name,
                latency_ms: healthState.ticketing.latencyMs,
                last_checked: healthState.ticketing.lastChecked,
                last_online: healthState.ticketing.lastOnline,
                message: healthState.ticketing.message
            },
            subcon: {
                status: healthState.subcon.status,
                name: healthState.subcon.name,
                latency_ms: healthState.subcon.latencyMs,
                last_checked: healthState.subcon.lastChecked,
                last_online: healthState.subcon.lastOnline,
                message: healthState.subcon.message
            }
        };
    }
}

const apiHealthService = new ApiHealthService();
module.exports = apiHealthService;

