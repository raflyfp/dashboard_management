
const INDO_MONTH_NAMES = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

function getSelectedPeriodText(includeYear = true) {
    const m = Math.max(1, Math.min(12, parseInt(state.selectedMonth, 10) || (new Date().getMonth() + 1)));
    const y = state.selectedYear || new Date().getFullYear();
    const name = INDO_MONTH_NAMES[m - 1] || 'Bulan Ini';
    return includeYear ? `${name} ${y}` : name;
}


/**
 * Helper fetch aman: membaca response sebagai text terlebih dahulu
 * Menghindari crash 'Unexpected token <' bila server/proxy mengembalikan halaman HTML (404/502/504)
 */
async function fetchJsonSafely(url, options = {}) {
    const res = await fetch(url, options);
    const text = await res.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        throw new Error(`Respon server tidak valid atau koneksi timeout (HTTP ${res.status}). Silakan coba klik tombol refresh.`);
    }
    if (!res.ok) {
        throw new Error(data?.message || `Gagal mengambil data dari server (HTTP ${res.status})`);
    }
    return data;
}


/**
 * Format teks penomoran pagination seragam untuk semua modal
 */
function getPaginationInfoText(currentPage, totalPages, totalItems, pageSize) {
    if (!totalItems || totalItems === 0) {
        return 'Menampilkan 0 data (Halaman 1/1)';
    }
    const pSize = pageSize || 10;
    const cPage = currentPage || 1;
    const tPages = Math.max(1, totalPages || Math.ceil(totalItems / pSize));
    const start = (cPage - 1) * pSize + 1;
    const end = Math.min(cPage * pSize, totalItems);
    return `Menampilkan ${start}–${end} dari ${totalItems} data (Halaman ${cPage}/${tPages})`;
}

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
    refreshInterval: 30,    // Interval refresh bawaan (detik)
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
    subconCurrentPage: 1,
    subconPageSize: 10,

    // State Khusus Modul Purchasing (Atena ERP)
    currentPurchasingRange: 'month',
    purchasingDateStart: '',
    purchasingDateEnd: '',
    currentPurchasingJenis: 'all',
    currentPurchasingStatus: 'all',
    currentPurchasingView: 'pr',
    purchasingSearchQuery: '',
    purchasingCurrentPage: 1,
    purchasingPageSize: 10,
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
    produksiPageSize: 10,
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
    logistikPageSize: 10,
    logistikRawData: null,
    logistikCache: new Map(),
    logistikSort: {
        orders: { column: 'tgl_jatuh_tempo', dir: 'desc' },
        items: { column: 'tgl_jatuh_tempo', dir: 'desc' }
    },

    // State Khusus Modul QA (Release Material GRS, Subcon SCN, Accept BR)
    currentQaRange: 'month',
    currentQaBagian: 'grsmaterial', // 'grsmaterial' | 'scn' | 'acceptbr'
    qaDateStart: '',
    qaDateEnd: '',
    currentQaStatus: 'all',
    currentQaGrsSubView: 'grs', // 'grs' (Daftar GRS) | 'po' (Ringkasan Per PO)
    qaSearchQuery: '',
    qaCurrentPage: 1,
    qaPageSize: 10,
    qaRawData: null,
    qaCache: new Map(),
    qaSort: {
        grs: { column: 'tanggal', dir: 'desc' },
        po: { column: 'tanggal', dir: 'desc' },
        scn: { column: 'tanggal', dir: 'desc' },
        acceptbr: { column: 'tgl_prh', dir: 'desc' },
    },

    // State Khusus Modul WH FG (Atena ERP REST API)
    currentWhFgRange: 'month',
    whFgDateStart: '',
    whFgDateEnd: '',
    currentWhFgStatus: 'all',
    currentWhFgView: 'dr', // 'dr' | 'items'
    whFgSearchQuery: '',
    whFgCurrentPage: 1,
    whFgPageSize: 10,
    whFgRawData: null,
    whFgCache: new Map(),
    whFgSort: {
        dr: { column: 'tanggal', dir: 'desc' },
        items: { column: 'tanggal', dir: 'desc' }
    },

    // State Khusus Modul WH Mat (Atena ERP REST API)
    currentWhMatBagian: 'permintaanbahan', // 'permintaanbahan' | 'dr'
    currentWhMatRange: 'month',
    whMatDateStart: '',
    whMatDateEnd: '',
    currentWhMatStatus: 'all',
    whMatMrSubView: 'doc', // 'doc' (Dokumen MR) | 'item' (Rincian MR)
    whMatDrSubView: 'doc', // 'doc' (Dokumen DR) | 'item' (Rincian DR)
    whMatSearchQuery: '',
    whMatCurrentPage: 1,
    whMatPageSize: 10,
    whMatRawData: null,
    whMatCache: new Map(),
    whMatSort: {
        mr_doc: { column: 'tgl_kirim', dir: 'desc' },
        mr: { column: 'tgl_kirim', dir: 'desc' },
        dr_doc: { column: 'tgl_kirim', dir: 'desc' },
        dr: { column: 'tgl_kirim', dir: 'desc' }
    },

    // State Khusus Modul HR (Atena ERP Kehadiran TK)
    currentHrBagian: 'tksna', // 'tksna' (TK SNA) | 'marketing' (Marketing/Non-SNAM)
    currentHrRange: 'month',
    hrDateStart: '',
    hrDateEnd: '',
    currentHrStatus: 'all', // 'all' | 'sesuai' | 'tidak_sesuai' | 'alpha' | 'terlambat' | 'beda_shift'
    hrSearchQuery: '',
    hrCurrentPage: 1,
    hrPageSize: 10,
    hrRawData: null,
    hrCache: new Map(),
    hrSort: { column: 'tanggal', dir: 'desc' },

    // Filter Periode Global Header (Bulan & Tahun)
    selectedMonth: new Date().getMonth() + 1,
    selectedYear: new Date().getFullYear(),
    selectedMonthName: INDO_MONTH_NAMES[new Date().getMonth()],
};

// ====================================================================
// KONFIGURASI URUTAN TAMPILAN CARD DASHBOARD (1 - 21)
// ====================================================================
// Silakan ubah angka (1 sampai 21) di bawah ini untuk mengatur urutan
// kartu dashboard sesuai preferensi Anda kapan saja.
// ====================================================================
window.CARD_DISPLAY_ORDER = {
    'card-IT': 1,                       // 1. Layanan IT
    'card-TK': 2,                       // 2. Layanan Teknik
    'card-GA': 3,                       // 3. Layanan General Affair (GA)
    'card-PROD_FINISHING': 4,           // 4. Produksi Finishing
    'card-PROD_ANTISEPTIK': 5,          // 5. Produksi Antiseptik
    'card-PROD_CW': 6,                  // 6. Produksi Cotton Wadding (CW)
    'card-PROD_SIZING': 7,              // 7. Produksi Sizing
    'card-PROD_POLIGYP': 8,             // 8. Produksi Poligyp
    'card-PROD_IRONING': 9,             // 9. Produksi Ironing
    'card-PROD_SURGICAL_MESIN': 10,     // 10. Produksi Surgical Mesin
    'card-PROD_SURGICAL_PACKING': 11,   // 11. Produksi Surgical Packing
    'card-PURCHASING': 12,              // 12. Purchasing
    'card-QA': 13,                      // 13. Quality Assurance (QA)
    'card-LOGISTIK': 14,                // 14. Logistik
    'card-WH_FG': 15,                   // 15. Gudang Jadi (WH FG)
    'card-WH_MAT': 16,                  // 16. Gudang Bahan (WH MAT)
    'card-PBF': 17,                     // 17. PBF Distribusi
    'card-HR': 18,                      // 18. Kehadiran Karyawan (HR)
    'card-DC': 19,                      // 19. Document Control (DC Paperless)
    'card-DEVELOPMENT': 20,             // 20. R&D Development
    'card-SUBCON': 21                   // 21. Monitoring Subcon (Paling Bawah)
};

/**
 * Menerapkan urutan tampilan kartu dashboard ke elemen DOM
 */
function applyCardDisplayOrder() {
    try {
        const orderConfig = window.CARD_DISPLAY_ORDER;
        const grid = document.querySelector('.cards-grid-10');
        if (!orderConfig || !grid) return;

        const cards = Array.from(grid.querySelectorAll('.service-card'));
        cards.forEach(card => {
            const cardId = card.id;
            const orderNum = orderConfig[cardId] !== undefined ? orderConfig[cardId] : 999;
            card.style.order = orderNum;
            card.setAttribute('data-card-order', orderNum);
        });

        // Urutkan juga child elements di dalam container grid DOM
        cards.sort((a, b) => {
            const orderA = orderConfig[a.id] !== undefined ? orderConfig[a.id] : 999;
            const orderB = orderConfig[b.id] !== undefined ? orderConfig[b.id] : 999;
            return orderA - orderB;
        });

        cards.forEach(card => grid.appendChild(card));
    } catch (err) {
        console.warn('⚠️ [applyCardDisplayOrder Error]:', err);
    }
}

// ====================================================================
// 1. INISIALISASI SAAT HALAMAN SELESAI DIMUAT
// ====================================================================
document.addEventListener('DOMContentLoaded', () => {
    applyCardDisplayOrder();
    initClock();
    initPeriodSelector();
    initModalDatePickers();
    initEventListeners();
    fetchDashboardStats();
    startAutoRefresh();
});

// ====================================================================
// 1B. INISIALISASI SELECTOR PERIODE BULAN & TAHUN HEADER (FLATPICKR DEFAULT)
// ====================================================================
function initPeriodSelector() {
    const pickerInput = document.getElementById('headerMonthPicker');
    const periodBox = document.getElementById('headerPeriodBox');
    if (!pickerInput) return;

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-12
    const monthNames = INDO_MONTH_NAMES;

    state.selectedMonth = currentMonth;
    state.selectedYear = currentYear;
    state.selectedMonthName = monthNames[currentMonth - 1];

    pickerInput.value = `${monthNames[state.selectedMonth - 1]} ${state.selectedYear}`;
    updateAllCardPeriodLabels();

    let fpInstance = null;
    if (typeof flatpickr !== 'undefined') {
        const plugins = [];
        if (typeof monthSelectPlugin !== 'undefined') {
            plugins.push(new monthSelectPlugin({
                shorthand: true,
                dateFormat: "F Y",
                altFormat: "F Y",
                theme: "light"
            }));
        }

        fpInstance = flatpickr(pickerInput, {
            locale: 'id',
            defaultDate: `${state.selectedYear}-${String(state.selectedMonth).padStart(2, '0')}-01`,
            plugins: plugins,
            disableMobile: true,
            onOpen: () => {
                if (periodBox) periodBox.classList.add('is-open');
            },
            onClose: () => {
                if (periodBox) periodBox.classList.remove('is-open');
            },
            onChange: async (selectedDates) => {
                if (selectedDates && selectedDates.length > 0) {
                    const d = selectedDates[0];
                    state.selectedYear = d.getFullYear();
                    state.selectedMonth = d.getMonth() + 1;
                    state.selectedMonthName = monthNames[state.selectedMonth - 1];
                    const periodStr = `${monthNames[state.selectedMonth - 1]} ${state.selectedYear}`;
                    pickerInput.value = periodStr;
                    console.log(`📅 [Periode]: Bulan diubah ke ${state.selectedMonth}, Tahun ${state.selectedYear}`);
                    
                    setPeriodLoading(true, periodStr);
                    updateAllCardPeriodLabels();
                    try {
                        await fetchDashboardStats(false, true);
                        refreshOpenModalOnPeriodChange();
                        if (!state.isOffline) {
                            showToast(`Data periode ${periodStr} berhasil dimuat`, 'success');
                        } else {
                            showToast(`Gagal memuat data periode ${periodStr}`, 'error');
                        }
                    } catch (err) {
                        console.error('Error updating period:', err);
                        showToast(`Gagal memuat data periode ${periodStr}`, 'error');
                    } finally {
                        setPeriodLoading(false);
                    }
                }
            }
        });

        if (periodBox) {
            periodBox.addEventListener('click', () => {
                if (fpInstance) fpInstance.open();
            });
        }
    }
}

/**
 * Kontrol visual loading indikator saat pemilihan bulan/periode di dashboard
 */
function setPeriodLoading(isLoading, periodName = '') {
    const loadingBar = document.getElementById('globalLoadingBar');
    const loadingPill = document.getElementById('periodLoadingIndicator');
    const periodLabel = document.getElementById('loadingPeriodLabel');
    const periodBox = document.getElementById('headerPeriodBox');
    const cardsGrid = document.querySelector('.cards-grid-10') || document.querySelector('.services-grid');

    if (isLoading) {
        if (loadingBar) {
            loadingBar.classList.remove('is-finished');
            loadingBar.classList.add('is-loading');
        }
        if (periodLabel && periodName) {
            periodLabel.textContent = periodName;
        }
        if (loadingPill) {
            loadingPill.style.display = 'inline-flex';
            requestAnimationFrame(() => loadingPill.classList.add('is-active'));
        }
        if (periodBox) {
            periodBox.classList.add('is-loading');
            const caret = periodBox.querySelector('.period-caret');
            if (caret) {
                caret.className = 'fa-solid fa-arrows-rotate fa-spin period-caret';
            }
        }
        if (cardsGrid) {
            cardsGrid.classList.add('is-loading-period');
        }
    } else {
        if (loadingBar) {
            loadingBar.classList.remove('is-loading');
            loadingBar.classList.add('is-finished');
            setTimeout(() => {
                loadingBar.classList.remove('is-finished');
            }, 600);
        }
        if (loadingPill) {
            loadingPill.classList.remove('is-active');
            setTimeout(() => {
                loadingPill.style.display = 'none';
            }, 250);
        }
        if (periodBox) {
            periodBox.classList.remove('is-loading');
            const caret = periodBox.querySelector('.period-caret');
            if (caret) {
                caret.className = 'fa-solid fa-angle-down period-caret';
            }
        }
        if (cardsGrid) {
            cardsGrid.classList.remove('is-loading-period');
        }
    }
}

/**
 * Menampilkan notifikasi toast ringkas di pojok kanan bawah
 */
