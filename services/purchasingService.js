/**
 * ====================================================================
 * SERVICE: PURCHASING API CLIENT (ATENA ERP)
 * ====================================================================
 * Bertanggung jawab untuk komunikasi ke Atena ERP Laporan PR:
 * - Mengambil data laporan HTML pemenuhan Purchase Request (Material & Non-Material)
 * - Melakukan parsing HTML tabel menjadi data terstruktur JSON
 * - Agregasi KPI (Total PR, PR Terpenuhi, PR Pending, Material vs Non-Material)
 * - Caching in-memory + fallback persistensi lokal (JSON) agar dashboard
 *   tetap aktif & cepat meskipun sesi Atena kedaluwarsa atau server offline.
 * ====================================================================
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config/app.config');

// Path cache persistensi lokal
const CACHE_DIR = path.join(__dirname, '..', 'data');
const PERSISTENT_CACHE_FILE = path.join(CACHE_DIR, 'purchasing_cache.json');

// Pastikan folder data/ ada
if (!fs.existsSync(CACHE_DIR)) {
    try {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    } catch {
        // ignore
    }
}

// In-memory cache
const cache = {
    summary: { data: null, timestamp: 0 },
    rawItems: null,
    lastFetchedAt: null,
    isSyncing: false,
};

const CACHE_TTL_MS = 60 * 1000; // 60 detik in-memory TTL

/**
 * Helper membersihkan string dan parsing angka desimal
 */
function parseNumber(str) {
    if (!str) return 0;
    const clean = String(str).replace(/,/g, '').trim();
    const num = parseFloat(clean);
    return isNaN(num) ? 0 : num;
}

/**
 * Format Date ke string YYYY-MM-DD
 */
function formatDate(date) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Format tanggal ke label singkat Indonesia (misal: "15 Okt 2026")
 */
function formatShortDate(dateStr) {
    try {
        const parts = String(dateStr).split('-');
        if (parts.length === 3) {
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
            const year = parts[0];
            const monthIdx = parseInt(parts[1], 10) - 1;
            const day = parts[2];
            return `${day} ${months[monthIdx] || ''} ${year}`;
        }
    } catch {
        // fallback
    }
    return dateStr;
}

/**
 * Parse string HTML Laporan PR Atena ERP menjadi array JSON objects
 */
