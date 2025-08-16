// Global variables
let currentMode = 'output'; // 'input' or 'output'
let orderBatches = []; // Array of order batches
let currentBatchId = null;
let currentOrderBatch = []; // Current batch being edited
let currentProducts = [];
let countingHistory = [];
let countingState = {
  isActive: false,
  currentOrderIndex: 0,
  totalPlanned: 0,
  totalCounted: 0
};

// Pagination
let currentPage = 1;
let itemsPerPage = 10;
let totalPages = 1;

let settings = {
  conveyorName: 'BT-001',
  ipAddress: '192.168.1.200',
  gateway: '192.168.1.1',
  subnet: '255.255.255.0',
  sensorDelay: 50,
  bagDetectionDelay: 200,
  minBagInterval: 100,
  autoReset: false,
  brightness: 35
};

// Initialize application
document.addEventListener('DOMContentLoaded', function() {
  loadSettings();
  loadProducts();
  loadOrderBatches();
  loadHistory();
  updateBatchSelector();
  updateCurrentBatchSelect();
  updateProductTable();
  updateBatchDisplay();
  updateOverview();
  showTab('overview');
  startStatusPolling(); // Bắt đầu polling status từ ESP32
  
  // Sync products to ESP32 on page load
  syncAllProductsToESP32();
  
  // Setup brightness slider
  const brightnessSlider = document.getElementById('brightness');
  const brightnessValue = document.getElementById('brightnessValue');
  if (brightnessSlider && brightnessValue) {
    brightnessSlider.addEventListener('input', function() {
      brightnessValue.textContent = this.value + '%';
      settings.brightness = parseInt(this.value);
    });
  }
});

// Batch Management
function createNewBatch() {
  const batchInfo = document.getElementById('batchInfo');
  const orderFormContainer = document.getElementById('orderFormContainer');
  
  batchInfo.style.display = 'block';
  orderFormContainer.style.display = 'block';
  
  // Clear current batch
  currentOrderBatch = [];
  currentBatchId = null;
  document.getElementById('batchName').value = '';
  document.getElementById('batchDescription').value = '';
  
  updateBatchPreview();
}

function loadBatch() {
  const select = document.getElementById('currentBatchSelect');
  const batchId = select.value;
  
  if (batchId) {
    const batch = orderBatches.find(b => b.id == batchId);
    if (batch) {
      currentBatchId = batch.id;
      currentOrderBatch = [...batch.orders];
      document.getElementById('batchName').value = batch.name;
      document.getElementById('batchDescription').value = batch.description || '';
      
      document.getElementById('batchInfo').style.display = 'block';
      document.getElementById('orderFormContainer').style.display = 'block';
      updateBatchPreview();
    }
  }
}

function addOrderToBatch() {
  const customerName = document.getElementById('customerName').value.trim();
  const orderCode = document.getElementById('orderCode').value.trim();
  const vehicleNumber = document.getElementById('vehicleNumber').value.trim();
  const productId = document.getElementById('productSelect').value;
  const quantity = parseInt(document.getElementById('quantity').value);
  const warningQuantity = parseInt(document.getElementById('warningQuantity').value) || Math.floor(quantity * 0.1);
  
  if (!customerName || !orderCode || !vehicleNumber || !productId || !quantity) {
    alert('Vui lòng điền đầy đủ thông tin đơn hàng');
    return;
  }
  
  const product = currentProducts.find(p => p.id == productId);
  if (!product) {
    alert('Sản phẩm không hợp lệ');
    return;
  }
  
  // Check if order code already exists in current batch
  if (currentOrderBatch.find(o => o.orderCode === orderCode)) {
    alert('Mã đơn hàng đã tồn tại trong danh sách');
    return;
  }
  
  const newOrder = {
    id: Date.now(),
    orderNumber: currentOrderBatch.length + 1,
    customerName,
    orderCode,
    vehicleNumber,
    product,
    quantity,
    warningQuantity,
    currentCount: 0,
    status: 'waiting',
    selected: false,
    createdAt: new Date().toISOString()
  };
  
  currentOrderBatch.push(newOrder);
  updateBatchPreview();
  
  // KHÔNG gửi đơn hàng đến ESP32 ngay - chỉ gửi khi bắt đầu đếm
  // sendOrderToESP32(newOrder);
  
  // Clear form
  document.getElementById('orderForm').reset();
  
  showNotification('Thêm đơn hàng vào danh sách thành công', 'success');
}

function removeOrderFromBatch(index) {
  if (confirm('Bạn có chắc chắn muốn xóa đơn hàng này khỏi danh sách?')) {
    currentOrderBatch.splice(index, 1);
    // Renumber orders
    currentOrderBatch.forEach((order, i) => {
      order.orderNumber = i + 1;
    });
    updateBatchPreview();
  }
}

function updateBatchPreview() {
  const preview = document.getElementById('batchPreview');
  const tbody = document.getElementById('batchPreviewBody');
  
  if (currentOrderBatch.length === 0) {
    preview.style.display = 'none';
    return;
  }
  
  preview.style.display = 'block';
  tbody.innerHTML = '';
  
  currentOrderBatch.forEach((order, index) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${order.orderNumber}</td>
      <td>${order.customerName}</td>
      <td>${order.orderCode}</td>
      <td>${order.vehicleNumber}</td>
      <td>${order.product.name}</td>
      <td>${order.quantity}</td>
      <td>
        <button class="btn-danger" onclick="removeOrderFromBatch(${index})" style="padding: 5px 10px; font-size: 12px;">
          <i class="fas fa-trash"></i>
        </button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

function saveBatch() {
  const batchName = document.getElementById('batchName').value.trim();
  const batchDescription = document.getElementById('batchDescription').value.trim();
  
  if (!batchName) {
    alert('Vui lòng nhập tên danh sách');
    return;
  }
  
  if (currentOrderBatch.length === 0) {
    alert('Danh sách đơn hàng không được trống');
    return;
  }
  
  const batch = {
    id: currentBatchId || Date.now(),
    name: batchName,
    description: batchDescription,
    orders: [...currentOrderBatch],
    createdAt: new Date().toISOString(),
    isActive: false
  };
  
  console.log('Saving batch:', batch);
  
  if (currentBatchId) {
    // Update existing batch
    const index = orderBatches.findIndex(b => b.id === currentBatchId);
    if (index !== -1) {
      orderBatches[index] = batch;
      console.log('Updated existing batch at index:', index);
    }
  } else {
    // Add new batch
    orderBatches.push(batch);
    console.log('Added new batch, total batches:', orderBatches.length);
  }
  
  saveOrderBatches();
  updateBatchSelector();
  updateCurrentBatchSelect();
  
  // GỬI TẤT CẢ ĐƠN HÀNG TRONG BATCH ĐẾN ESP32 KHI LƯU
  sendBatchToESP32(batch);
  
  showNotification('Lưu danh sách đơn hàng thành công', 'success');
  
  // Reset form
  document.getElementById('batchInfo').style.display = 'none';
  document.getElementById('orderFormContainer').style.display = 'none';
  currentOrderBatch = [];
  currentBatchId = null;
  
  console.log('Batch saved successfully, orderBatches:', orderBatches);
}

function clearBatch() {
  const select = document.getElementById('batchSelector');
  const selectedBatchId = select ? parseInt(select.value) : null;
  
  if (!selectedBatchId) {
    // Nếu chưa chọn batch nào, chỉ xóa đơn hàng đang tạo
    if (confirm('Bạn có chắc chắn muốn xóa tất cả đơn hàng trong danh sách hiện tại?')) {
      currentOrderBatch = [];
      updateBatchPreview();
      showNotification('Đã xóa đơn hàng đang tạo!', 'success');
    }
    return;
  }
  
  // Nếu đã chọn batch, xóa batch đó
  const batchToDelete = orderBatches.find(b => b.id === selectedBatchId);
  if (!batchToDelete) return;
  
  if (confirm(`Bạn có chắc chắn muốn xóa danh sách "${batchToDelete.name}"?`)) {
    // Xóa batch được chọn
    orderBatches = orderBatches.filter(b => b.id !== selectedBatchId);
    saveOrderBatches();
    
    // Reset selection
    select.value = '';
    currentOrderBatch = [];
    currentBatchId = null;
    
    // Cập nhật UI
    updateBatchPreview();
    updateBatchSelector();
    updateCurrentBatchSelect();
    updateOverview();
    updateBatchDisplay();
    
    // Ẩn form
    document.getElementById('batchInfo').style.display = 'none';
    document.getElementById('orderFormContainer').style.display = 'none';
    
    showNotification(`Đã xóa danh sách "${batchToDelete.name}"!`, 'success');
  }
}

function switchBatch() {
  const select = document.getElementById('batchSelector');
  if (!select || !select.value) return;
  
  const batchId = parseInt(select.value);
  console.log('Switching to batch ID:', batchId);
  
  if (batchId) {
    const batch = orderBatches.find(b => b.id == batchId);
    if (batch) {
      // Set as active batch
      orderBatches.forEach(b => b.isActive = false);
      batch.isActive = true;
      
      // Auto-select all orders in the batch
      batch.orders.forEach(order => {
        if (order.selected === undefined) {
          order.selected = true;
        }
      });
      
      saveOrderBatches();
      
      console.log('Activated batch:', batch.name, 'with', batch.orders.length, 'orders');
      
      currentPage = 1;
      updateBatchDisplay();
      updateOverview();
      showNotification(`Đã chuyển sang danh sách: ${batch.name}`, 'success');
    } else {
      console.error('Batch not found:', batchId);
    }
  }
}

function updateBatchSelector() {
  const select = document.getElementById('batchSelector');
  if (!select) {
    console.error('batchSelector element not found');
    return;
  }
  
  console.log('Updating batch selector with', orderBatches.length, 'batches');
  
  select.innerHTML = '<option value="">Chọn danh sách đơn hàng</option>';
  
  // Auto-activate first batch if no active batch exists
  if (orderBatches.length > 0 && !orderBatches.find(b => b.isActive)) {
    orderBatches[0].isActive = true;
    saveOrderBatches();
    console.log('Auto-activated first batch:', orderBatches[0].name);
  }
  
  orderBatches.forEach(batch => {
    const option = document.createElement('option');
    option.value = batch.id;
    option.textContent = `${batch.name} (${batch.orders.length} đơn)`;
    if (batch.isActive) {
      option.selected = true;
    }
    select.appendChild(option);
    console.log('Added batch option:', batch.name);
  });
}

function updateCurrentBatchSelect() {
  const select = document.getElementById('currentBatchSelect');
  if (!select) return;
  
  select.innerHTML = '<option value="">Chọn danh sách</option>';
  
  orderBatches.forEach(batch => {
    const option = document.createElement('option');
    option.value = batch.id;
    option.textContent = batch.name;
    select.appendChild(option);
  });
}

function updateBatchDisplay() {
  console.log('Updating batch display...');
  
  // Find the active batch
  const activeBatch = orderBatches.find(batch => batch.isActive);
  
  if (!activeBatch) {
    console.log('No active batch found');
    // Clear display if no active batch
    const ordersTableBody = document.getElementById('ordersTableBody');
    if (ordersTableBody) {
      ordersTableBody.innerHTML = '<tr><td colspan="6" class="text-center">Không có danh sách đơn hàng nào được chọn</td></tr>';
    }
    
    // Clear pagination
    const currentPageElement = document.getElementById('currentPage');
    const totalPagesElement = document.getElementById('totalPages');
    const totalItemsElement = document.getElementById('totalItems');
    
    if (currentPageElement) currentPageElement.textContent = '0';
    if (totalPagesElement) totalPagesElement.textContent = '0';
    if (totalItemsElement) totalItemsElement.textContent = '0';
    
    return;
  }
  
  console.log('Displaying batch:', activeBatch.name, 'with', activeBatch.orders.length, 'orders');
  
  // Update batch selector if needed
  const batchSelector = document.getElementById('batchSelector');
  if (batchSelector && batchSelector.value !== activeBatch.id) {
    batchSelector.value = activeBatch.id;
  }
  
  // Reset to first page when switching batches
  currentPage = 1;
  
  // Update the orders display
  updateOrderTable();

  // Update pagination
  updatePagination(activeBatch.orders);
}

// Pagination Functions
function updatePagination(orders) {
  totalPages = Math.ceil(orders.length / itemsPerPage);
  
  const currentPageElement = document.getElementById('currentPage');
  const totalPagesElement = document.getElementById('totalPages');
  const showingFromElement = document.getElementById('showingFrom');
  const showingToElement = document.getElementById('showingTo');
  const totalItemsElement = document.getElementById('totalItems');
  
  if (currentPageElement) currentPageElement.textContent = currentPage;
  if (totalPagesElement) totalPagesElement.textContent = totalPages;
  if (totalItemsElement) totalItemsElement.textContent = orders.length;
  
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, orders.length);
  
  if (showingFromElement) showingFromElement.textContent = orders.length > 0 ? startIndex + 1 : 0;
  if (showingToElement) showingToElement.textContent = endIndex;
  
  // Update pagination buttons
  const firstPageBtn = document.getElementById('firstPageBtn');
  const prevPageBtn = document.getElementById('prevPageBtn');
  const nextPageBtn = document.getElementById('nextPageBtn');
  const lastPageBtn = document.getElementById('lastPageBtn');
  
  if (firstPageBtn) firstPageBtn.disabled = currentPage === 1;
  if (prevPageBtn) prevPageBtn.disabled = currentPage === 1;
  if (nextPageBtn) nextPageBtn.disabled = currentPage === totalPages;
  if (lastPageBtn) lastPageBtn.disabled = currentPage === totalPages;
  
  // Update page numbers
  updatePageNumbers();
}

function updatePageNumbers() {
  const pageNumbers = document.getElementById('pageNumbers');
  if (!pageNumbers) return;
  
  pageNumbers.innerHTML = '';
  
  const maxVisiblePages = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
  let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
  
  if (endPage - startPage + 1 < maxVisiblePages) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
  }
  
  for (let i = startPage; i <= endPage; i++) {
    const pageBtn = document.createElement('div');
    pageBtn.className = `page-number ${i === currentPage ? 'active' : ''}`;
    pageBtn.textContent = i;
    pageBtn.onclick = () => goToPage(i);
    pageNumbers.appendChild(pageBtn);
  }
}

