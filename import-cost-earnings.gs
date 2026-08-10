// ============================================================
// IMPORT COST + EARNINGS TỰ ĐỘNG THEO NỘI DUNG (không cần khớp tên file/sheet)
// ============================================================
// Logic:
//  - File "Cost": nhận diện qua header "External number" + ("Fulfillment cost" hoặc "Total")
//    -> điền vào cột có header "Base Cost" của TRANG TÍNH HIỆN TẠI (sheet đang mở) nếu
//       orderNumber (cột C) khớp
//  - File "Earnings": nhận diện qua header "Mã đơn" + "Earnings"
//    -> điền vào cột có header "Earnings" của TRANG TÍNH HIỆN TẠI nếu orderNumber (cột C) khớp
//    -> chỉ lấy giá trị số, bỏ ký tự "$"
//  - Nguồn dữ liệu để tra cứu mã đơn: gộp từ TẤT CẢ file Excel đã chọn VÀ (nếu có) sheet
//    "Cost" có sẵn trong file hiện tại. Việc dò khớp luôn ưu tiên: kiểm tra mã đơn xuất hiện
//    ở file Excel hoặc sheet Cost trước, sau đó mới đối chiếu với TRANG TÍNH HIỆN TẠI, khớp thì mới điền.
//  - CHỈ điền trên trang tính đang mở (active sheet) tại thời điểm chạy, không đụng tới các
//    sheet ETSY_ khác.
//  - Cả 2 cột đích (Base Cost, Earnings) đều được DÒ THEO TÊN HEADER trong dòng tiêu đề
//    của trang tính hiện tại (không hardcode số cột).
//  - Nếu 1 orderNumber xuất hiện nhiều dòng trong sheet hiện tại -> chỉ điền dòng đầu tiên
//  - Nếu ô đích đã có sẵn giá trị -> bỏ qua (không ghi đè)
//  - Nếu dòng có mã đơn nhưng KHÔNG tìm thấy giá trị tương ứng trong dữ liệu tra cứu
//    -> điền "chưa có cost" (hoặc "chưa có earnings")
//  - Nếu dòng KHÔNG có mã đơn -> điền "chưa ff"
//  - Kết thúc, báo cáo số dòng đã điền được giá trị thật và số dòng chưa điền được trên
//    trang tính hiện tại.
//
// CÀI ĐẶT TRƯỚC KHI DÙNG:
// 1. Mở Apps Script Editor (Extensions > Apps Script)
// 2. Bên trái, mục "Services" > bấm dấu (+) > chọn "Drive API" > Add
//    (Advanced Drive Service, cần để convert Excel -> Google Sheet)
// 3. Lưu (Ctrl+S), chạy thử showImportCostDialog() 1 lần để cấp quyền
// ============================================================

const ORDER_NUMBER_COL_INDEX = 3;   // Cột C trong trang tính hiện tại (orderNumber)
const BASE_COST_HEADER = "base cost";  // Header cần dò (đã normalize: bỏ dấu, chữ thường)
const EARNINGS_HEADER = "earnings";    // Header cần dò (đã normalize: bỏ dấu, chữ thường)
const COST_SHEET_NAME = "Cost";        // Sheet phụ (nếu có) dùng làm nguồn tra cứu cost
const NO_ORDER_LABEL = "chưa ff";      // Dòng không có mã đơn
const NO_COST_LABEL = "chưa có cost";  // Có mã đơn nhưng không tìm thấy cost tương ứng
const NO_EARNINGS_LABEL = "chưa có earnings"; // Có mã đơn nhưng không tìm thấy earnings tương ứng

// Dò 1 cột trong sheet theo tên header (dòng 1), trả về chỉ số cột (1-based) hoặc -1 nếu không thấy
function findColumnByHeader(sheet, headerText) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return -1;
  const headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  for (let i = 0; i < headerRow.length; i++) {
    if (normalizeHeader(headerRow[i]) === headerText) return i + 1;
  }
  return -1;
}

