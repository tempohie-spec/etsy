// ==UserScript==
// @name         Etsy Auto - Lay Tieu De, Tag & Tai Anh Full Size (quet tu data-carousel-pagination-list, tai rieng le, khong nen zip, dung Clipboard he thong)
// @namespace    etsy-auto-local
// @version      5.0
// @description  Lay tieu de + tag (co hoac khong tai anh full size, luu tung file rieng - khong nen zip) tren trang nguon, luu vao Clipboard he thong (dung chung duoc giua nhieu trinh duyet), tu dong tim va dan gop tieu de + tag tren trang chinh sua Etsy, sau do tu dong bam vao tab Photo & Video va giu lai tieu de trong Clipboard de dan rieng noi khac. Anh duoc lay tu khoi "data-carousel-pagination-list" (dung anh cua listing), doi il_75x75 -> il_fullxfull roi tai tung file. Giao dien co the thu nho thanh 1 bieu tuong "Listing" va keo tha tu do.
// @match        https://www.etsy.com/*
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @connect      i.etsystatic.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // Ky tu dung de noi Tieu de va Tag lai thanh 1 chuoi duy nhat khi luu vao clipboard
  const NGAN_CACH = '|||TAGS|||';

  // Khoang cach (ms) giua 2 lan tai file lien tiep, de trinh duyet khong chan cac ban tai lien tuc.
  // Neu bi mat anh giua chung (trinh duyet bop bot), tang len 1000-1500.
  const KHOANG_CACH_GIUA_CAC_LAN_TAI = 700;

  // Khi KHONG tim thay khoi carousel va phai quet ca trang (che do du phong),
  // bo bot 1 anh cuoi cung tim thay (thuong la anh khong thuoc listing).
  const BO_ANH_CUOI_KHI_QUET_CA_TRANG = true;

  // Key luu trang thai giao dien (vi tri + thu nho hay khong) vao localStorage cua trang Etsy,
  // de giu nguyen giua cac lan tai lai trang.
  const PANEL_STATE_KEY = 'etsy_auto_panel_state_v1';

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
    clearTimeout(box._timer);
    box._timer = setTimeout(() => (box.style.display = 'none'), 4000);
  }

  function cho(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function timTheoChuHienThi(danhSachThe, chu) {
    return [...document.querySelectorAll(danhSachThe)].find(
      (el) => el.textContent.trim().toLowerCase() === chu.toLowerCase() && el.children.length === 0
    );
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

  // Tach chuoi da luu trong clipboard thanh { tieuDe, tagText }
  function tachDuLieu(chuoi) {
    if (!chuoi || !chuoi.includes(NGAN_CACH)) return { tieuDe: '', tagText: '' };
    const [tieuDe, tagText] = chuoi.split(NGAN_CACH);
    return { tieuDe: (tieuDe || '').trim(), tagText: (tagText || '').trim() };
  }

  // Ghi chuoi vao clipboard he thong. Dung GM_setClipboard truoc (dong bo, on dinh hon),
  // neu khong co thi du phong bang navigator.clipboard.writeText.
  async function ghiClipboard(chuoi) {
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(chuoi, 'text');
      return true;
    }
    try {
      await navigator.clipboard.writeText(chuoi);
      return true;
    } catch (e) {
      return false;
    }
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

  // Lay danh sach anh full size cua listing.
  // Uu tien: chi doc trong khoi "data-carousel-pagination-list" (dung 100% anh cua listing,
  // khong dinh anh gia hang / anh shop khac). Neu khong tim thay khoi nay moi quet ca trang.
  function layDanhSachAnhFullSize() {
    const khoi = timKhoiCarousel();

    if (khoi) {
      const danhSach = rutLinkFullSize(khoi.outerHTML);
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

    // Che do du phong: quet toan bo HTML cua trang
    const danhSach = rutLinkFullSize(document.documentElement.outerHTML);
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

  // CACH 1 (uu tien): GM_download tai THANG tu URL goc.
  // Yeu cau tai nay do TIEN ICH (Violentmonkey/Tampermonkey) thuc hien, khong phai trang web,
  // nen uBlock Origin / AdBlock khong loc duoc, va trinh duyet cung KHONG hien popup
  // "This site wants to download multiple files".
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

  // Thu tai 1 anh, neu loi thi thu lai them vai lan truoc khi bo cuoc
  async function taiMotAnhVoiRetry(url, soLanThuLai = 2) {
    let loiCuoi;
    for (let lan = 0; lan <= soLanThuLai; lan++) {
      try {
        return await taiMotAnh(url);
      } catch (loi) {
        loiCuoi = loi;
        if (lan < soLanThuLai) {
          console.warn(`[Etsy Auto] Lỗi tải ảnh, thử lại lần ${lan + 1}/${soLanThuLai}:`, url, loi.message);
          await cho(800);
        }
      }
    }
    throw loiCuoi;
  }

  // CACH 2: da co san du lieu anh (blob) -> nho GM_download luu xuong may
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
          setTimeout(() => URL.revokeObjectURL(urlTaiVe), 5000);
          resolve('gm_download_blob');
        },
        onerror: (loi) => {
          setTimeout(() => URL.revokeObjectURL(urlTaiVe), 5000);
          reject(new Error('GM_download (blob) báo lỗi: ' + JSON.stringify(loi)));
        },
        ontimeout: () => {
          setTimeout(() => URL.revokeObjectURL(urlTaiVe), 5000);
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
        setTimeout(() => URL.revokeObjectURL(urlTaiVe), 8000);
        resolve('a_tag');
      } catch (loi) {
        reject(loi);
      }
    });
  }

  // Luu 1 anh xuong may, thu lan luot 3 cach tu "an toan voi adblock" nhat tro xuong
  async function luuAnhXuongMay(url, tenFile) {
    try {
      return await taiBangGmDownloadTuUrl(url, tenFile);
    } catch (loi) {
      console.warn('[Etsy Auto] GM_download từ URL thất bại, chuyển sang tải dữ liệu rồi lưu:', loi.message);
    }

    const duLieu = await taiMotAnhVoiRetry(url);
    const duoi = laySoDuoiFile(url);
    const blob = new Blob([duLieu], { type: laMimeTheoDuoi(duoi) });

    try {
      return await taiBangGmDownloadTuBlob(blob, tenFile);
    } catch (loi) {
      console.warn('[Etsy Auto] GM_download từ blob thất bại, thử bằng thẻ <a>:', loi.message);
    }
    return taiBangTheA(blob, tenFile);
  }

  // Tai TUNG anh full size mot, luu thanh file rieng le xuong may (KHONG nen zip)
  async function taiTungAnhRieng(tieuDe) {
    const { danhSach: danhSachUrl, nguon } = layDanhSachAnhFullSize();

    if (danhSachUrl.length === 0) {
      hienThongBao('⚠️ Không tìm thấy ảnh nào trên trang này', '#DC2626');
      return;
    }

    if (nguon === 'ca_trang') {
      hienThongBao('⚠️ Không thấy khối carousel ảnh, đang quét cả trang (có thể dính ảnh thừa)', '#F59E0B');
      await cho(1200);
    }

    hienThongBao(`⏳ Đang tải ${danhSachUrl.length} ảnh (từng file riêng)...`, '#2563EB');

    const tenGoc = lamSachTenFile(tieuDe);
    let soLuongThanhCong = 0;
    const danhSachLoi = [];

    for (let i = 0; i < danhSachUrl.length; i++) {
      const url = danhSachUrl[i];
      const soThuTu = String(i + 1).padStart(2, '0');
      try {
        const duoi = laySoDuoiFile(url);
        const tenFile = `${tenGoc} - ${soThuTu}.${duoi}`;
        const cachTai = await luuAnhXuongMay(url, tenFile);
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
        `⚠️ Đã tải ${soLuongThanhCong}/${danhSachUrl.length} ảnh. Lỗi ảnh số: ${danhSachLoi.join(', ')}`,
        '#F59E0B'
      );
    } else {
      hienThongBao(`✅ Đã tải xong tất cả ${soLuongThanhCong} ảnh (file riêng lẻ, không nén zip)`, '#16A34A');
    }

    console.log(
      '[Etsy Auto] Lưu ý: nếu trình duyệt vẫn hiện popup "This site wants to download multiple files", ' +
      'hãy bấm Allow/Cho phép, hoặc vào Cài đặt trang của etsy.com và bật "Automatic downloads / Tải xuống tự động".'
    );
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

  // Ham dung chung: lay tieu de + tag, va CHI tai anh full size (tung file rieng) neu coTaiAnh = true
  async function layVaLuuDuLieu(coTaiAnh = true) {
    const tieuDe = layTieuDe() || '';
    const daLuuTieuDe = !!tieuDe;
    if (daLuuTieuDe) {
      console.log('[Etsy Auto] Tiêu đề lấy được:', tieuDe);
    } else {
      console.warn('[Etsy Auto] KHÔNG tìm thấy tiêu đề trên trang này (kiểm tra lại selector h1)');
    }

    // Chi tai anh full size (tung file rieng) neu coTaiAnh = true (chay nen, khong lien quan clipboard)
    if (coTaiAnh) {
      taiTungAnhRieng(tieuDe).catch((loi) => {
        console.error('[Etsy Auto] Lỗi khi tải ảnh:', loi);
        hienThongBao('❌ Lỗi khi tải ảnh: ' + loi.message, '#DC2626');
      });
    }

    const nutCopy = timNutCopyTag();
    if (nutCopy) {
      // Nut Copy co san se ghi de tag vao clipboard, nen phai doi no chay xong roi moi doc lai va ghi de ca goi (title+tag)
      nutCopy.click();
      setTimeout(async () => {
        let tagText = '';
        try {
          tagText = await navigator.clipboard.readText();
          console.log('[Etsy Auto] Tag lấy được:', tagText);
        } catch (e) {
          hienThongBao('⚠️ Không đọc được clipboard cho tag. Hãy cho phép quyền clipboard cho trang này.', '#DC2626');
          return;
        }

        const goiDuLieu = `${tieuDe}${NGAN_CACH}${tagText}`;
        const ok = await ghiClipboard(goiDuLieu);

        const ghiChuAnh = coTaiAnh ? ', đang tải ảnh full size' : '';
        if (ok && daLuuTieuDe) {
          hienThongBao(`✅ Đã lấy tiêu đề + tag${ghiChuAnh}!`, '#16A34A');
        } else if (ok) {
          hienThongBao(`⚠️ Đã lấy tag${ghiChuAnh}, nhưng KHÔNG tìm thấy tiêu đề trên trang này!`, '#DC2626');
        } else {
          hienThongBao('❌ Không ghi được vào Clipboard', '#DC2626');
        }
      }, 400);
    } else if (daLuuTieuDe) {
      const ok = await ghiClipboard(`${tieuDe}${NGAN_CACH}`);
      const ghiChuAnh = coTaiAnh ? ', đang tải ảnh full size' : '';
      hienThongBao(
        ok
          ? `✅ Đã lấy tiêu đề${ghiChuAnh} (không thấy nút Copy tag trên trang này)`
          : '❌ Không ghi được vào Clipboard',
        ok ? '#16A34A' : '#DC2626'
      );
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
      console.log('[Etsy Auto] Đã bấm vào tab Photo & Video');
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
    console.log('[Etsy Auto] Kết quả tìm ô Tiêu đề:', el);
    if (!el) {
      return { ok: false, ly_do: '⚠️ Không tìm thấy ô Tiêu đề trên trang này' };
    }
    if (!tieuDe) {
      return { ok: false, ly_do: '⚠️ Clipboard chưa có tiêu đề' };
    }
    el.focus();
    setNativeValue(el, tieuDe);
    console.log('[Etsy Auto] Giá trị ô Tiêu đề sau khi dán:', el.value);
    return { ok: true };
  }

  // Dan tag. Tra ve true/false de ham gop biet co thanh cong khong.
  async function danTagNoiBo(tagText) {
    const { input, nutAdd } = timOTag();
    console.log('[Etsy Auto] Kết quả tìm ô Tag:', input, '| Nút Add:', nutAdd);
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

  // Ham gop: doc Clipboard 1 lan roi dan ca tieu de va tag, sau do tu dong bam tab Photo & Video
  async function danTieuDeVaTag() {
    const { tieuDe, tagText } = tachDuLieu(await docClipboard());
    if (!tieuDe && !tagText) {
      hienThongBao('⚠️ Clipboard chưa có dữ liệu. Hãy chạy Alt+G trên trang nguồn trước rồi copy sang trình duyệt này', '#DC2626');
      return;
    }

    hienThongBao('⏳ Đang dán tiêu đề + tag...', '#2563EB');

    const ketQuaTieuDe = danTieuDeNoiBo(tieuDe);
    const ketQuaTag = await danTagNoiBo(tagText);

    // Sau khi dan xong (it nhat 1 trong 2 thanh cong), doi 1 chut roi tu dong bam vao tab "Photo & Video"
    if (ketQuaTieuDe.ok || ketQuaTag.ok) {
      await cho(300);
      timVaBamTabPhotoVideo();
    }

    // Ghi de Clipboard he thong: chi con lai TIEU DE (khong con phan tag/ky tu ngan cach),
    // de sau do bam Ctrl+V thuong o bat ky o nao khac se dan duoc rieng tieu de
    if (tieuDe) {
      await ghiClipboard(tieuDe);
      console.log('[Etsy Auto] Đã ghi lại Clipboard, chỉ còn tiêu đề để dùng Ctrl+V ở nơi khác');
    }

    if (ketQuaTieuDe.ok && ketQuaTag.ok) {
      hienThongBao(`✅ Đã dán tiêu đề + ${ketQuaTag.soLuong} tag!`, '#16A34A');
    } else if (ketQuaTieuDe.ok) {
      hienThongBao(`✅ Đã dán tiêu đề. ${ketQuaTag.ly_do}`, '#DC2626');
    } else if (ketQuaTag.ok) {
      hienThongBao(`✅ Đã dán ${ketQuaTag.soLuong} tag. ${ketQuaTieuDe.ly_do}`, '#DC2626');
    } else {
      hienThongBao(`❌ ${ketQuaTieuDe.ly_do} | ${ketQuaTag.ly_do}`, '#DC2626');
    }
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
  function ganKeoTha(tayCam, panelEl, onClick) {
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
      luuTrangThaiPanel({ left: panelEl.style.left, top: panelEl.style.top });
      if (!daDiChuyen && typeof onClick === 'function') onClick();
    });
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
      <span>🏷️ Listing Tools</span>
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
      <button id="ea-btn-get" style="padding:8px 12px;background:#F56400;color:#fff;border:none;border-radius:6px;font-weight:bold;cursor:pointer;">📋 Lấy dữ liệu + tải ảnh full size (Alt+G)</button>
      <button id="ea-btn-get-notag" style="padding:8px 12px;background:#0D9488;color:#fff;border:none;border-radius:6px;font-weight:bold;cursor:pointer;">📋 Chỉ lấy tiêu đề + tag (Alt+C)</button>
      <button id="ea-btn-paste" style="padding:8px 12px;background:#2563EB;color:#fff;border:none;border-radius:6px;font-weight:bold;cursor:pointer;">📝🏷️ Dán tiêu đề + tag (Alt+V)</button>
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
  }

  taoGiaoDien();

  document.addEventListener('keydown', (e) => {
    if (!e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'g') { e.preventDefault(); layVaTaiAnh(); }
    if (key === 'c') { e.preventDefault(); chiLayTieuDeVaTag(); }
    if (key === 'v') { e.preventDefault(); danTieuDeVaTag(); }
  });
})();
