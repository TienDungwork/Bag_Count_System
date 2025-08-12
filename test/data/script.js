const API_BASE = location.origin;

// Tab navigation
function showTab(tab) {
  document.querySelectorAll('.tab-content').forEach(e => e.style.display = 'none');
  document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1)).style.display = '';
  document.querySelectorAll('.tab-btn').forEach(e => e.classList.remove('active'));
  document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1) + 'Btn').classList.add('active');
}

// Main tab: hiển thị danh sách đơn hàng
function renderOrderList() {
  fetch(API_BASE + '/api/orders')
    .then(res => res.json())
    .then(data => {
      let html = '';
      data.forEach((order, idx) => {
        const isCurrent = order.isCurrent;
        const isDone = order.status === 'DONE';
        html += `<div class="order-item${isCurrent && !isDone ? ' current' : ''}${isDone ? ' done' : ''}">
          <div class="order-content">
            <div class="order-num${isCurrent && !isDone ? ' checked' : ''}${isDone ? ' done' : ''}">${idx + 1}</div>
            ${isCurrent && !isDone ? '<span class="order-check"><i class="fa fa-check-circle"></i></span>' : ''}
            ${isDone ? '<span class="order-done"><i class="fa fa-check-double"></i></span>' : ''}
            <span>Số lượng</span>
            <span class="order-qty">${order.target}</span>
            <span class="order-type">${order.type}</span>
          </div>
          <div class="order-actions">
            ${(!isCurrent && !isDone) ? `<button class="order-select-btn" onclick="selectOrder('${order.type}')">Chọn</button>` : ''}
            <button class="order-delete-btn" onclick="deleteOrder('${order.type}')"><i class="fa fa-trash"></i></button>
          </div>
        </div>`;
      });
      document.getElementById('orderList').innerHTML = html;
    });
}

function deleteOrder(type) {
  if (confirm('Bạn có chắc muốn xóa đơn hàng ' + type + '?')) {
    fetch(API_BASE + '/api/bagtype?type=' + encodeURIComponent(type), {
      method: 'DELETE'
    }).then(() => {
      renderOrderList();
      fetchBagTypes();
    });
  }
}

// Thêm hàm xóa tất cả đơn hàng
function deleteAllOrders() {
  if (confirm('Bạn có chắc muốn xóa tất cả đơn hàng đã hoàn thành?')) {
    fetch(API_BASE + '/api/orders')
      .then(res => res.json())
      .then(orders => {
        const doneOrders = orders.filter(order => order.status === 'DONE');
        if (doneOrders.length === 0) {
          showError('Không có đơn hàng nào để xóa');
          return;
        }
        
        // Xóa từng đơn hàng đã hoàn thành
        const deletePromises = doneOrders.map(order => 
          fetch(API_BASE + '/api/bagtype?type=' + encodeURIComponent(order.type), {
            method: 'DELETE'
          })
        );
        
        Promise.all(deletePromises)
          .then(() => {
            renderOrderList();
            fetchBagTypes();
            showError('Đã xóa tất cả đơn hàng đã hoàn thành');
          })
          .catch(err => {
            console.error('Lỗi khi xóa:', err);
            showError('Có lỗi xảy ra khi xóa đơn hàng');
          });
      });
  }
}

// Hàm cập nhật cảnh báo gần xong ở trang chủ theo loại bao hiện tại
function updateWarnCount() {
  fetch(API_BASE + '/api/orders')
    .then(res => res.json())
    .then(orders => {
      const current = orders.find(o => o.isCurrent);
      if (current) {
        document.getElementById('warnCount').value = current.warn;
      }
    });
}

// Lịch sử đếm
function fetchHistory() {
  fetch(API_BASE + '/api/history')
    .then(res => res.json())
    .then(data => {
      let html = '';
      data.forEach(item => {
        html += `<div class="history-row">
          <span class="history-time">${item.time}</span>
          <span class="history-type">${item.type}</span>
          <span>Đã đếm</span>
          <span class="history-count">${item.count}</span>
        </div>`;
      });
      document.getElementById('historyList').innerHTML = html;
    });
}

// Điều khiển Start/Pause/Reset
function sendCmd(cmd) {
  fetch(API_BASE + '/api/cmd', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({cmd})
  })
  .then(res => {
    if (!res.ok) throw new Error('Lỗi khi gửi lệnh');
    fetchStatus();
  })
  .catch(err => {
    console.error('Lỗi:', err);
    showError('Không thể gửi lệnh');
  });
}