function goToPage(page) {
  if (typeof page === 'number') {
    currentPage = page;
  } else {
    switch(page) {
      case 'first':
        currentPage = 1;
        break;
      case 'prev':
        currentPage = Math.max(1, currentPage - 1);
        break;
      case 'next':
        currentPage = Math.min(totalPages, currentPage + 1);
        break;
      case 'last':
        currentPage = totalPages;
        break;
    }
  }
  
  updateOrderTable();
}

// Order Management (Updated)
function selectAllOrders(checked) {
  const activeBatch = orderBatches.find(b => b.isActive);
  if (!activeBatch) return;
  
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, activeBatch.orders.length);
  
  for (let i = startIndex; i < endIndex; i++) {
    activeBatch.orders[i].selected = checked;
  }
  
  saveOrderBatches();
  updateOrderTable();
  updateOverview();
}

function selectOrder(orderId, checked) {
  const activeBatch = orderBatches.find(b => b.isActive);
  if (!activeBatch) return;
  
  const order = activeBatch.orders.find(o => o.id === orderId);
  if (order) {
    order.selected = checked;
    console.log(`Order ${order.product.name} ${checked ? 'selected' : 'deselected'}`);
    saveOrderBatches();
    updateOverview();
  }
}

function updateOrderTable() {
  const tbody = document.getElementById('orderTableBody');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  const activeBatch = orderBatches.find(b => b.isActive);
  if (!activeBatch || activeBatch.orders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center">Chưa có đơn hàng nào</td></tr>';
    updatePagination([]);
    updateTotalInfo(0, 0);
    return;
  }
  
  const orders = activeBatch.orders;
  updatePagination(orders);
  
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, orders.length);
  const pageOrders = orders.slice(startIndex, endIndex);
  
  let selectedCount = 0;
  
  pageOrders.forEach(order => {
    if (order.selected) selectedCount++;
    
    const row = document.createElement('tr');
    
    // Thêm class cho trạng thái
    row.classList.add(order.status);
    
    // Style cho đơn hàng đã hoàn thành (mờ đi)
    if (order.status === 'completed') {
      row.style.opacity = '0.6';
      row.style.backgroundColor = '#f8f9fa';
    } else if (order.status === 'counting') {
      row.style.backgroundColor = '#e3f2fd';
      row.style.fontWeight = 'bold';
      row.style.border = '2px solid #2196f3';
    } else if (order.status === 'paused') {
      row.style.backgroundColor = '#fff3e0';
    }
    
    const statusDisplay = getStatusDisplay(order.status);
    
    // Hiển thị số đếm hiện tại nếu có
    const currentCountText = order.currentCount > 0 ? ` (${order.currentCount})` : '';
    
    row.innerHTML = `
      <td><span class="order-number">${order.orderNumber}</span></td>
      <td>
        <input type="checkbox" ${order.selected ? 'checked' : ''} 
               onchange="selectOrder(${order.id}, this.checked)"
               ${order.status === 'counting' || order.status === 'completed' ? 'disabled' : ''}>
      </td>
      <td><strong>${order.quantity}${currentCountText}</strong></td>
      <td>${order.product.name}</td>
      <td>${order.customerName}</td>
      <td>${order.vehicleNumber}</td>
      <td>
        <span class="status-indicator status-${order.status}">
          <i class="fas fa-${statusDisplay.icon}"></i>
          ${statusDisplay.text}
          ${order.status === 'counting' && order.currentCount ? ` (${order.currentCount}/${order.quantity})` : ''}
        </span>
      </td>
    `;
    
    tbody.appendChild(row);
  });
  
  // Update select all checkbox
  const selectAllCheckbox = document.getElementById('selectAllCheckbox');
  if (selectAllCheckbox) {
    const allPageSelected = pageOrders.length > 0 && pageOrders.every(order => order.selected);
    const somePageSelected = pageOrders.some(order => order.selected);
    
    selectAllCheckbox.checked = allPageSelected;
    selectAllCheckbox.indeterminate = somePageSelected && !allPageSelected;
  }
  
  updateTotalInfo(orders.filter(o => o.selected).length, orders.length);
}

function updateTotalInfo(selected, total) {
  const totalSelectedElement = document.getElementById('totalSelected');
  const totalOrdersElement = document.getElementById('totalOrders');
  
  if (totalSelectedElement) totalSelectedElement.textContent = selected;
  if (totalOrdersElement) totalOrdersElement.textContent = total;
}

function getStatusDisplay(status) {
  switch(status) {
    case 'waiting': return { icon: 'clock', text: 'Chờ' };
    case 'counting': return { icon: 'play', text: 'Đang đếm' };
    case 'completed': return { icon: 'check-circle', text: 'Hoàn thành' };
    case 'paused': return { icon: 'pause', text: 'Tạm dừng' };
    default: return { icon: 'clock', text: 'Chờ' };
  }
}

// Counting Control (Updated)
function startCounting() {
  const activeBatch = orderBatches.find(b => b.isActive);
  if (!activeBatch) {
    alert('Vui lòng chọn danh sách đơn hàng');
    return;
  }
  
  const selectedOrders = activeBatch.orders.filter(o => o.selected);
  if (selectedOrders.length === 0) {
    alert('Vui lòng chọn ít nhất một đơn hàng để đếm');
    return;
  }
  
  // KIỂM TRA XEM ĐÃ CÓ ĐƠN HÀNG ĐANG ĐẾM HAY CHƯA
  let currentOrderIndex = selectedOrders.findIndex(o => o.status === 'counting');
  
  if (currentOrderIndex === -1) {
    // CHƯA CÓ ĐƠN HÀNG NÀO ĐANG ĐẾM - TÌM ĐƠN TIẾP THEO
    currentOrderIndex = selectedOrders.findIndex(o => o.status === 'waiting' || o.status === 'paused');
    
    if (currentOrderIndex === -1) {
      // TẤT CẢ ĐÃ HOÀN THÀNH - BẮT ĐẦU LẠI TỪ ĐẦU
      selectedOrders.forEach(order => {
        order.status = 'waiting';
        order.currentCount = 0;
      });
      currentOrderIndex = 0;
    }
    
    // ĐẶT ĐƠN HÀNG HIỆN TẠI THÀNH COUNTING
    selectedOrders[currentOrderIndex].status = 'counting';
  }
  
  // CẬP NHẬT COUNTING STATE
  countingState.isActive = true;
  countingState.currentOrderIndex = currentOrderIndex;
  countingState.totalPlanned = selectedOrders.reduce((sum, order) => sum + order.quantity, 0);
  
  // TÍNH TOTAL COUNTED DỰA VÀO CÁC ĐƠN HÀNG ĐÃ HOÀN THÀNH
  countingState.totalCounted = 0;
  for (let i = 0; i < currentOrderIndex; i++) {
    if (selectedOrders[i].status === 'completed') {
      countingState.totalCounted += selectedOrders[i].quantity;
    }
  }
  countingState.totalCounted += selectedOrders[currentOrderIndex].currentCount || 0;
  
  console.log('Bat dau dem tu don:', currentOrderIndex + 1, 'cua', selectedOrders.length);
  console.log('Tong ke hoach:', countingState.totalPlanned);
  console.log('Da dem:', countingState.totalCounted);
  
  // GỬI LỆNH ĐẾN ESP32 VỚI ĐƠN HÀNG HIỆN TẠI
  const currentOrder = selectedOrders[currentOrderIndex];
  sendESP32Command('start', {
    orderCode: currentOrder.orderCode,
    customerName: currentOrder.customerName,
    productName: currentOrder.product.name,
    target: currentOrder.quantity,
    warningQuantity: currentOrder.warningQuantity,
    totalTarget: countingState.totalPlanned,
    isMultiOrder: selectedOrders.length > 1,
    currentOrderIndex: currentOrderIndex,
    totalOrders: selectedOrders.length,
    currentCount: countingState.totalCounted
  });
  
  saveOrderBatches();
  updateOrderTable();
  updateOverview();
  showNotification(`Bat dau dem don ${currentOrderIndex + 1}/${selectedOrders.length}: ${currentOrder.customerName}`, 'success');
}

// Hàm gửi thông tin batch để ESP32 biết (optional)
async function sendBatchInfoToESP32(orders) {
  try {
    const batchInfo = {
      cmd: 'set_batch_info',
      totalOrders: orders.length,
      totalQuantity: orders.reduce((sum, o) => sum + o.quantity, 0),
      orders: orders.map((order, index) => ({
        index: index,
        orderCode: order.orderCode,
        customerName: order.customerName,
        productName: order.product.name,
        quantity: order.quantity
      }))
    };
    
    const response = await fetch('/api/cmd', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(batchInfo)
    });
    
    if (response.ok) {
      console.log('✅ Đã gửi thông tin batch đến ESP32');
    } else {
      console.log('⚠️ Không gửi được thông tin batch (không quan trọng)');
    }
  } catch (error) {
    console.log('⚠️ Lỗi gửi batch info (không quan trọng):', error.message);
  }
}

// Hàm gửi toàn bộ danh sách đơn hàng đến ESP32
async function sendBatchOrdersToESP32(orders) {
  try {
    console.log('📤 Gửi danh sách', orders.length, 'đơn hàng đến ESP32...');
    
    // Thử gửi qua endpoint batch_orders trước
    const batchData = {
      orders: orders.map((order, index) => ({
        orderNumber: index + 1,
        orderCode: order.orderCode,
        customerName: order.customerName,
        vehicleNumber: order.vehicleNumber,
        productName: order.product.name,
        quantity: order.quantity,
        warningQuantity: order.warningQuantity
      })),
      totalQuantity: orders.reduce((sum, o) => sum + o.quantity, 0),
      totalOrders: orders.length
    };
    
    try {
      const response = await fetch('/api/batch_orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(batchData)
      });
      
      if (response.ok) {
        const result = await response.text();
        console.log('✅ Danh sách đơn hàng đã gửi thành công đến ESP32 (batch):', result);
        showNotification(`✅ Đã gửi ${orders.length} đơn hàng đến ESP32`, 'success');
        return true;
      } else if (response.status === 404) {
        // Endpoint không tồn tại, fallback sang gửi từng đơn
        console.log('⚠️ Endpoint batch_orders không tồn tại, gửi từng đơn hàng...');
        return await sendOrdersOneByOne(orders);
      } else {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    } catch (fetchError) {
      if (fetchError.message.includes('404') || fetchError.message.includes('Not Found')) {
        console.log('⚠️ Endpoint batch_orders không tồn tại, gửi từng đơn hàng...');
        return await sendOrdersOneByOne(orders);
      } else {
        throw fetchError;
      }
    }
    
  } catch (error) {
    console.error('❌ Lỗi gửi danh sách đơn hàng đến ESP32:', error);
    showNotification('❌ Lỗi gửi danh sách đến ESP32: ' + error.message, 'error');
    return false;
  }
}

