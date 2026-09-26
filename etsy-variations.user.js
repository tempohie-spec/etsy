// ==UserScript==
// @name         Etsy Variations Copy/Paste
// @namespace    etsy-variations
// @version      1.0
// @description  Copy khoi Variations (ten variation, ten tung option, gia, trang thai Visible) tu 1 listing Etsy va tu tao lai + dien gia sang listing moi. Du lieu luu bang GM_setValue nen dung duoc giua 2 tab; co them Xuat/Nhap JSON de mang sang trinh duyet khac.
// @match        https://www.etsy.com/your/shops/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const PHIEN_BAN = '1.0';
  const KHOA_LUU = 'etsy_variations_data_v1';
  const log = (...a) => console.log('[Etsy Variations]', ...a);
  const canhBao = (...a) => console.warn('[Etsy Variations]', ...a);

  console.log(`[Etsy Variations] v${PHIEN_BAN} da nap`);

  // ================== HAM DUNG CHUNG ==================

  const cho = (ms) => new Promise((r) => setTimeout(r, ms));

  function chuan(s) {
    return (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function dangHienThi(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none';
  }

  async function doi(hamTim, ms = 8000, buoc = 150) {
    const het = Date.now() + ms;
    while (Date.now() < het) {
      try {
        const kq = hamTim();
        if (kq) return kq;
      } catch (e) {
        /* thu lai */
      }
      await cho(buoc);
    }
    return null;
  }

  // O input cua Etsy dung React -> phai goi setter goc roi ban su kien, gan .value thuong se bi bo qua
  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function roiKhoiO(el) {
    el.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  }

  // Bam bang chuoi su kien day du (mot so nut Etsy nghe pointerdown/mousedown)
  function bam(el) {
    try {
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
    } catch (e) {
      /* noop */
    }
    const chung = { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 };
    if (typeof PointerEvent === 'function') el.dispatchEvent(new PointerEvent('pointerdown', chung));
    el.dispatchEvent(new MouseEvent('mousedown', chung));
    if (typeof el.focus === 'function') el.focus();
    if (typeof PointerEvent === 'function') el.dispatchEvent(new PointerEvent('pointerup', { ...chung, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...chung, buttons: 0 }));
    el.click();
  }

  function guiEnter(el) {
    const o = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent('keydown', o));
    el.dispatchEvent(new KeyboardEvent('keypress', o));
    el.dispatchEvent(new KeyboardEvent('keyup', o));
  }

  function hienThongBao(text, mau = '#1F2937', ms = 4000) {
    let box = document.getElementById('etsy-var-toast');
    if (!box) {
      box = document.createElement('div');
      box.id = 'etsy-var-toast';
      box.style.cssText =
        'position:fixed;bottom:24px;right:24px;z-index:2147483647;color:#fff;padding:10px 16px;' +
        'border-radius:8px;font:14px sans-serif;max-width:360px;box-shadow:0 4px 12px rgba(0,0,0,.3);white-space:pre-line';
      document.body.appendChild(box);
    }
    box.style.background = mau;
    box.textContent = text;
    box.style.display = 'block';
    clearTimeout(box._hen);
    if (ms) box._hen = setTimeout(() => (box.style.display = 'none'), ms);
  }
  const XANH = '#15803D';
  const DO = '#B91C1C';
  const VANG = '#B45309';

  function docLuu() {
    try {
      const s = typeof GM_getValue === 'function' ? GM_getValue(KHOA_LUU, '') : localStorage.getItem(KHOA_LUU);
      return s ? JSON.parse(s) : null;
    } catch (e) {
      return null;
    }
  }

  function ghiLuu(duLieu) {
    const s = JSON.stringify(duLieu);
    if (typeof GM_setValue === 'function') GM_setValue(KHOA_LUU, s);
    else localStorage.setItem(KHOA_LUU, s);
  }

  // ================== BUOC 1: DOC VARIATIONS TREN TRANG NGUON ==================

  function layCacBang() {
    return [...document.querySelectorAll('[data-testid="variations-table"]')];
  }

  function tenBang(bang) {
    return bang.querySelector('[data-id="le-variations-table"]')?.textContent.trim() || '';
  }

  function oGiaCuaDong(tr) {
    return tr.querySelector('input[data-testid="price-input"]');
  }

  function congTacCuaDong(tr) {
    return tr.querySelector('[data-clg-id="WtSwitch"] input[type="checkbox"], input.wt-switch');
  }

  function tenDong(tr) {
    return tr.querySelector('th[scope="row"]')?.textContent.trim() || '';
  }

  function docVariations() {
    return layCacBang()
      .map((bang) => {
        const luaChon = [...bang.querySelectorAll('tbody tr')]
          .map((tr) => {
            const sw = congTacCuaDong(tr);
            return {
              ten: tenDong(tr),
              gia: (oGiaCuaDong(tr)?.value || '').trim(),
              hien: sw ? sw.checked : true,
            };
          })
          .filter((o) => o.ten);
        return {
          ten: tenBang(bang),
          coGia: !!bang.querySelector('input[data-testid="price-input"]'),
          luaChon,
        };
      })
      .filter((b) => b.ten && b.luaChon.length);
  }

  function copyVariations() {
    const ds = docVariations();
    if (!ds.length) {
      hienThongBao('Không tìm thấy bảng Variations trên trang này', DO);
      return;
    }
    const thieuGia = ds.flatMap((b) => (b.coGia ? b.luaChon.filter((o) => !o.gia).map((o) => o.ten) : []));
    ghiLuu({ luc: Date.now(), variations: ds });
    log('Da luu:', ds);
    const tomTat = ds.map((b) => `${b.ten}: ${b.luaChon.length} option${b.coGia ? ' (có giá)' : ''}`).join('\n');
    if (thieuGia.length) {
      hienThongBao(`Đã copy, nhưng ${thieuGia.length} option chưa có giá:\n${thieuGia.slice(0, 5).join(', ')}`, VANG, 7000);
    } else {
      hienThongBao(`Đã copy Variations\n${tomTat}`, XANH);
    }
    capNhatPanel();
  }

  // ================== BUOC 2: TAO VARIATIONS TREN TRANG DICH ==================

  // Hop thoai dang mo tren cung (Manage variations). Khong co thi dung ca trang.
  function vungHopThoai() {
    const ds = [
      ...document.querySelectorAll(
        '[role="dialog"], [aria-modal="true"], [data-clg-id="WtDialog"], [data-clg-id="WtOverlay"], .wt-overlay--will-animate, .wt-overlay'
      ),
    ].filter((el) => dangHienThi(el) && !el.closest('#etsy-var-panel'));
    return ds[ds.length - 1] || document.body;
  }

  function cacNutHienThi(goc) {
    return [...goc.querySelectorAll('button, [role="button"], [role="menuitem"], [role="option"], a')].filter(
      (b) => dangHienThi(b) && !b.disabled && b.getAttribute('aria-disabled') !== 'true' && !b.closest('#etsy-var-panel')
    );
  }

  function timNut(goc, regex) {
    return cacNutHienThi(goc).find((b) => {
      const t = chuan(b.textContent || b.getAttribute('aria-label'));
      return t.length < 60 && regex.test(t);
    });
  }

  // Lay chu mo ta cua 1 o input: aria-label, placeholder, <label for>, aria-labelledby
  function nhanCuaO(o) {
    const phan = [o.getAttribute('aria-label'), o.getAttribute('placeholder'), o.name];
    if (o.id) {
      const lb = document.querySelector(`label[for="${CSS.escape(o.id)}"]`);
      if (lb) phan.push(lb.textContent);
    }
    const ids = (o.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
    for (const id of ids) phan.push(document.getElementById(id)?.textContent);
    const lbCha = o.closest('label');
    if (lbCha) phan.push(lbCha.textContent);
    return chuan(phan.filter(Boolean).join(' '));
  }

  function cacOTextHienThi(goc) {
    return [...goc.querySelectorAll('input:not([type]), input[type="text"], input[type="search"]')].filter(
      (o) => dangHienThi(o) && !o.disabled && !o.readOnly && !o.closest('#etsy-var-panel')
    );
  }

  function timOTenVariation(goc) {
    return cacOTextHienThi(goc).find((o) => {
      const n = nhanCuaO(o);
      return /name|variation|property/.test(n) && !/option/.test(n);
    });
  }

  function timOOption(goc) {
    return cacOTextHienThi(goc).find((o) => /option/.test(nhanCuaO(o)));
  }

  // Tim checkbox / switch theo chu cua nhan (vd "Prices vary for each Style & Size")
  function timCongTacTheoNhan(goc, regex) {
    return [...goc.querySelectorAll('input[type="checkbox"]')].find(
      (o) => !o.closest('#etsy-var-panel') && regex.test(nhanCuaO(o))
    );
  }

  function moDauHopThoaiVariations() {
    const nut = timNut(document.body, /^(manage|add) variations?$/);
    if (!nut) return false;
    bam(nut);
    return true;
  }

  async function chonTaoMoi(tenVariation) {
    const goc = vungHopThoai();

    // Kieu 1: <select> co muc "Create your own"
    const sel = [...goc.querySelectorAll('select')].find(
      (s) => dangHienThi(s) && [...s.options].some((op) => /create your own|custom/i.test(op.textContent))
    );
    if (sel) {
      const op = [...sel.options].find((x) => /create your own|custom/i.test(x.textContent));
      setNativeValue(sel, op.value);
      return true;
    }

    // Kieu 2: menu/list co nut "Create your own" (co the render ra ngoai hop thoai)
    const muc = await doi(
      () => timNut(document.body, /create (your own|a new|new)|custom (variation|property|option)|^custom$/),
      3000
    );
    if (muc) {
      bam(muc);
      return true;
    }

    // Kieu 3: o tim kiem/combobox -> go ten roi chon dong "Create ..." hoac Enter
    const cb = cacOTextHienThi(goc).find((o) => o.getAttribute('role') === 'combobox' || /search|variation/.test(nhanCuaO(o)));
    if (cb) {
      cb.focus();
      setNativeValue(cb, tenVariation);
      const dong = await doi(() => timNut(document.body, new RegExp(`(create|add).*${chuanRegex(tenVariation)}`)), 2000);
      if (dong) bam(dong);
      else guiEnter(cb);
      return true;
    }
    return false;
  }

  function chuanRegex(s) {
    return chuan(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async function themMotOption(ten) {
    const o = await doi(() => timOOption(vungHopThoai()), 4000);
    if (!o) return false;
    o.focus();
    setNativeValue(o, ten);
    await cho(80);

    // Uu tien nut "Add" canh o nhap; khong co thi Enter
    let khung = o.parentElement;
    let nutAdd = null;
    for (let i = 0; i < 4 && khung && !nutAdd; i++, khung = khung.parentElement) {
      nutAdd = timNut(khung, /^\+?\s*add$/);
    }
    if (nutAdd) bam(nutAdd);
    else guiEnter(o);

    // Thanh cong khi o nhap duoc xoa trang
    const xong = await doi(() => {
      const oMoi = timOOption(vungHopThoai());
      return oMoi && oMoi.value === '' ? true : null;
    }, 2500);
    if (xong) return true;

    // Thu lai bang Enter neu da bam Add ma chua an
    if (nutAdd) {
      guiEnter(o);
      return !!(await doi(() => (timOOption(vungHopThoai())?.value === '' ? true : null), 2000));
    }
    return false;
  }

  async function batGiaRieng(tenVariation) {
    const re = new RegExp(`price.*${chuanRegex(tenVariation)}|${chuanRegex(tenVariation)}.*price|^prices? vary`);
    const cb = timCongTacTheoNhan(vungHopThoai(), re) || timCongTacTheoNhan(document.body, re);
    if (!cb) return false;
    if (!cb.checked) bam(cb);
    return true;
  }

  async function taoMotVariation(v, loi) {
    const nutThem = await doi(() => timNut(vungHopThoai(), /^\+?\s*add (a |another )?variation$/), 6000);
    if (!nutThem) {
      loi.push(`Không thấy nút "Add a variation" (${v.ten})`);
      return false;
    }
    bam(nutThem);
    await cho(400);

    if (!(await chonTaoMoi(v.ten))) {
      loi.push(`Không chọn được "Create your own" (${v.ten})`);
      return false;
    }
    await cho(400);

    const oTen = await doi(() => timOTenVariation(vungHopThoai()), 4000);
    if (oTen && !oTen.value) {
      oTen.focus();
      setNativeValue(oTen, v.ten);
      roiKhoiO(oTen);
    } else if (!oTen) {
      canhBao('Khong thay o ten variation, co the ten da duoc dien qua combobox');
    }
    await cho(200);

    let soLoi = 0;
    for (const op of v.luaChon) {
      const ok = await themMotOption(op.ten);
      if (!ok) {
        soLoi++;
        canhBao('Khong them duoc option:', op.ten);
      }
      hienThongBao(`Đang tạo "${v.ten}": ${op.ten}`, '#1F2937', 0);
      await cho(120);
    }
    if (soLoi) loi.push(`${soLoi} option của "${v.ten}" không thêm được`);

    if (v.coGia) await batGiaRieng(v.ten);

    // Mot so giao dien co nut Done/Save cho tung variation truoc khi quay lai danh sach
    const nutXong = timNut(vungHopThoai(), /^(done|save|continue)$/);
    if (nutXong && !timNut(vungHopThoai(), /apply/)) {
      bam(nutXong);
      await cho(600);
    }
    return true;
  }

  async function taoVariations(ds) {
    const loi = [];
    if (!moDauHopThoaiVariations()) {
      return { ok: false, loi: ['Không thấy nút "Manage variations" / "Add variations"'] };
    }
    await cho(800);

    for (const v of ds) {
      const ok = await taoMotVariation(v, loi);
      if (!ok) return { ok: false, loi };
      await cho(400);
    }

    // Checkbox "Prices vary" co the nam o man hinh tong, bat lai cho chac
    for (const v of ds) if (v.coGia) await batGiaRieng(v.ten);
    await cho(300);

    const nutApDung = await doi(
      () => timNut(vungHopThoai(), /^apply( variations)?$/) || timNut(vungHopThoai(), /^(save|done)$/),
      4000
    );
    if (!nutApDung) {
      loi.push('Không thấy nút "Apply" / "Save" để lưu variations');
      return { ok: false, loi };
    }
    bam(nutApDung);

    const daCoBang = await doi(() => {
      const ten = layCacBang().map((b) => chuan(tenBang(b)));
      return ds.every((v) => ten.includes(chuan(v.ten))) ? true : null;
    }, 15000);
    if (!daCoBang) loi.push('Đã bấm Apply nhưng chưa thấy bảng Variations xuất hiện');
    return { ok: !!daCoBang, loi };
  }

  // ================== BUOC 3: DIEN GIA + VISIBLE ==================

  async function dienGiaVaHienThi(ds) {
    const bangs = layCacBang();
    let soGia = 0;
    let soAn = 0;
    const thieu = [];

    for (const v of ds) {
      const bang = bangs.find((b) => chuan(tenBang(b)) === chuan(v.ten));
      if (!bang) {
        thieu.push(`bảng "${v.ten}"`);
        continue;
      }
      const dong = [...bang.querySelectorAll('tbody tr')];
      for (const op of v.luaChon) {
        const tr = dong.find((d) => chuan(tenDong(d)) === chuan(op.ten));
        if (!tr) {
          thieu.push(op.ten);
          continue;
        }
        const oGia = oGiaCuaDong(tr);
        if (oGia && op.gia && oGia.value !== op.gia) {
          oGia.focus();
          setNativeValue(oGia, op.gia);
          roiKhoiO(oGia);
          soGia++;
          await cho(30);
        }
        const sw = congTacCuaDong(tr);
        if (sw && sw.checked !== op.hien) {
          sw.click();
          if (!op.hien) soAn++;
          await cho(30);
        }
      }
    }
    return { soGia, soAn, thieu };
  }

  function daCoDuBang(ds) {
    const ten = layCacBang().map((b) => chuan(tenBang(b)));
    return ds.every((v) => ten.includes(chuan(v.ten)));
  }

  function baoKetQuaDien(kq) {
    let msg = `Đã điền ${kq.soGia} giá, ẩn ${kq.soAn} option`;
    if (kq.thieu.length) {
      msg += `\nKhông tìm thấy: ${kq.thieu.slice(0, 6).join(', ')}${kq.thieu.length > 6 ? '...' : ''}`;
      hienThongBao(msg, VANG, 9000);
    } else {
      hienThongBao(msg + '\nKiểm tra lại rồi bấm Save/Publish', XANH, 7000);
    }
  }

  let dangChay = false;

  async function danVariations() {
    if (dangChay) return;
    const luu = docLuu();
    if (!luu?.variations?.length) {
      hienThongBao('Chưa có dữ liệu. Hãy Copy ở listing nguồn trước', DO);
      return;
    }
    dangChay = true;
    try {
      const ds = luu.variations;
      if (!daCoDuBang(ds)) {
        hienThongBao('Đang tạo Variations...', '#1F2937', 0);
        const kq = await taoVariations(ds);
        if (!kq.ok) {
          log('Loi tao variations:', kq.loi);
          hienThongBao(
            `Chưa tạo tự động được:\n${kq.loi.join('\n')}\n\nHãy tạo tay trong "Manage variations" (đúng tên variation/option), bấm Apply rồi bấm "Chỉ điền giá".`,
            DO,
            15000
          );
          return;
        }
        await cho(800);
      }
      baoKetQuaDien(await dienGiaVaHienThi(ds));
    } catch (e) {
      console.error('[Etsy Variations]', e);
      hienThongBao('Lỗi: ' + e.message, DO, 8000);
    } finally {
      dangChay = false;
    }
  }

  async function chiDienGia() {
    const luu = docLuu();
    if (!luu?.variations?.length) {
      hienThongBao('Chưa có dữ liệu. Hãy Copy ở listing nguồn trước', DO);
      return;
    }
    if (!layCacBang().length) {
      hienThongBao('Chưa có bảng Variations trên trang này', DO);
      return;
    }
    baoKetQuaDien(await dienGiaVaHienThi(luu.variations));
  }

  // ================== XUAT / NHAP JSON ==================

  function xuatJson() {
    const luu = docLuu();
    if (!luu) {
      hienThongBao('Chưa có dữ liệu để xuất', DO);
      return;
    }
    const s = JSON.stringify(luu.variations, null, 2);
    if (typeof GM_setClipboard === 'function') GM_setClipboard(s, 'text');
    else navigator.clipboard?.writeText(s);
    hienThongBao('Đã copy JSON vào Clipboard', XANH);
  }

  function nhapJson() {
    const s = prompt('Dán JSON variations:');
    if (!s) return;
    try {
      const ds = JSON.parse(s);
      const hopLe =
        Array.isArray(ds) && ds.every((v) => v && typeof v.ten === 'string' && Array.isArray(v.luaChon));
      if (!hopLe) throw new Error('Sai định dạng');
      for (const v of ds) {
        v.coGia = !!v.coGia;
        v.luaChon = v.luaChon.map((o) => ({ ten: String(o.ten), gia: String(o.gia ?? ''), hien: o.hien !== false }));
      }
      ghiLuu({ luc: Date.now(), variations: ds });
      hienThongBao('Đã nhập JSON', XANH);
      capNhatPanel();
    } catch (e) {
      hienThongBao('JSON không hợp lệ: ' + e.message, DO);
    }
  }

  // ================== GIAO DIEN ==================

  function laTrangEditor() {
    return /\/your\/shops\/[^/]+\/(tools\/)?listing-editor/.test(location.pathname);
  }

  function capNhatPanel() {
    const el = document.querySelector('#etsy-var-panel .ev-info');
    if (!el) return;
    const luu = docLuu();
    el.textContent = luu?.variations?.length
      ? luu.variations.map((v) => `${v.ten}: ${v.luaChon.length}`).join(' | ')
      : 'Chưa có dữ liệu';
  }

  function taoPanel() {
    if (document.getElementById('etsy-var-panel')) return;
    const p = document.createElement('div');
    p.id = 'etsy-var-panel';
    p.style.cssText =
      'position:fixed;left:16px;bottom:16px;z-index:2147483646;background:#fff;border:1px solid #d1d5db;' +
      'border-radius:10px;padding:10px;font:13px sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.18);width:210px';
    p.innerHTML = `
      <div class="ev-head" style="display:flex;justify-content:space-between;font-weight:bold;margin-bottom:6px;cursor:pointer">
        <span>Variations v${PHIEN_BAN}</span><span class="ev-toggle">–</span>
      </div>
      <div class="ev-body">
        <div class="ev-info" style="color:#6b7280;font-size:12px;margin-bottom:8px"></div>
      </div>`;
    const body = p.querySelector('.ev-body');
    const nut = (chu, mau, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = chu;
      b.style.cssText = `display:block;width:100%;margin-top:5px;padding:6px;border:0;border-radius:6px;color:#fff;background:${mau};cursor:pointer;font:13px sans-serif`;
      b.addEventListener('click', fn);
      body.appendChild(b);
    };
    nut('Copy variations', '#2563EB', copyVariations);
    nut('Dán variations', '#15803D', danVariations);
    nut('Chỉ điền giá', '#0F766E', chiDienGia);
    nut('Xuất JSON', '#6B7280', xuatJson);
    nut('Nhập JSON', '#6B7280', nhapJson);

    p.querySelector('.ev-head').addEventListener('click', () => {
      const an = body.style.display !== 'none';
      body.style.display = an ? 'none' : 'block';
      p.querySelector('.ev-toggle').textContent = an ? '+' : '–';
    });
    document.body.appendChild(p);
    capNhatPanel();
  }

  // Etsy la SPA -> theo doi URL de hien/an panel
  function kiemTraTrang() {
    const p = document.getElementById('etsy-var-panel');
    if (laTrangEditor()) {
      if (!p) taoPanel();
      else p.style.display = '';
    } else if (p) {
      p.style.display = 'none';
    }
  }
  kiemTraTrang();
  setInterval(kiemTraTrang, 1000);
})();