function parseAtenaPrHtml(html) {
    if (!html || typeof html !== 'string') return [];

    const items = [];
    const trRegex = /<tr\s*[^>]*>([\s\S]*?)<\/tr>/gi;
    let match;

    while ((match = trRegex.exec(html)) !== null) {
        const rowContent = match[1];
        // Lewati header baris tabel
        if (rowContent.includes('tabelket') || rowContent.includes('bgcolor=\'#6CAEF5\'') || rowContent.includes('bgcolor="#6CAEF5"')) {
            continue;
        }

        const tdRegex = /<td\s*[^>]*>([\s\S]*?)<\/td>/gi;
        let tdMatch;
        const cols = [];
        while ((tdMatch = tdRegex.exec(rowContent)) !== null) {
            cols.push(tdMatch[1].replace(/<[^>]+>/g, '').trim());
        }

        // Pastikan kolom lengkap (No, No.PR, Tgl, Kode, Nama, Satuan, Request, PO, GRS, OS)
        if (cols.length >= 10) {
            const no = parseInt(cols[0], 10) || (items.length + 1);
            const no_pr = cols[1];
            if (!no_pr || !no_pr.toUpperCase().startsWith('PR')) {
                continue;
            }

            const tanggal = cols[2];
            const kode_barang = cols[3];
            const nama_barang = cols[4];
            const satuan = cols[5];
            const qty_request = parseNumber(cols[6]);
            const qty_po = parseNumber(cols[7]);
            const qty_grs = parseNumber(cols[8]);
            const qty_os = parseNumber(cols[9]);

            // Tentukan status baris item
            // 1. Terpenuhi: jika sisa OS <= 0 dan request > 0
            // 2. Parsial: jika sudah ada GRS tapi OS masih > 0
            // 3. Proses PO: jika sudah PO tapi GRS masih 0
            // 4. Pending: belum ada PO dan belum ada GRS
            // Aturan Pemenuhan Sesuai Kebijakan Purchasing SNA Medika:
            // - PR Material: selama sudah ada yang di-PO atau sudah GRS -> Terpenuhi
            // - PR Non-Material: sudah di-PO atau sudah GRS -> Terpenuhi
            // - Belum ada PO dan belum ada GRS -> Pending
            let status = 'Pending (Belum PO)';
            let status_code = 'pending';
            const isItemFulfilled = (qty_po > 0) || (qty_grs > 0);

            if (qty_os <= 0 && qty_request > 0) {
                status = 'Terpenuhi (GRS Lengkap)';
                status_code = 'terpenuhi';
            } else if (isItemFulfilled) {
                status = qty_grs > 0 ? 'Terpenuhi (Parsial GRS)' : 'Terpenuhi (Sudah PO)';
                status_code = 'terpenuhi';
            } else {
                status = 'Pending (Belum PO)';
                status_code = 'pending';
            }

            // Jenis PR: PRNM = Non-Material, PR = Material
            const isNonMaterial = no_pr.toUpperCase().startsWith('PRNM');
            const jenis = isNonMaterial ? 'Non-Material' : 'Material';
            const jenis_code = isNonMaterial ? 'non_material' : 'material';

            // Hitung Persentase Pemenuhan Item berdasarkan Realisasi GRS dan Sisa OS (Outstanding)
            // Rumus: Realisasi GRS / (Realisasi GRS + Sisa OS) * 100%
            let progress_percent = 0;
            const totalGrsOs = qty_grs + qty_os;
            if (totalGrsOs > 0) {
                progress_percent = Math.min(100, Math.max(0, Number(((qty_grs / totalGrsOs) * 100).toFixed(1))));
            } else if (qty_grs > 0 && qty_os <= 0) {
                progress_percent = 100;
            }

            items.push({
                no,
                no_pr,
                jenis,
                jenis_code,
                tanggal,
                tanggal_label: formatShortDate(tanggal),
                kode_barang,
                nama_barang,
                satuan,
                qty_request,
                qty_po,
                qty_grs,
                qty_os,
                progress_percent,
                status,
                status_code,
            });
        }
    }

    return items;
}

/**
 * Agregasi item mentah menjadi rangkuman KPI & struktur per No. PR
 */
