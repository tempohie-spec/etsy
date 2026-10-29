# Cong cu tach nen anh thiet ke 2D

Tach nen trang hoac den bang thuat toan color to alpha (khong dung AI), giu vien mo sach, ket qua PNG nen trong suot. File luu ra co them hau to `_done` (vd `logo.png` thanh `logo_done.png`).

```bash
pip install -r requirements.txt
python app.py                                # giao dien may tinh (can tkinter)
python remove_bg.py anh.png                  # dong lenh, 1 anh
python remove_bg.py thu_muc/ ra/ --connected # ca lo, chi xoa nen noi voi mep anh
```

Giao dien: keo thanh trang de so sanh truoc/sau, lan chuot de zoom, keo anh de di chuyen, bam doi de ve vua khung, nut `<` `>` de chuyen giua cac anh da chon.

Tham so: `--bg auto|white|black`, `--tolerance` (tang neu con vet nen), `--opaque` (giam neu thiet ke co mau nhat bi trong suot), `--connected` (chi xoa nen noi voi mep anh).

Luu y: o che do mac dinh, phan thiet ke mau trang tren nen trang (hoac den tren nen den) bi tach cung nen. Bat `--connected` (o chon "Chi xoa nen noi voi mep anh" trong ung dung) de giu lai phan trang/den ben trong thiet ke; doi lai, cac khoang nen bi bao kin ben trong thiet ke se duoc giu lai.
