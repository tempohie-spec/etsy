// ============================================================
// MENU
// ============================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📦 Order Processing')
    .addItem('▶ Chạy sheet đang mở', 'processCurrentSheet')
    .addToUi();
}

// ============================================================
// CHẠY SHEET ĐANG MỞ - dùng ui.prompt gốc (không HtmlService) để không
// bị delay do tải iframe, xử lý xong tự chuyển sang sheet đích
// ============================================================
function processCurrentSheet() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const srcSheet = ss.getActiveSheet();
  const sheetName = srcSheet.getName();

  if (!sheetName.startsWith('ETSY_') && !sheetName.startsWith('ETSY -')) {
    ui.alert('Sheet đang mở ("' + sheetName + '") không phải sheet nguồn.\n' +
      'Vui lòng mở đúng sheet nguồn (tên bắt đầu bằng "ETSY_" hoặc "ETSY -") rồi thử lại.');
    return;
  }

  const dateInput = promptDate(ui);
  if (!dateInput) return;

  const merchizeLookup = buildMerchizeLookup(ss);
  const tebLookup      = buildTebLookup(ss);

  let totalTeb = 0, totalMerchize = 0, targetSheetName;

  if (sheetName === 'ETSY_Turkiye 01') {
    const result = processTurkiyeSheet(ss, srcSheet, dateInput, tebLookup, merchizeLookup);
    totalTeb      = result.teb;
    totalMerchize = result.merchize;
    // Ưu tiên mở sheet Teb nếu có dữ liệu, không thì mở sheet Merchize
    targetSheetName = totalTeb > 0 ? 'Teb: ETSY_Turkiye 01' : 'Merchize: ETSY_Turkiye 01';
  } else {
    totalMerchize = processMerchizeOnly(ss, srcSheet, dateInput, merchizeLookup);
    targetSheetName = 'Merchize: ' + sheetName;
  }

  const msg = '✅ Hoàn tất ngày ' + dateInput +
    '\n→ Teb: '      + totalTeb      + ' đơn' +
    '\n→ Merchize: ' + totalMerchize + ' đơn';
  try { ui.alert(msg); } catch(e) { Logger.log(msg); }

  const targetSheet = ss.getSheetByName(targetSheetName);
  if (targetSheet) targetSheet.activate();
}

// ============================================================
// Helper: hỏi ngày, trả về string hoặc null nếu huỷ/sai
// ============================================================
function promptDate(ui) {
  const response = ui.prompt(
    'Nhập ngày Fulfill',
    'Nhập ngày theo định dạng DD/MM/YYYY (ví dụ: 23/06/2026):',
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return null;
  const dateInput = response.getResponseText().trim();
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dateInput)) {
    ui.alert('Ngày không hợp lệ. Vui lòng nhập đúng định dạng DD/MM/YYYY.');
    return null;
  }
  return dateInput;
}

// TEST từ Editor
function processOrdersByDate_TEST() {
  _runProcessing('29/06/2026', null); // <-- SỬA NGÀY Ở ĐÂY
}

// TEST chạy 1 sheet cụ thể từ Editor
function processSelectedSheets_TEST() {
  _runProcessing('29/06/2026', new Set(['ETSY_Marty HT 10'])); // <-- SỬA TÊN SHEET VÀ NGÀY
}

// ============================================================
// CORE - selectedSheets: Set tên sheet cần chạy, null = tất cả
// ============================================================
function _runProcessing(dateInput, selectedSheets) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const allSourceSheets = ss.getSheets().filter(s =>
    s.getName().startsWith('ETSY_') || s.getName().startsWith('ETSY -')
  );

  // Lọc theo danh sách được chọn (nếu có)
  const sourceSheets = selectedSheets
    ? allSourceSheets.filter(s => selectedSheets.has(s.getName()))
    : allSourceSheets;

  if (sourceSheets.length === 0) {
    try { SpreadsheetApp.getUi().alert('Không tìm thấy sheet nào để xử lý.'); } catch(e) {}
    return;
  }

  const merchizeLookup = buildMerchizeLookup(ss);
  const tebLookup      = buildTebLookup(ss);

  Logger.log('Chạy cho: ' + sourceSheets.map(s => s.getName()).join(', '));

  let totalTeb = 0, totalMerchize = 0;

  for (const srcSheet of sourceSheets) {
    const sheetName = srcSheet.getName();

    if (sheetName === 'ETSY_Turkiye 01') {
      const result = processTurkiyeSheet(ss, srcSheet, dateInput, tebLookup, merchizeLookup);
      totalTeb      += result.teb;
      totalMerchize += result.merchize;
      Logger.log(sheetName + ' -> Teb: ' + result.teb + ', Merchize: ' + result.merchize);

    } else {
      const count = processMerchizeOnly(ss, srcSheet, dateInput, merchizeLookup);
      totalMerchize += count;
      Logger.log(sheetName + ' -> Merchize: ' + count);
    }
  }

  const msg = '✅ Hoàn tất ngày ' + dateInput +
    '\n→ Teb: '      + totalTeb      + ' đơn' +
    '\n→ Merchize: ' + totalMerchize + ' đơn';
  try { SpreadsheetApp.getUi().alert(msg); } catch(e) { Logger.log(msg); }
}