function aggregatePrData(items, meta = {}) {
    const prMap = new Map();
    let totalQtyRequest = 0;
    let totalQtyPo = 0;
    let totalQtyGrs = 0;
    let totalQtyOs = 0;

    let itemTerpenuhi = 0;
    let itemPending = 0;

    items.forEach(item => {
        totalQtyRequest += item.qty_request;
        totalQtyPo += item.qty_po;
        totalQtyGrs += item.qty_grs;
        totalQtyOs += item.qty_os;

        if (item.status_code === 'terpenuhi') itemTerpenuhi++;
        else itemPending++;

        if (!prMap.has(item.no_pr)) {
            prMap.set(item.no_pr, {
                no_pr: item.no_pr,
                tanggal: item.tanggal,
                tanggal_label: item.tanggal_label,
                jenis: item.jenis,
                jenis_code: item.jenis_code,
                items: [],
                total_request: 0,
                total_po: 0,
                total_grs: 0,
                total_os: 0,
                all_completed: true,
                has_grs: false,
                has_po: false,
            });
        }

        const pr = prMap.get(item.no_pr);
        pr.items.push(item);
        pr.total_request += item.qty_request;
        pr.total_po += item.qty_po;
        pr.total_grs += item.qty_grs;
        pr.total_os += item.qty_os;

        if (item.qty_os > 0) pr.all_completed = false;
        if (item.qty_grs > 0) pr.has_grs = true;
        if (item.qty_po > 0) pr.has_po = true;
    });

    // Kalkulasi status untuk setiap PR unik
    const prList = Array.from(prMap.values()).map(pr => {
        let prStatus = 'Pending (Belum PO)';
        let prStatusCode = 'pending';

        // Aturan Status Purchasing:
        // - Jika sudah ada PO atau sudah ada GRS -> Terpenuhi (Sudah PO / GRS)
        // - Belum ada PO dan belum ada GRS -> Pending (Belum PO)
        const isPrFulfilled = (pr.total_po > 0) || (pr.total_grs > 0);

        if (isPrFulfilled) {
            prStatusCode = 'terpenuhi';
            if (pr.all_completed && pr.total_request > 0) {
                prStatus = 'Terpenuhi (Lunas)';
            } else if (pr.has_grs) {
                prStatus = 'Terpenuhi (GRS Parsial)';
            } else {
                prStatus = 'Terpenuhi (Sudah PO)';
            }
        } else {
            prStatus = 'Pending (Belum PO)';
            prStatusCode = 'pending';
        }

        return {
            no_pr: pr.no_pr,
            tanggal: pr.tanggal,
            tanggal_label: pr.tanggal_label,
            jenis: pr.jenis,
            jenis_code: pr.jenis_code,
            item_count: pr.items.length,
            total_request: pr.total_request,
            total_po: pr.total_po,
            total_grs: pr.total_grs,
            total_os: pr.total_os,
            status: prStatus,
            status_code: prStatusCode,
            items: pr.items,
        };
    });

    // Urutkan PR dari tanggal terbaru
    prList.sort((a, b) => (b.tanggal || '').localeCompare(a.tanggal || '') || b.no_pr.localeCompare(a.no_pr));

    const totalPr = prList.length;
    const prTerpenuhi = prList.filter(p => p.status_code === 'terpenuhi').length;
    const prPending = prList.filter(p => p.status_code === 'pending').length;
    const prBelum = prPending;

    const persentasePr = totalPr > 0 ? Number(((prTerpenuhi / totalPr) * 100).toFixed(1)) : 0;
    const persentaseItem = items.length > 0 ? Number(((itemTerpenuhi / items.length) * 100).toFixed(1)) : 0;

    // Breakdown Material vs Non-Material
    const matPrList = prList.filter(p => p.jenis_code === 'material');
    const nonMatPrList = prList.filter(p => p.jenis_code === 'non_material');

    const matCompleted = matPrList.filter(p => p.status_code === 'terpenuhi').length;
    const nonMatCompleted = nonMatPrList.filter(p => p.status_code === 'terpenuhi').length;

    return {
        meta: {
            ...meta,
            total_pr: totalPr,
            total_item: items.length,
            generated_at: new Date().toISOString(),
        },
        kpi: {
            // Berbasis Unique PR
            total_pr: totalPr,
            pr_terpenuhi: prTerpenuhi,
            pr_pending: prPending,
            pr_belum: prBelum,
            persentase_selesai: persentasePr,
            pr_lunas_grs: prList.filter(p => p.all_completed && p.total_request > 0).length,
            pr_proses_po: prList.filter(p => p.has_po && !p.has_grs).length,
            pr_parsial_grs: prList.filter(p => p.has_grs && !p.all_completed).length,

            // Berbasis Baris Item
            total_item: items.length,
            item_terpenuhi: itemTerpenuhi,
            item_pending: itemPending,
            item_belum: itemPending,
            persentase_item: persentaseItem,

            // Material
            material: {
                total_pr: matPrList.length,
                pr_terpenuhi: matCompleted,
                pr_belum: matPrList.length - matCompleted,
                persentase: matPrList.length > 0 ? Number(((matCompleted / matPrList.length) * 100).toFixed(1)) : 0,
                total_item: items.filter(i => i.jenis_code === 'material').length,
            },

            // Non-Material
            non_material: {
                total_pr: nonMatPrList.length,
                pr_terpenuhi: nonMatCompleted,
                pr_belum: nonMatPrList.length - nonMatCompleted,
                persentase: nonMatPrList.length > 0 ? Number(((nonMatCompleted / nonMatPrList.length) * 100).toFixed(1)) : 0,
                total_item: items.filter(i => i.jenis_code === 'non_material').length,
            },

            // Qty Agregat
            total_qty_request: totalQtyRequest,
            total_qty_po: totalQtyPo,
            total_qty_grs: totalQtyGrs,
            total_qty_os: totalQtyOs,
        },
        summary_by_pr: prList,
        items: items,
    };
}

/**
 * Muat fallback persistensi dari file disk jika ada
 */
