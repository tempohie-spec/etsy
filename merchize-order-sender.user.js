// ==UserScript==
// @name         Google Sheets - Gui don len Merchize
// @namespace    gsheet-merchize-order-sender
// @version      1.41
// @description  Doc don hang tren trang tinh Google Sheets dang mo, tu tra Merchize SKU theo loai ao + mau + size (tu catalog Merchize), gop cac dong cung orderNumber thanh 1 don roi gui len Merchize qua API /order/external/orders. Ghi ket qua vao cot AB (Merchize SKU), AC (Trang thai), AD (Ma don Merchize).
// @match        https://docs.google.com/spreadsheets/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @grant        GM_registerMenuCommand
// @connect      merchize.com
// @connect      workers.dev
// @connect      merchize.store
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ====== CAU HINH ======
  const SCRIPT_VERSION = '1.41';
  // Gui don / dien cost chi doc 100 dong cuoi cua tab (nhanh hon voi tab dai).
  const SO_DONG_CUOI = 100;
  // Moi tab account = 1 store Merchize rieng (Base URL + Access Token rieng), luu theo TEN TAB.
  // Base URL mac dinh goi y khi tab chua cai dat (store dau tien).
  const BASE_URL_GOI_Y = 'https://bo-group-1-2.merchize.com/zoi24ff/bo-api';

  // Dung chung OAuth Client ID voi script "Import Cost/Earnings" (da khai bao san
  // https://docs.google.com trong Authorized JavaScript origins).
  const OAUTH_CLIENT_ID = '221078626866-ts9mr9ff2pr6a2einfr9r47bp0catmmd.apps.googleusercontent.com';
  const OAUTH_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

  // Vi tri cot (0-based) - khop voi HEADERS cua etsy-order-earnings.user.js.
  const COL = {
    printingMethod: 0, // A
    account: 1,        // B
    orderNumber: 2,    // C
    mockUpFront: 3,    // D
    designFront: 5,    // F
    designBack: 6,     // G
    title: 7,          // H
    color: 8,          // I
    size: 9,           // J
    quantity: 10,      // K
    name: 13,          // N
    address1: 14,      // O
    address2: 15,      // P
    city: 16,          // Q
    state: 17,         // R
    postalCode: 18,    // S
    country: 19,       // T
    phone: 20,         // U
    email: 21,         // V
    dateFulfill: 22,   // W (dd/mm/yyyy)
    baseCost: 24,      // Y
    merchizeSku: 27,   // AB
    status: 28,        // AC
    merchizeId: 29,    // AD
    tracking: 30,      // AE
    carrier: 31,       // AF
    ticket: 32         // AG
  };
  const OUTPUT_HEADERS = ['Merchize SKU', 'Trạng thái Merchize', 'Mã đơn Merchize'];
  
  // Bac gia goc Merchize dang ap dung cho store (tier1 = 0-999 don, tier2 = 1000-2999, tier3 = >3000).
  const TIER = 'tier1';
  // Thue nhap khau (Import Duty) tu 26/06/2026: 3.5$ MOI KIEN HANG (moi don) ship tu kho US
  // cua Merchize toi 50 nuoc/vung lanh tho chau Au duoi day.
  const THUE_NHAP_KHAU_CHAU_AU = 3.5;
  const NUOC_THUE_CHAU_AU = new Set(['AL', 'AD', 'AM', 'AT', 'AZ', 'BY', 'BE', 'BA', 'BG', 'HR', 'CY', 'CZ',
    'DK', 'EE', 'FI', 'FR', 'GE', 'DE', 'GR', 'HU', 'IS', 'IE', 'IT', 'KZ', 'XK', 'LV', 'LI', 'LT', 'LU',
    'MT', 'MD', 'MC', 'ME', 'NL', 'MK', 'NO', 'PL', 'PT', 'RO', 'SM', 'RS', 'SK', 'SI', 'ES', 'SE', 'CH',
    'TR', 'UA', 'VA']);
  // UK (GB) co trong thong bao cua Merchize nhung thuc te khong bi thu (da doi chieu 4 don UK) -> bo ra.
  // Phu phi in them mat sau (moi san pham co link designBack), tinh theo tung cai.
  const PHU_PHI_MAT_SAU = 4.5;

  const STATUS_SENT = 'Đã gửi';
  const STATUS_OLD = 'Cũ';
  const STATUS_ERROR_PREFIX = 'Lỗi: ';

  // Quy doi loai ao (cot title, viet kieu nao cung duoc: "Comfort-Adult Tee", "Comfort Adult",
  // "Comfort-AdultTee"...) sang ma san pham Merchize. Thu tu quan trong: toddler va
  // sweatshirt/hoodie phai xet truoc vi title cua chung cung co the chua chu "adult".
  // Sweatshirt/hoodie tre em chua co trong bang -> tra ve null de bao loi, khong gui nham size nguoi lon.
  // Loai ao them (nut "Thêm loại áo"): [{ tu: ["gildan", "youth"], ma: "<ma Merchize>" }]. Title chua
  // du cac tu khoa thi dung ma do; xet truoc cac luat co san.
  function docLoaiAoThem() {
    try { return JSON.parse(GM_getValue('mz_loai_ao_them', '[]')) || []; } catch (e) { return []; }
  }
  function luuLoaiAoThem(ds) {
    GM_setValue('mz_loai_ao_them', JSON.stringify(ds));
  }
  function cacMaSanPham() {
    return Array.from(new Set(MA_SAN_PHAM.concat(docLoaiAoThem().map((x) => x.ma))));
  }

  function xacDinhMaSanPham(title) {
    const t = String(title || '').toLowerCase().replace(/[^a-z]/g, '');
    const them = docLoaiAoThem().find((x) => x.tu.length && x.tu.every((w) => t.includes(w)));
    if (them) return them.ma;
    if (t.includes('toddler')) return '3321US';
    if (t.includes('sweatshirt') || t.includes('hoodie')) {
      if (t.includes('youth') || t.includes('kid')) return null;
      return t.includes('hoodie') ? '1850US' : '1800US';
    }
    if (t.includes('comfort') && t.includes('youth')) return '9018US';
    if (t.includes('comfort') && t.includes('adult')) return '1717US';
    if (t.includes('bella') && t.includes('youth')) return '301YUS';
    if (t.includes('bella') && t.includes('adult')) return '3001US';
    return null;
  }
  const MA_SAN_PHAM = ['3001US', '301YUS', '1717US', '1717AU', '9018US', '3321US', '1800US', '1850US'];

  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  // ============ HAM DUNG CHUNG ============
  function str(v) {
    return v === null || v === undefined ? '' : String(v).trim();
  }

  function chuanHoaMau(s) {
    return str(s).toLowerCase().replace(/\s+/g, ' ');
  }

  const BI_DANH_SIZE = { XXL: '2XL', XXXL: '3XL', XXXXL: '4XL', XXXXXL: '5XL' };
  function chuanHoaSize(s) {
    const v = str(s).toUpperCase().replace(/\s+/g, '');
    return BI_DANH_SIZE[v] || v;
  }

  function laLink(v) {
    return /^https?:\/\//i.test(str(v));
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ====== QUY DOI TEN QUOC GIA -> MA 2 CHU (Merchize can "US", Sheet dang ghi "United States") ======
  let bangQuocGia = null;
  const BI_DANH_QUOC_GIA = {
    'usa': 'US', 'united states of america': 'US', 'uk': 'GB', 'united kingdom': 'GB', 'england': 'GB', 'scotland': 'GB',
    'wales': 'GB', 'great britain': 'GB', 'germany': 'DE', 'turkey': 'TR', 'russia': 'RU', 'south korea': 'KR',
    'korea': 'KR', 'czech republic': 'CZ', 'holland': 'NL', 'the netherlands': 'NL', 'vietnam': 'VN'
  };
  function maQuocGia(ten) {
    const v = str(ten);
    // "UK" khong phai ma ISO (Merchize bao "Country is invalid"), ma dung la "GB".
    if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase() === 'UK' ? 'GB' : v.toUpperCase();
    const key = v.toLowerCase();
    if (BI_DANH_QUOC_GIA[key]) return BI_DANH_QUOC_GIA[key];
    if (!bangQuocGia) {
      bangQuocGia = {};
      try {
        const dn = new Intl.DisplayNames(['en'], { type: 'region' });
        for (let a = 65; a <= 90; a++) {
          for (let b = 65; b <= 90; b++) {
            const code = String.fromCharCode(a) + String.fromCharCode(b);
            const name = dn.of(code);
            // Giu ma dau tien (vd GB), khong de ma cu nhu "UK" ghi de.
            if (name && name !== code && !bangQuocGia[name.toLowerCase()]) bangQuocGia[name.toLowerCase()] = code;
          }
        }
      } catch (e) { /* trinh duyet qua cu khong co Intl.DisplayNames - chi dung bang bi danh */ }
    }
    return bangQuocGia[key] || '';
  }

  // ============ GOI MERCHIZE API (GM_xmlhttpRequest de khong bi CORS chan) ============
  // { "ten tab": { baseUrl, token } }
  function docCacStore() {
    try { return JSON.parse(GM_getValue('mz_stores', '{}')) || {}; } catch (e) { return {}; }
  }

  function layStore(tenTab) {
    const st = docCacStore()[tenTab];
    return st && st.baseUrl && st.token ? st : null;
  }

  function luuStore(tenTab, baseUrl, token) {
    const all = docCacStore();
    all[tenTab] = { baseUrl, token };
    GM_setValue('mz_stores', JSON.stringify(all));
  }

  // Nhan ca Base URL lan 1 Request URL day du copy tu tab Network (vd
  // ".../zoi24ff/bo-api/order/orders/..."), cat lai toi "/bo-api".
  function chuanHoaBaseUrl(v) {
    const m = str(v).match(/^(https:\/\/[a-z0-9.-]+\.merchize\.com\/[^/?#]+\/bo-api)/i);
    return m ? m[1] : '';
  }

  function merchizeRequest(store, method, path, body) {
    if (!store) return Promise.reject(new Error('Tab này chưa cài store Merchize (Base URL + Access Token).'));
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url: store.baseUrl + path,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + store.token },
        data: body ? JSON.stringify(body) : undefined,
        timeout: 60000,
        onload: (res) => {
          let json = null;
          try { json = JSON.parse(res.responseText); } catch (e) { /* khong phai JSON */ }
          if (res.status === 401 || res.status === 403) {
            reject(new Error(`Merchize từ chối (${res.status}) - kiểm tra lại Access Token.`));
            return;
          }
          if (!json) {
            reject(new Error(`Merchize trả về ${res.status}, không đọc được nội dung.`));
            return;
          }
          resolve({ status: res.status, json });
        },
        onerror: () => reject(new Error('Không kết nối được tới Merchize.')),
        ontimeout: () => reject(new Error('Merchize không phản hồi (quá 60 giây).'))
      });
    });
  }

  // Ten store: ma trong Base URL (vd t37fruz) -> ten lay tu API Merchize (luu trong mz_site_names).
  function maStoreCua(st) {
    return st ? (st.baseUrl.match(/merchize\.com\/([^/]+)\/bo-api/i) || [])[1] || st.baseUrl : '';
  }
  function docTenStore() {
    try { return JSON.parse(GM_getValue('mz_site_names', '{}')) || {}; } catch (e) { return {}; }
  }
  function tenStore(st) {
    const ma = maStoreCua(st);
    return docTenStore()[ma] || ma;
  }
  // Chua co ten: hoi API cua Merchize (stores/by-slug/<ma>/authorize, settings "name") bang Access
  // Token cua store, moi ma 1 lan.
  const daThuTen = new Set();
  function thuLayTenStore(st, xong) {
    const ma = maStoreCua(st);
    if (!ma || docTenStore()[ma] || daThuTen.has(ma)) return;
    daThuTen.add(ma);
    GM_xmlhttpRequest({
      method: 'GET',
      url: `https://bo-master-1-eks.merchize.store/api/seller/stores/by-slug/${encodeURIComponent(ma)}/authorize`,
      headers: { Authorization: 'Bearer ' + st.token },
      timeout: 20000,
      onload: (res) => {
        let json = null;
        try { json = JSON.parse(res.responseText); } catch (e) { return; }
        const ds = (json && json.data && json.data.settings) || [];
        const lay = (k) => str((ds.find((x) => x && x.key === k) || {}).value);
        const ten = lay('name') || lay('general_name');
        if (!ten) return;
        const all = docTenStore();
        all[ma] = ten;
        GM_setValue('mz_site_names', JSON.stringify(all));
        xong();
      }
    });
  }

  // ============ DONG BO LEN WORKER (khoi sua bien STORES / TEB tren Cloudflare) ============
  // { url: "https://merchize-webhook.<ten>.workers.dev", key: "<1 trong SECRET_KEYS>" }
  function docWorker() {
    try { return JSON.parse(GM_getValue('mz_worker', 'null')); } catch (e) { return null; }
  }

  function goiWorker(method, path, body) {
    const wk = docWorker();
    if (!wk) return Promise.reject(new Error('Chưa cài Worker (bấm "Cài Worker").'));
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url: `${wk.url}${path}${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(wk.key)}`,
        headers: { 'Content-Type': 'application/json' },
        data: body ? JSON.stringify(body) : undefined,
        timeout: 30000,
        onload: (res) => {
          let json = null;
          try { json = JSON.parse(res.responseText); } catch (e) { /* khong phai JSON */ }
          if (!json || !json.ok) reject(new Error(`Worker trả về ${res.status}: ${(json && json.error) || 'lỗi'}`));
          else resolve(json);
        },
        onerror: () => reject(new Error('Không kết nối được tới Worker.')),
        ontimeout: () => reject(new Error('Worker không phản hồi.'))
      });
    });
  }

  // Gui store + sheet Teb cua tab len Worker. phan: { store?, teb? } (null = xoa). Tra ve cac dong bao cao.
  async function dongBoWorker(title, phan) {
    if (!docWorker()) return ['(Chưa cài Worker nên Worker chưa biết tab này. Bấm "Cài Worker" rồi "Đồng bộ tab này lên Worker".)'];
    try {
      const kq = await goiWorker('POST', '/config', { spreadsheetId: getSpreadsheetId(), sheet: title, ...phan });
      danhDauDaDongBo(title);
      // Worker tra ve ten file Teb (service account doc duoc) -> luu de hien "✅ Sheet Teb: <ten file>".
      if (kq.tenFileTeb) {
        const all = docCacSheetTeb();
        if (all[title] && all[title].fileTitle !== kq.tenFileTeb) {
          all[title].fileTitle = kq.tenFileTeb;
          GM_setValue('mz_teb_targets', JSON.stringify(all));
        }
      }
      const dong = [`Worker: đã cập nhật "${kq.khoa}".`];
      if (kq.quyenSheet && kq.quyenSheet !== 'ok') dong.push(`⚠️ Worker chưa vào được file này: ${kq.quyenSheet}. Hãy share file này cho ${kq.serviceAccount} (quyền Editor).`);
      if (kq.quyenTeb && kq.quyenTeb !== 'ok') dong.push(`⚠️ Worker chưa đọc được sheet Teb: ${kq.quyenTeb}. Hãy share file Teb cho ${kq.serviceAccount} (quyền xem là đủ).`);
      return dong;
    } catch (e) {
      return ['⚠️ Chưa đồng bộ được lên Worker: ' + e.message];
    }
  }

  // Chu ky cau hinh cua tab (store + sheet Teb) da gui len Worker, de tu dong bo khi con thieu.
  function chuKyTab(title) {
    const st = layStore(title);
    const teb = docCacSheetTeb()[title];
    return [getSpreadsheetId(), st ? st.baseUrl + st.token.slice(-6) : '', teb ? teb.spreadsheetId + teb.sheetTitle : ''].join('|');
  }
  function docDaDongBo() {
    try { return JSON.parse(GM_getValue('mz_synced', '{}')) || {}; } catch (e) { return {}; }
  }
  function danhDauDaDongBo(title) {
    const all = docDaDongBo();
    all[getSpreadsheetId() + '|' + title] = chuKyTab(title);
    GM_setValue('mz_synced', JSON.stringify(all));
  }
  function canDongBo(title) {
    return !!docWorker() && !!layStore(title) && docDaDongBo()[getSpreadsheetId() + '|' + title] !== chuKyTab(title);
  }

  async function caiWorker() {
    const cu = docWorker() || {};
    const url = str(W.prompt('Link Worker (vd https://merchize-webhook.<tên>.workers.dev):', cu.url || ''));
    if (!url) return 'Đã hủy.';
    if (!/^https:\/\/[^/]+\.workers\.dev\/?$/i.test(url)) throw new Error('Link Worker phải có dạng https://....workers.dev');
    const key = str(W.prompt('SECRET_KEY của Worker (1 trong các key trong biến SECRET_KEYS):', cu.key || ''));
    if (!key) return 'Đã hủy.';
    GM_setValue('mz_worker', JSON.stringify({ url: url.replace(/\/$/, ''), key }));
    const kq = await goiWorker('GET', '/config');
    return `Đã kết nối Worker. Service account: ${kq.serviceAccount}\nWorker đang theo dõi ${Object.keys(kq.stores).length} tab: ${Object.keys(kq.stores).join(', ')}`;
  }

  async function dongBoTabNay(tenTab) {
    const title = tenTab || (await layTrangTinhDangMo()).title;
    const st = layStore(title);
    if (!st) throw new Error(`Tab "${title}" chưa có store Merchize. Lưu store trước.`);
    const teb = docCacSheetTeb()[title];
    const dong = await dongBoWorker(title, {
      store: { baseUrl: st.baseUrl, token: st.token },
      teb: teb ? { spreadsheetId: teb.spreadsheetId, sheet: teb.sheetTitle } : null
    });
    return dong.join('\n');
  }

  // ============ CATALOG: ma san pham -> { "mau|size": SKU variant } ============
  function docCatalogDaLuu() {
    try { return JSON.parse(GM_getValue('mz_catalog', 'null')); } catch (e) { return null; }
  }

  // Catalog la cua chung Merchize (giong nhau moi store) nen chi can token cua tab dang mo.
  async function capNhatCatalog(statusEl) {
    log(statusEl, '⏳ Đang đọc tab đang mở...');
    const { title } = await layTrangTinhDangMo();
    const store = layStore(title);
    if (!store) throw new Error(`Tab "${title}" chưa cài store Merchize.`);
    log(statusEl, '⏳ Đang tải catalog Merchize...');
    const products = [];
    for (let page = 1; page <= 10; page++) {
      const q = `?limit=50&page=${page}&search=${encodeURIComponent(cacMaSanPham().join(','))}`;
      const { json } = await merchizeRequest(store, 'GET', '/product/catalog' + q);
      if (!json.success) throw new Error('Tải catalog lỗi: ' + (json.message || 'không rõ'));
      const list = (json.data && json.data.products) || [];
      products.push(...list);
      const total = (json.data && json.data.total) || 0;
      if (list.length === 0 || products.length >= total) break;
    }

    const catalog = { updated: new Date().toISOString(), products: {} };
    const baoCao = [];
    products.forEach((p) => {
      const variants = {};
      let soVariant = 0;
      (p.variants || []).forEach((v) => {
        let mau = '';
        let size = '';
        (v.attributes || []).forEach((a) => {
          const loai = str(a.type || a.name).toLowerCase();
          if (loai.includes('color')) mau = chuanHoaMau(a.value_text);
          else if (loai.includes('size')) size = chuanHoaSize(a.value_text);
        });
        const key = mau + '|' + size;
        if (v.sku && variants[key] === undefined) {
          const gia = {};
          (v.tiers || []).forEach((t) => { gia[t.name] = Number(t.price); });
          const ship = (v.shipping_prices || v.shipping_price || []).map((x) => [
            str(x.to_zone), str(x.to_country), Number(x.first_item) || 0, Number(x.additional_item) || 0
          ]);
          variants[key] = { sku: v.sku, gia, ship };
          soVariant++;
        }
      });
      catalog.products[p.sku] = { title: p.title, variants };
      baoCao.push(`• ${p.sku}: ${soVariant} variant - ${p.title}`);
    });

    const thieu = cacMaSanPham().filter((m) => !catalog.products[m]);
    GM_setValue('mz_catalog', JSON.stringify(catalog));
    return [
      `Đã lưu catalog ${Object.keys(catalog.products).length} sản phẩm:`,
      ...baoCao,
      thieu.length ? `⚠️ Không tìm thấy trên Merchize: ${thieu.join(', ')}` : ''
    ].join('\n');
  }

  // ====== SHEET "Teb Print SKU" (giong Apps Script cu) ======
  // Khoa tra cuu = title|color|size (viet thuong, bo khoang trang dau cuoi).
  function makeKey(a, b, c) {
    return [a, b, c].map((x) => str(x).toLowerCase()).join('|');
  }

  function bangTuDuLieu(values) {
    const H = {};
    (values[0] || []).forEach((h, i) => { if (str(h)) H[str(h)] = i; });
    return { H, rows: values.slice(1) };
  }

  // Doc tab "SKU LIST" trong file Teb cua tab (cot title / color / size / SKU, khong phan biet hoa
  // thuong). Tab khong dung Teb thi tra ve bang rong.
  async function docBangPhu(tebTarget) {
    const teb = {};
    if (!tebTarget) return { teb };
    const data = await sheetsApiFetch(`${tebTarget.spreadsheetId}/values/${encodeURIComponent("'SKU LIST'")}?valueRenderOption=FORMATTED_VALUE`, { method: 'GET' })
      .catch((e) => { throw new Error('Không đọc được tab "SKU LIST" của file Teb: ' + e.message.slice(0, 150)); });
    const values = data.values || [];
    // Dong tieu de: dong dau tien (trong 10 dong dau) co du cot COLOR, SIZE, SKU. STYLE CODE: theo ten cot,
    // khong co thi lay cot D.
    const tim = (h, ds) => h.findIndex((x) => ds.includes(str(x).toLowerCase()));
    let hdr = -1;
    let C = {};
    for (let k = 0; k < Math.min(10, values.length) && hdr < 0; k++) {
      const h = values[k] || [];
      C = {
        style: tim(h, ['style code', 'stylecode', 'style']),
        color: tim(h, ['color', 'colour', 'màu']),
        size: tim(h, ['size']),
        sku: tim(h, ['sku', 'teb sku', 'sku teb', 'sku teb print'])
      };
      if (C.color >= 0 && C.size >= 0 && C.sku >= 0) hdr = k;
    }
    if (hdr < 0) throw new Error('Tab "SKU LIST" của file Teb thiếu cột COLOR / SIZE / SKU.');
    if (C.style < 0) C.style = 3;
    const styles = new Set();
    values.slice(hdr + 1).forEach((r) => {
      const style = str(r[C.style]);
      const key = makeKey(style, r[C.color], r[C.size]);
      const sku = str(r[C.sku]);
      if (style && key !== '||' && sku) { teb[key] = sku; styles.add(style); }
    });
    // Luu danh sach STYLE CODE de goi y khi ghep.
    GM_setValue('mz_teb_styles', JSON.stringify(Array.from(styles)));
    const h = values[hdr];
    return { teb, sanPham: Array.from(styles), cot: ['style', 'color', 'size', 'sku'].map((k) => `${k}="${str(h[C[k]])}"`).join(', ') };
  }

  // Tra SKU cho 1 dong tu catalog. Mau ghep "A/B" (Etsy gop nhieu mau vao 1 lua chon) -> thu
  // tung manh, chi nhan khi dung 1 manh khop catalog.
  // Luat AU (giong Apps Script cu): Comfort Adult (1717US) gui Australia -> dung 1717 Made in AU
  // (1717AU) neu co dung mau + size, khong co thi quay ve 1717US.
  function traSku(catalog, title, color, size, country) {
    const maSpGoc = xacDinhMaSanPham(title);
    if (!maSpGoc) return { loi: `không nhận ra loại áo "${title}"` };
    if (maSpGoc === '1717US' && str(country).toLowerCase() === 'australia') {
      const kqAu = traSkuTrongSp(catalog, '1717AU', color, size);
      if (kqAu.sku) return kqAu;
    }
    return traSkuTrongSp(catalog, maSpGoc, color, size);
  }

  function traSkuTrongSp(catalog, maSp, color, size) {
    const sp = catalog.products[maSp];
    if (!sp) return { loi: `catalog chưa có ${maSp}, bấm "Cập nhật catalog"` };
    const s = chuanHoaSize(size);
    const bang = sp.variants;
    const khopMap = new Map();
    [color, ...str(color).split('/')].map(str).filter(Boolean).forEach((goc) => {
      const m = chuanHoaMau(goc);
      if (bang[m + '|' + s] && !khopMap.has(m)) khopMap.set(m, goc);
    });
    const khop = Array.from(khopMap.keys());
    if (khop.length === 1) {
      const v = bang[khop[0] + '|' + s];
      // Catalog luu tu ban <= 1.4 chi co chuoi SKU, chua co gia/phi ship.
      return typeof v === 'string'
        ? { sku: v, productTitle: sp.title, mauGui: khopMap.get(khop[0]), variant: null }
        : { sku: v.sku, productTitle: sp.title, mauGui: khopMap.get(khop[0]), variant: v };
    }
    if (khop.length > 1) return { loi: `màu "${color}" khớp nhiều màu trong catalog ${maSp}` };
    return { loi: `${maSp} không có màu "${color}" size "${size}"` };
  }

  // ============ UOC TINH BASE COST (gia goc + phi ship) TU CATALOG ============
  const NUOC_EU = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
    'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE']);

  // Phi ship lay tu file catalog Excel cua Merchize (tab US) - khop voi cost that. KHONG dung
  // shipping_prices cua API vi API tra ve 0 cho zone US/EU (da doi chieu voi don that).
  // [first item, additional item] theo zone US / EU / ROW.
  const PHI_SHIP = {
    '1717US': { US: [5.4, 1.99], EU: [10.19, 5], ROW: [10.19, 5] },
    '3001US': { US: [5.4, 1.99], EU: [10.19, 5], ROW: [10.19, 5] },
    '301YUS': { US: [5.4, 1.99], EU: [10.19, 5], ROW: [10.19, 5] },
    '3321US': { US: [5.4, 1.99], EU: [10.19, 5], ROW: [10.19, 5] },
    '9018US': { US: [5.4, 1.99], EU: [10.19, 5], ROW: [10.19, 5] },
    '1800US': { US: [7.59, 2.99], EU: [14.99, 10], ROW: [14.99, 10] },
    '1850US': { US: [8, 2.99], EU: [14.99, 10], ROW: [14.99, 10] }
  };

  // Tra ve dang [zone, country, first, additional] giong 1 dong shipping_prices.
  function phiShipTheoBang(sku, code) {
    const bang = PHI_SHIP[str(sku).slice(0, 6)];
    if (!bang) return null;
    const zone = code === 'US' ? 'US' : NUOC_EU.has(code) ? 'EU' : 'ROW';
    return bang[zone] ? [zone, 'bảng', bang[zone][0], bang[zone][1]] : null;
  }

  // ship: [[to_zone, to_country, first_item, additional_item], ...]. Uu tien dong ghi dung ma
  // nuoc, roi toi zone trung ma nuoc (vd "CA"), roi EU, cuoi cung ROW.
  function chonPhiShip(ship, code) {
    const tatCa = (x) => /^(all|)$/i.test(x[1]);
    return ship.find((x) => x[1].split(/\s*,\s*/).includes(code)) ||
      ship.find((x) => (x[0] === code || (code === 'GB' && x[0] === 'UK')) && tatCa(x)) ||
      (NUOC_EU.has(code) && (ship.find((x) => x[0] === 'EU' && /rest of eu/i.test(x[1])) ||
        ship.find((x) => x[0] === 'EU' && tatCa(x)))) ||
      ship.find((x) => x[0] === 'ROW' && tatCa(x)) ||
      null;
  }

  // dong: [{ variant, pm, qty }]. Tong = gia goc tung san pham + phi ship: san pham co phi
  // "first item" cao nhat tinh first item, cac san pham con lai tinh "additional item".
  // Tra ve { tong, chiTiet } hoac { loi }. chiTiet ghi ro gia goc + dong phi ship da chon
  // (zone/country) de doi chieu khi so uoc tinh lech cost that.
  function uocTinhCost(dong, code) {
    const donVi = [];
    for (const d of dong) {
      if (!d.variant) return { loi: 'catalog cũ, bấm "Cập nhật catalog"' };
      const gia = d.variant.gia[`${d.pm.toLowerCase()}_${TIER}`] ?? d.variant.gia[TIER];
      if (typeof gia !== 'number' || isNaN(gia)) return { loi: `không có giá ${TIER} cho ${d.variant.sku}` };
      const phi = phiShipTheoBang(d.variant.sku, code) || chonPhiShip(d.variant.ship, code);
      if (!phi) return { loi: `không có phí ship tới ${code} cho ${d.variant.sku}` };
      const matSau = d.matSau ? PHU_PHI_MAT_SAU : 0;
      for (let i = 0; i < d.qty; i++) donVi.push({ sku: d.variant.sku, gia, matSau, phi });
    }
    if (donVi.length === 0) return { loi: 'đơn trống' };
    let iMax = 0;
    donVi.forEach((u, i) => { if (u.phi[2] > donVi[iMax].phi[2]) iMax = i; });
    let tong = 0;
    const phan = donVi.map((u, i) => {
      const ship = i === iMax ? u.phi[2] : u.phi[3];
      tong += u.gia + u.matSau + ship;
      return `${u.sku} ${u.gia}${u.matSau ? ` + mặt sau ${u.matSau}` : ''} + ship ${ship} (${u.phi[0]}/${u.phi[1] || 'all'}, ${i === iMax ? 'first' : 'additional'})`;
    });
    // Tat ca san pham hien dung deu la hang kho US (ma ...US) nen don toi cac nuoc tren deu chiu thue.
    if (NUOC_THUE_CHAU_AU.has(code)) {
      tong += THUE_NHAP_KHAU_CHAU_AU;
      phan.push(`thuế nhập khẩu ${THUE_NHAP_KHAU_CHAU_AU}`);
    }
    tong = Math.round(tong * 100) / 100;
    return { tong, chiTiet: `${code}: ${phan.join(' | ')} = ${tong}` };
  }

  // ============ GOOGLE OAUTH + SHEETS API (giong script Import Cost/Earnings) ============
  let accessToken = null;
  let tokenClient = null;
  let trustedScriptUrlPolicy = null;

  function toTrustedScriptURL(url) {
    if (!(W.trustedTypes && W.trustedTypes.createPolicy)) return url;
    try {
      if (!trustedScriptUrlPolicy) {
        trustedScriptUrlPolicy = W.trustedTypes.createPolicy('mz-sender-script-url', { createScriptURL: (u) => u });
      }
      return trustedScriptUrlPolicy.createScriptURL(url);
    } catch (e) {
      console.error('[Merchize] Không tạo được Trusted Types policy:', e);
      return url;
    }
  }

  function gisSanSang() {
    return W.google && W.google.accounts && W.google.accounts.oauth2;
  }

  let gisLoadPromise = null;
  function loadGisScript() {
    if (gisSanSang()) return Promise.resolve();
    if (gisLoadPromise) return gisLoadPromise;
    gisLoadPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = toTrustedScriptURL('https://accounts.google.com/gsi/client');
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Không tải được thư viện đăng nhập Google (accounts.google.com/gsi/client).'));
      document.head.appendChild(s);
    });
    return gisLoadPromise;
  }

  function requestAccessTokenWithPrompt(promptValue) {
    return new Promise((resolve, reject) => {
      tokenClient.callback = (resp) => {
        if (resp && resp.access_token) {
          accessToken = resp.access_token;
          resolve(accessToken);
        } else {
          reject(new Error('Đăng nhập Google thất bại hoặc bạn đã từ chối cấp quyền.'));
        }
      };
      tokenClient.error_callback = (err) => reject(new Error('Đăng nhập Google lỗi: ' + (err && err.type ? err.type : 'không rõ')));
      tokenClient.requestAccessToken({ prompt: promptValue });
    });
  }

  function ensureAccessToken() {
    if (accessToken) return Promise.resolve(accessToken);
    return loadGisScript().then(() => {
      if (!gisSanSang()) throw new Error('Chưa tải được thư viện đăng nhập Google.');
      if (!tokenClient) {
        tokenClient = W.google.accounts.oauth2.initTokenClient({
          client_id: OAUTH_CLIENT_ID,
          scope: OAUTH_SCOPE,
          callback: () => {}
        });
      }
      return requestAccessTokenWithPrompt('').catch(() => requestAccessTokenWithPrompt('consent'));
    });
  }

  // Token Google chi song ~1 gio: gap 401 thi xin token moi (am tham) roi goi lai 1 lan.
  async function sheetsApiFetch(path, options = {}, daThuLai = false) {
    const token = await ensureAccessToken();
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    if (res.status === 401) {
      accessToken = null;
      if (!daThuLai) return sheetsApiFetch(path, options, true);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Sheets API lỗi ${res.status}: ${body}`);
    }
    return res.json();
  }

  function getSpreadsheetId() {
    const m = location.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!m) throw new Error('Không tìm thấy Spreadsheet ID trong URL.');
    return m[1];
  }

  function gidHienTai() {
    const m = location.hash.match(/gid=(\d+)/);
    return m ? Number(m[1]) : 0;
  }

  // gid -> ten tab, ghi lai moi lan doc qua API de doi tab khong can goi API/dang nhap lai.
  const tenTabTheoGid = {};

  // Ten tab dang mo, lay NGAY (khong goi API): uu tien chu tren thanh tab duoi day cua Sheets,
  // khong thay thi dung bang gid -> ten da luu. Tra ve '' neu chua biet.
  function tenTabNhanh() {
    const dom = document.querySelector('.docs-sheet-active-tab .docs-sheet-tab-name');
    const ten = dom ? str(dom.textContent) : '';
    return ten || tenTabTheoGid[gidHienTai()] || '';
  }

  async function layTrangTinhDangMo() {
    const spreadsheetId = getSpreadsheetId();
    const gid = gidHienTai();
    const data = await sheetsApiFetch(`${spreadsheetId}?fields=sheets.properties`, { method: 'GET' });
    const props = (data.sheets || []).map((s) => s.properties);
    props.forEach((p) => { tenTabTheoGid[p.sheetId] = p.title; });
    const active = props.find((p) => p.sheetId === gid) || props[0];
    if (!active) throw new Error('Không tìm thấy trang tính đang mở.');
    return { spreadsheetId, title: active.title };
  }

  // soDongCuoi: chi doc tieu de + N dong cuoi (theo cot orderNumber). Ket qua van danh so theo dong that:
  // rows[i] la dong i+1, cac dong khong doc de trong (forEach tu bo qua).
  async function docTrangTinh(spreadsheetId, title, soDongCuoi) {
    const q = '&valueRenderOption=FORMATTED_VALUE';
    // FORMATTED_VALUE: lay dung chu dang hien tren o (giu nguyen postalCode "02720", orderNumber khong bi thanh 4.17E+09).
    if (!soDongCuoi) {
      const data = await sheetsApiFetch(`${spreadsheetId}/values/${encodeURIComponent(`'${title}'!A:AG`)}?${q.slice(1)}`, { method: 'GET' });
      return data.values || [];
    }
    const dau = await sheetsApiFetch(`${spreadsheetId}/values:batchGet?ranges=${encodeURIComponent(`'${title}'!A1:AG1`)}&ranges=${encodeURIComponent(`'${title}'!C:C`)}${q}`, { method: 'GET' });
    const vr = dau.valueRanges || [];
    const header = ((vr[0] || {}).values || [])[0] || [];
    const cotC = ((vr[1] || {}).values || []).map((x) => str((x || [])[0]));
    // Chi tinh dong co ma don o cot C (bo qua dong soan san ben duoi: o trong, cong thuc ra rong...).
    const dongCoMa = [];
    cotC.forEach((v, i) => { if (i > 0 && v) dongCoMa.push(i + 1); });
    const kq = [header];
    if (!dongCoMa.length) return kq;
    const cuoi = dongCoMa[dongCoMa.length - 1];
    let batDau = Math.max(2, dongCoMa[Math.max(0, dongCoMa.length - soDongCuoi)]);
    // Khong cat ngang don nhieu dong: lui len toi dong dau cua don.
    while (batDau > 2 && cotC[batDau - 1] && cotC[batDau - 2] === cotC[batDau - 1]) batDau--;
    const data = await sheetsApiFetch(`${spreadsheetId}/values/${encodeURIComponent(`'${title}'!A${batDau}:AG${cuoi}`)}?${q.slice(1)}`, { method: 'GET' });
    (data.values || []).forEach((r, k) => { kq[batDau - 1 + k] = r; });
    return kq;
  }

  // updates: [{ row: so dong 1-based, values: [AB, AC, AD] }]
  async function ghiKetQua(spreadsheetId, title, updates) {
    if (updates.length === 0) return;
    const data = updates.map((u) => ({ range: `'${title}'!AB${u.row}:AD${u.row}`, values: [u.values] }));
    await sheetsApiFetch(`${spreadsheetId}/values:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ valueInputOption: 'RAW', data })
    });
  }

  async function damBaoTieuDe(spreadsheetId, title, rows) {
    const header = rows[0] || [];
    if (str(header[COL.merchizeSku]) || str(header[COL.status]) || str(header[COL.merchizeId])) return;
    await ghiKetQua(spreadsheetId, title, [{ row: 1, values: OUTPUT_HEADERS }]);
  }

  // ============ GOM DON TU TRANG TINH ============
  function cell(row, idx) {
    return str(row[idx]);
  }

  // Tra ve danh sach don CHO GUI (cac dong co orderNumber va cot AC trong), gop theo orderNumber.
  function gomDon(rows) {
    const daGui = new Set();
    rows.slice(1).forEach((r) => {
      const ma = cell(r, COL.orderNumber);
      if (ma && cell(r, COL.status)) daGui.add(ma);
    });

    const donMap = new Map();
    rows.forEach((r, i) => {
      if (i === 0) return;
      const ma = cell(r, COL.orderNumber);
      if (!ma || cell(r, COL.status)) return;
      if (!donMap.has(ma)) donMap.set(ma, { orderNumber: ma, rows: [], daGuiTruoc: daGui.has(ma) });
      donMap.get(ma).rows.push({ rowNumber: i + 1, r });
    });
    return Array.from(donMap.values());
  }

  // Kiem tra + dung payload cho 1 don. Tra ve { payload, skus, loi[] }.
  function dungDon(don, catalog, tenTab) {
    const loi = [];
    const skus = [];
    const dongCost = [];
    if (don.daGuiTruoc) loi.push('đơn này đã có dòng được gửi/đánh dấu trước đó');

    const first = don.rows[0].r;
    const country = maQuocGia(cell(first, COL.country));
    let postcode = cell(first, COL.postalCode);
    if (country === 'US' && /^\d{1,4}$/.test(postcode)) postcode = postcode.padStart(5, '0');

    const shipping = {
      full_name: cell(first, COL.name),
      address_1: cell(first, COL.address1),
      address_2: cell(first, COL.address2),
      city: cell(first, COL.city),
      state: cell(first, COL.state),
      postcode,
      country,
      email: cell(first, COL.email),
      phone: cell(first, COL.phone)
    };
    if (!shipping.full_name) loi.push('thiếu tên người nhận');
    if (!shipping.address_1) loi.push('thiếu address1');
    if (!shipping.city) loi.push('thiếu city');
    if (!shipping.postcode) loi.push('thiếu postalCode');
    if (!country) loi.push(`không nhận ra quốc gia "${cell(first, COL.country)}"`);

    const items = don.rows.map(({ r }, idx) => {
      const vt = don.rows.length > 1 ? ` (dòng ${idx + 1})` : '';
      const title = cell(r, COL.title);
      const color = cell(r, COL.color);
      const size = cell(r, COL.size);
      const tra = traSku(catalog, title, color, size, cell(first, COL.country));
      // Mau ghep "A/B" da tra ra 1 mau cu the -> gui dung manh do thay vi ca chuoi goc.
      const mauGui = tra.mauGui || color;
      skus.push(tra.sku || '');
      if (tra.loi) loi.push(tra.loi + vt);

      const image = cell(r, COL.mockUpFront);
      const front = cell(r, COL.designFront);
      const back = cell(r, COL.designBack);
      if (!laLink(image)) loi.push('thiếu ảnh mockUpFront' + vt);
      if (!laLink(front) && !laLink(back)) loi.push('thiếu link design' + vt);

      const qty = parseInt(cell(r, COL.quantity), 10);
      const pm = cell(r, COL.printingMethod).toUpperCase();
      dongCost.push({
        variant: tra.variant || null, pm: pm || 'DTF', qty: qty > 0 ? qty : 1,
        matSau: laLink(cell(r, COL.designFront)) && laLink(cell(r, COL.designBack))
      });
      const item = {
        name: title,
        merchize_sku: tra.sku || '',
        quantity: qty > 0 ? qty : 1,
        image,
        attributes: [
          { name: 'product', option: tra.productTitle || title },
          { name: 'Color', option: mauGui },
          { name: 'Size', option: size }
        ]
      };
      if (pm === 'DTG' || pm === 'DTF') item.printing_method = pm;
      if (laLink(front)) item.design_front = front;
      if (laLink(back)) item.design_back = back;
      return item;
    });

    const identifier = cell(first, COL.account) || tenTab;
    return {
      loi,
      skus,
      ...(() => {
        if (!country || coLoiSku(loi)) return { cost: '', chiTietCost: '' };
        const kq = uocTinhCost(dongCost, country);
        return kq.loi ? { cost: kq.loi, chiTietCost: '' } : { cost: kq.tong, chiTietCost: kq.chiTiet };
      })(),
      payload: { order_id: don.orderNumber, identifier, shipping_info: shipping, items }
    };
  }

  function coLoiSku(loi) {
    return loi.some((x) => /không có màu|không nhận ra loại áo|catalog chưa có|khớp nhiều màu/.test(x));
  }

  // Ghi Base Cost (cot Y) vao dong DAU cua don, giong cach dang dien tay. USER_ENTERED de la so.
  async function ghiBaseCost(spreadsheetId, title, list) {
    const data = list.filter((x) => typeof x.cost === 'number')
      .map((x) => ({ range: `'${title}'!Y${x.row}`, values: [[x.cost]] }));
    if (data.length === 0) return;
    await sheetsApiFetch(`${spreadsheetId}/values:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data })
    });
  }

  // ============ TEB PRINT (fulfill rieng cho 1 so account) ============
  // Tab nao dung Teb: don gui US, chi 1 dong va tim duoc SKU trong sheet "Teb Print SKU" thi di
  // Teb (ghi noi tiep vao sheet Teb do nguoi dung chon), con lai gui Merchize.
  // Tab dung Teb = tab da luu sheet Teb (nut "Luu sheet Teb cho tab nay"). TEB_TABS chi con de
  // tuong thich ban cu.
  const TEB_TABS = new Set(['ETSY_Turkiye 01']);
  function laTabTeb(tenTab) {
    return TEB_TABS.has(tenTab) || !!docCacSheetTeb()[tenTab];
  }
  const STATUS_TEB = 'Teb';

  // Ghep title tren Sheet voi STYLE CODE (cot D) trong SKU LIST cua Teb: { "comfort adult": "<style code>" }.
  function docGhepTeb() {
    try { return JSON.parse(GM_getValue('mz_teb_style', '{}')) || {}; } catch (e) { return {}; }
  }
  function luuGhepTeb(ghep) {
    GM_setValue('mz_teb_style', JSON.stringify(ghep));
  }
  function styleTeb(title) {
    return docGhepTeb()[str(title).toLowerCase()] || '';
  }
  function tebSkuCuaDon(don, tenTab, bangPhu) {
    if (!laTabTeb(tenTab) || don.rows.length !== 1) return '';
    const r = don.rows[0].r;
    if (maQuocGia(cell(r, COL.country)) !== 'US') return '';
    const style = styleTeb(cell(r, COL.title));
    if (!style) return '';
    return bangPhu.teb[makeKey(style, cell(r, COL.color), cell(r, COL.size))] || '';
  }

  // Sheet Teb dich cua tung tab: { "<tab>": { spreadsheetId, sheetTitle } }, luu trong Violentmonkey.
  function docCacSheetTeb() {
    try { return JSON.parse(GM_getValue('mz_teb_targets', '{}')) || {}; } catch (e) { return {}; }
  }

  // "28/09/2026" -> "28/9/26" (giong cot ORDER DATE cua sheet Teb).
  function ngayTeb(v) {
    const m = str(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    return m ? `${Number(m[1])}/${Number(m[2])}/${m[3].slice(-2)}` : str(v);
  }

  // 1 dong theo dinh dang sheet Teb (A ORDER DATE, B ORDER CODE, C SKU ... Q MOCKUP, R MOCKUP
  // BACK, S NOTE = DTG), giong buildTebDestRow cua Apps Script cu. Khi ghi bo cot A (bi khoa).
  function dongTeb(r, tebSku) {
    const v = new Array(20).fill('');
    v[0] = ngayTeb(cell(r, COL.dateFulfill));
    v[1] = cell(r, COL.orderNumber);
    v[2] = tebSku;
    v[3] = cell(r, COL.quantity);
    v[4] = cell(r, COL.name);
    v[5] = cell(r, COL.phone);
    v[6] = cell(r, COL.address1);
    v[7] = cell(r, COL.address2);
    v[8] = cell(r, COL.city);
    v[9] = cell(r, COL.state);
    v[10] = cell(r, COL.postalCode);
    v[11] = cell(r, COL.country);
    v[12] = cell(r, COL.designFront);
    v[13] = cell(r, COL.designBack);
    // Chi co designBack -> mockUpFront dien vao cot mockupBack (R), nguoc lai vao cot Q.
    if (!cell(r, COL.designFront) && cell(r, COL.designBack)) v[17] = cell(r, COL.mockUpFront);
    else v[16] = cell(r, COL.mockUpFront);
    if (cell(r, COL.printingMethod).toUpperCase() === 'DTG') v[18] = cell(r, COL.printingMethod);
    return v;
  }

  // Ghi NOI TIEP (khong xoa gi) cac don Teb vao sheet Teb da chon cho tab nay.
  async function ghiSheetTeb(target, dsTeb) {
    if (!dsTeb.length) return;
    // Chi ghi cot B -> T (cot A ORDER DATE va cac cot sau T tren sheet Teb co the bi khoa). Tim
    // dong trong ke tiep theo cot B (ORDER CODE) roi ghi dung vung do, khong chen dong moi.
    const cotB = await sheetsApiFetch(
      `${target.spreadsheetId}/values/${encodeURIComponent(`'${target.sheetTitle}'!B:B`)}?majorDimension=COLUMNS`,
      { method: 'GET' });
    const dongTiep = (((cotB.values || [])[0]) || []).length + 1;
    const range = `'${target.sheetTitle}'!B${dongTiep}:T${dongTiep + dsTeb.length - 1}`;
    await sheetsApiFetch(`${target.spreadsheetId}/values:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: [{ range, values: dsTeb.map((d) => dongTeb(d.rows[0].r, d.tebSku).slice(1)) }]
      })
    });
  }

  // Luu sheet Teb dich cho tab dang mo tu link (mo dung tab trong file Teb roi copy link co #gid=).
  async function luuSheetTeb(link) {
    const { title } = await layTrangTinhDangMo();
    // O link de trong: bo dung Teb cho tab nay.
    if (!str(link)) {
      const all = docCacSheetTeb();
      if (!all[title]) throw new Error('Chưa dán link sheet Teb.');
      if (!W.confirm(`Bỏ dùng Teb cho tab "${title}"? Đơn của tab này sẽ gửi hết lên Merchize.`)) return 'Đã hủy.';
      delete all[title];
      GM_setValue('mz_teb_targets', JSON.stringify(all));
      return `Tab "${title}" không còn dùng Teb.`;
    }
    const m = str(link).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!m) throw new Error('Link không phải link Google Sheet.');
    const g = str(link).match(/gid=(\d+)/);
    const gid = g ? Number(g[1]) : 0;
    const data = await sheetsApiFetch(`${m[1]}?fields=properties.title,sheets.properties`, { method: 'GET' });
    const p = (data.sheets || []).map((x) => x.properties).find((x) => x.sheetId === gid);
    if (!p) throw new Error('Không tìm thấy tab trong link (link cần có #gid=...).');
    const tenFile = str((data.properties || {}).title);
    const all = docCacSheetTeb();
    all[title] = { spreadsheetId: m[1], sheetTitle: p.title, fileTitle: tenFile };
    GM_setValue('mz_teb_targets', JSON.stringify(all));
    return `Đã chọn sheet Teb cho tab "${title}": file "${tenFile}", tab "${p.title}".`;
  }

  // ============ 3 CHUC NANG CHINH ============
  async function kiemTraHoacGui(statusEl, guiThat) {
    const catalog = docCatalogDaLuu();
    if (!catalog) throw new Error('Chưa có catalog. Bấm "Cập nhật catalog" trước.');

    log(statusEl, '⏳ Đang đọc trang tính...');
    const { spreadsheetId, title } = await layTrangTinhDangMo();
    const store = layStore(title);
    if (guiThat && !store) throw new Error(`Tab "${title}" chưa cài store Merchize (Base URL + Access Token).`);
    const rows = await docTrangTinh(spreadsheetId, title, SO_DONG_CUOI);
    const tebTarget = docCacSheetTeb()[title];
    const bangPhu = await docBangPhu(tebTarget);
    const tatCa = gomDon(rows).map((d) => ({ ...d, tebSku: tebSkuCuaDon(d, title, bangPhu) }));
    const dsTeb = tatCa.filter((d) => d.tebSku);
    if (guiThat && dsTeb.length && !tebTarget) {
      throw new Error(`Có ${dsTeb.length} đơn đi Teb nhưng tab "${title}" chưa chọn sheet Teb. Dán link sheet Teb rồi bấm "Lưu sheet Teb".`);
    }
    const donList = tatCa.filter((d) => !d.tebSku).map((d) => ({ ...d, ...dungDon(d, catalog, title) }));
    if (donList.length === 0 && dsTeb.length === 0) return `Trang "${title}": không có đơn nào chờ gửi (cột AC đều đã có trạng thái).`;
    const dongTebBaoCao = dsTeb.length ? [`${dsTeb.length} đơn đi Teb: ${dsTeb.map((d) => d.orderNumber).join(', ')}`] : [];
    if (!tebTarget) dongTebBaoCao.push(`Tab "${title}" chưa chọn sheet Teb nên mọi đơn gửi Merchize.`);
    // Chan doan Teb: don US 1 dong khong tim thay SKU trong SKU LIST (de so voi SKU LIST).
    if (tebTarget) {
      const khongKhop = tatCa.filter((d) => !d.tebSku && d.rows.length === 1 && maQuocGia(cell(d.rows[0].r, COL.country)) === 'US');
      const mau = Object.keys(bangPhu.teb).slice(0, 3);
      dongTebBaoCao.push(`SKU LIST: ${Object.keys(bangPhu.teb).length} dòng (cột ${bangPhu.cot})` +
        (mau.length ? `, ví dụ: ${mau.map((k) => `"${k}"`).join('; ')}` : ''));
      if (khongKhop.length) {
        dongTebBaoCao.push(`${khongKhop.length} đơn US 1 dòng không có trong SKU LIST:`,
          ...khongKhop.slice(0, 10).map((d) => {
            const r = d.rows[0].r;
            const style = styleTeb(cell(r, COL.title));
            return `• ${d.orderNumber}: "${cell(r, COL.title)}" ${style ? `→ ${style}` : '(chưa ghép STYLE CODE)'} | ${cell(r, COL.color)} | ${cell(r, COL.size)}`;
          }),
          'Ghép title với STYLE CODE trong mục "1. Cập nhật catalog".');
      }
    }

    const hopLe = donList.filter((d) => d.loi.length === 0);
    const coLoi = donList.filter((d) => d.loi.length > 0);
    const dongLoi = coLoi.map((d) => `• ${d.orderNumber}: ${d.loi.join('; ')}`);

    if (!guiThat) {
      // Kiem tra: chi dien SKU vao AB, KHONG ghi AC de don van con o trang thai cho gui.
      const updates = [];
      donList.forEach((d) => d.rows.forEach(({ rowNumber, r }, i) => {
        updates.push({ row: rowNumber, values: [d.skus[i], cell(r, COL.status), cell(r, COL.merchizeId)] });
      }));
      dsTeb.forEach((d) => {
        const { rowNumber, r } = d.rows[0];
        updates.push({ row: rowNumber, values: [d.tebSku, cell(r, COL.status), cell(r, COL.merchizeId)] });
      });
      await damBaoTieuDe(spreadsheetId, title, rows);
      await ghiKetQua(spreadsheetId, title, updates);
      return [
        `Trang "${title}": ${donList.length} đơn chờ gửi Merchize, ${hopLe.length} đơn hợp lệ, ${coLoi.length} đơn có lỗi.`,
        ...dongTebBaoCao,
        'Đã điền SKU vào cột AB (chưa gửi gì lên Merchize / Teb).',
        ...dongLoi
      ].join('\n');
    }

    if (hopLe.length === 0 && dsTeb.length === 0) {
      return [`Không có đơn hợp lệ để gửi (${coLoi.length} đơn lỗi):`, ...dongLoi].join('\n');
    }
    const ok = W.confirm(
      `Sẽ gửi ${hopLe.length} đơn lên Merchize (${tenStore(store)})` +
      (dsTeb.length ? ` và ${dsTeb.length} đơn vào sheet Teb` : '') + ` từ tab "${title}".` +
      (coLoi.length ? `\n${coLoi.length} đơn lỗi sẽ được đánh dấu, không gửi.` : '') +
      '\n\nVui lòng điền "Cũ" vào cột Trạng thái (AC) cho những đơn hàng cũ để tránh gửi nhầm 1 đơn 2 lần.' +
      '\n\nBấm OK để xác nhận gửi, Cancel để hủy.'
    );
    if (!ok) return 'Đã hủy, chưa gửi đơn nào.';

    await damBaoTieuDe(spreadsheetId, title, rows);

    // Don loi: ghi ngay trang thai loi (sua xong thi xoa o AC de gui lai).
    const updLoi = [];
    coLoi.forEach((d) => d.rows.forEach(({ rowNumber }, i) => {
      updLoi.push({ row: rowNumber, values: [d.skus[i], STATUS_ERROR_PREFIX + d.loi.join('; '), ''] });
    }));
    await ghiKetQua(spreadsheetId, title, updLoi);

    // Don Teb: ghi sheet Teb truoc, roi danh dau AC = "Teb" de khong bi gui lai. Ghi loi (vd khong
    // co quyen sua file Teb) thi danh dau loi cho don Teb va VAN gui tiep don Merchize.
    let loiTeb = '';
    if (dsTeb.length) {
      try {
        await ghiSheetTeb(tebTarget, dsTeb);
        await ghiKetQua(spreadsheetId, title, dsTeb.map((d) => ({ row: d.rows[0].rowNumber, values: [d.tebSku, STATUS_TEB, ''] })));
      } catch (e) {
        loiTeb = /\b403\b|PERMISSION_DENIED/.test(e.message)
          ? 'tài khoản Google đang dùng không có quyền sửa file Teb'
          : e.message.slice(0, 200);
        await ghiKetQua(spreadsheetId, title, dsTeb.map((d) => ({
          row: d.rows[0].rowNumber, values: [d.tebSku, STATUS_ERROR_PREFIX + 'không ghi được sheet Teb - ' + loiTeb, '']
        })));
      }
    }

    let thanhCong = 0;
    const ketQuaGui = [];
    for (let i = 0; i < hopLe.length; i++) {
      const d = hopLe[i];
      log(statusEl, `⏳ Đang gửi ${i + 1}/${hopLe.length}: ${d.orderNumber}...`);
      let trangThai;
      let maMerchize = '';
      try {
        const { json } = await merchizeRequest(store, 'POST', '/order/external/orders', d.payload);
        if (json.success) {
          trangThai = STATUS_SENT;
          // Ma RX-... that se do webhook dien vao cot AD sau (API chi tra ve ID lan import).
          maMerchize = '';
          thanhCong++;
        } else {
          trangThai = STATUS_ERROR_PREFIX + (json.message || 'Merchize từ chối');
        }
      } catch (e) {
        trangThai = STATUS_ERROR_PREFIX + e.message;
      }
      if (trangThai !== STATUS_SENT) ketQuaGui.push(`• ${d.orderNumber}: ${trangThai}`);
      // Ghi ngay sau moi don de lo dong tab giua chung van biet don nao da gui.
      await ghiKetQua(spreadsheetId, title, d.rows.map(({ rowNumber }, j) => ({
        row: rowNumber, values: [d.skus[j], trangThai, maMerchize]
      })));
      await sleep(300);
    }

    return [
      `Trang "${title}": gửi thành công ${thanhCong}/${hopLe.length} đơn lên Merchize.`,
      ...(dsTeb.length && !loiTeb ? [`Đã ghi ${dsTeb.length} đơn vào sheet Teb "${tebTarget.sheetTitle}".`] : []),
      ...(loiTeb ? [`❌ ${dsTeb.length} đơn Teb chưa ghi được: ${loiTeb}. Cấp quyền Editor file Teb cho tài khoản này, rồi xoá ô AC các đơn đó và gửi lại.`] : []),
      ...ketQuaGui,
      coLoi.length ? `${coLoi.length} đơn không gửi vì lỗi dữ liệu:` : '',
      ...dongLoi
    ].filter(Boolean).join('\n');
  }

  // ============ GIAO DIEN NOI ============
  // Google Sheets bat Trusted Types CSP: khong dung innerHTML, chi createElement/appendChild.
  function log(el, text) {
    if (el) el.textContent = text;
  }

  const MAX_Z = 2147483647;
  const POS_STORAGE_KEY = 'mz_sender_btn_pos';
  const PANEL_WIDTH = 380;

  function el(tag, css, text) {
    const e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text) e.textContent = text;
    return e;
  }

  function nut(text, mau) {
    return el('button', `width:100%;padding:8px;background:${mau};color:#fff;border:none;border-radius:4px;cursor:pointer;margin-bottom:6px;`, text);
  }

  function buildUi() {
    const btn = el('button', `position:fixed!important;bottom:80px;right:24px;z-index:${MAX_Z}!important;
      padding:10px 16px;background:#ff6f00;color:#fff;border:none;border-radius:6px;cursor:grab;font-size:13px;
      font-family:Arial,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.4);user-select:none;`, `Merchize v${SCRIPT_VERSION}`);
    try {
      const pos = JSON.parse(localStorage.getItem(POS_STORAGE_KEY) || 'null');
      if (pos && typeof pos.left === 'number') {
        Object.assign(btn.style, { left: pos.left + 'px', top: pos.top + 'px', right: 'auto', bottom: 'auto' });
      }
    } catch (e) { /* bo qua */ }

    const panel = el('div', `position:fixed!important;z-index:${MAX_Z}!important;width:${PANEL_WIDTH}px;box-sizing:border-box;padding:14px;
      background:#fff;border:1px solid #ccc;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.4);
      font-family:Arial,sans-serif;font-size:13px;display:none;`);

    const oCss = 'width:100%;box-sizing:border-box;padding:6px;margin-bottom:6px;border:1px solid #ccc;border-radius:4px;';
    const dongCss = 'font-size:12px;font-weight:bold;margin-bottom:6px;cursor:pointer;white-space:pre-wrap;';
    // 2 dong trang thai: bam vao dong da cai (✅) de hien o sua.
    const storeInfo = el('div', dongCss, '');
    storeInfo.title = 'Bấm để sửa store Merchize';
    const tebInfo = el('div', dongCss, '');
    tebInfo.title = 'Bấm để sửa sheet Teb';
    const storeBox = el('div', 'margin-bottom:4px;');
    const baseInput = el('input', oCss);
    baseInput.placeholder = 'Base URL, vd ' + BASE_URL_GOI_Y;
    const tokenInput = el('input', oCss);
    tokenInput.type = 'password';
    tokenInput.placeholder = 'Access Token của store này';
    const webhookInput = el('input', oCss);
    webhookInput.type = 'password';
    webhookInput.placeholder = 'Secret key webhook của store (Merchize > Webhook), nếu có';
    const saveTokenBtn = nut('Lưu store Merchize cho tab này', '#607d8b');
    [baseInput, tokenInput, webhookInput, saveTokenBtn].forEach((x) => storeBox.appendChild(x));
    const tebBox = el('div', 'margin-bottom:4px;');
    const tebInput = el('input', oCss);
    tebInput.placeholder = 'Link sheet Teb (mở đúng tab rồi copy link) nếu tab này dùng Teb';
    const tebBtn = nut('Lưu sheet Teb cho tab này', '#6d4c41');
    [tebInput, tebBtn].forEach((x) => tebBox.appendChild(x));

    const catalogInfo = el('div', 'font-size:11px;color:#999;margin:4px 0 6px;');
    function capNhatCatalogInfo() {
      const c = docCatalogDaLuu();
      catalogInfo.textContent = c
        ? `Catalog: ${Object.keys(c.products).length} sản phẩm, cập nhật ${new Date(c.updated).toLocaleString()}`
        : 'Catalog: chưa có';
    }
    capNhatCatalogInfo();

    const catalogBtn = nut('1. Cập nhật catalog', '#2196F3');
    // Muc rieng khi bam "1. Cap nhat catalog": tai catalog + 2 danh sach (loai ao them, ghep Teb).
    const catalogBox = el('div', 'display:none;border:1px solid #bbdefb;border-radius:6px;padding:8px;margin-bottom:8px;background:#f5faff;');
    const taiCatalogBtn = nut('Tải catalog từ Merchize', '#1976d2');
    const oNho = 'flex:1;min-width:0;box-sizing:border-box;padding:5px;border:1px solid #ccc;border-radius:4px;font-size:12px;';
    const nutNho = (text, mau) => el('button', `padding:5px 8px;background:${mau};color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;`, text);
    // 1 danh sach: tieu de, cac dong "a → b [Xoá]", 2 o nhap + nut Them.
    function taoDanhSach(tieuDe, goiY1, goiY2, docDs, them, xoa) {
      const khung = el('div', 'margin-top:8px;');
      khung.appendChild(el('div', 'font-size:12px;font-weight:bold;margin-bottom:4px;', tieuDe));
      const ds = el('div', '');
      const hang = el('div', 'display:flex;gap:4px;margin-top:4px;');
      const o1 = el('input', oNho);
      o1.placeholder = goiY1;
      const o2 = el('input', oNho);
      o2.placeholder = goiY2;
      const nutThem = nutNho('Thêm', '#43a047');
      [o1, o2, nutThem].forEach((x) => hang.appendChild(x));
      [ds, hang].forEach((x) => khung.appendChild(x));
      function ve() {
        while (ds.firstChild) ds.removeChild(ds.firstChild);
        const muc = docDs();
        if (!muc.length) ds.appendChild(el('div', 'font-size:12px;color:#999;', '(chưa có)'));
        muc.forEach(([a, b], i) => {
          const d = el('div', 'display:flex;align-items:center;gap:6px;font-size:12px;padding:2px 0;border-bottom:1px dashed #ddd;');
          d.appendChild(el('span', 'flex:1;', `${a} → ${b}`));
          const x = nutNho('Xoá', '#e53935');
          x.addEventListener('click', () => { xoa(i); ve(); });
          d.appendChild(x);
          ds.appendChild(d);
        });
      }
      nutThem.addEventListener('click', () => {
        try {
          them(str(o1.value), str(o2.value));
          o1.value = '';
          o2.value = '';
          ve();
          log(statusEl, '✅ Đã lưu. Bấm "2. Kiểm tra" để áp dụng.');
        } catch (e) {
          log(statusEl, '❌ ' + e.message);
        }
      });
      return { khung, ve, o2 };
    }
    const dsLoaiAo = taoDanhSach('Loại áo thêm (từ khóa trong title → mã sản phẩm Merchize)', 'từ khóa, vd gildan youth', 'mã, vd 5000BUS',
      () => docLoaiAoThem().map((x) => [x.tu.join(' '), x.ma]),
      (a, b) => {
        const tu = a.toLowerCase().split(/\s+/).map((w) => w.replace(/[^a-z]/g, '')).filter(Boolean);
        if (!tu.length || !/^[A-Za-z0-9-]+$/.test(b)) throw new Error('Nhập từ khóa (chữ) và mã sản phẩm Merchize (vd 5000BUS).');
        const ds = docLoaiAoThem().filter((x) => x.tu.join(' ') !== tu.join(' '));
        ds.push({ tu, ma: b.toUpperCase() });
        luuLoaiAoThem(ds);
      },
      (i) => { const ds = docLoaiAoThem(); ds.splice(i, 1); luuLoaiAoThem(ds); });
    const dsGhepTeb = taoDanhSach('Ghép Teb (title trên Sheet → STYLE CODE cột D trong SKU LIST)', 'title, vd Comfort Adult', 'STYLE CODE',
      () => Object.entries(docGhepTeb()),
      (a, b) => {
        if (!a || !b) throw new Error('Nhập title và STYLE CODE.');
        const g = docGhepTeb();
        g[a.toLowerCase()] = b;
        luuGhepTeb(g);
      },
      (i) => { const g = docGhepTeb(); delete g[Object.keys(g)[i]]; luuGhepTeb(g); });
    // Goi y STYLE CODE da doc tu SKU LIST (lan Kiem tra / Gui don gan nhat).
    const goiYStyle = el('datalist', '');
    goiYStyle.id = 'mz-teb-styles';
    dsGhepTeb.o2.setAttribute('list', goiYStyle.id);
    function veGoiYStyle() {
      while (goiYStyle.firstChild) goiYStyle.removeChild(goiYStyle.firstChild);
      let styles = [];
      try { styles = JSON.parse(GM_getValue('mz_teb_styles', '[]')) || []; } catch (e) { /* bo qua */ }
      styles.forEach((v) => { const o = el('option', ''); o.value = v; goiYStyle.appendChild(o); });
    }
    [taiCatalogBtn, dsLoaiAo.khung, dsGhepTeb.khung, goiYStyle].forEach((x) => catalogBox.appendChild(x));
    const checkBtn = nut('2. Kiểm tra (điền SKU, chưa gửi)', '#8e24aa');
    const sendBtn = nut('3. Gửi đơn (Merchize + sheet Teb)', '#4CAF50');
    const workerBtn = nut('Cài Worker (link + key, 1 lần)', '#455a64');


    const statusEl = el('pre', 'white-space:pre-wrap;margin-top:8px;max-height:280px;overflow:auto;font-size:12px;color:#333;');

    [storeInfo, storeBox, tebInfo, tebBox, catalogInfo, catalogBtn, catalogBox, checkBtn, sendBtn, workerBtn, statusEl]
      .forEach((x) => panel.appendChild(x));
    document.body.appendChild(btn);

    // Vi tri da luu co the nam ngoai man hinh (cua so nho hon luc keo tha) -> keo ve trong man hinh.
    function giuNutTrongManHinh() {
      if (btn.style.left === '' || btn.style.left === 'auto') return;
      const r = btn.getBoundingClientRect();
      const left = Math.min(Math.max(0, r.left), Math.max(0, window.innerWidth - btn.offsetWidth));
      const top = Math.min(Math.max(0, r.top), Math.max(0, window.innerHeight - btn.offsetHeight));
      if (left !== r.left || top !== r.top) Object.assign(btn.style, { left: left + 'px', top: top + 'px' });
    }
    function datLaiViTriNut() {
      try { localStorage.removeItem(POS_STORAGE_KEY); } catch (e) { /* bo qua */ }
      Object.assign(btn.style, { left: 'auto', top: 'auto', right: '24px', bottom: '80px' });
    }
    giuNutTrongManHinh();
    window.addEventListener('resize', giuNutTrongManHinh);
    try {
      GM_registerMenuCommand('Hiện lại nút Merchize (góc phải dưới)', datLaiViTriNut);
      GM_registerMenuCommand('Cài / đổi Worker (link + key)', () => {
        panel.style.display = 'block';
        repositionPanel();
        chay(caiWorkerVaHien);
      });
    } catch (e) { /* bo qua */ }
    document.body.appendChild(panel);

    function repositionPanel() {
      const rect = btn.getBoundingClientRect();
      let left = Math.min(rect.left, window.innerWidth - PANEL_WIDTH - 8);
      panel.style.left = Math.max(8, left) + 'px';
      if (window.innerHeight - rect.bottom >= 380 || rect.top < 380) {
        panel.style.top = (rect.bottom + 8) + 'px';
        panel.style.bottom = 'auto';
      } else {
        panel.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
        panel.style.top = 'auto';
      }
    }

    // Keo tha nut, nho vi tri qua localStorage.
    let dragMoved = false;
    let sx = 0, sy = 0, sl = 0, st = 0;
    function onMove(e) {
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      if (!dragMoved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) dragMoved = true;
      if (!dragMoved) return;
      e.preventDefault();
      const left = Math.min(Math.max(0, sl + dx), window.innerWidth - btn.offsetWidth);
      const top = Math.min(Math.max(0, st + dy), window.innerHeight - btn.offsetHeight);
      Object.assign(btn.style, { left: left + 'px', top: top + 'px', right: 'auto', bottom: 'auto' });
      if (panel.style.display !== 'none') repositionPanel();
    }
    function onUp() {
      btn.style.cursor = 'grab';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (dragMoved) {
        const r = btn.getBoundingClientRect();
        try { localStorage.setItem(POS_STORAGE_KEY, JSON.stringify({ left: r.left, top: r.top })); } catch (e) { /* bo qua */ }
      }
    }
    btn.addEventListener('mousedown', (e) => {
      dragMoved = false;
      sx = e.clientX; sy = e.clientY;
      const r = btn.getBoundingClientRect();
      sl = r.left; st = r.top;
      btn.style.cursor = 'grabbing';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    btn.addEventListener('click', () => {
      if (dragMoved) { dragMoved = false; return; }
      const show = panel.style.display === 'none';
      panel.style.display = show ? 'block' : 'none';
      if (show) {
        repositionPanel();
        tabDaHien = null;
        capNhatStoreTheoTab();
      }
    });

    const tatCaNut = [saveTokenBtn, tebBtn, catalogBtn, taiCatalogBtn, checkBtn, sendBtn, workerBtn];
    async function chay(task) {
      tatCaNut.forEach((b) => { b.disabled = true; });
      try {
        log(statusEl, '✅ ' + await task());
      } catch (e) {
        log(statusEl, '❌ Lỗi: ' + e.message);
        console.error('[Merchize]', e);
      } finally {
        tatCaNut.forEach((b) => { b.disabled = false; });
        capNhatCatalogInfo();
      }
    }

    // Tab da cai store (va sheet Teb neu dung Teb) thi chi hien dong ✅, bam vao dong de hien o sua.
    let moSuaStore = false;
    let moSuaTeb = false;
    let dangDongBo = false;
    const daHoiTenTeb = new Set();
    function hienStore(title) {
      const st = layStore(title);
      const teb = docCacSheetTeb()[title];
      const canTeb = laTabTeb(title);
      storeInfo.textContent = st
        ? `✅ Tab "${title}": ${tenStore(st)} (đã có token)`
        : `❌ Tab "${title}": chưa có store Merchize`;
      storeInfo.style.color = st ? '#2e7d32' : '#c62828';
      storeBox.style.display = !st || moSuaStore ? 'block' : 'none';
      tebInfo.textContent = teb ? `✅ Sheet Teb: ${teb.fileTitle || teb.sheetTitle}`
        : canTeb ? '❌ Chưa chọn sheet Teb' : 'Tab này chưa dùng Teb, mọi đơn gửi Merchize (bấm để chọn sheet Teb)';
      tebInfo.style.color = teb ? '#2e7d32' : canTeb ? '#c62828' : '#777';
      tebInfo.style.display = 'block';
      // Tab chua dung Teb: o link Teb hien cung o sua store (de them Teb khi can).
      tebBox.style.display = (canTeb && !teb) || moSuaTeb || !st || moSuaStore ? 'block' : 'none';
      tebInput.placeholder = teb
        ? `Đang dùng: ${teb.fileTitle || teb.sheetTitle} / ${teb.sheetTitle} (dán link mới để đổi, để trống rồi bấm Lưu để bỏ)`
        : 'Link sheet Teb (mở đúng tab rồi copy link) nếu tab này dùng Teb';
      if (document.activeElement !== baseInput) baseInput.value = st ? st.baseUrl : '';
      workerBtn.style.display = docWorker() ? 'none' : 'block';
      if (st) thuLayTenStore(st, () => { if (tabDaHien === title) hienStore(title); });
      // File Teb luu tu ban cu chua co ten file: nho Worker lay ten (gui lai sheet Teb len Worker),
      // chua cai Worker thi lay bang Google cua ban (chi khi da dang nhap, khong bat popup).
      if (teb && !teb.fileTitle && docWorker() && !dangDongBo && !daHoiTenTeb.has(title)) {
        daHoiTenTeb.add(title);
        dangDongBo = true;
        dongBoWorker(title, { teb: { spreadsheetId: teb.spreadsheetId, sheet: teb.sheetTitle } })
          .then(() => { if (tabDaHien === title) hienStore(title); })
          .finally(() => { dangDongBo = false; });
      } else if (teb && !teb.fileTitle && !docWorker() && accessToken) {
        sheetsApiFetch(`${teb.spreadsheetId}?fields=properties.title`, { method: 'GET' }).then((d) => {
          const all = docCacSheetTeb();
          if (!all[title] || !d.properties) return;
          all[title].fileTitle = str(d.properties.title);
          GM_setValue('mz_teb_targets', JSON.stringify(all));
          if (tabDaHien === title) hienStore(title);
        }).catch(() => {});
      }
      // Tab chua gui (hoac da doi) cau hinh len Worker: tu gui ngam.
      if (!dangDongBo && canDongBo(title)) {
        dangDongBo = true;
        dongBoTabNay(title).then((kq) => { if (/⚠️/.test(kq)) log(statusEl, kq); }).catch(() => {}).finally(() => { dangDongBo = false; });
      }
      return storeInfo.textContent;
    }

    async function xemStore() {
      const { title } = await layTrangTinhDangMo();
      return hienStore(title);
    }

    // Tu cap nhat dong trang thai store khi doi tab (kiem tra moi 0.5 giay khi panel dang mo).
    let tabDaHien = null;
    function capNhatStoreTheoTab() {
      if (panel.style.display === 'none') return;
      const ten = tenTabNhanh();
      if (!ten) {
        if (tabDaHien === null) {
          storeInfo.textContent = 'Bấm vào đây để kiểm tra store của tab.';
          storeInfo.style.color = '#777';
        }
        return;
      }
      if (ten === tabDaHien) return;
      tabDaHien = ten;
      moSuaStore = false;
      moSuaTeb = false;
      hienStore(ten);
    }
    setInterval(capNhatStoreTheoTab, 500);
    window.addEventListener('hashchange', capNhatStoreTheoTab);

    storeInfo.addEventListener('click', () => {
      if (!tabDaHien) { chay(xemStore); return; }
      moSuaStore = !moSuaStore;
      hienStore(tabDaHien);
    });
    tebInfo.addEventListener('click', () => {
      if (!tabDaHien) return;
      moSuaTeb = !moSuaTeb;
      hienStore(tabDaHien);
    });
    // Trong luc luu, tat tu dong bo (tranh 2 lan ghi cau hinh len Worker cung luc).
    const khongTuDongBo = (fn) => async () => {
      dangDongBo = true;
      try { return await fn(); } finally { dangDongBo = false; }
    };
    tebBtn.addEventListener('click', () => chay(khongTuDongBo(async () => {
      const kq = await luuSheetTeb(tebInput.value);
      tebInput.value = '';
      moSuaTeb = false;
      const { title } = await layTrangTinhDangMo();
      await xemStore();
      if (kq === 'Đã hủy.' || !layStore(title)) return kq;
      const teb = docCacSheetTeb()[title];
      const dong = await dongBoWorker(title, { teb: teb ? { spreadsheetId: teb.spreadsheetId, sheet: teb.sheetTitle } : null });
      return [kq, ...dong].join('\n');
    })));
    saveTokenBtn.addEventListener('click', () => chay(khongTuDongBo(async () => {
      const baseUrl = chuanHoaBaseUrl(baseInput.value);
      if (!baseUrl) throw new Error('Base URL không đúng dạng https://....merchize.com/<store>/bo-api');
      const { title } = await layTrangTinhDangMo();
      const cu = layStore(title);
      const token = str(tokenInput.value) || (cu && cu.token) || '';
      if (!token) throw new Error('Chưa dán Access Token.');
      if (cu && cu.baseUrl !== baseUrl && !str(tokenInput.value)) {
        throw new Error('Đổi Base URL thì phải dán lại Access Token của store mới.');
      }
      luuStore(title, baseUrl, token);
      tokenInput.value = '';
      const webhookKey = str(webhookInput.value);
      webhookInput.value = '';
      moSuaStore = false;
      await xemStore();
      const teb = docCacSheetTeb()[title];
      const dong = await dongBoWorker(title, {
        store: { baseUrl, token, ...(webhookKey ? { webhookKey } : {}) },
        ...(teb ? { teb: { spreadsheetId: teb.spreadsheetId, sheet: teb.sheetTitle } } : {})
      });
      return [`Đã lưu store cho tab "${title}".`, ...dong].join('\n');
    })));
    catalogBtn.addEventListener('click', () => {
      const mo = catalogBox.style.display === 'none';
      catalogBox.style.display = mo ? 'block' : 'none';
      if (mo) { dsLoaiAo.ve(); dsGhepTeb.ve(); veGoiYStyle(); }
    });
    taiCatalogBtn.addEventListener('click', () => chay(() => capNhatCatalog(statusEl)));
    checkBtn.addEventListener('click', () => chay(() => kiemTraHoacGui(statusEl, false)));
    sendBtn.addEventListener('click', () => chay(() => kiemTraHoacGui(statusEl, true)));
    const caiWorkerVaHien = async () => {
      const kq = await caiWorker();
      if (tabDaHien) hienStore(tabDaHien);
      return kq;
    };
    workerBtn.addEventListener('click', () => chay(caiWorkerVaHien));
  }

  function safeInit() {
    try {
      buildUi();
    } catch (e) {
      console.error('[Merchize] Lỗi khi tạo giao diện:', e);
    }
  }

  if (document.body) safeInit();
  else document.addEventListener('DOMContentLoaded', safeInit);
})();
