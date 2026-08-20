# Etsy Auto — Lấy tiêu đề, tag & tải ảnh full size

Userscript (Violentmonkey / Tampermonkey) cho trang Etsy.

- File script: [`etsy-auto.user.js`](etsy-auto.user.js)
- Cài đặt: mở Violentmonkey → **Create a new script** → dán toàn bộ nội dung file → **Save**.

## Chức năng

| Nút / Phím tắt | Việc làm |
|---|---|
| `Alt + G` | Lấy tiêu đề + tag + ô cá nhân hoá vào Clipboard **và** tải toàn bộ ảnh full size của listing |
| `Alt + C` | Chỉ lấy tiêu đề + tag + ô cá nhân hoá (không tải ảnh) |
| `Alt + V` | Dán tiêu đề + tag, tạo ô cá nhân hoá, bấm tab **Photo & Video**, rồi **tự upload luôn ảnh** của listing nguồn (xem mục dưới) — không còn nút/phím tắt upload riêng |
| 📐 Ảnh bảng size | Quản lý danh sách ảnh bảng size của riêng bạn, tự thêm vào **sau cùng** mỗi lần upload (xem mục dưới) |

Giao diện nổi có thể thu nhỏ thành biểu tượng tròn "Listing" và kéo thả tự do; vị trí được nhớ lại
qua `localStorage`. Số phiên bản hiện ngay trên card, kể cả khi thu nhỏ.

**Chỉ hiện trên 3 dạng trang** (trang khác trên etsy.com — trang chủ, giỏ hàng, tin nhắn... — script
không làm gì cả):
- `www.etsy.com/search` — trang tìm kiếm/lưới sản phẩm
- `www.etsy.com/listing/...` — trang chi tiết 1 listing (nguồn cho `Alt+G`/`Alt+C`)
- `www.etsy.com/your/shops/me/listing-editor` — trang tạo/sửa listing (đích cho `Alt+V`)

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
listing của bất kỳ shop nào. Giới hạn thực tế: **5 QPS** và **5.000 request/ngày**. Lấy key tại
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

### Nút 📊 Xem dữ liệu API (v6.5, xoá ở v8.1)

Từng gọi `getListing` cho listing đang mở rồi in nguyên văn phản hồi ra Console, để biết tận mắt
app đọc được những trường nào (Etsy khoá bớt một số trường tuỳ loại app). Đây là công cụ debug lúc
làm rõ khả năng của API (mục trên) — sau khi đã xác định xong bộ trường khả dụng, nút này không còn
tác dụng gì trong vận hành hàng ngày nên đã bỏ khỏi giao diện để panel gọn hơn.

Bảng phân biệt rõ **`0`** với **`(API không trả về)`** — hai thứ này khác hẳn nhau khi cần biết
Etsy có công bố chỉ số đó hay không.

### Lấy được chỉ số gì? (đã kiểm chứng thực tế)

| Chỉ số | Nguồn | Kết quả |
|---|---|---|
| 👁️ **Lượt xem listing** | API — `views` | ✅ **Có**, số thật |
| ❤️ **Lượt thích listing** | API — `num_favorers` | ✅ **Có**, số chính xác |
| 🛒 **Lượt bán listing** | — | ❌ **Không có ở bất kỳ đâu** |
| 🏪 Tổng đơn của shop | API — `shop.transaction_sold_count` | ✅ Có |
| 🏪 Người theo dõi shop | API — `shop.num_favorers` | ✅ Có |
| 🏪 Đánh giá shop | API — `shop.review_average` / `review_count` | ✅ Có |
| 🏪 Số listing đang bán | API — `shop.listing_active_count` | ✅ Có |

Phản hồi `getListing` kèm sẵn object `shop`, nên các chỉ số cấp shop lấy được **trong cùng một
request**, không cần gọi `getShop` riêng.

**Về lượt bán của từng listing:** Etsy không có trường này — không trong API, không trong HTML
trang, và **không có trường ẩn nào**. Đường duy nhất cho số chính xác là `getShopReceipts` rồi tự
đếm, mà nó cần **OAuth** và chỉ đọc được đơn của **chính shop bạn**.

### HeyEtsy ước lượng lượt bán bằng cách nào?

Không phải bằng trường ẩn — họ **không đọc được gì hơn**. Cách làm là chụp dữ liệu theo thời gian
rồi lấy hiệu số:

| Trường | Theo dõi qua thời gian cho ra |
|---|---|
| `quantity` | Giảm bao nhiêu = bán bấy nhiêu (999 → 996 tức bán 3 cái) |
| `views` | Chênh lệch = lượt xem/ngày → chính là "Views 7 (Avg)" của HeyEtsy |
| `shop.transaction_sold_count` | Chênh lệch = số đơn cả shop trong kỳ |
| `num_favorers` | Tốc độ tăng lượt thích |

Họ có server quét hàng loạt listing liên tục và tích luỹ nhiều tháng. Badge "7+ Sold" là suy ra từ
đó, không phải số Etsy công bố.

Điểm yếu của cách này: nếu người bán nạp thêm hàng (`quantity` tăng trở lại) thì phép trừ sai, nên
con số chỉ là ước lượng.

### Card thống kê tự hiện (v6.8)

Mở bất kỳ trang listing nào, một card tím tự hiện ở góc trái — kéo thả được, vị trí được nhớ:

```
┌──────────────────────────────┐
│ 📊 Thống kê listing        × │
├──────────────────────────────┤
│ 👁️ Lượt xem     397  14.2/ngày│
│ ❤️ Yêu thích     27  6.8% xem │
│ 📝 Review         7  đơn thật │
│ 🛒 Ước tính bán  24 – 70      │
│                720–2.099 USD  │
│ 📅 Tạo lúc  17/07/2026 28 ngày│
│ 🔄 Sửa lúc  11/08/2026  6 ngày│
│ 📦 Còn lại      999  29.99 USD│
└──────────────────────────────┘
```

Các chỉ số suy ra:

| Chỉ số | Công thức |
|---|---|
| Lượt xem/ngày | `views ÷ số ngày kể từ khi tạo` |
| % yêu thích | `num_favorers ÷ views × 100` |
| Ước tính bán | `review ÷ 0.30` đến `review ÷ 0.10` |
| Ước tính doanh thu | khoảng lượt bán × giá |

**Vì sao là một khoảng chứ không phải một số?** Thực tế chỉ 10–30% người mua để lại đánh giá, và
tỷ lệ đó thay đổi theo ngành hàng, theo shop. Quy về một số duy nhất sẽ tạo cảm giác chính xác giả
tạo. 7 review nghĩa là "gần như chắc chắn đã bán trong khoảng 24–70 cái", không phải "đã bán 35".

Listing chưa có review nào thì ghi `chưa đủ dữ liệu` thay vì đoán bừa.

Nút **📊 Tự hiện: BẬT/TẮT** trong panel để tắt hẳn nếu không muốn tốn quota (mỗi lần mở listing
tốn 2 request: 1 cho listing, 1 cho review). Nút **📊 Thống kê listing** để gọi lại thủ công.

Lần tự chạy không bung toast đỏ khi chưa nhập khoá hoặc API tạm lỗi — vì bạn đâu có chủ động yêu
cầu gì; lỗi chỉ ghi vào Console.

### Thẻ mini trên lưới sản phẩm (v6.9)

Mọi trang có lưới listing — tìm kiếm, shop, danh mục, gợi ý cuối trang listing — đều được gắn thẻ
tím nhỏ vào **từng sản phẩm**:

```
👁️ 397        14.2/ngày
❤️ 27              6.8%
📅 28 ngày   🔄 6 ngày
🛒 rê chuột để ước tính bán
```

Rê chuột giữ **0,4 giây** vào thẻ thì dòng cuối mới gọi API và đổi thành:

```
🛒 24 – 70 (7 review) · 720–2.099 USD
```

**Chi phí request** — đã đo bằng mô phỏng:

| Tình huống | Request |
|---|---|
| Trang tìm kiếm 48 sản phẩm | **1** |
| Mở lại đúng trang đó | **0** (cache 24h) |
| Trang sau, trùng 24 sản phẩm | **1** (chỉ gọi 24 id mới) |
| Trang 250 sản phẩm | **3** (chia lô 100) |
| Lướt 50 trang tìm kiếm | ~50 = **1%** quota ngày |

Ba cơ chế giữ chi phí thấp:

1. **Endpoint gộp** `listings/batch?listing_ids=...` nhận tối đa 100 id trong 1 request — 48 sản
   phẩm tốn đúng 1 request thay vì 48.
2. **Bộ nhớ đệm 24 giờ** theo `listing_id`, lưu bằng `GM_setValue`. Cuộn qua cuộn lại, quay về
   trang trước, mở lại listing đã xem đều không gọi lại API. Mục quá hạn tự bị dọn.
3. **Ước tính bán chỉ gọi khi rê chuột.** Endpoint review không gộp được (mỗi listing 1 request),
   nên chỉ trả tiền cho sản phẩm bạn thực sự quan tâm. Kết quả cũng được cache.

Etsy nạp thêm thẻ khi cuộn hoặc chuyển trang bằng AJAX, nên script dùng `MutationObserver` để gắn
tiếp — gom thay đổi lại rồi quét một lần sau 600ms, không gọi API liên tục.

Nếu một lô thất bại thì dừng luôn các lô sau, tránh nướng quota vào lỗi lặp lại.

Nút **📊 Tự hiện: BẬT/TẮT** điều khiển cả card lớn lẫn thẻ mini.

## Tự giới hạn theo hạn mức Etsy — 5 QPS / 5.000 ngày (v7.0)

Hạn mức thật của Etsy là **5 request/giây** và **5.000 request/ngày**.

**Vì sao phải tự giới hạn thay vì cứ gọi rồi để Etsy chặn:** vượt 5 QPS thì Etsy trả `429`,
request đó **mất không** — vẫn tính vào hạn mức ngày mà không lấy được dữ liệu gì. Càng gọi dồn
càng lãng phí.

**Rủi ro lớn nhất là nhiều tab.** Mở 5 tab Etsy cùng lúc thì mỗi tab tự bắn request của nó, cộng
lại vượt 5 QPS ngay. Nên mốc thời gian gọi cuối và bộ đếm ngày đều lưu bằng `GM_setValue` — đây là
kho dùng chung giữa mọi tab của cùng một script, nên các tab **tự điều phối lẫn nhau**.

Cách làm:

