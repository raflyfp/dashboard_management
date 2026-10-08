/**
 * ====================================================================
 * MANAGEMENT MONITORING DASHBOARD - SERVER UTAMA (EXPRESS.JS)
 * ====================================================================
 * Entry point aplikasi. Dibuat bersih, modular, dan terstruktur rapi:
 * - config/          : File konfigurasi (.env)
 * - services/        : Client penghubung ke API sistem lain
 * - routes/          : Routing API Dashboard
 * - public/          : Tampilan antarmuka web (HTML, CSS, JS)
 * ====================================================================
 */

const express = require('express');
const path = require('path');
const config = require('./config/app.config');
const dashboardRoutes = require('./routes/dashboardRoutes');
const ticketingService = require('./services/ticketingService');
const subconService = require('./services/subconService');

const app = express();

// Middleware parsing JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Nonaktifkan cache browser untuk file statis di mode development
// Agar saat HTML/CSS/JS diubah, perubahannya LANGSUNG muncul di browser tanpa tertahan cache!
app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
});

// Sajikan folder public/ untuk file statis
app.use(express.static(path.join(__dirname, 'public'), {
    etag: false,
    maxAge: 0
}));

// Pasang rute API Dashboard
app.use('/api/dashboard', dashboardRoutes);

// Health check endpoint (General System Status)
app.get('/api/health', async (req, res) => {
    let ticketingOk = false;
    let subconOk = false;

    try {
        const pingTicket = await ticketingService.ping();
        ticketingOk = pingTicket?.status === 'online';
    } catch {
        ticketingOk = false;
    }

    try {
        const pingSubcon = await subconService.ping();
        subconOk = pingSubcon?.status === 'online';
    } catch {
        subconOk = false;
    }

    const isOperational = ticketingOk && subconOk;
    const isDegraded = ticketingOk || subconOk;

    res.json({
        status: isOperational ? 'operational' : (isDegraded ? 'partially_degraded' : 'degraded'),
        services: {
            ticketing: ticketingOk ? 'online' : 'offline',
            subcon: subconOk ? 'online' : 'offline',
        },
        uptime_seconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString()
    });
});

// Jalankan Server
app.listen(config.port, '0.0.0.0', async () => {
    console.log('====================================================');
    console.log('🚀 SNA MEDIKA - MANAGEMENT MONITORING DASHBOARD');
    console.log(`📡 URL Lokal     : http://localhost:${config.port}`);
    console.log(`🔗 API Ticketing : ${config.ticketing.url ? 'Terkonfigurasi' : 'Belum diisi'}`);
    console.log(`🔗 API Subcon    : ${config.subcon.url ? 'Terkonfigurasi' : 'Belum diisi'}`);
    console.log('----------------------------------------------------');
    console.log('⏳ Memeriksa status koneksi ke API Eksternal...');

    try {
        const startTime = Date.now();
        const ping = await ticketingService.ping();
        const duration = Date.now() - startTime;
        console.log('✅ [API TICKETING BERHASIL]: Terhubung ke sistem Ticketing!');
        console.log(`   • Status Server : ${ping?.status || 'online'} (${ping?.system || 'Ticketing API Service'})`);
        console.log(`   • Kecepatan     : ${duration} ms`);
    } catch (err) {
        console.error('❌ [API TICKETING GAGAL]: Tidak dapat terhubung ke API Ticketing!');
        console.error(`   • Error         : ${err.message}`);
    }

    try {
        const startTimeSubcon = Date.now();
        const pingSubcon = await subconService.ping();
        const durationSubcon = Date.now() - startTimeSubcon;
        console.log('✅ [API SUBCON BERHASIL]: Terhubung ke sistem E-Subcon!');
        console.log(`   • Kecepatan     : ${durationSubcon} ms`);
    } catch (err) {
        console.error('❌ [API SUBCON GAGAL]: Tidak dapat terhubung ke API Subcon!');
        console.error(`   • Error         : ${err.message}`);
    }
    console.log('====================================================');
});