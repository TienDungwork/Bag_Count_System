# Hướng dẫn cài đặt Mosquitto MQTT Broker (Windows)

## 1. Cài đặt Mosquitto
- Tải Mosquitto từ trang chính thức: https://mosquitto.org/download/
- Tải mosquitto-2.0.22-install-windows-x64.exe
- Cài đặt vào máy (ví dụ: `C:\Programs\mosquitto`).

## 2. Chỉnh sửa file cấu hình `mosquitto.conf`
- Đường dẫn ví dụ: `C:\Programs\mosquitto\mosquitto.conf`
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