// ============================================================
// Xoá toàn bộ dữ liệu cũ trong sheet đích, CHỈ GIỮ LẠI dòng header (dòng 1)
// Dùng deleteRows để dữ liệu mới được điền ngay sau header, không để trống dòng
// ============================================================
function clearDestSheetKeepHeader(destSheet) {
  const lastRow = destSheet.getLastRow();
  if (lastRow > 1) {
    destSheet.deleteRows(2, lastRow - 1);
    Logger.log('Đã xoá dữ liệu cũ (giữ header) trong sheet "' + destSheet.getName() + '"');
  }
}

// ============================================================
// Ghi toàn bộ dữ liệu tích luỹ (mảng các dòng) xuống sheet đích trong 1 lần gọi API
// -> nhanh hơn nhiều lần so với setValues() theo từng dòng trong vòng lặp
// ============================================================
function flushRows(destSheet, rows) {
  if (rows.length === 0) return;
  const numCols = rows[0].length;
  destSheet.getRange(destSheet.getLastRow() + 1, 1, rows.length, numCols).setValues(rows);
}

// ============================================================
// LOGIC: Sheet ETSY_Turkiye 01
// ============================================================
function processTurkiyeSheet(ss, srcSheet, dateInput, tebLookup, merchizeLookup) {
  const data = srcSheet.getDataRange().getValues();
  const H    = buildHeaderMap(data[0]);

  const targetRows = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[H['orderNumber']]) continue;
    if (formatDate(row[H['Date Fulfill']]) === dateInput) targetRows.push(row);
  }

  const tebDestSheet   = getOrCreateSheet(ss, 'Teb: ETSY_Turkiye 01');
  const merchDestSheet = getOrCreateSheet(ss, 'Merchize: ETSY_Turkiye 01');
  ensureMerchizeDestHeader(merchDestSheet, data[0]);

  // XOÁ dữ liệu cũ (giữ header) - LUÔN LUÔN xoá, kể cả khi không có dữ liệu để điền
  clearDestSheetKeepHeader(tebDestSheet);
  clearDestSheetKeepHeader(merchDestSheet);

  if (targetRows.length === 0) return { teb: 0, merchize: 0 };

  // Group theo orderNumber để phát hiện duplicate NGAY TRONG lần chạy này
  const orderGroups = {};
  for (const row of targetRows) {
    const oNum = String(row[H['orderNumber']] || '').trim();
    orderGroups[oNum] = (orderGroups[oNum] || 0) + 1;
  }

  // Đọc header đích 1 lần duy nhất (thay vì đọc lại cho từng dòng)
  const merchLastCol  = Math.max(merchDestSheet.getLastColumn(), 30);
  const merchDestHMap = buildHeaderMap(merchDestSheet.getRange(1, 1, 1, merchLastCol).getValues()[0]);

  const tebRows   = [];
  const merchRows = [];

  for (const row of targetRows) {
    const oNum = String(row[H['orderNumber']] || '').trim();

    const country     = String(row[H['country']] || '').trim();
    const title       = String(row[H['title']]   || '').trim();
    const color       = String(row[H['color']]   || '').trim();
    const size        = String(row[H['size']]    || '').trim();
    const isNotUS     = country.toLowerCase() !== 'united states';
    const isDuplicate = (orderGroups[oNum] || 0) >= 2;

    if (isNotUS || isDuplicate) {
      merchRows.push(buildMerchizeDestRow(merchLastCol, merchDestHMap, data[0], row, H, merchizeLookup));
      continue;
    }

    const tebSKU = tebLookup[makeKey(title, color, size)];
    if (tebSKU) {
      tebRows.push(buildTebDestRow(row, H, tebSKU));
    } else {
      merchRows.push(buildMerchizeDestRow(merchLastCol, merchDestHMap, data[0], row, H, merchizeLookup));
    }
  }

  flushRows(tebDestSheet, tebRows);
  flushRows(merchDestSheet, merchRows);

  return { teb: tebRows.length, merchize: merchRows.length };
}

