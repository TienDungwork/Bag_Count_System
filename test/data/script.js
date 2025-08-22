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

// MQTT Configuration
let mqttClient = null;
let mqttConnected = false;
let currentDeviceStatus = {};
let lastMqttUpdate = 0;

// API polling configuration (reduced frequency for management data only)
let apiPollingInterval = null;
const API_POLL_FREQUENCY = 1000; // 60 seconds - chỉ cho management data, không cho real-time count

let settings = {
  conveyorName: 'BT-001',
  ipAddress: '192.168.1.200',
  gateway: '192.168.1.1',
  subnet: '255.255.255.0',
  sensorDelay: 20,
  bagDetectionDelay: 200,
  minBagInterval: 100,
  autoReset: false,
  brightness: 35,
  relayDelayAfterComplete: 5000
};

// Initialize application
document.addEventListener('DOMContentLoaded', async function() {
  // Load data from ESP32 first, fallback to localStorage
  try {
    await loadAllDataFromESP32();
  } catch (error) {
    loadSettings();
    loadProducts();
    loadOrderBatches();
    loadHistory();
  }
  
  updateCurrentBatchSelect();
  updateProductTable();
  updateBatchDisplay();
  updateOverview();
  updateConveyorNameDisplay();
  showTab('overview');
  
  // Initialize MQTT Client
  initMQTTClient();
  
  // Start background sync
  setTimeout(() => {
    startManagementAPIPolling();
  }, 3000);
  
  // Setup brightness slider
  const brightnessSlider = document.getElementById('brightness');
  const brightnessValue = document.getElementById('brightnessValue');
  if (brightnessSlider && brightnessValue) {
    brightnessSlider.addEventListener('input', function() {
      brightnessValue.textContent = this.value + '%';
      settings.brightness = parseInt(this.value);
    });
  }
  
  // Khởi tạo trạng thái ban đầu cho các nút bấm
  initializeButtonStates();
  
  console.log('✅ Application initialized successfully');
  showNotification('Ứng dụng đã khởi tạo (ESP32 mode)', 'success');
});

// LOAD TẤT CẢ DỮ LIỆU TỪ ESP32 KHI KHỞI ĐỘNG
async function loadAllDataFromESP32() {
  console.log('Loading all data from ESP32...');
  
  try {
    // 🔄 KIỂM TRA XEM ESP32 CÓ DỮ LIỆU CHƯA
    const hasData = await checkESP32HasData();
    
    if (!hasData) {
      console.log('ESP32 chưa có dữ liệu, gửi cấu hình mặc định...');
      await initDefaultDataToESP32();
    }
    
    // Load settings từ ESP32
    await loadSettingsFromESP32();
    
    // Load products từ ESP32
    await loadProductsFromESP32();
    
    // Load orders từ ESP32  
    await loadOrdersFromESP32();
    
    // Load order batches từ ESP32
    await loadOrderBatchesFromESP32();
    
    // Load history từ ESP32
    await loadHistoryFromESP32();
    
    console.log('All data loaded from ESP32 successfully');
    
    // Force sync lại toàn bộ data để đảm bảo ESP32 có data mới nhất
    setTimeout(() => {
      sendOrderBatchesToESP32();
    }, 1000);
    
    showNotification('Đã tải dữ liệu từ ESP32', 'success');
    
  } catch (error) {
    console.error('Error loading data from ESP32:', error);
    console.log('Falling back to localStorage data');
    showNotification('Không thể tải từ ESP32, sử dụng dữ liệu local', 'warning');
  }
}

// Kiểm tra ESP32 có dữ liệu chưa
async function checkESP32HasData() {
  try {
    const [productsRes, ordersRes, settingsRes] = await Promise.all([
      fetch('/api/products').catch(() => null),
      fetch('/api/orders').catch(() => null), 
      fetch('/api/settings').catch(() => null)
    ]);
    
    // Nếu có ít nhất 1 endpoint trả dữ liệu thì coi như đã có data
    return (productsRes?.ok) || (ordersRes?.ok) || (settingsRes?.ok);
    
  } catch (error) {
    console.error('Error checking ESP32 data:', error);
    return false;
  }
}

// Gửi cấu hình mặc định đến ESP32 lần đầu
async function initDefaultDataToESP32() {
  try {
    console.log('🚀 Initializing default data to ESP32...');
    
    // Gửi sản phẩm mặc định
    const defaultProducts = [
      { id: 1, code: 'GAO001', name: 'Gạo thường ST25' },
      { id: 2, code: 'GAO002', name: 'Gạo thơm Jasmine' },
      { id: 3, code: 'NGO001', name: 'Ngô bắp vàng' },
      { id: 4, code: 'LUA001', name: 'Lúa mì cao cấp' }
    ];
    
    await fetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(defaultProducts)
    });
    
    // Gửi cài đặt mặc định
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
    
    console.log('✅ Default data sent to ESP32');
    
  } catch (error) {
    console.error('❌ Error sending default data to ESP32:', error);
  }
}

// Load products từ ESP32
async function loadProductsFromESP32() {
  try {
    const response = await fetch('/api/products');
    if (response.ok) {
      const esp32Products = await response.json();
      if (esp32Products && esp32Products.length > 0) {
        currentProducts = esp32Products;
        localStorage.setItem('products', JSON.stringify(currentProducts));
        console.log('Products loaded from ESP32:', esp32Products.length, 'products');
        return true;
      }
    }
  } catch (error) {
    console.error('Error loading products from ESP32:', error);
  }
  return false;
}

// Load orders từ ESP32
async function loadOrdersFromESP32() {
  try {
    console.log('📋 Loading orders from ESP32...');
    
    const response = await fetch('/api/orders');
    if (response.ok) {
      const esp32Orders = await response.json();
      console.log('📋 ESP32 orders response:', esp32Orders);
      
      if (esp32Orders && Array.isArray(esp32Orders) && esp32Orders.length > 0) {
        orderBatches = esp32Orders;
        localStorage.setItem('orderBatches', JSON.stringify(orderBatches));
        console.log('✅ Orders loaded from ESP32:', esp32Orders.length, 'batches');
        console.log('📋 First batch sample:', esp32Orders[0]);
        return true;
      } else if (esp32Orders && Array.isArray(esp32Orders) && esp32Orders.length === 0) {
        console.log('ℹ️ ESP32 has empty orders array - this is normal for new setup');
        orderBatches = [];
        localStorage.setItem('orderBatches', JSON.stringify(orderBatches));
        return true;
      } else {
        console.log('❌ ESP32 orders response is not a valid array:', esp32Orders);
        return false;
      }
    } else {
      console.log('❌ Failed to fetch orders from ESP32, status:', response.status);
      return false;
    }
  } catch (error) {
    console.error('❌ Error loading orders from ESP32:', error);
    return false;
  }
}

// Load history từ ESP32
async function loadHistoryFromESP32() {
  try {
    const response = await fetch('/api/history');
    if (response.ok) {
      const esp32History = await response.json();
      if (esp32History && esp32History.length > 0) {
        countingHistory = esp32History;
        localStorage.setItem('countingHistory', JSON.stringify(countingHistory));
        console.log('History loaded from ESP32:', esp32History.length, 'records');
        return true;
      }
    }
  } catch (error) {
    console.error('Error loading history from ESP32:', error);
  }
  return false;
}

// HÀM ĐỂ FORCE REFRESH TỪ ESP32 (DÙNG KHI CẦN RESET)
async function forceRefreshFromESP32() {
  if (confirm('Tải lại tất cả dữ liệu từ ESP32? Dữ liệu local sẽ bị ghi đè.')) {
    console.log('Force refreshing from ESP32...');
    
    // Clear localStorage
    localStorage.removeItem('settings');
    localStorage.removeItem('products');
    localStorage.removeItem('orderBatches');
    localStorage.removeItem('countingHistory');
    
    // Load from ESP32
    await loadAllDataFromESP32();
    
    // Update UI
    updateBatchSelector();
    updateCurrentBatchSelect();
    updateProductTable();
    updateBatchDisplay();
    updateOverview();
    updateHistoryTable();
    updateSettingsForm();
    
    showNotification('Đã tải lại dữ liệu từ ESP32', 'success');
  }
}

// CÁC HÀM DEBUG VÀ TROUBLESHOOTING

