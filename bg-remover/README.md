# Cong cu tach nen anh thiet ke 2D

Tach nen trang hoac den bang thuat toan color to alpha (khong dung AI), giu vien mo sach, ket qua PNG nen trong suot. File luu ra co hau to `_done` (vd `logo.png` thanh `logo_done.png`).

```bash
pip install -r requirements.txt
python app.py                                   # giao dien may tinh (can tkinter)
python remove_bg.py anh.png                     # dong lenh, 1 anh
python remove_bg.py thu_muc/ ra/ --connected --bridge 2   # ca lo
```

## Giao dien
Khi keo thanh truot, ung dung ve nhanh bang ban thu nho roi tinh day du khi dung tay (anh luu ra luon o do phan giai goc).

Keo thanh trang de so sanh truoc/sau, lan chuot de zoom, keo anh de di chuyen, bam doi de ve vua khung, nut `<` `>` de chuyen giua cac anh da chon.

**Bam vao mot khoang nen de doi giua xoa va giu vung do** (vd khoang trang giua cac nhan vat). Nut "Hoan tac vung vua bam" de quay lai. Cac lan bam duoc ap dung ca khi xu ly ca lo.

## Tuy chon
| Tuy chon | Dong lenh | Tac dung |
|---|---|---|
| Do nhay | `--tolerance` | Tang neu con vet nen |
| Do dac | `--opaque` | Giam neu thiet ke co mau nhat bi trong suot |
| Chi xoa nen noi voi mep anh | `--connected` | Giu phan trang/den nam ben trong thiet ke |
| Xuyen net manh (px) | `--bridge N` | Nen xuyen qua net manh hon 2N px (day den, net chu) de xoa cac khoang nen bi no chia cat. Anh khoang 2000 px: thu 2. Tang cao se an vao chi tiet trang ben trong |
| Bit khe ho net ve | `--close-gaps` | Tranh nen ro vao trong thiet ke qua khe ho 1 den 2 px trong net ve |
| Tu xoa vung kin lon hon (%) | `--min-pocket X` | Xoa moi khoang nen kin lon hon X% dien tich anh. Co the xoa nham chi tiet trang lon, nen ket hop voi bam chon vung |
| Dung AI (thu nghiem) | `--ai` | Dung mo hinh ISNet de doan khoang nen kin. Can `pip install onnxruntime`, lan dau tai mo hinh khoang 170 MB. Xem luu y ben duoi |

Phan vien luon duoc lam sach quang trang/den o canh (khong can bat).

## Luu y
- O che do mac dinh (khong bat "chi xoa nen noi voi mep anh"), phan thiet ke mau trang tren nen trang (hoac den tren nen den) bi tach cung nen.
- AI chi duoc huan luyen cho anh chup nen khong phan biet duoc ruot trang cua nhan vat (gang tay, vien long) voi khoang nen trang. Voi anh minh hoa dong nhan vat no co the xoa nham, nen mac dinh tat. Cach nen dung: "Xuyen net manh" va bam chon vung.