// Hàm fallback: gửi từng đơn hàng một
async function sendOrdersOneByOne(orders) {
  try {
    console.log('📤 Gửi từng đơn hàng (fallback mode)...');
    let successCount = 0;
    
    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];
      console.log(`📤 Gửi đơn ${i + 1}/${orders.length}: ${order.customerName} - ${order.product.name}`);
      
      const result = await sendOrderToESP32(order);
      if (result) {
        successCount++;
        // Delay nhỏ giữa các request
        await new Promise(resolve => setTimeout(resolve, 200));
      } else {
        console.error(`❌ Thất bại gửi đơn ${i + 1}`);
      }
    }
    
    if (successCount === orders.length) {
      console.log('✅ Tất cả đơn hàng đã được gửi thành công (fallback)');
      showNotification(`✅ Đã gửi ${successCount}/${orders.length} đơn hàng đến ESP32`, 'success');
      return true;
    } else {
      console.warn(`⚠️ Chỉ gửi được ${successCount}/${orders.length} đơn hàng`);
      showNotification(`⚠️ Chỉ gửi được ${successCount}/${orders.length} đơn hàng`, 'warning');
      return successCount > 0; // Trả về true nếu ít nhất 1 đơn thành công
    }
    
  } catch (error) {
    console.error('❌ Lỗi trong fallback mode:', error);
    showNotification('❌ Lỗi gửi đơn hàng: ' + error.message, 'error');
    return false;
  }
}

function pauseCounting() {
  const activeBatch = orderBatches.find(b => b.isActive);
  if (!activeBatch) return;
  
  const selectedOrders = activeBatch.orders.filter(o => o.selected);
  
  countingState.isActive = false;
  
  // Send pause command to ESP32
  sendESP32Command('pause');
  
  // Cập nhật trạng thái đơn hàng giống như IR Remote
  selectedOrders.forEach(order => {
    if (order.status === 'counting') {
      order.status = 'paused';
    }
  });
  
  saveOrderBatches();
  updateOrderTable();
  updateOverview();
  showNotification('Tam dung dem tu Web', 'warning');
}

function resetCounting() {
  const activeBatch = orderBatches.find(b => b.isActive);
  if (!activeBatch) return;
  
  const selectedOrders = activeBatch.orders.filter(o => o.selected);
  
  countingState.isActive = false;
  countingState.currentOrderIndex = 0;
  countingState.totalPlanned = 0;
  countingState.totalCounted = 0;
  
  // Send reset command to ESP32
  sendESP32Command('reset');
  
  // Reset tất cả đơn hàng giống như IR Remote
  selectedOrders.forEach(order => {
    order.status = 'waiting';
    order.currentCount = 0;
  });
  
  saveOrderBatches();
  updateOrderTable();
  updateOverview();
  showNotification('Reset dem tu Web', 'info');
}

// Product Management (Updated)
function addProduct() {
  const productName = document.getElementById('productName').value.trim();
  const productCode = document.getElementById('productCode').value.trim();
  const unitWeight = parseFloat(document.getElementById('unitWeight').value);
  
  if (!productName || !productCode || isNaN(unitWeight) || unitWeight <= 0) {
    alert('Vui lòng điền đầy đủ thông tin sản phẩm hợp lệ');
    return;
  }
  
  // Check if product code already exists
  if (currentProducts.find(p => p.code === productCode)) {
    alert('Mã sản phẩm đã tồn tại');
    return;
  }
  
  const newProduct = {
    id: Date.now(),
    name: productName,
    code: productCode,
    unitWeight: unitWeight,
    createdAt: new Date().toISOString()
  };
  
  currentProducts.push(newProduct);
  saveProducts();
  updateProductTable();
  updateProductSelect();
  
  // GỬI SẢNPHẨM ĐẾN ESP32
  sendProductToESP32(newProduct);
  
  // Clear form
  document.getElementById('productForm').reset();
  showNotification('Thêm sản phẩm thành công', 'success');
}

function editProduct(index) {
  const product = currentProducts[index];
  document.getElementById('productName').value = product.name;
  document.getElementById('productCode').value = product.code;
  document.getElementById('unitWeight').value = product.unitWeight;
  
  // Remove the product temporarily for validation
  currentProducts.splice(index, 1);
  updateProductTable();
}

function deleteProduct(index) {
  if (confirm('Bạn có chắc chắn muốn xóa sản phẩm này?')) {
    currentProducts.splice(index, 1);
    saveProducts();
    updateProductTable();
    updateProductSelect();
    showNotification('Xóa sản phẩm thành công', 'success');
  }
}