function showToast(message, type = 'info') {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast-message toast-${type}`;
    let icon = 'fa-circle-info';
    if (type === 'success') icon = 'fa-circle-check';
    if (type === 'error') icon = 'fa-circle-xmark';
    if (type === 'warning') icon = 'fa-triangle-exclamation';
    
    toast.innerHTML = `<i class="fa-solid ${icon}"></i><span>${message}</span>`;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 2800);
}


/**
 * Helper: Menghitung rentang tanggal aktif berdasarkan bulan & tahun yang dipilih di header dashboard
 * @param {string} preset 'month' | 'today' | 'week' | 'all' | 'last_month'
 * @returns {{ startDate: string, endDate: string, today: string, firstDay: string, lastDayOfMonth: string }}
 */
function getActivePeriodDates(preset = 'month') {
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth() + 1; // 1-12
    const curDay = now.getDate();

    const year = state.selectedYear ? parseInt(state.selectedYear, 10) : curYear;
    const month = state.selectedMonth ? parseInt(state.selectedMonth, 10) : curMonth;
    const isCurrentPeriod = (year === curYear && month === curMonth);

    const padMonth = String(month).padStart(2, '0');
    const firstDay = `${year}-${padMonth}-01`;
    const lastDayNum = new Date(year, month, 0).getDate();
    const lastDayOfMonth = `${year}-${padMonth}-${String(lastDayNum).padStart(2, '0')}`;
    const today = `${curYear}-${String(curMonth).padStart(2, '0')}-${String(curDay).padStart(2, '0')}`;

    let startDate = firstDay;
    let endDate = isCurrentPeriod ? today : lastDayOfMonth;

    if (preset === 'month') {
        startDate = firstDay;
        endDate = isCurrentPeriod ? today : lastDayOfMonth;
    } else if (preset === 'today') {
        startDate = isCurrentPeriod ? today : firstDay;
        endDate = isCurrentPeriod ? today : firstDay;
    } else if (preset === 'week') {
        if (isCurrentPeriod) {
            const d = new Date();
            d.setDate(d.getDate() - 7);
            const wYear = d.getFullYear();
            const wMonth = String(d.getMonth() + 1).padStart(2, '0');
            const wDay = String(d.getDate()).padStart(2, '0');
            startDate = `${wYear}-${wMonth}-${wDay}`;
            endDate = today;
        } else {
            startDate = firstDay;
            endDate = `${year}-${padMonth}-${String(Math.min(7, lastDayNum)).padStart(2, '0')}`;
        }
    } else if (preset === 'all') {
        startDate = '2024-01-01';
        endDate = isCurrentPeriod ? today : lastDayOfMonth;
    } else if (preset === 'last_month') {
        const prevDate = new Date(year, month - 1, 0);
        const pYear = prevDate.getFullYear();
        const pMonth = prevDate.getMonth() + 1;
        const pLastDay = prevDate.getDate();
        startDate = `${pYear}-${String(pMonth).padStart(2, '0')}-01`;
        endDate = `${pYear}-${String(pMonth).padStart(2, '0')}-${String(pLastDay).padStart(2, '0')}`;
    }

    return { startDate, endDate, today, firstDay, lastDayOfMonth, isCurrentPeriod };
}

/**
 * Sinkronisasi nilai input datepicker DOM dan instance flatpickr-nya jika ada
 */
function setDateInputValue(id, val) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = val;
    if (el._flatpickr) {
        el._flatpickr.setDate(val, false);
    }
}

/**
 * Otomatis menyinkronkan modal yang sedang terbuka saat filter bulan di header diubah
 */
function refreshOpenModalOnPeriodChange() {
    if (document.getElementById('qaModal')?.classList.contains('active') && typeof setQaQuickDate === 'function') {
        setQaQuickDate(state.currentQaRange || 'month');
    }
    if (document.getElementById('purchasingModal')?.classList.contains('active') && typeof setPurchasingQuickDate === 'function') {
        setPurchasingQuickDate(state.currentPurchasingRange || 'month');
    }
    if (document.getElementById('subconModal')?.classList.contains('active') && typeof switchSubconRange === 'function') {
        switchSubconRange(state.currentSubconRange || 'month');
    }
    if (document.getElementById('produksiModal')?.classList.contains('active') && typeof setProduksiQuickDate === 'function') {
        setProduksiQuickDate(state.currentProduksiPeriod || 'month');
    }
    if (document.getElementById('logistikModal')?.classList.contains('active') && typeof setLogistikQuickDate === 'function') {
        setLogistikQuickDate(state.currentLogistikRange || 'month');
    }
    if (document.getElementById('whFgModal')?.classList.contains('active') && typeof setWhFgQuickDate === 'function') {
        setWhFgQuickDate(state.currentWhFgRange || 'month');
    }
    if (document.getElementById('whMatModal')?.classList.contains('active') && typeof setWhMatQuickDate === 'function') {
        setWhMatQuickDate(state.currentWhMatRange || 'month');
    }
    if (document.getElementById('pbfModal')?.classList.contains('active') && typeof setPbfQuickDate === 'function') {
        setPbfQuickDate(state.currentPbfRange || 'month');
    }
    if (document.getElementById('hrModal')?.classList.contains('active') && typeof setHrQuickDate === 'function') {
        setHrQuickDate(state.currentHrRange || 'month');
    }
    if (document.getElementById('devModal')?.classList.contains('active') && typeof setDevQuickDate === 'function') {
        setDevQuickDate(state.currentDevRange || 'month');
    }
    if (document.getElementById('dcModal')?.classList.contains('active') && typeof setDcQuickDate === 'function') {
        setDcQuickDate(state.currentDcRange || 'month');
    }
}

// ====================================================================
// 1C. INISIALISASI FLATPICKR PADA SELURUH FILTER TANGGAL MODAL DETAIL
// ====================================================================
function initModalDatePickers() {
    if (typeof flatpickr === 'undefined') return;

    const dateInputIds = [
        'subconDateStart', 'subconDateEnd',
        'hrDateStart', 'hrDateEnd',
        'purchasingDateStart', 'purchasingDateEnd',
        'qaDateStart', 'qaDateEnd',
        'pbfDateStart', 'pbfDateEnd',
        'prodDateStart', 'prodDateEnd',
        'logistikDateStart', 'logistikDateEnd',
        'whFgDateStart', 'whFgDateEnd',
        'whMatDateStart', 'whMatDateEnd',
        'devDateStart', 'devDateEnd',
        'dcDateStart', 'dcDateEnd'
    ];

    dateInputIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el || el._flatpickr) return;

        flatpickr(el, {
            locale: 'id',
            dateFormat: 'Y-m-d',
            disableMobile: true,
            allowInput: false,
            onOpen: function(selectedDates, dateStr, instance) {
                if (el.value) {
                    instance.setDate(el.value, false);
                }
            },
            onChange: function(selectedDates, dateStr) {
                el.value = dateStr;
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
    });
}

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
            closeWhFgModal();
            closeWhMatModal();
            closePbfModal();
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

    const whFgModalOverlay = document.getElementById('whFgModal');
    if (whFgModalOverlay) {
        whFgModalOverlay.addEventListener('click', (e) => {
            if (e.target === whFgModalOverlay) {
                closeWhFgModal();
            }
        });
    }

    const whMatModalOverlay = document.getElementById('whMatModal');
    if (whMatModalOverlay) {
        whMatModalOverlay.addEventListener('click', (e) => {
            if (e.target === whMatModalOverlay) {
                closeWhMatModal();
            }
        });
    }

    const pbfModalOverlay = document.getElementById('pbfModal');
    if (pbfModalOverlay) {
        pbfModalOverlay.addEventListener('click', (e) => {
            if (e.target === pbfModalOverlay) {
                closePbfModal();
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
async function fetchDashboardStats(force = false, isPeriodSwitch = false) {
    if (state.isFetching) {
        if (!isPeriodSwitch) return;
        // Jika pengguna baru saja mengganti bulan/periode di header, batalkan request lama yang sedang berjalan
        if (state.activeFetchController) {
            try { state.activeFetchController.abort('PERIOD_SWITCH'); } catch (_) {}
        }
    }
    state.isFetching = true;

    const refreshIcon = document.getElementById('refreshIcon');
    if (refreshIcon) refreshIcon.classList.add('fa-spin');

    // Timeout 35 detik dengan AbortController agar penarikan bulan historis (31 hari penuh) dari ERP tidak terputus prematur
    const controller = new AbortController();
    state.activeFetchController = controller;
    const timeoutId = setTimeout(() => controller.abort('TIMEOUT'), 35000);

    try {
        const params = new URLSearchParams();
        if (state.selectedMonth) params.set('bulan', state.selectedMonth);
        if (state.selectedYear) params.set('tahun', state.selectedYear);
        if (force) params.set('force', 'true');
        const url = `/api/dashboard/stats?${params.toString()}`;
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

        // Render Data ke Tampilan (Terisolasi try/catch agar satu modul tidak memblokir yang lain)
        try { renderGlobalKPI(data.kpi_global); } catch (e) { console.error('Error renderGlobalKPI:', e); }
        try { renderServiceCards(data.layanan); } catch (e) { console.error('Error renderServiceCards:', e); }
        try { renderKpiTrackerTicker(data); } catch (e) { console.error('Error renderKpiTrackerTicker:', e); }
        try { applyCardDisplayOrder(); } catch (e) { console.error('Error applyCardDisplayOrder:', e); }
        updateSystemStatus(true, Boolean(data._cached));

        // Reset hitung mundur normal setelah fetch sukses
        state.countdownTimer = state.refreshInterval;
        updateCountdownUI();

    } catch (error) {
        clearTimeout(timeoutId);
        // Abaikan jika dibatalkan karena pengguna berpindah periode bulan
        if (controller.signal.reason === 'PERIOD_SWITCH') {
            return;
        }
        const isAbort = error.name === 'AbortError';
        const errorMsg = isAbort ? 'Request Timeout (35s)' : (error.message || 'Jaringan Terputus');
        console.warn(`⚠️ [Sync Error]: ${errorMsg}, mencoba reconnect otomatis dalam 5 detik...`);

        state.isOffline = true;
        // Atur interval retry cepat (5 detik)
        state.countdownTimer = state.retryInterval;
        updateSystemStatus(false);
        updateCountdownUI();

    } finally {
        if (state.activeFetchController === controller) {
            state.isFetching = false;
            state.activeFetchController = null;
        }
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
function getKpiClass(val) {
    const v = Number(val || 0);
    if (v > 85) return { text: 'kpi-color-green', fill: 'kpi-fill-green' };
    if (v >= 75) return { text: 'kpi-color-yellow', fill: 'kpi-fill-yellow' };
    return { text: 'kpi-color-red', fill: 'kpi-fill-red' };
}


/**
 * Memperbarui seluruh label periode di semua 21 kartu dashboard
 * Sesuai bulan & tahun yang sedang dipilih di filter navbar atas.
 */
function updateAllCardPeriodLabels() {
    // 1. Kosongkan seluruh label periode (.percent-lbl) pada semua kartu sehingga hanya angka persentase yang tampil
    document.querySelectorAll('.percent-lbl').forEach(lbl => {
        lbl.textContent = '';
    });

    // 2. Purchasing (Dual Hero: Material & Non-Material)
    const cardPurchasing = document.getElementById('card-PURCHASING');
    if (cardPurchasing) {
        cardPurchasing.querySelectorAll('.percent-hero span[style*="font-size: 0.62rem"]').forEach(span => {
            span.textContent = '';
        });
    }

    // 3. QA (Triple Hero: GRS, SCN, Acc BR)
    const cardQa = document.getElementById('card-QA');
    if (cardQa) {
        cardQa.querySelectorAll('.percent-hero span[style*="font-size: 0.58rem"]').forEach(span => {
            span.textContent = '';
        });
    }

    // 4. WH Material (Dual Hero: MR Bahan & DR Paskot)
    const cardWhMat = document.getElementById('card-WH_MAT');
    if (cardWhMat) {
        cardWhMat.querySelectorAll('.percent-hero span[style*="font-size: 0.62rem"]').forEach(span => {
            span.textContent = '';
        });
    }

    // 5. HR (Dual Hero: TK SNA & Marketing)
    const lblTk = document.getElementById('lblHrPeriodTkSna');
    const lblMkt = document.getElementById('lblHrPeriodMarketing');
    if (lblTk) lblTk.textContent = '';
    if (lblMkt) lblMkt.textContent = '';

    // 6. Subcon (Hasil Produksi PCS)
    const subHeroSub = document.getElementById('subconHeroSub');
    if (subHeroSub) {
        subHeroSub.innerHTML = '<i class="fa-solid fa-industry"></i> Hasil Produksi';
    }
}

function renderServiceCards(layanan) {
    if (!layanan) return;
    updateAllCardPeriodLabels();

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

        // Penanganan Modul Pengerjaan Subcon (Jumlah Hasil Produksi PCS)
        if (code === 'SUBCON') {
            const pcs = item.total_output_pcs || 0;
            animateCounter('totalPcsSUBCON', pcs);

            const subHeroSub = document.getElementById('subconHeroSub');
            if (subHeroSub) {
                subHeroSub.innerHTML = '<i class="fa-solid fa-industry"></i> Hasil Produksi';
            }

            const subconEl = document.getElementById('subconJumlahSubcon') || document.getElementById('totalSUBCON') || document.getElementById('subconJumlahMitra');
            if (subconEl) {
                subconEl.textContent = String(item.total_subcon || 1);
            }

            const karyawanEl = document.getElementById('subconJumlahKaryawan') || document.getElementById('karyawanSUBCON');
            if (karyawanEl) {
                karyawanEl.textContent = String(item.total_karyawan || 0);
            }
            return;
        }

        // Penanganan Modul Kehadiran Karyawan (HR) - Dual Hero: TK SNA & Marketing
        if (code === 'HR') {
            const now = new Date();
            const isCurrent = (state.selectedYear == now.getFullYear() && state.selectedMonth == (now.getMonth() + 1));
            const lblTk = document.getElementById('lblHrPeriodTkSna');
            const lblMkt = document.getElementById('lblHrPeriodMarketing');
            if (lblTk) lblTk.textContent = '';
            if (lblMkt) lblMkt.textContent = '';

            const tksna = item.sub_metrics?.tksna || {};
            const mkt = item.sub_metrics?.marketing || {};

            const percentTk = Number(tksna.persentase || 0);
            const percentMkt = Number(mkt.persentase || 0);

            const elTk = document.getElementById('percentHrTkSna');
            const barTk = document.getElementById('barFillHrTkSna');
            if (elTk) {
                const kpiTk = getKpiClass(percentTk);
                elTk.textContent = percentTk + '%';
                elTk.className = 'percent-val ' + kpiTk.text;
                if (barTk) {
                    barTk.style.width = Math.min(Math.max(percentTk, 0), 100) + '%';
                    barTk.className = 'progress-bar-fill ' + kpiTk.fill;
                }
            }

            const elMkt = document.getElementById('percentHrMarketing');
            const barMkt = document.getElementById('barFillHrMarketing');
            if (elMkt) {
                const kpiMkt = getKpiClass(percentMkt);
                elMkt.textContent = percentMkt + '%';
                elMkt.className = 'percent-val ' + kpiMkt.text;
                if (barMkt) {
                    barMkt.style.width = Math.min(Math.max(percentMkt, 0), 100) + '%';
                    barMkt.className = 'progress-bar-fill ' + kpiMkt.fill;
                }
            }

            // Fallback hidden element
            const percentEl = document.getElementById('percentHR');
            if (percentEl) percentEl.textContent = (item.persentase_selesai || 0) + '%';

            animateCounter('totalHR', item.total_tiket || item.total || 0);
            animateCounter('selesaiHR', item.selesai || 0);
            animateCounter('belumHR', item.belum_selesai || 0);
            return;
        }

        // Penanganan Modul Document Control (DC)
        if (code === 'DC') {
            const now = new Date();
            const isCurrent = (state.selectedYear == now.getFullYear() && state.selectedMonth == (now.getMonth() + 1));
            const lblDc = document.getElementById('lblDcPeriod');
            if (lblDc) {
                lblDc.textContent = '';
            }

            const percent = Number(item.persentase_selesai || 0);
            const percentEl = document.getElementById('percentDC');
            const barFill = document.getElementById('barFillDC');
            const kpi = getKpiClass(percent);
            if (percentEl) {
                percentEl.textContent = percent + '%';
                percentEl.className = 'percent-val ' + kpi.text;
            }
            if (barFill) {
                barFill.style.width = Math.min(Math.max(percent, 0), 100) + '%';
                barFill.className = 'progress-bar-fill ' + kpi.fill;
            }

            animateCounter('totalDC', item.total_tiket || item.total || 0);
            animateCounter('selesaiDC', item.selesai || 0);
            animateCounter('belumDC', item.belum_selesai || item.belum || item.total_belum || 0);
            return;
        }

        // Penanganan Modul Development (R&D)
        if (code === 'DEVELOPMENT') {
            const now = new Date();
            const isCurrent = (state.selectedYear == now.getFullYear() && state.selectedMonth == (now.getMonth() + 1));
            const lblDev = document.getElementById('lblDevPeriod');
            if (lblDev) {
                lblDev.textContent = '';
            }

            const percent = Number(item.persentase_selesai || 0);
            const percentEl = document.getElementById('percentDEVELOPMENT');
            const barFill = document.getElementById('barFillDEVELOPMENT');
            const kpi = getKpiClass(percent);
            if (percentEl) {
                percentEl.textContent = percent + '%';
                percentEl.className = 'percent-val ' + kpi.text;
            }
            if (barFill) {
                barFill.style.width = Math.min(Math.max(percent, 0), 100) + '%';
                barFill.className = 'progress-bar-fill ' + kpi.fill;
            }

            animateCounter('totalDEVELOPMENT', item.total_tiket || item.total || 0);
            animateCounter('selesaiDEVELOPMENT', item.selesai || 0);
            animateCounter('belumDEVELOPMENT', item.belum_selesai || 0);
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
        let percent = item.persentase_selesai || 0;


        if (code === 'WH_MAT') {
            const pctMr = Number(item.persentase_mr ?? item.mr?.persentase_selesai ?? 0);
            const pctDr = Number(item.persentase_dr ?? item.dr?.persentase_selesai ?? 0);
            if (pctMr > 0 && pctDr > 0) {
                percent = Number(((pctMr + pctDr) / 2).toFixed(2));
            } else if (pctMr > 0) {
                percent = pctMr;
            } else if (pctDr > 0) {
                percent = pctDr;
            }
        }
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
            barFill.style.width = `${Math.min(Math.max(percent, 0), 100)}%`;
            barFill.className = `progress-bar-fill ${kpiFillClass}`;
        }

        // 3. Update Status Badge (Live vs Standby) & Dual/Triple Hero secara dinamis

        if (code === 'PURCHASING') {
            const matPct = Number(item.persentase_material ?? item.material?.persentase ?? 0);
            const nonMatPct = Number(item.persentase_non_material ?? item.non_material?.persentase ?? 0);

            const elMat = document.getElementById('percentPurchasingMaterial');
            const barMat = document.getElementById('barFillPurchasingMaterial');
            if (elMat) {
                elMat.textContent = `${matPct}%`;
                elMat.className = `percent-val ${getKpiClass(matPct).text}`;
            }
            if (barMat) {
                barMat.style.width = `${Math.min(Math.max(matPct, 0), 100)}%`;
                barMat.className = `progress-bar-fill ${getKpiClass(matPct).fill}`;
            }

            const elNon = document.getElementById('percentPurchasingNonMaterial');
            const barNon = document.getElementById('barFillPurchasingNonMaterial');
            if (elNon) {
                elNon.textContent = `${nonMatPct}%`;
                elNon.className = `percent-val ${getKpiClass(nonMatPct).text}`;
            }
            if (barNon) {
                barNon.style.width = `${Math.min(Math.max(nonMatPct, 0), 100)}%`;
                barNon.className = `progress-bar-fill ${getKpiClass(nonMatPct).fill}`;
            }
        }

        if (code === 'QA') {
            const grsPct = Number(item.grs?.persentase ?? item.persentase_grs ?? 0);
            const scnPct = Number(item.scn?.persentase ?? item.persentase_scn ?? 0);
            const brPct = Number(item.acceptbr?.persentase ?? item.persentase_br ?? 0);

            const elGrs = document.getElementById('percentQaGrs');
            const barGrs = document.getElementById('barFillQaGrs');
            if (elGrs) {
                elGrs.textContent = `${grsPct}%`;
                elGrs.className = `percent-val ${getKpiClass(grsPct).text}`;
            }
            if (barGrs) {
                barGrs.style.width = `${Math.min(Math.max(grsPct, 0), 100)}%`;
                barGrs.className = `progress-bar-fill ${getKpiClass(grsPct).fill}`;
            }

            const elScn = document.getElementById('percentQaScn');
            const barScn = document.getElementById('barFillQaScn');
            if (elScn) {
                elScn.textContent = `${scnPct}%`;
                elScn.className = `percent-val ${getKpiClass(scnPct).text}`;
            }
            if (barScn) {
                barScn.style.width = `${Math.min(Math.max(scnPct, 0), 100)}%`;
                barScn.className = `progress-bar-fill ${getKpiClass(scnPct).fill}`;
            }

            const elBr = document.getElementById('percentQaBr');
            const barBr = document.getElementById('barFillQaBr');
            if (elBr) {
                elBr.textContent = `${brPct}%`;
                elBr.className = `percent-val ${getKpiClass(brPct).text}`;
            }
            if (barBr) {
                barBr.style.width = `${Math.min(Math.max(brPct, 0), 100)}%`;
                barBr.className = `progress-bar-fill ${getKpiClass(brPct).fill}`;
            }
        }

        if (code === 'WH_MAT') {
            const pctMr = Number(item.persentase_mr ?? item.mr?.persentase_selesai ?? 0);
            const pctDr = Number(item.persentase_dr ?? item.dr?.persentase_selesai ?? 0);

            const elMr = document.getElementById('percentWhMatMr');
            const barMr = document.getElementById('barFillWhMatMr');
            if (elMr) {
                elMr.textContent = `${pctMr}%`;
                elMr.className = `percent-val ${getKpiClass(pctMr).text}`;
            }
            if (barMr) {
                barMr.style.width = `${Math.min(Math.max(pctMr, 0), 100)}%`;
                barMr.className = `progress-bar-fill ${getKpiClass(pctMr).fill}`;
            }

            const elDr = document.getElementById('percentWhMatDr');
            const barDr = document.getElementById('barFillWhMatDr');
            if (elDr) {
                elDr.textContent = `${pctDr}%`;
                elDr.className = `percent-val ${getKpiClass(pctDr).text}`;
            }
            if (barDr) {
                barDr.style.width = `${Math.min(Math.max(pctDr, 0), 100)}%`;
                barDr.className = `progress-bar-fill ${getKpiClass(pctDr).fill}`;
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

    try {
        const kpi = data.kpi_global || {};
        const layanan = data.layanan || {};
        const subcon = layanan.SUBCON || {};

        const items = [];

        // 1. Capaian Produksi Subcon
        const totalPcs = Number(subcon.total_output_pcs || 0).toLocaleString('id-ID');
        const namaSubcon = subcon.subcon_nama || 'SIMAN';
        const totalKaryawan = subcon.total_karyawan || 27;
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
                <span class="ticker-kpi-sub">(dari total ${totalTiket} tiket • ${kpi.persentase_selesai || 0}%)</span>
            </span>
        `);

        // 3. Tiket Dalam Proses
        const pendingTiket = kpi.total_belum_selesai || 0;
        items.push(`
            <span class="ticker-item">
                <i class="fa-solid fa-clock-rotate-left" style="color: #f59e0b;"></i>
                <span>Tiket Dalam Proses:</span>
                <b style="color: #d97706;">${pendingTiket} Tiket</b>
            </span>
        `);

        // 4. Realisasi Per Divisi Operasional (IT, TK, GA)
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

        // 5. Realisasi Penyelesaian PP Produksi (Atena ERP)
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

        // 6. Realisasi Pemenuhan PR Purchasing (Atena ERP)
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

        // 7. Realisasi Pemenuhan Order Logistik (Atena ERP)
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

        // 8. Realisasi Release Material QA (GRS Atena ERP)
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

        // 9. Kehadiran Karyawan (HR)
        if (layanan.HR && layanan.HR.sub_metrics) {
            const tk = layanan.HR.sub_metrics.tksna?.persentase ?? 0;
            const mkt = layanan.HR.sub_metrics.marketing?.persentase ?? 0;
            items.push(`
                <span class="ticker-item">
                    <i class="fa-solid fa-users" style="color: #0284c7;"></i>
                    <span>Kehadiran HR Hari Ini:</span>
                    <b style="color: #0284c7;">TK SNA ${tk}%</b> &bull; <b style="color: #0284c7;">Marketing ${mkt}%</b>
                </span>
            `);
        }

        // 10. Document Control (DC Paperless)
        if (layanan.DC) {
            items.push(`
                <span class="ticker-item">
                    <i class="fa-solid fa-file-signature" style="color: #9333ea;"></i>
                    <span>DC Paperless:</span>
                    <b style="color: #9333ea;">${layanan.DC.selesai}/${layanan.DC.total} Dokumen</b>
                    <span class="ticker-kpi-sub">(${layanan.DC.persentase_selesai}%)</span>
                </span>
            `);
        }

        // 11. Development (R&D Permintaan BOM)
        if (layanan.DEVELOPMENT) {
            items.push(`
                <span class="ticker-item">
                    <i class="fa-solid fa-compass-drafting" style="color: #ea580c;"></i>
                    <span>Development (R&D):</span>
                    <b style="color: #ea580c;">${layanan.DEVELOPMENT.selesai}/${layanan.DEVELOPMENT.total} BOM Selesai</b>
                    <span class="ticker-kpi-sub">(${layanan.DEVELOPMENT.persentase_selesai}%)</span>
                </span>
            `);
        }

        const itemsHtml = items.join(' &bull; ');

        // Cegah animasi mereset lompat ke awal jika konten ticker sama dengan putaran sebelumnya
        if (state.lastTickerContent === itemsHtml) {
            return;
        }
        state.lastTickerContent = itemsHtml;

        // Gandakan konten agar animasi marquee meluncur mulus tanpa jeda terputus
        listEl.innerHTML = itemsHtml + ' &bull; ' + itemsHtml;
    } catch (err) {
        console.error('Error renderKpiTrackerTicker:', err);
    }
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
    state.subconCurrentPage = 1;

    const { startDate, endDate } = getActivePeriodDates(range);
    state.subconDateStart = startDate;
    state.subconDateEnd = endDate;

    setDateInputValue('subconDateStart', startDate);
    setDateInputValue('subconDateEnd', endDate);

    // Update tampilan tombol range
    const btnToday = document.getElementById('btnRangeToday');
    const btnWeek = document.getElementById('btnRangeWeek');
    const btnMonth = document.getElementById('btnRangeMonth');

    if (btnToday) btnToday.classList.toggle('active', range === 'today');
    if (btnWeek) btnWeek.classList.toggle('active', range === 'week');
    if (btnMonth) btnMonth.classList.toggle('active', range === 'month');

    // Cek cache lokal frontend
    const cacheKey = `subcon_${startDate}_${endDate}_${range}`;
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
        const response = await fetch(`/api/dashboard/subcon?range=${encodeURIComponent(range)}&tanggal_mulai=${encodeURIComponent(startDate)}&tanggal_akhir=${encodeURIComponent(endDate)}`);
        const result = await response.json();

        if (!result.success) {
            throw new Error(result.message || 'Gagal mengambil data monitoring subcon');
        }

        state.subconCache.set(cacheKey, { data: result.data, timestamp: Date.now() });
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
    switchSubconRange('month');
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
        renderSubconPagination(0);
        return;
    }

    const pageSize = state.subconPageSize || 10;
    const totalPages = Math.ceil(items.length / pageSize) || 1;
    if ((state.subconCurrentPage || 1) > totalPages) {
        state.subconCurrentPage = totalPages;
    }
    const page = state.subconCurrentPage || 1;
    const startIdx = (page - 1) * pageSize;
    const paginatedItems = items.slice(startIdx, startIdx + pageSize);

    tbody.innerHTML = paginatedItems.map(b => `
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

    renderSubconPagination(items.length);
}

function renderSubconPagination(totalItems) {
    const pageInfo = document.getElementById('subconPageInfo');
    const btnPrev = document.getElementById('btnSubconPrevPage');
    const btnNext = document.getElementById('btnSubconNextPage');
    if (!pageInfo && !btnPrev && !btnNext) return;

    const pageSize = state.subconPageSize || 10;
    const totalPages = Math.ceil(totalItems / pageSize) || 1;
    const currentPage = state.subconCurrentPage || 1;

    if (pageInfo) {
        pageInfo.textContent = getPaginationInfoText(currentPage, totalPages, totalItems, pageSize);
    }
    if (btnPrev) btnPrev.disabled = currentPage <= 1;
    if (btnNext) btnNext.disabled = currentPage >= totalPages;
}

function changeSubconPage(delta) {
    state.subconCurrentPage = (state.subconCurrentPage || 1) + delta;
    renderSubconFilteredTables();
}

async function syncSubconData() {
    const btn = document.getElementById('btnSyncSubcon');
    if (btn) btn.classList.add('rotating');
    try {
        if (state.subconCache) state.subconCache.clear();
        await switchSubconRange(state.currentSubconRange || 'today');
        const syncEl = document.getElementById('subconLastSyncTime');
        if (syncEl) syncEl.textContent = `Sinkron: ${new Date().toLocaleTimeString('id-ID')}`;
        showToast('Data Subcon berhasil disinkronkan', 'success');
    } catch (err) {
        showToast('Gagal menyinkronkan data Subcon: ' + err.message, 'error');
    } finally {
        if (btn) btn.classList.remove('rotating');
    }
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

    const { startDate, endDate } = getActivePeriodDates(preset);
    state.purchasingDateStart = startDate;
    state.purchasingDateEnd = endDate;

    setDateInputValue('purchasingDateStart', startDate);
    setDateInputValue('purchasingDateEnd', endDate);

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
        if (pageInfo) pageInfo.textContent = 'Menampilkan 0 data (Halaman 1/1)';
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
        pageInfo.textContent = getPaginationInfoText(state.purchasingCurrentPage, totalPages, prList.length, pageSize);
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
        if (pageInfo) pageInfo.textContent = 'Menampilkan 0 data (Halaman 1/1)';
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
        pageInfo.textContent = getPaginationInfoText(state.purchasingCurrentPage, totalPages, itemList.length, pageSize);
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
    stentor: { name: 'Produksi Finishing', judul: 'Penyelesaian PP Stentor', tahap: 'STENTOR', unit: 'Meter / PCS', icon: 'fa-industry' },
    antiseptik: { name: 'Produksi Antiseptik', judul: 'Penyelesaian PP Packing', tahap: 'PACKING', unit: 'Botol / PCS', icon: 'fa-pump-medical' },
    cw: { name: 'Produksi CW', judul: 'Penyelesaian PP CW Packing', tahap: 'CW PACKING', unit: 'PCS', icon: 'fa-prescription-bottle' },
    sizing: { name: 'Produksi Sizing', judul: 'Penyelesaian PP Sizing', tahap: 'SIZING', unit: 'Meter / Beam', icon: 'fa-ruler-combined' },
    poligyp: { name: 'Produksi Poligyp', judul: 'Penyelesaian PP Poligyp Packing', tahap: 'POLIGYP PACKING', unit: 'Roll / PCS', icon: 'fa-bandage' },
    ironing: { name: 'Produksi Ironing', judul: 'Penyelesaian PP Ironing', tahap: 'IRONING', unit: 'PCS / Meter', icon: 'fa-shirt' },
    surgicalmesin: { name: 'Produksi Surgical Mesin', judul: 'Penyelesaian PP Surgical Mesin', tahap: 'SURGICAL MESIN', unit: 'PCS / Box', icon: 'fa-gears' },
    surgicalpacking: { name: 'Produksi Surgical Packing', judul: 'Penyelesaian PP Surgical Packing', tahap: 'SURGICAL PACKING', unit: 'Box / Karton', icon: 'fa-box-tissue' }
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

    const { startDate: monthStart, endDate: today } = getActivePeriodDates('month');

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
    const { startDate: tglawal, endDate: tglakhir } = getActivePeriodDates(preset);

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

    setDateInputValue('prodDateStart', tglawal);
    setDateInputValue('prodDateEnd', tglakhir);

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
    // Metode 2: Simple average dari kolom capaian (persentase) seluruh PP tanpa batasan maksimal 100%
    const allRows = Array.isArray(payload.rows) ? payload.rows : [];
    let avgCapaian = 0;
    if (allRows.length > 0) {
        const totalCapaian = allRows.reduce((sum, r) => sum + (Number(r.persentase) || 0), 0);
        avgCapaian = Number((totalCapaian / allRows.length).toFixed(2));
    } else if (payload.avg_capaian !== undefined) {
        avgCapaian = Number(payload.avg_capaian) || 0;
    } else if (ringkasan.avg_capaian !== undefined) {
        avgCapaian = Number(ringkasan.avg_capaian) || 0;
    } else {
        avgCapaian = Number(ringkasan.persentase) || 0;
    }
    const persentaseVal = avgCapaian;

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
    const defaultTahap = (PRODUKSI_BAGIAN_MAP[payload.bagian] && PRODUKSI_BAGIAN_MAP[payload.bagian].tahap)
        || cfg.tahap
        || (ringkasan.judul ? ringkasan.judul.replace(/^Penyelesaian PP\s+/i, '').toUpperCase() : '');

    if (state.produksiSearchQuery) {
        const q = state.produksiSearchQuery;
        rows = rows.filter(r => {
            const tahapStr = r.tahap_pekerjaan || defaultTahap || r.divisi || '';
            return String(r.nomor_pp || '').toLowerCase().includes(q) ||
                String(r.nama_barang || '').toLowerCase().includes(q) ||
                String(r.kode_barang || '').toLowerCase().includes(q) ||
                String(tahapStr).toLowerCase().includes(q) ||
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
    const pageSize = state.produksiPageSize || 10;
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

            const tahapPekerjaan = r.tahap_pekerjaan || r.nama_tahap || r.tahap || r.pekerjaan || r.mesin || r.sub_bagian || defaultTahap || r.divisi || '-';

            html += `
                <tr>
                    <td class="text-center" style="color: var(--text-muted); font-size: 0.8rem;">${no}</td>
                    <td><strong style="color: var(--sna-blue); font-family: var(--font-mono);">${r.nomor_pp || '-'}</strong></td>
                    <td><span class="skeleton-pill" style="padding: 2px 8px; font-size: 0.72rem; font-weight: 600; background: #f1f5f9; border-radius: 4px;">${tahapPekerjaan}</span></td>
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
        pageInfoEl.textContent = getPaginationInfoText(state.produksiCurrentPage, totalPages, totalItems, pageSize);
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

    const { startDate, endDate } = getActivePeriodDates(preset);

    state.logistikDateStart = startDate;
    state.logistikDateEnd = endDate;

    setDateInputValue('logistikDateStart', startDate);
    setDateInputValue('logistikDateEnd', endDate);

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

    // 1. Tampilkan 5 KPI Utama Logistik (Berdasarkan Rincian Item Barang yang sudah terpenuhi)
    const elTotalOrder = document.getElementById('modalKpiLogistikTotalOrder');
    const elSubOrder = document.getElementById('modalKpiLogistikSubOrder');
    const elTerpenuhi = document.getElementById('modalKpiLogistikTerpenuhi');
    const elBelum = document.getElementById('modalKpiLogistikBelum');
    const elPercent = document.getElementById('modalKpiLogistikPercent');
    const elTotalQty = document.getElementById('modalKpiLogistikTotalQtyOrder');
    const elTotalDn = document.getElementById('modalKpiLogistikTotalQtyDn');

    const totalItemVal = kpi.total_item !== undefined ? kpi.total_item : (kpi.total_order || 0);
    const itemMemenuhiVal = kpi.item_memenuhi !== undefined ? kpi.item_memenuhi : (kpi.order_terpenuhi || 0);
    const itemBelumVal = kpi.item_belum !== undefined ? kpi.item_belum : (kpi.order_belum_terpenuhi || 0);
    const pctVal = totalItemVal > 0
        ? Number(((itemMemenuhiVal / totalItemVal) * 100).toFixed(2))
        : (kpi.persentase_selesai || 0);

    if (elTotalOrder) elTotalOrder.textContent = Number(totalItemVal).toLocaleString('id-ID');
    if (elSubOrder) elSubOrder.textContent = Number(kpi.total_order || 0).toLocaleString('id-ID');
    if (elTerpenuhi) elTerpenuhi.textContent = Number(itemMemenuhiVal).toLocaleString('id-ID');
    if (elBelum) elBelum.textContent = Number(itemBelumVal).toLocaleString('id-ID');
    if (elPercent) elPercent.textContent = `${pctVal}%`;
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
 * Buka Modal Monitoring QA (Release Material GRS & Produk Jadi)
 */
function openQaModal(range = 'month') {
    const modal = document.getElementById('qaModal');
    if (!modal) return;

    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    state.qaSearchQuery = '';
    state.qaCurrentPage = 1;

    const searchInput = document.getElementById('qaSearchInput');
    if (searchInput) searchInput.value = '';

    const selectStatus = document.getElementById('selectQaStatus');
    if (selectStatus) selectStatus.value = 'all';
    state.currentQaStatus = 'all';

    if (!state.currentQaBagian) {
        state.currentQaBagian = 'grsmaterial';
    }
    if (!state.currentQaGrsSubView) {
        state.currentQaGrsSubView = 'detail';
    }

    updateQaBagianTabUI();
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
    document.body.style.overflow = '';
}

/**
 * Switch bagian QA: 'grsmaterial', 'scn', atau 'acceptbr'
 */
function switchQaBagian(bagian) {
    if (state.currentQaBagian === bagian) return;
    state.currentQaBagian = bagian;
    state.qaCurrentPage = 1;
    state.qaSearchQuery = '';

    const searchInput = document.getElementById('qaSearchInput');
    if (searchInput) searchInput.value = '';

    const selectStatus = document.getElementById('selectQaStatus');
    if (selectStatus) selectStatus.value = 'all';
    state.currentQaStatus = 'all';

    updateQaBagianTabUI();
    loadQaData(true);
}

/**
 * Update UI Navigasi Tab & Kontainer Table Sesuai Bagian Aktif
 */
function updateQaBagianTabUI() {
    const bagian = state.currentQaBagian || 'grsmaterial';

    const btnGrs = document.getElementById('btnTabQaGrs');
    const btnScn = document.getElementById('btnTabQaScn');
    const btnBr = document.getElementById('btnTabQaAcceptBr');

    if (btnGrs) btnGrs.classList.toggle('active', bagian === 'grsmaterial');
    if (btnScn) btnScn.classList.toggle('active', bagian === 'scn');
    if (btnBr) btnBr.classList.toggle('active', bagian === 'acceptbr');

    const panelGrs = document.getElementById('tabPanelQaGrs');
    const panelScn = document.getElementById('tabPanelQaScn');
    const panelBr = document.getElementById('tabPanelQaAcceptBr');

    if (panelGrs) {
        panelGrs.classList.toggle('active', bagian === 'grsmaterial');
        panelGrs.style.display = bagian === 'grsmaterial' ? 'flex' : 'none';
    }
    if (panelScn) {
        panelScn.classList.toggle('active', bagian === 'scn');
        panelScn.style.display = bagian === 'scn' ? 'flex' : 'none';
    }
    if (panelBr) {
        panelBr.classList.toggle('active', bagian === 'acceptbr');
        panelBr.style.display = bagian === 'acceptbr' ? 'flex' : 'none';
    }

    // Pastikan Rincian GRS selalu aktif
    state.currentQaGrsSubView = 'detail';
    const subRows = document.getElementById('subPanelQaGrsRows');
    if (subRows) subRows.style.display = '';

    // Dynamic Title & Subtitle
    const titleEl = document.getElementById('qaModalTitle');
    const subtitleEl = document.getElementById('qaModalSubtitle');
    if (titleEl) {
        if (bagian === 'grsmaterial') {
            titleEl.textContent = 'Monitoring QA - Release Material (GRS)';
        } else if (bagian === 'scn') {
            titleEl.textContent = 'Monitoring QA - Release Produk Jadi (SCN Subcon)';
        } else if (bagian === 'acceptbr') {
            titleEl.textContent = 'Monitoring QA - Accept Batch Record (Acc BR)';
        }
    }
    if (subtitleEl) {
        if (bagian === 'grsmaterial') {
            subtitleEl.textContent = 'Laporan GRS Material Masuk: Perbandingan GRS Sudah Approve vs Total GRS Masuk';
        } else if (bagian === 'scn') {
            subtitleEl.textContent = 'Laporan Hasil Sample Test: Release SC Subcon vs Subcon Status Belum Selesai';
        } else if (bagian === 'acceptbr') {
            subtitleEl.textContent = 'Laporan Jurnal Batch Record: Transaksi PRH yang Sudah Ada vs Belum Ada Batch Record';
        }
    }
}

/**
 * Switch Sub-view GRS: 'grs' (rincian GRS) atau 'po' (ringkasan PO)
 */
function switchQaGrsSubView(view) {
    state.currentQaGrsSubView = view === 'po' ? 'po' : 'detail';
    state.qaCurrentPage = 1;
    updateQaBagianTabUI();
    if (state.qaRawData) {
        renderQaModalData(state.qaRawData);
    }
}

/**
 * Mengatur rentang tanggal cepat QA (Bulan Ini, 7 Hari, Hari Ini, Semua)
 */
function setQaQuickDate(preset = 'month') {
    state.currentQaRange = preset;
    state.qaCurrentPage = 1;

    const { startDate, endDate } = getActivePeriodDates(preset);
    state.qaDateStart = startDate;
    state.qaDateEnd = endDate;

    setDateInputValue('qaDateStart', startDate);
    setDateInputValue('qaDateEnd', endDate);

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
 * Ganti filter Status QA (all, terpenuhi, pending, ditolak)
 */
function switchQaStatus(status) {
    state.currentQaStatus = status;
    state.qaCurrentPage = 1;
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
    if (syncBtn) syncBtn.disabled = true;

    const bagian = state.currentQaBagian || 'grsmaterial';

    try {
        renderQaTablesLoading();
        const res = await fetch('/api/dashboard/qa/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                bagian: bagian,
                startDate: state.qaDateStart,
                endDate: state.qaDateEnd
            })
        });
        const json = await res.json();
        if (json.success) {
            state.qaCache.clear();
            await loadQaData(true);
            fetchDashboardStats(true);
            showToast(`Sinkronisasi QA (${bagian.toUpperCase()}) berhasil!`, 'success');
        } else {
            throw new Error(json.message || 'Gagal sinkronisasi data QA');
        }
    } catch (err) {
        console.error('Error sync QA:', err);
        renderQaTablesError(err.message);
        showToast(`Sinkronisasi QA gagal: ${err.message}`, 'error');
    } finally {
        if (icon) {
            setTimeout(() => icon.classList.remove('fa-spin'), 600);
        }
        if (syncBtn) syncBtn.disabled = false;
    }
}

