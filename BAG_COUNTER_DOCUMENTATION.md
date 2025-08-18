# BAG COUNTER SYSTEM - API & MQTT DOCUMENTATION

## HỆ THỐNG TỔNG QUAN

### KIẾN TRÚC HỆ THỐNG
- **ESP32**: Vi điều khiển chính với W5500 Ethernet + WiFi
- **LED Matrix**: Hiển thị 64x32 px (2 panel nối chain)
- **Cảm biến**: T61 sensor + Encoder trigger
- **Remote IR**: Điều khiển từ xa
- **LED/Relay**: Start relay , Done buzzer

### TRẠNG THÁI HỆ THỐNG
Hệ thống có 3 trạng thái chính:
- **RUNNING**: Đang đếm
- **PAUSE**: Tạm dừng
- **RESET**: Dừng và reset về 0

## MQTT CONFIGURATION

### MQTT BROKER
```cpp
const char* mqtt_server = "test.mosquitto.org";
```
- **Web Interface**: WebSocket Secure port 8081
- **ESP32**: Standard MQTT port 1883
- **Heartbeat**: 30 giây
- **Publish interval**: 2 giây

### MQTT TOPICS STRUCTURE

#### PUBLISH TOPICS (ESP32 gửi data)

**1. bagcounter/status**
- **Mục đích**: Trạng thái tổng quát của hệ thống
- **Tần suất**: Mỗi 2 giây hoặc khi có thay đổi
- **Format JSON**:
```json
{
  "status": "RUNNING|PAUSE|RESET",
  "count": 25,
  "target": 100,
  "bagType": "Gạo thường",
  "isRunning": true,
  "timestamp": 1692345678,
  "systemStatus": "RUNNING"
}
```

**2. bagcounter/count**
- **Mục đích**: Số đếm real-time
- **Tần suất**: Mỗi khi có túi mới
- **Format JSON**:
```json
{
  "count": 26,
  "target": 100,
  "bagType": "Gạo thường",
  "timestamp": 1692345678
}
```

**3. bagcounter/alerts**
- **Mục đích**: Cảnh báo và thông báo hoàn thành
- **Tần suất**: Khi gần đạt target 
- **Format JSON**:
```json
{
  "type": "COMPLETED|WARNING|ERROR",
  "message": "Order completed successfully",
  "count": 100,
  "target": 80,
  "timestamp": 1692345678
}
```

**4. bagcounter/sensor**
- **Mục đích**: Dữ liệu cảm biến
- **Tần suất**: Khi có thay đổi cảm biến
- **Format JSON**:
```json
{
  "sensorValue": 1,
  "triggerValue": 0,
  "isCountingEnabled": true,
  "timestamp": 1692345678
}
```

**5. bagcounter/heartbeat**
- **Mục đích**: Keep-alive signal
- **Tần suất**: Mỗi 30 giây
- **Format JSON**:
```json
{
  "device": "ESP32_BagCounter",
  "uptime": 123456,
  "timestamp": 1692345678,
  "status": "online"
}
```

**6. bagcounter/ir_command**
- **Mục đích**: Lệnh từ IR Remote
- **Tần suất**: Khi nhấn remote
- **Format JSON**:
```json
{
  "command": "START|PAUSE|RESET|SELECT",
  "irCode": "0xFF18E7",
  "timestamp": 1692345678
}
```

#### SUBSCRIBE TOPICS (ESP32 nhận lệnh)

**1. bagcounter/cmd/start**
- **Mục đích**: Lệnh bắt đầu đếm
- **Payload**: `{"action": "start"}`
- **Phản hồi**: Publish status với isRunning=true

**2. bagcounter/cmd/pause**
- **Mục đích**: Lệnh tạm dừng
- **Payload**: `{"action": "pause"}`
- **Phản hồi**: Publish status với isRunning=false

**3. bagcounter/cmd/reset**
- **Mục đích**: Lệnh reset về 0
- **Payload**: `{"action": "reset"}`
- **Phản hồi**: Publish status với count=0

**4. bagcounter/cmd/select**
- **Mục đích**: Chọn đơn hàng/loại túi
- **Payload**: 
```json
{
  "action": "select",
  "bagType": "Gạo thường",
  "target": 100
}
```

**5. bagcounter/config/update**
- **Mục đích**: Cập nhật cấu hình
- **Payload**:
```json
{
  "action": "update_target",
  "target": 150,
  "resetLimit": true
}
```

## API ENDPOINTS

### BASE URL
```
http://192.168.1.200/
```

#### REAL-TIME STATUS

