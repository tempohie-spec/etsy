# Công cụ tách nền ảnh thiết kế 2D

Tách nền trắng hoặc đen bằng thuật toán color to alpha (không dùng AI), giữ viền mịn, kết quả PNG nền trong suốt. File lưu ra có hậu tố `_done` (vd `logo.png` thành `logo_done.png`).

```bash
pip install -r requirements.txt
python app.py                                   # giao diện máy tính (cần tkinter)
python remove_bg.py anh.png                     # dòng lệnh, 1 ảnh
python remove_bg.py thu_muc/ ra/ --connected --bridge   # cả lô
```

Bản Windows dựng sẵn: https://github.com/tempohie-spec/etsy/releases/download/bg-remover-latest/BackgroundRemover.exe

## Giao diện
- Kéo thanh trắng để so sánh trước/sau, lăn chuột để zoom, kéo ảnh để di chuyển, bấm đúp để về vừa khung, danh sách ảnh đang mở bên trái: bấm tên ảnh để chọn.
- Khi kéo thanh trượt, bản xem nhanh (thu nhỏ) được tính ở luồng nền nên giao diện không bị đơ, rồi tính đầy đủ khi dừng tay. Ảnh lưu ra luôn ở độ phân giải gốc.
- **Bấm vào một khoảng nền** để đổi giữa xóa và giữ vùng đó (vd khoảng trắng giữa các nhân vật). Các lần bấm cũng được áp dụng khi xử lý cả lô.
- **Nhiều ảnh:** "Chọn ảnh" thêm ảnh vào danh sách và mở ảnh vừa chọn, không làm mất ảnh đang mở. Mỗi ảnh giữ riêng các vùng đã bấm, cấu hình các thanh trượt và lịch sử hoàn tác; ảnh mới kế thừa cấu hình hiện tại. Bấm tên ảnh trong danh sách bên trái để chuyển ảnh (ảnh trùng tên được thêm tên thư mục), bỏ ảnh khỏi danh sách bằng "Đóng ảnh này". "Xử lý cả lô" dùng cấu hình riêng của từng ảnh.
- **Nhập số:** mỗi thanh trượt có ô số bên cạnh: kéo thanh (tự làm tròn theo bước) hoặc gõ số rồi nhấn Enter, hoặc dùng mũi tên của ô. Số vượt giới hạn tự được đưa về giới hạn, gõ sai thì giữ nguyên giá trị cũ.
- **Hoàn tác / Làm lại:** `Ctrl+Z` / `Ctrl+Y` (hoặc nút trên thanh công cụ) cho mọi thao tác: chỉnh thanh trượt, đổi tùy chọn, bấm chọn vùng.
- **Khôi phục ảnh gốc:** xóa toàn bộ vùng đã bấm chọn thủ công của ảnh hiện tại (có hỏi xác nhận, hoàn tác được bằng `Ctrl+Z`).
- **Cấu hình có tên:** lưu các tùy chọn hiện tại thành một cấu hình, chọn lại bất cứ lúc nào, và đặt một cấu hình làm mặc định để tự áp dụng mỗi khi mở ứng dụng. Lưu tại `~/.bg-remover/settings.json` (Windows: `C:\Users\<tên bạn>\.bg-remover\settings.json`).
- **Nền xem trước:** ô caro, đen, trắng, xanh lá, xanh dương, đỏ, xám đậm, xám nhạt. Chỉ để xem, ảnh lưu ra vẫn trong suốt.

## Học từ lựa chọn của bạn
Ứng dụng có thể học cách phân biệt khoảng nền kín (khoảng trắng giữa các nhân vật, vòng trong chữ ký) với ruột trắng của thiết kế (găng tay, viền lông) từ chính các lần bạn bấm chọn vùng.

