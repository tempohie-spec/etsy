# Etsy Auto — Lấy tiêu đề, tag & tải ảnh full size

Userscript (Violentmonkey / Tampermonkey) cho trang Etsy.

- File script: [`etsy-auto.user.js`](etsy-auto.user.js)
- Cài đặt: mở Violentmonkey → **Create a new script** → dán toàn bộ nội dung file → **Save**.

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

---

# Etsy Auto Tracking — Tự động điền tracking từ Merchize

Userscript thứ hai trong repo này, độc lập với script phía trên.

- File script: [`etsy-auto-tracking.user.js`](etsy-auto-tracking.user.js)
- Cài đặt: mở Violentmonkey → **Create a new script** → dán toàn bộ nội dung file → **Save**.

## Chức năng

Tự động hoàn tất các đơn Etsy chưa có tracking bằng cách lấy tracking number + shipping carrier
tương ứng từ trang quản lý fulfillment [Merchize](https://seller.merchize.com).

Cần mở **cả 2 tab cùng lúc**:

1. Tab Etsy: `Orders → Sold` (`https://www.etsy.com/your/orders/sold*`)
2. Tab Merchize: `seller.merchize.com/a/orders?tab=shipping_status`

Trên tab Etsy sẽ có panel nổi góc dưới phải với nút **Start/Stop**. Trên tab Merchize có badge
"AutoTrack: listening" xác nhận đang lắng nghe.

## Logic xử lý (theo từng đơn trên trang Etsy)

1. Dò mã đơn Etsy (order id trong link `?order_id=...`).
2. **Trước khi mở bất kỳ ô nhập nào**, gửi mã đơn này sang tab Merchize để tra cứu.
3. Tab Merchize quét các dòng `tr.OrderExtendPackagesRow` đang hiển thị trên trang, so khớp với
   `External order number` (`td.OrderCodeCell code`) — không cần gõ vào ô tìm kiếm.
   - Nếu **không tìm thấy** mã khớp → bỏ qua đơn này hoàn toàn, không đụng vào Update
     progress/Complete order bên Etsy.
   - Nếu **tìm thấy** → trả về tracking number + tên carrier (VD: `USPS`, `DHL eCommerce`).
4. Chỉ khi có kết quả, tab Etsy mới: bấm **Update progress → Complete order** để mở modal, sau đó:
   - Chọn carrier trong dropdown bằng cách so khớp text (VD: `DHL eCommerce` → chọn `DHL`).
   - Nếu không có carrier tương ứng trong dropdown → chọn **Other** rồi gõ tay tên carrier gốc
     (VD: `USPS` → Other → gõ `USPS`).
   - Điền tracking number.
   - Bấm **Complete order** để hoàn tất.
5. Lặp lại cho từng đơn trên trang Etsy hiện tại.

## Cơ chế giao tiếp giữa 2 tab

Vì Etsy và Merchize là 2 domain khác nhau, script dùng `GM_setValue` / `GM_getValue` /
`GM_addValueChangeListener` (bộ nhớ dùng chung của Violentmonkey cho cùng 1 script, không phụ
thuộc domain) để tab Etsy gửi yêu cầu tra cứu và tab Merchize trả kết quả về — không cần
`GM_xmlhttpRequest` hay mở tab ẩn.

## Ghi chú

- Danh sách carrier trong dropdown "Shipping carrier" khác nhau tuỳ tài khoản Etsy; có thể chỉnh
  `CARRIER_ALIASES` ở đầu file nếu việc so khớp tự động (`matchCarrierOption`) chọn sai carrier.
- Mở Console (F12) để xem log `[AutoTrack]` khi debug — có log riêng ở cả 2 tab.
