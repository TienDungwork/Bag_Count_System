
//>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> Bag Counter Display
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"
#include "esp_task_wdt.h"
#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>
#include <WebServer_ESP32_SC_W5500.h>

// Force use ESP32 WiFi library
#ifdef ARDUINO_ARCH_ESP32
  #include <WiFi.h>
#endif

#include <LittleFS.h>
#include <ArduinoJson.h>
#include <PubSubClient.h>
#include <time.h>
#include <vector>
#include <FS.h>
#include <IRremote.h>

//----------------------------------------W5500 Ethernet config
// W5500 SPI pin definitions - Undefine library pins first to avoid warnings
#ifdef INT_GPIO
#undef INT_GPIO
#endif
#ifdef MISO_GPIO
#undef MISO_GPIO
#endif
#ifdef MOSI_GPIO
#undef MOSI_GPIO
#endif
#ifdef SCK_GPIO
#undef SCK_GPIO
#endif
#ifdef CS_GPIO
#undef CS_GPIO
#endif

#define INT_GPIO            45
#define MISO_GPIO           37
#define MOSI_GPIO           35
#define SCK_GPIO            36
#define CS_GPIO             48
#define SPI_CLOCK_MHZ       25

// MAC address for W5500
byte mac[] = { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0x01 };

//----------------------------------------Network mode config
enum NetworkMode {
  ETHERNET_MODE,
  WIFI_STA_MODE,
  WIFI_AP_MODE
};

NetworkMode currentNetworkMode = ETHERNET_MODE;
bool ethernetConnected = false;
bool wifiConnected = false;

//----------------------------------------WiFi config
String wifi_ssid = "";
String wifi_password = "";
bool wifi_use_static_ip = false;
IPAddress wifi_static_ip;
IPAddress wifi_gateway;
IPAddress wifi_subnet;
IPAddress wifi_dns1;
IPAddress wifi_dns2;

const char* ap_ssid = "BagCounter_Config";
const char* ap_password = "12345678";

//----------------------------------------Network & MQTT config
const char* mqtt_server = "broker.hivemq.com";  // Thay đổi từ test.mosquitto.org
const char* mqtt_server_backup = "test.mosquitto.org";  // Backup broker
const int mqtt_port = 1883;
bool mqtt_use_backup = false;

//----------------------------------------MQTT Topics Structure
// Publish topics (ESP32 gửi data)
const char* TOPIC_STATUS = "bagcounter/status";           // Trạng thái tổng quát
const char* TOPIC_COUNT = "bagcounter/count";             // Số đếm real-time
const char* TOPIC_ALERTS = "bagcounter/alerts";           // Cảnh báo/hoàn thành
const char* TOPIC_SENSOR = "bagcounter/sensor";           // Dữ liệu cảm biến
const char* TOPIC_HEARTBEAT = "bagcounter/heartbeat";     // Keep-alive signal
const char* TOPIC_IR_CMD = "bagcounter/ir_command";       // IR Remote commands

// Subscribe topics (ESP32 nhận lệnh)
const char* TOPIC_CMD_START = "bagcounter/cmd/start";     // Lệnh start
const char* TOPIC_CMD_PAUSE = "bagcounter/cmd/pause";     // Lệnh pause  
const char* TOPIC_CMD_RESET = "bagcounter/cmd/reset";     // Lệnh reset
const char* TOPIC_CMD_SELECT = "bagcounter/cmd/select";   // Chọn đơn hàng
const char* TOPIC_CMD_BATCH = "bagcounter/cmd/batch_info"; // Thông tin batch
const char* TOPIC_CMD_TARGET = "bagcounter/cmd/target";   // Cập nhật target
const char* TOPIC_CONFIG = "bagcounter/config/update";    // Cập nhật config

// MQTT timing variables
unsigned long lastMqttPublish = 0;
unsigned long lastHeartbeat = 0;
unsigned long lastCountPublish = 0;     // Throttle count updates
const unsigned long MQTT_PUBLISH_INTERVAL = 500;  // 2 giây
const unsigned long HEARTBEAT_INTERVAL = 30000; 
const unsigned long COUNT_PUBLISH_THROTTLE = 100;   // 30 giây  
const unsigned long COUNT_PUBLISH_INTERVAL = 100;  // 100ms cho count updates - faster real-time

//----------------------------------------IP tĩnh config (Ethernet)
IPAddress local_IP(192, 168, 1, 200);     // IP tĩnh Ethernet
IPAddress gateway(192, 168, 1, 1);      // Gateway router của bạn
IPAddress subnet(255, 255, 255, 0);       // Subnet mask
IPAddress primaryDNS(8, 8, 8, 8);         // DNS
IPAddress secondaryDNS(8, 8, 4, 4);     // DNS phụ (Google DNS)

WebServer server(80);
WiFiClient ethClient;
PubSubClient mqtt(ethClient);

//----------------------------------------Defines the connected PIN between P5 and ESP32.
#define R1_PIN 10
#define G1_PIN 46
#define B1_PIN 3
#define R2_PIN 18
#define G2_PIN 17
#define B2_PIN 16
#define A_PIN 14
#define B_PIN 13
#define C_PIN 12
#define D_PIN 11
#define E_PIN -1  //--> required for 1/32 scan panels, like 64x64px. Any available pin would do, i.e. IO32.
#define LAT_PIN 7
#define OE_PIN 21
#define CLK_PIN 15
/*
#define R1_PIN 19 
#define G1_PIN 13
#define B1_PIN 18
#define R2_PIN 5
#define G2_PIN 12
#define B2_PIN 17

#define A_PIN 16
#define B_PIN 14
#define C_PIN 4
#define D_PIN 27
#define E_PIN -1  //--> required for 1/32 scan panels, like 64x64px. Any available pin would do, i.e. IO32

#define LAT_PIN 26
#define OE_PIN 15
#define CLK_PIN 2
*/

//----------------------------------------Sensor pin
#define SENSOR_PIN 4 // Chân kết nối cảm biến t61
#define TRIGGER_SENSOR_PIN 39  // Chân cảm biến encoder
#define START_LED_PIN 38  // relay chạy bắt đầu đếm
#define DONE_LED_PIN 5   // còi báo đến ngưỡng hoàn thành

//----------------------------------------IR Remote pin
#define RECV_PIN 1  // Chân nhận tín hiệu IR

//----------------------------------------Settings variables (WEB SYNC - NO DEFAULTS)
// CÁC BIẾN NÀY SẼ ĐƯỢC LOAD TỪ FILE TRONG setup() - KHÔNG CÓ GIÁ TRỊ MẶC ĐỊNH
int bagDetectionDelay;              // Thời gian xác nhận 1 bao (ms) - LOADED FROM FILE
int minBagInterval;                 // Khoảng cách tối thiểu giữa 2 bao (ms) - LOADED FROM FILE  
bool autoReset;                     // Tự động reset sau khi hoàn thành - LOADED FROM FILE
String conveyorName;  // Tên băng tải - LOADED FROM FILE
String location;      // Địa điểm - LOADED FROM FILE
int displayBrightness;              // Độ sáng LED matrix (10-100%) - LOADED FROM FILE
int sensorDelayMs;                  // Độ trễ cảm biến (ms) - LOADED FROM FILE
int relayDelayAfterComplete;        // Thời gian relay chạy thêm sau khi hoàn thành (ms) - LOADED FROM FILE

// Timing variables for bag detection
unsigned long lastBagTime = 0;      // Thời gian bao cuối cùng được phát hiện
unsigned long bagStartTime = 0;     // Thời gian bắt đầu phát hiện bao hiện tại
bool isBagDetected = false;         // Đang trong quá trình phát hiện bao
bool waitingForInterval = false;    // Đang chờ khoảng cách tối thiểu

// Relay control variables
unsigned long orderCompleteTime = 0;    // Thời gian hoàn thành đơn hàng
bool isOrderComplete = false;           // Đã hoàn thành đơn hàng
bool isRelayDelayActive = false;        // Đang trong thời gian delay relay

// Warning threshold LED control variables
unsigned long warningLedStartTime = 0;   // Thời gian bắt đầu bật LED cảnh báo
bool isWarningLedActive = false;         // Đang trong trạng thái cảnh báo
bool hasReachedWarningThreshold = false; // Đã đạt ngưỡng cảnh báo

//----------------------------------------
#define PANEL_RES_X 64
#define PANEL_RES_Y 32
#define PANEL_CHAIN 2  // 2 bảng nối với nhau

//----------------------------------------  // Maximum number of bags
//----------------------------------------
MatrixPanel_I2S_DMA *dma_display = nullptr;
uint16_t myBLACK, myWHITE, myRED, myGREEN, myBLUE, myYELLOW, myCYAN;

//----------------------------------------Bag config & history
struct HistoryItem {
  String time;
  int count;
  String type;  // Thêm trường type
};
std::vector<HistoryItem> history;
String bagType = "bao";
String productCode = "";  // Mã sản phẩm hiện tại được hiển thị trên LED
String orderCode = "";    // Mã đơn hàng hiện tại
String customerName = ""; // Tên khách hàng hiện tại
int targetCount = 20;
std::vector<String> bagTypes;

// THÔNG TIN BATCH HIỆN TẠI
String currentBatchName = "";
String currentBatchId = "";
String currentBatchDescription = "";
int totalOrdersInBatch = 0;
int batchTotalTarget = 0;  // Tổng kế hoạch của tất cả đơn hàng trong batch

// CHÍNH CHẾ ĐỘ HIỂN THỊ
String currentMode = "output";  // "output" hoặc "input"

unsigned long totalCount = 0;
unsigned long lastUpdate = 0;
bool isRunning = false;
bool isLimitReached = false;
bool finishedBlinking = false;
int blinkCount = 0;
bool isBlinking = false;
unsigned long lastBlink = 0;
bool needUpdate = true;  // Biến để theo dõi cần cập nhật LED
String startTimeStr = ""; // Thời gian bắt đầu thực tế
bool timeWaitingForSync = false; // Biến theo dõi trạng thái chờ đồng bộ thời gian
String currentSystemStatus = "RESET"; // Trạng thái hệ thống: RUNNING, PAUSE, RESET (chỉ 3 trạng thái)

// Biến để xử lý debounce cho cảm biến  
unsigned long lastDebounceTime = 0;
unsigned long debounceDelay = 50;  // Sẽ được sync từ sensorDelayMs
int lastSensorState = HIGH;
int sensorState;
int lastTriggerState = HIGH;
int triggerState;
bool isCountingEnabled = false;  // Biến kiểm soát việc đếm
bool isTriggerEnabled = false;   // Biến kiểm soát cảm biến khởi động
bool isCounting = false;    // Biến mới để theo dõi trạng thái đếm

// Biến trạng thái cho LED
bool startLedOn = false;  // true = sáng (LOW), false = tắt (HIGH)
bool doneLedOn = false;   // true = sáng (LOW), false = tắt (HIGH)

//----------------------------------------System Status variables
bool systemConnected = false;    // Trạng thái kết nối hoàn tất
bool showConnectingAnimation = true;   // Hiển thị "Connecting" hay không
unsigned long connectingAnimationTime = 0;  // Thời gian cho animation
int connectingDots = 0;          // Số dấu chấm cho animation

//----------------------------------------Data Storage variables
DynamicJsonDocument productsData(4096);
DynamicJsonDocument ordersData(16384); // Tăng từ 8192 lên 16384 để chứa nhiều đơn hàng hơn
bool dataLoaded = false;

//----------------------------------------IR Remote variables
IRrecv irrecv(RECV_PIN);
decode_results results;
unsigned long lastIRCode = 0;
unsigned long lastIRTime = 0;
unsigned long debounceIRTime = 200; // ms

// IR Command tracking for web notification
String lastIRCommand = "";
unsigned long lastIRTimestamp = 0;
bool hasNewIRCommand = false;

// File paths
#define BAGTYPES_FILE "/bagtypes.json"
#define BAGCONFIGS_FILE "/bagconfigs.json"

//----------------------------------------Function declarations
void updateStartLED();
void updateDoneLED();
void updateDisplay();
void updateCount();
String getTimeStr();
void showConnectingDisplay();
void setSystemConnected();
void saveBagConfigsToFile();
void publishStatusMQTT();
void publishBagConfigs();
void displayCurrentOrderInfo();

//----------------------------------------IR Remote functions
// Cấu hình từng loại - Di chuyển lên đây để sử dụng trong handleIRCommand
struct BagConfig {
  String type;
  int target;
  int warn;
  String status; // WAIT, RUNNING, DONE
};
std::vector<BagConfig> bagConfigs;

unsigned long mapIRButton(unsigned long code) {
  if (code == 0xFFA25D || code == 0xE318261B) return 1;  // Nút 1 - Start
  if (code == 0x511DBB || code == 0xFF629D) return 2;    // Nút 2 - Pause
  if (code == 0xFFE21D || code == 0xEE886D7F) return 3;  // Nút 3 - Reset
  return 0;
}

void handleIRCommand(int button) {
  // Khai báo biến ở ngoài switch để tránh lỗi biên dịch
  JsonDocument doc;
  String msg;
  String action = "";
  
  switch(button) {
    case 1: // Start
      Serial.println("🎛️ IR Remote: START");
      isRunning = true;
      isTriggerEnabled = true;
      isCountingEnabled = true;
      currentSystemStatus = "RUNNING";
      isRunning = true;
      isTriggerEnabled = true;
      isCountingEnabled = true;
      currentSystemStatus = "RUNNING";
      action = "START";
      
      if (time(nullptr) > 24 * 3600) {
        startTimeStr = getTimeStr();
        timeWaitingForSync = false;
      } else {
        startTimeStr = "Waiting for time sync...";
        timeWaitingForSync = true;
      }
      
      // CHỈ LOAD THÔNG TIN ĐƠN HÀNG HIỆN TẠI KHI CHƯA CÓ THÔNG TIN TỪ WEB
      // Chỉ load từ ordersData nếu bagType trống (chưa được set từ web)
      if (bagType.isEmpty()) {
        loadCurrentOrderForDisplay();
      }
      
      for (auto& cfg : bagConfigs) {
        cfg.status = "RUNNING";
      }
      saveBagConfigsToFile();
      updateStartLED();
      needUpdate = true;
      
      if (time(nullptr) > 24 * 3600) {
        startTimeStr = getTimeStr();
        timeWaitingForSync = false;
      } else {
        startTimeStr = "Waiting for time sync...";
        timeWaitingForSync = true;
      }
      
      for (auto& cfg : bagConfigs) {
        cfg.status = "RUNNING";
      }
      saveBagConfigsToFile();
      updateStartLED();
      needUpdate = true;
      break;
      
    case 2: // Pause
      Serial.println("🎛️ IR Remote: PAUSE");
      isRunning = false;
      isTriggerEnabled = false;
      isCountingEnabled = false;
      currentSystemStatus = "PAUSE";
      isRunning = false;
      isTriggerEnabled = false;
      isCountingEnabled = false;
      currentSystemStatus = "PAUSE";
      action = "PAUSE";
      for (auto& cfg : bagConfigs) {
        cfg.status = "PAUSE";
      }
      saveBagConfigsToFile();
      for (auto& cfg : bagConfigs) {
        cfg.status = "PAUSE";
      }
      saveBagConfigsToFile();
      updateStartLED();
      needUpdate = true;
      updateStartLED();
      needUpdate = true;
      break;
      
    case 3: // Reset
      Serial.println("🎛️ IR Remote: RESET");
      totalCount = 0;
      isLimitReached = false;
      isRunning = false;
      isTriggerEnabled = false;
      totalCount = 0;
      isLimitReached = false;
      isRunning = false;
      isTriggerEnabled = false;
      isCountingEnabled = false;
      history.clear();
      startTimeStr = "";
      timeWaitingForSync = false;
      currentSystemStatus = "RESET";
      isCountingEnabled = false;
      history.clear();
      startTimeStr = "";
      timeWaitingForSync = false;
      currentSystemStatus = "RESET";
      action = "RESET";
      
      for (auto& cfg : bagConfigs) {
        cfg.status = "RESET";
      }
      saveBagConfigsToFile();
      updateStartLED();
      updateDoneLED();
      needUpdate = true;
      
      for (auto& cfg : bagConfigs) {
        cfg.status = "RESET";
      }
      saveBagConfigsToFile();
      updateStartLED();
      updateDoneLED();
      needUpdate = true;
      break;
  }
  
  // MQTT connection check
  if (!mqtt.connected()) {
    String clientId = "ESP32_BagCounter_" + String(WiFi.macAddress());
    clientId.replace(":", "");
    const char* current_broker = mqtt_use_backup ? mqtt_server_backup : mqtt_server;
    mqtt.setServer(current_broker, mqtt_port);
    
    if (mqtt.connect(clientId.c_str())) {
      mqtt.subscribe(TOPIC_CMD_START);
      mqtt.subscribe(TOPIC_CMD_PAUSE);
      mqtt.subscribe(TOPIC_CMD_RESET);
      mqtt.subscribe(TOPIC_CMD_SELECT);
      mqtt.subscribe(TOPIC_CMD_BATCH);
      mqtt.subscribe(TOPIC_CONFIG);
    } else {
      Serial.println("❌ Failed to reconnect MQTT for IR command");
    }
  }
  
  // GỬI LỆNH MQTT GIỐNG NHƯ WEB INTERFACE  
  // Chỉ gửi IR notification, KHÔNG gửi command để tránh loop
  doc.clear();
  doc["source"] = "IR_REMOTE";
  doc["action"] = action;
  doc["status"] = isRunning ? "RUNNING" : "STOPPED";
  doc["count"] = totalCount;
  doc["timestamp"] = millis();
  doc["startTime"] = startTimeStr;
  msg = "";
  serializeJson(doc, msg);
  
  // Gửi thông báo IR command qua topic riêng (cho web biết và xử lý)
  bool irNotificationSent = mqtt.publish(TOPIC_IR_CMD, msg.c_str(), true);
  
  if (irNotificationSent) {
    Serial.println("IR Command notification sent to web: " + action);
  } else {
    Serial.println("Failed to send IR notification");
  }
  
  updateDisplay();
  publishStatusMQTT();
  
  lastIRCommand = action;
  lastIRTimestamp = millis();
  hasNewIRCommand = true;
  
  Serial.println("IR Command " + action + " processed and sent to web via MQTT");
}

// Load thông tin đơn hàng hiện tại để hiển thị trên LED khi IR Remote START
void loadCurrentOrderForDisplay() {
  Serial.println("Loading current order for display...");
  
  // Tìm đơn hàng đang đếm hoặc chờ trong ordersData
  for (size_t i = 0; i < ordersData.size(); i++) {
    JsonArray orders = ordersData[i]["orders"];
    
    // Tìm đơn hàng đang counting hoặc selected
    for (size_t j = 0; j < orders.size(); j++) {
      JsonObject order = orders[j];
      String status = order["status"].as<String>();
      bool selected = order["selected"] | false;
      
      if ((status == "counting" || status == "waiting" || status == "paused") && selected) {
        // Load thông tin đơn hàng này
        String productName = order["productName"].as<String>();
        String productCodeFromOrder = "";
        
        // Lấy product code từ product object nếu có
        if (order.containsKey("product") && order["product"].containsKey("code")) {
          productCodeFromOrder = order["product"]["code"].as<String>();
        }
        
        int quantity = order["quantity"] | 20;
        int warningQuantity = order["warningQuantity"].as<int>() | 5; // Mặc định 5 nếu không có
        
        bagType = productName;
        productCode = productCodeFromOrder;
        
        // Cập nhật biến global cho API customer
        if (order.containsKey("orderCode")) {
          orderCode = order["orderCode"].as<String>();
          Serial.println("Updated global orderCode: " + orderCode);
        }
        if (order.containsKey("customerName")) {
          customerName = order["customerName"].as<String>();
          Serial.println("Updated global customerName: " + customerName);
        }
        
        targetCount = quantity;
        
        // Cập nhật bagConfig với warningQuantity từ order
        for (auto& cfg : bagConfigs) {
          if (cfg.type == productName) {
            cfg.target = quantity;
            cfg.warn = warningQuantity;
            Serial.println("Updated bagConfig warning threshold to: " + String(warningQuantity));
            break;
          }
        }
        
        Serial.println("Loaded order for display:");
        Serial.println("   Product: " + productName);
        Serial.println("   Code: " + productCodeFromOrder);
        Serial.println("   Target: " + String(quantity));
        Serial.println("   Warning: " + String(warningQuantity));
        
        needUpdate = true;
        return;
      }
    }
  }
  
  Serial.println("No current order found for display");
}

// Handle commands from Web
void handleWebCommand(int button) {
  String action = "";
  
  switch(button) {
    case 1: // Start
      isRunning = true;
      isTriggerEnabled = true;
      isCountingEnabled = true;
      currentSystemStatus = "RUNNING";
      action = "START";
      
      if (time(nullptr) > 24 * 3600) {
        startTimeStr = getTimeStr();
        timeWaitingForSync = false;
      } else {
        startTimeStr = "Waiting for time sync...";
        timeWaitingForSync = true;
      }
      
      // LUÔN LOAD THÔNG TIN ĐƠN HÀNG HIỆN TẠI KHI START
      // Đảm bảo LED display luôn hiển thị đúng order info (cho cả Web và IR Remote)
      loadCurrentOrderForDisplay();
      
      for (auto& cfg : bagConfigs) {
        cfg.status = "RUNNING";
      }
      saveBagConfigsToFile();
      updateStartLED();
      needUpdate = true;
      break;
      
    case 2: // Pause
      isRunning = false;
      isTriggerEnabled = false;
      isCountingEnabled = false;
      currentSystemStatus = "PAUSE";
      action = "PAUSE";
      
      for (auto& cfg : bagConfigs) {
        cfg.status = "PAUSE";
      }
      saveBagConfigsToFile();
      updateStartLED();
      needUpdate = true;
      break;
      
    case 3: // Reset
      totalCount = 0;
      isLimitReached = false;
      isRunning = false;
      isTriggerEnabled = false;
      isCountingEnabled = false;
      history.clear();
      startTimeStr = "";
      timeWaitingForSync = false;
      currentSystemStatus = "RESET"; // Set trạng thái RESET
      action = "RESET";
      
      // CLEAR RELAY DELAY STATE
      isOrderComplete = false;
      isRelayDelayActive = false;
      orderCompleteTime = 0;
      Serial.println("🔌 RELAY DELAY STATE CLEARED (manual reset)");
      
      // CLEAR WARNING THRESHOLD STATE
      isWarningLedActive = false;
      hasReachedWarningThreshold = false;
      warningLedStartTime = 0;
      Serial.println("⚠️ WARNING LED STATE CLEARED (manual reset)");
      
      for (auto& cfg : bagConfigs) {
        cfg.status = "RESET";
      }
      saveBagConfigsToFile();
      updateStartLED();
      updateDoneLED();
      needUpdate = true;
      break;
  }
  
  publishStatusMQTT();
}

//------------------- Lưu/đọc loại bao -------------------
void saveBagTypesToFile() {
  File f = LittleFS.open(BAGTYPES_FILE, "w");
  if (!f) return;
  JsonDocument doc;
  JsonArray arr = doc.to<JsonArray>();
  for (auto& type : bagTypes) arr.add(type);
  serializeJson(doc, f);
  f.close();
}
void loadBagTypesFromFile() {
  File f = LittleFS.open(BAGTYPES_FILE, "r");
  if (!f) return;
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, f);
  if (!err) {
    bagTypes.clear();
    for (JsonVariant v : doc.as<JsonArray>()) bagTypes.push_back(v.as<String>());
  }
  f.close();
}

//------------------- Lưu/đọc thông tin batch -------------------
#define BATCH_FILE "/batch_info.json"

void saveBatchInfoToFile() {
  File f = LittleFS.open(BATCH_FILE, "w");
  if (!f) return;
  JsonDocument doc;
  doc["batchName"] = currentBatchName;
  doc["batchId"] = currentBatchId;
  doc["batchDescription"] = currentBatchDescription;
  doc["totalOrders"] = totalOrdersInBatch;
  doc["batchTotalTarget"] = batchTotalTarget;  // Lưu tổng target của batch
  serializeJson(doc, f);
  f.close();
  Serial.println("Batch info saved to file: " + currentBatchName);
}

void loadBatchInfoFromFile() {
  File f = LittleFS.open(BATCH_FILE, "r");
  if (!f) return;
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, f);
  if (!err) {
    currentBatchName = doc["batchName"].as<String>();
    currentBatchId = doc["batchId"].as<String>();
    currentBatchDescription = doc["batchDescription"].as<String>();
    totalOrdersInBatch = doc["totalOrders"].as<int>();
    batchTotalTarget = doc["batchTotalTarget"].as<int>();  // Load tổng target của batch
    Serial.println("Batch info loaded from file: " + currentBatchName);
  }
  f.close();
}

//------------------- Lưu/đọc cấu hình từng loại -------------------
void saveBagConfigsToFile() {
  File f = LittleFS.open(BAGCONFIGS_FILE, "w");
  if (!f) return;
  JsonDocument doc;
  JsonArray arr = doc.to<JsonArray>();
  for (auto& c : bagConfigs) {
    JsonObject o = arr.add<JsonObject>();
    o["type"] = c.type;
    o["target"] = c.target;
    o["warn"] = c.warn;
    o["status"] = c.status;
  }
  serializeJson(doc, f);
  f.close();
}
void loadBagConfigsFromFile() {
  File f = LittleFS.open(BAGCONFIGS_FILE, "r");
  if (!f) return;
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, f);
  if (!err) {
    bagConfigs.clear();
    for (JsonObject o : doc.as<JsonArray>()) {
      BagConfig c;
      c.type = o["type"].as<String>();
      c.target = o["target"] | 20;
      c.warn = o["warn"] | 10;
      c.status = o["status"] | "WAIT";
      bagConfigs.push_back(c);
    }
  }
  f.close();
}

//------------------- Lưu/đọc cài đặt chung -------------------

// Helper function để copy JsonObject (cần cho API orders POST)
void copyJsonObject(JsonObject src, JsonObject dst) {
  for (JsonPair p : src) {
    if (p.value().is<JsonObject>()) {
      JsonObject nested = dst.createNestedObject(p.key());
      copyJsonObject(p.value().as<JsonObject>(), nested);
    } else if (p.value().is<JsonArray>()) {
      JsonArray srcArray = p.value().as<JsonArray>();
      JsonArray dstArray = dst.createNestedArray(p.key());
      for (JsonVariant v : srcArray) {
        if (v.is<JsonObject>()) {
          JsonObject nestedObj = dstArray.createNestedObject();
          copyJsonObject(v.as<JsonObject>(), nestedObj);
        } else {
          dstArray.add(v);
        }
      }
    } else {
      dst[p.key()] = p.value();
    }
  }
}