| Cơ chế | Chi tiết |
|---|---|
| Hàng đợi | Mọi request xếp hàng chạy lần lượt, cách nhau ≥ 250ms (4 QPS, chừa biên an toàn) |
| Bộ đếm ngày | Đủ 5.000 thì chặn tại chỗ, không gửi đi nữa |
| Gặp 429 | Chờ 3 giây rồi thử lại đúng 1 lần |
| Lỗi | Không làm đứt hàng đợi — request sau vẫn chạy |

Đã kiểm chứng bằng mô phỏng 20 request bắn đồng thời:

```
20 request đồng thời → xong trong 4.8s
Nhiều nhất trong 1 giây bất kỳ: 4 request (giới hạn Etsy: 5) → ✅ KHÔNG vi phạm
```

Panel có đồng hồ hạn mức, đổi màu khi sắp hết:

```
API hôm nay: 127/5.000 · còn 4.873
```

### Số review — cận dưới chắc chắn của lượt bán

Mỗi review ứng với một đơn hàng thật, nên số review là **cận dưới** đáng tin của lượt bán (thực tế
chỉ khoảng 10–30% người mua để lại đánh giá). Nút 📊 gọi thêm:

```
GET /v3/application/listings/{listing_id}/reviews?limit=1   →   { count: N, results: [...] }
```

`limit=1` để payload nhỏ, chỉ cần lấy `count`. Endpoint này thất bại thì bỏ qua, không làm hỏng
phần còn lại của nút.

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

### Tự bỏ qua ảnh bảng size khi tải xuống (v8.2)

Cùng điều kiện nhận diện `laAnhBangSize()` dùng để tự bỏ tick sẵn ở bảng chọn ảnh upload (mục dưới)
giờ áp dụng luôn cho `Alt+G` (tải ảnh xuống máy): ảnh có `alt` khớp `size chart`, `sizing chart`,
`size guide`, `sizing guide`, `measurement`, hoặc từ `chart` đứng riêng — bị **loại thẳng khỏi danh
sách tải**, không tạo ra file trên máy. Khác với bảng chọn ảnh upload (chỉ bỏ tick, người dùng tick
lại được), tải xuống không có bước chọn lại nên loại hẳn thay vì để tuỳ chọn.

Toast báo rõ đã bỏ qua bao nhiêu ảnh: `⏳ Đang tải 5 ảnh (từng file riêng) (đã bỏ qua 2 ảnh bảng
size)...`. Ở chế độ dự phòng (quét cả trang, không có `alt` theo từng ảnh) thì không lọc được gì —
việc lọc chỉ có tác dụng khi tìm thấy khối carousel.

## Tự upload ảnh nguồn lên trang chỉnh sửa — gộp vào `Alt + V` (v7.4, gộp ở v8.1)

Thay vì tải 10 file xuống máy rồi mở hộp thoại chọn file của hệ điều hành, script giữ luôn danh sách
ảnh của listing nguồn và tự đẩy vào ô upload của Etsy.

**Chi phí: 0 request API Etsy.** Ảnh lấy thẳng từ CDN `i.etsystatic.com` bằng `GM_xmlhttpRequest`,
không đụng tới hạn mức 5 QPS / 5.000 request mỗi ngày. Chỉ tốn băng thông tải ảnh.

### Luồng chạy

1. **Trang nguồn** — `Alt+G` *hoặc* `Alt+C` đều đóng danh sách ảnh vào **gói Clipboard**, cùng chỗ với
   tiêu đề và tag (xem mục dưới). Không cần lưu file xuống đĩa.
2. **Trang chỉnh sửa** — `Alt+V` dán tiêu đề/tag/cá nhân hoá, bấm tab *Photos & video*, rồi
   (nếu gói Clipboard có ảnh) **tự mở luôn** bảng chọn ảnh có thumbnail (dùng `il_180x135` cho nhẹ,
   không tải ảnh gốc vài MB) — không cần bấm gì thêm.
3. Ảnh nghi là **bảng size** bị **bỏ tick sẵn** — nhận diện qua `alt`:
   `size chart`, `sizing chart`, `size guide`, `sizing guide`, `measurement`, hoặc từ `chart` đứng
   riêng (`\bchart\b`, nên `Charter` không bị dính). Đây chỉ là gợi ý — tick lại được.
4. Bảng chọn tự chặn khi tổng số ảnh vượt chỗ trống còn lại (nút *Bắt đầu upload* mờ đi).
5. Script tải bytes ảnh sản phẩm **trước** (song song, xem mục dưới), rồi tới ảnh trong **thư viện
   ảnh bảng size** của bạn nếu có (mục ngay dưới đây) → tạo `File` cho từng ảnh, ghép **đúng thứ tự
   sản phẩm trước – bảng size sau** → nhồi vào `<input type="file">` bằng `DataTransfer` rồi bắn
   `input` + `change`. Trình duyệt coi đây y hệt như vừa chọn file bằng tay.
6. Chờ Etsy xử lý xong (tối đa 180s). Ảnh mới nằm ở **cuối** lưới — script **không tự đưa lên đầu
   được** (xem mục dưới), nên nếu listing đã có sẵn ảnh, bạn cần tự kéo tay trước khi lưu.