// Debug ESP32 settings
async function debugESP32Settings() {
  try {
    console.log('🔍 Debugging ESP32 settings...');
    
    const response = await fetch('/api/debug/settings');
    if (response.ok) {
      const debugData = await response.json();
      
      console.log('=== ESP32 SETTINGS DEBUG ===');
      console.log('📂 Files status:', debugData.files || 'NO FILES DATA');
      console.log('💾 Current memory variables:', debugData.memory || 'NO MEMORY DATA');
      console.log('📄 Settings file content:', debugData.file_content?.settings || 'NO FILE CONTENT');
      console.log('🖥️ System info:', debugData.system || 'NO SYSTEM DATA');
      console.log('=== END DEBUG ===');
      
      showNotification('Debug info printed to console (F12)', 'info');
      
      // Hiển thị popup với info quan trọng
      const fileExists = debugData.files?.settings_exists || false;
      const memorySettings = debugData.memory || {};
      
      alert(`ESP32 Settings Debug:\n\nFile exists: ${fileExists}\nConveyor: ${memorySettings.conveyorName || 'N/A'}\nBrightness: ${memorySettings.brightness || 'N/A'}%\nSensor Delay: ${memorySettings.sensorDelay || 'N/A'}ms\n\nCheck console (F12) for full details`);
      
    } else {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
  } catch (error) {
    console.error('Error debugging ESP32:', error);
    showNotification('Lỗi debug ESP32: ' + error.message, 'error');
  }
}

// Force refresh settings từ file
async function forceRefreshESP32Settings() {
  try {
    console.log('🔄 Force refreshing ESP32 settings from file...');
    
    const response = await fetch('/api/settings/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      }
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log('Settings refreshed:', result);
      
      // Reload settings to web
      await loadSettingsFromESP32();
      
      showNotification('Đã force refresh settings từ ESP32', 'success');
    } else {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
  } catch (error) {
    console.error('Error force refreshing settings:', error);
    showNotification('Lỗi force refresh: ' + error.message, 'error');
  }
}

// So sánh settings giữa web và ESP32
async function compareSettings() {
  try {
    console.log('🔍 Comparing web vs ESP32 settings...');
    
    const response = await fetch('/api/settings');
    if (response.ok) {
      const esp32Settings = await response.json();
      
      console.log('=== SETTINGS COMPARISON ===');
      console.log('📱 Web settings:', settings);
      console.log('🔧 ESP32 settings:', esp32Settings);
      
      // So sánh từng field
      const differences = [];
      
      if (settings.conveyorName !== esp32Settings.conveyorName) {
        differences.push(`conveyorName: Web="${settings.conveyorName}" vs ESP32="${esp32Settings.conveyorName}"`);
      }
      if (settings.brightness !== esp32Settings.brightness) {
        differences.push(`brightness: Web=${settings.brightness} vs ESP32=${esp32Settings.brightness}`);
      }
      if (settings.sensorDelay !== esp32Settings.sensorDelay) {
        differences.push(`sensorDelay: Web=${settings.sensorDelay} vs ESP32=${esp32Settings.sensorDelay}`);
      }
      if (settings.bagDetectionDelay !== esp32Settings.bagDetectionDelay) {
        differences.push(`bagDetectionDelay: Web=${settings.bagDetectionDelay} vs ESP32=${esp32Settings.bagDetectionDelay}`);
      }
      if (settings.minBagInterval !== esp32Settings.minBagInterval) {
        differences.push(`minBagInterval: Web=${settings.minBagInterval} vs ESP32=${esp32Settings.minBagInterval}`);
      }
      if (settings.autoReset !== esp32Settings.autoReset) {
        differences.push(`autoReset: Web=${settings.autoReset} vs ESP32=${esp32Settings.autoReset}`);
      }
      
      if (differences.length > 0) {
        console.log('❌ DIFFERENCES FOUND:');
        differences.forEach(diff => console.log('  - ' + diff));
        showNotification(`Phát hiện ${differences.length} khác biệt - xem console`, 'warning');
      } else {
        console.log('✅ No differences found');
        showNotification('Settings đồng bộ hoàn hảo', 'success');
      }
      
      console.log('=== END COMPARISON ===');
      
    } else {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
  } catch (error) {
    console.error('Error comparing settings:', error);
    showNotification('Lỗi so sánh settings: ' + error.message, 'error');
  }
}

// Xóa sản phẩm từ ESP32
async function deleteProductFromESP32(productId) {
  try {
    console.log('🗑️ Deleting product from ESP32:', productId);
    
    const response = await fetch(`/api/products/${productId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      }
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log('Product deleted from ESP32:', result);
      return true;
    } else {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
  } catch (error) {
    console.error('Error deleting product from ESP32:', error);
    return false;
  }
}

// Xóa order batch từ ESP32
async function deleteBatchFromESP32(batchId) {
  try {
    console.log('Deleting batch from ESP32:', batchId);
    
    const response = await fetch(`/api/orders/${batchId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      }
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log('Batch deleted from ESP32:', result);
      return true;
    } else {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
  } catch (error) {
    console.error('Error deleting batch from ESP32:', error);
    return false;
  }
}

// Xóa order từ batch trên ESP32
async function deleteOrderFromBatchESP32(batchId, orderId) {
  try {
    console.log('Deleting order from batch on ESP32:', batchId, orderId);
    
    const response = await fetch(`/api/orders/${batchId}/orders/${orderId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      }
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log('Order deleted from batch on ESP32:', result);
      return true;
    } else {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
  } catch (error) {
    console.error('Error deleting order from batch on ESP32:', error);
    return false;
  }
}

// Xóa tất cả lịch sử từ ESP32
async function clearHistoryFromESP32() {
  try {
    console.log('Clearing all history from ESP32...');
    
    const response = await fetch('/api/history', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      }
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log('History cleared from ESP32:', result);
      return true;
    } else {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
  } catch (error) {
    console.error('Error clearing history from ESP32:', error);
    return false;
  }
}

// Reset cài đặt về mặc định trên ESP32
async function resetSettingsToDefaultESP32() {
  try {
    console.log('Resetting settings to default on ESP32...');
    
    const response = await fetch('/api/settings/reset', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      }
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log('Settings reset to default on ESP32:', result);
      return true;
    } else {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
  } catch (error) {
    console.error('Error resetting settings on ESP32:', error);
    return false;
  }
}

// RESET TẤT CẢ DỮ LIỆU VỀ MẶC ĐỊNH (DÙNG KHI CẦN RESET HOÀN TOÀN)
async function resetAllDataToDefault() {
  if (confirm('⚠️ CẢNH BÁO: Thao tác này sẽ XÓA TẤT CẢ dữ liệu (sản phẩm, đơn hàng, lịch sử, cài đặt) và reset về cấu hình mặc định!\n\nBạn có chắc chắn?')) {
    if (confirm('Lần xác nhận cuối: Bạn THỰC SỰ muốn xóa tất cả dữ liệu?')) {
      console.log('Resetting ALL data to default...');
      
      try {
        // Xóa tất cả từ ESP32
        await Promise.all([
          clearHistoryFromESP32(),
          fetch('/api/products', { method: 'DELETE' }),
          fetch('/api/orders', { method: 'DELETE' }),
          resetSettingsToDefaultESP32()
        ]);
        
        // Xóa localStorage
        localStorage.clear();
        
        // Reset biến global
        currentProducts = [];
        orderBatches = [];
        countingHistory = [];
        currentOrderBatch = [];
        currentBatchId = null;
        
        // Reset settings về default
        settings = {
          conveyorName: 'BT-001',
          ipAddress: '192.168.1.200',
          gateway: '192.168.1.1',
          subnet: '255.255.255.0',
          sensorDelay: 20,
          bagDetectionDelay: 200,
          minBagInterval: 100,
          autoReset: false,
          brightness: 35
        };
        
        // Cập nhật UI
        updateBatchSelector();
        updateCurrentBatchSelect();
        updateProductTable();
        updateBatchDisplay();
        updateOverview();
        updateHistoryTable();
        updateSettingsForm();
        
        showNotification('✅ Đã reset tất cả dữ liệu về mặc định', 'success');
        
      } catch (error) {
        console.error('Error resetting data:', error);
        showNotification('Lỗi khi reset dữ liệu: ' + error.message, 'error');
      }
    }
  }
}

// MQTT Client Setup  
function initMQTTClient() {
  try {
    // Use WebSockets MQTT client (you'll need to include mqtt.js library)
    // For now, we'll implement a fallback approach
    console.log('Attempting MQTT WebSocket connection...');
    
    // Try to connect via WebSocket MQTT (if available)
    if (typeof mqtt !== 'undefined') {
      // ✅ RE-ENABLE MQTT with stable broker
      console.log('� Initializing MQTT with stable broker...');
      
      // Try multiple stable MQTT brokers with fallback
      const brokers = [
        'wss://broker.emqx.io:8084/mqtt',  // EMQX
        'ws://broker.hivemq.com:8000/mqtt', // HiveMQ non-SSL
        'wss://mqtt.eclipseprojects.io:443/mqtt' // Eclipse
      ];
      
      let brokerIndex = 0;
      const tryNextBroker = () => {
        if (brokerIndex >= brokers.length) {
          console.log('❌ All MQTT brokers failed, using API-only mode');
          mqttConnected = false;
          updateMQTTStatus(false);
          startStatusPollingFallback();
          return;
        }
        
        const brokerUrl = brokers[brokerIndex];
        
        mqttClient = mqtt.connect(brokerUrl, {
          clientId: `WebClient_${Date.now()}`,
          keepalive: 30,
          reconnectPeriod: 5000
        });
        
        mqttClient.on('connect', function() {
          console.log(`✅ MQTT Connected to broker ${brokerIndex + 1}!`);
          mqttConnected = true;
          updateMQTTStatus(true);
          
          // Subscribe to all relevant topics
          subscribeMQTTTopics();
        });
        
        mqttClient.on('message', function(topic, message) {
          try {
            const messageStr = message.toString();
            const data = JSON.parse(messageStr);
            
            // Debug real-time count updates  
            if (topic === 'bagcounter/count') {
              console.log('⚡ MQTT Count:', data.count, 'Target:', data.target, 'Type:', data.type);
            }
            
            handleMQTTMessage(topic, data).catch(error => {
              console.error('MQTT message handler error:', error);
            });
          } catch (error) {
            console.error('MQTT message parse error:', error);
          }
        });
        
        mqttClient.on('error', function(error) {
          brokerIndex++;
          if (brokerIndex < brokers.length) {
            console.log('🔄 Trying next broker...');
            setTimeout(tryNextBroker, 2000);
          } else {
            console.log('❌ All MQTT brokers failed, using API-only mode');
            mqttConnected = false;
            updateMQTTStatus(false);
            startStatusPollingFallback();
          }
        });
        
        mqttClient.on('disconnect', function() {
          console.log('MQTT Disconnected');
          mqttConnected = false;
          updateMQTTStatus(false);
        });
      };
      
      // Start trying brokers
      tryNextBroker();
      
    } else {
      startStatusPollingFallback();
    }
    
  } catch (error) {
    startStatusPollingFallback();
  }
}

function subscribeMQTTTopics() {
  if (!mqttClient || !mqttConnected) return;
  
  const topics = [
    'bagcounter/status',
    'bagcounter/count', 
    'bagcounter/alerts',
    'bagcounter/sensor',
    'bagcounter/heartbeat',
    'bagcounter/ir_command'
  ];
  
  topics.forEach(topic => {
    mqttClient.subscribe(topic, function(err) {
      if (err) {
        console.error(`Failed to subscribe to ${topic}:`, err);
      }
    });
  });
}

// Handle MQTT Messages
async function handleMQTTMessage(topic, data) {
  lastMqttUpdate = Date.now();
  
  switch (topic) {
    case 'bagcounter/status':
      await updateDeviceStatus(data);
      updateDisplayElements(data);
      break;
      
    case 'bagcounter/count':
      await handleCountUpdate(data);
      break;
      
    case 'bagcounter/alerts':
      handleDeviceAlert(data);
      break;
      
    case 'bagcounter/sensor':
      updateSensorStatus(data);
      break;
      
    case 'bagcounter/ir_command':
      await handleIRCommandMessage(data);
      break;
      
    case 'bagcounter/heartbeat':
      updateHeartbeat(data);
      break;
      
    // NOTE: Removed bagcounter/ir_command handling to prevent command loops
    // IR commands are handled locally on ESP32, web only receives status updates
    
    default:
      console.log('Unknown MQTT topic:', topic);
  }
}

// MQTT Message Handlers  
async function updateDeviceStatus(data) {
  currentDeviceStatus = { ...currentDeviceStatus, ...data };
  
  // Sync device status with web counting state
  if (data.status) {
    console.log('📡 ESP32 Status:', data.status, 'Web state:', countingState.isActive, 'Timestamp:', new Date().toLocaleTimeString());
    
    if (data.status === 'RUNNING' && !countingState.isActive) {
      console.log('🎛️ IR Remote START detected - updating web state');
      countingState.isActive = true;
      
      // Find active batch and set a counting order if none
      const activeBatch = orderBatches.find(b => b.isActive);
      if (activeBatch) {
        const selectedOrders = activeBatch.orders.filter(o => o.selected);
        if (selectedOrders.length > 0) {
          // Set first waiting/paused order to counting
          const orderToStart = selectedOrders.find(o => o.status === 'waiting' || o.status === 'paused');
          if (orderToStart) {
            orderToStart.status = 'counting';
            countingState.currentOrderIndex = selectedOrders.indexOf(orderToStart);
            console.log('Set order to counting:', countingState.currentOrderIndex + 1);
            console.log('💾 Force saving counting orders to ESP32...');
            await sendOrderBatchesToESP32(); // FORCE SYNC với ESP32
            updateOrderTable();
          }
        }
      }
      updateOverview();
      
    } else if (data.status === 'PAUSE') {
      console.log('🎛️ IR Remote PAUSE detected - updating web state');
      countingState.isActive = false;
      
      // CHỈ SET PAUSED NẾU CÓ ĐƠN HÀNG ĐANG COUNTING
      const activeBatch = orderBatches.find(b => b.isActive);
      if (activeBatch) {
        let hasCountingOrders = false;
        activeBatch.orders.forEach(order => {
          if (order.status === 'counting') {
            order.status = 'paused';
            hasCountingOrders = true;
          }
        });
        
        if (hasCountingOrders) {
          console.log('💾 Force saving paused orders to ESP32...');
          await sendOrderBatchesToESP32(); // FORCE SYNC với ESP32
          updateOrderTable();
        }
      }
      updateOverview();
      
    } else if (data.status === 'RESET') {
      console.log('🎛️ IR Remote RESET detected - resetting all orders');
      
      // Chỉ xử lý nếu chưa reset hoặc đang active
      if (countingState.isActive || countingState.totalCounted > 0) {
        countingState.isActive = false;
        countingState.currentOrderIndex = 0;
        countingState.totalPlanned = 0;
        countingState.totalCounted = 0;
        
        // Reset tất cả đơn hàng VỀ WAITING (không phải paused)
        const activeBatch = orderBatches.find(b => b.isActive);
        if (activeBatch) {
          const selectedOrders = activeBatch.orders.filter(o => o.selected);
          selectedOrders.forEach(order => {
            order.status = 'waiting'; // Đảm bảo về waiting
            order.currentCount = 0;
          });
          saveOrderBatches();
          updateOrderTable();
        }
        updateOverview();
        showNotification('🔄 Reset đếm hoàn tất', 'info');
      }
    }
  }
  
  updateStatusIndicators(data);
  updateControlButtons(data);
  
  // Also update count and display
  if (data.count !== undefined) {
    await updateStatusFromDevice(data);
  }
  
  // Update display elements
  updateDisplayElements(data);
}

async function handleCountUpdate(data) {
  console.log('⚡ MQTT Real-time count:', data.count, 'type:', data.type, 'progress:', data.progress + '%');
  
  // REAL-TIME UPDATE - chỉ cập nhật UI, không save to ESP32
  if (data.count !== undefined) {
    const activeBatch = orderBatches.find(b => b.isActive);
    if (activeBatch && countingState.isActive) {
      const selectedOrders = activeBatch.orders.filter(o => o.selected);
      const currentOrderIndex = selectedOrders.findIndex(o => o.status === 'counting');
      
      if (currentOrderIndex >= 0) {
        const currentOrder = selectedOrders[currentOrderIndex];
        const totalCountFromDevice = data.count;
        
        // Tính số đếm đã hoàn thành từ các đơn hàng trước đó
        let completedCount = 0;
        for (let i = 0; i < currentOrderIndex; i++) {
          if (selectedOrders[i].status === 'completed') {
            completedCount += selectedOrders[i].quantity;
          }
        }
        
        // Số đếm hiện tại của đơn hàng
        const calculatedCurrentCount = Math.max(0, totalCountFromDevice - completedCount);
        const newCurrentCount = Math.min(calculatedCurrentCount, currentOrder.quantity);
        
        // Chỉ cập nhật nếu số mới lớn hơn
        if (newCurrentCount >= (currentOrder.currentCount || 0)) {
          const oldCount = currentOrder.currentCount || 0;
          currentOrder.currentCount = newCurrentCount;
          countingState.totalCounted = totalCountFromDevice;
          
          console.log(`⚡ Real-time: Đơn ${currentOrderIndex + 1} (${currentOrder.customerName}): ${oldCount} → ${newCurrentCount}/${currentOrder.quantity}`);
          
          // ⚡ REAL-TIME UI UPDATE - không save to ESP32
          updateOrderTable();
          updateOverview();
          
          // Kiểm tra hoàn thành đơn hàng
          if (currentOrder.currentCount >= currentOrder.quantity) {
            currentOrder.currentCount = currentOrder.quantity;
            currentOrder.status = 'completed';
            
            console.log(`✅ Hoàn thành đơn ${currentOrderIndex + 1}: ${currentOrder.customerName}`);
            
            // Tìm đơn hàng tiếp theo
            const nextOrderIndex = selectedOrders.findIndex((o, idx) => 
              idx > currentOrderIndex && o.status === 'waiting'
            );
            
            if (nextOrderIndex >= 0) {
              selectedOrders[nextOrderIndex].status = 'counting';
              countingState.currentOrderIndex = nextOrderIndex;
              console.log(`▶️ Chuyển sang đơn ${nextOrderIndex + 1}: ${selectedOrders[nextOrderIndex].customerName}`);
            } else {
              console.log('🎉 Hoàn thành tất cả đơn hàng trong batch!');
              countingState.isActive = false;
            }
            
            // Chỉ save khi có thay đổi status quan trọng
            saveOrderBatches();
            setTimeout(() => updateOrderTable(), 100); // Defer UI update
          }
        }
      }
    } else {
      console.log('⚠️ Received count update but no active batch or not counting');
    }
  }
}

function handleDeviceAlert(data) {
  console.log('Device Alert:', data);
  
  switch (data.alertType) {
    case 'WARNING':
      showNotification(`${data.message}`, 'warning');
      break;
    case 'COMPLETED':
      showNotification(`${data.message}`, 'success');
      // REMOVE handleOrderCompletion từ alert - để logic chính xác trong updateStatusFromDevice
      console.log('COMPLETED alert received but ignored - using updateStatusFromDevice logic instead');
      // handleOrderCompletion(data);
      break;
    case 'ERROR':
      showNotification(`${data.message}`, 'error');
      break;
    case 'IR_COMMAND':
      showNotification(`${data.message}`, 'info');
      break;
  }
}

function updateSensorStatus(data) {
  //console.log('Sensor update:', data);
  // Update sensor status indicators in UI
}

function updateHeartbeat(data) {
  // Update device online status
  const onlineIndicator = document.getElementById('deviceOnline');
  if (onlineIndicator) {
    onlineIndicator.textContent = 'Online';
    onlineIndicator.style.color = 'green';
  }
}

// Handle IR Command Messages from MQTT  
async function handleIRCommandMessage(data) {
  console.log('🎛️ IR Command received:', data);
  
  // Xử lý MQTT_READY signal từ ESP32
  if (data.action === 'MQTT_READY') {
    return;
  }
  
  // Xử lý IR command từ ESP32 - simulate user click
  switch(data.action) {
    case 'START':
      console.log('🎛️ IR Remote START - executing startCounting()');
      await startCounting();
      break;
    case 'PAUSE':
      console.log('🎛️ IR Remote PAUSE - executing pauseCounting()');  
      await pauseCounting();
      break;
    case 'RESET':
      console.log('🎛️ IR Remote RESET - executing resetCounting()');
      await resetCounting();
      break;
    default:
      console.log('🎛️ Unknown IR command:', data.action);
      break;
  }
  
  // Show notification về IR command
  const actionText = {
    'START': 'Bắt đầu đếm',
    'PAUSE': 'Tạm dừng', 
    'RESET': 'Reset hệ thống'
  };
  
  showNotification(`🎛️ Remote: ${actionText[data.action] || data.action}`, 'info');
}

// UI UPDATE FUNCTIONS FOR IR COMMANDS (NO ESP32 COMMANDS)
function initializeButtonStates() {
  // Trạng thái ban đầu: sẵn sàng bắt đầu
  document.getElementById('startBtn').disabled = false;
  document.getElementById('pauseBtn').disabled = true;
  document.getElementById('resetBtn').disabled = true;
  
  console.log('🎛️ Button states initialized to ready state');
}

function updateUIForStart() {
  // Update button states
  document.getElementById('startBtn').disabled = true;
  document.getElementById('pauseBtn').disabled = false;
  document.getElementById('resetBtn').disabled = false;
  
  // Update counting state
  countingState.isActive = true;
  
  // Visual feedback
  showNotification('🎛️ Remote: Bắt đầu đếm', 'success');
}

function updateUIForPause() {
  // Update button states  
  document.getElementById('startBtn').disabled = false;
  document.getElementById('pauseBtn').disabled = true;
  document.getElementById('resetBtn').disabled = false;
  
  // Update counting state
  countingState.isActive = false;
  
  // Visual feedback
  showNotification('🎛️ Remote: Tạm dừng', 'warning');
}

function updateUIForReset() {
  // Update button states - về trạng thái ban đầu
  document.getElementById('startBtn').disabled = false;
  document.getElementById('pauseBtn').disabled = true;
  document.getElementById('resetBtn').disabled = true;
  
  // Reset counting state
  countingState.isActive = false;
  countingState.totalCounted = 0;
  
  // Visual feedback
  showNotification('🎛️ Remote: Reset hệ thống', 'info');
}

// MQTT Command Functions
function sendMQTTCommand(topic, payload) {
  if (!mqttClient || !mqttConnected) {
    return false;
  }
  
  try {
    const message = JSON.stringify(payload);
    mqttClient.publish(topic, message);
    return true;
  } catch (error) {
    console.error('Failed to send MQTT command:', error);
    return false;
  }
}

// DEPRECATED: MQTT Command Functions - Now using API for Web->ESP32 commands
// These functions kept for compatibility but not used in main flow
function startCountingMQTT() {
  console.log('⚠️ startCountingMQTT is deprecated - using API instead');
  return false; // Force fallback to API
}

function pauseCountingMQTT() {
  console.log('⚠️ pauseCountingMQTT is deprecated - using API instead');
  return false; // Force fallback to API
}

function resetCountingMQTT() {
  console.log('⚠️ resetCountingMQTT is deprecated - using API instead');
  return false; // Force fallback to API
}

function selectOrderMQTT(orderData) {
  return sendMQTTCommand('bagcounter/cmd/select', {
    type: orderData.productName,
    target: orderData.quantity,
    warn: orderData.warningQuantity,
    timestamp: Date.now(),
    source: 'web'
  });
}

function updateConfigMQTT(configData) {
  return sendMQTTCommand('bagcounter/config/update', {
    ...configData,
    timestamp: Date.now(),
    source: 'web'
  });
}

// Management API Polling (Reduced Frequency - Only for CRUD operations)
function startManagementAPIPolling() {
  if (apiPollingInterval) {
    clearInterval(apiPollingInterval);
  }
  
  // Only poll for management data (orders, products, settings) - NOT real-time status
  apiPollingInterval = setInterval(async () => {
    try {
      await loadManagementData();
      
      // 🎛️ ALSO CHECK FOR IR COMMANDS từ status API (bổ sung cho MQTT)
      try {
        const statusResponse = await fetch('/api/status');
        if (statusResponse.ok) {
          const statusData = await statusResponse.json();
          
          // Process IR commands trong updateStatusFromDevice
          await updateStatusFromDevice(statusData);
        }
      } catch (irError) {
        console.error('IR status check error:', irError);
      }
      
    } catch (error) {
      console.error('Management API polling error:', error);
    }
  }, API_POLL_FREQUENCY);
  
  console.log(`Management API polling started (${API_POLL_FREQUENCY/1000}s interval)`);
}

async function loadManagementData() {
  try {
    // 🔄 CHỈ SYNC SETTINGS và PRODUCTS - KHÔNG SYNC ORDERS khi đang counting
    // console.log('🔄 Refreshing management data from ESP32...');
    
    const [productsResponse, settingsResponse] = await Promise.all([
      fetch('/api/products').catch(() => null),
      fetch('/api/settings').catch(() => null)
    ]);
    
    // CHỈ SYNC ORDERS khi KHÔNG đang counting để tránh ghi đè real-time data
    if (!countingState.isActive) {
      const ordersResponse = await fetch('/api/orders').catch(() => null);
      if (ordersResponse?.ok) {
        const orders = await ordersResponse.json();
        if (orders && orders.length > 0) {
          orderBatches = orders;
          localStorage.setItem('orderBatches', JSON.stringify(orderBatches));
          updateBatchSelector();
          updateCurrentBatchSelect();
          updateBatchDisplay();
          // console.log('📦 Orders refreshed from ESP32 (not counting)');
        }
      }
    } else {
      console.log('⚡ Skipping orders sync - real-time counting active');
    }
    
    if (productsResponse?.ok) {
      const products = await productsResponse.json();
      if (products && products.length > 0) {
        currentProducts = products;
        localStorage.setItem('products', JSON.stringify(currentProducts));
        updateProductTable();
        // console.log('🛍️ Products refreshed from ESP32');
      }
    }
    
    if (settingsResponse?.ok) {
      const settingsData = await settingsResponse.json();
      if (settingsData) {
        settings = { ...settings, ...settingsData };
        localStorage.setItem('settings', JSON.stringify(settings));
        updateSettingsForm();
        // console.log('⚙️ Settings refreshed from ESP32');
      }
    }
    
  } catch (error) {
    console.error('Error refreshing management data:', error);
  }
}

// Fallback to old API polling if MQTT fails
function startStatusPollingFallback() {
  console.log('Starting fallback API polling for real-time data...');
  startStatusPolling(); // Use the original function as fallback
}

// UI Update Functions
function updateMQTTStatus(connected) {
  const statusElement = document.getElementById('mqttStatus');
  if (statusElement) {
    statusElement.textContent = connected ? 'MQTT Connected' : 'API Mode';
    statusElement.style.color = connected ? 'green' : 'orange';
  }
}

function updateStatusIndicators(data) {
  // Update status indicators in UI
  const statusElement = document.getElementById('currentStatus');
  if (statusElement) {
    statusElement.textContent = data.status || 'UNKNOWN';
    statusElement.className = `status-${(data.status || 'unknown').toLowerCase()}`;
  }
  
  const countElement = document.getElementById('currentCount');
  if (countElement) {
    countElement.textContent = data.count || 0;
  }
  
  const targetElement = document.getElementById('currentTarget');
  if (targetElement) {
    targetElement.textContent = data.target || 0;
  }
  
  // CẬP NHẬT THÔNG TIN BATCH HIỆN TẠI
  if (data.currentBatchName) {
    // Update batch name display
    const batchNameElement = document.getElementById('currentBatchName');
    if (batchNameElement) {
      batchNameElement.textContent = data.currentBatchName;
    }
    
    // Update batch info display  
    const batchInfoElement = document.getElementById('batchInfoDisplay');
    if (batchInfoElement) {
      batchInfoElement.innerHTML = `
        <strong>📦 ${data.currentBatchName}</strong>
        ${data.currentBatchDescription ? `<br><small>${data.currentBatchDescription}</small>` : ''}
        <br><small>Đơn hàng: ${data.totalOrdersInBatch || 0}</small>
      `;
      batchInfoElement.style.display = 'block';
    }
    
    console.log('📦 Batch info updated:', data.currentBatchName, '- Orders:', data.totalOrdersInBatch);
  } else {
    // Hide batch info if no batch selected
    const batchInfoElement = document.getElementById('batchInfoDisplay');
    if (batchInfoElement) {
      batchInfoElement.style.display = 'none';
    }
  }
}

function updateControlButtons(data) {
  // Update button states based on device status
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const resetBtn = document.getElementById('resetBtn');
  
  if (startBtn && pauseBtn && resetBtn) {
    const isRunning = data.status === 'RUNNING';
    startBtn.disabled = isRunning;
    pauseBtn.disabled = !isRunning;
    resetBtn.disabled = false;
  }
}

function handleOrderCompletion(data) {
  console.log('Order completion detected:', data);
  
  // Handle order completion logic
  const activeBatch = orderBatches.find(b => b.isActive);
  if (activeBatch && countingState.isActive) {
    const currentOrder = activeBatch.orders.find(o => o.status === 'counting');
    if (currentOrder) {
      currentOrder.status = 'completed';
      // KHÔNG gán data.count trực tiếp - sử dụng quantity target thay vì total count
      currentOrder.currentCount = currentOrder.quantity;
      
      console.log(`Order completion - Set currentCount to target quantity: ${currentOrder.quantity}`);
      
      // Add to history
      countingHistory.push({
        timestamp: new Date().toISOString(),
        customerName: currentOrder.customerName,
        productName: currentOrder.product.name,
        plannedQuantity: currentOrder.quantity,
        actualCount: currentOrder.currentCount
      });
      
      saveOrderBatches();
      saveHistory();
      updateOrderTable();
      updateOverview();
      
      // Move to next order
      moveToNextOrder();
    }
  }
}

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
  
  // Initialize products form
  productItemCounter = 0;
  addInitialProductItem();
  
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
      
      // GỬI THÔNG TIN BATCH LÊN ESP32 KHI CHỌN
      activateBatchOnESP32(batch);
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
    const orderToRemove = currentOrderBatch[index];
    
    // Xóa từ array local
    currentOrderBatch.splice(index, 1);
    
    // Renumber orders
    currentOrderBatch.forEach((order, i) => {
      order.orderNumber = i + 1;
    });
    
    // 🗑️ Nếu đang edit batch có sẵn, gửi lệnh xóa đến ESP32
    if (currentBatchId && orderToRemove && orderToRemove.id) {
      deleteOrderFromBatchESP32(currentBatchId, orderToRemove.id);
    }
    
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
      <td>${index + 1}</td>
      <td>${order.customerName}</td>
      <td>${order.orderCode}</td>
      <td>${order.vehicleNumber}</td>
      <td>${order.productName}</td>
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
  
  console.log('🔧 DEBUG: Starting saveBatch()');
  console.log('   - currentBatchId:', currentBatchId);
  console.log('   - batchName:', batchName);
  console.log('   - currentOrderBatch length:', currentOrderBatch.length);
  
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
  
  console.log('🔧 DEBUG: Saving batch with details:');
  console.log('   - Batch name:', batchName);
  console.log('   - Batch ID:', batch.id);
  console.log('   - Orders count:', currentOrderBatch.length);
  console.log('   - First order sample:', currentOrderBatch[0]);
  console.log('   - Full batch object:', batch);
  
  if (currentBatchId) {
    // Update existing batch
    console.log('🔧 DEBUG: Updating existing batch with ID:', currentBatchId);
    const index = orderBatches.findIndex(b => b.id === currentBatchId);
    if (index !== -1) {
      orderBatches[index] = batch;
      console.log('🔧 DEBUG: Updated existing batch at index:', index);
    } else {
      console.log('❌ DEBUG: Batch ID not found in orderBatches!');
    }
  } else {
    // Add new batch
    console.log('🔧 DEBUG: Adding new batch');
    orderBatches.push(batch);
    console.log('🔧 DEBUG: Added new batch, total batches:', orderBatches.length);
  }
  
  saveOrderBatches();
  updateBatchSelector();
  updateCurrentBatchSelect();
  
  // GỬI TẤT CẢ BATCHES ĐẾN ESP32 ĐỂ SYNC TOÀN BỘ DỮ LIỆU
  sendOrderBatchesToESP32();
  
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
    
    // GỬI LỆNH XÓA BATCH ĐẾN ESP32
    deleteBatchFromESP32(selectedBatchId);
    
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
      if (batch.orders && batch.orders.length > 0) {
        batch.orders.forEach(order => {
          if (order.selected === undefined) {
            order.selected = true;
          }
        });
      }
      
      saveOrderBatches();
      
      // GỬI THÔNG TIN BATCH LÊN ESP32 KHI CHỌN
      activateBatchOnESP32(batch);
      
      const ordersCount = (batch.orders && batch.orders.length) || 0;
      console.log('Activated batch:', batch.name, 'with', ordersCount, 'orders');
      
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
  
  // console.log('Updating batch selector with', orderBatches.length, 'batches');
  
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
    const ordersCount = (batch.orders && batch.orders.length) || 0;
    option.textContent = `${batch.name} (${ordersCount} đơn)`;
    if (batch.isActive) {
      option.selected = true;
    }
    select.appendChild(option);
    // console.log('Added batch option:', batch.name);
  });
}

function updateCurrentBatchSelect() {
  // Cập nhật dropdown trong order tab
  const select = document.getElementById('currentBatchSelect');
  if (select) {
    select.innerHTML = '<option value="">Chọn danh sách</option>';
    
    orderBatches.forEach(batch => {
      const option = document.createElement('option');
      option.value = batch.id;
      option.textContent = batch.name;
      select.appendChild(option);
    });
  }
  
  // CẬP NHẬT DROPDOWN TRONG OVERVIEW TAB
  const batchSelector = document.getElementById('batchSelector');
  if (batchSelector) {
    batchSelector.innerHTML = '<option value="">Chọn danh sách đơn hàng</option>';
    
    orderBatches.forEach(batch => {
      const option = document.createElement('option');
      option.value = batch.id;
      option.textContent = batch.name;
      batchSelector.appendChild(option);
    });
    
    // console.log('✅ Updated batchSelector with', orderBatches.length, 'batches');
  }
}

function updateBatchDisplay() {
  // console.log('Updating batch display...');
  
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
  
  const ordersCount = (activeBatch.orders && activeBatch.orders.length) || 0;
  // console.log('Displaying batch:', activeBatch.name, 'with', ordersCount, 'orders');
  
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
    const productName = order.product?.name || order.productName || 'Unknown product';
    console.log(`Order ${productName} ${checked ? 'selected' : 'deselected'}`);
    
    // 🚀 GỬI THÔNG TIN SẢN PHẨM ĐẾN ESP32 KHI CHỌN
    if (checked) {
      const plannedQuantity = order.plannedQuantity || order.quantity;
      console.log('📦 Sending product info to ESP32:', productName, 'Target:', plannedQuantity);
      
      // Gửi cả set_product và batch_info để đảm bảo ESP32 nhận được
      sendESP32Command('set_product', {
        productName: productName,
        target: plannedQuantity
      }).catch(error => {
        console.error('Failed to send product to ESP32:', error);
      });
      
      // Gửi batch_info để cập nhật toàn bộ thông tin
      const productName = order.product?.name || order.productName || 'Unknown product';
      const orderQuantity = order.plannedQuantity || order.quantity;
      sendESP32Command('batch_info', {
        firstOrder: {
          productName: productName,
          quantity: orderQuantity
        }
      }).catch(error => {
        console.error('Failed to send batch info to ESP32:', error);
      });
    }
    
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
    tbody.innerHTML = '<tr><td colspan="8" class="text-center">Chưa có đơn hàng nào</td></tr>';
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
      <td><span class="order-number">${order.orderNumber || order.orderCode || 'N/A'}</span></td>
      <td>
        <input type="checkbox" ${order.selected ? 'checked' : ''} 
               onchange="selectOrder(${order.id}, this.checked)"
               ${order.status === 'counting' || order.status === 'completed' ? 'disabled' : ''}>
      </td>
      <td><strong>${order.quantity}${currentCountText}</strong></td>
      <td>${order.product?.name || order.productName || 'N/A'}</td>
      <td>${order.customerName}</td>
      <td>${order.vehicleNumber}</td>
      <td>
        <span class="status-indicator status-${order.status}">
          <i class="fas fa-${statusDisplay.icon}"></i>
          ${statusDisplay.text}
          ${order.status === 'counting' && order.currentCount ? ` (${order.currentCount}/${order.quantity})` : ''}
        </span>
      </td>
      <td>
        <button class="edit-btn" onclick="editOrderById(${order.id})" 
                ${order.status === 'counting' ? 'disabled' : ''}>
          <i class="fas fa-edit"></i>
        </button>
        <button class="delete-btn" onclick="deleteOrder(${order.id})" 
                ${order.status === 'counting' ? 'disabled' : ''}>
          <i class="fas fa-trash"></i>
        </button>
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
// 🔄 Hybrid Functions (MQTT preferred, API fallback)
async function startCounting() {
  console.log('Starting counting...');
  console.log('Current orderBatches:', orderBatches);
  
  let activeBatch = orderBatches.find(b => b.isActive);
  console.log('Active batch:', activeBatch);
  
  // Nếu không có batch active, thử active batch đầu tiên có orders
  if (!activeBatch && orderBatches.length > 0) {
    const batchWithOrders = orderBatches.find(b => b.orders && b.orders.length > 0);
    if (batchWithOrders) {
      // Deactivate all batches first
      orderBatches.forEach(b => b.isActive = false);
      // Activate the batch with orders
      batchWithOrders.isActive = true;
      activeBatch = batchWithOrders;
      saveOrderBatches();
      updateBatchSelector();
      console.log('Auto-activated batch:', activeBatch.name);
    }
  }
  
  if (!activeBatch) {
    showNotification('Vui lòng chọn danh sách đơn hàng trước', 'warning');
    return;
  }
  
  let selectedOrders = activeBatch.orders.filter(o => o.selected);
  console.log('Selected orders:', selectedOrders);
  
  // Nếu không có đơn hàng nào được chọn, auto-select tất cả
  if (selectedOrders.length === 0 && activeBatch.orders.length > 0) {
    activeBatch.orders.forEach(order => order.selected = true);
    selectedOrders = activeBatch.orders;
    saveOrderBatches();
    updateOrderTable();
    console.log('Auto-selected all orders:', selectedOrders.length);
  }
  
  if (selectedOrders.length === 0) {
    showNotification('Không có đơn hàng nào để đếm', 'warning');
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
  console.log('MQTT connected:', mqttConnected);
  
  // Tính tổng target cho toàn bộ batch
  const totalTarget = selectedOrders.reduce((sum, order) => sum + order.quantity, 0);
  const batchInfo = {
    totalTarget: totalTarget,
    totalOrders: selectedOrders.length,
    currentOrderIndex: currentOrderIndex,
    // Gửi thông tin đơn đầu tiên để ESP32 hiển thị
    firstOrder: {
      customerName: selectedOrders[currentOrderIndex].customerName,
      productName: selectedOrders[currentOrderIndex].productName || selectedOrders[currentOrderIndex].product?.name,
      orderCode: selectedOrders[currentOrderIndex].orderCode,
      quantity: selectedOrders[currentOrderIndex].quantity
    }
  };
  
  console.log('Sending batch info to ESP32:', batchInfo);
  
  try {
    // Web commands always use API to avoid MQTT loops
    console.log('🌐 Web START command - sending via API...');
    await sendESP32Command('start', batchInfo);
    
    updateUIForStart(); // Cập nhật UI state
    saveOrderBatches();
    updateOrderTable();
    updateOverview();
    
    showNotification('Bắt đầu đếm thành công', 'success');
    
  } catch (error) {
    console.error('Start counting error:', error);
    showNotification(`Lỗi bắt đầu đếm: ${error.message}`, 'error');
  }
}

async function pauseCounting() {
  console.log('⏸ Pausing counting...');
  console.log('MQTT connected:', mqttConnected);
  
  try {
    // Web commands always use API to avoid MQTT loops
    console.log('🌐 Web PAUSE command - sending via API...');
    await sendESP32Command('pause');
    
    updateUIForPause(); // Cập nhật UI state
    countingState.isActive = false;
    
    // � MANUAL UPDATE ORDERS TRƯỚC KHI REFRESH
    console.log('📝 Manually updating order status to paused...');
    const activeBatch = orderBatches.find(b => b.isActive);
    if (activeBatch) {
      let pausedCount = 0;
      activeBatch.orders.forEach(order => {
        if (order.status === 'counting') {
          order.status = 'paused';
          pausedCount++;
          console.log(`Order ${order.productName} changed to paused`);
        }
      });
      console.log(`📊 ${pausedCount} orders changed to paused status`);
      
      // Force save to ESP32
      console.log('💾 Force saving paused orders to ESP32...');
      await sendOrderBatchesToESP32();
      updateOrderTable();
    }
    
    // �🚀 FORCE REFRESH STATUS NGAY SAU PAUSE
    console.log('🔄 Force refreshing status after pause...');
    setTimeout(async () => {
      await loadOrderBatchesFromESP32();
      await loadSettingsFromESP32();
      updateOverview();
      updateOrderTable();
    }, 500);
    
    console.log('Counting paused successfully');
    showNotification('Đã tạm dừng đếm', 'info');
    updateOverview();
    
    showNotification('⏸️ Đã tạm dừng đếm', 'info');
    
  } catch (error) {
    console.error('Pause counting error:', error);
    showNotification(`Lỗi tạm dừng: ${error.message}`, 'error');
  }
}

async function resetCounting() {
  console.log('Resetting counting...');
  console.log('MQTT connected:', mqttConnected);
  
  if (!confirm('Bạn có chắc chắn muốn reset hệ thống đếm?')) {
    return;
  }
  
  try {
    // Web commands always use API to avoid MQTT loops
    console.log('🌐 Web RESET command - sending via API...');
    await sendESP32Command('reset');
    
    // Đợi ESP32 xử lý reset command + thêm delay cho polling
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Reset local state FORCE để ghi đè bất kỳ polling nào
    countingState.isActive = false;
    countingState.currentOrderIndex = 0;
    countingState.totalCounted = 0;
    
    // Reset all order statuses FORCE
    const activeBatch = orderBatches.find(b => b.isActive);
    if (activeBatch) {
      activeBatch.orders.forEach(order => {
        if (order.selected) {
          order.status = 'waiting'; // FORCE về waiting
          order.currentCount = 0;
        }
      });
      
      // Force save ngay lập tức để ESP32 biết
      await sendOrderBatchesToESP32();
    }
    
    saveOrderBatches();
    updateOrderTable();
    updateOverview();
    updateUIForReset(); // Thêm dòng này để update UI state
    
    console.log('✅ Reset completed - all orders set to WAITING');
    showNotification('✅ Đã reset hệ thống về trạng thái chờ', 'success');
    
  } catch (error) {
    console.error('Reset counting error:', error);
    showNotification(`Lỗi reset: ${error.message}`, 'error');
  }
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
      console.log('Đã gửi thông tin batch đến ESP32');
    } else {
      console.log('Không gửi được thông tin batch (không quan trọng)');
    }
  } catch (error) {
    console.log('Lỗi gửi batch info (không quan trọng):', error.message);
  }
}

// Hàm gửi toàn bộ danh sách đơn hàng đến ESP32
async function sendBatchOrdersToESP32(orders) {
  try {
    console.log('Gửi danh sách', orders.length, 'đơn hàng đến ESP32...');
    
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
        console.log('Danh sách đơn hàng đã gửi thành công đến ESP32 (batch):', result);
        showNotification(`Đã gửi ${orders.length} đơn hàng đến ESP32`, 'success');
        return true;
      } else if (response.status === 404) {
        // Endpoint không tồn tại, fallback sang gửi từng đơn
        console.log('Endpoint batch_orders không tồn tại, gửi từng đơn hàng...');
        return await sendOrdersOneByOne(orders);
      } else {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    } catch (fetchError) {
      if (fetchError.message.includes('404') || fetchError.message.includes('Not Found')) {
        console.log('Endpoint batch_orders không tồn tại, gửi từng đơn hàng...');
        return await sendOrdersOneByOne(orders);
      } else {
        throw fetchError;
      }
    }
    
  } catch (error) {
    console.error('Lỗi gửi danh sách đơn hàng đến ESP32:', error);
    showNotification('Lỗi gửi danh sách đến ESP32: ' + error.message, 'error');
    return false;
  }
}

// Hàm fallback: gửi từng đơn hàng một
async function sendOrdersOneByOne(orders) {
  try {
    console.log('Gửi từng đơn hàng (fallback mode)...');
    let successCount = 0;
    
    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];
      const productName = order.product?.name || order.productName || 'Unknown product';
      console.log(`Gửi đơn ${i + 1}/${orders.length}: ${order.customerName} - ${productName}`);
      
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
      console.log('Tất cả đơn hàng đã được gửi thành công (fallback)');
      showNotification(`Đã gửi ${successCount}/${orders.length} đơn hàng đến ESP32`, 'success');
      return true;
    } else {
      console.warn(`Chỉ gửi được ${successCount}/${orders.length} đơn hàng`);
      showNotification(`Chỉ gửi được ${successCount}/${orders.length} đơn hàng`, 'warning');
      return successCount > 0; // Trả về true nếu ít nhất 1 đơn thành công
    }
    
  } catch (error) {
    console.error('Lỗi trong fallback mode:', error);
    showNotification('Lỗi gửi đơn hàng: ' + error.message, 'error');
    return false;
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
    const productToDelete = currentProducts[index];
    
    // Xóa từ array local
    currentProducts.splice(index, 1);
    
    // Lưu và sync với ESP32
    saveProducts(); // Đã bao gồm sendAllProductsToESP32()
    
    // GỬI LỆNH XÓA ĐẾN ESP32
    if (productToDelete && productToDelete.id) {
      deleteProductFromESP32(productToDelete.id);
    }
    
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
  console.log('Loading history from localStorage...');
  const saved = localStorage.getItem('countingHistory');
  console.log('Raw localStorage data:', saved);
  
  if (saved) {
    try {
      countingHistory = JSON.parse(saved);
      console.log('Parsed history:', countingHistory.length, 'entries');
      console.log('History data:', countingHistory);
    } catch (error) {
      console.error('Error parsing history:', error);
      countingHistory = [];
    }
  } else {
    console.log('No saved history found');
    countingHistory = [];
  }
  updateHistoryTable();
}

function saveHistory() {
  // Giới hạn tối đa 50 entries (FIFO)
  if (countingHistory.length > 50) {
    countingHistory = countingHistory.slice(-50); // Giữ 50 entries mới nhất
    console.log('History trimmed to 50 entries (FIFO)');
  }
  
  localStorage.setItem('countingHistory', JSON.stringify(countingHistory));
  console.log('History saved to localStorage:', countingHistory.length, 'entries');
  
  // Gửi lịch sử đến ESP32
  sendHistoryToESP32();
}

// Gửi lịch sử đến ESP32 (tối đa 50 entries) - CHỈ QUA API
async function sendHistoryToESP32() {
  try {
    // Chỉ gửi 50 entries mới nhất
    const historyToSend = countingHistory.slice(-50);
    
    console.log('Sending', historyToSend.length, 'history entries to ESP32...');
    
    const response = await fetch('/api/history', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(historyToSend)
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log('✅ History sent to ESP32 successfully:', result);
    } else {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
  } catch (error) {
    console.error('❌ Error sending history to ESP32:', error);
    // Không báo lỗi cho user vì đây là background sync
  }
}

function updateHistoryTable() {
  console.log('🔄 updateHistoryTable called');
  console.log('📊 countingHistory length:', countingHistory.length);
  console.log('📊 countingHistory data:', countingHistory);
  
  const tbody = document.getElementById('historyTableBody');
  console.log('📊 historyTableBody element:', tbody);
  
  if (!tbody) {
    console.error('historyTableBody element not found!');
    return;
  }
  
  tbody.innerHTML = '';
  
  if (countingHistory.length === 0) {
    console.log('No history data, showing empty message');
    tbody.innerHTML = '<tr><td colspan="7" class="text-center">Chưa có lịch sử đếm</td></tr>';
    return;
  }
  
  console.log('Processing', countingHistory.length, 'history entries');
  
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
    
    // Xác định class CSS cho accuracy
    let accuracyClass = 'accuracy-good';
    if (accuracy < 95) accuracyClass = 'accuracy-warning';
    if (accuracy < 90) accuracyClass = 'accuracy-error';
    
    row.innerHTML = `
      <td style="font-weight: 500;">${new Date(entry.timestamp).toLocaleString('vi-VN')}</td>
      <td>
        ${isBatch ? '<span class="batch-indicator">📦 BATCH</span>' : ''}
        <strong>${entry.customerName}</strong>
        ${entry.orderCode ? `<br><small style="color: #666; font-size: 12px;">Mã: ${entry.orderCode}</small>` : ''}
      </td>
      <td style="text-align: center;">${entry.vehicleNumber || 'N/A'}</td>
      <td style="font-weight: 500;">${entry.productName}</td>
      <td class="number-cell" style="color: #333;">${entry.plannedQuantity}</td>
      <td class="number-cell">
        <span style="color: ${isAccurate ? '#4CAF50' : '#f44336'}; font-weight: bold;">
          ${entry.actualCount}
        </span>
        <br>
        <small class="${accuracyClass}">(${accuracy}%)</small>
      </td>
      <td style="text-align: center;">
        <span class="status-indicator ${isAccurate ? 'status-completed' : 'status-warning'}">
          <i class="fas fa-${isAccurate ? 'check-circle' : 'exclamation-triangle'}"></i>
          ${isAccurate ? 'Đạt' : 'Lệch'}
        </span>
      </td>
    `;
    
    // Highlight batch entries with CSS classes
    if (isBatch) {
      row.classList.add('batch-history-row');
      row.title = `Danh sách đơn hàng - Click để xem chi tiết`;
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
    
    // Lưu local và gửi đến ESP32
    saveHistory(); // Này sẽ gọi sendHistoryToESP32() với array rỗng
    
    // 🗑️ GỬI LỆNH XÓA TẤT CẢ LỊCH SỬ ĐẾN ESP32
    clearHistoryFromESP32();
    
    updateHistoryTable();
    showNotification('Xóa lịch sử thành công', 'info');
  }
}

// Data Persistence (Updated)
function loadOrderBatches() {
  console.log('📋 Loading order batches from localStorage...');
  
  const saved = localStorage.getItem('orderBatches');
  if (saved) {
    try {
      const loadedBatches = JSON.parse(saved);
      // Validate and fix batch structure
      orderBatches = loadedBatches.map(batch => ({
        ...batch,
        orders: Array.isArray(batch.orders) ? batch.orders : []
      }));
      console.log('✅ Loaded', orderBatches.length, 'batches from localStorage');
      
      if (orderBatches.length > 0) {
        console.log('📋 First batch sample from localStorage:', orderBatches[0]);
      }
    } catch (error) {
      console.error('❌ Error parsing order batches from localStorage:', error);
      orderBatches = [];
    }
  } else {
    console.log('ℹ️ No saved batches found in localStorage, creating sample data');
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
    // Lưu vào localStorage
    localStorage.setItem('orderBatches', JSON.stringify(orderBatches));
    console.log('📋 Saved', orderBatches.length, 'batches to localStorage');
    
    // Không tự động gửi ESP32 ở đây để tránh spam, chỉ gửi khi cần
    
  } catch (error) {
    console.error('Error saving order batches:', error);
  }
}

// Gửi tất cả order batches đến ESP32
async function sendOrderBatchesToESP32() {
  try {
    console.log('📤 Sending all order batches to ESP32...', orderBatches.length, 'batches');
    
    // Validate orderBatches trước khi gửi
    if (!Array.isArray(orderBatches)) {
      console.error('❌ orderBatches is not an array:', typeof orderBatches);
      return;
    }
    
    // Log first batch để debug
    if (orderBatches.length > 0) {
      console.log('📋 DEBUG: First batch details:');
      console.log('   - Batch name:', orderBatches[0].name);
      console.log('   - Batch ID:', orderBatches[0].id);
      console.log('   - Orders array exists:', !!orderBatches[0].orders);
      console.log('   - Orders count:', orderBatches[0].orders?.length || 0);
      if (orderBatches[0].orders && orderBatches[0].orders.length > 0) {
        console.log('   - First order:', orderBatches[0].orders[0]);
      }
      console.log('   - Full batch:', orderBatches[0]);
    }
    
    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(orderBatches)
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log('✅ Order batches sent to ESP32 successfully:', result);
      //showNotification(`Đã lưu ${orderBatches.length} lô đơn hàng lên ESP32`, 'success');
    } else {
      const errorText = await response.text();
      throw new Error(`HTTP error! status: ${response.status}, response: ${errorText}`);
    }
    
  } catch (error) {
    console.error('❌ Error sending order batches to ESP32:', error);
    showNotification('Lỗi lưu đơn hàng lên ESP32: ' + error.message, 'error');
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
  // Lưu vào localStorage
  localStorage.setItem('products', JSON.stringify(currentProducts));
  
  // 🔄 GỬI ĐẾN ESP32 ĐỂ GHI ĐÈ DỮ LIỆU MẶC ĐỊNH
  sendAllProductsToESP32();
}

// Gửi tất cả products đến ESP32
async function sendAllProductsToESP32() {
  try {
    console.log('📡 Sending all products to ESP32...');
    
    const response = await fetch('/api/products', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(currentProducts)
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log('✅ Products sent to ESP32:', result);
    } else {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
  } catch (error) {
    console.error('❌ Error sending products to ESP32:', error);
  }
}

function loadSettings() {
  console.log('🔧 Loading settings...');
  
  // ⚠️ KHÔNG load từ localStorage trước nữa - chỉ load từ ESP32
  // Tránh việc localStorage ghi đè lên ESP32 settings
  console.log('📡 Skipping localStorage, will load directly from ESP32');
  
  // Load trực tiếp từ ESP32
  loadSettingsFromESP32();
}

// Load settings from ESP32
async function loadSettingsFromESP32() {
  try {
    const response = await fetch('/api/settings');
    if (response.ok) {
      const esp32Settings = await response.json();
      
      console.log('📡 ESP32 settings received:', esp32Settings);
      console.log('🔍 Settings file exists on ESP32:', esp32Settings._settingsFileExists);
      
      // ⚡ GHI ĐÈ HOÀN TOÀN settings từ ESP32 (không merge)
      if (esp32Settings.conveyorName !== undefined) settings.conveyorName = esp32Settings.conveyorName;
      if (esp32Settings.ipAddress !== undefined) settings.ipAddress = esp32Settings.ipAddress;
      if (esp32Settings.gateway !== undefined) settings.gateway = esp32Settings.gateway;
      if (esp32Settings.subnet !== undefined) settings.subnet = esp32Settings.subnet;
      if (esp32Settings.brightness !== undefined) settings.brightness = esp32Settings.brightness;
      if (esp32Settings.sensorDelay !== undefined) settings.sensorDelay = esp32Settings.sensorDelay;
      if (esp32Settings.bagDetectionDelay !== undefined) settings.bagDetectionDelay = esp32Settings.bagDetectionDelay;
      if (esp32Settings.minBagInterval !== undefined) settings.minBagInterval = esp32Settings.minBagInterval;
      if (esp32Settings.autoReset !== undefined) settings.autoReset = esp32Settings.autoReset;
      if (esp32Settings.relayDelayAfterComplete !== undefined) settings.relayDelayAfterComplete = esp32Settings.relayDelayAfterComplete;
      // ⚡ LƯU NGAY VÀO localStorage (đè settings cũ)
      localStorage.setItem('settings', JSON.stringify(settings));
      updateSettingsForm();
      
      console.log('✅ Settings loaded and synced from ESP32:', settings);
      showNotification('Đã tải cài đặt từ ESP32', 'success');
      
      // ⚡ CẬP NHẬT NGAY TÊN BĂNG TẢI TRÊN DISPLAY
      updateConveyorNameDisplay();
    } else {
      console.log('❌ Failed to load settings from ESP32, using defaults');
      showNotification('Không thể tải cài đặt từ ESP32', 'warning');
    }
  } catch (error) {
    console.error('❌ Error loading settings from ESP32:', error);
    showNotification('Lỗi kết nối ESP32', 'error');
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
  document.getElementById('relayDelay').value = settings.relayDelayAfterComplete / 1000; // Convert ms to seconds
  // ⚡ CẬP NHẬT TÊN BĂNG TẢI TRÊN HEADER
  updateConveyorNameDisplay();
}

// ⚡ Hàm cập nhật tên băng tải hiển thị
function updateConveyorNameDisplay() {
  const conveyorIdElement = document.getElementById('conveyorId');
  if (conveyorIdElement && settings.conveyorName) {
    console.log('🏷️ Updating conveyor name display from:', conveyorIdElement.textContent, 'to:', settings.conveyorName);
    conveyorIdElement.textContent = settings.conveyorName;
  }
}

// Load order batches from ESP32 
async function loadOrderBatchesFromESP32() {
  try {
    console.log('📋 Loading order batches from ESP32...');
    const response = await fetch('/api/orders');
    
    if (response.ok) {
      const esp32Batches = await response.json();
      console.log('📡 ESP32 batches received:', esp32Batches);
      
      if (esp32Batches && Array.isArray(esp32Batches) && esp32Batches.length > 0) {
        // Validate and fix batch structure
        orderBatches = esp32Batches.map(batch => ({
          ...batch,
          orders: Array.isArray(batch.orders) ? batch.orders : []
        }));
        console.log('✅ Updated orderBatches from ESP32:', orderBatches.length, 'batches');
        
        // Cập nhật UI
        updateCurrentBatchSelect();
        updateBatchSelector();
        
        return orderBatches;
      } else {
        console.log('📋 ESP32 has no batches - using localStorage');
        return [];
      }
    } else {
      console.warn('Failed to load order batches from ESP32:', response.status);
      return [];
    }
  } catch (error) {
    console.error('Error loading order batches from ESP32:', error);
    return [];
  }
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
// Biến để tạm thời tắt status polling sau khi gửi command
let disablePollingUntil = 0;

async function sendESP32Command(action, data = {}) {
  try {
    const payload = {
      cmd: action,
      ...data
    };
    
    // Chỉ log cho button commands quan trọng
    if (['start', 'pause', 'reset'].includes(action)) {
      console.log(`🌐 Web→ESP32: ${action.toUpperCase()}`, payload);
      
      // Tắt polling trong 1 giây để tránh conflict
      disablePollingUntil = Date.now() + 1000;
      console.log('⏸️ Disabling status polling for 1 second to avoid conflict');
    }
    
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
    console.log(`✅ ESP32 response for ${action}:`, result);
    
    if (action === 'next_order') {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    return result;
    
  } catch (error) {
    console.error('Error sending ESP32 command:', error);
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
      const productName = order.product?.name || order.productName || 'Unknown product';
      console.log(`Sending order ${i + 1}/${batch.orders.length}:`, order.customerName, '-', productName);
      
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
      productName: order.product?.name || order.productName,
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

// GỬI THÔNG TIN BATCH ĐẾN ESP32 KHI ACTIVATE/CHỌN BATCH
async function activateBatchOnESP32(batch) {
  try {
    console.log('🔄 Activating batch on ESP32:', batch.name);
    
    // Tính tổng kế hoạch của tất cả đơn hàng trong batch
    const batchTotalTarget = batch.orders.reduce((total, order) => {
      return total + (order.quantity || 0);
    }, 0);
    
    console.log('📊 Batch total target:', batchTotalTarget, 'from', batch.orders.length, 'orders');
    
    // Gửi thông tin batch
    const batchPayload = {
      batchName: batch.name,
      batchId: batch.id,
      batchDescription: batch.description || '',
      totalOrders: batch.orders.length,
      batchTotalTarget: batchTotalTarget  // Thêm tổng target
    };
    
    console.log('Sending batch info to ESP32:', batchPayload);
    
    const response = await fetch('/api/activate_batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(batchPayload)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('ESP32 batch activation error:', errorText);
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const result = await response.json();
    console.log('✅ Batch activated on ESP32:', result);
    
    // Nếu batch có đơn hàng, gửi đơn hàng đầu tiên để hiển thị
    if (batch.orders && batch.orders.length > 0) {
      const firstOrder = batch.orders[0];
      const productName = firstOrder.product?.name || firstOrder.productName || 'Unknown product';
      console.log('Sending first order for display:', productName);
      await sendOrderToESP32(firstOrder);
    }
    
    showNotification(`Đã chọn danh sách: ${batch.name}`, 'success');
    return true;
    
  } catch (error) {
    console.error('Error activating batch on ESP32:', error);
    showNotification('Lỗi kích hoạt danh sách: ' + error.message, 'error');
    return false;
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

async function updateStatusFromDevice(data) {
  if (!data) return;
  
  // Kiểm tra xem có đang tạm tắt polling không
  if (disablePollingUntil > Date.now()) {
    console.log('⏸️ Status polling disabled, skipping update to avoid conflict');
    return;
  }
  
  // 🎛️ Check for IR commands in status when MQTT might not work
  if (data.lastIRCommand && data.lastIRTimestamp) {
    // Check if this is a new IR command (different timestamp)
    if (!window.lastProcessedIRTimestamp || data.lastIRTimestamp !== window.lastProcessedIRTimestamp) {
      console.log('🎛️ ESP32→Web: IR ' + data.lastIRCommand + ' (polling)');
      window.lastProcessedIRTimestamp = data.lastIRTimestamp;
      
      // Process IR command like MQTT
      await handleIRCommandMessage({
        source: "IR_REMOTE",
        action: data.lastIRCommand,
        status: data.status,
        count: data.count,
        timestamp: data.lastIRTimestamp
      });
    }
  }
  
  // Update current count if device has new count
  if (data.count !== undefined) {
    const activeBatch = orderBatches.find(b => b.isActive);
    if (activeBatch && countingState.isActive) {
      const selectedOrders = activeBatch.orders.filter(o => o.selected);
      const currentOrderIndex = selectedOrders.findIndex(o => o.status === 'counting');
      
      if (currentOrderIndex >= 0) {
        const currentOrder = selectedOrders[currentOrderIndex];
        
        // ESP32 gửi total count tích lũy cho toàn bộ batch
        const totalCountFromDevice = data.count;
        
        // Debug: Log thông tin đơn hàng hiện tại
        console.log(`🔍 DEBUG - Đơn ${currentOrderIndex + 1}:`, {
          customerName: currentOrder.customerName,
          quantity: currentOrder.quantity,
          currentCount: currentOrder.currentCount,
          status: currentOrder.status
        });
        
        // Tính số đếm đã hoàn thành từ các đơn hàng trước đó (THEO THỨ TỰ)
        let completedCount = 0;
        for (let i = 0; i < currentOrderIndex; i++) {
          // Đối với đơn đã completed, cộng đúng số quantity
          if (selectedOrders[i].status === 'completed') {
            completedCount += selectedOrders[i].quantity;
            console.log(`🔍 DEBUG - Đơn ${i + 1} đã hoàn thành: ${selectedOrders[i].quantity} bao`);
          }
        }
        
        // Số đếm hiện tại của đơn hàng = total từ ESP32 - đã hoàn thành trước đó
        const calculatedCurrentCount = Math.max(0, totalCountFromDevice - completedCount);
        
        // ĐẢM BẢO không vượt quá target của đơn hiện tại
        const newCurrentCount = Math.min(calculatedCurrentCount, currentOrder.quantity);
        
        // CHỈ cập nhật nếu số mới lớn hơn (tránh ghi đè sai)
        if (newCurrentCount >= (currentOrder.currentCount || 0)) {
          currentOrder.currentCount = newCurrentCount;
        }
        
        console.log(`🔍 DEBUG - Tính toán chi tiết:`, {
          currentOrderIndex: currentOrderIndex,
          totalFromESP32: totalCountFromDevice,
          completedCountFromPreviousOrders: completedCount,
          calculatedCurrentCount: calculatedCurrentCount,
          currentOrder_oldCurrentCount: currentOrder.currentCount || 0,
          currentOrder_newCurrentCount: newCurrentCount,
          currentOrder_targetQuantity: currentOrder.quantity,
          willUpdate: newCurrentCount >= (currentOrder.currentCount || 0)
        });
        
        // Cập nhật tổng đếm
        countingState.totalCounted = totalCountFromDevice;
        
        console.log(`Đơn ${currentOrderIndex + 1}/${selectedOrders.length}: ${currentOrder.customerName}`);
        console.log(`ESP32 total: ${totalCountFromDevice} | Đã xong: ${completedCount} | Đơn hiện tại: ${currentOrder.currentCount}/${currentOrder.quantity}`);
        console.log(`Tổng batch: ${countingState.totalCounted}/${countingState.totalPlanned}`);
        
        // Kiểm tra xem đơn hàng hiện tại đã hoàn thành chưa
        if (currentOrder.currentCount >= currentOrder.quantity) {
          currentOrder.currentCount = currentOrder.quantity; // Đảm bảo không vượt quá
          currentOrder.status = 'completed';
          
          const productName = currentOrder.product?.name || currentOrder.productName || 'Unknown product';
          console.log(`HOÀN THÀNH ĐƠN ${currentOrderIndex + 1}: ${currentOrder.customerName} - ${productName}`);
          console.log(`Order completion details:`, {
            orderIndex: currentOrderIndex,
            customerName: currentOrder.customerName,
            quantity: currentOrder.quantity,
            currentCount: currentOrder.currentCount,
            status: currentOrder.status
          });
          
          // Lưu đơn hàng vào lịch sử đơn lẻ
          const historyEntry = {
            timestamp: new Date().toISOString(),
            customerName: currentOrder.customerName,
            productName: currentOrder.product?.name || currentOrder.productName,
            orderCode: currentOrder.orderCode,
            vehicleNumber: currentOrder.vehicleNumber,
            plannedQuantity: currentOrder.quantity,
            actualCount: currentOrder.currentCount
          };
          
          console.log('ĐANG LƯU VÀO LỊCH SỬ:', historyEntry);
          console.log('countingHistory trước khi thêm:', countingHistory.length);
          
          countingHistory.push(historyEntry);
          saveHistory();
          
          console.log('countingHistory sau khi thêm:', countingHistory.length);
          console.log('localStorage countingHistory:', localStorage.getItem('countingHistory') ? 'EXISTS' : 'NULL');
          console.log('Parsed từ localStorage:', JSON.parse(localStorage.getItem('countingHistory') || '[]').length);
          
          // CẬP NHẬT BẢNG LỊCH SỬ NGAY LẬP TỨC
          updateHistoryTable();
          console.log('ĐÃ CẬP NHẬT BẢNG LỊCH SỬ');
          
          // HIỂN THỊ THÔNG BÁO VỀ LỊCH SỬ
          setTimeout(() => {
            const historyTab = document.querySelector('[data-tab="history"]') || document.querySelector('[onclick="showTab(\'history\')"]');
            if (historyTab) {
              console.log('Có thể chuyển sang tab Lịch sử để xem kết quả');
              showNotification(`Đã lưu lịch sử đơn ${currentOrder.customerName}. Xem tại tab "Lịch sử đếm"`, 'success');
            }
          }, 500);
          
          // KIỂM TRA XEM CÒN ĐƠN HÀNG TIẾP THEO KHÔNG
          if (currentOrderIndex < selectedOrders.length - 1) {
            // VẪN CÒN ĐƠN HÀNG TIẾP THEO 
            console.log(`VẪN CÒN ${selectedOrders.length - currentOrderIndex - 1} ĐƠN HÀNG NỮA`);
            console.log(`Current order index: ${currentOrderIndex}, total orders: ${selectedOrders.length}`);
            
            // Chuyển đơn tiếp theo sang trạng thái counting
            const nextOrder = selectedOrders[currentOrderIndex + 1];
            const nextProductName = nextOrder.product?.name || nextOrder.productName;
            console.log(`Next order details:`, {
              index: currentOrderIndex + 1,
              customerName: nextOrder.customerName,
              productName: nextProductName,
              quantity: nextOrder.quantity,
              currentStatus: nextOrder.status
            });
            
            nextOrder.status = 'counting';
            countingState.currentOrderIndex = currentOrderIndex + 1;
            
            console.log(`CHUYỂN SANG ĐƠN ${countingState.currentOrderIndex + 1}/${selectedOrders.length}: ${nextOrder.customerName}`);
            
            // ❗ QUAN TRỌNG: Cập nhật target mới cho ESP32 để nó tiếp tục đếm
            // ESP32 hiện tại có isLimitReached=true, cần reset để tiếp tục
            const newTotalTarget = selectedOrders.reduce((sum, order) => sum + order.quantity, 0);
            
            console.log(`TARGET CALCULATION:`, {
              selectedOrders: selectedOrders.map(o => `${o.customerName}: ${o.quantity}`),
              newTotalTarget: newTotalTarget,
              mqttConnected: mqttConnected
            });
            
            try {
              console.log(`GỬI LỆNH CẬP NHẬT TARGET CHO ESP32: ${newTotalTarget}`);
              
              if (mqttConnected) {
                console.log(`Sending MQTT command to bagcounter/config/update`);
                // Gửi lệnh update target qua MQTT
                const result = sendMQTTCommand('bagcounter/config/update', {
                  target: newTotalTarget,
                  resetLimit: true,
                  nextOrder: {
                    customerName: nextOrder.customerName,
                    productName: nextOrder.product?.name || nextOrder.productName,
                    quantity: nextOrder.quantity,
                    orderCode: nextOrder.orderCode
                  }
                });
                console.log(`MQTT command result:`, result);
              } else {
                console.log(`Sending API command`);
                // Gửi qua API
                await sendESP32Command('update_target', { 
                  target: newTotalTarget,
                  resetLimit: true 
                });
              }
              
              console.log('ĐÃ GỬI LỆNH CẬP NHẬT TARGET CHO ESP32');
              
            } catch (error) {
              console.error('LỖI CẬP NHẬT TARGET:', error);
            }
            
            showNotification(`Chuyển sang đơn ${countingState.currentOrderIndex + 1}: ${nextOrder.customerName}`, 'info');
            
          } else {
            // ĐÂY LÀ HOÀN THÀNH TẤT CẢ
            console.log(`HOÀN THÀNH TẤT CẢ ${selectedOrders.length} ĐƠN HÀNG!`);
            countingState.isActive = false;
            
            // Gửi lệnh pause đến ESP32 để dừng đếm
            try {
              if (mqttConnected) {
                pauseCountingMQTT();
              } else {
                await sendESP32Command('pause');
              }
              console.log('ESP32 đã được lệnh dừng');
            } catch (error) {
              console.error('Lỗi gửi lệnh pause:', error);
            }
            
            showNotification(`Hoàn thành tất cả ${selectedOrders.length} đơn hàng!`, 'success');
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
        productName: nextOrder.product?.name || nextOrder.productName,
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
      console.log('Hoàn thành tất cả đơn hàng!');
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
  
  // Force refresh UI to ensure order transition is visible
  setTimeout(() => {
    console.log('force refreshing UI after order transition');
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
        productName: order.product?.name || order.productName,
        vehicleNumber: order.vehicleNumber,
        plannedQuantity: order.quantity,
        actualCount: order.currentCount
      }))
    }
  };
  
  // Thêm vào lịch sử đếm chính
  countingHistory.push(batchEntry);
  saveHistory();
  
  console.log('Đã lưu batch vào lịch sử đếm:', batch.name);
  console.log('Tổng kế hoạch:', batchEntry.plannedQuantity, '- Tổng thực hiện:', batchEntry.actualCount);
  
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
  settings.relayDelayAfterComplete = parseInt(document.getElementById('relayDelay').value) * 1000; // Convert seconds to ms
  console.log('💾 Saving settings to ESP32:', settings);
  
  // Lưu vào localStorage
  localStorage.setItem('settings', JSON.stringify(settings));
  
  // CẬP NHẬT TÊN BĂNG TẢI NGAY LẬP TỨC
  const conveyorIdElement = document.getElementById('conveyorId');
  if (conveyorIdElement) {
    conveyorIdElement.textContent = settings.conveyorName;
    console.log('Conveyor name display updated immediately to:', settings.conveyorName);
  }
  
  // Gửi đến ESP32 qua API (ưu tiên)
  sendSettingsToESP32();
  
  // Gửi qua MQTT để sync real-time (backup)
  sendSettingsViaMQTT();
  
  showNotification('Lưu cài đặt thành công', 'success');
}

// Gửi settings qua MQTT (real-time sync)
function sendSettingsViaMQTT() {
  if (mqttConnected && mqttClient) {
    try {
      const mqttSettings = {
        conveyorName: settings.conveyorName,
        brightness: settings.brightness,
        sensorDelay: settings.sensorDelay,
        bagDetectionDelay: settings.bagDetectionDelay,
        minBagInterval: settings.minBagInterval,
        autoReset: settings.autoReset
      };
      
      const message = JSON.stringify(mqttSettings);
      console.log('📡 Sending settings via MQTT:', message);
      
      mqttClient.publish('bagcounter/config/update', message);
      console.log('✅ Settings sent via MQTT');
      
    } catch (error) {
      console.error('❌ Error sending settings via MQTT:', error);
    }
  } else {
    console.log('⚠️ MQTT not connected, skipping MQTT settings sync');
  }
}

// Kiểm tra dữ liệu ESP32
// async function checkESP32Data() {
//   try {
//     console.log('=== CHECKING ESP32 DATA ===');
    
//     // Check status
//     const statusResponse = await fetch('/api/status');
//     if (statusResponse.ok) {
//       const statusData = await statusResponse.json();
//       console.log('ESP32 Status:', statusData);
//     }
    
//     // Check orders
//     const ordersResponse = await fetch('/api/orders');
//     if (ordersResponse.ok) {
//       const ordersData = await ordersResponse.json();
//       console.log('ESP32 Orders (' + ordersData.length + '):', ordersData);
//     }
    
//     // Check products
//     const productsResponse = await fetch('/api/products');
//     if (productsResponse.ok) {
//       const productsData = await productsResponse.json();
//       console.log('ESP32 Products (' + productsData.length + '):', productsData);
//     }
    
//     // Check settings
//     const settingsResponse = await fetch('/api/settings');
//     if (settingsResponse.ok) {
//       const settingsData = await settingsResponse.json();
//       console.log('ESP32 Settings:', settingsData);
//     }
    
//     console.log('=== END ESP32 DATA CHECK ===');
//     showNotification('Đã kiểm tra dữ liệu ESP32 - xem console (F12)', 'info');
    
//   } catch (error) {
//     console.error('Error checking ESP32 data:', error);
//     showNotification('Lỗi kiểm tra dữ liệu ESP32: ' + error.message, 'error');
//   }
// }

// UI Functions (Updated)
// Removed old showTab function - using new one with authentication

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

// Make control functions available globally  
window.startCounting = startCounting;
window.pauseCounting = pauseCounting;
window.resetCounting = resetCounting;

// Tab Management
// Removed old showTab function - using new one with authentication

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
    // Xóa từ array local
    currentProducts = currentProducts.filter(p => p.id !== id);
    
    // Lưu và sync với ESP32
    saveProducts();
    
    // GỬI LỆNH XÓA ĐẾN ESP32
    deleteProductFromESP32(id);
    
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
    updateHistoryTable();
    return;
  }
  
  const filteredHistory = countingHistory.filter(item => {
    const itemDate = new Date(item.timestamp).toISOString().split('T')[0];
    return itemDate >= dateFrom && itemDate <= dateTo;
  });
  
  // Update history table with filtered data
  updateHistoryTableWithData(filteredHistory);
}

function updateHistoryTableWithData(historyData) {
  const tbody = document.getElementById('historyTableBody');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  if (historyData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center">Không tìm thấy dữ liệu trong khoảng thời gian này</td></tr>';
    return;
  }
  
  // Sắp xếp theo thời gian mới nhất
  const sortedHistory = [...historyData].sort((a, b) => 
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

function exportHistory() {
  if (countingHistory.length === 0) {
    alert('Không có dữ liệu để xuất');
    return;
  }
  
  // Sử dụng BOM để fix encoding UTF-8
  let csvContent = "data:text/csv;charset=utf-8,\uFEFF";
  csvContent += "Mã đơn hàng,Khách hàng,Sản phẩm,Xe,Số lượng thực tế,Số lượng kế hoạch,Thời gian\n";
  
  countingHistory.forEach(item => {
    // Sử dụng đúng property names và xử lý undefined
    const orderCode = item.orderCode || 'N/A';
    const customerName = item.customerName || 'N/A';
    const productName = item.productName || 'N/A';
    const vehicleNumber = item.vehicleNumber || 'N/A';
    const actualCount = item.actualCount || 0;
    const plannedQuantity = item.plannedQuantity || 0;
    const timestamp = new Date(item.timestamp).toLocaleString('vi-VN');
    
    csvContent += `"${orderCode}","${customerName}","${productName}","${vehicleNumber}",${actualCount},${plannedQuantity},"${timestamp}"\n`;
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
    updateHistoryTable();
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
  console.log('💾 Saving settings - CURRENT STATE CHECK...');
  
  // ⚡ KIỂM TRA SETTINGS HIỆN TẠI TRƯỚC KHI LƯU
  console.log('📊 Current settings before save:', settings);
  
  // Get form values và update settings object
  settings.conveyorName = document.getElementById('conveyorName').value;
  settings.ipAddress = document.getElementById('ipAddress').value;
  settings.gateway = document.getElementById('gateway').value;
  settings.subnet = document.getElementById('subnet').value;
  settings.sensorDelay = parseInt(document.getElementById('sensorDelay').value);
  settings.bagDetectionDelay = parseInt(document.getElementById('bagDetectionDelay').value);
  settings.minBagInterval = parseInt(document.getElementById('minBagInterval').value);
  settings.autoReset = document.getElementById('autoReset').checked;
  settings.brightness = parseInt(document.getElementById('brightness').value);
  
  console.log('📊 Updated settings for save:', settings);
  
  // ⚡ VALIDATE SETTINGS
  if (!settings.conveyorName || settings.conveyorName.trim() === '') {
    showNotification('Tên băng tải không được để trống', 'error');
    return;
  }
  
  if (settings.brightness < 10 || settings.brightness > 100) {
    showNotification('Độ sáng phải từ 10% đến 100%', 'error');
    return;
  }
  
  if (settings.sensorDelay < 10 || settings.sensorDelay > 1000) {
    showNotification('Độ trễ cảm biến phải từ 10ms đến 1000ms', 'error');
    return;
  }
  
  // Save to localStorage FIRST (as backup)
  try {
    localStorage.setItem('settings', JSON.stringify(settings));
    console.log('✅ Settings saved to localStorage as backup');
  } catch (error) {
    console.error('❌ Failed to save to localStorage:', error);
  }
  
  // Send settings to ESP32 với error handling tốt hơn
  showNotification('Đang lưu cài đặt...', 'info');
  
  // ⚡ CẬP NHẬT NGAY TÊN BĂNG TẢI TRÊN DISPLAY
  updateConveyorNameDisplay();
  
  sendSettingsToESP32();
  
  updateOverview();
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
  // 🔄 GỬI SETTINGS TỚI ESP32 ĐỂ GHI ĐÈ CÁC GIÁ TRỊ MẶC ĐỊNH
  const data = {
    conveyorName: settings.conveyorName,
    brightness: settings.brightness,
    sensorDelay: settings.sensorDelay,
    bagDetectionDelay: settings.bagDetectionDelay,   // ⚡ GHI ĐÈ default 200ms
    minBagInterval: settings.minBagInterval,         // ⚡ GHI ĐÈ default 100ms
    autoReset: settings.autoReset,                   // ⚡ GHI ĐÈ default false
    // Network settings
    ipAddress: settings.ipAddress,
    gateway: settings.gateway,
    subnet: settings.subnet,
    dns1: "8.8.8.8",
    dns2: "8.8.4.4"
  };
  
  console.log('📡 Sending settings to ESP32 (will override defaults):', data);
  
  fetch('/api/settings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data)
  })
  .then(response => {
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  })
  .then(result => {
    console.log('✅ Settings sent to ESP32 and saved to /settings.json:', result);
    
    if (result.needRestart) {
      // Hiển thị thông báo cần restart
      if (confirm('IP Address đã thay đổi. Cần khởi động lại ESP32 để áp dụng. Khởi động lại ngay?')) {
        restartESP32();
      } else {
        showNotification('Lưu ý: Cần khởi động lại ESP32 để áp dụng IP mới', 'warning');
      }
    } else {
      showNotification('✅ Cài đặt đã được lưu và áp dụng trên ESP32', 'success');
      
      // ⚡ VERIFY: Load lại settings từ ESP32 để kiểm tra
      setTimeout(async () => {
        console.log('🔍 Verifying saved settings...');
        await loadSettingsFromESP32();
        await compareSettings(); // So sánh để đảm bảo đồng bộ
        updateConveyorNameDisplay(); // Đảm bảo display được cập nhật
      }, 1000);
    }
  })
  .catch(error => {
    console.error('❌ Error sending settings to ESP32:', error);
    showNotification('❌ Lỗi lưu cài đặt: ' + error.message, 'error');
    
    // ⚡ FALLBACK: Attempt to reload from ESP32
    console.log('🔄 Attempting to reload settings from ESP32 after error...');
    setTimeout(() => {
      loadSettingsFromESP32();
      updateConveyorNameDisplay(); // Đảm bảo display được cập nhật
    }, 2000);
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

// Legacy API polling (kept as fallback only)  
function startStatusPolling() {
  console.log('Using legacy API polling - MQTT failed');
  
  let lastStatus = '';
  let lastCount = 0;
  let lastIRTimestamp = 0;
  
  // Reduced frequency polling as fallback
  setInterval(async () => {
    try {
      const response = await fetch('/api/status');
      if (response.ok) {
        const data = await response.json();
        
        // Handle IR commands
        if (data.hasNewIRCommand && data.lastIRTimestamp !== lastIRTimestamp) {
          console.log('IR Command detected from ESP32:', data.lastIRCommand, 'at', data.lastIRTimestamp);
          lastIRTimestamp = data.lastIRTimestamp;
          
          if (data.lastIRCommand === 'START') {
            console.log('IR Remote START - calling startCounting()');
            startCounting();
          } else if (data.lastIRCommand === 'PAUSE') {
            console.log('IR Remote PAUSE - calling pauseCounting()');
            pauseCounting();
          } else if (data.lastIRCommand === 'RESET') {
            console.log('IR Remote RESET - calling resetCounting()');
            resetCounting();
          }
          return;
        }
        
        // Handle count updates
        if (data.count !== undefined && data.count !== lastCount) {
          console.log('Count update from ESP32:', lastCount, '→', data.count);
          updateStatusFromDevice(data);
          lastCount = data.count;
        }
        
        lastStatus = data.status || '';
        updateDisplayElements(data);
      }
    } catch (error) {
      console.error('Error polling status:', error);
    }
  }, 3000); // 3 seconds instead of 1 second for fallback mode
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
      const localOrder = activeBatch.orders.find(o => {
        const localProductName = o.product?.name || o.productName;
        return o.orderCode === esp32Order.orderCode ||
          localProductName === esp32Order.productName ||
          localProductName?.toLowerCase() === esp32Order.productName?.toLowerCase();
      });
      
      if (localOrder) {
        const localProductName = localOrder.product?.name || localOrder.productName;
        console.log(`Found matching local order:`, localOrder.orderCode, '-', localProductName);
        
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
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response.json();
    })
    .then(data => {
      if (data.error) {
        throw new Error(data.error);
      }
      
      if (networksContainer) {
        networksContainer.innerHTML = '';
        
        if (data.networks && data.networks.length > 0) {
          data.networks.forEach(network => {
            const networkItem = createWiFiNetworkItem(network);
            networksContainer.appendChild(networkItem);
          });
          showNotification(`Tìm thấy ${data.networks.length} mạng WiFi`, 'success');
        } else {
          networksContainer.innerHTML = '<p style="text-align: center; color: #6c757d;">Không tìm thấy mạng WiFi nào</p>';
          showNotification('Không tìm thấy mạng WiFi nào', 'warning');
        }
      }
    })
    .catch(error => {
      console.error('Error scanning WiFi:', error);
      const errorMessage = error.message || 'Lỗi không xác định khi quét WiFi';
      showNotification(`Lỗi quét WiFi: ${errorMessage}`, 'error');
      if (networksContainer) {
        networksContainer.innerHTML = `<p style="text-align: center; color: #dc3545;">❌ ${errorMessage}</p>`;
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

// Test function to send product info to ESP32
function testSetProduct() {
  const testProducts = [
    { name: "Gạo ST25", target: 25 },
    { name: "Đậu xanh", target: 30 },
    { name: "Nếp cẩm", target: 20 },
    { name: "Cà phê rang", target: 15 }
  ];
  
  const randomProduct = testProducts[Math.floor(Math.random() * testProducts.length)];
  
  console.log('🧪 Testing set_product with:', randomProduct.name);
  
  // Send both set_product and batch_info
  sendESP32Command('set_product', {
    productName: randomProduct.name,
    target: randomProduct.target
  }).then(() => {
    console.log('✅ Test set_product sent successfully');
    
    // Also send batch_info
    return sendESP32Command('batch_info', {
      firstOrder: {
        productName: randomProduct.name,
        quantity: randomProduct.target
      }
    });
  }).then(() => {
    console.log('✅ Test batch_info sent successfully');
    alert(`Test completed! Sent "${randomProduct.name}" with target ${randomProduct.target} to ESP32. Check ESP32 Serial Monitor.`);
  }).catch(error => {
    console.error('❌ Test failed:', error);
    alert('Test failed: ' + error.message);
  });
}

// Test functions for debugging
window.testConnectivity = function() {
  console.log('� Testing ESP32 connectivity...');
  
  // Test 1: Basic fetch to root
  console.log('1. Testing root path /...');
  fetch('/')
    .then(response => {
      console.log(`📊 Root response: ${response.status} ${response.statusText}`);
      return fetch('/api/status');
    })
    .then(response => {
      console.log(`📊 /api/status response: ${response.status} ${response.statusText}`);
      return response.json();
    })
    .then(data => {
      console.log('✅ /api/status success:', data);
      
      console.log('2. Testing /api/cmd with test command...');
      return sendESP32Command('test', { debug: true });
    })
    .then(result => {
      console.log('✅ /api/cmd test result:', result);
      console.log('✅ Full connectivity test PASSED!');
    })
    .catch(error => {
      console.error('❌ Connectivity test FAILED:', error);
      console.log('💡 Possible issues:');
      console.log('   - Wrong IP address');
      console.log('   - ESP32 not connected to WiFi');
      console.log('   - Firewall blocking connection');
      console.log('   - ESP32 web server not running');
    });
};

window.testMQTTCount = function() {
  console.log('🧪 Testing MQTT count updates...');
  
  // Test 1: Check MQTT connection
  console.log('1. MQTT Connection Status:');
  console.log('   Connected:', mqttConnected);
  console.log('   Client exists:', !!mqttClient);
  console.log('   Last MQTT update:', lastMqttUpdate ? new Date(lastMqttUpdate) : 'Never');
  
  // Test 2: Manual count update simulation
  console.log('2. Testing manual count update...');
  const testCountData = {
    deviceId: "BT-001",
    count: Math.floor(Math.random() * 50) + 1,
    target: 100,
    type: "Test Product",
    timestamp: new Date().toISOString(),
    progress: 0
  };
  
  console.log('📊 Simulating count data:', testCountData);
  
  // Test direct display update
  updateDisplayElements(testCountData);
  
  // Test MQTT handler
  handleCountUpdate(testCountData);
  
  console.log('✅ Manual test completed. Check "Thực hiện" field should show:', testCountData.count);
  console.log('🎯 If this works but real MQTT doesn\'t, problem is in MQTT communication');
};

window.debugMQTTTopics = function() {
  console.log('🔍 MQTT Topics Debug:');
  console.log('Subscribed topics should include:');
  console.log('   - bagcounter/status');
  console.log('   - bagcounter/count');  
  console.log('   - bagcounter/ir_command');
  console.log('   - bagcounter/alerts');
  
  if (mqttClient) {
    console.log('MQTT Client state:', mqttClient.connected ? 'Connected' : 'Disconnected');
  } else {
    console.log('❌ MQTT Client not initialized');
  }
};

// Test basic connectivity to ESP32
window.testConnectivity = function() {
  console.log('🔌 Testing ESP32 connectivity...');
  
  console.log('1. Testing /api/status...');
  fetch('/api/status')
    .then(response => {
      console.log(`📊 /api/status response: ${response.status} ${response.statusText}`);
      return response.json();
    })
    .then(data => {
      console.log('✅ /api/status success:', data);
      
      console.log('2. Testing /api/cmd with ping...');
      return sendESP32Command('ping', { test: true });
    })
    .then(() => {
      console.log('✅ Full connectivity test passed!');
    })
    .catch(error => {
      console.error('❌ Connectivity test failed:', error);
      console.log('💡 Check if ESP32 IP is correct and reachable');
    });
};

window.testWebCommands = function() {
  console.log('🧪 Testing web commands step by step...');
  
  console.log('Step 1: Testing start command...');
  sendESP32Command('start')
    .then(result => {
      console.log('✅ Start command result:', result);
      console.log('Step 2: Testing pause command...');
      return sendESP32Command('pause');
    })
    .then(result => {
      console.log('✅ Pause command result:', result);
      console.log('Step 3: Testing reset command...');
      return sendESP32Command('reset');
    })
    .then(result => {
      console.log('✅ Reset command result:', result);
      console.log('✅ All web commands test PASSED!');
      console.log('🎯 Check ESP32 Serial Monitor for corresponding logs:');
      console.log('   📨 Received API command: start');
      console.log('   📨 Received API command: pause');  
      console.log('   📨 Received API command: reset');
    })
    .catch(error => {
      console.error('❌ Web commands test FAILED:', error);
    });
};

window.debugMQTTConnection = function() {
  console.log('🔍 MQTT Connection Debug:');
  console.log('   Connected:', mqttConnected);
  console.log('   Client exists:', !!mqttClient);
  console.log('   Client connected:', mqttClient ? mqttClient.connected : 'N/A');
  console.log('   Last MQTT update:', lastMqttUpdate ? new Date(lastMqttUpdate) : 'Never');
  
  if (mqttClient) {
    console.log('   Client details:', {
      clientId: mqttClient.options ? mqttClient.options.clientId : 'N/A',
      host: mqttClient.options ? mqttClient.options.hostname : 'N/A',
      port: mqttClient.options ? mqttClient.options.port : 'N/A'
    });
    
    console.log('🧪 Testing manual IR command simulation...');
    const testIRData = {
      source: "IR_REMOTE",
      action: "START",
      status: "RUNNING", 
      count: 0,
      timestamp: Date.now(),
      startTime: "Test Time"
    };
    
    console.log('📊 Simulating IR command:', testIRData);
    handleMQTTMessage('bagcounter/ir_command', testIRData);
    console.log('✅ Manual IR command test completed');
  } else {
    console.log('❌ MQTT Client not initialized');
  }
};

// ==================== PASSWORD AUTHENTICATION ====================

const ADMIN_PASSWORD = "admin123"; // Change this to your desired password
let authenticatedTabs = new Set();

function showTab(tabName) {
  // Check if tab requires authentication
  const protectedTabs = ['product', 'wifi', 'settings'];
  
  if (protectedTabs.includes(tabName) && !authenticatedTabs.has(tabName)) {
    showPasswordModal(tabName);
    return;
  }
  
  // Continue with normal tab switching
  showTabInternal(tabName);
}

function showPasswordModal(targetTab) {
  document.getElementById('passwordModal').style.display = 'block';
  document.getElementById('adminPassword').value = '';
  document.getElementById('passwordError').style.display = 'none';
  document.getElementById('adminPassword').focus();
  
  // Store target tab for after authentication
  document.getElementById('passwordModal').dataset.targetTab = targetTab;
  
  // Handle Enter key
  document.getElementById('adminPassword').onkeypress = function(e) {
    if (e.key === 'Enter') {
      verifyPassword();
    }
  };
}

function verifyPassword() {
  const password = document.getElementById('adminPassword').value;
  const targetTab = document.getElementById('passwordModal').dataset.targetTab;
  
  if (password === ADMIN_PASSWORD) {
    authenticatedTabs.add(targetTab);
    closePasswordModal();
    showTabInternal(targetTab);
    showNotification('Xác thực thành công!', 'success');
  } else {
    document.getElementById('passwordError').style.display = 'block';
    document.getElementById('adminPassword').value = '';
    document.getElementById('adminPassword').focus();
  }
}

function closePasswordModal() {
  document.getElementById('passwordModal').style.display = 'none';
}

function showTabInternal(tabName) {
  // Hide all tab panes
  const tabPanes = document.querySelectorAll('.tab-pane');
  tabPanes.forEach(pane => pane.classList.remove('active'));
  
  // Hide all tab buttons
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => btn.classList.remove('active'));
  
  // Show selected tab pane
  document.getElementById(tabName).classList.add('active');
  
  // Show selected tab button
  document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
  
  // Load data based on tab
  switch(tabName) {
    case 'overview':
      updateOverview();
      break;
    case 'product':
      updateProductTable();
      break;
    case 'order':
      updateCurrentBatchSelect();
      break;
  }
}

// ==================== MULTIPLE PRODUCTS FORM ====================

let productItemCounter = 0;

function addProductItem() {
  productItemCounter++;
  const productsList = document.getElementById('productsList');
  
  const productItem = document.createElement('div');
  productItem.className = 'product-item';
  productItem.dataset.index = productItemCounter;
  
  productItem.innerHTML = `
    <div class="form-row">
      <div class="form-group">
        <label>Tên mặt hàng:</label>
        <select class="productSelect" required>
          <option value="">Chọn sản phẩm</option>
          ${currentProducts.map(p => `<option value="${p.name}">${p.name}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Số lượng:</label>
        <input type="number" class="quantity" min="1" required>
      </div>
      <div class="form-group">
        <label>Cảnh báo gần xong:</label>
        <input type="number" class="warningQuantity" min="1">
      </div>
      <div class="form-group">
        <button type="button" class="btn-danger btn-small" onclick="removeProductItem(${productItemCounter})" style="margin-top: 25px;">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    </div>
  `;
  
  productsList.appendChild(productItem);
}

function removeProductItem(index) {
  const productItem = document.querySelector(`[data-index="${index}"]`);
  if (productItem) {
    productItem.remove();
  }
  
  // If no items left, add one
  if (document.querySelectorAll('.product-item').length === 0) {
    addInitialProductItem();
  }
}

function addInitialProductItem() {
  const productsList = document.getElementById('productsList');
  productsList.innerHTML = `
    <div class="product-item" data-index="0">
      <div class="form-row">
        <div class="form-group">
          <label>Tên mặt hàng:</label>
          <select class="productSelect" required>
            <option value="">Chọn sản phẩm</option>
            ${currentProducts.map(p => `<option value="${p.name}">${p.name}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Số lượng:</label>
          <input type="number" class="quantity" min="1" required>
        </div>
        <div class="form-group">
          <label>Cảnh báo gần xong:</label>
          <input type="number" class="warningQuantity" min="1">
        </div>
        <div class="form-group">
          <button type="button" class="btn-danger btn-small" onclick="removeProductItem(0)" style="margin-top: 25px;">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    </div>
  `;
}

function addMultipleOrdersToBatch() {
  const customerName = document.getElementById('customerName').value.trim();
  const orderCode = document.getElementById('orderCode').value.trim();
  const vehicleNumber = document.getElementById('vehicleNumber').value.trim();
  
  if (!customerName || !orderCode || !vehicleNumber) {
    showNotification('Vui lòng điền đầy đủ thông tin khách hàng, mã đơn hàng và biển số xe', 'error');
    return;
  }
  
  const productItems = document.querySelectorAll('.product-item');
  const orders = [];
  
  for (let item of productItems) {
    const productSelect = item.querySelector('.productSelect');
    const quantity = item.querySelector('.quantity');
    const warningQuantity = item.querySelector('.warningQuantity');
    
    if (productSelect.value && quantity.value) {
      orders.push({
        id: Date.now() + Math.random(), // Unique ID
        orderNumber: `${orderCode}-${orders.length + 1}`, // Order number based on orderCode
        customerName,
        orderCode,
        vehicleNumber,
        productName: productSelect.value,
        quantity: parseInt(quantity.value),
        warningQuantity: parseInt(warningQuantity.value) || 5,
        status: 'WAIT',
        selected: true // Auto-select new orders
      });
    }
  }
  
  if (orders.length === 0) {
    showNotification('Vui lòng chọn ít nhất một sản phẩm', 'error');
    return;
  }
  
  // Add all orders to current batch
  orders.forEach(order => {
    currentOrderBatch.push(order);
  });
  
  updateBatchPreview();
  resetOrderForm();
  showNotification(`Đã thêm ${orders.length} đơn hàng vào danh sách`, 'success');
}

function resetOrderForm() {
  document.getElementById('customerName').value = '';
  document.getElementById('orderCode').value = '';
  document.getElementById('vehicleNumber').value = '';
  
  // Reset to one product item
  productItemCounter = 0;
  addInitialProductItem();
}

// ==================== EDIT ORDER FUNCTIONALITY ====================

function editOrder(index) {
  const order = getCurrentOrdersForDisplay()[index];
  if (!order) return;
  
  // Fill edit form
  document.getElementById('editOrderIndex').value = index;
  document.getElementById('editCustomerName').value = order.customerName;
  document.getElementById('editOrderCode').value = order.orderCode;
  document.getElementById('editVehicleNumber').value = order.vehicleNumber;
  document.getElementById('editQuantity').value = order.quantity;
  document.getElementById('editWarningQuantity').value = order.warningQuantity || 5;
  
  // Populate product select
  const editProductSelect = document.getElementById('editProductSelect');
  editProductSelect.innerHTML = '<option value="">Chọn sản phẩm</option>';
  currentProducts.forEach(product => {
    const option = document.createElement('option');
    option.value = product.name;
    option.textContent = product.name;
    const orderProductName = order.product?.name || order.productName;
    if (product.name === orderProductName) {
      option.selected = true;
    }
    editProductSelect.appendChild(option);
  });
  
  // Show modal
  document.getElementById('editOrderModal').style.display = 'block';
}

function getCurrentOrdersForDisplay() {
  const activeBatch = orderBatches.find(b => b.isActive);
  return activeBatch ? activeBatch.orders || [] : [];
}

function editOrderById(orderId) {
  const activeBatch = orderBatches.find(b => b.isActive);
  if (!activeBatch) return;
  
  const orderIndex = activeBatch.orders.findIndex(o => o.id === orderId);
  if (orderIndex === -1) return;
  
  editOrder(orderIndex);
}

function closeEditOrderModal() {
  document.getElementById('editOrderModal').style.display = 'none';
}

function saveEditOrder() {
  const index = parseInt(document.getElementById('editOrderIndex').value);
  const customerName = document.getElementById('editCustomerName').value.trim();
  const orderCode = document.getElementById('editOrderCode').value.trim();
  const vehicleNumber = document.getElementById('editVehicleNumber').value.trim();
  const productName = document.getElementById('editProductSelect').value;
  const quantity = parseInt(document.getElementById('editQuantity').value);
  const warningQuantity = parseInt(document.getElementById('editWarningQuantity').value) || 5;
  
  if (!customerName || !orderCode || !vehicleNumber || !productName || !quantity) {
    showNotification('Vui lòng điền đầy đủ thông tin', 'error');
    return;
  }
  
  // Find active batch and update order
  const batch = orderBatches.find(b => b.isActive);
  if (batch && batch.orders[index]) {
    const oldOrder = batch.orders[index];
    
    // Update order
    batch.orders[index] = {
      ...oldOrder,
      customerName,
      orderCode,
      vehicleNumber,
      productName,
      quantity,
      warningQuantity
    };
    
    // Save to localStorage
    saveOrderBatches();
    
    // Send update to ESP32
    sendOrderUpdateToESP32(batch.orders[index], index);
    
    // Refresh display
    updateOrderTable();
    closeEditOrderModal();
    showNotification('Đã cập nhật đơn hàng thành công', 'success');
  }
}

function deleteOrder(orderId) {
  if (!confirm('Bạn có chắc chắn muốn xóa đơn hàng này?')) {
    return;
  }
  
  const batch = orderBatches.find(b => b.isActive);
  if (batch) {
    const orderIndex = batch.orders.findIndex(o => o.id === orderId);
    if (orderIndex !== -1) {
      batch.orders.splice(orderIndex, 1);
      saveOrderBatches();
      
      // Send delete to ESP32
      sendOrderDeleteToESP32(orderId);
      
      updateOrderTable();
      showNotification('Đã xóa đơn hàng', 'success');
    }
  }
}

// ==================== ESP32 SYNC FUNCTIONS ====================

async function sendOrderUpdateToESP32(order, index) {
  try {
    const response = await fetch('/api/order/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        index: index,
        order: order
      })
    });
    
    if (response.ok) {
      console.log('✅ Order update sent to ESP32');
    } else {
      console.error('❌ Failed to send order update to ESP32');
    }
  } catch (error) {
    console.error('❌ Error sending order update to ESP32:', error);
  }
}

async function sendOrderDeleteToESP32(index) {
  try {
    const response = await fetch('/api/order/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index: index })
    });
    
    if (response.ok) {
      console.log('✅ Order delete sent to ESP32');
    } else {
      console.error('❌ Failed to send order delete to ESP32');
    }
  } catch (error) {
    console.error('❌ Error sending order delete to ESP32:', error);
  }
}
