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
    ticketSearchQuery: '',  // Pencarian kata kunci di modal tiket
    modalRawTickets: [],    // Data mentah tiket yang sedang dibuka
    servicesData: null,     // Cache data statistik 10 layanan terakhir
    ticketCache: {},        // Cache in-memory tiket per layanan untuk loading instan
    subconCache: new Map(), // Cache in-memory subcon per range

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
        renderKpiTrackerTicker(data);
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

        // 2. Persentase & Progress Bar Fill (Standarisasi Warna Traffic Light KPI)
        const percent = item.persentase_selesai || 0;
        const percentEl = document.getElementById(`percent${code}`);
        const barFill = document.getElementById(`barFill${code}`);

        // Ambang Batas KPI:
        // - Merah: dibawah 75% (< 75%)
        // - Kuning: 76% sampai 85% (75% - 85%)
        // - Hijau: diatas 85% (> 85%)
        let kpiTextClass = 'kpi-color-red';
        let kpiFillClass = 'kpi-fill-red';

        if (percent > 85) {
            kpiTextClass = 'kpi-color-green';
            kpiFillClass = 'kpi-fill-green';
        } else if (percent >= 75) {
            kpiTextClass = 'kpi-color-yellow';
            kpiFillClass = 'kpi-fill-yellow';
        }

        if (percentEl) {
            percentEl.textContent = `${percent}%`;
            percentEl.className = `percent-val ${kpiTextClass}`;
        }

        // Update lebar dan warna progress bar di bawah angka persentase
        if (barFill) {
            barFill.style.width = `${percent}%`;
            barFill.className = `progress-bar-fill ${kpiFillClass}`;
        }
    });
}

// ====================================================================
// 8. RENDER RUNNING TICKER TARGET & CAPAIAN HARIAN (KPI TRACKER DIREKSI)
// ====================================================================
function renderKpiTrackerTicker(data) {
    const listEl = document.getElementById('tickerList');
    if (!listEl) return;

    if (!data) {
        listEl.innerHTML = `
            <span class="ticker-item">
                <i class="fa-solid fa-circle-check" style="color: #10b981;"></i> 
                Semua sistem dan lini operasional aktif termonitor normal.
            </span>
        `;
        return;
    }

    const kpi = data.kpi_global || {};
    const layanan = data.layanan || {};
    const subcon = layanan.SUBCON || {};

    const items = [];

    // 1. Capaian Produksi Subcon
    const totalPcs = Number(subcon.total_output_pcs || 0).toLocaleString('id-ID');
    const namaSubcon = subcon.subcon_nama || 'SIMAN';
    const totalKaryawan = subcon.total_karyawan || 26;
    items.push(`
        <span class="ticker-item">
            <i class="fa-solid fa-boxes-packing" style="color: #6366f1;"></i>
            <span>Produksi Subcon:</span>
            <b style="color: #6366f1;">${totalPcs} PCS</b>
            <span class="ticker-kpi-sub">(Mitra ${namaSubcon} • ${totalKaryawan} Tenaga Kerja)</span>
        </span>
    `);

    // 2. Capaian Tiket Operasional Selesai
    const selesaiTiket = kpi.total_selesai || 0;
    const totalTiket = kpi.total_efektif || kpi.total_tiket || 0;
    items.push(`
        <span class="ticker-item">
            <i class="fa-solid fa-circle-check" style="color: #10b981;"></i>
            <span>Tiket Selesai:</span>
            <b style="color: #10b981;">${selesaiTiket} Tiket</b>
            <span class="ticker-kpi-sub">(dari total ${totalTiket} tiket)</span>
        </span>
    `);

    // 3. Tingkat Respon / Efektivitas Layanan
    // const persentase = kpi.persentase_selesai || 0;
    // items.push(`
    //     <span class="ticker-item">
    //         <i class="fa-solid fa-bullseye" style="color: #0284c7;"></i>
    //         <span>Tingkat Respon Layanan:</span>
    //         <b style="color: #0284c7;">${persentase}%</b>
    //     </span>
    // `);

    // 4. Tiket Dalam Proses
    const pendingTiket = kpi.total_belum_selesai || 0;
    items.push(`
        <span class="ticker-item">
            <i class="fa-solid fa-clock-rotate-left" style="color: #f59e0b;"></i>
            <span>Tiket Dalam Proses:</span>
            <b style="color: #d97706;">${pendingTiket} Tiket</b>
        </span>
    `);

    // 5. Realisasi Per Divisi Operasional (IT, TK, GA)
    if (layanan.IT) {
        items.push(`
            <span class="ticker-item">
                <span class="tag tag-it">IT</span>
                <b>${layanan.IT.selesai}/${layanan.IT.total_tiket} Selesai</b>
                <span class="ticker-kpi-sub">(${layanan.IT.persentase_selesai}%)</span>
            </span>
        `);
    }
    if (layanan.TK) {
        items.push(`
            <span class="ticker-item">
                <span class="tag tag-tk">TK</span>
                <b>${layanan.TK.selesai}/${layanan.TK.total_tiket} Selesai</b>
                <span class="ticker-kpi-sub">(${layanan.TK.persentase_selesai}%)</span>
            </span>
        `);
    }
    if (layanan.GA) {
        items.push(`
            <span class="ticker-item">
                <span class="tag tag-ga">GA</span>
                <b>${layanan.GA.selesai}/${layanan.GA.total_tiket} Selesai</b>
                <span class="ticker-kpi-sub">(${layanan.GA.persentase_selesai}%)</span>
            </span>
        `);
    }

    const itemsHtml = items.join(' &bull; ');
    // Gandakan konten agar animasi marquee meluncur mulus tanpa terputus
    listEl.innerHTML = itemsHtml + ' &bull; ' + itemsHtml;
}

