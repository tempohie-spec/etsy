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

4b. **Tải bị đứng ở "Đã tải 1/8..." rồi không nhúc nhích nữa (v5.5+)** — `GM_download` bị treo
   vĩnh viễn, không bao giờ gọi lại `onload`/`onerror`/`ontimeout` cho ảnh tiếp theo. Vài nguyên
   nhân có thể gặp:

   - Chrome bật **"Ask where to save each file before downloading"** (`chrome://settings/downloads`)
     → mỗi lần `GM_download` bật 1 hộp thoại Save As gốc, hộp sau xếp hàng chờ mà không ai bấm.
   - Chrome tạm chặn tải nhiều file tự động — để ý 1 icon nhỏ (chồng file, góc đỏ) xuất hiện ở
     thanh địa chỉ, bấm vào và chọn **Allow**.
   - CDN của Etsy (`i.etsystatic.com`) treo kết nối khi tải trực tiếp bằng `chrome.downloads`
     (khác với tải bằng `GM_xmlhttpRequest` rồi mới lưu — cách này ít khi bị treo hơn).

   **Cách chẩn đoán:** lúc script đang đứng, mở `chrome://downloads` xem mục ảnh đang tải là
   *In progress* (treo thật, do 1 trong các lý do trên) hay hoàn toàn không xuất hiện (script còn
   chưa gửi được request).

   Từ bản 5.5, script tự đặt đồng hồ riêng (`THOI_HAN_MOI_CACH_TAI`, mặc định 20 giây) cho mỗi
   lần gọi `GM_download`, không còn phụ thuộc vào việc `GM_download` có tự báo lại hay không —
   nên vòng lặp không còn bị treo vĩnh viễn nữa, tối đa dừng lại 20s ở 1 bước rồi tự rớt xuống
   cách tiếp theo. Bản 5.6 đổi lại **thứ tự ưu tiên**: mặc định tải theo đúng cách bản gốc 4.8
   đã chạy ổn định (`GM_xmlhttpRequest` lấy dữ liệu → `GM_download` lưu từ blob), chỉ thử
   "`GM_download` tải thẳng từ URL" làm phương án dự phòng nếu cách trên thất bại.

   Bản 5.7 bọc thêm đồng hồ riêng cho chính bước **lấy dữ liệu ảnh** (`GM_xmlhttpRequest`), vì
   trên Edge có trường hợp request bị treo ngay từ bước này (trước cả khi chạm tới `GM_download`)
   — `edge://downloads` không hề có entry nào cho ảnh bị kẹt, chứng tỏ request chưa từng tới được
   trình duyệt. Option `timeout` của `GM_xmlhttpRequest` gặp đúng vấn đề như `GM_download`: chỉ
   tính giờ sau khi request đã bắt đầu, vô dụng nếu nó bị treo trước đó.

4c. **`window.setTimeout` bị vô hiệu hoá trên trang listing (nguyên nhân thật, sửa ở 5.9)**

   Triệu chứng quan sát được trên Edge, với bộ đo nhịp của bản 5.8:

   ```
   [Etsy Auto] Đã lưu ảnh 01 (gm_download_blob): ...
   [Etsy Auto] ⏱ Nhịp 5s   — đang xử lý: nghỉ 700ms trước ảnh kế tiếp
   [Etsy Auto] ⏱ Nhịp 115s — đang xử lý: nghỉ 700ms trước ảnh kế tiếp
   ```

   Nhịp (chạy bằng `setInterval`) vẫn đều đặn, nhưng một lệnh chờ **700 mili-giây**
   (`setTimeout`) kéo dài hơn 115 giây và không bao giờ kết thúc. Nghĩa là trên trang này
   `window.setTimeout` đã bị ghi đè bởi code khác — nhiều khả năng từ một tiện ích mở rộng khác
   chạy cùng lúc — và không bao giờ gọi lại callback, trong khi `setInterval` vẫn nguyên vẹn.

   Điều này giải thích ngược lại mọi triệu chứng trước đó: các lớp timeout thêm ở bản 5.5–5.7
   đều xây trên `setTimeout` nên **chưa từng có cơ hội chạy** — đó là lý do Console im lặng tuyệt
   đối, không có cả log timeout. Toast `⏳ Đã tải x/y ảnh...` không tự ẩn sau 4 giây cũng vì lý do
   này (hàm ẩn toast cũng dùng `setTimeout`) — đây là dấu hiệu nhận biết nhanh nhất bằng mắt.

   **Cách sửa ở bản 5.9:** lấy bản **nguyên gốc** của `setTimeout`/`setInterval` từ một iframe
   cùng nguồn tạo mới (`HEN_GIO`) — iframe có `window` riêng chưa bị ai vá. Ngoài ra hàm `cho()`
   chạy song song 2 cơ chế (`setTimeout` gốc **và** `setInterval` tự kiểm tra đồng hồ), cái nào
   xong trước thì kết thúc, nên kể cả khi `setTimeout` vẫn hỏng thì việc chờ vẫn kết thúc đúng
   hạn. `voiThoiHan()` xây trên chính `cho()` để thừa hưởng cùng độ bền.

   Lúc nạp script, Console in ra nguồn hẹn giờ đang dùng:
   `[Etsy Auto] Đã nạp script phiên bản 6.0 | Nguồn hẹn giờ: iframe (bản gốc)`.
   Nếu thấy `window (có thể đã bị ghi đè)` thì iframe không tạo được, lúc đó lớp `setInterval`
   dự phòng trong `cho()` là thứ giữ cho script không treo.

   Bộ đo nhịp dùng để chẩn đoán lỗi này đã được gỡ ở bản 6.0 sau khi xác nhận chạy ổn. Nếu cần
   dựng lại để soi một sự cố tương tự, xem commit `447d836`.

5. **Violentmonkey** — vào *Settings* của script, kiểm tra `GM_download` và `GM_xmlhttpRequest`
   được cấp quyền, và `i.etsystatic.com` nằm trong danh sách `@connect`.

Mở Console (F12) khi chạy để xem log `[Etsy Auto]`: số ảnh tìm được, danh sách URL full size,
và cách tải nào đã dùng cho từng file (`gm_download_url`, `gm_download_blob`, hay `a_tag`).
