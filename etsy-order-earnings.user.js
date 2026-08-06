// ==UserScript==
// @name         Etsy Order Scraper + Earnings -> Excel
// @namespace    etsy-order-scraper
// @version      1.0
// @description  Quet don hang Etsy, tu dong lay Earnings tung don, xoa du lieu cu va xuat ngay ra file Excel (khong header). Giao dien co the thu nho thanh 1 bieu tuong "Order" va keo tha tu do.
// @match        https://www.etsy.com/your/orders*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @require      https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ====== CAU HINH - CHINH LAI O DAY NEU CAN ======
  // Thu tu cot phai khop dung voi file excel mau cua ban.
  // Neu header thuc te khac ten ben duoi, sua lai cho dung.
  // Cot L: "Personalization", dung de chua gia tri personalization cua san pham.
  // Da them 1 cot trong ngay ben phai cot "Personalization" (key: ' ')
  // Da xoa 2 cot "Printing" va "Account". Da them cot "Earnings" ngay ben phai "Date Fulfil".
  // File Excel xuat ra KHONG co dong header.
  const HEADERS = [
    'orderNumber', 'mockUpFront', 'Image',
    'designFront', 'designBack', 'title', 'color', 'size', 'quantity',
    'Personalization', ' ', 'name', 'address1', 'address2', 'city', 'state',
    'postalCode', 'country', 'phone', 'email', 'Date Fulfil', 'Earnings'
  ];

  const STORAGE_KEY = 'etsy_scraped_orders_v1';
  // Luu vi tri + trang thai thu nho/mo rong cua panel
  const PANEL_STATE_KEY = 'etsy_scraper_panel_state_v1';

  // ====== SELECTOR PHUC VU LAY EARNINGS (chinh neu Etsy doi giao dien) ======
  const SEL = {
    // o input tim kiem don hang (dua vao aria-label "Search your orders")
    searchInput: 'input[aria-label="Search your orders"]',
    // nut submit trong form tim kiem
    searchSubmitBtn: 'button[type="submit"]',
    // tab "Earnings" trong trang chi tiet don - tim theo text vi class hay doi
    earningsTabText: 'Earnings',
    // dong chu "You earned $xx.xx on this order" -> lay so trong <span>
    earningsAmountSelector: 'span.wt-text-title-large',
  };

  const WAIT_TIMEOUT = 15000; // 15s cho moi buoc
  const STEP_DELAY = 600; // nghi giua cac buoc de trang kip render

  // ====== TIEN ICH CHUNG ======
  function getStoredData() {
    try {
      return JSON.parse(GM_getValue(STORAGE_KEY, '[]'));
    } catch (e) {
      return [];
    }
  }

  function saveData(data) {
    GM_setValue(STORAGE_KEY, JSON.stringify(data));
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function waitFor(checkFn, timeout = WAIT_TIMEOUT) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const interval = setInterval(() => {
        const result = checkFn();
        if (result) {
          clearInterval(interval);
          resolve(result);
        } else if (Date.now() - start > timeout) {
          clearInterval(interval);
          reject(new Error('Timeout cho phan tu'));
        }
      }, 200);
    });
  }

  // Etsy co 2 dang duong dan anh:
  //   Dang "c" (thumbnail cache, co kich thuoc nhung trong duong dan):
  //     .../58864821/c/1360/1360/300/223/il/409428/7541359670/il_794xN...jpg
  //   Dang "r" (anh goc, khong bi cat):
  //     .../58786000/r/il/31255a/7649361332/il_794xN...jpg
  // Neu gap dang "c", doi "c" -> "r" va xoa doan kich thuoc nam giua
  // "c" va "il" (vd "1360/1360/300/223/") de ra dung dang "r/il/...".
  function fixCFormatUrl(src) {
    if (!src) return src;
    return src.replace(/\/c\/[\d/]+\/il\//, '/r/il/');
  }

  function toBigImage(src) {
    if (!src) return '';
    // Sua dang "c" -> "r" truoc (neu co)
    let fixed = fixCFormatUrl(src);
    // vd: .../il_75x75.7875320399_d5sm.jpg  ->  .../il_794xN.7875320399_d5sm.jpg
    return fixed.replace(/il_\d+x\d+/, 'il_794xN');
  }

  function getOrderNumber(link) {
    try {
      const url = new URL(link.href, location.origin);
      const oid = url.searchParams.get('order_id');
      if (oid) return oid;
    } catch (e) { /* noop */ }
    return link.textContent.trim().replace(/^#/, '');
  }

  // Tim khung chua toan bo 1 don hang (bao gom ca link order + dia chi + san pham)
  function findOrderContainer(linkEl) {
    let node = linkEl;
    for (let i = 0; i < 20 && node; i++) {
      if (
        node.querySelector &&
        node.querySelector('span.name') &&
        node.querySelector('img[alt]')
      ) {
        return node;
      }
      node = node.parentElement;
    }
    return linkEl.closest('div') || document.body;
  }

  function extractAddress(container) {
    const q = (sel) => {
      const el = container.querySelector(sel);
      return el ? el.textContent.trim() : '';
    };

    const emailLink = container.querySelector('a[href^="mailto:"]');
    const email = emailLink
      ? emailLink.getAttribute('href').replace(/^mailto:/i, '').split('?')[0].trim()
      : '';

    return {
      name: q('span.name'),
      address1: q('span.first-line'),
      address2: q('span.second-line'),
      city: q('span.city'),
      state: q('span.state'),
      postalCode: q('span.zip'),
      country: q('span.country-name'),
      // CHUA CHAC CHAN: chua co vi du HTML co so dien thoai.
      // Tam thoi thu vai class pho bien, ban kiem tra lai giup minh.
      phone: q('span.phone') || q('.phone-number') || q('[class*="phone"]'),
      email
    };
  }

  // Lay danh sach gia tri theo nhan (label) dang: <span>Quantity</span><span class="strong">1</span>
  function getLabelValues(container, labelText) {
    const spans = Array.from(container.querySelectorAll('span'));
    const values = [];
    spans.forEach((span) => {
      if (span.textContent.trim() === labelText) {
        const strong = span.parentElement
          ? span.parentElement.querySelector('span.strong')
          : null;
        if (strong) values.push(strong.textContent.trim());
      }
    });
    return values;
  }

  // Etsy co the hien thi nhan la "Style & Size" HOAC chi "Size" (khi listing
  // khong co tuy chon Style). Thu ca hai, uu tien "Style & Size" neu co.
  function getStyleSizeValues(container) {
    const styleAndSize = getLabelValues(container, 'Style & Size');
    if (styleAndSize.length) return styleAndSize;
    return getLabelValues(container, 'Size');
  }

  function extractLineItems(container) {
    // Luu y: khi 1 don co nhieu san pham CUNG 1 listing (vd ao dong phuc,
    // moi cai chi khac ten in ca nhan hoa) thi tat ca cac san pham nay
    // dung CHUNG 1 anh mockup. Vi vay khong the dua vao anh de dem so
    // san pham - phai dua vao Quantity / Style & Size (so luong the nay
    // luon dung bang so san pham thuc te trong don).
    const imgs = Array.from(
      container.querySelectorAll('.flag-img img[alt], img[alt][src*="etsystatic"]')
    );
    const uniqueImgs = [];
    const seenSrc = new Set();
    imgs.forEach((img) => {
      const src = img.getAttribute('src');
      if (src && !seenSrc.has(src)) {
        seenSrc.add(src);
        uniqueImgs.push(img);
      }
    });

    const quantities = getLabelValues(container, 'Quantity');
    const styleSizes = getStyleSizeValues(container);
    const colors = getLabelValues(container, 'Color');
    const personalizations = getLabelValues(container, 'Personalization');

    // So san pham that su = so the "Quantity" (moi san pham co 1 the Quantity
    // rieng), day la nguon dang tin cay nhat, khong phu thuoc vao anh.
    const count = Math.max(quantities.length, styleSizes.length, 1);
    const items = [];

    for (let i = 0; i < count; i++) {
      // Anh: neu co nhieu anh khac nhau thi lay theo dung thu tu i,
      // neu chi co 1 anh chung (truong hop pho bien) thi dung anh do cho tat ca.
      const img = uniqueImgs[i] || uniqueImgs[0];
      const styleSize = styleSizes[i] || styleSizes[0] || '';
      const parts = styleSize.trim().split(/\s+/).filter(Boolean);
      const size = parts.length ? parts[parts.length - 1] : '';
      let title = parts.length > 1 ? parts.slice(0, -1).join(' ') : '';

      const personalization = personalizations[i] || '';
      // Personalization xuat ra cot rieng ("Personalization"), khong ghep vao title.
      // Van giu bien personalization de dung phan biet cac dong giong nhau
      // (tranh bi coi la trung) khi can.

      items.push({
        mockUpFront: img ? toBigImage(img.getAttribute('src')) : '',
        title,
        size,
        quantity: quantities[i] || quantities[0] || '',
        color: colors[i] || colors[0] || '',
        personalization
      });
    }
    return items;
  }

  function extractOrdersFromPage() {
    const orderLinks = Array.from(
      document.querySelectorAll('a[href*="/your/orders/sold"]')
    ).filter((a) => {
      const txt = a.textContent.trim();
      return /^#?\d+$/.test(txt) || /order_id=/.test(a.href);
    });

    const seenContainers = new Set();
    const results = [];

    orderLinks.forEach((link) => {
      const container = findOrderContainer(link);
      if (!container || seenContainers.has(container)) return;
      seenContainers.add(container);

      const orderNumber = getOrderNumber(link);
      const addr = extractAddress(container);
      const items = extractLineItems(container);

      items.forEach((item) => {
        results.push({
          orderNumber,
          mockUpFront: item.mockUpFront,
          Image: '',
          designFront: '',
          designBack: '',
          title: item.title,
          color: item.color,
          size: item.size,
          quantity: item.quantity,
          Personalization: item.personalization,
          ' ': '', // cot trong ben phai "Personalization"
          name: addr.name,
          address1: addr.address1,
          address2: addr.address2,
          city: addr.city,
          state: addr.state,
          postalCode: addr.postalCode,
          country: addr.country,
          phone: addr.phone,
          email: addr.email,
          'Date Fulfil': '',
          Earnings: ''
        });
      });
    });

    return results;
  }

  // Thay dau "-" bang khoang trang trong title, vd "Comfort-Youth" -> "Comfort Youth"
  // Va bo chu "Tee" (dung rieng le HOAC dinh lien vao cuoi 1 tu, vd "AdultTee"),
  // vi du: "Comfort-Adult Tee" -> "Comfort Adult", "Comfort-AdultTee" -> "Comfort Adult"
  function cleanTitleForExport(title) {
    if (!title) return title;
    let out = title.replace(/-/g, ' ');
    // Bo "Tee" khi dinh lien ngay sau 1 chu cai khac (khong co khoang trang truoc no),
    // vd "AdultTee" -> "Adult". Giu lai chu cai ngay truoc "Tee".
    out = out.replace(/([a-zA-Z])Tee(?=[^a-zA-Z]|$)/gi, '$1');
    // Bo tu "Tee" dung rieng le (khong dinh lien voi chu khac, khong phan biet hoa/thuong)
    out = out.replace(/\bTee\b/gi, '');
    // Don lai khoang trang thua do bo chu "Tee" de lai
    out = out.replace(/\s+/g, ' ').trim();
    return out;
  }

  // Thay dau nhay don cong (’) bang dau nhay don thang (') trong tat ca cac cot dang chu.
  function fixCurlyApostrophe(value) {
    if (typeof value !== 'string') return value;
    return value.replace(/’/g, "'");
  }

  function exportToExcelFile(data) {
    // Fix lai link anh dang "c" -> "r" ngay tai buoc xuat file, va don lai title.
    const cleanData = data.map((row) => {
      const out = {};
      HEADERS.forEach((h) => { out[h] = fixCurlyApostrophe(row[h] !== undefined ? row[h] : ''); });
      out.title = cleanTitleForExport(out.title);
      out.mockUpFront = fixCFormatUrl(out.mockUpFront);
      return out;
    });
    // skipHeader: true -> khong ghi dong header vao file Excel
    const ws = XLSX.utils.json_to_sheet(cleanData, { header: HEADERS, skipHeader: true });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Orders');
    const filename = `etsy_orders_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, filename);
  }

  // ====== LAY EARNINGS THEO MA DON (dieu khien tren chinh trang /your/orders) ======

  function setNativeValue(el, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // tim phan tu clickable (a, button, div...) chua doan text cho truoc
  function findClickableByText(text, root = document) {
    const candidates = root.querySelectorAll('a, button, div, span, li');
    for (const el of candidates) {
      if (
        el.children.length === 0 &&
        el.textContent &&
        el.textContent.trim() === text
      ) {
        return el;
      }
    }
    // fallback: chua text (khong can khop tuyet doi)
    for (const el of candidates) {
      if (el.textContent && el.textContent.includes(text)) {
        return el;
      }
    }
    return null;
  }

  // Lay chuoi so tien "$xx.xx" va tra ve chi phan so (khong don vi tien te)
  function parseAmountToNumberString(amountText) {
    if (!amountText) return '';
    const cleaned = amountText.replace(/[^0-9.\-]/g, '');
    return cleaned;
  }

  async function getEarningsForOrder(orderId) {
    // 1. Tim o search, nhap ma don
    const input = await waitFor(() => document.querySelector(SEL.searchInput));
    input.focus();
    setNativeValue(input, orderId);
    await sleep(300);

    // 2. Submit tim kiem (thu bam nut submit, neu khong co thi bam Enter)
    const submitBtn = document.querySelector(SEL.searchSubmitBtn);
    if (submitBtn) {
      submitBtn.click();
    } else {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
    await sleep(STEP_DELAY);

    // 3. Doi ket qua xuat hien, tim dong chua "#<ma don>" va click vao
    const orderRow = await waitFor(() => findClickableByText('#' + orderId));
    orderRow.click();
    await sleep(STEP_DELAY);

    // 4. Click tab "Earnings"
    const earningsTab = await waitFor(() => findClickableByText(SEL.earningsTabText));
    earningsTab.click();
    await sleep(STEP_DELAY);

    // 5. Lay so tien - tim span chua "$" gan cum "You earned"
    const amountEl = await waitFor(() => {
      const spans = document.querySelectorAll(SEL.earningsAmountSelector);
      for (const s of spans) {
        if (/^\$[\d,.]+$/.test(s.textContent.trim())) return s;
      }
      return null;
    });

    return parseAmountToNumberString(amountEl.textContent.trim());
  }

  // Lay earnings tuan tu cho tung ma don hang duy nhat, ghi ket qua vao
  // tat ca cac dong (rows) co cung orderNumber. Bao tien do qua callback onProgress.
  async function fillEarningsForRows(rows, onProgress) {
    const uniqueOrderNumbers = [...new Set(rows.map((r) => r.orderNumber).filter(Boolean))];
    const earningsByOrder = {};

    for (let i = 0; i < uniqueOrderNumbers.length; i++) {
      const orderId = uniqueOrderNumbers[i];
      if (typeof onProgress === 'function') {
        onProgress(`⏳ (${i + 1}/${uniqueOrderNumbers.length}) Đang lấy Earnings đơn #${orderId}...`);
      }
      try {
        earningsByOrder[orderId] = await getEarningsForOrder(orderId);
      } catch (err) {
        console.error('[Etsy Scraper] Lỗi lấy Earnings cho đơn ' + orderId + ':', err);
        earningsByOrder[orderId] = '';
      }
      await sleep(400);
    }

    rows.forEach((row) => {
      row.Earnings = earningsByOrder[row.orderNumber] || '';
    });

    return rows;
  }

  // Quet don tren trang hien tai: XOA het du lieu cu da luu, lay Earnings tung don,
  // luu du lieu moi, roi xuat file Excel va tai xuong ngay lap tuc.
  async function scanClearAndExport() {
    const newRows = extractOrdersFromPage();
    if (newRows.length === 0) {
      hienThongBao('⚠️ Không tìm thấy đơn hàng nào trên trang hiện tại. Kiểm tra Console (F12) để xem log.', '#DC2626');
      console.log('[Etsy Scraper] Khong tim thay orderLinks. Kiem tra lai selector.');
      return;
    }

    scanBtn.disabled = true;
    scanBtn.textContent = '⏳ Đang xử lý...';

    try {
      await fillEarningsForRows(newRows, (msg) => hienThongBao(msg, '#2563EB'));

      // Xoa du lieu cu, chi giu lai du lieu vua quet duoc
      saveData(newRows);
      updatePanelCount();

      exportToExcelFile(newRows);

      hienThongBao(`✅ Đã quét ${newRows.length} dòng (kèm Earnings) và tải file Excel!`, '#16A34A');
      console.log('[Etsy Scraper] Scanned rows (đã thay thế toàn bộ dữ liệu cũ):', newRows);
    } catch (err) {
      console.error('[Etsy Scraper] Lỗi trong quá trình quét + lấy Earnings:', err);
      hienThongBao('❌ Lỗi khi lấy Earnings: ' + err.message, '#DC2626');
    } finally {
      scanBtn.disabled = false;
      scanBtn.textContent = '🔍 Quét đơn + Earnings & tải Excel';
    }
  }

  // ====== GIAO DIEN NOI (FLOATING PANEL): KEO THA + THU NHO/MO RONG ======
  let countLabel;
  let messageBox;
  let scanBtn;

  function updatePanelCount() {
    if (countLabel) {
      countLabel.textContent = `Đã lưu: ${getStoredData().length} dòng`;
    }
  }

  // Hien thong bao ngay ben duoi panel, thay cho alert() phai bam OK.
  function hienThongBao(text, mau = '#374151') {
    if (!messageBox) return;
    messageBox.style.background = mau;
    messageBox.style.display = 'block';
    messageBox.textContent = text;
    clearTimeout(messageBox._timer);
    messageBox._timer = setTimeout(() => {
      messageBox.style.display = 'none';
    }, 5000);
  }

  function docTrangThaiPanel() {
    try {
      return JSON.parse(GM_getValue(PANEL_STATE_KEY, '{}')) || {};
    } catch (e) {
      return {};
    }
  }

  function luuTrangThaiPanel(state) {
    const hienTai = docTrangThaiPanel();
    GM_setValue(PANEL_STATE_KEY, JSON.stringify({ ...hienTai, ...state }));
  }

  // Cho phep keo panel bang cach giu chuot vao "tayCam". Neu ha-tha chuot ma
  // KHONG di chuyen (hoac di chuyen rat it), coi la 1 cai click va goi onClick.
  function ganKeoTha(tayCam, panelEl, onClick) {
    let dangKeo = false;
    let daDiChuyen = false;
    let downX = 0;
    let downY = 0;
    let startLeft = 0;
    let startTop = 0;

    tayCam.addEventListener('mousedown', (e) => {
      dangKeo = true;
      daDiChuyen = false;
      const rect = panelEl.getBoundingClientRect();
      panelEl.style.left = `${rect.left}px`;
      panelEl.style.top = `${rect.top}px`;
      panelEl.style.right = 'auto';
      startLeft = rect.left;
      startTop = rect.top;
      downX = e.clientX;
      downY = e.clientY;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dangKeo) return;
      const dx = e.clientX - downX;
      const dy = e.clientY - downY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) daDiChuyen = true;

      let newLeft = startLeft + dx;
      let newTop = startTop + dy;
      const maxLeft = window.innerWidth - panelEl.offsetWidth;
      const maxTop = window.innerHeight - panelEl.offsetHeight;
      newLeft = Math.min(Math.max(0, newLeft), Math.max(0, maxLeft));
      newTop = Math.min(Math.max(0, newTop), Math.max(0, maxTop));

      panelEl.style.left = `${newLeft}px`;
      panelEl.style.top = `${newTop}px`;
    });

    document.addEventListener('mouseup', () => {
      if (!dangKeo) return;
      dangKeo = false;
      luuTrangThaiPanel({ left: panelEl.style.left, top: panelEl.style.top });
      if (!daDiChuyen && typeof onClick === 'function') onClick();
    });
  }

  function buildPanel() {
    const trangThai = docTrangThaiPanel();

    // Khung ngoai cung: dinh vi co dinh, keo tha duoc tu do
    const khung = document.createElement('div');
    khung.id = 'etsy-order-scraper-panel';
    khung.style.cssText = `
      position:fixed; z-index:999999; font-family:sans-serif; user-select:none;
      top:90px; right:20px;
    `;
    if (trangThai.left && trangThai.top) {
      khung.style.left = trangThai.left;
      khung.style.top = trangThai.top;
      khung.style.right = 'auto';
    }
    document.body.appendChild(khung);

    // ---- Giao dien THU NHO: 1 bieu tuong hop/thung hang, chu "Order" ----
    const bieuTuongThuNho = document.createElement('div');
    bieuTuongThuNho.id = 'eos-mini';
    bieuTuongThuNho.title = 'Etsy Order Scraper — giữ và kéo để di chuyển, bấm để mở rộng';
    bieuTuongThuNho.style.cssText = `
      display:flex; align-items:center; justify-content:center;
      width:64px; height:64px; border-radius:50%;
      background:linear-gradient(135deg,#1a7f37,#22a745);
      color:#fff; box-shadow:0 4px 14px rgba(0,0,0,.3);
      cursor:grab; flex-direction:column; text-align:center;
    `;
    bieuTuongThuNho.innerHTML = `
      <div style="font-size:20px; line-height:1;">📦</div>
      <div style="font-size:10px; font-weight:bold; letter-spacing:.3px; margin-top:2px;">Order</div>
    `;
    khung.appendChild(bieuTuongThuNho);

    // ---- Giao dien MO RONG ----
    const khungMoRong = document.createElement('div');
    khungMoRong.id = 'eos-expanded';
    khungMoRong.style.cssText = `
      display:flex; flex-direction:column; width:220px;
      background:#fff; border-radius:10px; overflow:hidden;
      box-shadow:0 6px 20px rgba(0,0,0,.25);
    `;

    const thanhTieuDe = document.createElement('div');
    thanhTieuDe.id = 'eos-header';
    thanhTieuDe.style.cssText = `
      display:flex; align-items:center; justify-content:space-between;
      background:linear-gradient(135deg,#1a7f37,#22a745); color:#fff;
      padding:8px 10px; cursor:grab; font-weight:bold; font-size:13px;
    `;
    thanhTieuDe.innerHTML = `
      <span>📦 Order Scraper</span>
      <button id="eos-btn-minimize" title="Thu nhỏ" style="
        background:rgba(255,255,255,.25); border:none; color:#fff;
        width:22px; height:22px; border-radius:6px; cursor:pointer;
        font-weight:bold; line-height:1; font-size:14px;
      ">–</button>
    `;
    khungMoRong.appendChild(thanhTieuDe);

    const vungNoiDung = document.createElement('div');
    vungNoiDung.style.cssText = 'padding:10px; display:flex; flex-direction:column; gap:8px;';

    countLabel = document.createElement('div');
    countLabel.style.cssText = 'color:#555; font-size:12px;';
    vungNoiDung.appendChild(countLabel);

    scanBtn = document.createElement('button');
    scanBtn.textContent = '🔍 Quét đơn + Earnings & tải Excel';
    scanBtn.style.cssText = `
      padding:8px 10px; background:#1a7f37; color:#fff; border:none;
      border-radius:6px; font-weight:bold; font-size:13px; cursor:pointer;
    `;
    scanBtn.onclick = scanClearAndExport;
    vungNoiDung.appendChild(scanBtn);

    messageBox = document.createElement('div');
    messageBox.id = 'eos-message';
    messageBox.style.cssText = `
      display:none; color:#fff; font-size:12px; padding:6px 8px;
      border-radius:6px; line-height:1.4;
    `;
    vungNoiDung.appendChild(messageBox);

    khungMoRong.appendChild(vungNoiDung);
    khung.appendChild(khungMoRong);

    function hienThiThuNho() {
      bieuTuongThuNho.style.display = 'flex';
      khungMoRong.style.display = 'none';
      luuTrangThaiPanel({ minimized: true });
    }

    function hienThiMoRong() {
      bieuTuongThuNho.style.display = 'none';
      khungMoRong.style.display = 'flex';
      luuTrangThaiPanel({ minimized: false });
      // Dam bao panel khong bi trang ra ngoai man hinh sau khi mo rong
      const rect = khung.getBoundingClientRect();
      const maxLeft = window.innerWidth - rect.width;
      const maxTop = window.innerHeight - rect.height;
      if (khung.style.left) {
        const leftHienTai = parseFloat(khung.style.left) || 0;
        const topHienTai = parseFloat(khung.style.top) || 0;
        khung.style.left = `${Math.min(Math.max(0, leftHienTai), Math.max(0, maxLeft))}px`;
        khung.style.top = `${Math.min(Math.max(0, topHienTai), Math.max(0, maxTop))}px`;
      }
    }

    // Ap dung trang thai thu nho/mo rong da luu (mac dinh: mo rong)
    if (trangThai.minimized === true) {
      hienThiThuNho();
    } else {
      hienThiMoRong();
    }

    // Keo tha: bieu tuong thu nho keo+bam de mo rong; thanh tieu de khi mo rong chi de keo
    ganKeoTha(bieuTuongThuNho, khung, hienThiMoRong);
    ganKeoTha(thanhTieuDe, khung, null);

    document.getElementById('eos-btn-minimize').onclick = (e) => {
      e.stopPropagation();
      hienThiThuNho();
    };

    updatePanelCount();
  }

  buildPanel();
})();