void saveSettingsToFile() {
  Serial.println("Saving settings to file...");
  
  JsonDocument doc;
  
  // Network settings
  doc["ipAddress"] = local_IP.toString();
  doc["gateway"] = gateway.toString();
  doc["subnet"] = subnet.toString();
  doc["dns1"] = primaryDNS.toString();
  doc["dns2"] = secondaryDNS.toString();
  
  // System settings
  doc["conveyorName"] = conveyorName;
  doc["location"] = location;
  doc["brightness"] = displayBrightness;
  doc["sensorDelay"] = sensorDelayMs;
  doc["bagDetectionDelay"] = bagDetectionDelay;
  doc["minBagInterval"] = minBagInterval;
  doc["autoReset"] = autoReset;
  doc["relayDelayAfterComplete"] = relayDelayAfterComplete;
  
  File file = LittleFS.open("/settings.json", "w");
  if (file) {
    serializeJson(doc, file);
    file.close();
    Serial.println("Settings saved to /settings.json");
  } else {
    Serial.println("Failed to save settings");
  }
}

void loadSettingsFromFile() {
  Serial.println("🔧 Loading settings from file...");
  
  // KIỂM TRA VÀ TẠO FILE MẶC ĐỊNH NẾU CHƯA CÓ
  if (!LittleFS.exists("/settings.json")) {
    Serial.println("ℹNo settings file found - creating default settings file...");
    createDefaultSettingsFile();
  }
  
  // LUÔN LUÔN LOAD TỪ FILE (vì đã đảm bảo file tồn tại)
  File file = LittleFS.open("/settings.json", "r");
  if (file) {
    String content = file.readString();
    file.close();
    
    DynamicJsonDocument doc(1024);
    if (deserializeJson(doc, content) == DeserializationError::Ok) {
      Serial.println("Found settings file, loading saved values:");
      
      // Load Ethernet IP config
  String ethIP = doc["ipAddress"].as<String>();
  String ethGateway = doc["gateway"].as<String>();
  String ethSubnet = doc["subnet"].as<String>();
  String ethDNS1 = doc["dns1"].as<String>();
  String ethDNS2 = doc["dns2"].as<String>();
      
      if (ethIP.length() > 0) {
        IPAddress newIP, newGateway, newSubnet, newDNS1, newDNS2;
        if (newIP.fromString(ethIP)) local_IP = newIP;
        if (newGateway.fromString(ethGateway)) gateway = newGateway;
        if (newSubnet.fromString(ethSubnet)) subnet = newSubnet;
        if (newDNS1.fromString(ethDNS1)) primaryDNS = newDNS1;
        if (newDNS2.fromString(ethDNS2)) secondaryDNS = newDNS2;
        
        Serial.println("   Network config loaded:");
        Serial.println("    IP: " + ethIP);
        Serial.println("    Gateway: " + ethGateway);
        Serial.println("    Subnet: " + ethSubnet);
      }
      
      // Load all settings from file (KHÔNG CÓ FALLBACK - file đã được tạo với giá trị mặc định)
      conveyorName = doc["conveyorName"].as<String>();
      location = doc["location"].as<String>();
      displayBrightness = doc["brightness"].as<int>();
      sensorDelayMs = doc["sensorDelay"].as<int>();
      bagDetectionDelay = doc["bagDetectionDelay"].as<int>();
      minBagInterval = doc["minBagInterval"].as<int>();
      autoReset = doc["autoReset"].as<bool>();
      relayDelayAfterComplete = doc["relayDelayAfterComplete"].as<int>();
      
      // Sync debounce delay
      debounceDelay = sensorDelayMs;
      
      Serial.println("    Settings loaded from file:");
      Serial.println("    conveyorName: " + conveyorName);
      Serial.println("    location: " + location);
      Serial.println("    brightness: " + String(displayBrightness) + "%");
      Serial.println("    sensorDelay: " + String(sensorDelayMs) + "ms");
      Serial.println("    bagDetectionDelay: " + String(bagDetectionDelay) + "ms");
      Serial.println("    minBagInterval: " + String(minBagInterval) + "ms");
      Serial.println("    autoReset: " + String(autoReset ? "true" : "false"));
      Serial.println("    relayDelayAfterComplete: " + String(relayDelayAfterComplete) + "ms");
      
      Serial.println("All settings loaded from file successfully");
    } else {
      Serial.println("Failed to parse settings JSON - recreating file");
      createDefaultSettingsFile();
      loadSettingsFromFile(); // Recursive call to load after creating file
    }
  } else {
    Serial.println("Failed to open settings file - recreating file");
    createDefaultSettingsFile();
    loadSettingsFromFile(); // Recursive call to load after creating file
  }
}

// TẠO FILE CÀI ĐẶT MẶC ĐỊNH (CHỈ CHẠY LẦN ĐẦU)
void createDefaultSettingsFile() {
  Serial.println("🔧 Creating default settings file...");
  
  JsonDocument doc;
  
  // Network settings - default values
  doc["ipAddress"] = "192.168.1.200";
  doc["gateway"] = "192.168.1.1";
  doc["subnet"] = "255.255.255.0";
  doc["dns1"] = "8.8.8.8";
  doc["dns2"] = "8.8.4.4";
  
  // Application settings - default values
  doc["conveyorName"] = "BT-001";
  doc["location"] = "Khu vực 1";
  doc["brightness"] = 35;
  doc["sensorDelay"] = 50;
  doc["bagDetectionDelay"] = 200;
  doc["minBagInterval"] = 100;
  doc["autoReset"] = true;  // Enable automatic order switching
  doc["relayDelayAfterComplete"] = 5000;
  
  // Add creation timestamp
  doc["_created"] = "ESP32_Default_Config";
  doc["_version"] = "1.0";
  
  File file = LittleFS.open("/settings.json", "w");
  if (file) {
    serializeJson(doc, file);
    file.close();
    Serial.println("Default settings file created successfully");
  } else {
    Serial.println("Failed to create default settings file!");
  }
}

// HÀM TẠO CÁC FILE MẶC ĐỊNH LẦN ĐẦU
void createDefaultDataFiles() {
  Serial.println("🔧 Creating default data files...");
  
  // Create default products.json if not exists
  if (!LittleFS.exists("/products.json")) {
    Serial.println("   Creating default products.json...");
    File file = LittleFS.open("/products.json", "w");
    if (file) {
      file.println("[]"); // Empty array
      file.close();
      Serial.println("   ✅ Default products.json created");
    }
  }
  
  // Create default orders.json if not exists
  if (!LittleFS.exists("/orders.json")) {
    Serial.println("   Creating default orders.json...");
    File file = LittleFS.open("/orders.json", "w");
    if (file) {
      file.println("[]"); // Empty array
      file.close();
      Serial.println("   Default orders.json created");
    }
  }
  
  // Create default history.json if not exists
  if (!LittleFS.exists("/history.json")) {
    Serial.println("   Creating default history.json...");
    File file = LittleFS.open("/history.json", "w");
    if (file) {
      file.println("[]"); // Empty array
      file.close();
      Serial.println("   Default history.json created");
    }
  }
  
  Serial.println("All default data files created");
}

void debugSettingsFile() {
  Serial.println("DEBUG: Checking settings file...");
  
  if (LittleFS.exists("/settings.json")) {
    File file = LittleFS.open("/settings.json", "r");
    if (file) {
      String content = file.readString();
      file.close();
      
      Serial.println("Settings file content:");
      Serial.println(content);
      DynamicJsonDocument doc(1024);
      DeserializationError error = deserializeJson(doc, content);
      
      if (error) {
        Serial.println("JSON Parse Error: " + String(error.c_str()));
      } else {
        Serial.println("JSON is valid");
        Serial.println("Keys found:");
        for (JsonPair p : doc.as<JsonObject>()) {
          Serial.println("  - " + String(p.key().c_str()) + ": " + p.value().as<String>());
        }
      }
    } else {
      Serial.println("Cannot open settings file");
    }
  } else {
    Serial.println("Settings file does not exist");
  }
  
  Serial.println("Current variables in memory:");
  Serial.println("  - conveyorName: " + conveyorName);
  Serial.println("  - location: " + location);
  Serial.println("  - brightness: " + String(displayBrightness));
  Serial.println("  - sensorDelay: " + String(sensorDelayMs));
  Serial.println("  - bagDetectionDelay: " + String(bagDetectionDelay));
  Serial.println("  - minBagInterval: " + String(minBagInterval));
  Serial.println("  - autoReset: " + String(autoReset));
}

//----------------------------------------Data Storage Functions
void saveProductsToFile() {
  File file = LittleFS.open("/products.json", "w");
  if (file) {
    serializeJson(productsData, file);
    file.close();
    Serial.println("Products saved to /products.json");
  } else {
    Serial.println("Failed to save products.json");
  }
}

void loadProductsFromFile() {
  // ĐẢMBẢO FILE TỒN TẠI - TẠO NẾU CHƯA CÓ
  if (!LittleFS.exists("/products.json")) {
    Serial.println("ℹproducts.json not found - creating empty products file");
    File file = LittleFS.open("/products.json", "w");
    if (file) {
      file.println("[]"); // Empty array
      file.close();
      Serial.println("   Empty products.json created");
    }
  }
  
  // LUÔN LOAD TỪ FILE (đã đảm bảo file tồn tại)
  File file = LittleFS.open("/products.json", "r");
  if (file) {
    DeserializationError error = deserializeJson(productsData, file);
    file.close();
    
    if (error) {
      Serial.println("❌ Failed to parse products.json: " + String(error.c_str()) + " - recreating file");
      File newFile = LittleFS.open("/products.json", "w");
      if (newFile) {
        newFile.println("[]");
        newFile.close();
      }
      productsData.clear();
      productsData.to<JsonArray>();
    } else {
      Serial.println("Products loaded from /products.json");
      Serial.println("   Found " + String(productsData.size()) + " products");
    }
  } else {
    Serial.println("Failed to open products.json - creating empty array");
    productsData.clear();
    productsData.to<JsonArray>();
  }
}

void saveOrdersToFile() {
  Serial.println("Attempting to save orders to file...");
  Serial.println("ordersData size: " + String(ordersData.size()) + " items");
  
  File file = LittleFS.open("/orders.json", "w");
  if (file) {
    size_t bytesWritten = serializeJson(ordersData, file);
    file.close();
    
    Serial.println("Orders saved to /orders.json");
    Serial.println("File size: " + String(bytesWritten) + " bytes");

    // VERIFY: Đọc lại file để đảm bảo đã lưu thành công
    File verifyFile = LittleFS.open("/orders.json", "r");
    if (verifyFile) {
      String content = verifyFile.readString();
      verifyFile.close();
      
      Serial.println("VERIFY: File content preview (first 200 chars):");
      Serial.println(content.substring(0, min(200, (int)content.length())));
      
      if (content.length() > 10) { // File có nội dung
        Serial.println("VERIFY: Orders file saved and verified successfully");
      } else {
        Serial.println("VERIFY: Orders file appears to be empty after save!");
      }
    } else {
      Serial.println("VERIFY: Cannot read back orders file!");
    }
  } else {
    Serial.println("Failed to open /orders.json for writing");
  }
}

void loadOrdersFromFile() {
  // ĐẢMBẢO FILE TỒN TẠI - TẠO NẾU CHƯA CÓ
  if (!LittleFS.exists("/orders.json")) {
    Serial.println(" orders.json not found - creating empty orders file");
    File file = LittleFS.open("/orders.json", "w");
    if (file) {
      file.println("[]"); // Empty array
      file.close();
      Serial.println("   Empty orders.json created");
    }
  }
  
  //  LUÔN LOAD TỪ FILE (đã đảm bảo file tồn tại)
  File file = LittleFS.open("/orders.json", "r");
  if (file) {
    DeserializationError error = deserializeJson(ordersData, file);
    file.close();
    
    if (error) {
      Serial.println("Failed to parse orders.json: " + String(error.c_str()) + " - recreating file");
      File newFile = LittleFS.open("/orders.json", "w");
      if (newFile) {
        newFile.println("[]");
        newFile.close();
      }
      ordersData.clear();
      ordersData.to<JsonArray>();
    } else {
      Serial.println("Orders loaded from /orders.json");
      Serial.println("   Found " + String(ordersData.size()) + " orders");
    }
  } else {
    Serial.println("Failed to open orders.json - creating empty array");
    ordersData.clear();
    ordersData.to<JsonArray>();
  }
}

void addNewProduct(String code, String name) {
  JsonArray arr = productsData.as<JsonArray>();
  
  // KIỂM TRA DUPLICATE TRƯỚC KHI THÊM
  for (JsonObject product : arr) {
    String existingCode = product["code"];
    String existingName = product["name"];
    if (existingCode == code || (existingCode == code && existingName == name)) {
      Serial.println("Product already exists: " + code + " - " + name + " (skipped)");
      return; // Không thêm nếu đã tồn tại
    }
  }
  
  // Tìm ID lớn nhất
  int maxId = 0;
  for (JsonObject product : arr) {
    int id = product["id"];
    if (id > maxId) maxId = id;
  }
  
  // Thêm sản phẩm mới
  JsonObject newProduct = arr.createNestedObject();
  newProduct["id"] = maxId + 1;
  newProduct["code"] = code;
  newProduct["name"] = name;
  
  saveProductsToFile();
  Serial.println("Added new product: " + code + " - " + name + " (ID: " + String(maxId + 1) + ")");
}

void deleteProduct(int productId) {
  JsonArray arr = productsData.as<JsonArray>();
  
  for (size_t i = 0; i < arr.size(); i++) {
    if (arr[i]["id"] == productId) {
      arr.remove(i);
      saveProductsToFile();
      Serial.println("Deleted product ID: " + String(productId));
      return;
    }
  }
  Serial.println("Product ID not found: " + String(productId));
}

void addNewOrder(String productCode, String customerName, int quantity, String notes) {
  JsonArray arr = ordersData.as<JsonArray>();
  
  // Tìm ID lớn nhất
  int maxId = 0;
  for (JsonObject order : arr) {
    int id = order["id"];
    if (id > maxId) maxId = id;
  }
  
  // Thêm đơn hàng mới
  JsonObject newOrder = arr.createNestedObject();
  newOrder["id"] = maxId + 1;
  newOrder["productCode"] = productCode;
  newOrder["customerName"] = customerName;
  newOrder["quantity"] = quantity;
  newOrder["notes"] = notes;
  newOrder["status"] = "pending";
  newOrder["createdDate"] = getTimeStr();
  newOrder["completedCount"] = 0;
  
  saveOrdersToFile();
  Serial.println("Added new order: " + productCode + " x" + String(quantity) + " for " + customerName);
}

void deleteOrder(int orderId) {
  JsonArray arr = ordersData.as<JsonArray>();
  
  for (size_t i = 0; i < arr.size(); i++) {
    if (arr[i]["id"] == orderId) {
      arr.remove(i);
      saveOrdersToFile();
      Serial.println("Deleted order ID: " + String(orderId));
      return;
    }
  }
  Serial.println("Order ID not found: " + String(orderId));
}

void printDataStatus() {
  Serial.println("=====================================");
  Serial.println("DATA STORAGE STATUS:");
  Serial.println("=====================================");
  
  // Kiểm tra files tồn tại
  Serial.println("Files on LittleFS:");
  Serial.println("  - /settings.json: " + String(LittleFS.exists("/settings.json") ? "✅ EXISTS" : "❌ MISSING"));
  Serial.println("  - /products.json: " + String(LittleFS.exists("/products.json") ? "✅ EXISTS" : "❌ MISSING"));
  Serial.println("  - /orders.json: " + String(LittleFS.exists("/orders.json") ? "✅ EXISTS" : "❌ MISSING"));
  Serial.println("  - /bag_types.json: " + String(LittleFS.exists("/bag_types.json") ? "✅ EXISTS" : "❌ MISSING"));
  Serial.println("  - /bag_configs.json: " + String(LittleFS.exists("/bag_configs.json") ? "✅ EXISTS" : "❌ MISSING"));
  
  // Hiển thị dữ liệu trong memory
  Serial.println("Data in Memory:");
  Serial.println("  - Products: " + String(productsData.size()) + " items");
  Serial.println("  - Orders: " + String(ordersData.size()) + " items");
  Serial.println("  - Bag Types: " + String(bagTypes.size()) + " items");
  Serial.println("  - Bag Configs: " + String(bagConfigs.size()) + " items");
  
  // Hiển thị chi tiết products
  if (productsData.size() > 0) {
    Serial.println("Products Details:");
    JsonArray arr = productsData.as<JsonArray>();
    for (JsonObject product : arr) {
      Serial.println("    ID:" + String(product["id"].as<int>()) + 
                     " Code:" + product["code"].as<String>() + 
                     " Name:" + product["name"].as<String>());
    }
  }
  
  // Hiển thị chi tiết orders
  if (ordersData.size() > 0) {
    Serial.println("Orders Details:");
    JsonArray arr = ordersData.as<JsonArray>();
    for (JsonObject order : arr) {
      Serial.println("    ID:" + String(order["id"].as<int>()) + 
                     " Product:" + order["productCode"].as<String>() + 
                     " Customer:" + order["customerName"].as<String>() +
                     " Qty:" + String(order["quantity"].as<int>()));
    }
  }
  
  Serial.println("=====================================");
}

//----------------------------------------Network Setup Functions
void loadWiFiConfig() {
  // Set default values first
  wifi_static_ip = IPAddress(192, 168, 1, 201);  // Default static IP
  wifi_gateway = IPAddress(192, 168, 1, 1);      // Default gateway
  wifi_subnet = IPAddress(255, 255, 255, 0);     // Default subnet
  wifi_dns1 = IPAddress(8, 8, 8, 8);             // Google DNS
  wifi_dns2 = IPAddress(8, 8, 4, 4);             // Google DNS backup
  
  if (LittleFS.exists("/wifi_config.json")) {
    File file = LittleFS.open("/wifi_config.json", "r");
    if (file) {
      String content = file.readString();
      file.close();
      
      DynamicJsonDocument doc(1024);
      if (deserializeJson(doc, content) == DeserializationError::Ok) {
        wifi_ssid = doc["ssid"].as<String>();
        wifi_password = doc["password"].as<String>();
        wifi_use_static_ip = doc["use_static_ip"] | false;
        
        if (wifi_use_static_ip) {
          String ip_str = doc["static_ip"].as<String>();
          String gateway_str = doc["gateway"].as<String>();
          String subnet_str = doc["subnet"].as<String>();
          String dns1_str = doc["dns1"].as<String>();
          String dns2_str = doc["dns2"].as<String>();
          
          // Only override defaults if valid values are provided
          if (ip_str.length() > 0) wifi_static_ip.fromString(ip_str);
          if (gateway_str.length() > 0) wifi_gateway.fromString(gateway_str);
          if (subnet_str.length() > 0) wifi_subnet.fromString(subnet_str);
          if (dns1_str.length() > 0) wifi_dns1.fromString(dns1_str);
          if (dns2_str.length() > 0) wifi_dns2.fromString(dns2_str);
        }
        
        Serial.println("WiFi config loaded: " + wifi_ssid);
        if (wifi_use_static_ip) {
          Serial.println("Static IP: " + wifi_static_ip.toString());
          Serial.println("Gateway: " + wifi_gateway.toString());
          Serial.println("Subnet: " + wifi_subnet.toString());
        }
      }
    }
  } else {
    Serial.println("No WiFi config found, using defaults");
  }
}

void saveWiFiConfig(String ssid, String password, bool useStaticIP = false, 
                   String staticIP = "", String gateway = "", String subnet = "",
                   String dns1 = "", String dns2 = "") {
  DynamicJsonDocument doc(1024);
  doc["ssid"] = ssid;
  doc["password"] = password;
  doc["use_static_ip"] = useStaticIP;
  
  if (useStaticIP) {
    doc["static_ip"] = staticIP;
    doc["gateway"] = gateway;
    doc["subnet"] = subnet;
    doc["dns1"] = dns1;
    doc["dns2"] = dns2;
  }
  
  File file = LittleFS.open("/wifi_config.json", "w");
  if (file) {
    serializeJson(doc, file);
    file.close();
    Serial.println("WiFi config saved");
  }
}

bool setupEthernet() {
  Serial.println("Trying Ethernet connection...");
  
  try {
    // To be called before ETH.begin()
    ESP32_W5500_onEvent();
    
    // Initialize W5500 with static IP
    ETH.begin(MISO_GPIO, MOSI_GPIO, SCK_GPIO, CS_GPIO, INT_GPIO, SPI_CLOCK_MHZ, ETH_SPI_HOST, mac);
    ETH.config(local_IP, gateway, subnet, primaryDNS, secondaryDNS);
    
    // Wait for connection with timeout
    unsigned long startTime = millis();
    while (!ESP32_W5500_isConnected() && millis() - startTime < 10000) {
      delay(100);
    }
    
    if (ESP32_W5500_isConnected()) {
      ethernetConnected = true;
      currentNetworkMode = ETHERNET_MODE;
      Serial.println("Ethernet connected!");
      Serial.print("IP: ");
      Serial.println(ETH.localIP());
      return true;
    }
  } catch (...) {
    Serial.println("Ethernet initialization failed");
  }
  
  ethernetConnected = false;
  return false;
}

bool setupWiFiSTA() {
  if (wifi_ssid.length() == 0) {
    Serial.println("❌ No WiFi credentials found");
    return false;
  }
  
  Serial.println("Trying WiFi connection to: " + wifi_ssid);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);  // Tự động kết nối lại
  WiFi.persistent(true);        // Lưu cấu hình WiFi
  
  // Configure static IP if enabled
  if (wifi_use_static_ip) {
    Serial.println("Using static IP: " + wifi_static_ip.toString());
    if (!WiFi.config(wifi_static_ip, wifi_gateway, wifi_subnet, wifi_dns1, wifi_dns2)) {
      Serial.println("Failed to configure static IP");
      return false;
    }
  }
  
  WiFi.begin(wifi_ssid.c_str(), wifi_password.c_str());
  
  Serial.print("Connecting");
  unsigned long startTime = millis();
  int dotCount = 0;
  
  // Tối ưu thời gian chờ và feedback
  while (WiFi.status() != WL_CONNECTED && millis() - startTime < 10000) { // Giảm từ 15s xuống 10s
    delay(300); // Giảm từ 500ms xuống 300ms
    Serial.print(".");
    dotCount++;
    
    // Hiển thị tiến trình mỗi 10 dots
    if (dotCount % 10 == 0) {
      Serial.print(" (" + String((millis() - startTime)/1000) + "s)");
    }
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    wifiConnected = true;
    currentNetworkMode = WIFI_STA_MODE;
    Serial.println();
    Serial.println(" WiFi connected successfully!");
    Serial.println(" Network Information:");
    Serial.println("   IP Address: " + WiFi.localIP().toString());
    Serial.println("   Gateway: " + WiFi.gatewayIP().toString());
    Serial.println("   Subnet: " + WiFi.subnetMask().toString());
    Serial.println("   DNS: " + WiFi.dnsIP().toString());
    Serial.println("   Signal: " + String(WiFi.RSSI()) + " dBm");
    
    // Hiển thị URL truy cập web interface
    Serial.println(" Web Interface URLs:");
    Serial.println("   Main: http://" + WiFi.localIP().toString() + "/");
    Serial.println("   Test: http://" + WiFi.localIP().toString() + "/test");
    
    return true;
  }
  
  Serial.println();
  Serial.println(" WiFi connection failed after 10 seconds");
  wifiConnected = false;
  return false;
}

void setupWiFiAP() {
  Serial.println("Starting WiFi Access Point mode...");
  WiFi.mode(WIFI_AP);
  WiFi.softAP(ap_ssid, ap_password);
  
  IPAddress apIP = WiFi.softAPIP();
  currentNetworkMode = WIFI_AP_MODE;
  
  Serial.println("Access Point started!");
  Serial.print("AP SSID: ");
  Serial.println(ap_ssid);
  Serial.print("AP Password: ");
  Serial.println(ap_password);
  Serial.print("AP IP: ");
  Serial.println(apIP);
}

void setupNetwork() {
  loadWiFiConfig();
  
  // Try Ethernet first
  if (setupEthernet()) {
    Serial.println("Using Ethernet connection");
    return;
  }
  
  // Try WiFi STA if Ethernet fails
  if (setupWiFiSTA()) {
    Serial.println("Using WiFi STA connection");
    return;
  }
  
  // Fallback to AP mode
  setupWiFiAP();
  Serial.println("Using WiFi AP mode for configuration");
}

void setupMQTT() {
  // Thử broker chính trước
  const char* current_broker = mqtt_use_backup ? mqtt_server_backup : mqtt_server;
  
  mqtt.setServer(current_broker, mqtt_port);
  mqtt.setCallback(onMqttMessage);
  mqtt.setBufferSize(512);
  mqtt.setKeepAlive(30); // Tăng keep alive để ổn định hơn
  
  // Tạo client ID unique
  String clientId = "ESP32_BagCounter_" + String(WiFi.macAddress());
  clientId.replace(":", "");
  
  Serial.print("🔌 Connecting to MQTT broker: ");
  Serial.println(current_broker);
  
  // Thử kết nối với timeout ngắn hơn
  if (mqtt.connect(clientId.c_str())) {
    Serial.println("MQTT connected successfully!");
    Serial.println("Client ID: " + clientId);
    
    // Subscribe các topic
    mqtt.subscribe(TOPIC_CMD_START);
    mqtt.subscribe(TOPIC_CMD_PAUSE);
    mqtt.subscribe(TOPIC_CMD_RESET);
    mqtt.subscribe(TOPIC_CMD_SELECT);
    mqtt.subscribe(TOPIC_CMD_BATCH);
    mqtt.subscribe(TOPIC_CONFIG);
    
    publishHeartbeat();
    
    // Gửi test message để notify web ESP32 sẵn sàng nhận IR commands
    DynamicJsonDocument testDoc(256);
    testDoc["source"] = "SYSTEM";
    testDoc["action"] = "MQTT_READY";
    testDoc["status"] = "ESP32_ONLINE";
    testDoc["timestamp"] = millis();
    String testMsg;
    serializeJson(testDoc, testMsg);
    mqtt.publish(TOPIC_IR_CMD, testMsg.c_str(), true);
    
  } else {
    int errorCode = mqtt.state();
    Serial.print("MQTT connection failed, rc=");
    Serial.println(errorCode);
    
    // Giải thích lỗi cụ thể
    switch(errorCode) {
      case -4: Serial.println("Lỗi: Timeout kết nối"); break;
      case -3: Serial.println("Lỗi: Mất kết nối"); break;
      case -2: Serial.println("Lỗi: Broker từ chối kết nối"); break;
      case -1: Serial.println("Lỗi: Protocol version sai"); break;
      case 1: Serial.println("Lỗi: Protocol version không được hỗ trợ"); break;
      case 2: Serial.println("Lỗi: Client ID bị từ chối"); break;
      case 3: Serial.println("Lỗi: Server không khả dụng"); break;
      case 4: Serial.println("Lỗi: Username/password sai"); break;
      case 5: Serial.println("Lỗi: Không được ủy quyền"); break;
      default: Serial.println("Lỗi: Không xác định"); break;
    }
    
    // Thử broker backup nếu broker chính thất bại
    if (!mqtt_use_backup && errorCode == -2) {
      Serial.println("Thử backup broker: " + String(mqtt_server_backup));
      mqtt_use_backup = true;
      delay(1000);
      setupMQTT(); // Gọi đệ quy với backup broker
      return;
    }
    
    Serial.println("Will retry in main loop...");
  }
}

