// ==UserScript==
// @name         Google Sheets - Gui don len Merchize
// @namespace    gsheet-merchize-order-sender
// @version      1.14
// @description  Doc don hang tren trang tinh Google Sheets dang mo, tu tra Merchize SKU theo loai ao + mau + size (tu catalog Merchize), gop cac dong cung orderNumber thanh 1 don roi gui len Merchize qua API /order/external/orders. Ghi ket qua vao cot AB (Merchize SKU), AC (Trang thai), AD (Ma don Merchize).
// @match        https://docs.google.com/spreadsheets/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @connect      merchize.com
// @connect      workers.dev
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ====== CAU HINH ======
  const SCRIPT_VERSION = '1.14';
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
    baseCost: 24,      // Y
    merchizeSku: 27,   // AB
    status: 28,        // AC
    merchizeId: 29,    // AD
    tracking: 30,      // AE
    carrier: 31,       // AF
    ticket: 32         // AG
  };
  const OUTPUT_HEADERS = ['Merchize SKU', 'Trạng thái Merchize', 'Mã đơn Merchize'];
  const TRACKING_HEADERS = ['Tracking', 'Hãng vận chuyển'];

  // Bac gia goc Merchize dang ap dung cho store (tier1 = 0-999 don, tier2 = 1000-2999, tier3 = >3000).
  const TIER = 'tier1';
  // Thue nhap khau (Import Duty) tu 26/06/2026: 3.5$ MOI KIEN HANG (moi don) ship tu kho US
  // cua Merchize toi 50 nuoc/vung lanh tho chau Au duoi day.
  const THUE_NHAP_KHAU_CHAU_AU = 3.5;
  const NUOC_THUE_CHAU_AU = new Set(['AL', 'AD', 'AM', 'AT', 'AZ', 'BY', 'BE', 'BA', 'BG', 'HR', 'CY', 'CZ',
    'DK', 'EE', 'FI', 'FR', 'GE', 'DE', 'GR', 'HU', 'IS', 'IE', 'IT', 'KZ', 'XK', 'LV', 'LI', 'LT', 'LU',
    'MT', 'MD', 'MC', 'ME', 'NL', 'MK', 'NO', 'PL', 'PT', 'RO', 'SM', 'RS', 'SK', 'SI', 'ES', 'SE', 'CH',
    'TR', 'UA', 'GB', 'VA']);
  // Phu phi in them mat sau (moi san pham co link designBack), tinh theo tung cai.
  const PHU_PHI_MAT_SAU = 4.5;

  const STATUS_SENT = 'Đã gửi';
  const STATUS_OLD = 'Cũ';
  const STATUS_ERROR_PREFIX = 'Lỗi: ';

  // Quy doi loai ao (cot title, viet kieu nao cung duoc: "Comfort-Adult Tee", "Comfort Adult",
  // "Comfort-AdultTee"...) sang ma san pham Merchize. Thu tu quan trong: toddler va
  // sweatshirt/hoodie phai xet truoc vi title cua chung cung co the chua chu "adult".
  // Sweatshirt/hoodie tre em chua co trong bang -> tra ve null de bao loi, khong gui nham size nguoi lon.
  function xacDinhMaSanPham(title) {
    const t = String(title || '').toLowerCase().replace(/[^a-z]/g, '');
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
  const MA_SAN_PHAM = ['3001US', '301YUS', '1717US', '9018US', '3321US', '1800US', '1850US'];

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
    'usa': 'US', 'united states of america': 'US', 'uk': 'GB', 'england': 'GB', 'scotland': 'GB',
    'wales': 'GB', 'great britain': 'GB', 'turkey': 'TR', 'russia': 'RU', 'south korea': 'KR',
    'korea': 'KR', 'czech republic': 'CZ', 'holland': 'NL', 'the netherlands': 'NL', 'vietnam': 'VN'
  };
  function maQuocGia(ten) {
    const v = str(ten);
    if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
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
            if (name && name !== code) bangQuocGia[name.toLowerCase()] = code;
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

  // Tra SKU cho 1 dong. Mau ghep "A/B" (Etsy gop nhieu mau vao 1 lua chon) -> thu tung manh,
  // chi nhan khi dung 1 manh khop catalog.
  function traSku(catalog, title, color, size) {
    const maSp = xacDinhMaSanPham(title);
    if (!maSp) return { loi: `không nhận ra loại áo "${title}"` };
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

  async function docTrangTinh(spreadsheetId, title) {
    const range = encodeURIComponent(`'${title}'!A:AG`);
    // FORMATTED_VALUE: lay dung chu dang hien tren o (giu nguyen postalCode "02720", orderNumber khong bi thanh 4.17E+09).
    const data = await sheetsApiFetch(`${spreadsheetId}/values/${range}?valueRenderOption=FORMATTED_VALUE`, { method: 'GET' });
    return data.values || [];
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
      const tra = traSku(catalog, title, color, size);
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

  // Dien Base Cost uoc tinh cho cac don "Da gui" ma cot Y con trong (vd don gui tu ban cu).
  async function dienBaseCost(statusEl) {
    const catalog = docCatalogDaLuu();
    if (!catalog) throw new Error('Chưa có catalog. Bấm "Cập nhật catalog" trước.');
    log(statusEl, '⏳ Đang đọc trang tính...');
    const { spreadsheetId, title } = await layTrangTinhDangMo();
    const rows = await docTrangTinh(spreadsheetId, title);
    const donMap = new Map();
    rows.forEach((r, i) => {
      const ma = cell(r, COL.orderNumber);
      if (i === 0 || !ma || cell(r, COL.status) !== STATUS_SENT) return;
      if (!donMap.has(ma)) donMap.set(ma, { orderNumber: ma, rows: [], daGuiTruoc: false });
      donMap.get(ma).rows.push({ rowNumber: i + 1, r });
    });
    const canDien = Array.from(donMap.values()).filter((d) => !cell(d.rows[0].r, COL.baseCost));
    const list = [];
    const loi = [];
    const chiTiet = [];
    canDien.forEach((d) => {
      const kq = dungDon(d, catalog, title);
      if (typeof kq.cost === 'number') {
        list.push({ row: d.rows[0].rowNumber, cost: kq.cost });
        chiTiet.push(`• ${d.orderNumber} ${kq.chiTietCost}`);
      } else {
        loi.push(`• ${d.orderNumber}: ${kq.cost || kq.loi.join('; ')}`);
      }
    });
    await ghiBaseCost(spreadsheetId, title, list);
    return [
      `Đã điền Base Cost ước tính cho ${list.length}/${canDien.length} đơn "Đã gửi" còn trống cột Y.`,
      ...loi, 'Chi tiết:', ...chiTiet
    ].join('\n');
  }

  // ============ LAY THONG BAO WEBHOOK TU CLOUDFLARE WORKER ============
  // { url, readKey } - dung chung moi tab (1 Worker cho moi store).
  function docCauHinhWebhook() {
    try { return JSON.parse(GM_getValue('mz_webhook', 'null')); } catch (e) { return null; }
  }

  function workerRequest(cfg, method, path, body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url: cfg.url.replace(/\/+$/, '') + path,
        headers: { 'Content-Type': 'application/json', 'x-read-key': cfg.readKey },
        data: body ? JSON.stringify(body) : undefined,
        timeout: 60000,
        onload: (res) => {
          let json = null;
          try { json = JSON.parse(res.responseText); } catch (e) { /* khong phai JSON */ }
          if (res.status === 401) { reject(new Error('Worker từ chối - kiểm tra lại READ_KEY.')); return; }
          if (!json || !json.ok) { reject(new Error(`Worker trả về ${res.status}.`)); return; }
          resolve(json);
        },
        onerror: () => reject(new Error('Không kết nối được tới Worker.')),
        ontimeout: () => reject(new Error('Worker không phản hồi.'))
      });
    });
  }

  const MO_TA_LOI_DIA_CHI = {
    invalid: 'địa chỉ không hợp lệ',
    inactive: 'địa chỉ không còn hoạt động',
    missing_secondary: 'thiếu số căn hộ/phòng',
    street_undefined: 'không xác định được tên đường',
    vacant: 'địa chỉ bỏ trống',
    zipcode_undefined: 'không xác định được ZIP code',
    spelling: 'sai chính tả địa chỉ'
  };

  // Tu 1 thong bao -> nhung gi can ghi vao Sheet. null = loai su kien khong xu ly (van xoa khoi Worker).
  function noiDungTuSuKien(ev) {
    const r = ev.resource || {};
    const loai = str(ev.event_type || ev.event).toUpperCase();
    const co = { maRx: str(r.code || r.order_code) };
    if (loai === 'ORDER.INVALID.ADDRESS') {
      const mt = MO_TA_LOI_DIA_CHI[r.type_invalid] || str(r.type_invalid);
      co.status = `Lỗi địa chỉ: ${mt}${r.message_invalid ? ' - ' + str(r.message_invalid) : ''}`;
    } else if (loai === 'ORDER.IMPORTER.ERROR') {
      co.status = `Lỗi import: ${str(r.error) || str(r.status)}`;
    } else if (loai === 'ORDER.CHANGED.TRACKING') {
      if (!str(r.tracking_number)) return co.maRx ? co : null;
      co.status = 'Có tracking';
      co.tracking = str(r.tracking_number);
      co.carrier = str(r.tracking_company);
    } else if (loai === 'ORDER.ISSUE.UPDATED') {
      const msg = r.last_message || {};
      const noiDung = str(msg.body_text || msg.body).replace(/\s+/g, ' ').slice(0, 300);
      co.cacRx = (r.orders || []).map(str).filter(Boolean);
      co.ticket = `${str(r.ticket_status) || '?'}${(r.category || []).length ? ' [' + r.category.join(', ') + ']' : ''}` +
        (noiDung ? ': ' + noiDung : '');
    } else if (loai === 'ORDER.PAYMENT.FULFILLMENT_COST') {
      const gia = Number(r.price);
      if (!isNaN(gia) && str(r.price) !== '') co.cost = Math.round(gia * 100) / 100;
    } else {
      return null;
    }
    return co;
  }

  async function layThongBaoWebhook(statusEl) {
    const cfg = docCauHinhWebhook();
    if (!cfg || !cfg.url || !cfg.readKey) throw new Error('Chưa cài Worker URL và READ_KEY.');
    log(statusEl, '⏳ Đang lấy thông báo từ Worker...');
    const { events } = await workerRequest(cfg, 'GET', '/events');
    if (!events.length) return 'Không có thông báo mới.';

    // Chi doc cac tab da cai store (tab account).
    const spreadsheetId = getSpreadsheetId();
    await layTrangTinhDangMo();
    const cacTab = Object.values(tenTabTheoGid).filter((t) => layStore(t));
    log(statusEl, `⏳ Đang đọc ${cacTab.length} tab account...`);
    const duLieu = {};
    for (const t of cacTab) duLieu[t] = await docTrangTinh(spreadsheetId, t);

    const ghiText = [];
    const ghiSo = [];
    const daXuLy = [];
    const khongKhop = [];
    const tabCanTieuDe = new Set();
    const tabCanTieuDeTicket = new Set();
    let soDong = 0;

    for (const ev of events) {
      const co = noiDungTuSuKien(ev);
      if (!co) { daXuLy.push(ev.id); continue; }
      const r = ev.resource || {};
      const ma = str(r.external_number);
      const idf = str(r.identifier);
      const tim = [];
      if (co.cacRx) {
        // Ticket: khop theo ma RX-... o cot AD (chi don da duoc webhook dien ma RX).
        cacTab.forEach((t) => duLieu[t].forEach((row, i) => {
          if (i > 0 && co.cacRx.includes(cell(row, COL.merchizeId))) tim.push({ t, rowNumber: i + 1 });
        }));
        if (tim.length === 0) {
          // Da bao Telegram roi, khong giu lai de tranh bao mai tren bang.
          khongKhop.push(`• Ticket ${co.cacRx.join(', ') || '?'}: chưa có mã RX trong cột AD (đã báo Telegram)`);
          daXuLy.push(ev.id);
          continue;
        }
      } else {
        cacTab.forEach((t) => {
          duLieu[t].forEach((row, i) => {
            if (i === 0 || cell(row, COL.orderNumber) !== ma) return;
            if (idf && idf !== t && idf !== cell(row, COL.account)) return;
            tim.push({ t, rowNumber: i + 1 });
          });
        });
      }
      if (tim.length === 0) {
        khongKhop.push(`• ${ev.event_type || ev.event} ${ma || '?'} (${idf || '?'})`);
        continue;
      }
      const dongDau = {};
      tim.forEach(({ t, rowNumber }) => {
        const o = (cot) => `'${t}'!${cot}${rowNumber}`;
        if (co.status) ghiText.push({ range: o('AC'), values: [[co.status]] });
        if (co.maRx) ghiText.push({ range: o('AD'), values: [[co.maRx]] });
        if (co.ticket) {
          ghiText.push({ range: o('AG'), values: [[co.ticket]] });
          tabCanTieuDeTicket.add(t);
        }
        if (co.tracking) {
          ghiText.push({ range: o('AE'), values: [[co.tracking]] });
          ghiText.push({ range: o('AF'), values: [[co.carrier]] });
          tabCanTieuDe.add(t);
        }
        if (dongDau[t] === undefined || rowNumber < dongDau[t]) dongDau[t] = rowNumber;
        soDong++;
      });
      if (typeof co.cost === 'number') {
        Object.keys(dongDau).forEach((t) => ghiSo.push({ range: `'${t}'!Y${dongDau[t]}`, values: [[co.cost]] }));
      }
      daXuLy.push(ev.id);
    }

    tabCanTieuDeTicket.forEach((t) => {
      if (!cell(duLieu[t][0] || [], COL.ticket)) ghiText.push({ range: `'${t}'!AG1`, values: [['Ticket']] });
    });
    tabCanTieuDe.forEach((t) => {
      const h = duLieu[t][0] || [];
      if (!cell(h, COL.tracking) && !cell(h, COL.carrier)) {
        ghiText.push({ range: `'${t}'!AE1:AF1`, values: [TRACKING_HEADERS] });
      }
    });

    // RAW cho chu (tracking dai khong bi doi thanh so), USER_ENTERED cho cost (de la so).
    if (ghiText.length) {
      await sheetsApiFetch(`${spreadsheetId}/values:batchUpdate`, {
        method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: ghiText })
      });
    }
    if (ghiSo.length) {
      await sheetsApiFetch(`${spreadsheetId}/values:batchUpdate`, {
        method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: ghiSo })
      });
    }
    // Chi xoa khoi Worker sau khi da ghi xong vao Sheet. Thong bao khong khop don nao giu lai (30 ngay).
    if (daXuLy.length) await workerRequest(cfg, 'POST', '/events/ack', { ids: daXuLy });

    return [
      `Đã xử lý ${daXuLy.length}/${events.length} thông báo, cập nhật ${soDong} dòng.`,
      khongKhop.length ? `${khongKhop.length} thông báo chưa tìm thấy đơn (giữ lại, lần sau lấy tiếp):` : '',
      ...khongKhop
    ].filter(Boolean).join('\n');
  }

  // ============ TRA THU 1 DON QUA API TRACKING (XEM DU LIEU THAT) ============
  // Tai lieu API /order/external/orders/tracking khong ghi ten truong chua so tracking, nen
  // truoc het hien nguyen du lieu that cua 1 don de xac dinh dung truong roi moi tu dong dien.
  async function traThu1Don(statusEl) {
    const { title } = await layTrangTinhDangMo();
    const store = layStore(title);
    if (!store) throw new Error(`Tab "${title}" chưa cài store Merchize.`);
    const ma = str(W.prompt(`Nhập mã đơn Etsy (orderNumber) cần tra trong store của tab "${title}":`, ''));
    if (!ma) return 'Đã hủy.';
    log(statusEl, `⏳ Đang tra đơn ${ma}...`);
    const { status, json } = await merchizeRequest(store, 'GET',
      '/order/external/orders/tracking?external_number=' + encodeURIComponent(ma));
    if (!json.success) return `Merchize trả về ${status}: ${json.message || JSON.stringify(json).slice(0, 500)}`;
    const goi = Array.isArray(json.data) ? json.data : [];
    // Liet ke moi truong co chu "track" o bat ky cap nao de biet ten truong that.
    const truongTracking = [];
    (function quet(o, duong) {
      if (!o || typeof o !== 'object') return;
      Object.keys(o).forEach((k) => {
        const p = duong ? duong + '.' + k : k;
        if (/track/i.test(k)) truongTracking.push(`${p} = ${JSON.stringify(o[k])}`);
        quet(o[k], p);
      });
    })(goi, 'data');
    const tomTat = goi.map((g, i) => {
      const cost = (g.items || []).reduce((t, it) => t + (Number(it.fulfillment_cost) || 0), 0);
      return `• Gói ${i + 1}: ${g.name || '?'} | ${g.status || '?'} | has_tracking=${g.has_tracking} | ` +
        `tổng fulfillment_cost items=${Math.round(cost * 100) / 100}, shipping_cost=${g.shipping_cost}`;
    });
    return [
      `Đơn ${ma}: ${goi.length} gói hàng.`,
      ...tomTat,
      'Các trường liên quan tracking:',
      ...(truongTracking.length ? truongTracking : ['(không có trường nào chứa chữ "track")']),
      '',
      'Dữ liệu gốc:',
      JSON.stringify(json.data, null, 1).slice(0, 6000)
    ].join('\n');
  }

  // ============ 3 CHUC NANG CHINH ============
  async function kiemTraHoacGui(statusEl, guiThat) {
    const catalog = docCatalogDaLuu();
    if (!catalog) throw new Error('Chưa có catalog. Bấm "Cập nhật catalog" trước.');

    log(statusEl, '⏳ Đang đọc trang tính...');
    const { spreadsheetId, title } = await layTrangTinhDangMo();
    const store = layStore(title);
    if (guiThat && !store) throw new Error(`Tab "${title}" chưa cài store Merchize (Base URL + Access Token).`);
    const rows = await docTrangTinh(spreadsheetId, title);
    const donList = gomDon(rows).map((d) => ({ ...d, ...dungDon(d, catalog, title) }));
    if (donList.length === 0) return `Trang "${title}": không có đơn nào chờ gửi (cột AC đều đã có trạng thái).`;

    const hopLe = donList.filter((d) => d.loi.length === 0);
    const coLoi = donList.filter((d) => d.loi.length > 0);
    const dongLoi = coLoi.map((d) => `• ${d.orderNumber}: ${d.loi.join('; ')}`);

    if (!guiThat) {
      // Kiem tra: chi dien SKU vao AB, KHONG ghi AC de don van con o trang thai cho gui.
      const updates = [];
      donList.forEach((d) => d.rows.forEach(({ rowNumber, r }, i) => {
        updates.push({ row: rowNumber, values: [d.skus[i], cell(r, COL.status), cell(r, COL.merchizeId)] });
      }));
      await damBaoTieuDe(spreadsheetId, title, rows);
      await ghiKetQua(spreadsheetId, title, updates);
      return [
        `Trang "${title}": ${donList.length} đơn chờ gửi, ${hopLe.length} đơn hợp lệ, ${coLoi.length} đơn có lỗi.`,
        'Đã điền Merchize SKU vào cột AB (chưa gửi gì lên Merchize).',
        ...dongLoi
      ].join('\n');
    }

    if (hopLe.length === 0) {
      return [`Không có đơn hợp lệ để gửi (${coLoi.length} đơn lỗi):`, ...dongLoi].join('\n');
    }
    const ok = W.confirm(
      `Gửi ${hopLe.length} đơn trong trang "${title}" lên store Merchize:\n${store.baseUrl}` +
      (coLoi.length ? `\n(${coLoi.length} đơn lỗi sẽ được đánh dấu, không gửi)` : '') +
      (hopLe.length > 30 ? '\n\nSố đơn khá nhiều. Nếu đây là đơn cũ, hãy bấm Hủy rồi dùng nút "Đánh dấu dòng cũ".' : '')
    );
    if (!ok) return 'Đã hủy, chưa gửi đơn nào.';

    await damBaoTieuDe(spreadsheetId, title, rows);

    // Don loi: ghi ngay trang thai loi (sua xong thi xoa o AC de gui lai).
    const updLoi = [];
    coLoi.forEach((d) => d.rows.forEach(({ rowNumber }, i) => {
      updLoi.push({ row: rowNumber, values: [d.skus[i], STATUS_ERROR_PREFIX + d.loi.join('; '), ''] });
    }));
    await ghiKetQua(spreadsheetId, title, updLoi);

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
          if (typeof d.cost === 'number' && !cell(d.rows[0].r, COL.baseCost)) {
            await ghiBaseCost(spreadsheetId, title, [{ row: d.rows[0].rowNumber, cost: d.cost }]);
          }
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
      `Trang "${title}": gửi thành công ${thanhCong}/${hopLe.length} đơn.`,
      ...ketQuaGui,
      coLoi.length ? `${coLoi.length} đơn không gửi vì lỗi dữ liệu:` : '',
      ...dongLoi
    ].filter(Boolean).join('\n');
  }

  // Dung 1 lan cho moi tab: danh dau tat ca dong hien co la "Cu" de khong bi gui lai.
  async function danhDauDongCu(statusEl) {
    log(statusEl, '⏳ Đang đọc trang tính...');
    const { spreadsheetId, title } = await layTrangTinhDangMo();
    const rows = await docTrangTinh(spreadsheetId, title);
    const donList = gomDon(rows);
    if (donList.length === 0) return `Trang "${title}": không có dòng nào cần đánh dấu.`;
    const soDong = donList.reduce((n, d) => n + d.rows.length, 0);
    const ok = W.confirm(`Đánh dấu "${STATUS_OLD}" cho ${soDong} dòng (${donList.length} đơn) trong trang "${title}"?\nCác dòng này sẽ KHÔNG bao giờ được gửi lên Merchize.`);
    if (!ok) return 'Đã hủy.';
    await damBaoTieuDe(spreadsheetId, title, rows);
    const updates = [];
    donList.forEach((d) => d.rows.forEach(({ rowNumber, r }) => {
      updates.push({ row: rowNumber, values: [cell(r, COL.merchizeSku), STATUS_OLD, cell(r, COL.merchizeId)] });
    }));
    await ghiKetQua(spreadsheetId, title, updates);
    return `Đã đánh dấu ${soDong} dòng là "${STATUS_OLD}".`;
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

    const panel = el('div', `position:fixed!important;z-index:${MAX_Z}!important;width:${PANEL_WIDTH}px;padding:14px;
      background:#fff;border:1px solid #ccc;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.4);
      font-family:Arial,sans-serif;font-size:13px;display:none;`);

    panel.appendChild(el('div', 'font-weight:bold;margin-bottom:8px;', 'Gửi đơn lên Merchize'));
    panel.appendChild(el('div', 'font-size:12px;color:#777;margin-bottom:10px;',
      'Chỉ làm việc trên trang tính đang mở. Đơn chờ gửi = dòng có orderNumber và cột AC còn trống.'));

    const oCss = 'width:100%;box-sizing:border-box;padding:6px;margin-bottom:6px;border:1px solid #ccc;border-radius:4px;';
    const tokenLabel = el('div', 'font-size:12px;font-weight:bold;margin-bottom:4px;', 'Store Merchize của tab đang mở');
    const storeInfo = el('div', 'font-size:12px;font-weight:bold;margin-bottom:6px;', '');
    const baseInput = el('input', oCss);
    baseInput.placeholder = 'Base URL, vd ' + BASE_URL_GOI_Y;
    const tokenInput = el('input', oCss);
    tokenInput.type = 'password';
    tokenInput.placeholder = 'Access Token của store này';
    const saveTokenBtn = nut('Lưu store cho tab này', '#607d8b');
    const viewStoreBtn = nut('Xem store của tab', '#90a4ae');

    const catalogInfo = el('div', 'font-size:11px;color:#999;margin:4px 0 6px;');
    function capNhatCatalogInfo() {
      const c = docCatalogDaLuu();
      catalogInfo.textContent = c
        ? `Catalog: ${Object.keys(c.products).length} sản phẩm, cập nhật ${new Date(c.updated).toLocaleString()}`
        : 'Catalog: chưa có';
    }
    capNhatCatalogInfo();

    const catalogBtn = nut('1. Cập nhật catalog', '#2196F3');
    const checkBtn = nut('2. Kiểm tra (điền SKU, chưa gửi)', '#8e24aa');
    const sendBtn = nut('3. Gửi đơn lên Merchize', '#4CAF50');
    const costBtn = nut('Điền Base Cost ước tính cho đơn đã gửi', '#00897b');
    const oldBtn = nut('Đánh dấu dòng cũ (dùng 1 lần mỗi tab)', '#9e9e9e');

    const whLabel = el('div', 'font-size:12px;font-weight:bold;margin:8px 0 4px;border-top:1px solid #eee;padding-top:8px;', 'Thông báo Merchize (Webhook)');
    const whUrl = el('input', oCss);
    whUrl.placeholder = 'Worker URL, vd https://merchize-webhook.xxx.workers.dev';
    const whKey = el('input', oCss);
    whKey.type = 'password';
    const cfgWh = docCauHinhWebhook();
    if (cfgWh) whUrl.value = cfgWh.url;
    whKey.placeholder = cfgWh && cfgWh.readKey ? 'READ_KEY đã lưu (dán mới để thay)' : 'READ_KEY';
    const whSaveBtn = nut('Lưu cài đặt Worker', '#607d8b');
    const whBtn = nut('Lấy thông báo Merchize', '#e65100');
    const apiTestBtn = nut('Tra thử 1 đơn qua API (xem dữ liệu)', '#795548');

    const statusEl = el('pre', 'white-space:pre-wrap;margin-top:8px;max-height:280px;overflow:auto;font-size:12px;color:#333;');

    [tokenLabel, storeInfo, baseInput, tokenInput, saveTokenBtn, viewStoreBtn, catalogInfo, catalogBtn, checkBtn, sendBtn, costBtn, oldBtn, whLabel, whUrl, whKey, whSaveBtn, whBtn, apiTestBtn, statusEl]
      .forEach((x) => panel.appendChild(x));
    document.body.appendChild(btn);
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

    const tatCaNut = [saveTokenBtn, viewStoreBtn, catalogBtn, checkBtn, sendBtn, costBtn, oldBtn, whSaveBtn, whBtn, apiTestBtn];
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

    function hienStore(title) {
      const st = layStore(title);
      storeInfo.textContent = st
        ? `✅ Tab "${title}": đã có token\n${st.baseUrl}`
        : `❌ Tab "${title}": chưa có token`;
      storeInfo.style.whiteSpace = 'pre-wrap';
      storeInfo.style.color = st ? '#2e7d32' : '#c62828';
      if (document.activeElement !== baseInput) baseInput.value = st ? st.baseUrl : '';
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
          storeInfo.textContent = 'Bấm "Xem store của tab" để kiểm tra.';
          storeInfo.style.color = '#777';
        }
        return;
      }
      if (ten === tabDaHien) return;
      tabDaHien = ten;
      hienStore(ten);
    }
    setInterval(capNhatStoreTheoTab, 500);
    window.addEventListener('hashchange', capNhatStoreTheoTab);

    viewStoreBtn.addEventListener('click', () => chay(xemStore));
    saveTokenBtn.addEventListener('click', () => chay(async () => {
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
      await xemStore();
      return `Đã lưu store cho tab "${title}" (chỉ lưu trong Violentmonkey trên máy này).`;
    }));
    catalogBtn.addEventListener('click', () => chay(() => capNhatCatalog(statusEl)));
    checkBtn.addEventListener('click', () => chay(() => kiemTraHoacGui(statusEl, false)));
    sendBtn.addEventListener('click', () => chay(() => kiemTraHoacGui(statusEl, true)));
    costBtn.addEventListener('click', () => chay(() => dienBaseCost(statusEl)));
    whSaveBtn.addEventListener('click', () => chay(async () => {
      const url = str(whUrl.value).replace(/\/+$/, '');
      if (!/^https:\/\/[a-z0-9.-]+\.workers\.dev$/i.test(url)) throw new Error('Worker URL phải có dạng https://....workers.dev');
      const cu = docCauHinhWebhook();
      const readKey = str(whKey.value) || (cu && cu.readKey) || '';
      if (!readKey) throw new Error('Chưa dán READ_KEY.');
      GM_setValue('mz_webhook', JSON.stringify({ url, readKey }));
      whKey.value = '';
      whKey.placeholder = 'READ_KEY đã lưu (dán mới để thay)';
      return 'Đã lưu cài đặt Worker.';
    }));
    whBtn.addEventListener('click', () => chay(() => layThongBaoWebhook(statusEl)));
    apiTestBtn.addEventListener('click', () => chay(() => traThu1Don(statusEl)));
    oldBtn.addEventListener('click', () => chay(() => danhDauDongCu(statusEl)));
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