// ============ HÀM DÙNG CHUNG ============
function removeDiacritics(str) {
  return String(str || "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeHeader(val) {
  return removeDiacritics(String(val || "")).trim().toLowerCase();
}

function normalizeKey(val) {
  if (val === null || val === undefined || val === "") return "";
  if (typeof val === "number") return Number.isInteger(val) ? String(val) : String(val);
  return String(val).trim().replace(/\s+/g, "").replace(/\.0+$/, "");
}

function normalizeNumericValue(val) {
  // Bỏ mọi ký tự không phải số/dấu chấm/dấu trừ (bỏ luôn "$", ",", v.v.)
  return String(val === null || val === undefined ? "" : val)
    .replace(/[^0-9.\-]/g, "")
    .trim();
}

// ============ DIALOG IMPORT EXCEL ============
function showImportCostDialog() {
  const html = HtmlService.createHtmlOutput(`
    <style>
      body { font-family: Arial, sans-serif; padding: 16px; font-size: 14px; }
      label { display: block; margin-bottom: 6px; font-weight: bold; }
      input { width: 100%; padding: 8px; box-sizing: border-box; margin-bottom: 12px; border: 1px solid #ccc; border-radius: 4px; }
      button { padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; }
      #btnRun { background: #4CAF50; color: white; width: 100%; }
      #btnRun:hover { background: #45a049; }
      #btnRun:disabled { background: #999; }
      #status { margin-top: 10px; font-size: 13px; color: #555; white-space: pre-line; }
      #preview { margin-bottom: 10px; font-size: 12px; color: #333; }
      .note { font-size: 12px; color: #777; margin-bottom: 12px; }
    </style>

    <label>Chọn 1 hoặc nhiều file Excel (Cost và/hoặc Earnings, tên file không quan trọng):</label>
    <input type="file" id="fileInput" multiple accept=".xlsx,.xls,.csv" />
    <div class="note">
      Chỉ điền dữ liệu vào <b>trang tính đang mở hiện tại</b>.<br>
      Hệ thống tự nhận diện loại file theo cột tiêu đề:<br>
      • File Cost: cần cột "External number" + "Fulfillment cost" hoặc "Total"<br>
      • File Earnings: cần cột "Mã đơn" + "Earnings"<br>
      Ngoài file Excel, nếu file hiện tại có sẵn sheet "Cost" thì dữ liệu cost trong đó
      cũng được dùng để tra cứu.<br>
      Với mỗi dòng trên trang tính hiện tại: có mã đơn nhưng chưa tra được giá trị -> điền
      "chưa có cost"/"chưa có earnings"; không có mã đơn -> điền "chưa ff".
    </div>

    <div id="preview"></div>

    <button id="btnRun" onclick="runImport()">▶ Import & Điền dữ liệu</button>
    <div id="status"></div>

    <script>
      document.getElementById("fileInput").addEventListener("change", function() {
        const files = this.files;
        let html = "";
        for (let i = 0; i < files.length; i++) {
          html += '<div>📄 ' + files[i].name + '</div>';
        }
        document.getElementById("preview").innerHTML = html;
      });

      function fileToBase64(file) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      }

      async function runImport() {
        const input = document.getElementById("fileInput");
        const files = input.files;
        if (!files.length) {
          document.getElementById("status").innerHTML = "⚠️ Vui lòng chọn ít nhất 1 file!";
          return;
        }
        document.getElementById("btnRun").disabled = true;
        document.getElementById("status").innerHTML = "⏳ Đang đọc file...";

        const payload = [];
        for (let i = 0; i < files.length; i++) {
          const base64 = await fileToBase64(files[i]);
          payload.push({
            name: files[i].name,
            mimeType: files[i].type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            base64: base64
          });
        }

        document.getElementById("status").innerHTML = "⏳ Đang import và điền dữ liệu...";

        google.script.run
          .withSuccessHandler(msg => {
            document.getElementById("status").innerHTML = "✅ Hoàn tất:\\n" + msg;
            document.getElementById("btnRun").disabled = false;
          })
          .withFailureHandler(err => {
            document.getElementById("status").innerHTML = "❌ Lỗi: " + err.message;
            document.getElementById("btnRun").disabled = false;
          })
          .processImportedCostFiles(payload);
      }
    </script>
  `)
  .setWidth(460)
  .setHeight(520)
  .setTitle("Import Cost / Earnings từ Excel");

  SpreadsheetApp.getUi().showModalDialog(html, "Import Cost / Earnings từ Excel");
}

// ============ HÀM XỬ LÝ IMPORT (SERVER SIDE) ============
function processImportedCostFiles(files) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const activeSheet = ss.getActiveSheet();
  const costPriceMap = {};     // orderKey -> giá cost (đã strip ký tự lạ)
  const earningsMap = {};      // orderKey -> giá earnings (đã strip "$")
  const fileReports = [];
  const tempFileIds = [];

  try {
    files.forEach(file => {
      // Convert file Excel -> Google Sheet tạm để đọc dữ liệu
      const blob = Utilities.newBlob(Utilities.base64Decode(file.base64), file.mimeType, file.name);
      const resource = {
        title: "TEMP_IMPORT_" + file.name + "_" + new Date().getTime(),
        mimeType: MimeType.GOOGLE_SHEETS
      };
      const driveFile = Drive.Files.insert(resource, blob, { convert: true });
      tempFileIds.push(driveFile.id);

      const tempSs = SpreadsheetApp.openById(driveFile.id);
      const tempSheet = tempSs.getSheets()[0];
      const lastRow = tempSheet.getLastRow();
      const lastCol = tempSheet.getLastColumn();

      if (lastRow < 2) {
        fileReports.push(`⚠️ ${file.name}: file không có dữ liệu, bỏ qua.`);
        return;
      }

      const data = tempSheet.getRange(1, 1, lastRow, lastCol).getValues();
      const headerRow = data[0].map(normalizeHeader);

      const extIdx = headerRow.indexOf("external number");
      const fulfillIdx = headerRow.indexOf("fulfillment cost");
      const totalIdx = headerRow.indexOf("total");
      const maDonIdx = headerRow.indexOf("ma don"); // "Mã đơn" sau khi bỏ dấu
      const earningsIdx = headerRow.indexOf("earnings");

      if (extIdx !== -1 && (fulfillIdx !== -1 || totalIdx !== -1)) {
        // ==== FILE LOẠI COST ====
        const priceColIdx = fulfillIdx !== -1 ? fulfillIdx : totalIdx;
        const priceColLabel = fulfillIdx !== -1 ? "Fulfillment cost" : "Total";
        let addedCount = 0;

        for (let i = 1; i < data.length; i++) {
          const orderKey = normalizeKey(data[i][extIdx]);
          if (!orderKey) continue;
          const price = normalizeNumericValue(data[i][priceColIdx]);
          if (costPriceMap[orderKey] === undefined) {
            costPriceMap[orderKey] = price;
            addedCount++;
          }
        }
        fileReports.push(`✅ ${file.name}: nhận diện là file COST (cột "${priceColLabel}"), thêm ${addedCount} mã đơn vào danh sách tra cứu.`);

      } else if (maDonIdx !== -1 && earningsIdx !== -1) {
        // ==== FILE LOẠI EARNINGS ====
        let addedCount = 0;

        for (let i = 1; i < data.length; i++) {
          const orderKey = normalizeKey(data[i][maDonIdx]);
          if (!orderKey) continue;
          const value = normalizeNumericValue(data[i][earningsIdx]);
          if (earningsMap[orderKey] === undefined) {
            earningsMap[orderKey] = value;
            addedCount++;
          }
        }
        fileReports.push(`✅ ${file.name}: nhận diện là file EARNINGS, thêm ${addedCount} mã đơn vào danh sách tra cứu.`);

      } else {
        fileReports.push(`⚠️ ${file.name}: không nhận diện được loại file (thiếu cột "External number"+"Fulfillment cost/Total" hoặc "Mã đơn"+"Earnings"), bỏ qua.`);
      }
    });
  } finally {
    // Dọn file tạm trên Drive
    tempFileIds.forEach(id => {
      try { Drive.Files.remove(id); } catch (e) { /* bỏ qua nếu lỗi */ }
    });
  }

  // ==== GỘP THÊM DỮ LIỆU TỪ SHEET "Cost" (NẾU CÓ) VÀO DANH SÁCH TRA CỨU COST ====
  const costSheetMap = buildCostMapFromCostSheet(ss);
  let costSheetAdded = 0;
  Object.keys(costSheetMap).forEach(orderKey => {
    if (costPriceMap[orderKey] === undefined) {
      costPriceMap[orderKey] = costSheetMap[orderKey];
      costSheetAdded++;
    }
  });
  if (costSheetAdded > 0) {
    fileReports.push(`✅ Sheet "${COST_SHEET_NAME}": bổ sung thêm ${costSheetAdded} mã đơn vào danh sách tra cứu cost.`);
  }

  // ==== ÁP DỤNG VÀO TRANG TÍNH HIỆN TẠI (KHÔNG ĐỤNG CÁC SHEET KHÁC) ====
  const lastRow = activeSheet.getLastRow();
  const perSheetReports = [];
  let totalCostMatched = 0, totalCostUnfilled = 0, totalCostSkipped = 0;
  let totalEarningsMatched = 0, totalEarningsUnfilled = 0, totalEarningsSkipped = 0;

  if (lastRow < 2) {
    perSheetReports.push(`⚠️ Trang tính "${activeSheet.getName()}" không có dữ liệu, bỏ qua.`);
  } else {
    const lastCol = activeSheet.getLastColumn();
    const headerRow = activeSheet.getRange(1, 1, 1, lastCol).getValues()[0];
    let baseCostColIdx = -1;
    let earningsColIdx = -1;
    headerRow.forEach((h, idx) => {
      const norm = normalizeHeader(h);
      if (norm === BASE_COST_HEADER) baseCostColIdx = idx + 1;
      if (norm === EARNINGS_HEADER) earningsColIdx = idx + 1;
    });

    const parts = [];

    // -- Điền Base Cost (cột đích dò theo header "Base Cost") --
    if (Object.keys(costPriceMap).length > 0) {
      if (baseCostColIdx !== -1) {
        const res = fillColumnByOrderMap(activeSheet, ORDER_NUMBER_COL_INDEX, baseCostColIdx, costPriceMap, NO_COST_LABEL);
        totalCostMatched = res.matched;
        totalCostUnfilled = res.noOrder + res.noValue;
        totalCostSkipped = res.skipped;
        parts.push(`Cost: điền được ${res.matched} dòng, chưa điền được ${totalCostUnfilled} dòng (${res.noValue} chưa có cost, ${res.noOrder} chưa ff), ${res.skipped} dòng đã có sẵn giá trị`);
      } else {
        parts.push(`Cost: không tìm thấy cột "Base Cost" trong trang tính này, bỏ qua`);
      }
    }

    // -- Điền Earnings (cột đích dò theo header "Earnings") --
    if (Object.keys(earningsMap).length > 0) {
      if (earningsColIdx !== -1) {
        const res = fillColumnByOrderMap(activeSheet, ORDER_NUMBER_COL_INDEX, earningsColIdx, earningsMap, NO_EARNINGS_LABEL);
        totalEarningsMatched = res.matched;
        totalEarningsUnfilled = res.noOrder + res.noValue;
        totalEarningsSkipped = res.skipped;
        parts.push(`Earnings: điền được ${res.matched} dòng, chưa điền được ${totalEarningsUnfilled} dòng (${res.noValue} chưa có earnings, ${res.noOrder} chưa ff), ${res.skipped} dòng đã có sẵn giá trị`);
      } else {
        parts.push(`Earnings: không tìm thấy cột "Earnings" trong trang tính này, bỏ qua`);
      }
    }

    if (parts.length > 0) {
      perSheetReports.push(`📄 ${activeSheet.getName()}: ` + parts.join(" | "));
    }
  }

  const summary = [
    ...fileReports,
    "",
    "— Kết quả điền vào trang tính hiện tại —",
    ...perSheetReports,
    "",
    `TỔNG: Cost điền ${totalCostMatched} / chưa điền ${totalCostUnfilled} / đã có sẵn ${totalCostSkipped}` +
      ` | Earnings điền ${totalEarningsMatched} / chưa điền ${totalEarningsUnfilled} / đã có sẵn ${totalEarningsSkipped}`
  ];

  return summary.join("\n");
}

