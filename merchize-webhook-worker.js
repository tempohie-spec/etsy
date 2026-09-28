// Cloudflare Worker nhan webhook tu Merchize (dung chung cho moi store).
//
// - POST /           : Merchize goi vao. Kiem tra header "merchize-webhook-key" khop 1 trong cac
//                      Secret key (bien SECRET_KEYS), luu thong bao vao KV (binding EVENTS) 30
//                      ngay, gui Telegram voi cac su kien quan trong. Luon tra 200 nhanh de
//                      Merchize khong gui lai.
// - GET  /events     : userscript tren Google Sheets lay cac thong bao chua xu ly
//                      (header "x-read-key" = bien READ_KEY).
// - POST /events/ack : userscript bao da ghi xong vao Sheet, body {"ids": [...]} -> xoa khoi KV.
//
// Bien moi truong (Settings > Variables and Secrets):
//   SECRET_KEYS        Secret key webhook cua cac store, cach nhau dau phay
//   READ_KEY           Chuoi bi mat tu dat, dan giong het vao userscript
//   TELEGRAM_BOT_TOKEN Token bot Telegram (tu @BotFather)
//   TELEGRAM_CHAT_ID   Chat ID nhan tin nhan
// KV binding: EVENTS

const LUU_TOI_DA_GIAY = 30 * 24 * 3600;

// Su kien gui Telegram ngay. Ten su kien khac (chua biet ten chinh xac) co chu INVALID/ERROR
// cung gui, de khong bo sot loi.
const SU_KIEN_TELEGRAM = new Set(['ORDER.INVALID.ADDRESS', 'ORDER.ISSUE.UPDATED']);

const MO_TA_LOI_DIA_CHI = {
  invalid: 'Địa chỉ không hợp lệ',
  inactive: 'Địa chỉ không còn hoạt động',
  missing_secondary: 'Thiếu số căn hộ/phòng (address2)',
  street_undefined: 'Không xác định được tên đường',
  vacant: 'Địa chỉ bỏ trống (không có người ở)',
  zipcode_undefined: 'Không xác định được ZIP code',
  spelling: 'Sai chính tả địa chỉ'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function cacSecretKey(env) {
  return String(env.SECRET_KEYS || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function canGuiTelegram(eventType) {
  const t = String(eventType || '').toUpperCase();
  return SU_KIEN_TELEGRAM.has(t) || t.includes('INVALID') || t.includes('ERROR');
}

// Ticket: payload khong co ma Etsy, chi co danh sach ma RX-... cua cac don lien quan.
function noiDungTicket(ev) {
  const r = ev.resource || {};
  const msg = r.last_message || {};
  const dong = [
    `💬 Ticket cập nhật: ${r.ticket_status || '?'}`,
    `Đơn Merchize: ${(r.orders || []).join(', ') || '?'}`
  ];
  if ((r.category || []).length) dong.push(`Vấn đề: ${r.category.join(', ')}`);
  if (r.prefer_solution) dong.push(`Hướng xử lý: ${r.prefer_solution}`);
  const noiDung = String(msg.body_text || msg.body || '').trim();
  if (noiDung) dong.push(`Tin nhắn mới nhất: ${noiDung.slice(0, 1000)}`);
  return dong.join('\n');
}

function noiDungTelegram(ev) {
  if (String(ev.event_type).toUpperCase() === 'ORDER.ISSUE.UPDATED') return noiDungTicket(ev);
  const r = ev.resource || {};
  const dong = [
    `⚠️ ${ev.event_type}`,
    `Account: ${r.identifier || '?'}`,
    `Đơn Etsy: ${r.external_number || '?'}`,
    `Mã Merchize: ${r.code || '?'}`
  ];
  if (r.type_invalid) dong.push(`Lỗi: ${MO_TA_LOI_DIA_CHI[r.type_invalid] || r.type_invalid}`);
  if (r.message_invalid) dong.push(`Chi tiết: ${r.message_invalid}`);
  if (r.error) dong.push(`Lỗi: ${r.error}`);
  if (!r.type_invalid && !r.message_invalid && !r.error) dong.push(JSON.stringify(r).slice(0, 800));
  return dong.join('\n');
}

// Tra ve ket qua cua Telegram de /test-telegram hien ro loi (sai token, chua bam Start...).
async function guiTelegram(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return { ok: false, description: 'thiếu TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID' };
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text })
  });
  return res.json().catch(() => ({ ok: false, description: 'HTTP ' + res.status }));
}

// Ghi lai lan goi webhook gan nhat (ke ca bi tu choi) de /status biet Merchize co goi toi khong.
async function ghiLanGoiCuoi(env, info) {
  if (!env.EVENTS) return;
  await env.EVENTS.put('last:attempt', JSON.stringify({ time: new Date().toISOString(), ...info }));
}

