# Etsy Auto — Lấy tiêu đề, tag & tải ảnh full size

Userscript (Violentmonkey / Tampermonkey) cho trang Etsy.

- File script: [`etsy-auto.user.js`](etsy-auto.user.js)
- Cài đặt: mở Violentmonkey → **Create a new script** → dán toàn bộ nội dung file → **Save**.

## Etsy Order Scraper + Earnings -> Excel

Userscript riêng cho trang `https://www.etsy.com/your/orders*`.

- File script: [`etsy-order-earnings.user.js`](etsy-order-earnings.user.js)
- Cài đặt: mở Violentmonkey → **Create a new script** → dán toàn bộ nội dung file → **Save**.

Panel nổi có thể thu nhỏ thành biểu tượng tròn "Order" và kéo thả tự do; vị trí được nhớ qua
`GM_setValue`/`GM_getValue`. Có 3 chức năng tách riêng:

| Nút | Việc làm |
|---|---|
| 🔍 Quét đơn + Earnings & tải Excel | Quét toàn bộ đơn đang hiển thị trên trang, sau đó với mỗi mã đơn: **bấm trực tiếp vào mã đơn** để mở bảng order details (không gõ vào ô tìm kiếm), bấm tab Earnings để lấy số tiền, rồi quay lại danh sách cho đơn tiếp theo. Nhờ không dùng ô tìm kiếm nên trang danh sách hiện tại không bị mất, xuất được đầy đủ các đơn còn lại. |
| 📦 Quét đơn & tải Excel | Chỉ quét đơn và xuất Excel ngay, không lấy Earnings (cột `Earnings` để trống) — dùng khi cần xuất nhanh. |
| 💰 Lấy Earnings theo mã đơn & tải Excel | Nhập tay danh sách mã đơn (mỗi dòng 1 mã), script dùng ô tìm kiếm để tra từng mã (giữ nguyên cách làm của bản gốc, vì các mã này có thể không nằm trong danh sách đang hiển thị), xuất file `earnings_result.xlsx` gồm 2 cột Mã đơn + Earnings. |

So với bản gốc (chỉ quét đơn, không có Earnings):

- Đã bỏ 2 cột `Printing` và `Account`.
- Đã thêm cột `Earnings` ngay bên phải cột `Date Fulfil` (chỉ số tiền, không kèm ký hiệu `$`).
  Nếu 1 đơn có nhiều sản phẩm (ra nhiều dòng), Earnings chỉ được điền vào **dòng đầu tiên**
  của đơn đó, các dòng sau để trống.
- Cột `Date Fulfil` được **tự động điền ngày chạy script** theo định dạng `dd/mm/yyyy`.
- File Excel xuất ra (2 chức năng đầu) **không có dòng header**.

### Đóng bảng "Order details" sau mỗi đơn

Bảng "Order details" mà Etsy hiện ra khi bấm vào mã đơn là một **overlay nổi đè lên danh
sách**, không phải điều hướng sang trang khác. Nếu không đóng lại, overlay sẽ giữ nguyên đơn
đầu tiên và mọi lần đọc Earnings sau đó đều ra cùng 1 số tiền (bị điền nhầm cho tất cả các đơn).
Script tự động bấm nút đóng (✕, nút có `<span class="screen-reader-only">Close</span>`) sau khi
đọc xong Earnings của mỗi đơn; nếu không tìm thấy nút thì gửi phím `ESC` để đóng.

### Nút Dừng

Khi đang chạy bất kỳ chức năng nào (quét + Earnings, hoặc lấy Earnings theo danh sách mã đơn),
panel sẽ hiện thêm nút **"⏹ Dừng"**. Bấm nút này để dừng giữa chừng — script sẽ dừng sau khi xử
lý xong đơn hiện tại, rồi vẫn xuất file Excel với dữ liệu đã lấy được đến thời điểm đó.

## Chức năng

| Nút / Phím tắt | Việc làm |
|---|---|
| `Alt + G` | Lấy tiêu đề + tag vào Clipboard **và** tải toàn bộ ảnh full size của listing |
| `Alt + C` | Chỉ lấy tiêu đề + tag (không tải ảnh) |
| `Alt + V` | Dán tiêu đề + tag vào trang chỉnh sửa listing, rồi tự bấm tab **Photo & Video** |

Giao diện nổi có thể thu nhỏ thành biểu tượng tròn "Listing" và kéo thả tự do; vị trí được nhớ lại qua `localStorage`.