// Đọc sheet "Cost" (nếu có) trong file hiện tại, trả về map orderKey -> giá cost
function buildCostMapFromCostSheet(ss) {
  const costSheet = ss.getSheetByName(COST_SHEET_NAME);
  if (!costSheet) return {};

  const lastRow = costSheet.getLastRow();
  const lastCol = costSheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return {};

  const data = costSheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headerRow = data[0].map(normalizeHeader);
  const fulfillIdx = headerRow.indexOf("fulfillment cost");
  const totalIdx = headerRow.indexOf("total");
  const priceColIdx = fulfillIdx !== -1 ? fulfillIdx : totalIdx;
  if (priceColIdx === -1) return {};

  const map = {};
  for (let i = 1; i < data.length; i++) {
    const orderKey = normalizeKey(data[i][1]); // Cột B = orderNumber trong sheet Cost cũ
    if (!orderKey) continue;
    const price = normalizeNumericValue(data[i][priceColIdx]);
    if (map[orderKey] === undefined) map[orderKey] = price;
  }
  return map;
}

// ============ HÀM ĐIỀN 1 CỘT DỰA TRÊN MAP orderNumber -> giá trị ============
// - Nếu orderNumber trùng nhiều dòng -> chỉ điền dòng đầu tiên
// - Nếu ô đích đã có sẵn giá trị -> bỏ qua, không ghi đè (skipped)
// - Nếu dòng không có mã đơn -> điền NO_ORDER_LABEL ("chưa ff") (noOrder)
// - Nếu dòng có mã đơn nhưng không khớp được giá trị trong valueMap -> điền noValueLabel (noValue)
// - Nếu khớp được -> điền giá trị thật (matched)
function fillColumnByOrderMap(sheet, orderColIndex, targetColIndex, valueMap, noValueLabel) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { matched: 0, noValue: 0, noOrder: 0, skipped: 0 };

  const orderNumbers = sheet.getRange(2, orderColIndex, lastRow - 1, 1).getValues();
  const currentVals = sheet.getRange(2, targetColIndex, lastRow - 1, 1).getValues();

  const filledOrder = new Set();
  let matched = 0;
  let noValue = 0;
  let noOrder = 0;
  let skipped = 0;

  const updates = orderNumbers.map((row, i) => {
    const orderKey = normalizeKey(row[0]);
    const existingValue = currentVals[i][0];
    const hasExistingValue = existingValue !== "" && existingValue !== null && existingValue !== undefined && String(existingValue).trim() !== "0";

    if (hasExistingValue) {
      skipped++;
      return [existingValue];
    }

    if (!orderKey) {
      noOrder++;
      return [NO_ORDER_LABEL];
    }

    if (filledOrder.has(orderKey)) return [existingValue];
    filledOrder.add(orderKey);

    if (valueMap[orderKey] !== undefined) {
      const v = valueMap[orderKey];
      if (v !== "") {
        matched++;
        return [v];
      }
      noValue++;
      return [noValueLabel];
    }

    noValue++;
    return [noValueLabel];
  });

  sheet.getRange(2, targetColIndex, updates.length, 1).setValues(updates);
  return { matched, noValue, noOrder, skipped };
}

