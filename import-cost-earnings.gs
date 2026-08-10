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
//  - CHỈ điền những dòng ở TRANG TÍNH HIỆN TẠI mà CÓ mã đơn (cột C):
//      + Nếu mã đơn đó khớp với dữ liệu trong file/sheet đã import -> điền/ghi đè giá trị thật
//        (kể cả khi ô đang có sẵn text "chưa ff"/"chưa có cost" từ lần chạy trước, hoặc một
//        con số cũ khác - luôn ghi đè bằng giá trị thật mới nhất khi có).
//      + Nếu mã đơn đó KHÔNG có trong dữ liệu import -> CHỈ điền "chưa ff" khi ô đích đang
//        RỖNG. Nếu ô đích đã có sẵn giá trị khác (VD 1 cost/earnings từ trước) thì KHÔNG ghi
//        đè, giữ nguyên giá trị đó.
//    Dòng KHÔNG có mã đơn ở trang tính hiện tại -> bỏ qua hoàn toàn, không điền gì cả
//    (không điền "chưa ff" cho những dòng này).
//  - Nếu 1 orderNumber xuất hiện nhiều dòng trong sheet hiện tại -> chỉ điền dòng đầu tiên
//  - Kết thúc, báo cáo số dòng đã điền/ghi đè được giá trị thật, số dòng có mã đơn nhưng
//    không khớp import (đã điền "chưa ff"), số dòng không khớp import nhưng đã có sẵn giá
//    trị nên được giữ nguyên, và số dòng không có mã đơn (bỏ qua) trên trang
//    tính hiện tại.
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

