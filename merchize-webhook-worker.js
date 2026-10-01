// Cloudflare Worker cho Merchize (dung chung cho moi store). Tu ghi thang vao Google Sheet,
// khong can mo Sheet.
//
// - POST /    : Merchize gui webhook. Kiem tra header "merchize-webhook-key", gui Telegram voi
//               su kien loi/ticket, roi ghi ngay vao Google Sheet (tim dong theo ma don).
//               Ghi loi hoac chua tim thay don thi luu KV de lich chay lai.
// - Lich (Cron Trigger, vd moi 30 phut hoac moi gio):
//     1. Chay lai cac thong bao con cho trong KV.
//     2. Tra API tracking cho don 10 ngay gan nhat chua co tracking -> dien tracking, ma RX, cost.
//     4. Don Merchize "Request update" (can xu ly, tao trong 10 ngay): ghi AC "Can xu ly: <note>" + Telegram 1 lan.
//     3. Don di Teb (AC = "Teb"): lay tracking + DVVC + Total (base cost) tu sheet Teb (bien TEB).
// - GET /run?key=<1 trong SECRET_KEYS>: chay lich ngay lap tuc.
// - GET/POST /config?key=<1 trong SECRET_KEYS>: userscript gui store + sheet Teb cua tung tab (luu KV
//   "cfg", ghi de len bien STORES / TEB), khong can sua bien tren Cloudflare khi them account.
// - GET /telegram-setup?key=<1 trong SECRET_KEYS>: cai 1 lan de tra loi bot ("xong") tat nhac don
//   can xu ly; POST /telegram nhan tin nhan tu Telegram.
//
// Bien moi truong (Settings > Variables and Secrets, loai Secret):
//   SECRET_KEYS             Secret key webhook cua cac store, cach nhau dau phay
//   TELEGRAM_BOT_TOKEN      Token bot Telegram
//   TELEGRAM_CHAT_ID        Chat ID nhan tin
//   GOOGLE_SERVICE_ACCOUNT  Toan bo noi dung file JSON khoa Service Account
//   SPREADSHEET_ID          ID cua Google Sheet (doan giua /d/ va /edit trong link)
//   STORES                  JSON: {"<ten tab>": {"baseUrl": "https://...merchize.com/<store>/bo-api", "token": "<Access Token>"}}
//                           Tab nam o file Sheet khac: them "spreadsheetId": "<ID file>" (va "sheet": "<ten tab
//                           that trong file>" neu ten muc khac ten tab), file do phai share cho service account.
//   TEB (tuy chon)          JSON: {"<ten tab>": {"spreadsheetId": "<ID file Teb>", "sheet": "<ten tab trong file Teb>"}}
// KV binding: EVENTS

const LUU_TOI_DA_GIAY = 30 * 24 * 3600;
const SO_NGAY_CAP_NHAT = 10;
// Goi Free cua Cloudflare cho toi da 50 request ra ngoai moi lan chay -> chua lai vai request.
const GIOI_HAN_REQUEST = 45;
// Canh bao khi so du store duoi muc nay (USD).
const NGUONG_SO_DU = 50;

// Vi tri cot (0-based) - giong userscript merchize-order-sender.user.js.
const COL = {
  account: 1, orderNumber: 2, country: 19, dateFulfill: 22, baseCost: 24,
  status: 28, merchizeId: 29, tracking: 30, carrier: 31, ticket: 32
};
const TEN_COT = { 24: 'Y', 28: 'AC', 29: 'AD', 30: 'AE', 31: 'AF', 32: 'AG' };
const STATUS_OLD = 'Cũ';

// Thue nhap khau 3.5$ moi kien tu kho US toi 50 nuoc chau Au (tu 26/06/2026).
const THUE_NHAP_KHAU_CHAU_AU = 3.5;
const NUOC_THUE_CHAU_AU = new Set(['AL', 'AD', 'AM', 'AT', 'AZ', 'BY', 'BE', 'BA', 'BG', 'HR', 'CY', 'CZ',
  'DK', 'EE', 'FI', 'FR', 'GE', 'DE', 'GR', 'HU', 'IS', 'IE', 'IT', 'KZ', 'XK', 'LV', 'LI', 'LT', 'LU',
  'MT', 'MD', 'MC', 'ME', 'NL', 'MK', 'NO', 'PL', 'PT', 'RO', 'SM', 'RS', 'SK', 'SI', 'ES', 'SE', 'CH',
  'TR', 'UA', 'VA']);
  // UK (GB) co trong thong bao cua Merchize nhung thuc te khong bi thu (da doi chieu 4 don UK) -> bo ra.

const SU_KIEN_TELEGRAM = new Set(['ORDER.INVALID.ADDRESS', 'ORDER.ISSUE.UPDATED']);

const MO_TA_LOI_DIA_CHI = {
  invalid: 'địa chỉ không hợp lệ',
  inactive: 'địa chỉ không còn hoạt động',
  missing_secondary: 'thiếu số căn hộ/phòng',
  street_undefined: 'không xác định được tên đường',
  vacant: 'địa chỉ bỏ trống',
  zipcode_undefined: 'không xác định được ZIP code',
  spelling: 'sai chính tả địa chỉ'
};

// ============ HAM DUNG CHUNG ============
function str(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function cell(row, idx) {
  return str((row || [])[idx]);
}

function loaiSuKien(ev) {
  // Tai lieu ghi "event_type" nhung simulator cua Merchize gui "event".
  return str(ev.event_type || ev.event).toUpperCase();
}

const BI_DANH_QUOC_GIA = {
  'usa': 'US', 'united states': 'US', 'united states of america': 'US', 'uk': 'GB', 'united kingdom': 'GB',
  'england': 'GB', 'scotland': 'GB', 'wales': 'GB', 'great britain': 'GB', 'turkey': 'TR', 'türkiye': 'TR',
  'russia': 'RU', 'south korea': 'KR', 'czech republic': 'CZ', 'czechia': 'CZ', 'netherlands': 'NL',
  'the netherlands': 'NL', 'germany': 'DE', 'france': 'FR', 'italy': 'IT', 'spain': 'ES', 'canada': 'CA',
  'australia': 'AU', 'ireland': 'IE', 'switzerland': 'CH', 'norway': 'NO', 'sweden': 'SE', 'denmark': 'DK'
};
let bangQuocGia = null;
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
    } catch (e) { /* khong co Intl.DisplayNames - chi dung bang bi danh */ }
  }
  return bangQuocGia[key] || '';
}