// ============ (GIỮ NGUYÊN) CÁCH LÀM CŨ QUA SHEET "Cost", PHÒNG KHI CẦN DÙNG LẠI ============
function showFillBaseCostDialog() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const sheetNames = ss.getSheets()
    .map(s => s.getName())
    .filter(name => name.startsWith("ETSY_"));

  const html = HtmlService.createHtmlOutput(`
    <style>
      body { font-family: Arial, sans-serif; padding: 16px; font-size: 14px; }
      label { display: block; margin-bottom: 6px; font-weight: bold; }
      input, select { width: 100%; padding: 8px; box-sizing: border-box; margin-bottom: 12px; border: 1px solid #ccc; border-radius: 4px; }
      button { padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; }
      #btnRun { background: #4CAF50; color: white; width: 100%; }
      #btnRun:hover { background: #45a049; }
      #status { margin-top: 10px; font-size: 13px; color: #555; }
    </style>

    <label>Chọn hoặc nhập tên sheet chính:</label>
    <select id="sheetSelect" onchange="syncInput(this.value)">
      <option value="">-- Chọn sheet --</option>
      ${sheetNames.map(n => `<option value="${n}">${n}</option>`).join("")}
    </select>

    <label>Tên sheet (có thể sửa trực tiếp):</label>
    <input type="text" id="sheetName" placeholder="Nhập tên sheet..." />

    <button id="btnRun" onclick="runScript()">▶ Chạy Điền Base Cost</button>
    <div id="status"></div>

    <script>
      function syncInput(val) {
        document.getElementById("sheetName").value = val;
      }
      function runScript() {
        const name = document.getElementById("sheetName").value.trim();
        if (!name) {
          document.getElementById("status").innerHTML = "⚠️ Vui lòng chọn hoặc nhập tên sheet!";
          return;
        }
        document.getElementById("status").innerHTML = "⏳ Đang chạy...";
        document.getElementById("btnRun").disabled = true;
        google.script.run
          .withSuccessHandler(msg => {
            document.getElementById("status").innerHTML = "✅ " + msg;
            document.getElementById("btnRun").disabled = false;
          })
          .withFailureHandler(err => {
            document.getElementById("status").innerHTML = "❌ Lỗi: " + err.message;
            document.getElementById("btnRun").disabled = false;
          })
          .fillBaseCostWithSheetName(name);
      }
    </script>
  `)
  .setWidth(380)
  .setHeight(280)
  .setTitle("Điền Base Cost");

  SpreadsheetApp.getUi().showModalDialog(html, "Điền Base Cost");
}