// Fallback alias jika masih ada pemanggilan lama
function renderAttentionTicker(ticketsOrData) {
    if (ticketsOrData && ticketsOrData.kpi_global) {
        renderKpiTrackerTicker(ticketsOrData);
    } else {
        renderKpiTrackerTicker({
            kpi_global: state.kpiGlobalData,
            layanan: state.servicesData,
        });
    }
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

    // Ambil data tiket untuk tab aktif (default: 'all')
    await loadModalTickets(serviceCode, 'all');
}

async function loadModalTickets(serviceCode, filterStatus = 'all') {
    let queryStatus = filterStatus;
    if (filterStatus === 'ditolak') queryStatus = 'rejected';

    const cacheKey = `${serviceCode}_${queryStatus}`;
    if (!state.ticketCache) state.ticketCache = {};
    const cached = state.ticketCache[cacheKey];

    // Jika data tab ini sudah ada di cache, tampilkan langsung instan (0 ms)!
    if (cached) {
        state.modalRawTickets = cached.data;
        renderFilteredTickets();
        if (Date.now() - cached.timestamp < 45000) {
            return;
        }
    } else {
        renderTicketTableLoading();
    }

    try {
        const url = `/api/dashboard/tickets?service=${serviceCode}&status=${queryStatus}&limit=all`;
        const response = await fetch(url);
        const json = await response.json();

        if (!json.success) {
            throw new Error(json.message || 'Gagal memuat tiket');
        }

        const tickets = json.data || [];
        state.ticketCache[cacheKey] = {
            data: tickets,
            timestamp: Date.now()
        };

        if (state.currentServiceModal === serviceCode && state.currentModalFilter === filterStatus) {
            state.modalRawTickets = tickets;
            renderFilteredTickets();
        }

    } catch (error) {
        console.error('Error saat load modal tickets:', error);
        if (!cached) {
            renderTicketTableError(error.message);
        }
    }
}

function filterModalTickets(filterType) {
    state.currentModalFilter = filterType;

    // Update class active pada tab pills
    document.querySelectorAll('.filter-pill').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-filter') === filterType);
    });

    if (state.currentServiceModal) {
        loadModalTickets(state.currentServiceModal, filterType);
    }
}

function handleSearchTickets(keyword) {
    state.ticketSearchQuery = keyword;
    renderFilteredTickets();
}