/**
 * Muat data QA dari API sesuai bagian aktif (grsmaterial, scn, acceptbr)
 */
async function loadQaData(force = false) {
    const bagian = state.currentQaBagian || 'grsmaterial';
    let url = `/api/dashboard/qa?bagian=${encodeURIComponent(bagian)}&range=${encodeURIComponent(state.currentQaRange || 'month')}&`;
    if (state.qaDateStart && state.qaDateEnd) {
        url += `tglawal=${encodeURIComponent(state.qaDateStart)}&tglakhir=${encodeURIComponent(state.qaDateEnd)}&startDate=${encodeURIComponent(state.qaDateStart)}&endDate=${encodeURIComponent(state.qaDateEnd)}&`;
    }
    if (force) url += '&force=true';

    const cacheKey = `qa_${bagian}_${state.qaDateStart}_${state.qaDateEnd}_${state.currentQaRange}`;

    if (!force && state.qaCache && state.qaCache.has(cacheKey)) {
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

        if (state.qaCache) {
            state.qaCache.set(cacheKey, { data: result.data, timestamp: Date.now() });
        }
        state.qaRawData = result.data;
        renderQaModalData(result.data);
    } catch (err) {
        console.error('Error memuat data QA:', err);
        renderQaTablesError(err.message);
    }
}

/**
 * Render semua elemen di Modal QA sesuai bagian aktif
 */
function renderQaModalData(data) {
    if (!data) return;

    const bagian = state.currentQaBagian || 'grsmaterial';
    const ringkasan = data.ringkasan || data.kpi || {};
    const items = Array.isArray(data.items) ? data.items : [];
    const meta = data.meta || {};

    const elTotal = document.getElementById('modalKpiQaTotal');
    const elTotalLbl = document.getElementById('modalKpiQaTotalLbl');
    const elReleased = document.getElementById('modalKpiQaReleased');
    const elReleasedLbl = document.getElementById('modalKpiQaReleasedLbl');
    const elPercent = document.getElementById('modalKpiQaPercent');
    const elReject = document.getElementById('modalKpiQaReject');
    const elRejectLbl = document.getElementById('modalKpiQaRejectLbl');
    const elPending = document.getElementById('modalKpiQaPending');
    const elPendingLbl = document.getElementById('modalKpiQaPendingLbl');
    const elExtra = document.getElementById('modalKpiQaExtra');
    const elExtraLbl = document.getElementById('modalKpiQaExtraLbl');

    if (bagian === 'grsmaterial') {
        if (elTotalLbl) elTotalLbl.textContent = 'Total GRS';
        if (elTotal) elTotal.textContent = Number(ringkasan.total_grs || 0).toLocaleString('id-ID');

        if (elReleasedLbl) elReleasedLbl.textContent = 'Sudah Approve';
        if (elReleased) elReleased.textContent = Number(ringkasan.grs_approve || 0).toLocaleString('id-ID');
        if (elPercent) elPercent.textContent = `${ringkasan.persentase_selesai || 0}%`;

        if (elPendingLbl) elPendingLbl.textContent = 'Belum Selesai';
        if (elPending) elPending.textContent = Number(ringkasan.grs_belum || 0).toLocaleString('id-ID');

        if (elRejectLbl) elRejectLbl.textContent = 'Ditolak / Batal';
        if (elReject) elReject.textContent = Number(ringkasan.grs_batal || 0).toLocaleString('id-ID');

        if (elExtraLbl) elExtraLbl.textContent = 'Total PO Terkait';
        if (elExtra) elExtra.textContent = Number(ringkasan.total_po || (data.ringkasan_po || []).length || 0).toLocaleString('id-ID');

        const tabBadgeGrs = document.getElementById('countQaTabGrs');
        if (tabBadgeGrs) tabBadgeGrs.textContent = `${items.length}`;
    } else if (bagian === 'scn') {
        if (elTotalLbl) elTotalLbl.textContent = 'Total SCN Subcon';
        if (elTotal) elTotal.textContent = Number(ringkasan.total_scn || 0).toLocaleString('id-ID');

        if (elReleasedLbl) elReleasedLbl.textContent = 'Sudah Release';
        if (elReleased) elReleased.textContent = Number(ringkasan.scn_sudah_release || 0).toLocaleString('id-ID');
        if (elPercent) elPercent.textContent = `${ringkasan.persentase_selesai || 0}%`;

        if (elPendingLbl) elPendingLbl.textContent = 'Belum Release';
        if (elPending) elPending.textContent = Number(ringkasan.scn_belum_release || 0).toLocaleString('id-ID');

        if (elRejectLbl) elRejectLbl.textContent = 'Ditolak';
        if (elReject) elReject.textContent = Number(ringkasan.scn_ditolak || 0).toLocaleString('id-ID');

        if (elExtraLbl) elExtraLbl.textContent = 'Total Item';
        if (elExtra) elExtra.textContent = `${items.length}`;

        const tabBadgeScn = document.getElementById('countQaTabScn');
        if (tabBadgeScn) tabBadgeScn.textContent = `${items.length}`;
    } else if (bagian === 'acceptbr') {
        if (elTotalLbl) elTotalLbl.textContent = 'Total Transaksi PRH';
        if (elTotal) elTotal.textContent = Number(ringkasan.total_br || 0).toLocaleString('id-ID');

        if (elReleasedLbl) elReleasedLbl.textContent = 'Sudah Ada BR';
        if (elReleased) elReleased.textContent = Number(ringkasan.br_sudah || 0).toLocaleString('id-ID');
        if (elPercent) elPercent.textContent = `${ringkasan.persentase_selesai || 0}%`;

        if (elPendingLbl) elPendingLbl.textContent = 'Belum Ada BR';
        if (elPending) elPending.textContent = Number(ringkasan.br_belum || 0).toLocaleString('id-ID');

        if (elRejectLbl) elRejectLbl.textContent = 'Ditolak';
        if (elReject) elReject.textContent = '0';

        if (elExtraLbl) elExtraLbl.textContent = 'Baris Pending';
        if (elExtra) elExtra.textContent = `${items.length}`;

        const tabBadgeBr = document.getElementById('countQaTabBr');
        if (tabBadgeBr) tabBadgeBr.textContent = `${items.length}`;
    }

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

    const q = (state.qaSearchQuery || '').toLowerCase();
    const status = state.currentQaStatus;

    if (bagian === 'grsmaterial') {
        const isDetail = state.currentQaGrsSubView !== 'po';

        if (isDetail) {
            let grsList = items.filter(item => {
                if (status === 'terpenuhi' && item.status_code !== 'terpenuhi' && item.status_code !== 'approve' && !item.is_released && item.disposisi_qc !== 'DITERIMA' && item.disposisi_qc !== 'DISETUJUI') return false;
                if (status === 'pending' && item.status_code !== 'pending' && item.status_code !== 'belum') return false;
                if (status === 'ditolak' && item.status_code !== 'ditolak' && item.status_code !== 'ditahan') return false;
                if (q) {
                    const matchGrs = item.no_grs && item.no_grs.toLowerCase().includes(q);
                    const matchPo = item.no_po && item.no_po.toLowerCase().includes(q);
                    const matchSupp = item.supplier && item.supplier.toLowerCase().includes(q);
                    const matchDisp = item.disposisi_qc && item.disposisi_qc.toLowerCase().includes(q);
                    if (!matchGrs && !matchPo && !matchSupp && !matchDisp) return false;
                }
                return true;
            });

            const sortGrs = (state.qaSort && state.qaSort.grs) || { column: 'tanggal', dir: 'desc' };
            grsList.sort((a, b) => {
                let valA = a[sortGrs.column] ?? '';
                let valB = b[sortGrs.column] ?? '';
                if (typeof valA === 'string') valA = valA.toLowerCase();
                if (typeof valB === 'string') valB = valB.toLowerCase();
                if (valA < valB) return sortGrs.dir === 'asc' ? -1 : 1;
                if (valA > valB) return sortGrs.dir === 'asc' ? 1 : -1;
                return 0;
            });

            renderQaGrsTable(grsList);
            renderQaPagination(grsList.length, state.qaCurrentPage, state.qaPageSize);
        } else {
            const poSummary = Array.isArray(data.ringkasan_po) ? data.ringkasan_po : [];
            let poList = poSummary.filter(po => {
                if (status === 'terpenuhi' && po.status_code !== 'selesai' && po.status_code !== 'terpenuhi') return false;
                if (status === 'pending' && po.status_code !== 'belum' && po.status_code !== 'pending') return false;
                if (q) {
                    const matchPo = po.no_po && po.no_po.toLowerCase().includes(q);
                    const matchSupp = po.supplier && po.supplier.toLowerCase().includes(q);
                    if (!matchPo && !matchSupp) return false;
                }
                return true;
            });

            const sortPo = (state.qaSort && state.qaSort.po) || { column: 'tanggal', dir: 'desc' };
            poList.sort((a, b) => {
                let valA = a[sortPo.column] ?? '';
                let valB = b[sortPo.column] ?? '';
                if (typeof valA === 'string') valA = valA.toLowerCase();
                if (typeof valB === 'string') valB = valB.toLowerCase();
                if (valA < valB) return sortPo.dir === 'asc' ? -1 : 1;
                if (valA > valB) return sortPo.dir === 'asc' ? 1 : -1;
                return 0;
            });

            renderQaPoTable(poList);
            renderQaPagination(poList.length, state.qaCurrentPage, state.qaPageSize);
        }
    } else if (bagian === 'scn') {
        let scnList = items.filter(item => {
            if (status === 'terpenuhi' && item.status_code !== 'terpenuhi' && item.status_code !== 'sudah_release' && item.status !== 'Sudah Release') return false;
            if (status === 'pending' && item.status_code !== 'belum' && item.status_code !== 'belum_release' && item.status !== 'Belum Release') return false;
            if (status === 'ditolak' && item.status_code !== 'ditolak' && item.status !== 'Ditolak') return false;
            if (q) {
                const matchScn = item.no_subcon && item.no_subcon.toLowerCase().includes(q);
                const matchSupp = item.supplier && item.supplier.toLowerCase().includes(q);
                const matchKode = item.kode_barang && item.kode_barang.toLowerCase().includes(q);
                const matchNama = item.nama_barang && item.nama_barang.toLowerCase().includes(q);
                const matchBatch = item.batch && item.batch.toLowerCase().includes(q);
                const matchQc = item.no_qc && item.no_qc.toLowerCase().includes(q);
                if (!matchScn && !matchSupp && !matchKode && !matchNama && !matchBatch && !matchQc) return false;
            }
            return true;
        });

        const sortScn = (state.qaSort && state.qaSort.scn) || { column: 'tanggal', dir: 'desc' };
        scnList.sort((a, b) => {
            let valA = a[sortScn.column] ?? '';
            let valB = b[sortScn.column] ?? '';
            const cmp = typeof valA === 'number' ? valA - valB : String(valA).localeCompare(String(valB));
            return sortScn.dir === 'asc' ? cmp : -cmp;
        });

        renderQaScnTable(scnList);
        renderQaPagination(scnList.length, state.qaCurrentPage, state.qaPageSize);
    } else if (bagian === 'acceptbr') {
        let brList = items.filter(item => {
            if (status === 'terpenuhi' && item.status_code !== 'terpenuhi' && item.status_code !== 'sudah_ada') return false;
            if (status === 'pending' && item.status_code !== 'belum' && item.status_code !== 'belum_ada' && item.status !== 'Belum Ada BR') return false;
            if (status === 'ditolak') return false;
            if (q) {
                const matchPrh = item.no_prh && item.no_prh.toLowerCase().includes(q);
                const matchProd = (item.no_hasil_produksi || item.no_trans_prod || '').toLowerCase().includes(q);
                const matchKode = item.kode_barang && item.kode_barang.toLowerCase().includes(q);
                const matchNama = item.nama_barang && item.nama_barang.toLowerCase().includes(q);
                const matchBatch = item.batch && item.batch.toLowerCase().includes(q);
                const matchUser = item.user_entry && item.user_entry.toLowerCase().includes(q);
                if (!matchPrh && !matchProd && !matchKode && !matchNama && !matchBatch && !matchUser) return false;
            }
            return true;
        });

        const sortBr = (state.qaSort && state.qaSort.acceptbr) || { column: 'tgl_prh', dir: 'desc' };
        brList.sort((a, b) => {
            let valA = a[sortBr.column] ?? '';
            let valB = b[sortBr.column] ?? '';
            const cmp = typeof valA === 'number' ? valA - valB : String(valA).localeCompare(String(valB));
            return sortBr.dir === 'asc' ? cmp : -cmp;
        });

        renderQaAcceptBrTable(brList);
        renderQaPagination(brList.length, state.qaCurrentPage, state.qaPageSize);
    }

    updateQaSortHeaders(bagian);
}

/**
 * Helper format disposisi QA (Disetujui / Ditolak / Ditahan / -)
 */
function formatQaDisposisi(val) {
    if (!val || val === '-' || val === 'null' || val === 'undefined') {
        return '<span style="color: #94a3b8;">-</span>';
    }
    const s = String(val).trim().toUpperCase();
    if (s === 'A' || s === 'DISETUJUI' || s === 'DITERIMA' || s === 'APPROVE') {
        return '<span style="color: var(--kpi-green); font-weight: 700;">Disetujui</span>';
    }
    if (s === 'D' || s === 'DITOLAK' || s === 'TOLAK' || s === 'REJECT') {
        return '<span style="color: #ef4444; font-weight: 700;">Ditolak</span>';
    }
    if (s === 'H' || s === 'DITAHAN' || s === 'HOLD') {
        return '<span style="color: #d97706; font-weight: 700;">Ditahan</span>';
    }
    return `<span style="color: #64748b;">${val}</span>`;
}

/**
 * Render Tabel Rincian Release GRS (Material)
 */
