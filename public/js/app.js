/**
 * ====================================================================
 * MANAGEMENT MONITORING DASHBOARD - FRONTEND JAVASCRIPT
 * ====================================================================
 * Fungsi Utama:
 * 1. Menjalankan Jam Digital & Tanggal Live (WIB).
 * 2. Auto-polling data dari Express API (/api/dashboard/stats) setiap 15 detik.
 * 3. Animasi Circular Progress Gauge & Counter Angka yang halus.
 * 4. Running Ticker untuk tiket darurat yang butuh perhatian manajemen.
 * 5. Modal interaktif untuk melihat daftar detail tiket per layanan (IT, Teknik, GA).
 * 6. Fitur Fullscreen untuk display Layar TV Kantor / Ruang Manajemen.
 * 
 * Ditulis dengan Vanilla JS (Standar Industri, Cepat, Tanpa Beban Library Berat).
 * ====================================================================
 */

// Keliling lingkaran progress ring (r=40 -> 2 * PI * 40 = 251.32)
const RING_CIRCUMFERENCE = 251.32;

// Konfigurasi State Aplikasi
const state = {
    refreshInterval: 15,    // Interval refresh bawaan (detik)
    countdownTimer: 15,     // Hitung mundur detik
    timerId: null,          // Referensi interval timer
    isFetching: false,      // Penanda sedang memuat
    currentServiceModal: null, // Layanan yang sedang dibuka di modal
    currentModalFilter: 'all',  // Filter di modal: all / selesai / belum / ditolak
    modalRawTickets: [],    // Data mentah tiket yang sedang dibuka
    servicesData: null,     // Cache data statistik 10 layanan terakhir
};

// ====================================================================
// 1. INISIALISASI SAAT HALAMAN SELESAI DIMUAT
// ====================================================================
document.addEventListener('DOMContentLoaded', () => {
    initClock();
    initEventListeners();
    fetchDashboardStats();
    startAutoRefresh();
});

// ====================================================================
// 2. JAM DIGITAL & TANGGAL (WAKTU INDONESIA)
// ====================================================================
function initClock() {
    const clockEl = document.getElementById('digitalClock');
    const dateEl = document.getElementById('digitalDate');

    function updateTime() {
        const now = new Date();

        // Format Waktu: HH:MM:SS WIB
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        clockEl.textContent = `${hours}:${minutes}:${seconds} WIB`;

        // Format Hari dan Tanggal Bahasa Indonesia
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        dateEl.textContent = now.toLocaleDateString('id-ID', options);
    }

    updateTime();
    setInterval(updateTime, 1000);
}

// ====================================================================
// 3. EVENT LISTENERS UNTUK TOMBOL-TOMBOL KONTROL
// ====================================================================
function initEventListeners() {
    // Tombol Manual Refresh
    const btnRefresh = document.getElementById('btnRefresh');
    if (btnRefresh) {
        btnRefresh.addEventListener('click', () => {
            fetchDashboardStats(true);
        });
    }

    // Tombol Fullscreen Layar TV
    const btnFullscreen = document.getElementById('btnFullscreen');
    if (btnFullscreen) {
        btnFullscreen.addEventListener('click', toggleFullscreen);
    }

    // Menutup Modal dengan Tombol Escape di Keyboard
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeTicketModal();
            closeAppModal();
        }
    });

    // Menutup Modal jika mengklik area gelap luar
    const modalOverlay = document.getElementById('ticketModal');
    if (modalOverlay) {
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) {
                closeTicketModal();
            }
        });
    }

    const appModalOverlay = document.getElementById('appModal');
    if (appModalOverlay) {
        appModalOverlay.addEventListener('click', (e) => {
            if (e.target === appModalOverlay) {
                closeAppModal();
            }
        });
    }
}

// ====================================================================
// 4. LOGIKA AUTO-REFRESH & HITUNG MUNDUR (COUNTDOWN)
// ====================================================================
function startAutoRefresh() {
    if (state.timerId) clearInterval(state.timerId);

    state.countdownTimer = state.refreshInterval;
    updateCountdownUI();

    state.timerId = setInterval(() => {
        state.countdownTimer--;
        updateCountdownUI();

        if (state.countdownTimer <= 0) {
            state.countdownTimer = state.refreshInterval;
            fetchDashboardStats();
        }
    }, 1000);
}