function fillBaseCostWithSheetName(mainSheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const costSheet = ss.getSheetByName(COST_SHEET_NAME);
  if (!costSheet) throw new Error("Không tìm thấy sheet: " + COST_SHEET_NAME);

  const costLastRow = costSheet.getLastRow();
  if (costLastRow < 2) throw new Error("Sheet Cost không có dữ liệu!");

  const mainSheet = ss.getSheetByName(mainSheetName);
  if (!mainSheet) throw new Error("Không tìm thấy sheet: " + mainSheetName);

  const priceMap = buildCostMapFromCostSheet(ss);
  if (Object.keys(priceMap).length === 0) {
    throw new Error("Sheet Cost không có cột 'Fulfillment cost' hoặc 'Total'!");
  }

  const baseCostColIdx = findColumnByHeader(mainSheet, BASE_COST_HEADER);
  if (baseCostColIdx === -1) throw new Error(`Không tìm thấy cột "Base Cost" trong sheet: ${mainSheetName}`);

  const res = fillColumnByOrderMap(mainSheet, ORDER_NUMBER_COL_INDEX, baseCostColIdx, priceMap, NO_COST_LABEL);
  return `Đã điền ${res.matched} đơn, ${res.noValue} đơn chưa có cost, ${res.noOrder} dòng chưa ff, ${res.skipped} đơn đã có sẵn giá trị (bỏ qua)`;
}
