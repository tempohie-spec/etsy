// Cloudflare Worker cho Merchize (dung chung cho moi store). Tu ghi thang vao Google Sheet,
// khong can mo Sheet.
//
// - POST /    : Merchize gui webhook. Kiem tra header "merchize-webhook-key", gui Telegram voi
//               su kien loi/ticket, roi ghi ngay vao Google Sheet (tim dong theo ma don).
//               Ghi loi hoac chua tim thay don thi luu KV de lich chay lai.
// - Lich (Cron Trigger, vd moi 30 phut hoac moi gio):
//     1. Chay lai cac thong bao con cho trong KV.
//     2. Tra API tracking cho don 30 ngay gan nhat chua co tracking -> dien tracking, ma RX, cost.
//
// Bien moi truong (Settings > Variables and Secrets, loai Secret):
//   SECRET_KEYS             Secret key webhook cua cac store, cach nhau dau phay
//   TELEGRAM_BOT_TOKEN      Token bot Telegram
//   TELEGRAM_CHAT_ID        Chat ID nhan tin
//   GOOGLE_SERVICE_ACCOUNT  Toan bo noi dung file JSON khoa Service Account
//   SPREADSHEET_ID          ID cua Google Sheet (doan giua /d/ va /edit trong link)
//   STORES                  JSON: {"<ten tab>": {"baseUrl": "https://...merchize.com/<store>/bo-api", "token": "<Access Token>"}}
// KV binding: EVENTS

const LUU_TOI_DA_GIAY = 30 * 24 * 3600;
const SO_NGAY_CAP_NHAT = 30;
// Goi Free cua Cloudflare cho toi da 50 request ra ngoai moi lan chay -> chua lai vai request.
const GIOI_HAN_REQUEST = 45;

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
  'TR', 'UA', 'GB', 'VA']);

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
    } catch (e) { /* khong co Intl.DisplayNames - chi dung bang bi danh */ }
  }
  return bangQuocGia[key] || '';
}

