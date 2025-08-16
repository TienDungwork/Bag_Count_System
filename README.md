# Hệ Thống Đếm Bao - Quản Lý Đơn Hàng

## Tổng quan
Hệ thống đếm bao tự động với giao diện web, hỗ trợ quản lý đa đơn hàng, sản phẩm và theo dõi tiến độ đếm realtime.

## Tính năng chính

### 1. Quản lý sản phẩm
- **Thêm sản phẩm mới**: Mã sản phẩm, tên sản phẩm
- **Danh sách sản phẩm**: Xem và quản lý toàn bộ sản phẩm
- **Xóa sản phẩm**: Xóa sản phẩm không sử dụng

### 2. Tạo danh sách đơn hàng (Batch System)
- **Tạo danh sách mới**: Tên danh sách, mô tả
- **Thêm đơn hàng vào danh sách**:
  - Mã đơn hàng
  - Tên khách hàng  
  - Biển số xe
  - Chọn sản phẩm
  - Số lượng cần đếm
  - Ngưỡng cảnh báo
- **Quản lý nhiều danh sách**: Chuyển đổi giữa các danh sách đơn hàng

### 3. Đếm đa đơn hàng thông minh
- **Đếm liên tục**: Tự động chuyển từ đơn hàng này sang đơn hàng khác
- **Multi-order counting**: Đếm tổng cộng nhiều đơn hàng trong 1 lần chạy
- **Logic chuyển đơn thông minh**: 
  - Đơn 1 hoàn thành → Đơn 2 tự động chuyển "Đang đếm"
  - Không cần can thiệp thủ công
  - Giữ nguyên tổng số đếm

### 4. Trạng thái đơn hàng realtime
- **Chờ** (màu vàng): Đơn hàng chưa bắt đầu
- **Đang đếm** (màu xanh, viền đậm): Đơn hàng hiện tại đang được đếm
- **Tạm dừng** (màu cam): Đơn hàng bị tạm dừng
- **Hoàn thành** (mờ, màu xám): Đơn hàng đã xong
- **Hiển thị tiến độ**: (số đã đếm/tổng số cần đếm)

### 5. Điều khiển linh hoạt
#### Web Interface:
- **Bắt đầu**: Tiếp tục từ đơn hàng hiện tại (không reset)
- **Tạm dừng**: Pause toàn bộ quá trình đếm
- **Reset**: Xóa toàn bộ tiến độ, bắt đầu lại từ đầu

#### IR Remote (hoạt động giống hệt web):
- **Nút 1 (START)**: Bắt đầu/tiếp tục đếm
- **Nút 2 (PAUSE)**: Tạm dừng đếm
- **Nút 3 (RESET)**: Reset toàn bộ hệ thống

### 6. Lịch sử đếm
- **Lưu đơn lẻ**: Mỗi đơn hàng hoàn thành được lưu riêng
- **Lưu batch**: Toàn bộ danh sách đơn hàng được lưu khi hoàn thành
- **Xuất CSV**: Export dữ liệu lịch sử
- **Lọc theo thời gian**: Xem lịch sử theo khoảng thời gian

### 7. Cài đặt hệ thống
#### Thông tin băng tải:
- Tên/Mã băng tải

#### Cấu hình mạng:
- **Ethernet**: IP tĩnh 192.168.1.200 (mặc định)
- **WiFi STA**: Kết nối WiFi có sẵn
- **WiFi AP**: Tạo hotspot để cấu hình

#### Cài đặt cảm biến:
- Độ trễ cảm biến (ms)
- Độ trễ phát hiện túi (ms)
- Khoảng cách tối thiểu giữa các túi

#### Cài đặt hiển thị:
- Độ sáng LED (0-100%)

## Cách sử dụng

### Bước 1: Cài đặt sản phẩm
1. Vào tab **Cài đặt SP**
2. Nhập **Mã SP** và **Tên sản phẩm**
3. Nhấn **Thêm** để lưu

### Bước 2: Tạo đơn hàng
1. Vào tab **Thêm đơn hàng**
2. Điền đầy đủ thông tin
3. Chọn sản phẩm từ dropdown
4. Nhấn **Thêm** rồi **Lưu lại**

### Bước 3: Bắt đầu đếm
1. Vào tab **Tổng quan**
2. Chọn đơn hàng trong bảng (checkbox)
3. Nhấn icon play để bắt đầu đơn hàng đó
4. Nhấn **Bắt đầu** để khởi động hệ thống đếm

### Bước 4: Theo dõi tiến độ
- Xem số lượng **Kế hoạch** vs **Thực hiện**
- Theo dõi trạng thái đơn hàng trong bảng
- Đơn hàng tự động chuyển sang hoàn thành khi đủ số lượng

## Điều khiển

### Nút điều khiển chính:
- ▶️ **Bắt đầu**: Khởi động đếm
- ⏸️ **Tạm dừng**: Dừng tạm thời
- ⏹️ **Dừng**: Dừng hẳn
- 🔄 **Reset**: Xóa dữ liệu đếm

### Điều khiển IR Remote:
- **Nút 1**: Start
- **Nút 2**: Pause  
- **Nút 3**: Reset

## Kết nối

### Web Interface:
- Truy cập: `http://192.168.1.200`

### Hardware:
- **ESP32-S3** với màn hình LED P5
- **Cảm biến E3F1-DS5C4** để đếm
- **W5500** Ethernet module
- **IR Remote** điều khiển từ xa

## API Endpoints

### Cơ bản:
- `GET /api/status` - Trạng thái hiện tại
- `POST /api/cmd` - Gửi lệnh điều khiển

### Sản phẩm:
- `GET /api/products` - Danh sách sản phẩm
- `POST /api/products` - Thêm sản phẩm
- `DELETE /api/products` - Xóa sản phẩm

### Đơn hàng:
- `GET /api/new_orders` - Danh sách đơn hàng
- `POST /api/new_orders` - Thêm đơn hàng

### Cài đặt:
- `GET /api/settings` - Lấy cài đặt
- `POST /api/settings` - Cập nhật cài đặt

## Lưu trữ dữ liệu
- **Sản phẩm**: Lưu trong localStorage
- **Đơn hàng**: Lưu trong localStorage  
- **Lịch sử**: Lưu trong localStorage
- **Cài đặt**: Lưu trong localStorage + ESP32

## Responsive Design
- Tối ưu cho màn hình điện thoại
- Giao diện tabs dễ sử dụng
- Animations và transitions mượt mà

## Tính năng nâng cao
-  Thống kê realtime
-  Notifications
-  Auto-save
-  Auto-refresh
-  Export CSV
-  Dark/Light theme (có thể mở rộng)

## Troubleshooting

### Không kết nối được:
1. Kiểm tra IP: `192.168.1.200`
2. Kiểm tra cáp mạng
3. Reset ESP32

### Không đếm được:
1. Kiểm tra cảm biến
2. Kiểm tra đơn hàng đã chọn
3. Nhấn Start

### Màn hình LED không hiển thị:
1. Kiểm tra nguồn điện
2. Kiểm tra cáp kết nối
3. Điều chỉnh độ sáng

---

*Phiên bản: 2.0*  
