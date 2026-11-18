# Repo conventions for Claude sessions

- After making and pushing any code change in this repo, always reply with the
  GitHub link(s) to the changed file(s) (e.g.
  `https://github.com/tempohie-spec/etsy/blob/<branch>/<file>`), even if the
  user didn't explicitly ask for it. Applies to every session working in this
  repo, not just the one that first set this rule.

- Quy ước đánh số `@version` của `etsy-order-earnings.user.js`: mỗi lần CHỈ sửa bảng quy đổi màu
  (`BI_DANH_MAU`) thì tăng số phụ (vd `3.9` → `3.9.1` → `3.9.2`), không tăng số chính/phụ. Chỉ khi
  có thay đổi chức năng mới tăng `3.10`, `4.0`... Không dùng hậu tố chữ (vd `3.9a`) vì trình quản
  lý script có thể coi là bản cũ hơn và không cập nhật. Vẫn phải tăng `@version` mỗi lần (nếu giữ
  nguyên thì Violentmonkey không nhận bản mới) và ghi chú vào README là "chỉ đổi màu".

- Quy trình merge (người dùng đã cho phép lâu dài): sau mỗi thay đổi, commit + push lên nhánh phiên
  rồi TẠO PR và squash-merge vào `main` luôn, không cần hỏi "có merge không". Sau đó báo link file
  trên `main` và nhắc bấm "⟳ Cập nhật" ở từng shop. Panel hiển thị đầy đủ `@version` (vd `v3.9.1`).