7. Nếu listing đang **trống ảnh** (`soAnhCu = 0`, ảnh mới nghiễm nhiên đã ở đúng vị trí đầu — kể cả
   ảnh bảng size ở cuối cùng), có thêm tuỳ chọn: **dừng lại** (mặc định), bấm hộ **Save as draft**,
   hoặc bấm hộ **Publish**. Chọn *Publish* phải xác nhận thêm một lần vì đây là thao tác đưa listing
   ra ngoài, khó lùi lại. Khi listing đã có ảnh sẵn, bảng chọn chỉ cho *dừng lại* — tự động lưu/đăng
   lúc ảnh còn sai thứ tự không có ý nghĩa gì.

### Thư viện ảnh bảng size của riêng bạn — nút 📐 (v9.0)

Vì bước "đưa ảnh mới lên đầu" không tự động hoá được (xem mục dưới), cách duy nhất để ảnh bảng size
luôn nằm **đúng ở cuối** lưới mà không cần kéo tay là: xoá hết ảnh bảng size cũ trong listing đích
trước (đưa `soAnhCu` về càng gần 0 càng tốt, lý tưởng là đúng 0), rồi để script nhồi ảnh theo
**đúng thứ tự mong muốn ngay từ đầu** — không cần sắp xếp lại sau đó nữa.

Nút **📐 Ảnh bảng size (N)** trên panel mở bảng quản lý một danh sách URL ảnh **dùng chung cho mọi
lần upload sau này** (không gắn với 1 listing cụ thể):

- Dán link ảnh vào ô, bấm **Thêm** (hoặc Enter). Ảnh hiện thumbnail ngay để kiểm tra link đúng.
- Nút **↑ / ↓** đổi thứ tự, **✕** xoá — mọi thay đổi lưu ngay lập tức (`GM_setValue`), không cần bấm
  "Lưu" riêng.
- Cố tình dùng nút Lên/Xuống thay vì kéo-thả: đây là bài học từ chính bước sắp xếp lưới ảnh chính —
  kéo-thả cần giả lập sự kiện mà trình duyệt chặn (xem mục "KHÔNG tự động hoá được" bên dưới); nút
  Lên/Xuống là thao tác bấm chuột thật của người dùng nên không dính giới hạn đó.

Khi `Alt+V` có ảnh để upload: nếu thư viện đang có N ảnh, script trừ luôn N khỏi số chỗ còn lại
**trước khi** cho bạn chọn ảnh sản phẩm (báo rõ trong bảng chọn), rồi tự tải + nhồi N ảnh đó vào
**sau cùng** ảnh sản phẩm bạn chọn, đúng thứ tự đã sắp trong thư viện. Nếu chỗ trống trên listing
còn ít hơn số ảnh trong thư viện, script báo lỗi ngay từ đầu thay vì để bạn chọn ảnh sản phẩm rồi
mới phát hiện không đủ chỗ.

### `@connect *` gây treo TOÀN BỘ request, kể cả tới `i.etsystatic.com` — đã rút lại (v9.2)

Bản v9.0 từng thêm `@connect *` vào header để ảnh trong thư viện không bị giới hạn phải lấy từ
`i.etsystatic.com`. Ngay lần thử tiếp theo, **toàn bộ** request `GM_xmlhttpRequest` — kể cả tới
`i.etsystatic.com` vốn đã chạy ổn định qua rất nhiều phiên bản trước — treo đúng 20s rồi báo lỗi
`GM_xmlhttpRequest không phản hồi sau 20s`, không sót ảnh nào. Đổi `@connect` là thay đổi PHẠM VI
QUYỀN của script; nhiều khả năng trình quản lý userscript coi đây là thay đổi cần xác nhận lại và
chặn ngầm mọi request cho tới khi được duyệt — chặn ngầm (không gọi lại `onerror`) khớp chính xác
với kiểu "treo rồi timeout" quan sát được, thay vì báo lỗi ngay.

Vì lúc đó thư viện ảnh bảng size còn chưa dùng domain nào ngoài Etsy, cách sửa an toàn nhất là
**rút hẳn `@connect *`**, chỉ giữ lại đúng 2 domain đã dùng ổn định từ đầu
(`i.etsystatic.com`, `openapi.etsy.com`) — loại bỏ hoàn toàn nghi vấn thay vì để người dùng tự dò
trong cài đặt quyền của extension.

**Cập nhật:** sau khi rút `@connect *`, lỗi **vẫn tái diễn y hệt** ở lần thử kế tiếp — nên giả
thuyết "đổi quyền cần duyệt lại" chỉ là một phần, không phải toàn bộ nguyên nhân. Bằng chứng quan
trọng: đây không phải lỗi Etsy *từ chối* request (không có mã trạng thái HTTP nào cả — `onload`,
`onerror` đều không được gọi), mà là **im lặng hoàn toàn** trong đúng 20 giây (`THOI_HAN_MOI_CACH_TAI`),
nhiều khả năng là bị chặn ngầm ở tầng mạng/tiện ích khi gọi liên tiếp quá nhiều request tới cùng
1 CDN trong thời gian ngắn — đúng như ghi chú đã có sẵn từ trước ở `taiMotAnhVoiRetry()` (viết cho
luồng tải xuống, hoá ra áp dụng luôn cho luồng upload). Việc debug dồn dập trong ngày lặp đi lặp lại
trên cùng vài listing rất có thể là nguyên nhân trực tiếp kích hoạt chặn ngầm này.