## Logic tải ảnh (v5.0)

Trước đây script quét regex trên **toàn bộ HTML của trang**, nên hay dính ảnh không thuộc listing (ảnh gợi ý, ảnh shop khác) và phải "bỏ bớt ảnh cuối" cho hên xui.

Bây giờ:

1. Tìm khối `data-carousel-pagination-list` (danh sách thumbnail của listing) trong DOM.
   - Thử lần lượt `[data-carousel-pagination-list]`, `ul[data-carousel-pagination-list]`,
     `[data-carousel-pagination-list-container]`, `.carousel-pagination-list`.
   - Dự phòng cuối: quét mọi phần tử tìm thuộc tính có tên chứa `carousel-pagination-list`.
2. Trong khối đó, bắt mọi link `https://i.etsystatic.com/.../il_75x75.<id>_xxxx.jpg` — lấy cả từ
   `src`, `data-src`, `srcset`, `style="background-image:url(...)"`.
3. Đổi `75x75` → `fullxfull`, giữ nguyên phần còn lại của URL, loại trùng, giữ đúng thứ tự thumbnail.
4. Tải **từng ảnh một** (không nén zip), tên file: `<tiêu đề listing> - 01.jpg`, `... - 02.jpg`, …

Nếu **không** tìm thấy khối carousel, script quay về chế độ quét cả trang như cũ (có bỏ 1 ảnh cuối,
bật/tắt bằng hằng số `BO_ANH_CUOI_KHI_QUET_CA_TRANG`) và hiện cảnh báo màu vàng.

## Không bị AdBlock / uBlock Origin chặn khi tải nhiều ảnh

Script tải theo 3 cách, ưu tiên từ trên xuống — cách 1 gần như miễn nhiễm với adblock:

| Ưu tiên | Cách tải | Ai thực hiện request? | Bị adblock / popup "download multiple files"? |
|---|---|---|---|
| 1 | `GM_download` với **URL gốc** của ảnh | Tiện ích userscript | Không — request không đi qua trang web |
| 2 | `GM_xmlhttpRequest` → Blob → `GM_download` | Tiện ích userscript | Không bị adblock lọc |
| 3 | Thẻ `<a download>` với Blob URL | Chính trang web | Có thể bị chặn / hiện popup |

Điểm mấu chốt: mọi request đều đi qua tiện ích userscript, **không phải** qua ngữ cảnh trang
`www.etsy.com`, nên bộ lọc của uBlock Origin (vốn chỉ chặn request phát sinh từ trang) không đụng tới.
Vì vậy `@connect i.etsystatic.com` trong header là bắt buộc — đừng xoá.

Nếu vẫn gặp trục trặc, xử lý theo thứ tự:

1. **Chrome / Edge — bật tải nhiều file**
   Bấm ổ khoá 🔒 cạnh thanh địa chỉ → *Site settings* → **Automatic downloads** → **Allow**.
   (Hoặc `chrome://settings/content/automaticDownloads` → thêm `https://www.etsy.com`.)
   Đây mới là thứ hay chặn "tải multi", không phải adblock.

2. **uBlock Origin — cho etsy.com qua**
   Bấm icon uBlock trên tab Etsy → bấm nút nguồn lớn để **tắt trên trang này** (trusted site).
   Hoặc thêm vào *My filters*:
   ```
   @@||i.etsystatic.com^$domain=etsy.com
   ```
   Cũng nên kiểm tra *Settings → Filtering behavior*: nếu bật **"Block media elements larger than …"**
   thì tắt đi, vì ảnh `fullxfull` thường vượt ngưỡng đó.

3. **AdBlock / AdBlock Plus** — thêm `www.etsy.com` vào danh sách website loại trừ (allowlist).

4. **Tải bị mất giữa chừng** — tăng `KHOANG_CACH_GIUA_CAC_LAN_TAI` trong script từ `700` lên
   `1000`–`1500` (ms) để trình duyệt không bóp bớt các bản tải liên tiếp.

5. **Violentmonkey** — vào *Settings* của script, kiểm tra `GM_download` và `GM_xmlhttpRequest`
   được cấp quyền, và `i.etsystatic.com` nằm trong danh sách `@connect`.

Mở Console (F12) khi chạy để xem log `[Etsy Auto]`: số ảnh tìm được, danh sách URL full size,
và cách tải nào đã dùng cho từng file (`gm_download_url`, `gm_download_blob`, hay `a_tag`).