void setupTime() {
  Serial.println("Configuring NTP time...");
  configTime(7 * 3600, 0, "pool.ntp.org", "time.nist.gov");
  
  // Đợi đồng bộ thời gian
  Serial.print("Waiting for NTP time sync: ");
  time_t now = time(nullptr);
  int timeout = 30; // 30 giây timeout
  while (now < 24 * 3600 && timeout > 0) {
    delay(1000);
    Serial.print(".");
    now = time(nullptr);
    timeout--;
  }
  Serial.println();
  
  if (now > 24 * 3600) {
    Serial.println("NTP time synchronized successfully!");
    Serial.print("Current time: ");
    Serial.println(getTimeStr());
  } else {
    Serial.println("Failed to sync NTP time - using system time");
  }
}

String getTimeStr() {
  time_t now = time(nullptr);
  
  // Kiểm tra xem thời gian đã được đồng bộ chưa
  if (now < 24 * 3600) {
    return "Syncing...";
  }
  
  struct tm* t = localtime(&now);
  char buf[32];
  strftime(buf, sizeof(buf), "%H:%M - %d/%m/%Y", t);
  return String(buf);
}

//----------------------------------------MQTT Callback & Publish Functions
void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  // Convert payload to string
  String message = "";
  for (int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  
  String topicStr = String(topic);
  Serial.println("MQTT Message received:");
  Serial.println("  Topic: " + topicStr);
  Serial.println("  Message: " + message);
  
  // Xử lý các lệnh điều khiển
  if (topicStr == TOPIC_CMD_START) {
    // Kiểm tra source để tránh xử lý lại lệnh từ chính mình
    DynamicJsonDocument sourceDoc(256);
    if (deserializeJson(sourceDoc, message) == DeserializationError::Ok) {
  String source = sourceDoc["source"].as<String>();
      if (source == "IR_REMOTE") {
        Serial.println("Ignoring START command from own IR remote");
        return;
      }
    }
    Serial.println("MQTT Command: START from Web");
    handleWebCommand(1); // Start command from web
    
  } else if (topicStr == TOPIC_CMD_PAUSE) {
    // Kiểm tra source để tránh xử lý lại lệnh từ chính mình
    DynamicJsonDocument sourceDoc(256);
    if (deserializeJson(sourceDoc, message) == DeserializationError::Ok) {
  String source = sourceDoc["source"].as<String>();
      if (source == "IR_REMOTE") {
        Serial.println("Ignoring PAUSE command from own IR remote");
        return;
      }
    }
    Serial.println("MQTT Command: PAUSE from Web");
    handleWebCommand(2); // Pause command from web
    
  } else if (topicStr == TOPIC_CMD_RESET) {
    // Kiểm tra source để tránh xử lý lại lệnh từ chính mình
    DynamicJsonDocument sourceDoc(256);
    if (deserializeJson(sourceDoc, message) == DeserializationError::Ok) {
  String source = sourceDoc["source"].as<String>();
      if (source == "IR_REMOTE") {
        Serial.println("Ignoring RESET command from own IR remote");
        return;
      }
    }
    Serial.println("MQTT Command: RESET from Web");
    handleWebCommand(3); // Reset command from web
    
  } else if (topicStr == TOPIC_CMD_SELECT) {
    Serial.println("MQTT Command: SELECT ORDER");
    // Parse JSON để chọn đơn hàng
    DynamicJsonDocument doc(256);
    if (deserializeJson(doc, message) == DeserializationError::Ok) {
  String orderType = doc["type"].as<String>();
      int target = doc["target"] | 20;
      int warn = doc["warn"] | 10;
      
      if (orderType.length() > 0) {
        bagType = orderType;
        targetCount = target;
        
        // Reset trạng thái cho đơn hàng mới
        totalCount = 0;
        isRunning = false;
        isTriggerEnabled = false;
        isCountingEnabled = false;
        isLimitReached = false;
        
        // Cập nhật bagConfig
        bool found = false;
        for (auto& cfg : bagConfigs) {
          if (cfg.type == orderType) {
            cfg.target = target;
            cfg.warn = warn;
            cfg.status = "SELECTED";
            found = true;
            break;
          }
        }
        
        if (!found) {
          BagConfig newCfg = {orderType, target, warn, "SELECTED"};
          bagConfigs.push_back(newCfg);
        }
        
        saveBagConfigsToFile();
        needUpdate = true;
        
        // Publish confirmation
        publishStatusMQTT();
        
        Serial.println("Order selected via MQTT: " + orderType);
      }
    }
    
  } else if (topicStr == TOPIC_CONFIG) {
    Serial.println("MQTT Command: CONFIG UPDATE");
    // Parse JSON config update - ÁP DỤNG SETTINGS TỪNG BỘ PHẬN
    DynamicJsonDocument doc(512);
    if (deserializeJson(doc, message) == DeserializationError::Ok) {
      bool settingsChanged = false;
      
      if (doc.containsKey("brightness")) {
        displayBrightness = doc["brightness"];
        if (displayBrightness >= 10 && displayBrightness <= 100) {
          dma_display->setBrightness8(map(displayBrightness, 0, 100, 0, 255));
          Serial.println("MQTT: Applied brightness: " + String(displayBrightness) + "%");
          settingsChanged = true;
        }
      }
      
      if (doc.containsKey("sensorDelay")) {
        sensorDelayMs = doc["sensorDelay"];
        debounceDelay = sensorDelayMs;
        Serial.println("MQTT: Applied sensorDelay: " + String(sensorDelayMs) + "ms");
        settingsChanged = true;
      }
      
      if (doc.containsKey("bagDetectionDelay")) {
        ::bagDetectionDelay = doc["bagDetectionDelay"];
        Serial.println("MQTT: Applied bagDetectionDelay: " + String(::bagDetectionDelay) + "ms");
        settingsChanged = true;
      }
      
      if (doc.containsKey("minBagInterval")) {
        ::minBagInterval = doc["minBagInterval"];
        Serial.println("MQTT: Applied minBagInterval: " + String(::minBagInterval) + "ms");
        settingsChanged = true;
      }
      
      if (doc.containsKey("autoReset")) {
        ::autoReset = doc["autoReset"];
        Serial.println("MQTT: Applied autoReset: " + String(::autoReset ? "true" : "false"));
        settingsChanged = true;
      }
      
      if (doc.containsKey("relayDelayAfterComplete")) {
        ::relayDelayAfterComplete = doc["relayDelayAfterComplete"];
        Serial.println("MQTT: Applied relayDelayAfterComplete: " + String(::relayDelayAfterComplete) + "ms");
        settingsChanged = true;
      }
      
      if (doc.containsKey("conveyorName")) {
        conveyorName = doc["conveyorName"].as<String>();
        Serial.println("MQTT: Applied conveyorName: " + conveyorName);
        settingsChanged = true;
      }
      
      if (doc.containsKey("location")) {
        location = doc["location"].as<String>();
        Serial.println("MQTT: Applied location: " + location);
        settingsChanged = true;
      }
      
      // Lưu settings vào file nếu có thay đổi
      if (settingsChanged) {
        DynamicJsonDocument settingsDoc(1024);
        settingsDoc["conveyorName"] = conveyorName;
        settingsDoc["location"] = location;
        settingsDoc["brightness"] = displayBrightness;
        settingsDoc["sensorDelay"] = sensorDelayMs;
        settingsDoc["bagDetectionDelay"] = ::bagDetectionDelay;
        settingsDoc["minBagInterval"] = ::minBagInterval;
        settingsDoc["autoReset"] = ::autoReset;
        settingsDoc["relayDelayAfterComplete"] = ::relayDelayAfterComplete;
        
        File file = LittleFS.open("/settings.json", "w");
        if (file) {
          serializeJson(settingsDoc, file);
          file.close();
          Serial.println("MQTT: Settings saved to file");
        }
      }
      
      // Legacy targets
      if (doc.containsKey("target")) {
        targetCount = doc["target"];
        Serial.println("Target updated via MQTT: " + String(targetCount));
        needUpdate = true;
      }
      
      // Thêm xử lý resetLimit để ESP32 tiếp tục đếm
      if (doc.containsKey("resetLimit") && doc["resetLimit"]) {
        isLimitReached = false;
        Serial.println("Limit reset via MQTT - continuing count");
        needUpdate = true;
      }
    }
    
  } else if (topicStr == TOPIC_CMD_BATCH) {
    Serial.println("MQTT Command: BATCH INFO");
    // Parse JSON batch information
    DynamicJsonDocument doc(1024);
    if (deserializeJson(doc, message) == DeserializationError::Ok) {
      if (doc.containsKey("firstOrder")) {
        JsonObject firstOrder = doc["firstOrder"];
        if (firstOrder.containsKey("productName")) {
          bagType = firstOrder["productName"].as<String>();
          Serial.println("MQTT: Set first order product: " + bagType);
        }
        if (firstOrder.containsKey("customerName")) {
          String customerName = firstOrder["customerName"].as<String>();
          Serial.println("MQTT: Customer: " + customerName);
        }
        // Cập nhật target từ firstOrder (đơn hàng hiện tại) chứ không phải totalTarget
        if (firstOrder.containsKey("quantity")) {
          targetCount = firstOrder["quantity"] | 20;
          Serial.println("MQTT: Set current order target: " + String(targetCount));
        }
      }
      
      needUpdate = true;
    }
  }
}

void publishStatusMQTT() {
  static unsigned long lastPublish = 0;
  
  // Debounce - chỉ publish mỗi 500ms để tránh spam
  if (millis() - lastPublish < 500) {
    return;
  }
  lastPublish = millis();
  
  if (currentNetworkMode == WIFI_AP_MODE || !mqtt.connected()) {
    if (currentNetworkMode == WIFI_AP_MODE) {
      // Không log lỗi khi ở AP mode - đây là bình thường
      return;
    } else {
      Serial.println("MQTT not connected - cannot publish status");
      return;
    }
  }
  
  DynamicJsonDocument doc(512);
  doc["deviceId"] = conveyorName;   
  doc["status"] = currentSystemStatus; 
  doc["count"] = totalCount;
  doc["target"] = targetCount;
  doc["type"] = bagType;
  doc["startTime"] = startTimeStr;
  doc["timestamp"] = getTimeStr();
  doc["uptime"] = millis() / 1000;
  doc["isWarning"] = false;
  doc["limitReached"] = isLimitReached;
  doc["sensorEnabled"] = isCountingEnabled;
  doc["triggerEnabled"] = isTriggerEnabled;
  
  // Kiểm tra cảnh báo
  for (auto& cfg : bagConfigs) {
    if (cfg.type == bagType) {
      int warningThreshold = cfg.target - cfg.warn;
      doc["isWarning"] = (totalCount >= warningThreshold);
      doc["warningThreshold"] = warningThreshold;
      break;
    }
  }
  
  String message;
  serializeJson(doc, message);
  
  //Serial.print("Publishing status MQTT (");
  //Serial.print(message.length());
  //Serial.print(" bytes): ");
  //Serial.println(message);
  
  bool published = mqtt.publish(TOPIC_STATUS, message.c_str());
  if (published) {
    //Serial.println("Status published to MQTT");
  } else {
    Serial.print("Failed to publish status to MQTT. State: ");
    Serial.println(mqtt.state());
  }
  
  // KẾT THÚC NETWORK ACTIVITY - cho phép LED Matrix hoạt động trở lại
}

void publishCountUpdate() {
  Serial.println("DEBUG publishCountUpdate: starting...");
  
  if (currentNetworkMode == WIFI_AP_MODE) {
    Serial.println("DEBUG publishCountUpdate: skipped - AP mode");
    return;
  }
  
  if (!mqtt.connected()) {
    Serial.println("DEBUG publishCountUpdate: skipped - MQTT not connected");
    return;
  }
  
  // Throttle count updates để tránh spam MQTT
  unsigned long now = millis();
  if (now - lastCountPublish < COUNT_PUBLISH_THROTTLE) {
    Serial.println("DEBUG publishCountUpdate: skipped - throttled");
    return;
  }
  lastCountPublish = now;
  
  Serial.println("DEBUG publishCountUpdate: preparing message...");
  
  DynamicJsonDocument doc(256);
  doc["deviceId"] = conveyorName;  // ✅ SỬA: Sử dụng biến conveyorName thay vì chuỗi
  doc["count"] = totalCount;
  doc["target"] = targetCount;
  doc["type"] = bagType;
  doc["productCode"] = productCode; // Thêm productCode để web dễ match
  doc["timestamp"] = getTimeStr();
  doc["progress"] = (float)totalCount / targetCount * 100;
  
  String message;
  serializeJson(doc, message);
  
  Serial.println("DEBUG publishCountUpdate: message = " + message);
  
  bool published = mqtt.publish(TOPIC_COUNT, message.c_str());
  if (published) {
    Serial.println("Count update published: " + String(totalCount) + "/" + String(targetCount));
  } else {
    Serial.println("Count update publish FAILED!");
  }
}

void publishAlert(String alertType, String message) {
  if (currentNetworkMode == WIFI_AP_MODE || !mqtt.connected()) return;
  
  DynamicJsonDocument doc(256);
  doc["deviceId"] = conveyorName;
  doc["alertType"] = alertType; // "WARNING", "COMPLETED", "ERROR"
  doc["message"] = message;
  doc["count"] = totalCount;
  doc["target"] = targetCount;
  doc["type"] = bagType;
  doc["timestamp"] = getTimeStr();
  
  String alertMessage;
  serializeJson(doc, alertMessage);
  
  mqtt.publish(TOPIC_ALERTS, alertMessage.c_str());
  Serial.println("Alert published: " + alertType + " - " + message);
}

void publishSensorData() {
  if (currentNetworkMode == WIFI_AP_MODE || !mqtt.connected()) return;
  
  DynamicJsonDocument doc(256);
  doc["deviceId"] = conveyorName;
  doc["sensorTriggered"] = isCountingEnabled;
  doc["triggerEnabled"] = isTriggerEnabled;
  doc["lastTrigger"] = millis();
  doc["sensorState"] = digitalRead(SENSOR_PIN) == LOW ? "DETECTED" : "CLEAR";
  doc["triggerState"] = digitalRead(TRIGGER_SENSOR_PIN) == LOW ? "DETECTED" : "CLEAR";
  doc["timestamp"] = getTimeStr();
  
  String message;
  serializeJson(doc, message);
  
  mqtt.publish(TOPIC_SENSOR, message.c_str());
}

void publishHeartbeat() {
  if (currentNetworkMode == WIFI_AP_MODE || !mqtt.connected()) return;
  
  DynamicJsonDocument doc(256);
  doc["deviceId"] = conveyorName;
  doc["status"] = "ONLINE";
  doc["uptime"] = millis() / 1000;
  doc["freeHeap"] = ESP.getFreeHeap();
  doc["wifiRSSI"] = WiFi.RSSI();
  doc["ipAddress"] = currentNetworkMode == ETHERNET_MODE ? ETH.localIP().toString() : WiFi.localIP().toString();
  doc["timestamp"] = getTimeStr();
  
  String message;
  serializeJson(doc, message);
  
  mqtt.publish(TOPIC_HEARTBEAT, message.c_str());
//   Serial.println("Heartbeat published");
  
}

void publishBagConfigs() {
  if (currentNetworkMode == WIFI_AP_MODE || !mqtt.connected()) return;
  
  DynamicJsonDocument doc(2048);
  JsonArray orders = doc.createNestedArray("orders");
  
  for (auto& cfg : bagConfigs) {
    JsonObject order = orders.createNestedObject();
    order["type"] = cfg.type;
    order["target"] = cfg.target;
    order["status"] = cfg.status;
    order["warn"] = cfg.warn;
    
    // Tìm thông tin chi tiết từ ordersData
    JsonArray ordersArray = ordersData.as<JsonArray>();
    for (size_t i = 0; i < ordersArray.size(); i++) {
      JsonObject orderData = ordersArray[i];
      if (orderData["id"].as<String>() == cfg.type) {
        order["productName"] = orderData["productName"];
        order["productCode"] = orderData["productCode"];
        order["quantity"] = orderData["quantity"];
        order["executeCount"] = orderData["executeCount"];
        break;
      }
    }
  }
  
  doc["currentOrder"] = bagType;
  doc["currentCount"] = totalCount;
  doc["timestamp"] = getTimeStr();
  
  String message;
  serializeJson(doc, message);
  
  mqtt.publish("bagcounter/orders", message.c_str());
  Serial.println("Orders configuration published to web");
}