### Giảm tải để né bị chặn ngầm (v9.3) — hoá ra không cần, trả lại tốc độ cũ (v9.4)

v9.3 từng đưa ra 2 thay đổi phòng vệ dựa trên giả thuyết "bị chặn ngầm do gọi request dồn dập tới
cùng 1 CDN":

- `DO_SONG_SONG_TAI_ANH` giảm từ 4 xuống 2.
- Thời gian đợi giữa các lần thử lại trong `taiMotAnhVoiRetry()` đổi từ cố định 800ms thành tăng
  dần (800ms, rồi 3200ms).

Chẩn đoán ngay sau đó (dán thẳng URL ảnh đang lỗi vào một tab trình duyệt bình thường, không qua
script) cho kết quả: **ảnh tải được bình thường** — tức là không phải CDN/tiện ích chặn ngầm gì cả,
mà đơn giản là mạng của người dùng chậm/chập chờn đúng lúc test. Giả thuyết "chặn ngầm do gọi dồn
dập" bị loại bỏ.

Vì `DO_SONG_SONG_TAI_ANH = 2` không giải quyết được vấn đề gì có thật, mà lại làm **mọi lần upload**
(kể cả khi mạng hoàn toàn ổn định) chậm hơn khoảng 60–70% so với 4 luồng — số "đợt" tải xấp xỉ
`⌈N/độ_song_song⌉`, nên giảm một nửa độ song song gần như tăng gấp đôi số đợt — v9.4 **trả lại 4**.
Phần tăng dần thời gian chờ giữa các lần thử lại (800ms → 3200ms) thì **giữ nguyên**: đoạn code đó
chỉ chạy khi có lỗi/timeout thật, không đụng tới khi mạng ổn định, nên không có lý do bỏ.

Bài học chung: khi gặp lỗi im lặng 20s (không có mã lỗi HTTP, không phải `onerror`), cách chẩn đoán
nhanh và đáng tin nhất vẫn là dán thẳng URL vào 1 tab trình duyệt bình thường — tải được ở đó thì
vấn đề nằm ở extension/script, không tải được thì là mạng/CDN thật, ngoài tầm kiểm soát của script.

**Hệ quả: thư viện ảnh bảng size giờ chỉ chắc chắn tải được ảnh từ `i.etsystatic.com`.** Dán link
domain khác vào bảng quản lý (nút 📐) vẫn được — chỉ hiện cảnh báo vàng, không chặn — nhưng lúc
upload nhiều khả năng sẽ lỗi tải ảnh đó cho tới khi thêm đúng domain đó vào `@connect` trong header
script (cách an toàn hơn `@connect *`: liệt kê rõ từng domain cần dùng).

### Tải ảnh song song để tăng tốc (v8.3)

Trước v8.3, bước 5 tải **từng ảnh một, tuần tự** — chờ ảnh trước tải xong mới bắt đầu ảnh sau, dù
đây hoàn toàn là việc I/O (chờ mạng) chứ không tốn CPU, có thể chồng lấp được.

`taiCacAnhSongSong()` dùng mô hình hàng đợi (`DO_SONG_SONG_TAI_ANH = 4` luồng): 4 "worker" cùng rút
ảnh tiếp theo từ một con trỏ chung (`chiSoTiepTheo`) và tải song song, ghi kết quả vào đúng ô theo
**chỉ số gốc** trong mảng kết quả — nên dù ảnh nào tải xong trước (tuỳ tốc độ mạng, không theo thứ
tự yêu cầu), thứ tự cuối cùng vẫn khớp đúng thứ tự đã chọn (quan trọng vì thứ tự này quyết định tên
file `- 01`, `- 02`... và thứ tự ảnh xuất hiện trong lưới sau khi upload). Ảnh lỗi bị bỏ qua
(`.filter(Boolean)`) mà không làm lệch vị trí các ảnh còn lại.

Đã mô phỏng 4 kịch bản trong Node: giữ đúng thứ tự dù hoàn thành lệch nhịp, bỏ đúng ảnh lỗi không
lệch vị trí, độ song song vượt số ảnh vẫn chạy đúng, và đo thời gian thực tế nhanh hơn hẳn so với
chạy tuần tự (xấp xỉ 4 lần với `DO_SONG_SONG_TAI_ANH = 4`).

**Giới hạn tốc độ tổng thể — phần KHÔNG tối ưu được:** sau khi ảnh đã nhồi vào ô upload
(bước 5), bước 6 (chờ Etsy xử lý xong) là **Etsy tự tải ảnh lên máy chủ của họ và tạo ảnh xem
trước** — đây là tốc độ phía server Etsy, script chỉ đứng chờ (`choEtsyXuLyAnh()` kiểm tra mỗi
giây), không có cách nào làm nhanh hơn từ userscript.

### Ảnh đi đường Clipboard, không đi `GM_setValue` (v7.5)

Bản 7.4 lưu danh sách ảnh vào `GM_setValue`. **Sai** khi trang nguồn và trang chỉnh sửa nằm ở
**hai trình duyệt khác nhau** — đúng cách dùng thật: `GM_setValue` là kho riêng của từng trình duyệt,
Chrome ghi thì Edge không bao giờ đọc được. Toast báo "chưa có ảnh nào được nhớ" dù cả hai bên đều
đã cập nhật script.

