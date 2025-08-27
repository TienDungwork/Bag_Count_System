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

// Simple ID counters instead of timestamps
let batchIdCounter = 1;
let orderIdCounter = 1;
let productIdCounter = 1;

// Pagination
let currentPage = 1;
let itemsPerPage = 10;
let totalPages = 1;

// MQTT Configuration
let mqttClient = null;
let mqttConnected = false;
let currentDeviceStatus = {};
let lastMqttUpdate = 0;

// API polling configuration (MANAGEMENT DATA ONLY - NO real-time counting or IR commands)
let apiPollingInterval = null;
const API_POLL_FREQUENCY = 5000; // 5 seconds - ONLY for products/settings sync, NO count/status data

let settings = {
  conveyorName: 'BT-001',
  location: '',
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
  console.log('DOMContentLoaded - Starting app initialization...');
  
  // Load data from ESP32 first, fallback to localStorage
  try {
    console.log('Trying to load data from ESP32...');
    await loadAllDataFromESP32();
  } catch (error) {
    console.log('ESP32 failed, loading from localStorage...');
    loadSettings();
    loadProducts();
    loadOrderBatches();
    loadHistory();
  }
  
  console.log('Updating UI components...');
  updateCurrentBatchSelect();
  updateBatchSelector();
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
  
  // Cập nhật tất cả dropdown sản phẩm sau khi load xong
  updateAllProductSelects();
  
  // Get device information on startup
  setTimeout(() => {
    getDeviceInfo();
  }, 2000);
  
  console.log('Application initialized successfully');
  // showNotification('Ứng dụng đã khởi tạo (MQTT Real-time mode)', 'success');
});