//----------------------------------------Web server API
void setupWebServer() {
  // Auto-redirect handler khi ở chế độ WiFi STA
  server.on("/", HTTP_GET, [](){
    // Nếu đang ở chế độ WiFi STA và được truy cập qua AP IP, redirect đến STA IP
    if (currentNetworkMode == WIFI_STA_MODE && server.client().localIP() == WiFi.softAPIP()) {
      String redirectUrl = "http://" + WiFi.localIP().toString() + "/";
      server.sendHeader("Location", redirectUrl);
      server.send(302, "text/plain", "Redirecting to: " + redirectUrl);
      Serial.println("Redirected from AP IP to STA IP: " + redirectUrl);
      return;
    }
    
    if (LittleFS.exists("/index.html")) {
      File file = LittleFS.open("/index.html", "r");
      server.streamFile(file, "text/html");
      file.close();
      Serial.println("Served index.html from LittleFS");
    } else {
      // Backup simple HTML với thông tin IP hiện tại
      String currentIP = (currentNetworkMode == WIFI_STA_MODE) ? WiFi.localIP().toString() : WiFi.softAPIP().toString();
      String networkMode = (currentNetworkMode == WIFI_STA_MODE) ? "WiFi STA" : 
                          (currentNetworkMode == ETHERNET_MODE) ? "Ethernet" : "WiFi AP";
      
      String html = "<!DOCTYPE html><html><head><title>Bag Counter</title>";
      html += "<meta http-equiv='refresh' content='5'></head><body>"; // Auto refresh mỗi 5s
      html += "<h1>🎒 Bag Counter System</h1>";
      html += "<div style='background: #f0f0f0; padding: 10px; margin: 10px 0;'>";
      html += "<p><strong>📍 Current IP:</strong> " + currentIP + "</p>";
      html += "<p><strong>🌐 Network Mode:</strong> " + networkMode + "</p>";
      html += "<p><strong>⚡ System Status:</strong> <span style='color: green'>Connected</span></p>";
      html += "</div>";
      html += "<p>🔧 Web interface is working!</p>";
      if (currentNetworkMode == WIFI_STA_MODE) {
        html += "<p>✅ <a href='http://" + WiFi.localIP().toString() + "/test'>Test Page</a></p>";
      }
      html += "</body></html>";
      server.send(200, "text/html", html);
      Serial.println("Served backup HTML (index.html not found)");
    }
  });

  // Serve CSS files
  server.on("/style.css", HTTP_GET, [](){
    if (LittleFS.exists("/style.css")) {
      File file = LittleFS.open("/style.css", "r");
      server.streamFile(file, "text/css");
      file.close();
    } else {
      server.send(404, "text/plain", "CSS not found");
    }
  });

  // Serve JS files
  server.on("/script.js", HTTP_GET, [](){
    if (LittleFS.exists("/script.js")) {
      File file = LittleFS.open("/script.js", "r");
      server.streamFile(file, "application/javascript");
      file.close();
    } else {
      server.send(404, "text/plain", "JS not found");
    }
  });

  // Serve test customer API page
  server.on("/test-customer-api", HTTP_GET, [](){
    if (LittleFS.exists("/test_customer_api.html")) {
      File file = LittleFS.open("/test_customer_api.html", "r");
      server.streamFile(file, "text/html");
      file.close();
      Serial.println("Served test_customer_api.html from LittleFS");
    } else {
      server.send(404, "text/plain", "Test customer API page not found");
    }
  });
  
  // API trạng thái hiện tại - Real-time polling
  server.on("/api/status", HTTP_GET, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.sendHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    
    DynamicJsonDocument doc(512);
    
    // TRẢ VỀ STATUS ĐÚNG THEO TRẠNG THÁI THỰC TẾ CỦA HỆ THỐNG
    String currentStatus = "WAIT";  // Default
    
    // Nếu đang chạy thì trả về RUNNING
    if (isRunning) {
      currentStatus = "RUNNING";
    } else {
      // Kiểm tra status từ bagConfigs - lấy status đầu tiên khác WAIT
      for (auto& cfg : bagConfigs) {
        if (cfg.status != "WAIT") {
          currentStatus = cfg.status;  // PAUSE, RESET, DONE
          break;
        }
      }
      
      // Fallback: kiểm tra bagType hiện tại
      if (currentStatus == "WAIT") {
        for (auto& cfg : bagConfigs) {
          if (cfg.type == bagType) {
            currentStatus = cfg.status;
            break;
          }
        }
      }
    }
    
    // // Serial.print("API Status returning: ");
    // Serial.print(currentStatus);
    // Serial.print(" (isRunning: ");
    // Serial.print(isRunning);
    // Serial.print(", bagType: ");
    // Serial.print(bagType);
    // Serial.println(")");
    
    doc["status"] = currentStatus;  // Trả về đúng format cho web
    doc["count"] = totalCount;
    doc["startTime"] = startTimeStr;
    doc["currentType"] = bagType;
    doc["target"] = targetCount;
    doc["isWarning"] = false;
    doc["timestamp"] = millis();
    doc["sensorEnabled"] = isCountingEnabled;
    doc["triggerEnabled"] = isTriggerEnabled;
    doc["limitReached"] = isLimitReached;
    doc["currentTime"] = getTimeStr();
    
    // Extended info (merged from extended_status)
    doc["conveyorId"] = conveyorName;
    doc["ipAddress"] = currentNetworkMode == ETHERNET_MODE ? ETH.localIP().toString() : WiFi.localIP().toString();
    doc["uptime"] = millis() / 1000;
    doc["freeHeap"] = ESP.getFreeHeap();
    doc["mqttConnected"] = mqtt.connected();
    
    // LED states
    doc["startLedOn"] = startLedOn;
    doc["doneLedOn"] = doneLedOn;
    
    // Thêm tên băng tải từ settings
    if (LittleFS.exists("/settings.json")) {
      File file = LittleFS.open("/settings.json", "r");
      if (file) {
        String content = file.readString();
        file.close();
        DynamicJsonDocument settingsDoc(1024);
        if (deserializeJson(settingsDoc, content) == DeserializationError::Ok) {
          if (settingsDoc.containsKey("conveyorName")) {
            doc["conveyorName"] = settingsDoc["conveyorName"].as<String>();
          }
        }
      }
    }
    
    // Thêm trạng thái bagConfig hiện tại để web sync được
    for (auto& cfg : bagConfigs) {
      if (cfg.type == bagType) {
        doc["bagConfigStatus"] = cfg.status;  // WAIT, RUNNING, DONE
        int warningThreshold = cfg.target - cfg.warn;
        doc["isWarning"] = (totalCount >= warningThreshold);
        doc["warningThreshold"] = warningThreshold;
        break;
      }
    }
    
    // THONG TIN IR COMMAND CHO WEB
    doc["lastIRCommand"] = lastIRCommand;
    doc["lastIRTimestamp"] = lastIRTimestamp;
    doc["hasNewIRCommand"] = hasNewIRCommand;
    
    // THÔNG TIN BATCH HIỆN TẠI
    doc["currentBatchName"] = currentBatchName;
    doc["currentBatchId"] = currentBatchId;
    doc["currentBatchDescription"] = currentBatchDescription;
    doc["totalOrdersInBatch"] = totalOrdersInBatch;
    doc["batchTotalTarget"] = batchTotalTarget;  // Thêm tổng target của batch
    
    // Reset flag sau khi gửi cho web
    if (hasNewIRCommand) {
      hasNewIRCommand = false;
      Serial.println("IR Command flag reset after sending to web");
    }
    
    String out;
    serializeJson(doc, out);
    server.send(200, "application/json", out);
  });

  // API kiểm tra thay đổi từ IR Remote - DEPRECATED: Thay bằng MQTT
  // server.on("/api/ir_status", HTTP_GET, [](){
  //   // Đã chuyển sang MQTT real-time
  // });

  // API lấy thời gian hiện tại
  server.on("/api/current_time", HTTP_GET, [](){
    DynamicJsonDocument doc(256);
    time_t now = time(nullptr);
    bool isTimeSynced = (now > 24 * 3600);
    
    doc["currentTime"] = getTimeStr();
    doc["timestamp"] = now;
    doc["isTimeSynced"] = isTimeSynced;
    doc["uptimeSeconds"] = millis() / 1000;
    
    if (isTimeSynced) {
      struct tm* t = localtime(&now);
      doc["year"] = t->tm_year + 1900;
      doc["month"] = t->tm_mon + 1;
      doc["day"] = t->tm_mday;
      doc["hour"] = t->tm_hour;
      doc["minute"] = t->tm_min;
      doc["second"] = t->tm_sec;
    }
    
    String out;
    serializeJson(doc, out);
    server.send(200, "application/json", out);
  });
  
  // API GET orders - Trả về orders data (KHÔNG phải bagConfigs)
  server.on("/api/orders", HTTP_GET, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    
    // Serial.println("GET /api/orders called");
    // Serial.println("ordersData size: " + String(ordersData.size()) + " items");
    
    // Trả về orders data từ LittleFS
    String out;
    serializeJson(ordersData, out);
    
    // Serial.println("Sending orders data (size: " + String(out.length()) + " chars)");
    // Commented out to reduce log spam
    // if (out.length() > 0 && out.length() < 300) {
    //   Serial.println("Orders content: " + out);
    // } else if (out.length() >= 300) {
    //   Serial.println("Orders content preview: " + out.substring(0, 200) + "...");
    // } else {
    //   Serial.println("Orders content: EMPTY");
    // }
    
    server.send(200, "application/json", out);
  });
  
  // API bagConfigs - Trả về bag configurations (khác với orders)
  server.on("/api/bagconfigs", HTTP_GET, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    
    DynamicJsonDocument doc(2048);
    JsonArray arr = doc.to<JsonArray>();
    for (auto& cfg : bagConfigs) {
      JsonObject o = arr.createNestedObject();
      o["type"] = cfg.type;
      o["target"] = cfg.target;
      o["warn"] = cfg.warn;
      o["status"] = cfg.status;
      o["isCurrent"] = (cfg.type == bagType);
      o["count"] = (cfg.type == bagType) ? totalCount : 0;
    }
    String out;
    serializeJson(doc, out);
    server.send(200, "application/json", out);
  });

  // API quản lý đơn hàng (khác với bagConfigs)
  server.on("/api/order-list", HTTP_GET, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    
    // Trả về danh sách đơn hàng từ LittleFS
    String out;
    serializeJson(ordersData, out);
    server.send(200, "application/json", out);
    
    Serial.println("Order-list API called - returned " + String(ordersData.size()) + " orders");
  });

  server.on("/api/order-list", HTTP_POST, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    
    if (server.hasArg("plain")) {
      DynamicJsonDocument doc(512);
      deserializeJson(doc, server.arg("plain"));
      
  String productCode = doc["productCode"].as<String>();
  String customerName = doc["customerName"].as<String>(); 
      int quantity = doc["quantity"];
      String notes = doc["notes"] | "";
      
      if (productCode.length() > 0 && customerName.length() > 0 && quantity > 0) {
        addNewOrder(productCode, customerName, quantity, notes);
        server.send(200, "application/json", "{\"status\":\"OK\",\"message\":\"Order added successfully\"}");
      } else {
        server.send(400, "application/json", "{\"status\":\"Error\",\"message\":\"Product code, customer name and quantity are required\"}");
      }
    } else {
      server.send(400, "application/json", "{\"status\":\"Error\",\"message\":\"No data provided\"}");
    }
  });

  server.on("/api/order-list", HTTP_DELETE, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    
    if (server.hasArg("id")) {
      String orderIdStr = server.arg("id");
      int orderId = orderIdStr.toInt();
      
      if (orderId > 0) {
        deleteOrder(orderId);
        server.send(200, "application/json", "{\"status\":\"OK\",\"message\":\"Order deleted successfully\"}");
      } else {
        server.send(400, "application/json", "{\"status\":\"Error\",\"message\":\"Invalid order ID\"}");
      }
    } else {
      server.send(400, "application/json", "{\"status\":\"Error\",\"message\":\"Missing order ID\"}");
    }
  });

  // API lịch sử đếm - đọc từ file
  server.on("/api/history", HTTP_GET, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    
    if (LittleFS.exists("/history.json")) {
      File file = LittleFS.open("/history.json", "r");
      if (file) {
        String content = file.readString();
        file.close();
        server.send(200, "application/json", content);
        Serial.println("History API called - returned data from file");
      } else {
        server.send(200, "application/json", "[]");
        Serial.println("History API called - file exists but cannot read");
      }
    } else {
      server.send(200, "application/json", "[]");
      Serial.println("History API called - no history file found");
    }
  });

  // API điều khiển cơ bản
  server.on("/api/cmd", HTTP_POST, [](){
    if (server.hasArg("plain")) {
      DynamicJsonDocument doc(256);
      deserializeJson(doc, server.arg("plain"));
      String cmd = doc["cmd"];
      
      Serial.println("Received API command: " + cmd);
      
      // DEBUG: Print full command payload for troubleshooting
      if (cmd == "UPDATE_ORDER" || cmd == "DELETE_ORDER") {
        Serial.println("DEBUG: Full command payload:");
        String debugPayload;
        serializeJson(doc, debugPayload);
        Serial.println(debugPayload);
      }
      
      if (cmd == "start") {
        Serial.println("Web Start command - delegating to handleWebCommand()");
        handleWebCommand(1); // Gọi chung logic với IR command
      } else if (cmd == "pause") {
        Serial.println("Web Pause command - delegating to handleWebCommand()");  
        handleWebCommand(2); // Gọi chung logic với IR command
      } else if (cmd == "reset") {
        Serial.println("Web Reset command - delegating to handleWebCommand()");
        handleWebCommand(3); // Gọi chung logic với IR command
      } else if (cmd == "reset_count_only") {
        Serial.println("Reset count only command received");
        // CHỈ RESET COUNT, KHÔNG THAY ĐỔI TRẠNG THÁI KHÁC
        totalCount = 0;
        isLimitReached = false;
        history.clear();
        
        // CLEAR RELAY DELAY STATE (khi reset count)
        isOrderComplete = false;
        isRelayDelayActive = false;
        orderCompleteTime = 0;
        Serial.println("RELAY DELAY STATE CLEARED (count reset)");
        
        // CLEAR WARNING THRESHOLD STATE (khi reset count)
        isWarningLedActive = false;
        hasReachedWarningThreshold = false;
        warningLedStartTime = 0;
        Serial.println("⚠️ WARNING LED STATE CLEARED (count reset)");
        
        // GIỮ NGUYÊN TRẠNG THÁI isRunning, isTriggerEnabled
        // CHỈ CẬP NHẬT COUNT DISPLAY
        updateDoneLED();
        needUpdate = true;
        
        Serial.println("Count reset to 0, keeping current running state");
      } else if (cmd == "set_current_order") {
        // Cập nhật thông tin đơn hàng hiện tại để hiển thị trên LED
  String productName = doc["productName"].as<String>();
  String customerName = doc["customerName"].as<String>();
  String orderCode = doc["orderCode"].as<String>();
        String productCodeFromWeb = doc["productCode"].as<String>();  // Nhận mã sản phẩm từ web
        int target = doc["target"] | 20;
        int warningQuantity = doc["warningQuantity"] | 5;
        bool keepCount = doc["keepCount"] | false;
        bool isRunningOrder = doc["isRunning"] | false;
        
        Serial.println("Setting current order:");
        Serial.println("Product: " + productName);
        Serial.println("Product Code: " + productCodeFromWeb);
        Serial.println("Customer: " + customerName);
        Serial.println("Order Code: " + orderCode);
        Serial.println("Target: " + String(target));
        Serial.println("Warning: " + String(warningQuantity));
        Serial.println("Keep Count: " + String(keepCount));
        Serial.println("Is Running: " + String(isRunningOrder));
        
        // Cập nhật biến hiển thị
        bagType = productName;
        productCode = productCodeFromWeb;  // Cập nhật mã sản phẩm
        orderCode = doc["orderCode"].as<String>();      // Cập nhật biến global
        customerName = doc["customerName"].as<String>(); // Cập nhật biến global
        Serial.println("Updated global orderCode: " + orderCode);
        Serial.println("Updated global customerName: " + customerName);
        targetCount = target; 
        
        // KHÔNG RESET COUNT NẾU keepCount = true (cho multi-order)
        if (!keepCount) {
          totalCount = 0;
          isLimitReached = false;
        }
        
        // ĐẶT TRẠNG THÁI RUNNING NẾU isRunning = true
        if (isRunningOrder) {
          isRunning = true;
          isTriggerEnabled = true;
          Serial.println("Set running state to RUNNING");
        }
        
        // Tìm và cập nhật bagConfig
        bool found = false;
        for (auto& cfg : bagConfigs) {
          if (cfg.type == productName) {
            cfg.target = target;
            cfg.warn = warningQuantity;
            if (isRunningOrder) {
              cfg.status = "RUNNING";
            }
            found = true;
            break;
          }
        }
        
        // Tạo mới nếu không tìm thấy
        if (!found) {
          BagConfig newCfg;
          newCfg.type = productName;
          newCfg.target = target;
          newCfg.warn = warningQuantity;
          newCfg.status = isRunningOrder ? "RUNNING" : "WAIT";
          bagConfigs.push_back(newCfg);
        }
        
        saveBagConfigsToFile();
        needUpdate = true;
        
        Serial.println("Current order updated successfully");
      } else if (cmd == "set_mode") {
        // XỬ LÝ THAY ĐỔI CHẾ ĐỘ HIỂN THỊ
        String mode = doc["mode"].as<String>();
        
        if (mode == "output" || mode == "input") {
          currentMode = mode;
          needUpdate = true;
          updateDisplay();
          
          Serial.println("Mode changed to: " + mode);
          Serial.println("Display updated with new mode");
        } else {
          Serial.println("Invalid mode: " + mode);
          server.send(400, "application/json", "{\"status\":\"Error\",\"message\":\"Invalid mode. Use 'output' or 'input'\"}");
          return;
        }
      } else if (cmd == "next_order") {
        // XỬ LÝ CHUYỂN SANG ĐƠN HÀNG TIẾP TH--EO
        Serial.println("Next order command received");
        
  String productName = doc["productName"].as<String>();
  String customerName = doc["customerName"].as<String>();
  String orderCode = doc["orderCode"].as<String>();
        String productCodeFromWeb = doc["productCode"].as<String>();  // Nhận mã sản phẩm từ web
        int target = doc["target"] | 20;
        int warningQuantity = doc["warningQuantity"] | 5;
        bool keepCount = doc["keepCount"] | false;
        
        Serial.println("Switching to next order:");
        Serial.println("Product: " + productName);
        Serial.println("Product Code: " + productCodeFromWeb);
        Serial.println("Customer: " + customerName);
        Serial.println("Order Code: " + orderCode);
        Serial.println("Target: " + String(target));
        Serial.println("Keep Count: " + String(keepCount));
        
        // CẬP NHẬT THÔNG TIN ĐƠN HÀNG MỚI
        bagType = productName;
        productCode = productCodeFromWeb;  // Cập nhật mã sản phẩm
        orderCode = doc["orderCode"].as<String>();      // Cập nhật biến global
        customerName = doc["customerName"].as<String>(); // Cập nhật biến global
        Serial.println("Updated global orderCode: " + orderCode);
        Serial.println("Updated global customerName: " + customerName);
        targetCount = target;
        
        // KHÔNG RESET COUNT NẾU keepCount = true (để tiếp tục đếm multi-order)
        if (!keepCount) {
          totalCount = 0;
          isLimitReached = false;
        }
        
        // ĐẢM BẢO TRẠNG THÁI VẪN ĐANG CHẠY
        isRunning = true;
        isTriggerEnabled = true;
        // isCountingEnabled sẽ được set khi cảm biến kích hoạt
        
        // TÌM VÀ CẬP NHẬT BAGCONFIG
        bool found = false;
        for (auto& cfg : bagConfigs) {
          if (cfg.type == productName) {
            cfg.target = target;
            cfg.warn = warningQuantity;
            cfg.status = "RUNNING";  // ĐẢM BẢO TRẠNG THÁI RUNNING
            found = true;
            Serial.println("Updated existing bagConfig to RUNNING");
            break;
          }
        }
        
        // TẠO MỚI NẾU KHÔNG TÌM THẤY
        if (!found) {
          BagConfig newCfg;
          newCfg.type = productName;
          newCfg.target = target;
          newCfg.warn = warningQuantity;
          newCfg.status = "RUNNING";
          bagConfigs.push_back(newCfg);
          Serial.println("Created new bagConfig with RUNNING status");
        }
        

        // Để đảm bảo /api/status trả về đúng
        for (auto& cfg : bagConfigs) {
          if (cfg.type == bagType) {  // bagType hiện tại đang active
            cfg.status = "RUNNING";
            Serial.println("Updated current bagType status to RUNNING");
            break;
          }
        }
        
        saveBagConfigsToFile();
        updateStartLED();
        needUpdate = true;
        
        Serial.println("Next order setup completed - Status: RUNNING");
      } else if (cmd == "select") {
        String type = doc["type"];
        int target = doc["target"] | 20;
        int warn = doc["warn"] | 10;
        orderCode = doc["orderCode"].as<String>();  // Cập nhật biến global
        Serial.println("Updated global orderCode: " + orderCode);
        
        // Cập nhật hoặc tạo mới bagConfig cho đơn hàng này
        bool found = false;
        for (auto& cfg : bagConfigs) {
          if (cfg.type == type || (orderCode.length() > 0 && cfg.type.indexOf(orderCode) >= 0)) {
            bagType = cfg.type;
            targetCount = target > 0 ? target : cfg.target;
            found = true;
            
            // Reset trạng thái cho đơn hàng mới
            isRunning = false;
            isTriggerEnabled = false;
            isCountingEnabled = false;
            isLimitReached = false;
            totalCount = 0;
            finishedBlinking = false;
            blinkCount = 0;
            isBlinking = false;
            startTimeStr = "";
            timeWaitingForSync = false;
            updateStartLED();
            updateDoneLED();
            
            // Cập nhật trạng thái
            cfg.status = "RUNNING";
            break;
          }
        }
        
        if (!found && type.length() > 0) {
          // Tạo mới nếu không tìm thấy
          BagConfig newCfg;
          newCfg.type = type;
          newCfg.target = target;
          newCfg.warn = warn;
          newCfg.status = "RUNNING";
          bagConfigs.push_back(newCfg);
          
          bagType = type;
          targetCount = target;
          
          // Reset trạng thái
          isRunning = false;
          isTriggerEnabled = false;
          isCountingEnabled = false;
          isLimitReached = false;
          totalCount = 0;
          finishedBlinking = false;
          blinkCount = 0;
          isBlinking = false;
          startTimeStr = "";
          timeWaitingForSync = false;
          updateStartLED();
          updateDoneLED();
        }
        
        // Đánh dấu các loại khác là WAIT hoặc giữ nguyên DONE
        for (auto& c : bagConfigs) {
          if (c.type != bagType && c.status != "DONE") {
            c.status = "WAIT";
          }
        }
        
        saveBagConfigsToFile();
        needUpdate = true;
        
        Serial.println("Order selected: " + bagType);
        Serial.println("Target: " + String(targetCount));
        Serial.println("Warning: " + String(warn));
      } else if (cmd == "REMOTE") {
        String button = doc["button"];
        Serial.println("Remote command received: " + button);
        
        // Xử lý các lệnh remote với function handleIRCommand
        if (button == "START") {
          handleIRCommand(1);  // Nút 1 - Start
        } else if (button == "STOP") {
          handleIRCommand(2);  // Nút 2 - Pause  
        } else if (button == "RESET") {
          handleIRCommand(3);  // Nút 3 - Reset
        }
      } else if (cmd == "set_product") {
        // LỆNH ĐƠN GIẢN ĐỂ SET SẢN PHẨM HIỆN TẠI
        String productName = doc["productName"];
        int target = doc["target"] | 0;
        
        if (productName.length() > 0) {
          Serial.println("Setting current product: " + productName);
          Serial.println("Target: " + String(target));
          
          bagType = productName;
          if (target > 0) {
            targetCount = target;
          }
          
          needUpdate = true;  // Force update display
          updateDisplay();    // Update ngay
          
          Serial.println("Product set - bagType: " + bagType + ", targetCount: " + String(targetCount));
        }
      } else if (cmd == "batch_info") {
        // XỬ LÝ THÔNG TIN BATCH TỪ WEB
        if (doc.containsKey("batchTotalTarget")) {
          batchTotalTarget = doc["batchTotalTarget"].as<int>();
          Serial.println("Batch Total Target set to: " + String(batchTotalTarget));
        }
        
        if (doc.containsKey("firstOrder")) {
          JsonObject firstOrder = doc["firstOrder"];
          String productName = firstOrder["productName"];
          int target = firstOrder["quantity"] | 0;
          
          if (productName.length() > 0) {
            Serial.println("Setting product from batch info: " + productName);
            bagType = productName;
            if (target > 0) {
              targetCount = target; // Hiển thị số lượng của đơn hàng hiện tại (không phải tổng batch)
            }
            needUpdate = true;
            updateDisplay();
            Serial.println("Batch product set - bagType: " + bagType + ", targetCount: " + String(targetCount));
          }
        }
      } else if (cmd == "ping") {
        // LỆNH PING ĐỂ TEST CONNECTIVITY
        Serial.println("Ping command received from web");
        server.send(200, "text/plain", "PONG - ESP32 is alive!");
        return;
      } else if (cmd == "test") {
        // LỆNH TEST ĐỂ DEBUG COMMUNICATION
        Serial.println("Test command received from web");
        Serial.println("Current state:");
        Serial.println("   isRunning: " + String(isRunning));
        Serial.println("   isTriggerEnabled: " + String(isTriggerEnabled));
        Serial.println("   isCountingEnabled: " + String(isCountingEnabled));
        Serial.println("   totalCount: " + String(totalCount));
        Serial.println("   MQTT connected: " + String(mqtt.connected()));
        server.send(200, "text/plain", "TEST OK - Check Serial Monitor for details");
        return;
      } else if (cmd == "clear_batch") {
        // XỬ LÝ LỆNH XÓA BATCH
        Serial.println("=== CLEAR BATCH COMMAND RECEIVED ===");
        Serial.println("Command payload:");
        String debugPayload;
        serializeJson(doc, debugPayload);
        Serial.println(debugPayload);
        
        int batchId = doc["batchId"] | 0;
        Serial.println("Extracted batch ID: " + String(batchId));
        
        if (batchId > 0) {
          Serial.println("Processing clear batch for ID: " + String(batchId));
          Serial.println("Current ordersData size: " + String(ordersData.size()));
          
          // Debug: Log all existing batch IDs
          Serial.println("Existing batch IDs in ordersData:");
          for (size_t i = 0; i < ordersData.size(); i++) {
            int existingId = ordersData[i]["id"] | 0;
            String existingName = ordersData[i]["name"] | "Unknown";
            Serial.println("   Batch " + String(i) + ": ID=" + String(existingId) + ", Name=" + existingName);
          }
          
          // Tìm và xóa batch từ ordersData
          bool found = false;
          for (size_t i = 0; i < ordersData.size(); i++) {
            int currentBatchId = ordersData[i]["id"] | 0;
            if (currentBatchId == batchId) {
              String batchName = ordersData[i]["name"] | "Unknown";
              ordersData.remove(i);
              found = true;
              Serial.println("✅ BATCH FOUND AND REMOVED:");
              Serial.println("   - Batch ID: " + String(batchId));
              Serial.println("   - Batch Name: " + batchName);
              Serial.println("   - Removed from index: " + String(i));
              break;
            }
          }
          
          if (found) {
            // Lưu thay đổi vào file
            saveOrdersToFile();
            Serial.println("✅ Orders file updated after batch deletion");
            
            // Reset trạng thái nếu batch đang active
            if (currentBatchId == String(batchId)) {
              currentBatchId = "";
              batchTotalTarget = 0;
              bagType = "bao";
              targetCount = 20;
              isRunning = false;
              isTriggerEnabled = false;
              isCountingEnabled = false;
              totalCount = 0;
              isLimitReached = false;
              updateStartLED();
              updateDoneLED();
              needUpdate = true;
              Serial.println("✅ ESP32 state reset after clearing active batch");
            }
            
            Serial.println("✅ Batch cleared successfully from ESP32");
            server.send(200, "application/json", "{\"status\":\"OK\",\"message\":\"Batch cleared successfully\",\"batchId\":" + String(batchId) + "}");
          } else {
            Serial.println("❌ BATCH NOT FOUND:");
            Serial.println("   - Requested batch ID: " + String(batchId));
            Serial.println("   - Available batches: " + String(ordersData.size()));
            server.send(404, "application/json", "{\"status\":\"Error\",\"message\":\"Batch not found\",\"batchId\":" + String(batchId) + "}");
          }
        } else {
          Serial.println("❌ Invalid batch ID for clear operation: " + String(batchId));
          server.send(400, "application/json", "{\"status\":\"Error\",\"message\":\"Invalid batch ID\",\"received\":" + String(batchId) + "}");
        }
      } else if (cmd == "UPDATE_ORDER") {
        // XỬ LÝ CẬP NHẬT ORDER
        Serial.println("Processing UPDATE_ORDER command...");
        if (doc.containsKey("batchId") && doc.containsKey("orderId") && doc.containsKey("orderData")) {
          int batchId = doc["batchId"];
          int orderId = doc["orderId"];
          JsonObject orderData = doc["orderData"];
          
          Serial.println("Updating order - Batch ID: " + String(batchId) + ", Order ID: " + String(orderId));
          
          // Tìm batch trong ordersData
          bool batchFound = false;
          for (size_t i = 0; i < ordersData.size(); i++) {
            if (ordersData[i]["id"] == batchId) {
              JsonArray orders = ordersData[i]["orders"];
              
              // Tìm order trong batch
              bool orderFound = false;
              for (size_t j = 0; j < orders.size(); j++) {
                if (orders[j]["id"] == orderId) {
                  // Cập nhật order data
                  orders[j]["productCode"] = orderData["productCode"];
                  orders[j]["productName"] = orderData["productName"];
                  orders[j]["quantity"] = orderData["quantity"];
                  orders[j]["bagType"] = orderData["bagType"];
                  
                  orderFound = true;
                  Serial.println("Order updated successfully");
                  break;
                }
              }
              
              if (!orderFound) {
                Serial.println("Order not found in batch");
                server.send(404, "application/json", "{\"status\":\"Error\",\"message\":\"Order not found\"}");
                return;
              }
              
              batchFound = true;
              break;
            }
          }
          
          if (!batchFound) {
            Serial.println("Batch not found");
            server.send(404, "application/json", "{\"status\":\"Error\",\"message\":\"Batch not found\"}");
            return;
          }
          
          // Lưu thay đổi vào file
          saveOrdersToFile();
          Serial.println("Order update saved to file");
          
        } else {
          Serial.println("Missing required parameters for UPDATE_ORDER");
          server.send(400, "application/json", "{\"status\":\"Error\",\"message\":\"Missing batchId, orderId or orderData\"}");
          return;
        }
      } else if (cmd == "DELETE_ORDER") {
        // XỬ LÝ XÓA ORDER
        Serial.println("Processing DELETE_ORDER command...");
        if (doc.containsKey("batchId") && doc.containsKey("orderId")) {
          int batchId = doc["batchId"];
          int orderId = doc["orderId"];
          
          Serial.println("Deleting order - Batch ID: " + String(batchId) + ", Order ID: " + String(orderId));
          
          // Tìm batch trong ordersData
          bool batchFound = false;
          for (size_t i = 0; i < ordersData.size(); i++) {
            Serial.println("   - Checking batch with ID: " + String(ordersData[i]["id"].as<int>()));
            if (ordersData[i]["id"] == batchId) {
              JsonArray orders = ordersData[i]["orders"];
              
              // Tìm và xóa order trong batch
              bool orderFound = false;
              for (size_t j = 0; j < orders.size(); j++) {
                Serial.println("     - Checking order with ID: " + String(orders[j]["id"].as<int>()));
                if (orders[j]["id"] == orderId) {
                  orders.remove(j);
                  orderFound = true;
                  Serial.println("Order deleted successfully");
                  break;
                }
              }
              
              if (!orderFound) {
                Serial.println("Order not found in batch");
                server.send(404, "application/json", "{\"status\":\"Error\",\"message\":\"Order not found\"}");
                return;
              }
              
              batchFound = true;
              break;
            }
          }
          
          if (!batchFound) {
            Serial.println("Batch not found");
            server.send(404, "application/json", "{\"status\":\"Error\",\"message\":\"Batch not found\"}");
            return;
          }
          
          // Lưu thay đổi vào file
          saveOrdersToFile();
          Serial.println("Order deletion saved to file");
          
        } else {
          Serial.println("Missing required parameters for DELETE_ORDER");
          server.send(400, "application/json", "{\"status\":\"Error\",\"message\":\"Missing batchId or orderId\"}");
          return;
        }
      }
    }
    server.send(200, "text/plain", "OK");
  });

  // API xóa loại bao
  server.on("/api/bagtype", HTTP_DELETE, [](){
    if (server.hasArg("type")) {
      String typeToDelete = server.arg("type");
      // Xóa khỏi danh sách loại
      bagTypes.erase(
        std::remove_if(bagTypes.begin(), bagTypes.end(),
          [&typeToDelete](const String& type) { return type == typeToDelete; }),
        bagTypes.end()
      );
      // Xóa khỏi cấu hình
      bagConfigs.erase(
        std::remove_if(bagConfigs.begin(), bagConfigs.end(),
          [&typeToDelete](const BagConfig& cfg) { return cfg.type == typeToDelete; }),
        bagConfigs.end()
      );
      // Lưu thay đổi
      saveBagTypesToFile();
      saveBagConfigsToFile();
      server.send(200, "text/plain", "OK");
    } else {
      server.send(400, "text/plain", "Missing type parameter");
    }
  });

  // API cập nhật cấu hình
  server.on("/api/config", HTTP_POST, [](){
    if (server.hasArg("plain")) {
      DynamicJsonDocument doc(256);
      deserializeJson(doc, server.arg("plain"));
      String type = doc["type"];
      int target = doc["target"];
      int warn = doc["warn"];
      
      // Cập nhật cấu hình
      bool found = false;
      for (auto& cfg : bagConfigs) {
        if (cfg.type == type) {
          cfg.target = target;
          cfg.warn = warn;
          found = true;
          break;
        }
      }
      
      // Nếu chưa có cấu hình cho loại này, tạo mới
      if (!found) {
        BagConfig newCfg;
        newCfg.type = type;
        newCfg.target = target;
        newCfg.warn = warn;
        newCfg.status = "WAIT";
        bagConfigs.push_back(newCfg);
      }
      
      // Lưu thay đổi
      saveBagConfigsToFile();
    }
    server.send(200, "text/plain", "OK");
  });

  // API lấy danh sách loại bao
  server.on("/api/bagtype", HTTP_GET, [](){
    DynamicJsonDocument doc(512);
    JsonArray arr = doc.to<JsonArray>();
    for (auto& type : bagTypes) arr.add(type);
    String out;
    serializeJson(doc, out);
    server.send(200, "application/json", out);
  });

  // API thêm loại bao mới
  server.on("/api/bagtype", HTTP_POST, [](){
    if (server.hasArg("plain")) {
      DynamicJsonDocument doc(256);
      deserializeJson(doc, server.arg("plain"));
      String type = doc["type"];
      
      // Kiểm tra và thêm loại mới
      if (type.length() > 0 && std::find(bagTypes.begin(), bagTypes.end(), type) == bagTypes.end()) {
        bagTypes.push_back(type);
        saveBagTypesToFile();
        needUpdate = true;
      }
    }
    server.send(200, "text/plain", "OK");
  });

  // API cho sản phẩm - Trả về dữ liệu từ LittleFS
  server.on("/api/products", HTTP_GET, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    
    // Trả về dữ liệu sản phẩm từ LittleFS
    String out;
    serializeJson(productsData, out);
    server.send(200, "application/json", out);
    
    Serial.println("Products API called - returned " + String(productsData.size()) + " products");
  });

  // server.on("/api/products", HTTP_POST, [](){
  //   server.sendHeader("Access-Control-Allow-Origin", "*");
  //   
  //   if (server.hasArg("plain")) {
  //     DynamicJsonDocument doc(256);
  //     deserializeJson(doc, server.arg("plain"));
  //     String code = doc["code"];
  //     String name = doc["name"];
  //     
  //     Serial.println("Add Product Request: code='" + code + "', name='" + name + "'");
  //     
  //     if (code.length() > 0 && name.length() > 0) {
  //       int sizeBefore = productsData.size();
  //       
  //       // Thêm sản phẩm mới vào LittleFS
  //       addNewProduct(code, name);
  //       
  //       int sizeAfter = productsData.size();
  //       
  //       DynamicJsonDocument response(256);
  //       response["status"] = "OK";
  //       
  //       if (sizeAfter > sizeBefore) {
  //         response["message"] = "Product added successfully";
  //         response["added"] = true;
  //       } else {
  //         response["message"] = "Product already exists (not added)";
  //         response["added"] = false;
  //       }
  //       
  //       response["total_products"] = sizeAfter;
  //       
  //       String out;
  //       serializeJson(response, out);
  //       server.send(200, "application/json", out);
  //       
  //     } else {
  //       server.send(400, "application/json", "{\"status\":\"Error\",\"message\":\"Code and name are required\"}");
  //     }
  //   } else {
  //     server.send(400, "application/json", "{\"status\":\"Error\",\"message\":\"No data provided\"}");
  //   }
  // });

  server.on("/api/products", HTTP_DELETE, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    
    if (server.hasArg("id")) {
      String productIdStr = server.arg("id");
      int productId = productIdStr.toInt();
      
      if (productId > 0) {
        deleteProduct(productId);
        server.send(200, "application/json", "{\"status\":\"OK\",\"message\":\"Product deleted successfully\"}");
      } else {
        server.send(400, "application/json", "{\"status\":\"Error\",\"message\":\"Invalid product ID\"}");
      }
    } else {
      server.send(400, "application/json", "{\"status\":\"Error\",\"message\":\"Missing product ID\"}");
    }
  });

  // API xóa đơn hàng
  server.on("/api/orders", HTTP_DELETE, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    
    if (server.hasArg("orderCode")) {
      String orderCode = server.arg("orderCode");
      
      // Tìm và xóa khỏi bagConfigs
      bagConfigs.erase(
        std::remove_if(bagConfigs.begin(), bagConfigs.end(),
          [&orderCode](const BagConfig& cfg) { 
            return cfg.type.indexOf(orderCode) >= 0; 
          }),
        bagConfigs.end()
      );
      
      // Lưu thay đổi
      saveBagConfigsToFile();
      
      Serial.println("Order deleted: " + orderCode);
      server.send(200, "application/json", "{\"status\":\"OK\",\"message\":\"Order deleted from ESP32\"}");
    } else {
      server.send(400, "application/json", "{\"status\":\"Error\",\"message\":\"Missing order code\"}");
    }
  });

  // API cho đơn hàng
  server.on("/api/new_orders", HTTP_GET, [](){
    // Trả về danh sách đơn hàng
    DynamicJsonDocument doc(4096);
    JsonArray arr = doc.to<JsonArray>();
    
    // Tạm thời trả về dữ liệu mẫu
    JsonObject order1 = arr.createNestedObject();
    order1["id"] = 1;
    order1["orderNumber"] = 1;
    order1["customerName"] = "Công ty ABC";
    order1["orderCode"] = "DH001";
    order1["vehicleNumber"] = "51A-12345";
    order1["productName"] = "Gạo thường";
    order1["quantity"] = 100;
    order1["currentCount"] = 0;
    order1["status"] = "waiting";
    order1["selected"] = false;
    
    String out;
    serializeJson(doc, out);
    server.send(200, "application/json", out);
  });

  server.on("/api/new_orders", HTTP_POST, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    
    // Check memory before processing
    size_t freeHeap = ESP.getFreeHeap();
    Serial.println("Free heap before new_orders processing: " + String(freeHeap) + " bytes");
    
    if (freeHeap < 5000) {  // Giảm threshold từ 10000 xuống 5000 bytes
      Serial.println("Very low memory detected, rejecting request");
      server.send(507, "application/json", "{\"status\":\"Error\",\"message\":\"Insufficient memory\"}");
      return;
    }
    
    if (server.hasArg("plain")) {
      String jsonData = server.arg("plain");
      Serial.println("Received data size: " + String(jsonData.length()) + " bytes");
      
      // Use smaller JSON document
      DynamicJsonDocument doc(256);  // Reduced from 512
      DeserializationError error = deserializeJson(doc, jsonData);
      
      if (error) {
        Serial.println("JSON Parse Error: " + String(error.c_str()));
        server.send(400, "application/json", "{\"status\":\"Error\",\"message\":\"Invalid JSON\"}");
        return;
      }
      
      customerName = doc["customerName"].as<String>();  // Cập nhật biến global
      orderCode = doc["orderCode"].as<String>();        // Cập nhật biến global
      Serial.println("Updated global customerName: " + customerName);
      Serial.println("Updated global orderCode: " + orderCode);
      String vehicleNumber = doc["vehicleNumber"];
      String productName = doc["productName"];
      int quantity = doc["quantity"];
      int warningQuantity = doc["warningQuantity"];
      
      // DEBUG: Log received data
      Serial.println("DEBUG: Received new order data:");
      Serial.println("  Customer: " + customerName);
      Serial.println("  OrderCode: " + orderCode);
      Serial.println("  Vehicle: " + vehicleNumber);
      Serial.println("  Product: " + productName);
      Serial.println("  Quantity: " + String(quantity));
      Serial.println("  WarningQuantity: " + String(warningQuantity));
      Serial.println("  WarningQuantity (raw): " + doc["warningQuantity"].as<String>());
      
      // Feed watchdog to prevent timeout
      yield();
      
      // Tạo BagConfig mới từ đơn hàng - LUÔN LUÔN TẠO MỚI để cho phép nhiều đơn hàng cùng sản phẩm
      BagConfig newConfig;
      // Sử dụng productCode thay vì orderCode để đảm bảo unique cho từng đơn hàng
      productCode = doc["product"]["code"].as<String>();  // Cập nhật biến global
      if (productCode.length() == 0) {
        productCode = String(millis()); // Fallback nếu không có productCode
      }
      Serial.println("Updated global productCode: " + productCode);
      newConfig.type = productName + "_" + productCode; // Sử dụng productCode để unique
      newConfig.target = quantity;
      newConfig.warn = warningQuantity;
      newConfig.status = "WAIT";
      
      Serial.println("Created bagConfig with type: " + newConfig.type + " (productCode: " + productCode + ")");
      
      // LUÔN LUÔN THÊM MỚI - không kiểm tra trùng lặp để cho phép nhiều đơn hàng
      bagConfigs.push_back(newConfig);
      Serial.println("Added new bag config: " + newConfig.type + " (Total configs: " + String(bagConfigs.size()) + ")");
      
      // Feed watchdog again
      yield();
      
      // Thêm vào bagTypes nếu chưa có
      if (std::find(bagTypes.begin(), bagTypes.end(), productName) == bagTypes.end()) {
        bagTypes.push_back(productName);
        saveBagTypesToFile();
      }
      
      // Lưu cấu hình
      saveBagConfigsToFile();
      
      // CẬP NHẬT bagType để hiển thị tên sản phẩm mới
      bagType = productName;
      Serial.println("Updated bagType to: " + bagType);
      
      Serial.println("New order saved to ESP32:");
      Serial.println("Customer: " + customerName);
      Serial.println("Order Code: " + orderCode);
      Serial.println("Vehicle: " + vehicleNumber);
      Serial.println("Product: " + productName);
      Serial.println("Quantity: " + String(quantity));
      Serial.println("Warning: " + String(warningQuantity));
      
      // Check memory after processing
      Serial.println("Free heap after processing: " + String(ESP.getFreeHeap()) + " bytes");
      
      server.send(200, "application/json", "{\"status\":\"OK\",\"message\":\"Order saved to ESP32\"}");
    } else {
      server.send(400, "application/json", "{\"status\":\"Error\",\"message\":\"No data provided\"}");
    }
  });

  // API kích hoạt batch - nhận thông tin batch từ web
  server.on("/api/activate_batch", HTTP_POST, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.sendHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
    
    if(server.hasArg("plain")) {
      String body = server.arg("plain");
      Serial.println("Activating batch, received data: " + body);
      
      DynamicJsonDocument doc(1024);
      DeserializationError error = deserializeJson(doc, body);
      
      if (!error) {
        // Lưu thông tin batch
        currentBatchName = doc["batchName"].as<String>();
        currentBatchId = doc["batchId"].as<String>();
        currentBatchDescription = doc["batchDescription"].as<String>();
        totalOrdersInBatch = doc["totalOrders"].as<int>();
        batchTotalTarget = doc["batchTotalTarget"].as<int>();  // Nhận tổng target của batch
        
        Serial.println("Batch activated:");
        Serial.println("Name: " + currentBatchName);
        Serial.println("ID: " + currentBatchId);
        Serial.println("Description: " + currentBatchDescription);
        Serial.println("Total Orders: " + String(totalOrdersInBatch));
        Serial.println("Batch Total Target: " + String(batchTotalTarget));
        
        // LƯU THÔNG TIN BATCH VÀO FILE
        saveBatchInfoToFile();
        
        // In thông báo đã chọn batch
        Serial.println("Batch displayed: " + currentBatchName);
        
        // Gửi response thành công
        DynamicJsonDocument response(512);
        response["status"] = "OK";
        response["message"] = "Batch activated successfully";
        response["batchName"] = currentBatchName;
        response["totalOrders"] = totalOrdersInBatch;
        response["batchTotalTarget"] = batchTotalTarget;  // Thêm vào response
        
        String responseStr;
        serializeJson(response, responseStr);
        server.send(200, "application/json", responseStr);
        
      } else {
        Serial.println("JSON parse error: " + String(error.c_str()));
        server.send(400, "application/json", "{\"status\":\"Error\",\"message\":\"Invalid JSON\"}");
      }
    } else {
      server.send(400, "application/json", "{\"status\":\"Error\",\"message\":\"No data provided\"}");
    }
  });

  // Handle CORS preflight for activate_batch
  server.on("/api/activate_batch", HTTP_OPTIONS, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.sendHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
    server.send(200);
  });

  // API trả về danh sách batch đã lưu - để web load khi reload
  server.on("/api/batches", HTTP_GET, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    
    DynamicJsonDocument doc(2048);
    JsonArray batchArray = doc.to<JsonArray>();
    
    // Nếu có batch hiện tại, thêm vào danh sách
    if (currentBatchName != "") {
      JsonObject batch = batchArray.createNestedObject();
      batch["id"] = currentBatchId;
      batch["name"] = currentBatchName;
      batch["description"] = currentBatchDescription;
      batch["totalOrders"] = totalOrdersInBatch;
      batch["batchTotalTarget"] = batchTotalTarget;  // Thêm tổng target
      batch["isActive"] = true;  // Batch hiện tại luôn là active
      batch["createdAt"] = "ESP32_STORED";
      
      Serial.println("Returning current batch: " + currentBatchName);
    }
    
    String response;
    serializeJson(doc, response);
    server.send(200, "application/json", response);
  });

  // API cài đặt chung - Trả về giá trị hiện tại (từ biến global)
  server.on("/api/settings", HTTP_GET, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    
    DynamicJsonDocument doc(1024);
    
    // Trả về giá trị hiện tại từ biến global (đã được load từ file)
    doc["conveyorName"] = conveyorName;
    doc["location"] = location;
    doc["ipAddress"] = currentNetworkMode == ETHERNET_MODE ? ETH.localIP().toString() : WiFi.localIP().toString();
    doc["gateway"] = gateway.toString();
    doc["subnet"] = subnet.toString();
    doc["sensorDelay"] = sensorDelayMs;
    doc["bagDetectionDelay"] = bagDetectionDelay;
    doc["minBagInterval"] = minBagInterval;
    doc["autoReset"] = autoReset;
    doc["brightness"] = displayBrightness;
    doc["relayDelayAfterComplete"] = relayDelayAfterComplete;
    
    // Add debug info about settings source
    doc["_debug"] = LittleFS.exists("/settings.json") ? "file" : "defaults";
    doc["_settingsFileExists"] = LittleFS.exists("/settings.json");
    
    String out;
    serializeJson(doc, out);
    server.send(200, "application/json", out);
  });

  server.on("/api/settings", HTTP_POST, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    
    if (server.hasArg("plain")) {
      DynamicJsonDocument doc(1024);
      deserializeJson(doc, server.arg("plain"));
      
      Serial.println("Receiving settings from web, applying and saving...");
      
      // ÁP DỤNG SETTINGS NGAY LẬP TỨC VÀO BIẾN GLOBAL
      if (doc.containsKey("onveyorName")) {
        String oldValue = conveyorName;
        conveyorName = doc["conveyorName"].as<String>();
        Serial.println("  conveyorName: '" + oldValue + "' → '" + conveyorName + "'");
      }
      
      if (doc.containsKey("location")) {
        String oldValue = location;
        location = doc["location"].as<String>();
        Serial.println("  location: '" + oldValue + "' → '" + location + "'");
      }
      
      if (doc.containsKey("brightness")) {
        int oldValue = displayBrightness;
        displayBrightness = doc["brightness"];
        if (displayBrightness >= 10 && displayBrightness <= 100) {
          dma_display->setBrightness8(map(displayBrightness, 0, 100, 0, 255));
          Serial.println("  brightness: " + String(oldValue) + "% → " + String(displayBrightness) + "%");
        }
      }
      
      if (doc.containsKey("sensorDelay")) {
        int oldValue = sensorDelayMs;
        sensorDelayMs = doc["sensorDelay"];
        debounceDelay = sensorDelayMs; // Sync debounce delay
        Serial.println("  sensorDelay: " + String(oldValue) + "ms → " + String(sensorDelayMs) + "ms");
      }
      
      if (doc.containsKey("bagDetectionDelay")) {
        int oldValue = ::bagDetectionDelay;
        ::bagDetectionDelay = doc["bagDetectionDelay"]; // Sử dụng :: để chỉ biến global
        Serial.println("  bagDetectionDelay: " + String(oldValue) + "ms → " + String(::bagDetectionDelay) + "ms");
      }
      
      if (doc.containsKey("minBagInterval")) {
        int oldValue = ::minBagInterval;
        ::minBagInterval = doc["minBagInterval"]; // Sử dụng :: để chỉ biến global
        Serial.println("  minBagInterval: " + String(oldValue) + "ms → " + String(::minBagInterval) + "ms");
      }
      
      if (doc.containsKey("autoReset")) {
        bool oldValue = ::autoReset;
        ::autoReset = doc["autoReset"]; // Sử dụng :: để chỉ biến global
        Serial.println("  autoReset: " + String(oldValue ? "true" : "false") + " → " + String(::autoReset ? "true" : "false"));
      }
      
      if (doc.containsKey("relayDelayAfterComplete")) {
        int oldValue = ::relayDelayAfterComplete;
        ::relayDelayAfterComplete = doc["relayDelayAfterComplete"];
        Serial.println("  relayDelayAfterComplete: " + String(oldValue) + "ms → " + String(::relayDelayAfterComplete) + "ms");
      }
      
      // Cấu hình IP tĩnh Ethernet
      String ethIP = doc["ipAddress"];
      String ethGateway = doc["gateway"];
      String ethSubnet = doc["subnet"];
      String ethDNS1 = doc["dns1"];
      String ethDNS2 = doc["dns2"];
      
      // Cập nhật IP tĩnh Ethernet nếu có thay đổi
      bool needRestart = false;
      if (ethIP.length() > 0 && ethGateway.length() > 0 && ethSubnet.length() > 0) {
        IPAddress newIP, newGateway, newSubnet, newDNS1, newDNS2;
        if (newIP.fromString(ethIP) && newGateway.fromString(ethGateway) && newSubnet.fromString(ethSubnet)) {
          // Kiểm tra xem có thay đổi không
          if (local_IP != newIP || gateway != newGateway || subnet != newSubnet) {
            local_IP = newIP;
            gateway = newGateway; 
            subnet = newSubnet;
            needRestart = true;
            
            Serial.println("  Network config changed:");
            Serial.println("    New IP: " + ethIP);
            Serial.println("    New Gateway: " + ethGateway);
            Serial.println("    New Subnet: " + ethSubnet);
          }
          
          if (ethDNS1.length() > 0) newDNS1.fromString(ethDNS1);
          else newDNS1 = IPAddress(8, 8, 8, 8);
          
          if (ethDNS2.length() > 0) newDNS2.fromString(ethDNS2);
          else newDNS2 = IPAddress(8, 8, 4, 4);
          
          primaryDNS = newDNS1;
          secondaryDNS = newDNS2;
        }
      }
      
      // 💾 LƯU TẤT CẢ SETTINGS VÀO FILE
      saveSettingsToFile();
      
      Serial.println("Settings updated and saved permanently:");
      Serial.println("  - Conveyor Name: " + conveyorName);
      Serial.println("  - Location: " + location);
      Serial.println("  - Brightness: " + String(displayBrightness) + "%");
      Serial.println("  - Sensor Delay: " + String(sensorDelayMs) + "ms");
      Serial.println("  - Bag Detection Delay: " + String(::bagDetectionDelay) + "ms");
      Serial.println("  - Min Bag Interval: " + String(::minBagInterval) + "ms");
      Serial.println("  - Auto Reset: " + String(::autoReset ? "true" : "false"));
      Serial.println("  - Relay Delay After Complete: " + String(::relayDelayAfterComplete) + "ms");
      if (ethIP.length() > 0) {
        Serial.println("  - Ethernet IP: " + ethIP);
      }
      
      // Trả về response với thông báo restart nếu cần
      DynamicJsonDocument response(256);
      response["status"] = "OK";
      if (needRestart) {
        response["message"] = "Settings saved. Restart required for IP changes.";
        response["needRestart"] = true;
      } else {
        response["message"] = "Settings saved successfully";
        response["needRestart"] = false;
      }
      
      String out;
      serializeJson(response, out);
      server.send(200, "application/json", out);
    } else {
      server.send(400, "application/json", "{\"status\":\"Error\",\"message\":\"No data provided\"}");
    }
  });

  // Individual setting endpoints - DEPRECATED: Sử dụng MQTT config thay thế
  // server.on("/brightness", HTTP_GET, [](){
  //   // Đã chuyển sang MQTT: bagcounter/config/update {"brightness": 50}
  // });
  
  // server.on("/sensorDelay", HTTP_GET, [](){
  //   // Đã chuyển sang MQTT: bagcounter/config/update {"sensorDelay": 50}
  // });
  
  // server.on("/bagDetectionDelay", HTTP_GET, [](){
  //   // Đã chuyển sang MQTT: bagcounter/config/update {"bagDetectionDelay": 200}
  // });
  
  // server.on("/minBagInterval", HTTP_GET, [](){
  //   // Đã chuyển sang MQTT: bagcounter/config/update {"minBagInterval": 100}
  // });

  // API cập nhật số đếm từ web - DEPRECATED: Chỉ sử dụng MQTT
  // server.on("/api/update_count", HTTP_POST, [](){
  //   // Đã chuyển sang MQTT real-time updates
  // });

  // API lấy trạng thái mở rộng - DEPRECATED: Merge vào /api/status
  // server.on("/api/extended_status", HTTP_GET, [](){
  //   // Đã merge vào /api/status với đầy đủ thông tin
  // });

  // WiFi configuration endpoints
  server.on("/api/wifi/scan", HTTP_GET, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.sendHeader("Cache-Control", "no-cache");
    server.sendHeader("Connection", "close");
    
    Serial.println("WiFi scan requested");
    
    // Ensure WiFi is initialized for scanning
    if (WiFi.getMode() == WIFI_OFF) {
      Serial.println("  Initializing WiFi for scan...");
      WiFi.mode(WIFI_STA);
      delay(100); // Allow WiFi to initialize
    }
    
    Serial.println("  Scanning networks...");
    unsigned long scanStart = millis();
    int n = WiFi.scanNetworks(false, false, false, 200); // Giảm timeout xuống 200ms mỗi channel
    unsigned long scanDuration = millis() - scanStart;
    Serial.println("  ⏱Scan completed in " + String(scanDuration) + "ms");
    
    if (n == -1) {
      Serial.println("  WiFi scan failed");
      String errorResponse = "{\"error\":\"WiFi scan failed\",\"networks\":[]}";
      server.send(500, "application/json", errorResponse);
      return;
    }
    
    if (n == 0) {
      Serial.println("  No networks found");
      String emptyResponse = "{\"networks\":[]}";
      server.send(200, "application/json", emptyResponse);
      return;
    }
    
    Serial.println("  Found " + String(n) + " networks");
    
    // Tạo response từng phần để tránh buffer overflow
    String response = "{\"networks\":[";
    
    int maxNetworks = min(n, 6); // Giảm xuống 6 networks để response nhanh hơn
    for (int i = 0; i < maxNetworks; i++) {
      if (i > 0) response += ",";
      
      String ssid = WiFi.SSID(i);
      // Clean SSID - remove problematic characters
      ssid.replace("\"", "");
      ssid.replace("\\", "");
      ssid.replace("\n", "");
      ssid.replace("\r", "");
      
      // Keep response minimal
      response += "{";
      response += "\"ssid\":\"" + ssid + "\",";
      response += "\"rssi\":" + String(WiFi.RSSI(i)) + ",";
      response += "\"encrypted\":" + String((WiFi.encryptionType(i) != WIFI_AUTH_OPEN) ? "true" : "false");
      response += "}";
      
      Serial.println("    " + ssid + " (" + String(WiFi.RSSI(i)) + " dBm)");
      
      // Check if response is getting too long
      if (response.length() > 600) { // Giảm limit xuống 600 bytes
        Serial.println("  Response getting too long, truncating at " + String(i+1) + " networks");
        break;
      }
    }
    
    response += "]}";
    
    Serial.println("Sending WiFi scan response (length: " + String(response.length()) + ")");
    
    // Send response với immediate flush
    server.sendHeader("Content-Length", String(response.length()));
    server.send(200, "application/json", response);
    server.client().flush(); // Force flush response
    
    // Clean up scan results
    WiFi.scanDelete();
    
    Serial.println("WiFi scan response sent and flushed successfully");
  });

  server.on("/api/wifi/connect", HTTP_POST, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    
    if (server.hasArg("plain")) {
      DynamicJsonDocument doc(512);
      deserializeJson(doc, server.arg("plain"));
      
  String ssid = doc["ssid"].as<String>();
  String password = doc["password"].as<String>();
      bool useStaticIP = doc["use_static_ip"] | false;
      String staticIP = doc["static_ip"];
      String gateway = doc["gateway"];
      String subnet = doc["subnet"];
      String dns1 = doc["dns1"];
      String dns2 = doc["dns2"];
      
      if (ssid.length() > 0) {
        // Save WiFi config first
        saveWiFiConfig(ssid, password, useStaticIP, staticIP, gateway, subnet, dns1, dns2);
        
        // Update global variables
        wifi_ssid = ssid;
        wifi_password = password;
        wifi_use_static_ip = useStaticIP;
        if (useStaticIP && staticIP.length() > 0) {
          wifi_static_ip.fromString(staticIP);
          if (gateway.length() > 0) wifi_gateway.fromString(gateway);
          if (subnet.length() > 0) wifi_subnet.fromString(subnet);
          if (dns1.length() > 0) wifi_dns1.fromString(dns1);
          if (dns2.length() > 0) wifi_dns2.fromString(dns2);
        }
        
        // Send immediate response to avoid timeout
        DynamicJsonDocument response(256);
        response["success"] = true;
        response["message"] = "WiFi config saved. Attempting connection...";
        response["status"] = "connecting";
        
        String out;
        serializeJson(response, out);
        server.send(200, "application/json", out);
        
        // Delay a bit to ensure response is sent
        delay(100);
        
        // Now try to connect in background
        Serial.println("Attempting WiFi connection to: " + ssid);
        
        // Configure WiFi
        WiFi.mode(WIFI_STA);
        
        // Configure static IP if enabled
        if (wifi_use_static_ip) {
          Serial.println("Configuring static IP: " + wifi_static_ip.toString());
          if (!WiFi.config(wifi_static_ip, wifi_gateway, wifi_subnet, wifi_dns1, wifi_dns2)) {
            Serial.println("Failed to configure static IP");
          }
        }
        
        WiFi.begin(ssid.c_str(), password.c_str());
        
        // Check connection in background (non-blocking)
        unsigned long startTime = millis();
        bool connected = false;
        while (millis() - startTime < 15000) {
          if (WiFi.status() == WL_CONNECTED) {
            connected = true;
            break;
          }
          delay(500);
          Serial.print(".");
        }
        
        if (connected) {
          currentNetworkMode = WIFI_STA_MODE;
          wifiConnected = true;
          Serial.println();
          Serial.println("WiFi connected successfully!");
          Serial.print("IP: ");
          Serial.println(WiFi.localIP());
          Serial.print("Gateway: ");
          Serial.println(WiFi.gatewayIP());
          Serial.print("Subnet: ");
          Serial.println(WiFi.subnetMask());
        } else {
          Serial.println();
          Serial.println("WiFi connection failed, reverting to AP mode");
          // Revert to AP mode if WiFi connection fails
          setupWiFiAP();
        }
        
      } else {
        server.send(400, "application/json", "{\"error\":\"SSID required\"}");
      }
    } else {
      server.send(400, "application/json", "{\"error\":\"No data provided\"}");
    }
  });

  server.on("/api/network/status", HTTP_GET, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.sendHeader("Cache-Control", "no-cache");
    
    // Tạo response nhỏ gọn bằng String thay vì ArduinoJson
    String response = "{";
    response += "\"ethernet_connected\":" + String(ethernetConnected ? "true" : "false") + ",";
    response += "\"wifi_connected\":" + String(wifiConnected ? "true" : "false") + ",";
    
    if (currentNetworkMode == ETHERNET_MODE) {
      response += "\"current_mode\":\"ethernet\"";
      if (ethernetConnected) {
        response += ",\"ip\":\"" + ETH.localIP().toString() + "\"";
        response += ",\"gateway\":\"" + ETH.gatewayIP().toString() + "\"";
      }
    } else if (currentNetworkMode == WIFI_STA_MODE) {
      response += "\"current_mode\":\"wifi_sta\"";
      if (wifiConnected) {
        response += ",\"ip\":\"" + WiFi.localIP().toString() + "\"";
        response += ",\"ssid\":\"" + WiFi.SSID() + "\"";
      }
    } else if (currentNetworkMode == WIFI_AP_MODE) {
      response += "\"current_mode\":\"wifi_ap\"";
      response += ",\"ip\":\"" + WiFi.softAPIP().toString() + "\"";
      response += ",\"ap_ssid\":\"" + String(ap_ssid) + "\"";
    }
    
    response += "}";
    
    server.send(200, "application/json", response);
    Serial.println("Network status API - response length: " + String(response.length()));
  });

  // API restart ESP32 để áp dụng cấu hình IP mới
  server.on("/api/restart", HTTP_POST, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    
    DynamicJsonDocument doc(256);
    doc["status"] = "OK";
    doc["message"] = "ESP32 will restart in 2 seconds";
    
    String out;
    serializeJson(doc, out);
    server.send(200, "application/json", out);
    
    Serial.println("Restart requested from web - restarting in 2 seconds...");
    delay(2000);
    ESP.restart();
  });

  // API để force restart ethernet connection
  server.on("/api/restart_ethernet", HTTP_POST, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    
    // Load settings từ file
    if (LittleFS.exists("/settings.json")) {
      File file = LittleFS.open("/settings.json", "r");
      if (file) {
        String content = file.readString();
        file.close();
        
        DynamicJsonDocument doc(1024);
        if (deserializeJson(doc, content) == DeserializationError::Ok) {
          String ethIP = doc["ipAddress"];
          String ethGateway = doc["gateway"];
          String ethSubnet = doc["subnet"];
          
          if (ethIP.length() > 0) {
            IPAddress newIP, newGateway, newSubnet;
            if (newIP.fromString(ethIP) && newGateway.fromString(ethGateway) && newSubnet.fromString(ethSubnet)) {
              local_IP = newIP;
              gateway = newGateway;
              subnet = newSubnet;
              
              Serial.println("Applying new Ethernet config:");
              Serial.println("IP: " + ethIP);
              Serial.println("Gateway: " + ethGateway);
              Serial.println("Subnet: " + ethSubnet);
            }
          }
        }
      }
    }
    
    server.send(200, "application/json", "{\"status\":\"OK\",\"message\":\"Restarting with new IP config\"}");
    delay(1000);
    ESP.restart();
  });

  // API để kiểm tra kết quả kết nối WiFi
  server.on("/api/wifi/status", HTTP_GET, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    
    DynamicJsonDocument doc(256);
    doc["wifi_connected"] = wifiConnected;
    doc["current_mode"] = (currentNetworkMode == ETHERNET_MODE) ? "ethernet" : 
                         (currentNetworkMode == WIFI_STA_MODE) ? "wifi_sta" : "wifi_ap";
    
    if (currentNetworkMode == WIFI_STA_MODE && wifiConnected) {
      doc["success"] = true;
      doc["ip"] = WiFi.localIP().toString();
      doc["gateway"] = WiFi.gatewayIP().toString();
      doc["subnet"] = WiFi.subnetMask().toString();
      doc["ssid"] = WiFi.SSID();
      doc["use_static_ip"] = wifi_use_static_ip;
      doc["message"] = "WiFi connected successfully";
    } else if (currentNetworkMode == WIFI_AP_MODE) {
      doc["success"] = false;
      doc["message"] = "WiFi connection failed, AP mode active";
      doc["ap_ip"] = WiFi.softAPIP().toString();
    } else {
      doc["success"] = false;
      doc["message"] = "WiFi connection in progress or failed";
    }
    
    String out;
    serializeJson(doc, out);
    server.send(200, "application/json", out);
  });

  // MQTT Control API
  server.on("/api/mqtt/status", HTTP_GET, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    
    DynamicJsonDocument doc(512);
    doc["connected"] = mqtt.connected();
    doc["server"] = mqtt_server;
    doc["client_id"] = "ESP32_BagCounter_" + String(WiFi.macAddress()).substring(0, 8);
    doc["last_publish"] = lastMqttPublish;
    doc["last_heartbeat"] = lastHeartbeat;
    
    // Topic structure
    JsonObject topics = doc.createNestedObject("topics");
    JsonArray publish_topics = topics.createNestedArray("publish");
    publish_topics.add(TOPIC_STATUS);
    publish_topics.add(TOPIC_COUNT);
    publish_topics.add(TOPIC_ALERTS);
    publish_topics.add(TOPIC_SENSOR);
    publish_topics.add(TOPIC_HEARTBEAT);
    publish_topics.add(TOPIC_IR_CMD);
    
    JsonArray subscribe_topics = topics.createNestedArray("subscribe");
    subscribe_topics.add(TOPIC_CMD_START);
    subscribe_topics.add(TOPIC_CMD_PAUSE);
    subscribe_topics.add(TOPIC_CMD_RESET);
    subscribe_topics.add(TOPIC_CMD_SELECT);
    subscribe_topics.add(TOPIC_CMD_BATCH);
    subscribe_topics.add(TOPIC_CONFIG);
    
    String out;
    serializeJson(doc, out);
    server.send(200, "application/json", out);
  });

  server.on("/api/mqtt/publish", HTTP_POST, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    
    if (server.hasArg("plain")) {
      DynamicJsonDocument doc(512);
      deserializeJson(doc, server.arg("plain"));
      
      String topic = doc["topic"];
      String message = doc["message"];
      
      if (topic.length() > 0 && message.length() > 0) {
        bool success = mqtt.publish(topic.c_str(), message.c_str());
        
        DynamicJsonDocument response(256);
        response["success"] = success;
        response["topic"] = topic;
        response["message"] = message;
        response["timestamp"] = millis();
        
        String out;
        serializeJson(response, out);
        server.send(200, "application/json", out);
        
        Serial.println("Manual MQTT publish: " + topic + " = " + message);
      } else {
        server.send(400, "application/json", "{\"error\":\"Topic and message required\"}");
      }
    } else {
      server.send(400, "application/json", "{\"error\":\"No data provided\"}");
    }
  });

  server.on("/api/mqtt/force_publish", HTTP_POST, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    
    // Force publish tất cả dữ liệu hiện tại
    publishStatusMQTT();
    publishCountUpdate();
    publishSensorData();
    publishHeartbeat();
    
    DynamicJsonDocument response(256);
    response["success"] = true;
    response["message"] = "All MQTT topics published";
    response["timestamp"] = millis();
    
    String out;
    serializeJson(response, out);
    server.send(200, "application/json", out);
    
    Serial.println(" Force published all MQTT topics");
  });

  // Simple test page
  server.on("/test", HTTP_GET, [](){
    String html = "<!DOCTYPE html><html><head><title>Test Page</title></head><body>";
    html += "<h1>Test Page Working!</h1>";
    html += "<p>AP IP: " + WiFi.softAPIP().toString() + "</p>";
    html += "<p>Free Heap: " + String(ESP.getFreeHeap()) + "</p>";
    html += "<p>Uptime: " + String(millis()) + "ms</p>";
    html += "<button onclick=\"testWiFiScan()\">Test WiFi Scan</button>";
    html += "<div id=\"scanResult\"></div>";
    html += "<script>";
    html += "function testWiFiScan() {";
    html += "  const startTime = Date.now();";
    html += "  document.getElementById('scanResult').innerHTML = 'Scanning...';";
    html += "  fetch('/api/wifi/scan')";
    html += "    .then(response => response.json())";
    html += "    .then(data => {";
    html += "      const duration = Date.now() - startTime;";
    html += "      document.getElementById('scanResult').innerHTML = ";
    html += "        '<p>Scan completed in ' + duration + 'ms</p>' +";
    html += "        '<p>Found ' + (data.networks ? data.networks.length : 0) + ' networks</p>';";
    html += "    })";
    html += "    .catch(error => {";
    html += "      const duration = Date.now() - startTime;";
    html += "      document.getElementById('scanResult').innerHTML = ";
    html += "        '<p>Error after ' + duration + 'ms: ' + error.message + '</p>';";
    html += "    });";
    html += "}";
    html += "</script>";
    html += "</body></html>";
    server.send(200, "text/html", html);
    Serial.println("Served test page with WiFi scan test");
  });

  // API debug/test cho việc lưu trữ dữ liệu
  server.on("/api/debug/storage", HTTP_GET, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    
    DynamicJsonDocument doc(2048);
    
    // Thông tin files
    doc["files"]["settings"] = LittleFS.exists("/settings.json");
    doc["files"]["products"] = LittleFS.exists("/products.json");
    doc["files"]["orders"] = LittleFS.exists("/orders.json");
    doc["files"]["bag_types"] = LittleFS.exists("/bag_types.json");
    doc["files"]["bag_configs"] = LittleFS.exists("/bag_configs.json");
    
    // Thông tin dữ liệu trong memory
    doc["memory"]["products_count"] = productsData.size();
    doc["memory"]["orders_count"] = ordersData.size();
    doc["memory"]["bag_types_count"] = bagTypes.size();
    doc["memory"]["bag_configs_count"] = bagConfigs.size();
    
    // Current settings
    doc["current_settings"]["conveyor_name"] = conveyorName;
    doc["current_settings"]["brightness"] = displayBrightness;
    doc["current_settings"]["sensor_delay"] = sensorDelayMs;
    doc["current_settings"]["bag_detection_delay"] = bagDetectionDelay;
    doc["current_settings"]["min_bag_interval"] = minBagInterval;
    doc["current_settings"]["auto_reset"] = autoReset;
    
    String out;
    serializeJson(doc, out);
    server.send(200, "application/json", out);
  });

  server.on("/api/debug/reload", HTTP_POST, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    
    // Reload tất cả dữ liệu từ LittleFS
    Serial.println("🔄 Reloading all data from LittleFS...");
    loadSettingsFromFile();
    loadProductsFromFile();
    loadOrdersFromFile();
    loadBagTypesFromFile();
    loadBagConfigsFromFile();
    
    printDataStatus();
    
    server.send(200, "application/json", "{\"status\":\"OK\",\"message\":\"All data reloaded from storage\"}");
  });

  server.on("/api/debug/reset-products", HTTP_POST, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    
    Serial.println("Resetting products to default...");
    
    // Xóa file cũ
    if (LittleFS.exists("/products.json")) {
      LittleFS.remove("/products.json");
      Serial.println("Deleted /products.json");
    }
    
    // Tạo lại file trống
    productsData.clear();
    productsData.to<JsonArray>(); // Tạo array rỗng
    saveProductsToFile();
    
    Serial.println("Products reset to empty");
    
    server.send(200, "application/json", "{\"status\":\"OK\",\"message\":\"Products reset to empty\",\"count\":" + String(productsData.size()) + "}");
  });

  server.on("/api/debug/reset-orders", HTTP_POST, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    
    Serial.println("Resetting orders...");
    
    // Xóa file cũ
    if (LittleFS.exists("/orders.json")) {
      LittleFS.remove("/orders.json");
      Serial.println("Deleted /orders.json");
    }
    
    // Tạo lại array rỗng
    ordersData.clear();
    ordersData.to<JsonArray>(); // Tạo array rỗng
    saveOrdersToFile();
    
    Serial.println("Orders reset (empty)");
    
    server.send(200, "application/json", "{\"status\":\"OK\",\"message\":\"Orders reset to empty\",\"count\":" + String(ordersData.size()) + "}");
  });

  server.on("/api/debug/settings", HTTP_GET, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    
    debugSettingsFile();
    
    DynamicJsonDocument doc(1024);
    doc["file_exists"] = LittleFS.exists("/settings.json");
    
    if (LittleFS.exists("/settings.json")) {
      File file = LittleFS.open("/settings.json", "r");
      if (file) {
        String content = file.readString();
        file.close();
        doc["file_content"] = content;
        
        DynamicJsonDocument fileDoc(1024);
        DeserializationError error = deserializeJson(fileDoc, content);
        doc["json_valid"] = (error == DeserializationError::Ok);
        if (error != DeserializationError::Ok) {
          doc["json_error"] = error.c_str();
        }
      }
    }
    
    doc["current_memory"]["conveyorName"] = conveyorName;
    doc["current_memory"]["brightness"] = displayBrightness;
    doc["current_memory"]["sensorDelay"] = sensorDelayMs;
    doc["current_memory"]["bagDetectionDelay"] = bagDetectionDelay;
    doc["current_memory"]["minBagInterval"] = minBagInterval;
    doc["current_memory"]["autoReset"] = autoReset;
    
    String out;
    serializeJson(doc, out);
    server.send(200, "application/json", out);
  });

  // ========== CAPTIVE PORTAL HANDLERS ==========
  // Xử lý các URL thường được sử dụng để phát hiện captive portal
  server.on("/generate_204", HTTP_GET, [](){
    // Android captive portal detection
    server.sendHeader("Location", "http://" + WiFi.softAPIP().toString() + "/");
    server.send(302, "text/plain", "");
  });
  
  server.on("/fwlink", HTTP_GET, [](){
    // Microsoft captive portal detection
    server.sendHeader("Location", "http://" + WiFi.softAPIP().toString() + "/");
    server.send(302, "text/plain", "");
  });
  
  server.on("/hotspot-detect.html", HTTP_GET, [](){
    // iOS captive portal detection
    server.sendHeader("Location", "http://" + WiFi.softAPIP().toString() + "/");
    server.send(302, "text/plain", "");
  });
  
  server.on("/connecttest.txt", HTTP_GET, [](){
    // Windows captive portal detection
    server.send(200, "text/plain", "Microsoft Connect Test");
  });
  
  // API BỔ SUNG ĐỂ ĐỒNG BỘ VỚI WEB
  
  // API lưu/xóa toàn bộ products
  server.on("/api/products", HTTP_POST, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    
    if (server.hasArg("plain")) {
      String jsonData = server.arg("plain");
      Serial.println("📦 Receiving ALL products from web: " + jsonData);
      
      // Parse JSON array
      DynamicJsonDocument doc(4096);
      DeserializationError error = deserializeJson(doc, jsonData);
      
      if (error) {
        server.send(400, "application/json", "{\"status\":\"Error\",\"message\":\"Invalid JSON\"}");
        return;
      }
      
      // Xóa products hiện tại và thay thế bằng dữ liệu mới
      productsData.clear();
      
      if (doc.is<JsonArray>()) {
        JsonArray arr = doc.as<JsonArray>();
        for (JsonObject obj : arr) {
          JsonObject newProduct = productsData.createNestedObject();
          newProduct["id"] = obj["id"];
          newProduct["code"] = obj["code"];
          newProduct["name"] = obj["name"];
          if (obj.containsKey("group")) {
            newProduct["group"] = obj["group"];
          }
          if (obj.containsKey("unitWeight")) {
            newProduct["unitWeight"] = obj["unitWeight"];
          }
          if (obj.containsKey("createdAt")) {
            newProduct["createdAt"] = obj["createdAt"];
          }
        }
      }
      
      // Lưu vào file
      saveProductsToFile();
      
      Serial.println("Saved " + String(productsData.size()) + " products to ESP32");
      server.send(200, "application/json", "{\"status\":\"OK\",\"message\":\"Products saved\",\"count\":" + String(productsData.size()) + "}");
    } else {
      server.send(400, "application/json", "{\"status\":\"Error\",\"message\":\"No data provided\"}");
    }
  });
  
  // API xóa product theo ID
  server.on("/api/products/*", HTTP_DELETE, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    
    String uri = server.uri();
    String productIdStr = uri.substring(uri.lastIndexOf('/') + 1);
    int productId = productIdStr.toInt();
    
    if (productId > 0) {
      Serial.println("Deleting product ID: " + String(productId));
      
      // Tìm và xóa product
      for (size_t i = 0; i < productsData.size(); i++) {
        if (productsData[i]["id"] == productId) {
          productsData.remove(i);
          saveProductsToFile();
          Serial.println("Product deleted successfully");
          server.send(200, "application/json", "{\"status\":\"OK\",\"message\":\"Product deleted\"}");
          return;
        }
      }
      
      server.send(404, "application/json", "{\"status\":\"Error\",\"message\":\"Product not found\"}");
    } else {
      server.send(400, "application/json", "{\"status\":\"Error\",\"message\":\"Invalid product ID\"}");
    }
  });
  
  // API lưu/xóa toàn bộ order batches
  server.on("/api/orders", HTTP_POST, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    
    // Check memory before processing
    size_t freeHeap = ESP.getFreeHeap();
    Serial.println("Free heap before orders processing: " + String(freeHeap) + " bytes");
    
    if (freeHeap < 8000) {  // Giảm từ 15000 xuống 8000 bytes
      Serial.println("Low memory detected, rejecting large orders request");
      server.send(507, "application/json", "{\"status\":\"Error\",\"message\":\"Insufficient memory for orders\"}");
      return;
    }
    
    if (server.hasArg("plain")) {
      String jsonData = server.arg("plain");
      Serial.println("Receiving ALL order batches from web...");
      Serial.println("Data size: " + String(jsonData.length()) + " chars");
      Serial.println("Data preview (first 300 chars): " + jsonData.substring(0, min(300, (int)jsonData.length())));
      
      // DEBUG: Print more of the data to see if there are different orders
      if (jsonData.length() > 300) {
        Serial.println("Data continuation (chars 300-600): " + jsonData.substring(300, min(600, (int)jsonData.length())));
      }
      if (jsonData.length() > 600) {
        Serial.println("Data continuation (chars 600-900): " + jsonData.substring(600, min(900, (int)jsonData.length())));
      }
      
      // Limit data size to prevent memory overflow
      if (jsonData.length() > 8000) {  // Tăng từ 6000 lên 8000 bytes
        Serial.println("Data too large, rejecting request");
        server.send(413, "application/json", "{\"status\":\"Error\",\"message\":\"Data too large\"}");
        return;
      }
      
      // Use smaller JSON document and check available memory
      size_t docSize = min(8192, (int)freeHeap / 2); // Use 1/2 of available memory instead of 1/3
      Serial.println("Using JSON document size: " + String(docSize) + " bytes");
      
      DynamicJsonDocument doc(docSize);
      DeserializationError error = deserializeJson(doc, jsonData);
      
      if (error) {
        Serial.println("JSON Parse Error: " + String(error.c_str()));
        server.send(400, "application/json", "{\"status\":\"Error\",\"message\":\"Invalid JSON: " + String(error.c_str()) + "\"}");
        return;
      }
      
      Serial.println("JSON parsed successfully");
      
      // Feed watchdog to prevent timeout
      yield();
      
      // Xóa orders hiện tại và thay thế bằng dữ liệu mới
      Serial.println("Clearing existing orders data...");
      ordersData.clear();
      
      if (doc.is<JsonArray>()) {
        JsonArray arr = doc.as<JsonArray>();
        Serial.println("Processing " + String(arr.size()) + " order batches...");
        
        int batchCount = 0;
        for (JsonObject obj : arr) {
          Serial.println("DEBUG: Processing batch " + String(batchCount + 1));
          Serial.println("   - Batch ID: " + String(obj["id"].as<long>()));
          Serial.println("   - Batch name: " + obj["name"].as<String>());
          
          // Check orders array BEFORE copy
          if (obj.containsKey("orders") && obj["orders"].is<JsonArray>()) {
            JsonArray orders = obj["orders"];
            Serial.println("   - Orders count in this batch: " + String(orders.size()));
            
            // Log first few orders FROM ORIGINAL JSON
            Serial.println("   - DEBUG: Orders from ORIGINAL JSON:");
            for (size_t i = 0; i < min(3, (int)orders.size()); i++) {
              JsonObject order = orders[i];
              String orderCode = order["orderCode"].as<String>();
              String productName = order["productName"].as<String>();
              String productCode = "";
              if (order.containsKey("product") && order["product"].containsKey("code")) {
                productCode = order["product"]["code"].as<String>();
              }
              int quantity = order["quantity"].as<int>();
              int warningQuantity = order["warningQuantity"].as<int>();
              
              Serial.println("     Order " + String(i + 1) + ": orderCode=" + orderCode + 
                           ", productName=" + productName + ", productCode=" + productCode +
                           ", qty=" + String(quantity) + ", warning=" + String(warningQuantity));
            }
          } else {
            Serial.println("   - No orders array found or empty!");
          }
          
          JsonObject newBatch = ordersData.createNestedObject();
          copyJsonObject(obj, newBatch);
          
          // CHECK orders array AFTER copy
          if (newBatch.containsKey("orders") && newBatch["orders"].is<JsonArray>()) {
            JsonArray copiedOrders = newBatch["orders"];
            Serial.println("   - DEBUG: Orders AFTER copy to ordersData:");
            for (size_t i = 0; i < min(3, (int)copiedOrders.size()); i++) {
              JsonObject copiedOrder = copiedOrders[i];
              String orderCode = copiedOrder["orderCode"].as<String>();
              String productName = copiedOrder["productName"].as<String>();
              String productCode = "";
              if (copiedOrder.containsKey("product") && copiedOrder["product"].containsKey("code")) {
                productCode = copiedOrder["product"]["code"].as<String>();
              }
              int quantity = copiedOrder["quantity"].as<int>();
              int warningQuantity = copiedOrder["warningQuantity"].as<int>();
              
              Serial.println("     Copied Order " + String(i + 1) + ": orderCode=" + orderCode + 
                           ", productName=" + productName + ", productCode=" + productCode +
                           ", qty=" + String(quantity) + ", warning=" + String(warningQuantity));
            }
          }
          
          // Feed watchdog every few batches to prevent timeout
          if (++batchCount % 2 == 0) {
            yield();
            Serial.println("Processed " + String(batchCount) + " batches...");
          }
        }
        
        Serial.println("All batches copied to ordersData");
      } else {
        Serial.println("Data is not a JSON array");
        server.send(400, "application/json", "{\"status\":\"Error\",\"message\":\"Data must be an array\"}");
        return;
      }
      
      // Feed watchdog before file save
      yield();
      
      // Lưu vào file
      Serial.println("Saving orders to file...");
      saveOrdersToFile();
      
      // Check memory after processing
      Serial.println("Free heap after orders processing: " + String(ESP.getFreeHeap()) + " bytes");
      
      Serial.println("Saved " + String(ordersData.size()) + " order batches to ESP32");
      server.send(200, "application/json", "{\"status\":\"OK\",\"message\":\"Orders saved\",\"count\":" + String(ordersData.size()) + "}");
    } else {
      Serial.println("No POST data received");
      server.send(400, "application/json", "{\"status\":\"Error\",\"message\":\"No data provided\"}");
    }
  });
  
  // API xóa batch theo ID
  server.on("/api/orders/*", HTTP_DELETE, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    
    String uri = server.uri();
    String batchIdStr = uri.substring(uri.lastIndexOf('/') + 1);
    int batchId = batchIdStr.toInt();
    
    if (batchId > 0) {
      Serial.println("Deleting batch ID: " + String(batchId));
      
      // Tìm và xóa batch
      for (size_t i = 0; i < ordersData.size(); i++) {
        if (ordersData[i]["id"] == batchId) {
          ordersData.remove(i);
          saveOrdersToFile();
          Serial.println("Batch deleted successfully");
          server.send(200, "application/json", "{\"status\":\"OK\",\"message\":\"Batch deleted\"}");
          return;
        }
      }
      
      server.send(404, "application/json", "{\"status\":\"Error\",\"message\":\"Batch not found\"}");
    } else {
      server.send(400, "application/json", "{\"status\":\"Error\",\"message\":\"Invalid batch ID\"}");
    }
  });
  
  // API lưu/xóa history
  server.on("/api/history", HTTP_POST, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    
    if (server.hasArg("plain")) {
      String jsonData = server.arg("plain");
      Serial.println("Receiving history from web: " + String(jsonData.length()) + " bytes");
      
      // Lưu trực tiếp vào file (không cần parse vì ESP32 chỉ lưu trữ)
      File file = LittleFS.open("/history.json", "w");
      if (file) {
        file.print(jsonData);
        file.close();
        Serial.println("History saved to ESP32");
        server.send(200, "application/json", "{\"status\":\"OK\",\"message\":\"History saved\"}");
      } else {
        server.send(500, "application/json", "{\"status\":\"Error\",\"message\":\"Failed to save history\"}");
      }
    } else {
      server.send(400, "application/json", "{\"status\":\"Error\",\"message\":\"No data provided\"}");
    }
  });
  
  server.on("/api/history", HTTP_DELETE, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    
    Serial.println("Clearing all history from ESP32");
    
    // Xóa file history
    if (LittleFS.exists("/history.json")) {
      LittleFS.remove("/history.json");
    }
    
    Serial.println("History cleared from ESP32");
    server.send(200, "application/json", "{\"status\":\"OK\",\"message\":\"History cleared\"}");
  });
  
  // API reset settings về mặc định
  server.on("/api/settings/reset", HTTP_POST, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    
    Serial.println("Resetting settings to default on ESP32");
    
    // Xóa file settings để force về default
    if (LittleFS.exists("/settings.json")) {
      LittleFS.remove("/settings.json");
    }
    
    // Reset biến global về default
    conveyorName = "BT-001";
    displayBrightness = 35;
    sensorDelayMs = 50;
    bagDetectionDelay = 200;
    minBagInterval = 100;
    autoReset = true;  // Bật tự động chuyển đơn hàng
    
    // Reset network về default
    local_IP = IPAddress(192, 168, 1, 200);
    gateway = IPAddress(192, 168, 1, 1);
    subnet = IPAddress(255, 255, 255, 0);
    primaryDNS = IPAddress(8, 8, 8, 8);
    secondaryDNS = IPAddress(8, 8, 4, 4);
    
    Serial.println("Settings reset to default");
    server.send(200, "application/json", "{\"status\":\"OK\",\"message\":\"Settings reset to default\",\"needRestart\":true}");
  });
  
  // API DEBUG SETTINGS - Để kiểm tra trạng thái file và biến
  server.on("/api/debug/settings", HTTP_GET, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    
    Serial.println("DEBUG: Settings debugging requested via API");
    debugSettingsFile();
    
    DynamicJsonDocument doc(2048);
    
    // Current variables in memory
    doc["memory"]["conveyorName"] = conveyorName;
    doc["memory"]["brightness"] = displayBrightness;
    doc["memory"]["sensorDelay"] = sensorDelayMs;
    doc["memory"]["bagDetectionDelay"] = bagDetectionDelay;
    doc["memory"]["minBagInterval"] = minBagInterval;
    doc["memory"]["autoReset"] = autoReset;
    
    // File status
    doc["files"]["settings_exists"] = LittleFS.exists("/settings.json");
    doc["files"]["products_exists"] = LittleFS.exists("/products.json");
    doc["files"]["orders_exists"] = LittleFS.exists("/orders.json");
    doc["files"]["bagtypes_exists"] = LittleFS.exists(BAGTYPES_FILE);
    doc["files"]["bagconfigs_exists"] = LittleFS.exists(BAGCONFIGS_FILE);
    
    // File content (settings.json)
    if (LittleFS.exists("/settings.json")) {
      File file = LittleFS.open("/settings.json", "r");
      if (file) {
        String content = file.readString();
        file.close();
        
        DynamicJsonDocument settingsDoc(1024);
        if (deserializeJson(settingsDoc, content) == DeserializationError::Ok) {
          doc["file_content"]["settings"] = settingsDoc;
        } else {
          doc["file_content"]["settings"] = "PARSE_ERROR";
        }
      }
    } else {
      doc["file_content"]["settings"] = "FILE_NOT_FOUND";
    }
    
    // System info
    doc["system"]["free_heap"] = ESP.getFreeHeap();
    doc["system"]["uptime_ms"] = millis();
    doc["system"]["littlefs_total"] = LittleFS.totalBytes();
    doc["system"]["littlefs_used"] = LittleFS.usedBytes();
    
    String out;
    serializeJson(doc, out);
    server.send(200, "application/json", out);
    
    Serial.println("Debug info sent to web client");
  });
  
  // ⚡ API FORCE REFRESH SETTINGS - Để reload settings từ file
  server.on("/api/settings/refresh", HTTP_POST, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    
    Serial.println("Force refreshing settings from file...");
    
    // Reload settings từ file
    loadSettingsFromFile();
    
    // Áp dụng ngay các thay đổi
    if (dma_display && displayBrightness >= 10 && displayBrightness <= 100) {
      dma_display->setBrightness8(map(displayBrightness, 0, 100, 0, 255));
      Serial.println("Display brightness re-applied: " + String(displayBrightness) + "%");
    }
    
    debounceDelay = sensorDelayMs;
    
    Serial.println("Settings refreshed from file:");
    Serial.println("  - conveyorName: " + conveyorName);
    Serial.println("  - brightness: " + String(displayBrightness) + "%");
    Serial.println("  - sensorDelay: " + String(sensorDelayMs) + "ms");
    
    server.send(200, "application/json", "{\"status\":\"OK\",\"message\":\"Settings refreshed from file\"}");
  });
  
  // Catch-all handler cho bất kỳ domain nào khác
  server.onNotFound([](){
    if (currentNetworkMode == WIFI_AP_MODE) {
      // Redirect về IP của AP
      server.sendHeader("Location", "http://" + WiFi.softAPIP().toString() + "/");
      server.send(302, "text/plain", "Redirecting to Bag Counter Configuration");
    } else {
      server.send(404, "text/plain", "Not Found");
    }
  });

  // API cập nhật target khi thêm/sửa order trong existing batch
  server.on("/api/update-target", HTTP_POST, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.sendHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
    
    if (server.hasArg("plain")) {
      String body = server.arg("plain");
      Serial.println("Received target update: " + body);
      
      DynamicJsonDocument doc(2048);
      DeserializationError error = deserializeJson(doc, body);
      
      if (!error) {
        String batchName = doc["batchName"].as<String>();
        int newTotalTarget = doc["totalTarget"];
        
        // Kiểm tra batch name có khớp không
        if (batchName == currentBatchName) {
          // Cập nhật tổng target
          int oldTarget = batchTotalTarget;
          batchTotalTarget = newTotalTarget;
          
          Serial.println("Target updated from " + String(oldTarget) + " to " + String(newTotalTarget));
          
          // Cập nhật hiển thị LED matrix
          displayCurrentOrderInfo();
          
          // Lưu thông tin batch
          saveBatchInfoToFile();
          
          // Response thành công
          DynamicJsonDocument response(512);
          response["status"] = "OK";
          response["message"] = "Target updated successfully";
          response["batchName"] = batchName;
          response["oldTarget"] = oldTarget;
          response["newTarget"] = newTotalTarget;
          
          String responseStr;
          serializeJson(response, responseStr);
          server.send(200, "application/json", responseStr);
          
        } else {
          Serial.println("Batch name mismatch: expected " + currentBatchName + ", got " + batchName);
          server.send(400, "application/json", "{\"status\":\"Error\",\"message\":\"Batch name mismatch\"}");
        }
        
      } else {
        Serial.println("JSON parse error: " + String(error.c_str()));
        server.send(400, "application/json", "{\"status\":\"Error\",\"message\":\"Invalid JSON\"}");
      }
    } else {
      server.send(400, "application/json", "{\"status\":\"Error\",\"message\":\"No data provided\"}");
    }
  });

  // API để lấy thông tin thiết bị
  server.on("/api/device_info", HTTP_GET, [](){
    DynamicJsonDocument doc(512);
    
    // Lấy MAC Address - Luôn dùng WiFi MAC của ESP32 cho nhất quán
    String macAddress = WiFi.macAddress();  // ESP32 WiFi MAC (unique per device)
    
    // Thông tin Ethernet MAC (W5500 shield MAC - cố định)
    String ethernetMAC = "";
    char ethMacStr[18];
    sprintf(ethMacStr, "%02X:%02X:%02X:%02X:%02X:%02X", 
            mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    ethernetMAC = String(ethMacStr);
    
    // Tạo MQTT Topic từ MAC
    String mqttTopic = "bagcounter/" + macAddress;
    mqttTopic.replace(":", "");  // Bỏ dấu :
    mqttTopic.toLowerCase();
    
    doc["deviceMAC"] = macAddress;  // ESP32 WiFi MAC (unique)
    doc["ethernetMAC"] = ethernetMAC;  // W5500 Ethernet MAC (fixed)
    doc["mqttTopic"] = mqttTopic;
    doc["conveyorName"] = conveyorName;
    doc["firmwareVersion"] = "1.0.0";
    doc["networkMode"] = (currentNetworkMode == ETHERNET_MODE) ? "Ethernet" : 
                        (currentNetworkMode == WIFI_STA_MODE) ? "WiFi_STA" : "WiFi_AP";
    doc["ipAddress"] = (currentNetworkMode == ETHERNET_MODE) ? local_IP.toString() : WiFi.localIP().toString();
    doc["uptime"] = millis();
    doc["activeInterface"] = (currentNetworkMode == ETHERNET_MODE) ? "Ethernet (W5500)" : "WiFi";
    
    String response;
    serializeJson(doc, response);
    
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.send(200, "application/json", response);
    
    Serial.println("Device info sent:");
    Serial.println("   - ESP32 WiFi MAC: " + macAddress);
    Serial.println("   - W5500 Ethernet MAC: " + ethernetMAC);
    Serial.println("   - MQTT Topic: " + mqttTopic);
    Serial.println("   - Active Interface: " + doc["activeInterface"].as<String>());
  });

  // Handle CORS preflight for update-target
  server.on("/api/update-target", HTTP_OPTIONS, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.sendHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
    server.send(200);
  });

  // API cho khách hàng lấy thông tin 7 trường dữ liệu chính
  server.on("/api/customer/info", HTTP_GET, [](){
    Serial.println("=== Customer Info API Called ===");
    Serial.println("Current values:");
    Serial.println("  orderCode: " + orderCode);
    Serial.println("  productCode: " + productCode);
    Serial.println("  customerName: " + customerName);
    Serial.println("  startTime: " + startTimeStr);
    Serial.println("  currentMode: " + currentMode);
    Serial.println("  location: " + location);
    Serial.println("  conveyorName: " + conveyorName);
    
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.sendHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    
    DynamicJsonDocument doc(1024);
    
    // 1. orderCode - Mã đơn hàng hiện tại
    doc["orderCode"] = orderCode;
    
    // 2. productGroup - Nhóm sản phẩm (từ sản phẩm hiện tại)
    String currentProductGroup = "";
    if (productCode.length() > 0) {
      // Tìm productGroup từ productsData
      JsonArray products = productsData.as<JsonArray>();
      for (JsonObject product : products) {
        if (product["code"] == productCode) {
          currentProductGroup = product["group"] | "";
          break;
        }
      }
    }
    doc["productGroup"] = currentProductGroup;
    
    // 3. productCode - Mã sản phẩm hiện tại
    doc["productCode"] = productCode;
    
    // 4. customerName - Tên khách hàng hiện tại
    doc["customerName"] = customerName;
    
    // 5. startTime - Thời gian bắt đầu đếm
    doc["startTime"] = startTimeStr;
    
    // 6. setMode - Chế độ hiển thị hiện tại
    doc["setMode"] = currentMode;
    
    // 7. location - Địa điểm đặt băng tải
    doc["location"] = location;
    
    
    String out;
    serializeJson(doc, out);
    server.send(200, "application/json", out);
    
    Serial.println("Customer info API response sent successfully");
    Serial.println("Response JSON: " + out);
    Serial.println("=== End Customer Info API ===");
  });

  server.begin();
  Serial.println("WebServer started");
  Serial.println("Access web interface at: http://192.168.4.1/");
  Serial.println("Test page at: http://192.168.4.1/test");
  Serial.println("Test Customer API at: http://192.168.4.1/test-customer-api");
}