1. Mở ảnh, bấm vào các khoảng nền cần xóa cho đến khi kết quả đúng ý (bật "Chỉ xóa nền nối với mép ảnh").
2. Bấm **"Học từ ảnh này"**. Kết quả hiện tại được lấy làm đáp án: khoảng nền kín nào đang bị xóa là "nên xóa", các khoảng còn lại là "nên giữ". Vì vậy chỉ học khi ảnh đã đúng, và nhớ bấm hết các khoảng cần xóa trước.
3. Lặp lại với vài ảnh. Cần ít nhất 20 vùng, mỗi loại ít nhất 3 vùng thì mới bắt đầu đề xuất. Càng nhiều ảnh càng tốt; từ 3 ảnh trở lên ứng dụng hiện độ chính xác ước tính (kiểm tra chéo giữa các ảnh).
4. Sau đó bấm **"Đề xuất vùng nền"**, hoặc bật "Tự đề xuất khi mở ảnh" (cũng áp dụng khi xử lý cả lô cho ảnh chưa mở). Vùng được đề xuất xóa như thể bạn đã bấm: bấm lại để đổi, `Ctrl+Z` để hủy.

Mô hình là một rừng ngẫu nhiên nhỏ chạy ngay trên máy (không cần GPU, không gửi dữ liệu đi đâu), học từ đặc trưng của từng vùng: kích thước, hình dạng, màu nét bao quanh, vị trí so với tâm thiết kế... Dữ liệu lưu ở `~/.bg-remover/learned.json`; nút "Xóa dữ liệu đã học" để bắt đầu lại. Học lại cùng một ảnh sẽ thay thế dữ liệu cũ của ảnh đó.

Lưu ý: bấm vào nền ngoài (nối với mép ảnh) không đổi được; nếu nền bị rò hoặc còn sót, hãy chỉnh "Bịt khe hở nét vẽ" hoặc "Độ nhạy".

## Tùy chọn
| Tùy chọn | Dòng lệnh | Tác dụng |
|---|---|---|
| Độ nhạy | `--tolerance` | Tăng nếu còn vệt nền |
| Độ đặc | `--opaque` | Giảm nếu thiết kế có màu nhạt bị trong suốt |
| Làm mịn viền (px) | `--smooth N` | Thêm quầng mềm ra phía ngoài mép để mất răng cưa. Không làm nhạt nét mảnh. Nên thử 1, mức 2 bắt đầu nhòe. Ngoài ra có thể giảm Độ nhạy và tăng Độ đặc để viền mềm hơn |
| Chỉ xóa nền nối với mép ảnh | `--connected` | Giữ phần trắng/đen nằm bên trong thiết kế |
| Xuyên nét mảnh | `--bridge` | Bật sẵn trong ứng dụng. Nền xuyên qua nét mảnh (dây đèn, nét chữ) để xóa luôn các khoảng nền bị chúng chia cắt, nét mảnh vẫn được giữ. Độ dày tự tính theo kích thước ảnh (khoảng 1 px cho mỗi 1000 px cạnh dài). Tắt đi nếu thiết kế có viền nhân vật mảnh bị xuyên qua làm mất phần trắng bên trong |
| Bịt khe hở nét vẽ | `--close-gaps` | Tránh nền rò vào trong thiết kế qua khe hở 1 đến 2 px trong nét vẽ |
| Dùng AI (thử nghiệm) | `--ai` | Dùng mô hình ISNet để đoán khoảng nền kín. Cần `pip install onnxruntime`, lần đầu tải mô hình khoảng 170 MB. Xem lưu ý bên dưới |

Phần viền luôn được làm sạch quầng trắng/đen ở cạnh (không cần bật).

## Lưu ý
- Ở chế độ mặc định (không bật "chỉ xóa nền nối với mép ảnh"), phần thiết kế màu trắng trên nền trắng (hoặc đen trên nền đen) bị tách cùng nền.
- AI chỉ được huấn luyện cho ảnh chụp nên không phân biệt được ruột trắng của nhân vật (găng tay, viền lông) với khoảng nền trắng. Với ảnh minh họa đông nhân vật nó có thể xóa nhầm. Cách nên dùng: "Xuyên nét mảnh", bấm chọn vùng và để ứng dụng học từ lựa chọn của bạn.