// ============================================================
// LOGIC: Các sheet ETSY_ khác (bao gồm ETSY_Marty HT 10) -> Merchize
// ============================================================
function processMerchizeOnly(ss, srcSheet, dateInput, merchizeLookup) {
  const data = srcSheet.getDataRange().getValues();
  const H    = buildHeaderMap(data[0]);

  const targetRows = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[H['orderNumber']]) continue;
    if (formatDate(row[H['Date Fulfill']]) === dateInput) targetRows.push(row);
  }

  const destSheet = getOrCreateSheet(ss, 'Merchize: ' + srcSheet.getName());
  ensureMerchizeDestHeader(destSheet, data[0]);

  // XOÁ dữ liệu cũ (giữ header) - LUÔN LUÔN xoá, kể cả khi không có dữ liệu để điền
  clearDestSheetKeepHeader(destSheet);

  if (targetRows.length === 0) return 0;

  const lastCol  = Math.max(destSheet.getLastColumn(), 30);
  const destHMap = buildHeaderMap(destSheet.getRange(1, 1, 1, lastCol).getValues()[0]);

  const rows = targetRows.map(row =>
    buildMerchizeDestRow(lastCol, destHMap, data[0], row, H, merchizeLookup)
  );
  flushRows(destSheet, rows);

  return rows.length;
}

// ============================================================
// Tạo mảng giá trị 1 dòng cho sheet Teb đích (không ghi trực tiếp)
// ============================================================
function buildTebDestRow(row, H, tebSKU) {
  const numCols = 20;
  const vals    = new Array(numCols).fill('');

  vals[1]  = row[H['orderNumber']]  || '';
  vals[2]  = tebSKU;
  vals[3]  = row[H['quantity']]     || '';
  vals[4]  = row[H['name']]         || '';
  vals[5]  = row[H['phone']]        || '';
  vals[6]  = row[H['address1']]     || '';
  vals[7]  = row[H['address2']]     || '';
  vals[8]  = row[H['city']]         || '';
  vals[9]  = row[H['state']]        || '';
  vals[10] = row[H['postalCode']]   || '';
  vals[11] = row[H['country']]      || '';
  vals[12] = row[H['designFront']]  || '';
  vals[13] = row[H['designBack']]   || '';

  // ===== LOGIC: designFront/designBack quyết định mockUpFront vs mockupBack =====
  const designFront = String(row[H['designFront']] || '').trim();
  const designBack   = String(row[H['designBack']]  || '').trim();

  if (!designFront && designBack) {
    // Chỉ có designBack -> điền mockUpFront vào cột mockupBack (R), để trống cột mockUpFront
    vals[17] = row[H['mockUpFront']] || ''; // cột R = mockupBack
  } else {
    // Trường hợp bình thường -> điền vào mockUpFront như cũ
    vals[16] = row[H['mockUpFront']] || '';
  }
  // ================================================================

  const printMethod = String(row[H['PrintingMethod']] || '').trim().toUpperCase();
  if (printMethod === 'DTG') vals[18] = row[H['PrintingMethod']] || '';

  return vals;
}

// ============================================================
// CHỌN SKU THEO TYPE + COUNTRY
// - Nếu country = Australia: ưu tiên dòng có type "...(Made in AU)".
//   Nếu KHÔNG có dòng nào khớp cả title+color+size với type AU
//   -> quay về logic cũ: lấy dòng có type "...(Made in US)".
// - Nếu country khác Australia: luôn lấy dòng có type "...(Made in US)"
//   (logic cũ, không đổi).
// - Với các sản phẩm khác (chỉ có 1 type / không phải Comfort Adult AU-US):
//   matches chỉ có 1 phần tử -> lấy luôn, hành vi y hệt trước đây.
// ============================================================
const MERCHIZE_TYPE_AU = 'Classic Unisex T-Shirt Comfort Colors 1717 (Made in AU)';
const MERCHIZE_TYPE_US = 'Classic Unisex T-Shirt Comfort Colors 1717 (Made in US)';

