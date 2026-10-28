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
    retryInterval: 5,       // Interval retry cepat saat error / reconnect (detik)
    countdownTimer: 15,     // Hitung mundur detik
    timerId: null,          // Referensi interval timer
    isFetching: false,      // Penanda sedang memuat
    isOffline: false,       // Status jaringan sedang offline / reconnect
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

    // State Khusus Modul Purchasing (Atena ERP)
    currentPurchasingRange: 'month',
    purchasingDateStart: '',
    purchasingDateEnd: '',
    currentPurchasingJenis: 'all',
    currentPurchasingStatus: 'all',
    currentPurchasingView: 'pr',
    purchasingSearchQuery: '',
    purchasingCurrentPage: 1,
    purchasingPageSize: 30,
    purchasingRawData: null,
    purchasingCache: new Map(),

    // State Sorting Tabel (Purchasing & Ticket)
    purchasingSort: {
        pr: { column: 'tanggal', dir: 'desc' },
        items: { column: 'tanggal', dir: 'desc' },
    },
    ticketSort: { column: 'tanggal', dir: 'desc' },

    // State Khusus Modul Produksi (Atena ERP)
    currentProduksiBagian: 'stentor',
    currentProduksiPeriod: 'month',
    produksiTglAwal: '',
    produksiTglAkhir: '',
    currentProduksiStatus: 'all',
    produksiSearchQuery: '',
    produksiCurrentPage: 1,
    produksiPageSize: 20,
    produksiRawData: null,
    produksiCache: new Map(),
    produksiSort: { column: 'nomor_pp', dir: 'asc' },
    produksiFilters: {}, // Filter tanggal independen per masing-masing lini bagian

    // State Khusus Modul Logistik (Atena ERP REST API)
    currentLogistikRange: 'month',
    logistikDateStart: '',
    logistikDateEnd: '',
    currentLogistikStatus: 'all',
    currentLogistikView: 'orders', // 'orders' | 'items'
    logistikFilteredOrder: '', // Ketika user klik drilldown rincian order spesifik
    logistikSearchQuery: '',
    logistikCurrentPage: 1,
    logistikPageSize: 15,
    logistikRawData: null,
    logistikCache: new Map(),
    logistikSort: {
        orders: { column: 'tgl_jatuh_tempo', dir: 'desc' },
        items: { column: 'tgl_jatuh_tempo', dir: 'desc' }
    },

    // State Khusus Modul QA (Release Material GRS Atena ERP)
    currentQaRange: 'month',
    qaDateStart: '',
    qaDateEnd: '',
    currentQaStatus: 'all',
    currentQaView: 'grs', // 'grs' (Daftar GRS) | 'po' (Ringkasan Per PO)
    qaSearchQuery: '',
    qaCurrentPage: 1,
    qaPageSize: 30,
    qaRawData: null,
    qaCache: new Map(),
    qaSort: {
        grs: { column: 'tanggal', dir: 'desc' },
        po: { column: 'tanggal', dir: 'desc' },
    },
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
            closePurchasingModal();
            closeQaModal();
            closeProduksiModal();
            closeLogistikModal();
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

    const purchasingModalOverlay = document.getElementById('purchasingModal');
    if (purchasingModalOverlay) {
        purchasingModalOverlay.addEventListener('click', (e) => {
            if (e.target === purchasingModalOverlay) {
                closePurchasingModal();
            }
        });
    }

    const qaModalOverlay = document.getElementById('qaModal');
    if (qaModalOverlay) {
        qaModalOverlay.addEventListener('click', (e) => {
            if (e.target === qaModalOverlay) {
                closeQaModal();
            }
        });
    }

    const produksiModalOverlay = document.getElementById('produksiModal');
    if (produksiModalOverlay) {
        produksiModalOverlay.addEventListener('click', (e) => {
            if (e.target === produksiModalOverlay) {
                closeProduksiModal();
            }
        });
    }

    const logistikModalOverlay = document.getElementById('logistikModal');
    if (logistikModalOverlay) {
        logistikModalOverlay.addEventListener('click', (e) => {
            if (e.target === logistikModalOverlay) {
                closeLogistikModal();
            }
        });
    }

    // Auto-reconnect saat koneksi internet / LAN kembali online
    window.addEventListener('online', () => {
        console.log('🌐 [Network]: Jaringan kembali online, menyinkronkan data...');
        fetchDashboardStats(true);
    });

    // Auto-sync saat tab browser aktif kembali (misalnya display TV atau pengguna kembali ke tab)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            fetchDashboardStats(false);
        }
    });
}

// ====================================================================
// 4. LOGIKA AUTO-REFRESH & HITUNG MUNDUR (COUNTDOWN & FAST RECONNECT)
// ====================================================================
function startAutoRefresh() {
    if (state.timerId) clearInterval(state.timerId);

    state.countdownTimer = state.refreshInterval;
    updateCountdownUI();

    state.timerId = setInterval(() => {
        state.countdownTimer--;
        updateCountdownUI();

        if (state.countdownTimer <= 0) {
            // Jika sedang offline gunakan retry cepat (5s), jika normal gunakan interval normal (15s)
            state.countdownTimer = state.isOffline ? state.retryInterval : state.refreshInterval;
            fetchDashboardStats();
        }
    }, 1000);
}

function updateCountdownUI() {
    const timerEl = document.getElementById('refreshTimer');
    if (timerEl) {
        if (state.isOffline) {
            timerEl.textContent = `${state.countdownTimer}s ⟳`;
        } else {
            timerEl.textContent = `${state.countdownTimer}s`;
        }
    }

    if (state.isOffline) {
        const badge = document.getElementById('systemStatusBadge');
        if (badge) {
            badge.className = 'status-badge status-offline';
            badge.innerHTML = `<span class="status-dot"></span> Reconnecting (${state.countdownTimer}s)...`;
        }
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

    // Timeout 10 detik dengan AbortController untuk mencegah fetch menggantung tanpa batas waktu
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
        const url = `/api/dashboard/stats${force ? '?force=true' : ''}`;
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status} (${response.statusText})`);
        }

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.message || 'Gagal memuat data dari server');
        }

        // Tandai koneksi pulih jika sebelumnya offline
        state.isOffline = false;

        // Simpan data layanan ke state lokal
        state.servicesData = data.layanan;

        // Render Data ke Tampilan
        renderGlobalKPI(data.kpi_global);
        renderServiceCards(data.layanan);
        renderKpiTrackerTicker(data);
        updateSystemStatus(true, Boolean(data._cached));

        // Reset hitung mundur normal setelah fetch sukses
        state.countdownTimer = state.refreshInterval;
        updateCountdownUI();

    } catch (error) {
        clearTimeout(timeoutId);
        const isAbort = error.name === 'AbortError';
        const errorMsg = isAbort ? 'Request Timeout (10s)' : (error.message || 'Jaringan Terputus');
        console.warn(`⚠️ [Sync Error]: ${errorMsg}, mencoba reconnect otomatis dalam 5 detik...`);

        state.isOffline = true;
        // Atur interval retry cepat (5 detik)
        state.countdownTimer = state.retryInterval;
        updateSystemStatus(false);
        updateCountdownUI();

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

    // Dukung seluruh modul dari API (22 Modul Operasional SNA Medika)
    const services = Object.keys(layanan);

    // Update jumlah modul di counter tab Semua
    const countAllEl = document.getElementById('count-all');
    if (countAllEl) {
        countAllEl.textContent = `${services.length}`;
    }

    services.forEach(code => {
        const item = layanan[code];
        if (!item) return;

        // Penanganan Khusus Modul Pengerjaan Subcon (Hasil Produksi PCS)
        if (code === 'SUBCON') {
            const pcs = item.total_output_pcs || 0;
            animateCounter('totalPcsSUBCON', pcs);
            animateCounter('percentSUBCON', pcs);

            const subconEl = document.getElementById('subconJumlahSubcon') || document.getElementById('totalSUBCON') || document.getElementById('subconJumlahMitra');
            if (subconEl) {
                const totalSubcon = item.total_subcon || 1;
                subconEl.textContent = `${totalSubcon}`;
            }

            const karyawanEl = document.getElementById('subconJumlahKaryawan') || document.getElementById('karyawanSUBCON');
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

        // 3. Update Status Badge (Live vs Standby) secara dinamis
        const cardEl = document.getElementById(`card-${code}`);
        if (cardEl) {
            const statusPill = cardEl.querySelector('.service-status-pill');
            if (statusPill) {
                if (item.is_active) {
                    statusPill.className = 'service-status-pill status-live';
                    statusPill.textContent = 'Live';
                } else {
                    statusPill.className = 'service-status-pill status-standby';
                    statusPill.textContent = 'Standby';
                }
            }
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

    // 6. Realisasi Penyelesaian PP Produksi (Atena ERP)
    if (data.kpi_produksi && data.kpi_produksi.total_pp > 0) {
        const prodKpi = data.kpi_produksi;
        items.push(`
            <span class="ticker-item">
                <i class="fa-solid fa-industry" style="color: #2563eb;"></i>
                <span>Penyelesaian PP Produksi:</span>
                <b style="color: #2563eb;">${prodKpi.total_memenuhi}/${prodKpi.total_pp} PP</b>
                <span class="ticker-kpi-sub">(${prodKpi.persentase}% • Live Atena ERP)</span>
            </span>
        `);
    }

    // 7. Realisasi Pemenuhan PR Purchasing (Atena ERP)
    if (layanan.PURCHASING && (layanan.PURCHASING.total_tiket > 0 || layanan.PURCHASING.is_active)) {
        const pur = layanan.PURCHASING;
        items.push(`
            <span class="ticker-item">
                <i class="fa-solid fa-cart-shopping" style="color: #0284c7;"></i>
                <span>Pemenuhan PR Purchasing:</span>
                <b style="color: #0284c7;">${pur.selesai}/${pur.total_tiket} PR</b>
                <span class="ticker-kpi-sub">(${pur.persentase_selesai}% • Live Atena ERP)</span>
            </span>
        `);
    }

    // 8. Realisasi Pemenuhan Order Logistik (Atena ERP)
    if (layanan.LOGISTIK && (layanan.LOGISTIK.total_tiket > 0 || layanan.LOGISTIK.is_active)) {
        const log = layanan.LOGISTIK;
        items.push(`
            <span class="ticker-item">
                <i class="fa-solid fa-truck-fast" style="color: #10b981;"></i>
                <span>Pemenuhan Order Logistik:</span>
                <b style="color: #10b981;">${log.selesai}/${log.total_tiket} Order</b>
                <span class="ticker-kpi-sub">(${log.persentase_selesai}% • Live Atena ERP)</span>
            </span>
        `);
    }

    // 9. Realisasi Release Material QA (GRS Atena ERP)
    if (layanan.QA && (layanan.QA.total_tiket > 0 || layanan.QA.is_active)) {
        const qa = layanan.QA;
        items.push(`
            <span class="ticker-item">
                <i class="fa-solid fa-clipboard-check" style="color: #8b5cf6;"></i>
                <span>Release Material QA (GRS):</span>
                <b style="color: #8b5cf6;">${qa.selesai}/${qa.total_tiket} GRS</b>
                <span class="ticker-kpi-sub">(${qa.persentase_selesai}% • Live GRS)</span>
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
        badge.innerHTML = `<span class="status-dot"></span> Reconnecting (${state.countdownTimer}s)...`;
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
    document.querySelectorAll('#ticketModal .filter-pill').forEach(btn => {
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

async function loadModalTickets(serviceCode, filterStatus = 'all', force = false) {
    let queryStatus = filterStatus;
    if (filterStatus === 'ditolak') queryStatus = 'rejected';

    const cacheKey = `${serviceCode}_${queryStatus}`;
    if (!state.ticketCache) state.ticketCache = {};
    const cached = state.ticketCache[cacheKey];

    // Jika data tab ini sudah ada di cache & tidak dipaksa refresh, tampilkan langsung instan (0 ms)!
    if (!force && cached) {
        state.modalRawTickets = cached.data;
        renderFilteredTickets();
        if (Date.now() - cached.timestamp < 15000) {
            return;
        }
    } else {
        renderTicketTableLoading();
    }

    try {
        const forceParam = force ? '&force=true' : '';
        const url = `/api/dashboard/tickets?service=${serviceCode}&status=${queryStatus}&limit=all${forceParam}`;
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
        if (!cached || force) {
            renderTicketTableError(error.message);
        }
    }
}

async function refreshModalTickets() {
    if (!state.currentServiceModal) return;
    const btn = document.getElementById('btnRefreshTickets');
    const icon = btn ? btn.querySelector('i') : null;
    if (icon) icon.classList.add('fa-spin');

    // Kosongkan cache frontend untuk layanan ini agar semua tab ikut segar
    state.ticketCache = {};

    try {
        await loadModalTickets(state.currentServiceModal, state.currentModalFilter || 'all', true);
    } finally {
        if (icon) {
            setTimeout(() => {
                icon.classList.remove('fa-spin');
            }, 500);
        }
    }
}

function filterModalTickets(filterType) {
    state.currentModalFilter = filterType;

    // Update class active pada tab pills di modal tiket
    document.querySelectorAll('#ticketModal .filter-pill').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-filter') === filterType);
    });

    if (state.currentServiceModal) {
        loadModalTickets(state.currentServiceModal, filterType);
    }
}

/**
 * Reset Filter Modal Tiket Layanan (IT, Teknik, GA) ke kondisi awal
 */
function resetTicketModalFilter() {
    state.currentModalFilter = 'all';
    state.ticketSearchQuery = '';
    state.ticketSort = { column: 'tanggal', dir: 'desc' };

    const searchInput = document.getElementById('ticketSearchInput');
    if (searchInput) searchInput.value = '';

    document.querySelectorAll('#ticketModal .filter-pill').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-filter') === 'all');
    });

    updateTicketSortHeaders();

    if (state.currentServiceModal) {
        loadModalTickets(state.currentServiceModal, 'all');
    }
}

function handleSearchTickets(keyword) {
    state.ticketSearchQuery = keyword;
    renderFilteredTickets();
}

function renderFilteredTickets() {
    const keyword = (state.ticketSearchQuery || '').trim().toLowerCase();
    let list = [...(state.modalRawTickets || [])];

    if (keyword) {
        list = list.filter(t => {
            const noTiket = (t.no_tiket || '').toLowerCase();
            const judul = (t.judul || '').toLowerCase();
            const pelapor = (t.pelapor || '').toLowerCase();
            const petugas = (t.petugas || '').toLowerCase();
            return noTiket.includes(keyword) || judul.includes(keyword) || pelapor.includes(keyword) || petugas.includes(keyword);
        });
    }

    // Sort Tiket (Asc / Desc)
    const tSort = state.ticketSort || { column: 'tanggal', dir: 'desc' };
    if (tSort.column) {
        const col = tSort.column;
        const dir = tSort.dir === 'asc' ? 1 : -1;
        list.sort((a, b) => {
            let valA = a[col];
            let valB = b[col];
            if (col === 'tanggal') {
                valA = a.tanggal || a.created_at || '';
                valB = b.tanggal || b.created_at || '';
                return String(valA).localeCompare(String(valB)) * dir;
            }
            return String(valA || '').localeCompare(String(valB || ''), 'id', { numeric: true, sensitivity: 'base' }) * dir;
        });
    }

    renderTicketsTable(list);
}

/**
 * Sorting Kolom Modal Tiket (Ascending / Descending)
 */
function sortTicketTable(column) {
    if (!state.ticketSort) {
        state.ticketSort = { column: 'tanggal', dir: 'desc' };
    }
    if (state.ticketSort.column === column) {
        state.ticketSort.dir = state.ticketSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
        state.ticketSort.column = column;
        state.ticketSort.dir = column === 'tanggal' ? 'desc' : 'asc';
    }
    updateTicketSortHeaders();
    renderFilteredTickets();
}

/**
 * Update Icon Sort pada Header Tabel Tiket
 */