//----------------------------------------Display Functions
void updateDisplay() {
  // Kiểm tra dma_display có khả dụng không
  if (!dma_display) {
    Serial.println("dma_display is null - cannot update display");
    return;
  }
  
  // Nếu chưa kết nối xong, hiển thị "Connecting"
  if (!systemConnected) {
    showConnectingDisplay();
    return;
  }
  
  if (isLimitReached && isBlinking && (blinkCount % 2 == 1)) {
    dma_display->fillScreen(myWHITE);
    return;
  }
  
  dma_display->clearScreen();
  
  //  LAYOUT THEO YÊU CẦU (2 dòng):
  // ┌─────────────────────┬──────────────┐
  // │ GAO THUONG (Size 2) │   "85" Size3 │  
  // │ XUAT: 100           │   (màu đỏ)   │
  // └─────────────────────┴──────────────┘
  
  // Chuyển đổi tên loại bao không dấu
  String displayType = bagType;
  //Serial.println("Displaying product: " + bagType + " -> " + displayType);
  displayType.replace("ạ", "a");
  displayType.replace("ă", "a"); 
  displayType.replace("â", "a");
  displayType.replace("á", "a");
  displayType.replace("à", "a");
  displayType.replace("ã", "a");
  displayType.replace("ả", "a");
  displayType.replace("ậ", "a");
  displayType.replace("ắ", "a");
  displayType.replace("ằ", "a");
  displayType.replace("ẵ", "a");
  displayType.replace("ẳ", "a");
  displayType.replace("ấ", "a");
  displayType.replace("ầ", "a");
  displayType.replace("ẫ", "a");
  displayType.replace("ẩ", "a");
  displayType.replace("ê", "e");
  displayType.replace("é", "e");
  displayType.replace("è", "e");
  displayType.replace("ẽ", "e");
  displayType.replace("ẻ", "e");
  displayType.replace("ế", "e");
  displayType.replace("ề", "e");
  displayType.replace("ễ", "e");
  displayType.replace("ể", "e");
  displayType.replace("ệ", "e");
  displayType.replace("í", "i");
  displayType.replace("ì", "i");
  displayType.replace("ĩ", "i");
  displayType.replace("ỉ", "i");
  displayType.replace("ị", "i");
  displayType.replace("ô", "o");
  displayType.replace("ơ", "o");
  displayType.replace("ó", "o");
  displayType.replace("ò", "o");
  displayType.replace("õ", "o");
  displayType.replace("ỏ", "o");
  displayType.replace("ọ", "o");
  displayType.replace("ố", "o");
  displayType.replace("ồ", "o");
  displayType.replace("ỗ", "o");
  displayType.replace("ổ", "o");
  displayType.replace("ộ", "o");
  displayType.replace("ớ", "o");
  displayType.replace("ờ", "o");
  displayType.replace("ỡ", "o");
  displayType.replace("ở", "o");
  displayType.replace("ợ", "o");
  displayType.replace("ư", "u");
  displayType.replace("ú", "u");
  displayType.replace("ù", "u");
  displayType.replace("ũ", "u");
  displayType.replace("ủ", "u");
  displayType.replace("ụ", "u");
  displayType.replace("ứ", "u");
  displayType.replace("ừ", "u");
  displayType.replace("ữ", "u");
  displayType.replace("ử", "u");
  displayType.replace("ự", "u");
  displayType.replace("ý", "y");
  displayType.replace("ỳ", "y");
  displayType.replace("ỹ", "y");
  displayType.replace("ỷ", "y");
  displayType.replace("ỵ", "y");
  displayType.replace("đ", "d");
  displayType.replace("Đ", "D");
  displayType.toUpperCase();
  
  // Rút gọn tên sản phẩm nếu quá dài (cho size 2)
  if (displayType.length() > 5) {
    displayType = displayType.substring(0, 4) + "..";
  }
  
  //  DÒNG 1: Mã sản phẩm bên trái (Size 2)
  dma_display->setTextSize(1.2);
  dma_display->setTextColor(myYELLOW);
  dma_display->setCursor(1, 2);
  
  // Hiển thị mã sản phẩm nếu có, nếu không thì hiển thị tên sản phẩm rút gọn
  String displayText = (productCode != "") ? productCode : displayType;
  dma_display->print(displayText);

  // SỐ ĐẾM LỚN BÊN PHẢI DÒNG 1 (Size 3, màu đỏ)
  String countStr = String((int)totalCount);
  dma_display->setTextSize(4);
  dma_display->setTextColor(myRED);  // Màu đỏ theo yêu cầu
  
  // Tính toán vị trí căn phải
  int16_t x1, y1;
  uint16_t w, h;
  dma_display->getTextBounds(countStr, 0, 0, &x1, &y1, &w, &h);
  
  // Đặt ở bên phải màn hình
  int totalWidth = PANEL_RES_X * PANEL_CHAIN;
  int x = totalWidth - w - 2;  // 2 pixel margin từ bên phải
  int y = 1;  // Căn với dòng 1
  
  dma_display->setCursor(x, y);
  dma_display->print(countStr);
  
  // DÒNG 2: Hiển thị "XUẤT" hoặc "NHẬP" theo mode với số lượng đơn hàng hiện tại (Size 2)
  dma_display->setTextSize(2);
  dma_display->setTextColor(myCYAN);
  dma_display->setCursor(1, 18);  // Dòng 2 ở y=18
  
  // Hiển thị prefix theo mode và số lượng kế hoạch của đơn hàng hiện tại
  String line2;
  if (currentMode == "output") {
    line2 = "X:" + String(targetCount);  // XUẤT mode
  } else {
    line2 = "N:" + String(targetCount);  // NHẬP mode
  }
  dma_display->print(line2);
  
  needUpdate = false;
}

