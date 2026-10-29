# Cong cu tach nen anh thiet ke 2D

Tach nen trang hoac den bang thuat toan color to alpha (khong dung AI), giu vien mo sach, ket qua PNG nen trong suot.

```bash
pip install -r requirements.txt
python app.py                      # giao dien may tinh (can tkinter)
python remove_bg.py anh.png        # dong lenh, 1 anh
python remove_bg.py thu_muc/ ra/   # xu ly ca lo
```

Tham so: `--bg auto|white|black`, `--tolerance` (tang neu con vet nen), `--opaque` (giam neu thiet ke co mau nhat bi trong suot).
Luu y: phan thiet ke mau trang tren nen trang (hoac mau den tren nen den) se bi tach cung nen.
