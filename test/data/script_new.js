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
  updateOrderTable();
  updateOverview();
  showTab('overview');
  startStatusPolling();
  
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
  
  showNotification('Lưu danh sách đơn hàng thành công', 'success');
  
  // Reset form
  document.getElementById('batchInfo').style.display = 'none';
  document.getElementById('orderFormContainer').style.display = 'none';
  currentOrderBatch = [];
  currentBatchId = null;
  
  console.log('Batch saved successfully, orderBatches:', orderBatches);
}

function clearBatch() {
  if (confirm('Bạn có chắc chắn muốn xóa tất cả đơn hàng trong danh sách?')) {
    currentOrderBatch = [];
    updateBatchPreview();
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
      saveOrderBatches();
      
      console.log('Activated batch:', batch.name, 'with', batch.orders.length, 'orders');
      
      currentPage = 1;
      updateOrderTable();
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
    row.classList.add(order.status);
    
    const statusDisplay = getStatusDisplay(order.status);
    
    row.innerHTML = `
      <td><span class="order-number">${order.orderNumber}</span></td>
      <td>
        <input type="checkbox" ${order.selected ? 'checked' : ''} 
               onchange="selectOrder(${order.id}, this.checked)">
      </td>
      <td><strong>${order.quantity}</strong></td>
      <td>${order.product.name}</td>
      <td>${order.customerName}</td>
      <td>${order.vehicleNumber}</td>
      <td>
        <span class="status-indicator status-${order.status}">
          <i class="fas fa-${statusDisplay.icon}"></i>
          ${statusDisplay.text}
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
  
  // Reset all orders status
  activeBatch.orders.forEach(order => {
    if (order.selected) {
      order.status = 'waiting';
      order.currentCount = 0;
    }
  });
  
  // Set first selected order to counting
  const firstSelected = selectedOrders[0];
  firstSelected.status = 'counting';
  
  countingState.isActive = true;
  countingState.currentOrderIndex = 0;
  countingState.totalPlanned = selectedOrders.reduce((sum, order) => sum + order.quantity, 0);
  countingState.totalCounted = 0;
  
  // Send command to ESP32
  sendCommand('start');
  
  saveOrderBatches();
  updateOrderTable();
  updateOverview();
  showNotification('Bắt đầu đếm', 'success');
}

function pauseCounting() {
  countingState.isActive = false;
  
  const activeBatch = orderBatches.find(b => b.isActive);
  if (activeBatch) {
    activeBatch.orders.forEach(order => {
      if (order.status === 'counting') {
        order.status = 'paused';
      }
    });
    saveOrderBatches();
  }
  
  sendCommand('pause');
  updateOrderTable();
  updateOverview();
  showNotification('Tạm dừng đếm', 'warning');
}

function stopCounting() {
  countingState.isActive = false;
  
  const activeBatch = orderBatches.find(b => b.isActive);
  if (activeBatch) {
    activeBatch.orders.forEach(order => {
      if (order.status === 'counting' || order.status === 'paused') {
        order.status = 'waiting';
      }
    });
    saveOrderBatches();
  }
  
  sendCommand('pause');
  updateOrderTable();
  updateOverview();
  showNotification('Dừng đếm', 'info');
}

function resetCounting() {
  if (confirm('Bạn có chắc chắn muốn reset? Tất cả dữ liệu đếm hiện tại sẽ bị xóa.')) {
    countingState.isActive = false;
    countingState.currentOrderIndex = 0;
    countingState.totalCounted = 0;
    
    const activeBatch = orderBatches.find(b => b.isActive);
    if (activeBatch) {
      activeBatch.orders.forEach(order => {
        order.currentCount = 0;
        order.status = 'waiting';
      });
      saveOrderBatches();
    }
    
    sendCommand('reset');
    updateOrderTable();
    updateOverview();
    showNotification('Reset thành công', 'info');
  }
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

// Updated Overview Function
function updateOverview() {
  console.log('Updating overview, orderBatches:', orderBatches.length);
  
  const activeBatch = orderBatches.find(b => b.isActive);
  console.log('Active batch:', activeBatch ? activeBatch.name : 'none');
  
  if (!activeBatch) {
    document.getElementById('totalOrdersCount').textContent = '0';
    document.getElementById('selectedOrdersCount').textContent = '0';
    document.getElementById('totalPlannedCount').textContent = '0';
    document.getElementById('totalCountedCount').textContent = '0';
    document.getElementById('currentOrderDisplay').textContent = 'Chưa có đơn hàng';
    
    // Update progress bar
    const progressBar = document.getElementById('overviewProgress');
    if (progressBar) {
      progressBar.style.width = '0%';
    }
    
    updateCountingControls();
    return;
  }
  
  const orders = activeBatch.orders;
  const selectedOrders = orders.filter(o => o.selected);
  const totalPlanned = selectedOrders.reduce((sum, order) => sum + order.quantity, 0);
  const totalCounted = selectedOrders.reduce((sum, order) => sum + order.currentCount, 0);
  
  console.log('Orders:', orders.length, 'Selected:', selectedOrders.length, 'Planned:', totalPlanned, 'Counted:', totalCounted);
  
  document.getElementById('totalOrdersCount').textContent = orders.length;
  document.getElementById('selectedOrdersCount').textContent = selectedOrders.length;
  document.getElementById('totalPlannedCount').textContent = totalPlanned;
  document.getElementById('totalCountedCount').textContent = totalCounted;
  
  // Current order display
  const currentOrder = orders.find(o => o.status === 'counting');
  if (currentOrder) {
    document.getElementById('currentOrderDisplay').textContent = 
      `${currentOrder.orderNumber}. ${currentOrder.customerName} - ${currentOrder.product.name} (${currentOrder.currentCount}/${currentOrder.quantity})`;
  } else {
    document.getElementById('currentOrderDisplay').textContent = countingState.isActive ? 'Đang đếm...' : 'Chưa bắt đầu';
  }
  
  // Update progress
  const progress = totalPlanned > 0 ? (totalCounted / totalPlanned) * 100 : 0;
  const progressBar = document.getElementById('overviewProgress');
  if (progressBar) {
    progressBar.style.width = progress + '%';
  }
  
  // Update counting controls
  updateCountingControls();
}

function updateCountingControls() {
  const startBtn = document.getElementById('startCountingBtn');
  const pauseBtn = document.getElementById('pauseCountingBtn');
  const stopBtn = document.getElementById('stopCountingBtn');
  const resetBtn = document.getElementById('resetCountingBtn');
  
  if (startBtn) startBtn.disabled = countingState.isActive;
  if (pauseBtn) pauseBtn.disabled = !countingState.isActive;
  if (stopBtn) stopBtn.disabled = !countingState.isActive;
  if (resetBtn) resetBtn.disabled = countingState.isActive;
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
    tbody.innerHTML = '<tr><td colspan="6" class="text-center">Chưa có lịch sử đếm</td></tr>';
    return;
  }
  
  countingHistory.slice().reverse().forEach((entry, index) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${new Date(entry.timestamp).toLocaleString('vi-VN')}</td>
      <td>${entry.customerName}</td>
      <td>${entry.productName}</td>
      <td>${entry.plannedQuantity}</td>
      <td>${entry.actualCount}</td>
      <td>
        <span class="status-indicator ${entry.actualCount === entry.plannedQuantity ? 'status-completed' : 'status-warning'}">
          ${entry.actualCount === entry.plannedQuantity ? 'Đạt' : 'Lệch'}
        </span>
      </td>
    `;
    tbody.appendChild(row);
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
    console.log('No saved batches found, starting with empty array');
    orderBatches = [];
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
  const saved = localStorage.getItem('settings');
  if (saved) {
    settings = { ...settings, ...JSON.parse(saved) };
  }
  updateSettingsForm();
}

function saveSettings() {
  localStorage.setItem('settings', JSON.stringify(settings));
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
    let payload = { cmd: command };
    if (value !== null) {
      payload.value = value;
    }
    
    const response = await fetch(`http://${settings.ipAddress}/api/cmd`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.text();
  } catch (error) {
    console.error('Error sending command:', error);
    showNotification('Lỗi kết nối với thiết bị', 'error');
    return null;
  }
}

// Send IR Remote commands
async function sendRemoteCommand(button) {
  try {
    const payload = { 
      cmd: "REMOTE",
      button: button
    };
    
    const response = await fetch(`http://${settings.ipAddress}/api/cmd`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.text();
  } catch (error) {
    console.error('Error sending remote command:', error);
    showNotification('Lỗi gửi lệnh remote', 'error');
    return null;
  }
}

async function getStatus() {
  try {
    const response = await fetch(`http://${settings.ipAddress}/api/status`, {
      method: 'GET'
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
      const currentOrder = activeBatch.orders.find(o => o.status === 'counting');
      if (currentOrder && data.count !== currentOrder.currentCount) {
        currentOrder.currentCount = data.count;
        
        // Check if order is complete
        if (currentOrder.currentCount >= currentOrder.quantity) {
          currentOrder.status = 'completed';
          
          // Add to history
          countingHistory.push({
            timestamp: new Date().toISOString(),
            customerName: currentOrder.customerName,
            productName: currentOrder.product.name,
            plannedQuantity: currentOrder.quantity,
            actualCount: currentOrder.currentCount
          });
          
          // Move to next order
          moveToNextOrder();
        }
        
        saveOrderBatches();
        saveHistory();
        updateOrderTable();
        updateOverview();
      }
    }
  }
}

function moveToNextOrder() {
  const activeBatch = orderBatches.find(b => b.isActive);
  if (!activeBatch) return;
  
  const selectedOrders = activeBatch.orders.filter(o => o.selected);
  const currentIndex = selectedOrders.findIndex(o => o.status === 'completed');
  
  if (currentIndex < selectedOrders.length - 1) {
    // Move to next order
    selectedOrders[currentIndex + 1].status = 'counting';
    sendCommand('reset'); // Reset count for next order
  } else {
    // All orders completed
    countingState.isActive = false;
    showNotification('Hoàn thành tất cả đơn hàng', 'success');
  }
}

function startStatusPolling() {
  setInterval(async () => {
    if (countingState.isActive) {
      await getStatus();
    }
  }, 1000); // Poll every second
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
  
  // Send settings to device
  sendCommand('brightness', settings.brightness);
  sendCommand('sensorDelay', settings.sensorDelay);
  sendCommand('bagDetectionDelay', settings.bagDetectionDelay);
  sendCommand('minBagInterval', settings.minBagInterval);
  
  showNotification('Lưu cài đặt thành công', 'success');
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
      updateOrderTable();
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
