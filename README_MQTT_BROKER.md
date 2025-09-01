# Hướng dẫn cài đặt Mosquitto MQTT Broker (Windows)

## 1. Cài đặt Mosquitto
- Tải Mosquitto từ trang chính thức: https://mosquitto.org/download/
- Cài đặt vào máy (ví dụ: `C:\Programs\mosquitto` hoặc `D:\Programs\mosquitto`).

## 2. Tạo hoặc chỉnh sửa file cấu hình `mosquitto.conf`
- Đường dẫn ví dụ: `C:\Programs\mosquitto\mosquitto.conf` hoặc `D:\Programs\mosquitto\mosquitto.conf`
- Thêm nội dung sau vào file:

```
listener 1883
protocol mqtt

listener 8080
protocol websockets

allow_anonymous true
```

## 3. Khởi động Mosquitto với file cấu hình
- Mở PowerShell hoặc Command Prompt.
- Chạy lệnh sau:

```
mosquitto -v -c "C:\Programs\mosquitto\mosquitto.conf"
```

hoặc nếu cài ở ổ D:
```
mosquitto -v -c "D:\Programs\mosquitto\mosquitto.conf"
```

## 4. Kiểm tra kết nối
- Đảm bảo các thiết bị (ESP32, web) cùng mạng LAN với máy chạy Mosquitto.
- Địa chỉ broker dùng IP của máy tính chạy Mosquitto.
- Web dùng địa chỉ WebSocket: `ws://<IP máy tính>:8080/mqtt`
- ESP32 dùng địa chỉ TCP: `<IP máy tính>` và port `1883`

## 5. Lưu ý
- Nếu cần bảo mật, hãy cấu hình thêm user/password cho Mosquitto.
- Nếu gặp lỗi, kiểm tra lại đường dẫn file cấu hình và quyền truy cập.
