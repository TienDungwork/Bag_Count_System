## Endpoint API

**URL:** `http://<ipAddress>/api/customer/info`  
**Phương thức (Method):** `GET`  
**Định dạng dữ liệu:** `application/json`

**Lưu ý:** `<ipAddress>` thay thế bằng địa chỉ IP thực tế của thiết bị

## Mô tả

API này cung cấp thông tin về đơn hàng **đang hoạt động hiện tại** trên ESP32, bao gồm 7 trường dữ liệu chính mà khách hàng cần theo dõi.

## Cấu trúc dữ liệu trả về (Response)

ESP32 sẽ trả về một đối tượng JSON có cấu trúc như sau:

```json
{
  "orderCode": "ORD001",
  "productGroup": "Bao",
  "productCode": "BAO001",
  "customerName": "Khách hàng A",
  "startTime": "14:30 - 15/12/2024",
  "setMode": "output",
  "location": "Khu vực A"
}
```

## Mô tả chi tiết các trường dữ liệu

| Tên trường | Kiểu dữ liệu | Mô tả | Ví dụ |
|------------|---------------|-------|--------|
| `orderCode` | String | Mã đơn hàng | `"ORD001"` |
| `productGroup` | String | Nhóm sản phẩm | `"Bao"` |
| `productCode` | String | Mã sản phẩm | `"BAO001"` |
| `customerName` | String | Mã khách hàng/ Mã số thuế: | `"Khách hàng A"` |
| `startTime` | String | Thời gian bắt đầu đếm| `"14:30 - 15/12/2024"` |
| `setMode` | String | Loại hình  | `"output"` |
| `location` | String | Địa điểm | `"Hà Nội"` |
