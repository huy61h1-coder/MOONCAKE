# AEON Mooncake 2026

Ứng dụng danh mục, báo giá và đặt bánh Trung Thu dành cho AEON Mooncake 2026.

## Chức năng

- Danh mục sản phẩm, thương hiệu, biến thể và giỏ hàng.
- Giao diện responsive cho desktop và mobile.
- Tùy chỉnh logo, màu sắc, kích thước và nội dung trang chủ.
- Nhập sản phẩm từ Excel/PDF và tải file báo giá Excel/PDF.
- Quản lý khách hàng, đơn hàng và xuất Excel tổng hợp.
- Tạo PDF A4 riêng cho từng đơn hàng.
- Đồng bộ đơn hàng sang Google Sheet qua Apps Script.

## Khởi chạy

Yêu cầu Node.js 20 trở lên.

```bash
npm install
npm start
```

Mở website tại `http://127.0.0.1:8080/` và trang quản trị tại
`http://127.0.0.1:8080/admin.html`.

Để truy cập từ thiết bị khác cùng mạng, dùng địa chỉ IP LAN của máy chạy ứng
dụng, ví dụ `http://192.168.1.64:8080/`.

## Cấu hình

Máy chủ hỗ trợ các biến môi trường:

- `HOST`: địa chỉ lắng nghe, mặc định `0.0.0.0`.
- `PORT`: cổng chạy ứng dụng, mặc định `8080`.
- `ADMIN_USERNAME`: tài khoản đăng nhập trang quản trị, bắt buộc.
- `ADMIN_PASSWORD`: mật khẩu quản trị, bắt buộc.
- `GOOGLE_SHEET_WEB_APP_URL`: URL Web App của Google Apps Script, bắt buộc
  nếu dùng chức năng đồng bộ đơn hàng.

Ví dụ trên PowerShell:

```powershell
$env:ADMIN_USERNAME='ten-quan-tri'
$env:ADMIN_PASSWORD='mat-khau-manh'
$env:GOOGLE_SHEET_WEB_APP_URL='https://script.google.com/macros/s/DEPLOYMENT_ID/exec'
npm start
```

Không ghi các giá trị thật vào mã nguồn hoặc commit tệp `.env`. Sau khi thay
đổi tài khoản/mật khẩu, hãy khởi động lại máy chủ để áp dụng.

Tệp `.aeon-store.seed.json` chỉ chứa danh mục và cấu hình giao diện mẫu. Dữ
liệu khách hàng, đơn hàng và tệp tải lên được lưu cục bộ, đã bị loại khỏi Git
để không xuất hiện trong repository công khai.
