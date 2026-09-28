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
const SU_KIEN_TELEGRAM = new Set(['ORDER.INVALID.ADDRESS']);

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

function noiDungTelegram(ev) {
  const r = ev.resource || {};
  const dong = [
    `⚠️ ${ev.event_type}`,
    `Account: ${r.identifier || '?'}`,
    `Đơn Etsy: ${r.external_number || '?'}`,
    `Mã Merchize: ${r.code || '?'}`
  ];
  if (r.type_invalid) dong.push(`Lỗi: ${MO_TA_LOI_DIA_CHI[r.type_invalid] || r.type_invalid}`);
  if (r.message_invalid) dong.push(`Chi tiết: ${r.message_invalid}`);
  if (!r.type_invalid && !r.message_invalid) dong.push(JSON.stringify(r).slice(0, 800));
  return dong.join('\n');
}

async function guiTelegram(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text })
  });
}

async function nhanWebhook(request, env, ctx) {
  const key = request.headers.get('merchize-webhook-key') || '';
  if (!cacSecretKey(env).includes(key)) return json({ ok: false, error: 'invalid key' }, 401);

  let ev;
  try {
    ev = await request.json();
  } catch (e) {
    return json({ ok: false, error: 'invalid json' }, 400);
  }

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

    // Mo URL bang trinh duyet de kiem tra Worker dang chay.
    if (request.method === 'GET' && url.pathname === '/') {
      return json({ ok: true, service: 'merchize-webhook' });
    }

    return json({ ok: false, error: 'not found' }, 404);
  }
};