// Nua dem hom nay theo gio Viet Nam, cung he quy chieu voi ngayTuO().
function homNayVN() {
  const d = new Date(Date.now() + 7 * 3600000);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function ngayTuO(v) {
  const m = str(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
}

// Ma don, tracking, hang van chuyen, ticket chi ghi o DONG DAU cua don (don nhieu dong); cac dong
// sau neu dang co gia tri (ghi tu ban cu) thi xoa di.
function datDongDau(boGhi, tab, rowNumber, row, laDongDau, col, value) {
  if (laDongDau) boGhi.dat(tab, rowNumber, col, value);
  else if (cell(row, col)) boGhi.dat(tab, rowNumber, col, '');
}

// Dem so request ra ngoai trong 1 lan chay de khong vuot gioi han cua Cloudflare.
function taoBoDem() {
  return { n: 0 };
}

async function goi(dem, url, opts) {
  dem.n++;
  return fetch(url, opts);
}

// ============ TELEGRAM ============
function noiDungTicket(ev) {
  const r = ev.resource || {};
  const msg = r.last_message || {};
  const dong = [
    `💬 ${ev.test ? '[TEST] ' : ''}Ticket cập nhật: ${r.ticket_status || '?'}`,
    `Đơn Merchize: ${(r.orders || []).join(', ') || '?'}`
  ];
  if ((r.category || []).length) dong.push(`Vấn đề: ${r.category.join(', ')}`);
  if (r.prefer_solution) dong.push(`Hướng xử lý: ${r.prefer_solution}`);
  const noiDung = str(msg.body_text || msg.body);
  if (noiDung) dong.push(`Tin nhắn mới nhất: ${noiDung.slice(0, 1000)}`);
  return dong.join('\n');
}

function noiDungTelegram(ev) {
  if (loaiSuKien(ev) === 'ORDER.ISSUE.UPDATED') return noiDungTicket(ev);
  const r = ev.resource || {};
  const dong = [
    `⚠️ ${ev.test ? '[TEST] ' : ''}${loaiSuKien(ev)}`,
    `Account: ${r.identifier || '?'}`,
    `Đơn Etsy: ${r.external_number || '?'}`,
    `Mã Merchize: ${r.code || r.order_code || '?'}`
  ];
  if (r.type_invalid) dong.push(`Lỗi: ${MO_TA_LOI_DIA_CHI[r.type_invalid] || r.type_invalid}`);
  if (r.message_invalid) dong.push(`Chi tiết: ${r.message_invalid}`);
  if (r.error) dong.push(`Lỗi: ${r.error}`);
  return dong.join('\n');
}

function canGuiTelegram(ev) {
  const t = loaiSuKien(ev);
  return SU_KIEN_TELEGRAM.has(t) || t.includes('INVALID') || t.includes('ERROR');
}

async function guiTelegram(env, dem, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  await goi(dem, `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text })
  });
}

// Bao loi he thong (ghi Sheet that bai...) qua Telegram, toi da 1 lan moi gio.
async function baoLoiHeThong(env, dem, text) {
  if (await env.EVENTS.get('alert:recent')) return;
  await env.EVENTS.put('alert:recent', '1', { expirationTtl: 3600 });
  await guiTelegram(env, dem, '❗ merchize-webhook: ' + text.slice(0, 1500));
}

// ============ GOOGLE SHEETS (Service Account) ============
function b64url(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Token Google song 1 gio, luu KV 55 phut de khong phai ky lai moi lan.
async function layGoogleToken(env, dem) {
  const cache = await env.EVENTS.get('gtoken');
  if (cache) return cache;
  if (!env.GOOGLE_SERVICE_ACCOUNT) throw new Error('Chưa khai báo GOOGLE_SERVICE_ACCOUNT.');
  const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT);
  const now = Math.floor(Date.now() / 1000);
  const dauVao = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const chuKy = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(dauVao));
  const res = await goi(dem, 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + dauVao + '.' + b64url(chuKy)
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Đăng nhập Google (Service Account) lỗi: ' + JSON.stringify(data).slice(0, 300));
  await env.EVENTS.put('gtoken', data.access_token, { expirationTtl: 3300 });
  return data.access_token;
}

async function sheetsFetch(env, dem, path, opts = {}, spreadsheetId = env.SPREADSHEET_ID) {
  const token = await layGoogleToken(env, dem);
  const res = await goi(dem, `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}${path}`, {
    ...opts,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
  });
  if (!res.ok) throw new Error(`Sheets API lỗi ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

function docCauHinhStores(env) {
  try { return JSON.parse(env.STORES || '{}') || {}; } catch (e) { throw new Error('Biến STORES không phải JSON hợp lệ.'); }
}

// Vi tri that cua moi muc trong STORES: file (spreadsheetId, mac dinh SPREADSHEET_ID) va ten tab
// trong file do (sheet, mac dinh chinh la ten muc). Nho vay 1 Worker phuc vu duoc nhieu file Sheet.
function viTriTab(env, stores) {
  const vt = {};
  Object.keys(stores).forEach((k) => {
    const st = stores[k] || {};
    vt[k] = { id: str(st.spreadsheetId) || env.SPREADSHEET_ID, sheet: str(st.sheet) || k };
  });
  return vt;
}

// Doc A:AG cua moi muc trong STORES -> { tenMuc: rows }. Gom theo file, moi file 1 request.
// File nao doc loi (chua share cho service account...) thi bao Telegram va coi nhu rong.
async function docCacTab(env, dem, viTri) {
  const kq = {};
  const theoFile = {};
  Object.keys(viTri).forEach((k) => { (theoFile[viTri[k].id] = theoFile[viTri[k].id] || []).push(k); });
  for (const id of Object.keys(theoFile)) {
    const keys = theoFile[id];
    const q = keys.map((k) => 'ranges=' + encodeURIComponent(`'${viTri[k].sheet}'!A1:AG`)).join('&');
    try {
      const data = await sheetsFetch(env, dem, `/values:batchGet?${q}&valueRenderOption=FORMATTED_VALUE`, {}, id);
      keys.forEach((k, i) => { kq[k] = ((data.valueRanges || [])[i] || {}).values || []; });
    } catch (e) {
      keys.forEach((k) => { kq[k] = []; });
      await baoLoiHeThong(env, dem, `Không đọc được file Sheet ${id} (${keys.join(', ')}): ${e.message}`).catch(() => {});
    }
  }
  return kq;
}

// Bo ghi: gom cac o can ghi (theo file), dong thoi sua ngay trong bo nho de cac buoc sau thay gia
// tri moi.
function taoBoGhi(duLieu, viTri) {
  const text = new Map();
  const so = new Map();
  return {
    text,
    so,
    dat(tab, rowNumber, col, value, laSo) {
      const vt = viTri[tab];
      const range = `'${vt.sheet}'!${TEN_COT[col]}${rowNumber}`;
      (laSo ? so : text).set(vt.id + '|' + range, { id: vt.id, range, value });
      const rows = duLieu[tab];
      if (!rows[rowNumber - 1]) rows[rowNumber - 1] = [];
      rows[rowNumber - 1][col] = String(value);
    },
    tieuDe(tab, col, value) {
      const rows = duLieu[tab];
      if (!cell(rows[0], col)) this.dat(tab, 1, col, value, false);
    },
    soLuong() { return text.size + so.size; }
  };
}

// Ghi 1 lo. O bi khoa (Protected range) thi bo o do ra roi ghi lai phan con lai, toi da 8 lan.
async function ghiLo(env, dem, valueInputOption, data, biKhoa, spreadsheetId) {
  let conLai = data;
  for (let lan = 0; lan < 8 && conLai.length; lan++) {
    try {
      await sheetsFetch(env, dem, '/values:batchUpdate', {
        method: 'POST', body: JSON.stringify({ valueInputOption, data: conLai })
      }, spreadsheetId);
      return;
    } catch (e) {
      const m = String(e.message).match(/Invalid data\[(\d+)\][^"]*protected/i);
      if (!m || !conLai[Number(m[1])]) throw e;
      biKhoa.push(conLai[Number(m[1])].range);
      conLai = conLai.filter((_, i) => i !== Number(m[1]));
    }
  }
}

async function ghiSheet(env, dem, boGhi) {
  // Gom theo file: { id: [{ range, values }] }.
  const theoFile = (m) => {
    const g = {};
    m.forEach(({ id, range, value }) => { (g[id] = g[id] || []).push({ range, values: [[value]] }); });
    return g;
  };
  const biKhoa = [];
  // RAW cho chu (tracking dai khong bi doi thanh so), USER_ENTERED cho cost (de la so).
  const text = theoFile(boGhi.text);
  const so = theoFile(boGhi.so);
  for (const id of Object.keys(text)) await ghiLo(env, dem, 'RAW', text[id], biKhoa, id);
  for (const id of Object.keys(so)) await ghiLo(env, dem, 'USER_ENTERED', so[id], biKhoa, id);
  if (biKhoa.length) {
    await baoLoiHeThong(env, dem, `Không ghi được ${biKhoa.length} ô vì đang bị khoá (Protected range): ` +
      biKhoa.slice(0, 10).join(', ') + '. Thêm email service account vào quyền sửa của vùng bảo vệ đó.').catch(() => {});
  }
}

// ============ AP DUNG 1 THONG BAO WEBHOOK VAO SHEET ============
// Tu 1 thong bao -> nhung gi can ghi. null = loai su kien khong xu ly.
function noiDungTuSuKien(ev) {
  const r = ev.resource || {};
  const loai = loaiSuKien(ev);
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
  } else if (loai === 'ORDER.PAYMENT.FULFILLMENT_COST') {
    const gia = Number(r.price);
    if (!isNaN(gia) && str(r.price) !== '') co.cost = gia;
  } else if (loai === 'ORDER.REQUEST.DONE') {
    // Nguoi dung bao "xong" qua bot Telegram.
    co.status = 'Đã xử lý request';
  } else if (loai === 'ORDER.REQUIRE.ATTENTION') {
    // Tu tao trong lich chay (khong phai webhook): don Merchize can xu ly (Request update).
    co.status = `Cần xử lý: ${str(r.note) || 'xem trên Merchize'}`;
  } else if (loai === 'ORDER.ISSUE.UPDATED') {
    const msg = r.last_message || {};
    const noiDung = str(msg.body_text || msg.body).replace(/\s+/g, ' ').slice(0, 300);
    co.maRx = '';
    co.cacRx = (r.orders || []).map(str).filter(Boolean);
    co.ticket = `${str(r.ticket_status) || '?'}${(r.category || []).length ? ' [' + r.category.join(', ') + ']' : ''}` +
      (noiDung ? ': ' + noiDung : '');
  } else {
    return null;
  }
  return co;
}

// Tra ve 'xong' (da ghi / khong can ghi), 'chuaThay' (chua co don trong Sheet) hoac 'boQua'.
function apDungSuKien(ev, duLieu, boGhi) {
  const co = noiDungTuSuKien(ev);
  if (!co) return 'boQua';
  const r = ev.resource || {};
  const ma = str(r.external_number);
  const idf = str(r.identifier);
  // Khop DUNG ma don (hau to nhu "a" do nguoi dung tu cap nhat trong Sheet cho khop Merchize).
  const tim = [];
  Object.keys(duLieu).forEach((t) => {
    duLieu[t].forEach((row, i) => {
      if (i === 0) return;
      if (co.cacRx) {
        if (co.cacRx.includes(cell(row, COL.merchizeId))) tim.push({ t, rowNumber: i + 1, row });
        return;
      }
      const maDong = cell(row, COL.orderNumber);
      if (!ma || !maDong) return;
      if (idf && idf !== t && idf !== cell(row, COL.account)) return;
      if (maDong === ma) tim.push({ t, rowNumber: i + 1, row });
    });
  });
  // Ticket cua don chua co ma RX trong Sheet: da bao Telegram, khong cho nua.
  if (tim.length === 0) return co.cacRx ? 'boQua' : 'chuaThay';

  const dongDau = {};
  tim.forEach(({ t, rowNumber }) => {
    if (dongDau[t] === undefined || rowNumber < dongDau[t]) dongDau[t] = rowNumber;
  });
  tim.forEach(({ t, rowNumber, row }) => {
    const dau = rowNumber === dongDau[t];
    if (co.status && !(cell(row, COL.status) === STATUS_OLD && co.status === 'Có tracking')) {
      boGhi.dat(t, rowNumber, COL.status, co.status);
    }
    if (co.maRx) datDongDau(boGhi, t, rowNumber, row, dau, COL.merchizeId, co.maRx);
    if (co.tracking) {
      datDongDau(boGhi, t, rowNumber, row, dau, COL.tracking, co.tracking);
      datDongDau(boGhi, t, rowNumber, row, dau, COL.carrier, co.carrier);
      boGhi.tieuDe(t, COL.tracking, 'Tracking');
      boGhi.tieuDe(t, COL.carrier, 'Hãng vận chuyển');
    }
    if (co.ticket) {
      datDongDau(boGhi, t, rowNumber, row, dau, COL.ticket, co.ticket);
      boGhi.tieuDe(t, COL.ticket, 'Ticket');
    }
  });
  if (typeof co.cost === 'number') {
    Object.keys(dongDau).forEach((t) => {
      boGhi.dat(t, dongDau[t], COL.baseCost, Math.round(co.cost * 100) / 100, true);
    });
  }
  return 'xong';
}

// ============ NHAN WEBHOOK ============
async function xuLyNgay(env, ev) {
  const dem = taoBoDem();
  try {
    if (canGuiTelegram(ev)) await guiTelegram(env, dem, noiDungTelegram(ev));
    if (!noiDungTuSuKien(ev)) return;
    const stores = docCauHinhStores(env);
    const viTri = viTriTab(env, stores);
    const duLieu = await docCacTab(env, dem, viTri);
    const boGhi = taoBoGhi(duLieu, viTri);
    const kq = apDungSuKien(ev, duLieu, boGhi);
    await ghiSheet(env, dem, boGhi);
    if (kq === 'chuaThay') await luuCho(env, ev);
  } catch (e) {
    await luuCho(env, ev);
    await baoLoiHeThong(env, dem, 'Ghi Google Sheet thất bại, sẽ thử lại theo lịch. ' + e.message).catch(() => {});
  }
}

async function luuCho(env, ev) {
  const id = str(ev.event_id) || crypto.randomUUID();
  await env.EVENTS.put('ev:' + id, JSON.stringify({ id, received: new Date().toISOString(), ...ev }),
    { expirationTtl: LUU_TOI_DA_GIAY });
}

async function nhanWebhook(request, env, ctx) {
  const key = request.headers.get('merchize-webhook-key') || '';
  const cacKey = str(env.SECRET_KEYS).split(',').map(str).filter(Boolean).concat(env.WEBHOOK_KEYS || []);
  if (!key || !cacKey.includes(key)) return json({ ok: false, error: 'invalid key' }, 401);
  let ev;
  try {
    ev = await request.json();
  } catch (e) {
    return json({ ok: false, error: 'invalid json' }, 400);
  }
  // Tra 200 ngay de Merchize khong gui lai, phan ghi Sheet chay nen.
  ctx.waitUntil(xuLyNgay(env, ev));
  return json({ ok: true });
}

// ============ LICH CHAY (CRON) ============
// Tu ket qua API tracking -> { maRx, tracking[], carrier[], cost } (cost chua gom thue chau Au).
function tomTatApiTracking(goiHang) {
  const kq = { maRx: '', tracking: [], carrier: [], cost: 0, coGoi: goiHang.length > 0 };
  goiHang.forEach((g) => {
    if (!kq.maRx && g.name) kq.maRx = str(g.name).replace(/-F\d+$/i, '');
    if (str(g.tracking_number)) {
      kq.tracking.push(str(g.tracking_number));
      if (str(g.tracking_company) && !kq.carrier.includes(str(g.tracking_company))) kq.carrier.push(str(g.tracking_company));
    }
    kq.cost += Number(g.shipping_cost) || 0;
    (g.items || []).forEach((it) => {
      kq.cost += (Number(it.fulfillment_cost) || 0) * (Number(it.quantity) || 1) - (Number(it.ffm_discount_amount) || 0);
    });
  });
  return kq;
}

// Tra ve { tracking, cost }: co ghi tracking moi / cost moi hay khong (de bao cao).
// API tra theo ma don (external_number) nen tin ket qua; ma RX/tracking chi ghi o dong dau.
function apDungKetQuaApi(tab, dong, kq, boGhi) {
  const kqGhi = { tracking: false, cost: false };
  if (!kq.coGoi) return kqGhi;
  const r0 = dong[0].row;
  let cost = kq.cost;
  if (NUOC_THUE_CHAU_AU.has(maQuocGia(cell(r0, COL.country)))) cost += THUE_NHAP_KHAU_CHAU_AU;
  cost = Math.round(cost * 100) / 100;
  dong.forEach(({ rowNumber, row }, i) => {
    const dau = i === 0;
    if (kq.maRx && (!dau || cell(row, COL.merchizeId) !== kq.maRx)) {
      datDongDau(boGhi, tab, rowNumber, row, dau, COL.merchizeId, kq.maRx);
    }
    if (kq.tracking.length) {
      datDongDau(boGhi, tab, rowNumber, row, dau, COL.tracking, kq.tracking.join(', '));
      datDongDau(boGhi, tab, rowNumber, row, dau, COL.carrier, kq.carrier.join(', '));
      if (cell(row, COL.status) !== STATUS_OLD) boGhi.dat(tab, rowNumber, COL.status, 'Có tracking');
      boGhi.tieuDe(tab, COL.tracking, 'Tracking');
      boGhi.tieuDe(tab, COL.carrier, 'Hãng vận chuyển');
    }
  });
  kqGhi.tracking = kq.tracking.length > 0;
  // Chi dien khi o Y dang trong: thue chau Au khong phai don nao cung bi thu (vd don UK), nen
  // khong ghi de so da co (cost that tu file import / webhook fulfillment cost).
  if (cost > 0 && !cell(r0, COL.baseCost)) {
    boGhi.dat(tab, dong[0].rowNumber, COL.baseCost, cost, true);
    kqGhi.cost = true;
  }
  return kqGhi;
}

// Gio Viet Nam (UTC+7) dang HH:MM.
function gioVN(ms) {
  const d = new Date(ms + 7 * 3600000);
  return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
}

// Lan chay tiep theo tu bieu thuc cron dang "*/N * * * *" hoac "0 * * * *". Khong doan duoc thi ''.
function lanChayTiep(cron, luc) {
  const m = str(cron).match(/^\*\/(\d+) \* \* \* \*$/);
  const phut = m ? Number(m[1]) : /^0 \* \* \* \*$/.test(str(cron)) ? 60 : 0;
  if (!phut) return '';
  const buoc = phut * 60000;
  return gioVN(Math.floor(luc / buoc) * buoc + buoc);
}

// GET API noi bo cua trang seller Merchize, tra ve data nguyen ban (object hoac mang).
async function merchizeGetRaw(dem, store, path) {
  const res = await goi(dem, store.baseUrl.replace(/\/+$/, '') + path, {
    headers: { Authorization: 'Bearer ' + store.token }
  });
  const data = await res.json().catch(() => null);
  if (!data || !data.success) throw new Error(`Merchize ${res.status}: ${(data && data.message) || 'lỗi'}`);
  return data.data;
}

// Bo tham so giong trang Orders cua Merchize, loc don "Request update" (can nguoi ban xu ly).
const QUERY_CAN_XU_LY = 'artwork_status=&external_number=&fulfillment_created_at_from=&fulfillment_created_at_to=' +
  '&fulfillment_status=&isOrderIssues=false&isPersonalized=&isRequireAttention=false&isTapShippedOrder=false' +
  '&limit=100&order_issue_type=issue_request_update&order_status=&page=1&paid_at_from=&paid_at_to=' +
  '&payment_status=&push_to_fulfillment_progress=&shipment_status=&shipped_at_from=&shipped_at_to=' +
  '&tracking_status=&validate_shipping_address=';
// 100 don moi nhat cua store (khong loc), de lay ma RX theo ma don Etsy.
const QUERY_DON_MOI = QUERY_CAN_XU_LY.replace('order_issue_type=issue_request_update', 'order_issue_type=');

async function merchizeFetch(dem, store, method, path, body) {
  const res = await goi(dem, store.baseUrl.replace(/\/+$/, '') + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + store.token },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => null);
  if (!data || !data.success) throw new Error(`Merchize ${res.status}: ${(data && data.message) || 'lỗi'}`);
  return Array.isArray(data.data) ? data.data : [];
}

// Don can tra: Date Fulfill (dong dau) trong SO_NGAY_CAP_NHAT ngay, chua dong nao co tracking,
// khong phai "Loi import". Gom du cac dong cua don truoc roi moi loc (tracking chi o dong dau).
function donCanTra(rows) {
  const moc = new Date();
  moc.setDate(moc.getDate() - SO_NGAY_CAP_NHAT);
  const map = new Map();
  rows.forEach((row, i) => {
    const ma = cell(row, COL.orderNumber);
    if (i === 0 || !ma) return;
    if (!map.has(ma)) map.set(ma, []);
    map.get(ma).push({ rowNumber: i + 1, row });
  });
  return Array.from(map.entries()).filter(([, dong]) => {
    if (dong.some(({ row }) => cell(row, COL.tracking))) return false;
    // Don loi (chua gui duoc / loi import) va don di Teb khong co tren Merchize.
    if (dong.some(({ row }) => /^Lỗi/.test(cell(row, COL.status)) || cell(row, COL.status) === 'Teb')) return false;
    const ngay = ngayTuO(cell(dong[0].row, COL.dateFulfill));
    return ngay && ngay >= moc;
  });
}

async function chayLich(env, event) {
  const dem = taoBoDem();
  const thongKe = { tracking: [], cost: [], cho: 0, daTra: 0, teb: [], tebCost: [], canXuLy: [] };
  // Moi muc thong ke: { tab, ma } (canXuLy them note) de tin Telegram ghi ro don nao cua tab nao.
  const daTraMa = new Set();
  const ghiNhan = (tab, ma, kq) => {
    thongKe.daTra++;
    daTraMa.add(tab + '|' + ma);
    if (kq.tracking) thongKe.tracking.push({ tab, ma });
    if (kq.cost) thongKe.cost.push({ tab, ma });
  };
  const stores = docCauHinhStores(env);
  const tabs = Object.keys(stores);
  const viTri = viTriTab(env, stores);
  const duLieu = await docCacTab(env, dem, viTri);
  const boGhi = taoBoGhi(duLieu, viTri);

  // 1. Chay lai cac thong bao con cho.
  const list = await env.EVENTS.list({ prefix: 'ev:' });
  const daXong = [];
  for (const k of list.keys) {
    const v = await env.EVENTS.get(k.name);
    if (!v) continue;
    let ev;
    try { ev = JSON.parse(v); } catch (e) { daXong.push(k.name); continue; }
    const kqSk = apDungSuKien(ev, duLieu, boGhi);
    if (kqSk !== 'chuaThay') daXong.push(k.name);
    if (kqSk === 'xong') thongKe.cho++;
  }

  // 3 (lam truoc de chac chan con request). Don Teb: doc sheet Teb theo ORDER CODE (cot B) ->
  //    TRACKING (T), DVVC (U) ghi vao AE/AF, Total (AA) ghi vao Base Cost (Y). Chi ghi dong dau
  //    cua don va chi khi gia tri khac hien tai.
  // Tinh trang doc sheet Teb, tra ve trong ket qua /run de biet vi sao khong co cap nhat.
  const tebInfo = {};
  let cauHinhTeb = {};
  if (!env.TEB) tebInfo.loi = 'chưa khai báo biến TEB';
  try {
    cauHinhTeb = JSON.parse(env.TEB || '{}') || {};
  } catch (e) {
    tebInfo.loi = 'biến TEB không phải JSON hợp lệ';
    await baoLoiHeThong(env, dem, 'Biến TEB không phải JSON hợp lệ.').catch(() => {});
  }
  const soTien = (v) => {
    const t = str(v).replace(/[^0-9.\-]/g, '');
    return t === '' || isNaN(Number(t)) ? null : Math.round(Number(t) * 100) / 100;
  };
  for (const tab of Object.keys(cauHinhTeb)) {
    const cfg = cauHinhTeb[tab];
    const rows = duLieu[tab];
    if (!rows) {
      tebInfo[tab] = 'tab không có trong STORES';
      await baoLoiHeThong(env, dem, `Tab "${tab}" trong biến TEB không có trong STORES.`).catch(() => {});
      continue;
    }
    if (!cfg || !cfg.spreadsheetId || !cfg.sheet) {
      tebInfo[tab] = 'thiếu spreadsheetId hoặc sheet';
      await baoLoiHeThong(env, dem, `Biến TEB của tab "${tab}" thiếu spreadsheetId hoặc sheet.`).catch(() => {});
      continue;
    }
    // Nhan don Teb theo ma don co trong sheet Teb (ca don cu tao bang Apps Script, AC = "Cu"/trong).
    // Chi xet don co Date Fulfill (dong dau) trong SO_NGAY_CAP_NHAT ngay.
    const moc = new Date();
    moc.setDate(moc.getDate() - SO_NGAY_CAP_NHAT);
    const tatCaDon = new Map();
    rows.forEach((row, i) => {
      const ma = cell(row, COL.orderNumber);
      if (i === 0 || !ma) return;
      if (!tatCaDon.has(ma)) tatCaDon.set(ma, []);
      tatCaDon.get(ma).push({ rowNumber: i + 1, row });
    });
    // Don co trong sheet Teb la don Teb, ke ca AC dang "Da gui" (gui truoc khi co phan Teb).
    const canTeb = new Map();
    tatCaDon.forEach((dong, ma) => {
      const ngay = ngayTuO(cell(dong[0].row, COL.dateFulfill));
      if (!ngay || ngay < moc) return;
      canTeb.set(ma, dong);
    });
    if (!canTeb.size) {
      tebInfo[tab] = `không có đơn nào trong ${SO_NGAY_CAP_NHAT} ngày gần nhất`;
      continue;
    }
    try {
      const data = await sheetsFetch(env, dem,
        `/values/${encodeURIComponent(`'${cfg.sheet}'!A:AA`)}?valueRenderOption=FORMATTED_VALUE`, {}, cfg.spreadsheetId);
      // Khop dung ma don.
      const theoMa = {};
      (data.values || []).forEach((r) => {
        const ma = cell(r, 1);
        if (ma) theoMa[ma] = { tracking: cell(r, 19), dvvc: cell(r, 20), total: soTien(r[26]) };
      });
      const timTeb = (ma) => theoMa[ma];
      tebInfo[tab] = {
        soDongSheetTeb: (data.values || []).length,
        khopMaDon: Array.from(canTeb.keys()).filter((m) => timTeb(m)).length,
        viDuMaSheetTeb: Object.keys(theoMa).slice(-3)
      };
      canTeb.forEach((dong, ma) => {
        const tk = timTeb(ma);
        if (!tk) return;
        const { rowNumber, row } = dong[0];
        dong.forEach(({ rowNumber: rn, row: r }) => {
          if (cell(r, COL.status) !== 'Teb') boGhi.dat(tab, rn, COL.status, 'Teb');
        });
        if (tk.tracking && !dong.some(({ row: r }) => cell(r, COL.tracking))) {
          boGhi.dat(tab, rowNumber, COL.tracking, tk.tracking);
          boGhi.dat(tab, rowNumber, COL.carrier, tk.dvvc);
          boGhi.tieuDe(tab, COL.tracking, 'Tracking');
          boGhi.tieuDe(tab, COL.carrier, 'Hãng vận chuyển');
          thongKe.teb.push({ tab, ma });
        }
        // Ghi de ca chu "chua co cost" / "chua ff" do script Import Cost dien (don Teb khong co tren Merchize).
        if (tk.total !== null && tk.total > 0 && soTien(cell(row, COL.baseCost)) !== tk.total) {
          boGhi.dat(tab, rowNumber, COL.baseCost, tk.total, true);
          thongKe.tebCost.push({ tab, ma });
        }
      });
    } catch (e) {
      tebInfo[tab] = 'lỗi đọc sheet Teb: ' + e.message.slice(0, 200);
      await baoLoiHeThong(env, dem, `Không đọc được sheet Teb của tab "${tab}": ${e.message}`).catch(() => {});
    }
  }

  // 4. Don Merchize can xu ly (Request update): statistic-issues (1 request/store) -> neu co thi
  //    search/v3 lay danh sach -> yeu cau MOI thi lay note (require-attention), ghi AC + Telegram.
  //    Moi yeu cau chi bao 1 lan (KV "att:<id>", giu 30 ngay).
  for (const tab of tabs) {
    const store = stores[tab];
    if (!store || !store.baseUrl || !store.token) continue;
    try {
      const thongKeLoi = await merchizeGetRaw(dem, store, '/order/orders/statistic-issues?' + QUERY_CAN_XU_LY);
      const muc = (Array.isArray(thongKeLoi) ? thongKeLoi : []).find((x) => x.key === 'issue_request_update');
      if (!muc || !Number(muc.total)) continue;
      const kq = await merchizeGetRaw(dem, store, '/order/orders/search/v3?' + QUERY_CAN_XU_LY);
      for (const o of (kq && kq.orders) || []) {
        if (o.order_request_attention_status && o.order_request_attention_status !== 'open') continue;
        // Chi xet don tao trong SO_NGAY_CAP_NHAT ngay gan nhat.
        const taoLuc = Date.parse(o.created || o.paid_at || '');
        if (!isNaN(taoLuc) && taoLuc < Date.now() - SO_NGAY_CAP_NHAT * 86400000) continue;
        const maEtsy = str(o.external_order_number || (o.external_order_id || {}).id);
        const khoa = 'att:' + ((o.order_request_attentions || []).join(',') || o._id);
        // Nguoi dung da bao "xong" qua bot Telegram cho dung yeu cau nay -> khong nhac nua.
        if (await env.EVENTS.get('done:' + khoa)) {
          if (maEtsy && (await env.EVENTS.get('donema:' + maEtsy))) await env.EVENTS.delete('donema:' + maEtsy);
          continue;
        }
        // Bao "xong" truoc khi lich kip luu attma (vd ngay sau khi deploy): tat yeu cau dang mo nay.
        if (maEtsy && (await env.EVENTS.get('donema:' + maEtsy))) {
          await env.EVENTS.put('done:' + khoa, '1', { expirationTtl: LUU_TOI_DA_GIAY });
          await env.EVENTS.delete('donema:' + maEtsy);
          apDungSuKien({ event_type: 'ORDER.REQUEST.DONE', resource: { external_number: maEtsy } }, duLieu, boGhi);
          continue;
        }
        // Ma don -> yeu cau dang mo, de lenh "xong <ma don>" tren Telegram biet tat yeu cau nao.
        const lienKet = JSON.stringify({ khoa, tab });
        if (maEtsy && (await env.EVENTS.get('attma:' + maEtsy)) !== lienKet) {
          await env.EVENTS.put('attma:' + maEtsy, lienKet, { expirationTtl: LUU_TOI_DA_GIAY });
        }
        // KV luu lai note de cac lan sau van hien noi dung ma khong goi lai API.
        const daBao = await env.EVENTS.get(khoa);
        if (daBao) {
          let noteCu = '';
          try { noteCu = JSON.parse(daBao).note || ''; } catch (e) { /* ban luu cu chi co "1" */ }
          thongKe.canXuLy.push({ tab, ma: maEtsy || str(o.code), note: noteCu });
          continue;
        }
        if (dem.n >= GIOI_HAN_REQUEST - 6 - tabs.length) break;
        const dsYeuCau = await merchizeGetRaw(dem, store, `/order/orders/${o._id}/require-attention?status=open&limit=50`);
        const note = (Array.isArray(dsYeuCau) ? dsYeuCau : []).map((x) => str(x.note)).filter(Boolean).join(' | ');
        thongKe.canXuLy.push({ tab, ma: maEtsy || str(o.code), note });
        apDungSuKien({
          event_type: 'ORDER.REQUIRE.ATTENTION',
          resource: { external_number: maEtsy, code: str(o.code), note }
        }, duLieu, boGhi);
        await guiTelegram(env, dem, [
          '🛑 Đơn cần xử lý trên Merchize',
          `Tab: ${tab}`,
          `Đơn Etsy: ${maEtsy || '?'}`,
          `Mã Merchize: ${str(o.code) || '?'}`,
          `Nội dung: ${note || 'xem trên Merchize'}`,
          'Xử lý xong thì trả lời (reply) tin này: xong'
        ].join('\n'));
        await env.EVENTS.put(khoa, JSON.stringify({ note }), { expirationTtl: LUU_TOI_DA_GIAY });
      }
    } catch (e) { /* loi tam thoi, lan sau kiem tra lai */ }
  }

  // 2. Tra API tracking. Don da co ma RX: gop 50 don/1 request. Don chua co ma RX: tra tung don,
  //    trong gioi han request con lai, xoay vong theo gio de lan luot tra het.
  const donLe = [];
  let tongCanTra = 0;
  const tatCaCanTra = [];
  for (const tab of tabs) {
    const store = stores[tab];
    if (!store || !store.baseUrl || !store.token) continue;
    const ds = donCanTra(duLieu[tab] || []);
    tongCanTra += ds.length;
    tatCaCanTra.push(...ds.map(([ma, dong]) => ({ tab, ma, r0: dong[0].row })));
    const laRx = (v) => /^[A-Z]{2}-\d+-\d+$/.test(v);
    // Don chua co ma RX (AD trong): 1 request search/v3 lay 100 don moi nhat cua store -> ma RX theo ma
    // don Etsy, ghi luon vao AD de tra tracking theo lo 50 don thay vi tra tung don.
    if (ds.some(([, dong]) => !laRx(cell(dong[0].row, COL.merchizeId))) && dem.n < GIOI_HAN_REQUEST - 10) {
      try {
        const kq = await merchizeGetRaw(dem, store, '/order/orders/search/v3?' + QUERY_DON_MOI);
        const rxTheoMa = {};
        ((kq && kq.orders) || []).forEach((o) => {
          const ma = str(o.external_order_number || (o.external_order_id || {}).id);
          if (ma && laRx(str(o.code))) rxTheoMa[ma] = str(o.code);
        });
        ds.forEach(([ma, dong]) => {
          const r0 = dong[0].row;
          if (laRx(cell(r0, COL.merchizeId)) || !rxTheoMa[ma]) return;
          boGhi.dat(tab, dong[0].rowNumber, COL.merchizeId, rxTheoMa[ma]);
          r0[COL.merchizeId] = rxTheoMa[ma];
        });
      } catch (e) { /* loi tam thoi, tra tung don nhu cu */ }
    }
    const coRx = ds.filter(([, dong]) => laRx(cell(dong[0].row, COL.merchizeId)));
    const chuaRx = ds.filter((d) => !coRx.includes(d));
    for (let i = 0; i < coRx.length && dem.n < GIOI_HAN_REQUEST - 4; i += 50) {
      const phan = coRx.slice(i, i + 50);
      try {
        const goiHang = await merchizeFetch(dem, store, 'POST', '/order/external/orders/list-orders-tracking', {
          orders: phan.map(([, dong]) => ({ code: cell(dong[0].row, COL.merchizeId), external_number: '', identifier: '' }))
        });
        phan.forEach(([, dong]) => {
          const rx = cell(dong[0].row, COL.merchizeId);
          const cua = goiHang.filter((g) => str(g.name).replace(/-F\d+$/i, '') === rx);
          ghiNhan(tab, cell(dong[0].row, COL.orderNumber), apDungKetQuaApi(tab, dong, tomTatApiTracking(cua), boGhi));
        });
      } catch (e) { /* loi tam thoi, lan sau tra lai */ }
    }
    // Don fulfill hom nay (gio VN) chua the co tracking -> khong ton request tra tung don.
    chuaRx.forEach(([ma, dong]) => {
      const ngay = ngayTuO(cell(dong[0].row, COL.dateFulfill));
      if (ngay && ngay >= homNayVN()) return;
      donLe.push({ tab, store, ma, dong, ngay: ngay ? ngay.getTime() : 0 });
    });
  }
  // Chua lai request cho: ghi Sheet (2), Telegram (1), so du moi store (1/store).
  // Don cu hon truoc (de co tracking hon), roi xoay vong tiep noi lan truoc.
  donLe.sort((a, b) => a.ngay - b.ngay);
  // So du luu KV 1 gio (chi luu so lay duoc): store nao da co thi khong goi lai; store loi (vd 403)
  // thi lan chay sau goi lai ngay, khong phai doi het 1 gio.
  let soDuCu = {};
  let lucSoDu = Date.now();
  try {
    const v = JSON.parse((await env.EVENTS.get('sodu')) || 'null');
    if (v && v.luc && Date.now() - v.luc < 3600000) { soDuCu = v.giaTri || {}; lucSoDu = v.luc; }
  } catch (e) { /* ban luu cu, lay lai */ }
  const canLaySoDu = tabs.filter((t) => typeof soDuCu[t] !== 'number');
  const conLai = Math.max(0, GIOI_HAN_REQUEST - 4 - canLaySoDu.length - dem.n);
  if (donLe.length && conLai) {
    // Moi lan chay tiep noi vi tri lan truoc (luu KV), dat lich 30 phut hay 1 gio deu tra lan luot het.
    const viTri = Number(await env.EVENTS.get('cron:vitri')) || 0;
    const batDau = viTri % donLe.length;
    const lanNay = [];
    for (let i = 0; i < Math.min(conLai, donLe.length); i++) lanNay.push(donLe[(batDau + i) % donLe.length]);
    // Han muc request dat truoc (an toan khi chay song song): het han muc thi dung, khong vuot 50.
    let hanMuc = conLai;
    const layHanMuc = () => (hanMuc > 0 ? (hanMuc--, true) : false);
    let daXet = 0;
    const traMotDon = async ({ tab, store, ma, dong }) => {
      if (!layHanMuc()) return;
      daXet++;
      try {
        const url = (m) => '/order/external/orders/tracking?external_number=' + encodeURIComponent(m);
        const goiHang = await merchizeFetch(dem, store, 'GET', url(ma));
        ghiNhan(tab, ma, apDungKetQuaApi(tab, dong, tomTatApiTracking(goiHang), boGhi));
      } catch (e) { /* bo qua, lan sau tra lai */ }
    };
    // Goi song song 6 don/lan (gioi han ket noi dong thoi cua Cloudflare) cho nhanh.
    for (let i = 0; i < lanNay.length && hanMuc > 0; i += 6) await Promise.all(lanNay.slice(i, i + 6).map(traMotDon));
    // Lan sau tiep noi dung sau don cuoi cung da xet.
    await env.EVENTS.put('cron:vitri', String(batDau + daXet));
  }

  await ghiSheet(env, dem, boGhi);
  await Promise.all(daXong.map((k) => env.EVENTS.delete(k)));

  // Nhan Telegram sau MOI lan chay, ke ca khi khong co gi moi.
  const conThieu = Math.max(0, tongCanTra - thongKe.tracking.length);
  // Cho /run: tung don con thieu tracking (AC, AD, lan nay co tra khong) de xem vi sao.
  const coTracking = new Set(thongKe.tracking.map((x) => x.tab + '|' + x.ma));
  const donThieu = tatCaCanTra.filter((x) => !coTracking.has(x.tab + '|' + x.ma)).slice(0, 80).map((x) => ({
    tab: x.tab, ma: x.ma, ngay: cell(x.r0, COL.dateFulfill), AC: cell(x.r0, COL.status), AD: cell(x.r0, COL.merchizeId),
    lanNayDaTra: daTraMa.has(x.tab + '|' + x.ma)
  }));

  // So du tung store: API noi bo cua trang seller Merchize (GET /billing/balance -> data.amount).
  const soDu = { ...soDuCu };
  if (canLaySoDu.length) {
    await Promise.all(canLaySoDu.map(async (tab) => {
      const store = stores[tab];
      if (!store || !store.baseUrl || !store.token) return;
      try {
        const res = await goi(dem, store.baseUrl.replace(/\/+$/, '') + '/billing/balance', {
          headers: { Authorization: 'Bearer ' + store.token }
        });
        const data = await res.json().catch(() => null);
        const amount = data && data.success && data.data ? Number(data.data.amount) : NaN;
        soDu[tab] = isNaN(amount) ? `lỗi ${res.status}` : Math.round(amount * 100) / 100;
      } catch (e) {
        soDu[tab] = 'lỗi kết nối';
      }
    }));
    // Chi luu so lay duoc; store loi se duoc lay lai o lan chay sau.
    const giaTri = {};
    Object.keys(soDu).forEach((t) => { if (typeof soDu[t] === 'number') giaTri[t] = soDu[t]; });
    if (Object.keys(giaTri).length) {
      await env.EVENTS.put('sodu', JSON.stringify({ luc: lucSoDu, giaTri }), { expirationTtl: 3600 });
    }
  }
  const dongSoDu = Object.keys(soDu).map((tab) => {
    const v = soDu[tab];
    if (typeof v !== 'number') return `• ${tab}: không lấy được (${v})`;
    return `• ${tab}: $${v.toFixed(2)}${v < NGUONG_SO_DU ? ' ⚠️ sắp hết' : ''}`;
  });
  const luc = (event && event.scheduledTime) || Date.now();
  const tiep = lanChayTiep(event && event.cron, luc);
  // Nhom theo tab: "  • <tab>: ma1, ma2 ..." (toi da 15 ma moi tab).
  const theoTab = (arr) => {
    const nhom = {};
    arr.forEach(({ tab, ma }) => { (nhom[tab] = nhom[tab] || []).push(ma); });
    return Object.keys(nhom).map((t) => {
      const m = nhom[t];
      return `  • ${t}: ${m.slice(0, 15).join(', ')}${m.length > 15 ? ` ... (+${m.length - 15})` : ''}`;
    }).join('\n');
  };
  const muc = (tieuDe, arr) => (arr.length ? `${tieuDe}: ${arr.length} đơn\n${theoTab(arr)}` : '');
  const coMoi = thongKe.tracking.length || thongKe.cost.length || thongKe.cho || thongKe.teb.length || thongKe.tebCost.length ||
    thongKe.canXuLy.length;
  await guiTelegram(env, dem, [
    `🔄 Cập nhật tự động lúc ${gioVN(luc)}`,
    muc('Tracking mới', thongKe.tracking),
    muc('Tracking Teb mới', thongKe.teb),
    muc('Cost thật', thongKe.cost),
    muc('Cost Teb', thongKe.tebCost),
    thongKe.canXuLy.length ? `🛑 Đơn cần xử lý trên Merchize: ${thongKe.canXuLy.length}\n` +
      thongKe.canXuLy.map((x) => `  • ${x.tab} | ${x.ma}: ${x.note || 'xem trên Merchize'}`).join('\n') : '',
    thongKe.cho ? `Ghi bù thông báo chờ: ${thongKe.cho}` : '',
    coMoi ? '' : 'Không có giá trị mới để điền.',
    `Đã tra ${thongKe.daTra} đơn, còn ${conThieu} đơn thiếu tracking.` + (tiep ? ` Lần chạy tiếp theo: ${tiep}` : ''),
    dongSoDu.length ? 'Số dư:\n' + dongSoDu.join('\n') : ''
  ].filter(Boolean).join('\n'));

  return {
    tracking: thongKe.tracking, cost: thongKe.cost,
    ghiBuThongBaoCho: thongKe.cho, daTra: thongKe.daTra, trackingTeb: thongKe.teb, costTeb: thongKe.tebCost, canXuLy: thongKe.canXuLy, teb: tebInfo, conThieuTracking: conThieu, donThieu, soDu
  };
}


// ============ CAU HINH TU USERSCRIPT (KV "cfg") ============
// Userscript gui store / sheet Teb cua tung tab len day (POST /config), khoi sua bien STORES, TEB
// tren Cloudflare. KV ghi de len muc cung ten trong bien; gia tri null = xoa muc do.
async function docCfgKv(env) {
  try { return JSON.parse((await env.EVENTS.get('cfg')) || '{}') || {}; } catch (e) { return {}; }
}

async function napCauHinh(env) {
  const kv = await docCfgKv(env);
  const gop = (bien, them) => {
    let goc = {};
    try { goc = JSON.parse(env[bien] || '{}') || {}; } catch (e) { return env[bien]; }
    const kq = { ...goc, ...(them || {}) };
    Object.keys(kq).forEach((k) => { if (!kq[k]) delete kq[k]; });
    return JSON.stringify(kq);
  };
  const e2 = Object.create(env);
  e2.STORES = gop('STORES', kv.stores);
  if (env.TEB || Object.keys(kv.teb || {}).length) e2.TEB = gop('TEB', kv.teb);
  // Secret key webhook rieng cua tung store (nhap tren userscript), dung them voi SECRET_KEYS.
  e2.WEBHOOK_KEYS = Object.values(kv.webhookKeys || {}).map(str).filter(Boolean);
  return e2;
}

function emailServiceAccount(env) {
  try { return JSON.parse(env.GOOGLE_SERVICE_ACCOUNT).client_email || ''; } catch (e) { return ''; }
}

// Thu doc 1 o de biet service account co vao duoc file khong.
async function thuQuyen(env, dem, spreadsheetId, sheet) {
  try {
    await sheetsFetch(env, dem, `/values/${encodeURIComponent(`'${sheet}'!A1`)}`, {}, spreadsheetId);
    return 'ok';
  } catch (e) {
    return /\b403\b|PERMISSION/.test(e.message) ? 'chưa share' : e.message.slice(0, 200);
  }
}

async function xuLyConfig(request, env) {
  const dem = taoBoDem();
  const envGop = await napCauHinh(env);
  const stores = docCauHinhStores(envGop);
  let teb = {};
  try { teb = JSON.parse(envGop.TEB || '{}') || {}; } catch (e) { /* bien TEB sai, bo qua */ }
  const viTri = viTriTab(env, stores);
  const kv = await docCfgKv(env);
  if (request.method === 'GET') {
    const ds = {};
    Object.keys(stores).forEach((k) => {
      ds[k] = { baseUrl: str(stores[k].baseUrl), coToken: !!str(stores[k].token), coWebhookKey: !!(kv.webhookKeys || {})[k], spreadsheetId: viTri[k].id, sheet: viTri[k].sheet, teb: teb[k] || null };
    });
    return json({ ok: true, serviceAccount: emailServiceAccount(env), stores: ds });
  }
  const body = await request.json().catch(() => null);
  const spreadsheetId = str(body && body.spreadsheetId);
  const sheet = str(body && body.sheet);
  if (!spreadsheetId || !sheet) return json({ ok: false, error: 'thiếu spreadsheetId / sheet' }, 400);
  // Ten muc: muc dang tro toi dung file + tab nay; chua co thi dung ten tab (trung ten tab o file
  // khac thi them duoi ma file).
  let khoa = Object.keys(viTri).find((k) => viTri[k].id === spreadsheetId && viTri[k].sheet === sheet);
  if (!khoa) khoa = stores[sheet] ? `${sheet} (${spreadsheetId.slice(0, 6)})` : sheet;
  kv.stores = kv.stores || {};
  kv.teb = kv.teb || {};
  kv.webhookKeys = kv.webhookKeys || {};
  const ketQua = { ok: true, khoa, serviceAccount: emailServiceAccount(env) };
  if (body.store === null) {
    kv.stores[khoa] = null;
    kv.teb[khoa] = null;
    delete kv.webhookKeys[khoa];
  } else if (body.store) {
    const cu = stores[khoa] || {};
    const token = str(body.store.token) || str(cu.token);
    const baseUrl = str(body.store.baseUrl);
    if (!/^https:\/\/[a-z0-9.-]+\.merchize\.com\/[^/]+\/bo-api$/i.test(baseUrl) || !token) {
      return json({ ok: false, error: 'baseUrl hoặc token không hợp lệ' }, 400);
    }
    kv.stores[khoa] = { baseUrl, token, spreadsheetId, sheet };
    if (str(body.store.webhookKey)) kv.webhookKeys[khoa] = str(body.store.webhookKey);
    ketQua.quyenSheet = await thuQuyen(env, dem, spreadsheetId, sheet);
  }
  if (body.teb === null) {
    kv.teb[khoa] = null;
  } else if (body.teb) {
    const t = { spreadsheetId: str(body.teb.spreadsheetId), sheet: str(body.teb.sheet) };
    if (!t.spreadsheetId || !t.sheet) return json({ ok: false, error: 'thiếu thông tin sheet Teb' }, 400);
    kv.teb[khoa] = t;
    ketQua.quyenTeb = await thuQuyen(env, dem, t.spreadsheetId, t.sheet);
    if (ketQua.quyenTeb === 'ok') {
      try {
        const d = await sheetsFetch(env, dem, '?fields=properties.title', {}, t.spreadsheetId);
        ketQua.tenFileTeb = str((d.properties || {}).title);
      } catch (e) { /* khong lay duoc ten file, bo qua */ }
    }
  }
  await env.EVENTS.put('cfg', JSON.stringify(kv));
  return json(ketQua);
}

function dungKey(env, url) {
  return str(env.SECRET_KEYS).split(',').map(str).filter(Boolean).includes(url.searchParams.get('key') || '');
}

// ============ BOT TELEGRAM: bao "xong" de tat nhac don can xu ly ============
// Chuoi bi mat cho webhook Telegram, sinh tu bot token (khong can them bien moi truong).
async function bimatTelegram(env) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('mz-tg:' + str(env.TELEGRAM_BOT_TOKEN)));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}

async function traLoiTelegram(env, dem, chatId, replyTo, text) {
  await goi(dem, `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, reply_to_message_id: replyTo })
  });
}

// Lenh: tra loi tin 🛑 bang "xong", hoac "/xong 4185372830 4185372831".
async function xuLyTinTelegram(env, msg) {
  const dem = taoBoDem();
  const chatId = String((msg.chat || {}).id || '');
  if (!chatId || chatId !== str(env.TELEGRAM_CHAT_ID)) return;
  const text = str(msg.text);
  const lenhXong = /^\/?(xong|done|ok|đã xử lý|da xu ly)\b/i.test(text);
  if (/^\/(help|start)\b/i.test(text)) {
    await traLoiTelegram(env, dem, chatId, msg.message_id,
      'Tắt nhắc đơn cần xử lý: trả lời (reply) tin 🛑 bằng "xong", hoặc gõ /xong <mã đơn> (nhiều mã cách nhau dấu cách).');
    return;
  }
  if (!lenhXong) return;
  let cacMa = text.replace(/^\/?\S+/, '').split(/[\s,]+/).map(str).filter(Boolean);
  if (!cacMa.length && msg.reply_to_message) {
    const m = str(msg.reply_to_message.text).match(/Đơn Etsy:\s*(\S+)/);
    if (m) cacMa = [m[1]];
  }
  if (!cacMa.length) {
    await traLoiTelegram(env, dem, chatId, msg.message_id, 'Chưa có mã đơn. Trả lời đúng tin 🛑, hoặc gõ /xong <mã đơn>.');
    return;
  }
  const ketQua = [];
  const theoTab = {};
  for (const ma of cacMa) {
    const v = await env.EVENTS.get('attma:' + ma);
    if (!v) {
      // Chua co lien ket (lich chua chay toi don nay): ghi nho, lan chay toi se tat nhac.
      await env.EVENTS.put('donema:' + ma, '1', { expirationTtl: 3 * 86400 });
      ketQua.push(`• ${ma}: đã ghi nhận, lần cập nhật tới sẽ tắt nhắc và ghi AC`);
      continue;
    }
    const { khoa, tab } = JSON.parse(v);
    await env.EVENTS.put('done:' + khoa, '1', { expirationTtl: LUU_TOI_DA_GIAY });
    (theoTab[tab] = theoTab[tab] || []).push(ma);
    ketQua.push(`• ${ma} (${tab}): đã ghi nhận, không nhắc lại`);
  }
  // Ghi AC = "Da xu ly request" cho cac don do (chi doc cac tab lien quan).
  try {
    const stores = docCauHinhStores(env);
    const viTriTatCa = viTriTab(env, stores);
    const viTri = {};
    Object.keys(theoTab).forEach((t) => { if (viTriTatCa[t]) viTri[t] = viTriTatCa[t]; });
    if (Object.keys(viTri).length) {
      const duLieu = await docCacTab(env, dem, viTri);
      const boGhi = taoBoGhi(duLieu, viTri);
      Object.values(theoTab).flat().forEach((ma) => {
        apDungSuKien({ event_type: 'ORDER.REQUEST.DONE', resource: { external_number: ma } }, duLieu, boGhi);
      });
      await ghiSheet(env, dem, boGhi);
    }
  } catch (e) {
    ketQua.push('(Không ghi được cột AC: ' + e.message.slice(0, 150) + ')');
  }
  await traLoiTelegram(env, dem, chatId, msg.message_id, '✅ ' + ketQua.join('\n'));
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // Store / sheet Teb tung tab do userscript gui len: GET xem, POST luu (?key=<1 trong SECRET_KEYS>).
    if (url.pathname === '/config' && (request.method === 'GET' || request.method === 'POST')) {
      if (!dungKey(env, url)) return json({ ok: false, error: 'invalid key' }, 401);
      try { return await xuLyConfig(request, env); } catch (e) { return json({ ok: false, error: e.message }, 500); }
    }
    env = await napCauHinh(env);
    if (request.method === 'POST' && url.pathname === '/') return nhanWebhook(request, env, ctx);
    if (request.method === 'GET' && url.pathname === '/') return json({ ok: true, service: 'merchize-webhook' });
    // Telegram gui tin nhan cua ban toi bot ve day (sau khi mo /telegram-setup 1 lan).
    if (request.method === 'POST' && url.pathname === '/telegram') {
      if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== await bimatTelegram(env)) {
        return json({ ok: false }, 401);
      }
      const update = await request.json().catch(() => ({}));
      if (update.message) ctx.waitUntil(xuLyTinTelegram(env, update.message).catch(() => {}));
      return json({ ok: true });
    }
    // Cai dat 1 lan: /telegram-setup?key=<1 trong cac SECRET_KEYS> -> bot gui tin nhan ve Worker.
    if (request.method === 'GET' && url.pathname === '/telegram-setup') {
      const cacKey = str(env.SECRET_KEYS).split(',').map(str).filter(Boolean);
      if (!cacKey.includes(url.searchParams.get('key') || '')) return json({ ok: false, error: 'invalid key' }, 401);
      const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url.origin + '/telegram',
          secret_token: await bimatTelegram(env),
          allowed_updates: ['message']
        })
      });
      return json({ ok: true, telegram: await res.json().catch(() => null) });
    }
    // Chay lich ngay lap tuc: /run?key=<1 trong cac SECRET_KEYS>
    if (request.method === 'GET' && url.pathname === '/run') {
      const cacKey = str(env.SECRET_KEYS).split(',').map(str).filter(Boolean);
      if (!cacKey.includes(url.searchParams.get('key') || '')) return json({ ok: false, error: 'invalid key' }, 401);
      try {
        return json({ ok: true, ketQua: await chayLich(env, null) });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }
    return json({ ok: false, error: 'not found' }, 404);
  },

  async scheduled(event, env, ctx) {
    env = await napCauHinh(env);
    ctx.waitUntil(chayLich(env, event).catch((e) => baoLoiHeThong(env, taoBoDem(), 'Lịch chạy lỗi: ' + e.message)));
  }
};