function loadPersistentCache() {
    try {
        if (fs.existsSync(PERSISTENT_CACHE_FILE)) {
            const raw = fs.readFileSync(PERSISTENT_CACHE_FILE, 'utf8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed.items) && parsed.items.length > 0) {
                return parsed;
            }
        }
    } catch (err) {
        console.error('⚠️ [PURCHASING]: Gagal membaca cache file lokal:', err.message);
    }
    return null;
}

/**
 * Simpan data ke disk cache
 */
function savePersistentCache(data) {
    try {
        fs.writeFileSync(PERSISTENT_CACHE_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
        console.error('⚠️ [PURCHASING]: Gagal menyimpan cache ke file:', err.message);
    }
}

const purchasingService = {
    /**
     * Mengambil dan mem-parsing data dari Atena ERP atau cache
     */
    async fetchData(force = false, params = {}) {
        const now = Date.now();

        // 1. Cek in-memory cache jika masih fresh
        if (!force && cache.rawItems && (now - cache.summary.timestamp < CACHE_TTL_MS)) {
            return aggregatePrData(cache.rawItems, { source: 'in-memory-cache', cached: true });
        }

        // 2. Coba fetch langsung dari Atena ERP menggunakan CURL parameter
        const prUrl = config.purchasing?.url || 'https://erpsna.atena.id/Laporan/LaporanPembelian/LaporanPR/laporan?kode=LPRS1';
        const sessionCookie = config.purchasing?.sessionCookie || 'ci_session=dv26ne8pa0orpc1gqnfbs001bmic31fi';

        const tglAw = params.tgl_aw || '2025-10-01';
        const tglAk = params.tgl_ak || formatDate(new Date());

        const postBody = new URLSearchParams({
            txt_tgl_aw: tglAw,
            txt_tgl_ak: tglAk,
            kolom: 'mbarang.kodebarang',
            operatorstring: 'ADALAH',
            operatornumber: 'SAMA DENGAN',
            txt_nilai: '',
            txt_nilai_list_barang: '',
            _ck: '',
            excel: 'tidak',
            file_name: 'LaporanPurchaseRequest',
            data_filter: '[]',
            data_tampil: JSON.stringify([{ value: 'REGISTER', jenis: 'Register' }])
        }).toString();

        try {
            cache.isSyncing = true;
            const res = await axios.post(prUrl, postBody, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Cookie': sessionCookie.includes('=') ? sessionCookie : `ci_session=${sessionCookie}`,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
                    'Referer': 'https://erpsna.atena.id/Laporan/LaporanPembelian/LaporanPR?kode=LPRS1&kodeinduk=UYTR5&kodelaporan=IU781',
                    'Origin': 'https://erpsna.atena.id',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                },
                timeout: config.purchasing?.timeoutMs || 25000,
            });

            if (res.status === 200 && typeof res.data === 'string' && res.data.includes('Purchase Request')) {
                const parsedItems = parseAtenaPrHtml(res.data);
                if (parsedItems.length > 0) {
                    cache.rawItems = parsedItems;
                    cache.summary.timestamp = now;
                    cache.lastFetchedAt = new Date().toISOString();

                    const aggregated = aggregatePrData(parsedItems, {
                        source: 'atena-erp-live',
                        periode: { start: tglAw, end: tglAk },
                        cached: false,
                        sync_time: cache.lastFetchedAt
                    });

                    // Simpan ke disk cache sebagai backup
                    savePersistentCache(aggregated);

                    return aggregated;
                }
            }
        } catch (fetchError) {
            console.error('⚠️ [PURCHASING ATENA ERROR]:', fetchError.message);
        } finally {
            cache.isSyncing = false;
        }

        // 3. Fallback: jika fetch ke Atena gagal / sesi habis, pakai memory cache atau persistent disk cache
        if (cache.rawItems && cache.rawItems.length > 0) {
            return aggregatePrData(cache.rawItems, { source: 'in-memory-fallback', cached: true, warning: 'Gagal menghubungi server Atena, menggunakan memori terakhir' });
        }

        const diskCached = loadPersistentCache();
        if (diskCached && Array.isArray(diskCached.items)) {
            cache.rawItems = diskCached.items;
            cache.summary.timestamp = now;
            return {
                ...diskCached,
                meta: {
                    ...diskCached.meta,
                    source: 'disk-cache-fallback',
                    cached: true,
                    warning: 'Menggunakan data cadangan lokal Atena ERP'
                }
            };
        }

        // Jika benar-benar kosong, kembalikan objek kosong aman
        return aggregatePrData([], { source: 'empty', cached: false });
    },

    /**
     * Ringkasan KPI untuk kartu utama di dashboard
     */
    async getSummary(force = false) {
        const aggregated = await this.fetchData(force);
        return {
            success: true,
            kpi: aggregated.kpi,
            meta: aggregated.meta,
        };
    },

    /**
     * Mengambil data monitoring detail untuk modal frontend
     * Mendukung filter: range, jenis, status, search
     */
    async getMonitoringData(options = {}) {
        const {
            range = 'all', // 'today', 'week', 'month', 'all'
            jenis = 'all', // 'all', 'material', 'non_material'
            status = 'all', // 'all', 'terpenuhi', 'proses_po', 'parsial', 'pending'
            search = '',
            force = false,
        } = options;

        const data = await this.fetchData(force);
        let items = data.items || [];
        const todayStr = formatDate(new Date());

        // 1. Filter Rentang Tanggal
        if (range === 'today') {
            items = items.filter(i => i.tanggal === todayStr);
        } else if (range === 'week') {
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            const minDate = formatDate(sevenDaysAgo);
            items = items.filter(i => i.tanggal >= minDate);
        } else if (range === 'month') {
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            const minDate = formatDate(thirtyDaysAgo);
            items = items.filter(i => i.tanggal >= minDate);
        }

        // 2. Filter Jenis (Material vs Non-Material)
        if (jenis && jenis !== 'all') {
            items = items.filter(i => i.jenis_code === jenis.toLowerCase());
        }

        // 3. Filter Status Pemenuhan
        if (status && status !== 'all') {
            if (status === 'belum_terpenuhi') {
                items = items.filter(i => i.status_code !== 'terpenuhi');
            } else {
                items = items.filter(i => i.status_code === status.toLowerCase());
            }
        }

        // 4. Pencarian kata kunci (No PR, Kode Barang, Nama Barang)
        if (search && search.trim() !== '') {
            const q = search.trim().toLowerCase();
            items = items.filter(i =>
                (i.no_pr && i.no_pr.toLowerCase().includes(q)) ||
                (i.kode_barang && i.kode_barang.toLowerCase().includes(q)) ||
                (i.nama_barang && i.nama_barang.toLowerCase().includes(q))
            );
        }

        // Susun ulang agregasi dengan subset item terfilter
        const filteredAgg = aggregatePrData(items, {
            ...data.meta,
            active_filters: { range, jenis, status, search },
            filtered_count: items.length,
        });

        return filteredAgg;
    },

    /**
     * Pengecekan koneksi ke Atena ERP
     */
    async ping() {
        try {
            const prUrl = config.purchasing?.url || 'https://erpsna.atena.id/Laporan/LaporanPembelian/LaporanPR/laporan?kode=LPRS1';
            const sessionCookie = config.purchasing?.sessionCookie || 'ci_session=dv26ne8pa0orpc1gqnfbs001bmic31fi';

            const postBody = new URLSearchParams({
                txt_tgl_aw: '2026-10-01',
                txt_tgl_ak: '2026-10-15',
                kolom: 'mbarang.kodebarang',
                operatorstring: 'ADALAH',
                operatornumber: 'SAMA DENGAN',
                txt_nilai: '',
                txt_nilai_list_barang: '',
                _ck: '',
                excel: 'tidak',
                file_name: 'LaporanPurchaseRequest',
                data_filter: '[]',
                data_tampil: JSON.stringify([{ value: 'REGISTER', jenis: 'Register' }])
            }).toString();

            const testRes = await axios.post(prUrl, postBody, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Cookie': sessionCookie.includes('=') ? sessionCookie : `ci_session=${sessionCookie}`,
                    'User-Agent': 'Mozilla/5.0'
                },
                timeout: 8000
            });

            const isOk = testRes.status === 200 && typeof testRes.data === 'string' && testRes.data.includes('Purchase Request');
            return {
                status: isOk ? 'online' : 'degraded',
                system: 'Atena ERP PR Service'
            };
        } catch (err) {
            return {
                status: 'offline',
                system: 'Atena ERP PR Service',
                error: err.message
            };
        }
    }
};

module.exports = purchasingService;