function updateCountdownUI() {
    const timerEl = document.getElementById('refreshTimer');
    if (timerEl) {
        timerEl.textContent = `${state.countdownTimer}s`;
    }
}

// ====================================================================
// 5. MENGAMBIL DATA DARI EXPRESS API (/api/dashboard/stats)
// ====================================================================
async function fetchDashboardStats(force = false) {
    if (state.isFetching) return;
    state.isFetching = true;

    const refreshIcon = document.getElementById('refreshIcon');
    if (refreshIcon) refreshIcon.classList.add('fa-spin');

    try {
        const url = `/api/dashboard/stats${force ? '?force=true' : ''}`;
        const response = await fetch(url);
        const data = await response.json();

        if (!data.success) {
            throw new Error(data.message || 'Gagal memuat data dari server');
        }

        // Simpan data layanan ke state lokal
        state.servicesData = data.layanan;

        // Render Data ke Tampilan
        renderGlobalKPI(data.kpi_global);
        renderServiceCards(data.layanan);
        renderAttentionTicker(data.perlu_perhatian);
        updateSystemStatus(true, data._cached ? 'Cached' : 'Live Sync');

        // Reset hitung mundur setelah fetch manual
        state.countdownTimer = state.refreshInterval;
        updateCountdownUI();

    } catch (error) {
        console.error('Error saat fetch dashboard stats:', error);
        updateSystemStatus(false, 'Gagal Sinkronisasi');
    } finally {
        state.isFetching = false;
        if (refreshIcon) {
            setTimeout(() => refreshIcon.classList.remove('fa-spin'), 600);
        }
    }
}

// ====================================================================
// 6. RENDER GLOBAL KPI (HEADER ATAS)
// ====================================================================
function renderGlobalKPI(kpi) {
    if (!kpi) return;

    animateCounter('globalTotalTickets', kpi.total_tiket);
    animateCounter('globalCompletedTickets', kpi.total_selesai);
    animateCounter('globalPendingTickets', kpi.total_belum_selesai);
    
    const percentEl = document.getElementById('globalPercentage');
    if (percentEl) {
        percentEl.textContent = `${kpi.persentase_selesai}%`;
    }
}

// ====================================================================
// 7. RENDER 3 KARTU UTAMA (IT, TEKNIK, GA)
// ====================================================================
function renderServiceCards(layanan) {
    if (!layanan) return;

    // Daftar 10 Modul Layanan (5 Baris Atas, 5 Baris Bawah)
    const services = ['IT', 'TK', 'GA', 'KAIZEN', 'ESYS', 'SIMRS', 'FARMASI', 'LAB', 'BILLING', 'SDM'];

    services.forEach(code => {
        const item = layanan[code];
        if (!item) return;

        // 1. Angka 3 Metrik Inti
        animateCounter(`total${code}`, item.total_tiket);
        animateCounter(`selesai${code}`, item.selesai);
        animateCounter(`belum${code}`, item.belum_selesai);

        // Keterangan Tambahan: Ditolak & Total Tiket Valid yang Diproses
        const ditolakEl = document.getElementById(`ditolak${code}`);
        if (ditolakEl) {
            ditolakEl.textContent = `${item.ditolak || 0} ditolak`;
            ditolakEl.style.display = item.ditolak > 0 ? 'inline-block' : 'none';
        }

        const efektifEl = document.getElementById(`efektif${code}`);
        if (efektifEl) {
            efektifEl.textContent = `/ ${item.total_efektif || item.total_tiket} valid`;
        }

        // 2. Persentase & Progress Bar Fill
        const percent = item.persentase_selesai || 0;
        const percentEl = document.getElementById(`percent${code}`);
        if (percentEl) {
            percentEl.textContent = `${percent}%`;
        }

        // Update lebar progress bar di bawah angka persentase
        const barFill = document.getElementById(`barFill${code}`);
        if (barFill) {
            barFill.style.width = `${percent}%`;
        }
    });
}