**GET /api/status**
- **Mục đích**: Trạng thái hiện tại (real-time polling)
- **Headers**: CORS enabled, no-cache
- **Response**:
```json
{
  "status": "RUNNING",
  "count": 25,
  "target": 100,
  "bagType": "Gạo thường",
  "isRunning": true,
  "timestamp": 1692345678,
  "limit_reached": false,
  "time": "2024-08-18 10:30:45"
}
```

**GET /api/current_time**
- **Mục đích**: Thời gian hiện tại của ESP32
- **Response**:
```json
{
  "current_time": "2024-08-18 10:30:45",
  "timestamp": 1692345678,
  "timezone": "UTC+7"
}
```

#### CONTROL COMMANDS

**POST /api/cmd**
- **Mục đích**: Điều khiển hệ thống
- **Content-Type**: application/json
- **Payload**:
```json
{
  "cmd": "start|pause|reset",
  "bagType": "Gạo thường",
  "target": 100
}
```
- **Response**:
```json
{
  "success": true,
  "message": "Command executed",
  "status": "RUNNING"
}
```

#### ORDER MANAGEMENT

**GET /api/orders**
- **Mục đích**: Danh sách đơn hàng
- **Response**:
```json
{
  "orders": [
    {
      "id": 1,
      "orderCode": "DH001",
      "customerName": "Khách hàng A",
      "vehicleNumber": "29A-12345",
      "product": {
        "id": 1,
        "code": "GAO001",
        "name": "Gạo thường"
      },
      "quantity": 100,
      "currentCount": 25,
      "status": "processing"
    }
  ]
}
```

**POST /api/new_orders**
- **Mục đích**: Tạo đơn hàng mới
- **Payload**:
```json
{
  "orderCode": "DH003",
  "customerName": "Khách hàng C",
  "vehicleNumber": "31C-11111",
  "productId": 1,
  "quantity": 80
}
```

**DELETE /api/orders**
- **Mục đích**: Xóa đơn hàng
- **Payload**: `{"orderId": 1}`

#### HISTORY MANAGEMENT

**GET /api/history**
- **Mục đích**: Lịch sử đếm túi
- **Response**:
```json
{
  "history": [
    {
      "time": "2024-08-18 09:15:30",
      "count": 100,
      "type": "Gạo thường"
    }
  ]
}
```

**POST /api/history**
- **Mục đích**: Lưu lịch sử từ web (max 50 entries)
- **Payload**:
```json
{
  "entries": [
    {
      "timestamp": "2024-08-18T09:15:30.000Z",
      "customerName": "Khách hàng A",
      "orderCode": "DH001",
      "vehicleNumber": "29A-12345",
      "productName": "Gạo thường",
      "plannedQuantity": 100,
      "actualCount": 98,
      "isBatch": false
    }
  ]
}
```

#### PRODUCT MANAGEMENT

**GET /api/products**
- **Mục đích**: Danh sách sản phẩm
- **Response**:
```json
{
  "products": [
    {
      "id": 1,
      "code": "GAO001",
      "name": "Gạo thường",
      "unit": "túi"
    }
  ]
}
```

**POST /api/products**
- **Mục đích**: Thêm sản phẩm mới
- **Payload**:
```json
{
  "code": "GAO003",
  "name": "Gạo ST25",
  "unit": "túi"
}
```

**DELETE /api/products**
- **Mục đích**: Xóa sản phẩm
- **Payload**: `{"productId": 1}`

#### BAG TYPE MANAGEMENT

**GET /api/bagtype**
- **Mục đích**: Danh sách loại túi
- **Response**:
```json
{
  "bagTypes": ["Gạo thường", "Gạo thơm", "Gạo ST25"]
}
```

**POST /api/bagtype**
- **Mục đích**: Thêm loại túi mới
- **Payload**: `{"type": "Gạo Jasmine"}`

**DELETE /api/bagtype**
- **Mục đích**: Xóa loại túi
- **Payload**: `{"type": "Gạo cũ"}`

#### CONFIGURATION

**GET /api/settings**
- **Mục đích**: Cài đặt hệ thống
- **Response**:
```json
{
  "networkMode": "ETHERNET",
  "mqttEnabled": true,
  "timezone": "UTC+7",
  "debounceDelay": 50
}
```

**POST /api/settings**
- **Mục đích**: Cập nhật cài đặt
- **Payload**:
```json
{
  "networkMode": "WIFI_STA",
  "ssid": "WiFi_Name",
  "password": "password123"
}
```

**POST /api/config**
- **Mục đích**: Cập nhật cấu hình đếm
- **Payload**:
```json
{
  "bagType": "Gạo thường",
  "target": 150,
  "resetLimit": true
}
```

#### MQTT CONTROL

**POST /api/mqtt/publish**
- **Mục đích**: Publish MQTT thủ công
- **Payload**:
```json
{
  "topic": "bagcounter/status",
  "message": "{\"count\": 50}"
}
```