// Cài đặt loại
function showAddType() {
  document.getElementById('newTypeInput').style.display = '';
  document.getElementById('saveTypeBtn').style.display = '';
}
function saveType() {
  const newType = document.getElementById('newTypeInput').value;
  if (newType) {
    fetch(API_BASE + '/api/bagtype', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({type: newType})
    }).then(() => {
      // Xóa input
      document.getElementById('newTypeInput').value = '';
      // Chỉ cập nhật danh sách loại
      fetchBagTypes();
    }).catch(err => {
      console.error('Lỗi:', err);
      showError('Không thể thêm loại mới');
    });
  }
}
function fetchBagTypes() {
  fetch(API_BASE + '/api/bagtype')
    .then(res => res.json())
    .then(data => {
      // Tab cài đặt loại
      let html = '';
      data.forEach(type => {
        html += `<div class="type-item">
          <span>${type}</span>
          <button class="type-del-btn" onclick="deleteType('${type}')"><i class='fa fa-trash'></i></button>
        </div>`;
      });
      document.getElementById('typeList').innerHTML = html;
      
      // Tab cài đặt số lượng
      const sel = document.getElementById('bagTypeSelect');
      sel.innerHTML = '<option value="" disabled selected>Chọn loại hàng hóa</option>';
      data.forEach(type => {
        const opt = document.createElement('option');
        opt.value = type;
        opt.textContent = type;
        sel.appendChild(opt);
      });
    });
}

// Thêm hàm xóa loại
function deleteType(type) {
  if (confirm('Bạn có chắc muốn xóa loại ' + type + '?')) {
    fetch(API_BASE + '/api/bagtype?type=' + encodeURIComponent(type), {
      method: 'DELETE'
    }).then(() => {
      fetchBagTypes();
      renderOrderList(); // Cập nhật lại danh sách đơn hàng
    });
  }
}

// Cài đặt số lượng và cảnh báo gần xong
function changeTarget(delta) {
  const input = document.getElementById('targetInput');
  let v = parseInt(input.value) || 1;
  v = Math.max(1, v + delta);
  input.value = v;
}
function changeWarn(delta) {
  const input = document.getElementById('warnInput');
  let v = parseInt(input.value) || 1;
  v = Math.max(1, v + delta);
  input.value = v;
}
function saveConfig() {
  const type = document.getElementById('bagTypeSelect').value;
  const target = parseInt(document.getElementById('targetInput').value);
  const warn = parseInt(document.getElementById('warnInput').value);
  
  if (!type || target < 1 || warn < 1) {
    showError('Vui lòng nhập đầy đủ thông tin');
    return;
  }
  
  fetch(API_BASE + '/api/config', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({type, target, warn})
  })
  .then(res => {
    if (!res.ok) throw new Error('Lỗi khi lưu cấu hình');
    return fetch(API_BASE + '/api/cmd', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({cmd: 'select', type: type})
    });
  })
  .then(() => {
    renderOrderList();
    showTab('main');
    updateWarnCount();
  })
  .catch(err => {
    console.error('Lỗi:', err);
    showError('Không thể lưu cấu hình');
  });
}

// Thêm hàm chọn đơn hàng
function selectOrder(type) {
  // Lấy thông tin đơn hàng trước khi gửi lệnh
  fetch(API_BASE + '/api/orders')
    .then(res => res.json())
    .then(orders => {
      const order = orders.find(o => o.type === type);
      if (order && order.status === 'DONE') {
        showError('Đơn hàng đã hoàn thành, không thể chọn lại!');
        return;
      }
      // Nếu chưa DONE thì mới gửi lệnh chọn
      fetch(API_BASE + '/api/cmd', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({cmd: 'select', type: type})
      })
      .then(res => {
        if (!res.ok) throw new Error('Lỗi khi chọn đơn hàng');
        renderOrderList();
        updateWarnCount();
      })
      .catch(err => {
        console.error('Lỗi:', err);
        showError('Không thể chọn đơn hàng');
      });
    });
}