// ====================================================================
// 8. RENDER RUNNING TICKER PERHATIAN MANAJEMEN
// ====================================================================
function renderAttentionTicker(tickets) {
    const listEl = document.getElementById('tickerList');
    if (!listEl) return;

    if (!tickets || tickets.length === 0) {
        listEl.innerHTML = `
            <span class="ticker-item">
                <i class="fa-solid fa-circle-check" style="color: #34d399;"></i> 
                Semua layanan beroperasi lancar. Tidak ada tiket darurat yang pending lama saat ini.
            </span>
        `;
        return;
    }

    // Bangun elemen berjalan (marquee ticker)
    const itemsHtml = tickets.map(t => {
        const tagClass = `tag-${t.service.toLowerCase()}`;
        const jamDurasi = Math.floor(t.durasi_menit / 60);
        const menitSisa = t.durasi_menit % 60;
        const waktuTeks = jamDurasi > 0 ? `${jamDurasi} jam ${menitSisa} mnt` : `${menitSisa} mnt`;

        return `
            <span class="ticker-item">
                <span class="tag ${tagClass}">${t.service}</span>
                <b>[${t.no_tiket}]</b> 
                <span>${escapeHtml(t.judul)}</span>
                <span style="color: #f87171;"><i class="fa-regular fa-clock"></i> Menggantung: ${waktuTeks}</span>
                <span style="color: #94a3b8;">Pelapor: ${escapeHtml(t.pelapor)}</span>
            </span>
        `;
    }).join(' &bull; ');

    // Gandakan konten agar animasi marquee meluncur mulus tanpa terputus
    listEl.innerHTML = itemsHtml + ' &bull; ' + itemsHtml;
}

