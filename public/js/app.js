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
    currentServiceModal: null, // Layanan yang sedang dibuka di modal tiket
    currentModalFilter: 'all',  // Filter di modal: all / selesai / belum / ditolak
    modalRawTickets: [],    // Data mentah tiket yang sedang dibuka
    servicesData: null,     // Cache data statistik 10 layanan terakhir

    // State Khusus Modul Pengerjaan Subcon
    subconChartInstance: null,
    currentSubconRange: 'today',
    currentSubconTab: 'barang',
    subconRawData: null,
    subconSearchQuery: '',
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
            closeSubconModal();
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

    const subconModalOverlay = document.getElementById('subconModal');
    if (subconModalOverlay) {
        subconModalOverlay.addEventListener('click', (e) => {
            if (e.target === subconModalOverlay) {
                closeSubconModal();
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
        updateSystemStatus(true, Boolean(data._cached));

        // Reset hitung mundur setelah fetch manual
        state.countdownTimer = state.refreshInterval;
        updateCountdownUI();

    } catch (error) {
        console.error('Error saat fetch dashboard stats:', error);
        updateSystemStatus(false);
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
// 7. RENDER KARTU MONITORING (IT, TEKNIK, GA, SUBCON, DLL)
// ====================================================================
function renderServiceCards(layanan) {
    if (!layanan) return;

    // Daftar 10 Modul Layanan (5 Baris Atas, 5 Baris Bawah)
    const services = ['IT', 'TK', 'GA', 'SUBCON', 'ESYS', 'SIMRS', 'FARMASI', 'LAB', 'BILLING', 'SDM'];

    services.forEach(code => {
        const item = layanan[code];
        if (!item) return;

        // Penanganan Khusus Modul Pengerjaan Subcon (Hasil Produksi PCS)
        if (code === 'SUBCON') {
            animateCounter('totalPcsSUBCON', item.total_output_pcs || 0);

            const subconEl = document.getElementById('subconJumlahSubcon') || document.getElementById('subconJumlahMitra');
            if (subconEl) {
                const totalSubcon = item.total_subcon || 1;
                subconEl.textContent = `${totalSubcon}`;
            }

            const karyawanEl = document.getElementById('subconJumlahKaryawan');
            if (karyawanEl) {
                const totalKaryawan = item.total_karyawan || 0;
                karyawanEl.textContent = `${totalKaryawan}`;
            }

            const durasiEl = document.getElementById('subconDurasi');
            if (durasiEl) durasiEl.textContent = item.total_durasi || '0 Jam';
            return;
        }

        // 1. Angka 3 Metrik Inti (Modul Berbasis Tiket)
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
// 9. STATUS KONEKSI SISTEM (OPERATIONAL STATUS)
// ====================================================================
function updateSystemStatus(isOnline, isCached = false) {
    const badge = document.getElementById('systemStatusBadge');
    if (!badge) return;

    badge.style.color = '';
    badge.style.borderColor = '';

    if (isOnline) {
        badge.className = 'status-badge';
        const label = isCached ? 'Sistem Normal (Sync)' : 'Sistem Operasional';
        badge.innerHTML = `<span class="status-dot"></span> ${label}`;
    } else {
        badge.className = 'status-badge status-offline';
        badge.innerHTML = `<span class="status-dot"></span> Terputus`;
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

// ====================================================================
// 14. MODAL MONITORING PENGERJAAN SUBCON & GRAFIK TREN
// ====================================================================

/**
 * Membuka Modal Monitoring Pengerjaan Subcon
 */
function openSubconModal(range = 'today') {
    const modal = document.getElementById('subconModal');
    if (!modal) return;

    modal.classList.add('active');
    state.subconSearchQuery = '';

    const searchInput = document.getElementById('subconSearchInput');
    if (searchInput) searchInput.value = '';

    switchSubconRange(range);
}

/**
 * Menutup Modal Subcon
 */
function closeSubconModal() {
    const modal = document.getElementById('subconModal');
    if (modal) modal.classList.remove('active');

    // Hancurkan instance chart jika modal ditutup agar hemat memory
    if (state.subconChartInstance) {
        state.subconChartInstance.destroy();
        state.subconChartInstance = null;
    }
}

/**
 * Mengganti Rentang Waktu (Hari Ini / 7 Hari Terakhir / 30 Hari Terakhir)
 */
async function switchSubconRange(range) {
    state.currentSubconRange = range;

    // Update tampilan tombol range
    const btnToday = document.getElementById('btnRangeToday');
    const btnWeek = document.getElementById('btnRangeWeek');
    const btnMonth = document.getElementById('btnRangeMonth');

    if (btnToday) btnToday.classList.toggle('active', range === 'today');
    if (btnWeek) btnWeek.classList.toggle('active', range === 'week');
    if (btnMonth) btnMonth.classList.toggle('active', range === 'month');

    // Tampilkan state loading di tabel
    renderSubconTablesLoading();

    try {
        const response = await fetch(`/api/dashboard/subcon?range=${range}`);
        const result = await response.json();

        if (!result.success) {
            throw new Error(result.message || 'Gagal mengambil data monitoring subcon');
        }

        state.subconRawData = result.data;
        renderSubconModalData(result.data);

    } catch (err) {
        console.error('Error memuat data subcon:', err);
        renderSubconTablesError(err.message);
    }
}

/**
 * Mengganti Tab Konten Detail (Pengerjaan Barang / Tracking Karyawan / Mitra Subcon / Riwayat)
 */
function switchSubconTab(tab) {
    state.currentSubconTab = tab;

    // Update active state tab buttons
    const tabBtns = {
        barang: document.getElementById('tabBtnBarang'),
        karyawan: document.getElementById('tabBtnKaryawan'),
        subcon: document.getElementById('tabBtnSubcon'),
        riwayat: document.getElementById('tabBtnRiwayat'),
    };

    Object.keys(tabBtns).forEach(k => {
        if (tabBtns[k]) tabBtns[k].classList.toggle('active', k === tab);
    });

    // Update active state tab panels
    const tabPanels = {
        barang: document.getElementById('tabPanelBarang'),
        karyawan: document.getElementById('tabPanelKaryawan'),
        subcon: document.getElementById('tabPanelSubcon'),
        riwayat: document.getElementById('tabPanelRiwayat'),
    };

    Object.keys(tabPanels).forEach(k => {
        if (tabPanels[k]) tabPanels[k].classList.toggle('active', k === tab);
    });
}

/**
 * Filter Pencarian Instan (Live Search)
 */
function handleSubconSearch(query) {
    state.subconSearchQuery = (query || '').trim().toLowerCase();
    if (!state.subconRawData) return;

    renderSubconFilteredTables();
}

/**
 * Render Seluruh Komponen Modal Subcon (KPI, Chart, Tabel)
 */
function renderSubconModalData(data) {
    if (!data) return;

    // 1. Render 4 KPI Mini
    const kpi = data.kpi || {};
    const totalPcsEl = document.getElementById('modalKpiTotalPcs');
    if (totalPcsEl) totalPcsEl.textContent = Number(kpi.total_output_pcs || 0).toLocaleString('id-ID');

    const totalDurasiEl = document.getElementById('modalKpiTotalDurasi');
    if (totalDurasiEl) totalDurasiEl.textContent = kpi.total_durasi_formatted || '0 Menit';

    const modalSubconEl = document.getElementById('modalKpiTotalSubcon');
    if (modalSubconEl) {
        const totalSubcon = kpi.total_subcon_aktif || (data.subcon_list && data.subcon_list.length) || 1;
        modalSubconEl.textContent = `${totalSubcon}`;
    }

    const modalKaryawanEl = document.getElementById('modalKpiTotalKaryawan');
    if (modalKaryawanEl) {
        const totalKaryawan = kpi.total_karyawan_aktif || 26;
        modalKaryawanEl.textContent = `${totalKaryawan}`;
    }

    // Fallback jika ID lama masih ada
    const karyawanEl = document.getElementById('modalKpiKaryawan');
    if (karyawanEl) {
        karyawanEl.textContent = `${kpi.sudah_mengisi || 0} / ${kpi.total_karyawan_aktif || 0} orang`;
    }

    const belumEl = document.getElementById('modalKpiBelumMengisi');
    if (belumEl) {
        belumEl.textContent = `${kpi.belum_mengisi || 0} orang`;
    }

    // 2. Update Label Badge & Judul Grafik
    const chartTitleEl = document.getElementById('subconChartTitle');
    const chartBadgeEl = document.getElementById('subconChartBadge');
    const range = state.currentSubconRange;

    if (range === 'today') {
        if (chartTitleEl) chartTitleEl.textContent = 'Distribusi Hasil Produksi Per Barang (Hari Ini)';
        if (chartBadgeEl) chartBadgeEl.textContent = 'Hari Ini';
    } else if (range === 'week') {
        if (chartTitleEl) chartTitleEl.textContent = 'Grafik Tren Hasil Produksi Harian (7 Hari Terakhir)';
        if (chartBadgeEl) chartBadgeEl.textContent = '7 Hari Terakhir';
    } else if (range === 'month') {
        if (chartTitleEl) chartTitleEl.textContent = 'Grafik Tren Hasil Produksi Harian (30 Hari Terakhir)';
        if (chartBadgeEl) chartBadgeEl.textContent = '30 Hari Terakhir';
    }

    // 3. Render Visualisasi Grafik dengan Chart.js
    renderSubconChart(data);

    // 4. Update Tab Badge Counts
    const countBarangEl = document.getElementById('countBarang');
    if (countBarangEl) countBarangEl.textContent = (data.per_barang || []).length;

    const countKaryawanEl = document.getElementById('countKaryawan');
    if (countKaryawanEl) countKaryawanEl.textContent = (data.karyawan || []).length;

    const countSubconEl = document.getElementById('countSubcon');
    if (countSubconEl) countSubconEl.textContent = (data.per_subcon || []).length;

    const countRiwayatEl = document.getElementById('countRiwayat');
    if (countRiwayatEl) countRiwayatEl.textContent = (data.pengerjaan || []).length;

    // 5. Render Data Tabel dengan Filter
    renderSubconFilteredTables();

    // 6. Update Keterangan Footer
    const footerStatsEl = document.getElementById('subconModalFooterStats');
    if (footerStatsEl) {
        const periodText = range === 'today' ? 'Hari Ini' : (range === 'week' ? '7 Hari Terakhir' : '30 Hari Terakhir');
        footerStatsEl.textContent = `Periode: ${periodText} (${data.tanggal_mulai} s/d ${data.tanggal_akhir}) • Sumber: E-Subcon API SNA Medika`;
    }
}

/**
 * Render Grafik Tren Menggunakan Chart.js
 */
function renderSubconChart(data) {
    const canvas = document.getElementById('subconChartCanvas');
    if (!canvas || typeof Chart === 'undefined') return;

    if (state.subconChartInstance) {
        state.subconChartInstance.destroy();
        state.subconChartInstance = null;
    }

    const ctx = canvas.getContext('2d');
    const range = state.currentSubconRange;

    let chartLabels = [];
    let chartValues = [];
    let datasetLabel = 'Hasil Produksi (PCS)';

    if (range === 'today') {
        const items = data.per_barang || [];
        if (items.length > 0) {
            chartLabels = items.map(b => (b.nama_barang && b.nama_barang.length > 25) ? b.nama_barang.substring(0, 22) + '...' : (b.nama_barang || b.kode_barang));
            chartValues = items.map(b => b.total_pcs || 0);
        } else {
            chartLabels = ['Hari Ini'];
            chartValues = [data.kpi?.total_output_pcs || 0];
        }
    } else {
        const daily = data.daily_chart || [];
        chartLabels = daily.map(d => d.label || d.date);
        chartValues = daily.map(d => d.total_pcs || 0);
    }

    // Buat efek gradasi warna modern tema SNA Medika / Subcon (Indigo/Violet)
    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, 'rgba(99, 102, 241, 0.9)');
    gradient.addColorStop(1, 'rgba(99, 102, 241, 0.25)');

    state.subconChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: chartLabels,
            datasets: [{
                label: datasetLabel,
                data: chartValues,
                backgroundColor: gradient,
                borderColor: '#6366f1',
                borderWidth: 1.5,
                borderRadius: 4,
                maxBarThickness: 38,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 400 },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#0f172a',
                    titleFont: { family: 'Plus Jakarta Sans', size: 12, weight: 'bold' },
                    bodyFont: { family: 'JetBrains Mono', size: 12 },
                    padding: 10,
                    cornerRadius: 6,
                    callbacks: {
                        label: (c) => ` Total: ${Number(c.raw || 0).toLocaleString('id-ID')} PCS`
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        font: { family: 'Plus Jakarta Sans', size: 11, weight: '600' },
                        color: '#64748b',
                        maxRotation: 0,
                        autoSkip: true,
                    }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(226, 232, 240, 0.7)' },
                    ticks: {
                        font: { family: 'JetBrains Mono', size: 10 },
                        color: '#64748b',
                        callback: (v) => v.toLocaleString('id-ID')
                    }
                }
            }
        }
    });
}

/**
 * Filter dan Render Semua Tabel di Modal Subcon
 */
function renderSubconFilteredTables() {
    if (!state.subconRawData) return;
    const q = state.subconSearchQuery;

    // 1. Filter Tabel Barang
    const allBarang = state.subconRawData.per_barang || [];
    const filteredBarang = !q ? allBarang : allBarang.filter(b =>
        (b.nama_barang && b.nama_barang.toLowerCase().includes(q)) ||
        (b.kode_barang && b.kode_barang.toLowerCase().includes(q))
    );
    renderSubconBarangTable(filteredBarang);

    // 2. Filter Tabel Tracking Karyawan
    const allKaryawan = state.subconRawData.karyawan || [];
    const filteredKaryawan = !q ? allKaryawan : allKaryawan.filter(k =>
        (k.nama_karyawan && k.nama_karyawan.toLowerCase().includes(q)) ||
        (k.no_karyawan && k.no_karyawan.toLowerCase().includes(q)) ||
        (k.status && k.status.toLowerCase().includes(q)) ||
        (k.lokasi_subcon?.nama && k.lokasi_subcon.nama.toLowerCase().includes(q))
    );
    renderSubconKaryawanTable(filteredKaryawan);

    // 3. Filter Tabel Subcon
    const allSubcon = state.subconRawData.per_subcon || [];
    const filteredSubcon = !q ? allSubcon : allSubcon.filter(s =>
        (s.nama_lokasi && s.nama_lokasi.toLowerCase().includes(q)) ||
        (s.alamat && s.alamat.toLowerCase().includes(q))
    );
    renderSubconVendorTable(filteredSubcon);

    // 4. Filter Tabel Riwayat
    const allRiwayat = state.subconRawData.pengerjaan || [];
    const filteredRiwayat = !q ? allRiwayat : allRiwayat.filter(r =>
        (r.nama_barang && r.nama_barang.toLowerCase().includes(q)) ||
        (r.kode_barang && r.kode_barang.toLowerCase().includes(q)) ||
        (r.nama_karyawan && r.nama_karyawan.toLowerCase().includes(q)) ||
        (r.no_karyawan && r.no_karyawan.toLowerCase().includes(q)) ||
        (r.subcon_nama && r.subcon_nama.toLowerCase().includes(q))
    );
    renderSubconRiwayatTable(filteredRiwayat);
}

/**
 * Render Tabel 1: Pengerjaan Per Barang (Tanpa Kolom Transaksi)
 */
function renderSubconBarangTable(items) {
    const tbody = document.getElementById('subconBarangTableBody');
    if (!tbody) return;

    if (!items || items.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="loading-state" style="color: var(--text-muted);">
                    <i class="fa-solid fa-box-open"></i> Tidak ada data barang yang sesuai filter.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = items.map(b => `
        <tr>
            <td><span class="ticket-number">${escapeHtml(b.kode_barang)}</span></td>
            <td style="max-width: 320px; font-weight: 600; color: var(--text-primary);">${escapeHtml(b.nama_barang)}</td>
            <td><span class="badge-status badge-draft">${escapeHtml(b.satuan || 'PCS')}</span></td>
            <td class="text-right" style="font-family: var(--font-mono); font-weight: 800; color: var(--subcon-color);">
                ${Number(b.total_pcs || 0).toLocaleString('id-ID')} PCS
            </td>
            <td class="text-right" style="font-weight: 600; color: var(--status-success);">
                ${escapeHtml(b.total_durasi_formatted || '0 Menit')}
            </td>
            <td class="text-center" style="font-weight: 600; color: var(--text-secondary);">
                ${b.total_karyawan || 0} orang
            </td>
        </tr>
    `).join('');
}

/**
 * Render Tabel 2: Tracking Karyawan Harian (Sudah vs Belum Setor)
 */
function renderSubconKaryawanTable(karyawanList) {
    const tbody = document.getElementById('subconKaryawanTableBody');
    if (!tbody) return;

    if (!karyawanList || karyawanList.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="loading-state" style="color: var(--text-muted);">
                    <i class="fa-solid fa-users"></i> Tidak ada data karyawan yang sesuai filter.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = karyawanList.map(k => {
        const isSudah = k.status === 'sudah' || (k.submit_count > 0);
        const statusBadge = isSudah
            ? '<span class="badge-status badge-closed"><i class="fa-solid fa-circle-check"></i> Sudah Setor</span>'
            : '<span class="badge-status badge-rejected"><i class="fa-solid fa-clock"></i> Belum Setor</span>';

        const pengerjaanBarang = (k.pengerjaan || []).map(p =>
            `<span style="display:inline-block; margin-right:4px;"><b>${escapeHtml(p.kode_barang)}</b> (${p.jumlah} pcs)</span>`
        ).join(', ') || '<span style="color:#94a3b8; font-style:italic;">Belum ada penyerahan barang</span>';

        return `
            <tr>
                <td><span class="ticket-number">${escapeHtml(k.no_karyawan)}</span></td>
                <td style="font-weight: 700; color: var(--text-primary);">${escapeHtml(k.nama_karyawan)}</td>
                <td><span class="badge-status badge-draft">${escapeHtml(k.lokasi_subcon?.nama || 'SIMAN')}</span></td>
                <td>${statusBadge}</td>
                <td class="text-right" style="font-family: var(--font-mono); font-weight: 800; color: ${isSudah ? 'var(--subcon-color)' : 'var(--text-muted)'};">
                    ${Number(k.total_pcs || 0).toLocaleString('id-ID')} PCS
                </td>
                <td class="text-right" style="font-weight: 600; color: ${isSudah ? 'var(--status-success)' : 'var(--text-muted)'};">
                    ${escapeHtml(k.total_durasi_formatted || '0 Menit')}
                </td>
                <td style="max-width: 280px; font-size: 0.8rem;">
                    ${pengerjaanBarang}
                </td>
            </tr>
        `;
    }).join('');
}

/**
 * Render Tabel 3: Performa Mitra Subcon (Tanpa Kolom Transaksi)
 */
function renderSubconVendorTable(vendors) {
    const tbody = document.getElementById('subconVendorTableBody');
    if (!tbody) return;

    if (!vendors || vendors.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="loading-state" style="color: var(--text-muted);">
                    <i class="fa-solid fa-handshake"></i> Tidak ada data mitra subcon yang sesuai filter.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = vendors.map(v => `
        <tr>
            <td style="font-weight: 700; color: var(--text-primary);">
                <i class="fa-solid fa-location-dot" style="color: var(--subcon-color); margin-right: 0.35rem;"></i>
                ${escapeHtml(v.nama_lokasi)}
            </td>
            <td style="color: var(--text-secondary);">${escapeHtml(v.alamat || '-')}</td>
            <td class="text-right" style="font-family: var(--font-mono); font-weight: 800; color: var(--subcon-color);">
                ${Number(v.total_output_pcs || 0).toLocaleString('id-ID')} PCS
            </td>
            <td class="text-right" style="font-weight: 600; color: var(--status-success);">
                ${escapeHtml(v.total_durasi_formatted || '0 Menit')}
            </td>
            <td class="text-center" style="font-weight: 600; color: var(--text-primary);">
                ${v.sudah_mengisi || 0} / ${v.total_karyawan || 0} aktif
            </td>
        </tr>
    `).join('');
}

/**
 * Render Tabel 3: Riwayat Transaksi Pengerjaan
 */
function renderSubconRiwayatTable(riwayat) {
    const tbody = document.getElementById('subconRiwayatTableBody');
    if (!tbody) return;

    if (!riwayat || riwayat.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="loading-state" style="color: var(--text-muted);">
                    <i class="fa-solid fa-clock-rotate-left"></i> Tidak ada riwayat transaksi yang sesuai filter.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = riwayat.slice(0, 100).map(r => `
        <tr>
            <td style="white-space: nowrap; font-size: 0.8rem; color: var(--text-muted);">
                <b>${escapeHtml(r.tanggal_label || r.tanggal)}</b>
                ${r.jam_mulai ? `<br><span style="font-size: 0.72rem;">${r.jam_mulai} - ${r.jam_selesai || ''}</span>` : ''}
            </td>
            <td>
                <div style="font-weight: 700; color: var(--text-primary);">${escapeHtml(r.nama_karyawan)}</div>
                <div style="font-size: 0.72rem; color: var(--text-muted);">${escapeHtml(r.no_karyawan)}</div>
            </td>
            <td>
                <span class="badge-status badge-draft">${escapeHtml(r.subcon_nama)}</span>
            </td>
            <td style="max-width: 280px;">
                <div style="font-size: 0.72rem; font-family: var(--font-mono); color: var(--text-muted);">${escapeHtml(r.kode_barang)}</div>
                <div style="font-weight: 600; color: var(--text-primary); font-size: 0.82rem;">${escapeHtml(r.nama_barang)}</div>
            </td>
            <td>
                <span class="badge-status badge-progress">${escapeHtml(r.jenis_pekerjaan || 'FOLDING')}</span>
            </td>
            <td class="text-right" style="font-family: var(--font-mono); font-weight: 800; color: var(--subcon-color);">
                ${Number(r.jumlah_pcs || 0).toLocaleString('id-ID')} ${escapeHtml(r.satuan || 'PCS')}
            </td>
            <td class="text-center" style="font-weight: 600; font-size: 0.8rem; color: var(--status-success);">
                ${escapeHtml(r.durasi_text || '-')}
            </td>
        </tr>
    `).join('');
}

function renderSubconTablesLoading() {
    ['subconBarangTableBody', 'subconKaryawanTableBody', 'subconVendorTableBody', 'subconRiwayatTableBody'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.innerHTML = `
                <tr>
                    <td colspan="7" class="loading-state">
                        <i class="fa-solid fa-circle-notch fa-spin"></i> Memuat data pengerjaan dari E-Subcon...
                    </td>
                </tr>
            `;
        }
    });
}

function renderSubconTablesError(msg) {
    ['subconBarangTableBody', 'subconKaryawanTableBody', 'subconVendorTableBody', 'subconRiwayatTableBody'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.innerHTML = `
                <tr>
                    <td colspan="7" class="loading-state" style="color: #ef4444;">
                        <i class="fa-solid fa-circle-exclamation"></i> Gagal memuat data: ${escapeHtml(msg)}
                    </td>
                </tr>
            `;
        }
    });
}