// Thêm hàm cập nhật trạng thái
function fetchStatus() {
  fetch(API_BASE + '/api/status')
    .then(res => res.json())
    .then(data => {
      // Cập nhật thời gian bắt đầu
      if (data.startTime && data.startTime !== '') {
        document.getElementById('startTime').value = data.startTime;
      } else {
        // Nếu không có thời gian bắt đầu, hiển thị thời gian hiện tại
        fetchCurrentTime();
      }
      
      // Cập nhật trạng thái đang chạy - chỉ ảnh hưởng đến nút Start/Pause
      const isRunning = data.status === 'RUNNING';
      const startBtn = document.querySelector('.ctrl-btn:nth-child(1)');
      const pauseBtn = document.querySelector('.ctrl-btn:nth-child(2)');
      
      if (startBtn && pauseBtn) {
        startBtn.style.display = isRunning ? 'none' : 'flex';
        pauseBtn.style.display = isRunning ? 'flex' : 'none';
      }
      
      // Cập nhật số đếm hiện tại
      const currentOrder = document.querySelector('.order-item.current');
      if (currentOrder) {
        const countSpan = currentOrder.querySelector('.order-count');
        if (countSpan) countSpan.textContent = data.count;
      }
    })
    .catch(err => {
      console.error('Lỗi khi cập nhật trạng thái:', err);
      showError('Không thể kết nối với thiết bị');
    });
}

// Thêm hàm lấy thời gian hiện tại
function fetchCurrentTime() {
  fetch(API_BASE + '/api/current_time')
    .then(res => res.json())
    .then(data => {
      if (data.isTimeSynced) {
        // Nếu thời gian đã đồng bộ, hiển thị thời gian hiện tại
        document.getElementById('startTime').value = data.currentTime;
      } else {
        // Nếu chưa đồng bộ, hiển thị thông báo
        document.getElementById('startTime').value = 'Đang đồng bộ thời gian...';
        console.log('Thời gian chưa được đồng bộ');
      }
    })
    .catch(err => {
      console.error('Lỗi khi lấy thời gian:', err);
      document.getElementById('startTime').value = 'Lỗi đồng bộ thời gian';
    });
}

// Thêm hàm hiển thị lỗi
function showError(message) {
  const errorDiv = document.createElement('div');
  errorDiv.className = 'error-message';
  errorDiv.textContent = message;
  document.body.appendChild(errorDiv);
  setTimeout(() => errorDiv.remove(), 3000);
}

// Thêm hàm kiểm tra thay đổi từ IR Remote
let lastIRStatus = null;
function checkIRStatus() {
  fetch(API_BASE + '/api/ir_status')
    .then(res => res.json())
    .then(data => {
      // So sánh với trạng thái trước đó
      if (lastIRStatus && 
          (lastIRStatus.status !== data.status || 
           lastIRStatus.count !== data.count)) {
        
        // Có thay đổi từ IR Remote
        console.log('Điều khiển từ IR Remote:', data);
        
        // Cập nhật giao diện ngay lập tức
        fetchStatus();
        renderOrderList();
        
        // Hiển thị thông báo
        let action = '';
        if (data.status === 'RUNNING' && lastIRStatus.status === 'STOPPED') {
          action = 'Bắt đầu đếm';
        } else if (data.status === 'STOPPED' && lastIRStatus.status === 'RUNNING') {
          action = 'Tạm dừng đếm';
        } else if (data.count === 0 && lastIRStatus.count > 0) {
          action = 'Đặt lại về 0';
        }
        
        if (action) {
          showIRNotification(action);
        }
      }
      lastIRStatus = data;
    })
    .catch(err => {
      console.error('Lỗi khi kiểm tra IR status:', err);
    });
}

// Thêm hàm hiển thị thông báo IR Remote
function showIRNotification(action) {
  const notification = document.createElement('div');
  notification.className = 'ir-notification';
  notification.innerHTML = `
    <i class="fa fa-remote"></i>
    <span>IR Remote: ${action}</span>
  `;
  document.body.appendChild(notification);
  
  // Tự động ẩn sau 3 giây
  setTimeout(() => {
    notification.classList.add('fade-out');
    setTimeout(() => notification.remove(), 500);
  }, 3000);
}

// Khởi tạo giao diện
renderOrderList();
fetchHistory();
fetchBagTypes();
fetchCurrentTime(); // Kiểm tra thời gian trước
fetchStatus();
setInterval(fetchStatus, 1000);
setInterval(renderOrderList, 2000);
setInterval(fetchHistory, 10000);

// Thêm kiểm tra IR Remote thường xuyên hơn
setInterval(checkIRStatus, 500); // Kiểm tra mỗi 500ms