//----------------------------------------Display Current Order Info Function
void displayCurrentOrderInfo() {
  // Gọi updateDisplay để cập nhật thông tin hiện tại
  needUpdate = true;
  updateDisplay();
}

//----------------------------------------Connecting Display Function
void showConnectingDisplay() {
  if (!dma_display) {
    Serial.println("dma_display is null!");
    return;
  }
  
  if (!showConnectingAnimation) {
    Serial.println("showConnectingAnimation is false");
    return;
  }
  
  if (systemConnected) {
    Serial.println("systemConnected is true");
    return;
  }
  
  // Animation mỗi 1000ms (chậm hơn để giảm xung đột)
  if (connectingAnimationTime == 0 || millis() - connectingAnimationTime > 1000) {
    connectingAnimationTime = millis();
    connectingDots = (connectingDots + 1) % 4; // 0-3 dots
    
    dma_display->clearScreen();
    
    // Hiển thị "CONNECTING" đơn giản hơn
    dma_display->setTextSize(1);
    dma_display->setTextColor(myYELLOW);
    dma_display->setCursor(8, 10);
    dma_display->print("BO DEM THONG MINH");
    
    // Hiển thị dots đơn giản
    dma_display->setTextSize(1);
    dma_display->setTextColor(myCYAN);
    dma_display->setCursor(8, 20);
    
    // Hiển thị dots đơn giản
    for (int i = 0; i < connectingDots; i++) {
      dma_display->print(".");
    }
    
    Serial.println("Connecting display updated successfully with " + String(connectingDots) + " dots");
  }
}

