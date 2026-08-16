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
| 📊 Xem dữ liệu API | In nguyên phản hồi API của listing ra Console (xem mục dưới) |

Giao diện nổi có thể thu nhỏ thành biểu tượng tròn "Listing" và kéo thả tự do; vị trí được nhớ lại qua `localStorage`.

## Lấy tag qua Etsy Open API (v6.1)

Trang listing của Etsy **không chứa tag trong HTML** — Etsy đã bỏ hiển thị tag công khai từ lâu.
Kiểm chứng: không một tag nào của listing xuất hiện trong `outerHTML` của trang. Ba thứ dễ bị
nhầm là tag nhưng không phải:

- `click_queries` trong `Listzilla_ApiSpecs_Tags_Landing` — là **truy vấn tìm kiếm** dẫn tới click,
  không phải tag người bán đặt.
- Khối đó khi tải xong hiển thị "related searches", vẫn không phải tag.
- JSON-LD chỉ có `name`, `description`, `image`, `category`, `brand`, `offers`, `material`.

Tag hiển thị trên màn hình là do tiện ích **HeyEtsy** chèn, nằm trong iframe `heyetsy.com` khác
domain nên userscript không đọc được — đó là lý do bản cũ phải bấm nút Copy rồi đọc clipboard.

Cách chính thống duy nhất là **Etsy Open API v3**:

```
GET https://openapi.etsy.com/v3/application/listings/{listing_id}
Header: x-api-key: <keystring>
```

Đây là endpoint **cấp ứng dụng**: chỉ cần API key, không cần OAuth, không cần đăng nhập, đọc được
listing của bất kỳ shop nào. Giới hạn 10.000 request/ngày. Lấy key tại
https://www.etsy.com/developers/register

Script lấy tag theo thứ tự ưu tiên:

| Ưu tiên | Nguồn | Điều kiện |
|---|---|---|
| 1 | Etsy Open API v3 | Đã nhập API key |
| 2 | Nút "Copy" của HeyEtsy | Chưa có key, hoặc API lỗi/hết quota |

Toast báo rõ nguồn đã dùng, ví dụ `✅ Đã lấy tiêu đề + tag [API Etsy] + cá nhân hoá!`

### Keystring, Shared secret, hay cả hai? (v6.4)

App Etsy cho 2 giá trị: **Keystring** và **Shared secret**. Tài liệu bảo chỉ cần Keystring, nhưng
một số app đòi **cả hai trong cùng một header**, nối bằng dấu hai chấm:

```
x-api-key: <keystring>:<shared secret>
```

Bằng chứng nằm ở chính 2 thông báo lỗi của Etsy khi thử từng giá trị riêng lẻ:

| Gửi | Etsy trả lời | Nghĩa là |
|---|---|---|
| Chỉ Keystring | `Shared secret is required in x-api-key header` | header còn thiếu nửa sau |
| Chỉ Shared secret | `API key not found or not active, or incorrect shared secret for API key` | Etsy đọc nó như một API key nên không tìm thấy |

Không đoán trước được app nào cần dạng nào, nên script lưu cả 2 giá trị rồi **thử lần lượt 4 tổ hợp**
theo thứ tự:

```
Keystring:Shared secret → Keystring → Shared secret → Shared secret:Keystring
```

(tổ hợp cuối phòng khi dán nhầm thứ tự 2 ô). Tổ hợp nào chạy được thì ghi nhớ vào
`etsy_api_uu_tien` để lần sau gọi thẳng — chỉ tốn đúng 1 request.

Console cho biết đang dùng tổ hợp nào: `[Etsy Auto] API OK bằng Keystring:Shared secret`

### Nút 📊 Xem dữ liệu API (v6.5)

Gọi `getListing` cho listing đang mở rồi in **nguyên văn** phản hồi ra Console — để biết tận mắt
app của bạn đọc được những trường nào, thay vì đoán theo tài liệu (Etsy khoá bớt một số trường
tuỳ loại app).

Console in ra 3 thứ:

1. Nguyên đối tượng JSON, bấm mở ra xem từng trường.
2. Bảng tóm tắt các chỉ số hay quan tâm — lượt thích, lượt xem, số lượng còn, số tag, trạng thái, giá.
3. Danh sách **tất cả** tên trường API trả về, sắp xếp A→Z.