// ====================================================================
// 9. STATUS KONEKSI SISTEM
// ====================================================================
function updateSystemStatus(isOnline, label) {
    const badge = document.getElementById('systemStatusBadge');
    if (!badge) return;

    if (isOnline) {
        badge.innerHTML = `<i class="fa-solid fa-circle-nodes"></i> API Online (${label})`;
        badge.style.color = '#34d399';
        badge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
    } else {
        badge.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> API Terputus (${label})`;
        badge.style.color = '#f87171';
        badge.style.borderColor = 'rgba(239, 68, 68, 0.3)';
    }
}

// ====================================================================
// 10. MODAL DAFTAR SEMUA TIKET PER LAYANAN
// ====================================================================
async function openTicketModal(serviceCode, serviceTitle) {
    state.currentServiceModal = serviceCode;
    state.currentModalFilter = 'all';

    const modal = document.getElementById('ticketModal');
    const titleEl = document.getElementById('modalServiceTitle');
    const subEl = document.getElementById('modalServiceSubtitle');
    const iconEl = document.getElementById('modalServiceIcon');
    const searchInput = document.getElementById('ticketSearchInput');
    const ditolakCountEl = document.getElementById('modalDitolakCount');

    // Ambil data statistik layanan dari memori
    const sData = (state.servicesData && state.servicesData[serviceCode]) || {};
    const totalTiket = sData.total_tiket || 0;
    const selesaiTiket = sData.selesai || 0;
    const belumTiket = sData.belum_selesai || 0;
    const ditolakTiket = sData.ditolak || 0;
    const efektifTiket = sData.total_efektif || Math.max(0, totalTiket - ditolakTiket);
    const persentase = sData.persentase_selesai || 0;

    if (titleEl) titleEl.textContent = `${serviceTitle}`;
    if (subEl) {
        subEl.innerHTML = `Total: <b>${totalTiket}</b> &bull; Diproses: <b>${efektifTiket}</b> (Selesai: <span style="color:#10b981; font-weight:700;">${selesaiTiket}</span> [${persentase}%], Belum: <span style="color:#f59e0b; font-weight:700;">${belumTiket}</span>) &bull; Ditolak: <span style="color:#ef4444; font-weight:700;">${ditolakTiket}</span>`;
    }

    if (ditolakCountEl) {
        ditolakCountEl.textContent = ditolakTiket;
    }

    if (searchInput) searchInput.value = '';

    // Reset tombol filter aktif ke 'all'
    document.querySelectorAll('.filter-pill').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-filter') === 'all');
    });

    // Sesuaikan icon modal
    if (iconEl) {
        if (serviceCode === 'IT') iconEl.innerHTML = '<i class="fa-solid fa-laptop-code" style="color: #0f5ca8;"></i>';
        else if (serviceCode === 'TK') iconEl.innerHTML = '<i class="fa-solid fa-screwdriver-wrench" style="color: #d97706;"></i>';
        else if (serviceCode === 'GA') iconEl.innerHTML = '<i class="fa-solid fa-building-user" style="color: #10b981;"></i>';
    }

    if (modal) modal.classList.add('active');

    // Tampilkan status loading di tabel
    renderTicketTableLoading();

    // Fetch daftar tiket spesifik untuk layanan ini
    await loadModalTickets(serviceCode, 'all');
}

async function loadModalTickets(serviceCode, filterStatus) {
    try {
        // Parameter status ke Express
        let queryStatus = 'all';
        if (filterStatus === 'selesai') queryStatus = 'selesai';
        if (filterStatus === 'belum') queryStatus = 'belum';
        if (filterStatus === 'ditolak') queryStatus = 'ditolak';

        const url = `/api/dashboard/tickets?service=${serviceCode}&status=${queryStatus}&limit=100`;
        const response = await fetch(url);
        const json = await response.json();

        if (!json.success) {
            throw new Error(json.message || 'Gagal memuat tiket');
        }

        state.modalRawTickets = json.data || [];
        renderTicketsTable(state.modalRawTickets);

    } catch (error) {
        console.error('Error saat load modal tickets:', error);
        renderTicketTableError(error.message);
    }
}

function filterModalTickets(filterType) {
    state.currentModalFilter = filterType;

    // Update class active pada tab pills
    document.querySelectorAll('.filter-pill').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-filter') === filterType);
    });

    if (state.currentServiceModal) {
        renderTicketTableLoading();
        loadModalTickets(state.currentServiceModal, filterType);
    }
}

function handleSearchTickets(keyword) {
    const term = keyword.trim().toLowerCase();
    if (!term) {
        renderTicketsTable(state.modalRawTickets);
        return;
    }

    const filtered = state.modalRawTickets.filter(t => {
        const noTiket = (t.no_tiket || '').toLowerCase();
        const judul = (t.judul || '').toLowerCase();
        const pelapor = (t.pelapor || '').toLowerCase();
        const petugas = (t.petugas || '').toLowerCase();
        return noTiket.includes(term) || judul.includes(term) || pelapor.includes(term) || petugas.includes(term);
    });

    renderTicketsTable(filtered);
}

function renderTicketsTable(tickets) {
    const tbody = document.getElementById('ticketsTableBody');
    const statsText = document.getElementById('modalStatsText');

    if (statsText) {
        statsText.textContent = `Menampilkan ${tickets.length} tiket`;
    }

    if (!tbody) return;

    if (!tickets || tickets.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="empty-state">
                    <i class="fa-regular fa-folder-open" style="font-size: 2rem; margin-bottom: 0.5rem; display: block;"></i>
                    Tidak ada tiket yang cocok dengan kriteria filter saat ini.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = tickets.map(t => {
        const badgeInfo = getStatusBadge(t.status, t.status_label);

        // Aturan: Jika kategori belum diisi atau 'biasa' -> tampilkan strip '-'
        const rawKat = (t.kategori || '').trim();
        const isBiasaOrEmpty = !rawKat || rawKat.toLowerCase() === 'biasa' || rawKat === '-';
        const kategoriBadge = !isBiasaOrEmpty 
            ? `<span class="badge-kategori">${escapeHtml(rawKat)}</span>` 
            : `<span class="kategori-dash">-</span>`;

        const tgl = t.tanggal || t.created_at || '-';

        return `
            <tr>
                <td><span class="ticket-number">${escapeHtml(t.no_tiket)}</span></td>
                <td style="max-width: 280px; font-weight: 500;">${escapeHtml(t.judul)}</td>
                <td>${kategoriBadge}</td>
                <td>${escapeHtml(t.pelapor || 'Anonim')}</td>
                <td>${escapeHtml(t.petugas || 'Belum ditugaskan')}</td>
                <td><span class="badge-status ${badgeInfo.cssClass}">${badgeInfo.label}</span></td>
                <td style="color: var(--text-muted); font-size: 0.8rem;">${tgl}</td>
            </tr>
        `;
    }).join('');
}

function renderTicketTableLoading() {
    const tbody = document.getElementById('ticketsTableBody');
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="loading-state">
                    <i class="fa-solid fa-circle-notch fa-spin"></i> Memuat data tiket dari sistem...
                </td>
            </tr>
        `;
    }
}