//----------------------------------------Set System Connected
void setSystemConnected() {
  if (!systemConnected) {
    systemConnected = true;
    showConnectingAnimation = false;
    needUpdate = true;  // Trigger display update to normal layout
    
    Serial.println("System fully connected - switching to normal display");
    
    // Cập nhật display ngay
    updateDisplay();
  }
}

void updateCount() {
  Serial.println("DEBUG updateCount: called, isLimitReached=" + String(isLimitReached));
  
  if (!isLimitReached) {
    totalCount++;
    Serial.println("DEBUG updateCount: incremented totalCount to " + String(totalCount));
    
    // Cập nhật executeCount trong ordersData cho đơn hàng hiện tại
    JsonArray ordersArray = ordersData.as<JsonArray>();
    for (size_t i = 0; i < ordersArray.size(); i++) {
      JsonObject orderData = ordersArray[i];
      if (orderData["id"].as<String>() == bagType) {
        int currentExecuteCount = orderData["executeCount"] | 0;
        orderData["executeCount"] = currentExecuteCount + 1;
        Serial.println("Updated executeCount for order '" + bagType + "': " + String(currentExecuteCount + 1));
        break;
      }
    }
    
    // Lưu ordersData sau khi cập nhật executeCount
    saveOrdersToFile();
    
    // MQTT: Publish count update ngay lập tức
    publishCountUpdate();
    
    // Kiểm tra ngưỡng cảnh báo và cập nhật đèn DONE
    for (auto& cfg : bagConfigs) {
      if (cfg.type == bagType) {
        int warningThreshold = cfg.target - cfg.warn;
        if (totalCount >= warningThreshold && totalCount < targetCount) {
          Serial.println("Đạt ngưỡng cảnh báo!");
          
          // MQTT: Publish warning alert
          publishAlert("WARNING", "Đạt ngưỡng cảnh báo: " + String(totalCount) + "/" + String(targetCount));
          
          updateDoneLED();
        }
        break;
      }
    }
    
    // Kiểm tra đạt mục tiêu - CHỈ KHI CÓ TARGET HỢP LỆ VÀ ĐÃ THỰC SỰ ĐẾM
    if (totalCount >= targetCount && targetCount > 0 && totalCount > 0) {
      isLimitReached = true;
      finishedBlinking = false;
      blinkCount = 0;
      isBlinking = true;
      lastBlink = millis();
      
      // Lưu lịch sử với thêm thông tin loại - chỉ khi có thời gian thực
      String currentTime = (time(nullptr) > 24 * 3600) ? getTimeStr() : "Time not synced";
      history.push_back({currentTime, (int)totalCount, bagType});
      
      // Đánh dấu DONE cho loại hiện tại
      for (auto& c : bagConfigs) {
        if (c.type == bagType) {
          c.status = "DONE";
          break;
        }
      }
      saveBagConfigsToFile();
      
      // MQTT: Publish completion alert
      publishAlert("COMPLETED", "Hoàn thành đơn hàng: " + bagType + " - " + String(totalCount) + " bao");
      
      // DEBUG: Check auto reset status
      Serial.println("DEBUG Auto Reset: enabled=" + String(autoReset) + ", totalCount=" + String(totalCount) + ", targetCount=" + String(targetCount));
      
      // BẮT ĐẦU RELAY DELAY TIMER
      isOrderComplete = true;
      orderCompleteTime = millis();
      isRelayDelayActive = true;
      Serial.println("🔌 ORDER COMPLETED - Starting relay delay: " + String(relayDelayAfterComplete) + "ms");
      
      // MQTT: Publish final status
      publishStatusMQTT();
      
      // Auto Reset nếu được bật từ settings - CHỈ RESET ĐƠN HÀNG HIỆN TẠI
      // THÊM CHECK: Chỉ auto reset khi thực sự hoàn thành đơn hàng (target > 0 và đã đếm xong)
      if (autoReset && totalCount >= targetCount && targetCount > 0 && totalCount > 0) {
        Serial.println("Auto Reset enabled - resetting CURRENT ORDER only");
        delay(2000); // Chờ 2 giây để hiển thị kết quả hoàn thành
        
        //  CHỈ RESET ĐƠN HÀNG HIỆN TẠI, GIỮ NGUYÊN DANH SÁCH
        String completedOrderType = bagType;  // Lưu tên đơn vừa hoàn thành
        
        // Reset CHỈ số đếm, GIỮ NGUYÊN trạng thái running
        totalCount = 0;
        isLimitReached = false;
        // KHÔNG RESET: isRunning, isTriggerEnabled, isCountingEnabled
        // Giữ nguyên trạng thái đang chạy để tiếp tục đếm đơn tiếp theo
        
        Serial.println("Reset count to 0, keep running state for next order");
        
        // CLEAR RELAY DELAY STATE
        isOrderComplete = false;
        isRelayDelayActive = false;
        orderCompleteTime = 0;
        Serial.println("🔌 RELAY DELAY STATE CLEARED");
        
        // Mark order as completed in ordersData (bagConfigs will sync automatically)
        Serial.println("Order '" + completedOrderType + "' marked as COMPLETED");
        
        //  TỰ ĐỘNG CHUYỂN SANG ĐƠN HÀNG TIẾP THEO THEO ORDER NUMBER
        bool foundNextOrder = false;
        Serial.println("Searching for next order by orderNumber...");
        
        // Tìm orderNumber hiện tại từ ordersData
        int currentOrderNumber = 0;
        String currentBatchIdStr = "";
        
        // Duyệt ordersData để tìm đơn hàng hiện tại đang đếm
        for (size_t i = 0; i < ordersData.size(); i++) {
          JsonArray orders = ordersData[i]["orders"];
          currentBatchIdStr = ordersData[i]["id"].as<String>();
          
          for (size_t j = 0; j < orders.size(); j++) {
            JsonObject order = orders[j];
            String status = order["status"].as<String>();
            bool selected = order["selected"] | false;
            
            if (status == "counting" && selected) {
              currentOrderNumber = order["orderNumber"] | 0;
              Serial.println("Current order found: orderNumber=" + String(currentOrderNumber));
              break;
            }
          }
          if (currentOrderNumber > 0) break;
        }
        
        // Tìm đơn hàng tiếp theo (orderNumber + 1) trong các đơn được chọn
        int nextOrderNumber = currentOrderNumber + 1;
        Serial.println("Looking for next order with orderNumber=" + String(nextOrderNumber));
        
        for (size_t i = 0; i < ordersData.size(); i++) {
          JsonArray orders = ordersData[i]["orders"];
          
          for (size_t j = 0; j < orders.size(); j++) {
            JsonObject order = orders[j];
            int orderNumber = order["orderNumber"] | 0;
            bool selected = order["selected"] | false;
            String status = order["status"].as<String>();
            
            // Tìm đơn có orderNumber tiếp theo và được chọn
            if (orderNumber == nextOrderNumber && selected && status != "completed") {
              // CẬP NHẬT THÔNG TIN ĐƠN MỚI
              String productName = order["productName"].as<String>();
              String newProductCode = "";
              if (order.containsKey("product") && order["product"].containsKey("code")) {
                newProductCode = order["product"]["code"].as<String>();
              }
              int quantity = order["quantity"] | 1;
              int warningQuantity = order["warningQuantity"].as<int>() | 5; // Mặc định 5 nếu không có
              
              Serial.println("Found next order with warningQuantity: " + String(warningQuantity));
              
              // Cập nhật hoặc tạo mới BagConfig với đúng warningQuantity
              bool foundBagConfig = false;
              for (auto& cfg : bagConfigs) {
                if (cfg.type == productName) {
                  cfg.target = quantity;
                  cfg.warn = warningQuantity;  // Cập nhật warning từ order data
                  cfg.status = "RUNNING";
                  foundBagConfig = true;
                  Serial.println("Updated existing bagConfig with warn: " + String(warningQuantity));
                  break;
                }
              }
              
              if (!foundBagConfig) {
                // Tạo mới bagConfig
                BagConfig newCfg;
                newCfg.type = productName;
                newCfg.target = quantity;
                newCfg.warn = warningQuantity;
                newCfg.status = "RUNNING";
                bagConfigs.push_back(newCfg);
                Serial.println("Created new bagConfig with warn: " + String(warningQuantity));
              }
              
              // Cập nhật trạng thái đơn cũ thành completed
              for (size_t x = 0; x < ordersData.size(); x++) {
                JsonArray oldOrders = ordersData[x]["orders"];
                for (size_t y = 0; y < oldOrders.size(); y++) {
                  JsonObject oldOrder = oldOrders[y];
                  if (oldOrder["orderNumber"] == currentOrderNumber && oldOrder["selected"]) {
                    oldOrder["status"] = "completed";
                    break;
                  }
                }
              }
              
              // Cập nhật trạng thái đơn mới thành counting
              order["status"] = "counting";
              
              // CẬP NHẬT BIẾN HIỂN THỊ
              bagType = productName;
              productCode = newProductCode;
              targetCount = quantity;
              totalCount = 0;  // Reset số đếm về 0
              isLimitReached = false;
              
              foundNextOrder = true;
              
              Serial.println("Auto switched to next order:");
              Serial.println("   OrderNumber: " + String(nextOrderNumber));
              Serial.println("   ProductName: " + productName);
              Serial.println("   ProductCode: " + newProductCode);
              Serial.println("   Target: " + String(quantity) + " bags");
              Serial.println("   Count reset to 0, continue running");
              
              // Lưu thay đổi vào file
              saveOrdersToFile();
              break;
            }
          }
          if (foundNextOrder) break;
        }
        
        if (!foundNextOrder) {
          // Không còn đơn hàng nào tiếp theo → DỪNG HẾT, KHÔNG RESTART
          Serial.println("No more orders in current batch - All orders completed!");
          Serial.println("Stopping system - Use batchSelector to choose next batch");
          
          // DỪNG HOÀN TOÀN hệ thống
          isRunning = false;
          isTriggerEnabled = false;
          isCountingEnabled = false;
          
          // Reset count về 0
          totalCount = 0;
          isLimitReached = true; // Đánh dấu đã hoàn thành
          
          // Thông báo hoàn thành batch
          publishAlert("BATCH_COMPLETED", "Hoàn thành tất cả đơn hàng trong batch hiện tại!");
          
          Serial.println("Batch completed - System stopped. Please select new batch to continue.");
        } else {
          // Đã tìm thấy đơn tiếp theo - gửi thông tin lên web
          loadCurrentOrderForDisplay();
          publishCountUpdate();
          publishBagConfigs();
          
          Serial.println("Sent new order info to web interface");
        }
        
        // Keep bagConfigs sync for legacy compatibility
        saveBagConfigsToFile();
        updateStartLED();
        updateDoneLED();
        needUpdate = true;
        
        Serial.println("Auto Reset completed - ready for next order");
        publishAlert("AUTO_RESET", "Đơn hàng '" + completedOrderType + "' hoàn thành. " + 
                    (foundNextOrder ? "Chuyển sang: " + bagType : "Hết đơn hàng"));
      } else {
        Serial.println("Auto Reset disabled - attempting manual order switch");
        
        // Manual order switching logic khi autoReset = false
        String completedOrderType = bagType;
        
        // Đánh dấu đơn hiện tại hoàn thành
        for (auto& cfg : bagConfigs) {
          if (cfg.type == completedOrderType) {
            cfg.status = "COMPLETED";
            Serial.println("Manual: Order '" + completedOrderType + "' marked as COMPLETED");
            break;
          }
        }
        
        // Tìm đơn hàng tiếp theo
        bool foundNextOrder = false;
        Serial.println("Manual search for next order...");
        
        for (auto& cfg : bagConfigs) {
          Serial.println("   Order: " + cfg.type + " | Status: " + cfg.status + " | Target: " + String(cfg.target));
        }
        
        for (auto& cfg : bagConfigs) {
          if (cfg.status == "WAIT" || cfg.status == "SELECTED" || (cfg.status == "RUNNING" && cfg.type != completedOrderType)) {
            bagType = cfg.type;
            targetCount = cfg.target;
            cfg.status = "COUNTING";
            totalCount = 0;
            
            // CẬP NHẬT PRODUCT CODE từ bagType (cho manual mode)
            int underscorePos = bagType.lastIndexOf('_');
            if (underscorePos > 0) {
              String productName = bagType.substring(0, underscorePos);
              productCode = bagType.substring(underscorePos + 1);
              Serial.println("Manual - Extracted: productName='" + productName + "', productCode='" + productCode + "'");
            } else {
              productCode = "1"; // Fallback
            }
            
            // GIỮ NGUYÊN trạng thái running
            isLimitReached = false;
            
            foundNextOrder = true;
            
            Serial.println("Manual switched to next order: " + bagType);
            Serial.println("   ProductCode: " + productCode);
            Serial.println("   Count reset to 0, continue running");
            loadCurrentOrderForDisplay();
            publishCountUpdate();
            publishBagConfigs();
            break;
          }
        }
        
        if (!foundNextOrder) {
          Serial.println("No orders available for manual switch");
        }
      }
      
      // Legacy MQTT (giữ lại để tương thích)
      DynamicJsonDocument doc(256);
      doc["count"] = totalCount;
      doc["time"] = currentTime;
      doc["type"] = bagType;
      String msg;
      serializeJson(doc, msg);
      mqtt.publish("bagcounter/status", msg.c_str());
    }
  }
}