Clipboard hệ thống là đường duy nhất đi được giữa 2 trình duyệt — cũng chính là lý do cả script này
dùng Clipboard ngay từ đầu. Nên từ 7.5, ảnh đi chung gói với tiêu đề và tag:

```
tiêu đề |||TAGS||| tag [|||PERSO_LABEL||| … ] [|||IMGS||| url|>|1 |;| url|>|0 |;| … ]
```

- Mục `|||IMGS|||` đặt **cuối gói** và được `tachDuLieu()` cắt ra **trước tiên**, để đoạn URL không bị
  nuốt vào hướng dẫn cá nhân hoá hay danh sách lựa chọn.
- Mỗi ảnh chỉ gửi `url` + **cờ 1/0** "nghi là bảng size", không gửi nguyên chữ `alt` — bên nhận chỉ
  cần biết có bỏ tick sẵn hay không, mà `alt` của Etsy có thể dài cả đoạn.
- Mọi mục không khớp `^https://i\.etsystatic\.com/` bị loại, để chuỗi lạ trong Clipboard không lọt
  vào luồng upload.

Đường đi của danh sách ảnh:

1. `Alt+V` nhận gói → **cất ảnh vào kho của trình duyệt đích** *trước khi* Clipboard bị rút gọn lại
   còn mỗi tiêu đề, rồi tự gọi luôn bước upload (`tuUploadAnh()`) bên dưới.
2. Bước upload đọc kho trước; kho trống thì **đọc thẳng Clipboard** — vẫn là lớp phòng hờ hữu ích
   nếu ai đó gọi `tuUploadAnh()` tay qua Console mà chưa từng bấm `Alt+V` ở trình duyệt này.

Gói của bản cũ (không có `|||IMGS|||`) vẫn đọc bình thường.

> ⚠️ Ngược lại thì không: bản 7.4 nhận gói của 7.5 sẽ thấy dấu `|||IMGS|||` lạ và **từ chối dán**
> (đúng theo cơ chế chống lệch phiên bản ở dưới). Phải cập nhật **cả hai** trình duyệt lên 7.5.

### Còn bao nhiêu chỗ cho ảnh? — đọc từ trang, không hard-code

Giới hạn ảnh/listing của Etsy **đã đổi** (trước là 10, nay là 20) nên hard-code số này trong script
sẽ sai âm thầm. `laySoAnhConLai()` đọc thẳng từ trang, theo thứ tự:

1. Ô **"Add photos"** tự ghi `N remaining` — lấy phần tử có `textContent` **ngắn nhất** trong số các
   phần tử khớp cả `add photos` lẫn `N remaining`, để bắt đúng ô đó chứ không dính khối cha to
   đang chứa cả `Add videos … 2 remaining`.
2. Dòng **"Add up to N photos and M videos"** ở đầu mục, trừ đi số ảnh đang có.
   (Chuỗi này *không* khớp bước 1 vì `add up to 20 photos` ≠ `add photos`.)
3. Phao cuối: hằng số `GIOI_HAN_ANH_MAC_DINH = 20`.

Nếu không còn chỗ nào, script báo luôn và không mở bảng chọn.

### Đưa ảnh mới lên đầu — KHÔNG tự động hoá được từ userscript (v7.6 → v8.0)

Đã thử nhiều vòng giả lập bàn phím theo đúng đường điều khiển chính thức mà dnd-kit (thư viện kéo
thả của lưới ảnh Etsy) tự công bố trong khối hướng dẫn trợ năng của nó:

> To pick up a draggable item, press the space bar. While dragging, use the arrow keys to move the
> item. Press space again to drop the item in its new position, or press escape to cancel.

Script tự tạo `KeyboardEvent('keydown'/'keyup')` với `key`/`code`/`keyCode` đúng chuẩn rồi
`dispatchEvent()` vào đúng thẻ ảnh. Qua nhiều bản vá (xác minh bằng chính vùng thông báo ẩn của
dnd-kit — `[id^="DndLiveRegion-"]`, đọc to "Picked up...", "...was moved into position..." cho
trình đọc màn hình — dùng cố định một tay cầm cho cả chuỗi phím, rồi viết lại thuật toán di chuyển
để xử lý đúng lưới nhiều cột thay vì coi là danh sách 1 chiều), kết quả **luôn ổn định giống nhau**:
phím `Space` (nhấc lên) *luôn* kích hoạt được dnd-kit, nhưng **không một phím mũi tên nào** — dù
hướng nào, dù thử bao nhiêu lần — từng khiến ảnh dịch chuyển.

Phép thử quyết định: nhờ người dùng tự tay (không qua script) bấm chọn 1 ảnh, bấm `Space`, bấm phím
mũi tên **thật** trên bàn phím — ảnh nhảy vị trí bình thường. Vậy bản thân tính năng kéo-thả-bằng-
bàn-phím của Etsy hoạt động tốt; chỉ riêng **phím giả lập từ JavaScript là không có tác dụng**.

