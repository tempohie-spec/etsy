// ==UserScript==
// @name         Etsy Auto - Lay Tieu De, Tag, Ca Nhan Hoa & Tai Anh Full Size (quet tu data-carousel-pagination-list, tai rieng le, khong nen zip, dung Clipboard he thong)
// @namespace    etsy-auto-local
// @version      6.1
// @description  Lay tieu de + tag + o ca nhan hoa (Add personalization) (co hoac khong tai anh full size, luu tung file rieng - khong nen zip) tren trang nguon, luu vao Clipboard he thong (dung chung duoc giua nhieu trinh duyet), tu dong tim va dan gop tieu de + tag + tao Custom option (Add field > Text box) tren trang chinh sua Etsy, sau do tu dong bam vao tab Photo & Video va giu lai tieu de trong Clipboard de dan rieng noi khac. Anh duoc lay tu khoi "data-carousel-pagination-list" (dung anh cua listing), doi il_75x75 -> il_fullxfull roi tai tung file. Giao dien co the thu nho thanh 1 bieu tuong "Listing" va keo tha tu do.
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
  const PHIEN_BAN = '6.1';

  // Ky tu dung de noi Tieu de va Tag lai thanh 1 chuoi duy nhat khi luu vao clipboard
  const NGAN_CACH = '|||TAGS|||';

  // Ky tu ngan cach cho phan "Add personalization" lay tu trang nguon.
  // Goi du lieu day du: tieuDe |||TAGS||| tag |||PERSO_LABEL||| nhan |||PERSO_INSTR||| huong dan
  // (neu listing khong co o ca nhan hoa thi khong co 2 doan sau -> van tuong thich ban cu)
  const NGAN_CACH_PERSO_NHAN = '|||PERSO_LABEL|||';
  const NGAN_CACH_PERSO_HUONG_DAN = '|||PERSO_INSTR|||';

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

  // Tach chuoi lam 2 phan tai LAN XUAT HIEN DAU TIEN cua dau ngan cach
  function tachMotLan(chuoi, dauNganCach) {
    const viTri = chuoi.indexOf(dauNganCach);
    if (viTri === -1) return [chuoi, null];
    return [chuoi.slice(0, viTri), chuoi.slice(viTri + dauNganCach.length)];
  }

  // Gop tieu de + tag + ca nhan hoa thanh 1 chuoi duy nhat de luu vao clipboard
  function taoGoiDuLieu(tieuDe, tagText, perso) {
    let goi = `${tieuDe || ''}${NGAN_CACH}${tagText || ''}`;
    if (perso && perso.nhan) {
      goi += `${NGAN_CACH_PERSO_NHAN}${perso.nhan}${NGAN_CACH_PERSO_HUONG_DAN}${perso.huongDan || ''}`;
    }
    return goi;
  }

  // Tach chuoi da luu trong clipboard thanh { tieuDe, tagText, persoNhan, persoHuongDan }
  function tachDuLieu(chuoi) {
    const rong = { tieuDe: '', tagText: '', persoNhan: '', persoHuongDan: '' };
    if (!chuoi || !chuoi.includes(NGAN_CACH)) return rong;

    const [tieuDe, phanSauTieuDe] = tachMotLan(chuoi, NGAN_CACH);
    let tagText = phanSauTieuDe || '';
    let persoNhan = '';
    let persoHuongDan = '';

    const [tagThoi, phanPerso] = tachMotLan(tagText, NGAN_CACH_PERSO_NHAN);
    if (phanPerso !== null) {
      tagText = tagThoi;
      const [nhan, huongDan] = tachMotLan(phanPerso, NGAN_CACH_PERSO_HUONG_DAN);
      persoNhan = nhan;
      persoHuongDan = huongDan || '';
    }

    return {
      tieuDe: tieuDe.trim(),
      tagText: tagText.trim(),
      persoNhan: persoNhan.trim(),
      persoHuongDan: persoHuongDan.trim(),
    };
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

    // Chi hien canh bao ve viec tai bi treo DUNG 1 LAN cho ca lo anh,
    // tranh spam toast neu nhieu anh lien tiep cung gap.
    let daCanhBaoTreo = false;
    const baoTreo = () => {
      if (daCanhBaoTreo) return;
      daCanhBaoTreo = true;
      hienThongBao('⚠️ Một bước tải bị treo quá lâu, script đang tự chuyển sang cách khác...', '#F59E0B');
    };

    for (let i = 0; i < danhSachUrl.length; i++) {
      const url = danhSachUrl[i];
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
        `⚠️ Đã tải ${soLuongThanhCong}/${danhSachUrl.length} ảnh. Lỗi ảnh số: ${danhSachLoi.join(', ')}`,
        '#F59E0B'
      );
    } else {
      hienThongBao(`✅ Đã tải xong tất cả ${soLuongThanhCong} ảnh (file riêng lẻ, không nén zip)`, '#16A34A');
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
      return { nhan: '', huongDan: '' };
    }

    // Xac nhan lai day dung la khu vuc ca nhan hoa: ben trong phai co o nhap ca nhan hoa
    // (id bat dau bang "perso-input-") hoac phan huong dan / o ca nhan hoa that su.
    const dungLaVungPerso = !!vung.querySelector(
      '[id^="perso-input-"], [data-instructions], li[id^="perso-field-"]'
    );
    if (!dungLaVungPerso) {
      console.log('[Etsy Auto] Có khối cá nhân hoá nhưng rỗng — bỏ qua phần cá nhân hoá');
      return { nhan: '', huongDan: '' };
    }

    let nhan = docTextGiuXuongDong(vung.querySelector('[data-label]'));
    if (!nhan) {
      const elDich = vung.querySelector('[data-label-translation]');
      if (elDich) nhan = (elDich.getAttribute('data-label-translation') || '').trim();
    }

    const huongDan = docTextGiuXuongDong(vung.querySelector('[data-instructions]'));

    if (nhan || huongDan) {
      console.log('[Etsy Auto] Cá nhân hoá — nhãn:', nhan, '| hướng dẫn:', huongDan);
    } else {
      console.warn('[Etsy Auto] Thấy khu vực cá nhân hoá nhưng không đọc được data-label / data-instructions');
    }

    return { nhan, huongDan };
  }

  // ================== LAY TAG QUA ETSY OPEN API v3 ==================

  // Trang listing cua Etsy KHONG he chua tag trong HTML (Etsy da bo hien thi tag cong khai
  // tu lau). Cach chinh thong duy nhat de lay tag cua bat ky listing nao la goi Etsy Open API v3:
  //   GET https://openapi.etsy.com/v3/application/listings/{listing_id}   (header: x-api-key)
  // Day la endpoint cap ung dung: chi can API key, KHONG can OAuth, khong can dang nhap.

  // API key duoc luu bang GM_setValue (nam trong Violentmonkey tren may nguoi dung),
  // TUYET DOI khong ghi thang vao file nay — repo nay la repo public, ai cung doc duoc.
  const KHOA_LUU_API_KEY = 'etsy_api_key';

  function docApiKey() {
    try {
      return (typeof GM_getValue === 'function' ? GM_getValue(KHOA_LUU_API_KEY, '') : '') || '';
    } catch (e) {
      console.warn('[Etsy Auto] Không đọc được API key đã lưu:', e);
      return '';
    }
  }

  function luuApiKey(khoa) {
    try {
      if (typeof GM_setValue === 'function') GM_setValue(KHOA_LUU_API_KEY, khoa);
      return true;
    } catch (e) {
      console.warn('[Etsy Auto] Không lưu được API key:', e);
      return false;
    }
  }

  // Mo hop thoai cho nguoi dung nhap / doi API key
  function hoiApiKey() {
    const hienTai = docApiKey();
    const nhap = prompt(
      'Nhập Etsy API key (keystring) để lấy tag qua API chính thức.\n' +
        'Lấy tại: https://www.etsy.com/developers/register\n\n' +
        'Để trống rồi bấm OK để xoá key đã lưu.',
      hienTai
    );
    if (nhap === null) return hienTai; // bam Cancel -> giu nguyen

    const khoa = nhap.trim();
    luuApiKey(khoa);
    hienThongBao(
      khoa ? '✅ Đã lưu API key' : '🗑️ Đã xoá API key (quay lại lấy tag bằng nút Copy)',
      khoa ? '#16A34A' : '#F59E0B'
    );
    return khoa;
  }

  // Lay listing id tu duong dan: https://www.etsy.com/listing/4550390920/...
  function layListingId() {
    const khop = location.pathname.match(/\/listing\/(\d+)/);
    return khop ? khop[1] : null;
  }

  function goiApiLayListing(listingId, apiKey) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error('Thiếu quyền GM_xmlhttpRequest'));
        return;
      }
      GM_xmlhttpRequest({
        method: 'GET',
        url: `https://openapi.etsy.com/v3/application/listings/${listingId}`,
        headers: { 'x-api-key': apiKey },
        timeout: 15000,
        onload: (res) => {
          if (res.status === 200) {
            try {
              resolve(JSON.parse(res.responseText));
            } catch (e) {
              reject(new Error('API trả về dữ liệu không đọc được: ' + e.message));
            }
            return;
          }
          if (res.status === 401 || res.status === 403) {
            reject(new Error(`API key bị từ chối (mã ${res.status}) — kiểm tra lại key`));
          } else if (res.status === 404) {
            reject(new Error('API không tìm thấy listing này (404)'));
          } else if (res.status === 429) {
            reject(new Error('Vượt giới hạn API (429) — chờ một lát rồi thử lại'));
          } else {
            reject(new Error(`API trả về mã ${res.status}`));
          }
        },
        onerror: () => reject(new Error('Không gọi được API Etsy')),
        ontimeout: () => reject(new Error('API Etsy không phản hồi')),
      });
    });
  }

  // Tra ve chuoi tag dang "tag1, tag2, ..." neu lay duoc, nguoc lai tra ve ''
  async function layTagQuaApi() {
    const apiKey = docApiKey();
    if (!apiKey) return '';

    const listingId = layListingId();
    if (!listingId) {
      console.warn('[Etsy Auto] Không lấy được listing id từ URL nên bỏ qua API');
      return '';
    }

    try {
      const duLieu = await voiThoiHan(
        goiApiLayListing(listingId, apiKey),
        THOI_HAN_MOI_CACH_TAI,
        'API Etsy không phản hồi sau ' + THOI_HAN_MOI_CACH_TAI / 1000 + 's'
      );
      const danhSachTag = Array.isArray(duLieu.tags) ? duLieu.tags : [];
      if (danhSachTag.length === 0) {
        console.warn('[Etsy Auto] API trả về thành công nhưng listing này không có tag nào');
        return '';
      }
      return danhSachTag.join(', ');
    } catch (loi) {
      console.warn('[Etsy Auto] Lấy tag qua API thất bại, quay lại dùng nút Copy:', loi.message);
      hienThongBao('⚠️ API lỗi: ' + loi.message, '#F59E0B');
      return '';
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
    const tagApi = await layTagQuaApi();
    if (tagApi) return { tagText: tagApi, nguon: 'API Etsy' };

    const tagCopy = await layTagQuaNutCopy();
    if (tagCopy) return { tagText: tagCopy, nguon: 'nút Copy' };

    return { tagText: '', nguon: '' };
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

    // Chi tai anh full size (tung file rieng) neu coTaiAnh = true (chay nen, khong lien quan clipboard)
    if (coTaiAnh) {
      taiTungAnhRieng(tieuDe).catch((loi) => {
        console.error('[Etsy Auto] Lỗi khi tải ảnh:', loi);
        hienThongBao('❌ Lỗi khi tải ảnh: ' + loi.message, '#DC2626');
      });
    }

    const { tagText, nguon: nguonTag } = await layTag();
    if (tagText) {
      console.log(`[Etsy Auto] Tag lấy được (${nguonTag}):`, tagText);
    }

    const ok = await ghiClipboard(taoGoiDuLieu(tieuDe, tagText, perso));
    if (!ok) {
      hienThongBao('❌ Không ghi được vào Clipboard', '#DC2626');
      return;
    }

    const ghiChuAnh = coTaiAnh ? ', đang tải ảnh full size' : '';
    const ghiChuNguon = tagText ? ` [${nguonTag}]` : '';

    if (daLuuTieuDe && tagText) {
      hienThongBao(`✅ Đã lấy tiêu đề + tag${ghiChuNguon}${ghiChuPerso}${ghiChuAnh}!`, '#16A34A');
    } else if (daLuuTieuDe) {
      hienThongBao(
        `⚠️ Đã lấy tiêu đề${ghiChuPerso}${ghiChuAnh} nhưng KHÔNG lấy được tag ` +
          '(chưa có API key? bấm 🔑 trong panel để nhập)',
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

  // Muc "Text box" trong menu vua xo ra (phan "Create new")
  function timMucTextBox() {
    const cacMuc = [...document.querySelectorAll('[role="menuitem"], button.wt-options__item')];
    return cacMuc.find(
      (muc) =>
        muc.getAttribute('aria-disabled') !== 'true' &&
        [...muc.querySelectorAll('*')].some(
          (x) => x.children.length === 0 && x.textContent.trim().toLowerCase() === 'text box'
        )
    );
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
  async function danCaNhanHoaNoiBo(nhan, huongDan) {
    if (!nhan) {
      return { boQua: true, ok: false, ly_do: 'ℹ️ Clipboard không có dữ liệu cá nhân hoá' };
    }

    const nutAddField = timNutAddField();
    if (!nutAddField) {
      return { ok: false, ly_do: '⚠️ Không tìm thấy nút "Add field" (mở tab Item Options trước)' };
    }
    nutAddField.click();

    const mucTextBox = await doiPhanTu(timMucTextBox, 5000);
    if (!mucTextBox) {
      return { ok: false, ly_do: '⚠️ Không tìm thấy mục "Text box" trong menu Add field' };
    }
    mucTextBox.click();

    const oNhan = await doiPhanTu(timOFieldTitle, 5000);
    if (!oNhan) {
      return { ok: false, ly_do: '⚠️ Không mở được hộp thoại "Add text box"' };
    }

    // Etsy gioi han 45 ky tu cho Field title va 120 ky tu cho Instructions -> cat bot cho vua
    const nhanCat = nhan.slice(0, GIOI_HAN_NHAN_FIELD);
    if (nhanCat.length < nhan.length) {
      console.warn(`[Etsy Auto] Field title bị cắt còn ${GIOI_HAN_NHAN_FIELD} ký tự:`, nhanCat);
    }
    oNhan.focus();
    setNativeValue(oNhan, nhanCat);
    await cho(250);

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

    const daBamDone = await bamNutDoneChacChan();
    if (!daBamDone) {
      return { ok: false, daDien: true, ly_do: '⚠️ Đã điền xong nhưng KHÔNG bấm được "Done", hãy bấm tay' };
    }
    await cho(300);

    return { ok: true };
  }

  // Ham gop: doc Clipboard 1 lan roi dan ca tieu de va tag, sau do tu dong bam tab Photo & Video
  async function danTieuDeVaTag() {
    const { tieuDe, tagText, persoNhan, persoHuongDan } = tachDuLieu(await docClipboard());
    if (!tieuDe && !tagText) {
      hienThongBao('⚠️ Clipboard chưa có dữ liệu. Hãy chạy Alt+G trên trang nguồn trước rồi copy sang trình duyệt này', '#DC2626');
      return;
    }

    hienThongBao('⏳ Đang dán tiêu đề + tag...', '#2563EB');

    const ketQuaTieuDe = danTieuDeNoiBo(tieuDe);
    const ketQuaTag = await danTagNoiBo(tagText);

    // Neu clipboard co du lieu ca nhan hoa thi tao them 1 Custom option dang Text box.
    // Boc trong try/catch de mot loi o day KHONG lam chet ca ham (truoc day loi o buoc nay
    // se lam bo qua luon phan bam tab va phan chuan hoa lai Clipboard).
    let ketQuaPerso = { boQua: true, ok: false, ly_do: '' };
    if (persoNhan) {
      hienThongBao('⏳ Đang tạo ô cá nhân hoá (Add field → Text box)...', '#2563EB');
      try {
        ketQuaPerso = await danCaNhanHoaNoiBo(persoNhan, persoHuongDan);
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
    const ghiChuPerso = ketQuaPerso.boQua ? '' : ketQuaPerso.ok ? ' + ô cá nhân hoá' : ` — ${ketQuaPerso.ly_do}`;
    const ghiChuTab = daBamTab ? ' → đã mở Photo & Video' : '';
    const ghiChuClipboard = daGiuLaiTieuDe ? ' (Clipboard giữ lại tiêu đề)' : '';
    const persoOn = ketQuaPerso.boQua || ketQuaPerso.ok;

    if (ketQuaTieuDe.ok && ketQuaTag.ok) {
      hienThongBao(
        `✅ Đã dán tiêu đề + ${ketQuaTag.soLuong} tag${ghiChuPerso}${ghiChuTab}${ghiChuClipboard}`,
        persoOn ? '#16A34A' : '#F59E0B'
      );
    } else if (ketQuaTieuDe.ok) {
      hienThongBao(`✅ Đã dán tiêu đề${ghiChuPerso}${ghiChuTab}. ${ketQuaTag.ly_do}`, '#DC2626');
    } else if (ketQuaTag.ok) {
      hienThongBao(`✅ Đã dán ${ketQuaTag.soLuong} tag${ghiChuPerso}${ghiChuTab}. ${ketQuaTieuDe.ly_do}`, '#DC2626');
    } else {
      hienThongBao(`❌ ${ketQuaTieuDe.ly_do} | ${ketQuaTag.ly_do}${ghiChuPerso}`, '#DC2626');
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
      <button id="ea-btn-get" style="padding:8px 12px;background:#F56400;color:#fff;border:none;border-radius:6px;font-weight:bold;cursor:pointer;">📋 Lấy dữ liệu + tải ảnh (Alt+G)</button>
      <button id="ea-btn-get-notag" style="padding:8px 12px;background:#0D9488;color:#fff;border:none;border-radius:6px;font-weight:bold;cursor:pointer;">📋 Chỉ lấy dữ liệu (Alt+C)</button>
      <button id="ea-btn-paste" style="padding:8px 12px;background:#2563EB;color:#fff;border:none;border-radius:6px;font-weight:bold;cursor:pointer;">📝 Dán dữ liệu (Alt+V)</button>
      <button id="ea-btn-apikey" style="padding:6px 12px;background:#fff;color:#374151;border:1px solid #D1D5DB;border-radius:6px;font-size:12px;cursor:pointer;">🔑 <span id="ea-apikey-label"></span></button>
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

    // Nut nhap / doi API key, kem nhan cho biet da co key hay chua
    const nhanApiKey = document.getElementById('ea-apikey-label');
    const capNhatNhanApiKey = () => {
      nhanApiKey.textContent = docApiKey() ? 'Đã có API key' : 'Chưa có API key';
    };
    capNhatNhanApiKey();
    document.getElementById('ea-btn-apikey').onclick = () => {
      hoiApiKey();
      capNhatNhanApiKey();
    };
  }

  taoGiaoDien();

  console.log(
    `%c[Etsy Auto] Đã nạp script phiên bản ${PHIEN_BAN}`,
    'background:#F56400;color:#fff;padding:2px 6px;border-radius:4px;font-weight:bold;',
    `| Nguồn hẹn giờ: ${HEN_GIO.nguon}`
  );

  document.addEventListener('keydown', (e) => {
    if (!e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'g') { e.preventDefault(); layVaTaiAnh(); }
    if (key === 'c') { e.preventDefault(); chiLayTieuDeVaTag(); }
    if (key === 'v') { e.preventDefault(); danTieuDeVaTag(); }
  });
})();
