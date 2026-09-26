// ==UserScript==
// @name         Etsy Variations Copy/Paste
// @namespace    etsy-variations
// @version      1.2
// @description  Copy khoi Variations (ten variation, ten tung option, gia, trang thai Visible) tu 1 listing Etsy va tu tao lai + dien gia sang listing moi. Copy ghi ca vao Clipboard he thong nen dan duoc sang trinh duyet khac tren cung may (va luu GM_setValue de dung giua cac tab).
// @match        https://www.etsy.com/your/shops/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const PHIEN_BAN = '1.2';
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

  async function copyVariations() {
    const ds = docVariations();
    if (!ds.length) {
      hienThongBao('Không tìm thấy bảng Variations trên trang này', DO);
      return;
    }
    const thieuGia = ds.flatMap((b) => (b.coGia ? b.luaChon.filter((o) => !o.gia).map((o) => o.ten) : []));
    ghiLuu({ luc: Date.now(), variations: ds });
    const daGhiClipboard = await ghiClipboard(taoChuoiClipboard(ds));
    log('Da luu:', ds, 'clipboard:', daGhiClipboard);
    const tomTat = ds.map((b) => `${b.ten}: ${b.luaChon.length} option${b.coGia ? ' (có giá)' : ''}`).join('\n');
    if (thieuGia.length) {
      hienThongBao(`Đã copy, nhưng ${thieuGia.length} option chưa có giá:\n${thieuGia.slice(0, 5).join(', ')}`, VANG, 7000);
    } else {
      hienThongBao(
        `Đã copy Variations${daGhiClipboard ? ' (cả vào Clipboard)' : ''}\n${tomTat}`,
        daGhiClipboard ? XANH : VANG
      );
    }
    capNhatPanel();
  }

  // ================== BUOC 2: TAO VARIATIONS TREN TRANG DICH ==================
  // Luong that cua Etsy:
  //   "Add variation" -> hop thoai chon (Size, Primary color...) -> "Create your own"
  //   -> hop thoai "Custom variation": o Name (#le-unstructured-variation-name-input),
  //      o option (#le-unstructured-variation-option-input) + nut "Add" cho TUNG option -> "Done"
  //   -> man hinh tong: "Add a variation" de them variation tiep theo (lai qua "Create your own")
  //   -> bat switch "Prices vary", chon variation trong #variations-select-controlsPrice -> "Apply"

  const ID_O_TEN = 'le-unstructured-variation-name-input';
  const ID_O_OPTION = 'le-unstructured-variation-option-input';
  const ID_SELECT_GIA = 'variations-select-controlsPrice';

  // Hop thoai dang mo tren cung. Khong co thi dung ca trang.
  function vungHopThoai() {
    const ds = [
      ...document.querySelectorAll(
        '.wt-overlay__modal, [role="dialog"], [aria-modal="true"], [data-clg-id="WtDialog"], [data-clg-id="WtOverlay"]'
      ),
    ].filter((el) => dangHienThi(el) && !el.closest('#etsy-var-panel'));
    return ds[ds.length - 1] || document.body;
  }

  function cacNutHienThi(goc) {
    return [...goc.querySelectorAll('button, [role="button"], [role="menuitem"], [role="option"]')].filter(
      (b) => dangHienThi(b) && !b.disabled && b.getAttribute('aria-disabled') !== 'true' && !b.closest('#etsy-var-panel')
    );
  }

  // Uu tien <button> that (vd "Add variation" nam trong 1 <span role="button"> boc ngoai)
  function timNut(goc, regex) {
    const khop = cacNutHienThi(goc).filter((b) => {
      const t = chuan(b.textContent || b.getAttribute('aria-label'));
      return t.length < 60 && regex.test(t);
    });
    return khop.find((b) => b.tagName === 'BUTTON') || khop[0] || null;
  }

  function oHienThi(id) {
    const o = document.getElementById(id);
    return dangHienThi(o) ? o : null;
  }

  function soOptionDaThem() {
    const badge = oHienThi(ID_O_TEN)?.closest('.wt-overlay__modal')?.querySelector('h2 .wt-badge');
    return badge ? parseInt(badge.textContent, 10) || 0 : -1;
  }

  async function themMotOption(ten) {
    const o = await doi(() => oHienThi(ID_O_OPTION), 4000);
    if (!o) return false;
    const truoc = soOptionDaThem();
    o.focus();
    setNativeValue(o, ten);

    // Nut "Add" chi het disabled sau khi React nhan gia tri
    const nutAdd = await doi(() => {
      const n = o.closest('.le-variation-options-input, .wt-form--group')?.querySelector('button');
      return n && !n.disabled && n.getAttribute('aria-disabled') !== 'true' ? n : null;
    }, 2500);
    if (nutAdd) bam(nutAdd);
    else guiEnter(o);

    const xong = await doi(() => {
      const oMoi = oHienThi(ID_O_OPTION);
      if (!oMoi || oMoi.value !== '') return null;
      return truoc < 0 || soOptionDaThem() > truoc ? true : null;
    }, 3000);
    return !!xong;
  }

  async function taoMotVariation(v, laDauTien, loi) {
    // Variation thu 2 tro di: bam "Add a variation" o man hinh tong
    if (!laDauTien) {
      const nut = await doi(() => timNut(vungHopThoai(), /^\+?\s*add (a |another )?variation$/), 6000);
      if (!nut) {
        loi.push(`Không thấy nút "Add a variation" (${v.ten})`);
        return false;
      }
      bam(nut);
    }

    const nutTaoMoi = await doi(() => timNut(document.body, /^\+?\s*create your own$/), 6000);
    if (!nutTaoMoi) {
      loi.push(`Không thấy nút "Create your own" (${v.ten})`);
      return false;
    }
    bam(nutTaoMoi);

    const oTen = await doi(() => oHienThi(ID_O_TEN), 5000);
    if (!oTen) {
      loi.push(`Không thấy ô Name của Custom variation (${v.ten})`);
      return false;
    }
    oTen.focus();
    setNativeValue(oTen, v.ten);
    roiKhoiO(oTen);
    await cho(150);

    let soLoi = 0;
    for (let i = 0; i < v.luaChon.length; i++) {
      const op = v.luaChon[i];
      hienThongBao(`Đang tạo "${v.ten}" (${i + 1}/${v.luaChon.length}): ${op.ten}`, '#1F2937', 0);
      if (!(await themMotOption(op.ten))) {
        soLoi++;
        canhBao('Khong them duoc option:', op.ten);
      }
    }
    if (soLoi) loi.push(`${soLoi} option của "${v.ten}" không thêm được`);

    const nutDone = await doi(() => {
      const modal = oHienThi(ID_O_TEN)?.closest('.wt-overlay__modal') || vungHopThoai();
      return timNut(modal, /^done$/);
    }, 4000);
    if (!nutDone) {
      loi.push(`Nút "Done" của "${v.ten}" vẫn bị khoá`);
      return false;
    }
    bam(nutDone);
    if (!(await doi(() => (oHienThi(ID_O_TEN) ? null : true), 5000))) {
      loi.push(`Bấm "Done" nhưng hộp thoại "${v.ten}" chưa đóng`);
      return false;
    }
    await cho(400);
    return true;
  }

  // Bat "Prices vary" va chon dung variation co gia rieng
  async function batGiaRieng(ds) {
    const coGia = ds.filter((v) => v.coGia);
    if (!coGia.length) return true;

    const sw = [...document.querySelectorAll('input.wt-switch[type="checkbox"]')].find(
      (o) => dangHienThi(o.closest('.wt-switch__wrapper')) && /^prices vary/.test(nhanCuaO(o))
    );
    if (!sw) return false;
    if (!sw.checked) sw.click();

    const sel = await doi(() => oHienThi(ID_SELECT_GIA) || document.getElementById(ID_SELECT_GIA), 3000);
    if (!sel) return false;
    let op;
    if (coGia.length > 1) op = [...sel.options].find((x) => x.value === 'unified');
    else op = [...sel.options].find((x) => chuan(x.textContent) === chuan(coGia[0].ten));
    if (!op) return false;
    if (sel.value !== op.value) setNativeValue(sel, op.value);
    return true;
  }

  // Lay chu mo ta cua 1 o input: aria-label, placeholder, <label for>, aria-labelledby
  function nhanCuaO(o) {
    const phan = [o.getAttribute('aria-label'), o.getAttribute('placeholder')];
    if (o.id) {
      const lb = document.querySelector(`label[for="${CSS.escape(o.id)}"]`);
      if (lb) phan.push(lb.textContent);
    }
    return chuan(phan.filter(Boolean).join(' '));
  }

  async function taoVariations(ds) {
    const loi = [];
    const nutMo = timNut(document.body, /^\+?\s*add variations?$/) || timNut(document.body, /^\+?\s*manage variations?$/);
    if (!nutMo) return { ok: false, loi: ['Không thấy nút "Add variation"'] };
    const laThemMoi = /^\+?\s*add/.test(chuan(nutMo.textContent));
    bam(nutMo);

    for (let i = 0; i < ds.length; i++) {
      // "Manage variations" mo thang man hinh tong -> ca variation dau cung phai bam "Add a variation"
      if (!(await taoMotVariation(ds[i], i === 0 && laThemMoi, loi))) return { ok: false, loi };
    }

    if (!(await batGiaRieng(ds))) loi.push('Không bật được "Prices vary" (hãy bật tay rồi bấm Apply)');
    await cho(300);

    const nutApply = await doi(() => timNut(vungHopThoai(), /^apply$/), 5000);
    if (!nutApply) {
      loi.push('Không thấy nút "Apply"');
      return { ok: false, loi };
    }
    bam(nutApply);

    const daCoBang = await doi(() => (daCoDuBang(ds) ? true : null), 15000);
    if (!daCoBang) loi.push('Đã bấm Apply nhưng chưa thấy bảng Variations xuất hiện');
    return { ok: !!daCoBang, loi };
  }

  // ================== BUOC 3: DIEN GIA + VISIBLE ==================

  // Switch Visible bi khoa (aria-disabled) khi gia chua hop le -> dien HET gia truoc, roi moi bat/tat Visible
  async function dienGiaVaHienThi(ds) {
    const bangs = layCacBang();
    let soGia = 0;
    let soAn = 0;
    const thieu = [];
    const canDoiVisible = [];

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
        canDoiVisible.push({ tr, hien: op.hien });
      }
    }

    await cho(500);
    for (const { tr, hien } of canDoiVisible) {
      const sw = await doi(() => {
        const x = congTacCuaDong(tr);
        return x && x.getAttribute('aria-disabled') !== 'true' ? x : null;
      }, 2000);
      if (sw && sw.checked !== hien) {
        sw.click();
        if (!hien) soAn++;
        await cho(30);
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
    const ds = await layDuLieuDeDan();
    if (!ds) return;
    dangChay = true;
    try {
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
    if (!layCacBang().length) {
      hienThongBao('Chưa có bảng Variations trên trang này', DO);
      return;
    }
    const ds = await layDuLieuDeDan();
    if (!ds) return;
    baoKetQuaDien(await dienGiaVaHienThi(ds));
  }

  // ================== CLIPBOARD (DUNG CHUNG GIUA CAC TRINH DUYET) ==================
  // GM_setValue la kho rieng cua TUNG trinh duyet (va tung ban Violentmonkey), nen Copy o Chrome
  // thi Firefox/Edge khong thay. Clipboard he thong thi moi trinh duyet tren cung may deu doc duoc,
  // nen Copy ghi ca 2 noi, con Dan uu tien doc Clipboard, khong co moi dung GM_setValue.
  // Chuoi co dau DAU_CLIPBOARD o dong dau de khong nham voi chu binh thuong dang nam trong Clipboard.

  const DAU_CLIPBOARD = 'ETSY_VARIATIONS_V1';

  function taoChuoiClipboard(ds) {
    return DAU_CLIPBOARD + '\n' + JSON.stringify(ds);
  }

  // Nhan ca chuoi co dau lan JSON tran (mang variations). Sai dinh dang -> null
  function tachChuoiClipboard(s) {
    s = String(s || '').trim();
    if (s.startsWith(DAU_CLIPBOARD)) s = s.slice(DAU_CLIPBOARD.length).trim();
    else if (!s.startsWith('[')) return null;
    try {
      const ds = JSON.parse(s);
      const hopLe =
        Array.isArray(ds) && ds.length && ds.every((v) => v && typeof v.ten === 'string' && Array.isArray(v.luaChon));
      if (!hopLe) return null;
      return ds.map((v) => ({
        ten: v.ten,
        coGia: !!v.coGia,
        luaChon: v.luaChon.map((o) => ({ ten: String(o.ten), gia: String(o.gia ?? ''), hien: o.hien !== false })),
      }));
    } catch (e) {
      return null;
    }
  }

  // Thu CA HAI duong: tuy trinh duyet / ban Violentmonkey ma 1 trong 2 co the im lang khong an
  async function ghiClipboard(chuoi) {
    let daGhi = false;
    if (typeof GM_setClipboard === 'function') {
      try {
        GM_setClipboard(chuoi, 'text');
        daGhi = true;
      } catch (e) {
        canhBao('GM_setClipboard loi:', e);
      }
    }
    try {
      await navigator.clipboard.writeText(chuoi);
      daGhi = true;
    } catch (e) {
      if (!daGhi) canhBao('navigator.clipboard.writeText loi:', e);
    }
    return daGhi;
  }

  async function docClipboard() {
    try {
      return await navigator.clipboard.readText();
    } catch (e) {
      canhBao('Khong doc duoc Clipboard:', e);
      return null;
    }
  }

  // Clipboard co du lieu variations -> dung va luu lai vao GM_setValue; khong thi dung du lieu da luu
  async function layDuLieuDeDan() {
    const chuoi = await docClipboard();
    const tuClipboard = tachChuoiClipboard(chuoi);
    if (tuClipboard) {
      ghiLuu({ luc: Date.now(), variations: tuClipboard });
      capNhatPanel();
      log('Dung du lieu tu Clipboard');
      return tuClipboard;
    }
    const luu = docLuu();
    if (luu?.variations?.length) {
      log('Clipboard khong co du lieu variations, dung du lieu da luu trong trinh duyet');
      return luu.variations;
    }
    hienThongBao(
      chuoi === null
        ? 'Không đọc được Clipboard (hãy cho phép quyền Clipboard cho etsy.com) và trình duyệt này chưa có dữ liệu.\nCó thể bấm "Nhập từ Clipboard" rồi dán tay (Ctrl+V).'
        : 'Chưa có dữ liệu. Hãy bấm "Copy variations" ở listing nguồn trước',
      DO,
      9000
    );
    return null;
  }

  // Du phong khi trinh duyet chan quyen doc Clipboard: dan tay vao hop thoai
  function nhapTay() {
    const s = prompt('Dán (Ctrl+V) dữ liệu variations đã Copy:');
    if (!s) return;
    const ds = tachChuoiClipboard(s);
    if (!ds) {
      hienThongBao('Dữ liệu không hợp lệ', DO);
      return;
    }
    ghiLuu({ luc: Date.now(), variations: ds });
    hienThongBao('Đã nhập dữ liệu variations', XANH);
    capNhatPanel();
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
    nut('Nhập từ Clipboard (dán tay)', '#6B7280', nhapTay);

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