**Nguyên nhân:** mọi `KeyboardEvent` tạo bằng `new KeyboardEvent(...)` rồi `dispatchEvent()` luôn có
`isTrusted: false` — đây là giới hạn bảo mật **cứng của nền tảng web**, không một API nào (kể cả
`GM_*` của Violentmonkey/Tampermonkey) cho phép script tạo ra sự kiện "đáng tin" như từ bàn phím
thật. Phím `Space` (nhấc lên) đi qua `onKeyDown` của React — React không lọc theo `isTrusted` nên
vẫn gọi được handler. Nhưng bước xử lý tiếp theo khi đang kéo (phím mũi tên) được dnd-kit gắn bằng
`addEventListener()` **trực tiếp vào `document`** — loại listener này rất có thể chủ động bỏ qua mọi
sự kiện `isTrusted: false` để chặn thao túng bằng script, khớp hoàn toàn với kết quả kiểm chứng ở
trên. Vì đây là giới hạn của chính trình duyệt, đổi sang giả lập chuột (`PointerEvent`/`MouseEvent`)
cũng sẽ dính đúng giới hạn này nên không đáng thử.

**Kết luận:** bước "đưa ảnh mới lên đầu" không thể tự động hoá an toàn từ userscript. Từ v8.0, script
chỉ còn tự động phần **upload** (gán `File` vào `<input>` không đi qua sự kiện bàn phím/chuột nên
không dính giới hạn này) — bước sắp xếp để người dùng tự kéo tay, thường chỉ mất vài giây.

### Chọn đúng ô upload

Trang chỉnh sửa có thể có **2** ô `input[type="file"]` (ảnh riêng, video riêng) hoặc **1 ô gộp**
tuỳ trạng thái lưới. Script chấm điểm để chọn đúng ô ảnh: `accept` chứa `video` → −100, chứa
`image`/`jpeg`/`png` → +50, có `multiple` → +20, vùng bao quanh có chữ "photo" → +10, và (mạnh
nhất) `id` của một tổ tiên chứa `image`/`photo` → +200, chứa `video` → −200.

#### Lưới trống đổi hẳn giao diện upload — vá bằng tín hiệu `id`, không dùng `accept`/class (v9.1)

Khi listing **chưa có ảnh nào** (ví dụ sau khi tự xoá hết ảnh bảng size cũ để dùng thư viện ảnh bảng
size ở trên), Etsy gộp khu vực Photo & Video thành **1 ô "Drag and drop files or [+ Upload]" duy
nhất** thay vì lưới + các ô "Add photos"/"Add videos" riêng như lúc đã có ảnh. Lúc này:

- `<input type="file">` **không còn `accept`** — mọi điểm cộng/trừ dựa vào `accept` đều bằng 0.
- Thẻ cha **gần nhất** có class lại mang tên `le-video-multiple-upload-area` — component upload
  dùng chung cho cả 2 loại field, tình cờ giữ tên cũ có chữ "video" **dù đang nằm trong field ảnh**.
  Đây chính là cái bẫy: dò theo class/chữ xung quanh ở tổ tiên gần nhất sẽ hiểu nhầm là ô video.

Sửa bằng cách ưu tiên tín hiệu ổn định hơn: `timTruongChaTheoId()` đi lên tối đa 10 cấp tổ tiên,
tìm phần tử có thuộc tính `id` (không phải class) chứa `image`/`photo` hoặc `video`. Etsy đặt id này
**có chủ đích** cho từng field (ví dụ `id="field-listingImages"`) ở một tổ tiên **xa hơn** — nằm
ngoài phạm vi cái div class gây nhầm lẫn ở trên — nên đi đủ xa sẽ luôn gặp đúng id thật, bỏ qua được
class dùng lại gây nhiễu ở giữa đường.

Đã mô phỏng bằng cây DOM giả trong Node cho 3 tình huống: lưới có sẵn ảnh (2 ô riêng, có `accept`,
cách cũ vẫn đúng), lưới trống chỉ có 1 ô gộp không `accept` với class gây hiểu lầm (đúng tình huống
gặp phải), và trường hợp khó nhất — cả 2 ô đều thiếu `accept` và mang class giống hệt nhau, chỉ phân
biệt được nhờ `id` của tổ tiên xa hơn.

### Tìm ô ảnh trong lưới — đếm sai vì mỗi ảnh nằm trong `<li>` riêng (v7.7)

`layCacTheAnh()` lấy mọi `[aria-roledescription="sortable"]` rồi nhóm lại để không dính các vùng
sortable khác của trang. Bản đầu nhóm theo **cha trực tiếp** (`el.parentElement`) — sai trên thực tế:
Console log ra *"Lưới đang có 1 ảnh"* trong khi ảnh chụp cho thấy rõ ràng nhiều hơn, lặp lại y hệt
trên hai listing khác nhau.

Nguyên nhân: lưới ảnh của Etsy bọc **mỗi ảnh trong một `<li>` riêng**, nên cha trực tiếp của từng thẻ
`sortable` là khác nhau cho từng ảnh — mọi "nhóm" chỉ có đúng 1 phần tử, và hàm tình cờ trả về nhóm
đầu tiên tìm thấy (1 ảnh bất kỳ). Số `soAnhCu` sai kéo theo toàn bộ phép tính "bước sang trái bao
nhiêu lần" ở bước sắp xếp cũng sai theo — đây chính là lý do 7 ảnh Star Wars/Mickey Mouse trước đó
tưởng "sắp xếp mà không chạy" thật ra chạy với dữ liệu sai từ đầu.