function ngayTuO(v) {
  const m = str(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
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

async function sheetsFetch(env, dem, path, opts = {}) {
  const token = await layGoogleToken(env, dem);
  const res = await goi(dem, `https://sheets.googleapis.com/v4/spreadsheets/${env.SPREADSHEET_ID}${path}`, {
    ...opts,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
  });
  if (!res.ok) throw new Error(`Sheets API lỗi ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

function docCauHinhStores(env) {
  try { return JSON.parse(env.STORES || '{}') || {}; } catch (e) { throw new Error('Biến STORES không phải JSON hợp lệ.'); }
}

// Doc A:AG cua moi tab trong STORES -> { tenTab: rows }.
async function docCacTab(env, dem, tabs) {
  if (tabs.length === 0) return {};
  const q = tabs.map((t) => 'ranges=' + encodeURIComponent(`'${t}'!A1:AG`)).join('&');
  const data = await sheetsFetch(env, dem, `/values:batchGet?${q}&valueRenderOption=FORMATTED_VALUE`);
  const kq = {};
  tabs.forEach((t, i) => { kq[t] = ((data.valueRanges || [])[i] || {}).values || []; });
  return kq;
}

// Bo ghi: gom cac o can ghi, dong thoi sua ngay trong bo nho de cac buoc sau thay gia tri moi.
function taoBoGhi(duLieu) {
  const text = new Map();
  const so = new Map();
  return {
    text,
    so,
    dat(tab, rowNumber, col, value, laSo) {
      const range = `'${tab}'!${TEN_COT[col]}${rowNumber}`;
      (laSo ? so : text).set(range, value);
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
async function ghiLo(env, dem, valueInputOption, data, biKhoa) {
  let conLai = data;
  for (let lan = 0; lan < 8 && conLai.length; lan++) {
    try {
      await sheetsFetch(env, dem, '/values:batchUpdate', {
        method: 'POST', body: JSON.stringify({ valueInputOption, data: conLai })
      });
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
  const doi = (m) => Array.from(m.entries()).map(([range, v]) => ({ range, values: [[v]] }));
  const biKhoa = [];
  // RAW cho chu (tracking dai khong bi doi thanh so), USER_ENTERED cho cost (de la so).
  if (boGhi.text.size) await ghiLo(env, dem, 'RAW', doi(boGhi.text), biKhoa);
  if (boGhi.so.size) await ghiLo(env, dem, 'USER_ENTERED', doi(boGhi.so), biKhoa);
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
  const tim = [];
  Object.keys(duLieu).forEach((t) => {
    duLieu[t].forEach((row, i) => {
      if (i === 0) return;
      if (co.cacRx) {
        if (co.cacRx.includes(cell(row, COL.merchizeId))) tim.push({ t, rowNumber: i + 1, row });
        return;
      }
      if (!ma || cell(row, COL.orderNumber) !== ma) return;
      if (idf && idf !== t && idf !== cell(row, COL.account)) return;
      tim.push({ t, rowNumber: i + 1, row });
    });
  });
  // Ticket cua don chua co ma RX trong Sheet: da bao Telegram, khong cho nua.
  if (tim.length === 0) return co.cacRx ? 'boQua' : 'chuaThay';

  const dongDau = {};
  tim.forEach(({ t, rowNumber, row }) => {
    if (co.status && !(cell(row, COL.status) === STATUS_OLD && co.status === 'Có tracking')) {
      boGhi.dat(t, rowNumber, COL.status, co.status);
    }
    if (co.maRx) boGhi.dat(t, rowNumber, COL.merchizeId, co.maRx);
    if (co.tracking) {
      boGhi.dat(t, rowNumber, COL.tracking, co.tracking);
      boGhi.dat(t, rowNumber, COL.carrier, co.carrier);
      boGhi.tieuDe(t, COL.tracking, 'Tracking');
      boGhi.tieuDe(t, COL.carrier, 'Hãng vận chuyển');
    }
    if (co.ticket) {
      boGhi.dat(t, rowNumber, COL.ticket, co.ticket);
      boGhi.tieuDe(t, COL.ticket, 'Ticket');
    }
    if (dongDau[t] === undefined || rowNumber < dongDau[t]) dongDau[t] = rowNumber;
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
    const duLieu = await docCacTab(env, dem, Object.keys(stores));
    const boGhi = taoBoGhi(duLieu);
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
  const cacKey = str(env.SECRET_KEYS).split(',').map(str).filter(Boolean);
  if (!cacKey.includes(key)) return json({ ok: false, error: 'invalid key' }, 401);
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
function apDungKetQuaApi(tab, dong, kq, boGhi) {
  const kqGhi = { tracking: false, cost: false };
  if (!kq.coGoi) return kqGhi;
  const r0 = dong[0].row;
  let cost = kq.cost;
  if (NUOC_THUE_CHAU_AU.has(maQuocGia(cell(r0, COL.country)))) cost += THUE_NHAP_KHAU_CHAU_AU;
  cost = Math.round(cost * 100) / 100;
  dong.forEach(({ rowNumber, row }) => {
    if (kq.maRx && cell(row, COL.merchizeId) !== kq.maRx) boGhi.dat(tab, rowNumber, COL.merchizeId, kq.maRx);
    if (kq.tracking.length) {
      boGhi.dat(tab, rowNumber, COL.tracking, kq.tracking.join(', '));
      boGhi.dat(tab, rowNumber, COL.carrier, kq.carrier.join(', '));
      if (cell(row, COL.status) !== STATUS_OLD) boGhi.dat(tab, rowNumber, COL.status, 'Có tracking');
      boGhi.tieuDe(tab, COL.tracking, 'Tracking');
      boGhi.tieuDe(tab, COL.carrier, 'Hãng vận chuyển');
    }
  });
  kqGhi.tracking = kq.tracking.length > 0;
  if (cost > 0 && Number(cell(r0, COL.baseCost).replace(/[^0-9.\-]/g, '')) !== cost) {
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

// Don can tra: Date Fulfill trong 30 ngay, chua co tracking, khong phai "Loi import".
function donCanTra(rows) {
  const moc = new Date();
  moc.setDate(moc.getDate() - SO_NGAY_CAP_NHAT);
  const map = new Map();
  rows.forEach((row, i) => {
    const ma = cell(row, COL.orderNumber);
    if (i === 0 || !ma || cell(row, COL.tracking)) return;
    if (/^Lỗi import/.test(cell(row, COL.status))) return;
    const ngay = ngayTuO(cell(row, COL.dateFulfill));
    if (!ngay || ngay < moc) return;
    if (!map.has(ma)) map.set(ma, []);
    map.get(ma).push({ rowNumber: i + 1, row });
  });
  return Array.from(map.entries());
}

async function chayLich(env, event) {
  const dem = taoBoDem();
  const thongKe = { tracking: [], cost: [], cho: 0, daTra: 0 };
  const ghiNhan = (ma, kq) => {
    thongKe.daTra++;
    if (kq.tracking) thongKe.tracking.push(ma);
    if (kq.cost) thongKe.cost.push(ma);
  };
  const stores = docCauHinhStores(env);
  const tabs = Object.keys(stores);
  const duLieu = await docCacTab(env, dem, tabs);
  const boGhi = taoBoGhi(duLieu);

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

  // 2. Tra API tracking. Don da co ma RX: gop 50 don/1 request. Don chua co ma RX: tra tung don,
  //    trong gioi han request con lai, xoay vong theo gio de lan luot tra het.
  const donLe = [];
  for (const tab of tabs) {
    const store = stores[tab];
    if (!store || !store.baseUrl || !store.token) continue;
    const ds = donCanTra(duLieu[tab] || []);
    const coRx = ds.filter(([, dong]) => /^[A-Z]{2}-\d+-\d+$/.test(cell(dong[0].row, COL.merchizeId)));
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
          ghiNhan(cell(dong[0].row, COL.orderNumber), apDungKetQuaApi(tab, dong, tomTatApiTracking(cua), boGhi));
        });
      } catch (e) { /* loi tam thoi, lan sau tra lai */ }
    }
    chuaRx.forEach(([ma, dong]) => donLe.push({ tab, store, ma, dong }));
  }
  const conLai = Math.max(0, GIOI_HAN_REQUEST - 4 - dem.n);
  if (donLe.length && conLai) {
    // Moi lan chay tiep noi vi tri lan truoc (luu KV), dat lich 30 phut hay 1 gio deu tra lan luot het.
    const viTri = Number(await env.EVENTS.get('cron:vitri')) || 0;
    const batDau = viTri % donLe.length;
    await env.EVENTS.put('cron:vitri', String(batDau + Math.min(conLai, donLe.length)));
    for (let i = 0; i < Math.min(conLai, donLe.length); i++) {
      const { tab, store, ma, dong } = donLe[(batDau + i) % donLe.length];
      try {
        const goiHang = await merchizeFetch(dem, store, 'GET', '/order/external/orders/tracking?external_number=' + encodeURIComponent(ma));
        ghiNhan(ma, apDungKetQuaApi(tab, dong, tomTatApiTracking(goiHang), boGhi));
      } catch (e) { /* bo qua, lan sau tra lai */ }
    }
  }

  await ghiSheet(env, dem, boGhi);
  await Promise.all(daXong.map((k) => env.EVENTS.delete(k)));

  // Chi nhan Telegram khi co cap nhat moi, tranh 48 tin/ngay.
  if (thongKe.tracking.length || thongKe.cost.length || thongKe.cho) {
    const luc = (event && event.scheduledTime) || Date.now();
    const tiep = lanChayTiep(event && event.cron, luc);
    const ds = (arr) => arr.slice(0, 15).join(', ') + (arr.length > 15 ? ` ... (+${arr.length - 15})` : '');
    await guiTelegram(env, dem, [
      `🔄 Cập nhật tự động lúc ${gioVN(luc)}`,
      thongKe.tracking.length ? `Tracking mới: ${thongKe.tracking.length} đơn (${ds(thongKe.tracking)})` : '',
      thongKe.cost.length ? `Cost thật: ${thongKe.cost.length} đơn (${ds(thongKe.cost)})` : '',
      thongKe.cho ? `Ghi bù thông báo chờ: ${thongKe.cho}` : '',
      `Đã tra ${thongKe.daTra} đơn.` + (tiep ? ` Lần chạy tiếp theo: ${tiep}` : '')
    ].filter(Boolean).join('\n'));
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/') return nhanWebhook(request, env, ctx);
    if (request.method === 'GET' && url.pathname === '/') return json({ ok: true, service: 'merchize-webhook' });
    return json({ ok: false, error: 'not found' }, 404);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(chayLich(env, event).catch((e) => baoLoiHeThong(env, taoBoDem(), 'Lịch chạy lỗi: ' + e.message)));
  }
};
