// ==UserScript==
// @name         Etsy Auto - Lay Tieu De, Tag, Ca Nhan Hoa & Tai Anh Full Size (quet tu data-carousel-pagination-list, tai rieng le, khong nen zip, dung Clipboard he thong)
// @namespace    etsy-auto-local
// @version      9.2
// @description  Lay tieu de + tag + o ca nhan hoa (Add personalization) (co hoac khong tai anh full size, luu tung file rieng - khong nen zip) tren trang nguon, luu vao Clipboard he thong (dung chung duoc giua nhieu trinh duyet), tu dong tim va dan gop tieu de + tag + tao Custom option (Add field > Text box) tren trang chinh sua Etsy, sau do tu dong bam vao tab Photo & Video, tu upload anh cua listing nguon (bo tick san anh bang size) va giu lai tieu de trong Clipboard de dan rieng noi khac. Anh duoc lay tu khoi "data-carousel-pagination-list" (dung anh cua listing), doi il_75x75 -> il_fullxfull roi tai tung file. Dua anh len dau luoi KHONG lam duoc tu script (trinh duyet chan moi su kien ban phim/chuot gia lap khi dang keo) nen ban tu keo tay sau khi upload — hoac dat truoc mot thu vien anh bang size cua rieng ban (nut "Ảnh bảng size") de script tu nhoi vao SAU CUNG anh san pham theo dung thu tu da luu, khong can dua len dau khi luoi dich con trong. Giao dien chi hien tren trang tim kiem, trang listing va trang tao/sua listing; co the thu nho thanh 1 bieu tuong "Listing" va keo tha tu do.
// @match        https://www.etsy.com/*
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      i.etsystatic.com
// @connect      openapi.etsy.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // Phien ban dang chay — in ra Console luc nap de biet chac trinh duyet dang dung ban nao
  const PHIEN_BAN = '9.2';

  // Ky tu dung de noi Tieu de va Tag lai thanh 1 chuoi duy nhat khi luu vao clipboard
  const NGAN_CACH = '|||TAGS|||';

  // Ky tu ngan cach cho phan "Add personalization" lay tu trang nguon.
  // Goi du lieu day du: tieuDe |||TAGS||| tag |||PERSO_LABEL||| nhan |||PERSO_INSTR||| huong dan
  // (neu listing khong co o ca nhan hoa thi khong co 2 doan sau -> van tuong thich ban cu)
  const NGAN_CACH_PERSO_NHAN = '|||PERSO_LABEL|||';
  const NGAN_CACH_PERSO_HUONG_DAN = '|||PERSO_INSTR|||';

  // Etsy co 2 kieu o ca nhan hoa, phai dien theo 2 cach khac han nhau ben trang dich:
  //   - text_input -> nguoi mua go chu   -> ben dich chon "Text box",       dien Field title + Instructions
  //   - dropdown   -> nguoi mua chon san -> ben dich chon "List of options", dien Field title + tung Option
  // Goi du lieu phan biet bang dau nao xuat hien sau PERSO_LABEL:
  //   co |||PERSO_OPTS||| -> dropdown ; co |||PERSO_INSTR||| -> text box
  // Nho vay chuoi cu (chi co PERSO_INSTR) van doc duoc nhu truoc.
  const NGAN_CACH_PERSO_LUA_CHON = '|||PERSO_OPTS|||';
  const NGAN_CACH_GIUA_LUA_CHON = '|;|'; // lua chon co the chua dau phay nen khong dung dau phay
  const GIOI_HAN_LUA_CHON = 30; // Etsy cho toi da 30 option moi field

  // Danh sach anh cua listing nguon, di CHUNG DUONG CLIPBOARD voi tieu de/tag.
  // LY DO: GM_setValue la kho rieng cua TUNG TRINH DUYET — mo trang nguon o Chrome roi mo trang
  // chinh sua o Edge thi ben Edge doc mai cung khong thay gi. Clipboard he thong la duong duy nhat
  // di duoc giua 2 trinh duyet, va do cung la ly do ca script nay dung Clipboard ngay tu dau.
  // Dat O CUOI goi du lieu de khong lam roi phan tach cua tag va o ca nhan hoa.
  const NGAN_CACH_ANH = '|||IMGS|||';
  const NGAN_CACH_GIUA_ANH = '|;|';
  const NGAN_CACH_TRONG_ANH = '|>|'; // url |>| 1 (nghi la bang size) hoac 0

  // Chi nhan link anh that cua Etsy tu Clipboard, khong nhan chuoi la
  const RE_LINK_ANH_ETSY = /^https:\/\/i\.etsystatic\.com\/\S+$/;

  // Gioi han ky tu cua o "Add text box" ben trang chinh sua Etsy
  const GIOI_HAN_NHAN_FIELD = 45;
  const GIOI_HAN_HUONG_DAN_FIELD = 120;

  // Khoang cach (ms) giua 2 lan tai file lien tiep, de trinh duyet khong chan cac ban tai lien tuc.
  // Neu bi mat anh giua chung (trinh duyet bop bot), tang len 1000-1500.
  const KHOANG_CACH_GIUA_CAC_LAN_TAI = 700;

  // Thoi han TOI DA (ms) cho MOI CACH tai 1 anh (GM_download tu blob / tu URL).
  // GM_download co the treo VINH VIEN (khong bao gio goi lai onload/onerror/ontimeout) vi nhieu
  // ly do ngoai tam kiem soat cua script: Chrome bat "Ask where to save each file" (bat hop thoai
  // Save As goc xep hang), Chrome tam chan tai nhieu file tu dong, CDN treo ket noi, loi noi bo cua
  // Violentmonkey/Tampermonkey... Option "timeout" cua GM_download KHONG cuu duoc vi no chi tinh gio
  // SAU KHI request da bat dau. Phai tu dat 1 dong ho rieng o tang code de chac chan khong bao gio
  // treo qua thoi han nay, bat ke ly do treo la gi.
  const THOI_HAN_MOI_CACH_TAI = 20000;

  // Khi KHONG tim thay khoi carousel va phai quet ca trang (che do du phong),
  // bo bot 1 anh cuoi cung tim thay (thuong la anh khong thuoc listing).
  const BO_ANH_CUOI_KHI_QUET_CA_TRANG = true;

  // ---- Tu dong tai anh nguon LEN trang chinh sua listing ----

  // Kho luu danh sach anh cua listing nguon (kem alt) de trang chinh sua doc lai.
  // Dung GM_setValue nen dung duoc giua 2 tab khac nhau, khong can luu file xuong dia.
  const KHOA_ANH_NGUON = 'etsy_auto_anh_nguon';

  // Thu vien anh bang size CUA RIENG NGUOI DUNG — khac han voi anh bang size cua listing nguon
  // (thu nay bi LOAI ra luc upload, xem RE_ANH_BANG_SIZE). Day la danh sach URL nguoi dung tu
  // quan ly (nut "Ảnh bảng size" tren panel), dung CHUNG cho MOI lan upload: sau khi ket thuc
  // buoc chon anh san pham, cac anh trong thu vien nay duoc TU DONG NHOI THEM vao CUOI, dung
  // thu tu da luu — vi luoi dich luc do trong (nguoi dung tu xoa het anh bang size cu di truoc),
  // nen chi can nhoi dung thu tu vao 1 lan la ra dung vi tri, KHONG can buoc "dua len dau" (buoc
  // do khong lam duoc tu script — xem ghi chu o tren).
  const KHOA_THU_VIEN_BANG_SIZE = 'etsy_thu_vien_bang_size';

  // Anh bang size / bang do thuong co alt chua cac tu nay -> tu bo tick san trong bang chon.
  // Nguoi dung van tick lai duoc neu muon giu.
  const RE_ANH_BANG_SIZE = /(size\s*chart|sizing\s*chart|size\s*guide|sizing\s*guide|measurement|\bchart\b)/i;

  // Gioi han so anh moi listing cua Etsy da tung la 10, nay la 20, va co the con doi tiep.
  // -> KHONG han so cung, luon co doc tu chinh trang truoc; so nay chi la phao cuoi cung.
  const GIOI_HAN_ANH_MAC_DINH = 20;

  // Thoi han (ms) cho Etsy xu ly xong cac anh vua nhoi vao o upload
  const THOI_HAN_CHO_ETSY_XU_LY_ANH = 180000;

  // Key luu trang thai giao dien (vi tri + thu nho hay khong) vao localStorage cua trang Etsy,
  // de giu nguyen giua cac lan tai lai trang.
  const PANEL_STATE_KEY = 'etsy_auto_panel_state_v1';

  // ================== HEN GIO "SACH" ==================

  // VAN DE THUC TE da gap: tren trang listing cua Etsy, window.setTimeout bi mot doan code khac
  // (trang, hoac mot tien ich khac dang chay cung luc) ghi de va KHONG BAO GIO goi lai callback,
  // trong khi window.setInterval van chay binh thuong. Hau qua: moi "await cho(...)" dung hinh
  // vinh vien, moi lop timeout deu vo hieu (vi chung cung xay tren setTimeout), va toast khong tu an.
  //
  // Cach xu ly: lay ban GOC cua cac ham hen gio tu mot iframe cung nguon moi tao ra.
  // Iframe do co window rieng, chua he bi ai va, nen setTimeout trong do luon nguyen ban.
  // LUU Y: phai GIU LAI iframe trong DOM — go bo iframe se giet toan bo timer thuoc ve no.
  const HEN_GIO = (function layHenGioSach() {
    const banDuPhong = {
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
      setInterval: window.setInterval.bind(window),
      clearInterval: window.clearInterval.bind(window),
      nguon: 'window (có thể đã bị ghi đè)',
    };

    try {
      const khung = document.createElement('iframe');
      khung.setAttribute('aria-hidden', 'true');
      khung.setAttribute('tabindex', '-1');
      khung.style.cssText = 'display:none!important;width:0;height:0;border:0;position:absolute;';
      (document.body || document.documentElement).appendChild(khung);

      const w = khung.contentWindow;
      if (w && typeof w.setTimeout === 'function' && typeof w.setInterval === 'function') {
        return {
          setTimeout: w.setTimeout.bind(w),
          clearTimeout: w.clearTimeout.bind(w),
          setInterval: w.setInterval.bind(w),
          clearInterval: w.clearInterval.bind(w),
          nguon: 'iframe (bản gốc)',
        };
      }
    } catch (e) {
      console.warn('[Etsy Auto] Không lấy được setTimeout gốc từ iframe, dùng bản của trang:', e);
    }

    return banDuPhong;
  })();

  // ================== HAM DUNG CHUNG ==================

  function setNativeValue(element, value) {
    const proto = Object.getPrototypeOf(element);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) {
      setter.call(element, value);
    } else {
      element.value = value;
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function hienThongBao(text, mau = '#1F2937') {
    let box = document.getElementById('etsy-auto-toast');
    if (!box) {
      box = document.createElement('div');
      box.id = 'etsy-auto-toast';
      box.style.cssText = `
        position:fixed; bottom:24px; right:24px; z-index:999999;
        background:${mau}; color:#fff; padding:10px 16px; border-radius:8px;
        font-size:14px; font-family:sans-serif; max-width:320px;
        box-shadow:0 4px 12px rgba(0,0,0,.3);
      `;
      document.body.appendChild(box);
    }
    box.style.background = mau;
    box.textContent = text;
    box.style.display = 'block';
    HEN_GIO.clearTimeout(box._timer);
    box._timer = HEN_GIO.setTimeout(() => (box.style.display = 'none'), 4000);
  }

  // Cho "ms" mili giay. Dung DONG THOI 2 co che de chac chan luon ket thuc:
  //   - setTimeout (ban goc lay tu iframe)
  //   - setInterval tu kiem tra dong ho (phong khi setTimeout van bi vo hieu hoa)
  // Cai nao xong truoc thi ket thuc, cai con lai bi huy. Day la ham then chot: neu no treo
  // thi CA vong lap tai anh dung hinh, va truoc day da tung xay ra dung nhu vay.
  function cho(ms) {
    return new Promise((resolve) => {
      const hetHan = Date.now() + ms;
      let xong = false;
      let hen = null;
      let dongHo = null;

      const ketThuc = () => {
        if (xong) return;
        xong = true;
        if (hen !== null) HEN_GIO.clearTimeout(hen);
        if (dongHo !== null) HEN_GIO.clearInterval(dongHo);
        resolve();
      };

      hen = HEN_GIO.setTimeout(ketThuc, ms);
      dongHo = HEN_GIO.setInterval(() => {
        if (Date.now() >= hetHan) ketThuc();
      }, Math.max(50, Math.min(ms, 250)));
    });
  }

  // Boc 1 promise trong dong ho rieng: neu qua "ms" ma promise chua xong (chua resolve/reject),
  // TU DAY reject bang loi timeout, khong can biet ben trong promise co bao gio phan hoi hay khong.
  // Dung khi goi cac API cua tien ich (GM_download...) co the treo vinh vien vi ly do ngoai tam
  // kiem soat cua trang (vi du: hop thoai Save As goc cua he dieu hanh dang cho nguoi dung).
  // Dung chinh cho() lam dong ho dem nguoc, de thua huong luon co che 2 lop cua no
  // (neu chi dung setTimeout thi khi setTimeout bi vo hieu, timeout nay cung khong bao gio chay).
  function voiThoiHan(promise, ms, thongDiepTimeout) {
    return new Promise((resolve, reject) => {
      let daXong = false;

      cho(ms).then(() => {
        if (daXong) return;
        daXong = true;
        reject(new Error(thongDiepTimeout || `Hết ${ms}ms mà không có phản hồi`));
      });

      promise.then(
        (giaTri) => {
          if (daXong) return;
          daXong = true;
          resolve(giaTri);
        },
        (loi) => {
          if (daXong) return;
          daXong = true;
          reject(loi);
        }
      );
    });
  }

  function timTheoChuHienThi(danhSachThe, chu) {
    return [...document.querySelectorAll(danhSachThe)].find(
      (el) => el.textContent.trim().toLowerCase() === chu.toLowerCase() && el.children.length === 0
    );
  }

  // Goi ham "hamTim" lien tuc cho toi khi no tra ve mot gia tri that (phan tu tim duoc),
  // hoac het thoi gian cho. Dung de doi menu / hop thoai cua Etsy hien ra.
  function doiPhanTu(hamTim, thoiGianToiDa = 5000, buoc = 150) {
    return new Promise((resolve) => {
      const batDau = Date.now();
      (function thu() {
        let ketQua = null;
        try {
          ketQua = hamTim();
        } catch (e) {
          ketQua = null;
        }
        if (ketQua) return resolve(ketQua);
        if (Date.now() - batDau >= thoiGianToiDa) return resolve(null);
        HEN_GIO.setTimeout(thu, buoc);
      })();
    });
  }

  // Doc text cua 1 phan tu nhung GIU LAI xuong dong do the <br> tao ra
  // (phan Instructions cua Etsy dung <br> de xuong dong giua cac vi du)
  function docTextGiuXuongDong(el) {
    if (!el) return '';
    const ban = el.cloneNode(true);
    ban.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    return ban.textContent
      .split('\n')
      .map((dong) => dong.trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // Doc chuoi hien co trong clipboard he thong (dung chung giua cac trinh duyet)
  async function docClipboard() {
    try {
      return await navigator.clipboard.readText();
    } catch (e) {
      hienThongBao('⚠️ Không đọc được Clipboard. Hãy cho phép quyền Clipboard cho trang này.', '#DC2626');
      return '';
    }
  }

  // Bat moi dau ngan cach dang |||CHU_HOA||| — ke ca dau cua phien ban script MOI HON
  // ma ban dang chay chua biet.
  const RE_DAU_NGAN_CACH = /\|\|\|[A-Z_]+\|\|\|/;

  // Neu con sot dau ngan cach trong mot gia tri thi Clipboard duoc tao boi ban script moi hon:
  // ban nay khong hieu dau do nen da nuot ca cum vao lam gia tri. Cat bo tu cho do tro di,
  // vi tha thieu du lieu con hon nhoi chuoi ky thuat "|||PERSO_OPTS|||..." thang vao o cua Etsy.
  let coDauLa = false;
  function catBoDauLa(chuoi, tenTruong) {
    const khop = String(chuoi || '').match(RE_DAU_NGAN_CACH);
    if (!khop) return chuoi;
    coDauLa = true;
    console.warn(
      `[Etsy Auto] Thấy dấu lạ "${khop[0]}" trong ${tenTruong} — Clipboard được tạo bởi bản script ` +
        'mới hơn bản đang chạy ở trang này. Hãy cập nhật script ở đây rồi lấy lại dữ liệu.'
    );
    return chuoi.slice(0, khop.index);
  }

  // Tach chuoi lam 2 phan tai LAN XUAT HIEN DAU TIEN cua dau ngan cach
  function tachMotLan(chuoi, dauNganCach) {
    const viTri = chuoi.indexOf(dauNganCach);
    if (viTri === -1) return [chuoi, null];
    return [chuoi.slice(0, viTri), chuoi.slice(viTri + dauNganCach.length)];
  }

  // Gop tieu de + tag + ca nhan hoa + danh sach anh thanh 1 chuoi duy nhat de luu vao clipboard
  function taoGoiDuLieu(tieuDe, tagText, perso, danhSachAnh) {
    let goi = `${tieuDe || ''}${NGAN_CACH}${tagText || ''}`;
    if (perso && perso.nhan) {
      goi += `${NGAN_CACH_PERSO_NHAN}${perso.nhan}`;
      if (perso.cacLuaChon && perso.cacLuaChon.length) {
        goi += `${NGAN_CACH_PERSO_LUA_CHON}${perso.cacLuaChon.join(NGAN_CACH_GIUA_LUA_CHON)}`;
      } else {
        goi += `${NGAN_CACH_PERSO_HUONG_DAN}${perso.huongDan || ''}`;
      }
    }
    if (danhSachAnh && danhSachAnh.length) {
      // Chi gui URL + co "nghi la bang size" (1/0), KHONG gui nguyen chu alt:
      // alt cua Etsy co the dai ca doan, ma ben nhan chi can biet co bo tick san hay khong.
      const cum = danhSachAnh
        .map((a) => `${a.url}${NGAN_CACH_TRONG_ANH}${laAnhBangSize(a.alt) ? '1' : '0'}`)
        .join(NGAN_CACH_GIUA_ANH);
      goi += `${NGAN_CACH_ANH}${cum}`;
    }
    return goi;
  }

  // Tach chuoi da luu trong clipboard thanh { tieuDe, tagText, persoNhan, persoHuongDan, danhSachAnh }
  function tachDuLieu(chuoi) {
    const rong = { tieuDe: '', tagText: '', persoNhan: '', persoHuongDan: '', danhSachAnh: [] };
    if (!chuoi || !chuoi.includes(NGAN_CACH)) return rong;

    const [tieuDe, phanSauTieuDe] = tachMotLan(chuoi, NGAN_CACH);
    let tagText = phanSauTieuDe || '';
    let persoNhan = '';
    let persoHuongDan = '';

    let persoLuaChon = [];

    // Cat phan ANH ra TRUOC TIEN (no nam cuoi goi), de doan URL khong bi nuot vao
    // huong dan ca nhan hoa hay danh sach lua chon.
    let danhSachAnh = [];
    const [truocAnh, phanAnh] = tachMotLan(tagText, NGAN_CACH_ANH);
    if (phanAnh !== null) {
      tagText = truocAnh;
      danhSachAnh = phanAnh
        .split(NGAN_CACH_GIUA_ANH)
        .map((muc) => {
          const [url, co] = muc.split(NGAN_CACH_TRONG_ANH);
          return { url: (url || '').trim(), bang: co === '1' };
        })
        // Bo moi thu khong phai link anh Etsy — khong dua chuoi la vao luong upload
        .filter((a) => RE_LINK_ANH_ETSY.test(a.url));
    }

    const [tagThoi, phanPerso] = tachMotLan(tagText, NGAN_CACH_PERSO_NHAN);
    if (phanPerso !== null) {
      tagText = tagThoi;

      // Dau nao xuat hien quyet dinh day la kieu dropdown hay text box
      const [nhanDrop, phanLuaChon] = tachMotLan(phanPerso, NGAN_CACH_PERSO_LUA_CHON);
      if (phanLuaChon !== null) {
        persoNhan = nhanDrop;
        persoLuaChon = phanLuaChon
          .split(NGAN_CACH_GIUA_LUA_CHON)
          .map((x) => x.trim())
          .filter(Boolean);
      } else {
        const [nhan, huongDan] = tachMotLan(phanPerso, NGAN_CACH_PERSO_HUONG_DAN);
        persoNhan = nhan;
        persoHuongDan = huongDan || '';
      }
    }

    coDauLa = false;
    const ketQua = {
      tieuDe: catBoDauLa(tieuDe, 'tiêu đề').trim(),
      tagText: catBoDauLa(tagText, 'tag').trim(),
      persoNhan: catBoDauLa(persoNhan, 'nhãn cá nhân hoá').trim(),
      persoHuongDan: catBoDauLa(persoHuongDan, 'hướng dẫn cá nhân hoá').trim(),
      persoLuaChon: persoLuaChon.map((x) => catBoDauLa(x, 'lựa chọn').trim()).filter(Boolean),
      danhSachAnh,
      dauLa: false,
    };
    ketQua.dauLa = coDauLa;
    return ketQua;
  }

  // Ghi chuoi vao clipboard he thong. Thu CA HAI duong (GM_setClipboard va
  // navigator.clipboard.writeText) vi tuy trinh duyet / tuy ban Violentmonkey ma mot trong hai
  // co the im lang khong an gi. Ca hai cung ghi mot chuoi nen khong so xung dot.
  async function ghiClipboard(chuoi) {
    let daGhi = false;

    if (typeof GM_setClipboard === 'function') {
      try {
        GM_setClipboard(chuoi, 'text');
        daGhi = true;
      } catch (e) {
        console.warn('[Etsy Auto] GM_setClipboard lỗi:', e);
      }
    }

    try {
      await navigator.clipboard.writeText(chuoi);
      daGhi = true;
    } catch (e) {
      if (!daGhi) console.warn('[Etsy Auto] navigator.clipboard.writeText lỗi:', e);
    }

    return daGhi;
  }

  // ================== TIM ANH TRONG KHOI "data-carousel-pagination-list" ==================

  // Bat cac link anh thumbnail 75x75 cua Etsy, vi du:
  // https://i.etsystatic.com/66228119/r/il/72db80/8293315887/il_75x75.8293315887_nmw7.jpg
  // Nhom 1 = phan dau (den truoc "75x75"), nhom 2 = phan duoi (tu dau "." sau kich thuoc).
  // Doi "75x75" thanh "fullxfull" la ra link anh full size.
  const RE_ANH_75 = /(https:\/\/i\.etsystatic\.com\/[^\s"'()\\<>]*?il_)75x75(\.[^\s"'()\\<>]*?\.(?:jpg|jpeg|png|gif|webp))/gi;

  // Tim khoi chua danh sach thumbnail cua listing (thuong la <ul data-carousel-pagination-list>)
  function timKhoiCarousel() {
    const cacSelector = [
      '[data-carousel-pagination-list]',
      'ul[data-carousel-pagination-list]',
      '[data-carousel-pagination-list-container]',
      '.carousel-pagination-list',
    ];
    for (const sel of cacSelector) {
      const el = document.querySelector(sel);
      if (el) return el;
    }

    // Du phong: quet moi phan tu, tim phan tu co TEN THUOC TINH chua "carousel-pagination-list"
    for (const el of document.querySelectorAll('*')) {
      for (const attr of el.attributes) {
        if (attr.name.toLowerCase().includes('carousel-pagination-list')) return el;
      }
    }
    return null;
  }

  // Rut cac link anh full size tu 1 doan HTML, giu nguyen thu tu xuat hien va loai trung
  function rutLinkFullSize(html) {
    const daThay = new Set();
    const danhSach = [];
    let ket;
    RE_ANH_75.lastIndex = 0;
    while ((ket = RE_ANH_75.exec(html)) !== null) {
      const urlFull = `${ket[1]}fullxfull${ket[2]}`;
      if (!daThay.has(urlFull)) {
        daThay.add(urlFull);
        danhSach.push(urlFull);
      }
    }
    return danhSach;
  }

  // Rut anh tu khoi carousel, GIU LAI ca chu "alt" cua tung anh.
  // Alt la thu duy nhat tren trang cho biet anh do la anh san pham hay anh bang size
  // ("...size chart", "Sizing guide"...), nen phai lay kem de con tu bo tick khi upload lai.
  // Cach lam: duyet TUNG MUC con (moi thumbnail la 1 <li>) de gan dung alt cho dung link,
  // sau do quet lai ca khoi mot lan de khong bo sot anh nam ngoai cac muc con.
  function rutAnhCoAlt(khoi) {
    const daThay = new Set();
    const danhSach = [];

    const them = (url, alt) => {
      if (daThay.has(url)) return;
      daThay.add(url);
      danhSach.push({ url, alt: (alt || '').trim() });
    };

    const cacMuc = khoi.querySelectorAll('li, [data-carousel-pagination-item]');
    for (const muc of cacMuc) {
      const anh = muc.querySelector('img');
      const alt = anh ? anh.getAttribute('alt') || '' : '';
      for (const url of rutLinkFullSize(muc.outerHTML)) them(url, alt);
    }

    for (const url of rutLinkFullSize(khoi.outerHTML)) them(url, '');

    return danhSach;
  }

  // Lay danh sach anh full size cua listing, moi phan tu la { url, alt }.
  // Uu tien: chi doc trong khoi "data-carousel-pagination-list" (dung 100% anh cua listing,
  // khong dinh anh gia hang / anh shop khac). Neu khong tim thay khoi nay moi quet ca trang.
  function layDanhSachAnhFullSize() {
    const khoi = timKhoiCarousel();

    if (khoi) {
      const danhSach = rutAnhCoAlt(khoi);
      console.log(
        `[Etsy Auto] Tìm thấy khối carousel (<${khoi.tagName.toLowerCase()}>), số ảnh trong khối:`,
        danhSach.length,
        danhSach
      );
      if (danhSach.length > 0) {
        return { danhSach, nguon: 'carousel' };
      }
      console.warn('[Etsy Auto] Khối carousel không chứa link ảnh 75x75 nào, chuyển sang quét cả trang');
    } else {
      console.warn('[Etsy Auto] KHÔNG tìm thấy khối "data-carousel-pagination-list", chuyển sang quét cả trang');
    }

    // Che do du phong: quet toan bo HTML cua trang (khong biet duoc alt cua tung anh)
    const danhSach = rutLinkFullSize(document.documentElement.outerHTML).map((url) => ({ url, alt: '' }));
    if (BO_ANH_CUOI_KHI_QUET_CA_TRANG && danhSach.length > 0) {
      danhSach.pop();
    }
    console.log('[Etsy Auto] (Dự phòng) Số ảnh full size lấy được khi quét cả trang:', danhSach.length, danhSach);
    return { danhSach, nguon: 'ca_trang' };
  }

  // ================== TAI ANH FULL SIZE (TUNG FILE RIENG - KHONG NEN ZIP) ==================

  // Lay phan duoi file (jpg/png/...) tu url
  function laySoDuoiFile(url) {
    const m = url.match(/\.([a-zA-Z0-9]+)(?:\?.*)?$/);
    return m ? m[1].toLowerCase() : 'jpg';
  }

  function laMimeTheoDuoi(duoi) {
    if (duoi === 'png') return 'image/png';
    if (duoi === 'gif') return 'image/gif';
    if (duoi === 'webp') return 'image/webp';
    return 'image/jpeg';
  }

  // Lam sach ten file (bo cac ky tu khong hop le tren Windows/Mac)
  function lamSachTenFile(ten) {
    return (ten || 'etsy-images')
      .replace(/[\/:*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100) || 'etsy-images';
  }

  // Tai THANG tu URL goc bang GM_download (khong tu fetch du lieu truoc).
  // Van la request do TIEN ICH thuc hien (khong phai trang web) nen uBlock/AdBlock khong loc duoc,
  // nhung dung lam PHUONG AN DU PHONG (khong phai mac dinh) vi it duoc kiem chung hon voi CDN cua
  // Etsy so voi duong "fetch bytes roi GM_download tu blob" - xem luuAnhXuongMay() de biet thu tu uu tien.
  function taiBangGmDownloadTuUrl(url, tenFile) {
    return new Promise((resolve, reject) => {
      if (typeof GM_download !== 'function') {
        reject(new Error('GM_download không khả dụng'));
        return;
      }
      let daXong = false;
      GM_download({
        url,
        name: tenFile,
        saveAs: false,
        timeout: 60000,
        onload: () => {
          if (daXong) return;
          daXong = true;
          resolve('gm_download_url');
        },
        onerror: (loi) => {
          if (daXong) return;
          daXong = true;
          reject(new Error('GM_download (URL) báo lỗi: ' + JSON.stringify(loi)));
        },
        ontimeout: () => {
          if (daXong) return;
          daXong = true;
          reject(new Error('GM_download (URL) timeout'));
        },
      });
    });
  }

  // Tai 1 anh ve dang ArrayBuffer (dung GM_xmlhttpRequest de tranh loi CORS,
  // va cung de request KHONG di qua trang web nen khong bi adblock loc)
  function taiMotAnh(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error('Thiếu quyền GM_xmlhttpRequest (kiểm tra lại @grant trong script)'));
        return;
      }
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        responseType: 'arraybuffer',
        timeout: 30000,
        onload: (res) => {
          if (res.status >= 200 && res.status < 300) {
            resolve(res.response);
          } else {
            reject(new Error(`Lỗi tải ảnh (mã ${res.status}): ${url}`));
          }
        },
        onerror: () => reject(new Error(`Không tải được ảnh: ${url}`)),
        ontimeout: () => reject(new Error(`Hết thời gian chờ khi tải ảnh: ${url}`)),
      });
    });
  }

  // Thu tai 1 anh, neu loi thi thu lai them vai lan truoc khi bo cuoc.
  // MOI LAN THU deu boc trong voiThoiHan() rieng: option "timeout" cua GM_xmlhttpRequest
  // co the KHONG duoc goi lai (giong y het van de gap voi GM_download) neu ket noi bi treo
  // truoc khi request thuc su bat dau (vi du: bi trinh duyet/tien ich chan ngam khi goi lien
  // tiep nhieu request cheo goc toi cung 1 CDN). Khong co dong ho rieng nay thi ca vong lap tai
  // anh se dung hinh vinh vien tu ngay o BUOC LAY DU LIEU, truoc ca khi cham toi GM_download.
  async function taiMotAnhVoiRetry(url, soLanThuLai = 2) {
    let loiCuoi;
    for (let lan = 0; lan <= soLanThuLai; lan++) {
      try {
        return await voiThoiHan(
          taiMotAnh(url),
          THOI_HAN_MOI_CACH_TAI,
          `GM_xmlhttpRequest không phản hồi sau ${THOI_HAN_MOI_CACH_TAI / 1000}s: ${url}`
        );
      } catch (loi) {
        loiCuoi = loi;
        if (lan < soLanThuLai) {
          console.warn(`[Etsy Auto] Lỗi/treo khi tải ảnh, thử lại lần ${lan + 1}/${soLanThuLai}:`, url, loi.message);
          await cho(800);
        }
      }
    }
    throw loiCuoi;
  }

  // Da co san du lieu anh (blob) -> nho GM_download luu xuong may.
  // Day la CACH MAC DINH (uu tien nhat) trong luuAnhXuongMay(), giong het cach ban script goc 4.8
  // da dung va chay on dinh: fetch bytes qua GM_xmlhttpRequest roi moi GM_download tu blob.
  function taiBangGmDownloadTuBlob(blob, tenFile) {
    return new Promise((resolve, reject) => {
      if (typeof GM_download !== 'function') {
        reject(new Error('GM_download không khả dụng'));
        return;
      }
      const urlTaiVe = URL.createObjectURL(blob);
      GM_download({
        url: urlTaiVe,
        name: tenFile,
        saveAs: false,
        onload: () => {
          HEN_GIO.setTimeout(() => URL.revokeObjectURL(urlTaiVe), 5000);
          resolve('gm_download_blob');
        },
        onerror: (loi) => {
          HEN_GIO.setTimeout(() => URL.revokeObjectURL(urlTaiVe), 5000);
          reject(new Error('GM_download (blob) báo lỗi: ' + JSON.stringify(loi)));
        },
        ontimeout: () => {
          HEN_GIO.setTimeout(() => URL.revokeObjectURL(urlTaiVe), 5000);
          reject(new Error('GM_download (blob) timeout'));
        },
      });
    });
  }

  // CACH 3 (cuoi cung): the <a download> chay ngay trong trang.
  // Day la cach DE bi trinh duyet chan nhat khi tai nhieu file lien tiep
  // (popup "This site wants to download multiple files"), nen chi dung khi 2 cach tren that bai.
  function taiBangTheA(blob, tenFile) {
    return new Promise((resolve, reject) => {
      try {
        const urlTaiVe = URL.createObjectURL(blob);
        const theA = document.createElement('a');
        theA.href = urlTaiVe;
        theA.download = tenFile;
        document.body.appendChild(theA);
        theA.click();
        theA.remove();
        HEN_GIO.setTimeout(() => URL.revokeObjectURL(urlTaiVe), 8000);
        resolve('a_tag');
      } catch (loi) {
        reject(loi);
      }
    });
  }

  // Luu 1 anh xuong may. Thu tu uu tien (doi lai so voi ban 5.0-5.5):
  //   1) GM_xmlhttpRequest tu lay du lieu anh -> GM_download tu BLOB
  //      (dung cach nay lam MAC DINH vi day la cach ban script goc 4.8 da chay on dinh)
  //   2) GM_download tai THANG tu URL goc (nhanh hon nhung it duoc kiem chung hon voi CDN cua Etsy)
  //   3) The <a download> chay ngay trong trang (de bi trinh duyet chan nhat, chi dung khi bi dong)
  // MOI cach qua GM_download deu boc trong voiThoiHan() de khong bao gio treo qua THOI_HAN_MOI_CACH_TAI,
  // du GM_download co goi lai hay khong (vi du: hop thoai he dieu hanh, CDN treo ket noi, v.v.)
  // "baoTreo" (tuy chon) duoc goi khi mot buoc GM_download bi TIMEOUT (khong phai loi khac).
  async function luuAnhXuongMay(url, tenFile, baoTreo) {
    let blob = null;

    // Buoc 1: lay du lieu anh + luu tu blob (uu tien, giong cach ban goc 4.8 da chay on dinh)
    try {
      const duLieu = await taiMotAnhVoiRetry(url);
      const duoi = laySoDuoiFile(url);
      blob = new Blob([duLieu], { type: laMimeTheoDuoi(duoi) });

      return await voiThoiHan(
        taiBangGmDownloadTuBlob(blob, tenFile),
        THOI_HAN_MOI_CACH_TAI,
        'GM_download (blob) không phản hồi sau ' + THOI_HAN_MOI_CACH_TAI / 1000 + 's'
      );
    } catch (loi) {
      console.warn('[Etsy Auto] Lấy dữ liệu / GM_download từ blob thất bại/treo, thử tải thẳng từ URL:', loi.message);
      if (loi.message.includes('không phản hồi sau') && typeof baoTreo === 'function') {
        baoTreo();
      }
    }

    // Buoc 2: du phong - GM_download tai thang tu URL (khong can blob da fetch o buoc 1)
    try {
      return await voiThoiHan(
        taiBangGmDownloadTuUrl(url, tenFile),
        THOI_HAN_MOI_CACH_TAI,
        'GM_download (URL) không phản hồi sau ' + THOI_HAN_MOI_CACH_TAI / 1000 + 's'
      );
    } catch (loi) {
      console.warn('[Etsy Auto] GM_download từ URL cũng thất bại/treo:', loi.message);
      if (loi.message.includes('không phản hồi sau') && typeof baoTreo === 'function') {
        baoTreo();
      }
    }

    // Buoc 3 (cuoi cung): the <a download> - CHI dung duoc neu buoc 1 da fetch thanh cong du lieu.
    // Neu ca viec fetch du lieu cung that bai thi khong co gi de dan qua the <a> -> bao loi anh nay.
    if (blob) {
      console.warn('[Etsy Auto] Thử phương án cuối: thẻ <a download>');
      return taiBangTheA(blob, tenFile);
    }
    throw new Error('Cả 3 cách tải đều thất bại/treo (không lấy được dữ liệu ảnh)');
  }

  // Tai TUNG anh full size mot, luu thanh file rieng le xuong may (KHONG nen zip)
  // "ketQuaAnhCoSan" (tuy chon) de dung lai ket qua da quet o noi goi, khong quet lai trang lan nua.
  async function taiTungAnhRieng(tieuDe, ketQuaAnhCoSan) {
    const { danhSach: danhSachGoc, nguon } = ketQuaAnhCoSan || layDanhSachAnhFullSize();

    // Bo qua ngay tu dau nhung anh nghi la bang size (cung dieu kien "tu bo tick san" o buoc
    // upload — xem laAnhBangSize()), vi day la tai xuong may nen khong co buoc chon lai nhu
    // bang chon anh upload — bo hang truoc, chu khong bo tick de nguoi dung tu chon.
    const danhSachUrl = danhSachGoc.filter((a) => !laAnhBangSize(a.alt));
    const soBoQuaBangSize = danhSachGoc.length - danhSachUrl.length;

    if (danhSachUrl.length === 0) {
      hienThongBao(
        soBoQuaBangSize > 0
          ? '⚠️ Chỉ tìm thấy ảnh nghi là bảng size — không còn ảnh nào để tải'
          : '⚠️ Không tìm thấy ảnh nào trên trang này',
        '#DC2626'
      );
      return;
    }

    if (nguon === 'ca_trang') {
      hienThongBao('⚠️ Không thấy khối carousel ảnh, đang quét cả trang (có thể dính ảnh thừa)', '#F59E0B');
      await cho(1200);
    }

    const ghiChuBoQua = soBoQuaBangSize > 0 ? ` (đã bỏ qua ${soBoQuaBangSize} ảnh bảng size)` : '';
    hienThongBao(`⏳ Đang tải ${danhSachUrl.length} ảnh (từng file riêng)${ghiChuBoQua}...`, '#2563EB');

    const tenGoc = lamSachTenFile(tieuDe);
    let soLuongThanhCong = 0;
    const danhSachLoi = [];

    // Chi hien canh bao ve viec tai bi treo DUNG 1 LAN cho ca lo anh,
    // tranh spam toast neu nhieu anh lien tiep cung gap.
    let daCanhBaoTreo = false;
    const baoTreo = () => {
      if (daCanhBaoTreo) return;
      daCanhBaoTreo = true;
      hienThongBao('⚠️ Một bước tải bị treo quá lâu, script đang tự chuyển sang cách khác...', '#F59E0B');
    };

    for (let i = 0; i < danhSachUrl.length; i++) {
      const url = danhSachUrl[i].url;
      const soThuTu = String(i + 1).padStart(2, '0');
      try {
        const duoi = laySoDuoiFile(url);
        const tenFile = `${tenGoc} - ${soThuTu}.${duoi}`;
        const cachTai = await luuAnhXuongMay(url, tenFile, baoTreo);
        soLuongThanhCong++;
        console.log(`[Etsy Auto] Đã lưu ảnh ${soThuTu} (${cachTai}):`, tenFile);
        hienThongBao(`⏳ Đã tải ${soLuongThanhCong}/${danhSachUrl.length} ảnh...`, '#2563EB');
      } catch (loi) {
        console.error(`[Etsy Auto] Lỗi ở ảnh ${soThuTu}:`, url, loi);
        danhSachLoi.push(soThuTu);
      }
      // Cho 1 chut giua cac lan tai de trinh duyet khong chan bot cac ban tai lien tuc
      await cho(KHOANG_CACH_GIUA_CAC_LAN_TAI);
    }

    if (soLuongThanhCong === 0) {
      hienThongBao('❌ Không tải được ảnh nào. Xem Console (F12) để biết chi tiết lỗi.', '#DC2626');
      return;
    }

    if (danhSachLoi.length > 0) {
      hienThongBao(
        `⚠️ Đã tải ${soLuongThanhCong}/${danhSachUrl.length} ảnh${ghiChuBoQua}. Lỗi ảnh số: ${danhSachLoi.join(', ')}`,
        '#F59E0B'
      );
    } else {
      hienThongBao(
        `✅ Đã tải xong tất cả ${soLuongThanhCong} ảnh (file riêng lẻ, không nén zip)${ghiChuBoQua}`,
        '#16A34A'
      );
    }

  }

  // ================== BUOC 1: LAY DU LIEU (chay tren trang nguon) ==================

  function layTieuDe() {
    const cacSelector = [
      'h1[data-buy-box-listing-title="true"]',
      'h1[data-listing-id-title]',
      'h1[itemprop="name"]',
      'main h1',
      'h1',
    ];
    for (const sel of cacSelector) {
      const h1 = document.querySelector(sel);
      if (h1 && h1.textContent.trim()) {
        return h1.textContent.trim();
      }
    }
    return null;
  }

  // Lay o "Add personalization" tren trang nguon (neu listing co bat ca nhan hoa).
  // Trong Elements, khu vuc nay co dang:
  //   <div id="enhanced-perso-content"> ... <li id="perso-field-xxxx" data-field-type="text_input">
  //     <label data-label-translation="Please write the Pokemon character you'd like">
  //        <span data-label>Please write the Pokemon character you'd like</span>
  //     <div data-selector="perso-text-field-content">
  //        <p data-instructions>Examples:<br>• Pikachu<br>• Eevee ...</p>
  // -> lay chu trong [data-label] va [data-instructions]
  function layThongTinCaNhanHoa() {
    // CHI dung cac selector rieng cua khu vuc ca nhan hoa.
    // Tuyet doi KHONG dung selector chung nhu [data-label] lam du phong: cac o chon bien the
    // (Style and Size, Color...) cua listing binh thuong cung dung data-label, se bi hieu nham
    // thanh o ca nhan hoa.
    const cacSelectorVung = [
      '#enhanced-perso-content',
      '[data-appears-component-name="personalization"]',
      'li[id^="perso-field-"]',
      '[data-selector="perso-text-field-content"]',
    ];

    let vung = null;
    for (const sel of cacSelectorVung) {
      vung = document.querySelector(sel);
      if (vung) break;
    }

    if (!vung) {
      console.log('[Etsy Auto] Listing này KHÔNG có "Add personalization" — bỏ qua phần cá nhân hoá');
      return { nhan: '', huongDan: '', loai: '', cacLuaChon: [] };
    }

    // Xac nhan lai day dung la khu vuc ca nhan hoa: ben trong phai co o nhap ca nhan hoa
    // (id bat dau bang "perso-input-") hoac phan huong dan / o ca nhan hoa that su.
    const dungLaVungPerso = !!vung.querySelector(
      '[id^="perso-input-"], [data-instructions], li[id^="perso-field-"]'
    );
    if (!dungLaVungPerso) {
      console.log('[Etsy Auto] Có khối cá nhân hoá nhưng rỗng — bỏ qua phần cá nhân hoá');
      return { nhan: '', huongDan: '', loai: '', cacLuaChon: [] };
    }

    let nhan = docTextGiuXuongDong(vung.querySelector('[data-label]'));
    if (!nhan) {
      const elDich = vung.querySelector('[data-label-translation]');
      if (elDich) nhan = (elDich.getAttribute('data-label-translation') || '').trim();
    }

    // Phan biet 2 kieu o ca nhan hoa. Uu tien doc data-field-type tren <li id="perso-field-...">,
    // neu khong co thi cu thay <select> la biet day la kieu chon tu danh sach.
    const oField = vung.matches('li[id^="perso-field-"]')
      ? vung
      : vung.querySelector('li[id^="perso-field-"]');
    const loaiField = oField ? oField.getAttribute('data-field-type') || '' : '';
    const oChon = vung.querySelector('select[id^="perso-dropdown-"], select[id*="perso-dropdown" i]');

    let cacLuaChon = [];
    if (loaiField === 'dropdown' || oChon) {
      if (oChon) {
        // Bo dong "Select an option": no la placeholder (value rong / disabled), khong phai lua chon that
        cacLuaChon = [...oChon.options]
          .filter((o) => o.value && !o.disabled)
          .map((o) => o.textContent.trim())
          .filter(Boolean)
          .slice(0, GIOI_HAN_LUA_CHON);
      }
      console.log('[Etsy Auto] Cá nhân hoá kiểu DROPDOWN — nhãn:', nhan, '| lựa chọn:', cacLuaChon);
      return { nhan, huongDan: '', loai: 'dropdown', cacLuaChon };
    }

    const huongDan = docTextGiuXuongDong(vung.querySelector('[data-instructions]'));
    if (nhan || huongDan) {
      console.log('[Etsy Auto] Cá nhân hoá kiểu TEXT BOX — nhãn:', nhan, '| hướng dẫn:', huongDan);
    } else {
      console.warn('[Etsy Auto] Thấy khu vực cá nhân hoá nhưng không đọc được data-label / data-instructions');
    }

    return { nhan, huongDan, loai: 'text_input', cacLuaChon: [] };
  }

  // ================== LAY TAG QUA ETSY OPEN API v3 ==================

  // Trang listing cua Etsy KHONG he chua tag trong HTML (Etsy da bo hien thi tag cong khai
  // tu lau). Cach chinh thong duy nhat de lay tag cua bat ky listing nao la goi Etsy Open API v3:
  //   GET https://openapi.etsy.com/v3/application/listings/{listing_id}   (header: x-api-key)
  // Day la endpoint cap ung dung: chi can khoa xac thuc, KHONG can OAuth, khong can dang nhap.
  //
  // LUU Y QUAN TRONG ve gia tri dat vao header x-api-key:
  // App cua Etsy cho 2 gia tri — "Keystring" va "Shared secret". Tai lieu bao chi can Keystring,
  // nhung mot so app doi CA HAI trong CUNG 1 header, noi bang dau hai cham:
  //     x-api-key: <keystring>:<shared secret>
  // Bang chung tu 2 thong bao loi cua chinh Etsy khi thu tung gia tri rieng le:
  //   - Gui rieng Keystring     -> 403 "Shared secret is required in x-api-key header"
  //     (tuc la header con thieu nua sau)
  //   - Gui rieng Shared secret -> 403 "API key not found or not active, or incorrect shared
  //     secret for API key" (Etsy doc no nhu mot API key nen khong tim thay)
  // Vi khong doan truoc duoc app nao can dang nao, script luu ca 2 gia tri roi thu lan luot cac
  // to hop; to hop nao chay duoc thi nho lai de lan sau goi thang, khoi ton them request.
  const KHOA_LUU_KEYSTRING = 'etsy_api_key'; // giu nguyen ten cu de key da luu truoc do khong mat
  const KHOA_LUU_SHARED_SECRET = 'etsy_shared_secret';
  const KHOA_LUU_UU_TIEN = 'etsy_api_uu_tien'; // ten loai khoa da tung goi thanh cong

  function docGiaTriLuu(ten) {
    try {
      return (typeof GM_getValue === 'function' ? GM_getValue(ten, '') : '') || '';
    } catch (e) {
      console.warn('[Etsy Auto] Không đọc được giá trị đã lưu:', ten, e);
      return '';
    }
  }

  function luuGiaTri(ten, giaTri) {
    try {
      if (typeof GM_setValue === 'function') GM_setValue(ten, giaTri);
      return true;
    } catch (e) {
      console.warn('[Etsy Auto] Không lưu được:', ten, e);
      return false;
    }
  }

  function coKhoaXacThuc() {
    return !!(docGiaTriLuu(KHOA_LUU_KEYSTRING) || docGiaTriLuu(KHOA_LUU_SHARED_SECRET));
  }

  // Danh sach cac to hop se thu, dat to hop tung chay duoc len dau tien
  function layDanhSachKhoaThu() {
    const keystring = docGiaTriLuu(KHOA_LUU_KEYSTRING);
    const secret = docGiaTriLuu(KHOA_LUU_SHARED_SECRET);
    const danhSach = [];

    // Dang ghep dat truoc vi thong bao loi cua Etsy chi thang vao no
    if (keystring && secret) {
      danhSach.push({ ten: 'Keystring:Shared secret', giaTri: `${keystring}:${secret}` });
    }
    if (keystring) danhSach.push({ ten: 'Keystring', giaTri: keystring });
    if (secret) danhSach.push({ ten: 'Shared secret', giaTri: secret });
    // Phong truong hop nguoi dung dan nham thu tu 2 o
    if (keystring && secret) {
      danhSach.push({ ten: 'Shared secret:Keystring', giaTri: `${secret}:${keystring}` });
    }

    // Neu da tung goi thanh cong bang to hop nao thi dua no len dau, khoi thu lai tu dau
    const uuTien = docGiaTriLuu(KHOA_LUU_UU_TIEN);
    const viTri = danhSach.findIndex((k) => k.ten === uuTien);
    if (viTri > 0) danhSach.unshift(danhSach.splice(viTri, 1)[0]);

    return danhSach;
  }

  // Dich ma loi HTTP cua Etsy thanh cau tieng Viet de hieu, kem nguyen van thong bao tu API
  function moTaLoiApi(res) {
    let chiTiet = '';
    try {
      const j = JSON.parse(res.responseText);
      chiTiet = j.error || j.message || '';
    } catch (e) {
      chiTiet = (res.responseText || '').slice(0, 200);
    }
    const them = chiTiet ? ` — ${chiTiet}` : '';

    if (res.status === 401) return `khoá sai hoặc chưa kích hoạt (401)${them}`;
    if (res.status === 403) return `bị từ chối (403)${them}`;
    if (res.status === 404) return `không tìm thấy (404)${them}`;
    if (res.status === 429) return `hết quota, thử lại sau (429)${them}`;
    return `API trả về mã ${res.status}${them}`;
  }

  // ---- Tu gioi han tan suat theo han muc that cua Etsy: 5 QPS va 5.000 request/ngay ----
  //
  // Vi sao phai tu gioi han thay vi cu goi roi de Etsy tu chan:
  //   - Vuot 5 QPS thi Etsy tra 429, request do MAT KHONG — van tinh vao han muc ngay ma khong
  //     lay duoc du lieu gi. Cang goi don cang lang phi.
  //   - Nguoi dung mo NHIEU TAB Etsy cung luc thi moi tab tu ban request cua no; cong lai rat de
  //     vuot 5 QPS. Nen moc thoi gian goi cuoi va bo dem ngay deu luu bang GM_setValue —
  //     day la kho dung chung giua moi tab cua cung mot script, nen cac tab tu dieu phoi lan nhau.
  const GIOI_HAN_QPS = 4; // de bien an toan duoi 5
  const GIOI_HAN_QPD = 5000;
  const KHOA_MOC_GOI_CUOI = 'etsy_api_moc_goi_cuoi';
  const KHOA_DEM_NGAY = 'etsy_api_dem_ngay';

  function ngayHomNay() {
    const d = new Date();
    const hai = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${hai(d.getMonth() + 1)}-${hai(d.getDate())}`;
  }

  function docDemNgay() {
    try {
      const j = JSON.parse(docGiaTriLuu(KHOA_DEM_NGAY) || '{}');
      if (j.ngay !== ngayHomNay()) return { ngay: ngayHomNay(), so: 0 };
      return { ngay: j.ngay, so: j.so || 0 };
    } catch (e) {
      return { ngay: ngayHomNay(), so: 0 };
    }
  }

  function tangDemNgay() {
    const d = docDemNgay();
    d.so += 1;
    luuGiaTri(KHOA_DEM_NGAY, JSON.stringify(d));
    return d.so;
  }

  let hangDoiApi = Promise.resolve();

  // Xep moi request vao mot hang doi: chay lan luot, cach nhau du de khong vuot QPS,
  // va dung han khi da het han muc ngay.
  function xepHangGoiApi(thucHien) {
    const ketQua = hangDoiApi.then(async () => {
      const dem = docDemNgay();
      if (dem.so >= GIOI_HAN_QPD) {
        throw new Error(`đã dùng hết ${GIOI_HAN_QPD} request của hôm nay — chờ sang ngày mới`);
      }

      const cachToiThieu = Math.ceil(1000 / GIOI_HAN_QPS);
      const moc = Number(docGiaTriLuu(KHOA_MOC_GOI_CUOI)) || 0;
      const phaiCho = moc + cachToiThieu - Date.now();
      if (phaiCho > 0) await cho(phaiCho);

      luuGiaTri(KHOA_MOC_GOI_CUOI, String(Date.now()));
      tangDemNgay();
      return thucHien();
    });

    // Mot request hong khong duoc lam dut ca hang doi cho nhung request sau
    hangDoiApi = ketQua.catch(() => {});
    return ketQua;
  }

  // Boc them 1 lop: bi 429 thi cho roi thu lai dung 1 lan, thay vi bao hong ngay
  async function goiApiMotLan(url, khoaXacThuc) {
    try {
      return await xepHangGoiApi(() => thucHienGoiApi(url, khoaXacThuc));
    } catch (loi) {
      if (!/\(429\)/.test(loi.message)) throw loi;
      console.warn('[Etsy Auto] Bị giới hạn tần suất (429), chờ 3 giây rồi thử lại 1 lần');
      await cho(3000);
      return xepHangGoiApi(() => thucHienGoiApi(url, khoaXacThuc));
    }
  }

  function thucHienGoiApi(url, khoaXacThuc) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error('Thiếu quyền GM_xmlhttpRequest'));
        return;
      }
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers: { 'x-api-key': khoaXacThuc },
        timeout: 15000,
        onload: (res) => {
          if (res.status === 200) {
            try {
              resolve(res.responseText ? JSON.parse(res.responseText) : {});
            } catch (e) {
              reject(new Error('API trả về dữ liệu không đọc được: ' + e.message));
            }
            return;
          }
          reject(new Error(moTaLoiApi(res)));
        },
        onerror: () => reject(new Error('Không gọi được API (kiểm tra @connect / mạng)')),
        ontimeout: () => reject(new Error('API không phản hồi')),
      });
    });
  }

  // Goi API, tu thu lan luot cac khoa da luu. Tra ve { duLieu, tenKhoa } neu thanh cong.
  async function goiApi(url) {
    const cacKhoa = layDanhSachKhoaThu();
    if (cacKhoa.length === 0) throw new Error('chưa nhập Keystring / Shared secret');

    const cacLoi = [];
    for (const khoa of cacKhoa) {
      try {
        const duLieu = await voiThoiHan(
          goiApiMotLan(url, khoa.giaTri),
          THOI_HAN_MOI_CACH_TAI,
          `API Etsy không phản hồi sau ${THOI_HAN_MOI_CACH_TAI / 1000}s`
        );
        console.log(`[Etsy Auto] API OK bằng ${khoa.ten}`);
        luuGiaTri(KHOA_LUU_UU_TIEN, khoa.ten);
        return { duLieu, tenKhoa: khoa.ten };
      } catch (loi) {
        console.warn(`[Etsy Auto] API thất bại với ${khoa.ten}:`, loi.message);
        // Gom loi theo noi dung: nhieu to hop thuong cung mot thong bao, gop lai cho gon
        const daCo = cacLoi.find((x) => x.thongDiep === loi.message);
        if (daCo) daCo.cacTen.push(khoa.ten);
        else cacLoi.push({ thongDiep: loi.message, cacTen: [khoa.ten] });
      }
    }
    throw new Error(cacLoi.map((x) => `${x.cacTen.join(' / ')}: ${x.thongDiep}`).join(' | '));
  }

  // Mo hop thoai nhap / doi khoa, roi kiem tra ngay bang endpoint ping
  async function hoiApiKey() {
    if (typeof GM_setValue !== 'function' || typeof GM_getValue !== 'function') {
      hienThongBao(
        '❌ Thiếu quyền GM_setValue/GM_getValue — mở script trong Violentmonkey và bấm Save lại',
        '#DC2626'
      );
      console.error('[Etsy Auto] Thiếu @grant GM_setValue / GM_getValue');
      return;
    }

    const keystring = prompt(
      'Bước 1/2 — KEYSTRING của app Etsy\n' +
        'Lấy tại: https://www.etsy.com/developers/your-apps\n\n' +
        'Để trống rồi OK nếu muốn bỏ qua / xoá giá trị này.',
      docGiaTriLuu(KHOA_LUU_KEYSTRING)
    );
    if (keystring === null) return; // Cancel -> khong doi gi
    luuGiaTri(KHOA_LUU_KEYSTRING, keystring.trim());

    const secret = prompt(
      'Bước 2/2 — SHARED SECRET của app Etsy\n\n' +
        'Nhiều app Etsy đòi cả 2 giá trị trong cùng header, dạng "keystring:shared secret".\n' +
        'Nhập đủ cả hai để script tự thử các tổ hợp và nhớ lại cái nào chạy được.\n\n' +
        '⚠️ Shared secret là thông tin nhạy cảm, chỉ lưu trên máy bạn, đừng chia sẻ.',
      docGiaTriLuu(KHOA_LUU_SHARED_SECRET)
    );
    if (secret !== null) luuGiaTri(KHOA_LUU_SHARED_SECRET, secret.trim());

    luuGiaTri(KHOA_LUU_UU_TIEN, ''); // nhap lai thi bo ghi nho cu, thu lai tu dau

    if (!coKhoaXacThuc()) {
      hienThongBao('🗑️ Đã xoá khoá API (quay lại lấy tag bằng nút Copy)', '#F59E0B');
      return;
    }

    hienThongBao('⏳ Đang kiểm tra khoá...', '#2563EB');
    try {
      const { tenKhoa } = await goiApi('https://openapi.etsy.com/v3/application/openapi-ping');
      hienThongBao(`✅ Khoá hợp lệ (dùng ${tenKhoa}), đã lưu`, '#16A34A');
    } catch (loi) {
      hienThongBao('❌ Khoá không dùng được — ' + loi.message, '#DC2626');
    }
  }

  // Lay listing id tu duong dan: https://www.etsy.com/listing/4550390920/...
  function layListingId() {
    const khop = location.pathname.match(/\/listing\/(\d+)/);
    return khop ? khop[1] : null;
  }

  // Tra ve { tagText, loi }:
  //   tagText = "tag1, tag2, ..." neu lay duoc
  //   loi     = ly do that bai, de ben ngoai HIEN RA cho nguoi dung thay.
  // KHONG tu hien toast o day: toast tong ket chay ngay sau se ghi de len, khien nguoi dung
  // chi thay dong chung chung "khong lay duoc tag" ma khong bao gio biet nguyen nhan that.
  async function layTagQuaApi() {
    if (typeof GM_getValue !== 'function') {
      return { tagText: '', loi: 'thiếu quyền GM_getValue — mở script trong Violentmonkey rồi bấm Save lại' };
    }
    if (!coKhoaXacThuc()) {
      console.log('[Etsy Auto] Chưa lưu khoá API nên bỏ qua API, dùng nút Copy');
      return { tagText: '', loi: 'chưa nhập khoá API' };
    }

    const listingId = layListingId();
    if (!listingId) {
      return { tagText: '', loi: 'không đọc được listing id từ URL (trang này không phải trang listing?)' };
    }

    try {
      const { duLieu } = await goiApi(`https://openapi.etsy.com/v3/application/listings/${listingId}`);
      const danhSachTag = Array.isArray(duLieu.tags) ? duLieu.tags : [];
      if (danhSachTag.length === 0) {
        return { tagText: '', loi: 'API chạy được nhưng listing này không có tag nào' };
      }
      return { tagText: danhSachTag.join(', '), loi: '' };
    } catch (loi) {
      return { tagText: '', loi: loi.message };
    }
  }

  function timNutCopyTag() {
    const nhan = timTheoChuHienThi('dt, span, div, h2, h3, label', 'tags');
    if (!nhan) return null;

    let khuVuc = nhan.parentElement;
    for (let i = 0; i < 4 && khuVuc; i++) {
      const nutCopy = [...khuVuc.querySelectorAll('button, a, span')].find(
        (el) => el.textContent.trim().toLowerCase() === 'copy'
      );
      if (nutCopy) return nutCopy;
      khuVuc = khuVuc.parentElement;
    }
    return null;
  }

  // Lay tag bang nut "Copy" cua tien ich HeyEtsy (phuong an du phong).
  // Nut nay ghi tag vao clipboard, phai doi no chay xong roi moi doc lai duoc.
  async function layTagQuaNutCopy() {
    const nutCopy = timNutCopyTag();
    if (!nutCopy) return '';

    nutCopy.click();
    await cho(400);
    try {
      return (await navigator.clipboard.readText()) || '';
    } catch (e) {
      console.warn('[Etsy Auto] Không đọc được clipboard sau khi bấm Copy:', e);
      return '';
    }
  }

  // Lay tag theo thu tu uu tien:
  //   1) Etsy Open API v3 — chinh thong, chinh xac, khong phu thuoc tien ich nao
  //   2) Nut "Copy" cua HeyEtsy — du phong khi chua nhap API key hoac API loi
  async function layTag() {
    const ketQuaApi = await layTagQuaApi();
    if (ketQuaApi.tagText) return { tagText: ketQuaApi.tagText, nguon: 'API Etsy', loiApi: '' };

    const tagCopy = await layTagQuaNutCopy();
    if (tagCopy) return { tagText: tagCopy, nguon: 'nút Copy', loiApi: ketQuaApi.loi };

    return { tagText: '', nguon: '', loiApi: ketQuaApi.loi };
  }

  // Ham dung chung: lay tieu de + tag, va CHI tai anh full size (tung file rieng) neu coTaiAnh = true
  async function layVaLuuDuLieu(coTaiAnh = true) {
    const tieuDe = layTieuDe() || '';
    const daLuuTieuDe = !!tieuDe;
    if (daLuuTieuDe) {
      console.log('[Etsy Auto] Tiêu đề lấy được:', tieuDe);
    } else {
      console.warn('[Etsy Auto] KHÔNG tìm thấy tiêu đề trên trang này (kiểm tra lại selector h1)');
    }

    // Lay them o ca nhan hoa (neu listing co) — dung cho ca Alt+G va Alt+C
    const perso = layThongTinCaNhanHoa();
    const coPerso = !!perso.nhan;
    const ghiChuPerso = coPerso ? ' + cá nhân hoá' : '';

    // Quet anh MOT LAN roi dung chung cho ca 2 viec: tai xuong may va luu lai de trang chinh sua
    // tu upload lai. Ca Alt+G va Alt+C deu luu, nen chi "Chỉ lấy dữ liệu" van upload anh duoc.
    const ketQuaAnh = layDanhSachAnhFullSize();
    luuAnhNguon(tieuDe, ketQuaAnh.danhSach);

    // Chi tai anh full size (tung file rieng) neu coTaiAnh = true (chay nen, khong lien quan clipboard)
    if (coTaiAnh) {
      taiTungAnhRieng(tieuDe, ketQuaAnh).catch((loi) => {
        console.error('[Etsy Auto] Lỗi khi tải ảnh:', loi);
        hienThongBao('❌ Lỗi khi tải ảnh: ' + loi.message, '#DC2626');
      });
    }

    const { tagText, nguon: nguonTag, loiApi } = await layTag();
    if (tagText) {
      console.log(`[Etsy Auto] Tag lấy được (${nguonTag}):`, tagText);
    }

    const ok = await ghiClipboard(taoGoiDuLieu(tieuDe, tagText, perso, ketQuaAnh.danhSach));
    if (!ok) {
      hienThongBao('❌ Không ghi được vào Clipboard', '#DC2626');
      return;
    }

    const soAnhNho = ketQuaAnh.danhSach.length;
    const ghiChuAnh =
      (coTaiAnh ? ', đang tải ảnh full size' : '') + (soAnhNho ? ` (đã nhớ ${soAnhNho} ảnh để tự upload)` : '');
    const ghiChuNguon = tagText ? ` [${nguonTag}]` : '';

    if (daLuuTieuDe && tagText) {
      hienThongBao(`✅ Đã lấy tiêu đề + tag${ghiChuNguon}${ghiChuPerso}${ghiChuAnh}!`, '#16A34A');
    } else if (daLuuTieuDe) {
      // Hien DUNG ly do API that bai thay vi doan mo "chua co API key?"
      hienThongBao(
        `⚠️ Đã lấy tiêu đề${ghiChuPerso}${ghiChuAnh} nhưng KHÔNG lấy được tag — ${loiApi || 'không rõ nguyên nhân, xem Console'}`,
        '#F59E0B'
      );
    } else if (tagText) {
      hienThongBao(`⚠️ Đã lấy tag${ghiChuNguon}${ghiChuPerso}${ghiChuAnh}, nhưng KHÔNG tìm thấy tiêu đề!`, '#DC2626');
    } else {
      hienThongBao('❌ Không tìm thấy tiêu đề/tag trên trang này', '#DC2626');
    }
  }

  // Nut "Lay du lieu + tai anh": co tai anh full size (tung file rieng, khong nen zip)
  function layVaTaiAnh() {
    return layVaLuuDuLieu(true);
  }

  // Nut "Chi lay tieu de + tag": KHONG tai anh
  function chiLayTieuDeVaTag() {
    return layVaLuuDuLieu(false);
  }

  // ================== BUOC 2: TU DONG TIM O TIEU DE / O TAG / TAB PHOTO & VIDEO (trang draft) ==================

  function timOTieuDe() {
    let el = document.querySelector(
      '#listing-title-input, input[name="title"], textarea[name="title"], input[id*="title-input" i], textarea[id*="title-input" i]'
    );
    if (el) return el;

    const label = [...document.querySelectorAll('label')].find((l) => {
      const t = l.textContent.trim().toLowerCase();
      return t === 'title' || t === 'add title';
    });
    if (label) {
      const forId = label.getAttribute('for');
      if (forId) {
        el = document.getElementById(forId);
        if (el) return el;
      }
    }

    const nhan = [...document.querySelectorAll('h2, h3, label, span, div')].find(
      (x) => x.children.length === 0 && /^title\s*\*?$/i.test(x.textContent.trim())
    );
    if (nhan) {
      let khuVuc = nhan.parentElement;
      for (let i = 0; i < 4 && khuVuc; i++) {
        const input = khuVuc.querySelector('input[type="text"], textarea');
        if (input) return input;
        khuVuc = khuVuc.parentElement;
      }
    }
    return null;
  }

  function timOTag() {
    const input =
      document.getElementById('listing-tags-input') ||
      document.querySelector('input[id*="tags-input" i], input[placeholder*="Shape, color, style" i]');
    if (!input) return { input: null, nutAdd: null };

    let khuVuc = input.closest('fieldset') || input.parentElement;
    let nutAdd = null;
    for (let i = 0; i < 4 && khuVuc && !nutAdd; i++) {
      nutAdd = [...khuVuc.querySelectorAll('button, a, span')].find(
        (el) => el.textContent.trim().toLowerCase() === 'add'
      );
      khuVuc = khuVuc.parentElement;
    }
    return { input, nutAdd };
  }

  // ---- Cac phan tu cua luong "Custom options > Add field > Text box" ----

  // Nut "+ Add field" o muc Custom options
  function timNutAddField() {
    return [...document.querySelectorAll('button')].find(
      (b) => /^\+?\s*add field$/i.test(b.textContent.trim()) && !b.disabled
    );
  }

  // Muc trong menu vua xo ra o phan "Create new" — "Text box" hoac "List of options".
  // Khop CHINH XAC chu hien thi de khong bat nham cac muc "reusable field" phia tren
  // (nhung muc do hay co ten gan giong nhu "Personalization").
  function timMucTaoMoi(tenMuc) {
    const ten = tenMuc.toLowerCase();
    const cacMuc = [...document.querySelectorAll('[role="menuitem"], button.wt-options__item')];
    return cacMuc.find(
      (muc) =>
        muc.getAttribute('aria-disabled') !== 'true' &&
        [...muc.querySelectorAll('*')].some(
          (x) => x.children.length === 0 && x.textContent.trim().toLowerCase() === ten
        )
    );
  }

  // O nhap tung lua chon trong hop thoai "List of options"
  function timOLuaChon() {
    return document.querySelector(
      '#field-personalizationQuestions-options, input[name="label"], [data-testid="personalization-questions-question-options-textarea"]'
    );
  }

  // Nut "Add" ben canh o nhap lua chon (bi khoa khi o con trong)
  function timNutThemLuaChon() {
    const o = timOLuaChon();
    if (!o) return null;
    const nhom = o.closest('.wt-input__btn-input-group') || o.parentElement;
    for (let khuVuc = nhom, i = 0; khuVuc && i < 3; khuVuc = khuVuc.parentElement, i++) {
      const nut = [...khuVuc.querySelectorAll('button')].find(
        (b) => b.textContent.trim().toLowerCase() === 'add' && !b.disabled
      );
      if (nut) return nut;
    }
    return null;
  }

  // Go 1 lua chon vao o roi bam Add. Tra ve true neu Etsy da nhan (o tu xoa trang sau khi them).
  async function themMotLuaChon(giaTri) {
    const o = timOLuaChon();
    if (!o) return false;

    o.focus();
    setNativeValue(o, giaTri);
    await cho(200);

    const nut = timNutThemLuaChon();
    if (nut) nut.click();
    else guiPhimEnter(o); // du phong khi khong thay nut Add

    // Etsy xoa trang o nhap sau khi them thanh cong -> dung lam dau hieu xac nhan
    const daThem = await doiPhanTu(() => (timOLuaChon() && timOLuaChon().value === '' ? true : null), 2000);
    if (!daThem) {
      console.warn('[Etsy Auto] Có thể chưa thêm được lựa chọn:', giaTri);
      return false;
    }
    return true;
  }

  // O "Field title" trong hop thoai "Add text box"
  function timOFieldTitle() {
    return document.querySelector(
      '#field-personalizationQuestions-questionText, input[name="questionText"], [data-testid="personalization-questions-question-text-textarea"]'
    );
  }

  // O "Instructions" trong hop thoai "Add text box"
  function timOInstructions() {
    return document.querySelector(
      '#field-personalizationQuestions-instructions, textarea[name="instructions"], [data-testid="personalization-questions-instructions-textarea"]'
    );
  }

  // Phan tu co dang hien tren man hinh khong.
  // Dung getClientRects thay cho offsetParent vi hop thoai thuong la position:fixed
  // -> offsetParent cua no luon la null du dang hien ro rang.
  function dangHienThi(el) {
    return !!el && el.getClientRects().length > 0;
  }

  // Danh sach CAC hop thoai dang mo. Trang chinh sua Etsy co san nhieu hop thoai an san,
  // neu chi lay cai dau tien bang querySelector thi rat de bat nham cai an -> khong thay nut Done.
  function layCacHopThoaiDangMo() {
    const cacHopThoai = [...document.querySelectorAll('[data-clg-id="WtDialog"], [role="dialog"], .wt-dialog')];
    return cacHopThoai.filter(dangHienThi);
  }

  // Nut "Done" o cuoi hop thoai (bi khoa cho toi khi Field title co chu)
  function timNutDone() {
    const cacHopThoai = layCacHopThoaiDangMo();
    const cacGoc = cacHopThoai.length ? cacHopThoai : [document];

    // 1) Uu tien nut primary nam trong phan footer cua hop thoai (theo dung cau truc DOM cua Etsy)
    for (const goc of cacGoc) {
      const nut = goc.querySelector(
        '[data-clg-id="WtDialogFooter"] button.wt-btn--primary, .wt-dialog__footer__container__buttons button.wt-btn--primary'
      );
      if (nut && !nut.disabled) return nut;
    }

    // 2) Du phong: bat ky nut nao hien chu "Done"
    for (const goc of cacGoc) {
      const nut = [...goc.querySelectorAll('button')].find(
        (b) => b.textContent.trim().toLowerCase() === 'done' && !b.disabled
      );
      if (nut) return nut;
    }
    return null;
  }

  // Hop thoai "Add text box" con dang mo hay khong (dua vao o Field title)
  function hopThoaiTextBoxDangMo() {
    return dangHienThi(timOFieldTitle());
  }

  // Bam nut bang CHUOI SU KIEN CHUOT day du. Mot so nut cua Etsy nghe pointerdown/mousedown
  // chu khong chi nghe click, nen goi .click() don thuan co the khong an gi.
  function bamBangChuoiSuKien(el) {
    const chung = { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 };
    try {
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
    } catch (e) {
      /* noop */
    }
    const coPointer = typeof PointerEvent === 'function';
    if (coPointer) el.dispatchEvent(new PointerEvent('pointerdown', chung));
    el.dispatchEvent(new MouseEvent('mousedown', chung));
    if (typeof el.focus === 'function') el.focus();
    if (coPointer) el.dispatchEvent(new PointerEvent('pointerup', { ...chung, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...chung, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('click', { ...chung, buttons: 0 }));
  }

  // Bam "Done" va KIEM TRA hop thoai da dong that chua. Neu chua, thu tiep cach khac.
  // Chi leo thang sang cach manh hon khi cach truoc that bai -> khong bao gio bam Done 2 lan.
  async function bamNutDoneChacChan() {
    const cacCachBam = [
      (nut) => nut.click(),
      (nut) => bamBangChuoiSuKien(nut),
      (nut) => {
        const benTrong = nut.querySelector('*');
        (benTrong || nut).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      },
    ];

    for (const cachBam of cacCachBam) {
      const nut = await doiPhanTu(timNutDone, 3000);
      if (!nut) break;
      cachBam(nut);
      const daDong = await doiPhanTu(() => (hopThoaiTextBoxDangMo() ? null : true), 2500);
      if (daDong) {
        return true;
      }
      console.warn('[Etsy Auto] Hộp thoại vẫn mở sau khi bấm Done, thử cách bấm khác...');
    }
    return !hopThoaiTextBoxDangMo();
  }

  // Tim va bam vao tab "Photo & Video" (thuong la tab dau tien, co href chua #media)
  function timVaBamTabPhotoVideo() {
    // Uu tien tim theo href chua #media trong khu vuc menu tab
    let tab = document.querySelector('nav[data-clg-id="WtExternalTabList"] a[href*="#media"]');

    // Du phong: tim theo chu hien thi la "Photo & Video" ben trong cac tab
    if (!tab) {
      tab = [...document.querySelectorAll('nav a, li a')].find(
        (el) => el.textContent.trim().toLowerCase() === 'photo & video'
      );
    }

    if (tab) {
      tab.click();
      return true;
    }
    console.warn('[Etsy Auto] KHÔNG tìm thấy tab Photo & Video');
    return false;
  }

  function guiPhimEnter(el) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  }

  // ================== BUOC 3: DAN DU LIEU (doc lai tu Clipboard) ==================

  // Dan tieu de. Tra ve true/false de ham gop biet co thanh cong khong.
  function danTieuDeNoiBo(tieuDe) {
    const el = timOTieuDe();
    if (!el) {
      return { ok: false, ly_do: '⚠️ Không tìm thấy ô Tiêu đề trên trang này' };
    }
    if (!tieuDe) {
      return { ok: false, ly_do: '⚠️ Clipboard chưa có tiêu đề' };
    }
    el.focus();
    setNativeValue(el, tieuDe);
    return { ok: true };
  }

  // Dan tag. Tra ve true/false de ham gop biet co thanh cong khong.
  async function danTagNoiBo(tagText) {
    const { input, nutAdd } = timOTag();
    if (!input) {
      return { ok: false, ly_do: '⚠️ Không tìm thấy ô Tag trên trang này' };
    }
    if (!tagText) {
      return { ok: false, ly_do: '⚠️ Clipboard chưa có tag' };
    }

    // Chuan hoa lai chuoi tag (bo khoang trang thua giua cac tag, gioi han 13 tag)
    // roi dan CA CUM vao o 1 lan, Etsy se tu tach thanh nhieu tag khi bam Add
    const danhSachTag = tagText
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 13);

    if (danhSachTag.length === 0) {
      return { ok: false, ly_do: '⚠️ Dữ liệu tag trong Clipboard bị rỗng' };
    }

    const cumTag = danhSachTag.join(', ');

    input.focus();
    setNativeValue(input, cumTag);
    await cho(200);

    if (nutAdd) {
      nutAdd.click();
    } else {
      guiPhimEnter(input);
    }
    await cho(300);

    return { ok: true, soLuong: danhSachTag.length };
  }

  // Dan phan ca nhan hoa: bam "Add field" -> chon "Text box" -> dien Field title + Instructions -> bam "Done"
  async function danCaNhanHoaNoiBo(nhan, huongDan, cacLuaChon) {
    if (!nhan) {
      return { boQua: true, ok: false, ly_do: 'ℹ️ Clipboard không có dữ liệu cá nhân hoá' };
    }

    // Co danh sach lua chon -> ben nguon la dropdown -> ben dich phai chon "List of options"
    const laDropdown = Array.isArray(cacLuaChon) && cacLuaChon.length > 0;
    const tenMuc = laDropdown ? 'List of options' : 'Text box';

    const nutAddField = timNutAddField();
    if (!nutAddField) {
      return { ok: false, ly_do: '⚠️ Không tìm thấy nút "Add field" (mở tab Item Options trước)' };
    }
    nutAddField.click();

    const muc = await doiPhanTu(() => timMucTaoMoi(tenMuc), 5000);
    if (!muc) {
      return { ok: false, ly_do: `⚠️ Không tìm thấy mục "${tenMuc}" trong menu Add field` };
    }
    muc.click();

    const oNhan = await doiPhanTu(timOFieldTitle, 5000);
    if (!oNhan) {
      return { ok: false, ly_do: `⚠️ Không mở được hộp thoại "${tenMuc}"` };
    }

    // Etsy gioi han 45 ky tu cho Field title -> cat bot cho vua
    const nhanCat = nhan.slice(0, GIOI_HAN_NHAN_FIELD);
    if (nhanCat.length < nhan.length) {
      console.warn(`[Etsy Auto] Field title bị cắt còn ${GIOI_HAN_NHAN_FIELD} ký tự:`, nhanCat);
    }
    oNhan.focus();
    setNativeValue(oNhan, nhanCat);
    await cho(250);

    let ghiChu = '';

    if (laDropdown) {
      // Hop thoai "List of options" KHONG co o Instructions, thay vao do la o nhap tung lua chon:
      // go 1 lua chon roi bam Add, lap lai cho tung cai.
      const oLuaChon = await doiPhanTu(timOLuaChon, 4000);
      if (!oLuaChon) {
        return { ok: false, daDien: true, ly_do: '⚠️ Không tìm thấy ô nhập Options' };
      }

      const danhSach = cacLuaChon.slice(0, GIOI_HAN_LUA_CHON);
      let daThem = 0;
      for (const luaChon of danhSach) {
        if (await themMotLuaChon(luaChon.slice(0, GIOI_HAN_NHAN_FIELD))) daThem++;
      }
      console.log(`[Etsy Auto] Đã thêm ${daThem}/${danhSach.length} lựa chọn`);

      if (daThem === 0) {
        return { ok: false, daDien: true, ly_do: '⚠️ Không thêm được lựa chọn nào' };
      }
      ghiChu = ` (${daThem} lựa chọn)`;
    } else {
      const oHuongDan = timOInstructions();
      if (oHuongDan && huongDan) {
        const huongDanCat = huongDan.slice(0, GIOI_HAN_HUONG_DAN_FIELD);
        if (huongDanCat.length < huongDan.length) {
          console.warn(`[Etsy Auto] Instructions bị cắt còn ${GIOI_HAN_HUONG_DAN_FIELD} ký tự:`, huongDanCat);
        }
        oHuongDan.focus();
        setNativeValue(oHuongDan, huongDanCat);
        await cho(250);
      }
    }

    const daBamDone = await bamNutDoneChacChan();
    if (!daBamDone) {
      return { ok: false, daDien: true, ly_do: '⚠️ Đã điền xong nhưng KHÔNG bấm được "Done", hãy bấm tay' };
    }
    await cho(300);

    return { ok: true, laDropdown, ghiChu };
  }

  // Ham gop: doc Clipboard 1 lan roi dan ca tieu de va tag, sau do tu dong bam tab Photo & Video
  async function danTieuDeVaTag() {
    const { tieuDe, tagText, persoNhan, persoHuongDan, persoLuaChon, danhSachAnh, dauLa } = tachDuLieu(
      await docClipboard()
    );

    // Chan ngay: dan tiep se nhoi chuoi ky thuat vao o cua Etsy, hong du lieu that
    if (dauLa) {
      hienThongBao(
        `❌ Clipboard tạo bởi bản script MỚI HƠN bản đang chạy ở trang này (${PHIEN_BAN}). ` +
          'Hãy cập nhật script ở đây rồi lấy lại dữ liệu — xem Console để biết chi tiết.',
        '#DC2626'
      );
      return;
    }

    if (!tieuDe && !tagText) {
      hienThongBao('⚠️ Clipboard chưa có dữ liệu. Hãy chạy Alt+G trên trang nguồn trước rồi copy sang trình duyệt này', '#DC2626');
      return;
    }

    hienThongBao('⏳ Đang dán tiêu đề + tag...', '#2563EB');

    // Chuyen danh sach anh tu Clipboard sang kho cua TRINH DUYET NAY, truoc khi Clipboard bi
    // rut gon lai con moi tieu de o cuoi ham. Nho vay Alt+U sau do van co anh de upload
    // du trang nguon mo o mot trinh duyet khac.
    if (danhSachAnh && danhSachAnh.length) {
      luuAnhNguon(tieuDe, danhSachAnh);
      console.log(`[Etsy Auto] Đã nhận ${danhSachAnh.length} ảnh từ Clipboard, sẵn sàng cho Alt+U`);
    }

    const ketQuaTieuDe = danTieuDeNoiBo(tieuDe);
    const ketQuaTag = await danTagNoiBo(tagText);

    // Neu clipboard co du lieu ca nhan hoa thi tao them 1 Custom option dang Text box.
    // Boc trong try/catch de mot loi o day KHONG lam chet ca ham (truoc day loi o buoc nay
    // se lam bo qua luon phan bam tab va phan chuan hoa lai Clipboard).
    let ketQuaPerso = { boQua: true, ok: false, ly_do: '' };
    if (persoNhan) {
      const tenKieu = persoLuaChon && persoLuaChon.length ? 'List of options' : 'Text box';
      hienThongBao(`⏳ Đang tạo ô cá nhân hoá (Add field → ${tenKieu})...`, '#2563EB');
      try {
        ketQuaPerso = await danCaNhanHoaNoiBo(persoNhan, persoHuongDan, persoLuaChon);
      } catch (loi) {
        console.error('[Etsy Auto] Lỗi khi tạo ô cá nhân hoá:', loi);
        ketQuaPerso = { boQua: false, ok: false, ly_do: '❌ Lỗi khi tạo ô cá nhân hoá: ' + loi.message };
      }
    }

    // Ghi de Clipboard he thong: chi con lai TIEU DE (bo tag + ca nhan hoa + cac ky tu ngan cach),
    // de sau do bam Ctrl+V thuong o bat ky o nao khac se dan duoc rieng tieu de.
    // Chay NGAY sau khi da dan xong du lieu (tag va ca nhan hoa deu doc tu bien trong bo nho,
    // khong con can Clipboard nua), de buoc nay khong bao gio bi bo qua vi loi o cac buoc sau.
    let daGiuLaiTieuDe = false;
    if (tieuDe) {
      daGiuLaiTieuDe = await ghiClipboard(tieuDe);
      if (!daGiuLaiTieuDe) console.warn('[Etsy Auto] KHÔNG ghi lại được Clipboard');
    }

    // Sau khi dan xong (it nhat 1 phan thanh cong), doi 1 chut roi tu dong bam vao tab "Photo & Video".
    // Neu hop thoai ca nhan hoa con dang mo (chua bam duoc Done) thi KHONG bam tab,
    // vi hop thoai dang chan ca trang -> bam cung khong an gi.
    let daBamTab = false;
    if (ketQuaTieuDe.ok || ketQuaTag.ok || ketQuaPerso.ok) {
      if (hopThoaiTextBoxDangMo()) {
        console.warn('[Etsy Auto] Hộp thoại cá nhân hoá còn mở nên KHÔNG bấm tab Photo & Video');
      } else {
        await cho(300);
        daBamTab = timVaBamTabPhotoVideo();
      }
    }

    // Ghi chu them ve phan ca nhan hoa (chi hien khi clipboard co du lieu ca nhan hoa)
    const ghiChuPerso = ketQuaPerso.boQua
      ? ''
      : ketQuaPerso.ok
        ? ` + ô cá nhân hoá${ketQuaPerso.ghiChu || ''}`
        : ` — ${ketQuaPerso.ly_do}`;
    const ghiChuTab = daBamTab ? ' → đã mở Photo & Video' : '';
    const ghiChuAnhNhan = danhSachAnh && danhSachAnh.length ? ` (có ${danhSachAnh.length} ảnh, bấm Alt+U để upload)` : '';
    const ghiChuClipboard = daGiuLaiTieuDe ? ' (Clipboard giữ lại tiêu đề)' : '';
    const persoOn = ketQuaPerso.boQua || ketQuaPerso.ok;

    if (ketQuaTieuDe.ok && ketQuaTag.ok) {
      hienThongBao(
        `✅ Đã dán tiêu đề + ${ketQuaTag.soLuong} tag${ghiChuPerso}${ghiChuTab}${ghiChuClipboard}${ghiChuAnhNhan}`,
        persoOn ? '#16A34A' : '#F59E0B'
      );
    } else if (ketQuaTieuDe.ok) {
      hienThongBao(`✅ Đã dán tiêu đề${ghiChuPerso}${ghiChuTab}. ${ketQuaTag.ly_do}`, '#DC2626');
    } else if (ketQuaTag.ok) {
      hienThongBao(`✅ Đã dán ${ketQuaTag.soLuong} tag${ghiChuPerso}${ghiChuTab}. ${ketQuaTieuDe.ly_do}`, '#DC2626');
    } else {
      hienThongBao(`❌ ${ketQuaTieuDe.ly_do} | ${ketQuaTag.ly_do}${ghiChuPerso}`, '#DC2626');
    }

    // Dan xong thi tu chay luon buoc upload anh (gop chung vao Alt+V, khong con nut/phim rieng).
    // Doi them 1 chut de tab "Photo & Video" (vua bam o tren, neu co) kip ve xong o upload.
    if (danhSachAnh && danhSachAnh.length) {
      await cho(500);
      try {
        await tuUploadAnh();
      } catch (loi) {
        console.error('[Etsy Auto] Lỗi khi upload ảnh:', loi);
        hienThongBao('❌ Lỗi khi upload ảnh: ' + loi.message, '#DC2626');
      }
    }
  }

  // ================== TU DONG UPLOAD ANH NGUON LEN TRANG CHINH SUA ==================

  // Y tuong: o trang nguon (Alt+G / Alt+C) script da biet dung danh sach anh full size cua listing.
  // Thay vi bat nguoi dung tai 10 file xuong may roi tu chon lai tung file trong hop thoai He dieu
  // hanh, script GIU danh sach do lai, sang trang chinh sua thi tu tai bytes ve (GM_xmlhttpRequest,
  // khong ton request API cua Etsy) va NHOI THANG vao <input type="file"> bang DataTransfer.
  // Trinh duyet coi day y het nhu nguoi dung vua chon file, nen Etsy upload binh thuong.

  // Nhan danh sach anh tu 2 nguon co dinh dang khac nhau:
  //   - trang nguon      -> { url, alt }        (co chu alt, tu suy ra co bang size)
  //   - goi tu Clipboard -> { url, bang: bool } (chi con co, alt da bo di cho gon)
  // nen chuan hoa ve mot dang duy nhat { url, alt, bang } truoc khi luu.
  function luuAnhNguon(tieuDe, danhSach) {
    if (!danhSach || !danhSach.length) return;
    try {
      luuGiaTri(
        KHOA_ANH_NGUON,
        JSON.stringify({
          tieuDe: tieuDe || '',
          listingId: layListingId() || '',
          thoiDiem: Date.now(),
          anh: danhSach.map((a) => ({
            url: a.url,
            alt: a.alt || '',
            bang: typeof a.bang === 'boolean' ? a.bang : laAnhBangSize(a.alt),
          })),
        })
      );
    } catch (e) {
      console.warn('[Etsy Auto] Không lưu được danh sách ảnh nguồn:', e);
    }
  }

  // Lay danh sach anh cho Alt+U: uu tien kho cua trinh duyet nay, khong co thi doc thang Clipboard.
  // Duong Clipboard la cai cuu duoc truong hop trang nguon va trang chinh sua o HAI TRINH DUYET
  // khac nhau va nguoi dung chua bam Alt+V o day.
  async function layAnhNguonMoiNoi() {
    const daCo = docAnhNguon();
    if (daCo) return daCo;

    const { tieuDe, danhSachAnh } = tachDuLieu(await docClipboard());
    if (danhSachAnh && danhSachAnh.length) {
      console.log(`[Etsy Auto] Kho ảnh trống, lấy ${danhSachAnh.length} ảnh thẳng từ Clipboard`);
      luuAnhNguon(tieuDe, danhSachAnh);
      return docAnhNguon();
    }
    return null;
  }

  function docAnhNguon() {
    try {
      const goi = JSON.parse(docGiaTriLuu(KHOA_ANH_NGUON) || 'null');
      if (goi && Array.isArray(goi.anh) && goi.anh.length) return goi;
    } catch (e) {
      console.warn('[Etsy Auto] Không đọc được danh sách ảnh nguồn:', e);
    }
    return null;
  }

  // Doan alt cua Etsy cho anh bang size, vi du "... size chart", "Sizing guide".
  // Chi la GOI Y (tu bo tick san) — nguoi dung van tick lai duoc trong bang chon.
  function laAnhBangSize(alt) {
    return RE_ANH_BANG_SIZE.test(alt || '');
  }

  // Doi link full size -> link thumbnail nho de ve bang chon cho nhe (khong tai anh goc nhieu MB)
  function linhThuNho(url) {
    return url.replace('il_fullxfull', 'il_180x135');
  }

  // Con bao nhieu cho trong cho anh moi? Doc thang tu trang, vi Etsy da doi gioi han
  // (10 -> 20 anh) va co the con doi nua — han so cung trong script se sai am tham.
  function laySoAnhConLai(soAnhDangCo) {
    // Cach 1 (chac nhat): o "Add photos" tu ghi "N remaining".
    // Lay phan tu co text NGAN NHAT trong so cac phan tu khop, de bat dung o do chu khong
    // phai mot khoi cha to dung chua ca "Add videos ... 2 remaining".
    const cacUngVien = [...document.querySelectorAll('div, button, label, span')].filter(
      (el) => /add\s+photos/i.test(el.textContent) && /\d+\s*remaining/i.test(el.textContent)
    );
    if (cacUngVien.length) {
      const goNhat = cacUngVien.reduce((a, b) => (b.textContent.length < a.textContent.length ? b : a));
      const khop = goNhat.textContent.match(/(\d+)\s*remaining/i);
      if (khop) return Number(khop[1]);
    }

    // Cach 2: dong "Add up to N photos and M videos" o dau muc
    const khopTong = document.body.textContent.match(/add\s+up\s+to\s+(\d+)\s+photos?/i);
    if (khopTong) return Math.max(0, Number(khopTong[1]) - soAnhDangCo);

    // Cach 3: phao cuoi
    return Math.max(0, GIOI_HAN_ANH_MAC_DINH - soAnhDangCo);
  }

  // ---- Thu vien anh bang size cua nguoi dung ----

  function docThuVienBangSize() {
    try {
      const ds = JSON.parse(docGiaTriLuu(KHOA_THU_VIEN_BANG_SIZE) || '[]');
      return Array.isArray(ds) ? ds.filter((x) => x && typeof x.url === 'string') : [];
    } catch (e) {
      console.warn('[Etsy Auto] Không đọc được thư viện ảnh bảng size:', e);
      return [];
    }
  }

  function luuThuVienBangSize(danhSach) {
    luuGiaTri(KHOA_THU_VIEN_BANG_SIZE, JSON.stringify(danhSach));
  }

  // Hop thoai them/xoa/sap xep danh sach anh bang size. Sap xep bang nut Len/Xuong (khong dung
  // keo-tha) vi day la thao tac tay, khong can dnd-kit — tranh moi lien quan toi gioi han
  // isTrusted da gap o buoc sap xep luoi anh chinh.
  function moQuanLyBangSize() {
    return new Promise((resolve) => {
      let danhSach = docThuVienBangSize();

      const lop = document.createElement('div');
      lop.style.cssText = `
        position:fixed; inset:0; z-index:1000001; background:rgba(17,24,39,.6);
        display:flex; align-items:center; justify-content:center; font-family:sans-serif;
      `;

      const hop = document.createElement('div');
      hop.style.cssText = `
        background:#fff; border-radius:12px; width:min(520px,94vw); max-height:88vh;
        display:flex; flex-direction:column; overflow:hidden; box-shadow:0 12px 40px rgba(0,0,0,.35);
      `;

      hop.innerHTML = `
        <div style="background:linear-gradient(135deg,#7C3AED,#A78BFA);color:#fff;padding:12px 16px;font-weight:bold;font-size:15px;">
          📐 Quản lý ảnh bảng size
        </div>
        <div style="padding:10px 16px;font-size:12px;color:#374151;border-bottom:1px solid #E5E7EB;line-height:1.6;">
          Danh sách này dùng chung cho <b>mọi lần upload</b> sau này. Mỗi khi dán dữ liệu (Alt+V) có
          kèm ảnh, các ảnh dưới đây sẽ được tự thêm vào <b>sau cùng</b> ảnh sản phẩm, đúng theo thứ
          tự đã sắp ở đây.
        </div>
        <div id="ea-bs-luoi" style="padding:10px 16px;overflow:auto;flex:1;"></div>
        <div style="padding:10px 16px;border-top:1px solid #E5E7EB;display:flex;gap:8px;">
          <input id="ea-bs-input" type="text" placeholder="Dán link ảnh (https://...)" style="flex:1;padding:8px 10px;border:1px solid #D1D5DB;border-radius:6px;font-size:12px;">
          <button id="ea-bs-them" style="padding:8px 14px;background:#7C3AED;color:#fff;border:none;border-radius:6px;font-weight:bold;cursor:pointer;">Thêm</button>
        </div>
        <div style="padding:12px 16px;border-top:1px solid #E5E7EB;text-align:right;">
          <button id="ea-bs-dong" style="padding:8px 16px;background:#F56400;color:#fff;border:none;border-radius:6px;font-weight:bold;cursor:pointer;">Xong</button>
        </div>
      `;

      lop.appendChild(hop);
      document.body.appendChild(lop);

      const luoi = hop.querySelector('#ea-bs-luoi');
      const oInput = hop.querySelector('#ea-bs-input');

      function ve() {
        if (!danhSach.length) {
          luoi.innerHTML = `<div style="padding:24px 8px;text-align:center;color:#9CA3AF;font-size:12px;">
            Chưa có ảnh bảng size nào. Dán link vào ô dưới rồi bấm "Thêm".
          </div>`;
          return;
        }
        luoi.innerHTML = danhSach
          .map(
            (a, i) => `
          <div style="display:flex;align-items:center;gap:8px;padding:6px;border:1px solid #E5E7EB;border-radius:8px;margin-bottom:6px;">
            <img src="${a.url.replace(/"/g, '&quot;')}" style="width:44px;height:44px;object-fit:cover;border-radius:4px;flex-shrink:0;background:#F3F4F6;" loading="lazy" onerror="this.style.opacity='.25'">
            <div style="flex:1;min-width:0;font-size:11px;color:#374151;word-break:break-all;">${a.url.replace(/</g, '&lt;')}</div>
            <button data-act="len" data-i="${i}" title="Lên" ${i === 0 ? 'disabled' : ''} style="width:24px;height:24px;border:1px solid #D1D5DB;border-radius:4px;background:#fff;cursor:pointer;flex-shrink:0;">↑</button>
            <button data-act="xuong" data-i="${i}" title="Xuống" ${i === danhSach.length - 1 ? 'disabled' : ''} style="width:24px;height:24px;border:1px solid #D1D5DB;border-radius:4px;background:#fff;cursor:pointer;flex-shrink:0;">↓</button>
            <button data-act="xoa" data-i="${i}" title="Xoá" style="width:24px;height:24px;border:1px solid #FCA5A5;border-radius:4px;background:#FEF2F2;color:#DC2626;cursor:pointer;flex-shrink:0;">✕</button>
          </div>`
          )
          .join('');
      }
      ve();

      luoi.addEventListener('click', (e) => {
        const nut = e.target.closest('button[data-act]');
        if (!nut) return;
        const i = Number(nut.dataset.i);
        if (nut.dataset.act === 'xoa') {
          danhSach.splice(i, 1);
        } else if (nut.dataset.act === 'len' && i > 0) {
          [danhSach[i - 1], danhSach[i]] = [danhSach[i], danhSach[i - 1]];
        } else if (nut.dataset.act === 'xuong' && i < danhSach.length - 1) {
          [danhSach[i + 1], danhSach[i]] = [danhSach[i], danhSach[i + 1]];
        }
        luuThuVienBangSize(danhSach);
        ve();
      });

      function themTuO() {
        const url = oInput.value.trim();
        if (!url) return;
        if (!/^https?:\/\//i.test(url)) {
          hienThongBao('⚠️ Link ảnh phải bắt đầu bằng http:// hoặc https://', '#DC2626');
          return;
        }
        // Script chi duoc cap quyen GM_xmlhttpRequest toi i.etsystatic.com va openapi.etsy.com
        // (xem @connect trong header) — anh o domain khac se tai LOI khi upload. Chi canh bao,
        // van cho them (nguoi dung co the dang chuan bi danh sach truoc khi xin them quyen).
        if (!/^https?:\/\/i\.etsystatic\.com\//i.test(url)) {
          hienThongBao(
            '⚠️ Đã thêm, nhưng link này không thuộc i.etsystatic.com — script chưa được cấp quyền ' +
              'tải ảnh từ domain khác nên lúc upload có thể sẽ lỗi. Xem README nếu muốn dùng domain khác.',
            '#F59E0B'
          );
        }
        danhSach.push({ url });
        luuThuVienBangSize(danhSach);
        oInput.value = '';
        ve();
      }
      hop.querySelector('#ea-bs-them').onclick = themTuO;
      oInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          themTuO();
        }
      });

      const dong = () => {
        lop.remove();
        resolve();
      };
      hop.querySelector('#ea-bs-dong').onclick = dong;
      lop.addEventListener('click', (e) => {
        if (e.target === lop) dong();
      });
    });
  }

  // ---- Bang chon anh ----

  // Mo hop thoai cho nguoi dung tick lai truoc khi upload. Tra ve:
  //   { cacAnh: [{url, alt}], hanhDong: 'khong' | 'nhap' | 'publish' }  hoac null neu bam Huy.
  function moBangChonAnh(goi, soAnhDangCo, conLai, soBangSizeCoDinh = 0) {
    return new Promise((resolve) => {
      const lop = document.createElement('div');
      lop.style.cssText = `
        position:fixed; inset:0; z-index:1000000; background:rgba(17,24,39,.6);
        display:flex; align-items:center; justify-content:center; font-family:sans-serif;
      `;

      const hop = document.createElement('div');
      hop.style.cssText = `
        background:#fff; border-radius:12px; width:min(760px,94vw); max-height:88vh;
        display:flex; flex-direction:column; overflow:hidden; box-shadow:0 12px 40px rgba(0,0,0,.35);
      `;

      const conLaiGoc = conLai + soBangSizeCoDinh;

      hop.innerHTML = `
        <div style="background:linear-gradient(135deg,#F56400,#FF8C42);color:#fff;padding:12px 16px;font-weight:bold;font-size:15px;">
          🖼️ Chọn ảnh để tự upload
        </div>
        <div style="padding:10px 16px;font-size:12px;color:#374151;border-bottom:1px solid #E5E7EB;line-height:1.6;">
          Listing nguồn: <b>${(goi.tieuDe || '(không rõ tiêu đề)').replace(/</g, '&lt;').slice(0, 90)}</b><br>
          Listing này đang có <b>${soAnhDangCo}</b> ảnh, theo trang thì còn chỗ cho <b>${conLaiGoc}</b> ảnh nữa.
          Ảnh nghi là bảng size đã được bỏ tick sẵn.
          ${
            soBangSizeCoDinh > 0
              ? `<br>📐 Thư viện của bạn có <b>${soBangSizeCoDinh}</b> ảnh bảng size sẽ <b>tự thêm vào sau cùng</b>
                 (không cần chọn ở đây) — nên chỉ còn <b>${conLai}</b> chỗ cho ảnh sản phẩm chọn bên dưới.`
              : ''
          }
        </div>
        <div id="ea-up-luoi" style="padding:12px 16px;display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;overflow:auto;"></div>
        <div style="padding:10px 16px;border-top:1px solid #E5E7EB;font-size:12px;color:#374151;">
          ${
            soAnhDangCo > 0
              ? `<div style="margin-bottom:6px;padding:8px;background:#FFFBEB;border:1px solid #FDE68A;border-radius:6px;line-height:1.5;">
                   ⚠️ Ảnh mới sẽ được thêm vào <b>cuối</b> lưới — trình duyệt không cho phép script tự
                   sắp xếp lại vị trí ảnh (giới hạn bảo mật, không phải lỗi). Sau khi upload xong,
                   bạn <b>tự kéo ảnh lên đầu</b> (thường vài giây) rồi mới lưu.
                 </div>
                 <label style="display:block;cursor:pointer;"><input type="radio" name="ea-up-xong" value="khong" checked disabled> Dừng lại sau khi upload, tôi tự kéo ảnh + tự lưu</label>`
              : `<div style="margin-bottom:6px;font-weight:bold;">Sau khi upload xong:</div>
                 <label style="display:block;margin-bottom:3px;cursor:pointer;"><input type="radio" name="ea-up-xong" value="khong" checked> Dừng lại, tôi tự bấm lưu (an toàn nhất)</label>
                 <label style="display:block;margin-bottom:3px;cursor:pointer;"><input type="radio" name="ea-up-xong" value="nhap"> Bấm hộ <b>Save as draft</b></label>
                 <label style="display:block;cursor:pointer;"><input type="radio" name="ea-up-xong" value="publish"> Bấm hộ <b>Publish</b> — đăng bán công khai ngay, khó lùi lại</label>`
          }
        </div>
        <div style="padding:12px 16px;border-top:1px solid #E5E7EB;display:flex;justify-content:space-between;align-items:center;gap:10px;">
          <div id="ea-up-dem" style="font-size:12px;font-weight:bold;color:#374151;"></div>
          <div style="display:flex;gap:8px;">
            <button id="ea-up-huy" style="padding:8px 14px;background:#fff;color:#374151;border:1px solid #D1D5DB;border-radius:6px;cursor:pointer;">Huỷ</button>
            <button id="ea-up-ok" style="padding:8px 16px;background:#F56400;color:#fff;border:none;border-radius:6px;font-weight:bold;cursor:pointer;">Bắt đầu upload</button>
          </div>
        </div>
      `;

      lop.appendChild(hop);
      document.body.appendChild(lop);

      const luoi = hop.querySelector('#ea-up-luoi');
      const oDem = hop.querySelector('#ea-up-dem');
      const nutOk = hop.querySelector('#ea-up-ok');

      goi.anh.forEach((anh, i) => {
        const the = document.createElement('label');
        the.style.cssText = `
          display:block; border:2px solid #E5E7EB; border-radius:8px; overflow:hidden;
          cursor:pointer; position:relative; background:#F9FAFB;
        `;
        const nghiBangSize = typeof anh.bang === 'boolean' ? anh.bang : laAnhBangSize(anh.alt);
        the.innerHTML = `
          <img src="${linhThuNho(anh.url)}" style="width:100%;height:110px;object-fit:cover;display:block;" loading="lazy">
          <div style="padding:5px 6px;font-size:10px;color:#6B7280;line-height:1.3;height:30px;overflow:hidden;">
            ${nghiBangSize ? '⚠️ nghi là bảng size' : `#${i + 1}`}
          </div>
          <input type="checkbox" data-i="${i}" ${nghiBangSize ? '' : 'checked'}
            style="position:absolute;top:6px;left:6px;width:18px;height:18px;cursor:pointer;">
        `;
        luoi.appendChild(the);
      });

      const cacTick = [...luoi.querySelectorAll('input[type="checkbox"]')];

      const capNhatDem = () => {
        const soChon = cacTick.filter((t) => t.checked).length;
        const quaNhieu = soChon > conLai;
        oDem.textContent = quaNhieu
          ? `⚠️ Đang chọn ${soChon} ảnh nhưng chỉ còn chỗ cho ${conLai}`
          : `Đang chọn ${soChon} ảnh`;
        oDem.style.color = quaNhieu ? '#DC2626' : soChon === 0 ? '#DC2626' : '#374151';
        nutOk.disabled = quaNhieu || soChon === 0;
        nutOk.style.opacity = nutOk.disabled ? '.5' : '1';
        nutOk.style.cursor = nutOk.disabled ? 'not-allowed' : 'pointer';
        cacTick.forEach((t) => {
          t.closest('label').style.borderColor = t.checked ? '#F56400' : '#E5E7EB';
        });
      };
      cacTick.forEach((t) => t.addEventListener('change', capNhatDem));
      capNhatDem();

      const dong = (ketQua) => {
        lop.remove();
        resolve(ketQua);
      };

      hop.querySelector('#ea-up-huy').onclick = () => dong(null);
      lop.addEventListener('click', (e) => {
        if (e.target === lop) dong(null);
      });
      nutOk.onclick = () => {
        const hanhDong = hop.querySelector('input[name="ea-up-xong"]:checked').value;
        // Publish la thao tac dua listing ra ngoai, kho lui lai -> hoi lai them 1 lan cho chac
        if (hanhDong === 'publish' && !window.confirm('Chắc chắn ĐĂNG BÁN (Publish) listing này ngay sau khi upload xong?')) {
          return;
        }
        const cacAnh = cacTick.filter((t) => t.checked).map((t) => goi.anh[Number(t.dataset.i)]);
        dong({ cacAnh, hanhDong });
      };
    });
  }

  // ---- Tim o upload anh (khong phai o upload video) ----

  // Di len toi da 10 cap tim to tien co ID chua "image"/"photo" hoac "video" — dung ID vi no ON
  // DINH HON NHIEU so voi class: khi luoi anh CON TRONG (chua co anh nao), Etsy gop khu vuc upload
  // thanh 1 o "Drag and drop" duy nhat, input luc do KHONG CON thuoc tinh "accept" de phan biet
  // anh/video, va the CHA GAN NHAT co the mang class ten gay hieu lam (vi du class
  // "...video-multiple-upload-area" dung chung cho ca 2 loai field, khong co id). Di tiep len tren
  // se gap khoi CHA XA HON mang id rieng cho tung field (vi du id="field-listingImages"), dang tin
  // cay hon nhieu vi Etsy dat co chu dich, khong bi anh huong boi viec tai su dung component.
  function timTruongChaTheoId(el) {
    let vc = el.parentElement;
    for (let buoc = 0; vc && buoc < 10; buoc++) {
      if (vc.id) {
        const id = vc.id.toLowerCase();
        if (/video/.test(id)) return 'video';
        if (/image|photo/.test(id)) return 'image';
      }
      vc = vc.parentElement;
    }
    return null;
  }

  function timOChonAnhSanPham() {
    const cacO = [...document.querySelectorAll('input[type="file"]')];
    if (!cacO.length) return null;

    // Trang chinh sua co the co 2 o file (1 cho anh, 1 cho video) hoac chi 1 o gop chung (luc
    // luoi con trong). Cham diem de chon dung o anh trong ca 2 truong hop.
    let totNhat = null;
    let diemTotNhat = -Infinity;
    for (const o of cacO) {
      const accept = (o.getAttribute('accept') || '').toLowerCase();
      let diem = 0;
      if (/video|\.mp4|\.mov/.test(accept)) diem -= 100;
      if (/image|jpe?g|png|\.gif/.test(accept)) diem += 50;
      if (o.hasAttribute('multiple')) diem += 20;

      // Tin hieu MANH nhat: id cua khoi cha bao quanh (vd "field-listingImages"), uu tien hon
      // han class/chu xung quanh vi khong bi nham lan boi component tai su dung.
      const truongTheoId = timTruongChaTheoId(o);
      if (truongTheoId === 'image') diem += 200;
      if (truongTheoId === 'video') diem -= 200;

      const quanhDay = (o.closest('section, fieldset, div[class]')?.textContent || '').toLowerCase();
      if (quanhDay.includes('photo')) diem += 10;

      if (diem > diemTotNhat) {
        diemTotNhat = diem;
        totNhat = o;
      }
    }
    return diemTotNhat > -100 ? totNhat : null;
  }

  // ---- Tai anh ve thanh File de nhoi vao o upload ----

  async function taiAnhThanhFile(url, ten) {
    const duLieu = await taiMotAnhVoiRetry(url);
    const duoi = laySoDuoiFile(url);
    return new File([duLieu], `${lamSachTenFile(ten)}.${duoi}`, { type: laMimeTheoDuoi(duoi) });
  }

  // So anh tai CUNG LUC toi da — GM_xmlhttpRequest khong bi gioi han 6 ket noi/goc nhu fetch
  // thuong cua trang, nhung van chon so vua phai de khong lam CDN/Etsy nghi la spam.
  const DO_SONG_SONG_TAI_ANH = 4;

  // Tai NHIEU anh CUNG LUC (thay vi tung anh mot lan luot) de tang toc buoc lay du lieu truoc
  // khi nhoi vao o upload — day la phan DUY NHAT script kiem soat duoc ve toc do, con buoc Etsy
  // tu xu ly anh sau khi nhan duoc (choEtsyXuLyAnh) la toc do may chu cua Etsy, khong lam nhanh
  // hon duoc tu phia script.
  // Dung "hang doi" (worker) thay vi Promise.all() thang de GIU DUNG THU TU ket qua trong mang
  // dau ra (khop voi thu tu chon anh, dung cho ten file/thu tu upload), du cac lan tai xong khong
  // theo dung thu tu do toc do mang khac nhau.
  async function taiCacAnhSongSong(cacAnh, tenGoc, capNhatTienDo) {
    const ketQua = new Array(cacAnh.length).fill(null);
    let chiSoTiepTheo = 0;
    let daXong = 0;

    async function motLuongTai() {
      while (chiSoTiepTheo < cacAnh.length) {
        const i = chiSoTiepTheo++;
        try {
          ketQua[i] = await taiAnhThanhFile(cacAnh[i].url, `${tenGoc} - ${String(i + 1).padStart(2, '0')}`);
        } catch (loi) {
          console.error('[Etsy Auto] Không lấy được ảnh để upload:', cacAnh[i].url, loi);
        }
        daXong++;
        capNhatTienDo(daXong, cacAnh.length);
      }
    }

    const soLuong = Math.min(DO_SONG_SONG_TAI_ANH, cacAnh.length);
    await Promise.all(Array.from({ length: soLuong }, motLuongTai));
    return ketQua.filter(Boolean);
  }

  // Nhoi danh sach File vao <input type="file"> y het nhu nguoi dung vua chon trong hop thoai.
  // DataTransfer la cach duy nhat: thuoc tinh .files chi nhan doi tuong FileList, khong nhan mang.
  function nhoiFileVaoO(o, cacFile) {
    const kho = new DataTransfer();
    cacFile.forEach((f) => kho.items.add(f));
    o.files = kho.files;
    o.dispatchEvent(new Event('input', { bubbles: true }));
    o.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ---- Cac the anh trong luoi (dnd-kit) ----

  // Tim to tien GAN NHAT trong dan la container danh sach (ul/ol/role=list|grid), toi da 6 buoc.
  function timChaDanhSach(el) {
    let vc = el.parentElement;
    for (let buoc = 0; vc && buoc < 6; buoc++) {
      if (/^(UL|OL)$/.test(vc.tagName) || vc.getAttribute('role') === 'list' || vc.getAttribute('role') === 'grid') {
        return vc;
      }
      vc = vc.parentElement;
    }
    return el.parentElement;
  }

  let daCanhBaoGomNhom = false;

  // Moi anh trong luoi la mot phan tu co aria-roledescription="sortable".
  // Loc theo container danh sach dung nhat de khong dinh cac vung sortable khac cua trang.
  //
  // LUU Y quan trong: KHONG the gom nhom theo CHA TRUC TIEP — nhieu luoi boc moi the trong 1 <li>
  // RIENG, khi do parentElement cua moi the KHAC NHAU va gom nhom se vo tinh tra ve dung 1 phan tu
  // (da tung xay ra thuc te: Console log "Lưới đang có 1 ảnh" trong khi anh chup cho thay ro co
  // nhieu hon). Vi vay tim CHA GAN NHAT dang la container danh sach (timChaDanhSach) roi moi gom
  // nhom theo container do. Neu nhom "lon nhat" van chi chiem mot phan nho trong tong so the tim
  // duoc, coi nhu gom nhom that bai — tra ve TAT CA thay vi mot con so sai lech: thua con hon
  // thieu, vi thieu se pha hong ca phep tinh soAnhCu / gioi han anh / buoc sap xep phia sau.
  function layCacTheAnh() {
    const tatCa = [...document.querySelectorAll('[aria-roledescription="sortable"]')];
    if (tatCa.length < 2) return tatCa;

    const nhomTheoCha = new Map();
    for (const el of tatCa) {
      const cha = timChaDanhSach(el);
      if (!cha) continue;
      if (!nhomTheoCha.has(cha)) nhomTheoCha.set(cha, []);
      nhomTheoCha.get(cha).push(el);
    }
    let lonNhat = [];
    for (const ds of nhomTheoCha.values()) {
      if (ds.length > lonNhat.length) lonNhat = ds;
    }

    if (lonNhat.length < tatCa.length * 0.6) {
      if (!daCanhBaoGomNhom) {
        daCanhBaoGomNhom = true;
        console.warn(
          '[Etsy Auto] Gom nhóm thẻ ảnh theo cha không chắc chắn (nhóm lớn nhất chỉ có',
          lonNhat.length, '/', tatCa.length, 'thẻ) — dùng toàn bộ để tránh đếm thiếu. ' +
            '(Cảnh báo này chỉ hiện 1 lần dù hàm được gọi nhiều lần.)'
        );
      }
      return tatCa;
    }
    return lonNhat;
  }

  // "Chu ky" de nhan ra 1 the anh cu the sau khi luoi ve lai — dung de kiem tra sap xep co an khong
  function chuKyThe(el) {
    if (!el) return '';
    const anh = el.querySelector('img');
    return (anh && (anh.getAttribute('src') || anh.src)) || el.getAttribute('aria-describedby') || el.textContent.trim();
  }

  // Cho Etsy upload + ve xong cac the anh moi
  async function choEtsyXuLyAnh(soAnhCu, soAnhThem) {
    const moc = Date.now();
    while (Date.now() - moc < THOI_HAN_CHO_ETSY_XU_LY_ANH) {
      const cacThe = layCacTheAnh();
      // Da du so the VA moi the moi deu da co anh xem truoc -> coi nhu Etsy xu ly xong
      if (cacThe.length >= soAnhCu + soAnhThem) {
        const cacTheMoi = cacThe.slice(soAnhCu, soAnhCu + soAnhThem);
        if (cacTheMoi.every((t) => t.querySelector('img'))) return true;
      }
      await cho(1000);
    }
    return false;
  }

  // ---- Sap xep len dau: KHONG kha thi tu userscript, xem ghi chu duoi day ----
  //
  // Da thu giai lap ban phim (Space nhac len -> phim huong -> Space tha xuong) qua nhieu phien
  // ban, dung ca vung thong bao dnd-kit ("DndLiveRegion") de xac minh tung buoc. Ket qua thuc te
  // ON DINH qua nhieu lan thu: phim Space (nhac len) LUON kich hoat duoc dnd-kit (vung thong bao
  // doi dung), nhung KHONG MOT PHIM HUONG NAO (Trai/Phai/Len/Xuong), du gui bao nhieu lan hay
  // theo thu tu nao, tung lam anh dich chuyen — cho toi khi nguoi dung tu tay kiem chung TRUC TIEP
  // tren trang (khong qua script): bam Tab chon 1 anh, bam Space that, bam phim mui ten that ->
  // anh nhay vi tri BINH THUONG. Nghia la ban than tinh nang keo-tha-bang-ban-phim cua Etsy hoat
  // dong tot — chi rieng phim GIA LAP TU JAVASCRIPT la khong co tac dung.
  //
  // NGUYEN NHAN: moi KeyboardEvent tao bang `new KeyboardEvent(...)` roi `dispatchEvent()` LUON
  // co `isTrusted: false` — day la gioi han bao mat CUNG cua nen tang web, khong co API nao (kho
  // ke ca GM_* cua Violentmonkey/Tampermonkey) cho phep script tao ra su kien "dang tin" nhu tu
  // ban phim that. Nut Space (nhac len) di qua props onKeyDown cua React (React KHONG loc theo
  // isTrusted nen van goi duoc), nhung buoc XU LY TIEP theo khi dang keo (phim huong) duoc dnd-kit
  // gan bang addEventListener() TRUC TIEP vao document — loai listener nay rat co the (va ket qua
  // kiem chung khop voi gia thuyet nay) CHU DONG BO QUA moi su kien co isTrusted=false de chan
  // thao tung bang script. Vi day la gioi han cua CHINH TRINH DUYET, doi sang gia lap chuot
  // (PointerEvent/MouseEvent) cung se dinh y het gioi han nay nen khong dang thu.
  //
  // KET LUAN: buoc "dua anh moi len dau" khong the tu dong hoa an toan tu userscript. Script chi
  // con lam duoc phan UPLOAD (khong dinh gioi han nay vi gan File vao input khong phai su kien ban
  // phim/chuot), con buoc sap xep de nguoi dung tu keo tay — thuong chi mat vai giay.

  // ---- Nut ket thuc (Save as draft / Publish) ----

  function timNutTheoNhan(chu) {
    const can = chu.toLowerCase();
    return [...document.querySelectorAll('button, a[role="button"]')].find(
      (b) => b.textContent.trim().toLowerCase() === can && !b.disabled && dangHienThi(b)
    );
  }

  // ---- Luong chinh ----

  async function tuUploadAnh() {
    const goi = await layAnhNguonMoiNoi();
    if (!goi) {
      hienThongBao(
        `⚠️ Chưa có ảnh nào. Hãy sang trang listing nguồn bấm Alt+G (hoặc Alt+C) bằng bản ${PHIEN_BAN}, ` +
          'rồi quay lại đây — Clipboard sẽ mang theo danh sách ảnh.',
        '#DC2626'
      );
      return;
    }

    if (!timOChonAnhSanPham()) {
      hienThongBao('⚠️ Không thấy ô upload ảnh. Hãy mở tab "Photos & video" của trang chỉnh sửa listing rồi thử lại.', '#DC2626');
      return;
    }

    const soAnhCu = layCacTheAnh().length;
    const conLai = laySoAnhConLai(soAnhCu);
    console.log(`[Etsy Auto] Lưới đang có ${soAnhCu} ảnh, trang báo còn chỗ cho ${conLai} ảnh nữa`);
    if (conLai === 0) {
      hienThongBao('⚠️ Listing này đã đầy ảnh, không còn chỗ để upload thêm.', '#DC2626');
      return;
    }

    // Thu vien anh bang size cua nguoi dung: LUON duoc them vao SAU CUNG, dung thu tu da luu.
    // Vi khong con buoc "dua len dau" (khong lam duoc tu script), cach duy nhat de co dung thu
    // tu [anh san pham... , anh bang size...] la nhoi dung thu tu do ngay tu dau — chi hoat dong
    // dung khi luoi dich con it/khong co anh cu lan vao giua (nguoi dung tu don truoc).
    const thuVienBangSize = docThuVienBangSize();
    if (conLai < thuVienBangSize.length) {
      hienThongBao(
        `⚠️ Chỉ còn chỗ cho ${conLai} ảnh, nhưng thư viện ảnh bảng size đang có ` +
          `${thuVienBangSize.length} ảnh cố định. Bớt ảnh trong thư viện (nút 📐) hoặc dọn chỗ trên listing.`,
        '#DC2626'
      );
      return;
    }
    const conLaiChoSanPham = conLai - thuVienBangSize.length;

    const luaChon = await moBangChonAnh(goi, soAnhCu, conLaiChoSanPham, thuVienBangSize.length);
    if (!luaChon) return;

    const { cacAnh, hanhDong } = luaChon;
    const tongSoAnhChon = cacAnh.length + thuVienBangSize.length;

    // Buoc 1: tai bytes cua tung anh ve (khong ton request API Etsy, chi ton bang thong).
    // Tai SONG SONG (toi da DO_SONG_SONG_TAI_ANH anh cung luc) thay vi tung anh mot — day la
    // phan chinh quyet dinh toc do tong the, vi buoc Etsy tu xu ly anh o buoc sau la toc do
    // may chu cua ho, khong lam nhanh hon duoc. Anh san pham va anh bang size tai THANH 2 DOT
    // rieng (khong tron chung) de GIU DUNG THU TU cuoi cung: san pham truoc, bang size sau.
    hienThongBao(`⏳ Đang lấy ${tongSoAnhChon} ảnh (song song)...`, '#2563EB');
    const tenGoc = lamSachTenFile(goi.tieuDe || 'etsy-image');
    const capNhatTienDo = (daXong, tong, nhan) => hienThongBao(`⏳ Đã lấy ${daXong}/${tong} ảnh${nhan}...`, '#2563EB');

    const cacFileSanPham = await taiCacAnhSongSong(cacAnh, tenGoc, (daXong, tong) =>
      capNhatTienDo(daXong, tong, ' sản phẩm')
    );
    const cacFileBangSize = thuVienBangSize.length
      ? await taiCacAnhSongSong(thuVienBangSize, `${tenGoc} - bang-size`, (daXong, tong) =>
          capNhatTienDo(daXong, tong, ' bảng size')
        )
      : [];
    const cacFile = [...cacFileSanPham, ...cacFileBangSize];

    if (!cacFile.length) {
      hienThongBao('❌ Không lấy được ảnh nào. Xem Console (F12) để biết chi tiết.', '#DC2626');
      return;
    }

    // Buoc 2: nhoi vao o upload cua Etsy. Query lai o ngay truoc khi nhoi vi React co the
    // da ve lai <input> khac trong luc dang tai anh.
    const oChonAnh = timOChonAnhSanPham();
    if (!oChonAnh) {
      hienThongBao('❌ Ô upload ảnh biến mất giữa chừng. Hãy tải lại trang chỉnh sửa rồi thử lại.', '#DC2626');
      return;
    }
    nhoiFileVaoO(oChonAnh, cacFile);
    hienThongBao(`⏳ Đã đẩy ${cacFile.length} ảnh vào Etsy, đang chờ xử lý...`, '#2563EB');

    // Buoc 3: cho Etsy upload xong
    const xuLyXong = await choEtsyXuLyAnh(soAnhCu, cacFile.length);
    if (!xuLyXong) {
      hienThongBao(
        `⚠️ Etsy chưa hiện đủ ${cacFile.length} ảnh sau ${THOI_HAN_CHO_ETSY_XU_LY_ANH / 1000}s. ` +
          'Ảnh có thể vẫn đang lên — hãy kiểm tra rồi tự sắp xếp.',
        '#F59E0B'
      );
      return;
    }

    // Buoc 4: dua anh moi len dau luoi — KHONG lam duoc tu script (xem ghi chu tai
    // "Sap xep len dau: KHONG kha thi tu userscript" o tren: gia lap phim/chuot deu bi dnd-kit
    // bo qua vi khong phai su kien "dang tin" tu ban phim/chuot that — gioi han cua trinh duyet,
    // khong phai loi script). Neu luoi dich dang trong (soAnhCu=0) thi thu tu vua nhoi vao da
    // dung san (san pham truoc, bang size sau) — khong can dua len dau nua.
    const ghiChuSapXep =
      soAnhCu > 0
        ? ' — ảnh mới nằm ở CUỐI lưới, bạn tự kéo lên đầu (không tự động hoá được, xem README)'
        : '';

    // Buoc 5: hanh dong ket thuc (chi khi nguoi dung da chon trong bang chon)
    let ghiChuKetThuc = '';
    if (hanhDong !== 'khong') {
      const nhan = hanhDong === 'publish' ? 'Publish' : 'Save as draft';
      await cho(600);
      const nut = timNutTheoNhan(nhan);
      if (nut) {
        nut.click();
        ghiChuKetThuc = ` → đã bấm "${nhan}"`;
      } else {
        ghiChuKetThuc = ` — ⚠️ không tìm thấy nút "${nhan}", bạn bấm giúp`;
      }
    }

    const ghiChuBangSize = thuVienBangSize.length
      ? ` (gồm ${cacFileSanPham.length} sản phẩm + ${cacFileBangSize.length} bảng size)`
      : '';
    const thieu = tongSoAnhChon - cacFile.length;
    hienThongBao(
      `✅ Đã upload ${cacFile.length}/${tongSoAnhChon} ảnh${ghiChuBangSize}${thieu ? ` (lỗi ${thieu} ảnh)` : ''}` +
        `${ghiChuSapXep}${ghiChuKetThuc}`,
      soAnhCu > 0 || ghiChuKetThuc.includes('⚠️') || thieu ? '#F59E0B' : '#16A34A'
    );
  }

  // ================== GIAO DIEN NOI: KEO THA + THU NHO/MO RONG ==================

  function docTrangThaiPanel() {
    try {
      return JSON.parse(localStorage.getItem(PANEL_STATE_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function luuTrangThaiPanel(state) {
    try {
      const hienTai = docTrangThaiPanel();
      localStorage.setItem(PANEL_STATE_KEY, JSON.stringify({ ...hienTai, ...state }));
    } catch (e) {
      /* noop */
    }
  }

  // Cho phep keo panel bang cach giu chuot vao "tayCam". Neu ha-tha chuot ma KHONG
  // di chuyen (hoac di chuyen rat it), coi la 1 cai click va goi onClick (dung de
  // bam mo/dong panel ma khong bi coi nham la keo).
  // "luuViTri" (tuy chon) cho phep moi khung tu chon noi luu toa do cua rieng no;
  // khong truyen thi mac dinh luu vao trang thai cua panel chinh.
  function ganKeoTha(tayCam, panelEl, onClick, luuViTri) {
    let dangKeo = false;
    let daDiChuyen = false;
    let downX = 0;
    let downY = 0;
    let startLeft = 0;
    let startTop = 0;

    tayCam.addEventListener('mousedown', (e) => {
      dangKeo = true;
      daDiChuyen = false;
      const rect = panelEl.getBoundingClientRect();
      panelEl.style.left = `${rect.left}px`;
      panelEl.style.top = `${rect.top}px`;
      panelEl.style.right = 'auto';
      panelEl.style.bottom = 'auto';
      startLeft = rect.left;
      startTop = rect.top;
      downX = e.clientX;
      downY = e.clientY;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dangKeo) return;
      const dx = e.clientX - downX;
      const dy = e.clientY - downY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) daDiChuyen = true;

      let newLeft = startLeft + dx;
      let newTop = startTop + dy;
      const maxLeft = window.innerWidth - panelEl.offsetWidth;
      const maxTop = window.innerHeight - panelEl.offsetHeight;
      newLeft = Math.min(Math.max(0, newLeft), Math.max(0, maxLeft));
      newTop = Math.min(Math.max(0, newTop), Math.max(0, maxTop));

      panelEl.style.left = `${newLeft}px`;
      panelEl.style.top = `${newTop}px`;
    });

    document.addEventListener('mouseup', () => {
      if (!dangKeo) return;
      dangKeo = false;
      const viTri = { left: panelEl.style.left, top: panelEl.style.top };
      if (typeof luuViTri === 'function') luuViTri(viTri);
      else luuTrangThaiPanel(viTri);
      if (!daDiChuyen && typeof onClick === 'function') onClick();
    });
  }

  // ================== THE THONG KE LISTING (tu hien khi mo listing) ==================

  const KHOA_TU_HIEN_THONG_KE = 'etsy_tu_hien_thong_ke';
  const KHOA_VI_TRI_THONG_KE = 'etsy_vi_tri_the_thong_ke';

  // Etsy KHONG cong bo luot ban cua tung listing. Chi so cung duy nhat lien quan la SO REVIEW:
  // moi review ung voi mot don hang that, nen no la CAN DUOI cua luot ban.
  // Thuc te chi khoang 10-30% nguoi mua de lai danh gia, nen suy nguoc ra duoc mot KHOANG:
  //     luot ban ~ soReview / 0.30  ...  soReview / 0.10
  // Luon hien duoi dang khoang, khong bao gio quy ve 1 con so co dinh — vi day la uoc luong,
  // dua ra so don le se tao cam giac chinh xac gia tao.
  const TY_LE_REVIEW_CAO = 0.3; // nhieu nguoi chiu review -> luot ban thuc thap
  const TY_LE_REVIEW_THAP = 0.1; // it nguoi chiu review -> luot ban thuc cao

  function dinhDangNgay(giay) {
    if (!giay) return '—';
    const d = new Date(giay * 1000);
    const hai = (n) => String(n).padStart(2, '0');
    return `${hai(d.getDate())}/${hai(d.getMonth() + 1)}/${d.getFullYear()}`;
  }

  function moTaKhoangCach(giay) {
    if (!giay) return '';
    const soNgay = Math.max(0, Math.floor((Date.now() / 1000 - giay) / 86400));
    if (soNgay === 0) return 'hôm nay';
    if (soNgay < 30) return `${soNgay} ngày trước`;
    if (soNgay < 365) return `${Math.floor(soNgay / 30)} tháng trước`;
    return `${Math.floor(soNgay / 365)} năm trước`;
  }

  function soNgayTuKhi(giay) {
    if (!giay) return 0;
    return Math.max(1, (Date.now() / 1000 - giay) / 86400);
  }

  function dinhDangSo(n) {
    return typeof n === 'number' ? n.toLocaleString('vi-VN') : '—';
  }

  // Tinh cac chi so suy ra tu du lieu API
  function tinhThongKe(duLieu, soReview) {
    const taoLuc = duLieu.original_creation_timestamp || duLieu.creation_timestamp || duLieu.created_timestamp;
    const suaLuc = duLieu.last_modified_timestamp || duLieu.updated_timestamp;
    const tuoiNgay = soNgayTuKhi(taoLuc);

    const xem = typeof duLieu.views === 'number' ? duLieu.views : null;
    const thich = typeof duLieu.num_favorers === 'number' ? duLieu.num_favorers : null;

    const donGia = duLieu.price ? duLieu.price.amount / duLieu.price.divisor : null;
    const tienTe = duLieu.price ? duLieu.price.currency_code : '';

    let banToiThieu = null;
    let banToiDa = null;
    if (typeof soReview === 'number' && soReview > 0) {
      banToiThieu = Math.ceil(soReview / TY_LE_REVIEW_CAO);
      banToiDa = Math.ceil(soReview / TY_LE_REVIEW_THAP);
    }

    return {
      xem,
      thich,
      soReview,
      taoLuc,
      suaLuc,
      tuoiNgay,
      donGia,
      tienTe,
      conLai: typeof duLieu.quantity === 'number' ? duLieu.quantity : null,
      xemMoiNgay: xem === null ? null : xem / tuoiNgay,
      tyLeThich: xem && thich !== null ? (thich / xem) * 100 : null,
      banToiThieu,
      banToiDa,
      doanhThuToiThieu: banToiThieu !== null && donGia !== null ? banToiThieu * donGia : null,
      doanhThuToiDa: banToiDa !== null && donGia !== null ? banToiDa * donGia : null,
    };
  }

  function xoaTheThongKe() {
    const cu = document.getElementById('etsy-auto-stats');
    if (cu) cu.remove();
  }

  const RONG_THE_THONG_KE = 260;

  // Vi tri mac dinh cua the thong ke: NGAY DUOI panel "Listing Tools" (du dang thu nho hay mo
  // rong), de khi xo ra no dinh lien vao card chinh thay vi hien o goc khac man hinh. Chi dung
  // khi nguoi dung CHUA TUNG tu keo the nay di dau (xem noi goi ham nay) — da keo roi thi tu
  // trong vi tri da luu.
  function viTriMacDinhTheThongKe() {
    const panel = document.getElementById('etsy-auto-panel');
    if (!panel) return { top: '120px', left: '16px' };
    const rect = panel.getBoundingClientRect();
    const traiToiDa = window.innerWidth - RONG_THE_THONG_KE - 8;
    const trai = Math.min(Math.max(8, rect.left), Math.max(8, traiToiDa));
    return { top: `${Math.round(rect.bottom + 8)}px`, left: `${Math.round(trai)}px` };
  }

  function veTheThongKe(tk) {
    xoaTheThongKe();

    const khung = document.createElement('div');
    khung.id = 'etsy-auto-stats';
    khung.style.cssText = `
      position:fixed; z-index:999998; top:120px; left:16px; width:${RONG_THE_THONG_KE}px;
      background:#fff; border-radius:10px; overflow:hidden; font-family:sans-serif;
      box-shadow:0 6px 20px rgba(0,0,0,.25); user-select:none;
    `;

    const viTri = docTrangThaiPanel()[KHOA_VI_TRI_THONG_KE];
    const viTriDat = viTri && viTri.left && viTri.top ? viTri : viTriMacDinhTheThongKe();
    khung.style.left = viTriDat.left;
    khung.style.top = viTriDat.top;

    // Mot dong so lieu: nhan ben trai, gia tri chinh ben phai, gia tri phu mo hon o duoi
    const dong = (bieuTuong, nhan, giaTri, phu) => `
      <div style="display:flex;justify-content:space-between;align-items:baseline;padding:6px 10px;border-bottom:1px solid #F3F4F6;">
        <span style="font-size:12px;color:#6B7280;">${bieuTuong} ${nhan}</span>
        <span style="text-align:right;">
          <span style="font-size:13px;font-weight:bold;color:#111827;">${giaTri}</span>
          ${phu ? `<span style="display:block;font-size:11px;color:#9CA3AF;">${phu}</span>` : ''}
        </span>
      </div>`;

    const uocTinhBan =
      tk.banToiThieu !== null
        ? `${dinhDangSo(tk.banToiThieu)} – ${dinhDangSo(tk.banToiDa)}`
        : 'chưa đủ dữ liệu';
    const uocTinhDoanhThu =
      tk.doanhThuToiThieu !== null
        ? `${dinhDangSo(Math.round(tk.doanhThuToiThieu))} – ${dinhDangSo(Math.round(tk.doanhThuToiDa))} ${tk.tienTe}`
        : '';

    khung.innerHTML = `
      <div id="ea-stats-header" style="display:flex;align-items:center;justify-content:space-between;
        background:linear-gradient(135deg,#7C3AED,#A78BFA);color:#fff;padding:8px 10px;
        cursor:grab;font-weight:bold;font-size:13px;">
        <span>📊 Thống kê listing</span>
        <button id="ea-stats-close" title="Đóng" style="background:rgba(255,255,255,.25);border:none;
          color:#fff;width:22px;height:22px;border-radius:6px;cursor:pointer;font-weight:bold;
          line-height:1;font-size:14px;">×</button>
      </div>
      ${dong('👁️', 'Lượt xem', dinhDangSo(tk.xem), tk.xemMoiNgay === null ? '' : `${tk.xemMoiNgay.toFixed(1)}/ngày`)}
      ${dong('❤️', 'Yêu thích', dinhDangSo(tk.thich), tk.tyLeThich === null ? '' : `${tk.tyLeThich.toFixed(1)}% lượt xem`)}
      ${dong('📝', 'Review', dinhDangSo(tk.soReview), 'đơn hàng có thật')}
      ${dong('🛒', 'Ước tính bán', uocTinhBan, uocTinhDoanhThu)}
      ${dong('📅', 'Tạo lúc', dinhDangNgay(tk.taoLuc), moTaKhoangCach(tk.taoLuc))}
      ${dong('🔄', 'Sửa lúc', dinhDangNgay(tk.suaLuc), moTaKhoangCach(tk.suaLuc))}
      ${dong('📦', 'Còn lại', dinhDangSo(tk.conLai), tk.donGia === null ? '' : `${tk.donGia.toFixed(2)} ${tk.tienTe}`)}
      <div style="padding:8px 10px;font-size:10px;color:#9CA3AF;line-height:1.4;">
        Ước tính bán suy từ số review (thường chỉ 10–30% người mua đánh giá) nên là một khoảng,
        không phải số chính xác. Etsy không công bố lượt bán của từng listing.
      </div>
    `;

    document.body.appendChild(khung);

    document.getElementById('ea-stats-close').onclick = xoaTheThongKe;
    ganKeoTha(document.getElementById('ea-stats-header'), khung, null, (vt) =>
      luuTrangThaiPanel({ [KHOA_VI_TRI_THONG_KE]: vt })
    );
  }

  function dangBatTuHien() {
    return docTrangThaiPanel()[KHOA_TU_HIEN_THONG_KE] !== false; // mac dinh: bat
  }

  // Goi API roi ve the. Dung chung cho ca luc tu chay va luc bam nut.
  async function hienThongKeListing({ imLangKhiLoi = false } = {}) {
    const listingId = layListingId();
    if (!listingId) {
      if (!imLangKhiLoi) hienThongBao('⚠️ Trang này không phải trang listing', '#F59E0B');
      return;
    }
    if (!coKhoaXacThuc()) {
      if (!imLangKhiLoi) hienThongBao('⚠️ Chưa có khoá API — bấm 🔑 để nhập trước', '#F59E0B');
      return;
    }

    try {
      const { duLieu } = await goiApi(`https://openapi.etsy.com/v3/application/listings/${listingId}`);

      // So review goi rieng; hong thi van ve the, chi thieu phan uoc tinh ban
      let soReview = null;
      try {
        const kq = await goiApi(
          `https://openapi.etsy.com/v3/application/listings/${listingId}/reviews?limit=1`
        );
        if (kq.duLieu && typeof kq.duLieu.count === 'number') soReview = kq.duLieu.count;
      } catch (loi) {
        console.warn('[Etsy Auto] Không lấy được số review:', loi.message);
      }

      veTheThongKe(tinhThongKe(duLieu, soReview));
    } catch (loi) {
      console.warn('[Etsy Auto] Không hiện được thống kê:', loi.message);
      if (!imLangKhiLoi) hienThongBao('❌ Không lấy được thống kê — ' + loi.message, '#DC2626');
    }
  }

  // ================== THE THONG KE MINI TREN LUOI SAN PHAM ==================

  // Gan the thong ke nho vao TUNG the san pham tren moi trang co luoi listing
  // (tim kiem, shop, danh muc, goi y cuoi trang listing...).
  //
  // Chi phi request duoc giu rat thap nho 3 co che:
  //   1. Endpoint GOP: /listings/batch?listing_ids=... nhan toi da 100 id trong 1 request,
  //      nen ca trang tim kiem 48 san pham chi ton DUNG 1 request thay vi 48.
  //   2. Bo nho dem 24 gio theo listing_id: cuon di cuon lai, quay ve trang truoc, mo lai
  //      listing da xem — deu khong goi lai API.
  //   3. Uoc tinh ban (can goi endpoint review, KHONG gop duoc, moi listing 1 request)
  //      chi chay khi nguoi dung RE CHUOT vao dung the do. Thuong chi quan tam vai san pham
  //      trong 48 cai, nen tra dung phan minh xem.
  const KHOA_CACHE_LISTING = 'etsy_cache_listing';
  const HAN_CACHE_MS = 24 * 60 * 60 * 1000;
  const SO_ID_MOI_LO = 100; // gioi han cua endpoint batch
  const CHO_TRUOC_KHI_UOC_TINH = 400; // ms giu chuot, tranh goi API khi luot chuot ngang qua

  let boNhoDem = null;

  function napCache() {
    if (boNhoDem) return boNhoDem;
    try {
      boNhoDem = JSON.parse(docGiaTriLuu(KHOA_CACHE_LISTING) || '{}');
    } catch (e) {
      boNhoDem = {};
    }
    const nay = Date.now();
    for (const id of Object.keys(boNhoDem)) {
      if (!boNhoDem[id] || nay - boNhoDem[id].t > HAN_CACHE_MS) delete boNhoDem[id];
    }
    return boNhoDem;
  }

  function ghiCache() {
    luuGiaTri(KHOA_CACHE_LISTING, JSON.stringify(boNhoDem || {}));
  }

  // Tim cac the san pham tren trang. Moi listing_id chi lay phan tu NGOAI CUNG
  // (duyet theo thu tu tai lieu nen cha luon den truoc con).
  function timCacTheListing() {
    const theo = new Map();
    for (const el of document.querySelectorAll('[data-listing-id]')) {
      const id = el.getAttribute('data-listing-id');
      if (!id || !/^\d+$/.test(id) || theo.has(id)) continue;

      // Loai cac phan tu khong phai the san pham (nut yeu thich, form them vao gio...)
      if (['BUTTON', 'INPUT', 'FORM', 'IMG', 'SELECT'].includes(el.tagName)) continue;
      const laThe =
        el.tagName === 'LI' ||
        /listing-card/.test(String(el.className || '')) ||
        el.querySelector('a[href*="/listing/"]');
      if (!laThe) continue;

      theo.set(id, el);
    }
    return theo;
  }

  // Rut gon du lieu API xuong dung nhung truong can luu, cho cache nho gon
  function rutGonChoCache(duLieu) {
    return {
      v: duLieu.views,
      f: duLieu.num_favorers,
      c: duLieu.original_creation_timestamp || duLieu.creation_timestamp || duLieu.created_timestamp,
      u: duLieu.last_modified_timestamp || duLieu.updated_timestamp,
      q: duLieu.quantity,
      p: duLieu.price ? duLieu.price.amount / duLieu.price.divisor : null,
      m: duLieu.price ? duLieu.price.currency_code : '',
    };
  }

  function veTheMini(elThe, id, muc) {
    if (elThe.querySelector(':scope > .ea-mini-stats')) return;

    const tuoiNgay = soNgayTuKhi(muc.c);
    const xemMoiNgay = typeof muc.v === 'number' ? (muc.v / tuoiNgay).toFixed(1) : '—';
    const tyLeThich =
      typeof muc.v === 'number' && muc.v > 0 && typeof muc.f === 'number'
        ? ((muc.f / muc.v) * 100).toFixed(1) + '%'
        : '—';

    const mini = document.createElement('div');
    mini.className = 'ea-mini-stats';
    mini.dataset.listingId = id;
    mini.style.cssText = `
      margin-top:6px; padding:6px 8px; border-radius:8px; background:#F5F3FF;
      border:1px solid #DDD6FE; font-family:sans-serif; font-size:11px; color:#4C1D95;
      line-height:1.5; cursor:default;
    `;
    mini.innerHTML = `
      <div style="display:flex;justify-content:space-between;">
        <span>👁️ <b>${dinhDangSo(muc.v)}</b></span><span style="color:#7C3AED;">${xemMoiNgay}/ngày</span>
      </div>
      <div style="display:flex;justify-content:space-between;">
        <span>❤️ <b>${dinhDangSo(muc.f)}</b></span><span style="color:#7C3AED;">${tyLeThich}</span>
      </div>
      <div style="display:flex;justify-content:space-between;color:#6D28D9;">
        <span>📅 ${moTaKhoangCach(muc.c)}</span><span>🔄 ${moTaKhoangCach(muc.u)}</span>
      </div>
      <div class="ea-uoc-tinh" style="margin-top:3px;padding-top:3px;border-top:1px dashed #C4B5FD;color:#7C3AED;">
        🛒 rê chuột để ước tính bán
      </div>
    `;
    elThe.appendChild(mini);

    // Chi goi API review khi giu chuot du lau — luot ngang qua thi khong ton request
    let hen = null;
    mini.addEventListener('mouseenter', () => {
      hen = HEN_GIO.setTimeout(() => hienUocTinhBan(mini, id, muc), CHO_TRUOC_KHI_UOC_TINH);
    });
    mini.addEventListener('mouseleave', () => {
      if (hen !== null) HEN_GIO.clearTimeout(hen);
    });
  }

  async function hienUocTinhBan(mini, id, muc) {
    const o = mini.querySelector('.ea-uoc-tinh');
    if (!o || o.dataset.xong === '1' || o.dataset.dangChay === '1') return;

    const veKetQua = (soReview) => {
      o.dataset.xong = '1';
      if (typeof soReview !== 'number') {
        o.textContent = '🛒 không lấy được số review';
        return;
      }
      if (soReview === 0) {
        o.textContent = '🛒 chưa có review — chưa ước tính được';
        return;
      }
      const min = Math.ceil(soReview / TY_LE_REVIEW_CAO);
      const max = Math.ceil(soReview / TY_LE_REVIEW_THAP);
      const doanhThu =
        muc.p != null ? ` · ${dinhDangSo(Math.round(min * muc.p))}–${dinhDangSo(Math.round(max * muc.p))} ${muc.m}` : '';
      o.innerHTML = `🛒 <b>${dinhDangSo(min)} – ${dinhDangSo(max)}</b> (${soReview} review)${doanhThu}`;
    };

    // Da hoi roi thi dung lai cache, khong goi lai
    const dem = napCache();
    if (dem[id] && typeof dem[id].r === 'number') {
      veKetQua(dem[id].r);
      return;
    }

    o.dataset.dangChay = '1';
    o.textContent = '🛒 đang tính...';
    try {
      const kq = await goiApi(`https://openapi.etsy.com/v3/application/listings/${id}/reviews?limit=1`);
      const soReview = kq.duLieu && typeof kq.duLieu.count === 'number' ? kq.duLieu.count : null;
      if (typeof soReview === 'number') {
        dem[id] = { ...(dem[id] || { t: Date.now() }), r: soReview };
        ghiCache();
      }
      veKetQua(soReview);
    } catch (loi) {
      console.warn('[Etsy Auto] Không lấy được review cho listing', id, ':', loi.message);
      o.textContent = '🛒 lỗi khi lấy review';
    } finally {
      o.dataset.dangChay = '0';
    }
  }

  let dangQuetLuoi = false;

  async function ganThongKeVaoLuoi() {
    if (dangQuetLuoi || !coKhoaXacThuc() || !dangBatTuHien()) return;

    const cacThe = timCacTheListing();
    if (cacThe.size === 0) return;

    const dem = napCache();

    // Ve ngay nhung the da co trong cache, phan con lai moi goi API
    const canGoi = [];
    for (const [id, el] of cacThe) {
      if (el.querySelector(':scope > .ea-mini-stats')) continue;
      if (dem[id]) veTheMini(el, id, dem[id]);
      else canGoi.push(id);
    }
    if (canGoi.length === 0) return;

    dangQuetLuoi = true;
    try {
      for (let i = 0; i < canGoi.length; i += SO_ID_MOI_LO) {
        const lo = canGoi.slice(i, i + SO_ID_MOI_LO);
        try {
          const kq = await goiApi(
            `https://openapi.etsy.com/v3/application/listings/batch?listing_ids=${lo.join(',')}`
          );
          const ketQua = kq.duLieu && Array.isArray(kq.duLieu.results) ? kq.duLieu.results : [];
          console.log(`[Etsy Auto] Lấy thống kê ${ketQua.length}/${lo.length} listing trong 1 request`);

          for (const duLieu of ketQua) {
            const id = String(duLieu.listing_id);
            dem[id] = { t: Date.now(), ...rutGonChoCache(duLieu), ...(dem[id] || {}) };
            dem[id].t = Date.now();
            const el = cacThe.get(id);
            if (el) veTheMini(el, id, dem[id]);
          }
          ghiCache();
        } catch (loi) {
          console.warn('[Etsy Auto] Gọi lô thống kê thất bại:', loi.message);
          break; // hong lo dau thi cac lo sau cung hong, dung lai cho do ton quota
        }
      }
    } finally {
      dangQuetLuoi = false;
    }
  }

  // Trang Etsy nap them the khi cuon / doi trang bang AJAX, nen phai theo doi DOM.
  // Gom cac thay doi lai roi quet 1 lan de khong goi API lien tuc.
  function theoDoiLuoiSanPham() {
    let hen = null;
    const quetLai = () => {
      if (hen !== null) HEN_GIO.clearTimeout(hen);
      hen = HEN_GIO.setTimeout(() => ganThongKeVaoLuoi(), 600);
    };

    new MutationObserver((cacThayDoi) => {
      for (const td of cacThayDoi) {
        for (const nut of td.addedNodes) {
          if (nut.nodeType !== 1) continue;
          if (nut.hasAttribute('data-listing-id') || nut.querySelector('[data-listing-id]')) {
            quetLai();
            return;
          }
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  function xoaTatCaTheMini() {
    document.querySelectorAll('.ea-mini-stats').forEach((el) => el.remove());
  }

  function taoGiaoDien() {
    const trangThai = docTrangThaiPanel();

    // Khung ngoai cung: 1 khoi duy nhat, dinh vi co dinh, keo tha duoc tu do
    const khung = document.createElement('div');
    khung.id = 'etsy-auto-panel';
    khung.style.cssText = `
      position:fixed; z-index:999999; font-family:sans-serif; user-select:none;
      top:120px; right:16px;
    `;
    if (trangThai.left && trangThai.top) {
      khung.style.left = trangThai.left;
      khung.style.top = trangThai.top;
      khung.style.right = 'auto';
    }
    document.body.appendChild(khung);

    // ---- Giao dien THU NHO: 1 bieu tuong tron, chu "Listing" ----
    const bieuTuongThuNho = document.createElement('div');
    bieuTuongThuNho.id = 'ea-mini';
    bieuTuongThuNho.title = 'Etsy Listing Tools — giữ và kéo để di chuyển, bấm để mở rộng';
    bieuTuongThuNho.style.cssText = `
      display:flex; align-items:center; justify-content:center; gap:6px;
      width:64px; height:64px; border-radius:50%;
      background:linear-gradient(135deg,#F56400,#FF8C42);
      color:#fff; box-shadow:0 4px 14px rgba(0,0,0,.3);
      cursor:grab; flex-direction:column; text-align:center;
    `;
    bieuTuongThuNho.innerHTML = `
      <div style="font-size:20px; line-height:1;">🏷️</div>
      <div style="font-size:10px; font-weight:bold; letter-spacing:.3px; margin-top:2px;">Listing</div>
      <div style="font-size:8px; opacity:.85; line-height:1;">v${PHIEN_BAN}</div>
    `;
    khung.appendChild(bieuTuongThuNho);

    // ---- Giao dien MO RONG: thanh tieu de (tay cam keo) + cac nut chuc nang ----
    const khungMoRong = document.createElement('div');
    khungMoRong.id = 'ea-expanded';
    khungMoRong.style.cssText = `
      display:flex; flex-direction:column; width:250px;
      background:#fff; border-radius:10px; overflow:hidden;
      box-shadow:0 6px 20px rgba(0,0,0,.25);
    `;

    const thanhTieuDe = document.createElement('div');
    thanhTieuDe.id = 'ea-header';
    thanhTieuDe.style.cssText = `
      display:flex; align-items:center; justify-content:space-between;
      background:linear-gradient(135deg,#F56400,#FF8C42); color:#fff;
      padding:8px 10px; cursor:grab; font-weight:bold; font-size:13px;
    `;
    thanhTieuDe.innerHTML = `
      <span>🏷️ Listing Tools <span style="font-weight:normal;opacity:.8;font-size:11px;">v${PHIEN_BAN}</span></span>
      <button id="ea-btn-minimize" title="Thu nhỏ" style="
        background:rgba(255,255,255,.25); border:none; color:#fff;
        width:22px; height:22px; border-radius:6px; cursor:pointer;
        font-weight:bold; line-height:1; font-size:14px;
      ">–</button>
    `;
    khungMoRong.appendChild(thanhTieuDe);

    const vungNut = document.createElement('div');
    vungNut.style.cssText = 'display:flex; flex-direction:column; gap:6px; padding:10px;';
    vungNut.innerHTML = `
      <button id="ea-btn-get" style="padding:8px 12px;background:#F56400;color:#fff;border:none;border-radius:6px;font-weight:bold;cursor:pointer;">📋 Lấy dữ liệu + tải ảnh (Alt+G)</button>
      <button id="ea-btn-get-notag" style="padding:8px 12px;background:#0D9488;color:#fff;border:none;border-radius:6px;font-weight:bold;cursor:pointer;">📋 Chỉ lấy dữ liệu (Alt+C)</button>
      <button id="ea-btn-paste" style="padding:8px 12px;background:#2563EB;color:#fff;border:none;border-radius:6px;font-weight:bold;cursor:pointer;">📝 Dán dữ liệu + upload ảnh (Alt+V)</button>
      <button id="ea-btn-bangsize" style="padding:6px 12px;background:#fff;color:#374151;border:1px solid #D1D5DB;border-radius:6px;font-size:12px;cursor:pointer;">📐 Ảnh bảng size (<span id="ea-bangsize-dem">0</span>)</button>
      <button id="ea-btn-apikey" style="padding:6px 8px;background:#F3F4F6;color:#374151;border:1px solid #D1D5DB;border-radius:6px;font-size:11px;font-weight:bold;cursor:pointer;text-align:center;">🔑 <span id="ea-apikey-label"></span> · <span id="ea-quota-inline">⚡ …</span></button>
      <button id="ea-btn-autostats" style="padding:6px 12px;background:#fff;color:#374151;border:1px solid #D1D5DB;border-radius:6px;font-size:12px;cursor:pointer;"></button>
    `;
    khungMoRong.appendChild(vungNut);
    khung.appendChild(khungMoRong);

    function hienThiThuNho() {
      bieuTuongThuNho.style.display = 'flex';
      khungMoRong.style.display = 'none';
      luuTrangThaiPanel({ minimized: true });
    }

    function hienThiMoRong() {
      bieuTuongThuNho.style.display = 'none';
      khungMoRong.style.display = 'flex';
      luuTrangThaiPanel({ minimized: false });
      // Sau khi mo rong, dam bao panel khong bi trang ra ngoai man hinh
      const rect = khung.getBoundingClientRect();
      const maxLeft = window.innerWidth - rect.width;
      const maxTop = window.innerHeight - rect.height;
      if (khung.style.left) {
        const leftHienTai = parseFloat(khung.style.left) || 0;
        const topHienTai = parseFloat(khung.style.top) || 0;
        khung.style.left = `${Math.min(Math.max(0, leftHienTai), Math.max(0, maxLeft))}px`;
        khung.style.top = `${Math.min(Math.max(0, topHienTai), Math.max(0, maxTop))}px`;
      }
    }

    // Ap dung trang thai thu nho/mo rong da luu (mac dinh: thu nho)
    if (trangThai.minimized === false) {
      hienThiMoRong();
    } else {
      hienThiThuNho();
    }

    // Keo tha: bieu tuong thu nho keo+bam de mo rong; thanh tieu de khi mo rong chi de keo
    ganKeoTha(bieuTuongThuNho, khung, hienThiMoRong);
    ganKeoTha(thanhTieuDe, khung, null);

    document.getElementById('ea-btn-minimize').onclick = (e) => {
      e.stopPropagation();
      hienThiThuNho();
    };

    document.getElementById('ea-btn-get').onclick = layVaTaiAnh;
    document.getElementById('ea-btn-get-notag').onclick = chiLayTieuDeVaTag;
    document.getElementById('ea-btn-paste').onclick = danTieuDeVaTag;

    // Nut mo thu vien anh bang size cua nguoi dung — dem so anh dang co ngay tren nhan nut
    const nhanSoBangSize = document.getElementById('ea-bangsize-dem');
    const capNhatSoBangSize = () => {
      nhanSoBangSize.textContent = docThuVienBangSize().length;
    };
    capNhatSoBangSize();
    document.getElementById('ea-btn-bangsize').onclick = async () => {
      await moQuanLyBangSize();
      capNhatSoBangSize();
    };

    // Nut gop: nhan/doi khoa API (bam de mo hop thoai nhap) + dong ho han muc hom nay,
    // cho biet hom nay da dung bao nhieu trong 5.000 request, doi mau khi sap het.
    const nhanApiKey = document.getElementById('ea-apikey-label');
    const oQuota = document.getElementById('ea-quota-inline');
    const capNhatNhanApiKey = () => {
      nhanApiKey.textContent = coKhoaXacThuc() ? 'Đã có khoá API' : 'Chưa có khoá API';
    };
    const capNhatQuota = () => {
      if (!oQuota) return;
      const { so } = docDemNgay();
      const conLai = Math.max(0, GIOI_HAN_QPD - so);
      oQuota.textContent = `⚡ ${so.toLocaleString('vi-VN')}/${GIOI_HAN_QPD.toLocaleString('vi-VN')}`;
      oQuota.style.color = conLai === 0 ? '#DC2626' : conLai < 500 ? '#D97706' : 'inherit';
      oQuota.title = `Còn ${conLai.toLocaleString('vi-VN')} request cho hôm nay (giới hạn Etsy: ${GIOI_HAN_QPD.toLocaleString('vi-VN')}/ngày, 5 QPS)`;
    };
    capNhatNhanApiKey();
    capNhatQuota();
    HEN_GIO.setInterval(capNhatQuota, 5000);
    document.getElementById('ea-btn-apikey').onclick = async () => {
      await hoiApiKey();
      capNhatNhanApiKey();
    };

    // Nut gop: bat/tat tu hien the thong ke moi khi mo mot listing (bam BAT se hien luon
    // the cua listing dang mo, giong nhu nut "Thong ke listing" rieng truoc day).
    const nutTuHien = document.getElementById('ea-btn-autostats');
    const capNhatNhanTuHien = () => {
      nutTuHien.textContent = dangBatTuHien() ? '📊 Thống kê listing: BẬT' : '📊 Thống kê listing: TẮT';
    };
    capNhatNhanTuHien();
    nutTuHien.onclick = () => {
      const batMoi = !dangBatTuHien();
      luuTrangThaiPanel({ [KHOA_TU_HIEN_THONG_KE]: batMoi });
      capNhatNhanTuHien();
      if (batMoi) {
        hienThongKeListing();
        ganThongKeVaoLuoi();
      } else {
        xoaTheThongKe();
        xoaTatCaTheMini();
      }
    };
  }

  // Chi kich hoat giao dien + tinh nang tren dung 3 dang trang lam viec, khong hien tool o
  // nhung trang khong lien quan (trang chu, gio hang, tin nhan, tai khoan...):
  //   - /search                        trang tim kiem / luoi san pham
  //   - /listing/...                   trang chi tiet 1 listing — nguon de Alt+G / Alt+C
  //   - /your/shops/me/listing-editor  trang tao/sua listing — dich de Alt+V
  function trangDuocHoTro() {
    const duong = location.pathname;
    return (
      /\/search(\/|$)/.test(duong) ||
      /\/listing\//.test(duong) ||
      duong.includes('/your/shops/me/listing-editor')
    );
  }

  if (trangDuocHoTro()) {
    taoGiaoDien();

    console.log(
      `%c[Etsy Auto] Đã nạp script phiên bản ${PHIEN_BAN}`,
      'background:#F56400;color:#fff;padding:2px 6px;border-radius:4px;font-weight:bold;',
      `| Nguồn hẹn giờ: ${HEN_GIO.nguon} | API hôm nay: ${docDemNgay().so}/${GIOI_HAN_QPD}`
    );

    // Tu hien the thong ke khi dang o trang listing (co the tat bang nut trong panel).
    // "imLangKhiLoi" de lan chay tu dong khong bung toast do khi chua nhap khoa hay API tam loi —
    // nguoi dung dau co chu dong yeu cau gi.
    if (layListingId() && dangBatTuHien()) {
      hienThongKeListing({ imLangKhiLoi: true });
    }

    // Gan the mini vao luoi san pham tren MOI trang, va theo doi de gan tiep khi trang nap them the
    ganThongKeVaoLuoi();
    theoDoiLuoiSanPham();

    document.addEventListener('keydown', (e) => {
      if (!e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'g') { e.preventDefault(); layVaTaiAnh(); }
      if (key === 'c') { e.preventDefault(); chiLayTieuDeVaTag(); }
      if (key === 'v') { e.preventDefault(); danTieuDeVaTag(); }
    });
  }
})();