Sửa bằng cách nhóm theo **container danh sách gần nhất** thay vì cha trực tiếp — `timChaDanhSach()`
đi lên tối đa 6 cấp tìm `<ul>`/`<ol>`/`[role="list"]`/`[role="grid"]`. Nếu việc gom nhóm vẫn không
chắc chắn (nhóm lớn nhất chưa tới 60% tổng số thẻ tìm được), hàm **bỏ qua bộ lọc và trả về toàn bộ**
thay vì một con số sai lệch — thừa còn hơn thiếu, vì thiếu sẽ phá hỏng cả phép tính giới hạn ảnh lẫn
bước sắp xếp phía sau. Đã mô phỏng bằng cây DOM giả trong Node cho 3 kịch bản: mỗi ảnh 1 `<li>` riêng
(đúng lỗi thực tế), các ảnh chung 1 cha trực tiếp (cách cũ vẫn đúng), và có 1 vùng sortable lạ dính
vào trang (phải bị loại bỏ).

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

### Hai kiểu ô cá nhân hoá (v7.2)

Etsy có 2 kiểu, phải điền theo 2 cách khác hẳn nhau:

| | `text_input` | `dropdown` |
|---|---|---|
| Người mua | Gõ chữ tự do | Chọn sẵn từ danh sách |
| Dấu hiệu ở nguồn | có `[data-instructions]` | có `<select id="perso-dropdown-…">` |
| Mục menu ở đích | **Text box** | **List of options** |
| Ô phải điền | Field title + Instructions | Field title + từng Option (bấm *Add*) |

Nhận diện ưu tiên theo `data-field-type` trên `<li id="perso-field-…">`; không có thuộc tính đó
thì cứ thấy `<select>` là biết kiểu dropdown.

Khi đọc danh sách lựa chọn, dòng `Select an option` bị loại — nó là placeholder
(`value=""`, `disabled`), không phải lựa chọn thật.

Chuỗi Clipboard phân biệt bằng dấu xuất hiện sau `|||PERSO_LABEL|||`:

```
… |||PERSO_LABEL||| Please write the character |||PERSO_INSTR||| Examples: Pikachu…
… |||PERSO_LABEL||| Please choose the design   |||PERSO_OPTS|||  Chip|;|Dale
```

Lựa chọn ngăn nhau bằng `|;|` chứ không phải dấu phẩy, vì bản thân lựa chọn có thể chứa dấu phẩy.
Chuỗi của bản 6.x cũ (chỉ có `PERSO_INSTR`) vẫn đọc được như trước.

**Trang đích** (`Alt+V`): sau khi dán tiêu đề + tag, nếu Clipboard có phần cá nhân hoá thì script:

1. Tìm nút **"+ Add field"** ở mục *Custom options* rồi bấm.
2. Đợi menu xổ ra, chọn **"Text box"** hoặc **"List of options"** tuỳ kiểu. Khớp **chính xác** chữ
   hiển thị để không bắt nhầm các mục *reusable field* phía trên (chúng hay có tên gần giống).
3. Đợi hộp thoại, điền nhãn vào `#field-personalizationQuestions-questionText`, rồi:
   - **Text box** — điền hướng dẫn vào `#field-personalizationQuestions-instructions`
   - **List of options** — gõ từng lựa chọn vào `#field-personalizationQuestions-options` rồi bấm
     *Add*. Etsy tự xoá trắng ô nhập sau mỗi lần thêm thành công, script dùng đúng dấu hiệu đó để
     xác nhận đã thêm được, thay vì chờ mò một khoảng thời gian cố định. Tối đa 30 lựa chọn.
4. Bấm **Done**, rồi mới chuyển sang tab *Photo & Video* như cũ.

Toast báo rõ số lựa chọn đã thêm: `✅ Đã dán tiêu đề + 13 tag + ô cá nhân hoá (2 lựa chọn)`

### Chống lệch phiên bản giữa các trình duyệt (v7.3)

Script dùng Clipboard hệ thống để chuyển dữ liệu giữa các trình duyệt, nên **hai bên có thể chạy
hai phiên bản khác nhau**. Khi bên lấy dữ liệu mới hơn bên dán, bên dán gặp dấu ngăn cách nó chưa
biết và **nuốt cả cụm vào làm giá trị**:

```
Bên lấy (7.2) tạo:  …|||PERSO_LABEL|||Please choose the design|||PERSO_OPTS|||Mickey|;|Minnie
Bên dán (7.1) hiểu: nhãn = "Please choose the design|||PERSO_OPTS|||Micke"   ← nhồi thẳng vào Etsy
```

Kết quả: mở nhầm "Text box" thay vì "List of options", và chuỗi kỹ thuật lọt vào ô Field title của
listing thật.

Từ 7.3, bên dán quét mọi giá trị bằng `/\|\|\|[A-Z_]+\|\|\|/` — bắt được **cả dấu của phiên bản
tương lai chưa tồn tại**. Thấy dấu lạ thì **dừng hẳn, không dán gì cả**, và báo:

```
❌ Clipboard tạo bởi bản script MỚI HƠN bản đang chạy ở trang này (7.3).
   Hãy cập nhật script ở đây rồi lấy lại dữ liệu.
```

Thà không dán còn hơn dán hỏng vào listing thật.

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
