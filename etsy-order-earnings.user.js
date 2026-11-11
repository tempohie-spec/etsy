// ==UserScript==
// @name         Etsy Order Scraper + Earnings -> Excel
// @namespace    etsy-order-scraper
// @version      3.7
// @description  Quet don hang Etsy + Earnings tung don + xuat Excel, VA tu dong dien tracking/hang van chuyen tu Google Sheet cho cac don tren trang /your/orders/sold (gop tu script "Etsy Auto Tracking"). Giao dien co the thu nho thanh 1 bieu tuong "Order" va keo tha tu do.
// @match        https://www.etsy.com/your/orders*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @connect      docs.google.com
// @connect      accounts.google.com
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/tempohie-spec/etsy/main/etsy-order-earnings.user.js
// @downloadURL  https://raw.githubusercontent.com/tempohie-spec/etsy/main/etsy-order-earnings.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ====== CAU HINH - CHINH LAI O DAY NEU CAN ======
  // Thu tu cot phai khop dung voi file excel mau cua ban.
  // Neu header thuc te khac ten ben duoi, sua lai cho dung.
  // Cot L: "Personalization", dung de chua gia tri personalization cua san pham.
  // Da them 1 cot trong ngay ben phai cot "Personalization" (key: ' ')
  // Da them lai 2 cot "PrintingMethod" va "Account" o DAU file (xem giai thich o duoi ham
  // xacDinhPhuongPhapIn). Da them cot "Earnings" ngay ben phai "Date Fulfil".
  // Cot "Date Fulfil" duoc TU DONG dien ngay chay script (dd/mm/yyyy), khong de trong nua.
  // File Excel xuat ra KHONG co dong header.
  const HEADERS = [
    'PrintingMethod', 'Account',
    'orderNumber', 'mockUpFront', 'Image',
    'designFront', 'designBack', 'title', 'color', 'size', 'quantity',
    'Personalization', ' ', 'name', 'address1', 'address2', 'city', 'state',
    'postalCode', 'country', 'phone', 'email', 'Date Fulfil', 'Earnings'
  ];

  // ====== QUY DOI MAU GHEP ("A/B/C") THEO LOAI AO ======
  // Etsy gop nhieu mau THAT SU khac nhau vao chung 1 lua chon "Color" dang "A/B/C" (vi du
  // "Ivory/Natural/Sand") vi cung 1 listing ban nhieu loai ao khac nhau nhung dung chung 1
  // option mau tren giao dien. Muon biet MAU THAT SU can dien la gi thi so tung MANH trong
  // chuoi "A/B/C" voi BANG MAU CHUAN cua dung loai ao do (doc tu "title" - phan chu lay duoc
  // tu "Style & Size", vi du "Comfort-Adult Tee") - manh nao la 1 ten mau CO TRONG bang mau
  // cua loai ao do thi dien manh do.
  //
  // Neu KHONG manh nao khop, hoac co TU 2 MANH TRO LEN cung khop (mo ho, khong biet chon
  // manh nao) -> GIU NGUYEN chuoi goc "A/B/C", khong doan bua.
  //
  // Cap nhat bang mau: copy dung chinh ta tu anh bang mau cua nha cung cap (khong phan biet
  // hoa/thuong, khoang trang du khi so khop). Them 1 gia tri vao mang tuong ung la du, khong
  // can sua ham resolveColorForGarment ben duoi. Neu Etsy hien ten mau KHAC voi ten chinh
  // thuc trong bang mau (vd "Dark Heather" thay vi "Dark Grey Heather"), sua trong bang
  // BI_DANH_MAU ben duoi.
  const BANG_MAU_COMFORT_ADULT = [
    'White', 'Ivory', 'Banana', 'Butter', 'Mustard', 'Grey', 'Granite', 'Pepper', 'Orange',
    'Yam', 'Bay', 'Moss', 'Light Green', 'Island Reef', 'Khaki', 'Chambray', 'Espresso',
    'Blue Jean', 'Lagoon Blue', 'Chalky Mint', 'Flo Blue', 'Navy', 'Black', 'Red', 'Crimson',
    'Blossom', 'Violet', 'Crunchberry', 'Orchid', 'Berry'
  ];
  const BANG_MAU_COMFORT_YOUTH = [
    'White', 'Melon', 'Terracotta', 'Salmon', 'Orchid', 'Butter', 'Pepper', 'Grey',
    'Island Reef', 'Blossom', 'Mint', 'Topaz Blue', 'Lagoon Blue', 'Chambray', 'Heliconia',
    'Washed Denim', 'Flo Blue', 'Blue Jean', 'Granite', 'Watermelon', 'Royal', 'Denim',
    'Navy', 'Violet', 'Red'
  ];
  const BANG_MAU_BELLA_ADULT = [
    'White', 'Ash', 'Athletic Heather', 'Dark Grey Heather', 'Black', 'Sunset',
    'Heather Peach', 'Heather Mauve', 'Natural', 'Soft Cream', 'Heather Ice Blue',
    'Dusty Blue', 'Mint', 'Military Green', 'Forest', 'Baby Blue', 'Heather Columbia Blue',
    'True Royal', 'Team Purple', 'Navy', 'Yellow', 'Lilac', 'Pink', 'Heather Slate',
    'Heather Navy', 'Orange', 'Berry', 'Red', 'Teal', 'Maroon'
  ];
  const BANG_MAU_BELLA_YOUTH = [
    'White', 'Ash', 'Athletic Heather', 'Dark Grey Heather', 'Black', 'Natural',
    'Heather Mauve', 'Deep Heather', 'Black Heather', 'Vintage Black', 'Gold',
    'Heather Columbia Blue', 'True Royal', 'Heather True Royal', 'Heather Navy', 'Kelly',
    'Forest', 'Heather Team Purple', 'Team Purple', 'Navy', 'Pink', 'Berry', 'Maroon', 'Red',
    'Heather Red'
  ];
  const BANG_MAU_TODDLER = [
    'Black', 'Charcoal', 'Cobalt', 'Heather', 'Kelly', 'Lavender', 'Natural', 'Navy',
    'Orange', 'Pink', 'Red', 'Royal', 'White', 'Mauvelous', 'Caribbean', 'Vintage Burgundy',
    'Vintage Camo', 'Chill', 'Granite Heather', 'Hot Pink', 'Key Lime', 'Vintage Hot Pink',
    'Vintage Royal', 'Vintage Smoke', 'Apple', 'Butter', 'Garnet', 'Light Blue', 'Silver'
  ];
  const BANG_MAU_SWEATSHIRT_HOODIE = [
    'Charcoal', 'White', 'Black', 'Ash', 'Sand', 'Sport Grey', 'Navy', 'Gold', 'Orange',
    'Maroon', 'Dark Chocolate', 'Military Green', 'Forest Green', 'Red', 'Graphite Heather',
    'Irish Green', 'Dark Heather', 'Light Blue', 'Purple', 'Light Pink'
  ];

  // Mot so noi Etsy hien ten mau HOI KHAC voi ten CHINH THUC trong bang mau cua nha cung cap
  // (vd ghi "Dark Heather" nhung ten chinh thuc cua Bella Canvas la "Dark Grey Heather").
  // Khai bao bi danh (alias) o day: key la ten XUAT HIEN TREN ETSY (khong phan biet hoa/thuong),
  // value la ten CHINH THUC dung trong bang mau tuong ung ben tren - dien ra se dung ten CHINH
  // THUC (value), khong dung nguyen van manh doc duoc tren Etsy (key).
  //
  // BANG QUY DOI MAU: nguon DUY NHAT, dung chung cho moi shop. Can doi quy doi cho tat ca shop thi
  // sua truc tiep o day, tang @version roi bam "Cap nhat" tren tung shop (khong con sua tren panel).
  // Key la ten (hoac to hop "A/B") XUAT HIEN TREN ETSY, khong phan biet hoa/thuong; value la ten
  // CHINH THUC se dien ra.
  const BI_DANH_MAU = {
    comfort_adult: { 'orange': 'Burnt Orange', 'yam/orange': 'Yam' },
    comfort_youth: {},
    bella_adult: { 'dark heather': 'Dark Grey Heather', 'blue': 'Baby Blue' },
    bella_youth: { 'dark heather': 'Dark Grey Heather', 'blossom/light pink': 'Pink' },
    toddler: {
      'violet': 'Lavender',
      'dark heather': 'Vintage Smoke',
      'blue': 'Light Blue',
      'blossom/light pink': 'Pink',
      'pepper/dark heather': 'Vintage Smoke',
      'moss/military green': 'Military Green'
    },
    sweatshirt_hoodie: { 'blue': 'Light Blue', 'pink': 'Light Pink' },
    // Ao Gildan (Adult + Youth, title chua "Gildan"): chi quy doi to hop, chua co bang mau chuan
    gildan: { 'ivory/natural': 'Natural' }
  };
  // Xac dinh loai ao tu "title" (phan chu cua "Style & Size", vd "Comfort-Adult Tee",
  // "Bella-Youth Tee", "Toddler Tee", "Sweatshirt-Adult", "Hoodie-Adult"...) de chon dung
  // bang mau + bang bi danh tuong ung. Tra ve null neu khong nhan ra loai ao nao ben duoi.
  function xacDinhBangMauTheoAo(title) {
    const t = (title || '').toLowerCase();
    if (t.includes('toddler')) return { mau: BANG_MAU_TODDLER, biDanh: BI_DANH_MAU.toddler };
    if (t.includes('sweatshirt') || t.includes('hoodie')) {
      return { mau: BANG_MAU_SWEATSHIRT_HOODIE, biDanh: BI_DANH_MAU.sweatshirt_hoodie };
    }
    if (t.includes('comfort') && t.includes('youth')) {
      return { mau: BANG_MAU_COMFORT_YOUTH, biDanh: BI_DANH_MAU.comfort_youth };
    }
    if (t.includes('comfort') && t.includes('adult')) {
      return { mau: BANG_MAU_COMFORT_ADULT, biDanh: BI_DANH_MAU.comfort_adult };
    }
    if (t.includes('bella') && t.includes('youth')) {
      return { mau: BANG_MAU_BELLA_YOUTH, biDanh: BI_DANH_MAU.bella_youth };
    }
    if (t.includes('bella') && t.includes('adult')) {
      return { mau: BANG_MAU_BELLA_ADULT, biDanh: BI_DANH_MAU.bella_adult };
    }
    if (t.includes('gildan')) return { mau: [], biDanh: BI_DANH_MAU.gildan };
    return null;
  }

  // Chuan hoa: bo khoang trang dau/cuoi, ve chu thuong, VA don khoang trang quanh dau "/"
  // (vd "Blossom / Light Pink" -> "blossom/light pink") - can thiet de bi danh CA TO HOP nhieu
  // mau (xem ben duoi) so khop duoc du Etsy co chen khoang trang quanh dau "/" hay khong.
  function chuanHoaTenMau(s) {
    return String(s || '').trim().toLowerCase().replace(/\s*\/\s*/g, '/');
  }

  // Quy doi 1 chuoi Color (co the la mau ghep "A/B/C" hoac mau don) thanh mau THAT SU can
  // dien, bang cach so tung manh voi bang mau chuan (va bang bi danh) cua dung loai ao. Xem
  // giai thich o tren.
  function resolveColorForGarment(colorRaw, title) {
    if (!colorRaw || !colorRaw.includes('/')) return colorRaw;
    const thongTinAo = xacDinhBangMauTheoAo(title);
    if (!thongTinAo) return colorRaw;
    const { mau: bangMau, biDanh } = thongTinAo;

    const biDanhChuanHoa = {};
    Object.keys(biDanh).forEach((k) => { biDanhChuanHoa[chuanHoaTenMau(k)] = biDanh[k]; });

    // Uu tien so bi danh cho CA CHUOI GOC truoc khi tach theo dau "/" - cho phep dinh nghia
    // rieng cho ca 1 to hop nhieu mau (vd "Blossom/Light Pink" -> "Pink"), khong chi tung
    // manh rieng le nhu ben duoi.
    const chuanCaChuoi = chuanHoaTenMau(colorRaw);
    if (biDanhChuanHoa[chuanCaChuoi] !== undefined) {
      return biDanhChuanHoa[chuanCaChuoi];
    }

    const boMauHopLe = new Set(bangMau.map(chuanHoaTenMau));
    const parts = colorRaw.split('/').map((s) => s.trim());
    const khop = [];
    parts.forEach((p) => {
      const chuan = chuanHoaTenMau(p);
      if (biDanhChuanHoa[chuan] !== undefined) {
        khop.push(biDanhChuanHoa[chuan]);
      } else if (boMauHopLe.has(chuan)) {
        khop.push(p);
      }
    });

    // Khong manh nao khop, hoac khop nhieu hon 1 manh (mo ho) -> giu nguyen chuoi goc.
    return khop.length === 1 ? khop[0] : colorRaw;
  }

  // ====== XAC DINH PHUONG PHAP IN (COT "PrintingMethod") ======
  // Mac dinh moi san pham la DTF. La DTG neu roi vao 1 trong 2 truong hop:
  //   - Title la "Comfort Youth" hoac "Bella Adult" (theo tu khoa, khong phan biet hoa/thuong).
  //   - Don KHONG giao o United States (dia chi "country" khac "United States").
  // Neu 1 don co NHIEU san pham ma co IT NHAT 1 san pham la DTG, thi TAT CA san pham con
  // lai trong CUNG DON DO cung phai in DTG (xu ly rieng, xem ham apDungPhuongPhapInChungChoDon
  // ben duoi, ap dung SAU KHI da xac dinh tung san pham rieng le).
  function xacDinhPhuongPhapInTheoTitle(title, country) {
    const t = (title || '').toLowerCase();
    if (country && country.trim().toLowerCase() !== 'united states') return 'DTG';
    if (t.includes('comfort') && t.includes('youth')) return 'DTG';
    if (t.includes('bella') && t.includes('adult')) return 'DTG';
    return 'DTF';
  }

  // Neu bat ky san pham nao trong 1 don la DTG, ep TAT CA san pham cua don do thanh DTG.
  function apDungPhuongPhapInChungChoDon(items) {
    const coDTG = items.some((item) => item.printingMethod === 'DTG');
    if (coDTG) {
      items.forEach((item) => { item.printingMethod = 'DTG'; });
    }
  }

  // Doc truc tiep tu metadata @version cua chinh script (GM_info luon co san, khong can
  // khai bao @grant) de hien thi tren panel (ca luc thu nho) - tranh phai sua 2 cho moi
  // lan bump version. '2.12' chi la gia tri du phong neu vi ly do nao do GM_info khong co.
  const SCRIPT_VERSION = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '3.4';

  // Link cai dat ban moi nhat tren GitHub (cung URL voi @updateURL/@downloadURL o dau file).
  // Mo link nay, Violentmonkey tu hien hop thoai Cai dat/Cap nhat kem so phien ban moi.
  const UPDATE_URL = 'https://raw.githubusercontent.com/tempohie-spec/etsy/main/etsy-order-earnings.user.js';

  // Luu vi tri + trang thai thu nho/mo rong cua panel
  const PANEL_STATE_KEY = 'etsy_scraper_panel_state_v1';
  // Trang thai Bat/Tat rieng cho tung nut Quet don (moi trinh duyet/profile = 1 account rieng),
  // de nguoi dung tu chan bot nut khong muon dung tren account do - luu lai qua GM_setValue nen
  // vAn con sau khi tai lai trang.
  const ENABLE_SCAN_EARNINGS_KEY = 'etsy_scraper_enable_scan_earnings_v1';
  const ENABLE_SCAN_ONLY_KEY = 'etsy_scraper_enable_scan_only_v1';

  // Sinh 1 so dien thoai ao ngau nhien (10 chu so), dung de dien vao cot "phone" cho cac
  // don o ngoai United States khi khong doc duoc so that tren trang - tranh o phone bi
  // trong khi in van don. Moi don se ra 1 so khac nhau (khong dung chung 1 so co dinh).
  function taoSoDienThoaiAo() {
    let soDienThoai = '';
    for (let i = 0; i < 10; i++) {
      soDienThoai += Math.floor(Math.random() * 10);
    }
    return soDienThoai;
  }

  // ====== SELECTOR PHUC VU LAY EARNINGS (chinh neu Etsy doi giao dien) ======
  const SEL = {
    // o input tim kiem don hang (dua vao aria-label "Search your orders") - chi dung cho
    // chuc nang "Lay Earnings theo danh sach ma don nhap tay"
    searchInput: 'input[aria-label="Search your orders"]',
    // dong chu "You earned $xx.xx on this order" -> lay so trong <span>
    earningsAmountSelector: 'span.wt-text-title-large',
    // tab "Earnings" trong bang order details - tim theo text vi class hay doi
    earningsTabText: 'Earnings',
  };

  const WAIT_TIMEOUT = 15000; // 15s cho moi buoc

  // ====== TIEN ICH CHUNG ======
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Khi nguoi dung chuyen sang tab khac, trinh duyet LAM CHAM timer (>=1s/lan, co khi dong bang
  // han) va ngung ve/animation cua trang. Neu van tinh thoi gian cho nhu binh thuong thi
  // waitFor se bao Timeout oan (hoac doc nham so tien dang dung hinh) - nen: (1) khi tab an
  // thi KHONG kiem tra va KHONG tinh vao thoi gian cho, (2) neu giua 2 lan chay timer co khoang
  // trong bat thuong (>2.5s, do bi dong bang/may ngu) thi cung bu lai vao thoi gian cho.
  function waitFor(checkFn, timeout = WAIT_TIMEOUT, label = '') {
    return new Promise((resolve, reject) => {
      let start = Date.now();
      let lastTick = start;
      const interval = setInterval(() => {
        const now = Date.now();
        const gap = now - lastTick;
        lastTick = now;
        if (document.hidden || gap > 2500) start += gap;
        if (document.hidden) return;
        const result = checkFn();
        if (result) {
          clearInterval(interval);
          resolve(result);
        } else if (now - start > timeout) {
          clearInterval(interval);
          reject(new Error(label ? `Timeout cho phan tu: ${label}` : 'Timeout cho phan tu'));
        }
      }, 100);
    });
  }

  // Dung hang cho toi khi tab Etsy hien thi lai (neu dang bi an) - goi o dau moi don trong
  // vong lap lay Earnings de tam dung gon gang thay vi chay tiep luc trinh duyet dang bop
  // nghet tab an (de bi loi/Timeout), tu dong chay tiep ngay khi nguoi dung quay lai tab.
  function choTabHienThi() {
    if (!document.hidden) return Promise.resolve();
    hienThongBao('⏸ Tab Etsy đang bị ẩn — quay lại tab này để tiếp tục lấy Earnings...', '#F59E0B');
    return new Promise((resolve) => {
      const onVis = () => {
        if (document.hidden) return;
        document.removeEventListener('visibilitychange', onVis);
        resolve();
      };
      document.addEventListener('visibilitychange', onVis);
    });
  }

  // Lay thoi diem hien tai theo DUNG GIO VIET NAM (UTC+7, khong doi theo DST) BAT KE may
  // dang chay script dat mui gio he thong la gi (vd nhieu nguoi dung VPS/RDP dat o My de
  // chay Etsy, mui gio he thong khac hoan toan gio VN that). Date.now() la epoch UTC, khong
  // phu thuoc mui gio may, nen cong them 7 tieng roi doc bang cac ham getUTC* la ra dung
  // "gio tren dong ho" o Viet Nam, khong bi anh huong boi timezone cua may.
  function getVietnamNow() {
    return new Date(Date.now() + 7 * 60 * 60 * 1000);
  }

  // Ngay hien tai (theo gio Viet Nam co dinh), dinh dang dd/mm/yyyy
  function getTodayDateStr() {
    const d = getVietnamNow();
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = d.getUTCFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  // Ngay hien tai dang yyyy-mm-dd (dung cho ten file), cung theo gio Viet Nam co dinh.
  function getTodayFileDateStr() {
    const d = getVietnamNow();
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  // Etsy co 2 dang duong dan anh:
  //   Dang "c" (thumbnail cache, co kich thuoc nhung trong duong dan):
  //     .../58864821/c/1360/1360/300/223/il/409428/7541359670/il_794xN...jpg
  //   Dang "r" (anh goc, khong bi cat):
  //     .../58786000/r/il/31255a/7649361332/il_794xN...jpg
  // Neu gap dang "c", doi "c" -> "r" va xoa doan kich thuoc nam giua
  // "c" va "il" (vd "1360/1360/300/223/") de ra dung dang "r/il/...".
  function fixCFormatUrl(src) {
    if (!src) return src;
    return src.replace(/\/c\/[\d/]+\/il\//, '/r/il/');
  }

  function toBigImage(src) {
    if (!src) return '';
    // Sua dang "c" -> "r" truoc (neu co)
    let fixed = fixCFormatUrl(src);
    // vd: .../il_75x75.7875320399_d5sm.jpg  ->  .../il_794xN.7875320399_d5sm.jpg
    return fixed.replace(/il_\d+x\d+/, 'il_794xN');
  }

  function getOrderNumber(link) {
    try {
      const url = new URL(link.href, location.origin);
      const oid = url.searchParams.get('order_id');
      if (oid) return oid.trim();
    } catch (e) { /* noop */ }
    return link.textContent.trim().replace(/^#/, '');
  }

  // Tim khung chua toan bo 1 don hang (bao gom ca link order + dia chi + san pham)
  function findOrderContainer(linkEl) {
    // Moi don hang tren trang duoc Etsy bao trong dung 1 khoi ".panel-body-row" rieng (xac
    // nhan qua DOM thuc te cua trang /your/orders). Dung khoi nay lam container CHINH vi no
    // luon khop dung 1 don, khong bao gio lan sang don khac.
    //
    // TRUOC DAY dung cach leo len toi 20 cap cha, tim khoi dau tien co ca "span.name" LAN
    // "img[alt]" ben trong - cach nay co the vo tinh leo qua luon khoi bao ngoai chua NHIEU
    // don cung luc (vi du gap 1 link ma don "mo coi" khong nam trong panel-body-row nao ca,
    // con sot lai trong DOM), khien du lieu cua nhieu don khac nhau bi gop chung vao 1 dong
    // va lap lai voi sai ma don. Neu khong tim thay ".panel-body-row" bao quanh link, BO QUA
    // link do luon (tra ve null) thay vi doan mo ho, de tranh gop nham du lieu.
    return linkEl.closest('.panel-body-row');
  }

  // ====== TU DONG CHUYEN CHU KHONG PHAI LATIN SANG LATIN (name/address1/address2/city/state) ======
  // Khong dung thu vien ngoai (CDN) cho phan nay - lich su du an tung gap loi "XLSX is not
  // defined" khi CDN ngoai bi chan/loi mang, nen tu viet 1 bo chuyen doi gon nhe ngay trong
  // script, khong phu thuoc mang. Do la PHIEN AM GAN DUNG (unidecode-style), KHONG phai chuan
  // phien am chinh thuc cua tung ngon ngu (vd khong phai chuan Pinyin co dau thanh).
  //
  // Buoc 1: NFD + bo dau to hop -> xu ly duoc HAU HET chu Latin co dau (Viet, Phap, Tay Ban
  // Nha, Duc, Ba Lan, Sec...): é -> e, ñ -> n, ệ -> e... Day la thao tac AN TOAN, KHONG can
  // danh dau de kiem tra lai (van la chu Latin, chi mat dau).
  // Buoc 2: bang rieng cho vai chu Latin DAC BIET khong tach duoc bang NFD (khong o dang to hop).
  // Buoc 3+: bang chuyen doi cho CAC BO CHU KHONG PHAI LATIN (Cyrillic, Hy Lap, Han Quoc,
  // A Rap, Do Thai...). Nhung dong nay MOI CAN danh dau de nguoi dung kiem tra lai, vi day la
  // chuyen doi CO MAT MAT thong tin that su (khac chu viet).
  const BANG_LATIN_DAC_BIET = {
    'đ': 'd', 'Đ': 'D', 'ı': 'i', 'İ': 'I', 'ğ': 'g', 'Ğ': 'G', 'ş': 's', 'Ş': 'S',
    'ß': 'ss', 'œ': 'oe', 'Œ': 'OE', 'æ': 'ae', 'Æ': 'AE', 'ø': 'o', 'Ø': 'O',
    'ł': 'l', 'Ł': 'L', 'ð': 'd', 'Ð': 'D', 'þ': 'th', 'Þ': 'Th'
  };

  const BANG_CYRILLIC = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e', 'ж': 'zh',
    'з': 'z', 'и': 'i', 'й': 'i', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
    'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts',
    'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'iu',
    'я': 'ia', 'і': 'i', 'ї': 'i', 'є': 'ie', 'ґ': 'g'
  };

  const BANG_GREEK = {
    'α': 'a', 'β': 'v', 'γ': 'g', 'δ': 'd', 'ε': 'e', 'ζ': 'z', 'η': 'i', 'θ': 'th',
    'ι': 'i', 'κ': 'k', 'λ': 'l', 'μ': 'm', 'ν': 'n', 'ξ': 'x', 'ο': 'o', 'π': 'p',
    'ρ': 'r', 'σ': 's', 'ς': 's', 'τ': 't', 'υ': 'y', 'φ': 'f', 'χ': 'ch', 'ψ': 'ps',
    'ω': 'o'
  };

  // Bang chu cai + nguyen am A Rap (rat gan dung, khong the hien day du dau nguyen am ngan).
  const BANG_ARABIC = {
    'ا': 'a', 'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'j', 'ح': 'h', 'خ': 'kh', 'د': 'd',
    'ذ': 'dh', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'sh', 'ص': 's', 'ض': 'd', 'ط': 't',
    'ظ': 'z', 'ع': 'a', 'غ': 'gh', 'ف': 'f', 'ق': 'q', 'ك': 'k', 'ل': 'l', 'م': 'm',
    'ن': 'n', 'ه': 'h', 'و': 'w', 'ي': 'y', 'ء': '', 'ة': 'h', 'ى': 'a'
  };

  const BANG_HEBREW = {
    'א': 'a', 'ב': 'v', 'ג': 'g', 'ד': 'd', 'ה': 'h', 'ו': 'v', 'ז': 'z', 'ח': 'ch',
    'ט': 't', 'י': 'y', 'כ': 'k', 'ך': 'k', 'ל': 'l', 'מ': 'm', 'ם': 'm', 'נ': 'n',
    'ן': 'n', 'ס': 's', 'ע': 'a', 'פ': 'p', 'ף': 'f', 'צ': 'tz', 'ץ': 'tz', 'ק': 'k',
    'ר': 'r', 'ש': 'sh', 'ת': 't'
  };

  // Chu cai dau/giua/cuoi cua tieng Han Quoc (Hangul) - dung dung cong thuc giai ma Unicode
  // chinh thuc (khong can bang du lieu lon: 1 ky tu Hangul = (dau*21 + giua)*28 + cuoi + AC00).
  const HANGUL_DAU = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
  const HANGUL_GIUA = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'yi', 'i'];
  const HANGUL_CUOI = ['', 'g', 'kk', 'gs', 'n', 'nj', 'nh', 'd', 'l', 'lg', 'lm', 'lb', 'ls', 'lt', 'lp', 'lh', 'm', 'b', 'bs', 's', 'ss', 'ng', 'j', 'ch', 'k', 't', 'p', 'h'];

  function chuyenBangKyTu(str, bang) {
    let out = '';
    for (const ch of str) {
      const thay = bang[ch] !== undefined ? bang[ch] : bang[ch.toLowerCase()];
      if (thay === undefined) { out += ch; continue; }
      // Giu hoa/thuong theo ky tu goc khi bang chi co dang chu thuong.
      out += (ch === ch.toUpperCase() && ch !== ch.toLowerCase() && bang[ch] === undefined)
        ? thay.charAt(0).toUpperCase() + thay.slice(1)
        : thay;
    }
    return out;
  }

  function chuyenHangul(str) {
    let out = '';
    for (const ch of str) {
      const code = ch.codePointAt(0);
      if (code >= 0xac00 && code <= 0xd7a3) {
        const off = code - 0xac00;
        const cuoi = off % 28;
        const giua = ((off - cuoi) / 28) % 21;
        const dau = (((off - cuoi) / 28) - giua) / 21;
        out += HANGUL_DAU[dau] + HANGUL_GIUA[giua] + HANGUL_CUOI[cuoi];
      } else {
        out += ch;
      }
    }
    return out;
  }

  // Nhung khoi Unicode KHONG phai chu Latin - co ky tu nao roi vao day thi coi la "can kiem
  // tra lai" (Hy Lap, Cyrillic, Armenia, Georgia, Do Thai, A Rap, Devanagari, Thai, Hangul
  // (roi + ghep van), Katakana/Hiragana, chu Han...).
  const VUNG_KHONG_LATIN = /[\u0370-\u03FF\u0400-\u052F\u0530-\u058F\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0900-\u097F\u0E00-\u0E7F\u10A0-\u10FF\u1100-\u11FF\u3040-\u30FF\u3130-\u318F\uAC00-\uD7A3\u3400-\u9FFF\uF900-\uFAFF]/;

  // Chuyen 1 chuoi ve Latin: bo dau chu Latin (an toan, khong danh dau) + doi cac bo chu khac
  // (Cyrillic/Hy Lap/Han Quoc/A Rap/Do Thai...) sang Latin gan dung (CAN danh dau kiem tra lai).
  // Tra ve { ketQua, canKiemTra } - canKiemTra = true neu chuoi GOC co chua ky tu khong phai Latin.
  function chuyenSangLatin(str) {
    if (!str) return { ketQua: str, canKiemTra: false };
    const canKiemTra = VUNG_KHONG_LATIN.test(str);

    // Chuyen Hangul TRUOC buoc NFD ben duoi: 1 ky tu Hangul da ghep san se bi NFD TACH
    // thanh cac chu cai roi (Jamo) - neu lam sau, chuyenHangul() se khong con nhan ra
    // duoc dang ky tu Hangul da ghep nua (bo qua nham, khong chuyen duoc).
    let s = chuyenHangul(str);
    s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    s = s.replace(/[đĐıİğĞşŞßœŒæÆøØłŁðÐþÞ]/g, (c) => BANG_LATIN_DAC_BIET[c] || c);
    s = chuyenBangKyTu(s, BANG_CYRILLIC);
    s = chuyenBangKyTu(s, BANG_GREEK);
    s = chuyenBangKyTu(s, BANG_ARABIC);
    s = chuyenBangKyTu(s, BANG_HEBREW);

    return { ketQua: s, canKiemTra };
  }

  // Danh sach cac truong (theo don) da bi chuyen sang Latin va CAN NGUOI DUNG KIEM TRA LAI -
  // duoc reset moi lan quet, dung de bao cao tong ket sau khi quet xong (xem scanAndExport).
  let danhSachCanKiemTraLatin = [];

  // Ap dung chuyenSangLatin cho 1 truong dia chi, ghi lai vao danhSachCanKiemTraLatin neu
  // can kiem tra, roi tra ve gia tri Latin de dien vao o tuong ung.
  function chuanHoaTruongDiaChi(orderNumber, tenTruong, giaTri) {
    if (!giaTri) return giaTri;
    const { ketQua, canKiemTra } = chuyenSangLatin(giaTri);
    if (canKiemTra) {
      danhSachCanKiemTraLatin.push({ orderNumber, tenTruong, giaTriGoc: giaTri, giaTriMoi: ketQua });
    }
    return ketQua;
  }

  function extractAddress(container) {
    const q = (sel) => {
      const el = container.querySelector(sel);
      return el ? el.textContent.trim() : '';
    };

    const emailLink = container.querySelector('a[href^="mailto:"]');
    const email = emailLink
      ? emailLink.getAttribute('href').replace(/^mailto:/i, '').split('?')[0].trim()
      : '';

    const country = q('span.country-name');
    // CHUA CHAC CHAN: chua co vi du HTML co so dien thoai.
    // Tam thoi thu vai class pho bien, ban kiem tra lai giup minh.
    let phone = q('span.phone') || q('.phone-number') || q('[class*="phone"]');
    // Xoa dau "+" (dau ma quoc gia) trong so dien thoai, vd "+1 234-567-8900" -> "1 234-567-8900"
    phone = phone.replace(/\+/g, '');

    // Don o ngoai United States ma chua doc duoc so dien thoai that -> tu dien so ao,
    // vi mot so noi (vd dich vu in van don) yeu cau o phone khong duoc de trong.
    if (!phone && country && country.trim().toLowerCase() !== 'united states') {
      phone = taoSoDienThoaiAo();
    }

    const city = q('span.city');
    // Neu khong co state (mot so nuoc ngoai United States khong co khai niem "state"),
    // dien tam city vao cot state de o do khong bi bo trong.
    const state = q('span.state') || city;

    return {
      name: q('span.name'),
      address1: q('span.first-line'),
      address2: q('span.second-line'),
      city,
      state,
      postalCode: q('span.zip'),
      country,
      phone,
      email
    };
  }

  // Lay danh sach gia tri theo nhan (label) dang: <span>Quantity</span><span class="strong">1</span>
  function getLabelValues(container, labelText) {
    const spans = Array.from(container.querySelectorAll('span'));
    const values = [];
    spans.forEach((span) => {
      if (span.textContent.trim() === labelText) {
        const strong = span.parentElement
          ? span.parentElement.querySelector('span.strong')
          : null;
        if (strong) values.push(strong.textContent.trim());
      }
    });
    return values;
  }

  // Etsy co the hien thi nhan la "Style & Size" HOAC chi "Size" (khi listing
  // khong co tuy chon Style). Thu ca hai, uu tien "Style & Size" neu co.
  function getStyleSizeValues(container) {
    const styleAndSize = getLabelValues(container, 'Style & Size');
    if (styleAndSize.length) return styleAndSize;
    return getLabelValues(container, 'Size');
  }

  // Cac nhan CO DINH cua 1 san pham (da duoc doc rieng vao cot Quantity/size/color). Moi dong
  // "nhan + gia tri" KHAC cua san pham (vd "Personalization", "Outline Section", "Primary
  // Color"... - ten do tung listing tu dat) deu la tuy chon ca nhan hoa cua khach.
  const NHAN_SAN_PHAM_CO_DINH = new Set(['quantity', 'style & size', 'size', 'color']);

  // Lay GIA TRI cua moi dong tuy chon ca nhan hoa trong 1 khoi san pham, bat ke ten nhan la gi.
  // Truoc day chi doc dung nhan "Personalization" nen cac don dung ten khac (vd "Outline Section:
  // Minnie (with bow)") bi bo trong cot Personalization.
  function getPersonalizationValues(flagEl) {
    const out = [];
    flagEl.querySelectorAll('span.strong').forEach((strong) => {
      const cha = strong.parentElement;
      if (!cha) return;
      const nhanEl = Array.from(cha.children).find(
        (el) => el !== strong && el.tagName === 'SPAN' && !el.classList.contains('strong')
      );
      const nhan = nhanEl ? nhanEl.textContent.trim() : '';
      if (!nhan || NHAN_SAN_PHAM_CO_DINH.has(nhan.toLowerCase())) return;
      const giaTri = strong.textContent.trim();
      if (giaTri) out.push(giaTri);
    });
    // Du phong: cach cu doc dung nhan "Personalization" (phong khi DOM nhan/gia tri long khac).
    getLabelValues(flagEl, 'Personalization').forEach((v) => {
      if (!out.includes(v)) out.push(v);
    });
    return out;
  }

  // Ghep 1 chuoi "Style & Size" thanh { title, size }, vd "Comfort-Adult Tee L" -> title "Comfort-Adult Tee", size "L"
  function splitStyleSize(styleSize) {
    const parts = (styleSize || '').trim().split(/\s+/).filter(Boolean);
    const size = parts.length ? parts[parts.length - 1] : '';
    const title = parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
    return { title, size };
  }

  function extractLineItems(container) {
    // Moi san pham trong don nam trong 1 khoi ".flag" RIENG cua no (anh + Quantity +
    // Style & Size + Color + Personalization cua rieng san pham do). Phai lay anh/nhan
    // THEO TUNG KHOI ".flag" nay, KHONG duoc gom het anh ca don lai roi loai trung theo
    // URL - vi 2 san pham KHAC NHAU (vd 1 mau thuong + 1 mau "Vintage" cua cung listing)
    // co the dung CHUNG 1 URL anh mockup; loai trung se lam mat bot 1 anh va lam lech
    // vi tri img[i] so voi san pham thu i (vd don co 4 san pham nhung chi con 2 URL anh
    // sau khi loai trung -> san pham thu 4 se bi fallback nham ve img[0] thay vi dung anh).
    // Loc bot cac phan tu ".flag" khong phai san pham (vd flag avatar/note cua nguoi mua,
    // icon co quoc gia... dung chung class "flag" o cho khac trong don hang) - chi giu lai
    // khoi co ANH ("flag-img") VA co nhan "Quantity" rieng cua no. "Quantity" la dau hieu
    // dang tin cay nhat de xac dinh day THAT SU la 1 san pham (khong phai chi can co anh +
    // 1 "strong" bat ky, vi cac khoi khac cung co the co "strong" ma khong phai san pham,
    // gay ra 1 dong "ma" thua o dau moi don voi title/color/size/quantity deu trong).
    //
    // QUAN TRONG: khoi ".flag" NGOAI CUNG cua ca dong don hang (bao quanh o checkbox chon
    // don) cung co "flag-img" (chinh la o checkbox) VA cung "chua" it nhat 1 nhan Quantity o
    // dau do rat sau ben trong no (vi no bao luon ca cac san pham that su) - neu khong loc
    // tiep, khoi bao ngoai nay bi tinh nham la 1 "san pham" nua, lay du lieu cua SAN PHAM DAU
    // TIEN tim thay ben trong -> lam sai lech: san pham dau tien cua moi don bi nhan doi.
    // San pham THAT SU luon la khoi ".flag" o SAU NHAT (khong con chua ".flag" nao khac ben
    // trong no), nen loai bo het cac khoi ".flag" nao co long 1 khoi ".flag" con khac.
    const flagEls = Array.from(container.querySelectorAll('.flag')).filter(
      (el) => el.querySelector('.flag-img') && getLabelValues(el, 'Quantity').length > 0 && !el.querySelector('.flag')
    );

    if (flagEls.length > 0) {
      return flagEls.map((flagEl) => {
        const img = flagEl.querySelector('.flag-img img[alt], img[alt][src*="etsystatic"]');
        const quantity = getLabelValues(flagEl, 'Quantity')[0] || '';
        const styleSize = getStyleSizeValues(flagEl)[0] || '';
        const { title, size } = splitStyleSize(styleSize);
        const color = resolveColorForGarment(getLabelValues(flagEl, 'Color')[0] || '', title);
        // Nhieu tuy chon ca nhan hoa trong cung 1 san pham thi noi bang " | ".
        const personalization = getPersonalizationValues(flagEl).join(' | ');
        // Personalization xuat ra cot rieng ("Personalization"), khong ghep vao title.

        return {
          mockUpFront: img ? toBigImage(img.getAttribute('src')) : '',
          title,
          size,
          quantity,
          color,
          personalization
        };
      });
    }

    // Du phong: khong tim thay khoi ".flag" nao (gap DOM khac ban thuong thay), quay ve
    // cach cu la doc cac nhan Quantity/Style & Size/Color/Personalization o cap ca don
    // hang. Cach nay co the bi lech anh khi nhieu san pham dung chung 1 URL anh (xem
    // giai thich o tren) nhung van dung neu tung don chi co dung 1 san pham.
    const imgs = Array.from(
      container.querySelectorAll('.flag-img img[alt], img[alt][src*="etsystatic"]')
    );
    const uniqueImgs = [];
    const seenSrc = new Set();
    imgs.forEach((img) => {
      const src = img.getAttribute('src');
      if (src && !seenSrc.has(src)) {
        seenSrc.add(src);
        uniqueImgs.push(img);
      }
    });

    const quantities = getLabelValues(container, 'Quantity');
    const styleSizes = getStyleSizeValues(container);
    const colors = getLabelValues(container, 'Color');
    const personalizations = getLabelValues(container, 'Personalization');

    // So san pham that su = so the "Quantity" (moi san pham co 1 the Quantity
    // rieng), day la nguon dang tin cay nhat, khong phu thuoc vao anh.
    const count = Math.max(quantities.length, styleSizes.length, 1);
    const items = [];

    for (let i = 0; i < count; i++) {
      const img = uniqueImgs[i] || uniqueImgs[0];
      const { title, size } = splitStyleSize(styleSizes[i] || styleSizes[0] || '');
      const personalization = personalizations[i] || '';

      items.push({
        mockUpFront: img ? toBigImage(img.getAttribute('src')) : '',
        title,
        size,
        quantity: quantities[i] || quantities[0] || '',
        color: resolveColorForGarment(colors[i] || colors[0] || '', title),
        personalization
      });
    }
    return items;
  }

  function extractOrdersFromPage() {
    // Reset danh sach can kiem tra lai (chu khong phai Latin) truoc moi lan quet moi.
    danhSachCanKiemTraLatin = [];

    const orderLinks = Array.from(
      document.querySelectorAll('a[href*="/your/orders/sold"]')
    ).filter((a) => {
      const txt = a.textContent.trim();
      return /^#?\d+$/.test(txt) || /order_id=/.test(a.href);
    });

    const seenContainers = new Set();
    const results = [];
    const today = getTodayDateStr();

    orderLinks.forEach((link) => {
      const container = findOrderContainer(link);
      if (!container || seenContainers.has(container)) return;
      seenContainers.add(container);

      const orderNumber = getOrderNumber(link);
      const addr = extractAddress(container);
      // Chuyen sang Latin cac truong dia chi co the co chu khong phai Latin (ten nguoi mua o
      // Nga, Hy Lap, Han Quoc, A Rap...) - xem chuyenSangLatin() o tren. Truong nao thuc su
      // can kiem tra lai duoc ghi vao danhSachCanKiemTraLatin de bao cao sau khi quet xong.
      addr.name = chuanHoaTruongDiaChi(orderNumber, 'name', addr.name);
      addr.address1 = chuanHoaTruongDiaChi(orderNumber, 'address1', addr.address1);
      addr.address2 = chuanHoaTruongDiaChi(orderNumber, 'address2', addr.address2);
      addr.city = chuanHoaTruongDiaChi(orderNumber, 'city', addr.city);
      addr.state = chuanHoaTruongDiaChi(orderNumber, 'state', addr.state);
      const items = extractLineItems(container);

      // Xac dinh phuong phap in TUNG san pham truoc, roi ep CA DON ve DTG neu co it nhat
      // 1 san pham la DTG (xem giai thich o ham apDungPhuongPhapInChungChoDon).
      items.forEach((item) => {
        item.printingMethod = xacDinhPhuongPhapInTheoTitle(item.title, addr.country);
      });
      apDungPhuongPhapInChungChoDon(items);

      items.forEach((item) => {
        results.push({
          PrintingMethod: item.printingMethod,
          Account: '',
          orderNumber,
          mockUpFront: item.mockUpFront,
          Image: '',
          designFront: '',
          designBack: '',
          title: item.title,
          color: item.color,
          size: item.size,
          quantity: item.quantity,
          Personalization: item.personalization,
          ' ': '', // cot trong ben phai "Personalization"
          name: addr.name,
          address1: addr.address1,
          address2: addr.address2,
          city: addr.city,
          state: addr.state,
          postalCode: addr.postalCode,
          country: addr.country,
          phone: addr.phone,
          email: addr.email,
          'Date Fulfil': today,
          Earnings: ''
        });
      });
    });

    return results;
  }

  // Thay dau "-" bang khoang trang trong title, vd "Comfort-Youth" -> "Comfort Youth"
  // Va bo chu "Tee" (dung rieng le HOAC dinh lien vao cuoi 1 tu, vd "AdultTee"),
  // vi du: "Comfort-Adult Tee" -> "Comfort Adult", "Comfort-AdultTee" -> "Comfort Adult"
  function cleanTitleForExport(title) {
    if (!title) return title;
    let out = title.replace(/-/g, ' ');
    // Bo "Tee" khi dinh lien ngay sau 1 chu cai khac (khong co khoang trang truoc no),
    // vd "AdultTee" -> "Adult". Giu lai chu cai ngay truoc "Tee".
    out = out.replace(/([a-zA-Z])Tee(?=[^a-zA-Z]|$)/gi, '$1');
    // Bo tu "Tee" dung rieng le (khong dinh lien voi chu khac, khong phan biet hoa/thuong)
    out = out.replace(/\bTee\b/gi, '');
    // Don lai khoang trang thua do bo chu "Tee" de lai
    out = out.replace(/\s+/g, ' ').trim();
    return out;
  }

  // Cac size dang khoang (vd size tre em "5-6T", "7-8T") dung dau "-" tren Etsy, nhung
  // muon xuat ra Excel dang "5/6T", "7/8T" (doi dau "-" thanh "/"). Chi ap dung cho dung
  // dinh dang so-so+chu (khong dung cham vao cac size khac nhu "S", "M", "XL"...).
  function cleanSizeForExport(size) {
    if (!size) return size;
    return size.replace(/^(\d+)-(\d+)([A-Za-z]*)$/, '$1/$2$3');
  }

  // Ao Gildan Youth: them "Y" vao truoc size chu (M -> YM, XL -> YXL). Khong them lai neu da co Y.
  function themYChoGildanYouth(title, size) {
    if (!size || !/gildan/i.test(title || '') || !/youth/i.test(title || '')) return size;
    return /^(XXS|XS|S|M|L|XL|XXL|[2-5]XL)$/i.test(size.trim()) ? 'Y' + size.trim().toUpperCase() : size;
  }

  // Thay dau nhay don cong (’) bang dau nhay don thang (') trong tat ca cac cot dang chu.
  function fixCurlyApostrophe(value) {
    if (typeof value !== 'string') return value;
    return value.replace(/’/g, "'");
  }

  function exportToExcelFile(data) {
    // Fix lai link anh dang "c" -> "r" ngay tai buoc xuat file, va don lai title.
    const cleanData = data.map((row) => {
      const out = {};
      HEADERS.forEach((h) => { out[h] = fixCurlyApostrophe(row[h] !== undefined ? row[h] : ''); });
      out.size = themYChoGildanYouth(out.title, out.size);
      out.title = cleanTitleForExport(out.title);
      out.size = cleanSizeForExport(out.size);
      out.mockUpFront = fixCFormatUrl(out.mockUpFront);
      return out;
    });
    // skipHeader: true -> khong ghi dong header vao file Excel
    const ws = XLSX.utils.json_to_sheet(cleanData, { header: HEADERS, skipHeader: true });
    // Ep dinh dang cot "postalCode" thanh Text ('@') - zipcode cua US doi khi co so 0 o dau
    // (vd "01234"). Ban than gia tri da la chuoi ("s") nen Excel se hien dung "01234" ngay tu
    // dau, nhung neu KHONG dat dinh dang Text san, sau nay nguoi dung SUA lai o do (go tay) se
    // bi Excel tu doi ve dang so va mat so 0 dau ngay lap tuc. Dat san dinh dang Text de tranh
    // rui ro nay ve sau, khong chi luc moi xuat file.
    const postalCodeCol = HEADERS.indexOf('postalCode');
    if (postalCodeCol !== -1 && ws['!ref']) {
      const range = XLSX.utils.decode_range(ws['!ref']);
      for (let r = range.s.r; r <= range.e.r; r++) {
        const addr = XLSX.utils.encode_cell({ r, c: postalCodeCol });
        if (ws[addr]) ws[addr].z = '@';
      }
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Orders');
    const filename = `etsy_orders_${getTodayFileDateStr()}.xlsx`;
    XLSX.writeFile(wb, filename);

    // Dong thoi copy toan bo du lieu vao clipboard dang TSV (cach nhau bang Tab, xuong dong
    // giua cac hang) - dan (Ctrl+V) thang duoc vao Excel/Google Sheets thanh tung o rieng,
    // khong can mo file .xlsx vua tai ra.
    copyDataToClipboard(cleanData);
  }

  // GHI CHU VE ZIPCODE MAT SO 0 DAU KHI DAN (Ctrl+V) VAO GOOGLE SHEETS:
  // Da THU them dau nhay don "'" truoc zipcode de ep hieu la van ban (meo pho bien voi Excel),
  // nhung Google Sheets KHONG an dau nhay nay khi dan van ban thuan tu ngoai vao (chi an duoc
  // khi tu tay go truc tiep vao o) - dau nhay lai HIEN RA truoc so, gay roi hon. Da BO meo nay.
  //
  // Day la gioi han cua Google Sheets (khong doc duoc kieu o tu clipboard van ban thuan/HTML
  // ben ngoai, luon tu doan kieu theo hinh thuc gia tri), khong the sua tu phia script. Cach
  // xu ly dung: dat SAN cot postalCode trong Google Sheet ve dinh dang "Van ban thuan" (chon
  // cot -> Format > Number > Plain text) MOT LAN - sau do moi lan dan (kieu gi cung duoc,
  // khong rieng tu script nay) Sheets se giu nguyen chuoi, khong tu doi thanh so nua.
  //
  // Rieng file .xlsx tai ve VAN duoc giu dung nguyen so 0 dau (xem exportToExcelFile), vi gia
  // tri da luu dung la chuoi "s" va cot postalCode da duoc dat san dinh dang Text trong file.

  // Chuyen du lieu thanh chuoi TSV (tab-separated) roi ghi vao clipboard qua GM_setClipboard.
  // Thay tab/xuong dong CO SAN trong tung o bang khoang trang, tranh lam le cot khi dan.
  // headers mac dinh la HEADERS (bang xuat don hang chinh); truyen headers khac de dung cho
  // cac bang xuat khac (vd ket qua "Lay Earnings theo ma don" chi co 2 cot).
  function copyDataToClipboard(cleanData, headers = HEADERS) {
    if (typeof GM_setClipboard === 'undefined') return;
    const tsv = cleanData
      .map((row) => headers.map((h) => String(row[h] !== undefined ? row[h] : '').replace(/[\t\r\n]+/g, ' ')).join('\t'))
      .join('\n');
    GM_setClipboard(tsv, 'text');
  }

  // ====== TIEN ICH DUNG CHUNG CHO CA 2 CACH LAY EARNINGS ======

  function setNativeValue(el, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Lay chuoi so tien "$xx.xx" va tra ve chi phan so (khong don vi tien te)
  function parseAmountToNumberString(amountText) {
    if (!amountText) return '';
    return amountText.replace(/[^0-9.\-]/g, '');
  }

  // Kiem tra span co dang HIEN THI tren man hinh khong (khong bi an boi CSS
  // wt-display-none/display:none). Etsy dong overlay bang cach AN di (khong xoa khoi DOM),
  // nen span "You earned $x.xx" cua don TRUOC van con trong DOM sau khi dong - neu khong loc
  // theo tinh hien thi, querySelectorAll co the tra ve dung span CU nay truoc khi span MOI
  // (cua don dang mo) kip render, khien Earnings bi dinh nham gia tri cua don truoc do.
  function isVisible(el) {
    return !!(el.offsetParent || el.getClientRects().length);
  }

  function findCandidateEarningsSpan(previousAmountText, start) {
    const spans = document.querySelectorAll(SEL.earningsAmountSelector);
    for (const s of spans) {
      const text = s.textContent.trim();
      if (!/^\$[\d,.]+$/.test(text)) continue;
      if (!isVisible(s)) continue;
      if (previousAmountText && text === previousAmountText && Date.now() - start < 2000) continue;
      return text;
    }
    return null;
  }

  // previousAmountText: chuoi "$xx.xx" da doc duoc o lan truoc (neu co). Neu span dang thay
  // van con giu nguyen gia tri cu nay trong ~2s dau, tiep tuc cho thay vi chap nhan ngay -
  // tranh doc nham gia tri Earnings cua don TRUOC con sot lai trong DOM (xem isVisible o tren).
  //
  // Sau khi tim thay 1 gia tri ung vien, KHONG chap nhan ngay: Etsy hien thi so tien bang hieu
  // ung dem chay tang dan (count-up), nen doc qua som co the bat trung 1 buoc trung gian LECH
  // 1-2 CENT so voi so tien that su. Vi vay bat buoc gia tri phai GIU NGUYEN ON DINH lien tuc
  // trong STABLE_WINDOW_MS roi moi chap nhan la gia tri cuoi cung (tinh theo THOI GIAN THUC,
  // khong theo so lan poll, de doi poll nhanh hon van dam bao du "on dinh").
  // 300ms van khong du: hieu ung dem chay co ease-out (cham dan ve cuoi), nen mot vai buoc GAN
  // CUOI (chua phai gia tri that) van co the dung yen du 300ms roi moi nhay tiep, khien script
  // chap nhan nham 1 so NHO HON so that su. Tang len 1000ms (1 giay) de chac chan hieu ung da
  // chay xong hoan toan truoc khi chap nhan.
  const STABLE_WINDOW_MS = 1000;
  async function waitForEarningsAmount(previousAmountText) {
    const start = Date.now();
    let stableText = null;
    let stableSince = 0;
    let lanKiemTraCuoi = start;
    const raw = await waitFor(() => {
      // Giua 2 lan kiem tra ma bi bo lo > 1.5s (tab tung bi an/dong bang) thi hieu ung dem
      // chay co the da dung hinh o 1 so trung gian -> bat dau dem lai "on dinh" tu dau.
      const bayGio = Date.now();
      if (bayGio - lanKiemTraCuoi > 1500) stableText = null;
      lanKiemTraCuoi = bayGio;
      const text = findCandidateEarningsSpan(previousAmountText, start);
      if (!text) {
        stableText = null;
        return null;
      }
      if (stableText !== text) {
        stableText = text;
        stableSince = Date.now();
        return null;
      }
      return Date.now() - stableSince >= STABLE_WINDOW_MS ? text : null;
    }, WAIT_TIMEOUT, 'so tien Earnings (on dinh)');
    return { raw, value: parseAmountToNumberString(raw) };
  }

  // ====== CACH 1 (MOI): LAY EARNINGS BANG CACH BAM TRUC TIEP VAO MA DON ======
  // (dung cho chuc nang "Quet don + Lay Earnings", vi don da san co tren trang,
  // khong can go vao o tim kiem nen KHONG bi mat trang danh sach dang xem)
  //
  // Bang "Order details" hien ra la 1 OVERLAY (peek panel) de tren danh sach, KHONG
  // phai dieu huong sang trang khac. Vi vay bat buoc phai dong overlay nay lai (bam nut X
  // hoac nhan ESC) truoc khi xu ly don tiep theo - neu khong overlay se giu nguyen don dau
  // tien va moi lan doc Earnings sau do deu ra cung 1 so tien (dinh vao tat ca cac don).

  // So khop CHINH XAC tham so "order_id" trong URL (phan tich bang URLSearchParams), KHONG
  // dung bo loc CSS kieu "chua chuoi con" (a[href*="order_id=123"]) - cach do co the bam NHAM
  // sang 1 don KHAC co ma don dai hon nhung TRUNG TIEN TO voi ma don can tim (vd tim "414220878"
  // van khop nham voi href chua "order_id=4142208787", vi "414220878" la 9 ky tu dau cua
  // "4142208787"). Bam nham don se lam Earnings bi gan cho SAI don, dung loi da gap truoc day.
  function findOrderLinkByOrderId(orderId) {
    const maDon = String(orderId);
    const candidates = document.querySelectorAll('a[href*="order_id="]');
    for (const a of candidates) {
      try {
        const url = new URL(a.href, location.origin);
        if (url.searchParams.get('order_id') === maDon) return a;
      } catch (e) { /* noop */ }
    }
    return null;
  }

  // Tim phan tu co the bam duoc, khop CHINH XAC theo noi dung chu (uu tien phan tu la LA -
  // khong co con - de tranh bam nham vao 1 the bao ngoai lon hon). Dung rieng cho tab
  // "Earnings" (chu ngan, khop tuyet doi, khong bi nham như truong hop tim theo "#<ma don>").
  function findClickableByText(text, root = document) {
    const candidates = root.querySelectorAll('a, button, div, span, li');
    for (const el of candidates) {
      if (el.children.length === 0 && el.textContent && el.textContent.trim() === text) {
        return el;
      }
    }
    return null;
  }

  // Nut dong overlay: <button ...><svg class="etsy-icon">...</svg><span class="screen-reader-only">Close</span></button>
  function findCloseOrderDetailButton() {
    const spans = document.querySelectorAll('span.screen-reader-only');
    for (const span of spans) {
      if (span.textContent.trim().toLowerCase() === 'close') {
        const btn = span.closest('button');
        if (btn) return btn;
      }
    }
    return null;
  }

  function pressEscape() {
    const opts = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true };
    document.dispatchEvent(new KeyboardEvent('keydown', opts));
    document.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  // Dong bang order details: uu tien bam nut X, khong co thi nhan ESC.
  async function closeOrderDetailPanel() {
    const closeBtn = findCloseOrderDetailButton();
    if (closeBtn) {
      closeBtn.click();
    } else {
      pressEscape();
    }
    // Doi overlay bien mat hoan toan roi moi xu ly don tiep theo. KHONG sleep co dinh truoc -
    // waitFor da tu poll (200ms/lan) cho toi khi dong xong nen khong can cho them.
    await waitFor(() => !findCloseOrderDetailButton(), 6000).catch(() => {});
  }

  // Bam vao ma don de mo bang order details roi bam sang tab "Earnings". DAM BAO bang that su
  // mo ra truoc khi di tiep: moi lan bam xong cho toi da 4s cho bang (nut dong "Close") VA tab
  // "Earnings" cung xuat hien; neu khong thi tim lai link va bam lai (toi da 3 lan) - 1 cu bam
  // co the bi "nuot" khi React ve lai danh sach dung luc do (link cu bi thay bang link moi),
  // day la nguyen nhan hay gay Timeout "khong mo duoc don" truoc day.
  async function moBangDonVaChonTabEarnings(orderId, linkTimeout = WAIT_TIMEOUT) {
    const SO_LAN_THU = 3;
    let loiCuoi;
    for (let lan = 1; lan <= SO_LAN_THU; lan++) {
      const link = await waitFor(() => findOrderLinkByOrderId(orderId), linkTimeout, `link don #${orderId}`);
      link.click();
      try {
        // Tab "Order details" la tab mac dinh, noi dung "Earnings" bi an cho toi khi bam tab nay.
        const tab = await waitFor(
          () => (findCloseOrderDetailButton() ? findClickableByText(SEL.earningsTabText) : null),
          4000,
          `bang chi tiet/tab Earnings (don #${orderId}, lan ${lan})`
        );
        tab.click();
        return;
      } catch (err) {
        loiCuoi = err;
      }
    }
    throw loiCuoi;
  }

  async function getEarningsByClickingOrder(orderId, previousAmountText) {
    // 1+2. Bam vao ma don (link) de mo bang order details roi bam sang tab "Earnings"
    await moBangDonVaChonTabEarnings(orderId);

    // 3. Lay so tien
    const amount = await waitForEarningsAmount(previousAmountText);

    // 4. BAT BUOC dong overlay lai (bam X hoac nhan ESC) truoc khi sang don tiep theo
    await closeOrderDetailPanel();

    return amount;
  }

  // Chuan hoa ma don thanh chuoi, bo khoang trang thua, de tranh truong hop 1 vai dong
  // co orderNumber le kieu so / co khoang trang an... khien so khop bi lech (Set/Map
  // dung so sanh chuoi tuyet doi, "123" va "123 " la 2 gia tri khac nhau).
  function chuanHoaMaDon(orderNumber) {
    return String(orderNumber || '').trim();
  }

  // Lay earnings tuan tu cho tung ma don hang duy nhat (bang cach bam vao ma don).
  // Neu 1 don co nhieu dong (nhieu san pham) thi CHI dien Earnings vao DONG DAU TIEN
  // cua don do, cac dong sau cua cung don giu nguyen trong.
  // Tra ve true neu bi nguoi dung bam nut Dung giua chung.
  async function fillEarningsForRowsByClick(rows, onProgress) {
    const uniqueOrderNumbers = [...new Set(rows.map((r) => chuanHoaMaDon(r.orderNumber)).filter(Boolean))];
    const earningsByOrder = new Map();
    let stopped = false;
    // Gia tri "$xx.xx" tho da doc duoc o don TRUOC - truyen sang waitForEarningsAmount de
    // tranh doc nham gia tri Earnings cua don truoc con sot lai trong DOM (xem isVisible).
    let previousRaw = null;

    for (let i = 0; i < uniqueOrderNumbers.length; i++) {
      if (cancelRequested) {
        stopped = true;
        break;
      }
      const orderId = uniqueOrderNumbers[i];
      await choTabHienThi();
      if (typeof onProgress === 'function') {
        onProgress(`⏳ (${i + 1}/${uniqueOrderNumbers.length}) Đang lấy Earnings đơn #${orderId}...`);
      }
      try {
        const result = await getEarningsByClickingOrder(orderId, previousRaw);
        earningsByOrder.set(orderId, result.value);
        previousRaw = result.raw;
      } catch (err) {
        console.error('[Etsy Scraper] Lỗi lấy Earnings cho đơn ' + orderId + ':', err);
        earningsByOrder.set(orderId, '');
      }
      // Nghi ngan giua cac don, tranh gui request qua nhanh lien tuc, khong can lau nhu truoc
      // vi cac buoc trong getEarningsByClickingOrder da tu doi (waitFor) du roi.
      await sleep(100);
    }

    console.log('[Etsy Scraper] Bảng Earnings theo mã đơn:', Object.fromEntries(earningsByOrder));

    // Chi dien vao dong DAU TIEN cua moi ma don, cac dong sau (cung 1 don) bo qua.
    const daDienChoMaDon = new Set();
    let soDongDaDien = 0;
    rows.forEach((row) => {
      const key = chuanHoaMaDon(row.orderNumber);
      if (earningsByOrder.has(key) && !daDienChoMaDon.has(key)) {
        row.Earnings = earningsByOrder.get(key) || '';
        daDienChoMaDon.add(key);
        soDongDaDien++;
      }
    });
    console.log(`[Etsy Scraper] Đã điền Earnings cho ${soDongDaDien}/${rows.length} dòng.`);

    return stopped;
  }

  // ====== CACH 2 (CU - GIU NGUYEN NHU BAN DAU): LAY EARNINGS QUA O TIM KIEM ======
  // Dung rieng cho chuc nang "Lay Earnings theo danh sach ma don nhap tay", vi cac ma don
  // nay co the KHONG nam trong danh sach dang hien thi tren trang, nen phai tim kiem.

  // Gui lenh tim kiem cho o "Search your orders". Nut submit PHAI la nut THUOC CUNG form/khoi
  // voi o tim kiem - truoc day dung document.querySelector('button[type="submit"]') tren CA
  // TRANG nen de bam nham sang 1 nut submit khac (bo loc, menu...), tim kiem khong chay, khong
  // co ket qua nao hien ra -> Timeout "khong mo duoc don".
  function guiTimKiem(input) {
    const form = input.closest('form');
    let btn = form ? form.querySelector('button[type="submit"], input[type="submit"]') : null;
    if (!btn) {
      let anc = input.parentElement;
      for (let i = 0; i < 5 && anc && !btn; i++, anc = anc.parentElement) {
        btn = anc.querySelector('button[type="submit"], button[aria-label*="earch" i]');
      }
    }
    if (btn) {
      btn.click();
      return;
    }
    if (form && typeof form.requestSubmit === 'function') {
      form.requestSubmit();
      return;
    }
    const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true };
    input.dispatchEvent(new KeyboardEvent('keydown', opts));
    input.dispatchEvent(new KeyboardEvent('keypress', opts));
    input.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  async function timKiemMaDon(orderId) {
    const input = await waitFor(() => document.querySelector(SEL.searchInput), WAIT_TIMEOUT, 'o tim kiem don hang');
    input.focus();
    setNativeValue(input, orderId);
    // Su kien "input" cua React xu ly dong bo nen khong can nghi truoc khi gui (truoc day nghi 300ms).
    guiTimKiem(input);
  }

  // Toi da 2 lan thu cho moi ma don: lan 2 tim kiem lai tu dau (sau khi dong bang dang mo do
  // neu co) - nhieu loi Timeout chi la do 1 lan tim kiem/bam khong an, thu lai la duoc.
  async function getEarningsForOrderBySearch(orderId, previousAmountText) {
    const SO_LAN_THU = 2;
    let loiCuoi;
    for (let lan = 1; lan <= SO_LAN_THU; lan++) {
      try {
        // 1. Neu ma don DA co san tren trang (vd dang nam trong danh sach/ket qua hien tai) thi
        // bo qua buoc tim kiem cho nhanh; con lai thi nhap ma don vao o tim kiem va gui.
        if (!findOrderLinkByOrderId(orderId)) {
          await timKiemMaDon(orderId);
        }

        // 2. Doi ket qua hien ra (tim theo href order_id CHINH XAC, khong theo chu "#<ma don>"
        // vi de bam nham vao the bao ngoai), bam vao ma don mo bang order details, bam tab Earnings.
        await moBangDonVaChonTabEarnings(orderId, 10000);

        // 3. Lay so tien
        const amount = await waitForEarningsAmount(previousAmountText);

        // 4. Dong bang order details lai (cung la 1 overlay) truoc khi tim ma don tiep theo
        await closeOrderDetailPanel();

        return amount;
      } catch (err) {
        loiCuoi = err;
        console.warn(`[Etsy Scraper] Lan ${lan}/${SO_LAN_THU} lay Earnings don #${orderId} that bai:`, err.message);
        await closeOrderDetailPanel();
      }
    }
    throw loiCuoi;
  }

  // ====== CHUC NANG 1 + 2: QUET DON (CO HOAC KHONG LAY EARNINGS) ROI XUAT EXCEL ======

  // Kiem tra thu vien XLSX (nap qua @require) da san sang chua. Neu CDN bi chan/loi mang,
  // Violentmonkey se khong nap duoc thu vien nay va bien XLSX se khong ton tai - kiem tra
  // truoc khi quet/lay Earnings de bao loi ngay, khong de nguoi dung cho xong roi moi bao loi.
  function kiemTraXLSXSanSang() {
    if (typeof XLSX === 'undefined') {
      hienThongBao(
        '❌ Chưa tải được thư viện Excel (XLSX). Thử tải lại trang (F5) rồi chạy lại; ' +
        'nếu vẫn lỗi, kiểm tra AdBlock/tường lửa có đang chặn cdn.jsdelivr.net không.',
        '#DC2626'
      );
      console.error('[Etsy Scraper] Bien XLSX chua duoc nap (kiem tra @require trong script va ket noi mang toi CDN).');
      return false;
    }
    return true;
  }

  async function scanAndExport(withEarnings) {
    if (!kiemTraXLSXSanSang()) return;

    const newRows = extractOrdersFromPage();
    if (newRows.length === 0) {
      hienThongBao('⚠️ Không tìm thấy đơn hàng nào trên trang hiện tại. Kiểm tra Console (F12) để xem log.', '#DC2626');
      console.log('[Etsy Scraper] Khong tim thay orderLinks. Kiem tra lai selector.');
      return;
    }

    setRunningState(true);
    datNutDangChay(withEarnings ? btnScanEarnings : btnScanOnly, true);

    try {
      let stopped = false;
      if (withEarnings) {
        stopped = await fillEarningsForRowsByClick(newRows, (msg) => hienThongBao(msg, '#2563EB'));
      }

      // Xoa du lieu cu, chi giu lai du lieu vua quet duoc
      exportToExcelFile(newRows);

      // Neu co truong dia chi bi chuyen tu chu khong phai Latin sang Latin (Nga, Hy Lap,
      // Han Quoc, A Rap...), bao cho nguoi dung biet de kiem tra lai (day la phien am GAN
      // DUNG, khong phai chuan chinh thuc) - chi tiet tung dong nam trong Console (F12).
      const ghiChuLatin = danhSachCanKiemTraLatin.length > 0
        ? ` ⚠️ ${danhSachCanKiemTraLatin.length} trường địa chỉ có chữ không phải Latin đã được chuyển đổi, xem chi tiết trong Console (F12).`
        : '';
      if (danhSachCanKiemTraLatin.length > 0) {
        console.log('[Etsy Scraper] Các trường đã chuyển sang Latin (nên kiểm tra lại):', danhSachCanKiemTraLatin);
      }

      if (stopped) {
        hienThongBao(`⏹ Đã dừng theo yêu cầu. Đã xuất ${newRows.length} dòng (Earnings chưa lấy hết cho tất cả đơn). Đã copy vào clipboard, dán (Ctrl+V) thẳng vào sheet cũng được.${ghiChuLatin}`, '#F59E0B');
      } else {
        const ghiChu = withEarnings ? ' (kèm Earnings)' : '';
        hienThongBao(`✅ Đã quét ${newRows.length} dòng${ghiChu} và tải file Excel! Đã copy vào clipboard, dán (Ctrl+V) thẳng vào sheet cũng được.${ghiChuLatin}`, '#16A34A');
      }
      console.log('[Etsy Scraper] Scanned rows (đã thay thế toàn bộ dữ liệu cũ):', newRows);
    } catch (err) {
      console.error('[Etsy Scraper] Lỗi trong quá trình quét:', err);
      hienThongBao('❌ Lỗi: ' + err.message, '#DC2626');
    } finally {
      datNutDangChay(btnScanEarnings, false);
      datNutDangChay(btnScanOnly, false);
      setRunningState(false);
    }
  }

  // ====== CHUC NANG 3: LAY EARNINGS THEO DANH SACH MA DON NHAP TAY (NHU BAN DAU) ======

  async function runEarningsOnlyExport() {
    if (!kiemTraXLSXSanSang()) return;

    const raw = idsTextarea.value;
    const ids = raw
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    if (ids.length === 0) {
      hienThongBao('⚠️ Vui lòng nhập ít nhất 1 mã đơn.', '#DC2626');
      return;
    }

    setRunningState(true);
    datNutDangChay(btnEarningsOnly, true);

    const results = [];
    // Neu danh sach nhap tay co ma don TRUNG NHAU, chi lay Earnings cho LAN XUAT HIEN DAU
    // TIEN cua ma don do; cac dong sau cung ma don de trong Earnings (khong tim kiem lai,
    // do ket qua se giong het lan dau).
    const daXuLyMaDon = new Set();
    let stopped = false;
    // Gia tri "$xx.xx" tho da doc duoc o don TRUOC - xem ghi chu o fillEarningsForRowsByClick.
    let previousRaw = null;
    try {
      for (let i = 0; i < ids.length; i++) {
        if (cancelRequested) {
          stopped = true;
          break;
        }
        const id = ids[i];

        if (daXuLyMaDon.has(id)) {
          results.push({ 'Mã đơn': id, Earnings: '' });
          continue;
        }
        daXuLyMaDon.add(id);

        await choTabHienThi();
        hienThongBao(`⏳ (${i + 1}/${ids.length}) Đang lấy Earnings đơn #${id}...`, '#2563EB');
        try {
          const result = await getEarningsForOrderBySearch(id, previousRaw);
          results.push({ 'Mã đơn': id, Earnings: result.value });
          previousRaw = result.raw;
        } catch (err) {
          console.error('[Etsy Scraper] Lỗi lấy Earnings cho đơn ' + id + ':', err);
          results.push({ 'Mã đơn': id, Earnings: 'LỖI: ' + err.message });
        }
        // Xem ghi chu o fillEarningsForRowsByClick - cac buoc ben trong da tu doi du roi.
        await sleep(100);
      }

      if (results.length === 0) {
        hienThongBao('⏹ Đã dừng, chưa lấy được Earnings nào.', '#F59E0B');
        return;
      }

      const ws = XLSX.utils.json_to_sheet(results);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Earnings');
      XLSX.writeFile(wb, 'earnings_result.xlsx');
      copyDataToClipboard(results, ['Mã đơn', 'Earnings']);

      if (stopped) {
        hienThongBao(`⏹ Đã dừng theo yêu cầu. Đã lấy Earnings cho ${results.length}/${ids.length} mã đơn và tải file Excel! Đã copy vào clipboard, dán (Ctrl+V) thẳng vào sheet cũng được.`, '#F59E0B');
      } else {
        hienThongBao(`✅ Đã lấy Earnings cho ${ids.length} mã đơn và tải file Excel! Đã copy vào clipboard, dán (Ctrl+V) thẳng vào sheet cũng được.`, '#16A34A');
      }
    } catch (err) {
      console.error('[Etsy Scraper] Lỗi khi lấy Earnings theo danh sách mã đơn:', err);
      hienThongBao('❌ Lỗi: ' + err.message, '#DC2626');
    } finally {
      datNutDangChay(btnEarningsOnly, false);
      setRunningState(false);
    }
  }

  // ====== GIAO DIEN NOI (FLOATING PANEL): KEO THA + THU NHO/MO RONG ======
  let messageBox;
  let btnScanEarnings;
  let btnScanOnly;
  let btnEarningsOnly;
  let btnStop;
  let idsTextarea;

  // Co bao nguoi dung yeu cau dung tien trinh dang chay hay khong. Cac vong lap
  // lay Earnings kiem tra co nay giua moi don de dung lai som.
  let cancelRequested = false;

  function setRunningState(isRunning) {
    // Khi het chay (isRunning = false), CHI mo lai nut nao dang duoc Bat qua checkbox rieng
    // cua no - khong duoc tu dong mo lai nut ma nguoi dung da chu dong Tat.
    if (btnScanEarnings) {
      btnScanEarnings.disabled = isRunning || !GM_getValue(ENABLE_SCAN_EARNINGS_KEY, true);
    }
    if (btnScanOnly) {
      btnScanOnly.disabled = isRunning || !GM_getValue(ENABLE_SCAN_ONLY_KEY, true);
    }
    if (btnEarningsOnly) {
      btnEarningsOnly.disabled = isRunning;
    }
    if (btnStop) {
      btnStop.style.display = isRunning ? 'block' : 'none';
      btnStop.disabled = false;
      btnStop.textContent = '⏹ Dừng';
      datNutDangChay(btnStop, false);
    }
    cancelRequested = false;
  }

  // Hien thong bao ngay ben duoi panel, thay cho alert() phai bam OK.
  function hienThongBao(text, mau = '#374151') {
    if (!messageBox) return;
    messageBox.style.background = mau;
    messageBox.style.display = 'block';
    messageBox.textContent = text;
    clearTimeout(messageBox._timer);
    messageBox._timer = setTimeout(() => {
      messageBox.style.display = 'none';
    }, 5000);
  }

  function docTrangThaiPanel() {
    try {
      return JSON.parse(GM_getValue(PANEL_STATE_KEY, '{}')) || {};
    } catch (e) {
      return {};
    }
  }

  function luuTrangThaiPanel(state) {
    const hienTai = docTrangThaiPanel();
    GM_setValue(PANEL_STATE_KEY, JSON.stringify({ ...hienTai, ...state }));
  }

  // Cho phep keo panel bang cach giu chuot vao "tayCam". Neu ha-tha chuot ma
  // KHONG di chuyen (hoac di chuyen rat it), coi la 1 cai click va goi onClick.
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

  // =====================================================================
  // ====== AUTO TRACKING (gop tu script "Etsy Auto Tracking (from Google Sheet)") ======
  // Dien tracking + hang van chuyen tu Google Sheet vao cac don tren trang
  // /your/orders/sold. Toan bo code nam trong module rieng (tranh trung ten ham
  // voi phan Order Scraper o tren); chi giao dien duoc dua vao panel Order Scraper.
  // =====================================================================
  const AutoTracking = (function () {
    // Tham chieu toi cac phan tu giao dien (gan trong buildSection)
    let logBoxEl = null;
    let startBtnEl = null;
    let pauseBtnEl = null;
    let sheetInfoEl = null;
    let sheetCountEl = null;
    let sheetUrlInput = null;
    let canhBaoScriptCuEl = null;

    // Script cu "Etsy Auto Tracking (from Google Sheet)" (v4.8, da gop vao Order Scraper tu
    // v3.0 nhung van con trong Violentmonkey neu chua xoa) tao panel #at-panel va lay nut bang
    // document.getElementById('at-...'). Neu chay song song, 2 vong cung dien tracking vao cung
    // don, tranh nhau mo/dong modal "Complete order" -> khong dien duoc / modal tat ngay.
    function coScriptTrackingCuDangChay() {
      return !!document.getElementById('at-panel');
    }

    function kiemTraScriptCu() {
      const coCu = coScriptTrackingCuDangChay();
      if (canhBaoScriptCuEl) canhBaoScriptCuEl.style.display = coCu ? 'block' : 'none';
      return coCu;
    }

    // Manual overrides if the automatic substring match picks the wrong
    // carrier option. Key = lowercase DVVC/carrier text (or part of it) as it
    // appears in the sheet, value = exact text of the Etsy <option> to pick.
    // Leave empty if the automatic matching (see matchCarrierOption) works
    // fine for your shop.
    const CARRIER_ALIASES = {
      // 'dhl ecommerce': 'DHL',
    };

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // Used by the order-code-first / customer-name-fallback order matching.
    function normalizeName(s) {
      return (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    const RUN_KEY = 'AT_RUNNING';
    const PAUSE_KEY = 'AT_PAUSED';

    // Short log lines shown inside the on-page panel (kept separate from the
    // full console log, which stays verbose for debugging).
    const MAX_UI_LOG_LINES = 12;

    function uiLog(text) {
      const box = logBoxEl;
      if (!box) return;
      const time = new Date().toLocaleTimeString('vi-VN', { hour12: false });
      const line = document.createElement('div');
      line.style.cssText =
        'white-space:pre-wrap; word-break:break-word; border-bottom:1px solid rgba(255,255,255,.06); padding:2px 0;';
      line.textContent = `${time} ${text}`;
      box.appendChild(line);
      while (box.children.length > MAX_UI_LOG_LINES) box.removeChild(box.firstChild);
      box.scrollTop = box.scrollHeight;
    }

    // Dich cac loi thuong gap sang tieng Viet ngan gon (console van giu thong bao goc).
    function dichLoi(m) {
      m = String(m || '');
      if (/^Timeout waiting for/i.test(m)) return 'quá thời gian chờ (' + m.replace(/^Timeout waiting for:\s*/i, '') + ')';
      if (/carrier select not found/i.test(m)) return 'không thấy ô chọn DVVC';
      if (/No "Other" option/i.test(m)) return 'DVVC không có mục Other';
      if (/submit button not found/i.test(m)) return 'không thấy nút gửi';
      if (/^HTTP 4(01|03)/.test(m)) return 'Sheet chưa chia sẻ công khai (' + m + ')';
      if (/^HTTP 404/.test(m)) return 'không tìm thấy Sheet (404)';
      if (/network error/i.test(m)) return 'lỗi mạng';
      if (/^timeout$/i.test(m)) return 'hết thời gian tải';
      return m;
    }

    function log(...a) {
      console.log('%c[AutoTrack]', 'color:#0ea5e9;font-weight:bold', ...a);
      let text = a.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ');
      text = text.replace(/\s+/g, ' ').trim();
      if (text.length > 90) text = text.slice(0, 87) + '...';
      uiLog(text);
    }

    // Bam Stop phai dung NGAY, khong doi het thoi gian cho (toi 8s/buoc) cua buoc dang ket:
    // moi vong cho kiem tra co RUN_KEY (xem bamStopGiuaChung) va nem loi dac biet de thoat.
    const STOP_MSG = 'Stopped by user';
    const laLoiDung = (e) => !!e && e.message === STOP_MSG;

    async function waitFor(fn, { timeout = 10000, interval = 200, desc = '' } = {}) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (!GM_getValue(RUN_KEY)) throw new Error(STOP_MSG);
        const v = await fn();
        if (v) return v;
        await sleep(interval);
      }
      throw new Error('Timeout waiting for: ' + desc);
    }

    function setNativeValue(el, value) {
      const proto = Object.getPrototypeOf(el);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      desc.set.call(el, value);
    }


    function getOrderIds() {
      return Array.from(document.querySelectorAll('a[href*="order_id="]'))
        .map((a) => {
          const m = a.href.match(/order_id=(\d+)/);
          return m ? m[1] : null;
        })
        .filter((v, i, arr) => v && arr.indexOf(v) === i);
    }

    // Look the row up fresh by order id rather than keeping a DOM reference
    // captured earlier — completing an order re-renders the list (the
    // finished row disappears), which can leave previously-captured element
    // references detached/stale, causing clicks on them to silently do
    // nothing (symptom: "dropdown open" timeouts right after a completion).
    function findRowByOrderId(orderId) {
      const a = document.querySelector(`a[href*="order_id=${orderId}"]`);
      return a ? a.closest('.panel-body-row') : null;
    }

    async function waitForRow(orderId, timeout = 4000) {
      try {
        return await waitFor(() => findRowByOrderId(orderId), {
          timeout,
          interval: 200,
          desc: 'row for order ' + orderId,
        });
      } catch (e) {
        return null;
      }
    }

    // Shipping recipient's name, used as a fallback match key when an order
    // code doesn't turn up a match in the Sheet data (e.g. a cancelled order
    // redone under a different code keeps the same shipping name).
    function getOrderCustomerName(row) {
      // Prefer the "Ship to" summary name (the actual shipping recipient) — a
      // <div class="text-body-smaller strong"> beneath the Ship to accordion.
      // Whether Etsy wraps the text in an extra
      // <span data-test-id="unsanitize"> or not varies per order (confirmed:
      // some orders render it as plain text with no such span at all), so
      // just read the element's own text instead of depending on that span.
      const shipToEl = row.querySelector('.text-body-smaller.strong');
      if (shipToEl && shipToEl.textContent.trim()) return shipToEl.textContent.trim();

      // Fallback: the buyer's account name shown at the top of the order (a
      // dropdown-button holding the name + a chevron icon). The row has other
      // dropdown buttons too (e.g. "Update progress"), so explicitly skip any
      // whose container carries a clg-tooltip — only the action-menu ones do.
      const dropdownButtons = row.querySelectorAll('[data-dropdown-button="true"]');
      for (const btn of dropdownButtons) {
        const container = btn.closest('[data-dropdown-container="true"]');
        if (container && container.querySelector('clg-tooltip')) continue;
        const text = btn.textContent.trim();
        if (text) return text;
      }
      return '';
    }

    function findUpdateProgressTrigger(row) {
      const groups = row.querySelectorAll('[data-dropdown-container="true"]');
      for (const g of groups) {
        const tip = g.querySelector('clg-tooltip');
        if (tip && tip.textContent.includes('Update progress')) {
          return g.querySelector('[data-dropdown-button="true"]');
        }
      }
      return null;
    }

    async function openCompleteOrderModal(row, orderId) {
      const trigger = findUpdateProgressTrigger(row);
      if (!trigger) return false; // no "Update progress" action on this row -> skip

      // Scroll the row into view first — some pages skip/deprioritise click
      // handling on elements sitting outside the viewport.
      row.scrollIntoView({ block: 'center' });
      await sleep(150);

      const container = trigger.closest('[data-dropdown-container="true"]');
      const menu = container.querySelector('[data-dropdown-target="true"]');
      // Check multiple signals (trigger's own aria-expanded as well as the
      // menu's aria-hidden/class) since which one flips first can vary.
      const isOpen = () =>
        trigger.getAttribute('aria-expanded') === 'true' ||
        menu.getAttribute('aria-hidden') === 'false' ||
        !menu.classList.contains('is-closed');

      trigger.click();
      await sleep(250);

      try {
        await waitFor(isOpen, { timeout: 8000, desc: 'dropdown open for order ' + orderId });
      } catch (e) {
        // Dropdown never opened in time (page was busy/laggy). Try to close it
        // again so it doesn't sit open and block clicks on the next order.
        trigger.click();
        throw e;
      }

      const completeBtn = Array.from(menu.querySelectorAll('button')).find((b) =>
        b.textContent.trim().includes('Complete order')
      );
      if (!completeBtn) {
        // No "Complete order" action (already shipped / cancelled / etc.) -> skip
        trigger.click(); // close the dropdown again
        return false;
      }
      completeBtn.click();

      await waitFor(
        () => document.querySelector(`select[name="carrierNameSelect-${orderId}"]`),
        { timeout: 8000, desc: 'Complete order modal for ' + orderId }
      );
      return true;
    }

    function matchCarrierOption(select, carrierRaw) {
      const carrierNorm = carrierRaw.trim().toLowerCase();

      for (const key of Object.keys(CARRIER_ALIASES)) {
        if (carrierNorm.includes(key)) {
          const wanted = CARRIER_ALIASES[key].toLowerCase();
          const opt = Array.from(select.querySelectorAll('option')).find(
            (o) => o.textContent.trim().toLowerCase() === wanted
          );
          if (opt) return opt;
        }
      }

      const options = Array.from(select.querySelectorAll('option')).filter((o) => {
        const t = o.textContent.trim().toLowerCase();
        return t && t !== 'other' && t !== 'select shipping carrier';
      });

      // Exact match wins; otherwise a substring match only counts when the
      // shorter side is at least 3 chars (avoids a tiny option like "US"
      // matching inside an unrelated carrier), preferring the longest option.
      const exact = options.find((o) => o.textContent.trim().toLowerCase() === carrierNorm);
      if (exact) return exact;

      const partial = options.filter((o) => {
        const t = o.textContent.trim().toLowerCase();
        if (Math.min(t.length, carrierNorm.length) < 3) return false;
        return carrierNorm.includes(t) || t.includes(carrierNorm);
      });
      partial.sort((a, b) => b.textContent.trim().length - a.textContent.trim().length);
      return partial[0];
    }

    async function setClgTextInputValue(clgEl, value) {
      const input = await waitFor(
        () => clgEl.shadowRoot && clgEl.shadowRoot.querySelector('input'),
        { timeout: 4000, desc: 'inner <input> of ' + (clgEl.getAttribute('name') || clgEl.tagName) }
      );
      const proto = Object.getPrototypeOf(input);
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(input, value);
      // Only 'input' + 'change' — dispatching 'blur' too has been seen to send
      // this custom element (and Etsy's own React tree) into a heavy re-render
      // loop that can hang/crash the tab, especially with DevTools open.
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    }

    async function fillAndSubmit(orderId, tracking, carrierRaw) {
      const select = document.querySelector(`select[name="carrierNameSelect-${orderId}"]`);
      if (!select) throw new Error('carrier select not found for ' + orderId);

      const matched = matchCarrierOption(select, carrierRaw);

      if (matched) {
        log(`  DVVC: ${matched.textContent.trim()}`);
        setNativeValue(select, matched.value);
        select.dispatchEvent(new Event('change', { bubbles: true }));
        // Let Etsy's own React tree finish re-rendering around the select
        // before we touch anything else in the modal.
        await sleep(500);
      } else {
        const other = Array.from(select.querySelectorAll('option')).find(
          (o) => o.textContent.trim().toLowerCase() === 'other'
        );
        if (!other) throw new Error('No "Other" option found in carrier select');
        log(`  DVVC: Other (${carrierRaw})`);
        setNativeValue(select, other.value);
        select.dispatchEvent(new Event('change', { bubbles: true }));
        // Selecting "Other" makes the custom carrier-name field appear/enable;
        // give the app a moment to settle before we grab and fill it — doing
        // this too fast back-to-back is what tends to freeze the tab.
        await sleep(500);

        const carrierInput = await waitFor(
          () => document.querySelector(`clg-text-input[name="carrierName-${orderId}"]`),
          { timeout: 3000, desc: 'custom carrier text input' }
        );
        await setClgTextInputValue(carrierInput, carrierRaw);
        await sleep(300);
      }

      const trackingInput = await waitFor(
        () => document.querySelector(`clg-text-input[name="trackingCode-${orderId}"]`),
        { timeout: 3000, desc: 'tracking number input' }
      );
      await setClgTextInputValue(trackingInput, tracking);

      await sleep(500);

      // The modal's own footer button, not the dropdown menu item -> exclude
      // anything still living inside a dropdown container.
      const submitBtn = Array.from(document.querySelectorAll('button')).find(
        (b) =>
          b.textContent.trim() === 'Complete order' &&
          !b.closest('[data-dropdown-target="true"]')
      );
      if (!submitBtn) throw new Error('Modal submit button not found');

      await waitFor(() => !submitBtn.disabled, { timeout: 5000, desc: 'submit button enabled' });
      submitBtn.click();

      await waitFor(
        () => !document.querySelector(`select[name="carrierNameSelect-${orderId}"]`),
        { timeout: 8000, desc: 'modal closed for ' + orderId }
      );
    }

    function closeModalIfOpen(orderId) {
      const select = document.querySelector(`select[name="carrierNameSelect-${orderId}"]`);
      if (!select) return;
      const cancelBtn = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent.trim() === 'Cancel'
      );
      if (cancelBtn) cancelBtn.click();
    }

    // ---------------------------------------------------------------------
    // Load tracking data straight from a Google Sheets link (no copy/paste),
    // via the CSV export endpoint. Requires the sheet's sharing set to
    // "Anyone with the link" (Viewer) — otherwise Google serves an HTML
    // sign-in page instead of CSV, which is detected and reported. The CSV
    // export always includes the real header row, so columns are matched by
    // name (ORDER CODE / FULL NAME / TRACKING / DVVC) instead of guessing a
    // fixed position.
    // ---------------------------------------------------------------------

    let sheetMap = null; // orderId -> { tracking, carrier }
    let sheetMapByName = null; // normalized customer name -> { tracking, carrier } (fallback)

    function extractSheetIdAndGid(url) {
      const idMatch = (url || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      if (!idMatch) return null;
      const gidMatch = url.match(/[?&#]gid=(\d+)/);
      return { sheetId: idMatch[1], gid: gidMatch ? gidMatch[1] : '0' };
    }

    function gmFetchTextOnce(url, anonymous) {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          anonymous: !!anonymous, // true = khong gui cookie Google (tranh 401 do dang nhap nhieu tai khoan)
          timeout: 15000,
          onload: (res) => {
            if (res.status >= 200 && res.status < 300) resolve(res.responseText);
            else reject(new Error('HTTP ' + res.status));
          },
          onerror: () => reject(new Error('network error')),
          ontimeout: () => reject(new Error('timeout')),
        });
      });
    }

    // One retry on a transient failure (network blip / timeout / 5xx); a 4xx
    // (e.g. 403/404) won't get better by retrying, so it fails immediately.
    async function gmFetchText(url) {
      try {
        return await gmFetchTextOnce(url, false);
      } catch (e) {
        // 401/403 thuong do cookie cua tai khoan Google dang dang nhap trong trinh duyet khong
        // co quyen (dang nhap nhieu tai khoan) du Sheet da chia se "Anyone with the link" ->
        // thu lai KHONG gui cookie (nac danh). Sheet han che thi van dung cookie o lan dau.
        if (/^HTTP 40[13]/.test(e.message)) return gmFetchTextOnce(url, true);
        if (/^HTTP 4/.test(e.message)) throw e;
        await sleep(1500);
        return gmFetchTextOnce(url, false);
      }
    }

    // Minimal RFC4180-ish CSV parser: handles quoted fields with embedded
    // commas, real newlines, and escaped "" quotes — which is exactly how
    // Google's CSV export represents a wrapped multi-line cell.
    function parseCsv(text) {
      const rows = [];
      let row = [];
      let field = '';
      let inQuotes = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
          if (c === '"') {
            if (text[i + 1] === '"') {
              field += '"';
              i++;
            } else {
              inQuotes = false;
            }
          } else {
            field += c;
          }
        } else if (c === '"') {
          inQuotes = true;
        } else if (c === ',') {
          row.push(field);
          field = '';
        } else if (c === '\r') {
          // ignore; \n (below) is what ends the row
        } else if (c === '\n') {
          row.push(field);
          field = '';
          rows.push(row);
          row = [];
        } else {
          field += c;
        }
      }
      if (field.length || row.length) {
        row.push(field);
        rows.push(row);
      }
      return rows;
    }

    // Only orders placed within this many days are kept when loading a sheet —
    // older rows are skipped entirely (not matched, not filled).
    const RECENT_DAYS_LIMIT = 10;

    // Parses "D/M/YY", "D/M/YYYY" (day-first, matching this sheet's ORDER DATE
    // convention, e.g. "20/5/26") or an ISO "YYYY-MM-DD" date string. Returns
    // null if it doesn't look like a date at all (in which case the row is
    // kept rather than guessed away).
    function parseSheetDate(str) {
      const s = (str || '').trim();
      if (!s) return null;

      let m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
      if (m) {
        const d = parseInt(m[1], 10);
        const mo = parseInt(m[2], 10);
        let y = parseInt(m[3], 10);
        if (y < 100) y += 2000;
        const dt = new Date(y, mo - 1, d);
        return isNaN(dt.getTime()) ? null : dt;
      }

      m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (m) {
        const dt = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
        return isNaN(dt.getTime()) ? null : dt;
      }

      return null;
    }

    function isWithinRecentDays(date, days) {
      const cutoff = new Date();
      cutoff.setHours(0, 0, 0, 0);
      cutoff.setDate(cutoff.getDate() - days);
      return date >= cutoff;
    }

    // The TRACKING column sometimes holds a free-text note instead of a real
    // tracking code (e.g. "NGOÀI US", "Priority") — a placeholder meaning
    // "not a trackable US shipment" rather than an actual tracking number.
    // Reject anything that doesn't look like a real carrier tracking code:
    // no whitespace, long enough, and containing at least some digits (a
    // purely-alphabetic word like "Priority" is never a real tracking number).
    function looksLikeTrackingNumber(str) {
      const s = (str || '').trim();
      if (s.length < 8) return false;
      if (/\s/.test(s)) return false;
      if (!/\d/.test(s)) return false;
      return true;
    }

    // Finds a header column by trying keyword groups in priority order (all
    // header cells checked against the first group before falling back to the
    // next) — e.g. "ORDER DATE" contains the bare substring "ORDER", so a
    // single flat keyword list risked matching the date column instead of the
    // real "ORDER CODE" column whenever the date column came first.
    function findColPriority(header, tiers) {
      for (const tier of tiers) {
        const idx = header.findIndex((h) => tier.some((k) => h.includes(k)));
        if (idx !== -1) return idx;
      }
      return -1;
    }

    function parseSheetCsv(text) {
      const rows = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ''));
      if (!rows.length) return { ok: false, rowCount: 0 };

      const header = rows[0].map((h) => h.trim().toUpperCase());
      const colOrder = findColPriority(header, [
        ['ORDER CODE'],
        ['ORDERNUMBER', 'ORDER NUMBER'],
        ['ORDER ID'],
        ['MA DON', 'MÃ ĐƠN'],
        ['ORDER'],
      ]);
      const colName = findColPriority(header, [['FULL NAME'], ['NAME'], ['CUSTOMER']]);
      const colTracking = findColPriority(header, [['TRACKING']]);
      const colCarrier = findColPriority(header, [
        ['DVVC'],
        ['CARRIER'],
        ['VAN CHUYEN', 'VẬN CHUYỂN'],
      ]);
      const colDate = findColPriority(header, [['ORDER DATE'], ['DATE', 'NGAY', 'NGÀY']]);

      if (colOrder === -1 || colTracking === -1) {
        return { ok: false, header, colOrder, colTracking };
      }

      const map = {};
      const mapByName = {};
      const order = [];
      let count = 0;
      let skippedOld = 0;
      let skippedNotTracking = 0;
      for (let i = 1; i < rows.length; i++) {
        const cells = rows[i];
        const orderId = (cells[colOrder] || '').trim();
        const tracking = (cells[colTracking] || '').trim();
        const carrier = colCarrier !== -1 ? (cells[colCarrier] || '').trim() : '';
        if (!orderId || !tracking) continue; // order not shipped yet -> skip
        if (!looksLikeTrackingNumber(tracking)) {
          // A note like "NGOÀI US" / "Priority" instead of a real tracking
          // code -> not something we can fill into Etsy, skip it.
          skippedNotTracking++;
          continue;
        }

        if (colDate !== -1) {
          const date = parseSheetDate(cells[colDate]);
          if (date && !isWithinRecentDays(date, RECENT_DAYS_LIMIT)) {
            skippedOld++;
            continue;
          }
        }

        if (!(orderId in map)) order.push(orderId);
        map[orderId] = { tracking, carrier };
        if (colName !== -1) {
          const name = normalizeName(cells[colName]);
          if (name) mapByName[name] = { tracking, carrier };
        }
        count++;
      }
      return { ok: true, map, mapByName, order, count, rowCount: rows.length - 1, skippedOld, skippedNotTracking };
    }

    function lookupTracking(orderId, customerName) {
      if (!sheetMap) return { orderId, found: false };
      let entry = sheetMap[orderId];
      let byName = false;
      if (!entry && customerName && sheetMapByName) {
        entry = sheetMapByName[normalizeName(customerName)];
        byName = !!entry;
      }
      return entry
        ? { orderId, found: true, tracking: entry.tracking, carrier: entry.carrier, byName }
        : { orderId, found: false };
    }

    // Returns true if a real "open modal / fill / submit" attempt happened
    // (used by runAll to decide how long to pause before the next order —
    // a quick skip shouldn't cost the same settle time as a real completion).
    async function processOrder(orderId) {
      // Fetch the row first — completing an order re-renders the list (see
      // findRowByOrderId), and we also need the customer name off of it as a
      // fallback match key in case the order code itself doesn't match.
      const row = await waitForRow(orderId);
      if (!row) {
        return false; // order no longer on page -> skip silently
      }
      const customerName = getOrderCustomerName(row);

      log(`Đơn ${orderId}${customerName ? ' (' + customerName + ')' : ''}...`);

      const result = lookupTracking(orderId, customerName);

      if (!result.found) {
        log('  Không có trong Sheet → bỏ qua.');
        return false;
      }
      log(`  Thấy${result.byName ? ' (theo tên)' : ''}: ${result.tracking} / ${result.carrier || '?'}`);

      if (!result.carrier) {
        log('  Thiếu DVVC trong Sheet → bỏ qua.');
        return false;
      }

      const opened = await openCompleteOrderModal(row, orderId);
      if (!opened) {
        log('  Đơn không có nút Complete order → bỏ qua.');
        return false;
      }

      try {
        await fillAndSubmit(orderId, result.tracking, result.carrier);
        log('  ✓ Đã điền xong.');
      } catch (e) {
        if (!laLoiDung(e)) log('  ✗ Lỗi khi điền: ' + dichLoi(e.message));
        closeModalIfOpen(orderId);
      }
      return true;
    }

    // Co "dang co 1 vong runAll chay" - chan viec 2 vong chay SONG SONG tren cung cac don
    // (2 vong cung bam menu "Update progress" cua 1 don -> bam dong/mo chong nhau -> ket).
    let vongDangChay = false;
    let dangKhoiDong = false; // dang tai Sheet sau khi bam Start, chua vao runAll

    async function runAll() {
      if (vongDangChay) {
        log('Đang chạy rồi, bỏ qua lần bấm trùng.');
        return;
      }
      vongDangChay = true;
      try {
        await runAllImpl();
      } finally {
        vongDangChay = false;
      }
    }

    async function runAllImpl() {
      GM_setValue(RUN_KEY, true);
      GM_setValue(PAUSE_KEY, false);
      capNhatTrangThaiNut();

      if (!sheetMap) {
        log('Chưa có dữ liệu Sheet — dán link rồi bấm Bắt đầu.');
      }

      // Always driven by the Etsy page: scan every order currently shown on
      // this page first, then check each one against the loaded Sheet data.
      const orderIds = getOrderIds();
      log(`Trang này có ${orderIds.length} đơn.`);

      for (const orderId of orderIds) {
        if (!GM_getValue(RUN_KEY)) {
          log('Đã dừng.');
          break;
        }

        // Pause: block right here (loop position/order id list is kept,
        // nothing is re-scanned) until Resume is clicked or Stop cancels the run.
        while (GM_getValue(PAUSE_KEY)) {
          capNhatTrangThaiNut();
          await sleep(300);
          if (!GM_getValue(RUN_KEY)) break;
        }
        if (!GM_getValue(RUN_KEY)) {
          log('Đã dừng.');
          break;
        }
        capNhatTrangThaiNut();

        let attempted = false;
        try {
          attempted = await processOrder(orderId);
        } catch (e) {
          // Bam Stop giua chung khong phai la loi - chi can don dep roi vong lap tu thoat.
          if (!laLoiDung(e)) log('Lỗi khi xử lý đơn:', e.message);
          // Best-effort cleanup: close any dropdown/modal left open by the
          // failed step so it doesn't block clicks on the next order.
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          // Chi bam Stop thi khong can nghi 2s cho trang on dinh - thoat vong lap ngay.
          attempted = !laLoiDung(e);
        }
        // Only pay the full "let the page settle" pause after a real
        // open-modal/fill/submit attempt; a quick non-match skip doesn't need it.
        await sleep(attempted ? 2000 : 150);
      }

      GM_setValue(RUN_KEY, false);
      GM_setValue(PAUSE_KEY, false);
      capNhatTrangThaiNut();
      log('Xong hết.');
    }

    // Fetches + parses a single sheet URL. Returns { ok:true, ...parseSheetCsv
    // result } or { ok:false, error } — never throws, so the caller can keep
    // going through a list of URLs even if one of them fails.
    async function fetchOneSheet(url) {
      const parsed = extractSheetIdAndGid(url);
      if (!parsed) {
        return { ok: false, error: 'link không hợp lệ (cần dạng .../spreadsheets/d/<id>/...)' };
      }

      const exportUrl = `https://docs.google.com/spreadsheets/d/${parsed.sheetId}/export?format=csv&gid=${parsed.gid}`;
      let text;
      try {
        text = await gmFetchText(exportUrl);
      } catch (e) {
        const loiQuyen = /^HTTP 40[13]/.test(e.message);
        return { ok: false, error: loiQuyen ? `không có quyền đọc (${e.message}) — kiểm tra Sheet đã chia sẻ "Bất kỳ ai có đường liên kết" chưa, và phải là Google Sheets gốc (không phải file Excel .xlsx tải lên Drive)` : `không tải được (${e.message})` };
      }

      if (/^\s*<(!DOCTYPE|html)/i.test(text)) {
        return { ok: false, error: 'chưa share công khai (Share -> Anyone with the link -> Viewer)' };
      }

      const result = parseSheetCsv(text);
      if (!result.ok) {
        const missing = [];
        if (result.colOrder === -1) missing.push('ORDER CODE');
        if (result.colTracking === -1) missing.push('TRACKING');
        return { ok: false, error: `thiếu cột ${missing.join(', ')}` };
      }
      if (result.count === 0) {
        const parts = [];
        if (result.skippedOld > 0) parts.push(`${result.skippedOld} đơn có tracking nhưng cũ hơn ${RECENT_DAYS_LIMIT} ngày`);
        if (result.skippedNotTracking > 0)
          parts.push(`${result.skippedNotTracking} dòng ghi chú không phải mã tracking (VD: "NGOÀI US", "Priority")`);
        const reason = parts.length
          ? parts.join('; ')
          : `đọc được ${result.rowCount} dòng nhưng không đơn nào có TRACKING`;
        return { ok: false, error: reason };
      }
      return result;
    }

    // Loads and merges sheet data from one or more Google Sheets links (one
    // per line — see fetchOneSheet/parseSheetCsv above for the "Anyone with
    // the link" requirement). A later sheet's entry for the same order code
    // overwrites an earlier one; order ids are kept in first-appearance order
    // across all sheets combined. Remembers the URLs in localStorage so Start
    // can quietly re-fetch the latest data on every run without re-entering
    // them. Keeps going through every URL even if some fail, and only reports
    // total failure if NONE of them produced usable data.
    async function loadSheetsFromUrls(urlsText) {
      const info = sheetInfoEl;
      const urls = (urlsText || '')
        .split(/\r?\n/)
        .map((u) => u.trim())
        .filter(Boolean);

      if (!urls.length) {
        if (info) info.textContent = 'Dán ít nhất 1 link Google Sheet.';
        return false;
      }

      if (info) info.textContent = `Đang tải dữ liệu từ ${urls.length} link Sheet...`;

      const combinedMap = {};
      const combinedMapByName = {};
      const combinedOrder = [];
      const errors = [];
      let okCount = 0;
      let totalSkippedOld = 0;
      let totalSkippedNotTracking = 0;

      for (const url of urls) {
        log('Đang tải Sheet...');
        const result = await fetchOneSheet(url);
        if (!result.ok) {
          log('  ✗ Tải lỗi: ' + dichLoi(result.error));
          errors.push(`${url}\n  -> ${result.error}`);
          continue;
        }
        okCount++;
        totalSkippedOld += result.skippedOld || 0;
        totalSkippedNotTracking += result.skippedNotTracking || 0;
        log(`  Đã tải ${result.count} đơn.`);
        for (const orderId of result.order) {
          if (!(orderId in combinedMap)) combinedOrder.push(orderId);
          combinedMap[orderId] = result.map[orderId];
        }
        Object.assign(combinedMapByName, result.mapByName);
      }

      if (!okCount) {
        if (info) info.textContent = `Không tải được link nào.\n${errors.join('\n')}`;
        log('Không tải được Sheet nào.');
        return false;
      }

      sheetMap = combinedMap;
      sheetMapByName = combinedMapByName;
      localStorage.setItem('at_sheet_urls', urlsText);

      let msg = `Đã tải ${combinedOrder.length} đơn từ ${okCount}/${urls.length} link.`;
      if (totalSkippedOld > 0) msg += ` (bỏ qua ${totalSkippedOld} đơn cũ hơn ${RECENT_DAYS_LIMIT} ngày)`;
      if (totalSkippedNotTracking > 0)
        msg += ` (bỏ qua ${totalSkippedNotTracking} dòng ghi chú không phải mã tracking, VD: "NGOÀI US", "Priority")`;
      if (errors.length) msg += `\nLỗi:\n${errors.join('\n')}`;
      if (info) info.textContent = msg;
      log(`Tổng ${combinedOrder.length} đơn từ ${okCount}/${urls.length} link.`);
      return true;
    }

    // --- giao dien (kieu Order Scraper) --------------------------------
    // Khong con dong chu "Idle/Running": nut nao dang hoat dong thi nhay sang (eos-busy).
    // Start sang khi dang chay (hoac dang tai Sheet), Tam dung sang khi dang tam dung.
    function capNhatTrangThaiNut() {
      const chay = !!GM_getValue(RUN_KEY);
      const tamDung = chay && !!GM_getValue(PAUSE_KEY);
      datNutDangChay(startBtnEl, (chay && !tamDung) || dangKhoiDong);
      datNutDangChay(pauseBtnEl, tamDung);
      if (pauseBtnEl) pauseBtnEl.textContent = tamDung ? '▶ Tiếp tục' : '⏸ Tạm dừng';
    }

    function setPauseButtonLabel() {
      capNhatTrangThaiNut();
    }

    // Live line-count so it's obvious each pasted link actually landed on its
    // own line (a paste that silently collapses everything onto one line
    // would otherwise look identical to the eye) instead of needing to click
    // a separate "load" button just to find out.
    function updateSheetUrlCount() {
      if (!sheetCountEl || !sheetUrlInput) return;
      const lines = sheetUrlInput.value
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (!lines.length) {
        sheetCountEl.textContent = '';
        return;
      }
      const validCount = lines.filter((l) => extractSheetIdAndGid(l)).length;
      let text = `${lines.length} dòng — ${validCount} link Sheet hợp lệ`;
      if (validCount !== lines.length) text += `, ${lines.length - validCount} dòng không phải link Sheet`;
      sheetCountEl.textContent = text;
    }

    function taoNut(nhan, mau) {
      const btn = document.createElement('button');
      btn.textContent = nhan;
      btn.className = 'eos-btn';
      btn.style.cssText = `flex:1; min-width:0; padding:7px 2px; background:${mau};`;
      return btn;
    }

    // Tao khoi giao dien Auto Tracking de gan vao panel Order Scraper.
    function buildSection() {
      const khoi = document.createElement('div');
      khoi.id = 'eos-at-section';
      canhBaoScriptCuEl = document.createElement('div');
      canhBaoScriptCuEl.style.cssText =
        'display:none; background:#FEF2F2; border:1px solid #DC2626; color:#991B1B; border-radius:6px; padding:5px 7px; font-size:11px; line-height:1.4; font-weight:600;';
      canhBaoScriptCuEl.textContent =
        '⚠️ Còn script cũ "Etsy Auto Tracking" — đã gộp vào đây nên 2 script sẽ tranh nhau điền. Xoá/tắt script cũ trong Violentmonkey rồi F5.';
      khoi.appendChild(canhBaoScriptCuEl);
      kiemTraScriptCu();
      // Script cu co the nap SAU script nay nen kiem tra lai vai lan.
      [1500, 4000, 8000].forEach((ms) => setTimeout(kiemTraScriptCu, ms));
      khoi.style.cssText =
        'display:flex; flex-direction:column; gap:7px; border-top:1px solid #E5E7EB; padding-top:8px; margin-top:1px;';

      const tieuDe = document.createElement('div');
      tieuDe.className = 'eos-title';
      tieuDe.textContent = '🚚 Điền tracking từ Google Sheet';
      khoi.appendChild(tieuDe);

      const hangNut = document.createElement('div');
      hangNut.style.cssText = 'display:flex; gap:5px;';
      const btnStart = taoNut('▶ Bắt đầu', '#1a7f37');
      startBtnEl = btnStart;
      pauseBtnEl = taoNut('⏸ Tạm dừng', '#D97706');
      const btnStop = taoNut('⏹ Dừng', '#DC2626');
      btnStart.id = 'eos-at-start';
      pauseBtnEl.id = 'eos-at-pause';
      btnStop.id = 'eos-at-stop';
      hangNut.appendChild(btnStart);
      hangNut.appendChild(pauseBtnEl);
      hangNut.appendChild(btnStop);
      khoi.appendChild(hangNut);

      const nhanLink = document.createElement('div');
      nhanLink.className = 'eos-hint';
      nhanLink.textContent = 'Link Google Sheet (mỗi link 1 dòng, chia sẻ "Anyone with the link")';
      khoi.appendChild(nhanLink);

      sheetUrlInput = document.createElement('textarea');
      sheetUrlInput.id = 'eos-at-sheet-url';
      sheetUrlInput.placeholder = 'https://docs.google.com/spreadsheets/d/...\nhttps://docs.google.com/spreadsheets/d/...';
      sheetUrlInput.className = 'eos-input';
      sheetUrlInput.style.height = '46px';
      sheetUrlInput.value = localStorage.getItem('at_sheet_urls') || localStorage.getItem('at_sheet_url') || '';
      sheetUrlInput.addEventListener('input', updateSheetUrlCount);
      khoi.appendChild(sheetUrlInput);

      sheetCountEl = document.createElement('div');
      sheetCountEl.id = 'eos-at-sheet-url-count';
      sheetCountEl.className = 'eos-hint';
      khoi.appendChild(sheetCountEl);

      sheetInfoEl = document.createElement('div');
      sheetInfoEl.id = 'eos-at-sheet-info';
      sheetInfoEl.className = 'eos-hint';
      sheetInfoEl.style.whiteSpace = 'pre-wrap';
      khoi.appendChild(sheetInfoEl);

      logBoxEl = document.createElement('div');
      logBoxEl.id = 'eos-at-log';
      logBoxEl.className = 'eos-log';
      khoi.appendChild(logBoxEl);

      updateSheetUrlCount();
      setPauseButtonLabel();

      // Start: begins a brand-new run (fresh scan of the current order list) if
      // idle, or resumes if currently paused. Always re-fetches the latest data
      // from the Sheet link first (so tracking added since the last run is
      // picked up automatically). Pause: temporarily halts the loop in place —
      // same in-progress list, same position, nothing re-scanned. Stop: cancels
      // the run entirely; the next Start rescans from the top.
      btnStart.addEventListener('click', async () => {
        if (kiemTraScriptCu()) {
          log('⚠️ Còn script Auto Tracking cũ — xoá/tắt nó rồi F5.');
          return;
        }
        if (GM_getValue(RUN_KEY)) {
          if (GM_getValue(PAUSE_KEY)) {
            GM_setValue(PAUSE_KEY, false);
            setPauseButtonLabel();
            log('Tiếp tục.');
          }
          return;
        }
        // RUN_KEY chi bat khi runAll() thuc su bat dau (sau khi tai xong Sheet, mat vai giay) nen
        // bam Start them lan nua TRONG LUC DO van lot qua kiem tra tren -> tai Sheet nhieu lan va
        // chay nhieu vong song song. Dung co rieng de chan ngay tu lan bam dau tien.
        if (dangKhoiDong) {
          log('Đang tải Sheet, đợi chút...');
          return;
        }
        const urlsText = sheetUrlInput ? sheetUrlInput.value : '';
        if (!urlsText.trim()) {
          log('Chưa có link Sheet — dán link vào ô trên.');
          return;
        }
        dangKhoiDong = true;
        capNhatTrangThaiNut();
        try {
          if (!(await loadSheetsFromUrls(urlsText))) {
            return;
          }
          // runAll() chay dong bo toi cho await dau tien va bat RUN_KEY ngay dau ham, nen sau
          // dong nay cac lan bam Start tiep theo se bi chan boi RUN_KEY o tren.
          runAll();
        } finally {
          dangKhoiDong = false;
          capNhatTrangThaiNut();
        }
      });
      pauseBtnEl.addEventListener('click', () => {
        if (!GM_getValue(RUN_KEY)) return; // nothing running to pause
        const nowPaused = !GM_getValue(PAUSE_KEY);
        GM_setValue(PAUSE_KEY, nowPaused);
        setPauseButtonLabel();
        log(nowPaused ? 'Tạm dừng.' : 'Tiếp tục.');
      });
      btnStop.addEventListener('click', () => {
        GM_setValue(RUN_KEY, false);
        GM_setValue(PAUSE_KEY, false);
        setPauseButtonLabel();

        // Wipe the on-page log per earlier request (the Sheet link itself is
        // kept, same as before, so Start doesn't need it re-entered).
        if (logBoxEl) logBoxEl.innerHTML = '';
      });

      log('Sẵn sàng. Dán link Sheet rồi bấm Bắt đầu.');
      return khoi;
    }

    return { buildSection };
  })();

  // CSS dung chung cho ca khoi Order Scraper lan Auto Tracking de nhin dong bo 1 giao dien.
  // Nut dang chay: .eos-busy -> vet sang chay ngang + sang hon (khong doi chu, khong them dong trang thai).
  function chenCssPanel() {
    if (document.getElementById('eos-style')) return;
    const st = document.createElement('style');
    st.id = 'eos-style';
    st.textContent = `
      #etsy-order-scraper-panel, #etsy-order-scraper-panel * { box-sizing:border-box; }
      #etsy-order-scraper-panel .eos-btn {
        position:relative; overflow:hidden; padding:7px 8px; color:#fff; border:none; border-radius:6px;
        font:600 12px/1.3 sans-serif; cursor:pointer; transition:filter .15s, box-shadow .15s; white-space:nowrap;
      }
      #etsy-order-scraper-panel .eos-btn:hover:not(:disabled) { filter:brightness(1.08); }
      #etsy-order-scraper-panel .eos-btn:disabled { opacity:.5; cursor:not-allowed; }
      #etsy-order-scraper-panel .eos-btn.eos-busy:disabled { opacity:1; cursor:progress; }
      #etsy-order-scraper-panel .eos-btn.eos-busy { box-shadow:0 0 0 2px rgba(255,255,255,.9), 0 0 0 4px currentColor; }
      #etsy-order-scraper-panel .eos-btn.eos-busy::after {
        content:''; position:absolute; inset:0; transform:translateX(-100%);
        background:linear-gradient(110deg, transparent 25%, rgba(255,255,255,.45) 50%, transparent 75%);
        animation:eos-sheen 1.1s linear infinite;
      }
      @keyframes eos-sheen { to { transform:translateX(100%); } }
      #etsy-order-scraper-panel .eos-input {
        width:100%; font:12px/1.4 sans-serif; border:1px solid #D1D5DB; border-radius:6px; padding:5px 6px;
        resize:vertical; user-select:text; color:#111;
      }
      #etsy-order-scraper-panel .eos-input:focus { outline:none; border-color:#1a7f37; box-shadow:0 0 0 2px rgba(26,127,55,.2); }
      #etsy-order-scraper-panel .eos-hint { color:#6B7280; font-size:11px; line-height:1.4; }
      #etsy-order-scraper-panel .eos-title { font:700 12px sans-serif; color:#111; }
      #etsy-order-scraper-panel .eos-hint:empty, #etsy-order-scraper-panel .eos-log:empty { display:none; }
      #etsy-order-scraper-panel .eos-log {
        max-height:96px; overflow-y:auto; background:#111827; border-radius:6px; padding:5px 6px;
        font:11px/1.4 ui-monospace, monospace; color:#D1D5DB; user-select:text;
      }
    `;
    document.head.appendChild(st);
  }

  // Bat/tat hieu ung "dang chay" cho 1 nut.
  function datNutDangChay(btn, bat) {
    if (btn) btn.classList.toggle('eos-busy', !!bat);
  }

  function buildPanel() {
    chenCssPanel();
    const trangThai = docTrangThaiPanel();

    // Khung ngoai cung: dinh vi co dinh, keo tha duoc tu do
    const khung = document.createElement('div');
    khung.id = 'etsy-order-scraper-panel';
    khung.style.cssText = `
      position:fixed; z-index:999999; font-family:sans-serif; user-select:none;
      top:90px; right:20px;
    `;
    if (trangThai.left && trangThai.top) {
      khung.style.left = trangThai.left;
      khung.style.top = trangThai.top;
      khung.style.right = 'auto';
    }
    document.body.appendChild(khung);

    // ---- Giao dien THU NHO: 1 bieu tuong hop/thung hang, chu "Order" ----
    const bieuTuongThuNho = document.createElement('div');
    bieuTuongThuNho.id = 'eos-mini';
    bieuTuongThuNho.title = 'Etsy Order Scraper — giữ và kéo để di chuyển, bấm để mở rộng';
    bieuTuongThuNho.style.cssText = `
      display:flex; align-items:center; justify-content:center;
      width:64px; height:64px; border-radius:50%;
      background:linear-gradient(135deg,#1a7f37,#22a745);
      color:#fff; box-shadow:0 4px 14px rgba(0,0,0,.3);
      cursor:grab; flex-direction:column; text-align:center;
    `;
    bieuTuongThuNho.innerHTML = `
      <div style="font-size:20px; line-height:1;">📦</div>
      <div style="font-size:10px; font-weight:bold; letter-spacing:.3px; margin-top:2px;">Order</div>
      <div style="font-size:8px; opacity:.85; margin-top:1px;">v${SCRIPT_VERSION}</div>
    `;
    khung.appendChild(bieuTuongThuNho);

    // ---- Giao dien MO RONG ----
    const khungMoRong = document.createElement('div');
    khungMoRong.id = 'eos-expanded';
    khungMoRong.style.cssText = `
      display:flex; flex-direction:column; width:260px;
      background:#fff; border-radius:10px; overflow:hidden;
      box-shadow:0 6px 20px rgba(0,0,0,.25);
    `;

    const thanhTieuDe = document.createElement('div');
    thanhTieuDe.id = 'eos-header';
    thanhTieuDe.style.cssText = `
      display:flex; align-items:center; justify-content:space-between;
      background:linear-gradient(135deg,#1a7f37,#22a745); color:#fff;
      padding:8px 10px; cursor:grab; font-weight:bold; font-size:13px;
    `;
    thanhTieuDe.innerHTML = `
      <span style="display:flex; align-items:center; gap:5px; min-width:0;">
        <span style="white-space:nowrap;">📦 Order Scraper <small style="font-weight:normal; opacity:.8;">v${SCRIPT_VERSION}</small></span>
        <button id="eos-btn-update" title="Mở link cài đặt để cập nhật lên bản mới nhất trên GitHub" style="
          background:rgba(255,255,255,.25); border:none; color:#fff; white-space:nowrap;
          padding:2px 6px; border-radius:6px; cursor:pointer;
          font-weight:bold; line-height:1.3; font-size:10px;
        ">⟳ Cập nhật</button>
      </span>
      <button id="eos-btn-minimize" title="Thu nhỏ" style="
        background:rgba(255,255,255,.25); border:none; color:#fff;
        width:22px; height:22px; border-radius:6px; cursor:pointer;
        font-weight:bold; line-height:1; font-size:14px; flex:none;
      ">–</button>
    `;
    khungMoRong.appendChild(thanhTieuDe);

    const vungNoiDung = document.createElement('div');
    vungNoiDung.style.cssText = 'padding:10px; display:flex; flex-direction:column; gap:7px; max-height:70vh; overflow-y:auto;';

    // Tao 1 dong gom [checkbox Bat/Tat] + [nut bam], de nguoi dung tu chan bot nut khong
    // muon dung tren account nay - tat thi nut xam di va khong bam duoc, trang thai duoc
    // luu lai qua GM_setValue nen van con sau khi tai lai trang.
    function taoDongNutCoTheBatTat(btn, storageKey) {
      const dong = document.createElement('div');
      dong.style.cssText = 'display:flex; align-items:center; gap:6px;';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.title = 'Bật/Tắt nút này';
      checkbox.style.cssText = 'flex:none; width:16px; height:16px; cursor:pointer;';
      checkbox.checked = GM_getValue(storageKey, true);

      function apDungTrangThai() {
        btn.disabled = !checkbox.checked;
      }
      checkbox.addEventListener('change', () => {
        GM_setValue(storageKey, checkbox.checked);
        apDungTrangThai();
      });
      apDungTrangThai();

      btn.style.flex = '1';
      dong.appendChild(checkbox);
      dong.appendChild(btn);
      return dong;
    }

    btnScanEarnings = document.createElement('button');
    btnScanEarnings.textContent = '🔍 Quét đơn + Earnings → Excel';
    btnScanEarnings.className = 'eos-btn';
    btnScanEarnings.style.background = '#1a7f37';
    btnScanEarnings.onclick = () => scanAndExport(true);
    vungNoiDung.appendChild(taoDongNutCoTheBatTat(btnScanEarnings, ENABLE_SCAN_EARNINGS_KEY));

    btnScanOnly = document.createElement('button');
    btnScanOnly.textContent = '📦 Quét đơn → Excel';
    btnScanOnly.className = 'eos-btn';
    btnScanOnly.style.background = '#2563EB';
    btnScanOnly.onclick = () => scanAndExport(false);
    vungNoiDung.appendChild(taoDongNutCoTheBatTat(btnScanOnly, ENABLE_SCAN_ONLY_KEY));

    idsTextarea = document.createElement('textarea');
    idsTextarea.placeholder = 'Mỗi mã đơn 1 dòng, ví dụ:\n4127701646\n4127701647';
    idsTextarea.className = 'eos-input';
    idsTextarea.style.height = '52px';
    vungNoiDung.appendChild(idsTextarea);

    btnEarningsOnly = document.createElement('button');
    btnEarningsOnly.textContent = '💰 Earnings theo mã đơn → Excel';
    btnEarningsOnly.className = 'eos-btn';
    btnEarningsOnly.style.background = '#F56400';
    btnEarningsOnly.onclick = runEarningsOnlyExport;
    vungNoiDung.appendChild(btnEarningsOnly);

    btnStop = document.createElement('button');
    btnStop.textContent = '⏹ Dừng';
    btnStop.className = 'eos-btn';
    btnStop.style.background = '#DC2626';
    btnStop.style.display = 'none';
    btnStop.onclick = () => {
      cancelRequested = true;
      btnStop.disabled = true;
      btnStop.textContent = '⏳ Đang dừng...';
      hienThongBao('⏳ Đang dừng, vui lòng đợi đến khi xong bước hiện tại...', '#F59E0B');
    };
    vungNoiDung.appendChild(btnStop);

    // ---- Auto Tracking (gop tu script "Etsy Auto Tracking"): chi hien o trang /your/orders/sold ----
    if (/^\/your\/orders\/sold/.test(window.location.pathname)) {
      vungNoiDung.appendChild(AutoTracking.buildSection());
    }

    messageBox = document.createElement('div');
    messageBox.id = 'eos-message';
    messageBox.style.cssText = `
      display:none; color:#fff; font-size:12px; padding:6px 8px;
      border-radius:6px; line-height:1.4; user-select:text;
    `;
    vungNoiDung.appendChild(messageBox);

    // Panel co the dai hon 70% chieu cao man hinh (them khoi Auto Tracking) -> cho cuon doc,
    // dong thoi khong de cac muc ben trong (vd o nhap ma don) bi ep xep lai.
    Array.from(vungNoiDung.children).forEach((c) => { c.style.flexShrink = '0'; });

    khungMoRong.appendChild(vungNoiDung);
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
      // Dam bao panel khong bi trang ra ngoai man hinh sau khi mo rong
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

    // Ap dung trang thai thu nho/mo rong da luu (mac dinh: mo rong)
    if (trangThai.minimized === true) {
      hienThiThuNho();
    } else {
      hienThiMoRong();
    }

    // Keo tha: bieu tuong thu nho keo+bam de mo rong; thanh tieu de khi mo rong chi de keo
    ganKeoTha(bieuTuongThuNho, khung, hienThiMoRong);
    ganKeoTha(thanhTieuDe, khung, null);

    document.getElementById('eos-btn-minimize').onclick = (e) => {
      e.stopPropagation();
      hienThiThuNho();
    };

    // Bam "Cap nhat": mo link cai dat ban moi nhat (Violentmonkey tu bat hop thoai cap nhat).
    // Chan mousedown de bam nut khong bi tinh la bat dau keo panel.
    const nutCapNhat = document.getElementById('eos-btn-update');
    nutCapNhat.addEventListener('mousedown', (e) => e.stopPropagation());
    nutCapNhat.onclick = (e) => {
      e.stopPropagation();
      window.open(UPDATE_URL, '_blank', 'noopener');
      hienThongBao('🔄 Đã mở trang cập nhật — bấm "Cài đặt/Xác nhận" trong hộp thoại Violentmonkey, rồi tải lại trang (F5).', '#2563EB');
    };

  }

  // Chi hien panel tren cac trang thuoc "/your/orders" (vd trang mac dinh cua Etsy la
  // "/your/orders/sold", cac tab loc nhu "Completed" cung doi sang "/your/orders/completed"...).
  // Dung startsWith thay vi khop tuyet doi "/your/orders" vi ban than URL that cua trang don
  // hang KHONG bao gio la "/your/orders" tran trui - luon co them 1 doan nhu "/sold".
  function dangOTrangDonHang() {
    return /^\/your\/orders(\/|$)/.test(window.location.pathname);
  }

  if (dangOTrangDonHang()) {
    buildPanel();
  }
})();