function renderTicketTableError(msg) {
    const tbody = document.getElementById('ticketsTableBody');
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="loading-state" style="color: #f87171;">
                    <i class="fa-solid fa-circle-exclamation"></i> Terjadi kesalahan: ${escapeHtml(msg)}
                </td>
            </tr>
        `;
    }
}

function closeTicketModal() {
    const modal = document.getElementById('ticketModal');
    if (modal) modal.classList.remove('active');
    state.currentServiceModal = null;
}

// Helper Label dan Warna Badge Status Tiket
function getStatusBadge(status, customLabel) {
    const s = (status || '').toLowerCase();
    if (s === 'closed' || s === 'done') {
        return { label: customLabel || 'Selesai', cssClass: 'badge-closed' };
    }
    if (s === 'rejected' || s === 'ditolak') {
        return { label: customLabel || 'Ditolak', cssClass: 'badge-rejected' };
    }
    if (s === 'open') {
        return { label: customLabel || 'Open', cssClass: 'badge-open' };
    }
    if (s === 'in_progress') {
        return { label: customLabel || 'Dikerjakan', cssClass: 'badge-progress' };
    }
    if (s === 'checking') {
        return { label: customLabel || 'Pemeriksaan', cssClass: 'badge-checking' };
    }
    if (s === 'draft') {
        return { label: customLabel || 'Draft', cssClass: 'badge-draft' };
    }
    if (s === 'pending_approval' || s === 'reported') {
        return { label: customLabel || 'Menunggu', cssClass: 'badge-pending' };
    }
    return { label: customLabel || s, cssClass: 'badge-draft' };
}

// ====================================================================
// 11. MODE FULLSCREEN (LAYAR TV BESAR)
// ====================================================================
function toggleFullscreen() {
    const fsIcon = document.getElementById('fullscreenIcon');

    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().then(() => {
            if (fsIcon) {
                fsIcon.classList.remove('fa-expand');
                fsIcon.classList.add('fa-compress');
            }
        }).catch(err => {
            console.warn('Fullscreen tidak diizinkan oleh browser:', err.message);
        });
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen().then(() => {
                if (fsIcon) {
                    fsIcon.classList.remove('fa-compress');
                    fsIcon.classList.add('fa-expand');
                }
            });
        }
    }
}

// ====================================================================
// 12. UTILITY: ANIMASI COUNTER ANGKA & ESCAPE HTML
// ====================================================================
function animateCounter(elementId, targetValue, duration = 800) {
    const el = document.getElementById(elementId);
    if (!el) return;

    const start = parseInt(el.textContent.replace(/[^0-9]/g, ''), 10) || 0;
    const end = parseInt(targetValue, 10) || 0;

    if (start === end) {
        el.textContent = end.toLocaleString('id-ID');
        return;
    }

    const range = end - start;
    const startTime = performance.now();

    function step(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // Easing fungsi easeOutQuad
        const easeProgress = progress * (2 - progress);
        const current = Math.floor(start + range * easeProgress);

        el.textContent = current.toLocaleString('id-ID');

        if (progress < 1) {
            requestAnimationFrame(step);
        } else {
            el.textContent = end.toLocaleString('id-ID');
        }
    }

    requestAnimationFrame(step);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ====================================================================
// 13. MODAL INFORMASI MODUL EKSTERNAL
// ====================================================================
function openAppModal(title, desc) {
    const modal = document.getElementById('appModal');
    const titleEl = document.getElementById('appModalTitle');
    const descEl = document.getElementById('appModalDesc');
    if (titleEl) titleEl.textContent = title;
    if (descEl) descEl.textContent = desc;
    if (modal) modal.classList.add('active');
}

function closeAppModal() {
    const modal = document.getElementById('appModal');
    if (modal) modal.classList.remove('active');
}

