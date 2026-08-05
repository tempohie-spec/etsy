# Etsy Auto — Lấy tiêu đề, tag & tải ảnh full size

Userscript (Violentmonkey / Tampermonkey) cho trang Etsy.

- File script: [`etsy-auto.user.js`](etsy-auto.user.js)
- Cài đặt: mở Violentmonkey → **Create a new script** → dán toàn bộ nội dung file → **Save**.

## Chức năng

| Nút / Phím tắt | Việc làm |
|---|---|
| `Alt + G` | Lấy tiêu đề + tag + ô cá nhân hoá vào Clipboard **và** tải toàn bộ ảnh full size của listing |
| `Alt + C` | Chỉ lấy tiêu đề + tag + ô cá nhân hoá (không tải ảnh) |
| `Alt + V` | Dán tiêu đề + tag, tạo ô cá nhân hoá, rồi tự bấm tab **Photo & Video** |

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

## Ô cá nhân hoá — "Add personalization" (v5.1)

**Trang nguồn** (`Alt+G` / `Alt+C`): script chỉ lấy khi listing **thật sự có** mục *Add personalization*.
Nó tìm khu vực `#enhanced-perso-content` (dự phòng: `[data-appears-component-name="personalization"]`,
`li[id^="perso-field-"]`, `[data-selector="perso-text-field-content"]`), xác nhận bên trong có
`[id^="perso-input-"]` / `[data-instructions]` / `li[id^="perso-field-"]`, rồi mới lấy:

- `[data-label]` → tiêu đề ô cá nhân hoá (dự phòng: thuộc tính `data-label-translation`)
- `[data-instructions]` → phần hướng dẫn, `<br>` được đổi thành xuống dòng thật

Dữ liệu được gộp chung vào Clipboard theo dạng:

```
tiêu đề |||TAGS||| tag |||PERSO_LABEL||| nhãn |||PERSO_INSTR||| hướng dẫn
```

Listing không có cá nhân hoá thì 2 đoạn sau không xuất hiện, và chuỗi vẫn đọc được bởi bản 5.0 cũ.

> **Không dùng `[data-label]` làm selector dự phòng.** Các ô chọn biến thể của listing thường
> (*Style and Size*, *Color*…) cũng dùng `data-label`, nên bắt theo thuộc tính này sẽ tưởng nhầm
> tên biến thể là ô cá nhân hoá trên những listing hoàn toàn không có cá nhân hoá.

**Trang đích** (`Alt+V`): sau khi dán tiêu đề + tag, nếu Clipboard có phần cá nhân hoá thì script:

1. Tìm nút **"+ Add field"** ở mục *Custom options* rồi bấm.
2. Đợi menu xổ ra, chọn mục **"Text box"** trong phần *Create new*.
3. Đợi hộp thoại **"Add text box"**, điền nhãn vào ô `#field-personalizationQuestions-questionText`
   và hướng dẫn vào ô `#field-personalizationQuestions-instructions`.
4. Bấm **Done**, rồi mới chuyển sang tab *Photo & Video* như cũ.

Etsy giới hạn **45 ký tự** cho Field title và **120 ký tự** cho Instructions, nên script tự cắt bớt
cho vừa và ghi cảnh báo ra Console nếu có cắt. Sửa bằng 2 hằng số `GIOI_HAN_NHAN_FIELD`
và `GIOI_HAN_HUONG_DAN_FIELD`.

Lưu ý: nút "Add field" nằm ở tab **Item Options** — nếu tab đó chưa mở thì script báo
"Không tìm thấy nút Add field", mở tab rồi bấm `Alt+V` lại.

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
