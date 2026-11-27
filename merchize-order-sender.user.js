// ==UserScript==
// @name         Google Sheets - Gui don len Merchize
// @namespace    gsheet-merchize-order-sender
// @version      1.71
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
// @connect      raw.githubusercontent.com
// @updateURL    https://raw.githubusercontent.com/tempohie-spec/etsy/main/merchize-order-sender.user.js
// @downloadURL  https://raw.githubusercontent.com/tempohie-spec/etsy/main/merchize-order-sender.user.js
// @grant        GM_openInTab
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ====== CAU HINH ======
  const SCRIPT_VERSION = '1.71';
  // Link ban moi nhat tren GitHub (nhanh main). Nhanh bi xoa / doi ten thi sua link nay va 2 dong
  // @updateURL / @downloadURL o dau file.
  const LINK_CAP_NHAT = 'https://raw.githubusercontent.com/tempohie-spec/etsy/main/merchize-order-sender.user.js';
  // Gui don / dien cost chi doc 200 dong cuoi cua tab (nhanh hon voi tab dai).
  const SO_DONG_CUOI = 200;
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
  
  // Gui thanh cong: AC ghi ten nha cung cap (Merchize / ZooTop).
  const STATUS_SENT = 'Merchize';
  const STATUS_ERROR_PREFIX = 'Lỗi: ';

  // Quy doi loai ao (cot title, viet kieu nao cung duoc: "Comfort-Adult Tee", "Comfort Adult",
  // "Comfort-AdultTee"...) sang ma san pham Merchize. Thu tu quan trong: toddler va
  // sweatshirt/hoodie phai xet truoc vi title cua chung cung co the chua chu "adult".
  // Sweatshirt/hoodie tre em chua co trong bang -> tra ve null de bao loi, khong gui nham size nguoi lon.
  function xacDinhMaSanPham(title) {
    const t = String(title || '').toLowerCase().replace(/[^a-z]/g, '');
    // Gildan (co dinh): youth -> 500BUS, adult -> 5000US.
    if (t.includes('gildan') && t.includes('youth')) return '500BUS';
    if (t.includes('gildan') && t.includes('adult')) return '5000US';
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
  const MA_SAN_PHAM = ['3001US', '301YUS', '1717US', '1717AU', '9018US', '3321US', '1800US', '1850US', '500BUS', '5000US'];

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

  // ============ DONG BO LEN WORKER (khoi sua bien STORES tren Cloudflare) ============
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

  // Gui store + sheet ZooTop cua tab len Worker. phan: { store?, zootop? } (null = xoa). Tra ve cac dong bao cao.
  async function dongBoWorker(title, phan) {
    if (!docWorker()) return ['(Chưa cài Worker nên Worker chưa biết tab này. Bấm "Cài Worker" rồi "Đồng bộ tab này lên Worker".)'];
    try {
      const kq = await goiWorker('POST', '/config', { spreadsheetId: getSpreadsheetId(), sheet: title, ...phan });
      danhDauDaDongBo(title);
      const dong = [`Worker: đã cập nhật "${kq.khoa}".`];
      if (kq.quyenSheet && kq.quyenSheet !== 'ok') dong.push(`⚠️ Worker chưa vào được file này: ${kq.quyenSheet}. Hãy share file này cho ${kq.serviceAccount} (quyền Editor).`);
      if (kq.quyenZooTop && kq.quyenZooTop !== 'ok') dong.push(`⚠️ Worker chưa đọc được sheet ZooTop: ${kq.quyenZooTop}. Hãy share file ZooTop cho ${kq.serviceAccount} (quyền xem là đủ).`);
      return dong;
    } catch (e) {
      return ['⚠️ Chưa đồng bộ được lên Worker: ' + e.message];
    }
  }

  // Chu ky cau hinh cua tab (store + sheet ZooTop) da gui len Worker, de tu dong bo khi con thieu.
  function chuKyTab(title) {
    const st = layStore(title);
    const zoo = docCacSheetZooTop()[title];
    return [getSpreadsheetId(), st ? st.baseUrl + st.token.slice(-6) : '', zoo ? zoo.spreadsheetId + zoo.sheetTitle : ''].join('|');
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

  // So sanh "1.53" voi "1.9": theo tung so.
  function banMoiHon(a, b) {
    const x = String(a).split('.').map(Number);
    const y = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    }
    return false;
  }

  // Nut Cap nhat: doc ban moi nhat tren GitHub, moi hon thi mo link de Violentmonkey hien hop cai dat.
  function kiemTraCapNhat() {
    return new Promise((resolve, reject) => {
      const url = `${LINK_CAP_NHAT}?_=${Date.now()}`;
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: 30000,
        onload: (res) => {
          const m = String(res.responseText || '').match(/@version\s+([0-9.]+)/);
          if (res.status !== 200 || !m) { reject(new Error(`Không đọc được bản mới trên GitHub (mã ${res.status}).`)); return; }
          const moi = m[1];
          if (!banMoiHon(moi, SCRIPT_VERSION)) { resolve(`Đang dùng bản mới nhất (v${SCRIPT_VERSION}).`); return; }
          try { GM_openInTab(url, { active: true }); } catch (e) { W.open(url, '_blank'); }
          resolve(`Có bản mới v${moi} (đang dùng v${SCRIPT_VERSION}). Một tab mới đã mở: bấm "Xác nhận cài đặt" / "Confirm installation" của Violentmonkey rồi tải lại trang Google Sheet. Nếu không thấy tab mới, hãy cho phép cửa sổ bật lên.`);
        },
        onerror: () => reject(new Error('Không kết nối được tới GitHub.')),
        ontimeout: () => reject(new Error('GitHub không phản hồi.'))
      });
    });
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
    const zoo = docCacSheetZooTop()[title];
    const dong = await dongBoWorker(title, {
      store: { baseUrl: st.baseUrl, token: st.token },
      zootop: zoo ? { spreadsheetId: zoo.spreadsheetId, sheet: zoo.sheetTitle } : null
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
      const q = `?limit=50&page=${page}&search=${encodeURIComponent(MA_SAN_PHAM.join(','))}`;
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

    const thieu = MA_SAN_PHAM.filter((m) => !catalog.products[m]);
    GM_setValue('mz_catalog', JSON.stringify(catalog));
    return [
      `Đã lưu catalog ${Object.keys(catalog.products).length} sản phẩm:`,
      ...baoCao,
      thieu.length ? `⚠️ Không tìm thấy trên Merchize: ${thieu.join(', ')}` : ''
    ].join('\n');
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
    if (!sp) return { loi: `catalog chưa có ${maSp}, bấm "Cập nhật catalog Merchize"` };
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
  // SKU tu dien san o cot AB (dong cho gui): ep dong do dung SKU nay. Nha cung cap theo SKU: co trong bang
  // ZooTop -> ZooTop, co trong catalog Merchize -> Merchize; SKU la thi can "#ZooTop" / "#Merchize" o AC.
  function bangSkuDaBiet(bangZoo, catalog) {
    const zoo = new Set(bangZoo ? Object.values(bangZoo).concat(Object.values(bangZoo.quocTe || {})) : []);
    const mz = new Set();
    Object.values((catalog && catalog.products) || {}).forEach((p) => Object.values(p.variants || {}).forEach((v) => mz.add(v.sku)));
    return { zoo, mz };
  }

  // Chi dinh nha cung cap: go "#ZooTop" / "#Merchize" vao cot AC truoc khi gui. Don nay van la
  // don cho gui, va chi di dung nha cung cap do (khong tim duoc SKU thi bao loi, khong tu doi ben).
  function chiDinhNcc(st) {
    // Dau '#' (go '@' trong Google Sheets hay bat menu smart chip); '@' cu van duoc nhan cho dong da danh dau.
    const m = str(st).match(/^[#@]\s*(merchize|zootop)$/i);
    return m ? { merchize: 'Merchize', zootop: 'ZooTop' }[m[1].toLowerCase()] : '';
  }

  function gomDon(rows) {
    const daGui = new Set();
    rows.slice(1).forEach((r) => {
      const ma = cell(r, COL.orderNumber);
      if (ma && cell(r, COL.status) && !chiDinhNcc(cell(r, COL.status))) daGui.add(ma);
    });

    const donMap = new Map();
    rows.forEach((r, i) => {
      if (i === 0) return;
      const ma = cell(r, COL.orderNumber);
      const st = cell(r, COL.status);
      const cd = chiDinhNcc(st);
      if (!ma || (st && !cd)) return;
      if (!donMap.has(ma)) donMap.set(ma, { orderNumber: ma, rows: [], daGuiTruoc: daGui.has(ma), chiDinh: '' });
      const d = donMap.get(ma);
      d.rows.push({ rowNumber: i + 1, r });
      if (cd && !d.chiDinh) d.chiDinh = cd;
    });
    return Array.from(donMap.values());
  }

  // Kiem tra + dung payload cho 1 don. Tra ve { payload, skus, loi[] }.
  function dungDon(don, catalog, tenTab) {
    const loi = [];
    const skus = [];
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
      // SKU tu dien o cot AB: gui dung SKU do, khong tra catalog.
      const skuTayDong = (don.skuTay || [])[idx] || '';
      const tra = skuTayDong ? { sku: skuTayDong } : traSku(catalog, title, color, size, cell(first, COL.country));
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
      payload: { order_id: don.orderNumber, identifier, shipping_info: shipping, items }
    };
  }

  // Luu sheet dich (ZooTop) cho tab dang mo tu link co #gid=. Link trong = bo dung.
  async function luuSheetDich(link, khoaGm, ten) {
    const { title } = await layTrangTinhDangMo();
    const docAll = () => { try { return JSON.parse(GM_getValue(khoaGm, '{}')) || {}; } catch (e) { return {}; } };
    if (!str(link)) {
      const all = docAll();
      if (!all[title]) throw new Error(`Chưa dán link sheet ${ten}.`);
      if (!W.confirm(`Bỏ dùng ${ten} cho tab "${title}"?`)) return 'Đã hủy.';
      delete all[title];
      GM_setValue(khoaGm, JSON.stringify(all));
      return `Tab "${title}" không còn dùng ${ten}.`;
    }
    const m = str(link).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!m) throw new Error('Link không phải link Google Sheet.');
    const g = str(link).match(/gid=(\d+)/);
    const gid = g ? Number(g[1]) : 0;
    const data = await sheetsApiFetch(`${m[1]}?fields=properties.title,sheets.properties`, { method: 'GET' });
    const p = (data.sheets || []).map((x) => x.properties).find((x) => x.sheetId === gid);
    if (!p) throw new Error('Không tìm thấy tab trong link (link cần có #gid=...).');
    const tenFile = str((data.properties || {}).title);
    const all = docAll();
    all[title] = { spreadsheetId: m[1], sheetTitle: p.title, fileTitle: tenFile };
    GM_setValue(khoaGm, JSON.stringify(all));
    return `Đã chọn sheet ${ten} cho tab "${title}": file "${tenFile}", tab "${p.title}".`;
  }

  // ============ ZOOTOP (fulfill rieng cho cac tab da gan sheet fulfill ZooTop) ============
  // Don cua tab da gan sheet ZooTop: moi dong tim duoc SKU trong bang SKU ZooTop thi ca don di ZooTop
  // (uu tien hon Merchize), moi san pham 1 dong tren sheet fulfill.
  const STATUS_ZOOTOP = 'ZooTop';
  // Bang SKU cho don NGOAI US (tra truoc cac bang khac): cot B "G5000-DTG" (ma loai ao - kieu in),
  // E Color, F Size, H SKU. Don ngoai US chi nhan SKU bat dau bang G hoac C (ma UT... chi di trong US).
  const ZOOTOP_QT = { file: '1mCPCCleDu4GuYZhmWr_-BAPdkUiuhvo2rqKYk9hELtI', gid: 1986553200, cot: { loai: 1, color: 4, size: 5, sku: 7 } };
  // Title tren Sheet -> ma loai ao trong bang quoc te.
  // (hoodie / sweatshirt dat truoc de title "Gildan Adult Hoodie" khong bi nhan nham la gildan adult).
  const ZOOTOP_QT_MA = { 'adult hoodie': 'G18500', 'adult sweatshirt': 'G18000', 'gildan adult': 'G5000', 'comfort adult': 'C1717' };
  const skuDiNgoaiUs = (sku) => /^[GC]/i.test(str(sku));
  // shipping_type ghi vao cot D sheet fulfill: 'PLATFORM' hoac 'SELLER'.
  const ZOOTOP_SHIPPING_TYPE = 'SELLER';
  const ZOOTOP_FILE_SKU = '1mCPCCleDu4GuYZhmWr_-BAPdkUiuhvo2rqKYk9hELtI';
  // 3 tab trong file SKU ZooTop (theo gid): cot 0-based cua Product Name / Type / Color / Size / SKU.
  // Tab khong co cot Type thi dung phuong phap in co dinh (pm).
  const ZOOTOP_BANG_SKU = [
    { gid: 193554855, cot: { product: 8, type: 10, color: 11, size: 12, sku: 13 } },
    { gid: 1487135370, pm: 'DTF', cot: { product: 1, color: 4, size: 5, sku: 6 } },
    { gid: 2135860525, pm: 'DTG', cot: { product: 1, color: 4, size: 5, sku: 6 } }
  ];
  // Title tren Sheet -> Product Name trong file SKU ZooTop, theo phuong phap in (cot A).
  const ZOOTOP_TEN = {
    'gildan adult': { DTG: 'Gildan Unisex T-Shirt 5000', DTF: 'Gildan Unisex T-Shirt 5000' },
    'comfort adult': { DTG: 'Comfort Colors Unisex T-Shirt 1717', DTF: 'Comfort Colors Unisex T-Shirt 1717' },
    'adult hoodie': { DTF: 'Hoodie2D - G18500 | Gildan-18500', DTG: 'Hoodie2D - G18500 | Gildan-18500 (DTG)' },
    'adult sweatshirt': { DTF: 'Sweater2D - G18000 | Gildan-18000', DTG: 'Sweater2D - G18000 | Gildan-18000 (DTG)' },
    'bella adult': { DTF: 'TShirt2D - BC3001 | Bella+Canvas-3001', DTG: 'TShirt2D - BC3001 | Bella+Canvas-3001 (DTG)' },
    'gildan youth': { DTF: 'TShirt2D - G5000B | Gildan-5000B', DTG: 'TShirt2D - G5000B | Gildan-5000B (DTG)' }
  };
  const chuanTen = (v) => str(v).toLowerCase().replace(/\s+/g, ' ');
  // Tim theo title khong can khop tuyet doi: bo dau / ky tu la roi xem title co chua ten loai ao khong
  // (vd "Comfort-Adult Tee" van la "comfort adult").
  const chiChu = (v) => str(v).toLowerCase().replace(/[^a-z]/g, '');
  function timTheoTitle(bang, title) {
    const t = chiChu(title);
    const khoa = Object.keys(bang).find((k) => t.includes(chiChu(k)));
    return khoa === undefined ? undefined : bang[khoa];
  }
  const phuongPhapIn = (v) => (/DTG/i.test(str(v)) ? 'DTG' : /DTF/i.test(str(v)) ? 'DTF' : '');
  const khoaZooTop = (tenSp, pm, mau, size) => [chuanTen(tenSp), pm, chuanHoaMau(mau), chuanHoaSize(size)].join('|');

  // Sheet fulfill ZooTop cua tung tab: { "<tab>": { spreadsheetId, sheetTitle, fileTitle } }.
  function docCacSheetZooTop() {
    try { return JSON.parse(GM_getValue('mz_zootop_targets', '{}')) || {}; } catch (e) { return {}; }
  }

  // Doc 3 tab SKU cua ZooTop -> { "ten sp|pm|mau|size": SKU }.
  async function docBangZooTop() {
    const meta = await sheetsApiFetch(`${ZOOTOP_FILE_SKU}?fields=sheets.properties(sheetId,title)`, { method: 'GET' })
      .catch((e) => { throw new Error('Không đọc được file SKU ZooTop: ' + e.message.slice(0, 150)); });
    const tenTab = {};
    (meta.sheets || []).forEach((x) => { tenTab[x.properties.sheetId] = x.properties.title; });
    const bang = ZOOTOP_BANG_SKU.filter((b) => tenTab[b.gid] !== undefined);
    if (!bang.length) throw new Error('File SKU ZooTop không có các tab SKU (gid) đã khai báo.');
    const q = bang.map((b) => 'ranges=' + encodeURIComponent(`'${tenTab[b.gid]}'`)).join('&');
    const data = await sheetsApiFetch(`${ZOOTOP_FILE_SKU}/values:batchGet?${q}&valueRenderOption=FORMATTED_VALUE`, { method: 'GET' });
    const sku = {};
    // Chan doan: san pham nao (theo pm) co trong file SKU, va moi tab doc duoc bao nhieu SKU.
    const sanPham = {};
    const soSku = {};
    (data.valueRanges || []).forEach((vr, i) => {
      const b = bang[i];
      soSku[tenTab[b.gid]] = 0;
      (vr.values || []).forEach((r) => {
        const pm = b.pm || phuongPhapIn(r[b.cot.type]);
        const ma = str(r[b.cot.sku]);
        if (pm && ma && str(r[b.cot.product]) && chuanTen(r[b.cot.product]) !== 'product name') {
          sku[khoaZooTop(r[b.cot.product], pm, r[b.cot.color], r[b.cot.size])] = ma;
          sanPham[pm + '|' + chuanTen(r[b.cot.product])] = true;
          soSku[tenTab[b.gid]]++;
        }
      });
    });
    // Bang quoc te (don ngoai US): "ma loai|pm|mau|size" -> SKU.
    const quocTe = {};
    try {
      const metaQt = await sheetsApiFetch(`${ZOOTOP_QT.file}?fields=sheets.properties(sheetId,title)`, { method: 'GET' });
      const p = (metaQt.sheets || []).map((x) => x.properties).find((x) => x.sheetId === ZOOTOP_QT.gid);
      if (p) {
        const d = await sheetsApiFetch(`${ZOOTOP_QT.file}/values/${encodeURIComponent(`'${p.title}'`)}?valueRenderOption=FORMATTED_VALUE`, { method: 'GET' });
        soSku[`${p.title} (quốc tế)`] = 0;
        (d.values || []).forEach((r) => {
          // Cot B: "G5000-DTG" / "C1717-DTF" / "G5000" (khong hau to = DTF).
          const loai = str(r[ZOOTOP_QT.cot.loai]);
          const m = loai.match(/^(.+?)-(DTG|DTF)$/i) || (/^[A-Za-z]+\d+$/.test(loai) ? [loai, loai, 'DTF'] : null);
          const ma = str(r[ZOOTOP_QT.cot.sku]);
          if (!m || !ma) return;
          quocTe[[m[1].toUpperCase(), m[2].toUpperCase(), chuanHoaMau(r[ZOOTOP_QT.cot.color]), chuanHoaSize(r[ZOOTOP_QT.cot.size])].join('|')] = ma;
          soSku[`${p.title} (quốc tế)`]++;
        });
      }
    } catch (e) {
      soSku['bảng quốc tế'] = 'lỗi: ' + e.message.slice(0, 80);
    }
    Object.defineProperty(sku, 'chanDoan', { value: { sanPham, soSku }, enumerable: false });
    Object.defineProperty(sku, 'quocTe', { value: quocTe, enumerable: false });
    return sku;
  }

  // SKU ZooTop cua 1 dong (rong neu khong co). Don ngoai US: bang quoc te truoc, roi cac bang khac,
  // va chi nhan SKU bat dau bang G / C.
  function zootopSkuDong(r, bangZoo, r0 = r) {
    const pm = phuongPhapIn(cell(r, COL.printingMethod));
    if (!pm) return '';
    const tenSp = (timTheoTitle(ZOOTOP_TEN, cell(r, COL.title)) || {})[pm];
    const skuThuong = tenSp ? bangZoo[khoaZooTop(tenSp, pm, cell(r, COL.color), cell(r, COL.size))] || '' : '';
    if (maQuocGia(cell(r0, COL.country)) === 'US') return skuThuong;
    const maLoai = timTheoTitle(ZOOTOP_QT_MA, cell(r, COL.title));
    const skuQt = maLoai ? (bangZoo.quocTe || {})[[maLoai, pm, chuanHoaMau(cell(r, COL.color)), chuanHoaSize(cell(r, COL.size))].join('|')] || '' : '';
    return skuDiNgoaiUs(skuQt) ? skuQt : '';
  }

  // ============ BANG GIA ZOOTOP + GOI Y KIEU IN (goi y kieu in re hon cho tung don) ============
  const ZOOTOP_GIA = { file: '1rEn1FYVfS9RW8Of8mL-262vQj6GDehYPhfJD2wRSBD0', gid: 445207736 };
  // Cot (0-based) bang gia: C size, D tong DTF (ship by sellers), F tong DTG, H base DTF, I base DTG,
  // J phi mat 2 DTF, O ship them DTF, P phi mat 2 DTG, S ship them DTG.
  const GIA_COT = { size: 2, DTF: { tong: 3, base: 7, them2: 9, shipThem: 14 }, DTG: { tong: 5, base: 8, them2: 15, shipThem: 18 } };
  // Title tren Sheet -> ten san pham trong bang gia (dong Promotion cho Gildan 5000 va Comfort 1717).
  const GIA_TEN = {
    'adult hoodie': 'Gildan-18500',
    'adult sweatshirt': 'Gildan-18000',
    'gildan adult': 'Gildan-5000-Promotion',
    'comfort adult': 'Comfort Color Unisex - C1717-Promotion',
    'bella adult': 'Bella+Canvas-3001 (US)',
    'gildan youth': 'Gildan 5000B Youth T-Shirt'
  };
  // "$9,70" / "$1,234.50" -> so (null neu trong).
  function soUsd(v) {
    const t = str(v).replace(/[$\s]/g, '');
    if (!t) return null;
    const n = Number(/,/.test(t) && !/\.\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, ''));
    return isNaN(n) ? null : n;
  }
  // { "<ten san pham chuan hoa>": { "<size>": { DTF: {tong, base, them2, shipThem}, DTG: {...} } } }
  async function docBangGia() {
    const meta = await sheetsApiFetch(`${ZOOTOP_GIA.file}?fields=sheets.properties(sheetId,title)`, { method: 'GET' });
    const p = (meta.sheets || []).map((x) => x.properties).find((x) => x.sheetId === ZOOTOP_GIA.gid);
    if (!p) throw new Error('File bảng giá ZooTop không có tab đã khai báo (gid).');
    const d = await sheetsApiFetch(`${ZOOTOP_GIA.file}/values/${encodeURIComponent(`'${p.title}'`)}?valueRenderOption=FORMATTED_VALUE`, { method: 'GET' });
    const bang = {};
    let ten = '';
    (d.values || []).forEach((r, i) => {
      if (i === 0) return;
      if (str(r[0])) ten = chuanTen(r[0]);
      const size = chuanHoaSize(r[GIA_COT.size]);
      if (!ten || !size) return;
      const lay = (c) => Object.fromEntries(Object.entries(c).map(([k, idx]) => [k, soUsd(r[idx])]));
      (bang[ten] = bang[ten] || {})[size] = { DTF: lay(GIA_COT.DTF), DTG: lay(GIA_COT.DTG) };
    });
    return bang;
  }

  // Chi phi 1 don neu in het bang kieu `pm` ('DTF' | 'DTG'); null neu thieu gia / khong co san pham.
  // San pham dau: tong (da gom ship by sellers); san pham tiep theo: base + ship them; co design_back: + phi mat 2.
  function giaDonTheoKieu(don, pm, bangGia) {
    let tong = 0;
    let dauTien = true;
    for (const { r } of don.rows) {
      const tenSp = timTheoTitle(GIA_TEN, cell(r, COL.title));
      const g = tenSp && ((bangGia[chuanTen(tenSp)] || {})[chuanHoaSize(cell(r, COL.size))] || {})[pm];
      if (!g) return null;
      const sl = Math.max(1, parseInt(cell(r, COL.quantity), 10) || 1);
      for (let u = 0; u < sl; u++) {
        if (dauTien) { if (g.tong == null) return null; tong += g.tong; dauTien = false; }
        else { if (g.base == null || g.shipThem == null) return null; tong += g.base + g.shipThem; }
        if (laLink(cell(r, COL.designBack))) { if (g.them2 == null) return null; tong += g.them2; }
      }
    }
    return Math.round(tong * 100) / 100;
  }

  // Ban sao cua don voi cot A doi sang kieu in `pm`.
  const donDoiKieuIn = (don, pm) => ({ ...don, rows: don.rows.map(({ rowNumber, r }) => ({ rowNumber, r: Object.assign(r.slice(), { [COL.printingMethod]: pm }) })) });

  // Chon kieu in re nhat cho don trong cac kieu co gia (ung: [{ pm, gia }]). Tra ve { nen, tietKiem } hoac null neu don da o kieu re nhat
  // (hoac 2 kieu bang gia). Don dang in 1 kieu: tietKiem = chenh lech so voi kieu hien tai (null neu kieu hien tai khong co gia).
  function chonKieuRe(don, ung) {
    if (!ung.length) return null;
    if (ung.length > 1 && Math.abs(ung[0].gia - ung[1].gia) < 0.005) return null;
    const re = ung.slice().sort((a, b) => a.gia - b.gia)[0];
    const hienTai = new Set(don.rows.map(({ r }) => phuongPhapIn(cell(r, COL.printingMethod))));
    if (hienTai.size === 1 && hienTai.has(re.pm)) return null;
    const cur = hienTai.size === 1 ? ung.find((x) => hienTai.has(x.pm)) : null;
    return { nen: re, tietKiem: cur ? Math.round((cur.gia - re.gia) * 100) / 100 : null };
  }

  // Goi y cho cac don ZooTop tu tra SKU: doi sang kieu in re hon (DTG sang DTF hoac nguoc lai).
  function tinhGoiYKieuIn(dsDon, bangZoo, bangGia) {
    const kq = [];
    dsDon.forEach((d) => {
      if (!d.zooSkus || (d.skuTay && d.skuTay.some(Boolean))) return;
      const ung = ['DTG', 'DTF'].map((pm) => ({ pm, gia: giaDonTheoKieu(d, pm, bangGia), sku: zootopSkuCuaDon(donDoiKieuIn(d, pm), bangZoo) }))
        .filter((x) => x.gia != null && x.sku);
      if (!ung.length) return;
      const dtg = ung.find((x) => x.pm === 'DTG');
      const dtf = ung.find((x) => x.pm === 'DTF');
      const c = chonKieuRe(d, ung);
      if (!c) return;
      const hienTai = Array.from(new Set(d.rows.map(({ r }) => phuongPhapIn(cell(r, COL.printingMethod)) || '?'))).join('+');
      kq.push({ don: d, moi: c.nen.pm, hienTai, giaDtg: dtg ? dtg.gia : null, giaDtf: dtf ? dtf.gia : null, tietKiem: c.tietKiem, ncc: 'ZooTop' });
    });
    return kq;
  }

  // ============ GIA MERCHIZE THEO KIEU IN (file merchize-gia.json tren GitHub, tu 7 file SKU information cua Merchize) ============
  const LINK_GIA_MERCHIZE = 'https://raw.githubusercontent.com/tempohie-spec/etsy/main/merchize-gia.json';
  const NUOC_EU = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE']);
  const vungShipMerchize = (quocGia) => (quocGia === 'US' ? 'us' : NUOC_EU.has(quocGia) ? 'eu' : 'row');
  // { V: { "<SKU variant>": [base DTF, base DTG] }, P: { "<ma san pham 6 ky tu>": { us|eu|row: [phi ship san pham dau, phi them] } } }
  async function docBangGiaMerchize() {
    let cu = null;
    try { cu = JSON.parse(GM_getValue('mz_gia_merchize', 'null')); } catch (e) { cu = null; }
    if (cu && cu.luc && cu.data && Date.now() - cu.luc < 6 * 3600 * 1000) return cu.data;
    try {
      const data = await new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'GET',
          url: `${LINK_GIA_MERCHIZE}?_=${Date.now()}`,
          timeout: 30000,
          onload: (res) => {
            try {
              const j = JSON.parse(res.responseText);
              if (res.status === 200 && j && j.V && j.P) resolve(j); else reject(new Error(`Không đọc được bảng giá Merchize trên GitHub (mã ${res.status}).`));
            } catch (e) { reject(new Error('Bảng giá Merchize trên GitHub không đọc được.')); }
          },
          onerror: () => reject(new Error('Không kết nối được tới GitHub.')),
          ontimeout: () => reject(new Error('GitHub không phản hồi.'))
        });
      });
      GM_setValue('mz_gia_merchize', JSON.stringify({ luc: Date.now(), data }));
      return data;
    } catch (e) {
      if (cu && cu.data) return cu.data;
      throw e;
    }
  }

  // Chi phi 1 don Merchize neu in het bang kieu `pm`: san pham dau = base + ship san pham dau, san pham tiep theo = base + ship them.
  // (Ship giong nhau giua DTG va DTF nen chenh lech chi la chenh base cost.) null neu thieu gia.
  function giaDonMerchize(don, skus, pm, bangGia, quocGia) {
    const vung = vungShipMerchize(quocGia);
    let tong = 0;
    let dau = true;
    for (let i = 0; i < don.rows.length; i++) {
      const ma = str(skus[i]);
      const v = (bangGia.V || {})[ma];
      const sp = (bangGia.P || {})[ma.slice(0, 6)];
      const base = v ? v[pm === 'DTF' ? 0 : 1] : null;
      if (base === null || base === undefined || !sp || !sp[vung]) return null;
      const sl = Math.max(1, parseInt(cell(don.rows[i].r, COL.quantity), 10) || 1);
      for (let u = 0; u < sl; u++) { tong += base + (dau ? sp[vung][0] : sp[vung][1]); dau = false; }
    }
    return Math.round(tong * 100) / 100;
  }

  // Goi y kieu in cho cac don Merchize hop le: doi sang kieu in re hon (DTG sang DTF hoac nguoc lai).
  function tinhGoiYMerchize(dsDon, bangGia) {
    const kq = [];
    dsDon.forEach(({ d, skus }) => {
      if (d.rows.some(({ r }) => !phuongPhapIn(cell(r, COL.printingMethod)))) return; // cot A khong phai DTG/DTF: khong biet kieu in hien tai
      const quocGia = maQuocGia(cell(d.rows[0].r, COL.country));
      const ung = ['DTG', 'DTF'].map((pm) => ({ pm, gia: giaDonMerchize(d, skus, pm, bangGia, quocGia) })).filter((x) => x.gia !== null);
      if (!ung.length) return;
      const dtg = ung.find((x) => x.pm === 'DTG');
      const dtf = ung.find((x) => x.pm === 'DTF');
      const c = chonKieuRe(d, ung);
      if (!c) return;
      const hienTai = Array.from(new Set(d.rows.map(({ r }) => phuongPhapIn(cell(r, COL.printingMethod))))).join('+');
      kq.push({ don: d, moi: c.nen.pm, hienTai, giaDtg: dtg ? dtg.gia : null, giaDtf: dtf ? dtf.gia : null, tietKiem: c.tietKiem, ncc: 'Merchize' });
    });
    return kq;
  }

  // Hop thoai chon don nao doi kieu in. Tra ve Set ma don duoc tich (mac dinh khong tich), hoac null neu nguoi dung tat bang.
  async function hoiDoiKieuIn(goiY) {
    return new Promise((resolve) => {
      const lop = el('div', `position:fixed;left:0;top:0;right:0;bottom:0;background:rgba(0,0,0,.45);z-index:${MAX_Z};display:flex;align-items:center;justify-content:center;font-family:Arial,sans-serif;`);
      const hop = el('div', 'background:#fff;border-radius:8px;padding:14px;width:520px;max-width:92vw;max-height:80vh;overflow:auto;box-shadow:0 4px 16px rgba(0,0,0,.5);font-size:13px;color:#222;');
      // Tieu de + nut tat bang (X): tat bang = khong gui don nao.
      const hangTieuDe = el('div', 'display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;');
      hangTieuDe.appendChild(el('div', 'font-weight:bold;', `Gợi ý đổi kiểu in để tối ưu chi phí (${goiY.length} đơn)`));
      const nutTat = el('button', 'border:none;background:transparent;font-size:18px;line-height:1;cursor:pointer;color:#666;padding:0 4px;', '✕');
      nutTat.title = 'Tắt bảng (chưa gửi đơn nào)';
      hangTieuDe.appendChild(nutTat);
      hop.appendChild(hangTieuDe);
      // "Chon tat ca" o dau cot tich cac don.
      const dongTatCa = el('label', 'display:flex;align-items:center;gap:6px;padding:4px 0;cursor:pointer;font-weight:bold;');
      const cbTatCa = document.createElement('input');
      cbTatCa.type = 'checkbox';
      cbTatCa.style.flex = 'none';
      dongTatCa.appendChild(cbTatCa);
      dongTatCa.appendChild(document.createTextNode('Chọn tất cả'));
      hop.appendChild(dongTatCa);
      const o = goiY.map((g) => {
        const dong = el('label', 'display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px solid #eee;cursor:pointer;');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.style.marginRight = '6px';
        const gia = (v) => (v == null ? 'n/a' : v.toFixed(2) + '$');
        cb.style.flex = 'none';
        dong.appendChild(cb);
        // Anh mockup (cot D) cua TAT CA cac dong trong don (bo link trung); bam vao anh de mo anh lon o tab moi.
        const cacLink = Array.from(new Set(g.don.rows.map(({ r }) => cell(r, COL.mockUpFront)).filter(laLink)));
        if (cacLink.length) {
          const khungAnh = el('div', 'display:flex;flex-wrap:wrap;gap:4px;flex:none;max-width:' + (cacLink.length > 1 ? '230px' : '76px') + ';');
          const cua = cacLink.length > 1 ? 56 : 72;
          cacLink.slice(0, 8).forEach((link) => {
            const anh = document.createElement('img');
            anh.src = link;
            anh.alt = 'mockup';
            anh.title = 'Bấm để xem ảnh lớn';
            anh.style.cssText = `width:${cua}px;height:${cua}px;object-fit:contain;flex:none;border:1px solid #ddd;border-radius:4px;background:#fafafa;cursor:zoom-in;`;
            anh.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); window.open(link, '_blank', 'noopener'); });
            khungAnh.appendChild(anh);
          });
          if (cacLink.length > 8) khungAnh.appendChild(el('span', 'font-size:11px;color:#666;align-self:center;', `+${cacLink.length - 8}`));
          dong.appendChild(khungAnh);
        }
        dong.appendChild(el('span', 'flex:1;', `${g.ncc ? '[' + g.ncc + '] ' : ''}${g.don.orderNumber}: ${g.hienTai} → ${g.moi}${g.tietKiem != null ? `, tiết kiệm ${g.tietKiem.toFixed(2)}$` : ''}   (DTG ${gia(g.giaDtg)}, DTF ${gia(g.giaDtf)})`));
        hop.appendChild(dong);
        return { g, cb };
      });
      const ap = nut('Chốt và Gửi đơn', '#4CAF50');
      ap.style.marginTop = '10px';
      ap.style.marginBottom = '0';
      hop.appendChild(ap);
      lop.appendChild(hop);
      document.body.appendChild(lop);
      const xong = (set) => { lop.remove(); document.removeEventListener('keydown', khiNhanPhim, true); resolve(set); };
      const khiNhanPhim = (e) => { if (e.key === 'Escape') xong(null); };
      document.addEventListener('keydown', khiNhanPhim, true);
      nutTat.addEventListener('click', () => xong(null));
      cbTatCa.addEventListener('change', () => o.forEach(({ cb }) => { cb.checked = cbTatCa.checked; }));
      o.forEach(({ cb }) => cb.addEventListener('change', () => { cbTatCa.checked = o.every((x) => x.cb.checked); }));
      ap.addEventListener('click', () => xong(new Set(o.filter(({ cb }) => cb.checked).map(({ g }) => g.don.orderNumber))));
    });
  }

  // Ghi kieu in moi vao cot A (A{row} = DTG / DTF).
  async function ghiKieuIn(spreadsheetId, title, updates) {
    if (!updates.length) return;
    await sheetsApiFetch(`${spreadsheetId}/values:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ valueInputOption: 'RAW', data: updates.map((u) => ({ range: `'${title}'!A${u.row}`, values: [[u.pm]] })) })
    });
  }

  // Ly do 1 dong khong co SKU ZooTop (de bao loi ro rang).
  function lyDoKhongCoZooTop(r, bangZoo, r0 = r) {
    const pm = phuongPhapIn(cell(r, COL.printingMethod));
    const moTa = `${cell(r, COL.printingMethod) || '?'} | ${cell(r, COL.title)} | ${cell(r, COL.color)} | ${cell(r, COL.size)}`;
    if (!pm) return `${moTa}: cột A không phải DTG/DTF`;
    if (maQuocGia(cell(r0, COL.country)) !== 'US') return `${moTa} (${cell(r0, COL.country)}): không có SKU đi ngoài US trong bảng quốc tế (chỉ có Gildan 5000, Comfort 1717, sweatshirt 18000, hoodie 18500, size S đến 3XL)`;
    const tenSp = (timTheoTitle(ZOOTOP_TEN, cell(r, COL.title)) || {})[pm];
    if (!tenSp) return `${moTa}: title chưa có trong danh sách ZooTop`;
    const cd = bangZoo.chanDoan || { sanPham: {} };
    if (!cd.sanPham[pm + '|' + chuanTen(tenSp)]) return `${moTa}: file SKU không có sản phẩm "${tenSp}" (${pm})`;
    return `${moTa}: "${tenSp}" không có màu/size này`;
  }

  // Ca don di ZooTop khi MOI dong deu co SKU ZooTop -> mang SKU theo dong, khong thi null.
  function zootopSkuCuaDon(don, bangZoo) {
    const r0 = don.rows[0].r;
    const skus = don.rows.map(({ r }) => zootopSkuDong(r, bangZoo, r0));
    return skus.every(Boolean) ? skus : null;
  }

  // Sheet fulfill ZooTop: A DATE, B trang thai, C Tracking Number, D order_id ... AA note (script ghi D -> AA),
  // AB tracking_number, AC tracking_carrier, AD shipping_label, AE Note, AF Total Cost.
  const ZOOTOP_COT_DAU = 'D';
  const ZOOTOP_COT_CUOI = 'AA';
  // 1 dong sheet fulfill ZooTop, cot D -> AA (24 o).
  // Nguoi nhan / dia chi lay o dong dau cua don (r0), san pham lay o dong r.
  function dongZooTop(r, sku, r0 = r) {
    const v = new Array(24).fill('');
    v[0] = cell(r, COL.orderNumber);          // D order_id
    v[2] = ZOOTOP_SHIPPING_TYPE;              // F shipping_type
    v[3] = cell(r0, COL.name);                // G buyer_first_name
    v[5] = cell(r0, COL.phone);               // I
    v[6] = cell(r0, COL.email);               // J
    v[7] = cell(r0, COL.country);             // K
    v[8] = cell(r0, COL.state);               // L
    v[9] = cell(r0, COL.city);                // M
    v[10] = cell(r0, COL.address1);           // N
    v[11] = cell(r0, COL.address2);           // O
    v[12] = cell(r0, COL.postalCode);         // P
    v[13] = cell(r, COL.quantity) || '1';     // Q
    v[14] = sku;                              // R
    v[15] = cell(r, COL.designFront);         // S
    v[16] = cell(r, COL.designBack);          // T
    // Co design_front thi dien mockup_front (W), co design_back thi dien mockup_back (X): co ca 2 thi dien ca 2
    // (cung anh mockup o cot D vi Sheet chi co 1 cot mockup). Khong co design nao (khong xay ra) thi dien W.
    const coFront = laLink(cell(r, COL.designFront));
    const coBack = laLink(cell(r, COL.designBack));
    if (coFront || !coBack) v[19] = cell(r, COL.mockUpFront);  // W mockup_front
    if (coBack) v[20] = cell(r, COL.mockUpFront);               // X mockup_back
    return v;
  }

  // Ghi NOI TIEP vao sheet fulfill ZooTop (cot D -> AA), dong trong ke tiep theo cot D (order_id).
  async function ghiSheetZooTop(target, dsZoo) {
    const dong = [];
    dsZoo.forEach((d) => d.rows.forEach(({ r }, i) => dong.push(dongZooTop(r, d.zooSkus[i], d.rows[0].r))));
    if (!dong.length) return;
    const cotB = await sheetsApiFetch(
      `${target.spreadsheetId}/values/${encodeURIComponent(`'${target.sheetTitle}'!${ZOOTOP_COT_DAU}:${ZOOTOP_COT_DAU}`)}?majorDimension=COLUMNS`,
      { method: 'GET' });
    const dongTiep = (((cotB.values || [])[0]) || []).length + 1;
    await sheetsApiFetch(`${target.spreadsheetId}/values:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: [{ range: `'${target.sheetTitle}'!${ZOOTOP_COT_DAU}${dongTiep}:${ZOOTOP_COT_CUOI}${dongTiep + dong.length - 1}`, values: dong }]
      })
    });
  }

  // ============ DON LOI BUOC 1 (cho gui lai o buoc 2) ============
  function docDonLoiBuoc1() {
    try { return JSON.parse(GM_getValue('mz_loi_buoc1', '{}')) || {}; } catch (e) { return {}; }
  }
  function luuDonLoiBuoc1(tab, dsMa) {
    const all = docDonLoiBuoc1();
    if (dsMa.length) all[tab] = dsMa; else delete all[tab];
    GM_setValue('mz_loi_buoc1', JSON.stringify(all));
  }

  // ============ 3 CHUC NANG CHINH ============
  // cheDo: 'buoc1' = don chua chi dinh di ZooTop (neu tab co sheet ZooTop), don loi duoc luu lai;
  //        'buoc2' = gui lai cac don loi da luu o buoc 1, uu tien ZooTop roi Merchize, con loi thi bo qua.
  async function kiemTraHoacGui(statusEl, guiThat, cheDo = '') {
    const catalog = docCatalogDaLuu();
    if (!catalog) throw new Error('Chưa có catalog. Bấm "1. Catalog SKU" > "Cập nhật catalog Merchize" trước.');

    log(statusEl, '⏳ Đang đọc trang tính...');
    const { spreadsheetId, title } = await layTrangTinhDangMo();
    const store = layStore(title);
    if (guiThat && !store) throw new Error(`Tab "${title}" chưa cài store Merchize (Base URL + Access Token).`);
    let rows = await docTrangTinh(spreadsheetId, title, SO_DONG_CUOI);
    const donCho = new Set(docDonLoiBuoc1()[title] || []);
    if (cheDo === 'buoc2') {
      if (!donCho.size) throw new Error('Không có đơn lỗi nào đang chờ từ Bước 1 (bấm "3. Gửi đơn" trước).');
      // Don da luu: dong nao dang ghi "Lỗi: ..." thi coi nhu da sua xong, xet lai tu dau.
      rows = rows.map((r, i) => (i > 0 && donCho.has(cell(r, COL.orderNumber)) && cell(r, COL.status).startsWith(STATUS_ERROR_PREFIX.trim())
        ? Object.assign(r.slice(), { [COL.status]: '' }) : r));
    }
    const zooTarget = docCacSheetZooTop()[title];
    const bangZoo = zooTarget ? await docBangZooTop() : null;
    const daBiet = bangSkuDaBiet(bangZoo, catalog);
    // Don da co dong duoc gui/danh dau truoc do (don nhieu dong, cac dong con lai de trong): bo qua, khong bao loi.
    const gomDonTatCa = gomDon(rows).filter((d) => cheDo !== 'buoc2' || donCho.has(d.orderNumber));
    const boQuaDaGui = gomDonTatCa.filter((d) => d.daGuiTruoc).map((d) => d.orderNumber);
    const ghiChuBoQua = boQuaDaGui.length
      ? `Bỏ qua ${boQuaDaGui.length} đơn đã có dòng được gửi/đánh dấu trước đó (không báo lỗi): ${boQuaDaGui.slice(0, 10).join(', ')}${boQuaDaGui.length > 10 ? ' ...' : ''}`
      : '';
    const tatCa = gomDonTatCa.filter((d) => !d.daGuiTruoc).map((d0) => {
      const skuTay = d0.rows.map(({ r }) => cell(r, COL.merchizeSku));
      let d = d0;
      if (skuTay.some(Boolean)) {
        // Nha cung cap theo SKU tu dien (hoac theo chi dinh o AC neu co).
        const theoSku = new Set(skuTay.filter(Boolean).map((k) => (daBiet.zoo.has(k) ? 'ZooTop' : daBiet.mz.has(k) ? 'Merchize' : '?')));
        let ncc = d0.chiDinh;
        let loiSku = '';
        if (!ncc) {
          if (theoSku.has('?')) loiSku = `SKU tự điền "${skuTay.find((k) => k && !daBiet.zoo.has(k) && !daBiet.mz.has(k))}" không có trong bảng ZooTop hay catalog Merchize (ghi #ZooTop / #Merchize ở AC để ép)`;
          else if (theoSku.size > 1) loiSku = 'SKU tự điền vừa của ZooTop vừa của Merchize trong cùng 1 đơn';
          else ncc = Array.from(theoSku)[0];
        }
        if (loiSku) return { ...d0, skuTay, zooSkus: null, loiChiDinh: loiSku };
        if (ncc === 'ZooTop') {
          if (!zooTarget) return { ...d0, skuTay, zooSkus: null, loiChiDinh: 'SKU ZooTop nhưng tab chưa gắn sheet ZooTop' };
          const zooSkus = d0.rows.map(({ r }, i) => skuTay[i] || zootopSkuDong(r, bangZoo, d0.rows[0].r));
          if (zooSkus.every(Boolean)) return { ...d0, zooSkus };
          return { ...d0, skuTay, zooSkus: null, loiChiDinh: 'đơn đi ZooTop theo SKU tự điền nhưng có dòng chưa có SKU: ' +
            d0.rows.filter((x, i) => !zooSkus[i]).map(({ r }) => lyDoKhongCoZooTop(r, bangZoo, d0.rows[0].r)).join('; ') };
        }
          // Merchize: cac dong co SKU tu dien gui dung SKU do, dong con lai tra catalog.
        d = { ...d0, chiDinh: 'Merchize', skuTay };
      }
      // Buoc 1: don chua chi dinh gi thi coi nhu #ZooTop (chi khi tab co sheet ZooTop).
      const epBuoc1 = cheDo === 'buoc1' && zooTarget && !d.chiDinh;
      if (epBuoc1) d = { ...d, chiDinh: 'ZooTop' };
      // Don chi dinh nha cung cap (#ZooTop / #Merchize o cot AC).
      if (d.chiDinh === 'Merchize') return { ...d, zooSkus: null };
      if (d.chiDinh === 'ZooTop') {
        const zooSkus = bangZoo ? zootopSkuCuaDon(d, bangZoo) : null;
        const tienTo = epBuoc1 ? 'bước 1 đi ZooTop nhưng' : 'chỉ định #ZooTop nhưng';
        const loiChiDinh = zooSkus ? '' : !zooTarget ? 'chỉ định #ZooTop nhưng tab chưa gắn sheet ZooTop'
          : tienTo + ' không có SKU ZooTop: ' + d.rows.filter(({ r }) => !zootopSkuDong(r, bangZoo, d.rows[0].r))
            .map(({ r }) => lyDoKhongCoZooTop(r, bangZoo, d.rows[0].r)).join('; ');
        return { ...d, zooSkus, loiChiDinh };
      }
      const zooSkus = bangZoo ? zootopSkuCuaDon(d, bangZoo) : null;
      return { ...d, zooSkus };
    }).map((d) => {
      // Don nao cung khong duoc day (ZooTop / Merchize) neu co dong thieu link design (ca front lan back).
      if (!d.zooSkus) return d;
      const thieu = d.rows.map(({ r }, i) => (!laLink(cell(r, COL.designFront)) && !laLink(cell(r, COL.designBack)) ? i + 1 : 0)).filter(Boolean);
      if (!thieu.length) return d;
      // thieuDesign: don DANG DUOC DI ZooTop (du SKU ZooTop) nhung thieu link design -> KHONG duoc dien SKU
      // Merchize vao AB (neu dien, lan gui sau AB da co SKU Merchize nen don bi ep sang Merchize du co SKU ZooTop).
      return { ...d, zooSkus: null, thieuDesign: true, loiChiDinh: 'thiếu link design' + (d.rows.length > 1 ? ` (dòng ${thieu.join(', ')})` : '') };
    });
    // Goi y kieu in (chi khi gui that): don ZooTop tu tra SKU va don Merchize hop le; 1 hop thoai de nguoi dung chon don nao doi.
    const ghiA = [];
    let ghiChuGia = '';
    if (guiThat) {
      try {
        let goiYZoo = [];
        if (zooTarget) {
          try {
            goiYZoo = tinhGoiYKieuIn(tatCa, bangZoo, await docBangGia());
          } catch (e) { ghiChuGia = 'Không gợi ý được kiểu in ZooTop (giữ nguyên): ' + e.message.slice(0, 120); }
        }
        let goiYMz = [];
        try {
          const bangGiaMz = await docBangGiaMerchize();
          const ungMz = tatCa.filter((d) => !d.zooSkus && !d.loiChiDinh).map((d) => ({ d, kq: dungDon(d, catalog, title) }))
            .filter((x) => x.kq.loi.length === 0).map((x) => ({ d: x.d, skus: x.kq.skus }));
          goiYMz = tinhGoiYMerchize(ungMz, bangGiaMz);
        } catch (e) { ghiChuGia = (ghiChuGia ? ghiChuGia + ' ' : '') + 'Không gợi ý được kiểu in Merchize (giữ nguyên): ' + e.message.slice(0, 120); }
        const goiY = goiYZoo.concat(goiYMz);
        const chon = goiY.length ? await hoiDoiKieuIn(goiY) : new Set();
        if (chon === null) return 'Đã tắt bảng gợi ý kiểu in, chưa gửi đơn nào.';
        const duocDoi = goiY.filter((g) => chon.has(g.don.orderNumber));
        duocDoi.forEach((g) => {
          const moi = donDoiKieuIn(g.don, g.moi);
          const i2 = tatCa.indexOf(g.don);
          tatCa[i2] = g.ncc === 'Merchize' ? moi : { ...moi, zooSkus: zootopSkuCuaDon(moi, bangZoo) };
          moi.rows.forEach(({ rowNumber }) => ghiA.push({ row: rowNumber, pm: g.moi }));
        });
        const tongTietKiem = Math.round(duocDoi.reduce((t, g) => t + (g.tietKiem || 0), 0) * 100) / 100;
        if (goiY.length) ghiChuGia = (ghiChuGia ? ghiChuGia + ' ' : '') + `Gợi ý đổi kiểu in: ${goiY.length} đơn, đã đổi ${duocDoi.length}` + (duocDoi.length ? `, tiết kiệm ${tongTietKiem.toFixed(2)}$` : '') + '.';
      } catch (e) {
        ghiChuGia = 'Không gợi ý được kiểu in (giữ nguyên): ' + e.message.slice(0, 150);
      }
    }
    const dsZoo = tatCa.filter((d) => d.zooSkus);
    const donList = tatCa.filter((d) => !d.zooSkus).map((d) => {
      const kq = dungDon(d, catalog, title);
      const skus = d.thieuDesign ? d.rows.map(({ r }) => cell(r, COL.merchizeSku)) : kq.skus;
      return { ...d, ...kq, skus, loi: d.loiChiDinh ? [d.loiChiDinh] : kq.loi };
    });
    if (donList.length === 0 && dsZoo.length === 0) {
      if (cheDo === 'buoc2') luuDonLoiBuoc1(title, []);
      const dongDoc = rows.map((r, i) => (i > 0 && r ? i + 1 : 0)).filter(Boolean);
      return `Trang "${title}": không có đơn nào chờ gửi (cột AC đều đã có trạng thái).` +
        (ghiChuBoQua ? '\n' + ghiChuBoQua : '') +
        (dongDoc.length ? `\nLưu ý: script chỉ quét ${SO_DONG_CUOI} dòng cuối có mã đơn (đang đọc từ dòng ${dongDoc[0]} đến dòng ${dongDoc[dongDoc.length - 1]}). Đơn nằm phía trên dòng ${dongDoc[0]} sẽ không được quét.` : '');
    }
    const dongBaoCao = [];
    if (zooTarget) {
      dongBaoCao.unshift(`${dsZoo.length} đơn đi ZooTop` + (dsZoo.length ? `: ${dsZoo.map((d) => d.orderNumber).join(', ')}` : '.'));
      // Don co dong khong tim thay SKU ZooTop (de doi chieu voi file SKU ZooTop).
      const thieuZoo = tatCa.filter((d) => !d.zooSkus && !d.chiDinh && !d.loiChiDinh).slice(0, 10).map((d) => {
        const r = (d.rows.find(({ r: x }) => !zootopSkuDong(x, bangZoo, d.rows[0].r)) || d.rows[0]).r;
        return `• ${d.orderNumber}: ${lyDoKhongCoZooTop(r, bangZoo, d.rows[0].r)}`;
      });
      if (thieuZoo.length) dongBaoCao.splice(1, 0, 'Không có SKU ZooTop (đi Merchize):', ...thieuZoo);
      const soSku = (bangZoo.chanDoan || {}).soSku || {};
      dongBaoCao.splice(1, 0, `File SKU ZooTop: ${Object.entries(soSku).map(([t, n]) => `"${t}" ${n} SKU`).join(', ')}`);
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
      dsZoo.forEach((d) => d.rows.forEach(({ rowNumber, r }, i) => {
        updates.push({ row: rowNumber, values: [d.zooSkus[i], cell(r, COL.status), cell(r, COL.merchizeId)] });
      }));
      await damBaoTieuDe(spreadsheetId, title, rows);
      await ghiKetQua(spreadsheetId, title, updates);
      return [
        `Trang "${title}": ${donList.length} đơn chờ gửi Merchize, ${hopLe.length} đơn hợp lệ, ${coLoi.length} đơn có lỗi.`,
        ...dongBaoCao,
        'Đã điền SKU vào cột AB (chưa gửi gì lên Merchize / ZooTop).',
        ghiChuBoQua,
        ...dongLoi
      ].filter(Boolean).join('\n');
    }

    if (hopLe.length === 0 && dsZoo.length === 0) {
      if (cheDo) {
        await damBaoTieuDe(spreadsheetId, title, rows);
        await ghiKetQua(spreadsheetId, title, coLoi.flatMap((d) => d.rows.map(({ rowNumber }, i) => (
          { row: rowNumber, values: [d.skus[i], STATUS_ERROR_PREFIX + d.loi.join('; '), ''] }))));
        luuDonLoiBuoc1(title, cheDo === 'buoc1' ? coLoi.map((d) => d.orderNumber) : []);
      }
      return [`Không có đơn hợp lệ để gửi (${coLoi.length} đơn lỗi):`, ...dongLoi,
        ...(cheDo === 'buoc1' && coLoi.length ? ['Đã lưu các đơn lỗi. Sửa xong bấm "4. Bước 2: gửi lại đơn lỗi".'] : []), ghiChuBoQua].filter(Boolean).join('\n');
    }
    const ok = W.confirm(
      `Sẽ gửi ${hopLe.length} đơn lên Merchize (${tenStore(store)})` +
      (dsZoo.length ? `, ${dsZoo.length} đơn vào sheet ZooTop` : '') + ` từ tab "${title}".` +
      (coLoi.length ? `\n${coLoi.length} đơn lỗi sẽ được đánh dấu, không gửi.` : '') +
      '\n\nVui lòng điền "Cũ" vào cột Trạng thái (AC) cho những đơn hàng cũ để tránh gửi nhầm 1 đơn 2 lần.' +
      '\n\nBấm OK để xác nhận gửi, Cancel để hủy.'
    );
    if (!ok) return 'Đã hủy, chưa gửi đơn nào.';

    await damBaoTieuDe(spreadsheetId, title, rows);
    await ghiKieuIn(spreadsheetId, title, ghiA);

    // Don loi: ghi ngay trang thai loi (sua xong thi xoa o AC de gui lai).
    const updLoi = [];
    coLoi.forEach((d) => d.rows.forEach(({ rowNumber }, i) => {
      updLoi.push({ row: rowNumber, values: [d.skus[i], STATUS_ERROR_PREFIX + d.loi.join('; '), ''] });
    }));
    await ghiKetQua(spreadsheetId, title, updLoi);

    // Don ZooTop: ghi sheet fulfill ZooTop, roi AB = SKU ZooTop, AC = "ZooTop" cho moi dong cua don.
    let loiZoo = '';
    const maLoiBuoc1 = coLoi.map((d) => d.orderNumber);
    if (dsZoo.length) {
      const dongAc = (trangThai) => dsZoo.flatMap((d) => d.rows.map(({ rowNumber }, i) => ({ row: rowNumber, values: [d.zooSkus[i], trangThai, ''] })));
      try {
        await ghiSheetZooTop(zooTarget, dsZoo);
        await ghiKetQua(spreadsheetId, title, dongAc(STATUS_ZOOTOP));
      } catch (e) {
        loiZoo = /\b403\b|PERMISSION_DENIED/.test(e.message)
          ? 'tài khoản Google đang dùng không có quyền sửa sheet ZooTop'
          : e.message.slice(0, 200);
        await ghiKetQua(spreadsheetId, title, dongAc(STATUS_ERROR_PREFIX + 'không ghi được sheet ZooTop - ' + loiZoo));
        dsZoo.forEach((d) => maLoiBuoc1.push(d.orderNumber));
      }
    }

    let thanhCong = 0;
    const maThanhCong = [];
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
          maThanhCong.push(d.orderNumber);
        } else {
          trangThai = STATUS_ERROR_PREFIX + (json.message || 'Merchize từ chối');
        }
      } catch (e) {
        trangThai = STATUS_ERROR_PREFIX + e.message;
      }
      if (trangThai !== STATUS_SENT) { ketQuaGui.push(`• ${d.orderNumber}: ${trangThai}`); maLoiBuoc1.push(d.orderNumber); }
      // Ghi ngay sau moi don de lo dong tab giua chung van biet don nao da gui.
      await ghiKetQua(spreadsheetId, title, d.rows.map(({ rowNumber }, j) => ({
        row: rowNumber, values: [d.skus[j], trangThai, maMerchize]
      })));
      await sleep(300);
    }

    if (cheDo) luuDonLoiBuoc1(title, cheDo === 'buoc1' ? maLoiBuoc1 : []);
    return [
      ...(ghiChuGia ? [ghiChuGia] : []),
      ...(cheDo === 'buoc1' ? ['BƯỚC 1 (ưu tiên ZooTop) xong.'] : cheDo === 'buoc2' ? ['BƯỚC 2 (ZooTop rồi Merchize) xong, đơn còn lỗi đã bỏ qua.'] : []),
      `Trang "${title}": gửi thành công ${thanhCong}/${hopLe.length} đơn lên Merchize` + (maThanhCong.length ? `: ${maThanhCong.join(', ')}.` : '.'),
      ...(dsZoo.length && !loiZoo ? [`Đã ghi ${dsZoo.length} đơn vào sheet ZooTop "${zooTarget.fileTitle || zooTarget.sheetTitle}": ${dsZoo.map((d) => d.orderNumber).join(', ')}.`] : []),
      ...(loiZoo ? [`❌ ${dsZoo.length} đơn ZooTop chưa ghi được: ${loiZoo}. Sửa xong thì xoá ô AC các đơn đó và gửi lại.`] : []),
      ...ketQuaGui,
      coLoi.length ? `${coLoi.length} đơn không gửi vì lỗi dữ liệu:` : '',
      ...dongLoi,
      cheDo === 'buoc1' && maLoiBuoc1.length ? `Đã lưu ${maLoiBuoc1.length} đơn lỗi. Sửa xong bấm "4. Bước 2: gửi lại đơn lỗi".` : '',
      ghiChuBoQua
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
    const b = el('button', `width:100%;padding:8px;background:${mau};color:#fff;border:none;border-radius:4px;cursor:pointer;margin-bottom:6px;`, text);
    b.className = 'mz-btn';
    return b;
  }

  // Hieu ung "dang chay" giong Auto Tracking: nut dang chay co vien + vet sang chay ngang, cac nut khac mo di.
  function chenCssNut() {
    if (document.getElementById('mz-style')) return;
    const st = document.createElement('style');
    st.id = 'mz-style';
    st.textContent = `
      .mz-btn { position:relative; overflow:hidden; transition:filter .15s, box-shadow .15s; }
      .mz-btn:hover:not(:disabled) { filter:brightness(1.08); }
      .mz-btn:disabled { opacity:.5; cursor:not-allowed; }
      .mz-btn.mz-busy:disabled { opacity:1; cursor:progress; }
      .mz-btn.mz-busy { box-shadow:0 0 0 2px #fff, 0 0 0 4px #1565c0; }
      .mz-btn.mz-busy::after {
        content:''; position:absolute; top:0; right:0; bottom:0; left:0; transform:translateX(-100%);
        background:linear-gradient(110deg, transparent 25%, rgba(255,255,255,.45) 50%, transparent 75%);
        animation:mz-sheen 1.1s linear infinite;
      }
      @keyframes mz-sheen { to { transform:translateX(100%); } }
    `;
    document.head.appendChild(st);
  }

  function buildUi() {
    chenCssNut();
    const btn = el('button', `position:fixed!important;bottom:80px;right:24px;z-index:${MAX_Z}!important;
      padding:10px 16px;background:#ff6f00;color:#fff;border:none;border-radius:6px;cursor:grab;font-size:13px;
      font-family:Arial,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.4);user-select:none;`, `Merchize v${SCRIPT_VERSION}`);
    try {
      const pos = JSON.parse(localStorage.getItem(POS_STORAGE_KEY) || 'null');
      if (pos && typeof pos.left === 'number') {
        Object.assign(btn.style, { left: pos.left + 'px', top: pos.top + 'px', right: 'auto', bottom: 'auto' });
      }
    } catch (e) { /* bo qua */ }

    const panel = el('div', `position:fixed!important;z-index:${MAX_Z}!important;width:${PANEL_WIDTH}px;box-sizing:border-box;padding:14px;overflow-y:auto;
      background:#fff;border:1px solid #ccc;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.4);
      font-family:Arial,sans-serif;font-size:13px;display:none;`);

    const oCss = 'width:100%;box-sizing:border-box;padding:6px;margin-bottom:6px;border:1px solid #ccc;border-radius:4px;';
    const dongCss = 'font-size:12px;font-weight:bold;margin-bottom:6px;cursor:pointer;white-space:pre-wrap;';
    // 2 dong trang thai: bam vao dong da cai (✅) de hien o sua.
    const storeInfo = el('div', dongCss, '');
    storeInfo.title = 'Bấm để sửa store Merchize';
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
    const boStoreBtn = nut('Bỏ store của tab này', '#c62828');
    [baseInput, tokenInput, webhookInput, saveTokenBtn, boStoreBtn].forEach((x) => storeBox.appendChild(x));
    const zooInfo = el('div', dongCss, '');
    zooInfo.title = 'Bấm để sửa sheet fulfill ZooTop';
    const zooBox = el('div', 'margin-bottom:4px;');
    const zooInput = el('input', oCss);
    zooInput.placeholder = 'Link sheet fulfill ZooTop (mở đúng tab rồi copy link)';
    const zooBtn = nut('Lưu sheet ZooTop cho tab này', '#00796b');
    [zooInput, zooBtn].forEach((x) => zooBox.appendChild(x));

    const catalogInfo = el('div', 'font-size:11px;color:#999;margin:4px 0 6px;');
    function capNhatCatalogInfo() {
      const c = docCatalogDaLuu();
      catalogInfo.textContent = c
        ? `Catalog: ${Object.keys(c.products).length} sản phẩm, cập nhật ${new Date(c.updated).toLocaleString()}`
        : 'Catalog: chưa có';
    }
    capNhatCatalogInfo();

    const catalogBtn = nut('1. Catalog SKU', '#2196F3');
    // Muc rieng khi bam "1. Catalog SKU": xem catalog SKU cac nha cung cap va cap nhat catalog Merchize.
    const catalogBox = el('div', 'display:none;border:1px solid #bbdefb;border-radius:6px;padding:8px;margin-bottom:8px;background:#f5faff;');
    const taiCatalogBtn = nut('Cập nhật catalog Merchize', '#1976d2');
    const xemCatalogBtn = nut('Xem catalog SKU các nhà cung cấp', '#0288d1');
    const xemCatalogBox = el('div', 'display:none;font-size:12px;line-height:1.45;max-height:340px;overflow:auto;background:#fff;border:1px solid #ddd;border-radius:4px;padding:6px 8px;margin-bottom:6px;');
    // Bang tom tat catalog SKU: nguon (link sheet) + quy chuan tra SKU cua tung nha cung cap.
    function veXemCatalog() {
      while (xemCatalogBox.firstChild) xemCatalogBox.removeChild(xemCatalogBox.firstChild);
      const tieuDe = (t) => xemCatalogBox.appendChild(el('div', 'font-weight:bold;margin:6px 0 2px;color:#0d47a1;', t));
      const dong = (t) => xemCatalogBox.appendChild(el('div', 'margin-left:6px;', t));
      const lienKet = (nhan, url) => {
        const d = el('div', 'margin-left:6px;');
        const a = el('a', 'color:#1565c0;', nhan);
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener';
        d.appendChild(a);
        xemCatalogBox.appendChild(d);
      };
      const linkSheet = (id, gid) => `https://docs.google.com/spreadsheets/d/${id}/edit#gid=${gid}`;
      const tab = tabDaHien || '';
      const cat = docCatalogDaLuu();

      tieuDe('Thứ tự gửi: ZooTop → Merchize');
      dong('Ép từng đơn: ghi #ZooTop / #Merchize ở cột AC, hoặc điền SKU sẵn ở cột AB.');

      tieuDe('ZooTop');
      const zoo = docCacSheetZooTop()[tab];
      dong(zoo ? `Sheet fulfill của tab: ${zoo.fileTitle || ''} / ${zoo.sheetTitle} (ghi cột D → AA)` : 'Tab này chưa gắn sheet fulfill ZooTop (đơn không đi ZooTop).');
      if (zoo) lienKet('Mở sheet fulfill', `https://docs.google.com/spreadsheets/d/${zoo.spreadsheetId}/edit`);
      dong('Đơn US: tra 3 tab trong file SKU ZooTop, khớp Product Name + kiểu in (cột A) + màu + size:');
      lienKet('Gildan Adult / Comfort Adult (I Product Name, K Type, L Color, M Size, N SKU)', linkSheet(ZOOTOP_FILE_SKU, ZOOTOP_BANG_SKU[0].gid));
      lienKet('Variant DTF (B Product Name, E Color, F Size, G SKU)', linkSheet(ZOOTOP_FILE_SKU, ZOOTOP_BANG_SKU[1].gid));
      lienKet('Variant DTG (B Product Name, E Color, F Size, G SKU)', linkSheet(ZOOTOP_FILE_SKU, ZOOTOP_BANG_SKU[2].gid));
      Object.entries(ZOOTOP_TEN).forEach(([t, m]) => dong(`• ${t} → DTF: "${m.DTF}" | DTG: "${m.DTG}"`));
      dong('Đơn ngoài US: chỉ tra bảng quốc tế (B mã loại-kiểu in, E Color, F Size, H SKU), không dùng các tab trên.');
      lienKet('Bảng SKU quốc tế', linkSheet(ZOOTOP_QT.file, ZOOTOP_QT.gid));
      Object.entries(ZOOTOP_QT_MA).forEach(([t, m]) => dong(`• ${t} → ${m}`));
      dong(`shipping_type: ${ZOOTOP_SHIPPING_TYPE}. Màu không phân biệt hoa thường, size XXL = 2XL.`);

      tieuDe('Merchize');
      dong(cat ? `Catalog đã lưu: ${Object.keys(cat.products).length} sản phẩm, cập nhật ${new Date(cat.updated).toLocaleString()}` : 'Chưa có catalog: bấm "Cập nhật catalog Merchize".');
      dong('Loại áo theo title → mã sản phẩm, rồi tra màu + size trong catalog:');
      [['toddler', '3321US'], ['sweatshirt', '1800US'], ['hoodie', '1850US'], ['comfort + youth', '9018US'], ['comfort + adult', '1717US'],
        ['bella + youth', '301YUS'], ['bella + adult', '3001US']].forEach(([t, m]) => {
        const sp = cat && cat.products[m];
        dong(`• ${t} → ${m}${sp ? ` (${Object.keys(sp.variants).length} variant)` : cat ? ' (chưa có trong catalog)' : ''}`);
      });
      ['gildan + youth → 500BUS', 'gildan + adult → 5000US'].forEach((t) => {
        const m = t.split('→ ')[1].trim();
        const sp = cat && cat.products[m];
        dong(`• ${t}${sp ? ` (${Object.keys(sp.variants).length} variant)` : cat ? ' (chưa có trong catalog)' : ''}`);
      });
      dong('Luật AU: Comfort Adult gửi Australia dùng 1717AU nếu có đúng màu + size, không thì 1717US.');

    }
    xemCatalogBtn.addEventListener('click', () => {
      const mo = xemCatalogBox.style.display === 'none';
      xemCatalogBox.style.display = mo ? 'block' : 'none';
      if (mo) veXemCatalog();
    });
    [xemCatalogBtn, xemCatalogBox, taiCatalogBtn].forEach((x) => catalogBox.appendChild(x));
    const checkBtn = nut('2. Kiểm tra (điền SKU, chưa gửi)', '#8e24aa');
    const sendBtn = nut('3. Gửi đơn - Bước 1 (ZooTop)', '#4CAF50');
    const buoc2Btn = nut('4. Bước 2: gửi lại đơn lỗi', '#ef6c00');
    buoc2Btn.style.display = 'none'; // chi hien sau Buoc 1 khi tab co don loi da luu
    sendBtn.title = 'Bước 1: đơn chưa chỉ định đi ZooTop, đơn lỗi được lưu lại';
    buoc2Btn.title = 'Bước 2: gửi lại các đơn lỗi đã lưu, ưu tiên ZooTop rồi Merchize';
    const hangGui = el('div', 'display:flex;gap:6px;');
    [sendBtn, buoc2Btn].forEach((x) => { x.style.flex = '1'; x.style.minWidth = '0'; hangGui.appendChild(x); });
    const workerBtn = nut('Cài Worker (link + key, 1 lần)', '#455a64');
    const capNhatBtn = nut(`Cập nhật script (đang dùng v${SCRIPT_VERSION})`, '#5d4037');


    const statusEl = el('pre', 'white-space:pre-wrap;margin-top:8px;max-height:280px;overflow:auto;font-size:12px;color:#333;');

    [storeInfo, storeBox, zooInfo, zooBox, catalogInfo, catalogBtn, catalogBox, checkBtn, hangGui, capNhatBtn, workerBtn, statusEl]
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
      GM_registerMenuCommand('Cập nhật script từ GitHub', () => {
        panel.style.display = 'block';
        repositionPanel();
        chay(kiemTraCapNhat);
      });
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
      // Gioi han chieu cao theo khoang trong con lai, phan du thi cuon trong bang.
      if (window.innerHeight - rect.bottom >= 380 || rect.top < 380) {
        panel.style.top = (rect.bottom + 8) + 'px';
        panel.style.bottom = 'auto';
        panel.style.maxHeight = Math.max(200, window.innerHeight - rect.bottom - 16) + 'px';
      } else {
        panel.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
        panel.style.top = 'auto';
        panel.style.maxHeight = Math.max(200, rect.top - 16) + 'px';
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

    const tatCaNut = [saveTokenBtn, boStoreBtn, zooBtn, catalogBtn, taiCatalogBtn, checkBtn, sendBtn, buoc2Btn, capNhatBtn, workerBtn];
    async function chay(task, nutChay) {
      tatCaNut.forEach((b) => { b.disabled = true; });
      if (nutChay) nutChay.classList.add('mz-busy');
      try {
        log(statusEl, '✅ ' + await task());
      } catch (e) {
        log(statusEl, '❌ Lỗi: ' + e.message);
        console.error('[Merchize]', e);
      } finally {
        if (nutChay) nutChay.classList.remove('mz-busy');
        tatCaNut.forEach((b) => { b.disabled = false; });
        hienNutBuoc2();
        capNhatCatalogInfo();
      }
    }

    // Tab da cai store (va sheet ZooTop neu dung) thi chi hien dong ✅, bam vao dong de hien o sua.
    let moSuaStore = false;
    let moSuaZoo = false;
    let dangDongBo = false;
    function hienStore(title) {
      const st = layStore(title);
      storeInfo.textContent = st
        ? `✅ Tab "${title}": ${tenStore(st)} (đã có token)`
        : `❌ Tab "${title}": chưa có store Merchize`;
      storeInfo.style.color = st ? '#2e7d32' : '#c62828';
      storeBox.style.display = !st || moSuaStore ? 'block' : 'none';
      boStoreBtn.style.display = st ? 'block' : 'none';
      const zoo = docCacSheetZooTop()[title];
      zooInfo.textContent = zoo ? `✅ ZooTop: ${zoo.fileTitle || zoo.sheetTitle}` : 'Tab này chưa dùng ZooTop (bấm để chọn sheet fulfill)';
      zooInfo.style.color = zoo ? '#2e7d32' : '#777';
      zooBox.style.display = moSuaZoo ? 'block' : 'none';
      zooInput.placeholder = zoo
        ? `Đang dùng: ${zoo.fileTitle || zoo.sheetTitle} / ${zoo.sheetTitle} (dán link mới để đổi, để trống rồi bấm Lưu để bỏ)`
        : 'Link sheet fulfill ZooTop (mở đúng tab rồi copy link)';
      if (document.activeElement !== baseInput) baseInput.value = st ? st.baseUrl : '';
      workerBtn.style.display = docWorker() ? 'none' : 'block';
      if (st) thuLayTenStore(st, () => { if (tabDaHien === title) hienStore(title); });
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

    // Nut 4 chi hien khi tab dang mo co don loi do Buoc 1 luu lai.
    function hienNutBuoc2() {
      const so = ((docDonLoiBuoc1()[tabDaHien || tenTabNhanh() || ''] || []).length);
      buoc2Btn.style.display = so ? '' : 'none';
      if (so) buoc2Btn.textContent = `4. Bước 2: gửi lại ${so} đơn lỗi`;
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
      hienNutBuoc2();
      moSuaStore = false;
      moSuaZoo = false;
      hienStore(ten);
    }
    setInterval(capNhatStoreTheoTab, 500);
    window.addEventListener('hashchange', capNhatStoreTheoTab);

    storeInfo.addEventListener('click', () => {
      if (!tabDaHien) { chay(xemStore); return; }
      moSuaStore = !moSuaStore;
      hienStore(tabDaHien);
    });
    zooInfo.addEventListener('click', () => {
      if (!tabDaHien) return;
      moSuaZoo = !moSuaZoo;
      hienStore(tabDaHien);
    });
    zooBtn.addEventListener('click', () => chay(khongTuDongBo(async () => {
      const kq = await luuSheetDich(zooInput.value, 'mz_zootop_targets', 'ZooTop');
      zooInput.value = '';
      moSuaZoo = false;
      const { title } = await layTrangTinhDangMo();
      hienStore(title);
      if (kq === 'Đã hủy.' || !layStore(title)) return kq;
      const zoo = docCacSheetZooTop()[title];
      const dong = await dongBoWorker(title, { zootop: zoo ? { spreadsheetId: zoo.spreadsheetId, sheet: zoo.sheetTitle } : null });
      return [kq, ...dong].join('\n');
    })));
    // Trong luc luu, tat tu dong bo (tranh 2 lan ghi cau hinh len Worker cung luc).
    const khongTuDongBo = (fn) => async () => {
      dangDongBo = true;
      try { return await fn(); } finally { dangDongBo = false; }
    };
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
      const zoo = docCacSheetZooTop()[title];
      const dong = await dongBoWorker(title, {
        store: { baseUrl, token, ...(webhookKey ? { webhookKey } : {}) },
        ...(zoo ? { zootop: { spreadsheetId: zoo.spreadsheetId, sheet: zoo.sheetTitle } } : {})
      });
      return [`Đã lưu store cho tab "${title}".`, ...dong].join('\n');
    })));
    // Bo store: xoa store + sheet ZooTop cua tab tren may nay va tren Worker (Worker thoi tra tracking,
    // so du, Request update cho tab nay; ke ca muc khai bao trong bien STORES tren Cloudflare).
    boStoreBtn.addEventListener('click', () => chay(khongTuDongBo(async () => {
      const title = tabDaHien || (await layTrangTinhDangMo()).title;
      const st = layStore(title);
      if (!st) throw new Error(`Tab "${title}" chưa có store Merchize.`);
      if (!W.confirm(`Bỏ store ${tenStore(st)} khỏi tab "${title}"?\nScript và Worker sẽ không gửi đơn, tra tracking hay báo số dư cho tab này nữa.`)) return 'Đã hủy.';
      const dong = docWorker() ? await dongBoWorker(title, { store: null }) : [];
      const all = docCacStore();
      delete all[title];
      GM_setValue('mz_stores', JSON.stringify(all));
      const zoo = docCacSheetZooTop();
      if (zoo[title]) { delete zoo[title]; GM_setValue('mz_zootop_targets', JSON.stringify(zoo)); }
      moSuaStore = false;
      hienStore(title);
      return [`Đã bỏ store khỏi tab "${title}".`, ...dong].join('\n');
    })));
    catalogBtn.addEventListener('click', () => {
      catalogBox.style.display = catalogBox.style.display === 'none' ? 'block' : 'none';
    });
    taiCatalogBtn.addEventListener('click', () => chay(() => capNhatCatalog(statusEl), taiCatalogBtn));
    checkBtn.addEventListener('click', () => chay(() => kiemTraHoacGui(statusEl, false), checkBtn));
    sendBtn.addEventListener('click', () => chay(() => kiemTraHoacGui(statusEl, true, 'buoc1'), sendBtn));
    buoc2Btn.addEventListener('click', () => chay(() => kiemTraHoacGui(statusEl, true, 'buoc2'), buoc2Btn));
    const caiWorkerVaHien = async () => {
      const kq = await caiWorker();
      if (tabDaHien) hienStore(tabDaHien);
      return kq;
    };
    workerBtn.addEventListener('click', () => chay(caiWorkerVaHien, workerBtn));
    capNhatBtn.addEventListener('click', () => chay(kiemTraCapNhat, capNhatBtn));
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