function renderFilteredTickets() {
    const keyword = (state.ticketSearchQuery || '').trim().toLowerCase();
    let list = state.modalRawTickets || [];

    if (keyword) {
        list = list.filter(t => {
            const noTiket = (t.no_tiket || '').toLowerCase();
            const judul = (t.judul || '').toLowerCase();
            const pelapor = (t.pelapor || '').toLowerCase();
            const petugas = (t.petugas || '').toLowerCase();
            return noTiket.includes(keyword) || judul.includes(keyword) || pelapor.includes(keyword) || petugas.includes(keyword);
        });
    }

    renderTicketsTable(list);
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

function renderTicketTableLoading(rowCount = 6) {
    const tbody = document.getElementById('ticketsTableBody');
    if (!tbody) return;

    const widths = [
        ['105px', '82%', '36px', '115px', '120px', '72px', '85px'],
        ['115px', '60%', '48px', '95px', '105px', '64px', '90px'],
        ['100px', '88%', '36px', '130px', '100px', '80px', '80px'],
        ['110px', '50%', '42px', '90px', '125px', '68px', '85px'],
        ['95px', '75%', '36px', '110px', '95px', '75px', '90px'],
        ['112px', '66%', '45px', '105px', '115px', '64px', '80px'],
    ];

    let html = '';
    for (let i = 0; i < rowCount; i++) {
        const w = widths[i % widths.length];
        html += `
            <tr class="skeleton-row">
                <td><span class="skeleton-box" style="width: ${w[0]}; height: 16px;"></span></td>
                <td>
                    <div style="display: flex; flex-direction: column; gap: 6px;">
                        <span class="skeleton-box" style="width: ${w[1]}; height: 15px;"></span>
                        <span class="skeleton-box" style="width: 40%; height: 10px; opacity: 0.6;"></span>
                    </div>
                </td>
                <td><span class="skeleton-pill" style="width: ${w[2]};"></span></td>
                <td><span class="skeleton-box" style="width: ${w[3]}; height: 14px;"></span></td>
                <td><span class="skeleton-box" style="width: ${w[4]}; height: 14px;"></span></td>
                <td><span class="skeleton-badge" style="width: ${w[5]};"></span></td>
                <td><span class="skeleton-box" style="width: ${w[6]}; height: 13px;"></span></td>
            </tr>
        `;
    }
    tbody.innerHTML = html;
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

    // Cek cache lokal frontend agar instan tanpa loading
    if (!state.subconCache) state.subconCache = new Map();
    const cached = state.subconCache.get(range);
    if (cached) {
        state.subconRawData = cached.data;
        renderSubconModalData(cached.data);
        if (Date.now() - cached.timestamp < 30000) {
            return;
        }
    } else {
        renderSubconTablesLoading();
    }

    try {
        const response = await fetch(`/api/dashboard/subcon?range=${range}`);
        const result = await response.json();

        if (!result.success) {
            throw new Error(result.message || 'Gagal mengambil data monitoring subcon');
        }

        state.subconCache.set(range, { data: result.data, timestamp: Date.now() });
        state.subconRawData = result.data;
        renderSubconModalData(result.data);

    } catch (err) {
        console.error('Error memuat data subcon:', err);
        if (!cached) {
            renderSubconTablesError(err.message);
        }
    }
}

/**
 * Mengganti Tab Konten Detail (Pengerjaan Barang / Mitra Subcon)
 */
function switchSubconTab(tab) {
    state.currentSubconTab = tab;

    // Update active state tab buttons
    const tabBtns = {
        barang: document.getElementById('tabBtnBarang'),
        subcon: document.getElementById('tabBtnSubcon'),
    };

    Object.keys(tabBtns).forEach(k => {
        if (tabBtns[k]) tabBtns[k].classList.toggle('active', k === tab);
    });

    // Update active state tab panels
    const tabPanels = {
        barang: document.getElementById('tabPanelBarang'),
        subcon: document.getElementById('tabPanelSubcon'),
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

    // 1. Render 3 KPI Mini
    const kpi = data.kpi || {};
    const totalPcsEl = document.getElementById('modalKpiTotalPcs');
    if (totalPcsEl) totalPcsEl.textContent = Number(kpi.total_output_pcs || 0).toLocaleString('id-ID');

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

    const countSubconEl = document.getElementById('countSubcon');
    if (countSubconEl) countSubconEl.textContent = (data.per_subcon || []).length;

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
        (b.kode_barang && b.kode_barang.toLowerCase().includes(q)) ||
        (b.nama_subcon && b.nama_subcon.toLowerCase().includes(q))
    );
    renderSubconBarangTable(filteredBarang);

    // 2. Filter Tabel Subcon
    const allSubcon = state.subconRawData.per_subcon || [];
    const filteredSubcon = !q ? allSubcon : allSubcon.filter(s =>
        (s.nama_lokasi && s.nama_lokasi.toLowerCase().includes(q)) ||
        (s.alamat && s.alamat.toLowerCase().includes(q))
    );
    renderSubconVendorTable(filteredSubcon);
}

/**
 * Render Tabel 1: Pengerjaan Per Barang (Kolom: Nama Subcon)
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
            <td>
                <span class="badge-status badge-closed" style="background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; font-weight: 600;">
                    <i class="fa-solid fa-industry" style="color: var(--subcon-color); margin-right: 4px;"></i>${escapeHtml(b.nama_subcon || b.subcon_nama || 'SIMAN')}
                </span>
            </td>
            <td class="text-center" style="font-weight: 600; color: var(--text-secondary);">
                ${b.total_karyawan || 0} orang
            </td>
        </tr>
    `).join('');
}

/**
 * Render Tabel 2: Performa Mitra Subcon (Tanpa Kolom Jam Kerja)
 */
function renderSubconVendorTable(vendors) {
    const tbody = document.getElementById('subconVendorTableBody');
    if (!tbody) return;

    if (!vendors || vendors.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="loading-state" style="color: var(--text-muted);">
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

function renderSubconTablesLoading(rowCount = 5) {
    const barangTbody = document.getElementById('subconBarangTableBody');
    if (barangTbody) {
        const widths = ['80%', '60%', '85%', '55%', '70%'];
        let html = '';
        for (let i = 0; i < rowCount; i++) {
            html += `
                <tr class="skeleton-row">
                    <td><span class="skeleton-box" style="width: 80px; height: 16px;"></span></td>
                    <td><span class="skeleton-box" style="width: ${widths[i % widths.length]}; height: 15px;"></span></td>
                    <td><span class="skeleton-pill" style="width: 38px;"></span></td>
                    <td class="text-right"><span class="skeleton-box" style="width: 70px; height: 16px;"></span></td>
                    <td><span class="skeleton-badge" style="width: 75px;"></span></td>
                    <td class="text-center"><span class="skeleton-box" style="width: 40px; height: 14px;"></span></td>
                </tr>
            `;
        }
        barangTbody.innerHTML = html;
    }

    const vendorTbody = document.getElementById('subconVendorTableBody');
    if (vendorTbody) {
        let html = '';
        for (let i = 0; i < 3; i++) {
            html += `
                <tr class="skeleton-row">
                    <td><span class="skeleton-box" style="width: 120px; height: 16px;"></span></td>
                    <td><span class="skeleton-box" style="width: 160px; height: 14px;"></span></td>
                    <td class="text-right"><span class="skeleton-box" style="width: 80px; height: 16px;"></span></td>
                    <td class="text-center"><span class="skeleton-box" style="width: 45px; height: 14px;"></span></td>
                </tr>
            `;
        }
        vendorTbody.innerHTML = html;
    }

    const riwayatTbody = document.getElementById('subconRiwayatTableBody');
    if (riwayatTbody) {
        let html = '';
        for (let i = 0; i < rowCount; i++) {
            html += `
                <tr class="skeleton-row">
                    <td><span class="skeleton-box" style="width: 80px; height: 14px;"></span></td>
                    <td><span class="skeleton-box" style="width: 110px; height: 15px;"></span></td>
                    <td><span class="skeleton-badge" style="width: 65px;"></span></td>
                    <td><span class="skeleton-box" style="width: 70%; height: 14px;"></span></td>
                    <td><span class="skeleton-badge" style="width: 70px;"></span></td>
                    <td class="text-right"><span class="skeleton-box" style="width: 65px; height: 16px;"></span></td>
                    <td class="text-center"><span class="skeleton-box" style="width: 55px; height: 13px;"></span></td>
                </tr>
            `;
        }
        riwayatTbody.innerHTML = html;
    }
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