function updateTicketSortHeaders() {
    const table = document.querySelector('#ticketModal .tickets-table');
    if (!table) return;
    const currentSort = state.ticketSort || { column: 'tanggal', dir: 'desc' };
    const headers = table.querySelectorAll('th.sortable-th');
    headers.forEach(th => {
        const key = th.getAttribute('data-sort-key');
        const icon = th.querySelector('.sort-icon');
        if (key === currentSort.column) {
            th.classList.add('active-sort');
            if (icon) {
                icon.className = currentSort.dir === 'asc'
                    ? 'fa-solid fa-sort-up sort-icon'
                    : 'fa-solid fa-sort-down sort-icon';
            }
        } else {
            th.classList.remove('active-sort');
            if (icon) {
                icon.className = 'fa-solid fa-sort sort-icon';
            }
        }
    });
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

/**
 * Modal Sederhana Informasi Modul Standby / Belum Terhubung
 */
function openAppModal(title, desc) {
    const modal = document.getElementById('appModal');
    const titleEl = document.getElementById('appModalTitle');
    const descEl = document.getElementById('appModalDesc');
    if (titleEl && title) titleEl.textContent = title;
    if (descEl && desc) descEl.textContent = desc;
    if (modal) modal.classList.add('active');
}

function closeAppModal() {
    const modal = document.getElementById('appModal');
    if (modal) modal.classList.remove('active');
}

// Helper Label dan Warna Badge Status Tiket
function getStatusBadge(status, customLabel) {
    const s = (status || '').toLowerCase();
    if (s === 'closed') {
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
    if (s === 'done') {
        return { label: customLabel || 'Menunggu Laporan', cssClass: 'badge-pending' };
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

function formatSubconDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * Mengganti Rentang Waktu (Hari Ini / 7 Hari Terakhir / 30 Hari Terakhir)
 */
async function switchSubconRange(range = 'today') {
    state.currentSubconRange = range;

    const now = new Date();
    const today = formatSubconDate(now);
    let startDate = today;
    let endDate = today;

    if (range === 'today') {
        startDate = today;
        endDate = today;
    } else if (range === 'week') {
        const past7 = new Date();
        past7.setDate(now.getDate() - 6);
        startDate = formatSubconDate(past7);
        endDate = today;
    } else if (range === 'month') {
        const past30 = new Date();
        past30.setDate(now.getDate() - 29);
        startDate = formatSubconDate(past30);
        endDate = today;
    }

    state.subconDateStart = startDate;
    state.subconDateEnd = endDate;

    const startInput = document.getElementById('subconDateStart');
    const endInput = document.getElementById('subconDateEnd');
    if (startInput) startInput.value = startDate;
    if (endInput) endInput.value = endDate;

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
        const response = await fetch(`/api/dashboard/subcon?range=${encodeURIComponent(range)}`);
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
 * Handle perubahan tanggal manual pada input Date Picker Subcon
 */
async function handleSubconDateChange(changedField) {
    const startInput = document.getElementById('subconDateStart');
    const endInput = document.getElementById('subconDateEnd');
    if (!startInput || !endInput) return;

    let start = startInput.value;
    let end = endInput.value;

    if (start && end && start > end) {
        if (changedField === 'start') {
            endInput.value = start;
            end = start;
        } else {
            startInput.value = end;
            start = end;
        }
    }

    state.subconDateStart = start;
    state.subconDateEnd = end;
    state.currentSubconRange = 'custom';

    const pills = document.querySelectorAll('.subcon-range-pills .filter-pill');
    pills.forEach(p => p.classList.remove('active'));

    const cacheKey = `custom_${start}_${end}`;
    if (!state.subconCache) state.subconCache = new Map();
    const cached = state.subconCache.get(cacheKey);
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
        const response = await fetch(`/api/dashboard/subcon?tanggal_mulai=${encodeURIComponent(start)}&tanggal_akhir=${encodeURIComponent(end)}`);
        const result = await response.json();

        if (!result.success) {
            throw new Error(result.message || 'Gagal mengambil data monitoring subcon');
        }

        state.subconCache.set(cacheKey, { data: result.data, timestamp: Date.now() });
        state.subconRawData = result.data;
        renderSubconModalData(result.data);

    } catch (err) {
        console.error('Error memuat data subcon kustom:', err);
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
 * Reset Filter Modal Subcon ke kondisi default (Hari Ini, search kosong, tab barang)
 */
function resetSubconFilter() {
    state.subconSearchQuery = '';
    const searchInput = document.getElementById('subconSearchInput');
    if (searchInput) searchInput.value = '';

    switchSubconTab('barang');
    switchSubconRange('today');
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

// ====================================================================
// 12. LOGIKA INTERAKTIF MODAL PURCHASING (ATENA ERP)
// ====================================================================

/**
 * Helper format tanggal YYYY-MM-DD untuk Purchasing
 */
function formatPurchasingDate(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Buka Modal Monitoring Purchasing
 */
function openPurchasingModal(range = 'month', defaultJenis = 'all') {
    const modal = document.getElementById('purchasingModal');
    if (!modal) return;

    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');

    state.purchasingSearchQuery = '';
    state.purchasingCurrentPage = 1;

    const searchInput = document.getElementById('purchasingSearchInput');
    if (searchInput) searchInput.value = '';

    const selectStatus = document.getElementById('selectPurchasingStatus');
    if (selectStatus) selectStatus.value = 'all';
    state.currentPurchasingStatus = 'all';

    if (defaultJenis) {
        state.currentPurchasingJenis = defaultJenis;
        const btnAll = document.getElementById('tabBtnPrAll');
        const btnMat = document.getElementById('tabBtnPrMaterial');
        const btnNon = document.getElementById('tabBtnPrNonMaterial');
        if (btnAll) btnAll.classList.toggle('active', defaultJenis === 'all');
        if (btnMat) btnMat.classList.toggle('active', defaultJenis === 'material');
        if (btnNon) btnNon.classList.toggle('active', defaultJenis === 'non_material');
    }

    setPurchasingQuickDate(range);
}

/**
 * Tutup Modal Purchasing
 */
function closePurchasingModal() {
    const modal = document.getElementById('purchasingModal');
    if (!modal) return;
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
}

/**
 * Mengatur rentang tanggal cepat (Bulan Ini, 7 Hari, Hari Ini, Semua)
 */
function setPurchasingQuickDate(preset = 'month') {
    state.currentPurchasingRange = preset;
    state.purchasingCurrentPage = 1;

    const now = new Date();
    const today = formatPurchasingDate(now);
    let startDate = today;
    let endDate = today;

    if (preset === 'month') {
        startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        endDate = today;
    } else if (preset === 'week') {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        startDate = formatPurchasingDate(d);
        endDate = today;
    } else if (preset === 'today') {
        startDate = today;
        endDate = today;
    } else if (preset === 'all') {
        startDate = '2026-01-01';
        endDate = today;
    }

    state.purchasingDateStart = startDate;
    state.purchasingDateEnd = endDate;

    // Sinkronisasi ke input DOM
    const startInput = document.getElementById('purchasingDateStart');
    const endInput = document.getElementById('purchasingDateEnd');
    if (startInput) startInput.value = startDate;
    if (endInput) endInput.value = endDate;

    // Update active class pada pill
    const pills = document.querySelectorAll('.purchasing-range-pills .filter-pill');
    pills.forEach(p => p.classList.remove('active'));

    const btnMap = {
        'month': 'btnQuickPurchasingMonth',
        'week': 'btnQuickPurchasingWeek',
        'today': 'btnQuickPurchasingToday',
        'all': 'btnQuickPurchasingAll'
    };
    const activeBtn = document.getElementById(btnMap[preset]);
    if (activeBtn) activeBtn.classList.add('active');

    loadPurchasingData();
}

/**
 * Handle perubahan tanggal manual pada input Date Picker Purchasing
 */
function handlePurchasingDateChange(field) {
    const startInput = document.getElementById('purchasingDateStart');
    const endInput = document.getElementById('purchasingDateEnd');

    if (!startInput || !endInput) return;

    let start = startInput.value;
    let end = endInput.value;

    if (start && end && start > end) {
        if (field === 'start') {
            endInput.value = start;
            end = start;
        } else {
            startInput.value = end;
            start = end;
        }
    }

    state.purchasingDateStart = start;
    state.purchasingDateEnd = end;
    state.currentPurchasingRange = 'custom';
    state.purchasingCurrentPage = 1;

    // Hapus active pill preset
    const pills = document.querySelectorAll('.purchasing-range-pills .filter-pill');
    pills.forEach(p => p.classList.remove('active'));

    loadPurchasingData();
}

/**
 * Reset seluruh filter Purchasing ke default (Bulan Ini)
 */
function resetPurchasingFilter() {
    state.purchasingSearchQuery = '';
    state.currentPurchasingStatus = 'all';
    state.currentPurchasingJenis = 'all';
    state.purchasingCurrentPage = 1;

    const searchInput = document.getElementById('purchasingSearchInput');
    if (searchInput) searchInput.value = '';

    const selectStatus = document.getElementById('selectPurchasingStatus');
    if (selectStatus) selectStatus.value = 'all';

    const btnAll = document.getElementById('tabBtnPrAll');
    const btnMat = document.getElementById('tabBtnPrMaterial');
    const btnNon = document.getElementById('tabBtnPrNonMaterial');
    if (btnAll) btnAll.classList.add('active');
    if (btnMat) btnMat.classList.remove('active');
    if (btnNon) btnNon.classList.remove('active');

    setPurchasingQuickDate('month');
}

/**
 * Alias kompatibilitas fungsi lama
 */
function switchPurchasingRange(range) {
    setPurchasingQuickDate(range);
}

/**
 * Mengganti filter Jenis PR (all, material, non_material)
 */
function switchPurchasingJenis(jenis) {
    state.currentPurchasingJenis = jenis;
    state.purchasingCurrentPage = 1;

    const btnAll = document.getElementById('tabBtnPrAll');
    const btnMat = document.getElementById('tabBtnPrMaterial');
    const btnNon = document.getElementById('tabBtnPrNonMaterial');

    if (btnAll) btnAll.classList.toggle('active', jenis === 'all');
    if (btnMat) btnMat.classList.toggle('active', jenis === 'material');
    if (btnNon) btnNon.classList.toggle('active', jenis === 'non_material');

    if (state.purchasingRawData) {
        renderPurchasingModalData(state.purchasingRawData);
    }
}

/**
 * Mengganti filter status (all, terpenuhi, proses_po, parsial, pending, belum_terpenuhi)
 */
function switchPurchasingStatus(status) {
    state.currentPurchasingStatus = status;
    state.purchasingCurrentPage = 1;

    if (state.purchasingRawData) {
        renderPurchasingModalData(state.purchasingRawData);
    }
}

/**
 * Mengganti mode tampilan: Per No. PR ('pr') vs Rincian Item ('items')
 */
function switchPurchasingView(viewMode) {
    state.currentPurchasingView = viewMode;
    state.purchasingCurrentPage = 1;

    const btnPr = document.getElementById('btnViewPrGroup');
    const btnItems = document.getElementById('btnViewPrItems');
    const panelPr = document.getElementById('tabPanelPurchasingPr');
    const panelItems = document.getElementById('tabPanelPurchasingItems');

    if (btnPr) btnPr.classList.toggle('active', viewMode === 'pr');
    if (btnItems) btnItems.classList.toggle('active', viewMode === 'items');

    if (panelPr) panelPr.classList.toggle('active', viewMode === 'pr');
    if (panelItems) panelItems.classList.toggle('active', viewMode === 'items');

    updatePurchasingSortHeaders(viewMode);

    if (state.purchasingRawData) {
        renderPurchasingModalData(state.purchasingRawData);
    }
}

/**
 * Pencarian No PR / Barang secara realtime
 */
let purchasingSearchTimeout = null;
function handlePurchasingSearch(query) {
    clearTimeout(purchasingSearchTimeout);
    purchasingSearchTimeout = setTimeout(() => {
        state.purchasingSearchQuery = (query || '').trim().toLowerCase();
        state.purchasingCurrentPage = 1;
        if (state.purchasingRawData) {
            renderPurchasingModalData(state.purchasingRawData);
        }
    }, 200);
}

/**
 * Tombol Sinkronisasi Paksa dengan Atena ERP
 */
async function syncPurchasingData() {
    const syncBtn = document.getElementById('btnSyncPurchasing');
    const icon = syncBtn?.querySelector('i');
    if (icon) icon.classList.add('fa-spin');

    try {
        renderPurchasingTablesLoading();
        const res = await fetch('/api/dashboard/purchasing/sync', { method: 'POST' });
        const json = await res.json();
        if (json.success && json.data) {
            state.purchasingCache.clear();
            state.purchasingRawData = json.data;
            renderPurchasingModalData(json.data);
            // Refresh statistik dashboard utama
            fetchDashboardStats(true);
        } else {
            throw new Error(json.message || 'Gagal sinkronisasi data');
        }
    } catch (err) {
        console.error('Error sync purchasing:', err);
        renderPurchasingTablesError(err.message);
    } finally {
        if (icon) {
            setTimeout(() => icon.classList.remove('fa-spin'), 600);
        }
    }
}

/**
 * Muat data purchasing dari API
 */
async function loadPurchasingData(force = false) {
    let url = '/api/dashboard/purchasing?';
    if (state.purchasingDateStart && state.purchasingDateEnd) {
        url += `tglawal=${encodeURIComponent(state.purchasingDateStart)}&tglakhir=${encodeURIComponent(state.purchasingDateEnd)}`;
    } else {
        url += `range=${encodeURIComponent(state.currentPurchasingRange)}`;
    }
    if (force) url += '&force=true';

    const cacheKey = `purchasing_${state.purchasingDateStart}_${state.purchasingDateEnd}_${state.currentPurchasingRange}`;

    if (!force && state.purchasingCache.has(cacheKey)) {
        const cached = state.purchasingCache.get(cacheKey);
        state.purchasingRawData = cached.data;
        renderPurchasingModalData(cached.data);
        if (Date.now() - cached.timestamp < 30000) return;
    } else {
        renderPurchasingTablesLoading();
    }

    try {
        const res = await fetch(url);
        const result = await res.json();

        if (!result.success || !result.data) {
            throw new Error(result.message || 'Gagal mengambil data monitoring purchasing');
        }

        state.purchasingCache.set(cacheKey, { data: result.data, timestamp: Date.now() });
        state.purchasingRawData = result.data;
        renderPurchasingModalData(result.data);

    } catch (err) {
        console.error('Error memuat data purchasing:', err);
        renderPurchasingTablesError(err.message);
    }
}

/**
 * Render semua elemen di Modal Purchasing berdasarkan state filter
 */
function renderPurchasingModalData(data) {
    if (!data) return;

    const kpi = data.kpi || {};
    const meta = data.meta || {};

    // 1. Tampilkan KPI Top Grid
    const elTotalPr = document.getElementById('modalKpiTotalPr');
    const elTerpenuhi = document.getElementById('modalKpiPrTerpenuhi');
    const elPercent = document.getElementById('modalKpiPrPercent');
    const elMatTerpenuhi = document.getElementById('modalKpiMatTerpenuhi');
    const elMatPercent = document.getElementById('modalKpiMatPercent');
    const elNonMatTerpenuhi = document.getElementById('modalKpiNonMatTerpenuhi');
    const elNonMatPercent = document.getElementById('modalKpiNonMatPercent');
    const elPending = document.getElementById('modalKpiPrPending');

    if (elTotalPr) elTotalPr.textContent = Number(kpi.total_pr || 0).toLocaleString('id-ID');
    if (elTerpenuhi) elTerpenuhi.textContent = Number(kpi.pr_terpenuhi || 0).toLocaleString('id-ID');
    if (elPercent) elPercent.textContent = `${kpi.persentase_selesai || 0}%`;
    if (elMatTerpenuhi) elMatTerpenuhi.textContent = Number(kpi.material?.pr_terpenuhi || 0).toLocaleString('id-ID');
    if (elMatPercent) elMatPercent.textContent = `${kpi.material?.persentase || 0}%`;
    if (elNonMatTerpenuhi) elNonMatTerpenuhi.textContent = Number(kpi.non_material?.pr_terpenuhi || 0).toLocaleString('id-ID');
    if (elNonMatPercent) elNonMatPercent.textContent = `${kpi.non_material?.persentase || 0}%`;
    if (elPending) elPending.textContent = Number(kpi.pr_pending || 0).toLocaleString('id-ID');

    // 2. Tampilkan Counter Tab Jenis PR
    const countAllEl = document.getElementById('countPrAll');
    const countMatEl = document.getElementById('countPrMaterial');
    const countNonMatEl = document.getElementById('countPrNonMaterial');

    if (countAllEl) countAllEl.textContent = `${kpi.total_pr || 0}`;
    if (countMatEl) countMatEl.textContent = `${kpi.material?.total_pr || 0}`;
    if (countNonMatEl) countNonMatEl.textContent = `${kpi.non_material?.total_pr || 0}`;

    // 3. Tampilkan Info Terakhir Sinkronisasi
    const syncTimeEl = document.getElementById('purchasingLastSyncTime');
    if (syncTimeEl) {
        if (meta.sync_time) {
            const d = new Date(meta.sync_time);
            syncTimeEl.textContent = `• Sinkronisasi: ${d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB`;
        } else if (meta.generated_at) {
            const d = new Date(meta.generated_at);
            syncTimeEl.textContent = `• Diperbarui: ${d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB`;
        }
    }

    // 4. Filter List PR dan Item
    const q = state.purchasingSearchQuery;
    const jenis = state.currentPurchasingJenis;
    const status = state.currentPurchasingStatus;

    // Filter daftar PR
    let prList = (data.summary_by_pr || []).filter(pr => {
        // Filter Jenis
        if (jenis !== 'all' && pr.jenis_code !== jenis) return false;
        // Filter Status
        if (status !== 'all') {
            if (status === 'belum_terpenuhi') {
                if (pr.status_code === 'terpenuhi') return false;
            } else if (pr.status_code !== status) {
                return false;
            }
        }
        // Filter Search
        if (q) {
            const matchPr = pr.no_pr && pr.no_pr.toLowerCase().includes(q);
            const matchItem = (pr.items || []).some(i =>
                (i.kode_barang && i.kode_barang.toLowerCase().includes(q)) ||
                (i.nama_barang && i.nama_barang.toLowerCase().includes(q))
            );
            if (!matchPr && !matchItem) return false;
        }
        return true;
    });

    // Filter daftar Item
    let itemList = (data.items || []).filter(item => {
        // Filter Jenis
        if (jenis !== 'all' && item.jenis_code !== jenis) return false;
        // Filter Status
        if (status !== 'all') {
            if (status === 'belum_terpenuhi') {
                if (item.status_code === 'terpenuhi') return false;
            } else if (item.status_code !== status) {
                return false;
            }
        }
        // Filter Search
        if (q) {
            const matchPr = item.no_pr && item.no_pr.toLowerCase().includes(q);
            const matchKode = item.kode_barang && item.kode_barang.toLowerCase().includes(q);
            const matchNama = item.nama_barang && item.nama_barang.toLowerCase().includes(q);
            if (!matchPr && !matchKode && !matchNama) return false;
        }
        return true;
    });

    // 5. Urutkan Data (Sorting Ascending / Descending)
    const prSort = state.purchasingSort?.pr || { column: 'tanggal', dir: 'desc' };
    if (prSort.column) {
        const col = prSort.column;
        const dir = prSort.dir === 'asc' ? 1 : -1;
        prList.sort((a, b) => {
            let valA = a[col];
            let valB = b[col];

            if (col === 'status_code') {
                valA = a.status_code === 'terpenuhi' ? 1 : 0;
                valB = b.status_code === 'terpenuhi' ? 1 : 0;
                return (valA - valB) * dir;
            }

            if (col === 'tanggal') {
                return String(valA || '').localeCompare(String(valB || '')) * dir;
            }

            if (typeof valA === 'number' || typeof valB === 'number') {
                return ((valA || 0) - (valB || 0)) * dir;
            }

            return String(valA || '').localeCompare(String(valB || ''), 'id', { numeric: true, sensitivity: 'base' }) * dir;
        });
    }

    const itemSort = state.purchasingSort?.items || { column: 'tanggal', dir: 'desc' };
    if (itemSort.column) {
        const col = itemSort.column;
        const dir = itemSort.dir === 'asc' ? 1 : -1;
        itemList.sort((a, b) => {
            let valA = a[col];
            let valB = b[col];

            if (col === 'status_code') {
                valA = a.status_code === 'terpenuhi' ? 1 : 0;
                valB = b.status_code === 'terpenuhi' ? 1 : 0;
                return (valA - valB) * dir;
            }

            if (col === 'tanggal') {
                return String(valA || '').localeCompare(String(valB || '')) * dir;
            }

            if (col === 'progress_percent') {
                valA = getItemProgressPercent(a);
                valB = getItemProgressPercent(b);
                return (valA - valB) * dir;
            }

            if (typeof valA === 'number' || typeof valB === 'number') {
                return ((valA || 0) - (valB || 0)) * dir;
            }

            return String(valA || '').localeCompare(String(valB || ''), 'id', { numeric: true, sensitivity: 'base' }) * dir;
        });
    }

    // Perbarui Icon Header yang Aktif
    updatePurchasingSortHeaders(state.currentPurchasingView);

    // 6. Render sesuai mode tampilan aktif
    if (state.currentPurchasingView === 'pr') {
        renderPurchasingPrTable(prList);
    } else {
        renderPurchasingItemsTable(itemList);
    }
}

/**
 * Hitung persentase pemenuhan item berdasarkan Realisasi GRS dan Sisa OS (Outstanding)
 * Rumus: (Realisasi GRS / (Realisasi GRS + Sisa OS)) * 100%
 * Catatan: Pemenuhan hanya ada pada rincian per item, tidak pada level per PR.
 */
function getItemProgressPercent(item) {
    if (!item) return 0;
    const grs = Number(item.qty_grs || 0);
    const os = Number(item.qty_os || 0);
    const total = grs + os;
    if (total > 0) {
        return Math.min(100, Math.max(0, Number(((grs / total) * 100).toFixed(1))));
    }
    if (grs > 0 && os <= 0) return 100;
    return 0;
}

/**
 * Render Tabel Rangkuman Per No. PR
 */
function renderPurchasingPrTable(prList) {
    const tbody = document.getElementById('purchasingPrTableBody');
    const footerStats = document.getElementById('purchasingModalFooterStats');
    const pageInfo = document.getElementById('purchasingPageInfo');
    const btnPrev = document.getElementById('btnPurchasingPrevPage');
    const btnNext = document.getElementById('btnPurchasingNextPage');

    if (!tbody) return;

    if (prList.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="10" class="loading-state" style="color: var(--text-muted); padding: 2.5rem 1rem;">
                    <i class="fa-solid fa-inbox" style="font-size: 1.8rem; margin-bottom: 0.5rem; display: block; color: #cbd5e1;"></i>
                    Tidak ada data Purchase Request yang sesuai dengan filter.
                </td>
            </tr>
        `;
        if (footerStats) footerStats.textContent = 'Menampilkan 0 No. PR';
        if (pageInfo) pageInfo.textContent = 'Halaman 1 dari 1';
        if (btnPrev) btnPrev.disabled = true;
        if (btnNext) btnNext.disabled = true;
        return;
    }

    const pageSize = state.purchasingPageSize;
    const totalPages = Math.ceil(prList.length / pageSize);
    if (state.purchasingCurrentPage > totalPages) state.purchasingCurrentPage = totalPages;
    if (state.purchasingCurrentPage < 1) state.purchasingCurrentPage = 1;

    const startIndex = (state.purchasingCurrentPage - 1) * pageSize;
    const pageItems = prList.slice(startIndex, startIndex + pageSize);

    let html = '';
    pageItems.forEach((pr, idx) => {
        const rowNo = startIndex + idx + 1;

        let badgeStatusHtml = '';
        if (pr.status_code === 'terpenuhi') {
            badgeStatusHtml = `<span class="badge-status-terpenuhi"><i class="fa-solid fa-circle-check"></i> Sudah PO / GRS</span>`;
        } else {
            badgeStatusHtml = `<span class="badge-status-pending"><i class="fa-solid fa-hourglass-start"></i> Belum PO</span>`;
        }

        const badgeJenisHtml = pr.jenis_code === 'material'
            ? `<span class="badge-mat"><i class="fa-solid fa-cube"></i> Material</span>`
            : `<span class="badge-nonmat"><i class="fa-solid fa-tag"></i> Non-Mat</span>`;

        html += `
            <tr>
                <td class="text-center" style="color: var(--text-muted); font-size: 0.78rem;">${rowNo}</td>
                <td>
                    <span class="ticket-number" style="font-weight: 700; cursor: pointer; white-space: nowrap;" onclick="filterToSinglePr('${escapeHtml(pr.no_pr)}')">
                        ${escapeHtml(pr.no_pr)}
                    </span>
                </td>
                <td style="font-size: 0.78rem; color: var(--text-secondary); white-space: nowrap;">${escapeHtml(pr.tanggal_label || pr.tanggal)}</td>
                <td class="text-center">${badgeJenisHtml}</td>
                <td class="text-center" style="font-weight: 600;">${pr.item_count}</td>
                <td class="text-right" style="font-weight: 600; white-space: nowrap;">${Number(pr.total_request || 0).toLocaleString('id-ID')}</td>
                <td class="text-right" style="color: #2563eb; white-space: nowrap;">${Number(pr.total_po || 0).toLocaleString('id-ID')}</td>
                <td class="text-right" style="color: #16a34a; font-weight: 600; white-space: nowrap;">${Number(pr.total_grs || 0).toLocaleString('id-ID')}</td>
                <td class="text-right" style="color: ${pr.total_os > 0 ? '#dc2626' : '#16a34a'}; font-weight: 600; white-space: nowrap;">
                    ${Number(pr.total_os || 0).toLocaleString('id-ID')}
                </td>
                <td class="text-center" style="white-space: nowrap;">${badgeStatusHtml}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;

    if (footerStats) {
        footerStats.textContent = `Menampilkan ${startIndex + 1}-${Math.min(startIndex + pageSize, prList.length)} dari ${prList.length} No. PR`;
    }
    if (pageInfo) {
        pageInfo.textContent = `Halaman ${state.purchasingCurrentPage} dari ${totalPages} (${prList.length} PR)`;
    }
    if (btnPrev) btnPrev.disabled = state.purchasingCurrentPage <= 1;
    if (btnNext) btnNext.disabled = state.purchasingCurrentPage >= totalPages;
}

/**
 * Render Tabel Rincian Semua Item
 */
function renderPurchasingItemsTable(itemList) {
    const tbody = document.getElementById('purchasingItemsTableBody');
    const footerStats = document.getElementById('purchasingModalFooterStats');
    const pageInfo = document.getElementById('purchasingPageInfo');
    const btnPrev = document.getElementById('btnPurchasingPrevPage');
    const btnNext = document.getElementById('btnPurchasingNextPage');

    if (!tbody) return;

    if (itemList.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="13" class="loading-state" style="color: var(--text-muted); padding: 2.5rem 1rem;">
                    <i class="fa-solid fa-inbox" style="font-size: 1.8rem; margin-bottom: 0.5rem; display: block; color: #cbd5e1;"></i>
                    Tidak ada baris item yang sesuai dengan filter.
                </td>
            </tr>
        `;
        if (footerStats) footerStats.textContent = 'Menampilkan 0 Item';
        if (pageInfo) pageInfo.textContent = 'Halaman 1 dari 1';
        if (btnPrev) btnPrev.disabled = true;
        if (btnNext) btnNext.disabled = true;
        return;
    }

    const pageSize = state.purchasingPageSize;
    const totalPages = Math.ceil(itemList.length / pageSize);
    if (state.purchasingCurrentPage > totalPages) state.purchasingCurrentPage = totalPages;
    if (state.purchasingCurrentPage < 1) state.purchasingCurrentPage = 1;

    const startIndex = (state.purchasingCurrentPage - 1) * pageSize;
    const pageItems = itemList.slice(startIndex, startIndex + pageSize);

    let html = '';
    pageItems.forEach((item, idx) => {
        const rowNo = startIndex + idx + 1;

        let badgeStatusHtml = '';
        if (item.status_code === 'terpenuhi') {
            badgeStatusHtml = `<span class="badge-status-terpenuhi"><i class="fa-solid fa-check"></i> Sudah PO / GRS</span>`;
        } else {
            badgeStatusHtml = `<span class="badge-status-pending">Belum PO</span>`;
        }

        const badgeJenisHtml = item.jenis_code === 'material'
            ? `<span class="badge-mat">Material</span>`
            : `<span class="badge-nonmat">Non-Mat</span>`;

        // Persentase Pemenuhan Item berdasarkan Realisasi GRS dan Sisa OS
        const progressVal = getItemProgressPercent(item);
        const progressCls = progressVal >= 100 ? 'fill-complete' : '';

        html += `
            <tr>
                <td class="text-center" style="color: var(--text-muted); font-size: 0.78rem;">${rowNo}</td>
                <td>
                    <span class="ticket-number" style="font-size: 0.78rem; white-space: nowrap;">${escapeHtml(item.no_pr)}</span>
                </td>
                <td style="font-size: 0.78rem; color: var(--text-secondary); white-space: nowrap;">${escapeHtml(item.tanggal)}</td>
                <td class="text-center">${badgeJenisHtml}</td>
                <td style="font-family: var(--font-mono); font-size: 0.74rem; color: var(--text-muted); white-space: nowrap;">${escapeHtml(item.kode_barang)}</td>
                <td style="font-weight: 600; color: var(--text-primary); font-size: 0.78rem; line-height: 1.35; word-break: break-word;">
                    ${escapeHtml(item.nama_barang)}
                </td>
                <td class="text-center"><span class="badge-status badge-draft" style="font-size: 0.68rem; padding: 1px 5px;">${escapeHtml(item.satuan || 'PCS')}</span></td>
                <td class="text-right" style="font-weight: 600; white-space: nowrap;">${Number(item.qty_request || 0).toLocaleString('id-ID')}</td>
                <td class="text-right" style="color: #2563eb; white-space: nowrap;">${Number(item.qty_po || 0).toLocaleString('id-ID')}</td>
                <td class="text-right" style="color: #16a34a; font-weight: 600; white-space: nowrap;">${Number(item.qty_grs || 0).toLocaleString('id-ID')}</td>
                <td class="text-right" style="color: ${item.qty_os > 0 ? '#dc2626' : '#16a34a'}; font-weight: 600; white-space: nowrap;">
                    ${Number(item.qty_os || 0).toLocaleString('id-ID')}
                </td>
                <td style="min-width: 80px;">
                    <div style="display: flex; justify-content: space-between; font-size: 0.72rem; font-weight: 700; color: var(--text-muted); margin-bottom: 2px;">
                        <span>${progressVal}%</span>
                    </div>
                    <div class="pr-progress-track">
                        <div class="pr-progress-fill ${progressCls}" style="width: ${Math.min(100, progressVal)}%;"></div>
                    </div>
                </td>
                <td class="text-center" style="white-space: nowrap;">${badgeStatusHtml}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;

    if (footerStats) {
        footerStats.textContent = `Menampilkan ${startIndex + 1}-${Math.min(startIndex + pageSize, itemList.length)} dari ${itemList.length} Item`;
    }
    if (pageInfo) {
        pageInfo.textContent = `Halaman ${state.purchasingCurrentPage} dari ${totalPages} (${itemList.length} Item)`;
    }
    if (btnPrev) btnPrev.disabled = state.purchasingCurrentPage <= 1;
    if (btnNext) btnNext.disabled = state.purchasingCurrentPage >= totalPages;
}

/**
 * Filter langsung ke single PR saat No PR diklik
 */
function filterToSinglePr(noPr) {
    const searchInput = document.getElementById('purchasingSearchInput');
    if (searchInput) searchInput.value = noPr;
    state.purchasingSearchQuery = (noPr || '').toLowerCase();
    switchPurchasingView('items');
}

/**
 * Navigasi ganti halaman
 */
function changePurchasingPage(delta) {
    state.purchasingCurrentPage += delta;
    if (state.purchasingRawData) {
        renderPurchasingModalData(state.purchasingRawData);
    }
}

/**
 * Animasi skeleton loading tabel purchasing
 */
function renderPurchasingTablesLoading() {
    const prTbody = document.getElementById('purchasingPrTableBody');
    const itemsTbody = document.getElementById('purchasingItemsTableBody');

    const skeletonPr = Array(6).fill(0).map(() => `
        <tr class="skeleton-row">
            <td class="text-center"><span class="skeleton-box" style="width: 20px; height: 16px;"></span></td>
            <td><span class="skeleton-box" style="width: 100px; height: 16px;"></span></td>
            <td><span class="skeleton-box" style="width: 80px; height: 14px;"></span></td>
            <td><span class="skeleton-pill" style="width: 70px;"></span></td>
            <td class="text-center"><span class="skeleton-box" style="width: 30px; height: 14px;"></span></td>
            <td class="text-right"><span class="skeleton-box" style="width: 60px; height: 14px;"></span></td>
            <td class="text-right"><span class="skeleton-box" style="width: 60px; height: 14px;"></span></td>
            <td class="text-right"><span class="skeleton-box" style="width: 60px; height: 14px;"></span></td>
            <td class="text-right"><span class="skeleton-box" style="width: 60px; height: 14px;"></span></td>
            <td class="text-center"><span class="skeleton-badge" style="width: 70px;"></span></td>
        </tr>
    `).join('');

    const skeletonItems = Array(6).fill(0).map(() => `
        <tr class="skeleton-row">
            <td class="text-center"><span class="skeleton-box" style="width: 20px; height: 16px;"></span></td>
            <td><span class="skeleton-box" style="width: 95px; height: 16px;"></span></td>
            <td><span class="skeleton-box" style="width: 75px; height: 14px;"></span></td>
            <td><span class="skeleton-pill" style="width: 65px;"></span></td>
            <td><span class="skeleton-box" style="width: 60px; height: 14px;"></span></td>
            <td><span class="skeleton-box" style="width: 80%; height: 14px;"></span></td>
            <td class="text-center"><span class="skeleton-box" style="width: 40px; height: 14px;"></span></td>
            <td class="text-right"><span class="skeleton-box" style="width: 50px; height: 14px;"></span></td>
            <td class="text-right"><span class="skeleton-box" style="width: 50px; height: 14px;"></span></td>
            <td class="text-right"><span class="skeleton-box" style="width: 50px; height: 14px;"></span></td>
            <td class="text-right"><span class="skeleton-box" style="width: 50px; height: 14px;"></span></td>
            <td><span class="skeleton-box" style="width: 85px; height: 12px;"></span></td>
            <td class="text-center"><span class="skeleton-badge" style="width: 70px;"></span></td>
        </tr>
    `).join('');

    if (prTbody) prTbody.innerHTML = skeletonPr;
    if (itemsTbody) itemsTbody.innerHTML = skeletonItems;
}

/**
 * Tampilkan pesan error di tabel
 */
function renderPurchasingTablesError(msg) {
    ['purchasingPrTableBody', 'purchasingItemsTableBody'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.innerHTML = `
                <tr>
                    <td colspan="12" class="loading-state" style="color: #ef4444; padding: 2rem 1rem;">
                        <i class="fa-solid fa-circle-exclamation"></i> Gagal memuat data Purchasing: ${escapeHtml(msg)}
                    </td>
                </tr>
            `;
        }
    });
}

/**
 * Sorting Kolom Tabel Purchasing (Ascending / Descending)
 */
function sortPurchasing(viewMode, column) {
    if (!state.purchasingSort) {
        state.purchasingSort = {
            pr: { column: 'tanggal', dir: 'desc' },
            items: { column: 'tanggal', dir: 'desc' }
        };
    }

    const currentSort = state.purchasingSort[viewMode] || { column: 'tanggal', dir: 'desc' };

    if (currentSort.column === column) {
        // Toggle direction (asc <-> desc)
        currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
        // Ganti kolom baru
        currentSort.column = column;
        const numericCols = [
            'item_count', 'total_request', 'total_po', 'total_grs', 'total_os', 'progress_percent',
            'qty_request', 'qty_po', 'qty_grs', 'qty_os', 'tanggal'
        ];
        currentSort.dir = numericCols.includes(column) ? 'desc' : 'asc';
    }

    state.purchasingSort[viewMode] = currentSort;
    state.purchasingCurrentPage = 1;

    updatePurchasingSortHeaders(viewMode);

    if (state.purchasingRawData) {
        renderPurchasingModalData(state.purchasingRawData);
    }
}

/**
 * Update Icon dan Indikator Sorting pada Header Tabel Purchasing
 */
function updatePurchasingSortHeaders(viewMode) {
    const panelId = viewMode === 'pr' ? 'tabPanelPurchasingPr' : 'tabPanelPurchasingItems';
    const panel = document.getElementById(panelId);
    if (!panel) return;

    const currentSort = (state.purchasingSort && state.purchasingSort[viewMode])
        ? state.purchasingSort[viewMode]
        : { column: 'tanggal', dir: 'desc' };

    const headers = panel.querySelectorAll('th.sortable-th');
    headers.forEach(th => {
        const key = th.getAttribute('data-sort-key');
        const icon = th.querySelector('.sort-icon');
        if (key === currentSort.column) {
            th.classList.add('active-sort');
            if (icon) {
                icon.className = currentSort.dir === 'asc'
                    ? 'fa-solid fa-sort-up sort-icon'
                    : 'fa-solid fa-sort-down sort-icon';
            }
        } else {
            th.classList.remove('active-sort');
            if (icon) {
                icon.className = 'fa-solid fa-sort sort-icon';
            }
        }
    });
}

// ====================================================================
// 12. MODAL MONITORING PENYELESAIAN PP (PRODUKSI ATENA ERP)
// ====================================================================

const PRODUKSI_BAGIAN_MAP = {
    stentor: { name: 'Produksi Finishing', judul: 'Penyelesaian PP Stentor', unit: 'Meter / PCS', icon: 'fa-industry' },
    antiseptik: { name: 'Produksi Antiseptik', judul: 'Penyelesaian PP Packing', unit: 'Botol / PCS', icon: 'fa-pump-medical' },
    cw: { name: 'Produksi CW', judul: 'Penyelesaian PP CW Packing', unit: 'PCS', icon: 'fa-prescription-bottle' },
    sizing: { name: 'Produksi Sizing', judul: 'Penyelesaian PP Sizing', unit: 'Meter / Beam', icon: 'fa-ruler-combined' },
    poligyp: { name: 'Produksi Poligyp', judul: 'Penyelesaian PP Poligyp Packing', unit: 'Roll / PCS', icon: 'fa-bandage' },
    ironing: { name: 'Produksi Ironing', judul: 'Penyelesaian PP Ironing', unit: 'PCS / Meter', icon: 'fa-shirt' },
    surgicalpacking: { name: 'Produksi Surgical Packing', judul: 'Penyelesaian PP Surgical Packing', unit: 'Box / Karton', icon: 'fa-box-tissue' }
};

/**
 * Helper format tanggal YYYY-MM-DD
 */
function formatProdDate(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Buka Modal Monitoring Produksi Khusus untuk Satu Bagian Tertentu
 */
function openProduksiModal(bagian = 'stentor') {
    state.currentProduksiBagian = bagian;
    state.currentProduksiStatus = 'all';
    state.produksiSearchQuery = '';
    state.produksiCurrentPage = 1;

    const now = new Date();
    const today = formatProdDate(now);
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    // Pastikan container filter independen per lini bagian tersedia
    if (!state.produksiFilters) state.produksiFilters = {};

    // Ambil filter yang pernah disimpan khusus untuk lini bagian ini, atau default ke Bulan Ini
    const bagianFilter = state.produksiFilters[bagian] || {
        tglawal: monthStart,
        tglakhir: today,
        period: 'month'
    };

    state.produksiFilters[bagian] = bagianFilter;
    state.produksiTglAwal = bagianFilter.tglawal;
    state.produksiTglAkhir = bagianFilter.tglakhir;
    state.currentProduksiPeriod = bagianFilter.period;

    const startInput = document.getElementById('prodDateStart');
    const endInput = document.getElementById('prodDateEnd');
    if (startInput) startInput.value = state.produksiTglAwal;
    if (endInput) endInput.value = state.produksiTglAkhir;

    const searchInput = document.getElementById('produksiSearchInput');
    if (searchInput) searchInput.value = '';

    const modal = document.getElementById('produksiModal');
    if (modal) {
        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
    }

    updateProduksiQuickPills(state.currentProduksiPeriod);
    updateProduksiStatusPills('all');
    fetchProduksiDetail(bagian, state.produksiTglAwal, state.produksiTglAkhir);
}

/**
 * Tutup Modal Monitoring Produksi
 */
function closeProduksiModal() {
    const modal = document.getElementById('produksiModal');
    if (modal) {
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
    }
}

/**
 * Tombol shortcut cepat rentang tanggal: 'month', 'today', 'week'
 */
function setProduksiQuickDate(preset) {
    const now = new Date();
    const today = formatProdDate(now);
    let tglawal = today;
    let tglakhir = today;

    if (preset === 'month') {
        tglawal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        tglakhir = today;
    } else if (preset === 'today') {
        tglawal = today;
        tglakhir = today;
    } else if (preset === 'week') {
        const weekAgo = new Date();
        weekAgo.setDate(now.getDate() - 7);
        tglawal = formatProdDate(weekAgo);
        tglakhir = today;
    } else if (preset === 'all') {
        tglawal = '2026-01-01';
        tglakhir = today;
    }

    state.produksiTglAwal = tglawal;
    state.produksiTglAkhir = tglakhir;
    state.currentProduksiPeriod = preset;
    state.produksiCurrentPage = 1;

    // Simpan filter khusus untuk lini bagian yang sedang aktif saja (terisolasi)
    if (!state.produksiFilters) state.produksiFilters = {};
    state.produksiFilters[state.currentProduksiBagian] = {
        tglawal,
        tglakhir,
        period: preset
    };

    const startInput = document.getElementById('prodDateStart');
    const endInput = document.getElementById('prodDateEnd');
    if (startInput) startInput.value = tglawal;
    if (endInput) endInput.value = tglakhir;

    updateProduksiQuickPills(preset);
    fetchProduksiDetail(state.currentProduksiBagian, tglawal, tglakhir);
}

/**
 * Auto-filter saat input Date Picker berubah (onchange)
 */
function handleProduksiDateChange(changedField) {
    const startInput = document.getElementById('prodDateStart');
    const endInput = document.getElementById('prodDateEnd');

    let tglawal = startInput ? startInput.value : '';
    let tglakhir = endInput ? endInput.value : '';

    if (!tglawal || !tglakhir) return;

    // Jika tglawal lebih besar dari tglakhir, sesuaikan otomatis field pasangannya
    if (tglawal > tglakhir) {
        if (changedField === 'start') {
            tglakhir = tglawal;
            if (endInput) endInput.value = tglakhir;
        } else {
            tglawal = tglakhir;
            if (startInput) startInput.value = tglawal;
        }
    }

    // Jika rentang tidak berubah, abaikan
    if (state.produksiTglAwal === tglawal && state.produksiTglAkhir === tglakhir && state.currentProduksiPeriod === 'custom') {
        return;
    }

    state.produksiTglAwal = tglawal;
    state.produksiTglAkhir = tglakhir;
    state.currentProduksiPeriod = 'custom';
    state.produksiCurrentPage = 1;

    // Simpan filter khusus untuk lini bagian yang sedang aktif saja (terisolasi)
    if (!state.produksiFilters) state.produksiFilters = {};
    state.produksiFilters[state.currentProduksiBagian] = {
        tglawal,
        tglakhir,
        period: 'custom'
    };

    updateProduksiQuickPills('custom');
    fetchProduksiDetail(state.currentProduksiBagian, tglawal, tglakhir);
}

/**
 * Terapkan rentang tanggal dari input Date Picker (kompatibilitas)
 */
function applyProduksiDateRange() {
    handleProduksiDateChange();
}

/**
 * Reset Filter Modal Produksi kembali ke default (Bulan Ini, status Semua, hapus pencarian)
 */
function resetProduksiFilter() {
    const now = new Date();
    const today = formatProdDate(now);
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    state.produksiTglAwal = monthStart;
    state.produksiTglAkhir = today;
    state.currentProduksiPeriod = 'month';
    state.currentProduksiStatus = 'all';
    state.produksiSearchQuery = '';
    state.produksiCurrentPage = 1;

    // Reset filter lini bagian yang aktif kembali ke default Bulan Ini
    if (!state.produksiFilters) state.produksiFilters = {};
    state.produksiFilters[state.currentProduksiBagian] = {
        tglawal: monthStart,
        tglakhir: today,
        period: 'month'
    };

    const startInput = document.getElementById('prodDateStart');
    const endInput = document.getElementById('prodDateEnd');
    if (startInput) startInput.value = monthStart;
    if (endInput) endInput.value = today;

    const searchInput = document.getElementById('produksiSearchInput');
    if (searchInput) searchInput.value = '';

    updateProduksiQuickPills('month');
    updateProduksiStatusPills('all');
    fetchProduksiDetail(state.currentProduksiBagian, monthStart, today);
}

/**
 * Update tombol filter preset cepat di modal
 */
function updateProduksiQuickPills(activePreset) {
    const presets = [
        { id: 'btnQuickProdMonth', key: 'month' },
        { id: 'btnQuickProdWeek', key: 'week' },
        { id: 'btnQuickProdToday', key: 'today' },
        { id: 'btnQuickProdAll', key: 'all' }
    ];
    presets.forEach(p => {
        const btn = document.getElementById(p.id);
        if (btn) {
            if (p.key === activePreset) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        }
    });
}

/**
 * Filter status di modal Produksi (all / memenuhi / belum)
 */
function filterProduksiStatus(status) {
    state.currentProduksiStatus = status;
    state.produksiCurrentPage = 1;
    updateProduksiStatusPills(status);
    if (state.produksiRawData) {
        renderProduksiUI(state.produksiRawData);
    }
}

/**
 * Update tombol filter status (Semua / Memenuhi / Belum)
 */
function updateProduksiStatusPills(activeStatus) {
    const pills = [
        { id: 'btnFilterProdAll', status: 'all' },
        { id: 'btnFilterProdMemenuhi', status: 'memenuhi' },
        { id: 'btnFilterProdBelum', status: 'belum' }
    ];
    pills.forEach(p => {
        const btn = document.getElementById(p.id);
        if (btn) {
            if (p.status === activeStatus) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        }
    });
}

/**
 * Debounce pencarian nomor PP / nama barang
 */
let produksiSearchDebounce = null;
function handleProduksiSearch(val) {
    clearTimeout(produksiSearchDebounce);
    produksiSearchDebounce = setTimeout(() => {
        state.produksiSearchQuery = (val || '').trim().toLowerCase();
        state.produksiCurrentPage = 1;
        if (state.produksiRawData) {
            renderProduksiUI(state.produksiRawData);
        }
    }, 250);
}

/**
 * Mengambil detail data lini produksi dari API dengan rentang tanggal
 */
async function fetchProduksiDetail(bagian, tglawal, tglakhir, force = false) {
    renderProduksiSkeleton();

    const cacheKey = `${bagian}_${tglawal}_${tglakhir}`;
    if (!force && state.produksiCache.has(cacheKey)) {
        const cached = state.produksiCache.get(cacheKey);
        if (Date.now() - cached.timestamp < 30000) {
            state.produksiRawData = cached.data;
            renderProduksiUI(cached.data);
            return;
        }
    }

    try {
        let url = `/api/dashboard/produksi?bagian=${encodeURIComponent(bagian)}`;
        if (tglawal) url += `&tglawal=${encodeURIComponent(tglawal)}`;
        if (tglakhir) url += `&tglakhir=${encodeURIComponent(tglakhir)}`;
        if (force) url += '&force=true';

        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = await res.json();

        if (!result.success || !result.data) {
            throw new Error(result.message || 'Gagal mengambil data');
        }

        state.produksiRawData = result.data;
        state.produksiCache.set(cacheKey, { data: result.data, timestamp: Date.now() });
        renderProduksiUI(result.data);

        // Update jam sync
        const lastSyncEl = document.getElementById('produksiLastSyncTime');
        if (lastSyncEl) {
            lastSyncEl.textContent = `Sinkron: ${new Date().toLocaleTimeString('id-ID')}`;
        }
    } catch (err) {
        console.error('[PRODUKSI MODAL ERROR]:', err);
        const tbody = document.getElementById('produksiTableBody');
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="11" class="text-center py-4 text-danger">
                        <i class="fa-solid fa-circle-exclamation"></i> Gagal memuat data dari Atena ERP (${err.message}).
                        <button class="filter-pill" style="margin-left: 8px;" onclick="fetchProduksiDetail('${bagian}', '${tglawal}', '${tglakhir}', true)">
                            <i class="fa-solid fa-rotate-right"></i> Coba Lagi
                        </button>
                    </td>
                </tr>
            `;
        }
    }
}

/**
 * Sinkronisasi ulang data produksi langsung ke backend
 */
async function syncProduksiData() {
    const btn = document.getElementById('btnSyncProduksi');
    const icon = btn ? btn.querySelector('i') : null;
    if (icon) icon.classList.add('fa-spin');

    try {
        state.produksiCache.clear();
        await fetch('/api/dashboard/produksi/sync', { method: 'POST' });
        await fetchProduksiDetail(state.currentProduksiBagian, state.produksiTglAwal, state.produksiTglAkhir, true);
        await fetchDashboardStats();
    } catch (err) {
        console.error('Sync Produksi Error:', err);
    } finally {
        if (icon) icon.classList.remove('fa-spin');
    }
}

/**
 * Render Skeleton Loading pada Tabel Produksi
 */
function renderProduksiSkeleton() {
    const tbody = document.getElementById('produksiTableBody');
    if (!tbody) return;

    let html = '';
    for (let i = 0; i < 5; i++) {
        html += `
            <tr class="skeleton-row">
                <td class="text-center"><span class="skeleton-box" style="width: 20px; height: 16px;"></span></td>
                <td><span class="skeleton-box" style="width: 95px; height: 16px;"></span></td>
                <td><span class="skeleton-pill" style="width: 70px;"></span></td>
                <td><span class="skeleton-box" style="width: 60px; height: 14px;"></span></td>
                <td><span class="skeleton-box" style="width: 80%; height: 14px;"></span></td>
                <td class="text-center"><span class="skeleton-box" style="width: 120px; height: 14px;"></span></td>
                <td class="text-right"><span class="skeleton-box" style="width: 60px; height: 14px;"></span></td>
                <td class="text-right"><span class="skeleton-box" style="width: 60px; height: 14px;"></span></td>
                <td class="text-center"><span class="skeleton-box" style="width: 45px; height: 14px;"></span></td>
                <td><span class="skeleton-box" style="width: 90px; height: 12px;"></span></td>
                <td class="text-center"><span class="skeleton-badge" style="width: 85px;"></span></td>
            </tr>
        `;
    }
    tbody.innerHTML = html;
}

/**
 * Render seluruh elemen Modal Produksi (KPI boxes, tabel, pagination)
 */
function renderProduksiUI(payload) {
    if (!payload) return;

    const ringkasan = payload.ringkasan || {};
    const cfg = payload.config || PRODUKSI_BAGIAN_MAP[payload.bagian] || {};

    // 1. Header Title, Subtitle, & Lini Badge
    const titleEl = document.getElementById('produksiModalTitle');
    const subtitleEl = document.getElementById('produksiModalSubtitle');
    const deptBadgeText = document.getElementById('modalDeptBadgeText');
    const deptBadgeIcon = document.getElementById('modalDeptBadgeIcon');
    const periodBadgeText = document.getElementById('modalPeriodBadgeText');

    if (titleEl) {
        titleEl.textContent = cfg.name ? `Monitoring ${cfg.name}` : (ringkasan.judul || 'Monitoring Produksi');
    }
    if (subtitleEl) {
        subtitleEl.textContent = `Perbandingan Target Plan vs Realisasi Actual Atena ERP • ${cfg.judul || 'Penyelesaian PP'}`;
    }
    if (deptBadgeText) {
        deptBadgeText.textContent = cfg.name || 'Produksi';
    }
    if (deptBadgeIcon) {
        deptBadgeIcon.className = `fa-solid ${cfg.icon || 'fa-industry'}`;
    }
    if (periodBadgeText) {
        const rangeStr = payload.tglawal && payload.tglakhir
            ? (payload.tglawal === payload.tglakhir ? payload.tglawal : `${payload.tglawal} s/d ${payload.tglakhir}`)
            : 'Rentang Terpilih';
        periodBadgeText.textContent = `Periode: ${rangeStr}`;
    }

    // 2. KPI Cards: Total PP, Memenuhi (%), Belum Memenuhi, Target Plan vs Actual
    const totalPpEl = document.getElementById('modalKpiTotalPp');
    const ppMemenuhiEl = document.getElementById('modalKpiPpMemenuhi');
    const ppPercentEl = document.getElementById('modalKpiPpPercent');
    const ppBelumEl = document.getElementById('modalKpiPpBelum');
    const totalPlanEl = document.getElementById('modalKpiTotalPlan');
    const totalActualEl = document.getElementById('modalKpiTotalActual');

    const totalPpVal = ringkasan.total_pp ?? payload.total_data ?? 0;
    const memenuhiVal = ringkasan.pp_memenuhi ?? 0;
    const belumVal = ringkasan.pp_belum_memenuhi ?? 0;
    const persentaseVal = ringkasan.persentase ?? (totalPpVal > 0 ? Number(((memenuhiVal / totalPpVal) * 100).toFixed(1)) : 0);

    if (totalPpEl) totalPpEl.textContent = totalPpVal;
    if (ppMemenuhiEl) ppMemenuhiEl.textContent = memenuhiVal;
    if (ppPercentEl) ppPercentEl.textContent = `${persentaseVal}%`;
    if (ppBelumEl) ppBelumEl.textContent = belumVal;
    if (totalPlanEl) totalPlanEl.textContent = Number(payload.total_plan || 0).toLocaleString('id-ID');
    if (totalActualEl) totalActualEl.textContent = Number(payload.total_actual || 0).toLocaleString('id-ID');

    // 3. Filter data rows
    let rows = Array.isArray(payload.rows) ? [...payload.rows] : [];

    // Filter Status
    if (state.currentProduksiStatus === 'memenuhi') {
        rows = rows.filter(r => (r.status || '').toUpperCase().includes('MEMENUHI') && !(r.status || '').toUpperCase().includes('BELUM'));
    } else if (state.currentProduksiStatus === 'belum') {
        rows = rows.filter(r => (r.status || '').toUpperCase().includes('BELUM'));
    }

    // Filter Search
    if (state.produksiSearchQuery) {
        const q = state.produksiSearchQuery;
        rows = rows.filter(r => {
            return String(r.nomor_pp || '').toLowerCase().includes(q) ||
                String(r.nama_barang || '').toLowerCase().includes(q) ||
                String(r.kode_barang || '').toLowerCase().includes(q) ||
                String(r.divisi || '').toLowerCase().includes(q);
        });
    }

    // 4. Sorting
    const sortCol = state.produksiSort.column;
    const sortDir = state.produksiSort.dir === 'desc' ? -1 : 1;
    rows.sort((a, b) => {
        let valA = a[sortCol];
        let valB = b[sortCol];

        if (sortCol === 'total_plan' || sortCol === 'total_actual' || sortCol === 'persentase' || sortCol === 'plan_tk' || sortCol === 'actual_tk') {
            valA = Number(valA) || 0;
            valB = Number(valB) || 0;
            return (valA - valB) * sortDir;
        }

        valA = String(valA || '').toLowerCase();
        valB = String(valB || '').toLowerCase();
        return valA.localeCompare(valB) * sortDir;
    });

    updateProduksiSortHeaders();

    // 5. Pagination
    const totalItems = rows.length;
    const pageSize = state.produksiPageSize || 20;
    const totalPages = Math.ceil(totalItems / pageSize) || 1;

    if (state.produksiCurrentPage > totalPages) state.produksiCurrentPage = totalPages;
    if (state.produksiCurrentPage < 1) state.produksiCurrentPage = 1;

    const startIdx = (state.produksiCurrentPage - 1) * pageSize;
    const endIdx = startIdx + pageSize;
    const pageRows = rows.slice(startIdx, endIdx);

    // 6. Render Rows
    const tbody = document.getElementById('produksiTableBody');
    if (!tbody) return;

    if (pageRows.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="11" class="text-center py-4" style="color: var(--text-muted);">
                    <i class="fa-solid fa-inbox"></i> Tidak ada data Perintah Produksi (PP) yang sesuai rentang tanggal & filter.
                </td>
            </tr>
        `;
    } else {
        let html = '';
        pageRows.forEach((r, idx) => {
            const no = startIdx + idx + 1;
            const percent = Number(r.persentase || 0);
            const isMemenuhi = (r.status || '').toUpperCase().includes('MEMENUHI') && !(r.status || '').toUpperCase().includes('BELUM');
            const statusBadge = isMemenuhi
                ? `<span class="badge-status-memenuhi"><i class="fa-solid fa-circle-check"></i> MEMENUHI</span>`
                : `<span class="badge-status-belum"><i class="fa-solid fa-circle-xmark"></i> BELUM</span>`;

            let progressClass = 'kpi-fill-red';
            if (percent >= 100) progressClass = 'kpi-fill-green';
            else if (percent >= 75) progressClass = 'kpi-fill-yellow';

            const planFormatted = Number(r.total_plan || 0).toLocaleString('id-ID');
            const actualFormatted = Number(r.total_actual || 0).toLocaleString('id-ID');

            const periodeStr = r.tgl_mulai && r.tgl_selesai
                ? `<span style="font-size: 0.75rem;">${r.tgl_mulai} <br><span style="color: var(--text-muted);">s/d ${r.tgl_selesai}</span></span>`
                : (r.tgl_mulai || '-');

            const tkStr = (r.plan_tk !== undefined && r.actual_tk !== undefined)
                ? `<span style="font-size: 0.75rem;">${r.plan_tk} / <b>${r.actual_tk}</b></span>`
                : '-';

            html += `
                <tr>
                    <td class="text-center" style="color: var(--text-muted); font-size: 0.8rem;">${no}</td>
                    <td><strong style="color: var(--sna-blue); font-family: var(--font-mono);">${r.nomor_pp || '-'}</strong></td>
                    <td><span class="skeleton-pill" style="padding: 2px 8px; font-size: 0.72rem; font-weight: 600; background: #f1f5f9; border-radius: 4px;">${r.divisi || '-'}</span></td>
                    <td style="font-family: var(--font-mono); font-size: 0.78rem; color: var(--text-muted);">${r.kode_barang || '-'}</td>
                    <td><strong>${r.nama_barang || '-'}</strong></td>
                    <td class="text-center">${periodeStr}</td>
                    <td class="text-right" style="font-family: var(--font-mono);">${planFormatted}</td>
                    <td class="text-right" style="font-family: var(--font-mono); font-weight: 700; color: ${isMemenuhi ? '#15803d' : '#b91c1c'};">${actualFormatted}</td>
                    <td class="text-center">${tkStr}</td>
                    <td>
                        <div class="prod-progress-cell">
                            <span style="font-weight: 700; font-size: 0.8rem;">${percent}%</span>
                            <div class="prod-progress-bar">
                                <div class="prod-progress-fill ${progressClass}" style="width: ${Math.min(100, percent)}%"></div>
                            </div>
                        </div>
                    </td>
                    <td class="text-center">${statusBadge}</td>
                </tr>
            `;
        });
        tbody.innerHTML = html;
    }

    // 7. Update Pagination Bar
    const pageInfoEl = document.getElementById('produksiPageInfo');
    if (pageInfoEl) {
        pageInfoEl.textContent = `Halaman ${state.produksiCurrentPage} dari ${totalPages} (${totalItems} data)`;
    }

    const prevBtn = document.getElementById('btnProduksiPrevPage');
    const nextBtn = document.getElementById('btnProduksiNextPage');
    if (prevBtn) prevBtn.disabled = state.produksiCurrentPage <= 1;
    if (nextBtn) nextBtn.disabled = state.produksiCurrentPage >= totalPages;

    // 8. Footer stats
    const footerStats = document.getElementById('produksiModalFooterStats');
    if (footerStats) {
        footerStats.textContent = `Menampilkan ${pageRows.length} dari ${totalItems} PP untuk ${cfg.name || payload.bagian}`;
    }
}

/**
 * Handle Sorting Kolom Tabel Produksi
 */
function sortProduksi(column) {
    if (state.produksiSort.column === column) {
        state.produksiSort.dir = state.produksiSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
        state.produksiSort.column = column;
        const numericCols = ['total_plan', 'total_actual', 'persentase', 'plan_tk', 'actual_tk'];
        state.produksiSort.dir = numericCols.includes(column) ? 'desc' : 'asc';
    }
    state.produksiCurrentPage = 1;
    if (state.produksiRawData) {
        renderProduksiUI(state.produksiRawData);
    }
}

/**
 * Mengubah Halaman Pagination Tabel Produksi
 */
function changeProduksiPage(delta) {
    state.produksiCurrentPage += delta;
    if (state.produksiRawData) {
        renderProduksiUI(state.produksiRawData);
    }
}

/**
 * Update Icon Panah Sorting pada Header Tabel Produksi
 */
function updateProduksiSortHeaders() {
    const table = document.getElementById('produksiModal');
    if (!table) return;

    const ths = table.querySelectorAll('th.sortable-th');
    ths.forEach(th => {
        const onclickAttr = th.getAttribute('onclick') || '';
        const match = onclickAttr.match(/sortProduksi\('([^']+)'\)/);
        if (!match) return;

        const col = match[1];
        const icon = th.querySelector('.sort-icon');

        if (col === state.produksiSort.column) {
            th.classList.add('active-sort');
            if (icon) {
                icon.className = state.produksiSort.dir === 'asc'
                    ? 'fa-solid fa-sort-up sort-icon'
                    : 'fa-solid fa-sort-down sort-icon';
            }
        } else {
            th.classList.remove('active-sort');
            if (icon) {
                icon.className = 'fa-solid fa-sort sort-icon';
            }
        }
    });
}

// ====================================================================
// ====================================================================
// 14. LOGIKA INTERAKTIF MODAL LOGISTIK (PEMENUHAN ORDER ATENA ERP)
// ====================================================================

/**
 * Helper format tanggal YYYY-MM-DD
 */
function formatLogistikDate(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Buka Modal Monitoring Logistik
 */
function openLogistikModal(range = 'month') {
    const modal = document.getElementById('logistikModal');
    if (!modal) return;

    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');

    state.logistikSearchQuery = '';
    state.logistikCurrentPage = 1;
    state.logistikFilteredOrder = '';

    const searchInput = document.getElementById('logistikSearchInput');
    if (searchInput) searchInput.value = '';

    const selectStatus = document.getElementById('selectLogistikStatus');
    if (selectStatus) selectStatus.value = 'all';
    state.currentLogistikStatus = 'all';

    const chipContainer = document.getElementById('logistikActiveOrderChipContainer');
    if (chipContainer) chipContainer.style.display = 'none';

    // Inisialisasi preset tanggal
    setLogistikQuickDate(range);
}

/**
 * Tutup Modal Logistik
 */
function closeLogistikModal() {
    const modal = document.getElementById('logistikModal');
    if (!modal) return;
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
}

/**
 * Mengatur rentang tanggal cepat (Bulan Ini, Bulan Lalu, 7 Hari, Hari Ini, Semua)
 */
function setLogistikQuickDate(preset = 'month') {
    state.currentLogistikRange = preset;
    state.logistikCurrentPage = 1;

    const now = new Date();
    const today = formatLogistikDate(now);
    let startDate = today;
    let endDate = today;

    if (preset === 'month') {
        startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        endDate = today;
    } else if (preset === 'last_month') {
        const year = now.getFullYear();
        const month = now.getMonth(); // 0-indexed (bulan lalu)
        const prevYear = month === 0 ? year - 1 : year;
        const prevMonth = month === 0 ? 12 : month;
        const lastDay = new Date(year, month, 0).getDate();
        startDate = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;
        endDate = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    } else if (preset === 'week') {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        startDate = formatLogistikDate(d);
        endDate = today;
    } else if (preset === 'today') {
        startDate = today;
        endDate = today;
    } else if (preset === 'all') {
        startDate = '2026-01-01';
        endDate = today;
    }

    state.logistikDateStart = startDate;
    state.logistikDateEnd = endDate;

    // Sinkronisasi ke input DOM
    const startInput = document.getElementById('logistikDateStart');
    const endInput = document.getElementById('logistikDateEnd');
    if (startInput) startInput.value = startDate;
    if (endInput) endInput.value = endDate;

    // Update active class pada pill
    const pills = document.querySelectorAll('.logistik-range-pills .filter-pill');
    pills.forEach(p => p.classList.remove('active'));

    const btnMap = {
        'month': 'btnQuickLogistikMonth',
        'week': 'btnQuickLogistikWeek',
        'today': 'btnQuickLogistikToday',
        'all': 'btnQuickLogistikAll'
    };
    const activeBtn = document.getElementById(btnMap[preset]);
    if (activeBtn) activeBtn.classList.add('active');

    loadLogistikData();
}

/**
 * Handle perubahan tanggal manual pada input Date Picker
 */
function handleLogistikDateChange(field) {
    const startInput = document.getElementById('logistikDateStart');
    const endInput = document.getElementById('logistikDateEnd');

    if (!startInput || !endInput) return;

    let start = startInput.value;
    let end = endInput.value;

    if (start && end && start > end) {
        if (field === 'start') {
            endInput.value = start;
            end = start;
        } else {
            startInput.value = end;
            start = end;
        }
    }

    state.logistikDateStart = start;
    state.logistikDateEnd = end;
    state.currentLogistikRange = 'custom';
    state.logistikCurrentPage = 1;

    // Hapus active pill preset
    const pills = document.querySelectorAll('.logistik-range-pills .filter-pill');
    pills.forEach(p => p.classList.remove('active'));

    loadLogistikData();
}

/**
 * Reset seluruh filter Logistik ke default (Bulan Ini)
 */
function resetLogistikFilter() {
    state.logistikSearchQuery = '';
    state.currentLogistikStatus = 'all';
    state.logistikFilteredOrder = '';
    state.logistikCurrentPage = 1;

    const searchInput = document.getElementById('logistikSearchInput');
    if (searchInput) searchInput.value = '';

    const selectStatus = document.getElementById('selectLogistikStatus');
    if (selectStatus) selectStatus.value = 'all';

    const chipContainer = document.getElementById('logistikActiveOrderChipContainer');
    if (chipContainer) chipContainer.style.display = 'none';

    setLogistikQuickDate('month');
}

/**
 * Drill-down: Filter rincian item barang berdasarkan satu nomor order tertentu
 */
function viewOrderItems(noOrder) {
    if (!noOrder) return;
    state.logistikFilteredOrder = noOrder;
    state.logistikCurrentPage = 1;

    // Tampilkan chip filter order aktif
    const chipContainer = document.getElementById('logistikActiveOrderChipContainer');
    const orderNumEl = document.getElementById('logistikFilteredOrderNum');
    if (orderNumEl) orderNumEl.textContent = noOrder;
    if (chipContainer) chipContainer.style.display = 'inline-flex';

    // Beralih ke tab rincian item barang
    switchLogistikView('items');
}

/**
 * Hapus filter drill-down order aktif
 */
function clearLogistikOrderFilter() {
    state.logistikFilteredOrder = '';
    state.logistikCurrentPage = 1;

    const chipContainer = document.getElementById('logistikActiveOrderChipContainer');
    if (chipContainer) chipContainer.style.display = 'none';

    if (state.logistikRawData) {
        renderLogistikModalData(state.logistikRawData);
    }
}

/**
 * Beralih Filter Status Pemenuhan Logistik ('all' | 'memenuhi' | 'belum')
 */
function switchLogistikStatus(status) {
    state.currentLogistikStatus = status;
    state.logistikCurrentPage = 1;
    if (state.logistikRawData) {
        renderLogistikModalData(state.logistikRawData);
    }
}

/**
 * Beralih Tampilan Tab Logistik ('orders' | 'items')
 */
function switchLogistikView(viewMode) {
    state.currentLogistikView = viewMode;
    state.logistikCurrentPage = 1;

    const btnOrders = document.getElementById('btnViewLogistikOrders');
    const btnItems = document.getElementById('btnViewLogistikItems');
    const panelOrders = document.getElementById('tabPanelLogistikOrders');
    const panelItems = document.getElementById('tabPanelLogistikItems');

    if (btnOrders) btnOrders.classList.toggle('active', viewMode === 'orders');
    if (btnItems) btnItems.classList.toggle('active', viewMode === 'items');

    if (panelOrders) panelOrders.classList.toggle('active', viewMode === 'orders');
    if (panelItems) panelItems.classList.toggle('active', viewMode === 'items');

    updateLogistikSortHeaders(viewMode);

    if (state.logistikRawData) {
        renderLogistikModalData(state.logistikRawData);
    }
}

/**
 * Pencarian Instan Logistik (Debounced)
 */
let logistikSearchTimeout = null;
function handleLogistikSearch(query) {
    clearTimeout(logistikSearchTimeout);
    logistikSearchTimeout = setTimeout(() => {
        state.logistikSearchQuery = (query || '').trim().toLowerCase();
        state.logistikCurrentPage = 1;
        if (state.logistikRawData) {
            renderLogistikModalData(state.logistikRawData);
        }
    }, 200);
}

/**
 * Memaksa sinkronisasi ulang data Logistik dari server Atena ERP
 */
async function syncLogistikData() {
    const syncBtn = document.getElementById('btnSyncLogistik');
    const icon = syncBtn ? syncBtn.querySelector('i') : null;
    if (icon) icon.classList.add('fa-spin');

    try {
        renderLogistikTablesLoading();
        state.logistikCache.clear();
        await fetch('/api/dashboard/logistik/sync', { method: 'POST' });
        await loadLogistikData(true);
        await fetchDashboardStats();
    } catch (err) {
        console.error('Error sync logistik:', err);
        renderLogistikTablesError(err.message);
    } finally {
        if (icon) icon.classList.remove('fa-spin');
    }
}

/**
 * Muat data Logistik dari API
 */
async function loadLogistikData(force = false) {
    let url = '/api/dashboard/logistik?';
    if (state.logistikDateStart && state.logistikDateEnd) {
        url += `tglawal=${encodeURIComponent(state.logistikDateStart)}&tglakhir=${encodeURIComponent(state.logistikDateEnd)}`;
    } else {
        url += `range=${encodeURIComponent(state.currentLogistikRange)}`;
    }
    if (force) url += '&force=true';

    const cacheKey = `logistik_${state.logistikDateStart}_${state.logistikDateEnd}_${state.currentLogistikRange}`;

    if (!force && state.logistikCache.has(cacheKey)) {
        const cached = state.logistikCache.get(cacheKey);
        state.logistikRawData = cached.data;
        renderLogistikModalData(cached.data);
        return;
    }

    renderLogistikTablesLoading();

    try {
        const res = await fetch(url);
        const result = await res.json();

        if (!result.success || !result.data) {
            throw new Error(result.message || 'Gagal mengambil data monitoring logistik');
        }

        state.logistikCache.set(cacheKey, { data: result.data, timestamp: Date.now() });
        state.logistikRawData = result.data;
        renderLogistikModalData(result.data);
    } catch (err) {
        console.error('Error memuat data logistik:', err);
        renderLogistikTablesError(err.message);
    }
}

/**
 * Render semua elemen di Modal Logistik
 */
function renderLogistikModalData(data) {
    if (!data) return;

    const kpi = data.kpi || {};
    const meta = data.meta || {};

    // 1. Tampilkan 5 KPI Utama Logistik
    const elTotalOrder = document.getElementById('modalKpiLogistikTotalOrder');
    const elTerpenuhi = document.getElementById('modalKpiLogistikTerpenuhi');
    const elBelum = document.getElementById('modalKpiLogistikBelum');
    const elPercent = document.getElementById('modalKpiLogistikPercent');
    const elTotalQty = document.getElementById('modalKpiLogistikTotalQtyOrder');
    const elTotalDn = document.getElementById('modalKpiLogistikTotalQtyDn');

    if (elTotalOrder) elTotalOrder.textContent = Number(kpi.total_order || 0).toLocaleString('id-ID');
    if (elTerpenuhi) elTerpenuhi.textContent = Number(kpi.order_terpenuhi || 0).toLocaleString('id-ID');
    if (elBelum) elBelum.textContent = Number(kpi.order_belum_terpenuhi || 0).toLocaleString('id-ID');
    if (elPercent) elPercent.textContent = `${kpi.persentase_selesai || 0}%`;
    if (elTotalQty) elTotalQty.textContent = Number(kpi.total_jumlah || 0).toLocaleString('id-ID');
    if (elTotalDn) elTotalDn.textContent = Number(kpi.total_jumlah_dn || 0).toLocaleString('id-ID');

    // 2. Info Waktu Sinkronisasi
    const syncTimeEl = document.getElementById('logistikLastSyncTime');
    if (syncTimeEl) {
        if (meta.sync_time) {
            const d = new Date(meta.sync_time);
            syncTimeEl.textContent = `• Sinkronisasi: ${d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB`;
        } else if (meta.generated_at) {
            const d = new Date(meta.generated_at);
            syncTimeEl.textContent = `• Diperbarui: ${d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB`;
        }
    }

    // 3. Filter List Order dan Items
    const q = state.logistikSearchQuery;
    const status = state.currentLogistikStatus;
    const filteredOrder = state.logistikFilteredOrder;

    // Filter daftar Order
    let orderList = (data.summary_by_order || []).filter(ord => {
        if (filteredOrder && ord.no_order !== filteredOrder) return false;
        if (status !== 'all' && ord.status_order_code !== status) return false;
        if (q) {
            const matchNoOrder = ord.no_order && ord.no_order.toLowerCase().includes(q);
            const matchNoPesanan = ord.no_pesanan && ord.no_pesanan.toLowerCase().includes(q);
            const matchCust = ord.customer && ord.customer.toLowerCase().includes(q);
            const matchDr = ord.no_dr && ord.no_dr.toLowerCase().includes(q);
            const matchDn = ord.no_dn && ord.no_dn.toLowerCase().includes(q);
            const matchItem = (ord.items || []).some(i =>
                (i.kode_barang && i.kode_barang.toLowerCase().includes(q)) ||
                (i.nama_barang && i.nama_barang.toLowerCase().includes(q))
            );
            if (!matchNoOrder && !matchNoPesanan && !matchCust && !matchDr && !matchDn && !matchItem) return false;
        }
        return true;
    });

    // Filter daftar Item
    let itemList = (data.items || []).filter(item => {
        if (filteredOrder && item.no_order !== filteredOrder) return false;
        if (status !== 'all' && item.status_code !== status) return false;
        if (q) {
            const matchNoOrder = item.no_order && item.no_order.toLowerCase().includes(q);
            const matchNoPesanan = item.no_pesanan && item.no_pesanan.toLowerCase().includes(q);
            const matchCust = item.customer && item.customer.toLowerCase().includes(q);
            const matchKode = item.kode_barang && item.kode_barang.toLowerCase().includes(q);
            const matchNama = item.nama_barang && item.nama_barang.toLowerCase().includes(q);
            const matchDr = item.no_dr && item.no_dr.toLowerCase().includes(q);
            const matchDn = item.no_dn && item.no_dn.toLowerCase().includes(q);
            if (!matchNoOrder && !matchNoPesanan && !matchCust && !matchKode && !matchNama && !matchDr && !matchDn) return false;
        }
        return true;
    });

    // 4. Update Counter Tab
    const countOrdersEl = document.getElementById('countLogistikOrders');
    const countItemsEl = document.getElementById('countLogistikItems');
    if (countOrdersEl) countOrdersEl.textContent = `${orderList.length}`;
    if (countItemsEl) countItemsEl.textContent = `${itemList.length}`;

    // 5. Sorting Data
    const ordSort = state.logistikSort?.orders || { column: 'tgl_jatuh_tempo', dir: 'desc' };
    orderList.sort((a, b) => {
        let valA = a[ordSort.column] ?? '';
        let valB = b[ordSort.column] ?? '';
        if (typeof valA === 'number' && typeof valB === 'number') {
            return ordSort.dir === 'asc' ? valA - valB : valB - valA;
        }
        valA = String(valA).toLowerCase();
        valB = String(valB).toLowerCase();
        return ordSort.dir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
    });

    const itemSort = state.logistikSort?.items || { column: 'tgl_jatuh_tempo', dir: 'desc' };
    itemList.sort((a, b) => {
        let valA = a[itemSort.column] ?? '';
        let valB = b[itemSort.column] ?? '';
        if (typeof valA === 'number' && typeof valB === 'number') {
            return itemSort.dir === 'asc' ? valA - valB : valB - valA;
        }
        valA = String(valA).toLowerCase();
        valB = String(valB).toLowerCase();
        return itemSort.dir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
    });

    updateLogistikSortHeaders(state.currentLogistikView);

    if (state.currentLogistikView === 'orders') {
        renderLogistikOrderTable(orderList);
    } else {
        renderLogistikItemsTable(itemList);
    }
}

/**
 * Render Tabel Per Order
 */
function renderLogistikOrderTable(orderList) {
    const tbody = document.getElementById('logistikOrdersTableBody');
    const footerStats = document.getElementById('logistikModalFooterStats');
    const pageInfo = document.getElementById('logistikPageInfo');
    const btnPrev = document.getElementById('btnLogistikPrevPage');
    const btnNext = document.getElementById('btnLogistikNextPage');

    if (!tbody) return;

    if (orderList.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="12" class="text-center" style="padding: 2.5rem 1rem; color: var(--text-muted);">
                    <div style="font-size: 2rem; margin-bottom: 0.5rem; color: #cbd5e1;">
                        <i class="fa-solid fa-box-open"></i>
                    </div>
                    Tidak ada data Order Logistik yang sesuai dengan filter pencarian.
                </td>
            </tr>
        `;
        if (pageInfo) pageInfo.textContent = 'Menampilkan 0 Order';
        if (btnPrev) btnPrev.disabled = true;
        if (btnNext) btnNext.disabled = true;
        return;
    }

    const pageSize = state.logistikPageSize;
    const totalPages = Math.ceil(orderList.length / pageSize) || 1;
    if (state.logistikCurrentPage > totalPages) state.logistikCurrentPage = totalPages;
    if (state.logistikCurrentPage < 1) state.logistikCurrentPage = 1;

    const startIndex = (state.logistikCurrentPage - 1) * pageSize;
    const pageOrders = orderList.slice(startIndex, startIndex + pageSize);

    let html = '';
    pageOrders.forEach((ord, idx) => {
        const rowNo = startIndex + idx + 1;
        const isMemenuhi = ord.status_order_code === 'memenuhi';
        const statusBadge = isMemenuhi
            ? `<span class="badge-logistik-memenuhi"><i class="fa-solid fa-circle-check"></i> Memenuhi</span>`
            : `<span class="badge-logistik-belum"><i class="fa-solid fa-clock-rotate-left"></i> Belum Memenuhi</span>`;

        const progressPercent = ord.progress_percent || 0;
        const progressClass = progressPercent >= 100 ? 'fill-complete' : '';

        html += `
            <tr>
                <td class="text-center" style="color: var(--text-muted); font-size: 0.75rem;">${rowNo}</td>
                <td>
                    <span class="logistik-order-link" onclick="viewOrderItems('${escapeHtml(ord.no_order)}')" title="Klik untuk memfilter rincian item barang order ini">
                        ${escapeHtml(ord.no_order)}
                    </span>
                </td>
                <td style="font-family: monospace; font-size: 0.75rem;">${escapeHtml(ord.no_pesanan)}</td>
                <td>
                    <span class="badge-customer-pill" title="${escapeHtml(ord.customer)}">
                        ${escapeHtml(ord.customer)}
                    </span>
                </td>
                <td class="text-center" style="font-size: 0.75rem;">${ord.tgl_jatuh_tempo_label || ord.tgl_jatuh_tempo}</td>
                <td>
                    <span class="badge-ekspedisi-pill">
                        <i class="fa-solid fa-truck"></i> ${escapeHtml(ord.ekspedisi)}
                    </span>
                </td>
                <td class="text-center font-weight-bold">${ord.item_count}</td>
                <td class="text-right" style="font-weight: 600;">${Number(ord.total_jumlah).toLocaleString('id-ID')}</td>
                <td class="text-right" style="font-weight: 700; color: #16a34a;">${Number(ord.total_jumlah_dn).toLocaleString('id-ID')}</td>
                <td>
                    <div style="font-size: 0.72rem; display: flex; justify-content: space-between; margin-bottom: 2px;">
                        <span>${progressPercent}%</span>
                    </div>
                    <div class="pr-progress-track">
                        <div class="pr-progress-fill ${progressClass}" style="width: ${progressPercent}%"></div>
                    </div>
                </td>
                <td style="font-size: 0.72rem; font-family: monospace; color: #475569; max-width: 120px;">
                    <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(ord.no_dr)}">${escapeHtml(ord.no_dr || '-')}</div>
                    <div style="color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(ord.no_dn)}">${escapeHtml(ord.no_dn || '-')}</div>
                </td>
                <td class="text-center" style="white-space: nowrap;">${statusBadge}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;

    if (pageInfo) {
        pageInfo.textContent = `Halaman ${state.logistikCurrentPage} dari ${totalPages} (${orderList.length} Order)`;
    }
    if (btnPrev) btnPrev.disabled = state.logistikCurrentPage <= 1;
    if (btnNext) btnNext.disabled = state.logistikCurrentPage >= totalPages;

    if (footerStats) {
        footerStats.textContent = `Menampilkan ${pageOrders.length} dari ${orderList.length} Order Logistik`;
    }
}

/**
 * Render Tabel Rincian Item Barang
 */
function renderLogistikItemsTable(itemList) {
    const tbody = document.getElementById('logistikItemsTableBody');
    const footerStats = document.getElementById('logistikModalFooterStats');
    const pageInfo = document.getElementById('logistikPageInfo');
    const btnPrev = document.getElementById('btnLogistikPrevPage');
    const btnNext = document.getElementById('btnLogistikNextPage');

    if (!tbody) return;

    if (itemList.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="12" class="text-center" style="padding: 2.5rem 1rem; color: var(--text-muted);">
                    <div style="font-size: 2rem; margin-bottom: 0.5rem; color: #cbd5e1;">
                        <i class="fa-solid fa-boxes-stacked"></i>
                    </div>
                    Tidak ada rincian item barang yang sesuai dengan filter pencarian.
                </td>
            </tr>
        `;
        if (pageInfo) pageInfo.textContent = 'Menampilkan 0 Item';
        if (btnPrev) btnPrev.disabled = true;
        if (btnNext) btnNext.disabled = true;
        return;
    }

    const pageSize = state.logistikPageSize;
    const totalPages = Math.ceil(itemList.length / pageSize) || 1;
    if (state.logistikCurrentPage > totalPages) state.logistikCurrentPage = totalPages;
    if (state.logistikCurrentPage < 1) state.logistikCurrentPage = 1;

    const startIndex = (state.logistikCurrentPage - 1) * pageSize;
    const pageItems = itemList.slice(startIndex, startIndex + pageSize);

    let html = '';
    pageItems.forEach((item, idx) => {
        const rowNo = startIndex + idx + 1;
        const isMemenuhi = item.status_code === 'memenuhi';
        const statusBadge = isMemenuhi
            ? `<span class="badge-logistik-memenuhi"><i class="fa-solid fa-circle-check"></i> Memenuhi</span>`
            : `<span class="badge-logistik-belum"><i class="fa-solid fa-clock-rotate-left"></i> Belum</span>`;

        html += `
            <tr>
                <td class="text-center" style="color: var(--text-muted); font-size: 0.75rem;">${rowNo}</td>
                <td>
                    <span class="logistik-order-link" onclick="viewOrderItems('${escapeHtml(item.no_order)}')" title="Filter hanya order ini">
                        ${escapeHtml(item.no_order)}
                    </span>
                </td>
                <td><span class="badge-customer-pill" title="${escapeHtml(item.customer)}">${escapeHtml(item.customer)}</span></td>
                <td style="font-family: monospace; font-size: 0.75rem;">${escapeHtml(item.kode_barang)}</td>
                <td style="font-weight: 500;">${escapeHtml(item.nama_barang)}</td>
                <td class="text-center" style="font-size: 0.75rem;">${escapeHtml(item.satuan)}</td>
                <td class="text-right" style="font-weight: 600;">${Number(item.jumlah).toLocaleString('id-ID')}</td>
                <td class="text-right" style="font-weight: 700; color: #16a34a;">${Number(item.jumlah_dn).toLocaleString('id-ID')}</td>
                <td class="text-center" style="font-size: 0.75rem;">${item.tgl_jatuh_tempo_label || item.tgl_jatuh_tempo}</td>
                <td style="font-size: 0.72rem; font-family: monospace; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(item.no_dr)}">${escapeHtml(item.no_dr || '-')}</td>
                <td style="font-size: 0.72rem; font-family: monospace; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(item.no_dn)}">${escapeHtml(item.no_dn || '-')}</td>
                <td class="text-center" style="white-space: nowrap;">${statusBadge}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;

    if (pageInfo) {
        pageInfo.textContent = `Halaman ${state.logistikCurrentPage} dari ${totalPages} (${itemList.length} Item)`;
    }
    if (btnPrev) btnPrev.disabled = state.logistikCurrentPage <= 1;
    if (btnNext) btnNext.disabled = state.logistikCurrentPage >= totalPages;

    if (footerStats) {
        footerStats.textContent = `Menampilkan ${pageItems.length} dari ${itemList.length} Item Barang Logistik`;
    }
}

/**
 * Handle Pagination Logistik
 */
function changeLogistikPage(delta) {
    state.logistikCurrentPage += delta;
    if (state.logistikRawData) {
        renderLogistikModalData(state.logistikRawData);
    }
}

/**
 * Skeleton Loading Tabel Logistik
 */
function renderLogistikTablesLoading() {
    const ordersTbody = document.getElementById('logistikOrdersTableBody');
    const itemsTbody = document.getElementById('logistikItemsTableBody');
    const skeleton = `
        <tr class="skeleton-row">
            <td class="text-center"><span class="skeleton-box" style="width: 20px; height: 16px;"></span></td>
            <td><span class="skeleton-box" style="width: 110px; height: 16px;"></span></td>
            <td><span class="skeleton-box" style="width: 100px; height: 16px;"></span></td>
            <td><span class="skeleton-box" style="width: 150px; height: 16px;"></span></td>
            <td class="text-center"><span class="skeleton-box" style="width: 80px; height: 14px;"></span></td>
            <td><span class="skeleton-box" style="width: 90px; height: 14px;"></span></td>
            <td class="text-center"><span class="skeleton-box" style="width: 30px; height: 14px;"></span></td>
            <td class="text-right"><span class="skeleton-box" style="width: 50px; height: 14px;"></span></td>
            <td class="text-right"><span class="skeleton-box" style="width: 50px; height: 14px;"></span></td>
            <td><span class="skeleton-box" style="width: 70px; height: 8px;"></span></td>
            <td><span class="skeleton-box" style="width: 100px; height: 14px;"></span></td>
            <td class="text-center"><span class="skeleton-badge" style="width: 80px;"></span></td>
        </tr>
    `;
    if (ordersTbody) ordersTbody.innerHTML = skeleton.repeat(4);
    if (itemsTbody) itemsTbody.innerHTML = skeleton.repeat(4);
}

/**
 * Error State Tabel Logistik
 */
function renderLogistikTablesError(msg) {
    ['logistikOrdersTableBody', 'logistikItemsTableBody'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.innerHTML = `
                <tr>
                    <td colspan="12" class="text-center" style="padding: 2.5rem 1rem; color: #dc2626;">
                        <i class="fa-solid fa-circle-exclamation"></i> Gagal memuat data Logistik: ${escapeHtml(msg)}
                    </td>
                </tr>
            `;
        }
    });
}

/**
 * Sorting Kolom Tabel Logistik
 */
function sortLogistik(viewMode, column) {
    if (!state.logistikSort) {
        state.logistikSort = {
            orders: { column: 'tgl_jatuh_tempo', dir: 'desc' },
            items: { column: 'tgl_jatuh_tempo', dir: 'desc' },
        };
    }

    const currentSort = state.logistikSort[viewMode] || { column: 'tgl_jatuh_tempo', dir: 'desc' };
    if (currentSort.column === column) {
        currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
        currentSort.column = column;
        const numericColumns = ['total_jumlah', 'total_jumlah_dn', 'jumlah', 'jumlah_dn', 'item_count', 'progress_percent'];
        currentSort.dir = numericColumns.includes(column) ? 'desc' : 'asc';
    }

    state.logistikSort[viewMode] = currentSort;
    state.logistikCurrentPage = 1;

    updateLogistikSortHeaders(viewMode);

    if (state.logistikRawData) {
        renderLogistikModalData(state.logistikRawData);
    }
}

/**
 * Update Icon Header Sorting Logistik
 */
function updateLogistikSortHeaders(viewMode) {
    const panelId = viewMode === 'orders' ? 'tabPanelLogistikOrders' : 'tabPanelLogistikItems';
    const panel = document.getElementById(panelId);
    if (!panel) return;

    const currentSort = (state.logistikSort && state.logistikSort[viewMode])
        ? state.logistikSort[viewMode]
        : { column: 'tgl_jatuh_tempo', dir: 'desc' };

    const ths = panel.querySelectorAll('th.sortable-th');
    ths.forEach(th => {
        const key = th.getAttribute('data-sort-key');
        const icon = th.querySelector('.sort-icon');

        if (key === currentSort.column) {
            th.classList.add('active-sort');
            if (icon) {
                icon.className = currentSort.dir === 'asc'
                    ? 'fa-solid fa-arrow-up-wide-short sort-icon'
                    : 'fa-solid fa-arrow-down-wide-short sort-icon';
            }
        } else {
            th.classList.remove('active-sort');
            if (icon) {
                icon.className = 'fa-solid fa-sort sort-icon';
            }
        }
    });
}

// ====================================================================
// 15. LOGIKA INTERAKTIF MODAL QA (RELEASE MATERIAL GRS ATENA ERP)
// ====================================================================

/**
 * Helper format tanggal YYYY-MM-DD untuk QA
 */
function formatQaDate(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Buka Modal Monitoring QA (Release Material GRS)
 */
function openQaModal(range = 'month') {
    const modal = document.getElementById('qaModal');
    if (!modal) return;

    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');

    state.qaSearchQuery = '';
    state.qaCurrentPage = 1;

    const searchInput = document.getElementById('qaSearchInput');
    if (searchInput) searchInput.value = '';

    const selectStatus = document.getElementById('selectQaStatus');
    if (selectStatus) selectStatus.value = 'all';
    state.currentQaStatus = 'all';

    setQaQuickDate(range);
}

/**
 * Tutup Modal QA
 */
function closeQaModal() {
    const modal = document.getElementById('qaModal');
    if (!modal) return;
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
}

/**
 * Mengatur rentang tanggal cepat QA (Bulan Ini, 7 Hari, Hari Ini, Semua)
 */
function setQaQuickDate(preset = 'month') {
    state.currentQaRange = preset;
    state.qaCurrentPage = 1;

    const now = new Date();
    const today = formatQaDate(now);
    let startDate = today;
    let endDate = today;

    if (preset === 'month') {
        startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        endDate = today;
    } else if (preset === 'week') {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        startDate = formatQaDate(d);
        endDate = today;
    } else if (preset === 'today') {
        startDate = today;
        endDate = today;
    } else if (preset === 'all') {
        startDate = '2026-01-01';
        endDate = today;
    }

    state.qaDateStart = startDate;
    state.qaDateEnd = endDate;

    const startInput = document.getElementById('qaDateStart');
    const endInput = document.getElementById('qaDateEnd');
    if (startInput) startInput.value = startDate;
    if (endInput) endInput.value = endDate;

    const pills = document.querySelectorAll('.qa-range-pills .filter-pill');
    pills.forEach(p => p.classList.remove('active'));

    const btnMap = {
        'month': 'btnQuickQaMonth',
        'week': 'btnQuickQaWeek',
        'today': 'btnQuickQaToday',
        'all': 'btnQuickQaAll'
    };
    const activeBtn = document.getElementById(btnMap[preset]);
    if (activeBtn) activeBtn.classList.add('active');

    loadQaData();
}

/**
 * Handle perubahan tanggal manual pada input Date Picker QA
 */
function handleQaDateChange(field) {
    const startInput = document.getElementById('qaDateStart');
    const endInput = document.getElementById('qaDateEnd');

    if (!startInput || !endInput) return;

    let start = startInput.value;
    let end = endInput.value;

    if (start && end && start > end) {
        if (field === 'start') {
            endInput.value = start;
            end = start;
        } else {
            startInput.value = end;
            start = end;
        }
    }

    state.qaDateStart = start;
    state.qaDateEnd = end;
    state.currentQaRange = 'custom';
    state.qaCurrentPage = 1;

    const pills = document.querySelectorAll('.qa-range-pills .filter-pill');
    pills.forEach(p => p.classList.remove('active'));

    loadQaData();
}

/**
 * Reset seluruh filter QA ke default (Bulan Ini)
 */
function resetQaFilter() {
    state.qaSearchQuery = '';
    state.currentQaStatus = 'all';
    state.qaCurrentPage = 1;

    const searchInput = document.getElementById('qaSearchInput');
    if (searchInput) searchInput.value = '';

    const selectStatus = document.getElementById('selectQaStatus');
    if (selectStatus) selectStatus.value = 'all';

    setQaQuickDate('month');
}

/**
 * Ganti filter Status QA (all, terpenuhi, pending)
 */
function switchQaStatus(status) {
    state.currentQaStatus = status;
    state.qaCurrentPage = 1;
    if (state.qaRawData) {
        renderQaModalData(state.qaRawData);
    }
}

/**
 * Ganti Mode Tampilan Tab QA: 'grs' vs 'po'
 */
function switchQaView(viewMode) {
    state.currentQaView = viewMode;
    state.qaCurrentPage = 1;

    const btnGrs = document.getElementById('btnViewQaGrs');
    const btnPo = document.getElementById('btnViewQaPo');
    const panelGrs = document.getElementById('tabPanelQaGrs');
    const panelPo = document.getElementById('tabPanelQaPo');

    if (btnGrs) btnGrs.classList.toggle('active', viewMode === 'grs');
    if (btnPo) btnPo.classList.toggle('active', viewMode === 'po');

    if (panelGrs) panelGrs.classList.toggle('active', viewMode === 'grs');
    if (panelPo) panelPo.classList.toggle('active', viewMode === 'po');

    updateQaSortHeaders(viewMode);

    if (state.qaRawData) {
        renderQaModalData(state.qaRawData);
    }
}

/**
 * Pencarian Instan QA (Debounced)
 */
let qaSearchTimeout = null;
function handleQaSearch(query) {
    clearTimeout(qaSearchTimeout);
    qaSearchTimeout = setTimeout(() => {
        state.qaSearchQuery = (query || '').trim().toLowerCase();
        state.qaCurrentPage = 1;
        if (state.qaRawData) {
            renderQaModalData(state.qaRawData);
        }
    }, 200);
}

/**
 * Sinkronisasi Paksa Data QA dengan Atena ERP
 */
async function syncQaData() {
    const syncBtn = document.getElementById('btnSyncQa');
    const icon = syncBtn?.querySelector('i');
    if (icon) icon.classList.add('fa-spin');

    try {
        renderQaTablesLoading();
        const res = await fetch('/api/dashboard/qa/sync', { method: 'POST' });
        const json = await res.json();
        if (json.success) {
            state.qaCache.clear();
            await loadQaData(true);
            fetchDashboardStats(true);
        } else {
            throw new Error(json.message || 'Gagal sinkronisasi data QA');
        }
    } catch (err) {
        console.error('Error sync QA:', err);
        renderQaTablesError(err.message);
    } finally {
        if (icon) {
            setTimeout(() => icon.classList.remove('fa-spin'), 600);
        }
    }
}

/**
 * Muat data QA dari API
 */
async function loadQaData(force = false) {
    let url = '/api/dashboard/qa?';
    if (state.qaDateStart && state.qaDateEnd) {
        url += `tglawal=${encodeURIComponent(state.qaDateStart)}&tglakhir=${encodeURIComponent(state.qaDateEnd)}`;
    } else {
        url += `range=${encodeURIComponent(state.currentQaRange)}`;
    }
    if (force) url += '&force=true';

    const cacheKey = `qa_${state.qaDateStart}_${state.qaDateEnd}_${state.currentQaRange}`;

    if (!force && state.qaCache.has(cacheKey)) {
        const cached = state.qaCache.get(cacheKey);
        state.qaRawData = cached.data;
        renderQaModalData(cached.data);
        if (Date.now() - cached.timestamp < 30000) return;
    } else {
        renderQaTablesLoading();
    }

    try {
        const res = await fetch(url);
        const result = await res.json();

        if (!result.success || !result.data) {
            throw new Error(result.message || 'Gagal mengambil data monitoring QA');
        }

        state.qaCache.set(cacheKey, { data: result.data, timestamp: Date.now() });
        state.qaRawData = result.data;
        renderQaModalData(result.data);
    } catch (err) {
        console.error('Error memuat data QA:', err);
        renderQaTablesError(err.message);
    }
}

/**
 * Render semua elemen di Modal QA
 */
function renderQaModalData(data) {
    if (!data) return;

    const kpi = data.kpi || {};
    const meta = data.meta || {};

    const elTotalGrs = document.getElementById('modalKpiQaTotalGrs');
    const elReleased = document.getElementById('modalKpiQaReleased');
    const elPercent = document.getElementById('modalKpiQaPercent');
    const elReject = document.getElementById('modalKpiQaReject');
    const elPending = document.getElementById('modalKpiQaPending');
    const elTotalPo = document.getElementById('modalKpiQaTotalPo');

    if (elTotalGrs) elTotalGrs.textContent = Number(kpi.total_grs || 0).toLocaleString('id-ID');
    if (elReleased) elReleased.textContent = Number(kpi.grs_released || kpi.grs_approve || 0).toLocaleString('id-ID');
    if (elPercent) elPercent.textContent = `${kpi.persentase || kpi.persentase_selesai || 0}%`;
    if (elReject) elReject.textContent = Number((kpi.grs_ditolak || 0) + (kpi.grs_ditahan || 0)).toLocaleString('id-ID');
    if (elPending) elPending.textContent = Number(kpi.grs_pending || 0).toLocaleString('id-ID');
    if (elTotalPo) elTotalPo.textContent = Number(kpi.total_po || 0).toLocaleString('id-ID');

    const countGrsEl = document.getElementById('countQaGrs');
    const countPoEl = document.getElementById('countQaPo');
    if (countGrsEl) countGrsEl.textContent = `${(data.items || []).length}`;
    if (countPoEl) countPoEl.textContent = `${(data.summary_by_po || []).length}`;

    const syncTimeEl = document.getElementById('qaLastSyncTime');
    if (syncTimeEl) {
        if (meta.sync_time) {
            const d = new Date(meta.sync_time);
            syncTimeEl.textContent = `• Sinkronisasi: ${d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB`;
        } else if (meta.last_updated) {
            const d = new Date(meta.last_updated);
            syncTimeEl.textContent = `• Diperbarui: ${d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB`;
        }
    }

    const q = state.qaSearchQuery;
    const status = state.currentQaStatus;

    // Filter daftar Release GRS
    let grsList = (data.items || []).filter(item => {
        if (status !== 'all' && item.status_code !== status) return false;
        if (q) {
            const matchGrs = item.no_grs && item.no_grs.toLowerCase().includes(q);
            const matchPo = item.no_po && item.no_po.toLowerCase().includes(q);
            const matchSupp = item.supplier && item.supplier.toLowerCase().includes(q);
            const matchSj = item.surat_jalan && item.surat_jalan.toLowerCase().includes(q);
            const matchDisp = item.disposisi_qc && item.disposisi_qc.toLowerCase().includes(q);
            if (!matchGrs && !matchPo && !matchSupp && !matchSj && !matchDisp) return false;
        }
        return true;
    });

    // Filter daftar Ringkasan Per PO
    let poList = (data.summary_by_po || []).filter(po => {
        if (status !== 'all') {
            if (status === 'terpenuhi' && po.status_code !== 'terpenuhi') return false;
            if (status === 'pending' && po.status_code === 'terpenuhi') return false;
        }
        if (q) {
            const matchPo = po.no_po && po.no_po.toLowerCase().includes(q);
            const matchSupp = po.supplier && po.supplier.toLowerCase().includes(q);
            const matchGrs = (po.grs_list || []).some(g => g.no_grs && g.no_grs.toLowerCase().includes(q));
            if (!matchPo && !matchSupp && !matchGrs) return false;
        }
        return true;
    });

    // Sorting
    const sortGrs = (state.qaSort && state.qaSort.grs) || { column: 'tanggal', dir: 'desc' };
    grsList.sort((a, b) => {
        let valA = a[sortGrs.column];
        let valB = b[sortGrs.column];
        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();
        if (valA < valB) return sortGrs.dir === 'asc' ? -1 : 1;
        if (valA > valB) return sortGrs.dir === 'asc' ? 1 : -1;
        return 0;
    });

    const sortPo = (state.qaSort && state.qaSort.po) || { column: 'tanggal', dir: 'desc' };
    poList.sort((a, b) => {
        let valA = a[sortPo.column];
        let valB = b[sortPo.column];
        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();
        if (valA < valB) return sortPo.dir === 'asc' ? -1 : 1;
        if (valA > valB) return sortPo.dir === 'asc' ? 1 : -1;
        return 0;
    });

    // Render Tabel sesuai mode tampilan
    if (state.currentQaView === 'grs') {
        renderQaGrsTable(grsList);
    } else {
        renderQaPoTable(poList);
    }

    updateQaSortHeaders(state.currentQaView);
}

/**
 * Render Tabel Rincian Release GRS (Material)
 */
function renderQaGrsTable(list) {
    const tbody = document.getElementById('qaGrsTableBody');
    const footerStats = document.getElementById('qaModalFooterStats');
    const pageInfo = document.getElementById('qaPageInfo');
    const btnPrev = document.getElementById('btnQaPrevPage');
    const btnNext = document.getElementById('btnQaNextPage');
    if (!tbody) return;

    if (!list || list.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="subcon-empty-row">
                    <i class="fa-solid fa-boxes-packing"></i>
                    <div>Tidak ada data Release Material GRS yang cocok dengan filter saat ini</div>
                </td>
            </tr>
        `;
        if (footerStats) footerStats.textContent = 'Menampilkan 0 GRS';
        if (pageInfo) pageInfo.textContent = 'Halaman 1 dari 1';
        if (btnPrev) btnPrev.disabled = true;
        if (btnNext) btnNext.disabled = true;
        return;
    }

    const pageSize = state.qaPageSize;
    const totalItems = list.length;
    const totalPages = Math.ceil(totalItems / pageSize) || 1;
    if (state.qaCurrentPage > totalPages) state.qaCurrentPage = totalPages;
    if (state.qaCurrentPage < 1) state.qaCurrentPage = 1;

    const startIdx = (state.qaCurrentPage - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, totalItems);
    const paged = list.slice(startIdx, endIdx);

    let html = '';
    paged.forEach((item, idx) => {
        let badgeStatusHtml = `<span class="badge-status-pending"><i class="fa-solid fa-hourglass-half"></i> Pending</span>`;
        if (item.status_code === 'terpenuhi') {
            badgeStatusHtml = `<span class="badge-status-terpenuhi"><i class="fa-solid fa-circle-check"></i> Released</span>`;
        } else if (item.status_code === 'ditolak') {
            badgeStatusHtml = `<span class="badge-status-ditolak"><i class="fa-solid fa-circle-xmark"></i> Ditolak</span>`;
        } else if (item.status_code === 'ditahan') {
            badgeStatusHtml = `<span class="badge-status-ditahan"><i class="fa-solid fa-triangle-exclamation"></i> Ditahan</span>`;
        }

        let disposisiHtml = `<span style="color: #94a3b8;">-</span>`;
        if (item.disposisi_qc === 'DITERIMA') {
            disposisiHtml = `<span class="badge-satuan" style="background: rgba(16, 185, 129, 0.15); color: #10b981; font-weight: 700;"><i class="fa-solid fa-check"></i> Diterima</span>`;
        } else if (item.disposisi_qc === 'DITOLAK') {
            disposisiHtml = `<span class="badge-satuan" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; font-weight: 700;"><i class="fa-solid fa-xmark"></i> Ditolak</span>`;
        } else if (item.disposisi_qc === 'DITAHAN') {
            disposisiHtml = `<span class="badge-satuan" style="background: rgba(245, 158, 11, 0.15); color: #d97706; font-weight: 700;"><i class="fa-solid fa-hand"></i> Ditahan</span>`;
        } else if (item.disposisi_qc && item.disposisi_qc !== '-') {
            disposisiHtml = `<span class="badge-satuan">${item.disposisi_qc}</span>`;
        }

        const poClickHtml = (item.no_po && item.no_po !== '-')
            ? `<span class="subcon-spk-num" style="cursor: pointer;" onclick="viewQaPoItems('${item.no_po}')" title="Klik untuk memfilter PO ini">
                 <i class="fa-solid fa-file-invoice" style="color: #0284c7;"></i> ${item.no_po}
               </span>`
            : `<span style="color: #94a3b8;">-</span>`;

        html += `
            <tr>
                <td class="text-center font-mono" style="color: #64748b;">${startIdx + idx + 1}</td>
                <td>
                    <span class="subcon-spk-num font-mono" style="font-weight: 600;">
                        <i class="fa-solid fa-boxes-packing" style="color: #8b5cf6;"></i> ${item.no_grs || '-'}
                    </span>
                </td>
                <td style="white-space: nowrap;">${item.tanggal_label || item.tanggal || '-'}</td>
                <td>${poClickHtml}</td>
                <td style="font-weight: 500; max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${item.supplier || '-'}">
                    ${item.supplier || '-'}
                </td>
                <td style="text-align: center;">${disposisiHtml}</td>
                <td style="text-align: center;">${badgeStatusHtml}</td>
                <td style="white-space: nowrap; font-size: 0.78rem; color: #64748b;">${item.tgl_approve || '-'}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
    if (footerStats) {
        footerStats.textContent = `Menampilkan ${startIdx + 1} - ${endIdx} dari ${totalItems} Release GRS Material`;
    }
    if (pageInfo) {
        pageInfo.textContent = `Halaman ${state.qaCurrentPage} dari ${totalPages} (${totalItems} GRS)`;
    }
    if (btnPrev) btnPrev.disabled = state.qaCurrentPage <= 1;
    if (btnNext) btnNext.disabled = state.qaCurrentPage >= totalPages;
}

/**
 * Render Tabel Ringkasan Per No. PO QA
 */
function renderQaPoTable(list) {
    const tbody = document.getElementById('qaPoTableBody');
    const footerStats = document.getElementById('qaModalFooterStats');
    const pageInfo = document.getElementById('qaPageInfo');
    const btnPrev = document.getElementById('btnQaPrevPage');
    const btnNext = document.getElementById('btnQaNextPage');
    if (!tbody) return;

    if (!list || list.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="subcon-empty-row">
                    <i class="fa-solid fa-file-invoice"></i>
                    <div>Tidak ada Purchase Order (PO) yang cocok dengan filter saat ini</div>
                </td>
            </tr>
        `;
        if (footerStats) footerStats.textContent = 'Menampilkan 0 PO';
        if (pageInfo) pageInfo.textContent = 'Halaman 1 dari 1';
        if (btnPrev) btnPrev.disabled = true;
        if (btnNext) btnNext.disabled = true;
        return;
    }

    const pageSize = state.qaPageSize;
    const totalItems = list.length;
    const totalPages = Math.ceil(totalItems / pageSize) || 1;
    if (state.qaCurrentPage > totalPages) state.qaCurrentPage = totalPages;
    if (state.qaCurrentPage < 1) state.qaCurrentPage = 1;

    const startIdx = (state.qaCurrentPage - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, totalItems);
    const paged = list.slice(startIdx, endIdx);

    let html = '';
    paged.forEach((po, idx) => {
        let badgeStatusHtml = `<span class="badge-status-pending"><i class="fa-solid fa-hourglass-half"></i> Pending</span>`;
        if (po.status_code === 'terpenuhi') {
            badgeStatusHtml = `<span class="badge-status-terpenuhi"><i class="fa-solid fa-circle-check"></i> Lengkap</span>`;
        } else if (po.status_code === 'ditolak') {
            badgeStatusHtml = `<span class="badge-status-ditolak"><i class="fa-solid fa-circle-xmark"></i> Ditolak</span>`;
        } else if (po.status_code === 'parsial') {
            badgeStatusHtml = `<span class="badge-status-pending" style="color: #0284c7; background: rgba(2, 132, 199, 0.12);"><i class="fa-solid fa-circle-half-stroke"></i> Parsial</span>`;
        }

        const percent = Number(po.persentase || 0);
        let progressColor = '#ef4444';
        if (percent >= 100) progressColor = '#16a34a';
        else if (percent >= 50) progressColor = '#0284c7';

        html += `
            <tr>
                <td class="text-center font-mono" style="color: #64748b;">${startIdx + idx + 1}</td>
                <td>
                    <span class="subcon-spk-num font-mono" style="cursor: pointer;" onclick="viewQaPoItems('${po.no_po}')" title="Klik untuk melihat seluruh GRS dari PO ini">
                        <i class="fa-solid fa-file-invoice" style="color: #0284c7;"></i> ${po.no_po || '-'}
                    </span>
                </td>
                <td style="white-space: nowrap;">${po.tanggal_label || po.tanggal || '-'}</td>
                <td style="font-weight: 500; max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${po.supplier || '-'}">
                    ${po.supplier || '-'}
                </td>
                <td style="text-align: center;"><span class="badge-satuan">${po.total_grs || 0} GRS</span></td>
                <td class="text-center" style="color: #16a34a; font-weight: 600;">${po.grs_approve || 0}</td>
                <td class="text-center" style="color: #d97706; font-weight: 600;">${po.grs_pending || 0}</td>
                <td class="text-right font-mono" style="font-weight: 700; color: ${progressColor};">${percent}%</td>
                <td style="text-align: center;">${badgeStatusHtml}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
    if (footerStats) {
        footerStats.textContent = `Menampilkan ${startIdx + 1} - ${endIdx} dari ${totalItems} Purchase Order`;
    }
    if (pageInfo) {
        pageInfo.textContent = `Halaman ${state.qaCurrentPage} dari ${totalPages} (${totalItems} PO)`;
    }
    if (btnPrev) btnPrev.disabled = state.qaCurrentPage <= 1;
    if (btnNext) btnNext.disabled = state.qaCurrentPage >= totalPages;
}

/**
 * Drill-down melihat GRS dari suatu PO di QA Modal
 */
function viewQaPoItems(noPo) {
    if (!noPo || noPo === '-') return;
    const searchInput = document.getElementById('qaSearchInput');
    if (searchInput) searchInput.value = noPo;
    state.qaSearchQuery = noPo.trim().toLowerCase();
    switchQaView('grs');
}

/**
 * Navigasi ganti halaman QA
 */
function changeQaPage(delta) {
    state.qaCurrentPage += delta;
    if (state.qaRawData) {
        renderQaModalData(state.qaRawData);
    }
}

/**
 * Sorting Kolom Tabel QA
 */
function sortQa(viewMode, column) {
    if (!state.qaSort) state.qaSort = { grs: { column: 'tanggal', dir: 'desc' }, po: { column: 'tanggal', dir: 'desc' } };
    if (!state.qaSort[viewMode]) state.qaSort[viewMode] = { column: 'tanggal', dir: 'desc' };

    const currentSort = state.qaSort[viewMode];
    if (currentSort.column === column) {
        currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
        currentSort.column = column;
        currentSort.dir = ['tanggal', 'total_grs', 'grs_approve', 'grs_pending', 'persentase'].includes(column) ? 'desc' : 'asc';
    }

    state.qaCurrentPage = 1;
    if (state.qaRawData) {
        renderQaModalData(state.qaRawData);
    }
}

/**
 * Update Icon Header Sorting QA
 */
function updateQaSortHeaders(viewMode) {
    const panelId = viewMode === 'grs' ? 'tabPanelQaGrs' : 'tabPanelQaPo';
    const panel = document.getElementById(panelId);
    if (!panel) return;

    const currentSort = (state.qaSort && state.qaSort[viewMode])
        ? state.qaSort[viewMode]
        : { column: 'tanggal', dir: 'desc' };

    const ths = panel.querySelectorAll('th.sortable-th');
    ths.forEach(th => {
        const key = th.getAttribute('data-sort-key');
        const icon = th.querySelector('.sort-icon');

        if (key === currentSort.column) {
            th.classList.add('active-sort');
            if (icon) {
                icon.className = currentSort.dir === 'asc'
                    ? 'fa-solid fa-arrow-up-wide-short sort-icon'
                    : 'fa-solid fa-arrow-down-wide-short sort-icon';
            }
        } else {
            th.classList.remove('active-sort');
            if (icon) {
                icon.className = 'fa-solid fa-sort sort-icon';
            }
        }
    });
}

function renderQaTablesLoading() {
    const tbodyGrs = document.getElementById('qaGrsTableBody');
    const tbodyPo = document.getElementById('qaPoTableBody');
    const skeleton = `
        <tr>
            <td colspan="10" style="padding: 2rem; text-align: center; color: var(--text-secondary);">
                <i class="fa-solid fa-spinner fa-spin" style="font-size: 1.5rem; color: #8b5cf6;"></i>
                <div style="margin-top: 8px; font-weight: 500;">Memuat data Release Material GRS dari Atena ERP...</div>
            </td>
        </tr>
    `;
    if (tbodyGrs) tbodyGrs.innerHTML = skeleton;
    if (tbodyPo) tbodyPo.innerHTML = skeleton;
}

function renderQaTablesError(message) {
    const tbodyGrs = document.getElementById('qaGrsTableBody');
    const tbodyPo = document.getElementById('qaPoTableBody');
    const errHtml = `
        <tr>
            <td colspan="10" class="subcon-empty-row" style="color: #ef4444;">
                <i class="fa-solid fa-triangle-exclamation" style="font-size: 2rem; color: #ef4444;"></i>
                <div style="margin-top: 8px; font-weight: 600;">Gagal Mengambil Data QA</div>
                <div style="font-size: 0.8rem; color: #64748b;">${message || 'Terjadi kesalahan sistem'}</div>
            </td>
        </tr>
    `;
    if (tbodyGrs) tbodyGrs.innerHTML = errHtml;
    if (tbodyPo) tbodyPo.innerHTML = errHtml;
}