// Chuyển 1 ô về giá trị tiền tệ dạng chuỗi số hợp lệ, hoặc "" nếu ô đó không thực sự là
// một con số tiền (VD: lỡ đọc nhầm phải cột ngày giờ do lệch cột "Fulfillment cost"/"Total").
// Trước đây hàm này chỉ strip ký tự lạ mà không kiểm tra kết quả, nên một giá trị datetime
// như "2026-08-06 10:22 +00:00" bị strip thành chuỗi số dài (giữ lại dấu "-") rồi bị Sheets
// tự làm tròn thành số khổng lồ kiểu "2520261400000700" khi ghi vào ô.
function normalizeNumericValue(val) {
  if (val === null || val === undefined || val === "") return "";
  if (Object.prototype.toString.call(val) === "[object Date]") return ""; // không phải tiền

  // Bỏ mọi ký tự không phải số/dấu chấm/dấu trừ (bỏ luôn "$", ",", v.v.)
  const stripped = String(val).replace(/[^0-9.\-]/g, "").trim();

  // Chỉ chấp nhận dạng số tiền hợp lệ: tối đa 1 dấu trừ ở đầu, tối đa 1 dấu chấm,
  // không quá 9 chữ số phần nguyên (loại bỏ chuỗi ngày/giờ bị đọc nhầm cột).
  if (!/^-?\d{1,9}(\.\d+)?$/.test(stripped)) return "";

  return stripped;
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
      Chỉ xét những dòng CÓ mã đơn ở trang tính hiện tại: mã đơn khớp với file/sheet import
      -> điền/ghi đè giá trị thật (kể cả ghi đè "chưa ff"/"chưa có cost" cũ). Mã đơn KHÔNG
      khớp -> chỉ điền "chưa ff" nếu ô đang trống, còn nếu ô đã có sẵn giá trị khác thì giữ
      nguyên, không ghi đè. Dòng KHÔNG có mã đơn thì bỏ qua hoàn toàn, không điền gì.
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
  let totalCostFilled = 0, totalCostAlready = 0, totalCostNoOrder = 0;
  let totalEarningsFilled = 0, totalEarningsAlready = 0, totalEarningsNoOrder = 0;

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
        totalCostFilled = res.filled;
        totalCostAlready = res.alreadyCorrect;
        totalCostNoOrder = res.noOrder;
        parts.push(`Cost: điền/ghi đè ${res.filled} dòng, đã đúng sẵn ${res.alreadyCorrect} dòng, ${res.noOrder} dòng có mã đơn nhưng không có trong file import (điền chưa ff), ${res.keptExisting} dòng có mã đơn không khớp import nhưng ô đã có sẵn giá trị (giữ nguyên), ${res.noOrderNumber} dòng chưa có mã đơn ở sheet đích (bỏ qua, không điền)`);
      } else {
        parts.push(`Cost: không tìm thấy cột "Base Cost" trong trang tính này, bỏ qua`);
      }
    }

    // -- Điền Earnings (cột đích dò theo header "Earnings") --
    if (Object.keys(earningsMap).length > 0) {
      if (earningsColIdx !== -1) {
        const res = fillColumnByOrderMap(activeSheet, ORDER_NUMBER_COL_INDEX, earningsColIdx, earningsMap, NO_EARNINGS_LABEL);
        totalEarningsFilled = res.filled;
        totalEarningsAlready = res.alreadyCorrect;
        totalEarningsNoOrder = res.noOrder;
        parts.push(`Earnings: điền/ghi đè ${res.filled} dòng, đã đúng sẵn ${res.alreadyCorrect} dòng, ${res.noOrder} dòng có mã đơn nhưng không có trong file import (điền chưa ff), ${res.keptExisting} dòng có mã đơn không khớp import nhưng ô đã có sẵn giá trị (giữ nguyên), ${res.noOrderNumber} dòng chưa có mã đơn ở sheet đích (bỏ qua, không điền)`);
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
    `TỔNG: Cost điền/ghi đè ${totalCostFilled} / đã đúng sẵn ${totalCostAlready} / chưa ff ${totalCostNoOrder}` +
      ` | Earnings điền/ghi đè ${totalEarningsFilled} / đã đúng sẵn ${totalEarningsAlready} / chưa ff ${totalEarningsNoOrder}`
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

// So sánh giá trị cũ (đang có trong ô) với giá trị mới (từ import) - coi là giống nhau nếu
// chuỗi (sau khi trim) trùng khớp, kể cả khi một bên là number còn bên kia là string.
function sameValue(existingValue, newValue) {
  const a = existingValue === null || existingValue === undefined ? "" : String(existingValue).trim();
  const b = newValue === null || newValue === undefined ? "" : String(newValue).trim();
  return a === b;
}

// Ô được coi là "chưa có giá trị" nếu rỗng hoặc bằng 0 (tương tự các phiên bản trước).
function isEmptyValue(val) {
  return val === "" || val === null || val === undefined || String(val).trim() === "0";
}

// ============ HÀM ĐIỀN 1 CỘT DỰA TRÊN MAP orderNumber -> giá trị ============
// - Dòng KHÔNG có mã đơn ở sheet đích -> bỏ qua hoàn toàn, không điền gì cả (noOrderNumber).
// - Dòng CÓ mã đơn ở sheet đích nhưng mã đơn đó KHÔNG có trong dữ liệu import (valueMap)
//   -> chỉ điền NO_ORDER_LABEL ("chưa ff") nếu ô đích đang RỖNG (noOrder). Nếu ô đã có sẵn
//   giá trị khác (VD 1 cost/earnings cũ) thì KHÔNG ghi đè, giữ nguyên (keptExisting).
// - Dòng có mã đơn VÀ khớp với valueMap -> điền/ghi đè giá trị thật (filled), hoặc bỏ qua
//   nếu ô đã sẵn đúng giá trị rồi (alreadyCorrect).
// - Nếu orderNumber trùng nhiều dòng trong sheet -> chỉ điền dòng đầu tiên khớp được.
function fillColumnByOrderMap(sheet, orderColIndex, targetColIndex, valueMap, noValueLabel) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { filled: 0, alreadyCorrect: 0, noOrder: 0, noOrderNumber: 0, keptExisting: 0 };

  const orderNumbers = sheet.getRange(2, orderColIndex, lastRow - 1, 1).getValues();
  const currentVals = sheet.getRange(2, targetColIndex, lastRow - 1, 1).getValues();

  const filledOrder = new Set();
  let filled = 0;
  let alreadyCorrect = 0;
  let noOrder = 0;
  let noOrderNumber = 0;
  let keptExisting = 0;
  let touched = false;

  const updates = orderNumbers.map((row, i) => {
    const orderKey = normalizeKey(row[0]);
    const existingValue = currentVals[i][0];

    if (!orderKey) {
      noOrderNumber++;
      return [existingValue];
    }

    if (valueMap[orderKey] === undefined) {
      if (sameValue(existingValue, NO_ORDER_LABEL)) {
        noOrder++;
        return [existingValue];
      }
      if (!isEmptyValue(existingValue)) {
        keptExisting++;
        return [existingValue];
      }
      noOrder++;
      touched = true;
      return [NO_ORDER_LABEL];
    }

    if (filledOrder.has(orderKey)) return [existingValue];
    filledOrder.add(orderKey);

    const newValue = valueMap[orderKey] !== "" ? valueMap[orderKey] : noValueLabel;
    if (sameValue(existingValue, newValue)) {
      alreadyCorrect++;
      return [existingValue];
    }
    filled++;
    touched = true;
    return [newValue];
  });

  if (touched) {
    sheet.getRange(2, targetColIndex, updates.length, 1).setValues(updates);
  }
  return { filled, alreadyCorrect, noOrder, noOrderNumber, keptExisting };
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
  return `Đã điền/ghi đè ${res.filled} đơn, ${res.alreadyCorrect} đơn đã đúng sẵn, ${res.noOrder} đơn không có trong sheet Cost (điền chưa ff), ${res.keptExisting} đơn không có trong sheet Cost nhưng ô đã có sẵn giá trị (giữ nguyên), ${res.noOrderNumber} dòng chưa có mã đơn (bỏ qua, không điền)`;
}
