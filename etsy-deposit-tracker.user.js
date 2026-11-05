// ==UserScript==
// @name         Etsy Deposit Tracker
// @namespace    etsy-deposit-tracker
// @version      1.7
// @description  Tự động quét các khoản "Deposit" (sent to your bank account / sent to your Payoneer Wallet) trên trang sao kê Etsy theo khoảng ngày do bạn chọn, hỗ trợ nhiều định dạng ngày tuỳ locale ("Aug 3, 2026", "10 Aug, 2026", "August 3, 2026"), tự tải thêm dữ liệu (Load more / phân trang số / cuộn từng đoạn nhỏ), chờ nội dung ổn định trước khi quét, tự chuyển tháng, in kết quả (Date + Số tiền) ra Console, xuất CSV. Tự cập nhật từ GitHub.
// @match        https://www.etsy.com/your/account/payments/monthly-statement*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/tempohie-spec/etsy/main/etsy-deposit-tracker.user.js
// @downloadURL  https://raw.githubusercontent.com/tempohie-spec/etsy/main/etsy-deposit-tracker.user.js
// ==/UserScript==

(function () {
  'use strict';

  const STATE_KEY = 'etsyDepositTrackerState_v1';
  const UPDATE_URL = 'https://raw.githubusercontent.com/tempohie-spec/etsy/main/etsy-deposit-tracker.user.js';
  // Đọc thẳng từ @version (GM_info luôn có sẵn, không cần @grant) để không phải sửa 2 chỗ
  // mỗi lần tăng phiên bản. '1.7' chỉ là giá trị dự phòng.
  const SCRIPT_VERSION =
    (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '1.7';
  const LOG = '[Etsy Deposit]';

  // ---------- Tiện ích chung ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const loadState = () => GM_getValue(STATE_KEY, null);
  const saveState = (s) => GM_setValue(STATE_KEY, s);
  const clearState = () => GM_deleteValue(STATE_KEY);

  // Dừng: kiểm tra trạng thái đã lưu (nút Dừng ghi active=false vào storage).
  function isStopped() {
    const s = loadState();
    return !s || !s.active;
  }

  const MONTHS = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };

  // Một regex dùng chung cho mọi chỗ cần bắt ngày trong text, hỗ trợ:
  //   "Aug 3, 2026"  /  "August 3, 2026"  /  "Sept. 3, 2026"   (Tháng Ngày, Năm)
  //   "10 Aug, 2026" /  "10 August, 2026"                       (Ngày Tháng, Năm)
  const DATE_RE = /((?:[A-Za-z]{3,9}\.?\s+\d{1,2}|\d{1,2}\s+[A-Za-z]{3,9}\.?),?\s*\d{4})/g;

  // Trả về { text, date } của ngày HỢP LỆ đầu tiên trong text (bỏ qua chuỗi giống ngày
  // nhưng không phải tên tháng, vd "USD 1,2026").
  function findDateInText(text) {
    for (const m of text.matchAll(DATE_RE)) {
      const str = m[1].trim();
      const date = parseListDate(str);
      if (date) return { text: str, date };
    }
    return null;
  }

  function monthIndex(name) {
    const idx = MONTHS[name.slice(0, 3).toLowerCase()];
    return idx === undefined ? null : idx;
  }

  function parseListDate(str) {
    if (!str) return null;
    let m = str.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s*(\d{4})$/);
    let mon;
    let day;
    let year;
    if (m) {
      mon = monthIndex(m[1]);
      day = +m[2];
      year = +m[3];
    } else {
      m = str.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s*(\d{4})$/);
      if (!m) return null;
      day = +m[1];
      mon = monthIndex(m[2]);
      year = +m[3];
    }
    if (mon === null || day < 1 || day > 31) return null;
    return new Date(year, mon, day);
  }

  const toISO = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // Tách số tiền, hỗ trợ cả "1,234.56" (US) và "1.234,56" (EU).
  function parseAmount(text) {
    const m = text.match(/\d[\d.,]*/);
    if (!m) return { number: null, raw: '' };
    let s = m[0].replace(/[.,]$/, '');
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastComma > lastDot && s.length - lastComma - 1 !== 3) {
      // dấu phẩy là dấu thập phân (vd "1.234,56" hoặc "12,5")
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
    const n = parseFloat(s);
    return { number: Number.isFinite(n) ? n : null, raw: m[0] };
  }

  function buildStatementUrl(month, year) {
    return `https://www.etsy.com/your/account/payments/monthly-statement?month=${month}&year=${year}`;
  }

  function getCurrentMonthYearFromUrl() {
    const p = new URLSearchParams(location.search);
    const m = parseInt(p.get('month'), 10);
    const y = parseInt(p.get('year'), 10);
    return m && y ? { month: m, year: y } : null;
  }

  const getRows = () => Array.from(document.querySelectorAll('table tbody tr'));

  function getRowsSignature() {
    const rows = getRows();
    return rows.length ? rows[0].innerText.slice(0, 80) + '|' + rows.length : '';
  }

  // Chờ tới khi cond() trả về true hoặc hết giờ.
  async function waitFor(cond, timeout, interval = 250) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (cond()) return true;
      await sleep(interval);
    }
    return false;
  }

  const waitForTable = (timeout = 15000) => waitFor(() => getRows().length > 0, timeout);
  const waitForRowCountIncrease = (oldCount, timeout = 8000) =>
    waitFor(() => getRows().length > oldCount, timeout);
  const waitForPageChange = (oldSig, timeout = 10000) =>
    waitFor(() => {
      const sig = getRowsSignature();
      return sig && sig !== oldSig;
    }, timeout, 200);

  // Chờ nội dung bảng THỰC SỰ ổn định trước khi quét (tránh quét lúc skeleton/loading).
  async function waitForContentStable(timeout = 8000, stableChecksNeeded = 2, interval = 250) {
    let lastSig = getRowsSignature();
    let stableCount = 0;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      await sleep(interval);
      const sig = getRowsSignature();
      if (sig === lastSig) {
        if (++stableCount >= stableChecksNeeded) return true;
      } else {
        stableCount = 0;
        lastSig = sig;
      }
    }
    return false;
  }

  // ---------- Trích xuất dữ liệu deposit trên trang hiện tại ----------
  // Chỉ bắt dòng "Deposit" có "sent to your bank account" / "sent to your Payoneer Wallet".
  // seenKeys: Set các key đã thu thập (tra trùng O(1) thay vì duyệt cả mảng mỗi dòng).
  // Trả về: { addedCount, sawOlderThanStart }
  function collectDepositsOnPage(results, seenKeys, startDate, endDate, pageNumber) {
    let sawOlderThanStart = false;
    let addedCount = 0;

    for (const tr of getRows()) {
      const rowText = tr.innerText;
      if (!/\bDeposit\b/i.test(rowText)) continue;

      const descEl = tr.querySelector(
        '[data-test-id^="recent-activity-description-primary"], [data-test-id="RecentActivityDescription"]'
      );
      const primaryText = (descEl ? descEl.innerText : rowText).trim();

      const sentMatch = primaryText.match(/sent to your (bank account|payoneer wallet)/i);
      if (!sentMatch) continue;

      const found = findDateInText(rowText);
      if (!found) continue;
      const rowDate = found.date;

      if (rowDate < startDate) {
        sawOlderThanStart = true; // đã ra ngoài khoảng ngày (quá cũ)
        continue;
      }
      if (rowDate > endDate) continue; // quá mới -> bỏ qua, vẫn quét tiếp

      const key = found.text + '|' + primaryText;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      const amtMatch = primaryText.match(/^(.+?)\s+sent to your/i);
      const chunk = amtMatch ? amtMatch[1] : primaryText;
      const { number, raw } = parseAmount(chunk);
      const entry = {
        key,
        date: found.text,
        dateISO: toISO(rowDate),
        amountText: primaryText,
        amountNumber: number,
        currencyLabel: raw ? chunk.replace(raw, '').trim() : '',
        destination: /payoneer/i.test(sentMatch[1]) ? 'Payoneer Wallet' : 'Bank Account',
        page: pageNumber || null,
      };
      results.push(entry);
      addedCount++;
      console.log(`${LOG} Trang ${entry.page} | ${entry.date} -> ${entry.amountNumber} (${entry.destination})`);
    }

    return { addedCount, sawOlderThanStart };
  }

  // ---------- Điều khiển phân trang (tự động) ----------
  // Không dựa vào DOM để biết "đang ở trang mấy" (Etsy không đánh dấu đáng tin cậy),
  // script tự đếm qua state.currentPage.
  const isOwnUi = (el) => !!el.closest('#edt-panel');

  function isNumericButton(el, num) {
    const t = (el.textContent || '').trim();
    return /^\d+$/.test(t) && (num === undefined || parseInt(t, 10) === num);
  }

  function isNextControl(el) {
    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
    const rel = (el.getAttribute('rel') || '').toLowerCase();
    const title = (el.getAttribute('title') || '').toLowerCase();
    return aria.includes('next') || rel === 'next' || title.includes('next');
  }

  const clickables = (container) =>
    container ? Array.from(container.querySelectorAll('button, a')).filter((el) => !isOwnUi(el)) : [];

  // Ưu tiên nav có aria-label pagination; nếu không có, chọn nav nào thực sự chứa nút số
  // hoặc nút Next (tránh nhầm sang thanh điều hướng đầu trang của Etsy).
  function getPaginationNav() {
    const direct =
      document.querySelector('nav[aria-label="Pagination"]') ||
      document.querySelector('nav[aria-label*="pagination" i]') ||
      document.querySelector('[data-clg-id*="Pagination" i]');
    if (direct) return direct;
    return (
      Array.from(document.querySelectorAll('nav')).find((nav) =>
        clickables(nav).some((el) => isNumericButton(el) || isNextControl(el))
      ) || null
    );
  }

  const findClickableByPageNumber = (container, num) =>
    clickables(container).find((el) => isNumericButton(el, num)) || null;
  const findNextControl = (container) => clickables(container).find(isNextControl) || null;

  function isControlDisabled(el) {
    return (
      !el ||
      el.disabled === true ||
      el.getAttribute('aria-disabled') === 'true' ||
      el.classList.contains('disabled')
    );
  }

  // Đưa về trang 1 trước khi quét. Chỉ tìm trong khung phân trang để không bấm nhầm
  // một nút "1" bất kỳ khác trên trang.
  async function ensureOnFirstPage() {
    const page1Btn = findClickableByPageNumber(getPaginationNav(), 1);
    if (isControlDisabled(page1Btn)) return;
    const oldSig = getRowsSignature();
    page1Btn.click();
    await waitForPageChange(oldSig, 4000); // đã ở trang 1 thì timeout, không sao
    await sleep(300);
  }

  // Tải "phần dữ liệu" kế tiếp, thử lần lượt: (1) nút Load more, (2) phân trang số/Next,
  // (3) cuộn từng đoạn nhỏ và quét lại sau mỗi đoạn (an toàn với virtualized list).
  // scanFn() quét DOM hiện tại, trả về { sawOlderThanStart }.
  // Trả về { advanced, hitOlder, stopped }.
  async function advanceToNextBatch(state, scanFn) {
    const nextPageNum = (state.currentPage || 1) + 1;
    const oldSig = getRowsSignature();
    const oldCount = getRows().length;

    // Cách 1: nút "Load more" / "Show more" / "Xem thêm" / "Tải thêm"
    const moreBtn = clickables(document).find((el) =>
      /load more|show more|xem thêm|tải thêm|more results|more activities/.test(
        (el.textContent || '').trim().toLowerCase()
      )
    );
    if (!isControlDisabled(moreBtn)) {
      moreBtn.click();
      if (await waitForRowCountIncrease(oldCount, 8000)) {
        state.currentPage = nextPageNum;
        await waitForContentStable();
        return { advanced: true, hitOlder: scanFn().sawOlderThanStart };
      }
    }

    // Cách 2: nút phân trang dạng số hoặc "Next"
    const nav = getPaginationNav();
    const pageTarget =
      findClickableByPageNumber(nav, nextPageNum) ||
      findNextControl(nav) ||
      findClickableByPageNumber(document, nextPageNum) ||
      findNextControl(document);
    if (!isControlDisabled(pageTarget)) {
      pageTarget.click();
      if (await waitForPageChange(oldSig, 8000)) {
        state.currentPage = nextPageNum;
        await waitForContentStable();
        let { sawOlderThanStart } = scanFn();
        if (!sawOlderThanStart) {
          await sleep(500); // quét bổ sung phòng dữ liệu tải muộn
          ({ sawOlderThanStart } = scanFn());
        }
        return { advanced: true, hitOlder: sawOlderThanStart };
      }
    }

    // Cách 3: cuộn từng đoạn nhỏ, quét lại sau mỗi đoạn.
    const stepPx = Math.max(Math.round(window.innerHeight * 0.6), 300);
    const maxSteps = 60;
    let advancedAny = false;
    let stallSteps = 0;
    let lastCount = oldCount;
    const scrollTop = () => window.scrollY || document.documentElement.scrollTop || 0;

    for (let i = 0; i < maxSteps; i++) {
      if (isStopped()) return { advanced: false, hitOlder: false, stopped: true };

      window.scrollTo(0, scrollTop() + stepPx);
      await sleep(350);

      if (scanFn().sawOlderThanStart) return { advanced: true, hitOlder: true };

      const newCount = getRows().length;
      if (newCount > lastCount) {
        advancedAny = true;
        lastCount = newCount;
        stallSteps = 0;
      } else {
        stallSteps++;
      }

      const atBottom = window.innerHeight + scrollTop() >= document.body.scrollHeight - 10;
      if ((atBottom && stallSteps >= 2) || stallSteps >= 8) break;
    }

    if (advancedAny) {
      state.currentPage = nextPageNum;
      return { advanced: true, hitOlder: false };
    }

    console.log(
      `${LOG} Không tải thêm được dữ liệu (đã thử Load more, phân trang, cuộn từng đoạn). ` +
        `Coi như đã hết dữ liệu của tháng này.`
    );
    return { advanced: false, hitOlder: false };
  }

  // ---------- Giao diện điều khiển ----------
  GM_addStyle(`
    #edt-panel {
      position: fixed; top: 80px; right: 20px; width: 320px;
      background: #fff; border: 1px solid #ccc; border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.15); z-index: 999999;
      font-family: Arial, sans-serif; font-size: 13px; color: #222;
      max-height: 80vh; overflow-y: auto;
    }
    #edt-panel h3 { margin: 0; padding: 10px 12px; background: #f5f2ea; border-bottom: 1px solid #ddd; font-size: 14px; }
    #edt-panel h3 a { font-weight: normal; font-size: 11px; margin-left: 6px; color: #f56400; }
    #edt-body { padding: 10px 12px; }
    #edt-panel label { display: block; margin: 6px 0 2px; font-weight: bold; }
    #edt-panel input[type=date] { width: 100%; box-sizing: border-box; padding: 4px; margin-bottom: 6px; }
    #edt-panel button { padding: 6px 10px; margin-right: 6px; margin-top: 4px; cursor: pointer; border-radius: 4px; border: 1px solid #999; background: #f0f0f0; }
    #edt-panel button.primary { background: #f56400; color: #fff; border-color: #f56400; }
    #edt-panel button:disabled { opacity: .5; cursor: default; }
    #edt-status { margin-top: 8px; font-style: italic; color: #555; white-space: pre-wrap; }
    #edt-results table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
    #edt-results th, #edt-results td { border: 1px solid #ddd; padding: 3px 5px; text-align: left; }
    #edt-total { margin-top: 6px; font-weight: bold; }
  `);

  const $ = (id) => document.getElementById(id);

  function ensurePanel() {
    if ($('edt-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'edt-panel';
    panel.innerHTML = `
      <h3>Etsy Deposit Tracker <span style="font-weight:normal;color:#888;">v${SCRIPT_VERSION}</span>
        <a href="${UPDATE_URL}" target="_blank" rel="noopener" title="Mở link cài đặt để cập nhật ngay bản mới nhất">Cập nhật</a>
      </h3>
      <div id="edt-body">
        <label for="edt-start">Từ ngày</label>
        <input type="date" id="edt-start" />
        <label for="edt-end">Đến ngày</label>
        <input type="date" id="edt-end" />
        <div>
          <button id="edt-start-btn" class="primary">Bắt đầu</button>
          <button id="edt-stop-btn">Dừng</button>
          <button id="edt-clear-btn">Xoá kết quả</button>
        </div>
        <div id="edt-status"></div>
        <div id="edt-results"></div>
        <div id="edt-total"></div>
        <div><button id="edt-csv-btn" style="display:none;">Tải CSV</button></div>
      </div>
    `;
    document.body.appendChild(panel);

    $('edt-start-btn').addEventListener('click', onStartClick);
    $('edt-stop-btn').addEventListener('click', onStopClick);
    $('edt-clear-btn').addEventListener('click', onClearClick);
    $('edt-csv-btn').addEventListener('click', downloadCsv);
  }

  function updateStatus(text) {
    ensurePanel();
    $('edt-status').textContent = text;
  }

  function setRunningUi(running) {
    ensurePanel();
    $('edt-start-btn').disabled = running;
    $('edt-clear-btn').disabled = running;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function renderResultsPreview(results) {
    ensurePanel();
    const sorted = [...results].sort((a, b) => b.dateISO.localeCompare(a.dateISO));
    const rowsHtml = sorted
      .map((r) =>
        '<tr>' +
        [r.date, r.amountNumber ?? '', r.destination || '', r.page ?? '']
          .map((v) => `<td>${escapeHtml(v)}</td>`)
          .join('') +
        '</tr>'
      )
      .join('');
    $('edt-results').innerHTML =
      '<table><thead><tr><th>Ngày</th><th>Số tiền</th><th>Nơi nhận</th><th>Trang</th></tr></thead>' +
      `<tbody>${rowsHtml}</tbody></table>`;

    const totals = {};
    for (const r of results) {
      if (r.amountNumber == null) continue;
      const cur = r.currencyLabel || '';
      totals[cur] = (totals[cur] || 0) + r.amountNumber;
    }
    $('edt-total').textContent = Object.entries(totals)
      .map(([cur, sum]) => `Tổng ${cur || '(không rõ đơn vị)'}: ${(Math.round(sum * 100) / 100).toLocaleString()}`)
      .join(' | ');
  }

  const csvCell = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  function downloadCsv() {
    const s = loadState();
    const results = (s && s.results) || [];
    if (!results.length) {
      alert('Chưa có dữ liệu để xuất.');
      return;
    }
    const sorted = [...results].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    const lines = ['Date,Date ISO,Amount Number,Destination,Page'];
    for (const r of sorted) {
      // "Aug 3, 2026" có dấu phẩy nên phải bọc ngoặc kép, nếu không CSV bị lệch cột.
      lines.push([r.date, r.dateISO, r.amountNumber, r.destination, r.page].map(csvCell).join(','));
    }
    // BOM để Excel đọc đúng UTF-8.
    const blob = new Blob(['﻿' + lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `etsy-deposits-${s.startDate}_to_${s.endDate}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  let running = false; // chặn bấm "Bắt đầu" 2 lần tạo 2 vòng lặp chạy song song

  async function onStartClick() {
    if (running) return;
    const startVal = $('edt-start').value;
    const endVal = $('edt-end').value;
    if (!startVal || !endVal) {
      alert('Vui lòng chọn cả ngày bắt đầu và ngày kết thúc.');
      return;
    }
    if (startVal > endVal) {
      alert('Ngày bắt đầu phải trước ngày kết thúc.');
      return;
    }

    const state = {
      active: true,
      startDate: startVal,
      endDate: endVal,
      results: [],
      currentMonth: null,
      currentYear: null,
      currentPage: 1,
      needFirstPage: true,
      iterations: 0,
    };
    saveState(state);
    $('edt-csv-btn').style.display = 'none';
    console.log(`${LOG} Bắt đầu quét từ ${startVal} đến ${endVal}`);
    runAutomation(state);
  }

  function onStopClick() {
    const s = loadState();
    if (s) {
      s.active = false;
      saveState(s);
    }
    updateStatus('Đã dừng theo yêu cầu.');
  }

  function onClearClick() {
    if (running) return;
    clearState();
    $('edt-results').innerHTML = '';
    $('edt-total').textContent = '';
    $('edt-csv-btn').style.display = 'none';
    updateStatus('');
  }

  // ---------- Vòng lặp tự động chính ----------
  async function runAutomation(state) {
    if (running) return;
    running = true;
    setRunningUi(true);
    try {
      await runAutomationInner(state);
    } catch (err) {
      console.error(`${LOG} Lỗi:`, err);
      updateStatus(`Lỗi: ${err && err.message ? err.message : err}`);
    } finally {
      running = false;
      setRunningUi(false);
    }
  }

  async function runAutomationInner(state) {
    const startDate = new Date(state.startDate + 'T00:00:00');
    const endDate = new Date(state.endDate + 'T23:59:59');
    const startYM = startDate.getFullYear() * 12 + startDate.getMonth();
    const endYM = endDate.getFullYear() * 12 + endDate.getMonth();

    // Lần chạy đầu: nếu tháng đang mở mới hơn tháng của "Đến ngày", nhảy thẳng tới tháng đó
    // thay vì quét lần lượt từng tháng không liên quan.
    if (!state.currentMonth) {
      const urlMY = getCurrentMonthYearFromUrl();
      const now = new Date();
      const curYM = urlMY ? urlMY.year * 12 + (urlMY.month - 1) : now.getFullYear() * 12 + now.getMonth();
      if (curYM > endYM) {
        state.currentMonth = endDate.getMonth() + 1;
        state.currentYear = endDate.getFullYear();
        state.currentPage = 1;
        state.needFirstPage = false;
        saveState(state);
        updateStatus(`Chuyển thẳng tới tháng ${state.currentMonth}/${state.currentYear}...`);
        location.href = buildStatementUrl(state.currentMonth, state.currentYear);
        return;
      }
    }

    updateStatus('Đang chờ bảng dữ liệu tải...');
    if (!(await waitForTable())) {
      updateStatus('Không tìm thấy bảng dữ liệu trên trang này.');
      return;
    }

    if (!state.currentMonth) {
      const urlMY = getCurrentMonthYearFromUrl();
      if (urlMY) {
        state.currentMonth = urlMY.month;
        state.currentYear = urlMY.year;
      } else {
        const firstRow = getRows()[0];
        const found = firstRow ? findDateInText(firstRow.innerText) : null;
        const d = found ? found.date : new Date();
        state.currentMonth = d.getMonth() + 1;
        state.currentYear = d.getFullYear();
      }
      saveState(state);
    }

    // Chỉ cần ép về trang 1 ở lần bắt đầu; sau khi chuyển tháng, URL mới luôn mở trang 1.
    if (state.needFirstPage) {
      updateStatus('Đang đưa về trang 1 trước khi quét...');
      await ensureOnFirstPage();
      state.needFirstPage = false;
      state.currentPage = 1;
      saveState(state);
    }

    const results = state.results || [];
    const seenKeys = new Set(results.map((r) => r.key));

    // Quét dùng chung; chỉ ghi storage + vẽ lại bảng khi thật sự có dòng mới
    // (trước đây ghi/vẽ lại sau mỗi bước cuộn dù không có gì đổi).
    const scanFn = () => {
      const res = collectDepositsOnPage(results, seenKeys, startDate, endDate, state.currentPage);
      if (res.addedCount) {
        state.results = results;
        persist(); // không ghi đè cờ active=false nếu người dùng vừa bấm Dừng
        renderResultsPreview(results);
      }
      updateStatus(
        `Đang quét tháng ${state.currentMonth}/${state.currentYear}, trang ${state.currentPage}...\n` +
          `Đã tìm thấy ${results.length} khoản deposit trong khoảng ngày.`
      );
      return res;
    };

    // Giữ cờ active mới nhất trong state (có thể đã bị nút Dừng đổi) trước khi lưu.
    const persist = () => {
      if (isStopped()) state.active = false;
      saveState(state);
    };

    while (true) {
      if (isStopped()) {
        updateStatus('Đã dừng.');
        return;
      }

      if (scanFn().sawOlderThanStart) {
        console.log(`${LOG} Gặp DATE trước ${state.startDate} -> dừng quét.`);
        return finish(results, state);
      }

      const { advanced, hitOlder, stopped } = await advanceToNextBatch(state, scanFn);
      if (stopped) {
        updateStatus('Đã dừng.');
        return;
      }
      persist();

      if (hitOlder) {
        console.log(`${LOG} Gặp DATE trước ${state.startDate} trong lúc tải thêm -> dừng quét.`);
        return finish(results, state);
      }
      if (!advanced) break;

      state.iterations = (state.iterations || 0) + 1;
      if (state.iterations > 300) {
        updateStatus('Đã dừng để tránh vòng lặp quá dài (vượt quá 300 lần).');
        return finish(results, state);
      }
    }

    // Hết dữ liệu tháng hiện tại -> lùi về tháng trước nếu còn trong khoảng ngày.
    const curYM = state.currentYear * 12 + (state.currentMonth - 1);
    if (curYM > startYM && !isStopped()) {
      const prevYM = curYM - 1;
      state.currentMonth = (prevYM % 12) + 1;
      state.currentYear = Math.floor(prevYM / 12);
      state.currentPage = 1;
      saveState(state);
      updateStatus(`Chuyển sang tháng ${state.currentMonth}/${state.currentYear}...`);
      console.log(`${LOG} Chuyển sang tháng ${state.currentMonth}/${state.currentYear}...`);
      location.href = buildStatementUrl(state.currentMonth, state.currentYear);
      return; // trang tải lại, script tự tiếp tục nhờ state đã lưu
    }

    finish(results, state);
  }

  function finish(results, state) {
    state.active = false;
    saveState(state);
    updateStatus(`Hoàn tất! Tìm thấy ${results.length} khoản deposit từ ${state.startDate} đến ${state.endDate}.`);
    console.log(`${LOG} Hoàn tất. Tổng cộng ${results.length} khoản deposit.`);
    console.table(results.map((r) => ({ Page: r.page, Date: r.date, Amount: r.amountNumber, Destination: r.destination })));
    renderResultsPreview(results);
    $('edt-csv-btn').style.display = 'inline-block';
  }

  // ---------- Khởi động khi trang load ----------
  async function init() {
    ensurePanel();
    const state = loadState();
    if (!state) return;
    $('edt-start').value = state.startDate || '';
    $('edt-end').value = state.endDate || '';
    if (state.results && state.results.length) {
      renderResultsPreview(state.results);
      if (!state.active) $('edt-csv-btn').style.display = 'inline-block';
    }
    if (state.active) {
      updateStatus('Tiếp tục quét sau khi chuyển trang...');
      await runAutomation(state);
    }
  }

  // @run-at document-idle: DOM đã sẵn sàng, chỉ chờ thêm chút cho Etsy render xong.
  setTimeout(init, 500);
})();