Toast tóm tắt ngay trên màn hình: `✅ ❤️ Thích: 15 · 👁️ Xem: 342 — chi tiết xem Console (F12)`

Bảng phân biệt rõ **`0`** với **`(API không trả về)`** — hai thứ này khác hẳn nhau khi cần biết
Etsy có công bố chỉ số đó hay không.

### Lấy được chỉ số gì?

| Chỉ số | API v3 (listing shop khác) | Trên trang HTML |
|---|---|---|
| Lượt thích | ✅ `num_favorers`, số chính xác | ✅ link "15 favorites" |
| Lượt xem | ⚠️ có trường `views` trong schema — dùng nút 📊 để kiểm chứng | ❌ Etsy không hiển thị |
| Lượt bán | ❌ không có trên listing | ⚠️ badge "7+ Sold", đã làm tròn |

Số "Views" mà HeyEtsy hiển thị là **do HeyEtsy tự theo dõi**, không phải số liệu Etsy công bố.

Muốn số bán chính xác chỉ có `getShopReceipts` — cần **OAuth** và chỉ đọc được đơn của chính shop
bạn. Ở cấp shop thì `getShop` (chỉ cần khoá, không cần OAuth) cho `transaction_sold_count`,
`num_favorers`, `review_count`, `review_average`, `listing_active_count`.

### Nhập khoá

Bấm nút **🔑** ở cuối panel → nhập Keystring (bước 1) → nhập Shared secret (bước 2). Có thể để
trống một trong hai. Nhập xong script gọi ngay endpoint `openapi-ping` để kiểm tra và báo kết quả
luôn, không phải đợi tới lúc lấy tag mới biết khoá hỏng.

Nhãn trên nút cho biết đang có khoá hay chưa. Xoá cả hai giá trị là quay về dùng nút Copy.

> ⚠️ **Không bao giờ ghi khoá vào file script.** Repo này public — khoá ghi trong code là ai cũng
> đọc được và dùng hết quota của bạn. Shared secret còn nhạy cảm hơn Keystring. Cả hai được lưu
> bằng `GM_setValue`, tức nằm trong Violentmonkey trên máy bạn, không đi kèm file khi chia sẻ.

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

Script tải theo 3 cách, ưu tiên từ trên xuống — 2 cách đầu gần như miễn nhiễm với adblock
(thứ tự này đã đổi ở bản 5.6, xem mục 4b bên dưới):

| Ưu tiên | Cách tải | Ai thực hiện request? | Bị adblock / popup "download multiple files"? |
|---|---|---|---|
| 1 | `GM_xmlhttpRequest` → Blob → `GM_download` | Tiện ích userscript | Không bị adblock lọc |
| 2 | `GM_download` với **URL gốc** của ảnh | Tiện ích userscript | Không — request không đi qua trang web |
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

---

# Etsy Auto Tracking — Tự động điền tracking từ Merchize

Userscript thứ hai trong repo này, độc lập với script phía trên.

- File script: [`etsy-auto-tracking.user.js`](etsy-auto-tracking.user.js)
- Cài đặt: mở Violentmonkey → **Create a new script** → dán toàn bộ nội dung file → **Save**.

## Chức năng

Tự động hoàn tất các đơn Etsy chưa có tracking bằng cách lấy tracking number + shipping carrier
tương ứng từ 1 trong 2 nguồn — chọn trong panel trên tab Etsy:

- **Merchize (tab)**: lấy trực tiếp từ trang quản lý fulfillment
  [Merchize](https://seller.merchize.com). Cần mở **cả 2 tab cùng lúc**:
  1. Tab Etsy: `Orders → Sold` (`https://www.etsy.com/your/orders/sold*`)
  2. Tab Merchize: danh sách "All orders" — `seller.merchize.com/a/orders`

  Trên tab Merchize có badge "AutoTrack: listening" xác nhận đang lắng nghe. Ở trang này, mã
  tracking không nằm sẵn trong HTML mà chỉ hiện trong tooltip khi hover vào icon ở cột
  **Tracking** (✓ xanh = đã có tracking, ✗ đỏ = chưa có) — script tự giả lập việc hover đó để đọc
  tracking + nhận diện carrier qua domain của link tracking (USPS, DHL eCommerce, UPS, FedEx,
  Canada Post). Carrier từ domain lạ sẽ để trống và bên Etsy sẽ tự chọn "Other".

- **Dán từ Sheet**: khi dùng 1 sheet riêng (VD Google Sheets) để theo dõi tracking. Bôi đen
  **chỉ các dòng dữ liệu** (KHÔNG cần dòng header), Ctrl+C, dán (Ctrl+V) vào ô textarea trong
  panel rồi bấm **Nạp dữ liệu Sheet**. Không cần mở tab Merchize ở chế độ này.

  Vì không có header, script quy ước vị trí cột cố định theo đúng layout của sheet gốc (chỉnh
  hằng số `ORDER_CODE_COLUMN_INDEX` ở đầu file nếu sheet của bạn khác layout):
  - Cột đầu tiên (`ORDER DATE`) — dùng để nhận diện điểm bắt đầu 1 đơn (dạng ngày/tháng/năm,
    VD `5/8/26`), không lấy dữ liệu.
  - Cột thứ 2 = **ORDER CODE**, phải khớp với order id của Etsy.
  - Cột **cuối cùng** của mỗi dòng = **carrier (DVVC)**.
  - Cột **áp chót** = **TRACKING**.

  Nếu 1 ô trong sheet có xuống dòng thủ công (Alt+Enter) — VD tên/địa chỉ bị wrap — khi copy nó
  sẽ tràn xuống nhiều dòng vật lý; script tự nhận biết dòng nào thực sự là "đơn mới" (bắt đầu
  bằng ngày tháng) và tự ghép các dòng còn lại vào đúng đơn đó, không cần bạn chỉnh sửa gì thêm.

  Vì tracking trong sheet cập nhật liên tục, mỗi lần muốn chạy lại chỉ cần copy vùng dữ liệu mới
  nhất rồi dán đè vào ô — **không bắt buộc phải bấm "Nạp dữ liệu Sheet"** nữa: cứ bấm **Start**
  là script tự đọc dữ liệu mới nhất đang có trong ô trước khi chạy. Nút "Nạp dữ liệu Sheet" vẫn
  còn để bạn kiểm tra trước (xem đọc được bao nhiêu đơn) mà chưa cần chạy ngay.

  Ở chế độ này, vòng lặp chạy theo **thứ tự đơn trên trang Etsy** (giống hệt chế độ Merchize):
  quét toàn bộ đơn đang hiển thị trên trang Etsy trước, sau đó với mỗi đơn mới kiểm tra xem có
  khớp mã đơn nào trong dữ liệu Sheet đã nạp hay không — nếu không khớp thì bỏ qua, nếu khớp thì
  lấy tracking + DVVC (đã lấy sẵn khi nạp dữ liệu) để điền và Complete order.

Trên tab Etsy sẽ có panel nổi góc dưới phải với nút **Start / Pause / Stop**. Bấm **Stop** cũng sẽ
xoá nội dung ô dán Sheet và log trong panel.

Panel có thể **thu gọn / xổ ra**: bấm vào dòng tiêu đề (chữ "Etsy Auto Tracking" hoặc "Merchize
AutoTrack") để đóng panel lại chỉ còn thanh tiêu đề, bấm lại để mở ra như cũ. Trạng thái thu gọn
và vị trí kéo thả đều được nhớ qua `localStorage`, giữ nguyên giữa các lần load lại trang. Kéo thả
vẫn hoạt động bình thường (chỉ coi là "bấm" khi con trỏ gần như không di chuyển).

## Logic xử lý (theo từng đơn trên trang Etsy)

1. Dò mã đơn Etsy (order id trong link `?order_id=...`).
2. **Trước khi mở bất kỳ ô nhập nào**, tra cứu mã đơn này theo nguồn dữ liệu đang chọn:
   - *Merchize*: gửi mã đơn sang tab Merchize, tab đó quét các dòng `tr.OrderExtendPackagesRow`
     đang hiển thị, so khớp với `External order number` (`td.OrderCodeCell code`) — không cần gõ
     vào ô tìm kiếm.
   - *Sheet*: tra trực tiếp trong dữ liệu đã dán/nạp, so khớp theo cột `ORDER CODE`.
   - Nếu **không tìm thấy** mã khớp → bỏ qua đơn này hoàn toàn, không đụng vào Update
     progress/Complete order bên Etsy.
   - Nếu **tìm thấy** → có tracking number + tên carrier (VD: `USPS`, `DHL eCommerce`).
3. Chỉ khi có kết quả, tab Etsy mới: bấm **Update progress → Complete order** để mở modal, sau đó:
   - Chọn carrier trong dropdown bằng cách so khớp text (VD: `DHL eCommerce` → chọn `DHL`).
   - Nếu không có carrier tương ứng trong dropdown → chọn **Other** rồi gõ tay tên carrier gốc
     (VD: `USPS` → Other → gõ `USPS`).
   - Điền tracking number.
   - Bấm **Complete order** để hoàn tất.
4. Lặp lại cho từng đơn trên trang Etsy hiện tại. Có thể **Pause** để tạm dừng đúng vị trí đang
   chạy (bấm lại Start để tiếp tục), hoặc **Stop** để huỷ hẳn — lần Start sau sẽ quét lại từ đầu
   danh sách đơn hiện có trên trang.

## Cơ chế giao tiếp giữa 2 tab

Vì Etsy và Merchize là 2 domain khác nhau, script dùng `GM_setValue` / `GM_getValue` /
`GM_addValueChangeListener` (bộ nhớ dùng chung của Violentmonkey cho cùng 1 script, không phụ
thuộc domain) để tab Etsy gửi yêu cầu tra cứu và tab Merchize trả kết quả về — không cần
`GM_xmlhttpRequest` hay mở tab ẩn.

## Ghi chú

- Danh sách carrier trong dropdown "Shipping carrier" khác nhau tuỳ tài khoản Etsy; có thể chỉnh
  `CARRIER_ALIASES` ở đầu file nếu việc so khớp tự động (`matchCarrierOption`) chọn sai carrier.
- Mở Console (F12) để xem log `[AutoTrack]` khi debug — có log riêng ở cả 2 tab.


---

# Etsy Order Scraper + Earnings -> Excel

Userscript riêng cho trang `https://www.etsy.com/your/orders*`.

- File script: [`etsy-order-earnings.user.js`](etsy-order-earnings.user.js)
- Cài đặt: mở Violentmonkey → **Create a new script** → dán toàn bộ nội dung file → **Save**.

Panel nổi có thể thu nhỏ thành biểu tượng tròn "Order" và kéo thả tự do; vị trí được nhớ qua
`GM_setValue`/`GM_getValue`. Có 3 chức năng tách riêng:

| Nút | Việc làm |
|---|---|
| 🔍 Quét đơn + Earnings & tải Excel | Quét toàn bộ đơn đang hiển thị trên trang, sau đó với mỗi mã đơn: **bấm trực tiếp vào mã đơn** để mở bảng order details (không gõ vào ô tìm kiếm), bấm tab Earnings để lấy số tiền, rồi quay lại danh sách cho đơn tiếp theo. Nhờ không dùng ô tìm kiếm nên trang danh sách hiện tại không bị mất, xuất được đầy đủ các đơn còn lại. |
| 📦 Quét đơn & tải Excel | Chỉ quét đơn và xuất Excel ngay, không lấy Earnings (cột `Earnings` để trống) — dùng khi cần xuất nhanh. |
| 💰 Lấy Earnings theo mã đơn & tải Excel | Nhập tay danh sách mã đơn (mỗi dòng 1 mã), script dùng ô tìm kiếm để tra từng mã (giữ nguyên cách làm của bản gốc, vì các mã này có thể không nằm trong danh sách đang hiển thị), xuất file `earnings_result.xlsx` gồm 2 cột Mã đơn + Earnings. Nếu danh sách nhập có **mã đơn trùng nhau**, chỉ lấy Earnings cho lần xuất hiện đầu tiên, các dòng trùng sau đó để trống Earnings (không tra lại). |

So với bản gốc (chỉ quét đơn, không có Earnings):

- Đã bỏ 2 cột `Printing` và `Account`.
- Đã thêm cột `Earnings` ngay bên phải cột `Date Fulfil` (chỉ số tiền, không kèm ký hiệu `$`).
  Nếu 1 đơn có nhiều sản phẩm (ra nhiều dòng), Earnings chỉ được điền vào **dòng đầu tiên**
  của đơn đó, các dòng sau để trống.
- Cột `size` dạng khoảng số (vd size trẻ em `5-6T`, `7-8T`) được đổi dấu `-` thành `/` khi
  xuất Excel (`5-6T` → `5/6T`). Các size khác (`L`, `XL`, `2T`...) giữ nguyên.
- Đơn giao ra **ngoài United States** mà không đọc được số điện thoại thật trên trang sẽ được
  tự động điền 1 số điện thoại ảo (10 chữ số **ngẫu nhiên**, khác nhau cho từng đơn mỗi lần
  chạy) vào cột `phone` — tránh để trống khi in vận đơn.
- Cột `Date Fulfil` được **tự động điền ngày chạy script** theo định dạng `dd/mm/yyyy`.
- File Excel xuất ra (2 chức năng đầu) **không có dòng header**.
- Nếu đơn không có `state` (một số nước ngoài United States không có khái niệm "state"),
  cột `state` sẽ tự điền tạm giá trị `city` thay vì để trống.
- Tên file (`etsy_orders_yyyy-mm-dd.xlsx`) và cột `Date Fulfil` đều tính theo **giờ Việt Nam
  cố định (UTC+7)**, không phụ thuộc múi giờ hệ thống của máy đang chạy script. Nhiều người
  dùng VPS/RDP đặt ở Mỹ để chạy Etsy — nếu tính theo giờ hệ thống của máy đó, ngày xuất ra có
  thể lệch cả nửa ngày so với ngày thực tế ở Việt Nam.

## Không cần bấm sang tab Earnings

Etsy đã render sẵn nội dung của cả 2 tab ("Order details" và "Earnings") ngay trong DOM
từ lúc mở bảng order details, chỉ ẩn/hiện bằng CSS chứ không tải lại khi đổi tab. Vì vậy
script chỉ cần mở bảng order details (bấm vào mã đơn) rồi đọc thẳng dòng "You earned $x.xx"
là đủ, không cần bấm sang tab Earnings nữa — nhanh hơn và ít phụ thuộc vào việc bấm đúng tab.

## Ghi chú trong panel

Panel có thêm 1 ô ghi chú nhỏ (ngay dưới dòng "Đã lưu: N dòng") để bạn tự ghi lại, ví dụ
tài khoản nào cần lấy Earnings, tài khoản nào bỏ qua. Ô này chỉ để tham khảo, không ảnh hưởng
đến logic quét/lấy Earnings, và được lưu lại qua `GM_setValue` nên vẫn còn khi tải lại trang.

## Đóng bảng "Order details" sau mỗi đơn

Bảng "Order details" mà Etsy hiện ra khi bấm vào mã đơn là một **overlay nổi đè lên danh
sách**, không phải điều hướng sang trang khác. Nếu không đóng lại, overlay sẽ giữ nguyên đơn
đầu tiên và mọi lần đọc Earnings sau đó đều ra cùng 1 số tiền (bị điền nhầm cho tất cả các đơn).
Script tự động bấm nút đóng (✕, nút có `<span class="screen-reader-only">Close</span>`) sau khi
đọc xong Earnings của mỗi đơn; nếu không tìm thấy nút thì gửi phím `ESC` để đóng.

## Lỗi "XLSX is not defined"

Script nạp thư viện đọc/ghi Excel (SheetJS) qua `@require` từ CDN. Nếu thấy thông báo đỏ
"Chưa tải được thư viện Excel (XLSX)" (hoặc lỗi Console `XLSX is not defined`), nghĩa là
Violentmonkey chưa tải được file đó — thường do mạng chặn CDN hoặc AdBlock. Cách khắc phục:

1. Tải lại trang (F5) rồi thử lại — nhiều khi chỉ là lỗi mạng tạm thời.
2. Kiểm tra AdBlock/uBlock Origin/tường lửa có đang chặn `cdn.jsdelivr.net` không, cho qua nếu có.
3. Vào Violentmonkey → mở script này → **Save** lại 1 lần để buộc tải lại các tài nguyên `@require`.

Script đã có kiểm tra trước khi chạy: nếu XLSX chưa sẵn sàng sẽ báo lỗi ngay, không để bạn
đợi hết cả quá trình quét/lấy Earnings rồi mới báo lỗi lúc xuất file.

## Nút Dừng

Khi đang chạy bất kỳ chức năng nào (quét + Earnings, hoặc lấy Earnings theo danh sách mã đơn),
panel sẽ hiện thêm nút **"⏹ Dừng"**. Bấm nút này để dừng giữa chừng — script sẽ dừng sau khi xử
lý xong đơn hiện tại, rồi vẫn xuất file Excel với dữ liệu đã lấy được đến thời điểm đó.