function resolveMerchizeMatch(matches, country) {
  if (!matches || matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  const isAustralia = String(country || '').trim().toLowerCase() === 'australia';

  if (isAustralia) {
    const auMatch = matches.find(m => m.type === MERCHIZE_TYPE_AU);
    if (auMatch) return auMatch;
    // Không có dòng AU khớp đủ title+color+size -> quay về logic cũ (US)
    const usMatch = matches.find(m => m.type === MERCHIZE_TYPE_US);
    if (usMatch) return usMatch;
    return matches[0];
  }

  // Không phải Australia -> luôn dùng type US (logic cũ)
  const usMatch = matches.find(m => m.type === MERCHIZE_TYPE_US);
  if (usMatch) return usMatch;
  return matches[0];
}

// ============================================================
// Tạo mảng giá trị 1 dòng cho sheet Merchize đích (không ghi trực tiếp)
// ============================================================
function buildMerchizeDestRow(destLastCol, destHMap, srcHeaders, row, H, merchizeLookup) {
  const title   = String(row[H['title']]   || '').trim();
  const color   = String(row[H['color']]   || '').trim();
  const size    = String(row[H['size']]    || '').trim();
  const country = String(row[H['country']] || '').trim();

  const matches = merchizeLookup[makeKey(title, color, size)] || [];
  const mMatch  = resolveMerchizeMatch(matches, country);

  const numCols = Math.max(destLastCol, srcHeaders.length + 2);
  const vals    = new Array(numCols).fill('');

  for (let i = 0; i < srcHeaders.length; i++) {
    const hName = String(srcHeaders[i]).trim();
    const dIdx  = destHMap[hName];
    if (hName && dIdx !== undefined) vals[dIdx] = row[i];
  }

  if (mMatch) {
    if (destHMap['type']        !== undefined) vals[destHMap['type']]        = mMatch.type;
    if (destHMap['merchizeSku'] !== undefined) vals[destHMap['merchizeSku']] = mMatch.merchizeSku;
  }

  return vals;
}

// ============================================================
// Tạo header cho sheet Merchize đích mới
// ============================================================
function ensureMerchizeDestHeader(destSheet, srcHeaders) {
  if (destSheet.getLastRow() > 0) return;
  const extra    = ['merchizeSku', 'type'];
  const srcNames = srcHeaders.map(h => String(h).trim()).filter(h => h);
  const combined = [...extra, ...srcNames.filter(h => !extra.includes(h))];
  destSheet.getRange(1, 1, 1, combined.length).setValues([combined]);
  destSheet.getRange(1, 1, 1, combined.length).setBackground('#00FF00').setFontWeight('bold');
}

// ============================================================
// BUILD LOOKUP - Merchize SKU
// Lưu ý: nhiều dòng có thể cùng title+color+size nhưng khác "type"
// (vd: "Comfort Adult" có 2 type: "...(Made in AU)" và "...(Made in US)")
// -> lookup[key] là MẢNG các match, không ghi đè lẫn nhau
// ============================================================
function buildMerchizeLookup(ss) {
  const sheet = ss.getSheetByName('Merchize SKU');
  if (!sheet) { Logger.log('❌ Không tìm thấy "Merchize SKU"'); return {}; }
  const data   = sheet.getDataRange().getValues();
  const H      = buildHeaderMap(data[0]);
  const lookup = {};
  for (let i = 1; i < data.length; i++) {
    const r     = data[i];
    const type  = String(r[H['type']]        || '').trim();
    const color = String(r[H['color']]       || '').trim();
    const size  = String(r[H['size']]        || '').trim();
    const sku   = String(r[H['merchizeSku']] || '').trim();
    const title = String(r[H['title']]       || '').trim();
    const key   = makeKey(title, color, size);
    if (key && sku) {
      if (!lookup[key]) lookup[key] = [];
      lookup[key].push({ type, merchizeSku: sku });
    }
  }
  return lookup;
}

// ============================================================
// BUILD LOOKUP - Teb Print SKU
// ============================================================
function buildTebLookup(ss) {
  const sheet = ss.getSheetByName('Teb Print SKU');
  if (!sheet) { Logger.log('❌ Không tìm thấy "Teb Print SKU"'); return {}; }
  const data   = sheet.getDataRange().getValues();
  const H      = buildHeaderMap(data[0]);
  const lookup = {};
  for (let i = 1; i < data.length; i++) {
    const r     = data[i];
    const title = String(r[H['title']] || '').trim();
    const color = String(r[H['color']] || '').trim();
    const size  = String(r[H['size']]  || '').trim();
    const sku   = String(r[H['SKU']]   || '').trim();
    const key   = makeKey(title, color, size);
    if (key && sku) lookup[key] = sku;
  }
  return lookup;
}

// ============================================================
// HELPERS
// ============================================================
function buildHeaderMap(headers) {
  const map = {};
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i]).trim();
    if (h) map[h] = i;
  }
  return map;
}

function makeKey(a, b, c) {
  return [a, b, c].map(s => String(s || '').trim().toLowerCase()).join('|');
}

function formatDate(val) {
  if (!val) return '';
  if (val instanceof Date) {
    const d = String(val.getDate()).padStart(2, '0');
    const m = String(val.getMonth() + 1).padStart(2, '0');
    return d + '/' + m + '/' + val.getFullYear();
  }
  return String(val).trim();
}

function getOrCreateSheet(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}