function updateProductTable() {
  const tbody = document.getElementById('productTableBody');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  if (currentProducts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center">Chưa có sản phẩm nào</td></tr>';
    return;
  }
  
  currentProducts.forEach((product, index) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${product.name}</td>
      <td>${product.code}</td>
      <td>${product.unitWeight} kg</td>
      <td>${new Date(product.createdAt).toLocaleDateString('vi-VN')}</td>
      <td>
        <button class="btn-edit" onclick="editProduct(${index})">
          <i class="fas fa-edit"></i>
        </button>
        <button class="btn-danger" onclick="deleteProduct(${index})">
          <i class="fas fa-trash"></i>
        </button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

function updateProductSelect() {
  const select = document.getElementById('productSelect');
  if (!select) return;
  
  select.innerHTML = '<option value="">Chọn sản phẩm</option>';
  
  currentProducts.forEach(product => {
    const option = document.createElement('option');
    option.value = product.id;
    option.textContent = `${product.name} - ${product.code}`;
    select.appendChild(option);
  });
}

// Debug function to check data
function debugBatchData() {
  console.log('=== DEBUG BATCH DATA ===');
  console.log('orderBatches:', orderBatches);
  console.log('Number of batches:', orderBatches.length);
  
  orderBatches.forEach((batch, index) => {
    console.log(`Batch ${index}:`, {
      id: batch.id,
      name: batch.name,
      isActive: batch.isActive,
      orders: batch.orders.length,
      ordersData: batch.orders
    });
    
    if (batch.orders.length > 0) {
      batch.orders.forEach((order, oIndex) => {
        console.log(`  Order ${oIndex}:`, {
          selected: order.selected,
          quantity: order.quantity,
          currentCount: order.currentCount || 0
        });
      });
    }
  });
  
  const activeBatch = orderBatches.find(b => b.isActive);
  console.log('Active batch:', activeBatch ? activeBatch.name : 'NONE FOUND');
  console.log('========================');
}

// Updated Overview Function
function updateOverview() {
  console.log('Updating overview, orderBatches:', orderBatches.length);
  debugBatchData(); // Debug call
  
  const activeBatch = orderBatches.find(b => b.isActive);
  console.log('Active batch:', activeBatch ? activeBatch.name : 'none');
  
  // Update plan vs execute counts
  const planCountElement = document.getElementById('planCount');
  const executeCountElement = document.getElementById('executeCount');
  
  if (!activeBatch) {
    if (planCountElement) planCountElement.textContent = '0';
    if (executeCountElement) executeCountElement.textContent = '0';
    return;
  }
  
  const orders = activeBatch.orders;
  const selectedOrders = orders.filter(o => o.selected);
  const totalPlanned = selectedOrders.reduce((sum, order) => sum + order.quantity, 0);
  const totalCounted = selectedOrders.reduce((sum, order) => sum + (order.currentCount || 0), 0);
  
  console.log('Orders:', orders.length, 'Selected:', selectedOrders.length, 'Planned:', totalPlanned, 'Counted:', totalCounted);
  
  if (planCountElement) planCountElement.textContent = totalPlanned;
  if (executeCountElement) executeCountElement.textContent = totalCounted;
}

// History Management (Updated)
function loadHistory() {
  const saved = localStorage.getItem('countingHistory');
  if (saved) {
    countingHistory = JSON.parse(saved);
  }
  updateHistoryTable();
}

function saveHistory() {
  localStorage.setItem('countingHistory', JSON.stringify(countingHistory));
}

function updateHistoryTable() {
  const tbody = document.getElementById('historyTableBody');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  if (countingHistory.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center">Chưa có lịch sử đếm</td></tr>';
    return;
  }
  
  // Sắp xếp theo thời gian mới nhất
  const sortedHistory = [...countingHistory].sort((a, b) => 
    new Date(b.timestamp) - new Date(a.timestamp)
  );
  
  sortedHistory.forEach((entry, index) => {
    const row = document.createElement('tr');
    const isAccurate = entry.actualCount === entry.plannedQuantity;
    const accuracy = entry.plannedQuantity > 0 ? 
      ((entry.actualCount / entry.plannedQuantity) * 100).toFixed(1) : 0;
    
    // Kiểm tra xem có phải là batch không
    const isBatch = entry.isBatch || entry.customerName.includes('📦');
    
    row.innerHTML = `
      <td>${new Date(entry.timestamp).toLocaleString('vi-VN')}</td>
      <td>
        <strong>${entry.customerName}</strong>
        ${entry.orderCode ? `<br><small style="color: #666;">Mã: ${entry.orderCode}</small>` : ''}
      </td>
      <td>${entry.vehicleNumber || 'N/A'}</td>
      <td>${entry.productName}</td>
      <td><strong>${entry.plannedQuantity}</strong></td>
      <td>
        <span style="color: ${isAccurate ? 'green' : 'red'}; font-weight: bold;">
          ${entry.actualCount}
        </span>
        <br>
        <small style="color: #666;">(${accuracy}%)</small>
      </td>
      <td>
        <span class="status-indicator ${isAccurate ? 'status-completed' : 'status-warning'}">
          ${isAccurate ? '✅ Đạt' : '⚠️ Lệch'}
        </span>
      </td>
    `;
    
    // Highlight batch entries
    if (isBatch) {
      row.style.backgroundColor = '#f0f8ff';
      row.style.borderLeft = '4px solid #007bff';
      row.title = `Danh sách đơn hàng - Click để xem chi tiết`;
      row.style.cursor = 'pointer';
      row.onclick = () => showBatchHistoryDetails(entry);
    }
    
    tbody.appendChild(row);
  });
}

// Hàm hiển thị chi tiết batch history
function showBatchHistoryDetails(batchEntry) {
  if (!batchEntry.batchDetails || !batchEntry.batchDetails.orders) {
    showNotification('Không có chi tiết cho entry này', 'warning');
    return;
  }
  
  const details = batchEntry.batchDetails;
  let detailHTML = `
    <div style="max-height: 500px; overflow-y: auto;">
      <h3>📦 Chi tiết: ${details.batchName}</h3>
      <p><strong>Thời gian:</strong> ${new Date(batchEntry.timestamp).toLocaleString('vi-VN')}</p>
      <p><strong>Mô tả:</strong> ${details.description || 'Không có'}</p>
      <p><strong>Tổng kế hoạch:</strong> ${batchEntry.plannedQuantity} | <strong>Tổng thực hiện:</strong> ${batchEntry.actualCount}</p>
      
      <table style="width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 14px;">
        <thead>
          <tr style="background: #f8f9fa; color: #333;">
            <th style="border: 1px solid #dee2e6; padding: 10px; text-align: left;">Khách hàng</th>
            <th style="border: 1px solid #dee2e6; padding: 10px; text-align: left;">Mã đơn</th>
            <th style="border: 1px solid #dee2e6; padding: 10px; text-align: left;">Sản phẩm</th>
            <th style="border: 1px solid #dee2e6; padding: 10px; text-align: left;">Xe</th>
            <th style="border: 1px solid #dee2e6; padding: 10px; text-align: center;">KH</th>
            <th style="border: 1px solid #dee2e6; padding: 10px; text-align: center;">TH</th>
            <th style="border: 1px solid #dee2e6; padding: 10px; text-align: center;">%</th>
          </tr>
        </thead>
        <tbody>
  `;
  
  details.orders.forEach(order => {
    const accuracy = order.plannedQuantity > 0 ? 
      ((order.actualCount / order.plannedQuantity) * 100).toFixed(1) : 0;
    const isAccurate = order.actualCount === order.plannedQuantity;
    
    detailHTML += `
      <tr style="border-bottom: 1px solid #eee;">
        <td style="border: 1px solid #dee2e6; padding: 8px;">${order.customerName}</td>
        <td style="border: 1px solid #dee2e6; padding: 8px; font-weight: bold;">${order.orderCode}</td>
        <td style="border: 1px solid #dee2e6; padding: 8px;">${order.productName}</td>
        <td style="border: 1px solid #dee2e6; padding: 8px;">${order.vehicleNumber}</td>
        <td style="border: 1px solid #dee2e6; padding: 8px; text-align: center; font-weight: bold;">${order.plannedQuantity}</td>
        <td style="border: 1px solid #dee2e6; padding: 8px; text-align: center; color: ${isAccurate ? '#28a745' : '#dc3545'}; font-weight: bold;">${order.actualCount}</td>
        <td style="border: 1px solid #dee2e6; padding: 8px; text-align: center; color: ${isAccurate ? '#28a745' : '#dc3545'}; font-weight: bold;">${accuracy}%</td>
      </tr>
    `;
  });
  
  detailHTML += `
        </tbody>
      </table>
      
      <div style="margin-top: 15px; padding: 10px; background: #e9ecef; border-radius: 5px;">
        <strong>📊 Tổng kết:</strong><br>
        • Số đơn hàng: ${details.orders.length}<br>
        • Tổng kế hoạch: ${batchEntry.plannedQuantity}<br>
        • Tổng thực hiện: ${batchEntry.actualCount}<br>
        • Độ chính xác: ${batchEntry.plannedQuantity > 0 ? ((batchEntry.actualCount / batchEntry.plannedQuantity) * 100).toFixed(1) : 0}%
      </div>
    </div>
  `;
  
  // Tạo modal
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
    background: rgba(0,0,0,0.6); z-index: 10000; display: flex; 
    align-items: center; justify-content: center; padding: 20px;
  `;
  
  const content = document.createElement('div');
  content.style.cssText = `
    background: white; padding: 25px; border-radius: 10px; 
    max-width: 90%; max-height: 85%; overflow: hidden;
    box-shadow: 0 10px 30px rgba(0,0,0,0.3);
    position: relative;
  `;
  
  // Thêm nút đóng
  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '✕';
  closeBtn.style.cssText = `
    position: absolute; top: 10px; right: 15px; 
    background: none; border: none; font-size: 20px; 
    cursor: pointer; color: #666; z-index: 1;
  `;
  closeBtn.onclick = () => document.body.removeChild(modal);
  
  content.innerHTML = detailHTML;
  content.appendChild(closeBtn);
  modal.appendChild(content);
  document.body.appendChild(modal);
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  });
}

function clearHistory() {
  if (confirm('Bạn có chắc chắn muốn xóa toàn bộ lịch sử?')) {
    countingHistory = [];
    saveHistory();
    updateHistoryTable();
    showNotification('Xóa lịch sử thành công', 'info');
  }
}

// Data Persistence (Updated)
function loadOrderBatches() {
  const saved = localStorage.getItem('orderBatches');
  if (saved) {
    try {
      orderBatches = JSON.parse(saved);
      console.log('Loaded', orderBatches.length, 'batches from localStorage');
    } catch (error) {
      console.error('Error loading order batches:', error);
      orderBatches = [];
    }
  } else {
    console.log('No saved batches found, creating sample data');
    orderBatches = [
      {
        id: 1,
        name: 'Batch Demo',
        description: 'Batch mẫu để test',
        orders: [
          {
            id: 1,
            orderCode: 'DH001',
            customerName: 'Khách hàng A',
            vehicleNumber: '29A-12345',
            product: { id: 1, code: 'GAO001', name: 'Gạo thường' },
            quantity: 100,
            currentCount: 0,
            status: 'waiting',
            selected: true
          },
          {
            id: 2,
            orderCode: 'DH002', 
            customerName: 'Khách hàng B',
            vehicleNumber: '30B-67890',
            product: { id: 2, code: 'GAO002', name: 'Gạo thơm' },
            quantity: 150,
            currentCount: 0,
            status: 'waiting',
            selected: true
          }
        ],
        createdAt: new Date().toISOString(),
        isActive: true
      }
    ];
    saveOrderBatches();
  }
}

function saveOrderBatches() {
  try {
    localStorage.setItem('orderBatches', JSON.stringify(orderBatches));
    console.log('Saved', orderBatches.length, 'batches to localStorage');
  } catch (error) {
    console.error('Error saving order batches:', error);
  }
}

function loadProducts() {
  const saved = localStorage.getItem('products');
  if (saved) {
    currentProducts = JSON.parse(saved);
  }
  updateProductSelect();
}

function saveProducts() {
  localStorage.setItem('products', JSON.stringify(currentProducts));
}

function loadSettings() {
  // Load from localStorage first
  const saved = localStorage.getItem('settings');
  if (saved) {
    settings = { ...settings, ...JSON.parse(saved) };
  }
  
  // Then load from ESP32 to get latest settings
  loadSettingsFromESP32();
  
  updateSettingsForm();
}

// Load settings from ESP32
async function loadSettingsFromESP32() {
  try {
    const response = await fetch('/api/settings');
    if (response.ok) {
      const esp32Settings = await response.json();
      
      // Merge ESP32 settings with local settings
      if (esp32Settings.conveyorName) settings.conveyorName = esp32Settings.conveyorName;
      if (esp32Settings.ipAddress) settings.ipAddress = esp32Settings.ipAddress;
      if (esp32Settings.gateway) settings.gateway = esp32Settings.gateway;
      if (esp32Settings.subnet) settings.subnet = esp32Settings.subnet;
      if (esp32Settings.brightness !== undefined) settings.brightness = esp32Settings.brightness;
      if (esp32Settings.sensorDelay !== undefined) settings.sensorDelay = esp32Settings.sensorDelay;
      if (esp32Settings.bagDetectionDelay !== undefined) settings.bagDetectionDelay = esp32Settings.bagDetectionDelay;
      if (esp32Settings.minBagInterval !== undefined) settings.minBagInterval = esp32Settings.minBagInterval;
      if (esp32Settings.autoReset !== undefined) settings.autoReset = esp32Settings.autoReset;
      
      // Save to localStorage and update form
      localStorage.setItem('settings', JSON.stringify(settings));
      updateSettingsForm();
      
      console.log('Settings loaded from ESP32:', esp32Settings);
    }
  } catch (error) {
    console.error('Error loading settings from ESP32:', error);
  }
}

function updateSettingsForm() {
  document.getElementById('conveyorName').value = settings.conveyorName;
  document.getElementById('ipAddress').value = settings.ipAddress;
  document.getElementById('gateway').value = settings.gateway;
  document.getElementById('subnet').value = settings.subnet;
  document.getElementById('sensorDelay').value = settings.sensorDelay;
  document.getElementById('bagDetectionDelay').value = settings.bagDetectionDelay;
  document.getElementById('minBagInterval').value = settings.minBagInterval;
  document.getElementById('autoReset').checked = settings.autoReset;
  document.getElementById('brightness').value = settings.brightness;
  document.getElementById('brightnessValue').textContent = settings.brightness + '%';
}

// ESP32 Communication (Updated)
async function sendCommand(command, value = null) {
  try {
    const url = `http://${settings.ipAddress}/${command}${value !== null ? '?value=' + value : ''}`;
    const response = await fetch(url, { 
      method: 'GET',
      timeout: 5000
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error sending command:', error);
    showNotification('Lỗi kết nối với thiết bị', 'error');
    return null;
  }
}

// Gửi lệnh điều khiển đến ESP32
async function sendESP32Command(action, data = {}) {
  try {
    const payload = {
      cmd: action,
      ...data
    };
    
    console.log(`🚀 Sending ESP32 command: ${action}`, payload);
    
    const response = await fetch('/api/cmd', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const result = await response.text();
    console.log(`✅ ESP32 Command ${action} sent successfully:`, result);
    
    // 🔄 Đợi 200ms để ESP32 xử lý command trước khi tiếp tục
    if (action === 'next_order') {
      console.log('⏱️ Waiting for ESP32 to process next_order...');
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    return result;
    
  } catch (error) {
    console.error('❌ Error sending ESP32 command:', error);
    showNotification('Lỗi gửi lệnh đến ESP32: ' + error.message, 'error');
    return null;
  }
}

// Gửi toàn bộ batch đến ESP32
async function sendBatchToESP32(batch) {
  try {
    console.log('Sending batch to ESP32:', batch.name, 'with', batch.orders.length, 'orders');
    
    // Gửi từng đơn hàng trong batch
    for (let i = 0; i < batch.orders.length; i++) {
      const order = batch.orders[i];
      console.log(`Sending order ${i + 1}/${batch.orders.length}:`, order.customerName, '-', order.product.name);
      
      const result = await sendOrderToESP32(order);
      if (!result) {
        console.error(`Failed to send order ${i + 1}`);
        showNotification(`Lỗi gửi đơn hàng ${i + 1} đến ESP32`, 'error');
        return false;
      }
      
      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    console.log('All orders in batch sent to ESP32 successfully');
    showNotification(`Đã gửi ${batch.orders.length} đơn hàng đến ESP32`, 'success');
    return true;
    
  } catch (error) {
    console.error('Error sending batch to ESP32:', error);
    showNotification('Lỗi gửi danh sách đến ESP32: ' + error.message, 'error');
    return false;
  }
}

// Gửi đơn hàng đến ESP32
async function sendOrderToESP32(order) {
  try {
    const payload = {
      customerName: order.customerName,
      orderCode: order.orderCode,
      vehicleNumber: order.vehicleNumber,
      productName: order.product.name,
      quantity: order.quantity,
      warningQuantity: order.warningQuantity
    };
    
    console.log('New order saved to ESP32:');
    console.log('Customer:', payload.customerName);
    console.log('Order Code:', payload.orderCode);
    console.log('Vehicle:', payload.vehicleNumber);
    console.log('Product:', payload.productName);
    console.log('Quantity:', payload.quantity);
    console.log('Warning:', payload.warningQuantity);
    console.log('Full payload:', JSON.stringify(payload, null, 2));
    
    const response = await fetch('/api/new_orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });
    
    console.log('Response status:', response.status);
    console.log('Response ok:', response.ok);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('ESP32 response error:', errorText);
      throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
    }
    
    const result = await response.json();
    console.log('Order sent to ESP32 successfully:', result);
    
    // KIỂM TRA ESP32 ĐÃ LƯU ĐƯỢC CHƯA
    setTimeout(async () => {
      try {
        const checkResponse = await fetch('/api/orders');
        if (checkResponse.ok) {
          const orders = await checkResponse.json();
          console.log('ESP32 current orders after sending:', orders);
          
          const sentOrder = orders.find(o => 
            o.orderCode === payload.orderCode || 
            o.productName === payload.productName
          );
          
          if (sentOrder) {
            console.log('✅ Order confirmed saved in ESP32:', sentOrder);
          } else {
            console.log('❌ Order NOT found in ESP32 storage');
          }
        }
      } catch (error) {
        console.error('Error checking ESP32 orders:', error);
      }
    }, 500);
    
    return result;
    
  } catch (error) {
    console.error('Error sending order to ESP32:', error);
    showNotification('Lỗi gửi đơn hàng đến ESP32: ' + error.message, 'error');
    return null;
  }
}

// Gửi sản phẩm đến ESP32
async function sendProductToESP32(product) {
  try {
    const payload = {
      name: product.name,
      code: product.code,
      unitWeight: product.unitWeight
    };
    
    console.log('Sending product to ESP32:', payload);
    
    const response = await fetch('/api/products', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const resultText = await response.text();
    console.log('Product sent to ESP32 successfully:', resultText);
    
    // Try to parse as JSON, if fail use as text
    let result;
    try {
      result = JSON.parse(resultText);
    } catch (e) {
      result = { status: 'OK', message: resultText };
    }
    
    showNotification('Sản phẩm đã được gửi đến ESP32', 'success');
    return result;
    
  } catch (error) {
    console.error('Error sending product to ESP32:', error);
    showNotification('Lỗi gửi sản phẩm đến ESP32: ' + error.message, 'error');
    return null;
  }
}

// Đồng bộ tất cả sản phẩm đến ESP32 
async function syncAllProductsToESP32() {
  if (currentProducts.length > 0) {
    console.log('Syncing all products to ESP32...');
    for (const product of currentProducts) {
      await sendProductToESP32(product);
      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    console.log('All products synced to ESP32');
  }
}

async function getStatus() {
  try {
    const response = await fetch(`http://${settings.ipAddress}/status`, {
      method: 'GET',
      timeout: 3000
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    updateStatusFromDevice(data);
    return data;
  } catch (error) {
    console.error('Error getting status:', error);
    return null;
  }
}

function updateStatusFromDevice(data) {
  if (!data) return;
  
  // Update current count if device has new count
  if (data.count !== undefined) {
    const activeBatch = orderBatches.find(b => b.isActive);
    if (activeBatch && countingState.isActive) {
      const selectedOrders = activeBatch.orders.filter(o => o.selected);
      const currentOrderIndex = selectedOrders.findIndex(o => o.status === 'counting');
      
      if (currentOrderIndex >= 0) {
        const currentOrder = selectedOrders[currentOrderIndex];
        
        // Cập nhật tổng số đếm cho toàn bộ batch
        countingState.totalCounted = data.count;
        
        // Tính số đếm đã hoàn thành từ các đơn hàng trước đó
        let completedCount = 0;
        for (let i = 0; i < currentOrderIndex; i++) {
          completedCount += selectedOrders[i].quantity; // Lấy số lượng kế hoạch đã hoàn thành
        }
        
        // Số đếm hiện tại của đơn hàng = tổng đếm - đã hoàn thành
        currentOrder.currentCount = Math.max(0, data.count - completedCount);
        
        console.log(`📊 Đơn ${currentOrderIndex + 1}/${selectedOrders.length}: Tổng=${data.count}, Đã xong=${completedCount}, Hiện tại=${currentOrder.currentCount}/${currentOrder.quantity}`);
        
        // Kiểm tra xem đơn hàng hiện tại đã hoàn thành chưa
        if (currentOrder.currentCount >= currentOrder.quantity) {
          currentOrder.currentCount = currentOrder.quantity; // Đảm bảo không vượt quá
          currentOrder.status = 'completed';
          
          console.log(`✅ Hoàn thành đơn ${currentOrderIndex + 1}: ${currentOrder.customerName} - ${currentOrder.product.name}`);
          console.log(`📊 Final count: ${currentOrder.currentCount}/${currentOrder.quantity}`);
          
          // Lưu đơn hàng vào lịch sử đơn lẻ
          const historyEntry = {
            timestamp: new Date().toISOString(),
            customerName: currentOrder.customerName,
            productName: currentOrder.product.name,
            orderCode: currentOrder.orderCode,
            vehicleNumber: currentOrder.vehicleNumber,
            plannedQuantity: currentOrder.quantity,
            actualCount: currentOrder.currentCount
          };
          
          countingHistory.push(historyEntry);
          saveHistory();
          
          // KIỂM TRA XEM CÒN ĐƠN HÀNG TIẾP THEO KHÔNG
          if (currentOrderIndex < selectedOrders.length - 1) {
            // VẪN CÒN ĐƠN HÀNG TIẾP THEO - CHUYỂN ĐƠN
            console.log(`➡️ Còn ${selectedOrders.length - currentOrderIndex - 1} đơn hàng nữa`);
            setTimeout(async () => {
              console.log('🔄 Calling moveToNextOrder from updateStatusFromDevice');
              await moveToNextOrder();
              
              // 🔄 FORCE REFRESH UI SAU KHI CHUYỂN ĐƠN
              setTimeout(() => {
                console.log('🔄 Force refreshing UI after moveToNextOrder from updateStatusFromDevice');
                updateOrderTable();
                updateOverview();
              }, 200);
            }, 500);
          } else {
            // ĐÂY MỚI LÀ HOÀN THÀNH TẤT CẢ
            console.log(`🎉 HOÀN THÀNH TẤT CẢ ${selectedOrders.length} ĐƠN HÀNG!`);
            countingState.isActive = false;
            sendESP32Command('stop');
            
            // LƯU TOÀN BỘ BATCH VÀO LỊCH SỬ ĐẾM CHÍNH
            saveBatchToCountingHistory(activeBatch, selectedOrders);
            
            showNotification(`🎉 Hoàn thành tất cả ${selectedOrders.length} đơn hàng được chọn!`, 'success');
          }
        }
        
        saveOrderBatches();
        updateOrderTable();
        updateOverview();
      }
    }
  }
}

async function moveToNextOrder() {
  const activeBatch = orderBatches.find(b => b.isActive);
  if (!activeBatch) return;
  
  const selectedOrders = activeBatch.orders.filter(o => o.selected);
  
  // Tìm đơn hàng đang counting
  const currentOrderIndex = selectedOrders.findIndex(o => o.status === 'counting');
  
  if (currentOrderIndex >= 0) {
    // Đánh dấu đơn hàng hiện tại hoàn thành
    selectedOrders[currentOrderIndex].status = 'completed';
    
    // Kiểm tra còn đơn hàng tiếp theo không
    if (currentOrderIndex < selectedOrders.length - 1) {
      // CHUYỂN SANG ĐƠN HÀNG TIẾP THEO
      const nextOrder = selectedOrders[currentOrderIndex + 1];
      nextOrder.status = 'counting';  // QUAN TRỌNG: Phải set trạng thái counting
      countingState.currentOrderIndex = currentOrderIndex + 1;
      
      console.log(`Chuyen sang don ${countingState.currentOrderIndex + 1}/${selectedOrders.length}: ${nextOrder.customerName}`);
      console.log(`Status updated: ${nextOrder.orderCode} -> counting`);
      
      // Gửi lệnh set_current_order đến ESP32 (dễ xử lý hơn next_order)
      await sendESP32Command('set_current_order', {
        orderCode: nextOrder.orderCode,
        customerName: nextOrder.customerName,
        productName: nextOrder.product.name,
        target: nextOrder.quantity,
        warningQuantity: nextOrder.warningQuantity,
        orderIndex: countingState.currentOrderIndex,
        totalOrders: selectedOrders.length,
        keepCount: true, // Không reset count
        isRunning: true  // Đảm bảo ESP32 biết phải tiếp tục chạy
      });
      
      console.log('ESP32 next_order command sent, updating UI...');
      
      showNotification(`Chuyen den don ${countingState.currentOrderIndex + 1}/${selectedOrders.length}: ${nextOrder.customerName}`, 'info');
      
    } else {
      // HẾT ĐƠN HÀNG - HOÀN THÀNH TẤT CẢ
      console.log('🎉 Hoàn thành tất cả đơn hàng!');
      countingState.isActive = false;
      sendESP32Command('stop');
      
      // Lưu batch vào lịch sử
      saveBatchToCountingHistory(activeBatch, selectedOrders);
      showNotification(`🎉 Hoàn thành tất cả ${selectedOrders.length} đơn hàng!`, 'success');
    }
  }
  
  // CẬP NHẬT NGAY LẬP TỨC
  saveOrderBatches();
  updateOrderTable();
  updateOverview();
  
  // 🔄 Force refresh UI to ensure order transition is visible
  setTimeout(() => {
    console.log('🔄 Force refreshing UI after order transition');
    updateOrderTable();
    updateOverview();
  }, 100);
}

// Hàm lưu batch vào lịch sử đếm chính (tab Lịch sử đếm)
function saveBatchToCountingHistory(batch, completedOrders) {
  const now = new Date();
  
  // Tạo entry tổng cho batch
  const batchEntry = {
    timestamp: now.toISOString(),
    customerName: `📦 Danh sách: ${batch.name}`,
    productName: `${completedOrders.length} đơn hàng`,
    orderCode: `BATCH_${batch.id}`,
    vehicleNumber: 'Nhiều xe',
    plannedQuantity: completedOrders.reduce((sum, o) => sum + o.quantity, 0),
    actualCount: countingState.totalCounted,
    isBatch: true,
    batchDetails: {
      batchName: batch.name,
      description: batch.description || '',
      orders: completedOrders.map(order => ({
        orderCode: order.orderCode,
        customerName: order.customerName,
        productName: order.product.name,
        vehicleNumber: order.vehicleNumber,
        plannedQuantity: order.quantity,
        actualCount: order.currentCount
      }))
    }
  };
  
  // Thêm vào lịch sử đếm chính
  countingHistory.push(batchEntry);
  saveHistory();
  
  console.log('✅ Đã lưu batch vào lịch sử đếm:', batch.name);
  console.log('📊 Tổng kế hoạch:', batchEntry.plannedQuantity, '- Tổng thực hiện:', batchEntry.actualCount);
  
  // Cập nhật bảng lịch sử
  updateHistoryTable();
}

// Hàm lưu lịch sử hoàn thành batch (giữ lại cho tương thích)
function saveBatchCompletionHistory(batch, completedOrders) {
  // Gọi hàm mới
  saveBatchToCountingHistory(batch, completedOrders);
}

// Settings Management (Updated)
function saveGeneralSettings() {
  settings.conveyorName = document.getElementById('conveyorName').value;
  settings.ipAddress = document.getElementById('ipAddress').value;
  settings.gateway = document.getElementById('gateway').value;
  settings.subnet = document.getElementById('subnet').value;
  settings.sensorDelay = parseInt(document.getElementById('sensorDelay').value);
  settings.bagDetectionDelay = parseInt(document.getElementById('bagDetectionDelay').value);
  settings.minBagInterval = parseInt(document.getElementById('minBagInterval').value);
  settings.autoReset = document.getElementById('autoReset').checked;
  settings.brightness = parseInt(document.getElementById('brightness').value);
  
  console.log('Saving settings:', settings);
  
  saveSettings();
  
  // CẬP NHẬT TÊN BĂNG TẢI NGAY LẬP TỨC
  const conveyorIdElement = document.getElementById('conveyorId');
  if (conveyorIdElement) {
    conveyorIdElement.textContent = settings.conveyorName;
    console.log('Conveyor name display updated immediately to:', settings.conveyorName);
  }
  
  showNotification('Lưu cài đặt thành công', 'success');
}

// Kiểm tra dữ liệu ESP32
async function checkESP32Data() {
  try {
    console.log('=== CHECKING ESP32 DATA ===');
    
    // Check status
    const statusResponse = await fetch('/api/status');
    if (statusResponse.ok) {
      const statusData = await statusResponse.json();
      console.log('📊 ESP32 Status:', statusData);
    }
    
    // Check orders
    const ordersResponse = await fetch('/api/orders');
    if (ordersResponse.ok) {
      const ordersData = await ordersResponse.json();
      console.log('📋 ESP32 Orders (' + ordersData.length + '):', ordersData);
    }
    
    // Check products
    const productsResponse = await fetch('/api/products');
    if (productsResponse.ok) {
      const productsData = await productsResponse.json();
      console.log('📦 ESP32 Products (' + productsData.length + '):', productsData);
    }
    
    // Check settings
    const settingsResponse = await fetch('/api/settings');
    if (settingsResponse.ok) {
      const settingsData = await settingsResponse.json();
      console.log('⚙️ ESP32 Settings:', settingsData);
    }
    
    console.log('=== END ESP32 DATA CHECK ===');
    showNotification('Đã kiểm tra dữ liệu ESP32 - xem console (F12)', 'info');
    
  } catch (error) {
    console.error('Error checking ESP32 data:', error);
    showNotification('Lỗi kiểm tra dữ liệu ESP32: ' + error.message, 'error');
  }
}

// UI Functions (Updated)
function showTab(tabName) {
  // Hide all tabs
  const tabs = document.querySelectorAll('.tab-pane');
  tabs.forEach(tab => {
    tab.style.display = 'none';
    tab.classList.remove('active');
  });
  
  // Remove active class from all tab buttons
  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach(btn => btn.classList.remove('active'));
  
  // Show selected tab
  const selectedTab = document.getElementById(tabName);
  if (selectedTab) {
    selectedTab.style.display = 'block';
    selectedTab.classList.add('active');
  }
  
  // Add active class to selected tab button
  const selectedButton = document.querySelector(`[onclick="showTab('${tabName}')"]`);
  if (selectedButton) {
    selectedButton.classList.add('active');
  }
  
  // Update content based on tab
  switch(tabName) {
    case 'overview':
      updateOverview();
      updateBatchDisplay();
      break;
    case 'history':
      updateHistoryTable();
      break;
    case 'order':
      // Order tab logic
      break;
    case 'product':
      updateProductTable();
      break;
    case 'wifi':
      initWiFiTab();
      break;
    case 'settings':
      updateSettingsForm();
      break;
  }
}

function showNotification(message, type = 'info') {
  // Create notification element
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.innerHTML = `
    <i class="fas fa-${type === 'success' ? 'check-circle' : 
                     type === 'error' ? 'exclamation-circle' : 
                     type === 'warning' ? 'exclamation-triangle' : 'info-circle'}"></i>
    ${message}
  `;
  
  // Add to page
  document.body.appendChild(notification);
  
  // Auto remove after 3 seconds
  setTimeout(() => {
    notification.remove();
  }, 3000);
}

// Debug function
function debugBatches() {
  console.log('=== DEBUG BATCHES ===');
  console.log('orderBatches length:', orderBatches.length);
  console.log('orderBatches:', orderBatches);
  
  const saved = localStorage.getItem('orderBatches');
  console.log('localStorage data:', saved);
  
  const activeBatch = orderBatches.find(b => b.isActive);
  console.log('Active batch:', activeBatch);
  
  return {
    batches: orderBatches,
    localStorage: saved,
    activeBatch: activeBatch
  };
}

// Make debug function available globally
window.debugBatches = debugBatches;

// Tab Management
function showTab(tabName) {
  // Hide all tab panes
  const tabPanes = document.querySelectorAll('.tab-pane');
  tabPanes.forEach(pane => {
    pane.classList.remove('active');
  });
  
  // Remove active class from all tab buttons
  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach(btn => {
    btn.classList.remove('active');
  });
  
  // Show selected tab pane
  const selectedPane = document.getElementById(tabName);
  if (selectedPane) {
    selectedPane.classList.add('active');
  }
  
  // Add active class to selected tab button
  const selectedButton = document.querySelector(`[data-tab="${tabName}"]`);
  if (selectedButton) {
    selectedButton.classList.add('active');
  }
  
  // Refresh content when switching tabs
  switch(tabName) {
    case 'overview':
      updateOverview();
      break;
    case 'history':
      updateHistoryDisplay();
      break;
    case 'order':
      updateProductSelect();
      break;
    case 'product':
      updateProductTable();
      break;
    case 'settings':
      updateSettingsForm();
      break;
  }
}

// Mode Management
function setMode(mode) {
  currentMode = mode;
  
  // Update button states
  const inputBtn = document.querySelector('.input-btn');
  const outputBtn = document.querySelector('.output-btn');
  
  inputBtn.classList.remove('active');
  outputBtn.classList.remove('active');
  
  if (mode === 'input') {
    inputBtn.classList.add('active');
  } else {
    outputBtn.classList.add('active');
  }
  
  updateOverview();
}

// Product Management
function addProduct() {
  const productCode = document.getElementById('productCode').value.trim();
  const productName = document.getElementById('productName').value.trim();
  
  if (!productCode || !productName) {
    alert('Vui lòng nhập đầy đủ mã sản phẩm và tên sản phẩm');
    return;
  }
  
  // Check if product code already exists
  if (currentProducts.find(p => p.code === productCode)) {
    alert('Mã sản phẩm đã tồn tại');
    return;
  }
  
  const newProduct = {
    id: Date.now(),
    code: productCode,
    name: productName
  };
  
  currentProducts.push(newProduct);
  saveProducts();
  updateProductTable();
  updateProductSelect();
  
  // Clear form
  document.getElementById('productCode').value = '';
  document.getElementById('productName').value = '';
  
  showNotification('Thêm sản phẩm thành công', 'success');
}

function deleteProduct(id) {
  if (confirm('Bạn có chắc chắn muốn xóa sản phẩm này?')) {
    currentProducts = currentProducts.filter(p => p.id !== id);
    saveProducts();
    updateProductTable();
    updateProductSelect();
    showNotification('Xóa sản phẩm thành công', 'success');
  }
}

function updateProductTable() {
  const tbody = document.getElementById('productTableBody');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  currentProducts.forEach(product => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${product.code}</td>
      <td>${product.name}</td>
      <td>
        <button class="btn-danger" onclick="deleteProduct(${product.id})" style="padding: 5px 10px; font-size: 12px;">
          <i class="fas fa-trash"></i>
        </button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

function updateProductSelect() {
  const select = document.getElementById('productSelect');
  if (!select) return;
  
  select.innerHTML = '<option value="">Chọn sản phẩm</option>';
  
  currentProducts.forEach(product => {
    const option = document.createElement('option');
    option.value = product.id;
    option.textContent = `${product.code} - ${product.name}`;
    select.appendChild(option);
  });
}

// Order Management
function addOrder() {
  const customerName = document.getElementById('customerName').value.trim();
  const orderCode = document.getElementById('orderCode').value.trim();
  const vehicleNumber = document.getElementById('vehicleNumber').value.trim();
  const productId = document.getElementById('productSelect').value;
  const quantity = parseInt(document.getElementById('quantity').value);
  const warningQuantity = parseInt(document.getElementById('warningQuantity').value) || Math.floor(quantity * 0.1);
  
  if (!customerName || !orderCode || !vehicleNumber || !productId || !quantity) {
    alert('Vui lòng điền đầy đủ thông tin đơn hàng');
    return;
  }
  
  const product = currentProducts.find(p => p.id == productId);
  if (!product) {
    alert('Sản phẩm không hợp lệ');
    return;
  }
  
  const newOrder = {
    id: Date.now(),
    orderNumber: currentOrders.length + 1,
    customerName,
    orderCode,
    vehicleNumber,
    product,
    quantity,
    warningQuantity,
    currentCount: 0,
    status: 'waiting', // waiting, active, completed, paused
    selected: false,
    createdAt: new Date().toISOString()
  };
  
  currentOrders.push(newOrder);
  saveOrders();
  updateOrderTable();
  
  showNotification('Thêm đơn hàng thành công', 'success');
}

function saveOrder() {
  saveOrders();
  showNotification('Lưu danh sách đơn hàng thành công', 'success');

  
  historyList.innerHTML = '';
  
  if (countingHistory.length === 0) {
    historyList.innerHTML = '<p class="text-center">Chưa có lịch sử đếm</p>';
    return;
  }
  
  countingHistory.reverse().forEach(item => {
    const historyItem = document.createElement('div');
    historyItem.className = 'history-item';
    historyItem.innerHTML = `
      <h5>${item.orderCode} - ${item.productName}</h5>
      <p><i class="fas fa-user"></i> Khách hàng: ${item.customerName}</p>
      <p><i class="fas fa-truck"></i> Xe: ${item.vehicleNumber}</p>
      <p><i class="fas fa-calculator"></i> Số lượng: ${item.count}/${item.target}</p>
      <p><i class="fas fa-clock"></i> Thời gian: ${new Date(item.timestamp).toLocaleString('vi-VN')}</p>
    `;
    historyList.appendChild(historyItem);
  });
}

function filterHistory() {
  // Implementation for filtering history by date range
  const dateFrom = document.getElementById('dateFrom').value;
  const dateTo = document.getElementById('dateTo').value;
  
  if (!dateFrom || !dateTo) {
    updateHistoryDisplay();
    return;
  }
  
  const filteredHistory = countingHistory.filter(item => {
    const itemDate = new Date(item.timestamp).toISOString().split('T')[0];
    return itemDate >= dateFrom && itemDate <= dateTo;
  });
  
  // Display filtered results
  const historyList = document.getElementById('historyList');
  if (!historyList) return;
  
  historyList.innerHTML = '';
  
  if (filteredHistory.length === 0) {
    historyList.innerHTML = '<p class="text-center">Không tìm thấy dữ liệu trong khoảng thời gian này</p>';
    return;
  }
  
  filteredHistory.reverse().forEach(item => {
    const historyItem = document.createElement('div');
    historyItem.className = 'history-item';
    historyItem.innerHTML = `
      <h5>${item.orderCode} - ${item.productName}</h5>
      <p><i class="fas fa-user"></i> Khách hàng: ${item.customerName}</p>
      <p><i class="fas fa-truck"></i> Xe: ${item.vehicleNumber}</p>
      <p><i class="fas fa-calculator"></i> Số lượng: ${item.count}/${item.target}</p>
      <p><i class="fas fa-clock"></i> Thời gian: ${new Date(item.timestamp).toLocaleString('vi-VN')}</p>
    `;
    historyList.appendChild(historyItem);
  });
}

function exportHistory() {
  if (countingHistory.length === 0) {
    alert('Không có dữ liệu để xuất');
    return;
  }
  
  let csvContent = "data:text/csv;charset=utf-8,";
  csvContent += "Mã đơn hàng,Khách hàng,Sản phẩm,Xe,Số lượng,Mục tiêu,Thời gian\n";
  
  countingHistory.forEach(item => {
    csvContent += `${item.orderCode},${item.customerName},${item.productName},${item.vehicleNumber},${item.count},${item.target},${new Date(item.timestamp).toLocaleString('vi-VN')}\n`;
  });
  
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `lich_su_dem_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  showNotification('Xuất dữ liệu thành công', 'success');
}

function clearHistory() {
  if (confirm('Bạn có chắc chắn muốn xóa toàn bộ lịch sử đếm?')) {
    countingHistory = [];
    saveHistory();
    updateHistoryDisplay();
    showNotification('Xóa lịch sử thành công', 'success');
  }
}

// Settings Management
function updateSettingsForm() {
  document.getElementById('conveyorName').value = settings.conveyorName;
  document.getElementById('ipAddress').value = settings.ipAddress;
  document.getElementById('gateway').value = settings.gateway;
  document.getElementById('subnet').value = settings.subnet;
  document.getElementById('sensorDelay').value = settings.sensorDelay;
  document.getElementById('autoReset').checked = settings.autoReset;
  document.getElementById('brightness').value = settings.brightness;
  document.getElementById('brightnessValue').textContent = settings.brightness + '%';
}

function saveSettings() {
  settings.conveyorName = document.getElementById('conveyorName').value;
  settings.ipAddress = document.getElementById('ipAddress').value;
  settings.gateway = document.getElementById('gateway').value;
  settings.subnet = document.getElementById('subnet').value;
  settings.sensorDelay = parseInt(document.getElementById('sensorDelay').value);
  settings.autoReset = document.getElementById('autoReset').checked;
  settings.brightness = parseInt(document.getElementById('brightness').value);
  
  localStorage.setItem('bagCounterSettings', JSON.stringify(settings));
  
  // Send settings to ESP32
  sendSettingsToESP32();
  
  updateOverview();
  showNotification('Lưu cài đặt thành công', 'success');
}

// ESP32 Communication
function sendCommand(command) {
  const data = {
    cmd: command
  };
  
  fetch('/api/cmd', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data)
  })
  .then(response => response.text())
  .then(data => {
    console.log('Command sent:', command);
  })
  .catch(error => {
    console.error('Error sending command:', error);
    showNotification('Lỗi kết nối với thiết bị', 'error');
  });
}

function sendRemoteCommand(command) {
  console.log('Sending remote command:', command);
  
  const data = {
    cmd: 'REMOTE',
    button: command
  };
  
  fetch('/api/cmd', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data)
  })
  .then(response => response.json())
  .then(data => {
    console.log('Remote command sent:', command);
    showNotification(`Gửi lệnh: ${command}`, 'success');
  })
  .catch(error => {
    console.error('Error sending remote command:', error);
    showNotification('Lỗi gửi lệnh điều khiển', 'error');
  });
}

function sendSettingsToESP32() {
  // Send network settings and other configurations to ESP32
  const data = {
    conveyorName: settings.conveyorName,
    brightness: settings.brightness,
    sensorDelay: settings.sensorDelay,
    bagDetectionDelay: settings.bagDetectionDelay,
    minBagInterval: settings.minBagInterval,
    autoReset: settings.autoReset,
    // Network settings
    ipAddress: settings.ipAddress,
    gateway: settings.gateway,
    subnet: settings.subnet,
    dns1: "8.8.8.8",
    dns2: "8.8.4.4"
  };
  
  fetch('/api/settings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data)
  })
  .then(response => response.json())
  .then(result => {
    console.log('Settings sent to ESP32:', result);
    if (result.needRestart) {
      // Hiển thị thông báo cần restart
      if (confirm('IP Address đã thay đổi. Cần khởi động lại ESP32 để áp dụng. Khởi động lại ngay?')) {
        restartESP32();
      } else {
        showNotification('Lưu ý: Cần khởi động lại ESP32 để áp dụng IP mới', 'warning');
      }
    } else {
      showNotification('Cài đặt đã được áp dụng', 'success');
    }
  })
  .catch(error => {
    console.error('Error sending settings:', error);
    showNotification('Lỗi gửi cài đặt đến ESP32', 'error');
  });
}

// Hàm restart ESP32
function restartESP32() {
  fetch('/api/restart', {
    method: 'POST'
  })
  .then(() => {
    showNotification('Đang khởi động lại ESP32...', 'info');
    // Chờ một chút rồi reload trang với IP mới
    setTimeout(() => {
      window.location.href = `http://${settings.ipAddress}`;
    }, 3000);
  })
  .catch(error => {
    console.error('Error restarting ESP32:', error);
  });
}

function startStatusPolling() {
  console.log('Starting status polling...');
  
  let lastStatus = '';
  let lastCount = 0;
  
  setInterval(async () => {
    try {
      const response = await fetch('/api/status');
      if (response.ok) {
        const data = await response.json();
        
        const activeBatch = orderBatches.find(b => b.isActive);
        if (!activeBatch) {
          // KHÔNG CÓ BATCH ACTIVE - CHỈ HIỂN thị TRẠNG THÁI
          updateDisplayOnly(data);
          lastStatus = data.status || '';
          lastCount = data.count || 0;
          return;
        }
        
        const selectedOrders = activeBatch.orders.filter(o => o.selected);
        if (selectedOrders.length === 0) {
          updateDisplayOnly(data);
          lastStatus = data.status || '';
          lastCount = data.count || 0;
          return;
        }
        
        // KIỂM TRA LỆNH IR REMOTE
        const statusChanged = lastStatus !== (data.status || '');
        
        if (statusChanged && data.status) {
          console.log('🎮 IR Remote command detected:', lastStatus, '→', data.status);
          
          if (data.status === 'RUNNING' && !countingState.isActive) {
            // IR REMOTE START - GOI HAM startCounting() GIONG WEB
            console.log('IR Remote START detected - calling startCounting()');
            startCounting(); // Goi dung ham nhu web
            
          } else if (data.status === 'RUNNING' && countingState.isActive) {
            // 🔄 ESP32 TRẢ VỀ RUNNING - CÓ THỂ LÀ SAU KHI CHUYỂN ĐƠN
            console.log('🔄 ESP32 confirms RUNNING status - ensuring current order is counting');
            
            // Đảm bảo đơn hàng hiện tại đang ở trạng thái counting
            if (countingState.currentOrderIndex < selectedOrders.length) {
              const currentOrder = selectedOrders[countingState.currentOrderIndex];
              if (currentOrder.status !== 'counting' && currentOrder.status !== 'completed') {
                console.log(`🔄 Fixing order ${countingState.currentOrderIndex + 1} status: ${currentOrder.status} → counting`);
                currentOrder.status = 'counting';
                
                // ✅ CẬP NHẬT UI NGAY LẬP TỨC
                saveOrderBatches();
                updateOrderTable();
                updateOverview();
                
                // 🔄 Force refresh UI
                setTimeout(() => {
                  console.log('🔄 Force refreshing UI after status fix');
                  updateOrderTable();
                  updateOverview();
                }, 100);
              }
            }
            
          } else if (data.status === 'PAUSE') {
            // IR REMOTE PAUSE - GOI HAM pauseCounting() GIONG WEB
            console.log('IR Remote PAUSE detected - calling pauseCounting()');
            pauseCounting(); // Goi dung ham nhu web
            
          } else if (data.status === 'RESET') {
            // IR REMOTE RESET - GOI HAM resetCounting() GIONG WEB
            console.log('IR Remote RESET detected - calling resetCounting()');
            resetCounting(); // Goi dung ham nhu web
          }
        }
        
        // 📊 Cập nhật số đếm (chỉ khi có thay đổi)
        if (data.count !== undefined && data.count !== lastCount) {
          console.log('📊 Count update from ESP32:', lastCount, '→', data.count);
          console.log('📊 Current counting state:', {
            isActive: countingState.isActive,
            currentOrderIndex: countingState.currentOrderIndex,
            totalCounted: countingState.totalCounted,
            totalPlanned: countingState.totalPlanned,
            selectedOrdersCount: selectedOrders.length
          });
          updateStatusFromDevice(data);
          lastCount = data.count;
        }
        
        lastStatus = data.status || '';
        
        // Cập nhật display
        updateDisplayElements(data);
      }
    } catch (error) {
      console.error('Error polling status:', error);
    }
  }, 1000);
}

// Hàm cập nhật chỉ hiển thị khi không có batch hoặc không có orders được chọn
function updateDisplayOnly(data) {
  const executeCountElement = document.getElementById('executeCount');
  if (executeCountElement) {
    executeCountElement.textContent = data.count || 0;
  }
  
  updateDisplayElements(data);
}

// Hàm cập nhật các elements hiển thị
function updateDisplayElements(data) {
  const executeCountElement = document.getElementById('executeCount');
  if (executeCountElement) {
    executeCountElement.textContent = data.count || 0;
  }
  
  const startTimeElement = document.getElementById('startTime');
  if (startTimeElement && data.startTime) {
    startTimeElement.textContent = data.startTime;
  }
  
  // Cập nhật tên băng tải
  if (data.conveyorName) {
    const conveyorIdElement = document.getElementById('conveyorId');
    if (conveyorIdElement && conveyorIdElement.textContent !== data.conveyorName) {
      conveyorIdElement.textContent = data.conveyorName;
    }
  }
}

// Hàm sync trạng thái orders từ ESP32 về localStorage
function updateOrderStatusFromESP32(esp32Orders) {
  try {
    if (!Array.isArray(esp32Orders)) {
      console.log('ESP32 orders data is not an array:', esp32Orders);
      return;
    }
    
    console.log('Syncing orders from ESP32:', esp32Orders.length, 'orders');
    
    // Tìm batch đang active
    const activeBatch = orderBatches.find(b => b.isActive);
    if (!activeBatch) {
      console.log('No active batch found for sync');
      return;
    }
    
    // Log để debug
    console.log('Active batch:', activeBatch.name, 'has', activeBatch.orders.length, 'orders');
    
    // Cập nhật trạng thái các orders từ ESP32
    let hasChanges = false;
    esp32Orders.forEach((esp32Order, index) => {
      console.log(`ESP32 Order ${index}:`, esp32Order);
      
      // Tìm order tương ứng trong localStorage theo orderCode hoặc productName
      const localOrder = activeBatch.orders.find(o => 
        o.orderCode === esp32Order.orderCode ||
        o.product.name === esp32Order.productName ||
        o.product.name.toLowerCase() === esp32Order.productName?.toLowerCase()
      );
      
      if (localOrder) {
        console.log(`Found matching local order:`, localOrder.orderCode, '-', localOrder.product.name);
        
        // Sync số đếm từ ESP32
        if (esp32Order.currentCount !== undefined && localOrder.currentCount !== esp32Order.currentCount) {
          console.log(`Syncing count: ${localOrder.currentCount} -> ${esp32Order.currentCount}`);
          localOrder.currentCount = esp32Order.currentCount;
          hasChanges = true;
        }
        
        // Sync status nếu ESP32 có cung cấp
        if (esp32Order.status && localOrder.status !== esp32Order.status) {
          console.log(`Syncing status: ${localOrder.status} -> ${esp32Order.status}`);
          localOrder.status = esp32Order.status;
          hasChanges = true;
        }
      } else {
        console.log(`No matching local order found for ESP32 order:`, esp32Order.productName || esp32Order.orderCode);
      }
    });
    
    // Lưu và cập nhật UI nếu có thay đổi
    if (hasChanges) {
      saveOrderBatches();
      updateBatchDisplay();
      updateOrderTable();
      updateOverview();
      console.log('Order data synced from ESP32');
    }
    
  } catch (error) {
    console.error('Error updating order status from ESP32:', error);
  }
}

// Data Persistence functions moved to earlier section

// Notifications
function showNotification(message, type = 'info') {
  // Create notification element
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.innerHTML = `
    <div class="notification-content">
      <i class="fas fa-${getNotificationIcon(type)}"></i>
      <span>${message}</span>
    </div>
  `;
  
  // Add styles
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${getNotificationColor(type)};
    color: white;
    padding: 15px 20px;
    border-radius: 5px;
    box-shadow: 0 4px 15px rgba(0,0,0,0.2);
    z-index: 1000;
    animation: slideIn 0.3s ease;
  `;
  
  document.body.appendChild(notification);
  
  // Remove after 3 seconds
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => {
      document.body.removeChild(notification);
    }, 300);
  }, 3000);
}

function getNotificationIcon(type) {
  switch(type) {
    case 'success': return 'check-circle';
    case 'error': return 'exclamation-circle';
    case 'warning': return 'exclamation-triangle';
    default: return 'info-circle';
  }
}

function getNotificationColor(type) {
  switch(type) {
    case 'success': return '#28a745';
    case 'error': return '#dc3545';
    case 'warning': return '#ffc107';
    default: return '#17a2b8';
  }
}

// WiFi Configuration Functions
function refreshNetworkStatus() {
  fetch('/api/network/status')
    .then(response => response.json())
    .then(data => {
      const modeElement = document.getElementById('currentNetworkMode');
      const ipElement = document.getElementById('currentIP');
      const ssidElement = document.getElementById('currentSSID');
      const ssidContainer = document.getElementById('wifiSSIDStatus');
      
      if (modeElement) {
        let modeText = '';
        switch(data.current_mode) {
          case 'ethernet': modeText = '🌐 Ethernet'; break;
          case 'wifi_sta': modeText = '📶 WiFi Station'; break;
          case 'wifi_ap': modeText = '📡 WiFi Access Point'; break;
          default: modeText = '❌ Không xác định';
        }
        modeElement.textContent = modeText;
      }
      
      if (ipElement) {
        ipElement.textContent = data.ip || 'Không có';
      }
      
      if (data.current_mode === 'wifi_sta' && data.ssid) {
        if (ssidElement) ssidElement.textContent = data.ssid;
        if (ssidContainer) ssidContainer.style.display = 'flex';
      } else if (data.current_mode === 'wifi_ap' && data.ap_ssid) {
        if (ssidElement) ssidElement.textContent = data.ap_ssid + ' (AP Mode)';
        if (ssidContainer) ssidContainer.style.display = 'flex';
      } else {
        if (ssidContainer) ssidContainer.style.display = 'none';
      }
    })
    .catch(error => {
      console.error('Error fetching network status:', error);
      showNotification('Lỗi khi lấy trạng thái mạng', 'error');
    });
}

function scanWiFiNetworks() {
  const scanBtn = document.getElementById('scanBtn');
  const networksContainer = document.getElementById('wifiNetworks');
  
  if (scanBtn) {
    scanBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang quét...';
    scanBtn.disabled = true;
  }
  
  fetch('/api/wifi/scan')
    .then(response => response.json())
    .then(data => {
      if (networksContainer) {
        networksContainer.innerHTML = '';
        
        if (data.networks && data.networks.length > 0) {
          data.networks.forEach(network => {
            const networkItem = createWiFiNetworkItem(network);
            networksContainer.appendChild(networkItem);
          });
        } else {
          networksContainer.innerHTML = '<p style="text-align: center; color: #6c757d;">Không tìm thấy mạng WiFi nào</p>';
        }
      }
    })
    .catch(error => {
      console.error('Error scanning WiFi:', error);
      showNotification('Lỗi khi quét WiFi', 'error');
      if (networksContainer) {
        networksContainer.innerHTML = '<p style="text-align: center; color: #dc3545;">Lỗi khi quét mạng WiFi</p>';
      }
    })
    .finally(() => {
      if (scanBtn) {
        scanBtn.innerHTML = '<i class="fas fa-search"></i> Quét mạng WiFi';
        scanBtn.disabled = false;
      }
    });
}

function createWiFiNetworkItem(network) {
  const item = document.createElement('div');
  item.className = 'wifi-network-item';
  
  const signalStrength = getSignalStrength(network.rssi);
  const securityIcon = network.encrypted ? '🔒' : '🔓';
  
  item.innerHTML = `
    <div class="wifi-network-info">
      <div class="wifi-network-ssid">${securityIcon} ${network.ssid}</div>
      <div class="wifi-network-details">
        ${network.encrypted ? 'Bảo mật' : 'Mở'} • Signal: ${network.rssi} dBm
      </div>
    </div>
    <div class="wifi-network-signal">
      <span class="signal-strength ${signalStrength.class}">${signalStrength.text}</span>
      <i class="fas fa-wifi ${signalStrength.class}"></i>
    </div>
  `;
  
  item.onclick = () => {
    document.getElementById('manualSSID').value = network.ssid;
    document.getElementById('manualPassword').focus();
  };
  
  return item;
}

function getSignalStrength(rssi) {
  if (rssi >= -50) return { text: 'Xuất sắc', class: 'signal-excellent' };
  if (rssi >= -70) return { text: 'Tốt', class: 'signal-good' };
  return { text: 'Yếu', class: 'signal-poor' };
}

function toggleStaticIPFields() {
  const useStaticIP = document.getElementById('useStaticIP').checked;
  const staticIPFields = document.getElementById('staticIPFields');
  
  if (staticIPFields) {
    staticIPFields.style.display = useStaticIP ? 'block' : 'none';
    
    // Auto-fill with suggested values when enabling static IP for the first time
    if (useStaticIP) {
      const staticIPInput = document.getElementById('staticIP');
      // Only auto-fill if the field is empty
      if (!staticIPInput.value) {
        fillSuggestedStaticIPValues();
      }
    }
  }
}

function fillSuggestedStaticIPValues() {
  // Try to get current network info to suggest better values
  fetch('/api/network/status')
    .then(response => response.json())
    .then(data => {
      const staticIPInput = document.getElementById('staticIP');
      const gatewayInput = document.getElementById('staticGateway');
      const subnetInput = document.getElementById('staticSubnet');
      const dns1Input = document.getElementById('staticDNS1');
      const dns2Input = document.getElementById('staticDNS2');
      
      let filled = false;
      
      if ((data.current_mode === 'ethernet' || data.current_mode === 'wifi_sta') && data.ip) {
        const currentIP = data.ip;
        const ipParts = currentIP.split('.');
        
        if (ipParts.length === 4) {
          // Suggest an IP in the same subnet
          const suggestedIP = `${ipParts[0]}.${ipParts[1]}.${ipParts[2]}.201`;
          staticIPInput.value = suggestedIP;
          filled = true;
          
          // Use actual gateway if available
          if (data.gateway) {
            gatewayInput.value = data.gateway;
          } else {
            gatewayInput.value = `${ipParts[0]}.${ipParts[1]}.${ipParts[2]}.1`;
          }
          
          // Use actual subnet if available
          if (data.subnet) {
            subnetInput.value = data.subnet;
          } else {
            subnetInput.value = '255.255.255.0';
          }
          
          // Use actual DNS if available
          if (data.dns && data.dns !== '0.0.0.0') {
            dns1Input.value = data.dns;
            dns2Input.value = '8.8.4.4'; // Google backup DNS
          } else {
            dns1Input.value = '8.8.8.8';
            dns2Input.value = '8.8.4.4';
          }
          
          const networkType = data.current_mode === 'ethernet' ? 'Ethernet' : 'WiFi';
          showNotification(`Đã điền thông tin mạng từ kết nối ${networkType} hiện tại\nMạng: ${ipParts[0]}.${ipParts[1]}.${ipParts[2]}.x\nIP được đề xuất: ${suggestedIP}`, 'success');
        }
      }
      
      if (!filled) {
        // Fill with reasonable defaults if no network info available
        staticIPInput.value = '192.168.1.201';
        gatewayInput.value = '192.168.1.1';
        subnetInput.value = '255.255.255.0';
        dns1Input.value = '8.8.8.8';
        dns2Input.value = '8.8.4.4';
        
        showNotification('Đã điền giá trị mặc định\nLưu ý: Điều chỉnh theo mạng WiFi thực tế', 'info');
      }
    })
    .catch(err => {
      console.log('Could not get network info for auto-fill:', err);
      
      // Fill with defaults on error
      const staticIPInput = document.getElementById('staticIP');
      const gatewayInput = document.getElementById('staticGateway');
      const subnetInput = document.getElementById('staticSubnet');
      const dns1Input = document.getElementById('staticDNS1');
      const dns2Input = document.getElementById('staticDNS2');
      
      staticIPInput.value = '192.168.1.201';
      gatewayInput.value = '192.168.1.1';
      subnetInput.value = '255.255.255.0';
      dns1Input.value = '8.8.8.8';
      dns2Input.value = '8.8.4.4';
      
      showNotification('Đã điền giá trị mặc định', 'info');
    });
}

function connectManualWiFi() {
  const ssid = document.getElementById('manualSSID').value.trim();
  const password = document.getElementById('manualPassword').value;
  const useStaticIP = document.getElementById('useStaticIP').checked;
  
  if (!ssid) {
    showNotification('Vui lòng nhập tên WiFi', 'warning');
    return;
  }
  
  let staticIPData = {};
  if (useStaticIP) {
    staticIPData = {
      use_static_ip: true,
      static_ip: document.getElementById('staticIP').value.trim(),
      gateway: document.getElementById('staticGateway').value.trim(),
      subnet: document.getElementById('staticSubnet').value.trim(),
      dns1: document.getElementById('staticDNS1').value.trim(),
      dns2: document.getElementById('staticDNS2').value.trim()
    };
    
    // Validate IP fields
    if (!staticIPData.static_ip || !staticIPData.gateway || !staticIPData.subnet) {
      showNotification('Vui lòng điền đầy đủ thông tin IP tĩnh', 'warning');
      return;
    }
  } else {
    staticIPData.use_static_ip = false;
  }
  
  connectToWiFi(ssid, password, staticIPData);
}

function connectToWiFi(ssid, password, staticIPConfig = {}) {
  showConnectingOverlay();
  
  const data = { 
    ssid, 
    password,
    ...staticIPConfig
  };
  
  // Show immediate feedback
  showNotification('Đang lưu cấu hình WiFi và kết nối...', 'info');
  
  fetch('/api/wifi/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
    .then(response => response.json())
    .then(data => {
      if (data.success && data.status === 'connecting') {
        // Configuration saved, now wait and check connection status
        showNotification('Cấu hình đã lưu. Đang kết nối WiFi...', 'info');
        
        // Wait a bit for connection attempt, then check status
        setTimeout(() => {
          checkWiFiConnectionStatus(ssid, staticIPConfig.use_static_ip);
        }, 3000);
        
      } else if (data.success) {
        // Immediate success (shouldn't happen with new logic, but keep for compatibility)
        hideConnectingOverlay();
        handleWiFiSuccess(data);
      } else {
        hideConnectingOverlay();
        showNotification(data.message || 'Lỗi khi lưu cấu hình WiFi', 'error');
      }
    })
    .catch(err => {
      console.log('WiFi connect request error (expected in AP mode):', err);
      
      // In AP mode, the connection will be lost when switching to STA mode
      // Show message and wait to check connection status
      showNotification('Đang chuyển đổi từ AP mode sang WiFi. Vui lòng đợi...', 'info');
      
      // Wait longer and check connection status
      setTimeout(() => {
        checkWiFiConnectionStatus(ssid, staticIPConfig.use_static_ip);
      }, 5000);
    });
}

function checkWiFiConnectionStatus(expectedSSID, useStaticIP) {
  let attempts = 0;
  const maxAttempts = 10;
  
  function pollStatus() {
    attempts++;
    
    // Try to connect to potential new IP first if using static IP
    if (useStaticIP) {
      const staticIP = document.getElementById('staticIP').value.trim();
      if (staticIP) {
        checkStatusAtIP(staticIP, expectedSSID, attempts, maxAttempts);
        return;
      }
    }
    
    // Check status at current location (might be AP mode)
    fetch('/api/wifi/status')
      .then(response => response.json())
      .then(data => {
        handleConnectionStatusResponse(data, expectedSSID, attempts, maxAttempts);
      })
      .catch(err => {
        console.log(`Status check attempt ${attempts} failed:`, err);
        
        if (attempts >= maxAttempts) {
          hideConnectingOverlay();
          showNotification('Không thể kiểm tra trạng thái kết nối WiFi', 'error');
        } else {
          setTimeout(pollStatus, 2000);
        }
      });
  }
  
  pollStatus();
}

function checkStatusAtIP(ip, expectedSSID, attempts, maxAttempts) {
  const url = `http://${ip}/api/wifi/status`;
  
  fetch(url)
    .then(response => response.json())
    .then(data => {
      hideConnectingOverlay();
      if (data.success && data.ssid === expectedSSID) {
        handleWiFiSuccess(data);
        
        // Update URL to new IP
        if (window.location.hostname !== ip) {
          showNotification(`WiFi kết nối thành công!\nĐang chuyển hướng đến IP mới: ${ip}`, 'success');
          setTimeout(() => {
            window.location.href = `http://${ip}`;
          }, 3000);
        }
      } else {
        showNotification(data.message || 'Kết nối WiFi thất bại', 'error');
      }
    })
    .catch(err => {
      // If static IP check fails, fall back to current IP check
      console.log(`Static IP check failed, trying current location:`, err);
      
      fetch('/api/wifi/status')
        .then(response => response.json())
        .then(data => {
          handleConnectionStatusResponse(data, expectedSSID, attempts, maxAttempts);
        })
        .catch(err => {
          if (attempts >= maxAttempts) {
            hideConnectingOverlay();
            showNotification('Không thể kiểm tra trạng thái kết nối WiFi', 'error');
          } else {
            setTimeout(() => checkWiFiConnectionStatus(expectedSSID, false), 2000);
          }
        });
    });
}

function handleConnectionStatusResponse(data, expectedSSID, attempts, maxAttempts) {
  if (data.success && data.ssid === expectedSSID) {
    hideConnectingOverlay();
    handleWiFiSuccess(data);
  } else if (data.current_mode === 'wifi_ap') {
    // Still in AP mode, connection likely failed
    if (attempts >= maxAttempts) {
      hideConnectingOverlay();
      showNotification('Kết nối WiFi thất bại. Vẫn ở chế độ AP', 'error');
    } else {
      setTimeout(() => checkWiFiConnectionStatus(expectedSSID, false), 2000);
    }
  } else {
    // Still connecting or other state
    if (attempts >= maxAttempts) {
      hideConnectingOverlay();
      showNotification('Timeout khi kiểm tra kết nối WiFi', 'warning');
    } else {
      setTimeout(() => checkWiFiConnectionStatus(expectedSSID, false), 2000);
    }
  }
}

function handleWiFiSuccess(data) {
  let message = `Kết nối WiFi thành công!\nSSID: ${data.ssid}\nIP: ${data.ip}`;
  if (data.gateway) message += `\nGateway: ${data.gateway}`;
  if (data.subnet) message += `\nSubnet: ${data.subnet}`;
  if (data.use_static_ip) message += '\n(Đang dùng IP tĩnh)';
  
  showNotification(message, 'success');
  refreshNetworkStatus();
  
  // Clear form
  document.getElementById('manualSSID').value = '';
  document.getElementById('manualPassword').value = '';
  document.getElementById('useStaticIP').checked = false;
  toggleStaticIPFields();
  
  // Show access info
  setTimeout(() => {
    showNotification(`💡 Có thể truy cập web tại: http://${data.ip}`, 'info');
  }, 2000);
}

function showConnectingOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'connecting-overlay';
  overlay.id = 'connectingOverlay';
  overlay.innerHTML = `
    <div class="connecting-content">
      <div class="spinner"></div>
      <h4>Đang kết nối WiFi...</h4>
      <p>Lưu ý: Nếu đang ở chế độ AP (192.168.4.1), kết nối có thể bị gián đoạn khi chuyển sang WiFi</p>
      <div class="connecting-steps">
        <div class="step">1. Lưu cấu hình WiFi</div>
        <div class="step">2. Chuyển từ AP mode sang WiFi</div>
        <div class="step">3. Kiểm tra kết nối</div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

function hideConnectingOverlay() {
  const overlay = document.getElementById('connectingOverlay');
  if (overlay) {
    document.body.removeChild(overlay);
  }
}

// Initialize WiFi tab when shown
function initWiFiTab() {
  refreshNetworkStatus();
}

// Add notification animations
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  
  @keyframes slideOut {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(100%);
      opacity: 0;
    }
  }
  
  .notification-content {
    display: flex;
    align-items: center;
    gap: 10px;
  }
`;
document.head.appendChild(style);

// Hàm hiển thị lịch sử batch đã hoàn thành
function showBatchHistory() {
  const batchHistories = JSON.parse(localStorage.getItem('batchHistories') || '[]');
  
  if (batchHistories.length === 0) {
    alert('Chưa có lịch sử đếm nào');
    return;
  }
  
  let historyHTML = `
    <div style="max-height: 500px; overflow-y: auto;">
      <h3 style="margin-bottom: 15px;">📊 Lịch sử đếm đã hoàn thành</h3>
  `;
  
  batchHistories.forEach((history, index) => {
    const completedDate = new Date(history.timestamp).toLocaleString('vi-VN');
    const accuracy = history.totalPlanned > 0 ? 
      ((history.totalCounted / history.totalPlanned) * 100).toFixed(1) : 0;
    
    historyHTML += `
      <div style="border: 1px solid #ddd; margin-bottom: 10px; padding: 10px; border-radius: 5px; background: ${index % 2 === 0 ? '#f9f9f9' : 'white'}">
        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
          <strong>📦 ${history.batchName}</strong>
          <span style="color: #666; font-size: 0.9em;">${completedDate}</span>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 8px;">
          <div><strong>Đơn hàng:</strong> ${history.totalOrders}</div>
          <div><strong>Kế hoạch:</strong> ${history.totalPlanned}</div>
          <div><strong>Thực hiện:</strong> ${history.totalCounted}</div>
        </div>
        <div style="margin-bottom: 8px;">
          <strong>Độ chính xác:</strong> <span style="color: ${accuracy >= 95 ? 'green' : accuracy >= 90 ? 'orange' : 'red'}; font-weight: bold;">${accuracy}%</span>
        </div>
        <details style="margin-top: 8px;">
          <summary style="cursor: pointer; color: #007bff;">Chi tiết đơn hàng</summary>
          <div style="margin-top: 8px; padding-left: 15px;">
    `;
    
    history.orders.forEach(order => {
      const orderAccuracy = order.plannedQuantity > 0 ? 
        ((order.actualCount / order.plannedQuantity) * 100).toFixed(1) : 0;
      historyHTML += `
        <div style="padding: 5px 0; border-bottom: 1px solid #eee;">
          <div><strong>${order.customerName}</strong> - ${order.productName}</div>
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; font-size: 0.9em; color: #666;">
            <span>Mã: ${order.orderCode}</span>
            <span>KH: ${order.plannedQuantity}</span>
            <span>TH: ${order.actualCount} (${orderAccuracy}%)</span>
          </div>
        </div>
      `;
    });
    
    historyHTML += `
          </div>
        </details>
      </div>
    `;
  });
  
  historyHTML += `
    </div>
    <div style="margin-top: 15px; text-align: right;">
      <button onclick="clearBatchHistory()" style="background: #dc3545; color: white; border: none; padding: 8px 15px; border-radius: 4px; cursor: pointer;">
        🗑️ Xóa lịch sử
      </button>
    </div>
  `;
  
  // Tạo modal hiển thị
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
    background: rgba(0,0,0,0.5); z-index: 10000; display: flex; 
    align-items: center; justify-content: center;
  `;
  
  const content = document.createElement('div');
  content.style.cssText = `
    background: white; padding: 20px; border-radius: 8px; 
    max-width: 80%; max-height: 80%; overflow: hidden;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
  `;
  content.innerHTML = historyHTML;
  
  modal.appendChild(content);
  document.body.appendChild(modal);
  
  // Đóng modal khi click bên ngoài
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  });
}

// Hàm xóa lịch sử
function clearBatchHistory() {
  if (confirm('Bạn có chắc chắn muốn xóa toàn bộ lịch sử đếm?')) {
    localStorage.removeItem('batchHistories');
    location.reload(); // Refresh page để đóng modal
  }
}