function renderQaGrsTable(list) {
    const tbody = document.getElementById('qaGrsTableBody');
    const footerStats = document.getElementById('qaModalFooterStats');
    if (!tbody) return;

    if (!list || list.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="11" class="subcon-empty-row">
                    <i class="fa-solid fa-boxes-packing"></i>
                    <div style="margin-top: 8px;">Tidak ada data Release Material GRS yang cocok</div>
                </td>
            </tr>
        `;
        if (footerStats) footerStats.textContent = 'Menampilkan 0 GRS';
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
        let badge = '<span class="service-status-pill" style="color: #64748b; background: #f1f5f9; border: 1px solid #cbd5e1;"><i class="fa-solid fa-clock"></i> BELUM APPROVE</span>';
        if (item.is_released || item.disposisi_qc === 'DITERIMA' || item.disposisi_qc === 'DISETUJUI' || item.status_code === 'terpenuhi') {
            badge = '<span class="service-status-pill status-live"><i class="fa-solid fa-check"></i> DISETUJUI</span>';
        } else if (item.disposisi_qc === 'DITOLAK' || item.status_code === 'ditolak') {
            badge = '<span class="service-status-pill" style="color: #dc2626; background: #fee2e2; border: 1px solid #fecaca;"><i class="fa-solid fa-xmark"></i> DITOLAK</span>';
        } else if (item.disposisi_qc === 'DITAHAN' || item.status_code === 'ditahan') {
            badge = '<span class="service-status-pill" style="color: #d97706; background: #fef3c7; border: 1px solid #fde68a;"><i class="fa-solid fa-pause"></i> DITAHAN</span>';
        }

        const poClickHtml = (item.no_po && item.no_po !== '-')
            ? `<span style="cursor: pointer; color: var(--sna-blue); font-weight: 600;" onclick="viewQaPoItems('${item.no_po}')" title="Klik untuk memfilter PO ini">
                 <i class="fa-solid fa-file-invoice"></i> ${item.no_po}
               </span>`
            : `<span style="color: #94a3b8;">-</span>`;

        const barangHtml = (item.kode_barang && item.kode_barang !== '-')
            ? `<div><span class="font-mono" style="font-size: 0.72rem; color: #64748b;">[${item.kode_barang}]</span> <span style="font-weight: 600; font-size: 0.8rem;">${item.nama_barang || '-'}</span></div>`
            : `<span style="font-size: 0.8rem;">${item.nama_barang || '-'}</span>`;

        const qtyHtml = (item.jumlah || item.jumlah_rilis)
            ? `<div class="font-mono" style="font-size: 0.78rem;">${Number(item.jumlah || 0).toLocaleString('id-ID')} / <strong style="color: #16a34a;">${Number(item.jumlah_rilis || 0).toLocaleString('id-ID')}</strong></div>`
            : `<span style="color: #94a3b8;">-</span>`;

        const lotEdHtml = (item.no_lot && item.no_lot !== '-') || (item.tgl_expired && item.tgl_expired !== '-')
            ? `<div style="font-size: 0.75rem;"><span class="font-mono">${item.no_lot || '-'}</span><br><span style="color: #64748b;">ED: ${item.tgl_expired_label || item.tgl_expired || '-'}</span></div>`
            : `<span style="color: #94a3b8;">-</span>`;

        html += `
            <tr>
                <td class="text-center font-mono" style="color: #64748b;">${startIdx + idx + 1}</td>
                <td><strong style="color: #8b5cf6;">${item.no_grs}</strong></td>
                <td class="font-mono text-center" style="font-size: 0.8rem;">${item.tanggal_label || item.tanggal}</td>
                <td>${poClickHtml}</td>
                <td style="font-weight: 500; max-width: 180px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${item.supplier || '-'}">${item.supplier || '-'}</td>
                <td style="max-width: 240px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${item.nama_barang || '-'}">${barangHtml}</td>
                <td class="text-right">${qtyHtml}</td>
                <td class="text-center">${lotEdHtml}</td>
                <td class="text-center" style="font-size: 0.8rem;">${formatQaDisposisi(item.disposisi_qc)}</td>
                <td class="text-center">${badge}</td>
                <td class="font-mono text-center" style="font-size: 0.75rem;">${item.tgl_approve_label || item.tgl_approve || '-'}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
    if (footerStats) {
        footerStats.textContent = `Menampilkan ${startIdx + 1} - ${endIdx} dari ${totalItems} Release GRS Material`;
    }
}

/**
 * Render Tabel Ringkasan Per No. PO QA
 */
function renderQaPoTable(list) {
    const tbody = document.getElementById('qaPoTableBody');
    const footerStats = document.getElementById('qaModalFooterStats');
    if (!tbody) return;

    if (!list || list.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="subcon-empty-row">
                    <i class="fa-solid fa-file-invoice"></i>
                    <div style="margin-top: 8px;">Tidak ada Purchase Order (PO) yang cocok</div>
                </td>
            </tr>
        `;
        if (footerStats) footerStats.textContent = 'Menampilkan 0 PO';
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
        const isSelesai = po.status_code === 'selesai' || po.status_code === 'terpenuhi';
        const badge = isSelesai
            ? '<span class="service-status-pill status-live">SELESAI</span>'
            : '<span class="service-status-pill" style="color: #d97706; background: #fef3c7; border: 1px solid #fde68a;">SEBAGIAN</span>';

        html += `
            <tr>
                <td class="text-center font-mono" style="color: #64748b;">${startIdx + idx + 1}</td>
                <td>
                    <span style="cursor: pointer; color: var(--sna-blue); font-weight: 600;" onclick="viewQaPoItems('${po.no_po}')" title="Klik untuk memfilter GRS dari PO ini">
                        <i class="fa-solid fa-file-invoice"></i> ${po.no_po || '-'}
                    </span>
                </td>
                <td class="font-mono text-center" style="font-size: 0.8rem;">${po.tanggal_label || po.tanggal || '-'}</td>
                <td style="font-weight: 500; max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${po.supplier || '-'}">${po.supplier || '-'}</td>
                <td class="text-center font-mono">${po.total_grs || 0}</td>
                <td class="text-center font-mono" style="color: var(--kpi-green); font-weight: 600;">${po.grs_approve || 0}</td>
                <td class="text-center font-mono" style="color: #d97706;">${po.grs_pending || 0}</td>
                <td class="text-right font-mono" style="font-weight: 700; color: ${isSelesai ? 'var(--kpi-green)' : '#d97706'};">${po.persentase || 0}%</td>
                <td class="text-center">${badge}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
    if (footerStats) {
        footerStats.textContent = `Menampilkan ${startIdx + 1} - ${endIdx} dari ${totalItems} Purchase Order`;
    }
}

/**
 * Render Tabel SCN Subcon (Release Produk Jadi)
 */
function renderQaScnTable(list) {
    const tbody = document.getElementById('qaScnTableBody');
    const footerStats = document.getElementById('qaModalFooterStats');
    if (!tbody) return;

    if (!list || list.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="13" class="subcon-empty-row">
                    <i class="fa-solid fa-boxes-packing" style="font-size: 2rem; color: #cbd5e1;"></i>
                    <div style="margin-top: 8px;">Tidak ada data Release Subcon (SCN) yang cocok</div>
                </td>
            </tr>
        `;
        if (footerStats) footerStats.textContent = 'Menampilkan 0 SCN';
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
        let badge = '<span class="service-status-pill" style="color: #d97706; background: #fef3c7; border: 1px solid #fde68a;"><i class="fa-solid fa-clock"></i> BELUM RELEASE</span>';
        if (item.status_code === 'terpenuhi' || item.status_code === 'sudah_release' || item.status === 'Sudah Release') {
            badge = '<span class="service-status-pill status-live"><i class="fa-solid fa-check"></i> SUDAH RELEASE</span>';
        } else if (item.status_code === 'ditolak' || item.status === 'Ditolak') {
            badge = '<span class="service-status-pill" style="color: #dc2626; background: #fee2e2; border: 1px solid #fecaca;"><i class="fa-solid fa-xmark"></i> DITOLAK</span>';
        }

        const disp1 = item.disposisi_1 || item.disposisi_qc_1 || '-';
        const disp2 = item.disposisi_2 || item.disposisi_qc_2 || '-';
        const disp1Html = formatQaDisposisi(disp1);
        const disp2Html = formatQaDisposisi(disp2);

        html += `
            <tr>
                <td class="text-center font-mono" style="color: #64748b;">${startIdx + idx + 1}</td>
                <td><strong style="color: #8b5cf6;">${item.no_subcon}</strong></td>
                <td class="text-center font-mono" style="font-size: 0.8rem;">${item.tanggal_label || item.tanggal}</td>
                <td style="font-size: 0.82rem;">${item.supplier || '-'}</td>
                <td><span class="font-mono" style="font-size: 0.8rem;">${item.kode_barang}</span></td>
                <td>${item.nama_barang}</td>
                <td class="text-center font-mono" style="font-size: 0.8rem;">${item.batch || '-'}</td>
                <td class="text-right font-mono">${Number(item.jumlah || 0).toLocaleString('id-ID')}</td>
                <td class="text-center"><span class="badge-satuan">${item.satuan || '-'}</span></td>
                <td class="text-center font-mono" style="font-size: 0.8rem; color: #64748b;">${item.no_qc || '-'}</td>
                <td class="text-center" style="font-size: 0.8rem;">${disp1Html}</td>
                <td class="text-center" style="font-size: 0.8rem;">${disp2Html}</td>
                <td class="text-center">${badge}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
    if (footerStats) {
        footerStats.textContent = `Menampilkan ${startIdx + 1} - ${endIdx} dari ${totalItems} Release Subcon (SCN)`;
    }
}

/**
 * Render Tabel Accept Batch Record (Acc BR)
 */
function renderQaAcceptBrTable(list) {
    const tbody = document.getElementById('qaAcceptBrTableBody');
    const footerStats = document.getElementById('qaModalFooterStats');
    if (!tbody) return;

    if (!list || list.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="13" class="subcon-empty-row">
                    <i class="fa-solid fa-file-circle-check" style="font-size: 2rem; color: #cbd5e1;"></i>
                    <div style="margin-top: 8px;">Semua Transaksi PRH Sudah Memiliki Batch Record!</div>
                </td>
            </tr>
        `;
        if (footerStats) footerStats.textContent = 'Menampilkan 0 Transaksi PRH';
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
        const isBelum = item.status_code === 'belum' || item.status_code === 'belum_ada' || item.status === 'Belum Ada BR';
        const badge = isBelum
            ? '<span class="service-status-pill" style="color: #dc2626; background: #fee2e2; border: 1px solid #fecaca;"><i class="fa-solid fa-triangle-exclamation"></i> BELUM ADA BR</span>'
            : '<span class="service-status-pill status-live"><i class="fa-solid fa-check"></i> SUDAH ADA BR</span>';

        const userAccept = (item.user_accept || '').trim();
        const tglAccept = item.tgl_accept_label || item.tgl_accept || '';
        const acceptCell = (userAccept && userAccept !== '-' || tglAccept && tglAccept !== '-')
            ? `<div style="line-height: 1.25;"><strong style="color: #0f172a; font-size: 0.78rem;">${userAccept || '-'}</strong><br><span class="font-mono" style="font-size: 0.72rem; color: #64748b;">${tglAccept || '-'}</span></div>`
            : '<span style="color: #94a3b8;">-</span>';

        html += `
            <tr>
                <td class="text-center font-mono" style="color: #64748b;">${startIdx + idx + 1}</td>
                <td><strong style="color: #8b5cf6;">${item.no_prh}</strong></td>
                <td class="text-center font-mono" style="font-size: 0.8rem;">${item.tgl_prh_label || item.tgl_prh}</td>
                <td class="text-center font-mono" style="font-size: 0.8rem; color: #64748b;">${item.tgl_kirim_sample_label || item.tgl_kirim_sample || '-'}</td>
                <td><span class="font-mono" style="font-size: 0.8rem;">${item.no_hasil_produksi || item.no_trans_prod || '-'}</span></td>
                <td class="text-center"><span class="badge-satuan" style="font-size: 0.72rem;">${item.divisi || '-'}</span></td>
                <td><span class="font-mono" style="font-size: 0.8rem;">${item.kode_barang}</span></td>
                <td>${item.nama_barang}</td>
                <td class="text-center font-mono" style="font-size: 0.8rem;">${item.batch || '-'}</td>
                <td class="text-right font-mono">${Number(item.jumlah || 0).toLocaleString('id-ID')}</td>
                <td style="font-size: 0.8rem; color: #64748b;">${item.user_entry || '-'}</td>
                <td class="text-center">${acceptCell}</td>
                <td class="text-center">${badge}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
    if (footerStats) {
        footerStats.textContent = `Menampilkan ${startIdx + 1} - ${endIdx} dari ${totalItems} Transaksi PRH`;
    }
}

/**
 * Drill-down melihat GRS dari suatu PO di QA Modal
 */
function viewQaPoItems(noPo) {
    if (!noPo || noPo === '-') return;
    const searchInput = document.getElementById('qaSearchInput');
    if (searchInput) searchInput.value = noPo;
    state.qaSearchQuery = noPo.trim().toLowerCase();
    switchQaGrsSubView('detail');
}

/**
 * Navigasi ganti halaman QA
 */
function changeQaPage(delta) {
    const bagian = state.currentQaBagian || 'grsmaterial';
    let totalItems = 0;
    if (state.qaRawData) {
        if (bagian === 'grsmaterial') {
            totalItems = state.currentQaGrsSubView === 'po'
                ? (state.qaRawData.ringkasan_po?.length || 0)
                : (state.qaRawData.items?.length || 0);
        } else {
            totalItems = state.qaRawData.items?.length || 0;
        }
    }

    const totalPages = Math.ceil(totalItems / state.qaPageSize) || 1;
    const target = state.qaCurrentPage + delta;
    if (target >= 1 && target <= totalPages) {
        state.qaCurrentPage = target;
        if (state.qaRawData) {
            renderQaModalData(state.qaRawData);
        }
    }
}

/**
 * Sorting Kolom Tabel QA
 */
function sortQa(type, column) {
    if (!state.qaSort) state.qaSort = { grs: { column: 'tanggal', dir: 'desc' }, po: { column: 'tanggal', dir: 'desc' }, scn: { column: 'tanggal', dir: 'desc' }, acceptbr: { column: 'tgl_prh', dir: 'desc' } };
    if (!state.qaSort[type]) state.qaSort[type] = { column: column, dir: 'desc' };

    const currentSort = state.qaSort[type];
    if (currentSort.column === column) {
        currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
        currentSort.column = column;
        currentSort.dir = ['tanggal', 'tgl_prh', 'total_grs', 'grs_approve', 'grs_pending', 'persentase'].includes(column) ? 'desc' : 'asc';
    }

    state.qaCurrentPage = 1;
    if (state.qaRawData) {
        renderQaModalData(state.qaRawData);
    }
}

/**
 * Update Icon Header Sorting QA
 */
function updateQaSortHeaders(bagian) {
    let panelId = 'tabPanelQaGrs';
    if (bagian === 'scn') panelId = 'tabPanelQaScn';
    else if (bagian === 'acceptbr') panelId = 'tabPanelQaAcceptBr';

    const panel = document.getElementById(panelId);
    if (!panel) return;

    const sortKey = (bagian === 'grsmaterial')
        ? (state.currentQaGrsSubView === 'po' ? 'po' : 'grs')
        : bagian;

    const currentSort = (state.qaSort && state.qaSort[sortKey])
        ? state.qaSort[sortKey]
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

function renderQaPagination(totalItems, currentPage, pageSize) {
    const pageInfo = document.getElementById('qaPageInfo');
    const btnPrev = document.getElementById('btnQaPrevPage');
    const btnNext = document.getElementById('btnQaNextPage');

    const totalPages = Math.ceil(totalItems / pageSize) || 1;

    if (pageInfo) {
        pageInfo.textContent = getPaginationInfoText(currentPage, totalPages, totalItems, pageSize);
    }

    if (btnPrev) btnPrev.disabled = currentPage <= 1;
    if (btnNext) btnNext.disabled = currentPage >= totalPages;
}

function renderQaTablesLoading() {
    const tbodyGrs = document.getElementById('qaGrsTableBody');
    const tbodyPo = document.getElementById('qaPoTableBody');
    const tbodyScn = document.getElementById('qaScnTableBody');
    const tbodyBr = document.getElementById('qaAcceptBrTableBody');

    const skeleton = `
        <tr>
            <td colspan="13" style="padding: 2rem; text-align: center; color: var(--text-secondary);">
                <i class="fa-solid fa-spinner fa-spin" style="font-size: 1.5rem; color: #8b5cf6;"></i>
                <div style="margin-top: 8px; font-weight: 500;">Memuat data QA dari Atena ERP...</div>
            </td>
        </tr>
    `;
    if (tbodyGrs) tbodyGrs.innerHTML = skeleton;
    if (tbodyPo) tbodyPo.innerHTML = skeleton;
    if (tbodyScn) tbodyScn.innerHTML = skeleton;
    if (tbodyBr) tbodyBr.innerHTML = skeleton;
}

function renderQaTablesError(message) {
    const tbodyGrs = document.getElementById('qaGrsTableBody');
    const tbodyPo = document.getElementById('qaPoTableBody');
    const tbodyScn = document.getElementById('qaScnTableBody');
    const tbodyBr = document.getElementById('qaAcceptBrTableBody');

    const errHtml = `
        <tr>
            <td colspan="13" class="subcon-empty-row" style="color: #ef4444;">
                <i class="fa-solid fa-triangle-exclamation" style="font-size: 2rem; color: #ef4444;"></i>
                <div style="margin-top: 8px; font-weight: 600;">Gagal Mengambil Data QA</div>
                <div style="font-size: 0.8rem; color: #64748b;">${message || 'Terjadi kesalahan sistem'}</div>
            </td>
        </tr>
    `;
    if (tbodyGrs) tbodyGrs.innerHTML = errHtml;
    if (tbodyPo) tbodyPo.innerHTML = errHtml;
    if (tbodyScn) tbodyScn.innerHTML = errHtml;
    if (tbodyBr) tbodyBr.innerHTML = errHtml;
}

// ====================================================================
// 15. MODAL MONITORING PENYELESAIAN DR (WH FG ATENA ERP)
// ====================================================================

function formatWhFgDate(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function openWhFgModal(range = 'month') {
    const modal = document.getElementById('whFgModal');
    if (!modal) return;

    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    state.whFgSearchQuery = '';
    state.whFgCurrentPage = 1;

    const searchInput = document.getElementById('whFgSearchInput');
    if (searchInput) searchInput.value = '';

    const selectStatus = document.getElementById('selectWhFgStatus');
    if (selectStatus) selectStatus.value = 'all';
    state.currentWhFgStatus = 'all';

    setWhFgQuickDate(range);
}

function closeWhFgModal() {
    const modal = document.getElementById('whFgModal');
    if (!modal) return;
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
}

function setWhFgQuickDate(preset = 'month') {
    state.currentWhFgRange = preset;
    state.whFgCurrentPage = 1;

    const { startDate, endDate } = getActivePeriodDates(preset);

    state.whFgDateStart = startDate;
    state.whFgDateEnd = endDate;

    setDateInputValue('whFgDateStart', startDate);
    setDateInputValue('whFgDateEnd', endDate);

    const pills = document.querySelectorAll('.wh-fg-range-pills .filter-pill');
    pills.forEach(p => p.classList.remove('active'));

    const btnMap = {
        'month': 'btnQuickWhFgMonth',
        'week': 'btnQuickWhFgWeek',
        'today': 'btnQuickWhFgToday',
        'all': 'btnQuickWhFgAll'
    };
    const activeBtn = document.getElementById(btnMap[preset]);
    if (activeBtn) activeBtn.classList.add('active');

    loadWhFgData();
}

function handleWhFgDateChange(field) {
    const startInput = document.getElementById('whFgDateStart');
    const endInput = document.getElementById('whFgDateEnd');
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

    state.whFgDateStart = start;
    state.whFgDateEnd = end;
    state.currentWhFgRange = 'custom';
    state.whFgCurrentPage = 1;

    const pills = document.querySelectorAll('.wh-fg-range-pills .filter-pill');
    pills.forEach(p => p.classList.remove('active'));

    loadWhFgData();
}

function resetWhFgFilter() {
    state.whFgSearchQuery = '';
    state.currentWhFgStatus = 'all';
    state.whFgCurrentPage = 1;

    const searchInput = document.getElementById('whFgSearchInput');
    if (searchInput) searchInput.value = '';

    const selectStatus = document.getElementById('selectWhFgStatus');
    if (selectStatus) selectStatus.value = 'all';

    setWhFgQuickDate('month');
}

function switchWhFgStatus(status) {
    state.currentWhFgStatus = status;
    state.whFgCurrentPage = 1;
    if (state.whFgRawData) {
        renderWhFgModalData(state.whFgRawData);
    }
}

function switchWhFgView(viewMode) {
    state.currentWhFgView = viewMode;
    state.whFgCurrentPage = 1;

    const btnDr = document.getElementById('btnViewWhFgDr');
    const btnItems = document.getElementById('btnViewWhFgItems');
    const panelDr = document.getElementById('tabPanelWhFgDr');
    const panelItems = document.getElementById('tabPanelWhFgItems');

    if (btnDr) btnDr.classList.toggle('active', viewMode === 'dr');
    if (btnItems) btnItems.classList.toggle('active', viewMode === 'items');
    if (panelDr) panelDr.classList.toggle('active', viewMode === 'dr');
    if (panelItems) panelItems.classList.toggle('active', viewMode === 'items');

    updateWhFgSortHeaders(viewMode);

    if (state.whFgRawData) {
        renderWhFgModalData(state.whFgRawData);
    }
}

let whFgSearchTimeout = null;
function handleWhFgSearch(query) {
    clearTimeout(whFgSearchTimeout);
    whFgSearchTimeout = setTimeout(() => {
        state.whFgSearchQuery = (query || '').trim().toLowerCase();
        state.whFgCurrentPage = 1;
        if (state.whFgRawData) {
            renderWhFgModalData(state.whFgRawData);
        }
    }, 200);
}

async function syncWhFgData() {
    const syncBtn = document.getElementById('btnSyncWhFg');
    const icon = syncBtn ? syncBtn.querySelector('i') : null;
    if (icon) icon.classList.add('fa-spin');

    try {
        renderWhFgTablesLoading();
        state.whFgCache.clear();
        await fetch('/api/dashboard/wh-fg/sync', { method: 'POST' });
        await loadWhFgData(true);
        await fetchDashboardStats();
    } catch (err) {
        console.error('[SYNC WH FG ERROR]:', err);
    } finally {
        if (icon) icon.classList.remove('fa-spin');
    }
}

async function loadWhFgData(force = false) {
    const { whFgDateStart, whFgDateEnd, currentWhFgRange } = state;
    const cacheKey = `${currentWhFgRange}_${whFgDateStart}_${whFgDateEnd}`;

    if (!force && state.whFgCache.has(cacheKey)) {
        const cached = state.whFgCache.get(cacheKey);
        state.whFgRawData = cached;
        renderWhFgModalData(cached);
        return;
    }

    renderWhFgTablesLoading();

    try {
        const params = new URLSearchParams({
            range: currentWhFgRange,
            tglawal: whFgDateStart,
            tglakhir: whFgDateEnd,
            force: force ? 'true' : 'false'
        });

        const res = await fetch(`/api/dashboard/wh-fg?${params.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();

        if (json.success && json.data) {
            state.whFgRawData = json.data;
            state.whFgCache.set(cacheKey, json.data);
            renderWhFgModalData(json.data);
        } else {
            renderWhFgTablesError(json.message || 'Format data WH FG tidak valid');
        }
    } catch (err) {
        renderWhFgTablesError(err.message);
    }
}

function renderWhFgModalData(data) {
    if (!data) return;
    const kpi = data.kpi || {};

    const elTotalDr = document.getElementById('modalKpiWhFgTotalDr');
    const elSudahDn = document.getElementById('modalKpiWhFgSudahDn');
    const elBelumDn = document.getElementById('modalKpiWhFgBelumDn');
    const elPercent = document.getElementById('modalKpiWhFgPercent');
    const elTotalQty = document.getElementById('modalKpiWhFgTotalQty');
    const elTotalQtyDn = document.getElementById('modalKpiWhFgTotalQtyDn');

    if (elTotalDr) elTotalDr.textContent = Number(kpi.total_dr || 0).toLocaleString('id-ID');
    if (elSudahDn) elSudahDn.textContent = Number(kpi.dr_sudah_dn || 0).toLocaleString('id-ID');
    if (elBelumDn) elBelumDn.textContent = Number(kpi.dr_belum_dn || 0).toLocaleString('id-ID');
    if (elPercent) elPercent.textContent = `${kpi.persentase_selesai || 0}%`;
    if (elTotalQty) elTotalQty.textContent = Number(Math.round(kpi.total_jumlah || 0)).toLocaleString('id-ID');
    if (elTotalQtyDn) elTotalQtyDn.textContent = Number(Math.round(kpi.total_jumlah_dn || 0)).toLocaleString('id-ID');

    const lastSyncEl = document.getElementById('whFgLastSyncTime');
    if (lastSyncEl && data.meta?.sync_time) {
        lastSyncEl.textContent = `Sinkron: ${new Date(data.meta.sync_time).toLocaleTimeString('id-ID')}`;
    }

    const rawDrList = data.summary_by_dr || [];
    const rawItems = data.items || [];

    const countDrEl = document.getElementById('countWhFgDr');
    const countItemsEl = document.getElementById('countWhFgItems');
    if (countDrEl) countDrEl.textContent = rawDrList.length;
    if (countItemsEl) countItemsEl.textContent = rawItems.length;

    // Filter Data
    const q = state.whFgSearchQuery;
    const st = state.currentWhFgStatus;

    if (state.currentWhFgView === 'dr') {
        let filtered = rawDrList.filter(dr => {
            if (st !== 'all' && dr.status_code !== st) return false;
            if (!q) return true;
            return (dr.no_trans || '').toLowerCase().includes(q) ||
                (dr.customer || '').toLowerCase().includes(q) ||
                (dr.no_pesanan || '').toLowerCase().includes(q) ||
                (dr.no_dn || '').toLowerCase().includes(q);
        });

        // Sorting
        const sort = state.whFgSort.dr;
        filtered.sort((a, b) => {
            const valA = a[sort.column] ?? '';
            const valB = b[sort.column] ?? '';
            const cmp = typeof valA === 'number' ? valA - valB : String(valA).localeCompare(String(valB));
            return sort.dir === 'asc' ? cmp : -cmp;
        });

        renderWhFgDrTable(filtered);
        renderWhFgPagination(filtered.length, state.whFgCurrentPage, state.whFgPageSize);
    } else {
        let filtered = rawItems.filter(item => {
            if (st !== 'all' && item.status_code !== st) return false;
            if (!q) return true;
            return (item.no_trans || '').toLowerCase().includes(q) ||
                (item.customer || '').toLowerCase().includes(q) ||
                (item.kode_barang || '').toLowerCase().includes(q) ||
                (item.nama_barang || '').toLowerCase().includes(q) ||
                (item.no_dn || '').toLowerCase().includes(q);
        });

        const sort = state.whFgSort.items;
        filtered.sort((a, b) => {
            const valA = a[sort.column] ?? '';
            const valB = b[sort.column] ?? '';
            const cmp = typeof valA === 'number' ? valA - valB : String(valA).localeCompare(String(valB));
            return sort.dir === 'asc' ? cmp : -cmp;
        });

        renderWhFgItemsTable(filtered);
        renderWhFgPagination(filtered.length, state.whFgCurrentPage, state.whFgPageSize);
    }
}

function renderWhFgDrTable(drList) {
    const tbody = document.getElementById('whFgDrTableBody');
    if (!tbody) return;

    if (drList.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="12" class="subcon-empty-row">
                    <i class="fa-solid fa-box-open" style="font-size: 2rem; color: #cbd5e1;"></i>
                    <div style="margin-top: 8px; font-weight: 500;">Tidak ada data DR yang cocok dengan filter</div>
                </td>
            </tr>
        `;
        return;
    }

    const startIdx = (state.whFgCurrentPage - 1) * state.whFgPageSize;
    const pageItems = drList.slice(startIdx, startIdx + state.whFgPageSize);

    let html = '';
    pageItems.forEach((dr, idx) => {
        const no = startIdx + idx + 1;
        const isSudah = dr.status_code === 'sudah_dn';
        const badge = isSudah
            ? '<span class="service-status-pill status-live">SUDAH DN</span>'
            : '<span class="service-status-pill" style="color: #d97706; background: #fef3c7; border: 1px solid #fde68a;">BELUM DN</span>';

        const barColor = isSudah ? 'var(--kpi-green)' : 'var(--kpi-yellow)';

        html += `
            <tr>
                <td class="text-center font-mono">${no}</td>
                <td><strong style="color: var(--sna-blue);">${dr.no_trans}</strong></td>
                <td class="text-center">${dr.tanggal_label || dr.tanggal || '-'}</td>
                <td><strong>${dr.customer}</strong></td>
                <td><span style="font-size: 0.8rem; color: var(--text-secondary);">${dr.ekspedisi}</span></td>
                <td><span class="font-mono" style="font-size: 0.82rem;">${dr.no_pesanan}</span></td>
                <td class="text-center font-mono">${dr.item_count}</td>
                <td class="text-right font-mono">${Number(Math.round(dr.total_jumlah || 0)).toLocaleString('id-ID')}</td>
                <td class="text-right font-mono" style="color: var(--kpi-green); font-weight: 600;">${Number(Math.round(dr.total_jumlah_dn || 0)).toLocaleString('id-ID')}</td>
                <td>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <div class="progress-bar-track" style="flex: 1; height: 6px;">
                            <div class="progress-bar-fill" style="width: ${dr.progress_percent}%; background: ${barColor};"></div>
                        </div>
                        <span style="font-size: 0.75rem; font-weight: 600; font-family: var(--font-mono);">${dr.progress_percent}%</span>
                    </div>
                </td>
                <td><span class="font-mono" style="font-size: 0.8rem; color: #64748b;">${dr.no_dn}</span></td>
                <td class="text-center">${badge}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

function renderWhFgItemsTable(items) {
    const tbody = document.getElementById('whFgItemsTableBody');
    if (!tbody) return;

    if (items.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="13" class="subcon-empty-row">
                    <i class="fa-solid fa-box-open" style="font-size: 2rem; color: #cbd5e1;"></i>
                    <div style="margin-top: 8px; font-weight: 500;">Tidak ada rincian item yang cocok</div>
                </td>
            </tr>
        `;
        return;
    }

    const startIdx = (state.whFgCurrentPage - 1) * state.whFgPageSize;
    const pageItems = items.slice(startIdx, startIdx + state.whFgPageSize);

    let html = '';
    pageItems.forEach((item, idx) => {
        const no = startIdx + idx + 1;
        const isSudah = item.status_code === 'sudah_dn';
        const badge = isSudah
            ? '<span class="service-status-pill status-live">SUDAH DN</span>'
            : '<span class="service-status-pill" style="color: #d97706; background: #fef3c7; border: 1px solid #fde68a;">BELUM DN</span>';

        html += `
            <tr>
                <td class="text-center font-mono">${no}</td>
                <td><strong style="color: var(--sna-blue);">${item.no_trans}</strong></td>
                <td class="text-center font-mono" style="font-size: 0.8rem;">${item.tanggal_label || item.tanggal}</td>
                <td><strong>${item.customer}</strong></td>
                <td><span class="font-mono" style="font-size: 0.82rem;">${item.kode_barang}</span></td>
                <td>${item.nama_barang}</td>
                <td class="text-center"><span class="badge-satuan">${item.satuan}</span></td>
                <td class="text-center font-mono" style="font-size: 0.8rem;">${item.batch}</td>
                <td class="text-right font-mono">${Number(item.jumlah || 0).toLocaleString('id-ID')}</td>
                <td class="text-right font-mono" style="color: var(--kpi-green); font-weight: 600;">${Number(item.jumlah_dn || 0).toLocaleString('id-ID')}</td>
                <td><span class="font-mono" style="font-size: 0.8rem; color: #64748b;">${item.no_dn}</span></td>
                <td class="text-center font-mono" style="font-size: 0.8rem;">${item.tgl_dn_label || item.tgl_dn || '-'}</td>
                <td class="text-center">${badge}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

function renderWhFgPagination(totalItems, currentPage, pageSize) {
    const pageInfo = document.getElementById('whFgPageInfo');
    const btnPrev = document.getElementById('btnWhFgPrevPage');
    const btnNext = document.getElementById('btnWhFgNextPage');

    const totalPages = Math.ceil(totalItems / pageSize) || 1;

    if (pageInfo) {
        pageInfo.textContent = getPaginationInfoText(currentPage, totalPages, totalItems, pageSize);
    }

    if (btnPrev) btnPrev.disabled = currentPage <= 1;
    if (btnNext) btnNext.disabled = currentPage >= totalPages;
}

function changeWhFgPage(delta) {
    const totalItems = state.currentWhFgView === 'dr'
        ? (state.whFgRawData?.summary_by_dr?.length || 0)
        : (state.whFgRawData?.items?.length || 0);

    const totalPages = Math.ceil(totalItems / state.whFgPageSize) || 1;
    const target = state.whFgCurrentPage + delta;
    if (target >= 1 && target <= totalPages) {
        state.whFgCurrentPage = target;
        if (state.whFgRawData) {
            renderWhFgModalData(state.whFgRawData);
        }
    }
}

function sortWhFg(view, column) {
    const current = state.whFgSort[view];
    if (current.column === column) {
        current.dir = current.dir === 'asc' ? 'desc' : 'asc';
    } else {
        current.column = column;
        current.dir = 'asc';
    }

    updateWhFgSortHeaders(view);
    if (state.whFgRawData) {
        renderWhFgModalData(state.whFgRawData);
    }
}

function updateWhFgSortHeaders(view) {
    const panelId = view === 'dr' ? 'tabPanelWhFgDr' : 'tabPanelWhFgItems';
    const panel = document.getElementById(panelId);
    if (!panel) return;

    const current = state.whFgSort[view];
    const ths = panel.querySelectorAll('th.sortable-th');
    ths.forEach(th => {
        const key = th.getAttribute('onclick')?.match(/'([^']+)'\)$/)?.[1];
        const icon = th.querySelector('.sort-icon');
        if (key === current.column) {
            th.classList.add('active-sort');
            if (icon) {
                icon.className = current.dir === 'asc'
                    ? 'fa-solid fa-arrow-up-wide-short sort-icon'
                    : 'fa-solid fa-arrow-down-wide-short sort-icon';
            }
        } else {
            th.classList.remove('active-sort');
            if (icon) icon.className = 'fa-solid fa-sort sort-icon';
        }
    });
}

function renderWhFgTablesLoading() {
    const tbodyDr = document.getElementById('whFgDrTableBody');
    const tbodyItems = document.getElementById('whFgItemsTableBody');
    const skeleton = `
        <tr>
            <td colspan="13" style="padding: 2rem; text-align: center; color: var(--text-secondary);">
                <i class="fa-solid fa-spinner fa-spin" style="font-size: 1.5rem; color: #0284c7;"></i>
                <div style="margin-top: 8px; font-weight: 500;">Memuat data Penyelesaian DR dari Atena ERP...</div>
            </td>
        </tr>
    `;
    if (tbodyDr) tbodyDr.innerHTML = skeleton;
    if (tbodyItems) tbodyItems.innerHTML = skeleton;
}

function renderWhFgTablesError(message) {
    const tbodyDr = document.getElementById('whFgDrTableBody');
    const tbodyItems = document.getElementById('whFgItemsTableBody');
    const errHtml = `
        <tr>
            <td colspan="13" class="subcon-empty-row" style="color: #ef4444;">
                <i class="fa-solid fa-triangle-exclamation" style="font-size: 2rem; color: #ef4444;"></i>
                <div style="margin-top: 8px; font-weight: 600;">Gagal Mengambil Data WH FG</div>
                <div style="font-size: 0.8rem; color: #64748b;">${message || 'Terjadi kesalahan sistem'}</div>
            </td>
        </tr>
    `;
    if (tbodyDr) tbodyDr.innerHTML = errHtml;
    if (tbodyItems) tbodyItems.innerHTML = errHtml;
}


// ====================================================================
// 16. MODAL MONITORING PEMENUHAN WH MATERIAL (ATENA ERP)
// ====================================================================

function formatWhMatDate(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function openWhMatModal(range = 'month', bagian = 'permintaanbahan') {
    const modal = document.getElementById('whMatModal');
    if (!modal) return;

    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    state.currentWhMatBagian = bagian;
    state.whMatSearchQuery = '';
    state.whMatCurrentPage = 1;

    const searchInput = document.getElementById('whMatSearchInput');
    if (searchInput) searchInput.value = '';

    const selectStatus = document.getElementById('selectWhMatStatus');
    if (selectStatus) selectStatus.value = 'all';
    state.currentWhMatStatus = 'all';

    updateWhMatBagianTabs(bagian);
    switchWhMatMrSubView(state.whMatMrSubView || 'doc', false);
    switchWhMatDrSubView(state.whMatDrSubView || 'doc', false);

    const whMatCardData = state.stats?.WH_MAT;
    if (whMatCardData?.kpi) {
        const countMr = document.getElementById('countWhMatMr');
        const countDr = document.getElementById('countWhMatDr');
        if (countMr && whMatCardData.kpi.total_mr && countMr.textContent.includes('0')) {
            countMr.textContent = `${whMatCardData.kpi.total_mr} MR`;
        }
        if (countDr && whMatCardData.kpi.total_dr && countDr.textContent.includes('0')) {
            countDr.textContent = `${whMatCardData.kpi.total_dr} DR`;
        }
    }

    setWhMatQuickDate(range);
}

function closeWhMatModal() {
    const modal = document.getElementById('whMatModal');
    if (!modal) return;
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
}

function switchWhMatBagian(bagian) {
    if (state.currentWhMatBagian === bagian) return;
    state.currentWhMatBagian = bagian;
    state.whMatCurrentPage = 1;
    updateWhMatBagianTabs(bagian);
    loadWhMatData();
}

function updateWhMatBagianTabs(bagian) {
    const btnMr = document.getElementById('btnWhMatTabMr');
    const btnDr = document.getElementById('btnWhMatTabDr');
    const panelMr = document.getElementById('tabPanelWhMatMr');
    const panelDr = document.getElementById('tabPanelWhMatDr');

    const isMr = bagian === 'permintaanbahan';
    if (btnMr) btnMr.classList.toggle('active', isMr);
    if (btnDr) btnDr.classList.toggle('active', !isMr);
    if (panelMr) panelMr.classList.toggle('active', isMr);
    if (panelDr) panelDr.classList.toggle('active', !isMr);

    // Update KPI Card Labels
    const lblTotal = document.getElementById('modalKpiWhMatTotalLbl');
    const lblSelesai = document.getElementById('modalKpiWhMatSelesaiLbl');
    const lblBelum = document.getElementById('modalKpiWhMatBelumLbl');
    const lblQty = document.getElementById('modalKpiWhMatTotalQtyLbl');
    const lblRealisasi = document.getElementById('modalKpiWhMatTotalQtyRealisasiLbl');

    if (isMr) {
        if (lblTotal) lblTotal.textContent = 'Total MR';
        if (lblSelesai) lblSelesai.textContent = 'Terpenuhi';
        if (lblBelum) lblBelum.textContent = 'Belum Terpenuhi';
        if (lblQty) lblQty.textContent = 'Total Qty Diminta';
        if (lblRealisasi) lblRealisasi.textContent = 'Total Qty Realisasi';
    } else {
        if (lblTotal) lblTotal.textContent = 'Total DR';
        if (lblSelesai) lblSelesai.textContent = 'Sudah DN';
        if (lblBelum) lblBelum.textContent = 'Belum DN';
        if (lblQty) lblQty.textContent = 'Total Qty DR';
        if (lblRealisasi) lblRealisasi.textContent = 'Total Qty Realisasi DN';
    }
}

function setWhMatQuickDate(preset = 'month') {
    state.currentWhMatRange = preset;
    state.whMatCurrentPage = 1;

    const { startDate, endDate } = getActivePeriodDates(preset);

    state.whMatDateStart = startDate;
    state.whMatDateEnd = endDate;

    setDateInputValue('whMatDateStart', startDate);
    setDateInputValue('whMatDateEnd', endDate);

    const pills = document.querySelectorAll('.wh-mat-range-pills .filter-pill');
    pills.forEach(p => p.classList.remove('active'));

    const btnMap = {
        'month': 'btnQuickWhMatMonth',
        'week': 'btnQuickWhMatWeek',
        'today': 'btnQuickWhMatToday',
        'all': 'btnQuickWhMatAll'
    };
    const activeBtn = document.getElementById(btnMap[preset]);
    if (activeBtn) activeBtn.classList.add('active');

    loadWhMatData();
}

function handleWhMatDateChange(field) {
    const startInput = document.getElementById('whMatDateStart');
    const endInput = document.getElementById('whMatDateEnd');
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

    state.whMatDateStart = start;
    state.whMatDateEnd = end;
    state.currentWhMatRange = 'custom';
    state.whMatCurrentPage = 1;

    const pills = document.querySelectorAll('.wh-mat-range-pills .filter-pill');
    pills.forEach(p => p.classList.remove('active'));

    loadWhMatData();
}

function resetWhMatFilter() {
    state.whMatSearchQuery = '';
    state.currentWhMatStatus = 'all';
    state.whMatCurrentPage = 1;

    const searchInput = document.getElementById('whMatSearchInput');
    if (searchInput) searchInput.value = '';

    const selectStatus = document.getElementById('selectWhMatStatus');
    if (selectStatus) selectStatus.value = 'all';

    setWhMatQuickDate('month');
}

function switchWhMatStatus(status) {
    state.currentWhMatStatus = status;
    state.whMatCurrentPage = 1;
    if (state.whMatRawData) {
        renderWhMatModalData(state.whMatRawData);
    }
}

let whMatSearchTimeout = null;
function handleWhMatSearch(query) {
    clearTimeout(whMatSearchTimeout);
    whMatSearchTimeout = setTimeout(() => {
        state.whMatSearchQuery = (query || '').trim().toLowerCase();
        state.whMatCurrentPage = 1;
        if (state.whMatRawData) {
            renderWhMatModalData(state.whMatRawData);
        }
    }, 200);
}

async function syncWhMatData() {
    const syncBtn = document.getElementById('btnSyncWhMat');
    const icon = syncBtn ? syncBtn.querySelector('i') : null;
    if (icon) icon.classList.add('fa-spin');

    try {
        renderWhMatTablesLoading();
        state.whMatCache.clear();
        await fetch('/api/dashboard/wh-mat/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bagian: state.currentWhMatBagian })
        });
        await loadWhMatData(true);
        await fetchDashboardStats();
    } catch (err) {
        console.error('[SYNC WH MAT ERROR]:', err);
    } finally {
        if (icon) icon.classList.remove('fa-spin');
    }
}

async function loadWhMatData(force = false) {
    const { whMatDateStart, whMatDateEnd, currentWhMatRange, currentWhMatBagian } = state;
    const cacheKey = `${currentWhMatBagian}_${currentWhMatRange}_${whMatDateStart}_${whMatDateEnd}`;

    if (!force && state.whMatCache.has(cacheKey)) {
        const cached = state.whMatCache.get(cacheKey);
        state.whMatRawData = cached;
        renderWhMatModalData(cached);
        return;
    }

    renderWhMatTablesLoading();

    try {
        const params = new URLSearchParams({
            bagian: currentWhMatBagian,
            range: currentWhMatRange,
            tglawal: whMatDateStart,
            tglakhir: whMatDateEnd,
            force: force ? 'true' : 'false'
        });

        const res = await fetch(`/api/dashboard/wh-mat?${params.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();

        if (json.success && json.data) {
            state.whMatRawData = json.data;
            state.whMatCache.set(cacheKey, json.data);
            renderWhMatModalData(json.data);
        } else {
            renderWhMatTablesError(json.message || 'Format data WH Material tidak valid');
        }
    } catch (err) {
        renderWhMatTablesError(err.message);
    }
}

function switchWhMatMrSubView(view, triggerRender = true) {
    state.whMatMrSubView = view;
    state.whMatCurrentPage = 1;

    const btnDoc = document.getElementById('btnSubViewWhMatMrDoc');
    const btnItem = document.getElementById('btnSubViewWhMatMrItem');
    const panelDoc = document.getElementById('subPanelWhMatMrDoc');
    const panelItem = document.getElementById('subPanelWhMatMrItem');

    const isDoc = view === 'doc';
    if (btnDoc) btnDoc.classList.toggle('active', isDoc);
    if (btnItem) btnItem.classList.toggle('active', !isDoc);
    if (panelDoc) panelDoc.style.display = isDoc ? 'block' : 'none';
    if (panelItem) panelItem.style.display = isDoc ? 'none' : 'block';

    if (triggerRender && state.whMatRawData) {
        renderWhMatModalData(state.whMatRawData);
    }
}

function switchWhMatDrSubView(view, triggerRender = true) {
    state.whMatDrSubView = view;
    state.whMatCurrentPage = 1;

    const btnDoc = document.getElementById('btnSubViewWhMatDrDoc');
    const btnItem = document.getElementById('btnSubViewWhMatDrItem');
    const panelDoc = document.getElementById('subPanelWhMatDrDoc');
    const panelItem = document.getElementById('subPanelWhMatDrItem');

    const isDoc = view === 'doc';
    if (btnDoc) btnDoc.classList.toggle('active', isDoc);
    if (btnItem) btnItem.classList.toggle('active', !isDoc);
    if (panelDoc) panelDoc.style.display = isDoc ? 'block' : 'none';
    if (panelItem) panelItem.style.display = isDoc ? 'none' : 'block';

    if (triggerRender && state.whMatRawData) {
        renderWhMatModalData(state.whMatRawData);
    }
}

function viewWhMatMrDocItems(noTrans) {
    state.whMatSearchQuery = (noTrans || '').trim().toLowerCase();
    const searchInput = document.getElementById('whMatSearchInput');
    if (searchInput) searchInput.value = noTrans || '';
    switchWhMatMrSubView('item', true);
}

function viewWhMatDrDocItems(noTrans) {
    state.whMatSearchQuery = (noTrans || '').trim().toLowerCase();
    const searchInput = document.getElementById('whMatSearchInput');
    if (searchInput) searchInput.value = noTrans || '';
    switchWhMatDrSubView('item', true);
}

function renderWhMatModalData(data) {
    if (!data) return;
    const kpi = data.kpi || {};
    const isMr = state.currentWhMatBagian === 'permintaanbahan';

    const elTotal = document.getElementById('modalKpiWhMatTotal');
    const elSelesai = document.getElementById('modalKpiWhMatSelesai');
    const elBelum = document.getElementById('modalKpiWhMatBelum');
    const elPercent = document.getElementById('modalKpiWhMatPercent');
    const elTotalQty = document.getElementById('modalKpiWhMatTotalQty');
    const elTotalRealisasi = document.getElementById('modalKpiWhMatTotalQtyRealisasi');

    const totalCount = isMr ? (kpi.total_mr ?? 0) : (kpi.total_dr ?? 0);
    const selesaiCount = isMr ? (kpi.mr_terpenuhi ?? 0) : (kpi.dr_sudah_dn ?? 0);
    const belumCount = isMr ? (kpi.mr_belum_terpenuhi ?? 0) : (kpi.dr_belum_dn ?? 0);

    if (elTotal) elTotal.textContent = Number(totalCount).toLocaleString('id-ID');
    if (elSelesai) elSelesai.textContent = Number(selesaiCount).toLocaleString('id-ID');
    if (elBelum) elBelum.textContent = Number(belumCount).toLocaleString('id-ID');
    if (elPercent) elPercent.textContent = `${kpi.persentase_selesai || 0}%`;
    if (elTotalQty) elTotalQty.textContent = Number(Math.round(kpi.total_jml || 0)).toLocaleString('id-ID');
    if (elTotalRealisasi) elTotalRealisasi.textContent = Number(Math.round(kpi.total_terpenuhi || 0)).toLocaleString('id-ID');

    const lastSyncEl = document.getElementById('whMatLastSyncTime');
    if (lastSyncEl && data.meta?.sync_time) {
        lastSyncEl.textContent = `Sinkron: ${new Date(data.meta.sync_time).toLocaleTimeString('id-ID')}`;
    }

    const rawDocs = data.summary_by_doc || [];
    const rawItems = data.items || [];

    // Update Badges on Sub-view buttons & Tabs
    if (isMr) {
        const countBadge = document.getElementById('countWhMatMr');
        if (countBadge) countBadge.textContent = `${rawDocs.length} MR (${rawItems.length} Item)`;
        const cDoc = document.getElementById('countSubViewMrDoc');
        if (cDoc) cDoc.textContent = rawDocs.length;
        const cItem = document.getElementById('countSubViewMrItem');
        if (cItem) cItem.textContent = rawItems.length;
    } else {
        const countBadge = document.getElementById('countWhMatDr');
        if (countBadge) countBadge.textContent = `${rawDocs.length} DR (${rawItems.length} Item)`;
        const cDoc = document.getElementById('countSubViewDrDoc');
        if (cDoc) cDoc.textContent = rawDocs.length;
        const cItem = document.getElementById('countSubViewDrItem');
        if (cItem) cItem.textContent = rawItems.length;
    }

    const q = state.whMatSearchQuery;
    const st = state.currentWhMatStatus;

    if (isMr) {
        if (state.whMatMrSubView === 'doc') {
            let filtered = rawDocs.filter(doc => {
                if (st === 'terpenuhi' && doc.status_code !== 'terpenuhi') return false;
                if (st === 'belum' && doc.status_code !== 'belum') return false;
                if (!q) return true;
                return (doc.no_trans || '').toLowerCase().includes(q) ||
                    (doc.lokasi_asal || '').toLowerCase().includes(q) ||
                    (doc.lokasi_tujuan || '').toLowerCase().includes(q) ||
                    (doc.leadtime || '').toLowerCase().includes(q) ||
                    (doc.status_mr || '').toLowerCase().includes(q);
            });

            const sort = state.whMatSort.mr_doc || { column: 'tgl_kirim', dir: 'desc' };
            filtered.sort((a, b) => {
                const valA = a[sort.column] ?? '';
                const valB = b[sort.column] ?? '';
                const cmp = typeof valA === 'number' ? valA - valB : String(valA).localeCompare(String(valB));
                return sort.dir === 'asc' ? cmp : -cmp;
            });

            renderWhMatMrDocTable(filtered);
            renderWhMatPagination(filtered.length, state.whMatCurrentPage, state.whMatPageSize);
        } else {
            let filtered = rawItems.filter(item => {
                if (st === 'terpenuhi' && item.status_code !== 'terpenuhi') return false;
                if (st === 'belum' && item.status_code !== 'belum') return false;
                if (!q) return true;
                return (item.no_trans || '').toLowerCase().includes(q) ||
                    (item.kode_barang || '').toLowerCase().includes(q) ||
                    (item.nama_barang || '').toLowerCase().includes(q) ||
                    (item.rak || '').toLowerCase().includes(q) ||
                    (item.lokasi_tujuan || '').toLowerCase().includes(q);
            });

            const sort = state.whMatSort.mr || { column: 'tgl_kirim', dir: 'desc' };
            filtered.sort((a, b) => {
                const valA = a[sort.column] ?? '';
                const valB = b[sort.column] ?? '';
                const cmp = typeof valA === 'number' ? valA - valB : String(valA).localeCompare(String(valB));
                return sort.dir === 'asc' ? cmp : -cmp;
            });

            renderWhMatMrTable(filtered);
            renderWhMatPagination(filtered.length, state.whMatCurrentPage, state.whMatPageSize);
        }
    } else {
        if (state.whMatDrSubView === 'doc') {
            let filtered = rawDocs.filter(doc => {
                if (st === 'terpenuhi' && doc.status_code !== 'sudah_dn') return false;
                if (st === 'belum' && doc.status_code !== 'belum_dn') return false;
                if (!q) return true;
                return (doc.no_trans || '').toLowerCase().includes(q) ||
                    (doc.sumber || '').toLowerCase().includes(q) ||
                    (doc.catatan || '').toLowerCase().includes(q) ||
                    (doc.ekspedisi || '').toLowerCase().includes(q) ||
                    (doc.no_dn || '').toLowerCase().includes(q) ||
                    (doc.kode_ref || '').toLowerCase().includes(q);
            });

            const sort = state.whMatSort.dr_doc || { column: 'tgl_kirim', dir: 'desc' };
            filtered.sort((a, b) => {
                const valA = a[sort.column] ?? '';
                const valB = b[sort.column] ?? '';
                const cmp = typeof valA === 'number' ? valA - valB : String(valA).localeCompare(String(valB));
                return sort.dir === 'asc' ? cmp : -cmp;
            });

            renderWhMatDrDocTable(filtered);
            renderWhMatPagination(filtered.length, state.whMatCurrentPage, state.whMatPageSize);
        } else {
            let filtered = rawItems.filter(item => {
                if (st === 'terpenuhi' && item.status_code !== 'sudah_dn') return false;
                if (st === 'belum' && item.status_code !== 'belum_dn') return false;
                if (!q) return true;
                return (item.no_trans || '').toLowerCase().includes(q) ||
                    (item.sumber || '').toLowerCase().includes(q) ||
                    (item.catatan || '').toLowerCase().includes(q) ||
                    (item.kode_barang || '').toLowerCase().includes(q) ||
                    (item.nama_barang || '').toLowerCase().includes(q) ||
                    (item.no_dn || '').toLowerCase().includes(q);
            });

            const sort = state.whMatSort.dr || { column: 'tgl_kirim', dir: 'desc' };
            filtered.sort((a, b) => {
                const valA = a[sort.column] ?? '';
                const valB = b[sort.column] ?? '';
                const cmp = typeof valA === 'number' ? valA - valB : String(valA).localeCompare(String(valB));
                return sort.dir === 'asc' ? cmp : -cmp;
            });

            renderWhMatDrTable(filtered);
            renderWhMatPagination(filtered.length, state.whMatCurrentPage, state.whMatPageSize);
        }
    }
}

function renderWhMatMrDocTable(docs) {
    const tbody = document.getElementById('whMatMrDocTableBody');
    if (!tbody) return;

    if (docs.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="12" class="subcon-empty-row">
                    <i class="fa-solid fa-file-invoice" style="font-size: 2rem; color: #cbd5e1;"></i>
                    <div style="margin-top: 8px; font-weight: 500;">Tidak ada data Dokumen MR yang cocok</div>
                </td>
            </tr>
        `;
        return;
    }

    const startIdx = (state.whMatCurrentPage - 1) * state.whMatPageSize;
    const pageItems = docs.slice(startIdx, startIdx + state.whMatPageSize);

    let html = '';
    pageItems.forEach((doc, idx) => {
        const no = startIdx + idx + 1;
        const isTerpenuhi = doc.status_code === 'terpenuhi' || doc.status_mr === 'TERPENUHI';
        const badgeMr = isTerpenuhi
            ? '<span class="service-status-pill status-live">TERPENUHI</span>'
            : '<span class="service-status-pill" style="color: #d97706; background: #fef3c7; border: 1px solid #fde68a;">BELUM TERPENUHI</span>';

        let badgeLeadtime = '<span class="service-status-pill status-live">TEPAT WAKTU</span>';
        if (doc.leadtime === 'TERLAMBAT' || doc.status === 'TERLAMBAT') {
            badgeLeadtime = '<span class="service-status-pill" style="color: #dc2626; background: #fee2e2; border: 1px solid #fecaca;">TERLAMBAT</span>';
        } else if (doc.leadtime === 'BELUM DITERIMA' || doc.status === 'BELUM DITERIMA') {
            badgeLeadtime = '<span class="service-status-pill" style="color: #64748b; background: #f1f5f9; border: 1px solid #cbd5e1;">BELUM DITERIMA</span>';
        }

        html += `
            <tr>
                <td class="text-center font-mono">${no}</td>
                <td>
                    <strong style="color: var(--sna-blue); cursor: pointer;" onclick="viewWhMatMrDocItems('${doc.no_trans}')" title="Klik untuk lihat rincian item">
                        ${doc.no_trans} <i class="fa-solid fa-arrow-up-right-from-square" style="font-size: 0.72rem; margin-left: 4px; color: #0284c7;"></i>
                    </strong>
                </td>
                <td class="text-center font-mono" style="font-size: 0.8rem;">${doc.tgl_kirim_label || doc.tgl_kirim}</td>
                <td style="font-size: 0.82rem;">${doc.lokasi_asal} &rarr; <strong>${doc.lokasi_tujuan}</strong></td>
                <td class="text-center">
                    <span class="badge-satuan" style="cursor: pointer; background: #e0f2fe; color: #0369a1; border-color: #bae6fd; font-weight: 600;" onclick="viewWhMatMrDocItems('${doc.no_trans}')" title="Klik untuk lihat rincian item">
                        ${doc.total_item} Item
                    </span>
                </td>
                <td class="text-right font-mono">${Number(doc.jml || 0).toLocaleString('id-ID')}</td>
                <td class="text-right font-mono" style="color: var(--kpi-green); font-weight: 600;">${Number(doc.terpenuhi || 0).toLocaleString('id-ID')}</td>
                <td class="text-right font-mono" style="color: ${doc.sisa > 0 ? '#ef4444' : '#64748b'};">${Number(doc.sisa || 0).toLocaleString('id-ID')}</td>
                <td class="text-center font-mono" style="font-size: 0.8rem;">${doc.tgl_transfer_label || doc.tgl_transfer || '-'}</td>
                <td class="text-center font-mono" style="font-size: 0.8rem;">${doc.tgl_terima_label || doc.tgl_terima || '-'}</td>
                <td class="text-center">${badgeLeadtime}</td>
                <td class="text-center">${badgeMr}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

function renderWhMatMrTable(items) {
    const tbody = document.getElementById('whMatMrTableBody');
    if (!tbody) return;

    if (items.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="15" class="subcon-empty-row">
                    <i class="fa-solid fa-box-open" style="font-size: 2rem; color: #cbd5e1;"></i>
                    <div style="margin-top: 8px; font-weight: 500;">Tidak ada data Rincian MR yang cocok</div>
                </td>
            </tr>
        `;
        return;
    }

    const startIdx = (state.whMatCurrentPage - 1) * state.whMatPageSize;
    const pageItems = items.slice(startIdx, startIdx + state.whMatPageSize);

    let html = '';
    pageItems.forEach((item, idx) => {
        const no = startIdx + idx + 1;
        const isTerpenuhi = item.status_code === 'terpenuhi';
        const badgeMr = isTerpenuhi
            ? '<span class="service-status-pill status-live">TERPENUHI</span>'
            : '<span class="service-status-pill" style="color: #d97706; background: #fef3c7; border: 1px solid #fde68a;">BELUM TERPENUHI</span>';

        let badgeLeadtime = '<span class="service-status-pill status-live">TEPAT WAKTU</span>';
        if (item.status === 'TERLAMBAT') {
            badgeLeadtime = '<span class="service-status-pill" style="color: #dc2626; background: #fee2e2; border: 1px solid #fecaca;">TERLAMBAT</span>';
        } else if (item.status !== 'TEPAT WAKTU') {
            badgeLeadtime = `<span class="service-status-pill" style="color: #64748b; background: #f1f5f9; border: 1px solid #cbd5e1;">${item.status}</span>`;
        }

        html += `
            <tr>
                <td class="text-center font-mono">${no}</td>
                <td><strong style="color: var(--sna-blue);">${item.no_trans}</strong></td>
                <td class="text-center font-mono" style="font-size: 0.8rem;">${item.tgl_kirim_label || item.tgl_kirim}</td>
                <td style="font-size: 0.82rem;">${item.lokasi_asal} &rarr; <strong>${item.lokasi_tujuan}</strong></td>
                <td><span class="font-mono" style="font-size: 0.82rem;">${item.kode_barang}</span></td>
                <td>${item.nama_barang}</td>
                <td class="text-center font-mono" style="font-size: 0.8rem;">${item.rak || '-'}</td>
                <td class="text-center font-mono" style="font-size: 0.8rem;">${item.batch || '-'}</td>
                <td class="text-right font-mono">${Number(item.jml || 0).toLocaleString('id-ID')}</td>
                <td class="text-right font-mono" style="color: var(--kpi-green); font-weight: 600;">${Number(item.terpenuhi || 0).toLocaleString('id-ID')}</td>
                <td class="text-right font-mono" style="color: ${item.sisa > 0 ? '#ef4444' : '#64748b'};">${Number(item.sisa || 0).toLocaleString('id-ID')}</td>
                <td class="text-center font-mono" style="font-size: 0.8rem;">${item.tgl_transfer_label || item.tgl_transfer || '-'}</td>
                <td class="text-center font-mono" style="font-size: 0.8rem;">${item.tgl_terima_label || item.tgl_terima || '-'}</td>
                <td class="text-center">${badgeLeadtime}</td>
                <td class="text-center">${badgeMr}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

function renderWhMatDrDocTable(docs) {
    const tbody = document.getElementById('whMatDrDocTableBody');
    if (!tbody) return;

    if (docs.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="14" class="subcon-empty-row">
                    <i class="fa-solid fa-file-invoice" style="font-size: 2rem; color: #cbd5e1;"></i>
                    <div style="margin-top: 8px; font-weight: 500;">Tidak ada data Dokumen DR yang cocok</div>
                </td>
            </tr>
        `;
        return;
    }

    const startIdx = (state.whMatCurrentPage - 1) * state.whMatPageSize;
    const pageItems = docs.slice(startIdx, startIdx + state.whMatPageSize);

    let html = '';
    pageItems.forEach((doc, idx) => {
        const no = startIdx + idx + 1;
        const isSudah = doc.status_code === 'sudah_dn';
        const badge = isSudah
            ? '<span class="service-status-pill status-live">SUDAH DN</span>'
            : '<span class="service-status-pill" style="color: #d97706; background: #fef3c7; border: 1px solid #fde68a;">BELUM DN</span>';

        html += `
            <tr>
                <td class="text-center font-mono">${no}</td>
                <td><span class="badge-satuan" style="font-size: 0.72rem;">${doc.sumber || '-'}</span></td>
                <td>
                    <strong style="color: var(--sna-blue); cursor: pointer;" onclick="viewWhMatDrDocItems('${doc.no_trans}')" title="Klik untuk lihat rincian item">
                        ${doc.no_trans} <i class="fa-solid fa-arrow-up-right-from-square" style="font-size: 0.72rem; margin-left: 4px; color: #0284c7;"></i>
                    </strong>
                </td>
                <td class="text-center font-mono" style="font-size: 0.8rem;">${doc.tgl_kirim_label || doc.tgl_kirim}</td>
                <td style="font-size: 0.8rem; max-width: 180px;" title="${doc.catatan || ''}">${doc.catatan || '-'}</td>
                <td style="font-size: 0.8rem;">${doc.ekspedisi || '-'}</td>
                <td class="text-center">
                    <span class="badge-satuan" style="cursor: pointer; background: #e0f2fe; color: #0369a1; border-color: #bae6fd; font-weight: 600;" onclick="viewWhMatDrDocItems('${doc.no_trans}')" title="Klik untuk lihat rincian item">
                        ${doc.total_item} Item
                    </span>
                </td>
                <td class="text-right font-mono">${Number(doc.jml || 0).toLocaleString('id-ID')}</td>
                <td class="text-right font-mono" style="color: var(--kpi-green); font-weight: 600;">${Number(doc.terpenuhi || 0).toLocaleString('id-ID')}</td>
                <td class="text-right font-mono" style="color: ${doc.sisa > 0 ? '#ef4444' : '#64748b'};">${Number(doc.sisa || 0).toLocaleString('id-ID')}</td>
                <td><span class="font-mono" style="font-size: 0.8rem; color: #64748b;">${doc.no_dn || '-'}</span></td>
                <td class="text-center font-mono" style="font-size: 0.8rem;">${doc.tgl_dn_label || doc.tgl_dn || '-'}</td>
                <td><span class="font-mono" style="font-size: 0.8rem; color: #64748b;">${doc.kode_ref || '-'}</span></td>
                <td class="text-center">${badge}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

function renderWhMatDrTable(items) {
    const tbody = document.getElementById('whMatDrTableBody');
    if (!tbody) return;

    if (items.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="17" class="subcon-empty-row">
                    <i class="fa-solid fa-box-open" style="font-size: 2rem; color: #cbd5e1;"></i>
                    <div style="margin-top: 8px; font-weight: 500;">Tidak ada data Rincian DR yang cocok</div>
                </td>
            </tr>
        `;
        return;
    }

    const startIdx = (state.whMatCurrentPage - 1) * state.whMatPageSize;
    const pageItems = items.slice(startIdx, startIdx + state.whMatPageSize);

    let html = '';
    pageItems.forEach((item, idx) => {
        const no = startIdx + idx + 1;
        const isSudah = item.status_code === 'sudah_dn';
        const badge = isSudah
            ? '<span class="service-status-pill status-live">SUDAH DN</span>'
            : '<span class="service-status-pill" style="color: #d97706; background: #fef3c7; border: 1px solid #fde68a;">BELUM DN</span>';

        html += `
            <tr>
                <td class="text-center font-mono">${no}</td>
                <td><span class="badge-satuan" style="font-size: 0.72rem;">${item.sumber || '-'}</span></td>
                <td><strong style="color: var(--sna-blue);">${item.no_trans}</strong></td>
                <td class="text-center font-mono" style="font-size: 0.8rem;">${item.tgl_kirim_label || item.tgl_kirim}</td>
                <td style="font-size: 0.8rem; max-width: 180px;" title="${item.catatan || ''}">${item.catatan || '-'}</td>
                <td style="font-size: 0.8rem;">${item.ekspedisi || '-'}</td>
                <td><span class="font-mono" style="font-size: 0.82rem;">${item.kode_barang}</span></td>
                <td>${item.nama_barang}</td>
                <td class="text-center"><span class="badge-satuan">${item.satuan || '-'}</span></td>
                <td class="text-center font-mono" style="font-size: 0.8rem;">${item.batch || '-'}</td>
                <td class="text-right font-mono">${Number(item.jml || 0).toLocaleString('id-ID')}</td>
                <td class="text-right font-mono" style="color: var(--kpi-green); font-weight: 600;">${Number(item.terpenuhi || 0).toLocaleString('id-ID')}</td>
                <td class="text-right font-mono" style="color: ${item.sisa > 0 ? '#ef4444' : '#64748b'};">${Number(item.sisa || 0).toLocaleString('id-ID')}</td>
                <td><span class="font-mono" style="font-size: 0.8rem; color: #64748b;">${item.no_dn || '-'}</span></td>
                <td class="text-center font-mono" style="font-size: 0.8rem;">${item.tgl_dn_label || item.tgl_dn || '-'}</td>
                <td><span class="font-mono" style="font-size: 0.8rem; color: #64748b;">${item.kode_ref || '-'}</span></td>
                <td class="text-center">${badge}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

function renderWhMatPagination(totalItems, currentPage, pageSize) {
    const pageInfo = document.getElementById('whMatPageInfo');
    const btnPrev = document.getElementById('btnWhMatPrevPage');
    const btnNext = document.getElementById('btnWhMatNextPage');

    const totalPages = Math.ceil(totalItems / pageSize) || 1;

    if (pageInfo) {
        pageInfo.textContent = getPaginationInfoText(currentPage, totalPages, totalItems, pageSize);
    }

    if (btnPrev) btnPrev.disabled = currentPage <= 1;
    if (btnNext) btnNext.disabled = currentPage >= totalPages;
}

function changeWhMatPage(delta) {
    const isMr = state.currentWhMatBagian === 'permintaanbahan';
    let activeList = [];
    if (isMr) {
        activeList = state.whMatMrSubView === 'doc' ? (state.whMatRawData?.summary_by_doc || []) : (state.whMatRawData?.items || []);
    } else {
        activeList = state.whMatDrSubView === 'doc' ? (state.whMatRawData?.summary_by_doc || []) : (state.whMatRawData?.items || []);
    }
    const totalItems = activeList.length;
    const totalPages = Math.ceil(totalItems / state.whMatPageSize) || 1;
    const target = state.whMatCurrentPage + delta;
    if (target >= 1 && target <= totalPages) {
        state.whMatCurrentPage = target;
        if (state.whMatRawData) {
            renderWhMatModalData(state.whMatRawData);
        }
    }
}

function sortWhMat(tab, column) {
    if (!state.whMatSort[tab]) {
        state.whMatSort[tab] = { column, dir: 'asc' };
    }
    const current = state.whMatSort[tab];
    if (current.column === column) {
        current.dir = current.dir === 'asc' ? 'desc' : 'asc';
    } else {
        current.column = column;
        current.dir = 'asc';
    }

    updateWhMatSortHeaders(tab);
    if (state.whMatRawData) {
        renderWhMatModalData(state.whMatRawData);
    }
}

function updateWhMatSortHeaders(tab) {
    let container = null;
    if (tab === 'mr_doc') container = document.getElementById('subPanelWhMatMrDoc');
    else if (tab === 'mr') container = document.getElementById('subPanelWhMatMrItem');
    else if (tab === 'dr_doc') container = document.getElementById('subPanelWhMatDrDoc');
    else if (tab === 'dr') container = document.getElementById('subPanelWhMatDrItem');
    if (!container) return;

    const current = state.whMatSort[tab];
    if (!current) return;

    const ths = container.querySelectorAll('th.sortable-th');
    ths.forEach(th => {
        const key = th.getAttribute('onclick')?.match(/'([^']+)'\)$/)?.[1];
        const icon = th.querySelector('.sort-icon');
        if (key === current.column) {
            th.classList.add('active-sort');
            if (icon) {
                icon.className = current.dir === 'asc'
                    ? 'fa-solid fa-arrow-up-wide-short sort-icon'
                    : 'fa-solid fa-arrow-down-wide-short sort-icon';
            }
        } else {
            th.classList.remove('active-sort');
            if (icon) icon.className = 'fa-solid fa-sort sort-icon';
        }
    });
}

function renderWhMatTablesLoading() {
    const tbodyMrDoc = document.getElementById('whMatMrDocTableBody');
    const tbodyMrItem = document.getElementById('whMatMrTableBody');
    const tbodyDrDoc = document.getElementById('whMatDrDocTableBody');
    const tbodyDrItem = document.getElementById('whMatDrTableBody');
    const skeleton = `
        <tr>
            <td colspan="15" style="padding: 2rem; text-align: center; color: var(--text-secondary);">
                <i class="fa-solid fa-spinner fa-spin" style="font-size: 1.5rem; color: #0284c7;"></i>
                <div style="margin-top: 8px; font-weight: 500;">Memuat data Pemenuhan WH Material dari Atena ERP...</div>
            </td>
        </tr>
    `;
    if (tbodyMrDoc) tbodyMrDoc.innerHTML = skeleton;
    if (tbodyMrItem) tbodyMrItem.innerHTML = skeleton;
    if (tbodyDrDoc) tbodyDrDoc.innerHTML = skeleton;
    if (tbodyDrItem) tbodyDrItem.innerHTML = skeleton;
}

function renderWhMatTablesError(message) {
    const tbodyMrDoc = document.getElementById('whMatMrDocTableBody');
    const tbodyMrItem = document.getElementById('whMatMrTableBody');
    const tbodyDrDoc = document.getElementById('whMatDrDocTableBody');
    const tbodyDrItem = document.getElementById('whMatDrTableBody');
    const errHtml = `
        <tr>
            <td colspan="15" class="subcon-empty-row" style="color: #ef4444;">
                <i class="fa-solid fa-triangle-exclamation" style="font-size: 2rem; color: #ef4444;"></i>
                <div style="margin-top: 8px; font-weight: 600;">Gagal Mengambil Data WH Material</div>
                <div style="font-size: 0.8rem; color: #64748b;">${message || 'Terjadi kesalahan sistem'}</div>
            </td>
        </tr>
    `;
    if (tbodyMrDoc) tbodyMrDoc.innerHTML = errHtml;
    if (tbodyMrItem) tbodyMrItem.innerHTML = errHtml;
    if (tbodyDrDoc) tbodyDrDoc.innerHTML = errHtml;
    if (tbodyDrItem) tbodyDrItem.innerHTML = errHtml;
}




// ====================================================================
// MODAL MONITORING PEMENUHAN ORDER PBF (ATENA ERP)
// ====================================================================

function formatPbfDate(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function openPbfModal(range = 'month') {
    const modal = document.getElementById('pbfModal');
    if (!modal) return;

    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    state.pbfSearchQuery = '';
    state.pbfCurrentPage = 1;
    state.currentPbfStatus = 'all';

    const searchInput = document.getElementById('pbfSearchInput');
    if (searchInput) searchInput.value = '';

    const selectStatus = document.getElementById('selectPbfStatus');
    if (selectStatus) selectStatus.value = 'all';

    setPbfQuickDate(range);
}

function closePbfModal() {
    const modal = document.getElementById('pbfModal');
    if (!modal) return;
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
}

function setPbfQuickDate(preset = 'month') {
    state.currentPbfRange = preset;
    state.pbfCurrentPage = 1;

    const { startDate, endDate } = getActivePeriodDates(preset);

    state.pbfDateStart = startDate;
    state.pbfDateEnd = endDate;

    setDateInputValue('pbfDateStart', startDate);
    setDateInputValue('pbfDateEnd', endDate);

    const pills = document.querySelectorAll('.pbf-range-pills .filter-pill');
    pills.forEach(p => p.classList.remove('active'));

    const btnMap = {
        'month': 'btnQuickPbfMonth',
        'week': 'btnQuickPbfWeek',
        'today': 'btnQuickPbfToday',
        'all': 'btnQuickPbfAll'
    };
    const activeBtn = document.getElementById(btnMap[preset]);
    if (activeBtn) activeBtn.classList.add('active');

    loadPbfData();
}

function handlePbfDateChange(field) {
    const startInput = document.getElementById('pbfDateStart');
    const endInput = document.getElementById('pbfDateEnd');

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

    state.pbfDateStart = start;
    state.pbfDateEnd = end;
    state.currentPbfRange = 'custom';
    state.pbfCurrentPage = 1;

    const pills = document.querySelectorAll('.pbf-range-pills .filter-pill');
    pills.forEach(p => p.classList.remove('active'));

    loadPbfData();
}

function resetPbfFilter() {
    state.pbfSearchQuery = '';
    state.pbfCurrentPage = 1;
    state.currentPbfStatus = 'all';

    const searchInput = document.getElementById('pbfSearchInput');
    if (searchInput) searchInput.value = '';

    const selectStatus = document.getElementById('selectPbfStatus');
    if (selectStatus) selectStatus.value = 'all';

    setPbfQuickDate('month');
}

let pbfSearchDebounce = null;
function handlePbfSearch(val) {
    clearTimeout(pbfSearchDebounce);
    pbfSearchDebounce = setTimeout(() => {
        state.pbfSearchQuery = (val || '').trim().toLowerCase();
        state.pbfCurrentPage = 1;
        if (state.pbfRawData) {
            renderPbfModalData(state.pbfRawData);
        }
    }, 250);
}

function switchPbfStatus(val) {
    state.currentPbfStatus = val;
    state.pbfCurrentPage = 1;
    if (state.pbfRawData) {
        renderPbfModalData(state.pbfRawData);
    }
}

async function syncPbfData() {
    const btn = document.getElementById('btnSyncPbf');
    const icon = btn ? btn.querySelector('i') : null;
    if (icon) icon.classList.add('fa-spin');

    try {
        if (state.pbfCache) state.pbfCache.clear();
        await fetch('/api/dashboard/pbf/sync', { method: 'POST' });
        await loadPbfData(true);
        await fetchDashboardStats();
    } catch (err) {
        console.error('Sync PBF Error:', err);
    } finally {
        if (icon) icon.classList.remove('fa-spin');
    }
}

async function loadPbfData(force = false) {
    let url = '/api/dashboard/pbf?';
    if (state.pbfDateStart && state.pbfDateEnd) {
        url += `tglawal=${encodeURIComponent(state.pbfDateStart)}&tglakhir=${encodeURIComponent(state.pbfDateEnd)}`;
    } else {
        url += `range=${encodeURIComponent(state.currentPbfRange || 'month')}`;
    }
    if (force) url += '&force=true';

    const cacheKey = `pbf_${state.pbfDateStart}_${state.pbfDateEnd}_${state.currentPbfRange}`;

    if (!state.pbfCache) state.pbfCache = new Map();

    if (!force && state.pbfCache.has(cacheKey)) {
        const cached = state.pbfCache.get(cacheKey);
        state.pbfRawData = cached.data;
        renderPbfModalData(cached.data);
        if (Date.now() - cached.timestamp < 30000) return;
    } else {
        renderPbfTableLoading();
    }

    try {
        const res = await fetch(url);
        const result = await res.json();

        if (!result.success || !result.data) {
            throw new Error(result.message || 'Gagal mengambil data monitoring PBF');
        }

        state.pbfCache.set(cacheKey, { data: result.data, timestamp: Date.now() });
        state.pbfRawData = result.data;
        renderPbfModalData(result.data);
    } catch (err) {
        console.error('Error memuat data PBF:', err);
        renderPbfTableError(err.message);
    }
}

function renderPbfTableLoading() {
    const tbody = document.getElementById('pbfTableBody');
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="12" style="padding: 2.5rem 1rem; text-align: center; color: var(--text-secondary);">
                    <i class="fa-solid fa-spinner fa-spin" style="font-size: 1.8rem; color: #8b5cf6;"></i>
                    <div style="margin-top: 10px; font-weight: 600; font-size: 0.9rem;">Memuat data Pemenuhan Order PBF dari Atena ERP...</div>
                </td>
            </tr>
        `;
    }
}

function renderPbfTableError(message) {
    const tbody = document.getElementById('pbfTableBody');
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="12" style="padding: 2.5rem 1rem; text-align: center; color: #dc2626;">
                    <i class="fa-solid fa-circle-exclamation" style="font-size: 1.8rem; color: #dc2626;"></i>
                    <div style="margin-top: 10px; font-weight: 600; font-size: 0.9rem;">${message || 'Gagal mengambil data monitoring PBF'}</div>
                    <button class="filter-pill" style="margin-top: 12px; display: inline-flex; align-items: center; gap: 6px;" onclick="loadPbfData(true)">
                        <i class="fa-solid fa-rotate-right"></i> Coba Lagi
                    </button>
                </td>
            </tr>
        `;
    }
}

function renderPbfModalData(data) {
    if (!data) return;

    const kpi = data.kpi || {};
    const ringkasan = data.ringkasan || {};
    const items = Array.isArray(data.items) ? data.items : [];
    const meta = data.meta || {};

    const elTotal = document.getElementById('modalKpiPbfTotal');
    const elMemenuhi = document.getElementById('modalKpiPbfMemenuhi');
    const elPercent = document.getElementById('modalKpiPbfPercent');
    const elBelum = document.getElementById('modalKpiPbfBelum');
    const elTepat = document.getElementById('modalKpiPbfTepat');
    const elQtyPct = document.getElementById('modalKpiPbfQtyPct');

    if (elTotal) elTotal.textContent = Number(kpi.total_order || 0).toLocaleString('id-ID');
    if (elMemenuhi) elMemenuhi.textContent = Number(kpi.order_memenuhi || 0).toLocaleString('id-ID');
    if (elPercent) elPercent.textContent = `${kpi.persentase || 0}%`;
    if (elBelum) elBelum.textContent = Number(kpi.order_belum_memenuhi || 0).toLocaleString('id-ID');
    if (elTepat) elTepat.textContent = Number(kpi.tepat_waktu || 0).toLocaleString('id-ID');
    if (elQtyPct) elQtyPct.textContent = `${kpi.persentase_qty || 0}%`;

    const lastSyncEl = document.getElementById('pbfLastSyncTime');
    if (lastSyncEl) {
        lastSyncEl.textContent = `• Sinkronisasi: ${new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB`;
    }

    // Filter Items
    const q = (state.pbfSearchQuery || '').toLowerCase();
    const status = state.currentPbfStatus || 'all';

    let filtered = items.filter(item => {
        if (status === 'memenuhi' && !item.is_memenuhi) return false;
        if (status === 'belum' && item.is_memenuhi) return false;
        if (status === 'tepat_waktu' && !item.is_tepat_waktu) return false;
        if (status === 'terlambat' && item.is_tepat_waktu) return false;

        if (q) {
            const matchTrans = item.no_trans && item.no_trans.toLowerCase().includes(q);
            const matchCust = item.customer && item.customer.toLowerCase().includes(q);
            const matchKota = item.kota && item.kota.toLowerCase().includes(q);
            const matchBarang = (item.nama_barang && item.nama_barang.toLowerCase().includes(q)) || (item.kode_barang && item.kode_barang.toLowerCase().includes(q));
            const matchSj = item.no_surat_jalan && item.no_surat_jalan.toLowerCase().includes(q);
            if (!matchTrans && !matchCust && !matchKota && !matchBarang && !matchSj) return false;
        }
        return true;
    });

    // Sorting
    const sort = state.pbfSort || { column: 'tgl_trans', dir: 'desc' };
    filtered.sort((a, b) => {
        let valA = a[sort.column] ?? '';
        let valB = b[sort.column] ?? '';
        if (typeof valA === 'number' || typeof valB === 'number') {
            return (Number(valA) - Number(valB)) * (sort.dir === 'asc' ? 1 : -1);
        }
        valA = String(valA).toLowerCase();
        valB = String(valB).toLowerCase();
        if (valA < valB) return sort.dir === 'asc' ? -1 : 1;
        if (valA > valB) return sort.dir === 'asc' ? 1 : -1;
        return 0;
    });

    renderPbfTable(filtered);
    renderPbfPagination(filtered.length);
}

function renderPbfTable(list) {
    const tbody = document.getElementById('pbfTableBody');
    const footerStats = document.getElementById('pbfModalFooterStats');
    if (!tbody) return;

    if (!list || list.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="12" class="subcon-empty-row">
                    <i class="fa-solid fa-boxes-packing" style="font-size: 2rem; color: #cbd5e1;"></i>
                    <div style="margin-top: 8px;">Tidak ada data Sales Order PBF yang cocok</div>
                </td>
            </tr>
        `;
        if (footerStats) footerStats.textContent = 'Menampilkan 0 Item Order';
        return;
    }

    const pageSize = state.pbfPageSize || 10;
    const totalItems = list.length;
    const totalPages = Math.ceil(totalItems / pageSize) || 1;
    if (state.pbfCurrentPage > totalPages) state.pbfCurrentPage = totalPages;
    if (state.pbfCurrentPage < 1) state.pbfCurrentPage = 1;

    const startIdx = (state.pbfCurrentPage - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, totalItems);
    const paged = list.slice(startIdx, endIdx);

    let html = '';
    paged.forEach((item, idx) => {
        const orderBadge = item.is_memenuhi
            ? '<span class="badge-status-memenuhi"><i class="fa-solid fa-circle-check"></i> MEMENUHI</span>'
            : '<span class="badge-status-belum"><i class="fa-solid fa-circle-xmark"></i> BELUM</span>';

        const kirimBadge = item.is_tepat_waktu
            ? '<span style="color: #16a34a; font-weight: 700; font-size: 0.76rem;"><i class="fa-solid fa-check-double"></i> TEPAT WAKTU</span>'
            : (item.no_surat_jalan && item.no_surat_jalan !== '-'
                ? '<span style="color: #dc2626; font-weight: 700; font-size: 0.76rem;"><i class="fa-solid fa-triangle-exclamation"></i> TERLAMBAT</span>'
                : '<span style="color: #64748b; font-size: 0.76rem;">BELUM KIRIM</span>');

        const custHtml = `<div><strong style="color: #1e293b;">${item.customer}</strong><br><span style="color: #64748b; font-size: 0.72rem;"><i class="fa-solid fa-location-dot"></i> ${item.kota || '-'}</span></div>`;

        const barangHtml = `<div><span class="font-mono" style="font-size: 0.72rem; color: #64748b;">[${item.kode_barang}]</span> <span style="font-weight: 600; font-size: 0.8rem;">${item.nama_barang}</span></div>`;

        const dnHtml = (item.no_surat_jalan && item.no_surat_jalan !== '-')
            ? `<div><strong style="color: #2563eb; font-size: 0.78rem;">${item.no_surat_jalan}</strong><br><span style="color: #64748b; font-size: 0.72rem;">${item.tgl_surat_jalan_label || item.tgl_surat_jalan}</span></div>`
            : '<span style="color: #94a3b8;">-</span>';

        html += `
            <tr>
                <td class="text-center font-mono" style="color: #64748b;">${startIdx + idx + 1}</td>
                <td class="text-center font-mono" style="font-size: 0.78rem;">${item.tgl_trans_label || item.tgl_trans}</td>
                <td><strong style="color: #8b5cf6; font-size: 0.82rem;">${item.no_trans}</strong></td>
                <td style="max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${item.customer}">${custHtml}</td>
                <td style="max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${item.nama_barang}">${barangHtml}</td>
                <td class="text-right font-mono" style="font-weight: 600;">${Number(item.jml || 0).toLocaleString('id-ID')} <span style="font-size: 0.7rem; color: #64748b;">${item.satuan}</span></td>
                <td class="text-right font-mono" style="color: #16a34a; font-weight: 700;">${Number(item.terpenuhi || 0).toLocaleString('id-ID')}</td>
                <td class="text-right font-mono" style="color: ${item.sisa > 0 ? '#dc2626' : '#64748b'};">${Number(item.sisa || 0).toLocaleString('id-ID')}</td>
                <td class="text-center font-mono" style="font-size: 0.75rem; color: #d97706;">${item.leadtime_label || item.leadtime}</td>
                <td class="text-center">${dnHtml}</td>
                <td class="text-center">${kirimBadge}</td>
                <td class="text-center">${orderBadge}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
    if (footerStats) {
        footerStats.textContent = `Menampilkan ${startIdx + 1} - ${endIdx} dari ${totalItems} Item Order PBF`;
    }
}

function renderPbfPagination(totalItems) {
    const pageInfo = document.getElementById('pbfPageInfo');
    const btnPrev = document.getElementById('btnPbfPrevPage');
    const btnNext = document.getElementById('btnPbfNextPage');

    const pageSize = state.pbfPageSize || 10;
    const totalPages = Math.ceil(totalItems / pageSize) || 1;
    const currentPage = state.pbfCurrentPage || 1;

    if (pageInfo) {
        pageInfo.textContent = getPaginationInfoText(currentPage, totalPages, totalItems, pageSize);
    }
    if (btnPrev) btnPrev.disabled = currentPage <= 1;
    if (btnNext) btnNext.disabled = currentPage >= totalPages;
}

function changePbfPage(delta) {
    state.pbfCurrentPage = (state.pbfCurrentPage || 1) + delta;
    if (state.pbfRawData) {
        renderPbfModalData(state.pbfRawData);
    }
}

function sortPbf(column) {
    if (!state.pbfSort) {
        state.pbfSort = { column: 'tgl_trans', dir: 'desc' };
    }
    if (state.pbfSort.column === column) {
        state.pbfSort.dir = state.pbfSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
        state.pbfSort.column = column;
        state.pbfSort.dir = ['jml', 'terpenuhi', 'sisa', 'tgl_trans', 'leadtime', 'tgl_surat_jalan'].includes(column) ? 'desc' : 'asc';
    }
    if (state.pbfRawData) {
        renderPbfModalData(state.pbfRawData);
    }
}


// ====================================================================
// MODUL HR - MONITORING KEHADIRAN KARYAWAN (ATENA ERP REST API)
// ====================================================================

function openHrModal(range = 'today') {
    const modal = document.getElementById('hrModal');
    if (!modal) return;

    modal.classList.add('active');
    state.hrSearchQuery = '';

    const searchInput = document.getElementById('hrSearchInput');
    if (searchInput) searchInput.value = '';

    setHrQuickDate(range);
}

function closeHrModal() {
    const modal = document.getElementById('hrModal');
    if (modal) modal.classList.remove('active');
}

function setHrQuickDate(preset = 'month') {
    state.currentHrRange = preset;

    const { startDate, endDate } = getActivePeriodDates(preset);
    state.hrDateStart = startDate;
    state.hrDateEnd = endDate;

    setDateInputValue('hrDateStart', startDate);
    setDateInputValue('hrDateEnd', endDate);

    const btnMonth = document.getElementById('btnQuickHrMonth');
    const btnWeek = document.getElementById('btnQuickHrWeek');
    const btnToday = document.getElementById('btnQuickHrToday');
    const btnAll = document.getElementById('btnQuickHrAll');

    if (btnMonth) btnMonth.classList.toggle('active', preset === 'month');
    if (btnWeek) btnWeek.classList.toggle('active', preset === 'week');
    if (btnToday) btnToday.classList.toggle('active', preset === 'today');
    if (btnAll) btnAll.classList.toggle('active', preset === 'all');

    state.hrCurrentPage = 1;
    loadHrData();
}

function handleHrDateChange(changedField) {
    const startInput = document.getElementById('hrDateStart');
    const endInput = document.getElementById('hrDateEnd');
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

    state.hrDateStart = start;
    state.hrDateEnd = end;
    state.currentHrRange = 'custom';

    const pills = document.querySelectorAll('.hr-range-pills .filter-pill');
    pills.forEach(p => p.classList.remove('active'));

    state.hrCurrentPage = 1;
    loadHrData();
}

function switchHrBagian(bagian) {
    if (state.currentHrBagian === bagian) return;
    state.currentHrBagian = bagian;

    const btnTk = document.getElementById('btnTabHrTkSna');
    const btnMkt = document.getElementById('btnTabHrMarketing');
    if (btnTk) btnTk.classList.toggle('active', bagian === 'tksna');
    if (btnMkt) btnMkt.classList.toggle('active', bagian === 'marketing');

    state.hrCurrentPage = 1;
    loadHrData();
}

function switchHrStatus(status) {
    state.currentHrStatus = status;
    const sel = document.getElementById('selectHrStatus');
    if (sel && sel.value !== status) sel.value = status;

    state.hrCurrentPage = 1;
    if (state.hrRawData) {
        renderHrModalData(state.hrRawData);
    }
}

function resetHrFilter() {
    state.hrSearchQuery = '';
    const searchInput = document.getElementById('hrSearchInput');
    if (searchInput) searchInput.value = '';

    const sel = document.getElementById('selectHrStatus');
    if (sel) sel.value = 'all';
    state.currentHrStatus = 'all';

    setHrQuickDate('month');
}

let hrSearchDebounce = null;
function handleHrSearch(query) {
    clearTimeout(hrSearchDebounce);
    hrSearchDebounce = setTimeout(() => {
        state.hrSearchQuery = (query || '').trim().toLowerCase();
        state.hrCurrentPage = 1;
        if (state.hrRawData) {
            renderHrModalData(state.hrRawData);
        }
    }, 200);
}

async function syncHrData() {
    const btnSync = document.getElementById('btnSyncHr');
    const icon = btnSync?.querySelector('i');
    if (icon) icon.classList.add('fa-spin');

    try {
        renderHrTableLoading();
        const result = await fetchJsonSafely('/api/dashboard/hr/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                bagian: state.currentHrBagian || 'tksna',
                tanggal_mulai: state.hrDateStart,
                tanggal_akhir: state.hrDateEnd
            })
        });
        if (!result.success) throw new Error(result.message || 'Gagal sinkronisasi data HR');

        const cacheKey = `${state.currentHrBagian}_${state.hrDateStart}_${state.hrDateEnd}`;
        if (!state.hrCache) state.hrCache = new Map();
        state.hrCache.set(cacheKey, { data: result.data, timestamp: Date.now() });

        state.hrRawData = result.data;
        renderHrModalData(result.data);
        showToast('Sinkronisasi Kehadiran Karyawan berhasil!', 'success');

        const syncEl = document.getElementById('hrLastSyncTime');
        if (syncEl) syncEl.textContent = `Sinkron: ${new Date().toLocaleTimeString('id-ID')}`;
    } catch (err) {
        console.error('Error sync HR:', err);
        renderHrTableError(err.message);
        showToast(`Sinkronisasi HR gagal: ${err.message}`, 'error');
    } finally {
        if (icon) icon.classList.remove('fa-spin');
    }
}

async function loadHrData(force = false) {
    const bagian = state.currentHrBagian || 'tksna';
    const start = state.hrDateStart;
    const end = state.hrDateEnd;
    const cacheKey = `${bagian}_${start}_${end}`;

    if (!state.hrCache) state.hrCache = new Map();
    const cached = state.hrCache.get(cacheKey);

    if (cached && !force) {
        state.hrRawData = cached.data;
        renderHrModalData(cached.data);
        if (Date.now() - cached.timestamp < 30000) return;
    } else {
        renderHrTableLoading();
    }

    try {
        const url = `/api/dashboard/hr?bagian=${encodeURIComponent(bagian)}&tanggal_mulai=${encodeURIComponent(start)}&tanggal_akhir=${encodeURIComponent(end)}`;
        const result = await fetchJsonSafely(url);
        if (!result.success) throw new Error(result.message || 'Gagal memuat data kehadiran');

        state.hrCache.set(cacheKey, { data: result.data, timestamp: Date.now() });
        state.hrRawData = result.data;
        renderHrModalData(result.data);

        const syncEl = document.getElementById('hrLastSyncTime');
        if (syncEl) syncEl.textContent = `Update: ${new Date().toLocaleTimeString('id-ID')}`;
    } catch (err) {
        console.error('Error memuat data HR:', err);
        renderHrTableError(err.message);
    }
}

function renderHrModalData(data) {
    if (!data) return;

    const kpi = data.kpi || {};
    const totalJadwal = kpi.total_jadwal || 0;
    const sesuai = kpi.sesuai || 0;
    const tidakSesuai = kpi.tidak_sesuai || 0;
    const totalKaryawan = kpi.total_karyawan || 0;

    const elTotalJadwal = document.getElementById('hrModalKpiTotalJadwal');
    const elSesuai = document.getElementById('hrModalKpiSesuai');
    const elTidakSesuai = document.getElementById('hrModalKpiTidakSesuai');
    const elTotalKaryawan = document.getElementById('hrModalKpiTotalKaryawan');

    if (elTotalJadwal) elTotalJadwal.textContent = totalJadwal.toLocaleString('id-ID');
    if (elSesuai) elSesuai.textContent = sesuai.toLocaleString('id-ID');
    if (elTidakSesuai) elTidakSesuai.textContent = tidakSesuai.toLocaleString('id-ID');
    if (elTotalKaryawan) elTotalKaryawan.textContent = totalKaryawan.toLocaleString('id-ID');

    const elPercent = document.getElementById('hrModalKpiPercent');
    if (elPercent) elPercent.textContent = `${kpi.persentase || 0}%`;

    // Update badge tab count
    const countTk = document.getElementById('countHrTkSna');
    const countMkt = document.getElementById('countHrMarketing');
    if (state.currentHrBagian === 'tksna' && countTk) {
        countTk.textContent = totalJadwal.toLocaleString('id-ID');
    } else if (state.currentHrBagian === 'marketing' && countMkt) {
        countMkt.textContent = totalJadwal.toLocaleString('id-ID');
    }

    // Filter items
    const rawItems = Array.isArray(data.items) ? data.items : [];
    const filterStatus = state.currentHrStatus || 'all';
    const q = state.hrSearchQuery;

    let filtered = rawItems.filter(item => {
        if (filterStatus === 'sesuai' && !item.is_sesuai) return false;
        if (filterStatus === 'tidak_sesuai' && item.is_sesuai) return false;
        if (filterStatus === 'alpha' && !item.is_alpha) return false;
        if (filterStatus === 'terlambat' && !item.terlambat) return false;
        if (filterStatus === 'beda_shift' && (item.is_sesuai || item.is_alpha || item.plan === 'OFF')) return false;

        if (q) {
            const matchNama = (item.nama_karyawan || '').toLowerCase().includes(q);
            const matchNkk = (item.nkk || '').toLowerCase().includes(q);
            const matchJabatan = (item.jabatan || '').toLowerCase().includes(q);
            const matchPlan = (item.plan || '').toLowerCase().includes(q);
            const matchAktual = (item.aktual || '').toLowerCase().includes(q);
            const matchAlasan = (item.alasan || '').toLowerCase().includes(q);
            const matchTgl = (item.tanggal || '').toLowerCase().includes(q);
            if (!matchNama && !matchNkk && !matchJabatan && !matchPlan && !matchAktual && !matchAlasan && !matchTgl) {
                return false;
            }
        }
        return true;
    });

    // Sorting
    const sort = state.hrSort || { column: 'tanggal', dir: 'desc' };
    filtered.sort((a, b) => {
        let valA = a[sort.column] ?? '';
        let valB = b[sort.column] ?? '';
        const cmp = typeof valA === 'number' ? valA - valB : String(valA).localeCompare(String(valB));
        return sort.dir === 'asc' ? cmp : -cmp;
    });

    renderHrTable(filtered);
    renderHrPagination(filtered.length);
}

function getShiftBadge(shiftStr, isPlan = false) {
    if (!shiftStr || shiftStr === '-' || shiftStr === '') {
        return '<span style="color: #94a3b8; font-weight: 500;">-</span>';
    }
    const s = String(shiftStr).trim().toUpperCase();
    if (s.startsWith('S1')) {
        const isLate = s.includes('.');
        return `<span class="badge-satuan" style="background: #e0e7ff; color: #4338ca; border: 1px solid #c7d2fe; font-weight: 700;">${s}${isLate ? ' • Telat' : ''}</span>`;
    }
    if (s.startsWith('S2')) {
        const isLate = s.includes('.');
        return `<span class="badge-satuan" style="background: #ede9fe; color: #6d28d9; border: 1px solid #ddd6fe; font-weight: 700;">${s}${isLate ? ' • Telat' : ''}</span>`;
    }
    if (s.startsWith('S3')) {
        const isLate = s.includes('.');
        return `<span class="badge-satuan" style="background: #fce7f3; color: #be185d; border: 1px solid #fbcfe8; font-weight: 700;">${s}${isLate ? ' • Telat' : ''}</span>`;
    }
    if (s === 'OFF' || s === 'LIBUR') {
        return `<span class="badge-satuan" style="background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; font-weight: 600;">LIBUR (OFF)</span>`;
    }
    if (s === 'A' || s === 'ALPHA') {
        return `<span class="badge-satuan" style="background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca; font-weight: 700;">ALPHA</span>`;
    }
    if (s === 'IK') {
        return `<span class="badge-satuan" style="background: #fef3c7; color: #92400e; border: 1px solid #fde68a; font-weight: 700;">IZIN (IK)</span>`;
    }
    if (s === 'C' || s === 'CUTI') {
        return `<span class="badge-satuan" style="background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; font-weight: 600;">CUTI</span>`;
    }
    if (s === 'S' || s === 'SAKIT') {
        return `<span class="badge-satuan" style="background: #ffedd5; color: #c2410c; border: 1px solid #fed7aa; font-weight: 600;">SAKIT</span>`;
    }
    return `<span class="badge-satuan" style="background: #f8fafc; color: #334155; border: 1px solid #e2e8f0;">${s}</span>`;
}

function renderHrTable(list) {
    const tbody = document.getElementById('hrTableBody');
    const footerStats = document.getElementById('hrModalFooterStats');
    if (!tbody) return;

    if (!list || list.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="11" class="subcon-empty-row">
                    <i class="fa-solid fa-user-check" style="font-size: 2rem; color: #cbd5e1;"></i>
                    <div style="margin-top: 8px;">Tidak ada data kehadiran yang sesuai dengan filter</div>
                </td>
            </tr>
        `;
        if (footerStats) footerStats.textContent = 'Menampilkan 0 Data Kehadiran';
        return;
    }

    const pageSize = state.hrPageSize || 10;
    const totalItems = list.length;
    const totalPages = Math.ceil(totalItems / pageSize) || 1;
    if (state.hrCurrentPage > totalPages) state.hrCurrentPage = totalPages;
    if (state.hrCurrentPage < 1) state.hrCurrentPage = 1;

    const startIdx = (state.hrCurrentPage - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, totalItems);
    const paged = list.slice(startIdx, endIdx);

    let html = '';
    paged.forEach((item, idx) => {
        const isSesuai = item.is_sesuai;
        const statusBadge = isSesuai
            ? '<span class="service-status-pill status-live"><i class="fa-solid fa-check"></i> SESUAI</span>'
            : '<span class="service-status-pill" style="color: #dc2626; background: #fee2e2; border: 1px solid #fecaca;"><i class="fa-solid fa-triangle-exclamation"></i> TIDAK SESUAI</span>';

        const planBadge = getShiftBadge(item.plan, true);
        const aktualBadge = getShiftBadge(item.aktual, false);

        let alasanColor = isSesuai ? '#16a34a' : '#d97706';
        if (item.is_alpha) alasanColor = '#dc2626';

        html += `
            <tr>
                <td class="text-center font-mono" style="color: #64748b;">${startIdx + idx + 1}</td>
                <td class="text-center font-mono" style="font-size: 0.82rem; font-weight: 600;">${item.tanggal_label || item.tanggal}</td>
                <td class="font-mono" style="font-size: 0.82rem; color: #0284c7; font-weight: 600;">${item.nkk || '-'}</td>
                <td><strong style="color: #0f172a;">${item.nama_karyawan}</strong></td>
                <td style="font-size: 0.8rem; color: #64748b;">${item.jabatan || '-'}</td>
                <td class="text-center">${planBadge}</td>
                <td class="text-center">${aktualBadge}</td>
                <td class="text-center font-mono" style="font-size: 0.8rem; color: ${item.jam_scan ? '#0f172a' : '#94a3b8'};">${item.jam_scan || '-'}</td>
                <td class="text-center font-mono" style="font-size: 0.8rem; color: #64748b;">${item.jenis_scan || '-'}</td>
                <td class="text-center">${statusBadge}</td>
                <td>
                    <span style="font-size: 0.8rem; color: ${alasanColor}; font-weight: 600;">
                        ${item.alasan || (isSesuai ? 'Hadir Sesuai Shift Plan' : 'Penyimpangan Jadwal')}
                    </span>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
    if (footerStats) {
        footerStats.textContent = `Menampilkan ${startIdx + 1} - ${endIdx} dari ${totalItems} Data Kehadiran (${state.currentHrBagian === 'tksna' ? 'TK SNA' : 'Marketing / Non-SNAM'})`;
    }
}

function renderHrPagination(totalItems) {
    const pageInfo = document.getElementById('hrPageInfo');
    const btnPrev = document.getElementById('btnPrevHrPage');
    const btnNext = document.getElementById('btnNextHrPage');

    const pageSize = state.hrPageSize || 10;
    const totalPages = Math.ceil(totalItems / pageSize) || 1;
    const currentPage = state.hrCurrentPage || 1;

    if (pageInfo) {
        pageInfo.textContent = getPaginationInfoText(currentPage, totalPages, totalItems, pageSize);
    }
    if (btnPrev) btnPrev.disabled = currentPage <= 1;
    if (btnNext) btnNext.disabled = currentPage >= totalPages;
}

function changeHrPage(delta) {
    state.hrCurrentPage = (state.hrCurrentPage || 1) + delta;
    if (state.hrRawData) {
        renderHrModalData(state.hrRawData);
    }
}

function sortHr(column) {
    if (!state.hrSort) {
        state.hrSort = { column: 'tanggal', dir: 'desc' };
    }
    if (state.hrSort.column === column) {
        state.hrSort.dir = state.hrSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
        state.hrSort.column = column;
        state.hrSort.dir = ['tanggal', 'nkk'].includes(column) ? 'desc' : 'asc';
    }
    if (state.hrRawData) {
        renderHrModalData(state.hrRawData);
    }
}

function renderHrTableLoading() {
    const tbody = document.getElementById('hrTableBody');
    if (!tbody) return;
    tbody.innerHTML = `
        <tr class="skeleton-row">
            <td colspan="11" class="text-center" style="padding: 30px;">
                <i class="fa-solid fa-spinner fa-spin" style="font-size: 1.5rem; color: #0284c7; margin-bottom: 8px;"></i>
                <div style="font-weight: 500; color: #64748b;">Mengambil data kehadiran karyawan dari Atena ERP...</div>
            </td>
        </tr>
    `;
}

function renderHrTableError(message) {
    const tbody = document.getElementById('hrTableBody');
    if (!tbody) return;
    tbody.innerHTML = `
        <tr>
            <td colspan="11" class="subcon-empty-row" style="padding: 25px;">
                <i class="fa-solid fa-triangle-exclamation" style="font-size: 2rem; color: #ef4444; margin-bottom: 8px;"></i>
                <div style="font-weight: 600; color: #b91c1c;">Gagal Memuat Data Kehadiran Karyawan</div>
                <div style="font-size: 0.8rem; color: #64748b; margin-top: 4px;">${message}</div>
            </td>
        </tr>
    `;
}


// ====================================================================
// 10. MODUL DEVELOPMENT (R&D PERMINTAAN BOM) - GOOGLE SPREADSHEET
// ====================================================================

function openDevModal(range = 'month') {
    const modal = document.getElementById('devModal');
    if (!modal) return;
    modal.classList.add('active');
    state.devSearchQuery = '';
    state.devJenis = 'all';
    state.devStatus = 'all';
    state.devCurrentPage = 1;
    state.devPageSize = 10;

    const searchInput = document.getElementById('devSearchInput');
    if (searchInput) searchInput.value = '';
    const selJenis = document.getElementById('selectDevJenis');
    if (selJenis) selJenis.value = 'all';
    const selStatus = document.getElementById('selectDevStatus');
    if (selStatus) selStatus.value = 'all';

    setDevQuickDate(range);
}

function closeDevModal() {
    const modal = document.getElementById('devModal');
    if (!modal) return;
    modal.classList.remove('active');
}

function setDevQuickDate(preset = 'month') {
    state.currentDevRange = preset;

    if (preset === 'all') {
        state.devDateStart = '';
        state.devDateEnd = '';
        setDateInputValue('devDateStart', '');
        setDateInputValue('devDateEnd', '');
    } else {
        const { startDate, endDate } = getActivePeriodDates(preset);
        state.devDateStart = startDate;
        state.devDateEnd = endDate;
        setDateInputValue('devDateStart', startDate);
        setDateInputValue('devDateEnd', endDate);
    }

    const btnMonth = document.getElementById('btnQuickDevMonth');
    const btnToday = document.getElementById('btnQuickDevToday');
    const btnAll = document.getElementById('btnQuickDevAll');

    if (btnMonth) btnMonth.classList.toggle('active', preset === 'month');
    if (btnToday) btnToday.classList.toggle('active', preset === 'today');
    if (btnAll) btnAll.classList.toggle('active', preset === 'all');

    state.devCurrentPage = 1;
    loadDevData();
}

function handleDevDateChange(changedField) {
    const startInput = document.getElementById('devDateStart');
    const endInput = document.getElementById('devDateEnd');
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

    state.devDateStart = start;
    state.devDateEnd = end;
    state.currentDevRange = 'custom';

    const pills = document.querySelectorAll('.dev-range-pills .filter-pill');
    pills.forEach(p => p.classList.remove('active'));

    state.devCurrentPage = 1;
    loadDevData();
}

function resetDevFilter() {
    state.devSearchQuery = '';
    const searchInput = document.getElementById('devSearchInput');
    if (searchInput) searchInput.value = '';

    const selJenis = document.getElementById('selectDevJenis');
    if (selJenis) selJenis.value = 'all';
    state.devJenis = 'all';

    const selStatus = document.getElementById('selectDevStatus');
    if (selStatus) selStatus.value = 'all';
    state.devStatus = 'all';

    setDevQuickDate('month');
}

function switchDevJenis(jenis) {
    state.devJenis = jenis;
    state.devCurrentPage = 1;
    filterAndRenderDevTable();
}

function switchDevStatus(status) {
    state.devStatus = status;
    state.devCurrentPage = 1;
    filterAndRenderDevTable();
}

function handleDevSearch(val) {
    state.devSearchQuery = val ? val.trim().toLowerCase() : '';
    state.devCurrentPage = 1;
    filterAndRenderDevTable();
}

async function loadDevData(force = false) {
    renderDevTableLoading();
    try {
        const range = state.currentDevRange || 'month';
        const bulan = state.selectedMonth || (new Date().getMonth() + 1);
        const tahun = state.selectedYear || new Date().getFullYear();
        const start = state.devDateStart || '';
        const end = state.devDateEnd || '';

        let url = `/api/dashboard/development?range=${range}&bulan=${bulan}&tahun=${tahun}`;
        if (range === 'custom' && start && end) {
            url += `&tglawal=${start}&tglakhir=${end}`;
        }
        if (force) url += '&force=true';

        const res = await fetch(url);
        const json = await res.json();

        if (!json || !json.success) {
            throw new Error(json?.message || 'Gagal memuat data Development');
        }

        state.devRawData = json.data;
        renderDevModalData(json.data);
    } catch (err) {
        console.error('Error loadDevData:', err);
        renderDevTableError(err.message);
    }
}

function renderDevModalData(data) {
    if (!data) return;
    const kpi = data.kpi || {};

    const elTotal = document.getElementById('devKpiTotal');
    const elSelesai = document.getElementById('devKpiSelesai');
    const elPercent = document.getElementById('devKpiPercent');
    const elProgress = document.getElementById('devKpiProgress');
    const elBlocked = document.getElementById('devKpiBlocked');

    if (elTotal) elTotal.textContent = Number(kpi.total || 0).toLocaleString('id-ID');
    if (elSelesai) elSelesai.textContent = Number(kpi.selesai || 0).toLocaleString('id-ID');
    if (elPercent) elPercent.textContent = (kpi.persentase || 0) + '%';
    if (elProgress) elProgress.textContent = Number(kpi.on_progress_count || 0).toLocaleString('id-ID');
    if (elBlocked) elBlocked.textContent = Number(kpi.blocked_count || 0).toLocaleString('id-ID');

    filterAndRenderDevTable();
}

function filterAndRenderDevTable() {
    if (!state.devRawData || !Array.isArray(state.devRawData.items)) return;
    let items = state.devRawData.items;

    // Filter jenis
    if (state.devJenis === 'baru') items = items.filter(it => it.is_baru);
    else if (state.devJenis === 'perubahan') items = items.filter(it => it.is_perubahan);

    // Filter status
    if (state.devStatus === 'complete') items = items.filter(it => it.is_selesai);
    else if (state.devStatus === 'progress') items = items.filter(it => it.is_on_progress);
    else if (state.devStatus === 'blocked') items = items.filter(it => it.is_blocked);

    // Filter search
    if (state.devSearchQuery) {
        const q = state.devSearchQuery;
        items = items.filter(it =>
            (it.kode_produk && it.kode_produk.toLowerCase().includes(q)) ||
            (it.nama_bom && it.nama_bom.toLowerCase().includes(q)) ||
            (it.kode_bom && it.kode_bom.toLowerCase().includes(q)) ||
            (it.detail_permintaan && it.detail_permintaan.toLowerCase().includes(q)) ||
            (it.pic_input && it.pic_input.toLowerCase().includes(q)) ||
            (it.tanggal_raw && it.tanggal_raw.toLowerCase().includes(q))
        );
    }

    renderDevTable(items);
}

function renderDevTable(items) {
    const tbody = document.getElementById('devTableBody');
    if (!tbody) return;

    if (!items || items.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="11" class="loading-state" style="padding: 25px; color: var(--text-muted); text-align: center;">
                    <i class="fa-solid fa-box-open" style="font-size: 1.5rem; margin-bottom: 8px; display: block; color: #0284c7;"></i>
                    Tidak ada data permintaan BOM yang sesuai filter.
                </td>
            </tr>
        `;
        renderDevPagination(0);
        return;
    }

    const pageSize = state.devPageSize || 10;
    const totalPages = Math.ceil(items.length / pageSize) || 1;
    if ((state.devCurrentPage || 1) > totalPages) state.devCurrentPage = totalPages;
    const page = state.devCurrentPage || 1;
    const startIdx = (page - 1) * pageSize;
    const pageItems = items.slice(startIdx, startIdx + pageSize);

    tbody.innerHTML = pageItems.map((r, idx) => {
        const isComplete = r.is_selesai;
        const isBlocked = r.is_blocked;
        const statusBadge = isComplete
            ? '<span class="badge-status badge-closed" style="background:#dcfce7;color:#15803d;font-weight:700;"><i class="fa-solid fa-circle-check"></i> Complete</span>'
            : isBlocked
                ? '<span class="badge-status" style="background:#fee2e2;color:#b91c1c;font-weight:700;"><i class="fa-solid fa-ban"></i> Blocked</span>'
                : '<span class="badge-status badge-process" style="background:#fef3c7;color:#b45309;font-weight:700;"><i class="fa-solid fa-hourglass-half"></i> On Progress</span>';

        const priorityBadge = r.is_urgent
            ? '<span class="badge-status" style="background:#fee2e2;color:#dc2626;font-weight:800;font-size:0.68rem;"><i class="fa-solid fa-fire"></i> URGENT</span>'
            : '<span style="color:#64748b;font-size:0.75rem;">Normal</span>';

        const jenisBadge = r.is_baru
            ? '<span style="font-size:0.75rem;font-weight:700;color:#0284c7;background:#e0f2fe;padding:2px 6px;border-radius:4px;">BARU</span>'
            : '<span style="font-size:0.75rem;font-weight:700;color:#9333ea;background:#f3e8ff;padding:2px 6px;border-radius:4px;">PERUBAHAN</span>';

        const lamaProsesStr = r.lama_proses_hari !== null
            ? `<b style="color:${r.lama_proses_hari <= 2 ? '#16a34a' : '#dc2626'};">${r.lama_proses_hari} Hari</b>`
            : '<span style="color:#94a3b8;">-</span>';

        return `
            <tr>
                <td class="text-center" style="font-weight:600;color:var(--text-secondary);">${startIdx + idx + 1}</td>
                <td class="text-center" style="font-weight:600;white-space:nowrap;">${escapeHtml(r.tanggal_raw || '-')}</td>
                <td><span class="ticket-number">${escapeHtml(r.kode_produk || '-')}</span></td>
                <td class="text-center">${priorityBadge}</td>
                <td class="text-center">${jenisBadge}</td>
                <td style="font-weight:600;color:var(--text-primary);max-width:220px;">${escapeHtml(r.nama_bom || '-')}</td>
                <td><code style="font-size:0.75rem;background:#f1f5f9;padding:2px 5px;border-radius:4px;">${escapeHtml(r.kode_bom || '-')}</code></td>
                <td style="font-size:0.75rem;color:var(--text-secondary);max-width:260px;">${escapeHtml(r.detail_permintaan || r.detail_perubahan || '-')}</td>
                <td style="font-weight:600;color:#0284c7;">${escapeHtml(r.pic_input || '-')}</td>
                <td class="text-center">${statusBadge}</td>
                <td class="text-center" style="font-size:0.75rem;">${lamaProsesStr}</td>
            </tr>
        `;
    }).join('');

    state.devFilteredCount = items.length;
    renderDevPagination(items.length);
}

function renderDevPagination(totalItems) {
    const pageInfo = document.getElementById('devPageInfo');
    const btnPrev = document.getElementById('btnDevPrevPage');
    const btnNext = document.getElementById('btnDevNextPage');
    if (!pageInfo && !btnPrev && !btnNext) return;

    const pageSize = state.devPageSize || 10;
    const totalPages = Math.ceil(totalItems / pageSize) || 1;
    const currentPage = state.devCurrentPage || 1;

    if (pageInfo) {
        pageInfo.textContent = getPaginationInfoText(currentPage, totalPages, totalItems, pageSize);
    }
    if (btnPrev) btnPrev.disabled = currentPage <= 1;
    if (btnNext) btnNext.disabled = currentPage >= totalPages;
}

function changeDevPage(delta) {
    const totalItems = state.devFilteredCount !== undefined ? state.devFilteredCount : (state.devRawData?.items || []).length;
    const totalPages = Math.max(1, Math.ceil(totalItems / (state.devPageSize || 10)));
    const targetPage = (state.devCurrentPage || 1) + delta;
    if (targetPage >= 1 && targetPage <= totalPages) {
        state.devCurrentPage = targetPage;
        filterAndRenderDevTable();
    }
}

async function syncDevData() {
    const btn = document.getElementById('btnSyncDev');
    if (btn) btn.classList.add('rotating');
    try {
        await loadDevData(true);
        const syncEl = document.getElementById('devLastSyncTime');
        if (syncEl) syncEl.textContent = `Sinkron: ${new Date().toLocaleTimeString('id-ID')}`;
        showToast('Data Development berhasil disinkronkan dari Google Spreadsheet', 'success');
    } catch (err) {
        showToast('Gagal sinkronisasi data Development: ' + err.message, 'error');
    } finally {
        if (btn) btn.classList.remove('rotating');
    }
}

function renderDevTableLoading() {
    const tbody = document.getElementById('devTableBody');
    if (!tbody) return;
    tbody.innerHTML = `
        <tr class="skeleton-row">
            <td colspan="11" class="text-center" style="padding: 30px;">
                <i class="fa-solid fa-spinner fa-spin" style="font-size: 1.5rem; color: #0284c7; margin-bottom: 8px;"></i>
                <div style="font-weight: 500; color: #64748b;">Mengambil data Permintaan BOM dari Google Spreadsheet...</div>
            </td>
        </tr>
    `;
}

function renderDevTableError(message) {
    const tbody = document.getElementById('devTableBody');
    if (!tbody) return;
    tbody.innerHTML = `
        <tr>
            <td colspan="11" class="subcon-empty-row" style="padding: 25px;">
                <i class="fa-solid fa-triangle-exclamation" style="font-size: 2rem; color: #ef4444; margin-bottom: 8px;"></i>
                <div style="font-weight: 600; color: #b91c1c;">Gagal Memuat Data Development</div>
                <div style="font-size: 0.8rem; color: #64748b; margin-top: 4px;">${message}</div>
            </td>
        </tr>
    `;
}


// ====================================================================
// 11. MODUL DOCUMENT CONTROL (DC) - REST API PAPERLESS
// ====================================================================

function openDcModal(range = 'month') {
    const modal = document.getElementById('dcModal');
    if (!modal) return;
    modal.classList.add('active');

    state.dcSearchQuery = '';
    state.dcStatus = 'all';
    state.dcJenis = 'all';
    state.dcCurrentPage = 1;
    state.dcPageSize = 10;

    const searchInput = document.getElementById('dcSearchInput');
    if (searchInput) searchInput.value = '';
    const selStatus = document.getElementById('selectDcStatus');
    if (selStatus) selStatus.value = 'all';
    const selJenis = document.getElementById('selectDcJenis');
    if (selJenis) selJenis.value = 'all';

    setDcQuickDate(range);
}

function closeDcModal() {
    const modal = document.getElementById('dcModal');
    if (!modal) return;
    modal.classList.remove('active');
}

function setDcQuickDate(preset = 'month') {
    state.currentDcRange = preset;
    state.dcCurrentPage = 1;

    const { startDate, endDate } = getActivePeriodDates(preset);
    state.dcDateStart = startDate;
    state.dcDateEnd = endDate;

    setDateInputValue('dcDateStart', startDate);
    setDateInputValue('dcDateEnd', endDate);

    const btnMonth = document.getElementById('btnQuickDcMonth');
    const btnToday = document.getElementById('btnQuickDcToday');
    const btnAll = document.getElementById('btnQuickDcAll');

    if (btnMonth) btnMonth.classList.toggle('active', preset === 'month');
    if (btnToday) btnToday.classList.toggle('active', preset === 'today');
    if (btnAll) btnAll.classList.toggle('active', preset === 'all');

    loadDcData();
}

function handleDcDateChange(changedField) {
    const startInput = document.getElementById('dcDateStart');
    const endInput = document.getElementById('dcDateEnd');
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

    state.dcDateStart = start;
    state.dcDateEnd = end;
    state.currentDcRange = 'custom';

    const pills = document.querySelectorAll('.dc-range-pills .filter-pill');
    pills.forEach(p => p.classList.remove('active'));

    state.dcCurrentPage = 1;
    loadDcData();
}

function resetDcFilter() {
    state.dcSearchQuery = '';
    const searchInput = document.getElementById('dcSearchInput');
    if (searchInput) searchInput.value = '';

    const selStatus = document.getElementById('selectDcStatus');
    if (selStatus) selStatus.value = 'all';
    state.dcStatus = 'all';

    const selJenis = document.getElementById('selectDcJenis');
    if (selJenis) selJenis.value = 'all';
    state.dcJenis = 'all';

    setDcQuickDate('month');
}

function switchDcStatus(status) {
    state.dcStatus = status;
    state.dcCurrentPage = 1;
    filterAndRenderDcTable();
}

function switchDcJenis(jenis) {
    state.dcJenis = jenis;
    state.dcCurrentPage = 1;
    filterAndRenderDcTable();
}

function handleDcSearch(val) {
    state.dcSearchQuery = val ? val.trim().toLowerCase() : '';
    state.dcCurrentPage = 1;
    filterAndRenderDcTable();
}

async function loadDcData(force = false) {
    renderDcTableLoading();
    try {
        const range = state.currentDcRange || 'month';
        const bulan = state.selectedMonth || (new Date().getMonth() + 1);
        const tahun = state.selectedYear || new Date().getFullYear();
        const start = state.dcDateStart || '';
        const end = state.dcDateEnd || '';

        let url = `/api/dashboard/dc?range=${range}&bulan=${bulan}&tahun=${tahun}`;
        if (start && end) {
            url += `&tglawal=${start}&tglakhir=${end}`;
        }
        if (force) url += '&force=true';

        const res = await fetch(url);
        const json = await res.json();

        if (!json || !json.success) {
            throw new Error(json?.message || 'Gagal memuat data DC dari Paperless');
        }

        state.dcRawData = json.data;
        renderDcModalData(json.data);
    } catch (err) {
        console.error('Error loadDcData:', err);
        renderDcTableError(err.message);
    }
}

function renderDcModalData(data) {
    if (!data) return;
    const kpi = data.kpi || {};

    const elTotal = document.getElementById('dcKpiTotal');
    const elSelesai = document.getElementById('dcKpiSelesai');
    const elPercent = document.getElementById('dcKpiPercent');
    const elProgress = document.getElementById('dcKpiProgress');

    if (elTotal) elTotal.textContent = Number(kpi.total || 0).toLocaleString('id-ID');
    if (elSelesai) elSelesai.textContent = Number(kpi.selesai || 0).toLocaleString('id-ID');
    if (elPercent) elPercent.textContent = (kpi.persentase || 0) + '%';
    if (elProgress) elProgress.textContent = Number(kpi.belum || 0).toLocaleString('id-ID');

    filterAndRenderDcTable();
}

function filterAndRenderDcTable() {
    if (!state.dcRawData || !Array.isArray(state.dcRawData.items)) return;
    let items = state.dcRawData.items;

    // Filter status
    if (state.dcStatus && state.dcStatus !== 'all') {
        if (state.dcStatus === 'selesai') {
            items = items.filter(it => it.is_selesai || it.status === 'SELESAI');
        } else if (state.dcStatus === 'belum') {
            items = items.filter(it => !it.is_selesai && it.status !== 'SELESAI');
        }
    }

    // Filter jenis dokumen
    if (state.dcJenis && state.dcJenis !== 'all') {
        const j = state.dcJenis.toLowerCase();
        items = items.filter(it => (it.jenis_dokumen || '').toLowerCase().includes(j));
    }

    // Filter search
    if (state.dcSearchQuery) {
        const q = state.dcSearchQuery;
        items = items.filter(it =>
            (it.nama_dokumen && it.nama_dokumen.toLowerCase().includes(q)) ||
            (it.nomor_klausul && it.nomor_klausul.toLowerCase().includes(q)) ||
            (it.bagian && it.bagian.toLowerCase().includes(q)) ||
            (it.tahap && it.tahap.toLowerCase().includes(q)) ||
            (it.jenis_dokumen && it.jenis_dokumen.toLowerCase().includes(q)) ||
            (it.tgl_permohonan && it.tgl_permohonan.toLowerCase().includes(q))
        );
    }

    renderDcTable(items);
}

function renderDcTable(items) {
    const tbody = document.getElementById('dcTableBody');
    if (!tbody) return;

    if (!items || items.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="loading-state" style="padding: 25px; color: var(--text-muted); text-align: center;">
                    <i class="fa-solid fa-file-signature" style="font-size: 1.5rem; margin-bottom: 8px; display: block; color: #9333ea;"></i>
                    Tidak ada data pengerjaan dokumen yang sesuai filter.
                </td>
            </tr>
        `;
        renderDcPagination(0);
        return;
    }

    const pageSize = state.dcPageSize || 10;
    const totalPages = Math.ceil(items.length / pageSize) || 1;
    if ((state.dcCurrentPage || 1) > totalPages) state.dcCurrentPage = totalPages;
    const page = state.dcCurrentPage || 1;
    const startIdx = (page - 1) * pageSize;
    const pageItems = items.slice(startIdx, startIdx + pageSize);

    tbody.innerHTML = pageItems.map((r, idx) => {
        const isSelesai = r.is_selesai || r.status === 'SELESAI';
        const statusBadge = isSelesai
            ? '<span class="badge-status badge-closed" style="background:#dcfce7;color:#15803d;font-weight:700;"><i class="fa-solid fa-stamp"></i> Selesai</span>'
            : '<span class="badge-status badge-process" style="background:#fef3c7;color:#b45309;font-weight:700;"><i class="fa-solid fa-hourglass-half"></i> Belum Selesai</span>';

        return `
            <tr>
                <td class="text-center" style="font-weight:600;color:var(--text-secondary);">${startIdx + idx + 1}</td>
                <td class="text-center" style="font-weight:600;white-space:nowrap;">${escapeHtml(r.tgl_permohonan || '-')}</td>
                <td><span style="font-weight:700;color:#0284c7;background:#e0f2fe;padding:2px 8px;border-radius:4px;font-size:0.75rem;">${escapeHtml(r.bagian || '-')}</span></td>
                <td><span style="font-weight:600;color:#7e22ce;font-size:0.78rem;">${escapeHtml(r.jenis_dokumen || '-')}</span></td>
                <td><code style="font-size:0.75rem;background:#f1f5f9;padding:2px 6px;border-radius:4px;font-weight:600;">${escapeHtml(r.nomor_klausul || '-')}</code></td>
                <td style="font-weight:600;color:var(--text-primary);max-width:240px;">${escapeHtml(r.nama_dokumen || '-')}</td>
                <td class="text-center" style="font-weight:600;color:#64748b;">${escapeHtml(String(r.nomor_revisi ?? '-'))}</td>
                <td style="font-size:0.78rem;color:var(--text-secondary);max-width:240px;">${escapeHtml(r.tahap || '-')}</td>
                <td class="text-center">${statusBadge}</td>
            </tr>
        `;
    }).join('');

    state.dcFilteredCount = items.length;
    const footerStats = document.getElementById('dcModalFooterStats');
    if (footerStats) {
        footerStats.textContent = `Menampilkan ${startIdx + 1} - ${Math.min(startIdx + pageSize, items.length)} dari ${items.length.toLocaleString('id-ID')} Dokumen Paperless (snam.ddns.net:8069)`;
    }
    renderDcPagination(items.length);
}

function renderDcPagination(totalItems) {
    const pageInfo = document.getElementById('dcPageInfo');
    const btnPrev = document.getElementById('btnDcPrevPage');
    const btnNext = document.getElementById('btnDcNextPage');
    if (!pageInfo && !btnPrev && !btnNext) return;

    const pageSize = state.dcPageSize || 10;
    const totalPages = Math.ceil(totalItems / pageSize) || 1;
    const currentPage = state.dcCurrentPage || 1;

    if (pageInfo) {
        pageInfo.textContent = getPaginationInfoText(currentPage, totalPages, totalItems, pageSize);
    }
    if (btnPrev) btnPrev.disabled = currentPage <= 1;
    if (btnNext) btnNext.disabled = currentPage >= totalPages;
}

function changeDcPage(delta) {
    const totalItems = state.dcFilteredCount !== undefined ? state.dcFilteredCount : (state.dcRawData?.items || []).length;
    const totalPages = Math.max(1, Math.ceil(totalItems / (state.dcPageSize || 10)));
    const targetPage = (state.dcCurrentPage || 1) + delta;
    if (targetPage >= 1 && targetPage <= totalPages) {
        state.dcCurrentPage = targetPage;
        filterAndRenderDcTable();
    }
}

async function syncDcData() {
    const btn = document.getElementById('btnSyncDc');
    if (btn) btn.classList.add('rotating');
    try {
        await loadDcData(true);
        const syncEl = document.getElementById('dcLastSyncTime');
        if (syncEl) syncEl.textContent = `Sinkron: ${new Date().toLocaleTimeString('id-ID')}`;
        showToast('Data Document Control berhasil disinkronkan dari REST API Paperless', 'success');
    } catch (err) {
        showToast('Gagal sinkronisasi data DC: ' + err.message, 'error');
    } finally {
        if (btn) btn.classList.remove('rotating');
    }
}

function renderDcTableLoading() {
    const tbody = document.getElementById('dcTableBody');
    if (!tbody) return;
    tbody.innerHTML = `
        <tr class="skeleton-row">
            <td colspan="9" class="text-center" style="padding: 30px;">
                <i class="fa-solid fa-spinner fa-spin" style="font-size: 1.5rem; color: #9333ea; margin-bottom: 8px;"></i>
                <div style="font-weight: 500; color: #64748b;">Mengambil data Pengerjaan Dokumen dari REST API Paperless...</div>
            </td>
        </tr>
    `;
}

function renderDcTableError(message) {
    const tbody = document.getElementById('dcTableBody');
    if (!tbody) return;
    tbody.innerHTML = `
        <tr>
            <td colspan="9" class="subcon-empty-row" style="padding: 25px;">
                <i class="fa-solid fa-triangle-exclamation" style="font-size: 2rem; color: #ef4444; margin-bottom: 8px;"></i>
                <div style="font-weight: 600; color: #b91c1c;">Gagal Memuat Data Document Control (Paperless)</div>
                <div style="font-size: 0.8rem; color: #64748b; margin-top: 4px;">${message}</div>
            </td>
        </tr>
    `;
}