// LOAD TẤT CẢ DỮ LIỆU TỪ ESP32 KHI KHỞI ĐỘNG
async function loadAllDataFromESP32() {
  console.log('Loading all data from ESP32...');
  
  try {
    // KIỂM TRA XEM ESP32 CÓ DỮ LIỆU CHƯA
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
    
    // showNotification('Đã tải dữ liệu từ ESP32', 'success');
    
  } catch (error) {
    console.error('Error loading data from ESP32:', error);
    console.log('Falling back to localStorage data');
    showNotification('Không thể tải dữ liệu', 'warning');
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
    
    console.log('Default data sent to ESP32');
    
  } catch (error) {
    console.error('Error sending default data to ESP32:', error);
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
        console.log('DEBUG: Loaded products:', currentProducts);
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
    console.log('Loading orders from ESP32...');
    
    const response = await fetch('/api/orders');
    if (response.ok) {
      const esp32Orders = await response.json();
      console.log('ESP32 orders response:', esp32Orders);
      
      if (esp32Orders && Array.isArray(esp32Orders) && esp32Orders.length > 0) {
        orderBatches = esp32Orders;
        localStorage.setItem('orderBatches', JSON.stringify(orderBatches));
        console.log('Orders loaded from ESP32:', esp32Orders.length, 'batches');
        console.log('First batch sample:', esp32Orders[0]);
        return true;
      } else if (esp32Orders && Array.isArray(esp32Orders) && esp32Orders.length === 0) {
        console.log('ℹESP32 has empty orders array - this is normal for new setup');
        orderBatches = [];
        localStorage.setItem('orderBatches', JSON.stringify(orderBatches));
        return true;
      } else {
        console.log('ESP32 orders response is not a valid array:', esp32Orders);
        return false;
      }
    } else {
      console.log('Failed to fetch orders from ESP32, status:', response.status);
      return false;
    }
  } catch (error) {
    console.error('Error loading orders from ESP32:', error);
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
  if (confirm('Tải lại tất cả dữ liệu từ thiết bị? Dữ liệu local sẽ bị ghi đè.')) {
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
    
    // showNotification('Đã tải lại dữ liệu từ thiết bị', 'success');
  }
}

// CÁC HÀM DEBUG VÀ TROUBLESHOOTING

// Debug ESP32 settings
async function debugESP32Settings() {
  try {
    //console.log('Debugging ESP32 settings...');
    
    const response = await fetch('/api/debug/settings');
    if (response.ok) {
      const debugData = await response.json();
      
      console.log('=== ESP32 SETTINGS DEBUG ===');
      console.log('Files status:', debugData.files || 'NO FILES DATA');
      console.log('Current memory variables:', debugData.memory || 'NO MEMORY DATA');
      console.log('Settings file content:', debugData.file_content?.settings || 'NO FILE CONTENT');
      console.log('System info:', debugData.system || 'NO SYSTEM DATA');
      console.log('=== END DEBUG ===');
      
      //showNotification('Debug info printed to console (F12)', 'info');
      
      // Hiển thị popup với info quan trọng
      const fileExists = debugData.files?.settings_exists || false;
      const memorySettings = debugData.memory || {};
      
      alert(`ESP32 Settings Debug:\n\nFile exists: ${fileExists}\nConveyor: ${memorySettings.conveyorName || 'N/A'}\nBrightness: ${memorySettings.brightness || 'N/A'}%\nSensor Delay: ${memorySettings.sensorDelay || 'N/A'}ms\n\nCheck console (F12) for full details`);
      
    } else {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
  } catch (error) {
    console.error('Error debugging ESP32:', error);
    showNotification('Lỗi debug: ' + error.message, 'error');
  }
}

// Force refresh settings từ file
async function forceRefreshESP32Settings() {
  try {
    console.log('Force refreshing ESP32 settings from file...');
    
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
      
      // showNotification('Đã force refresh settings từ ESP32', 'success');
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
    console.log('Comparing web vs ESP32 settings...');
    
    const response = await fetch('/api/settings');
    if (response.ok) {
      const esp32Settings = await response.json();
      
      console.log('=== SETTINGS COMPARISON ===');
      console.log('Web settings:', settings);
      console.log('ESP32 settings:', esp32Settings);
      
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
        console.log('DIFFERENCES FOUND:');
        differences.forEach(diff => console.log('  - ' + diff));
        //showNotification(`Phát hiện ${differences.length} khác biệt - xem console`, 'warning');
      } else {
        console.log('No differences found');
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
    console.log('Deleting product from ESP32:', productId);
    
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
  if (confirm('CẢNH BÁO: Thao tác này sẽ XÓA TẤT CẢ dữ liệu (sản phẩm, đơn hàng, lịch sử, cài đặt) và reset về cấu hình mặc định!\n\nBạn có chắc chắn?')) {
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
        
        showNotification('Đã reset tất cả dữ liệu về mặc định', 'success');
        
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
      // RE-ENABLE MQTT with stable broker
      console.log('Initializing MQTT with stable broker...');
      
      // Try multiple stable MQTT brokers with fallback - PRIORITIZE SAME AS ESP32
      const brokers = [
        'ws://broker.hivemq.com:8000/mqtt', // HiveMQ WebSocket - SAME AS ESP32
        'wss://broker.emqx.io:8084/mqtt',  // EMQX backup
        'wss://mqtt.eclipseprojects.io:443/mqtt' // Eclipse backup
      ];
      
      let brokerIndex = 0;
      const tryNextBroker = () => {
        if (brokerIndex >= brokers.length) {
          console.log('All MQTT brokers failed, using API-only mode');
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
          console.log(`MQTT Connected to broker ${brokerIndex + 1}: ${brokers[brokerIndex]}`);
          console.log(`Same broker as ESP32: ${brokers[brokerIndex].includes('hivemq') ? 'YES' : 'NO'}`);
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
              console.log('MQTT Count received:', data.count, 'Target:', data.target, 'Type:', data.type, 'Full data:', data);
            }
            
            // Debug IR commands specifically
            if (topic === 'bagcounter/ir_command') {
              console.log('IR Command received via MQTT:', {
                topic: topic,
                command: data.command,
                timestamp: new Date().toLocaleTimeString(),
                fullData: data
              });
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
            console.log('Trying next broker...');
            setTimeout(tryNextBroker, 2000);
          } else {
            console.log('All MQTT brokers failed, using API-only mode');
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
      } else {
        console.log(`Subscribed to ${topic}`);
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
      
    default:
      console.log('Unknown MQTT topic:', topic);
  }
}

// MQTT Message Handlers  
async function updateDeviceStatus(data) {
  currentDeviceStatus = { ...currentDeviceStatus, ...data };
  
  // Sync device status with web counting state
  if (data.status) {
    // console.log('ESP32 Status:', data.status, 'Web state:', countingState.isActive, 'Timestamp:', new Date().toLocaleTimeString());
    
    if (data.status === 'RUNNING' && !countingState.isActive) {
      // console.log('IR Remote START detected - updating web state');
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
            console.log('Force saving counting orders to ESP32...');
            await sendOrderBatchesToESP32(); // FORCE SYNC với ESP32
            updateOrderTable();
          }
        }
      }
      updateOverview();
      
    } else if (data.status === 'PAUSE') {
      // console.log('IR Remote PAUSE detected - updating web state');
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
          console.log('Force saving paused orders to ESP32...');
          await sendOrderBatchesToESP32(); // FORCE SYNC với ESP32
          updateOrderTable();
        }
      }
      updateOverview();
      
    } else if (data.status === 'RESET') {
      // console.log('IR Remote RESET detected - resetting all orders');
      
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
        showNotification('Reset đếm hoàn tất', 'info');
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

let handleCountUpdateRunning = false;

async function handleCountUpdate(data) {
  // Tránh infinite loop
  if (handleCountUpdateRunning) {
    console.log('handleCountUpdate already running, skipping...');
    return;
  }
  
  handleCountUpdateRunning = true;
  
  try {
    console.log('MQTT Real-time count:', data.count, 'type:', data.type, 'productCode:', data.productCode, 'progress:', data.progress + '%');
    console.log('countingState.isActive:', countingState.isActive);

    // MQTT-ONLY REAL-TIME COUNT UPDATE - No API fallback to prevent overwrites
    if (data.count !== undefined) {
    // Tìm đơn hàng đang được ESP32 đếm theo product type/name
    let foundOrder = null;
    let foundBatch = null;
    let foundOrderIndex = -1;
    
    // Tìm trong TẤT CẢ batches, không chỉ activeBatch
    for (let batch of orderBatches) {
      const selectedOrders = batch.orders.filter(o => o.selected);
      
      console.log(`Checking batch ${batch.name} - orders:`, selectedOrders.map(o => `${o.productName}(${o.status})`));
      
      for (let i = 0; i < selectedOrders.length; i++) {
        const order = selectedOrders[i];
        
        // Match theo nhiều cách để đảm bảo tìm đúng
        const productMatches = (
          order.productName === data.type || 
          (order.product && order.product.name === data.type) ||
          (order.product && order.product.code === data.type) ||
          (data.productCode && order.product && order.product.code === data.productCode) ||
          order.status === 'counting'
        );
        
        console.log(`Order ${i+1}: ${order.productName} - status:${order.status} - matches:${productMatches}`);
        
        if (productMatches && (order.status === 'counting' || order.status === 'waiting')) {
          // Nếu ESP32 đang gửi count cho đơn này mà chưa có status counting, tự động set
          if (order.status === 'waiting' && data.count > 0) {
            console.log(`Auto-setting order ${order.productName} to counting status`);
            order.status = 'counting';
            
            // Đảm bảo các đơn khác không còn status counting
            selectedOrders.forEach((otherOrder, otherIdx) => {
              if (otherIdx !== i && otherOrder.status === 'counting') {
                otherOrder.status = 'completed';
              }
            });
          }
          
          foundOrder = order;
          foundBatch = batch;
          foundOrderIndex = i;
          
          console.log(`Found counting order: ${order.productName} (${order.product?.code}) in batch ${batch.name}`);
          break;
        }
      }
      if (foundOrder) break;
    }
    
    if (foundOrder && foundBatch) {
      const totalCountFromDevice = data.count;
      
      // ESP32 GỬI COUNT RIÊNG CHO TỪNG ĐƠN (KHÔNG TÍCH LŨY)
      // Khi ESP32 chuyển đơn, nó reset count về 0 cho đơn mới
      // Vì vậy data.count chính là currentCount của đơn hiện tại
      const calculatedCurrentCount = totalCountFromDevice;
      const newCurrentCount = Math.min(calculatedCurrentCount, foundOrder.quantity);
      
      // Chỉ cập nhật nếu số mới lớn hơn
      if (newCurrentCount >= (foundOrder.currentCount || 0)) {
        const oldCount = foundOrder.currentCount || 0;
        foundOrder.currentCount = newCurrentCount;
        
        // Cập nhật activeBatch nếu cần
        if (!foundBatch.isActive) {
          console.log(`Switching active batch to: ${foundBatch.name}`);
          orderBatches.forEach(b => b.isActive = false);
          foundBatch.isActive = true;
        }
        
        // Tính tổng count cho batch (số đã hoàn thành + đang đếm)
        const selectedOrders = foundBatch.orders.filter(o => o.selected);
        let batchTotalCount = 0;
        for (let order of selectedOrders) {
          batchTotalCount += order.currentCount || 0;
        }
        
        // Cập nhật counting state
        countingState.isActive = true;
        countingState.totalCounted = batchTotalCount; // Tổng thực tế của batch
        countingState.currentOrderIndex = foundOrderIndex;
        
        // console.log(`Real-time: ${foundBatch.name} - Đơn ${foundOrderIndex + 1} (${foundOrder.productName}): ${oldCount} → ${newCurrentCount}/${foundOrder.quantity}`);
        
        // REAL-TIME UI UPDATE (throttled)
        updateOrderTable();
        
        // Chỉ update overview nếu count thực sự thay đổi
        if (oldCount !== newCurrentCount) {
          updateOverview();
        }
        
        // Kiểm tra hoàn thành đơn hàng
        if (foundOrder.currentCount >= foundOrder.quantity) {
          foundOrder.currentCount = foundOrder.quantity;
          foundOrder.status = 'completed';
          
          console.log(`Hoàn thành đơn ${foundOrderIndex + 1}: ${foundOrder.productName} trong batch ${foundBatch.name}`);
          
          // Tìm đơn hàng tiếp theo trong cùng batch
          const nextOrder = selectedOrders.find((o, idx) => 
            idx > foundOrderIndex && o.status === 'waiting'
          );
          
          if (nextOrder) {
            nextOrder.status = 'counting';
            console.log(`Chuyển sang đơn tiếp theo: ${nextOrder.productName}`);
          } else {
            console.log(`Hoàn thành tất cả đơn hàng trong batch ${foundBatch.name}!`);
            countingState.isActive = false;
          }
          
          // Save changes
          saveOrderBatches();
          setTimeout(() => updateOrderTable(), 100);
        }
      }
    } else {
      console.log(`Không tìm thấy đơn hàng đang đếm cho product: ${data.type}`);
      console.log('Available orders:');
      orderBatches.forEach(batch => {
        console.log(`  Batch ${batch.name}:`, batch.orders.map(o => `${o.productName}(${o.status})`));
      });
    }
  }
  } catch (error) {
    console.error('Error in handleCountUpdate:', error);
  } finally {
    handleCountUpdateRunning = false;
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
  console.log('IR Command received:', data);
  
  // Xử lý MQTT_READY signal từ ESP32
  if (data.action === 'MQTT_READY' || data.command === 'MQTT_READY') {
    return;
  }
  
  // Support both 'action' and 'command' fields from ESP32
  const command = data.action || data.command;
  
  // Xử lý IR command từ ESP32 - simulate user click
  switch(command) {
    case 'START':
      // console.log('IR Remote START - executing startCounting()');
      await startCountingMQTT();
      break;
      
    case 'PAUSE':
      // console.log('IR Remote PAUSE - executing pauseCounting()');
      await pauseCountingMQTT();
      break;
      
    case 'RESET':
      // console.log('IR Remote RESET - executing resetCounting()');
      await resetCountingMQTT();
      break;
      
    default:
      console.log('Unknown IR command:', command);
  }
  
  // Show notification về IR command
  const actionText = {
    'START': 'Bắt đầu đếm',
    'PAUSE': 'Tạm dừng', 
    'RESET': 'Reset hệ thống'
  };
  
  // showNotification(`Remote: ${actionText[command] || command}`, 'info');
}

// UI UPDATE FUNCTIONS FOR IR COMMANDS (NO ESP32 COMMANDS)
function initializeButtonStates() {
  // Trạng thái ban đầu: sẵn sàng bắt đầu (reset state)
  updateButtonStates('reset');
  
  console.log('Button states initialized to ready state');
}

function updateUIForStart() {
  // Update button states using dimmed class
  updateButtonStates('started');
  
  // Update counting state
  countingState.isActive = true;
  
  // Visual feedback
  // showNotification('Remote: Bắt đầu đếm', 'success');
}

function updateUIForPause() {
  // Update button states using dimmed class
  updateButtonStates('paused');
  
  // Update counting state
  countingState.isActive = false;
  
  // Visual feedback
  // showNotification('Remote: Tạm dừng', 'warning');
}

function updateUIForReset() {
  // Update button states using dimmed class - về trạng thái ban đầu
  updateButtonStates('reset');
  
  // Reset counting state
  countingState.isActive = false;
  countingState.totalCounted = 0;
  
  // Visual feedback
  //owNotification('Remote: Reset hệ thống', 'info');
}

// MQTT Command Functions
function sendMQTTCommand(topic, payload) {
  console.log(`MQTT Debug - Sending command to: ${topic}`);
  console.log(`MQTT Client connected: ${mqttConnected}`);
  console.log(`MQTT Client exists: ${!!mqttClient}`);
  console.log(`MQTT Client.connected: ${mqttClient ? mqttClient.connected : 'N/A'}`);
  
  if (!mqttClient || !mqttConnected) {
    console.warn('MQTT not connected, command failed:', topic);
    return false;
  }
  
  try {
    const message = JSON.stringify(payload);
    const result = mqttClient.publish(topic, message);
    console.log(`MQTT Command sent: ${topic}`, payload);
    console.log(`Publish result:`, result);
    return true;
  } catch (error) {
    console.error('Failed to send MQTT command:', error);
    return false;
  }
}

// MQTT Command Functions for IR Remote and Counting Control
function startCountingMQTT() {
  console.log('Sending START command via MQTT');
  return sendMQTTCommand('bagcounter/cmd/start', {
    action: 'START',
    timestamp: Date.now(),
    source: 'web'
  });
}

function pauseCountingMQTT() {
  console.log('Sending PAUSE command via MQTT');
  return sendMQTTCommand('bagcounter/cmd/pause', {
    action: 'PAUSE',
    timestamp: Date.now(),
    source: 'web'
  });
}

function resetCountingMQTT() {
  console.log('Sending RESET command via MQTT');
  return sendMQTTCommand('bagcounter/cmd/reset', {
    action: 'RESET',
    timestamp: Date.now(),
    source: 'web'
  });
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

// Management API Polling (PRODUCTS/SETTINGS ONLY - NO real-time data)
function startManagementAPIPolling() {
  if (apiPollingInterval) {
    clearInterval(apiPollingInterval);
  }
  
  // DISABLED AUTO SYNC - Only sync on user actions (save order, login, manual refresh)
  // Không cần đồng bộ liên tục - chỉ đồng bộ khi có hành động từ user
  console.log('Auto sync disabled - will only sync on demand');
  
  // Load initial data once on startup
  loadManagementData().then(() => {
    console.log('Initial data loaded successfully');
  }).catch(error => {
    console.error('Initial data load failed:', error);
  });
  
  console.log(`Management data loaded once on startup - no auto sync`);
}

// Manual sync function - call only when needed (save order, login, refresh button)
async function syncDataFromESP32(reason = 'manual') {
  console.log(`Manual sync requested: ${reason}`);
  try {
    await loadManagementData();
    console.log(`Manual sync completed: ${reason}`);
    return true;
  } catch (error) {
    console.error(`Manual sync failed: ${reason}`, error);
    return false;
  }
}

async function loadManagementData() {
  try {
    // CHỈ SYNC SETTINGS và PRODUCTS - HOÀN TOÀN TẮTORDERS SYNC để tránh ghi đè selections
    // console.log('Refreshing management data from ESP32...');
    
    const [productsResponse, settingsResponse] = await Promise.all([
      fetch('/api/products').catch(() => null),
      fetch('/api/settings').catch(() => null)
    ]);
    
    // HOÀN TOÀN TẮT ORDERS SYNC để tránh ghi đè user selections
    console.log('Orders sync disabled - user can freely modify selections');
    
    if (productsResponse?.ok) {
      const products = await productsResponse.json();
      if (products && products.length > 0) {
        currentProducts = products;
        localStorage.setItem('products', JSON.stringify(currentProducts));
        updateProductTable();
        // console.log('Products refreshed from ESP32');
      }
    }
    
    if (settingsResponse?.ok) {
      const settingsData = await settingsResponse.json();
      if (settingsData) {
        settings = { ...settings, ...settingsData };
        localStorage.setItem('settings', JSON.stringify(settings));
        updateSettingsForm();
        // console.log('Settings refreshed from ESP32');
      }
    }
    
  } catch (error) {
    console.error('Error refreshing management data:', error);
  }
}

// Fallback to old API polling if MQTT fails - DISABLED to prevent data overwrites
function startStatusPollingFallback() {
  console.log('Status polling fallback disabled - using MQTT-only mode');
  console.log('Real-time data will only be available via MQTT');
  showNotification('MQTT required for real-time data', 'warning');
  // startStatusPolling(); // DISABLED to prevent settings overwrite
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
        <strong>${data.currentBatchName}</strong>
        <br><small>Đơn hàng: ${data.totalOrdersInBatch || 0}</small>
      `;
      batchInfoElement.style.display = 'block';
    }
    
    console.log('Batch info updated:', data.currentBatchName, '- Orders:', data.totalOrdersInBatch);
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
function clearAllFormFields() {
  // Clear main order form fields (chỉ những field có ID)
  const fieldsToCleare = [
    'customerName', 'orderCode', 'vehicleNumber'
  ];
  
  fieldsToCleare.forEach(fieldId => {
    const element = document.getElementById(fieldId);
    if (element) {
      element.value = '';
    }
  });
  
  // Clear product fields using class selectors (multiple product form)
  const productSelects = document.querySelectorAll('.productSelect');
  const quantities = document.querySelectorAll('.quantity');
  const warnings = document.querySelectorAll('.warningQuantity');
  
  productSelects.forEach(select => select.value = '');
  quantities.forEach(input => input.value = '');
  warnings.forEach(input => input.value = '');
  
  console.log('All form fields cleared');
}

function createNewBatch() {
  const batchInfo = document.getElementById('batchInfo');
  const orderFormContainer = document.getElementById('orderFormContainer');
  
  batchInfo.style.display = 'block';
  orderFormContainer.style.display = 'block';
  
  // Clear current batch
  currentOrderBatch = [];
  currentBatchId = null;
  document.getElementById('batchName').value = '';
  
  // XÓA SẠCH TẤT CẢ THÔNG TIN FORM KHI TẠO MỚI
  clearAllFormFields();
  
  // Initialize products form
  productItemCounter = 0;
  addInitialProductItem();
  
  // Cập nhật dropdown sản phẩm ngay khi tạo mới
  updateAllProductSelects();
  
  updateBatchPreview();
}

function loadBatch() {
  console.log('loadBatch() called');
  const select = document.getElementById('currentBatchSelect');
  const batchName = select.value; // Dùng tên batch thay vì ID
  console.log('Selected batch name:', batchName);
  
  if (batchName) {
    const batch = orderBatches.find(b => b.name === batchName); // Tìm theo tên
    console.log('Found batch:', batch);
    if (batch) {
      currentBatchId = batch.id;
      currentOrderBatch = [...batch.orders];
      document.getElementById('batchName').value = batch.name;
      
      // TỰ ĐIỀN THÔNG TIN từ đơn hàng cuối để dễ thêm đơn mới (trừ mã đơn hàng)
      if (batch.orders && batch.orders.length > 0) {
        const lastOrder = batch.orders[batch.orders.length - 1];
        
        // TỰ ĐIỀN TẤT CẢ THÔNG TIN từ đơn hàng cuối (bao gồm cả mã đơn hàng) - với error handling
        const customerNameEl = document.getElementById('customerName');
        const vehicleNumberEl = document.getElementById('vehicleNumber');
        const orderCodeEl = document.getElementById('orderCode');
        
        if (customerNameEl) customerNameEl.value = lastOrder.customerName || '';
        if (vehicleNumberEl) vehicleNumberEl.value = lastOrder.vehicleNumber || '';
        if (orderCodeEl) orderCodeEl.value = lastOrder.orderCode || ''; // ✅ TỰ ĐIỀN MÃ ĐƠN HÀNG
        
        // TỰ ĐIỀN THÔNG TIN SẢN PHẨM từ đơn hàng cuối (nếu muốn copy)
        const firstProductSelect = document.querySelector('.productSelect');
        const firstQuantity = document.querySelector('.quantity');
        const firstWarningQuantity = document.querySelector('.warningQuantity');
        
        if (firstProductSelect && lastOrder.product) {
          firstProductSelect.value = lastOrder.product.id || '';
        }
        if (firstQuantity) firstQuantity.value = lastOrder.quantity || '';
        if (firstWarningQuantity) firstWarningQuantity.value = lastOrder.warningQuantity || '';
        
        console.log('Auto-filled form from last order:', lastOrder.customerName);
      } else {
        // Nếu batch trống, xóa form
        clearAllFormFields();
      }
      
      document.getElementById('batchInfo').style.display = 'block';
      document.getElementById('orderFormContainer').style.display = 'block';
      updateBatchPreview();
      
      // Cập nhật dropdown sản phẩm
      updateAllProductSelects();
      
      // GỬI THÔNG TIN BATCH LÊN ESP32 KHI CHỌN
      activateBatchOnESP32(batch);
    }
  }
}

function addOrderToBatch() {
  console.log('addOrderToBatch() called');
  console.log('Current batch size before add:', currentOrderBatch.length);
  
  const customerName = document.getElementById('customerName').value.trim();
  const orderCode = document.getElementById('orderCode').value.trim();
  const vehicleNumber = document.getElementById('vehicleNumber').value.trim();
  const productId = document.getElementById('productSelect').value;
  const quantity = parseInt(document.getElementById('quantity').value);
  const warningQuantity = parseInt(document.getElementById('warningQuantity').value) || Math.floor(quantity * 0.1);
  
  console.log('Form data:', {
    customerName, orderCode, vehicleNumber, productId, quantity, warningQuantity
  });
  
  if (!customerName || !orderCode || !vehicleNumber || !productId || !quantity) {
    alert('Vui lòng điền đầy đủ thông tin đơn hàng');
    console.log('Missing required fields');
    return;
  }
  
  const product = currentProducts.find(p => p.id == productId);
  if (!product) {
    alert('Sản phẩm không hợp lệ');
    console.log('Product not found:', productId);
    return;
  }
  
  // CHO PHÉP DUPLICATE ORDER CODE - Bỏ check duplicate để có thể tạo nhiều đơn cùng mã
  // Người dùng có thể tạo nhiều đơn hàng với:
  // - Cùng mã đơn hàng (orderCode)
  // - Cùng tên sản phẩm (productName)
  // - Cùng thông tin khách hàng
  console.log('Allowing duplicate orderCode and productName for multiple orders with same info');
  
  const newOrder = {
    id: orderIdCounter++,
    orderNumber: currentOrderBatch.length + 1,
    customerName,
    orderCode,
    vehicleNumber,
    product,
    productName: product.name, // Thêm để đảm bảo tương thích
    quantity,
    warningQuantity,
    currentCount: 0,
    status: 'waiting',
    selected: false,
    createdAt: new Date().toISOString()
  };
  
  currentOrderBatch.push(newOrder);
  console.log('Order added successfully. New batch size:', currentOrderBatch.length);
  console.log('New order:', newOrder);
  
  updateBatchPreview();
  
  // Kiểm tra xem có phải đang chỉnh sửa batch đã lưu không
  const isEditingExistingBatch = currentBatchId && orderBatches.find(b => b.id == currentBatchId);
  
  if (isEditingExistingBatch) {
    // Nếu đang chỉnh sửa batch đã lưu, cập nhật ngay vào danh sách chính và gửi đến ESP32
    const batchIndex = orderBatches.findIndex(b => b.id == currentBatchId);
    if (batchIndex !== -1) {
      orderBatches[batchIndex].orders = [...currentOrderBatch];
      saveOrderBatches();
      
      // Gửi đến ESP32 cho batch đã lưu
      sendOrderUpdateToESP32(newOrder, batchIndex).then(() => {
        console.log(`Đã gửi đơn hàng mới ${newOrder.orderCode} đến ESP32 cho batch đã lưu`);
        updateOverview(); // Cập nhật số liệu tổng quan
      }).catch(error => {
        console.error(`Lỗi gửi đơn hàng ${newOrder.orderCode} đến ESP32:`, error);
      });
    }
  } else {
    // Nếu đang tạo batch mới (preview), chỉ gửi thông tin preview đến ESP32
    sendOrderToESP32(newOrder).then(() => {
      console.log(`Đã gửi đơn hàng preview ${newOrder.orderCode} đến ESP32`);
    }).catch(error => {
      console.error(`Lỗi gửi đơn hàng preview ${newOrder.orderCode} đến ESP32:`, error);
    });
  }
  
  // Clear form - chỉ xóa mã đơn hàng, giữ thông tin khách hàng
  document.getElementById('orderCode').value = '';
  // Reset product selection
  const productSelects = document.querySelectorAll('.productSelect');
  const quantities = document.querySelectorAll('.quantity');
  const warnings = document.querySelectorAll('.warningQuantity');
  
  productSelects.forEach(select => select.value = '');
  quantities.forEach(input => input.value = '');
  warnings.forEach(input => input.value = '');
  
  showNotification('Thêm đơn hàng vào danh sách thành công và gửi đến ESP32', 'success');
}

function removeOrderFromBatch(index) {
  console.log('removeOrderFromBatch called with index:', index);
  console.log('currentOrderBatch length before:', currentOrderBatch.length);
  
  if (confirm('Bạn có chắc chắn muốn xóa đơn hàng này khỏi danh sách?')) {
    const orderToRemove = currentOrderBatch[index];
    console.log('Removing order:', orderToRemove);
    
    // Kiểm tra xem có phải đang chỉnh sửa batch đã lưu không
    const isEditingExistingBatch = currentBatchId && orderBatches.find(b => b.id == currentBatchId);
    
    // Xóa từ array local
    currentOrderBatch.splice(index, 1);
    
    // Renumber orders
    currentOrderBatch.forEach((order, i) => {
      order.orderNumber = i + 1;
    });
    
    console.log('currentOrderBatch length after:', currentOrderBatch.length);
    
    if (isEditingExistingBatch) {
      // Nếu đang chỉnh sửa batch đã lưu, cập nhật ngay vào danh sách chính và gửi delete đến ESP32
      const batchIndex = orderBatches.findIndex(b => b.id == currentBatchId);
      if (batchIndex !== -1) {
        orderBatches[batchIndex].orders = [...currentOrderBatch];
        saveOrderBatches();
        
        // Gửi delete đến ESP32 cho batch đã lưu
        sendOrderDeleteToESP32(orderToRemove, batchIndex).then(() => {
          console.log(`Đã xóa đơn hàng ${orderToRemove.orderCode} khỏi ESP32 cho batch đã lưu`);
          updateOverview(); // Cập nhật số liệu tổng quan
        }).catch(error => {
          console.error(`Lỗi xóa đơn hàng ${orderToRemove.orderCode} khỏi ESP32:`, error);
        });
      }
    }
    // Nếu đang tạo batch mới (preview), không cần gửi delete đến ESP32
    // ESP32 chỉ cần biết khi batch được save cuối cùng
    
    updateBatchPreview();
    showNotification('Đã xóa đơn hàng khỏi danh sách', 'success');
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
    // Get product info to show code + name
    const product = order.product || currentProducts.find(p => p.name === order.productName);
    const productDisplay = product && product.code ? `${product.code} - ${product.name}` : (order.productName || 'N/A');
    
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${index + 1}</td>
      <td>${order.customerName}</td>
      <td>${order.orderCode}</td>
      <td>${order.vehicleNumber}</td>
      <td>${productDisplay}</td>
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

async function saveBatch() {
  const batchName = document.getElementById('batchName').value.trim();
  
  console.log('DEBUG: Starting saveBatch()');
  console.log('   - currentBatchId:', currentBatchId);
  console.log('   - batchName:', batchName);
  console.log('   - currentOrderBatch length:', currentOrderBatch.length);
  console.log('   - Memory usage check: currentOrderBatch size =', JSON.stringify(currentOrderBatch).length, 'chars');
  
  if (!batchName) {
    alert('Vui lòng nhập tên danh sách');
    return;
  }
  
  if (currentOrderBatch.length === 0) {
    alert('Danh sách đơn hàng không được trống');
    return;
  }
  
  // KIỂM TRA GIỚI HẠN SỐ LƯỢNG ĐƠN HÀNG
  if (currentOrderBatch.length > 20) {
    if (!confirm(`Danh sách có ${currentOrderBatch.length} đơn hàng. ESP32 có thể không xử lý được quá nhiều đơn hàng cùng lúc. Bạn có muốn tiếp tục?`)) {
      return;
    }
  }
  
  const batch = {
    id: currentBatchId || batchIdCounter++,
    name: batchName,
    orders: [...currentOrderBatch],
    createdAt: new Date().toISOString(),
    isActive: false
  };
  
  console.log('DEBUG: Saving batch with details:');
  console.log('   - Batch name:', batchName);
  console.log('   - Batch ID:', batch.id);
  console.log('   - Orders count:', currentOrderBatch.length);
  console.log('   - First order sample:', currentOrderBatch[0]);
  console.log('   - Full batch object size:', JSON.stringify(batch).length, 'chars');
  
  if (currentBatchId) {
    // Update existing batch
    console.log('DEBUG: Updating existing batch with ID:', currentBatchId);
    const index = orderBatches.findIndex(b => b.id === currentBatchId);
    if (index !== -1) {
      orderBatches[index] = batch;
      console.log('DEBUG: Updated existing batch at index:', index);
    } else {
      console.log('DEBUG: Batch ID not found in orderBatches!');
    }
  } else {
    // Add new batch
    console.log('DEBUG: Adding new batch');
    orderBatches.push(batch);
    console.log('DEBUG: Added new batch, total batches:', orderBatches.length);
  }
  
  saveOrderBatches();
  updateBatchSelector();
  updateCurrentBatchSelect();
  
  // GỬI TẤT CẢ BATCHES ĐẾN ESP32 ĐỂ SYNC TOÀN BỘ DỮ LIỆU
  const syncSuccess = await sendOrderBatchesToESP32();
  
  if (syncSuccess) {
    // GỬI TỪNG ĐƠN HÀNG TRONG BATCH ĐẾN ESP32 ĐỂ ESP32 BIẾT
    for (const order of batch.orders) {
      try {
        await sendOrderToESP32(order);
        console.log(`Đã gửi đơn hàng ${order.orderCode} đến ESP32`);
      } catch (error) {
        console.error(`Lỗi gửi đơn hàng ${order.orderCode} đến ESP32:`, error);
      }
    }
    
   // showNotification('Lưu danh sách đơn hàng thành công và đồng bộ với ESP32', 'success');
  } else {
    //showNotification('Lưu danh sách thành công nhưng có lỗi đồng bộ với ESP32', 'warning');
  }
  
  // Reset form
  document.getElementById('batchInfo').style.display = 'none';
  document.getElementById('orderFormContainer').style.display = 'none';
  currentOrderBatch = [];
  currentBatchId = null;
  
  console.log('Batch saved successfully, orderBatches:', orderBatches);
}

function clearBatch() {
  const select = document.getElementById('batchSelector');
  const selectedBatchName = select ? select.value : null; // Dùng tên batch thay vì ID
  
  if (!selectedBatchName) {
    // Nếu chưa chọn batch nào, chỉ xóa đơn hàng đang tạo
    if (confirm('Bạn có chắc chắn muốn xóa tất cả đơn hàng trong danh sách hiện tại?')) {
      currentOrderBatch = [];
      updateBatchPreview();
      showNotification('Đã xóa đơn hàng đang tạo!', 'success');
    }
    return;
  }
  
  // Nếu đã chọn batch, xóa batch đó
  const batchToDelete = orderBatches.find(b => b.name === selectedBatchName); // Tìm theo tên
  if (!batchToDelete) return;
  
  if (confirm(`Bạn có chắc chắn muốn xóa danh sách "${batchToDelete.name}"?`)) {
    // Xóa batch được chọn
    orderBatches = orderBatches.filter(b => b.name !== selectedBatchName); // Xóa theo tên
    saveOrderBatches();
    
    // GỬI LỆNH XÓA BATCH ĐẾN ESP32
    deleteBatchFromESP32(batchToDelete.id);
    
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
  if (!select || !select.value) {
    return;
  }
  
  const batchName = select.value; // Dùng tên batch thay vì ID
  console.log('Switching to batch name:', batchName);
  
  if (batchName) {
    const batch = orderBatches.find(b => b.name === batchName); // Tìm theo tên
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
      
      // KHÔNG RESET currentPage để tránh nhảy về đơn 1
      // currentPage = 1; // BỎ DÒNG NÀY
      updateBatchSelector();
      updateCurrentBatchSelect();
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
  console.log('Current orderBatches:', orderBatches);
  
  select.innerHTML = '<option value="">Chọn danh sách đơn hàng</option>';
  
  orderBatches.forEach(batch => {
    const option = document.createElement('option');
    option.value = batch.name; // Dùng tên batch làm value
    const ordersCount = (batch.orders && batch.orders.length) || 0;
    option.textContent = `${batch.name} (${ordersCount} đơn)`;
    if (batch.isActive) {
      option.selected = true;
      console.log('Setting selected for active batch:', batch.name);
    }
    select.appendChild(option);
    console.log('Added batch option:', batch.name, 'isActive:', batch.isActive);
  });
  
  console.log('batchSelector updated independently with', orderBatches.length, 'batches');
}

function updateCurrentBatchSelect() {
  // Cập nhật dropdown trong order tab
  const select = document.getElementById('currentBatchSelect');
  if (select) {
    select.innerHTML = '<option value="">Chọn danh sách</option>';
    
    orderBatches.forEach(batch => {
      const option = document.createElement('option');
      option.value = batch.name; // Dùng tên batch thay vì ID
      option.textContent = batch.name;
      if (batch.isActive) {
        option.selected = true;
        console.log('Setting selected for active batch in currentBatchSelect:', batch.name);
      }
      select.appendChild(option);
    });
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
  
  const batchSelector = document.getElementById('batchSelector');
  if (batchSelector && batchSelector.value != activeBatch.id) {
    batchSelector.value = activeBatch.id;
  }
  
  // KHÔNG RESET currentPage - giữ nguyên trang hiện tại
  // currentPage = 1; // BỎ DÒNG NÀY
  
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
  console.log('selectOrder called:', orderId, checked);
  
  const activeBatch = orderBatches.find(b => b.isActive);
  if (!activeBatch) {
    console.log('No active batch found');
    return;
  }
  
  const order = activeBatch.orders.find(o => o.id === orderId);
  if (order) {
    console.log('Before update - order.selected:', order.selected);
    order.selected = checked;
    console.log('After update - order.selected:', order.selected);
    
    // Get product info with both code and name
    const product = order.product || currentProducts.find(p => p.name === order.productName);
    const productName = product?.name || order.productName || 'Unknown product';
    const productCode = product?.code || '';
    const productDisplay = productCode ? `${productCode} - ${productName}` : productName;
    
    console.log(`Order ${productDisplay} ${checked ? 'selected' : 'deselected'}`);
    
    // GỬI THÔNG TIN SẢN PHẨM ĐẾN ESP32 KHI CHỌN
    if (checked) {
      const plannedQuantity = order.plannedQuantity || order.quantity;
      console.log('Sending product info to ESP32:', productDisplay, 'Target:', plannedQuantity);
      
      // Gửi thông tin đơn hàng đầy đủ bao gồm productCode
      sendESP32Command('set_current_order', {
        productName: productName,
        productCode: productCode,
        productDisplay: productDisplay,
        customerName: order.customerName,
        orderCode: order.orderCode,
        target: plannedQuantity,
        warningQuantity: 5, // Mặc định 5 cho warning
        keepCount: false, // Reset count khi chọn đơn mới
        isRunning: false  // Chỉ set order info, chưa chạy
      }).catch(error => {
        console.error('Failed to send order to ESP32:', error);
      });
    }
    
    saveOrderBatches();
    updateOverview();
    
    console.log('selectOrder completed');
  } else {
    console.log('Order not found with ID:', orderId);
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
  
  pageOrders.forEach((order, index) => {
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
    
    // THAY ĐỔI: Hiển thị thứ tự tự động thay vì orderCode
    const orderSequence = startIndex + index + 1; // Thứ tự tự động từ 1
    
    row.innerHTML = `
      <td><span class="order-number">${orderSequence}</span></td>
      <td>
        <input type="checkbox" ${order.selected ? 'checked' : ''} 
               onchange="selectOrder(${order.id}, this.checked)"
               ${order.status === 'counting' || order.status === 'completed' ? 'disabled' : ''}>
      </td>
      <td><strong>${order.quantity}${currentCountText}</strong></td>
      <td>
        ${(() => {
          const product = order.product || currentProducts.find(p => p.name === order.productName);
          if (product && product.code) {
            return `${product.code} - ${product.name}`;
          } else {
            return order.product?.name || order.productName || 'N/A';
          }
        })()}
      </td>
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

// UI State Management Functions
function updateButtonStates(state) {
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const resetBtn = document.getElementById('resetBtn');
  
  // Reset all states first
  startBtn.classList.remove('dimmed');
  pauseBtn.classList.remove('dimmed');
  resetBtn.classList.remove('dimmed');
  
  switch(state) {
    case 'started':
      startBtn.classList.add('dimmed');
      break;
    case 'paused':
      pauseBtn.classList.add('dimmed');
      break;
    case 'reset':
      pauseBtn.classList.add('dimmed');
      resetBtn.classList.add('dimmed');
      break;
    default:
      // All buttons active
      break;
  }
}

// Counting Control (Updated)
// Hybrid Functions (MQTT preferred, API fallback)
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
  
  // Kiểm tra nếu không có đơn hàng nào được chọn
  if (selectedOrders.length === 0) {
    showNotification('Vui lòng chọn ít nhất một đơn hàng để bắt đầu đếm', 'error');
    return;
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
  
  // Get product info for current order
  const currentOrder = selectedOrders[currentOrderIndex];
  const product = currentOrder.product || currentProducts.find(p => p.name === currentOrder.productName);
  const productName = product?.name || currentOrder.productName;
  const productCode = product?.code || '';
  const productDisplay = productCode ? `${productCode} - ${productName}` : productName;
  
  const batchInfo = {
    totalTarget: totalTarget,
    batchTotalTarget: totalTarget, // ESP32 cần biến này
    totalOrders: selectedOrders.length,
    currentOrderIndex: currentOrderIndex,
    // Gửi thông tin đơn đầu tiên để ESP32 hiển thị
    firstOrder: {
      customerName: currentOrder.customerName,
      productName: productName,
      productCode: productCode,
      productDisplay: productDisplay,
      orderCode: currentOrder.orderCode,
      quantity: currentOrder.quantity
    }
  };
  
  console.log('Sending batch info to ESP32:', batchInfo);
  
  // CẬP NHẬT UI NGAY LẬP TỨC TRƯỚC KHI GỬI COMMAND
  updateUIForStart();
  
  try {
    // Try MQTT first for real-time commands
    if (mqttConnected && startCountingMQTT()) {
      console.log('START command sent via MQTT');
      
      // Send batch info via MQTT as well
      sendMQTTCommand('bagcounter/cmd/batch_info', batchInfo);
      
    } else {
      // Fallback to API if MQTT not available
      console.log('MQTT not available, fallback to API...');
      await sendESP32Command('start');
      await sendESP32Command('batch_info', batchInfo);
    }
    
    // GỬI THÔNG TIN ĐƠN HÀNG HIỆN TẠI ĐỂ ESP32 HIỂN THỊ ĐÚNG TRÊN LED
    await sendESP32Command('set_current_order', {
      orderCode: currentOrder.orderCode,
      customerName: currentOrder.customerName,
      productName: productName,
      productCode: productCode,
      target: currentOrder.quantity,
      warningQuantity: 5,
      keepCount: false, // Reset count khi bắt đầu mới
      isRunning: true   // Đảm bảo ESP32 biết đang chạy
    });
    
    console.log('Sent current order info to ESP32 for LED display:', productCode, productName);
    
    // updateUIForStart(); // Đã di chuyển lên trên
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
  
  // CẬP NHẬT UI NGAY LẬP TỨC
  updateUIForPause();
  countingState.isActive = false;
  
  try {
    // Try MQTT first for real-time commands
    if (mqttConnected && pauseCountingMQTT()) {
      console.log('PAUSE command sent via MQTT');
    } else {
      // Fallback to API if MQTT not available
      console.log('MQTT not available, fallback to API...');
      await sendESP32Command('pause');
    }
    
    // updateUIForPause(); // Đã di chuyển lên trên
    countingState.isActive = false;
    
    // � MANUAL UPDATE ORDERS TRƯỚC KHI REFRESH
    console.log('Manually updating order status to paused...');
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
      console.log(`${pausedCount} orders changed to paused status`);
      
      // Force save to ESP32
      console.log('Force saving paused orders to ESP32...');
      await sendOrderBatchesToESP32();
      updateOrderTable();
    }
    
    // �🚀 FORCE REFRESH STATUS NGAY SAU PAUSE
    console.log('Counting paused successfully');
    updateOverview();
    
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
  
  // CẬP NHẬT UI VÀ STATE NGAY LẬP TỨC
  countingState.isActive = false;
  countingState.currentOrderIndex = 0;
  countingState.totalCounted = 0;
  updateUIForReset();
  
  try {
    // Try MQTT first for real-time commands
    if (mqttConnected && resetCountingMQTT()) {
      console.log('RESET command sent via MQTT');
    } else {
      // Fallback to API if MQTT not available
      console.log('MQTT not available, fallback to API...');
      await sendESP32Command('reset');
    }
    
    // Reset local state - đã di chuyển lên trên
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
    // updateUIForReset(); // Đã di chuyển lên trên
    
    console.log('Reset completed - all orders set to WAITING');
    // showNotification('Đã reset hệ thống về trạng thái chờ', 'success');
    
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
        showNotification(`Đã gửi ${orders.length} đơn hàng đến thiết bị`, 'success');
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
    showNotification('Lỗi gửi danh sách đến thiết bị: ' + error.message, 'error');
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
        console.error(`Thất bại gửi đơn ${i + 1}`);
      }
    }
    
    if (successCount === orders.length) {
      console.log('Tất cả đơn hàng đã được gửi thành công (fallback)');
      showNotification(`Đã gửi ${successCount}/${orders.length} đơn hàng đến thiết bị`, 'success');
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
  const productGroup = document.getElementById('productGroup').value.trim();
  const productName = document.getElementById('productName').value.trim();
  const productCode = document.getElementById('productCode').value.trim();
  const unitWeight = parseFloat(document.getElementById('unitWeight').value);
  
  if (!productGroup || !productName || !productCode || isNaN(unitWeight) || unitWeight <= 0) {
    alert('Vui lòng điền đầy đủ thông tin sản phẩm hợp lệ');
    return;
  }
  
  // Check if product code already exists
  if (currentProducts.find(p => p.code === productCode)) {
    alert('Mã sản phẩm đã tồn tại');
    return;
  }
  
  const newProduct = {
    id: productIdCounter++,
    group: productGroup,
    name: productName,
    code: productCode,
    unitWeight: unitWeight,
    createdAt: new Date().toISOString()
  };
  
  currentProducts.push(newProduct);
  saveProducts();
  updateProductTable();
  updateAllProductSelects(); // Cập nhật tất cả dropdown
  
  // Clear form
  document.getElementById('productForm').reset();
  showNotification('Thêm sản phẩm thành công', 'success');
}

function editProduct(index) {
  const product = currentProducts[index];
  document.getElementById('productGroup').value = product.group || '';
  document.getElementById('productName').value = product.name;
  document.getElementById('productCode').value = product.code;
  document.getElementById('unitWeight').value = product.unitWeight;
  
  // Remove the product temporarily for validation
  currentProducts.splice(index, 1);
  updateProductTable();
}

function updateProductTable() {
  console.log('Updating product table with', currentProducts.length, 'products');
  
  const tbody = document.getElementById('productTableBody');
  if (!tbody) {
    console.error('productTableBody element not found!');
    return;
  }
  
  tbody.innerHTML = '';
  
  if (currentProducts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center">Chưa có sản phẩm nào</td></tr>';
    return;
  }
  
  currentProducts.forEach((product, index) => {
    console.log('Adding product to table:', product.code, product.name, product.unitWeight + 'kg');
    
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${product.group || ''}</td>
      <td>${product.code}</td>
      <td>${product.name}</td>
      <td>${product.unitWeight || 0} kg</td>
      <td>
        <button class="btn-danger" onclick="deleteProduct(${product.id})">
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
    // Hiển thị: Nhóm - Mã - Tên sản phẩm
    const displayText = product.group ? 
      `${product.group} - ${product.code} - ${product.name}` : 
      `${product.code} - ${product.name}`;
    option.textContent = displayText;
    select.appendChild(option);
    console.log('Added product to select:', option.value, option.textContent);
  });
}

// Cập nhật tất cả dropdown sản phẩm
function updateAllProductSelects() {
  // Cập nhật dropdown chính
  updateProductSelect();
  
  // Cập nhật dropdown trong edit modal
  const editProductSelect = document.getElementById('editProductSelect');
  if (editProductSelect) {
    editProductSelect.innerHTML = '<option value="">Chọn sản phẩm</option>';
    currentProducts.forEach(product => {
      const option = document.createElement('option');
      option.value = product.name; // Dùng name thay vì id cho edit
      const displayText = product.group ? 
        `${product.group} - ${product.code} - ${product.name}` : 
        `${product.code} - ${product.name}`;
      option.textContent = displayText;
      editProductSelect.appendChild(option);
    });
  }
  
  // Cập nhật tất cả dropdown trong form multi-order
  const allProductSelects = document.querySelectorAll('.productSelect');
  console.log('DEBUG: Updating', allProductSelects.length, 'multi-order selects');
  
  allProductSelects.forEach((select, index) => {
    const currentValue = select.value;
    select.innerHTML = '<option value="">Chọn sản phẩm</option>';
    
    currentProducts.forEach(product => {
      const option = document.createElement('option');
      option.value = product.id; // Sửa từ product.name thành product.id
      option.textContent = product.code ? `${product.code} - ${product.name}` : product.name;
      select.appendChild(option);
    });
    
    // Khôi phục giá trị đã chọn nếu có
    if (currentValue) {
      select.value = currentValue;
    }
    
    console.log(`DEBUG: Select ${index} updated with ${currentProducts.length} products, current value:`, currentValue);
  });
}

// Debug function to check data
function debugBatchData() {
  // console.log('=== DEBUG BATCH DATA ===');
  // console.log('orderBatches:', orderBatches);
  // console.log('Number of batches:', orderBatches.length);
  
  orderBatches.forEach((batch, index) => {
    // console.log(`Batch ${index}:`, {
    //   id: batch.id,
    //   name: batch.name,
    //   isActive: batch.isActive,
    //   orders: batch.orders.length,
    //   ordersData: batch.orders
    // });
    
    if (batch.orders.length > 0) {
      batch.orders.forEach((order, oIndex) => {
        // console.log(`  Order ${oIndex}:`, 
        //   {
        //   selected: order.selected,
        //   quantity: order.quantity,
        //   currentCount: order.currentCount || 0
        // });
      });
    }
  });
  
  const activeBatch = orderBatches.find(b => b.isActive);
  // console.log('Active batch:', activeBatch ? activeBatch.name : 'NONE FOUND');
  // console.log('========================');
}

// Updated Overview Function
function updateOverview() {
  // console.log('Updating overview, orderBatches:', orderBatches.length);
  // debugBatchData(); // Debug call
  
  const activeBatch = orderBatches.find(b => b.isActive);
  // console.log('Active batch:', activeBatch ? activeBatch.name : 'none');
  
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
  
  // console.log('Orders:', orders.length, 'Selected:', selectedOrders.length, 'Planned:', totalPlanned, 'Counted:', totalCounted);
  
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
      console.log('History sent to ESP32 successfully:', result);
    } else {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
  } catch (error) {
    console.error('Error sending history to ESP32:', error);
    // Không báo lỗi cho user vì đây là background sync
  }
}

function updateHistoryTable() {
  console.log('updateHistoryTable called');
  console.log('countingHistory length:', countingHistory.length);
  console.log('countingHistory data:', countingHistory);
  
  const tbody = document.getElementById('historyTableBody');
  console.log('historyTableBody element:', tbody);
  
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
    
    // GỬI LỆNH XÓA TẤT CẢ LỊCH SỬ ĐẾN ESP32
    clearHistoryFromESP32();
    
    updateHistoryTable();
    showNotification('Xóa lịch sử thành công', 'info');
  }
}

// Data Persistence (Updated)
function loadOrderBatches() {
  console.log('Loading order batches from localStorage...');
  
  const saved = localStorage.getItem('orderBatches');
  if (saved) {
    try {
      const loadedBatches = JSON.parse(saved);
      // Validate and fix batch structure
      orderBatches = loadedBatches.map(batch => ({
        ...batch,
        orders: Array.isArray(batch.orders) ? batch.orders : []
      }));
      console.log('Loaded', orderBatches.length, 'batches from localStorage');
      
      // Update counters to avoid ID conflicts
      let maxBatchId = 0;
      let maxOrderId = 0;
      
      orderBatches.forEach(batch => {
        if (batch.id > maxBatchId) maxBatchId = batch.id;
        batch.orders.forEach(order => {
          if (order.id > maxOrderId) maxOrderId = order.id;
        });
      });
      
      batchIdCounter = maxBatchId + 1;
      orderIdCounter = maxOrderId + 1;
      
      console.log('Updated counters - batchIdCounter:', batchIdCounter, 'orderIdCounter:', orderIdCounter);
      
      if (orderBatches.length > 0) {
        console.log('First batch sample from localStorage:', orderBatches[0]);
      }
    } catch (error) {
      console.error('Error parsing order batches from localStorage:', error);
      orderBatches = [];
    }
  } else {
    console.log('ℹNo saved batches found in localStorage, creating sample data');
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
    console.log('Created sample batch:', orderBatches[0]);
  }
  
  console.log('🔧 DEBUG: Final orderBatches array length:', orderBatches.length);
  console.log('🔧 DEBUG: Final orderBatches data:', orderBatches);
  
  // Force update batchSelector after loading data
  console.log('Calling updateBatchSelector after loadOrderBatches');
  
  // Try immediate update
  updateBatchSelector();
  
  // Also try delayed update to ensure DOM is ready
  setTimeout(() => {
    console.log('Delayed updateBatchSelector call');
    updateBatchSelector();
  }, 1000);
}

function saveOrderBatches() {
  try {
    // Lưu vào localStorage
    localStorage.setItem('orderBatches', JSON.stringify(orderBatches));
    // console.log('Saved', orderBatches.length, 'batches to localStorage');
    
    // Không tự động gửi ESP32 ở đây để tránh spam, chỉ gửi khi cần
    
  } catch (error) {
    console.error('Error saving order batches:', error);
  }
}

// Gửi tất cả order batches đến ESP32
async function sendOrderBatchesToESP32() {
  try {
    console.log('Sending all order batches to ESP32...', orderBatches.length, 'batches');
    
    // Validate orderBatches trước khi gửi
    if (!Array.isArray(orderBatches)) {
      console.error('orderBatches is not an array:', typeof orderBatches);
      return false;
    }
    
    // Tính tổng số đơn hàng và kích thước dữ liệu
    let totalOrders = 0;
    orderBatches.forEach(batch => {
      if (batch.orders && Array.isArray(batch.orders)) {
        totalOrders += batch.orders.length;
      }
    });
    
    const dataSize = JSON.stringify(orderBatches).length;
    console.log(`Data summary: ${orderBatches.length} batches, ${totalOrders} total orders, ${dataSize} chars`);
    
    // Cảnh báo nếu dữ liệu quá lớn (ESP32 có giới hạn)
    if (dataSize > 10000) { // Giảm từ 12KB xuống 10KB safety limit cho ESP32
      console.warn('Data size large:', dataSize, 'chars - may cause ESP32 memory issues');
      showNotification(`Cảnh báo: Dữ liệu lớn (${Math.round(dataSize/1000)}KB) có thể gây lỗi thiết bị`, 'warning');
      
      // Suggest user to reduce orders if data is too large
      if (dataSize > 15000) {
        if (!confirm(`Dữ liệu rất lớn (${Math.round(dataSize/1000)}KB). thiết bị có thể không xử lý được.\n\nBạn có muốn tiếp tục? (Khuyến nghị: Giảm số đơn hàng hoặc chia nhỏ batch)`)) {
          return false;
        }
      }
    }
    
    // Log first batch để debug
    if (orderBatches.length > 0) {
      console.log('DEBUG: First batch details:');
      console.log('   - Batch name:', orderBatches[0].name);
      console.log('   - Batch ID:', orderBatches[0].id);
      console.log('   - Orders array exists:', !!orderBatches[0].orders);
      console.log('   - Orders count:', orderBatches[0].orders?.length || 0);
      if (orderBatches[0].orders && orderBatches[0].orders.length > 0) {
        console.log('   - First order sample:', {
          orderCode: orderBatches[0].orders[0].orderCode,
          productName: orderBatches[0].orders[0].productName,
          quantity: orderBatches[0].orders[0].quantity
        });
      }
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
      console.log('Order batches sent to ESP32 successfully:', result);
      return true;
    } else {
      const errorText = await response.text();
      throw new Error(`HTTP error! status: ${response.status}, response: ${errorText}`);
    }
    
  } catch (error) {
    console.error('Error sending order batches to ESP32:', error);
    showNotification('Lỗi lưu đơn hàng lên thiết bị: ' + error.message, 'error');
    return false;
  }
}

function loadProducts() {
  const saved = localStorage.getItem('products');
  if (saved) {
    currentProducts = JSON.parse(saved);
    
    // Update productIdCounter to avoid conflicts
    let maxProductId = 0;
    currentProducts.forEach(product => {
      if (product.id > maxProductId) maxProductId = product.id;
    });
    productIdCounter = maxProductId + 1;
    console.log('Updated productIdCounter:', productIdCounter);
  }
  updateProductSelect();
}

function saveProducts() {
  // Lưu vào localStorage
  localStorage.setItem('products', JSON.stringify(currentProducts));
  
  // GỬI ĐẾN ESP32 ĐỂ GHI ĐÈ DỮ LIỆU MẶC ĐỊNH
  sendAllProductsToESP32();
}

// Gửi tất cả products đến ESP32
async function sendAllProductsToESP32() {
  try {
    console.log('Sending all products to ESP32...');
    
    const response = await fetch('/api/products', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(currentProducts)
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log('Products sent to ESP32:', result);
    } else {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
  } catch (error) {
    console.error('Error sending products to ESP32:', error);
  }
}

function loadSettings() {
  console.log('Loading settings...');
  
  // KHÔNG load từ localStorage trước nữa - chỉ load từ ESP32
  // Tránh việc localStorage ghi đè lên ESP32 settings
  console.log('Skipping localStorage, will load directly from ESP32');
  
  // Load trực tiếp từ ESP32
  loadSettingsFromESP32();
}

// Load settings from ESP32
async function loadSettingsFromESP32() {
  try {
    const response = await fetch('/api/settings');
    if (response.ok) {
      const esp32Settings = await response.json();
      
      console.log('ESP32 settings received:', esp32Settings);
      console.log('Settings file exists on ESP32:', esp32Settings._settingsFileExists);
      
      // GHI ĐÈ HOÀN TOÀN settings từ ESP32 (không merge)
      if (esp32Settings.conveyorName !== undefined) settings.conveyorName = esp32Settings.conveyorName;
      if (esp32Settings.location !== undefined) settings.location = esp32Settings.location;
      if (esp32Settings.ipAddress !== undefined) settings.ipAddress = esp32Settings.ipAddress;
      if (esp32Settings.gateway !== undefined) settings.gateway = esp32Settings.gateway;
      if (esp32Settings.subnet !== undefined) settings.subnet = esp32Settings.subnet;
      if (esp32Settings.brightness !== undefined) settings.brightness = esp32Settings.brightness;
      if (esp32Settings.sensorDelay !== undefined) settings.sensorDelay = esp32Settings.sensorDelay;
      if (esp32Settings.bagDetectionDelay !== undefined) settings.bagDetectionDelay = esp32Settings.bagDetectionDelay;
      if (esp32Settings.minBagInterval !== undefined) settings.minBagInterval = esp32Settings.minBagInterval;
      if (esp32Settings.autoReset !== undefined) settings.autoReset = esp32Settings.autoReset;
      if (esp32Settings.relayDelayAfterComplete !== undefined) settings.relayDelayAfterComplete = esp32Settings.relayDelayAfterComplete;
      // LƯU NGAY VÀO localStorage (đè settings cũ)
      localStorage.setItem('settings', JSON.stringify(settings));
      updateSettingsForm();
      
      console.log('Settings loaded and synced from ESP32:', settings);
      // showNotification('Đã tải cài đặt từ ESP32', 'success');
      
      // CẬP NHẬT NGAY TÊN BĂNG TẢI TRÊN DISPLAY
      updateConveyorNameDisplay();
    } else {
      console.log('Failed to load settings from ESP32, using defaults');
      // showNotification('Không thể tải cài đặt từ ESP32', 'warning');
    }
  } catch (error) {
    console.error('Error loading settings from ESP32:', error);
    showNotification('Lỗi kết nối thiết bị', 'error');
  }
}

function updateSettingsForm() {
  document.getElementById('conveyorName').value = settings.conveyorName;
  document.getElementById('location').value = settings.location || '';
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
  // CẬP NHẬT TÊN BĂNG TẢI TRÊN HEADER
  updateConveyorNameDisplay();
}

// Hàm cập nhật tên băng tải hiển thị
function updateConveyorNameDisplay() {
  const conveyorIdElement = document.getElementById('conveyorId');
  if (conveyorIdElement && settings.conveyorName) {
    console.log('Updating conveyor name display from:', conveyorIdElement.textContent, 'to:', settings.conveyorName);
    conveyorIdElement.textContent = settings.conveyorName;
  }
}

// Load order batches from ESP32 
async function loadOrderBatchesFromESP32() {
  try {
    console.log('Loading order batches from ESP32...');
    const response = await fetch('/api/orders');
    
    if (response.ok) {
      const esp32Batches = await response.json();
      console.log('ESP32 batches received:', esp32Batches);
      
      if (esp32Batches && Array.isArray(esp32Batches) && esp32Batches.length > 0) {
        // PRESERVE SELECTED STATE khi update từ ESP32
        const updatedBatches = esp32Batches.map(esp32Batch => {
          const existingBatch = orderBatches.find(b => b.id === esp32Batch.id);
          
          if (existingBatch) {
            // Preserve selected state cho từng order
            const ordersWithSelectedState = esp32Batch.orders.map(esp32Order => {
              const existingOrder = existingBatch.orders.find(o => o.id === esp32Order.id);
              return {
                ...esp32Order,
                selected: existingOrder ? existingOrder.selected : false // Preserve hoặc mặc định false
              };
            });
            
            return {
              ...esp32Batch,
              orders: ordersWithSelectedState,
              isActive: existingBatch.isActive // Preserve active state
            };
          } else {
            // Batch mới - tất cả orders chưa được chọn
            return {
              ...esp32Batch,
              orders: Array.isArray(esp32Batch.orders) ? esp32Batch.orders.map(order => ({
                ...order,
                selected: false
              })) : []
            };
          }
        });
        
        orderBatches = updatedBatches;
        console.log('Updated orderBatches from ESP32 (preserved selected state):', orderBatches.length, 'batches');
        
        // Cập nhật UI
        updateCurrentBatchSelect();
        updateBatchSelector();
        
        return orderBatches;
      } else {
        console.log('ESP32 has no batches - using localStorage');
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
      console.log(`Web→ESP32: ${action.toUpperCase()}`, payload);
      
      // Tắt polling trong 1 giây để tránh conflict
      disablePollingUntil = Date.now() + 1000;
      console.log('Disabling status polling for 1 second to avoid conflict');
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
    console.log(`ESP32 response for ${action}:`, result);
    
    if (action === 'next_order') {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    return result;
    
  } catch (error) {
    console.error('Error sending ESP32 command:', error);
    showNotification('Lỗi gửi lệnh: ' + error.message, 'error');
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
        showNotification(`Lỗi gửi đơn hàng ${i + 1} đến thiết bị`, 'error');
        return false;
      }
      
      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    console.log('All orders in batch sent to ESP32 successfully');
    showNotification(`Đã gửi ${batch.orders.length} đơn hàng đến thiết bị`, 'success');
    return true;
    
  } catch (error) {
    console.error('Error sending batch to ESP32:', error);
    showNotification('Lỗi gửi danh sách đến thiết bị: ' + error.message, 'error');
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
      productCode: order.product?.code || '',
      quantity: order.quantity,
      warningQuantity: order.warningQuantity
    };
    
    console.log('New order saved to ESP32:');
    console.log('Customer:', payload.customerName);
    console.log('Order Code:', payload.orderCode);
    console.log('Vehicle:', payload.vehicleNumber);
    console.log('Product:', payload.productName);
    console.log('Product Code:', payload.productCode);
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
          
          // ESP32 trả về array of batches, không phải array of orders
          if (orders && Array.isArray(orders) && orders.length > 0) {
            let orderFound = false;
            
            // Tìm trong tất cả batches
            orders.forEach(batch => {
              if (batch.orders && Array.isArray(batch.orders)) {
                const sentOrder = batch.orders.find(o => 
                  o.orderCode === payload.orderCode || 
                  o.productName === payload.productName
                );
                if (sentOrder) {
                  console.log('Order confirmed saved in ESP32:', sentOrder);
                  orderFound = true;
                }
              }
            });
            
            if (!orderFound) {
              console.log('Order NOT found in ESP32 storage');
            }
          } else {
            console.log('ESP32 orders list is empty or invalid');
          }
        }
      } catch (error) {
        console.error('Error checking ESP32 orders:', error);
      }
    }, 500);
    
    return result;
    
  } catch (error) {
    console.error('Error sending order to ESP32:', error);
    showNotification('Lỗi gửi đơn hàng đến thiết bị: ' + error.message, 'error');
    return null;
  }
}

// GỬI THÔNG TIN BATCH ĐẾN ESP32 KHI ACTIVATE/CHỌN BATCH
async function activateBatchOnESP32(batch) {
  try {
    console.log('Activating batch on ESP32:', batch.name);
    
    // Tính tổng kế hoạch của tất cả đơn hàng trong batch
    const batchTotalTarget = batch.orders.reduce((total, order) => {
      return total + (order.quantity || 0);
    }, 0);
    
    console.log('Batch total target:', batchTotalTarget, 'from', batch.orders.length, 'orders');
    
    // Gửi thông tin batch
    const batchPayload = {
      batchName: batch.name,
      batchId: batch.id,
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
    console.log('Batch activated on ESP32:', result);
    
    // Nếu batch có đơn hàng, gửi đơn hàng đầu tiên để hiển thị
    if (batch.orders && batch.orders.length > 0) {
      const firstOrder = batch.orders[0];
      const productName = firstOrder.product?.name || firstOrder.productName || 'Unknown product';
      console.log('Sending first order for display:', productName);
      await sendOrderToESP32(firstOrder);
    }
    
    //showNotification(`Đã chọn danh sách: ${batch.name}`, 'success');
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
    
    showNotification('Sản phẩm đã được gửi đến thiết bị', 'success');
    return result;
    
  } catch (error) {
    console.error('Error sending product to ESP32:', error);
    showNotification('Lỗi gửi sản phẩm đến thiết bị: ' + error.message, 'error');
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
  
  // Check for IR commands in status when MQTT might not work
  if (data.lastIRCommand && data.lastIRTimestamp) {
    // Check if this is a new IR command (different timestamp)
    if (!window.lastProcessedIRTimestamp || data.lastIRTimestamp !== window.lastProcessedIRTimestamp) {
      console.log('ESP32→Web: IR ' + data.lastIRCommand + ' (polling)');
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
        // console.log(` DEBUG - Đơn ${currentOrderIndex + 1}:`, {
        //   customerName: currentOrder.customerName,
        //   quantity: currentOrder.quantity,
        //   currentCount: currentOrder.currentCount,
        //   status: currentOrder.status
        // });
        
        // Tính số đếm đã hoàn thành từ các đơn hàng trước đó (THEO THỨ TỰ)
        let completedCount = 0;
        for (let i = 0; i < currentOrderIndex; i++) {
          // Đối với đơn đã completed, cộng đúng số quantity
          if (selectedOrders[i].status === 'completed') {
            completedCount += selectedOrders[i].quantity;
            // console.log(` DEBUG - Đơn ${i + 1} đã hoàn thành: ${selectedOrders[i].quantity} bao`);
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
        
        // console.log(` DEBUG - Tính toán chi tiết:`, {
        //   currentOrderIndex: currentOrderIndex,
        //   totalFromESP32: totalCountFromDevice,
        //   completedCountFromPreviousOrders: completedCount,
        //   calculatedCurrentCount: calculatedCurrentCount,
        //   currentOrder_oldCurrentCount: currentOrder.currentCount || 0,
        //   currentOrder_newCurrentCount: newCurrentCount,
        //   currentOrder_targetQuantity: currentOrder.quantity,
        //   willUpdate: newCurrentCount >= (currentOrder.currentCount || 0)
        // });
        
        // Cập nhật tổng đếm
        countingState.totalCounted = totalCountFromDevice;
        
        // console.log(`Đơn ${currentOrderIndex + 1}/${selectedOrders.length}: ${currentOrder.customerName}`);
        // console.log(`ESP32 total: ${totalCountFromDevice} | Đã xong: ${completedCount} | Đơn hiện tại: ${currentOrder.currentCount}/${currentOrder.quantity}`);
        // console.log(`Tổng batch: ${countingState.totalCounted}/${countingState.totalPlanned}`);
        
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
    // Lấy thông tin đơn hàng hiện tại trước khi đánh dấu completed
    const completedOrder = selectedOrders[currentOrderIndex];
    
    // Đánh dấu đơn hàng hiện tại hoàn thành
    selectedOrders[currentOrderIndex].status = 'completed';
    
    // LƯU LỊCH SỬ CHO ĐƠN HÀNG VỪA HOÀN THÀNH
    const orderHistoryEntry = {
      timestamp: new Date().toISOString(),
      customerName: completedOrder.customerName,
      productName: completedOrder.product?.name || completedOrder.productName || 'N/A',
      orderCode: completedOrder.orderCode,
      vehicleNumber: completedOrder.vehicleNumber,
      plannedQuantity: completedOrder.quantity,
      actualCount: completedOrder.currentCount || 0,
      isBatch: false
    };
    
    console.log('Saving individual order to history:', completedOrder.orderCode);
    countingHistory.push(orderHistoryEntry);
    saveHistory();
    
    // Kiểm tra còn đơn hàng tiếp theo không
    if (currentOrderIndex < selectedOrders.length - 1) {
      // CHUYỂN SANG ĐƠN HÀNG TIẾP THEO
      const nextOrder = selectedOrders[currentOrderIndex + 1];
      nextOrder.status = 'counting';  // QUAN TRỌNG: Phải set trạng thái counting
      countingState.currentOrderIndex = currentOrderIndex + 1;
      
      console.log(`Chuyen sang don ${countingState.currentOrderIndex + 1}/${selectedOrders.length}: ${nextOrder.customerName}`);
      console.log(`Status updated: ${nextOrder.orderCode} -> counting`);
      
      // Gửi lệnh set_current_order đến ESP32 (dễ xử lý hơn next_order)
      const nextProduct = nextOrder.product || currentProducts.find(p => p.name === nextOrder.productName);
      const nextProductCode = nextProduct?.code || '';
      const nextProductName = nextProduct?.name || nextOrder.productName || 'Unknown product';
      
      await sendESP32Command('set_current_order', {
        orderCode: nextOrder.orderCode,
        customerName: nextOrder.customerName,
        productName: nextProductName,
        productCode: nextProductCode,  // Thêm productCode
        target: nextOrder.quantity,
        warningQuantity: nextOrder.warningQuantity || 5,
        orderIndex: countingState.currentOrderIndex,
        totalOrders: selectedOrders.length,
        keepCount: true, // Không reset count
        isRunning: true  // Đảm bảo ESP32 biết phải tiếp tục chạy
      });
      
      console.log('ESP32 next_order command sent with productCode:', nextProductCode, 'updating UI...');
      
      // showNotification(`Chuyen den don ${countingState.currentOrderIndex + 1}/${selectedOrders.length}: ${nextOrder.customerName}`, 'info');
      
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
  
  console.log('Saving batch to counting history:', batch.name);
  console.log('Completed orders:', completedOrders.length);
  console.log('Total counted:', countingState.totalCounted);
  
  // Tạo entry tổng cho batch
  const batchEntry = {
    timestamp: now.toISOString(),
    customerName: `Danh sách: ${batch.name}`,
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
  console.log('Saving settings to ESP32:', settings);
  
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
      console.log('Sending settings via MQTT:', message);
      
      mqttClient.publish('bagcounter/config/update', message);
      console.log('Settings sent via MQTT');
      
    } catch (error) {
      console.error('Error sending settings via MQTT:', error);
    }
  } else {
    console.log('MQTT not connected, skipping MQTT settings sync');
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
  // console.log('Active batch:', activeBatch);
  
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
  
  // GỬI LỆNH ĐẾN ESP32 ĐỂ CẬP NHẬT HIỂN THỊ LED
  sendESP32Command('set_mode', {
    mode: mode
  }).then(() => {
    console.log('Mode changed to:', mode, '- ESP32 display updated');
  }).catch(error => {
    console.error('Failed to update ESP32 mode:', error);
  });
  
  updateOverview();
}

// Product Management
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
    id: orderIdCounter++,
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
      <p><i class="fas fa-truck"></i> Địa chỉ: ${item.vehicleNumber}</p>
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
    
    // Get product display with code + name
    const product = currentProducts.find(p => p.name === entry.productName);
    const productDisplay = product && product.code ? `${product.code} - ${product.name}` : (entry.productName || 'N/A');
    
    row.innerHTML = `
      <td>${new Date(entry.timestamp).toLocaleString('vi-VN')}</td>
      <td>
        <strong>${entry.customerName}</strong>
        ${entry.orderCode ? `<br><small style="color: #666;">Mã: ${entry.orderCode}</small>` : ''}
      </td>
      <td>${entry.vehicleNumber || 'N/A'}</td>
      <td>${productDisplay}</td>
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
function saveSettings() {
  console.log('Saving settings - CURRENT STATE CHECK...');
  
  // KIỂM TRA SETTINGS HIỆN TẠI TRƯỚC KHI LƯU
  console.log('Current settings before save:', settings);
  
  // Get form values và update settings object
  settings.conveyorName = document.getElementById('conveyorName').value;
  settings.location = document.getElementById('location').value || '';
  settings.ipAddress = document.getElementById('ipAddress').value;
  settings.gateway = document.getElementById('gateway').value;
  settings.subnet = document.getElementById('subnet').value;
  settings.sensorDelay = parseInt(document.getElementById('sensorDelay').value);
  settings.bagDetectionDelay = parseInt(document.getElementById('bagDetectionDelay').value);
  settings.minBagInterval = parseInt(document.getElementById('minBagInterval').value);
  settings.autoReset = document.getElementById('autoReset').checked;
  settings.brightness = parseInt(document.getElementById('brightness').value);
  settings.relayDelayAfterComplete = parseInt(document.getElementById('relayDelay').value) * 1000; // Convert seconds to ms
  
  console.log('DEBUG: relayDelay form value:', document.getElementById('relayDelay').value);
  console.log('DEBUG: settings.relayDelayAfterComplete after update:', settings.relayDelayAfterComplete);
  
  console.log('Updated settings for save:', settings);
  
  // VALIDATE SETTINGS
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
    console.log('Settings saved to localStorage as backup');
  } catch (error) {
    console.error('Failed to save to localStorage:', error);
  }
  
  // Send settings to ESP32 với error handling tốt hơn
  showNotification('Đang lưu cài đặt...', 'info');
  
  // CẬP NHẬT NGAY TÊN BĂNG TẢI TRÊN DISPLAY
  updateConveyorNameDisplay();
  
  sendSettingsToESP32();
  
  updateOverview();
}

// Get device information (MAC address and MQTT topic)
async function getDeviceInfo() {
  try {
    console.log(' Getting device info from ESP32...');
    
    const response = await fetch('/api/device_info');
    if (response.ok) {
      const deviceInfo = await response.json();
      console.log('Device info received:', deviceInfo);
      
      // Update device code field (MAC Address với thông tin chi tiết)
      const deviceCodeField = document.getElementById('deviceCode');
      if (deviceCodeField) {
        let macInfo = deviceInfo.deviceMAC || 'N/A';
        if (deviceInfo.activeInterface === "Ethernet (W5500)" && deviceInfo.ethernetMAC) {
          macInfo = `ESP32: ${deviceInfo.deviceMAC} | Ethernet: ${deviceInfo.ethernetMAC}`;
        }
        deviceCodeField.value = macInfo;
      }
      
      // Update MQTT topic field
      const mqttTopicField = document.getElementById('mqttTopic');
      if (mqttTopicField) {
        mqttTopicField.value = deviceInfo.mqttTopic || 'bagcounter/unknown';
      }
      
      // Update conveyor name if available
      if (deviceInfo.conveyorName) {
        const conveyorNameField = document.getElementById('conveyorName');
        if (conveyorNameField && !conveyorNameField.value) {
          conveyorNameField.value = deviceInfo.conveyorName;
        }
      }
      
      console.log('Device info populated successfully');
      showNotification('Đã tải thông tin thiết bị thành công', 'success');
    } else {
      throw new Error('Failed to get device info');
    }
  } catch (error) {
    console.error('Error getting device info:', error);
    
    // Set default values when API fails
    const deviceCodeField = document.getElementById('deviceCode');
    const mqttTopicField = document.getElementById('mqttTopic');
    
    if (deviceCodeField) {
      deviceCodeField.value = 'API không khả dụng - Vui lòng kiểm tra kết nối';
    }
    if (mqttTopicField) {
      mqttTopicField.value = 'bagcounter/esp32_default';
    }
    
    console.log(' Device info set to default values due to API error');
  }
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
  // GỬI SETTINGS TỚI ESP32 ĐỂ GHI ĐÈ CÁC GIÁ TRỊ MẶC ĐỊNH
  const data = {
    conveyorName: settings.conveyorName,
    location: settings.location,
    brightness: settings.brightness,
    sensorDelay: settings.sensorDelay,
    bagDetectionDelay: settings.bagDetectionDelay,   // GHI ĐÈ default 200ms
    minBagInterval: settings.minBagInterval,         // GHI ĐÈ default 100ms
    autoReset: settings.autoReset,                   // GHI ĐÈ default false
    relayDelayAfterComplete: settings.relayDelayAfterComplete, // Thêm relay delay
    // Network settings
    ipAddress: settings.ipAddress,
    gateway: settings.gateway,
    subnet: settings.subnet,
    dns1: "8.8.8.8",
    dns2: "8.8.4.4"
  };
  
  console.log('Sending settings to ESP32 (will override defaults):', data);
  
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
    console.log('Settings sent to ESP32 and saved to /settings.json:', result);
    
    if (result.needRestart) {
      // Hiển thị thông báo cần restart
      if (confirm('IP Address đã thay đổi. Cần khởi động lại thiết bị để áp dụng. Khởi động lại ngay?')) {
        restartESP32();
      } else {
        showNotification('Lưu ý: Cần khởi động lại thiết bị để áp dụng IP mới', 'warning');
      }
    } else {
      showNotification('Cài đặt đã được lưu và áp dụng trên thiết bị', 'success');
      
      // KHÔNG reload settings từ ESP32 để tránh ghi đè giá trị vừa save
      // Chỉ cập nhật display name
      updateConveyorNameDisplay();
      
      // Optional: chỉ verify sau 3 giây và không ghi đè
      setTimeout(async () => {
        console.log('Quietly verifying settings (no overwrite)...');
        const response = await fetch('/api/settings');
        if (response.ok) {
          const esp32Settings = await response.json();
          console.log('ESP32 settings after save:', esp32Settings);
          
          // Chỉ so sánh, không ghi đè
          if (esp32Settings.relayDelayAfterComplete !== settings.relayDelayAfterComplete) {
            console.log('relayDelayAfterComplete mismatch: local=' + settings.relayDelayAfterComplete + ', ESP32=' + esp32Settings.relayDelayAfterComplete);
          }
        }
      }, 3000);
    }
  })
  .catch(error => {
    console.error('Error sending settings to ESP32:', error);
    showNotification('Lỗi lưu cài đặt: ' + error.message, 'error');
    
    // FALLBACK: Attempt to reload from ESP32
    console.log('Attempting to reload settings from ESP32 after error...');
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
    showNotification('Đang khởi động lại thiết bị...', 'info');
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
            // console.log('IR Remote START - calling startCounting()');
            startCounting();
          } else if (data.lastIRCommand === 'PAUSE') {
            // console.log('IR Remote PAUSE - calling pauseCounting()');
            pauseCounting();
          } else if (data.lastIRCommand === 'RESET') {
            // console.log('IR Remote RESET - calling resetCounting()');
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
    // console.log('Active batch:', activeBatch.name, 'has', activeBatch.orders.length, 'orders');
    
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
  
  console.log('Testing set_product with:', randomProduct.name);
  
  // Send both set_product and batch_info
  sendESP32Command('set_product', {
    productName: randomProduct.name,
    target: randomProduct.target
  }).then(() => {
    console.log('Test set_product sent successfully');
    
    // Also send batch_info
    return sendESP32Command('batch_info', {
      firstOrder: {
        productName: randomProduct.name,
        quantity: randomProduct.target
      }
    });
  }).then(() => {
    console.log('Test batch_info sent successfully');
    alert(`Test completed! Sent "${randomProduct.name}" with target ${randomProduct.target} to ESP32. Check ESP32 Serial Monitor.`);
  }).catch(error => {
    console.error('Test failed:', error);
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
      console.log(`Root response: ${response.status} ${response.statusText}`);
      return fetch('/api/status');
    })
    .then(response => {
      console.log(`/api/status response: ${response.status} ${response.statusText}`);
      return response.json();
    })
    .then(data => {
      console.log('/api/status success:', data);
      
      console.log('2. Testing /api/cmd with test command...');
      return sendESP32Command('test', { debug: true });
    })
    .then(result => {
      console.log('/api/cmd test result:', result);
      console.log('Full connectivity test PASSED!');
    })
    .catch(error => {
      console.error('Connectivity test FAILED:', error);
      console.log('Possible issues:');
      console.log('   - Wrong IP address');
      console.log('   - ESP32 not connected to WiFi');
      console.log('   - Firewall blocking connection');
      console.log('   - ESP32 web server not running');
    });
};

window.testMQTTCount = function() {
  console.log('Testing MQTT count updates...');
  
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
  
  console.log('Simulating count data:', testCountData);
  
  // Test direct display update
  updateDisplayElements(testCountData);
  
  // Test MQTT handler
  handleCountUpdate(testCountData);
  
  console.log('Manual test completed. Check "Thực hiện" field should show:', testCountData.count);
  console.log('If this works but real MQTT doesn\'t, problem is in MQTT communication');
};

window.debugMQTTTopics = function() {
  console.log('MQTT Topics Debug:');
  console.log('Subscribed topics should include:');
  console.log('   - bagcounter/status');
  console.log('   - bagcounter/count');  
  console.log('   - bagcounter/ir_command');
  console.log('   - bagcounter/alerts');
  
  if (mqttClient) {
    console.log('MQTT Client state:', mqttClient.connected ? 'Connected' : 'Disconnected');
  } else {
    console.log('MQTT Client not initialized');
  }
};

// Test basic connectivity to ESP32
window.testConnectivity = function() {
  console.log('Testing ESP32 connectivity...');
  
  console.log('1. Testing /api/status...');
  fetch('/api/status')
    .then(response => {
      console.log(`/api/status response: ${response.status} ${response.statusText}`);
      return response.json();
    })
    .then(data => {
      console.log('/api/status success:', data);
      
      console.log('2. Testing /api/cmd with ping...');
      return sendESP32Command('ping', { test: true });
    })
    .then(() => {
      console.log('Full connectivity test passed!');
    })
    .catch(error => {
      console.error('Connectivity test failed:', error);
      console.log('Check if ESP32 IP is correct and reachable');
    });
};

window.testWebCommands = function() {
  console.log('Testing web commands step by step...');
  
  console.log('Step 1: Testing start command...');
  sendESP32Command('start')
    .then(result => {
      console.log('Start command result:', result);
      console.log('Step 2: Testing pause command...');
      return sendESP32Command('pause');
    })
    .then(result => {
      console.log('Pause command result:', result);
      console.log('Step 3: Testing reset command...');
      return sendESP32Command('reset');
    })
    .then(result => {
      console.log('Reset command result:', result);
      console.log('All web commands test PASSED!');
      console.log('Check ESP32 Serial Monitor for corresponding logs:');
      console.log('   Received API command: start');
      console.log('   Received API command: pause');  
      console.log('   Received API command: reset');
    })
    .catch(error => {
      console.error('Web commands test FAILED:', error);
    });
};

// Test IR Command function  
window.testIRCommand = function() {
  console.log('Testing IR Command reception...');
  
  // Simulate IR command from ESP32
  const testCommands = ['START', 'PAUSE', 'RESET'];
  let commandIndex = 0;
  
  const testInterval = setInterval(() => {
    if (commandIndex >= testCommands.length) {
      clearInterval(testInterval);
      console.log('IR Command test completed');
      return;
    }
    
    const command = testCommands[commandIndex];
    const testData = {
      source: "IR_REMOTE_TEST",
      action: command,
      status: command === 'START' ? "RUNNING" : "STOPPED", 
      count: 0,
      timestamp: Date.now()
    };
    
    console.log(`Simulating IR command: ${command}`);
    handleMQTTMessage('bagcounter/ir_command', testData);
    
    commandIndex++;
  }, 2000);
};

window.debugMQTTConnection = function() {
  console.log(' MQTT Connection Debug:');
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
    
    console.log('Testing manual IR command simulation...');
    const testIRData = {
      source: "IR_REMOTE",
      action: "START",
      status: "RUNNING", 
      count: 0,
      timestamp: Date.now(),
      startTime: "Test Time"
    };
    
    console.log('Simulating IR command:', testIRData);
    handleMQTTMessage('bagcounter/ir_command', testIRData);
    console.log('Manual IR command test completed');
  } else {
    console.log('MQTT Client not initialized');
  }
};

// ==================== PASSWORD AUTHENTICATION ====================

const ADMIN_PASSWORD = "kinhbac99"; // Password for product management
const SETTINGS_PASSWORD = "kb666888"; // Password for WiFi and settings
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
  
  // Set appropriate placeholder based on target tab
  const passwordInput = document.getElementById('adminPassword');
  if (targetTab === 'product') {
    passwordInput.placeholder = 'Nhập mật khẩu ...';
  } else if (targetTab === 'wifi' || targetTab === 'settings') {
    passwordInput.placeholder = 'Nhập mật khẩu ...';
  }
  
  passwordInput.focus();
  
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
  
  let isValidPassword = false;
  
  // Check password based on target tab
  if (targetTab === 'product') {
    isValidPassword = (password === ADMIN_PASSWORD);
  } else if (targetTab === 'wifi' || targetTab === 'settings') {
    isValidPassword = (password === SETTINGS_PASSWORD);
  }
  
  if (isValidPassword) {
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
    case 'settings':
      // Auto-load device info when opening settings tab
      setTimeout(() => {
        getDeviceInfo();
      }, 500); // Small delay to ensure tab is fully loaded
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
  
  // Tạo select element và populate sau khi đã tạo
  productItem.innerHTML = `
    <div class="form-row">
      <div class="form-group">
        <label>Tên mặt hàng:</label>
        <select class="productSelect" required>
          <option value="">Chọn sản phẩm</option>
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
  
  // Populate select với currentProducts sau khi element đã được thêm vào DOM
  const select = productItem.querySelector('.productSelect');
  if (select && currentProducts && currentProducts.length > 0) {
    currentProducts.forEach(product => {
      const option = document.createElement('option');
      option.value = product.id;
      option.textContent = product.code ? `${product.code} - ${product.name}` : product.name;
      select.appendChild(option);
    });
    console.log('✅ DEBUG: Populated select with', currentProducts.length, 'products');
  } else {
    console.warn('⚠️ DEBUG: No currentProducts available when creating select');
  }
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
  
  // Populate select với currentProducts sau khi element đã được tạo
  const select = productsList.querySelector('.productSelect');
  if (select && currentProducts && currentProducts.length > 0) {
    currentProducts.forEach(product => {
      const option = document.createElement('option');
      option.value = product.id;
      option.textContent = product.code ? `${product.code} - ${product.name}` : product.name;
      select.appendChild(option);
    });
    console.log('✅ DEBUG: Populated initial select with', currentProducts.length, 'products');
  } else {
    console.warn('⚠️ DEBUG: No currentProducts available when creating initial select');
  }
}

function addMultipleOrdersToBatch() {
  const customerName = document.getElementById('customerName').value.trim();
  const orderCode = document.getElementById('orderCode').value.trim();
  const vehicleNumber = document.getElementById('vehicleNumber').value.trim();
  
  if (!customerName || !orderCode || !vehicleNumber) {
    showNotification('Vui lòng điền đầy đủ thông tin khách hàng, mã đơn hàng và địa chỉ', 'error');
    return;
  }
  
  const productItems = document.querySelectorAll('.product-item');
  const orders = [];
  
  for (let item of productItems) {
    const productSelect = item.querySelector('.productSelect');
    const quantity = item.querySelector('.quantity');
    const warningQuantity = item.querySelector('.warningQuantity');
    
    console.log('🔍 DEBUG: Processing product item:');
    console.log('   productSelect.value:', productSelect.value);
    console.log('   quantity.value:', quantity.value);
    console.log('   currentProducts:', currentProducts);
    
    if (productSelect.value && quantity.value) {
      // Tìm product object hoàn chỉnh theo ID
      const product = currentProducts.find(p => p.id == productSelect.value);
      console.log('DEBUG: Found product:', product);
      
      if (!product) {
        console.error('DEBUG: Product not found for ID:', productSelect.value);
        showNotification(`Không tìm thấy sản phẩm với ID: ${productSelect.value}`, 'error');
        continue;
      }
      
      // CHO PHÉP TẠO NHIỀU ĐỠN HÀNG CÙNG MÃ VÀ SẢN PHẨM
      // Không kiểm tra trùng lặp để cho phép tạo nhiều đơn hàng giống nhau
      
      const newOrder = {
        id: orderIdCounter++, // Simple incrementing ID
        orderNumber: currentOrderBatch.length + orders.length + 1, // Đảm bảo không trùng orderNumber
        customerName,
        orderCode: orderCode, // GIỮ NGUYÊN mã đơn hàng như user nhập - KHÔNG auto-append số
        vehicleNumber,
        product: product, // Lưu object product hoàn chỉnh
        productName: product.name, // Để tương thích
        quantity: parseInt(quantity.value),
        warningQuantity: parseInt(warningQuantity.value) || 5,
        status: 'waiting',
        selected: true, // Auto-select new orders
        currentCount: 0,
        createdAt: new Date().toISOString()
      };
      
      orders.push(newOrder);
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
  
  // Gửi từng đơn hàng đến ESP32 để ESP32 biết
  orders.forEach(async (order, index) => {
    try {
      await sendOrderToESP32(order);
      console.log(`Đã gửi đơn hàng ${order.orderCode} đến ESP32`);
    } catch (error) {
      console.error(`Lỗi gửi đơn hàng ${order.orderCode} đến ESP32:`, error);
    }
  });
  
  updateBatchPreview();
  resetOrderForm();
  showNotification(`Đã thêm ${orders.length} đơn hàng vào danh sách và gửi đến thiết bị`, 'success');
}

function resetOrderForm() {
  // Chỉ xóa mã đơn hàng, giữ lại thông tin khách hàng và địa chỉ để dễ nhập đơn tiếp theo
  document.getElementById('orderCode').value = '';
  
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
  document.getElementById('editQuantity').value = order.quantity;
  
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
  const quantity = parseInt(document.getElementById('editQuantity').value);
  
  if (!quantity || quantity < 1) {
    showNotification('Vui lòng nhập số lượng hợp lệ', 'error');
    return;
  }
  
  // Find active batch and update order
  const batch = orderBatches.find(b => b.isActive);
  const batchIndex = orderBatches.findIndex(b => b.isActive);
  
  if (batch && batch.orders[index] && batchIndex !== -1) {
    const oldOrder = batch.orders[index];
    
    // Chỉ update số lượng
    batch.orders[index] = {
      ...oldOrder,
      quantity: quantity
    };
    
    // Save to localStorage
    saveOrderBatches();
    
    // Send update to ESP32
    sendOrderUpdateToESP32(batch.orders[index], batchIndex);
    
    // Refresh display
    updateOrderTable();
    updateOverview(); // Cập nhật số liệu tổng quan sau khi sửa
    closeEditOrderModal();
    showNotification('Đã cập nhật số lượng thành công', 'success');
  }
}

function deleteOrder(orderId) {
  if (!confirm('Bạn có chắc chắn muốn xóa đơn hàng này?')) {
    return;
  }
  
  const batch = orderBatches.find(b => b.isActive);
  const batchIndex = orderBatches.findIndex(b => b.isActive);
  
  if (batch && batchIndex !== -1) {
    const orderIndex = batch.orders.findIndex(o => o.id === orderId);
    if (orderIndex !== -1) {
      const orderToDelete = batch.orders[orderIndex];
      batch.orders.splice(orderIndex, 1);
      saveOrderBatches();
      
      // Send delete to ESP32 with order data and batch index
      sendOrderDeleteToESP32(orderToDelete, batchIndex);
      
      updateOrderTable();
      updateOverview(); // Cập nhật số liệu tổng quan sau khi xóa
      showNotification('Đã xóa đơn hàng', 'success');
    }
  }
}

// ==================== ESP32 SYNC FUNCTIONS ====================

async function sendOrderUpdateToESP32(order, batchIndex) {
  try {
    const batches = JSON.parse(localStorage.getItem('orderBatches') || '[]');
    const batch = batches[batchIndex];
    
    if (!batch) {
      console.error('Batch not found at index:', batchIndex);
      return;
    }
    
    const payload = {
      cmd: 'UPDATE_ORDER',
      batchId: batch.id,
      orderId: order.id,
      orderData: {
        productCode: order.product?.code || '',
        productName: order.product?.name || order.productName,
        quantity: order.quantity,
        bagType: order.bagType || ''
      }
    };
    
    console.log('Sending UPDATE_ORDER to ESP32:', payload);
    
    // Sử dụng endpoint đã có thay vì tạo endpoint mới
    const response = await fetch('/api/cmd', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (response.ok) {
      const result = await response.text();
      console.log('Order update sent to ESP32:', result);
    } else {
      const errorText = await response.text();
      console.error('Failed to send order update to ESP32:', response.status, errorText);
    }
  } catch (error) {
    console.error('Error sending order update to ESP32:', error);
  }
}

async function sendOrderDeleteToESP32(orderData, batchIndex) {
  try {
    const batches = JSON.parse(localStorage.getItem('orderBatches') || '[]');
    const batch = batches[batchIndex];
    
    if (!batch) {
      console.error('Batch not found at index:', batchIndex);
      return;
    }
    
    const payload = {
      cmd: 'DELETE_ORDER',
      batchId: batch.id,
      orderId: orderData.id
    };
    
    console.log('Sending DELETE_ORDER to ESP32:', payload);
    
    // Sử dụng endpoint /api/cmd thay vì tạo endpoint mới
    const response = await fetch('/api/cmd', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (response.ok) {
      const result = await response.text();
      console.log('Order delete sent to ESP32:', result);
    } else {
      const errorText = await response.text();
      console.error('Failed to send order delete to ESP32:', response.status, errorText);
    }
  } catch (error) {
    console.error('Error sending order delete to ESP32:', error);
  }
}

// DEBUG FUNCTION - Test batchSelector
function testBatchSelector() {
  console.log('TESTING batchSelector...');
  console.log('orderBatches length:', orderBatches.length);
  console.log('orderBatches data:', orderBatches);
  
  const select = document.getElementById('batchSelector');
  console.log('batchSelector element:', select);
  console.log('batchSelector exists:', !!select);
  
  if (select) {
    console.log('Current innerHTML:', select.innerHTML);
    console.log('Current options count:', select.options.length);
  }
  
  console.log('Calling updateBatchSelector()...');
  updateBatchSelector();
  
  if (select) {
    console.log('After update - options count:', select.options.length);
    console.log('After update - innerHTML:', select.innerHTML);
  }
}

// FORCE REFRESH batchSelector
function forceRefreshBatchSelector() {
  console.log('FORCE REFRESH batchSelector');
  
  const select = document.getElementById('batchSelector');
  if (!select) {
    console.error('batchSelector not found!');
    return;
  }
  
  // Clear first
  select.innerHTML = '';
  
  // Add default option
  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = 'Chọn danh sách đơn hàng';
  select.appendChild(defaultOption);
  
  // Add each batch manually
  orderBatches.forEach((batch, index) => {
    console.log(`Adding batch ${index}:`, batch.name);
    const option = document.createElement('option');
    option.value = batch.name;
    const ordersCount = (batch.orders && batch.orders.length) || 0;
    option.textContent = `${batch.name} (${ordersCount} đơn)`;
    if (batch.isActive) {
      option.selected = true;
      console.log('Set as selected:', batch.name);
    }
    select.appendChild(option);
  });
  
  console.log('Force refresh completed. Options count:', select.options.length);
}