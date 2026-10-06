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
    let isOperational = false;
    try {
        const ping = await ticketingService.ping();
        isOperational = ping?.status === 'online';
    } catch {
        isOperational = false;
    }

    res.json({
        status: isOperational ? 'operational' : 'degraded',
        uptime_seconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString()
    });
});

// Jalankan Server
app.listen(config.port, '0.0.0.0', async () => {
    console.log('====================================================');
    console.log('🚀 SNA MEDIKA - MANAGEMENT MONITORING DASHBOARD');
    console.log(`📡 URL Lokal     : http://localhost:${config.port}`);
    console.log(`📺 URL Layar TV   : http://localhost:${config.port}`);
    console.log(`🔗 API Ticketing : ${config.ticketing.baseUrl}`);
    console.log('----------------------------------------------------');
    console.log('⏳ Memeriksa status koneksi ke API Ticketing...');

    try {
        const startTime = Date.now();
        const ping = await ticketingService.ping();
        const duration = Date.now() - startTime;
        console.log('✅ [KONEKSI API BERHASIL]: Terhubung ke sistem Ticketing!');
        console.log(`   • Status Server : ${ping?.status || 'online'} (${ping?.system || 'Ticketing API Service'})`);
        console.log(`   • Kecepatan     : ${duration} ms`);
        console.log(`   • Waktu Server  : ${ping?.server_time || '-'}`);
    } catch (err) {
        console.error('❌ [KONEKSI API GAGAL]: Tidak dapat terhubung ke API Ticketing!');
        console.error(`   • Error         : ${err.message}`);
        console.warn('   • Tindakan      : Periksa TICKETING_API_URL & TICKETING_API_KEY di file .env');
    }
    console.log('====================================================');
});