void updateDoneLED() {
  // Đèn DONE (GPIO 5) với logic Active HIGH - BẬT khi đạt ngưỡng cảnh báo hoặc hoàn thành
  doneLedOn = false; // Mặc định TẮT
  
  for (auto& cfg : bagConfigs) {
    if (cfg.type == bagType) {
      // Kiểm tra ngưỡng cảnh báo được set từ web
      int warningThreshold = cfg.target - cfg.warn;  // Số bao còn lại để cảnh báo
      
      // Kiểm tra ngưỡng cảnh báo
      if (totalCount >= warningThreshold && totalCount < cfg.target) {
        // Đạt ngưỡng cảnh báo
        if (!hasReachedWarningThreshold) {
          // Lần đầu đạt ngưỡng cảnh báo
          hasReachedWarningThreshold = true;
          isWarningLedActive = true;
          warningLedStartTime = millis();
          doneLedOn = true;  // BẬT LED cảnh báo
          Serial.println("🚨 WARNING THRESHOLD REACHED! LED ON for 5 seconds");
          Serial.println("   Count: " + String(totalCount) + "/" + String(cfg.target) + 
                        ", Warning at: " + String(warningThreshold));
        } else if (isWarningLedActive) {
          // Đang trong thời gian cảnh báo 5 giây
          if (millis() - warningLedStartTime < 5000) {
            doneLedOn = true;  // Giữ LED BẬT trong 5 giây
          } else {
            // Hết 5 giây, tắt LED cảnh báo
            isWarningLedActive = false;
            doneLedOn = false;
            Serial.println("⏰ Warning LED timeout - LED OFF");
          }
        }
      } else if (totalCount >= cfg.target) {
        // Hoàn thành đơn hàng - BẬT LED liên tục
        doneLedOn = true;
        isWarningLedActive = false;  // Reset warning state
        hasReachedWarningThreshold = false;
        Serial.println("✅ ORDER COMPLETED - LED ON");
      } else {
        // Chưa đạt ngưỡng cảnh báo - TẮT LED
        doneLedOn = false;
        isWarningLedActive = false;
        hasReachedWarningThreshold = false;
      }
      
      digitalWrite(DONE_LED_PIN, doneLedOn ? HIGH : LOW);  // Active HIGH logic
      
      // Debug info
      static bool lastDoneState = false;
      static unsigned long lastDebugTime = 0;
      if (doneLedOn != lastDoneState || (millis() - lastDebugTime > 10000)) {
        lastDoneState = doneLedOn;
        lastDebugTime = millis();
        
        String reason = "";
        if (totalCount >= cfg.target) {
          reason = "COMPLETED";
        } else if (isWarningLedActive) {
          reason = "WARNING (5s timer)";
        } else if (hasReachedWarningThreshold) {
          reason = "WARNING (timeout)";
        } else {
          reason = "NORMAL";
        }
        
        Serial.println("💡 DONE LED: " + String(doneLedOn ? "ON" : "OFF") + 
                      " - Count: " + String(totalCount) + 
                      "/" + String(cfg.target) + 
                      ", Warning at: " + String(warningThreshold) +
                      " (" + reason + ")");
      }
      break;
    }
  }
}

void updateStartLED() {
  // Đèn START (GPIO 38 - relay) logic cập nhật:
  // - Sáng (LOW) khi: isRunning = true HOẶC đang trong thời gian relay delay
  // - Tắt (HIGH) khi: isRunning = false VÀ không trong thời gian relay delay
  
  if (isRunning || isRelayDelayActive) {
    startLedOn = true;  // Sáng (LOW) - relay hoạt động
  } else {
    startLedOn = false; // Tắt (HIGH) - relay ngưng
  }
  
  digitalWrite(START_LED_PIN, startLedOn ? HIGH : LOW);
  
  // Debug relay state
  static bool lastRelayState = false;
  if (startLedOn != lastRelayState) {
    lastRelayState = startLedOn;
    String reason = "";
    if (isRunning) reason = "System Running";
    else if (isRelayDelayActive) reason = "Relay Delay Active";
    else reason = "System Stopped";
    
    Serial.println("🔌 RELAY STATE: " + String(startLedOn ? "ON" : "OFF") + " - Reason: " + reason);
  }
}

//----------------------------------------SETUP & LOOP
void setup() {
  // Tắt brownout detector để tránh reset do điện áp thấp
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);
  
  // Disable watchdog timer to prevent resets during heavy processing
  esp_task_wdt_init(30, false); // 30 second timeout, no panic
  
  Serial.begin(115200);
  Serial.println("Booting ESP32 Bag Counter System...");
  
  // Print free heap at startup
  Serial.println("Free heap at startup: " + String(ESP.getFreeHeap()) + " bytes");
  
  // BƯỚC 1: Khởi tạo LittleFS
  if (!LittleFS.begin()) {
    Serial.println("LittleFS failed!");
    while (1);
  }
  Serial.println("LittleFS initialized");
  
  // BƯỚC 2: Tạo các file mặc định LẦN ĐẦU (nếu chưa có)
  Serial.println("Checking and creating default files...");
  createDefaultDataFiles();  // Tạo products, orders, history nếu chưa có
  
  // BƯỚC 3: Load cấu hình từ file (với đảm bảo file tồn tại)
  Serial.println("Loading configurations from files...");
  loadBagTypesFromFile();
  loadBagConfigsFromFile();
  loadBatchInfoFromFile(); // Thêm load batch info
  loadSettingsFromFile();  // Load settings (file đã được tạo nếu chưa có)
  loadProductsFromFile();  // Load products data
  loadOrdersFromFile();    // Load orders data
  
  // BƯỚC QUAN TRỌNG: Debug và Force Refresh Settings
  Serial.println("🔍 POST-LOAD DEBUG:");
  debugSettingsFile();
  
  // FORCE REFRESH để đảm bảo settings được áp dụng đúng
  Serial.println("🔄 Force refreshing settings...");
  // NOTE: dma_display chưa được khởi tạo ở đây, sẽ xử lý brightness sau
  
  // Đồng bộ debounce delay với sensorDelayMs  
  debounceDelay = sensorDelayMs;
  
  Serial.println("All configurations loaded and verified:");
  Serial.println("  - location: " + location);
  Serial.println("  - conveyorName: " + conveyorName);
  Serial.println("  - brightness: " + String(displayBrightness) + "%");
  Serial.println("  - sensorDelay: " + String(sensorDelayMs) + "ms");
  Serial.println("  - bagDetectionDelay: " + String(bagDetectionDelay) + "ms");
  Serial.println("  - minBagInterval: " + String(minBagInterval) + "ms");
  Serial.println("  - autoReset: " + String(autoReset ? "true" : "false"));
  Serial.println("  - products: " + String(productsData.size()) + " items");
  Serial.println("  - orders: " + String(ordersData.size()) + " items");
  Serial.println("  - relayDelayAfterComplete: " + String(relayDelayAfterComplete) + "ms");
  // BƯỚC 3: Khởi tạo hardware
  pinMode(SENSOR_PIN, INPUT_PULLUP);
  pinMode(TRIGGER_SENSOR_PIN, INPUT);
  pinMode(START_LED_PIN, OUTPUT);
  pinMode(DONE_LED_PIN, OUTPUT);
  
  // Khởi tạo IR Remote
  irrecv.enableIRIn();
  Serial.println("✅ IR Remote initialized");
  
  // Tắt LED ban đầu
  digitalWrite(START_LED_PIN, LOW);  // Đèn START tắt (HIGH)
  digitalWrite(DONE_LED_PIN, LOW);   // Đèn DONE tắt (HIGH)
  
  // BƯỚC 4: Khởi tạo các biến trạng thái
  isRunning = false;
  isTriggerEnabled = false;
  isCountingEnabled = false;
  isLimitReached = false;
  totalCount = 0;
  
  // BƯỚC 5: Khởi tạo LED Matrix display TRƯỚC network
  Serial.println("Initializing LED Matrix display...");
  HUB75_I2S_CFG::i2s_pins _pins={R1_PIN, G1_PIN, B1_PIN, R2_PIN, G2_PIN, B2_PIN, A_PIN, B_PIN, C_PIN, D_PIN, E_PIN, LAT_PIN, OE_PIN, CLK_PIN};
  HUB75_I2S_CFG mxconfig(PANEL_RES_X, PANEL_RES_Y, PANEL_CHAIN, _pins);
  
  // Cấu hình để tránh xung đột với WiFi - tối ưu hóa timing
  mxconfig.i2sspeed = HUB75_I2S_CFG::HZ_8M;   // Giảm thêm tốc độ để tránh xung đột với WiFi
  mxconfig.latch_blanking = 6;                 // Tăng latch blanking để ổn định hơn
  mxconfig.clkphase = false;                   // Clock phase
  mxconfig.double_buff = false;                // DISABLE double buffering để fix LED không sáng
  // Giảm tốc độ I2S xuống 8MHz để tránh xung đột với WiFi 2.4GHz
  
  dma_display = new MatrixPanel_I2S_DMA(mxconfig);
  
  // Kiểm tra khởi tạo thành công
  if (!dma_display) {
    Serial.println("FAILED to create LED Matrix display!");
    return;
  }
  
  dma_display->begin();
  Serial.println("LED Matrix display object created successfully");
  
  // CRITICAL: Force enable output và kiểm tra OE pin
  Serial.println("Checking OE_PIN (Output Enable)...");
  pinMode(OE_PIN, OUTPUT);
  digitalWrite(OE_PIN, LOW);  // FORCE LOW để enable output
  Serial.println("OE_PIN forced to LOW (enabled)");
  
  // Delay để đảm bảo hardware stable
  delay(100);
  
  // Áp dụng brightness từ settings (không giới hạn quá thấp)
  if (displayBrightness >= 10 && displayBrightness <= 100) {
    // Sử dụng brightness từ settings, không giới hạn thấp quá
    int adjustedBrightness = displayBrightness; // Dùng brightness gốc 35%
    dma_display->setBrightness8(map(adjustedBrightness, 0, 100, 0, 255));
    Serial.println("Display brightness applied: " + String(adjustedBrightness) + "% (from settings)");
  } else {
    Serial.println("Invalid brightness value, using 35%");
    displayBrightness = 35;
    dma_display->setBrightness8(map(35, 0, 100, 0, 255));
  }
  
  // Khởi tạo colors cho display
  myBLACK = dma_display->color565(0, 0, 0);
  myWHITE = dma_display->color565(255, 255, 255);
  myRED = dma_display->color565(255, 0, 0);
  myGREEN = dma_display->color565(0, 255, 0);
  myBLUE = dma_display->color565(0, 0, 255);
  myYELLOW = dma_display->color565(255, 255, 0);
  myCYAN = dma_display->color565(0, 255, 255);
  
  // Test LED matrix cơ bản
  Serial.println("Testing LED Matrix...");
  dma_display->clearScreen();
  
  // Test với fill màu sáng
  dma_display->fillScreen(myWHITE);
  delay(1000);
  dma_display->fillScreen(myRED);
  delay(1000);
  dma_display->clearScreen();
  
  // Test text
  dma_display->setTextSize(2);
  dma_display->setTextColor(myGREEN);
  dma_display->setCursor(0, 0);
  dma_display->print("READY");
  delay(2000);
  Serial.println("LED Matrix test completed");
  
  // Hiển thị "Connecting" NGAY LẬP TỨC và LIÊN TỤC
  showConnectingAnimation = true;
  systemConnected = false;
  connectingAnimationTime = 0; // Bắt buộc update ngay lần đầu
  connectingDots = 0;
  
  // Hiển thị Connecting ngay lập tức (không chờ timer)
  dma_display->clearScreen();
  dma_display->setTextSize(1);
  dma_display->setTextColor(myYELLOW);
  dma_display->setCursor(5, 8);
  dma_display->print("CONNECTING");
  dma_display->setTextSize(2);
  dma_display->setTextColor(myCYAN);
  dma_display->setCursor(40, 20);
  dma_display->print(".");
  
  Serial.println("Displaying 'Connecting' while initializing services...");
  delay(1000); // Cho user thấy "Connecting" trước khi bắt đầu init services
  
  // BƯỚC 6: Khởi tạo network và services
  Serial.println("Starting network setup...");
  
  setupNetwork();
  Serial.println("Network initialized");
  delay(1000); // Chờ network ổn định
  
  // Chỉ setup MQTT khi có kết nối Internet (không phải AP mode)
  if (currentNetworkMode != WIFI_AP_MODE) {
    Serial.println("Starting MQTT setup...");
    setupMQTT();
    Serial.println("MQTT initialized");
    delay(1000); // Chờ MQTT ổn định
  } else {
    Serial.println("kipping MQTT setup (AP mode - no Internet connection)");
  }
  
  // Chỉ setup Time sync khi có kết nối Internet
  if (currentNetworkMode != WIFI_AP_MODE) {
    Serial.println("Starting Time sync setup...");
    setupTime();
    Serial.println("Time sync initialized");
    delay(1000); // Chờ Time sync ổn định
  } else {
    Serial.println("Skipping Time sync (AP mode - no Internet connection)");
  }
  
  Serial.println("Starting Web server setup...");
  setupWebServer();
  Serial.println("Web server initialized");
  delay(1000); // Chờ Web server ổn định
  
  // KẾT THÚC NETWORK SETUP - CHO PHÉP LED MATRIX HOẠT ĐỘNG LẠI
  Serial.println("All network services ready - LED Matrix can resume");
  
  // 🎉 Tất cả services đã sẵn sàng - hiển thị "Connecting" ít hơn để giảm flicker
  Serial.println("All services ready! Showing connecting animation for 3 more seconds...");
  unsigned long finishTime = millis() + 3000; // Giảm từ 5 xuống 3 giây
  while (millis() < finishTime) {
    showConnectingDisplay();
    delay(200); // Tăng delay từ 50ms lên 200ms để giảm flicker
    Serial.print("."); // Show progress
  }
  Serial.println(); // New line after dots
  
  setSystemConnected();
  
  // FORCE UPDATE LED MATRIX NGAY SAU KHI SETUP XONG
  Serial.println("Force updating LED display after setup...");
  needUpdate = true;
  updateDisplay();
  
  Serial.println("Setup completed successfully!");
  Serial.println("System ready - Web interface available");
  
  // Hiển thị IP đúng theo network mode
  String ipAddress = "Unknown";
  if (currentNetworkMode == ETHERNET_MODE) {
    ipAddress = ETH.localIP().toString();
  } else if (currentNetworkMode == WIFI_STA_MODE) {
    ipAddress = WiFi.localIP().toString();
  } else if (currentNetworkMode == WIFI_AP_MODE) {
    ipAddress = WiFi.softAPIP().toString();
  }
  
  Serial.println("IP: " + ipAddress);
  Serial.println("Network Mode: " + String(currentNetworkMode == ETHERNET_MODE ? "Ethernet" : 
                                            currentNetworkMode == WIFI_STA_MODE ? "WiFi STA" : "WiFi AP"));
  
  // Hiển thị trạng thái dữ liệu
  printDataStatus();
  
  // Debug settings file 
  debugSettingsFile();
}

void loop() {
  // Update LED display LUÔN LUÔN nếu cần thiết
  if (needUpdate || (millis() - lastUpdate > 1000)) { // Update mỗi 1 giây thay vì 2 giây
    updateDisplay();
    updateStartLED();  // Luôn cập nhật đèn START
    lastUpdate = millis();
    needUpdate = false; // Reset flag
  }
  
  // Cập nhật animation "Connecting" nếu chưa kết nối xong
  if (!systemConnected && dma_display) {
    showConnectingDisplay();
  }

  // FORCE SET needUpdate = true periodically để đảm bảo LED luôn update
  static unsigned long lastForceUpdate = 0;
  if (millis() - lastForceUpdate > 5000) { // Force update mỗi 5 giây
    needUpdate = true;
    lastForceUpdate = millis();
  }
  
  // RELAY DELAY TIMER - Kiểm tra và tắt relay sau khi hoàn thành đơn hàng
  if (isRelayDelayActive && isOrderComplete) {
    if (millis() - orderCompleteTime >= relayDelayAfterComplete) {
      // Hết thời gian delay, tắt relay
      isRelayDelayActive = false;
      isOrderComplete = false;
      Serial.println("🔌 RELAY DELAY FINISHED - Relay can now be turned OFF");
      // Relay sẽ được tắt trong updateStartLED() khi không còn đơn hàng nào chạy
    }
  }
  
  // Xử lý IR Remote
  if (irrecv.decode(&results)) {
    unsigned long now = millis();
    unsigned long code = results.value;

    // Bỏ qua mã lặp 0xFFFFFFFF
    if (code == 0xFFFFFFFF) {
      irrecv.resume();
    } else {
      // Chống nhấn lặp quá nhanh
      if (now - lastIRTime > debounceIRTime || code != lastIRCode) {
        lastIRTime = now;
        lastIRCode = code;

        unsigned long btn = mapIRButton(code);
        if (btn > 0) {
          Serial.print("IR Remote - Nhan nut: ");
          Serial.println(btn);
          Serial.print("IR Remote - Ma hex: 0x");
          Serial.println(code, HEX);
          Serial.print("Trang thai truoc khi xu ly - isRunning: ");
          Serial.print(isRunning);
          Serial.print(", isTriggerEnabled: ");
          Serial.print(isTriggerEnabled);
          Serial.print(", isCountingEnabled: ");
          Serial.println(isCountingEnabled);
          handleIRCommand(btn);
          Serial.print("Trang thai sau khi xu ly - isRunning: ");
          Serial.print(isRunning);
          Serial.print(", isTriggerEnabled: ");
          Serial.print(isTriggerEnabled);
          Serial.print(", isCountingEnabled: ");
          Serial.println(isCountingEnabled);
        } else {
          Serial.print("IR Remote - Ma khong xac dinh: 0x");
          Serial.println(code, HEX);
        }
      }
    }
    irrecv.resume(); // Chuẩn bị nhận tiếp
  }

  // Chỉ xử lý cảm biến khởi động khi được kích hoạt
  if (isTriggerEnabled) {
    int triggerReading = digitalRead(TRIGGER_SENSOR_PIN);
    
    if (triggerReading != lastTriggerState) {
      lastDebounceTime = millis();
    }
    
    if ((millis() - lastDebounceTime) > debounceDelay) {
      if (triggerReading != triggerState) {
        triggerState = triggerReading;
        if (triggerState == LOW) {  // Khi phát hiện vật thể
          isCountingEnabled = true;  // Kích hoạt cảm biến đếm
          Serial.println("TRIGGER SENSOR: Phat hien vat the -> Kich hoat dem!");
          Serial.print("isCountingEnabled = ");
          Serial.println(isCountingEnabled);
        } else {
          Serial.println("TRIGGER SENSOR: Khong con vat the");
        }
      }
    }
    lastTriggerState = triggerReading;
  }

  // Chỉ đếm khi được kích hoạt - SỬ DỤNG SETTINGS ĐỒNG BỘ
  if (isCountingEnabled && isRunning && !isLimitReached) {
    int reading = digitalRead(SENSOR_PIN);
    
    // Sử dụng sensorDelayMs từ settings thay vì debounceDelay cố định
    if (reading != lastSensorState) {
      lastDebounceTime = millis();
    }
    
    if ((millis() - lastDebounceTime) > sensorDelayMs) {
      if (reading != sensorState) {
        sensorState = reading;
        
        if (sensorState == LOW) {  // Phát hiện bao
          unsigned long currentTime = millis();
          
          // Kiểm tra khoảng cách tối thiểu giữa 2 bao (minBagInterval từ settings)
          if (currentTime - lastBagTime >= minBagInterval) {
            
            if (!isBagDetected) {
              // Bắt đầu phát hiện bao mới
              isBagDetected = true;
              bagStartTime = currentTime;
              Serial.print("BẮT ĐẦU phát hiện bao - thời gian xác nhận: ");
              Serial.print(bagDetectionDelay);
              Serial.println("ms");
            }
            
          } else {
            Serial.print("Chờ khoảng cách tối thiểu (");
            Serial.print(minBagInterval);
            Serial.print("ms), còn lại: ");
            Serial.print(minBagInterval - (currentTime - lastBagTime));
            Serial.println("ms");
          }
          
        } else {
          // Sensor không phát hiện
          if (isBagDetected) {
            unsigned long detectionDuration = millis() - bagStartTime;
            
            // Kiểm tra thời gian xác nhận đủ lâu (bagDetectionDelay từ settings)
            if (detectionDuration >= bagDetectionDelay) {
              // XÁC NHẬN BAO HỢP LỆ - ĐẾM!
              Serial.print("XÁC NHẬN BAO! Thời gian phát hiện: ");
              Serial.print(detectionDuration);
              Serial.print("ms >= ");
              Serial.print(bagDetectionDelay);
              Serial.print("ms. Count: ");
              Serial.print(totalCount);
              Serial.print(" -> ");
              Serial.println(totalCount + 1);
              
              updateCount();
              needUpdate = true;
              lastBagTime = millis();
              
              // MQTT: Publish sensor data khi đếm thành công
              publishSensorData();
              
            } else {
              Serial.print("BAO KHÔNG HỢP LỆ - thời gian quá ngắn: ");
              Serial.print(detectionDuration);
              Serial.print("ms < ");
              Serial.print(bagDetectionDelay);
              Serial.println("ms");
            }
            
            isBagDetected = false;
          }
        }
      }
    }
    lastSensorState = reading;
    
  } else if (isCountingEnabled && !isRunning) {
    // Đã kích hoạt counting nhưng hệ thống đang pause
    int reading = digitalRead(SENSOR_PIN);
    if (reading == LOW) {
      Serial.println("Phát hiện bao nhưng hệ thống đang PAUSE");
    }
  }

  if (isLimitReached && !finishedBlinking) {
    if (isBlinking && millis() - lastBlink >= 250) {
      blinkCount++;
      lastBlink = millis();
      if (blinkCount >= 10) {
        isBlinking = false;
        finishedBlinking = true;
      }
      needUpdate = true;
    }
  }

  // Kiểm tra và cập nhật thời gian bắt đầu nếu đang chờ đồng bộ
  if (timeWaitingForSync && time(nullptr) > 24 * 3600) {
    startTimeStr = getTimeStr();
    timeWaitingForSync = false;
    Serial.print("Time sync completed - Start time updated to: ");
    Serial.println(startTimeStr);
  }
  
  // 📡 MQTT Management với Smart Reconnection (chỉ khi không ở AP mode)
  if (currentNetworkMode != WIFI_AP_MODE && !mqtt.connected()) {
    static unsigned long lastReconnectAttempt = 0;
    static int reconnectAttempts = 0;
    static bool mqttErrorLogged = false;
    
    // Thời gian chờ động: càng thất bại nhiều, càng chờ lâu
    unsigned long reconnectInterval = 5000 + (reconnectAttempts * 2000); // 5s, 7s, 9s, 11s...
    if (reconnectInterval > 30000) reconnectInterval = 30000; // Tối đa 30s
    
    if (millis() - lastReconnectAttempt > reconnectInterval) {
      lastReconnectAttempt = millis();
      
      // Chỉ log chi tiết lần đầu hoặc mỗi 10 lần thất bại
      if (!mqttErrorLogged || reconnectAttempts % 10 == 0) {
        Serial.println("Attempting MQTT reconnection... (Attempt " + String(reconnectAttempts + 1) + ")");
        if (reconnectAttempts > 0) {
          Serial.println("Using interval: " + String(reconnectInterval/1000) + "s");
        }
        mqttErrorLogged = true;
      }
      
      bool connected = false;
      const char* current_broker = mqtt_use_backup ? mqtt_server_backup : mqtt_server;
      mqtt.setServer(current_broker, mqtt_port);
      
      String clientId = "ESP32_BagCounter_" + String(WiFi.macAddress());
      clientId.replace(":", "");
      
      if (mqtt.connect(clientId.c_str())) {
        Serial.println("MQTT reconnected successfully to: " + String(current_broker));
        reconnectAttempts = 0; // Reset counter
        mqttErrorLogged = false;
        
        // Re-subscribe
        mqtt.subscribe(TOPIC_CMD_START);
        mqtt.subscribe(TOPIC_CMD_PAUSE);
        mqtt.subscribe(TOPIC_CMD_RESET);
        mqtt.subscribe(TOPIC_CMD_SELECT);
        mqtt.subscribe(TOPIC_CMD_BATCH);
        mqtt.subscribe(TOPIC_CONFIG);
        publishHeartbeat();
        
      } else {
        reconnectAttempts++;
        if (reconnectAttempts == 1 || reconnectAttempts % 5 == 0) {
          Serial.println("MQTT reconnection failed (attempt " + String(reconnectAttempts) + ")");
        }
        
        // Thử backup broker sau 3 lần thất bại
        if (reconnectAttempts == 3 && !mqtt_use_backup) {
          Serial.println("Switching to backup broker: " + String(mqtt_server_backup));
          mqtt_use_backup = true;
          reconnectAttempts = 0; // Reset để thử backup
        }
        // Quay lại broker chính sau 10 lần thất bại với backup
        else if (reconnectAttempts >= 10 && mqtt_use_backup) {
          Serial.println("Switching back to main broker: " + String(mqtt_server));
          mqtt_use_backup = false;
          reconnectAttempts = 0;
        }
      }
    }
  } else if (currentNetworkMode != WIFI_AP_MODE && mqtt.connected()) {
    // MQTT connected - handle messages
    mqtt.loop();

    // Publish periodic updates
    if (millis() - lastMqttPublish > MQTT_PUBLISH_INTERVAL) {
      publishStatusMQTT();

      // Publish sensor data nếu đang hoạt động
      if (isCountingEnabled || isTriggerEnabled)
        publishSensorData();

      lastMqttPublish = millis();
    }
    
    // Publish heartbeat
    if (millis() - lastHeartbeat > HEARTBEAT_INTERVAL) {
      publishHeartbeat();
      lastHeartbeat = millis();
    }
  }
  
  // Web server handling
  server.handleClient();
  
  // Feed watchdog to prevent timeout
  yield();
  
  // Monitor memory periodically
  static unsigned long lastMemoryCheck = 0;
  if (millis() - lastMemoryCheck > 30000) { // Check every 30 seconds
    size_t freeHeap = ESP.getFreeHeap();
    if (freeHeap < 10000) {
      Serial.println("WARNING: Low memory detected - " + String(freeHeap) + " bytes free");
    }
    lastMemoryCheck = millis();
  }
  
  // Cập nhật hệ thống với delay tối ưu
  delay(50);  // Giảm từ 100ms xuống 50ms để cải thiện responsiveness
}
//<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
