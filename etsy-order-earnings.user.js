// ==UserScript==
// @name         Etsy Order Scraper + Earnings -> Excel
// @namespace    etsy-order-scraper
// @version      2.3
// @description  Quet don hang Etsy, co the lay them Earnings tung don (bang cach bam vao ma don de mo bang order details, khong bi mat trang danh sach), tu dong xoa du lieu cu va xuat ra file Excel (khong header). Giao dien co the thu nho thanh 1 bieu tuong "Order" va keo tha tu do.
// @match        https://www.etsy.com/your/orders*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
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
  // Cot "Date Fulfil" duoc TU DONG dien ngay chay script (dd/mm/yyyy), khong de trong nua.
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

  // Sinh 1 so dien thoai ao ngau nhien (10 chu so), dung de dien vao cot "phone" cho cac
  // don o ngoai United States khi khong doc duoc so that tren trang - tranh o phone bi
  // trong khi in van don. Moi don se ra 1 so khac nhau (khong dung chung 1 so co dinh).
  function taoSoDienThoaiAo() {
    let soDienThoai = '';
    for (let i = 0; i < 10; i++) {
      soDienThoai += Math.floor(Math.random() * 10);
    }
    return soDienThoai;
  }

  // ====== SELECTOR PHUC VU LAY EARNINGS (chinh neu Etsy doi giao dien) ======
  const SEL = {
    // o input tim kiem don hang (dua vao aria-label "Search your orders") - chi dung cho
    // chuc nang "Lay Earnings theo danh sach ma don nhap tay"
    searchInput: 'input[aria-label="Search your orders"]',
    // nut submit trong form tim kiem
    searchSubmitBtn: 'button[type="submit"]',
    // tab "Earnings" trong bang order details - tim theo text vi class hay doi
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

  function waitFor(checkFn, timeout = WAIT_TIMEOUT, label = '') {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const interval = setInterval(() => {
        const result = checkFn();
        if (result) {
          clearInterval(interval);
          resolve(result);
        } else if (Date.now() - start > timeout) {
          clearInterval(interval);
          reject(new Error(label ? `Timeout cho phan tu: ${label}` : 'Timeout cho phan tu'));
        }
      }, 200);
    });
  }

  // Ngay hien tai luc chay script, dinh dang dd/mm/yyyy
  function getTodayDateStr() {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
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
      if (oid) return oid.trim();
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

    const country = q('span.country-name');
    // CHUA CHAC CHAN: chua co vi du HTML co so dien thoai.
    // Tam thoi thu vai class pho bien, ban kiem tra lai giup minh.
    let phone = q('span.phone') || q('.phone-number') || q('[class*="phone"]');

    // Don o ngoai United States ma chua doc duoc so dien thoai that -> tu dien so ao,
    // vi mot so noi (vd dich vu in van don) yeu cau o phone khong duoc de trong.
    if (!phone && country && country.trim().toLowerCase() !== 'united states') {
      phone = taoSoDienThoaiAo();
    }

    return {
      name: q('span.name'),
      address1: q('span.first-line'),
      address2: q('span.second-line'),
      city: q('span.city'),
      state: q('span.state'),
      postalCode: q('span.zip'),
      country,
      phone,
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

  // Ghep 1 chuoi "Style & Size" thanh { title, size }, vd "Comfort-Adult Tee L" -> title "Comfort-Adult Tee", size "L"
  function splitStyleSize(styleSize) {
    const parts = (styleSize || '').trim().split(/\s+/).filter(Boolean);
    const size = parts.length ? parts[parts.length - 1] : '';
    const title = parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
    return { title, size };
  }

  function extractLineItems(container) {
    // Moi san pham trong don nam trong 1 khoi ".flag" RIENG cua no (anh + Quantity +
    // Style & Size + Color + Personalization cua rieng san pham do). Phai lay anh/nhan
    // THEO TUNG KHOI ".flag" nay, KHONG duoc gom het anh ca don lai roi loai trung theo
    // URL - vi 2 san pham KHAC NHAU (vd 1 mau thuong + 1 mau "Vintage" cua cung listing)
    // co the dung CHUNG 1 URL anh mockup; loai trung se lam mat bot 1 anh va lam lech
    // vi tri img[i] so voi san pham thu i (vd don co 4 san pham nhung chi con 2 URL anh
    // sau khi loai trung -> san pham thu 4 se bi fallback nham ve img[0] thay vi dung anh).
    // Loc bot cac phan tu ".flag" khong phai san pham (vd flag avatar/note cua nguoi mua,
    // icon co quoc gia... dung chung class "flag" o cho khac trong don hang) - chi giu lai
    // khoi co ANH ("flag-img") VA co nhan "Quantity" rieng cua no. "Quantity" la dau hieu
    // dang tin cay nhat de xac dinh day THAT SU la 1 san pham (khong phai chi can co anh +
    // 1 "strong" bat ky, vi cac khoi khac cung co the co "strong" ma khong phai san pham,
    // gay ra 1 dong "ma" thua o dau moi don voi title/color/size/quantity deu trong).
    const flagEls = Array.from(container.querySelectorAll('.flag')).filter(
      (el) => el.querySelector('.flag-img') && getLabelValues(el, 'Quantity').length > 0
    );

    if (flagEls.length > 0) {
      return flagEls.map((flagEl) => {
        const img = flagEl.querySelector('.flag-img img[alt], img[alt][src*="etsystatic"]');
        const quantity = getLabelValues(flagEl, 'Quantity')[0] || '';
        const styleSize = getStyleSizeValues(flagEl)[0] || '';
        const { title, size } = splitStyleSize(styleSize);
        const color = getLabelValues(flagEl, 'Color')[0] || '';
        const personalization = getLabelValues(flagEl, 'Personalization')[0] || '';
        // Personalization xuat ra cot rieng ("Personalization"), khong ghep vao title.

        return {
          mockUpFront: img ? toBigImage(img.getAttribute('src')) : '',
          title,
          size,
          quantity,
          color,
          personalization
        };
      });
    }

    // Du phong: khong tim thay khoi ".flag" nao (gap DOM khac ban thuong thay), quay ve
    // cach cu la doc cac nhan Quantity/Style & Size/Color/Personalization o cap ca don
    // hang. Cach nay co the bi lech anh khi nhieu san pham dung chung 1 URL anh (xem
    // giai thich o tren) nhung van dung neu tung don chi co dung 1 san pham.
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
      const img = uniqueImgs[i] || uniqueImgs[0];
      const { title, size } = splitStyleSize(styleSizes[i] || styleSizes[0] || '');
      const personalization = personalizations[i] || '';

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
    const today = getTodayDateStr();

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
          'Date Fulfil': today,
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

  // Cac size dang khoang (vd size tre em "5-6T", "7-8T") dung dau "-" tren Etsy, nhung
  // muon xuat ra Excel dang "5/6T", "7/8T" (doi dau "-" thanh "/"). Chi ap dung cho dung
  // dinh dang so-so+chu (khong dung cham vao cac size khac nhu "S", "M", "XL"...).
  function cleanSizeForExport(size) {
    if (!size) return size;
    return size.replace(/^(\d+)-(\d+)([A-Za-z]*)$/, '$1/$2$3');
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
      out.size = cleanSizeForExport(out.size);
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

  // ====== TIEN ICH DUNG CHUNG CHO CA 2 CACH LAY EARNINGS ======

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
    return amountText.replace(/[^0-9.\-]/g, '');
  }

  async function waitForEarningsAmount() {
    const amountEl = await waitFor(() => {
      const spans = document.querySelectorAll(SEL.earningsAmountSelector);
      for (const s of spans) {
        if (/^\$[\d,.]+$/.test(s.textContent.trim())) return s;
      }
      return null;
    }, WAIT_TIMEOUT, 'so tien Earnings');
    return parseAmountToNumberString(amountEl.textContent.trim());
  }

  // ====== CACH 1 (MOI): LAY EARNINGS BANG CACH BAM TRUC TIEP VAO MA DON ======
  // (dung cho chuc nang "Quet don + Lay Earnings", vi don da san co tren trang,
  // khong can go vao o tim kiem nen KHONG bi mat trang danh sach dang xem)
  //
  // Bang "Order details" hien ra la 1 OVERLAY (peek panel) de tren danh sach, KHONG
  // phai dieu huong sang trang khac. Vi vay bat buoc phai dong overlay nay lai (bam nut X
  // hoac nhan ESC) truoc khi xu ly don tiep theo - neu khong overlay se giu nguyen don dau
  // tien va moi lan doc Earnings sau do deu ra cung 1 so tien (dinh vao tat ca cac don).

  function findOrderLinkByOrderId(orderId) {
    return document.querySelector(`a[href*="order_id=${orderId}"]`);
  }

  // Nut dong overlay: <button ...><svg class="etsy-icon">...</svg><span class="screen-reader-only">Close</span></button>
  function findCloseOrderDetailButton() {
    const spans = document.querySelectorAll('span.screen-reader-only');
    for (const span of spans) {
      if (span.textContent.trim().toLowerCase() === 'close') {
        const btn = span.closest('button');
        if (btn) return btn;
      }
    }
    return null;
  }

  function pressEscape() {
    const opts = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true };
    document.dispatchEvent(new KeyboardEvent('keydown', opts));
    document.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  // Dong bang order details: uu tien bam nut X, khong co thi nhan ESC.
  async function closeOrderDetailPanel() {
    const closeBtn = findCloseOrderDetailButton();
    if (closeBtn) {
      closeBtn.click();
    } else {
      pressEscape();
    }
    await sleep(STEP_DELAY);
    // Doi overlay bien mat hoan toan roi moi xu ly don tiep theo
    await waitFor(() => !findCloseOrderDetailButton(), 6000).catch(() => {});
  }

  async function getEarningsByClickingOrder(orderId) {
    // 1. Bam truc tiep vao ma don (link) de mo bang order details, khong dung o tim kiem
    const link = await waitFor(() => findOrderLinkByOrderId(orderId), WAIT_TIMEOUT, `link don #${orderId}`);
    link.click();
    await sleep(STEP_DELAY);

    // 2. Bam tab "Earnings" trong bang order details
    const earningsTab = await waitFor(() => findClickableByText(SEL.earningsTabText), WAIT_TIMEOUT, `tab Earnings (don #${orderId})`);
    earningsTab.click();
    await sleep(STEP_DELAY);

    // 3. Lay so tien
    const amount = await waitForEarningsAmount();

    // 4. BAT BUOC dong overlay lai (bam X hoac nhan ESC) truoc khi sang don tiep theo
    await closeOrderDetailPanel();

    return amount;
  }

  // Chuan hoa ma don thanh chuoi, bo khoang trang thua, de tranh truong hop 1 vai dong
  // co orderNumber le kieu so / co khoang trang an... khien so khop bi lech (Set/Map
  // dung so sanh chuoi tuyet doi, "123" va "123 " la 2 gia tri khac nhau).
  function chuanHoaMaDon(orderNumber) {
    return String(orderNumber || '').trim();
  }

  // Lay earnings tuan tu cho tung ma don hang duy nhat (bang cach bam vao ma don).
  // Neu 1 don co nhieu dong (nhieu san pham) thi CHI dien Earnings vao DONG DAU TIEN
  // cua don do, cac dong sau cua cung don giu nguyen trong.
  // Tra ve true neu bi nguoi dung bam nut Dung giua chung.
  async function fillEarningsForRowsByClick(rows, onProgress) {
    const uniqueOrderNumbers = [...new Set(rows.map((r) => chuanHoaMaDon(r.orderNumber)).filter(Boolean))];
    const earningsByOrder = new Map();
    let stopped = false;

    for (let i = 0; i < uniqueOrderNumbers.length; i++) {
      if (cancelRequested) {
        stopped = true;
        break;
      }
      const orderId = uniqueOrderNumbers[i];
      if (typeof onProgress === 'function') {
        onProgress(`⏳ (${i + 1}/${uniqueOrderNumbers.length}) Đang lấy Earnings đơn #${orderId}...`);
      }
      try {
        earningsByOrder.set(orderId, await getEarningsByClickingOrder(orderId));
      } catch (err) {
        console.error('[Etsy Scraper] Lỗi lấy Earnings cho đơn ' + orderId + ':', err);
        earningsByOrder.set(orderId, '');
      }
      await sleep(400);
    }

    console.log('[Etsy Scraper] Bảng Earnings theo mã đơn:', Object.fromEntries(earningsByOrder));

    // Chi dien vao dong DAU TIEN cua moi ma don, cac dong sau (cung 1 don) bo qua.
    const daDienChoMaDon = new Set();
    let soDongDaDien = 0;
    rows.forEach((row) => {
      const key = chuanHoaMaDon(row.orderNumber);
      if (earningsByOrder.has(key) && !daDienChoMaDon.has(key)) {
        row.Earnings = earningsByOrder.get(key) || '';
        daDienChoMaDon.add(key);
        soDongDaDien++;
      }
    });
    console.log(`[Etsy Scraper] Đã điền Earnings cho ${soDongDaDien}/${rows.length} dòng.`);

    return stopped;
  }

  // ====== CACH 2 (CU - GIU NGUYEN NHU BAN DAU): LAY EARNINGS QUA O TIM KIEM ======
  // Dung rieng cho chuc nang "Lay Earnings theo danh sach ma don nhap tay", vi cac ma don
  // nay co the KHONG nam trong danh sach dang hien thi tren trang, nen phai tim kiem.

  async function getEarningsForOrderBySearch(orderId) {
    // 1. Tim o search, nhap ma don
    const input = await waitFor(() => document.querySelector(SEL.searchInput), WAIT_TIMEOUT, 'o tim kiem don hang');
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

    // 3. Doi ket qua xuat hien, bam vao ma don de mo bang order details.
    // Dung findOrderLinkByOrderId (khop theo href chua order_id, giong CACH 1) thay vi tim
    // theo NOI DUNG CHU "#<ma don>": khi tim theo chu, ham findClickableByText co the vo
    // tinh khop nham vao 1 the <div>/<span> BAO NGOAI ca khoi ket qua tim kiem (vi no cung
    // "chua" doan chu do), khong phai chinh the <a> co the bam duoc - bam vao do khong co
    // tac dung gi, lam cac buoc sau (tim tab Earnings) bi timeout vi overlay khong bao gio mo.
    const orderLink = await waitFor(() => findOrderLinkByOrderId(orderId), WAIT_TIMEOUT, `link don #${orderId} trong ket qua tim kiem`);
    orderLink.click();
    await sleep(STEP_DELAY);

    // 4. Click tab "Earnings"
    const earningsTab = await waitFor(() => findClickableByText(SEL.earningsTabText), WAIT_TIMEOUT, `tab Earnings (don #${orderId})`);
    earningsTab.click();
    await sleep(STEP_DELAY);

    // 5. Lay so tien
    const amount = await waitForEarningsAmount();

    // 6. Dong bang order details lai (cung la 1 overlay) truoc khi tim ma don tiep theo
    await closeOrderDetailPanel();

    return amount;
  }

  // ====== CHUC NANG 1 + 2: QUET DON (CO HOAC KHONG LAY EARNINGS) ROI XUAT EXCEL ======

  // Kiem tra thu vien XLSX (nap qua @require) da san sang chua. Neu CDN bi chan/loi mang,
  // Violentmonkey se khong nap duoc thu vien nay va bien XLSX se khong ton tai - kiem tra
  // truoc khi quet/lay Earnings de bao loi ngay, khong de nguoi dung cho xong roi moi bao loi.
  function kiemTraXLSXSanSang() {
    if (typeof XLSX === 'undefined') {
      hienThongBao(
        '❌ Chưa tải được thư viện Excel (XLSX). Thử tải lại trang (F5) rồi chạy lại; ' +
        'nếu vẫn lỗi, kiểm tra AdBlock/tường lửa có đang chặn cdn.jsdelivr.net không.',
        '#DC2626'
      );
      console.error('[Etsy Scraper] Bien XLSX chua duoc nap (kiem tra @require trong script va ket noi mang toi CDN).');
      return false;
    }
    return true;
  }

  async function scanAndExport(withEarnings) {
    if (!kiemTraXLSXSanSang()) return;

    const newRows = extractOrdersFromPage();
    if (newRows.length === 0) {
      hienThongBao('⚠️ Không tìm thấy đơn hàng nào trên trang hiện tại. Kiểm tra Console (F12) để xem log.', '#DC2626');
      console.log('[Etsy Scraper] Khong tim thay orderLinks. Kiem tra lai selector.');
      return;
    }

    const originalText = btnScanEarnings.textContent;
    setRunningState(true);
    if (withEarnings) btnScanEarnings.textContent = '⏳ Đang xử lý...';
    else btnScanOnly.textContent = '⏳ Đang xử lý...';

    try {
      let stopped = false;
      if (withEarnings) {
        stopped = await fillEarningsForRowsByClick(newRows, (msg) => hienThongBao(msg, '#2563EB'));
      }

      // Xoa du lieu cu, chi giu lai du lieu vua quet duoc
      saveData(newRows);
      updatePanelCount();

      exportToExcelFile(newRows);

      if (stopped) {
        hienThongBao(`⏹ Đã dừng theo yêu cầu. Đã xuất ${newRows.length} dòng (Earnings chưa lấy hết cho tất cả đơn).`, '#F59E0B');
      } else {
        const ghiChu = withEarnings ? ' (kèm Earnings)' : '';
        hienThongBao(`✅ Đã quét ${newRows.length} dòng${ghiChu} và tải file Excel!`, '#16A34A');
      }
      console.log('[Etsy Scraper] Scanned rows (đã thay thế toàn bộ dữ liệu cũ):', newRows);
    } catch (err) {
      console.error('[Etsy Scraper] Lỗi trong quá trình quét:', err);
      hienThongBao('❌ Lỗi: ' + err.message, '#DC2626');
    } finally {
      btnScanEarnings.textContent = originalText;
      btnScanOnly.textContent = '📦 Quét đơn & tải Excel';
      setRunningState(false);
    }
  }

  // ====== CHUC NANG 3: LAY EARNINGS THEO DANH SACH MA DON NHAP TAY (NHU BAN DAU) ======

  async function runEarningsOnlyExport() {
    if (!kiemTraXLSXSanSang()) return;

    const raw = idsTextarea.value;
    const ids = raw
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    if (ids.length === 0) {
      hienThongBao('⚠️ Vui lòng nhập ít nhất 1 mã đơn.', '#DC2626');
      return;
    }

    setRunningState(true);
    btnEarningsOnly.textContent = '⏳ Đang xử lý...';

    const results = [];
    // Neu danh sach nhap tay co ma don TRUNG NHAU, chi lay Earnings cho LAN XUAT HIEN DAU
    // TIEN cua ma don do; cac dong sau cung ma don de trong Earnings (khong tim kiem lai,
    // do ket qua se giong het lan dau).
    const daXuLyMaDon = new Set();
    let stopped = false;
    try {
      for (let i = 0; i < ids.length; i++) {
        if (cancelRequested) {
          stopped = true;
          break;
        }
        const id = ids[i];

        if (daXuLyMaDon.has(id)) {
          results.push({ 'Mã đơn': id, Earnings: '' });
          continue;
        }
        daXuLyMaDon.add(id);

        hienThongBao(`⏳ (${i + 1}/${ids.length}) Đang lấy Earnings đơn #${id}...`, '#2563EB');
        try {
          const earnings = await getEarningsForOrderBySearch(id);
          results.push({ 'Mã đơn': id, Earnings: earnings });
        } catch (err) {
          console.error('[Etsy Scraper] Lỗi lấy Earnings cho đơn ' + id + ':', err);
          results.push({ 'Mã đơn': id, Earnings: 'LỖI: ' + err.message });
        }
        await sleep(400);
      }

      if (results.length === 0) {
        hienThongBao('⏹ Đã dừng, chưa lấy được Earnings nào.', '#F59E0B');
        return;
      }

      const ws = XLSX.utils.json_to_sheet(results);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Earnings');
      XLSX.writeFile(wb, 'earnings_result.xlsx');

      if (stopped) {
        hienThongBao(`⏹ Đã dừng theo yêu cầu. Đã lấy Earnings cho ${results.length}/${ids.length} mã đơn và tải file Excel!`, '#F59E0B');
      } else {
        hienThongBao(`✅ Đã lấy Earnings cho ${ids.length} mã đơn và tải file Excel!`, '#16A34A');
      }
    } catch (err) {
      console.error('[Etsy Scraper] Lỗi khi lấy Earnings theo danh sách mã đơn:', err);
      hienThongBao('❌ Lỗi: ' + err.message, '#DC2626');
    } finally {
      btnEarningsOnly.textContent = '💰 Lấy Earnings theo mã đơn & tải Excel';
      setRunningState(false);
    }
  }

  // ====== GIAO DIEN NOI (FLOATING PANEL): KEO THA + THU NHO/MO RONG ======
  let countLabel;
  let messageBox;
  let btnScanEarnings;
  let btnScanOnly;
  let btnEarningsOnly;
  let btnStop;
  let idsTextarea;

  // Co bao nguoi dung yeu cau dung tien trinh dang chay hay khong. Cac vong lap
  // lay Earnings kiem tra co nay giua moi don de dung lai som.
  let cancelRequested = false;

  function setRunningState(isRunning) {
    [btnScanEarnings, btnScanOnly, btnEarningsOnly].forEach((btn) => {
      if (btn) btn.disabled = isRunning;
    });
    if (btnStop) {
      btnStop.style.display = isRunning ? 'block' : 'none';
      btnStop.disabled = false;
      btnStop.textContent = '⏹ Dừng';
    }
    cancelRequested = false;
  }

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
      display:flex; flex-direction:column; width:260px;
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
    vungNoiDung.style.cssText = 'padding:10px; display:flex; flex-direction:column; gap:8px; max-height:70vh; overflow-y:auto;';

    countLabel = document.createElement('div');
    countLabel.style.cssText = 'color:#555; font-size:12px;';
    vungNoiDung.appendChild(countLabel);

    btnScanEarnings = document.createElement('button');
    btnScanEarnings.textContent = '🔍 Quét đơn + Earnings & tải Excel';
    btnScanEarnings.style.cssText = `
      padding:8px 10px; background:#1a7f37; color:#fff; border:none;
      border-radius:6px; font-weight:bold; font-size:13px; cursor:pointer;
    `;
    btnScanEarnings.onclick = () => scanAndExport(true);
    vungNoiDung.appendChild(btnScanEarnings);

    btnScanOnly = document.createElement('button');
    btnScanOnly.textContent = '📦 Quét đơn & tải Excel';
    btnScanOnly.style.cssText = `
      padding:8px 10px; background:#2563EB; color:#fff; border:none;
      border-radius:6px; font-weight:bold; font-size:13px; cursor:pointer;
    `;
    btnScanOnly.onclick = () => scanAndExport(false);
    vungNoiDung.appendChild(btnScanOnly);

    const duongKe = document.createElement('div');
    duongKe.style.cssText = 'border-top:1px solid #e5e7eb; margin:4px 0; padding-top:6px; font-size:11px; color:#6b7280; font-weight:bold;';
    duongKe.textContent = 'Lấy Earnings theo danh sách mã đơn (nhập tay)';
    vungNoiDung.appendChild(duongKe);

    idsTextarea = document.createElement('textarea');
    idsTextarea.placeholder = 'Mỗi mã đơn 1 dòng, ví dụ:\n4127701646\n4127701647';
    idsTextarea.style.cssText = 'width:100%; height:70px; box-sizing:border-box; font-size:12px; resize:vertical;';
    vungNoiDung.appendChild(idsTextarea);

    btnEarningsOnly = document.createElement('button');
    btnEarningsOnly.textContent = '💰 Lấy Earnings theo mã đơn & tải Excel';
    btnEarningsOnly.style.cssText = `
      padding:8px 10px; background:#F56400; color:#fff; border:none;
      border-radius:6px; font-weight:bold; font-size:13px; cursor:pointer;
    `;
    btnEarningsOnly.onclick = runEarningsOnlyExport;
    vungNoiDung.appendChild(btnEarningsOnly);

    btnStop = document.createElement('button');
    btnStop.textContent = '⏹ Dừng';
    btnStop.style.cssText = `
      display:none; padding:8px 10px; background:#DC2626; color:#fff; border:none;
      border-radius:6px; font-weight:bold; font-size:13px; cursor:pointer;
    `;
    btnStop.onclick = () => {
      cancelRequested = true;
      btnStop.disabled = true;
      btnStop.textContent = '⏳ Đang dừng...';
      hienThongBao('⏳ Đang dừng, vui lòng đợi đến khi xong bước hiện tại...', '#F59E0B');
    };
    vungNoiDung.appendChild(btnStop);

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