async function nhanWebhook(request, env, ctx) {
  const key = request.headers.get('merchize-webhook-key') || '';
  let ev;
  try {
    ev = await request.json();
  } catch (e) {
    await ghiLanGoiCuoi(env, { ketQua: 'invalid json' });
    return json({ ok: false, error: 'invalid json' }, 400);
  }
  if (!cacSecretKey(env).includes(key)) {
    // Chi luu 4 ky tu dau cua key de doi chieu, khong luu ca key.
    await ghiLanGoiCuoi(env, {
      ketQua: 'sai secret key (401)', event_type: ev.event_type,
      keyNhanDuoc: key ? key.slice(0, 4) + '...' : '(không có header merchize-webhook-key)'
    });
    return json({ ok: false, error: 'invalid key' }, 401);
  }
  ctx.waitUntil(ghiLanGoiCuoi(env, { ketQua: 'OK', event_type: ev.event_type }).catch(() => {}));

  // Key theo event_id: Merchize gui lai cung 1 su kien thi chi ghi de, khong bi trung.
  const id = String(ev.event_id || crypto.randomUUID());
  const banGhi = { id, received: new Date().toISOString(), ...ev };
  await env.EVENTS.put('ev:' + id, JSON.stringify(banGhi), { expirationTtl: LUU_TOI_DA_GIAY });

  if (canGuiTelegram(ev.event_type)) {
    ctx.waitUntil(guiTelegram(env, noiDungTelegram(ev)).catch(() => {}));
  }
  return json({ ok: true });
}

function kiemTraReadKey(request, env) {
  return env.READ_KEY && request.headers.get('x-read-key') === env.READ_KEY;
}

async function layEvents(env) {
  const events = [];
  let cursor;
  do {
    const list = await env.EVENTS.list({ prefix: 'ev:', cursor });
    const values = await Promise.all(list.keys.map((k) => env.EVENTS.get(k.name)));
    values.forEach((v) => {
      if (!v) return;
      try { events.push(JSON.parse(v)); } catch (e) { /* bo qua ban ghi hong */ }
    });
    cursor = list.list_complete ? null : list.cursor;
  } while (cursor);
  events.sort((a, b) => String(a.event_time || a.received).localeCompare(String(b.event_time || b.received)));
  return events;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/') {
      return nhanWebhook(request, env, ctx);
    }

    if (url.pathname === '/events' && request.method === 'GET') {
      if (!kiemTraReadKey(request, env)) return json({ ok: false, error: 'invalid read key' }, 401);
      return json({ ok: true, events: await layEvents(env) });
    }

    if (url.pathname === '/events/ack' && request.method === 'POST') {
      if (!kiemTraReadKey(request, env)) return json({ ok: false, error: 'invalid read key' }, 401);
      const body = await request.json().catch(() => ({}));
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
      await Promise.all(ids.map((id) => env.EVENTS.delete('ev:' + id)));
      return json({ ok: true, deleted: ids.length });
    }

    // Kiem tra cau hinh bang trinh duyet: /status?key=READ_KEY va /test-telegram?key=READ_KEY
    if (request.method === 'GET' && (url.pathname === '/status' || url.pathname === '/test-telegram')) {
      if (!env.READ_KEY || url.searchParams.get('key') !== env.READ_KEY) {
        return json({ ok: false, error: 'thiếu hoặc sai ?key=READ_KEY' }, 401);
      }
      if (url.pathname === '/test-telegram') {
        const kq = await guiTelegram(env, '✅ Test từ merchize-webhook: Telegram đã hoạt động.');
        return json({ ok: !!kq.ok, telegram: kq.ok ? 'đã gửi' : kq.description || kq });
      }
      const coKV = !!env.EVENTS;
      const last = coKV ? await env.EVENTS.get('last:attempt') : null;
      const dsCho = coKV ? await layEvents(env) : [];
      const cho = dsCho.length;
      return json({
        ok: true,
        kvEVENTS: coKV ? 'đã gắn' : 'CHƯA gắn binding EVENTS',
        soSecretKey: cacSecretKey(env).length,
        telegram: env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID ? 'đã khai báo' : 'CHƯA khai báo',
        thongBaoDangCho: cho,
        lanGoiCuoi: last ? JSON.parse(last) : 'chưa có lần gọi nào từ Merchize',
        // 20 thong bao moi nhat: loai su kien, ma don, luc nhan (khong hien du lieu khach hang).
        danhSachCho: dsCho.slice(-20).map((e) => ({
          event_type: e.event_type,
          external_number: (e.resource || {}).external_number,
          identifier: (e.resource || {}).identifier,
          received: e.received
        }))
      });
    }

    // Mo URL bang trinh duyet de kiem tra Worker dang chay.
    if (request.method === 'GET' && url.pathname === '/') {
      return json({ ok: true, service: 'merchize-webhook' });
    }

    return json({ ok: false, error: 'not found' }, 404);
  }
};
