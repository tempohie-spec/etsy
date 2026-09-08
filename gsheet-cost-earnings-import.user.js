// ==UserScript==
// @name         Google Sheets - Import Cost/Earnings tu dong theo noi dung
// @namespace    gsheet-cost-earnings-import
// @version      1.0
// @description  Ban lai logic cua Apps Script processImportedCostFiles() thanh userscript chay ngay tren trang Google Sheets, dung Sheets API v4 de doc/ghi thay vi chay trong Apps Script.
// @match        https://docs.google.com/spreadsheets/*
// @grant        none
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ====== CAU HINH - CHINH LAI O DAY TRUOC KHI DUNG ======
  // Tao 1 OAuth Client ID loai "Web application" tren Google Cloud Console
  // (APIs & Services > Credentials), them https://docs.google.com vao
  // "Authorized JavaScript origins", bat Google Sheets API cho project do,
  // roi dan Client ID vao day.
  const OAUTH_CLIENT_ID = 'DAN_CLIENT_ID_CUA_BAN_VAO_DAY.apps.googleusercontent.com';
  const OAUTH_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

  const ORDER_NUMBER_COL_INDEX = 3;   // Cot C trong trang tinh hien tai (orderNumber), 1-based
  const BASE_COST_HEADER = 'base cost';
  const EARNINGS_HEADER = 'earnings';
  const COST_SHEET_NAME = 'Cost';
  const NO_ORDER_LABEL = 'chưa ff';
  const NO_COST_LABEL = 'chưa có cost';
  const NO_EARNINGS_LABEL = 'chưa có earnings';
  const FLAG_COLOR_RGB = { red: 244 / 255, green: 204 / 255, blue: 204 / 255 };
  const CLEAR_COLOR_RGB = { red: 1, green: 1, blue: 1 };

  let accessToken = null;
  let tokenClient = null;

  // ============ HAM DUNG CHUNG (giong het ban Apps Script) ============
  function removeDiacritics(str) {
    return String(str || '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function normalizeHeader(val) {
    return removeDiacritics(String(val || '')).trim().toLowerCase();
  }

  function normalizeKey(val) {
    if (val === null || val === undefined || val === '') return '';
    if (typeof val === 'number') return Number.isInteger(val) ? String(val) : String(val);
    return String(val).trim().replace(/\s+/g, '').replace(/\.0+$/, '');
  }

  function normalizeNumericValue(val) {
    if (val === null || val === undefined || val === '') return '';
    if (val instanceof Date) return '';
    const stripped = String(val).replace(/[^0-9.\-]/g, '').trim();
    if (!/^-?\d{1,9}(\.\d+)?$/.test(stripped)) return '';
    // Cac gia tri tien te doc tu file (dac biet qua SheetJS voi raw:true) co the mang theo
    // sai so nhi phan (VD "11.690000000000001" thay vi "11.69") do gia tri goc trong file
    // da la mot so thap phan khong bieu dien tron trong double, chu khong phai do phep tinh
    // nao trong script nay gay ra. Lam tron ve 2 chu so thap phan (chuan tien te) roi de
    // JS tu format lai (Math.round(...)/100 luon cho chuoi ngan gon nhat, VD "11.69") de
    // trieu tieu sai so hien thi nay.
    const num = parseFloat(stripped);
    if (!isFinite(num)) return '';
    return String(Math.round(num * 100) / 100);
  }

  function describeRawValue(val) {
    if (val === null || val === undefined || val === '') return '(ô trống)';
    if (val instanceof Date) return '[Date] ' + val.toISOString();
    return `[${typeof val}] "${val}"`;
  }

  function buildBlankDebugLines(blankOrderKeys, rawMap, label) {
    const uniqueKeys = Array.from(new Set(blankOrderKeys)).slice(0, 8);
    return uniqueKeys.map(k => `   • ${label} - mã đơn ${k}: giá trị gốc đọc được = ${rawMap[k] || '(không xác định)'}`);
  }

  function sameValue(existingValue, newValue) {
    const a = existingValue === null || existingValue === undefined ? '' : String(existingValue).trim();
    const b = newValue === null || newValue === undefined ? '' : String(newValue).trim();
    return a === b;
  }

  function isEmptyValue(val) {
    return val === '' || val === null || val === undefined || String(val).trim() === '0';
  }

  // ============ GOOGLE OAUTH (Google Identity Services token client) ============
  // docs.google.com bat Trusted Types CSP: gan chuoi thuong vao script.src bi chan voi loi
  // "This document requires 'TrustedScriptURL' assignment" - phai boc URL qua 1 Trusted
  // Types policy truoc khi gan. URL o day la hang so co dinh trong code (khong phai du
  // lieu tu ben ngoai) nen policy chi can tra nguyen URL la an toan.
  let trustedScriptUrlPolicy = null;
  function toTrustedScriptURL(url) {
    if (!(window.trustedTypes && window.trustedTypes.createPolicy)) return url;
    try {
      if (!trustedScriptUrlPolicy) {
        trustedScriptUrlPolicy = window.trustedTypes.createPolicy('gcei-script-url', {
          createScriptURL: (u) => u
        });
      }
      return trustedScriptUrlPolicy.createScriptURL(url);
    } catch (e) {
      // CSP co the gioi han san ten policy duoc phep tao (trusted-types directive)
      // - neu tao policy that bai, tra ve URL goc va de loi TrustedScriptURL that
      // (neu co) hien ro trong console thay vi nuot mat.
      console.error('[Import Cost/Earnings] Không tạo được Trusted Types policy:', e);
      return url;
    }
  }

  // Tai script GIS DONG (khong dung @require) de 1 lan tai loi khong lam
  // hong toan bo userscript (nut noi van phai hien du thu vien ngoai co loi).
  let gisLoadPromise = null;
  function loadGisScript() {
    if (typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
      return Promise.resolve();
    }
    if (gisLoadPromise) return gisLoadPromise;
    gisLoadPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = toTrustedScriptURL('https://accounts.google.com/gsi/client');
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Không tải được thư viện Google Identity Services (accounts.google.com/gsi/client). Kiểm tra kết nối mạng hoặc trình chặn quảng cáo.'));
      document.head.appendChild(s);
    });
    return gisLoadPromise;
  }

  // Xin 1 access token voi 1 gia tri "prompt" cu the. prompt:'' la xin AM THAM - neu ban
  // da tung dong y cap quyen cho app nay tren tai khoan Google nay (con nho ben phia
  // Google, KHONG phai luu trong trinh duyet), Google se tra token ngay, khong hien man
  // hinh dong y nao ca, ke ca sau khi tai lai trang. Chi khi Google thay chua tung cap
  // quyen (lan dau tien, hoac quyen da bi thu hoi) thi buoc "consent" hien man hinh that
  // moi can thiet.
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
      if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
        throw new Error('Chưa tải được thư viện Google Identity Services (accounts.google.com/gsi/client).');
      }
      if (!tokenClient) {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: OAUTH_CLIENT_ID,
          scope: OAUTH_SCOPE,
          callback: () => {}
        });
      }
      // Thu am tham truoc, chi hien man hinh dong y that neu am tham that bai.
      return requestAccessTokenWithPrompt('').catch(() => requestAccessTokenWithPrompt('consent'));
    });
  }

  async function sheetsApiFetch(path, options = {}) {
    const token = await ensureAccessToken();
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    if (res.status === 401) {
      // Token het han/thu hoi, buoc dang nhap lai cho lan goi ke tiep.
      accessToken = null;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Sheets API lỗi ${res.status}: ${body}`);
    }
    return res.json();
  }

  function getSpreadsheetIdFromUrl() {
    const m = location.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!m) throw new Error('Không tìm thấy Spreadsheet ID trong URL. Hãy mở đúng trang 1 Google Sheet.');
    return m[1];
  }

  function getActiveGidFromUrl() {
    const m = location.hash.match(/gid=(\d+)/);
    return m ? Number(m[1]) : 0;
  }

  // ============ DOC / GHI 1 SHEET QUA API (thay cho SpreadsheetApp) ============
  async function fetchSheetMeta(spreadsheetId) {
    const data = await sheetsApiFetch(
      `${spreadsheetId}?fields=sheets.properties`,
      { method: 'GET' }
    );
    return (data.sheets || []).map(s => s.properties);
  }

  async function fetchSheetValues(spreadsheetId, sheetTitle) {
    const range = encodeURIComponent(`'${sheetTitle}'`);
    const data = await sheetsApiFetch(
      `${spreadsheetId}/values/${range}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`,
      { method: 'GET' }
    );
    return data.values || [];
  }

  async function writeColumnValues(spreadsheetId, sheetTitle, colIndex1Based, startRow1Based, values) {
    // values: mang 1 chieu, moi phan tu la 1 hang cua cot colIndex1Based
    if (values.length === 0) return;
    const colLetter = columnIndexToLetter(colIndex1Based);
    const range = `'${sheetTitle}'!${colLetter}${startRow1Based}:${colLetter}${startRow1Based + values.length - 1}`;
    await sheetsApiFetch(
      `${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
      { method: 'PUT', body: JSON.stringify({ range, majorDimension: 'COLUMNS', values: [values] }) }
    );
  }

  function columnIndexToLetter(idx) {
    let s = '';
    while (idx > 0) {
      const rem = (idx - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      idx = Math.floor((idx - 1) / 26);
    }
    return s;
  }

  // Tô đỏ (hoặc bỏ màu) 1 cột, gom cac hang lien tiep cung mau thanh 1 request (RLE)
  // de khong phai goi batchUpdate ca ngan lan.
  async function paintColumnFlags(spreadsheetId, sheetId, colIndex0Based, startRow0Based, flagBooleans) {
    if (flagBooleans.length === 0) return;
    const requests = [];
    let runStart = 0;
    let runFlag = flagBooleans[0];
    for (let i = 1; i <= flagBooleans.length; i++) {
      const cur = i < flagBooleans.length ? flagBooleans[i] : null;
      if (cur !== runFlag) {
        requests.push({
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: startRow0Based + runStart,
              endRowIndex: startRow0Based + i,
              startColumnIndex: colIndex0Based,
              endColumnIndex: colIndex0Based + 1
            },
            cell: { userEnteredFormat: { backgroundColor: runFlag ? FLAG_COLOR_RGB : CLEAR_COLOR_RGB } },
            fields: 'userEnteredFormat.backgroundColor'
          }
        });
        runStart = i;
        runFlag = cur;
      }
    }
    if (requests.length === 0) return;
    await sheetsApiFetch(`${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests })
    });
  }

  // ============ DO COT THEO HEADER (dong 1 cua mang data) ============
  function findColumnByHeaderInRow(headerRow, headerText) {
    for (let i = 0; i < headerRow.length; i++) {
      if (normalizeHeader(headerRow[i]) === headerText) return i + 1; // 1-based
    }
    return -1;
  }

  // ============ DOC FILE EXCEL/CSV BANG SHEETJS (giong logic GAS processImportedCostFiles) ============
  function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  async function parseImportedFile(file) {
    const buf = await readFileAsArrayBuffer(file);
    const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv';
    const wb = XLSX.read(buf, { type: 'array', raw: true, cellDates: true, codepage: isCsv ? 65001 : undefined });
    const firstSheetName = wb.SheetNames[0];
    const ws = wb.Sheets[firstSheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    return data;
  }

  // ============ LOGIC XU LY IMPORT ============
  // Tach lam 2 nguon rieng biet (2 nut rieng ngoai UI):
  //  - processImportedFiles(): CHI dung file Excel/CSV da chon (Cost + Earnings)
  //  - fillBaseCostFromCostSheet(): CHI dung sheet "Cost" co san trong spreadsheet, khong
  //    can chon file nao, chi dien duoc Base Cost (giong ham fillBaseCostWithSheetName cu
  //    ben Apps Script, sheet "Cost" khong co du lieu Earnings).
  // Ca 2 deu dung chung buoc cuoi (applyMapsToActiveSheet) de dien vao trang tinh dang mo.

  async function processImportedFiles(files, statusEl) {
    const spreadsheetId = getSpreadsheetIdFromUrl();
    const gid = getActiveGidFromUrl();

    log(statusEl, '⏳ Đang xác thực với Google...');
    await ensureAccessToken();

    log(statusEl, '⏳ Đang đọc thông tin spreadsheet...');
    const sheetProps = await fetchSheetMeta(spreadsheetId);
    const activeProps = sheetProps.find(p => p.sheetId === gid) || sheetProps[0];
    if (!activeProps) throw new Error('Không tìm thấy trang tính đang mở trong spreadsheet này.');
    const activeSheetTitle = activeProps.title;
    const activeSheetId = activeProps.sheetId;

    const costPriceMap = {};
    const earningsMap = {};
    const costRawMap = {};
    const earningsRawMap = {};
    const fileReports = [];

    log(statusEl, '⏳ Đang đọc file đã chọn...');
    for (const file of files) {
      let data;
      try {
        data = await parseImportedFile(file);
      } catch (e) {
        fileReports.push(`⚠️ ${file.name}: lỗi đọc file (${e.message}), bỏ qua.`);
        continue;
      }
      if (!data || data.length < 2) {
        fileReports.push(`⚠️ ${file.name}: file không có dữ liệu, bỏ qua.`);
        continue;
      }

      const headerRow = data[0].map(normalizeHeader);
      const extIdx = headerRow.indexOf('external number');
      const fulfillIdx = headerRow.indexOf('fulfillment cost');
      const totalIdx = headerRow.indexOf('total');
      const maDonIdx = headerRow.indexOf('ma don');
      const earningsIdx = headerRow.indexOf('earnings');

      if (extIdx !== -1 && (fulfillIdx !== -1 || totalIdx !== -1)) {
        const priceColIdx = fulfillIdx !== -1 ? fulfillIdx : totalIdx;
        const priceColLabel = fulfillIdx !== -1 ? 'Fulfillment cost' : 'Total';
        let addedCount = 0;
        for (let i = 1; i < data.length; i++) {
          const row = data[i];
          const orderKey = normalizeKey(row[extIdx]);
          if (!orderKey) continue;
          const rawCell = row[priceColIdx];
          const price = normalizeNumericValue(rawCell);
          if (costPriceMap[orderKey] === undefined) {
            costPriceMap[orderKey] = price;
            addedCount++;
          } else if (costPriceMap[orderKey] === '' && price !== '') {
            costPriceMap[orderKey] = price;
          }
          if (price === '' && costRawMap[orderKey] === undefined) {
            costRawMap[orderKey] = describeRawValue(rawCell);
          }
        }
        fileReports.push(`✅ ${file.name}: nhận diện là file COST (cột "${priceColLabel}"), thêm ${addedCount} mã đơn vào danh sách tra cứu.`);
      } else if (maDonIdx !== -1 && earningsIdx !== -1) {
        let addedCount = 0;
        for (let i = 1; i < data.length; i++) {
          const row = data[i];
          const orderKey = normalizeKey(row[maDonIdx]);
          if (!orderKey) continue;
          const rawCell = row[earningsIdx];
          const value = normalizeNumericValue(rawCell);
          if (earningsMap[orderKey] === undefined) {
            earningsMap[orderKey] = value;
            addedCount++;
          } else if (earningsMap[orderKey] === '' && value !== '') {
            earningsMap[orderKey] = value;
          }
          if (value === '' && earningsRawMap[orderKey] === undefined) {
            earningsRawMap[orderKey] = describeRawValue(rawCell);
          }
        }
        fileReports.push(`✅ ${file.name}: nhận diện là file EARNINGS, thêm ${addedCount} mã đơn vào danh sách tra cứu.`);
      } else {
        fileReports.push(`⚠️ ${file.name}: không nhận diện được loại file (thiếu cột "External number"+"Fulfillment cost/Total" hoặc "Mã đơn"+"Earnings"), bỏ qua.`);
      }
    }

    return applyMapsToActiveSheet(
      spreadsheetId, sheetProps, activeSheetTitle, activeSheetId,
      costPriceMap, earningsMap, costRawMap, earningsRawMap, fileReports, statusEl
    );
  }

  // Chi dung sheet "Cost" co san trong spreadsheet, khong can chon file Excel nao. Sheet
  // "Cost" khong co cot Earnings nen chi dien duoc Base Cost.
  async function fillBaseCostFromCostSheet(statusEl) {
    const spreadsheetId = getSpreadsheetIdFromUrl();
    const gid = getActiveGidFromUrl();

    log(statusEl, '⏳ Đang xác thực với Google...');
    await ensureAccessToken();

    log(statusEl, '⏳ Đang đọc thông tin spreadsheet...');
    const sheetProps = await fetchSheetMeta(spreadsheetId);
    const activeProps = sheetProps.find(p => p.sheetId === gid) || sheetProps[0];
    if (!activeProps) throw new Error('Không tìm thấy trang tính đang mở trong spreadsheet này.');
    const activeSheetTitle = activeProps.title;
    const activeSheetId = activeProps.sheetId;

    const costSheetProps = sheetProps.find(p => p.title === COST_SHEET_NAME);
    if (!costSheetProps) {
      throw new Error(`Không tìm thấy sheet "${COST_SHEET_NAME}" trong spreadsheet này.`);
    }

    log(statusEl, `⏳ Đang đọc sheet "${COST_SHEET_NAME}"...`);
    const costSheetData = await fetchSheetValues(spreadsheetId, COST_SHEET_NAME);
    if (costSheetData.length < 2) {
      throw new Error(`Sheet "${COST_SHEET_NAME}" không có dữ liệu.`);
    }
    const headerRow = costSheetData[0].map(normalizeHeader);
    const fulfillIdx = headerRow.indexOf('fulfillment cost');
    const totalIdx = headerRow.indexOf('total');
    const priceColIdx = fulfillIdx !== -1 ? fulfillIdx : totalIdx;
    if (priceColIdx === -1) {
      throw new Error(`Sheet "${COST_SHEET_NAME}" không có cột "Fulfillment cost" hoặc "Total".`);
    }

    const costPriceMap = {};
    const costRawMap = {};
    let addedCount = 0;
    for (let i = 1; i < costSheetData.length; i++) {
      const row = costSheetData[i];
      const orderKey = normalizeKey(row[1]); // Cot B trong sheet Cost
      if (!orderKey) continue;
      const rawCell = row[priceColIdx];
      const price = normalizeNumericValue(rawCell);
      if (costPriceMap[orderKey] === undefined) {
        costPriceMap[orderKey] = price;
        addedCount++;
      } else if (costPriceMap[orderKey] === '' && price !== '') {
        costPriceMap[orderKey] = price;
      }
      if (price === '' && costRawMap[orderKey] === undefined) {
        costRawMap[orderKey] = describeRawValue(rawCell);
      }
    }

    const fileReports = [`✅ Sheet "${COST_SHEET_NAME}": tìm thấy ${addedCount} mã đơn vào danh sách tra cứu cost.`];
    return applyMapsToActiveSheet(
      spreadsheetId, sheetProps, activeSheetTitle, activeSheetId,
      costPriceMap, {}, costRawMap, {}, fileReports, statusEl
    );
  }

  // Buoc chung cho ca 2 nguon: dien Base Cost / Earnings vao trang tinh dang mo, dua tren
  // cac map orderNumber -> gia tri da xay dung san (tu file, hoac tu sheet Cost).
  async function applyMapsToActiveSheet(
    spreadsheetId, sheetProps, activeSheetTitle, activeSheetId,
    costPriceMap, earningsMap, costRawMap, earningsRawMap, fileReports, statusEl
  ) {
    log(statusEl, `⏳ Đang đọc trang tính "${activeSheetTitle}"...`);
    const activeData = await fetchSheetValues(spreadsheetId, activeSheetTitle);
    const perSheetReports = [];
    let totalCostFilled = 0, totalCostAlready = 0, totalCostNoOrder = 0;
    let totalEarningsFilled = 0, totalEarningsAlready = 0, totalEarningsNoOrder = 0;

    if (activeData.length < 2) {
      perSheetReports.push(`⚠️ Trang tính "${activeSheetTitle}" không có dữ liệu, bỏ qua.`);
    } else {
      const headerRow = activeData[0];
      const baseCostColIdx = findColumnByHeaderInRow(headerRow, BASE_COST_HEADER);
      const earningsColIdx = findColumnByHeaderInRow(headerRow, EARNINGS_HEADER);
      const orderNumbers = activeData.slice(1).map(r => r[ORDER_NUMBER_COL_INDEX - 1]);

      const parts = [];
      const debugLines = [];

      if (Object.keys(costPriceMap).length > 0) {
        if (baseCostColIdx !== -1) {
          log(statusEl, '⏳ Đang tính toán và ghi cột Base Cost...');
          const currentVals = activeData.slice(1).map(r => r[baseCostColIdx - 1]);
          const res = computeColumnUpdates(orderNumbers, currentVals, costPriceMap, NO_COST_LABEL);
          await applyColumnUpdates(spreadsheetId, activeSheetTitle, activeSheetId, baseCostColIdx, res, NO_ORDER_LABEL, NO_COST_LABEL);
          totalCostFilled = res.filled;
          totalCostAlready = res.alreadyCorrect;
          totalCostNoOrder = res.noOrder;
          parts.push(`Cost: điền/ghi đè ${res.filled} dòng, đã đúng sẵn ${res.alreadyCorrect} dòng, ${res.noOrder} dòng có mã đơn nhưng không có trong file import (điền chưa ff), ${res.keptExisting} dòng có mã đơn không khớp import nhưng ô đã có sẵn giá trị (giữ nguyên), ${res.noOrderNumber} dòng chưa có mã đơn ở sheet đích (bỏ qua, không điền)`);
          debugLines.push(...buildBlankDebugLines(res.blankOrderKeys, costRawMap, 'Cost'));
        } else {
          parts.push('Cost: không tìm thấy cột "Base Cost" trong trang tính này, bỏ qua');
        }
      }

      if (Object.keys(earningsMap).length > 0) {
        if (earningsColIdx !== -1) {
          log(statusEl, '⏳ Đang tính toán và ghi cột Earnings...');
          const currentVals = activeData.slice(1).map(r => r[earningsColIdx - 1]);
          const res = computeColumnUpdates(orderNumbers, currentVals, earningsMap, NO_EARNINGS_LABEL);
          await applyColumnUpdates(spreadsheetId, activeSheetTitle, activeSheetId, earningsColIdx, res, NO_ORDER_LABEL, NO_EARNINGS_LABEL);
          totalEarningsFilled = res.filled;
          totalEarningsAlready = res.alreadyCorrect;
          totalEarningsNoOrder = res.noOrder;
          parts.push(`Earnings: điền/ghi đè ${res.filled} dòng, đã đúng sẵn ${res.alreadyCorrect} dòng, ${res.noOrder} dòng có mã đơn nhưng không có trong file import (điền chưa ff), ${res.keptExisting} dòng có mã đơn không khớp import nhưng ô đã có sẵn giá trị (giữ nguyên), ${res.noOrderNumber} dòng chưa có mã đơn ở sheet đích (bỏ qua, không điền)`);
          debugLines.push(...buildBlankDebugLines(res.blankOrderKeys, earningsRawMap, 'Earnings'));
        } else {
          parts.push('Earnings: không tìm thấy cột "Earnings" trong trang tính này, bỏ qua');
        }
      }

      if (parts.length > 0) perSheetReports.push(`📄 ${activeSheetTitle}: ` + parts.join(' | '));
      if (debugLines.length > 0) {
        perSheetReports.push('🔍 Debug - giá trị GỐC đọc được cho các mã đơn bị coi là "chưa có cost/earnings":');
        perSheetReports.push(...debugLines);
      }
    }

    const summary = [
      ...fileReports,
      '',
      '— Kết quả điền vào trang tính hiện tại —',
      ...perSheetReports,
      '',
      `TỔNG: Cost điền/ghi đè ${totalCostFilled} / đã đúng sẵn ${totalCostAlready} / chưa ff ${totalCostNoOrder}` +
        ` | Earnings điền/ghi đè ${totalEarningsFilled} / đã đúng sẵn ${totalEarningsAlready} / chưa ff ${totalEarningsNoOrder}`
    ];
    return summary.join('\n');
  }

  // Tinh toan gia tri moi cho 1 cot dua tren map orderNumber -> gia tri (giong het
  // fillColumnByOrderMap cua GAS, nhung chi tinh toan trong bo nho, chua ghi len sheet).
  function computeColumnUpdates(orderNumbers, currentVals, valueMap, noValueLabel) {
    const filledOrder = new Set();
    const blankOrderKeys = [];
    let filled = 0, alreadyCorrect = 0, noOrder = 0, noOrderNumber = 0, keptExisting = 0;

    const newVals = orderNumbers.map((rawOrder, i) => {
      const orderKey = normalizeKey(rawOrder);
      const existingValue = currentVals[i] !== undefined ? currentVals[i] : '';

      if (!orderKey) {
        noOrderNumber++;
        return { value: existingValue, changed: false };
      }

      if (valueMap[orderKey] === undefined) {
        if (filledOrder.has(orderKey)) return { value: existingValue, changed: false };
        filledOrder.add(orderKey);

        if (sameValue(existingValue, NO_ORDER_LABEL)) {
          noOrder++;
          return { value: existingValue, changed: false };
        }
        if (!isEmptyValue(existingValue)) {
          keptExisting++;
          return { value: existingValue, changed: false };
        }
        noOrder++;
        return { value: NO_ORDER_LABEL, changed: true };
      }

      if (filledOrder.has(orderKey)) return { value: existingValue, changed: false };
      filledOrder.add(orderKey);

      const newValue = valueMap[orderKey] !== '' ? valueMap[orderKey] : noValueLabel;
      if (valueMap[orderKey] === '') blankOrderKeys.push(orderKey);
      if (sameValue(existingValue, newValue)) {
        alreadyCorrect++;
        return { value: existingValue, changed: false };
      }
      filled++;
      return { value: newValue, changed: true };
    });

    return { newVals, filled, alreadyCorrect, noOrder, noOrderNumber, keptExisting, blankOrderKeys };
  }

  async function applyColumnUpdates(spreadsheetId, sheetTitle, sheetId, colIndex1Based, res, noOrderLabel, noValueLabel) {
    const anyChanged = res.newVals.some(v => v.changed);
    if (anyChanged) {
      await writeColumnValues(spreadsheetId, sheetTitle, colIndex1Based, 2, res.newVals.map(v => v.value));
    }
    const flags = res.newVals.map(v => sameValue(v.value, noOrderLabel) || sameValue(v.value, noValueLabel));
    await paintColumnFlags(spreadsheetId, sheetId, colIndex1Based - 1, 1, flags);
  }

  // ============ GIAO DIEN NOI (giong tinh than dialog HTML cua GAS) ============
  function log(el, text) {
    if (el) el.textContent = text;
  }

  const MAX_Z = 2147483647;

  function buildUi() {
    const btn = document.createElement('button');
    btn.id = 'gcei-toggle-btn';
    btn.textContent = '📥 Import Cost/Earnings';
    btn.style.cssText = `position:fixed!important;bottom:24px!important;right:24px!important;top:auto!important;
      left:auto!important;z-index:${MAX_Z}!important;padding:10px 16px;background:#4CAF50;color:#fff;
      border:none;border-radius:6px;cursor:pointer;font-size:13px;font-family:Arial,sans-serif;
      box-shadow:0 2px 8px rgba(0,0,0,.4);`;

    const panel = document.createElement('div');
    panel.style.cssText = `position:fixed!important;bottom:70px!important;right:24px!important;top:auto!important;
      left:auto!important;z-index:${MAX_Z}!important;width:360px;padding:14px;background:#fff;
      border:1px solid #ccc;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.4);
      font-family:Arial,sans-serif;font-size:13px;display:none;`;

    // Google Sheets bat Trusted Types CSP nen KHONG duoc gan panel.innerHTML = "..."
    // (se nem TypeError "This document requires 'TrustedHTML' assignment") - phai dung
    // createElement/appendChild cho tung phan tu con.
    const title = document.createElement('div');
    title.style.cssText = 'font-weight:bold;margin-bottom:8px;';
    title.textContent = 'Import Cost / Earnings từ Excel';

    const desc = document.createElement('div');
    desc.style.cssText = 'font-size:12px;color:#777;margin-bottom:10px;';
    desc.textContent = 'Chỉ điền dữ liệu vào trang tính đang mở hiện tại. File Cost cần cột "External number" + "Fulfillment cost"/"Total". File Earnings cần cột "Mã đơn" + "Earnings".';

    // --- Khoi 1: import tu file Excel/CSV da chon ---
    const fileLabel = document.createElement('div');
    fileLabel.style.cssText = 'font-weight:bold;font-size:12px;margin-bottom:4px;';
    fileLabel.textContent = '1. Import từ file Excel/CSV';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.accept = '.xlsx,.xls,.csv';
    fileInput.style.cssText = 'width:100%;margin-bottom:6px;';

    const runFileBtn = document.createElement('button');
    runFileBtn.textContent = '▶ Import & Điền dữ liệu';
    runFileBtn.style.cssText = 'width:100%;padding:8px;background:#4CAF50;color:#fff;border:none;border-radius:4px;cursor:pointer;margin-bottom:6px;';

    const fileHint = document.createElement('div');
    fileHint.style.cssText = 'font-size:11px;color:#999;margin-bottom:12px;';
    fileHint.textContent = 'Cần chọn ít nhất 1 file. Chỉ dùng dữ liệu trong (các) file đã chọn.';

    // --- Khoi 2: dien Base Cost tu sheet "Cost" co san, khong can chon file ---
    const sheetLabel = document.createElement('div');
    sheetLabel.style.cssText = 'font-weight:bold;font-size:12px;margin-bottom:4px;border-top:1px solid #eee;padding-top:10px;';
    sheetLabel.textContent = `2. Điền Base Cost từ sheet "${COST_SHEET_NAME}" có sẵn`;

    const sheetHint = document.createElement('div');
    sheetHint.style.cssText = 'font-size:11px;color:#999;margin-bottom:6px;';
    sheetHint.textContent = `Không cần chọn file. Dùng dữ liệu có sẵn ở sheet "${COST_SHEET_NAME}" trong chính spreadsheet này để điền lại cột Base Cost (không đụng đến Earnings).`;

    const runSheetBtn = document.createElement('button');
    runSheetBtn.textContent = `▶ Điền từ sheet "${COST_SHEET_NAME}"`;
    runSheetBtn.style.cssText = 'width:100%;padding:8px;background:#2196F3;color:#fff;border:none;border-radius:4px;cursor:pointer;';

    const statusEl = document.createElement('pre');
    statusEl.style.cssText = 'white-space:pre-wrap;margin-top:10px;max-height:280px;overflow:auto;font-size:12px;color:#333;';

    panel.appendChild(title);
    panel.appendChild(desc);
    panel.appendChild(fileLabel);
    panel.appendChild(fileInput);
    panel.appendChild(runFileBtn);
    panel.appendChild(fileHint);
    panel.appendChild(sheetLabel);
    panel.appendChild(sheetHint);
    panel.appendChild(runSheetBtn);
    panel.appendChild(statusEl);

    document.body.appendChild(btn);
    document.body.appendChild(panel);

    btn.addEventListener('click', () => {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });

    async function runWithGuard(btnEl, task) {
      runFileBtn.disabled = true;
      runSheetBtn.disabled = true;
      try {
        const summary = await task();
        log(statusEl, '✅ Hoàn tất:\n' + summary);
      } catch (e) {
        log(statusEl, '❌ Lỗi: ' + e.message);
        console.error('[Import Cost/Earnings]', e);
      } finally {
        runFileBtn.disabled = false;
        runSheetBtn.disabled = false;
      }
    }

    runFileBtn.addEventListener('click', () => {
      const files = Array.from(fileInput.files || []);
      if (files.length === 0) {
        log(statusEl, '⚠️ Vui lòng chọn ít nhất 1 file!');
        return;
      }
      runWithGuard(runFileBtn, () => processImportedFiles(files, statusEl));
    });

    runSheetBtn.addEventListener('click', () => {
      runWithGuard(runSheetBtn, () => fillBaseCostFromCostSheet(statusEl));
    });
  }

  function safeInit() {
    try {
      buildUi();
      console.log('[Import Cost/Earnings] Đã tạo nút nổi thành công.');
    } catch (e) {
      console.error('[Import Cost/Earnings] Lỗi khi tạo giao diện:', e);
    }
  }

  if (document.body) {
    safeInit();
  } else {
    document.addEventListener('DOMContentLoaded', safeInit);
  }
})();
