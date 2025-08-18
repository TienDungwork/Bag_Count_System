
//>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> Bag Counter Display
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"
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
// W5500 SPI pin definitions
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
const char* mqtt_server = "test.mosquitto.org";

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
const char* TOPIC_CONFIG = "bagcounter/config/update";    // Cập nhật config

// MQTT timing variables
unsigned long lastMqttPublish = 0;
unsigned long lastHeartbeat = 0;
const unsigned long MQTT_PUBLISH_INTERVAL = 2000;  // 2 giây
const unsigned long HEARTBEAT_INTERVAL = 30000;    // 30 giây

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

//----------------------------------------Sensor pin
#define SENSOR_PIN 4 // Chân kết nối cảm biến t61
#define TRIGGER_SENSOR_PIN 39  // Chân cảm biến encoder
#define START_LED_PIN 38  // relay chạy bắt đầu đếm
#define DONE_LED_PIN 5   // còi báo đến ngưỡng hoàn thành

//----------------------------------------IR Remote pin
#define RECV_PIN 1  // Chân nhận tín hiệu IR

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
String bagType = "Gạo";
int targetCount = 20;
std::vector<String> bagTypes;

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
unsigned long debounceDelay = 50;  // Thời gian debounce 50ms
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
  DynamicJsonDocument doc(256);
  String msg;
  String action = "";
  
  switch(button) {
    case 1: // Start
      Serial.println("IR Remote: Start command");
      isRunning = true;
      isTriggerEnabled = true;
      currentSystemStatus = "RUNNING"; // Set trạng thái chính xác
      action = "START";
      // Cập nhật thời gian bắt đầu khi Start
      if (time(nullptr) > 24 * 3600) {
        startTimeStr = getTimeStr();
        timeWaitingForSync = false;
        Serial.print("IR Remote - Thời gian bắt đầu: ");
        Serial.println(startTimeStr);
      } else {
        startTimeStr = "Waiting for time sync...";
        timeWaitingForSync = true;
        Serial.println("IR Remote - Time not synced yet, will update when available");
      }
      // CAP NHAT NGAY LAP TUC TRANG THAI CHO TAT CA BAGCONFIG
      Serial.print("IR Remote START - Updating ");
      Serial.print(bagConfigs.size());
      Serial.println(" bagConfigs to RUNNING");
      
      for (auto& cfg : bagConfigs) {
        cfg.status = "RUNNING";  // Set TAT CA ve RUNNING
        Serial.print("Updated ");
        Serial.print(cfg.type);
        Serial.println(" -> RUNNING");
      }
      saveBagConfigsToFile();
      Serial.println("IR Remote - Config saved to file");
      updateStartLED();
      needUpdate = true;
      break;
      
    case 2: // Pause
      Serial.println("IR Remote: Pause command");
      isRunning = false;
      isTriggerEnabled = false;
      isCountingEnabled = false;
      currentSystemStatus = "PAUSE"; // Set trạng thái chính xác
      action = "PAUSE";
      // CAP NHAT NGAY LAP TUC TRANG THAI CHO TAT CA BAGCONFIG
      Serial.print("IR Remote PAUSE - Updating ");
      Serial.print(bagConfigs.size());
      Serial.println(" bagConfigs to PAUSE");
      
      for (auto& cfg : bagConfigs) {
        cfg.status = "PAUSE";  // Set TAT CA ve PAUSE
        Serial.print("Updated ");
        Serial.print(cfg.type);
        Serial.println(" -> PAUSE");
      }
      saveBagConfigsToFile();
      updateStartLED();
      needUpdate = true;
      break;
      
    case 3: // Reset
      Serial.println("IR Remote: Reset command");
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
      // CAP NHAT NGAY LAP TUC TRANG THAI CHO TAT CA BAGCONFIG
      Serial.print("IR Remote RESET - Updating ");
      Serial.print(bagConfigs.size());
      Serial.println(" bagConfigs to RESET");
      
      for (auto& cfg : bagConfigs) {
        cfg.status = "RESET";  // Set TAT CA ve RESET
        Serial.print("Updated ");
        Serial.print(cfg.type);
        Serial.println(" -> RESET");
      }
      saveBagConfigsToFile();
      updateStartLED();
      updateDoneLED();
      needUpdate = true;
      break;
  }
  
  // Publish MQTT để thông báo thay đổi
  doc.clear();
  doc["source"] = "IR_REMOTE";
  doc["action"] = action;
  doc["status"] = isRunning ? "RUNNING" : "STOPPED";
  doc["count"] = totalCount;
  doc["timestamp"] = millis();
  doc["startTime"] = startTimeStr;
  msg = "";
  serializeJson(doc, msg);
  mqtt.publish("bagcounter/ir_command", msg.c_str());
  
  // MQTT: Publish updated status after IR command
  publishStatusMQTT();
  
  // 🚨 MQTT: Publish IR command alert
  publishAlert("IR_COMMAND", "IR Remote: " + action + " - " + (isRunning ? "RUNNING" : "STOPPED"));
  
  // LUU IR COMMAND CHO WEB POLLING
  lastIRCommand = action;
  lastIRTimestamp = millis();
  hasNewIRCommand = true;
  
  Serial.println("IR Command processed: " + action);
  Serial.println("IR Command saved for web polling: " + action);
}

// Handle commands from Web via MQTT (similar to IR but no IR alerts)
void handleWebCommand(int button) {
  String action = "";
  
  switch(button) {
    case 1: // Start
      Serial.println("Web: Start command");
      isRunning = true;
      isTriggerEnabled = true;
      currentSystemStatus = "RUNNING"; // Set trạng thái chính xác
      action = "START";
      
      // Update start time
      if (time(nullptr) > 24 * 3600) {
        startTimeStr = getTimeStr();
        timeWaitingForSync = false;
        Serial.print("Web - Start time: ");
        Serial.println(startTimeStr);
      } else {
        startTimeStr = "Waiting for time sync...";
        timeWaitingForSync = true;
        Serial.println("Web - Time not synced yet");
      }
      
      // Update all bagConfigs to RUNNING
      Serial.print(" Web START - Updating ");
      Serial.print(bagConfigs.size());
      Serial.println(" bagConfigs to RUNNING");
      
      for (auto& cfg : bagConfigs) {
        cfg.status = "RUNNING";
        Serial.print("Updated ");
        Serial.print(cfg.type);
        Serial.println(" -> RUNNING");
      }
      saveBagConfigsToFile();
      updateStartLED();
      needUpdate = true;
      break;
      
    case 2: // Pause
      Serial.println("Web: Pause command");
      isRunning = false;
      isTriggerEnabled = false;
      isCountingEnabled = false;
      currentSystemStatus = "PAUSE"; // Set trạng thái chính xác
      action = "PAUSE";
      
      // Update all bagConfigs to PAUSE
      Serial.print("Web PAUSE - Updating ");
      Serial.print(bagConfigs.size());
      Serial.println(" bagConfigs to PAUSE");
      
      for (auto& cfg : bagConfigs) {
        cfg.status = "PAUSE";
        Serial.print("Updated ");
        Serial.print(cfg.type);
        Serial.println(" -> PAUSE");
      }
      saveBagConfigsToFile();
      updateStartLED();
      needUpdate = true;
      break;
      
    case 3: // Reset
      Serial.println("Web: Reset command");
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
      
      // Update all bagConfigs to RESET
      Serial.print("Web RESET - Updating ");
      Serial.print(bagConfigs.size());
      Serial.println(" bagConfigs to RESET");
      
      for (auto& cfg : bagConfigs) {
        cfg.status = "RESET";
        Serial.print("Updated ");
        Serial.print(cfg.type);
        Serial.println(" -> RESET");
      }
      saveBagConfigsToFile();
      updateStartLED();
      updateDoneLED();
      needUpdate = true;
      break;
  }
  
  // MQTT: Publish updated status after web command (NO IR alerts)
  publishStatusMQTT();
  
  Serial.println("Web command processed: " + action);
}

//------------------- Lưu/đọc loại bao -------------------
void saveBagTypesToFile() {
  File f = LittleFS.open(BAGTYPES_FILE, "w");
  if (!f) return;
  DynamicJsonDocument doc(512);
  JsonArray arr = doc.to<JsonArray>();
  for (auto& type : bagTypes) arr.add(type);
  serializeJson(doc, f);
  f.close();
}
void loadBagTypesFromFile() {
  File f = LittleFS.open(BAGTYPES_FILE, "r");
  if (!f) return;
  DynamicJsonDocument doc(512);
  DeserializationError err = deserializeJson(doc, f);
  if (!err) {
    bagTypes.clear();
    for (JsonVariant v : doc.as<JsonArray>()) bagTypes.push_back(v.as<String>());
  }
  f.close();
}
//------------------- Lưu/đọc cấu hình từng loại -------------------
void saveBagConfigsToFile() {
  File f = LittleFS.open(BAGCONFIGS_FILE, "w");
  if (!f) return;
  DynamicJsonDocument doc(2048);
  JsonArray arr = doc.to<JsonArray>();
  for (auto& c : bagConfigs) {
    JsonObject o = arr.createNestedObject();
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
  DynamicJsonDocument doc(2048);
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
void loadSettingsFromFile() {
  if (LittleFS.exists("/settings.json")) {
    File file = LittleFS.open("/settings.json", "r");
    if (file) {
      String content = file.readString();
      file.close();
      
      DynamicJsonDocument doc(1024);
      if (deserializeJson(doc, content) == DeserializationError::Ok) {
        // Load Ethernet IP config
        String ethIP = doc["ipAddress"];
        String ethGateway = doc["gateway"];
        String ethSubnet = doc["subnet"];
        String ethDNS1 = doc["dns1"];
        String ethDNS2 = doc["dns2"];
        
        if (ethIP.length() > 0) {
          IPAddress newIP, newGateway, newSubnet, newDNS1, newDNS2;
          if (newIP.fromString(ethIP)) local_IP = newIP;
          if (newGateway.fromString(ethGateway)) gateway = newGateway;
          if (newSubnet.fromString(ethSubnet)) subnet = newSubnet;
          if (newDNS1.fromString(ethDNS1)) primaryDNS = newDNS1;
          if (newDNS2.fromString(ethDNS2)) secondaryDNS = newDNS2;
          
          Serial.println("Loaded Ethernet config from file:");
          Serial.println("IP: " + ethIP);
          Serial.println("Gateway: " + ethGateway);
          Serial.println("Subnet: " + ethSubnet);
        }
        
        // Load other settings
        if (doc.containsKey("brightness")) {
          int brightness = doc["brightness"];
          if (brightness >= 10 && brightness <= 100) {
            // Brightness sẽ được set sau khi display init
          }
        }
      }
    }
  }
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
          String ip_str = doc["static_ip"];
          String gateway_str = doc["gateway"];
          String subnet_str = doc["subnet"];
          String dns1_str = doc["dns1"];
          String dns2_str = doc["dns2"];
          
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
    Serial.println("No WiFi credentials found");
    return false;
  }
  
  Serial.println("Trying WiFi connection to: " + wifi_ssid);
  WiFi.mode(WIFI_STA);
  
  // Configure static IP if enabled
  if (wifi_use_static_ip) {
    Serial.println("Using static IP: " + wifi_static_ip.toString());
    if (!WiFi.config(wifi_static_ip, wifi_gateway, wifi_subnet, wifi_dns1, wifi_dns2)) {
      Serial.println("Failed to configure static IP");
      return false;
    }
  }
  
  WiFi.begin(wifi_ssid.c_str(), wifi_password.c_str());
  
  unsigned long startTime = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startTime < 15000) {
    delay(500);
    Serial.print(".");
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    wifiConnected = true;
    currentNetworkMode = WIFI_STA_MODE;
    Serial.println();
    Serial.println("WiFi connected!");
    Serial.print("IP: ");
    Serial.println(WiFi.localIP());
    Serial.print("Gateway: ");
    Serial.println(WiFi.gatewayIP());
    Serial.print("Subnet: ");
    Serial.println(WiFi.subnetMask());
    return true;
  }
  
  Serial.println();
  Serial.println("WiFi connection failed");
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
  mqtt.setServer(mqtt_server, 1883);
  mqtt.setCallback(onMqttMessage); // Set callback để nhận message
  mqtt.setBufferSize(512); // Increase buffer size for larger messages
  mqtt.setKeepAlive(15); // Keep alive interval
  
  // Thử kết nối MQTT
  String clientId = "ESP32_BagCounter_" + String(WiFi.macAddress());
  clientId.replace(":", "");
  
  Serial.print("🔌 Connecting to MQTT broker: ");
  Serial.println(mqtt_server);
  
  if (mqtt.connect(clientId.c_str())) {
    Serial.println("MQTT connected successfully!");
    Serial.println("Client ID: " + clientId);
    
    // Subscribe các topic để nhận lệnh điều khiển
    mqtt.subscribe(TOPIC_CMD_START);
    mqtt.subscribe(TOPIC_CMD_PAUSE);
    mqtt.subscribe(TOPIC_CMD_RESET);
    mqtt.subscribe(TOPIC_CMD_SELECT);
    mqtt.subscribe(TOPIC_CONFIG);
    
    Serial.println("Subscribed to control topics:");
    Serial.println("  - " + String(TOPIC_CMD_START));
    Serial.println("  - " + String(TOPIC_CMD_PAUSE));
    Serial.println("  - " + String(TOPIC_CMD_RESET));
    Serial.println("  - " + String(TOPIC_CMD_SELECT));
    Serial.println("  - " + String(TOPIC_CONFIG));
    
    // Publish online status
    publishHeartbeat();
    
  } else {
    Serial.print("MQTT connection failed, rc=");
    Serial.println(mqtt.state());
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
    Serial.println("MQTT Command: START from Web");
    handleWebCommand(1); // Start command from web
    
  } else if (topicStr == TOPIC_CMD_PAUSE) {
    Serial.println("MQTT Command: PAUSE from Web");
    handleWebCommand(2); // Pause command from web
    
  } else if (topicStr == TOPIC_CMD_RESET) {
    Serial.println("MQTT Command: RESET from Web");
    handleWebCommand(3); // Reset command from web
    
  } else if (topicStr == TOPIC_CMD_SELECT) {
    Serial.println("MQTT Command: SELECT ORDER");
    // Parse JSON để chọn đơn hàng
    DynamicJsonDocument doc(256);
    if (deserializeJson(doc, message) == DeserializationError::Ok) {
      String orderType = doc["type"];
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
    // Parse JSON config update
    DynamicJsonDocument doc(512);
    if (deserializeJson(doc, message) == DeserializationError::Ok) {
      if (doc.containsKey("brightness")) {
        int brightness = doc["brightness"];
        if (brightness >= 10 && brightness <= 100) {
          dma_display->setBrightness8(map(brightness, 0, 100, 0, 255));
          Serial.println("Brightness updated via MQTT: " + String(brightness));
        }
      }
      
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
  }
}

void publishStatusMQTT() {
  static unsigned long lastPublish = 0;
  
  // Debounce - chỉ publish mỗi 500ms để tránh spam
  if (millis() - lastPublish < 500) {
    return;
  }
  lastPublish = millis();
  
  if (!mqtt.connected()) {
    Serial.println("MQTT not connected - cannot publish status");
    return;
  }
  
  DynamicJsonDocument doc(512);
  doc["deviceId"] = "BT-001";
  doc["status"] = currentSystemStatus; // Sử dụng trạng thái chính xác thay vì chỉ RUNNING/STOPPED
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
  
  Serial.print("📤 Publishing status MQTT (");
  Serial.print(message.length());
  Serial.print(" bytes): ");
  Serial.println(message);
  
  bool published = mqtt.publish(TOPIC_STATUS, message.c_str());
  if (published) {
    Serial.println("Status published to MQTT");
  } else {
    Serial.print("Failed to publish status to MQTT. State: ");
    Serial.println(mqtt.state());
  }
}

void publishCountUpdate() {
  if (!mqtt.connected()) return;
  
  DynamicJsonDocument doc(256);
  doc["deviceId"] = "BT-001";
  doc["count"] = totalCount;
  doc["target"] = targetCount;
  doc["type"] = bagType;
  doc["timestamp"] = getTimeStr();
  doc["progress"] = (float)totalCount / targetCount * 100;
  
  String message;
  serializeJson(doc, message);
  
  mqtt.publish(TOPIC_COUNT, message.c_str());
  Serial.println("Count update published: " + String(totalCount));
}

void publishAlert(String alertType, String message) {
  if (!mqtt.connected()) return;
  
  DynamicJsonDocument doc(256);
  doc["deviceId"] = "BT-001";
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
  if (!mqtt.connected()) return;
  
  DynamicJsonDocument doc(256);
  doc["deviceId"] = "BT-001";
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
  if (!mqtt.connected()) return;
  
  DynamicJsonDocument doc(256);
  doc["deviceId"] = "BT-001";
  doc["status"] = "ONLINE";
  doc["uptime"] = millis() / 1000;
  doc["freeHeap"] = ESP.getFreeHeap();
  doc["wifiRSSI"] = WiFi.RSSI();
  doc["ipAddress"] = currentNetworkMode == ETHERNET_MODE ? ETH.localIP().toString() : WiFi.localIP().toString();
  doc["timestamp"] = getTimeStr();
  
  String message;
  serializeJson(doc, message);
  
  mqtt.publish(TOPIC_HEARTBEAT, message.c_str());
  Serial.println("Heartbeat published");
}

//----------------------------------------Web server API
void setupWebServer() {
  // Root page handler
  server.on("/", HTTP_GET, [](){
    if (LittleFS.exists("/index.html")) {
      File file = LittleFS.open("/index.html", "r");
      server.streamFile(file, "text/html");
      file.close();
    } else {
      server.send(404, "text/plain", "index.html not found");
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
    
    Serial.print("API Status returning: ");
    Serial.print(currentStatus);
    Serial.print(" (isRunning: ");
    Serial.print(isRunning);
    Serial.print(", bagType: ");
    Serial.print(bagType);
    Serial.println(")");
    
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
    doc["conveyorId"] = "BT-001";
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
  server.on("/api/orders", HTTP_GET, [](){
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

  // API lịch sử đếm
  server.on("/api/history", HTTP_GET, [](){
    DynamicJsonDocument doc(2048);
    JsonArray arr = doc.to<JsonArray>();
    for (auto& h : history) {
      JsonObject obj = arr.createNestedObject();
      obj["time"] = h.time;
      obj["count"] = h.count;
      obj["type"] = h.type;
    }
    String out;
    serializeJson(doc, out);
    server.send(200, "application/json", out);
  });

  // API điều khiển cơ bản
  server.on("/api/cmd", HTTP_POST, [](){
    if (server.hasArg("plain")) {
      DynamicJsonDocument doc(256);
      deserializeJson(doc, server.arg("plain"));
      String cmd = doc["cmd"];
      
      if (cmd == "start") {
        Serial.println("Web Start command received");
        Serial.print("Trang thai truoc - isRunning: ");
        Serial.print(isRunning);
        Serial.print(", isTriggerEnabled: ");
        Serial.print(isTriggerEnabled);
        Serial.print(", isCountingEnabled: ");
        Serial.println(isCountingEnabled);
        
        isRunning = true;
        isTriggerEnabled = true;
        // Cập nhật thời gian bắt đầu khi Start
        if (time(nullptr) > 24 * 3600) {
          startTimeStr = getTimeStr();
          timeWaitingForSync = false;
        } else {
          startTimeStr = "Waiting for time sync...";
          timeWaitingForSync = true;
        }
        
        // CẬP NHẬT STATUS TRONG BAGCONFIGS
        for (auto& cfg : bagConfigs) {
          if (cfg.type == bagType) {
            cfg.status = "RUNNING";
            break;
          }
        }
        saveBagConfigsToFile();
        
        updateStartLED();
        needUpdate = true;
        
        Serial.print("Trang thai sau - isRunning: ");
        Serial.print(isRunning);
        Serial.print(", isTriggerEnabled: ");
        Serial.print(isTriggerEnabled);
        Serial.print(", isCountingEnabled: ");
        Serial.println(isCountingEnabled);
      } else if (cmd == "pause") {
        Serial.println("Pause command received");
        isRunning = false;
        isTriggerEnabled = false;
        isCountingEnabled = false;
        
        // CẬP NHẬT STATUS TRONG BAGCONFIGS
        for (auto& cfg : bagConfigs) {
          if (cfg.type == bagType) {
            cfg.status = "PAUSE";
            break;
          }
        }
        saveBagConfigsToFile();
        
        updateStartLED();
        needUpdate = true;
      } else if (cmd == "reset") {
        Serial.println("Reset command received");
        totalCount = 0;
        isLimitReached = false;
        isRunning = false;
        isTriggerEnabled = false;
        isCountingEnabled = false;
        history.clear();
        startTimeStr = "";
        timeWaitingForSync = false;
        
        // CẬP NHẬT STATUS TRONG BAGCONFIGS
        for (auto& cfg : bagConfigs) {
          if (cfg.type == bagType) {
            cfg.status = "RESET";
            break;
          }
        }
        saveBagConfigsToFile();
        
        // SAU KHI RESET, TỰ ĐỘNG CHUYỂN VỀ WAIT SAU 2 GIÂY
        delay(100);  // Đợi web nhận được status RESET
        for (auto& cfg : bagConfigs) {
          if (cfg.type == bagType) {
            cfg.status = "WAIT";
            break;
          }
        }
        saveBagConfigsToFile();
        
        updateStartLED();
        updateDoneLED();
        needUpdate = true;
      } else if (cmd == "reset_count_only") {
        Serial.println("Reset count only command received");
        // CHỈ RESET COUNT, KHÔNG THAY ĐỔI TRẠNG THÁI KHÁC
        totalCount = 0;
        isLimitReached = false;
        history.clear();
        
        // GIỮ NGUYÊN TRẠNG THÁI isRunning, isTriggerEnabled
        // CHỈ CẬP NHẬT COUNT DISPLAY
        updateDoneLED();
        needUpdate = true;
        
        Serial.println("Count reset to 0, keeping current running state");
      } else if (cmd == "set_current_order") {
        // Cập nhật thông tin đơn hàng hiện tại để hiển thị trên LED
        String productName = doc["productName"];
        String customerName = doc["customerName"];
        String orderCode = doc["orderCode"];
        int target = doc["target"] | 20;
        int warningQuantity = doc["warningQuantity"] | 5;
        bool keepCount = doc["keepCount"] | false;
        bool isRunningOrder = doc["isRunning"] | false;
        
        Serial.println("Setting current order:");
        Serial.println("Product: " + productName);
        Serial.println("Customer: " + customerName);
        Serial.println("Order Code: " + orderCode);
        Serial.println("Target: " + String(target));
        Serial.println("Warning: " + String(warningQuantity));
        Serial.println("Keep Count: " + String(keepCount));
        Serial.println("Is Running: " + String(isRunningOrder));
        
        // Cập nhật biến hiển thị
        bagType = productName;
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
      } else if (cmd == "next_order") {
        // XỬ LÝ CHUYỂN SANG ĐƠN HÀNG TIẾP THEO
        Serial.println("Next order command received");
        
        String productName = doc["productName"];
        String customerName = doc["customerName"];
        String orderCode = doc["orderCode"];
        int target = doc["target"] | 20;
        int warningQuantity = doc["warningQuantity"] | 5;
        bool keepCount = doc["keepCount"] | false;
        
        Serial.println("Switching to next order:");
        Serial.println("Product: " + productName);
        Serial.println("Customer: " + customerName);
        Serial.println("Order Code: " + orderCode);
        Serial.println("Target: " + String(target));
        Serial.println("Keep Count: " + String(keepCount));
        
        // CẬP NHẬT THÔNG TIN ĐƠN HÀNG MỚI
        bagType = productName;
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
            cfg.status = "RUNNING";  // ✅ ĐẢM BẢO TRẠNG THÁI RUNNING
            found = true;
            Serial.println("✅ Updated existing bagConfig to RUNNING");
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
        String orderCode = doc["orderCode"];
        
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

  // API cho sản phẩm
  server.on("/api/products", HTTP_GET, [](){
    // Trả về danh sách sản phẩm từ LittleFS hoặc cơ sở dữ liệu
    DynamicJsonDocument doc(2048);
    JsonArray arr = doc.to<JsonArray>();
    
    // Tạm thời trả về dữ liệu mẫu - sau này có thể lưu vào file
    JsonObject product1 = arr.createNestedObject();
    product1["id"] = 1;
    product1["code"] = "GAO001";
    product1["name"] = "Gạo thường";
    
    JsonObject product2 = arr.createNestedObject();
    product2["id"] = 2;
    product2["code"] = "GAO002";
    product2["name"] = "Gạo thơm";
    
    JsonObject product3 = arr.createNestedObject();
    product3["id"] = 3;
    product3["code"] = "NGO001";
    product3["name"] = "Ngô";
    
    String out;
    serializeJson(doc, out);
    server.send(200, "application/json", out);
  });

  server.on("/api/products", HTTP_POST, [](){
    if (server.hasArg("plain")) {
      DynamicJsonDocument doc(256);
      deserializeJson(doc, server.arg("plain"));
      String code = doc["code"];
      String name = doc["name"];
      
      // Lưu sản phẩm mới vào file hoặc cơ sở dữ liệu
      // Tạm thời chỉ trả về OK
      Serial.println("New product added: " + code + " - " + name);
    }
    server.send(200, "text/plain", "OK");
  });

  server.on("/api/products", HTTP_DELETE, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    
    if (server.hasArg("id")) {
      String productId = server.arg("id");
      Serial.println("Delete product ID: " + productId);
      server.send(200, "application/json", "{\"status\":\"OK\",\"message\":\"Product deleted\"}");
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
    
    if (server.hasArg("plain")) {
      DynamicJsonDocument doc(512);
      deserializeJson(doc, server.arg("plain"));
      
      String customerName = doc["customerName"];
      String orderCode = doc["orderCode"];
      String vehicleNumber = doc["vehicleNumber"];
      String productName = doc["productName"];
      int quantity = doc["quantity"];
      int warningQuantity = doc["warningQuantity"];
      
      // Tạo BagConfig mới từ đơn hàng
      BagConfig newConfig;
      newConfig.type = productName;
      newConfig.target = quantity;
      newConfig.warn = warningQuantity;
      newConfig.status = "WAIT";
      
      // Kiểm tra và thêm vào bagConfigs nếu chưa có
      bool found = false;
      for (auto& cfg : bagConfigs) {
        if (cfg.type == productName) {
          cfg.target = quantity;
          cfg.warn = warningQuantity;
          cfg.status = "WAIT";
          found = true;
          break;
        }
      }
      
      if (!found) {
        bagConfigs.push_back(newConfig);
      }
      
      // Thêm vào bagTypes nếu chưa có
      if (std::find(bagTypes.begin(), bagTypes.end(), productName) == bagTypes.end()) {
        bagTypes.push_back(productName);
        saveBagTypesToFile();
      }
      
      // Lưu cấu hình
      saveBagConfigsToFile();
      
      Serial.println("New order saved to ESP32:");
      Serial.println("Customer: " + customerName);
      Serial.println("Order Code: " + orderCode);
      Serial.println("Vehicle: " + vehicleNumber);
      Serial.println("Product: " + productName);
      Serial.println("Quantity: " + String(quantity));
      Serial.println("Warning: " + String(warningQuantity));
      
      server.send(200, "application/json", "{\"status\":\"OK\",\"message\":\"Order saved to ESP32\"}");
    } else {
      server.send(400, "application/json", "{\"status\":\"Error\",\"message\":\"No data provided\"}");
    }
  });

  // API cài đặt chung - Cập nhật để lưu vào ESP32
  server.on("/api/settings", HTTP_GET, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    
    DynamicJsonDocument doc(1024);
    
    // Load từ file hoặc giá trị mặc định
    if (LittleFS.exists("/settings.json")) {
      File file = LittleFS.open("/settings.json", "r");
      if (file) {
        String content = file.readString();
        file.close();
        deserializeJson(doc, content);
      }
    }
    
    // Đặt giá trị mặc định nếu chưa có
    if (!doc.containsKey("conveyorName")) doc["conveyorName"] = "BT-001";
    if (!doc.containsKey("ipAddress")) doc["ipAddress"] = ETH.localIP().toString();
    if (!doc.containsKey("gateway")) doc["gateway"] = gateway.toString();
    if (!doc.containsKey("subnet")) doc["subnet"] = subnet.toString();
    if (!doc.containsKey("sensorDelay")) doc["sensorDelay"] = 50;
    if (!doc.containsKey("bagDetectionDelay")) doc["bagDetectionDelay"] = 200;
    if (!doc.containsKey("minBagInterval")) doc["minBagInterval"] = 100;
    if (!doc.containsKey("autoReset")) doc["autoReset"] = false;
    if (!doc.containsKey("brightness")) doc["brightness"] = 35;
    
    String out;
    serializeJson(doc, out);
    server.send(200, "application/json", out);
  });

  server.on("/api/settings", HTTP_POST, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    
    if (server.hasArg("plain")) {
      DynamicJsonDocument doc(1024);
      deserializeJson(doc, server.arg("plain"));
      
      String conveyorName = doc["conveyorName"];
      int brightness = doc["brightness"];
      int sensorDelay = doc["sensorDelay"];
      int bagDetectionDelay = doc["bagDetectionDelay"];
      int minBagInterval = doc["minBagInterval"];
      bool autoReset = doc["autoReset"];
      
      // Cấu hình IP tĩnh Ethernet
      String ethIP = doc["ipAddress"];
      String ethGateway = doc["gateway"];
      String ethSubnet = doc["subnet"];
      String ethDNS1 = doc["dns1"];
      String ethDNS2 = doc["dns2"];
      
      // Cập nhật cài đặt
      if (brightness >= 10 && brightness <= 100) {
        dma_display->setBrightness8(map(brightness, 0, 100, 0, 255));
      }
      
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
            
            Serial.println("IP configuration changed:");
            Serial.println("New IP: " + ethIP);
            Serial.println("New Gateway: " + ethGateway);
            Serial.println("New Subnet: " + ethSubnet);
          }
          
          if (ethDNS1.length() > 0) newDNS1.fromString(ethDNS1);
          else newDNS1 = IPAddress(8, 8, 8, 8);
          
          if (ethDNS2.length() > 0) newDNS2.fromString(ethDNS2);
          else newDNS2 = IPAddress(8, 8, 4, 4);
          
          primaryDNS = newDNS1;
          secondaryDNS = newDNS2;
        }
      }
      
      // Lưu cài đặt vào file
      File file = LittleFS.open("/settings.json", "w");
      if (file) {
        serializeJson(doc, file);
        file.close();
        Serial.println("Settings saved to file");
      }
      
      Serial.println("Settings updated:");
      Serial.println("Conveyor Name: " + conveyorName);
      Serial.println("Brightness: " + String(brightness));
      Serial.println("Sensor Delay: " + String(sensorDelay));
      Serial.println("Ethernet IP: " + ethIP);
      
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
    
    int n = WiFi.scanNetworks();
    DynamicJsonDocument doc(2048);
    JsonArray networks = doc.createNestedArray("networks");
    
    for (int i = 0; i < n; i++) {
      JsonObject network = networks.createNestedObject();
      network["ssid"] = WiFi.SSID(i);
      network["rssi"] = WiFi.RSSI(i);
      network["encrypted"] = (WiFi.encryptionType(i) != WIFI_AUTH_OPEN);
    }
    
    String out;
    serializeJson(doc, out);
    server.send(200, "application/json", out);
  });

  server.on("/api/wifi/connect", HTTP_POST, [](){
    server.sendHeader("Access-Control-Allow-Origin", "*");
    
    if (server.hasArg("plain")) {
      DynamicJsonDocument doc(512);
      deserializeJson(doc, server.arg("plain"));
      
      String ssid = doc["ssid"];
      String password = doc["password"];
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
    
    DynamicJsonDocument doc(512);
    doc["ethernet_connected"] = ethernetConnected;
    doc["wifi_connected"] = wifiConnected;
    doc["current_mode"] = (currentNetworkMode == ETHERNET_MODE) ? "ethernet" : 
                         (currentNetworkMode == WIFI_STA_MODE) ? "wifi_sta" : "wifi_ap";
    
    if (currentNetworkMode == ETHERNET_MODE && ethernetConnected) {
      doc["ip"] = ETH.localIP().toString();
      doc["gateway"] = ETH.gatewayIP().toString();
      doc["subnet"] = ETH.subnetMask().toString();
      doc["dns"] = ETH.dnsIP().toString();
    } else if (currentNetworkMode == WIFI_STA_MODE && wifiConnected) {
      doc["ip"] = WiFi.localIP().toString();
      doc["gateway"] = WiFi.gatewayIP().toString();
      doc["subnet"] = WiFi.subnetMask().toString();
      doc["dns"] = WiFi.dnsIP().toString();
      doc["ssid"] = WiFi.SSID();
    } else if (currentNetworkMode == WIFI_AP_MODE) {
      doc["ip"] = WiFi.softAPIP().toString();
      doc["ap_ssid"] = ap_ssid;
    }
    
    String out;
    serializeJson(doc, out);
    server.send(200, "application/json", out);
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

  server.begin();
  Serial.println("WebServer started");
}

//----------------------------------------Display Functions
void updateDisplay() {
  if (isLimitReached && isBlinking && (blinkCount % 2 == 1)) {
    dma_display->fillScreen(myWHITE);
    return;
  }
  dma_display->clearScreen();
  
  // Layout mới:
  // Dòng 1 bên trái: Loại bao không dấu (NGO) - chữ to
  // Dòng 2 bên trái: XUAT: [số mục tiêu] 
  // Bên phải: Số đếm lớn chiếm 2 dòng
  
  // Chuyển đổi tên loại bao không dấu
  String displayType = bagType;
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
  
  // Hiển thị loại bao (dòng 1 bên trái) - chữ to không đậm để tránh giật
  dma_display->setTextSize(2);  // Tăng kích thước chữ
  dma_display->setTextColor(myYELLOW);
  
  // Vẽ text không đậm để tránh giật LED
  dma_display->setCursor(2, 3);    // Vị trí gốc
  dma_display->print(displayType);
  
  // Hiển thị "XUAT: [target]" (dòng 2 bên trái) - không đậm để tránh dính
  dma_display->setTextSize(1);
  dma_display->setTextColor(myCYAN);
  
  // Vẽ text XUAT không đậm để tránh dính nhau
  String xuatText = "XUAT: " + String(targetCount);
  dma_display->setCursor(2, 21);   // Tăng Y từ 19 lên 21 để tránh dính
  dma_display->print(xuatText);
  
  // Hiển thị số đếm lớn bên phải (chiếm 2 dòng) - TO HƠN NHIỀU
  String countStr = String((int)totalCount);
  dma_display->setTextSize(4);  // Tăng từ size 3 lên size 4 để TO HƠN
  dma_display->setTextColor(isLimitReached ? myRED : myGREEN);
  
  // Tính toán vị trí bên phải cho số đếm
  int16_t x1, y1;
  uint16_t w, h;
  dma_display->getTextBounds(countStr, 0, 0, &x1, &y1, &w, &h);
  
  // Đặt số đếm ở bên phải màn hình nhưng dịch sang trái hơn
  int x = (PANEL_RES_X * PANEL_CHAIN) - w - 8;  // Tăng margin từ 3 lên 15 để dịch sang trái
  int y = (PANEL_RES_Y - h) / 2 + 1;  // Chỉnh xuống 1 đơn vị
  
  // Vẽ số đếm không đậm để tránh nhiễu và giật
  dma_display->setCursor(x, y);      // Vị trí gốc
  dma_display->print(countStr);
  
  needUpdate = false;  // Đã cập nhật xong
}

void updateCount() {
  if (!isLimitReached) {
    totalCount++;
    
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
    
    // Kiểm tra đạt mục tiêu
    if (totalCount >= targetCount) {
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
      
      // MQTT: Publish final status
      publishStatusMQTT();
      
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
  // Đèn DONE (GPIO 23) chỉ phụ thuộc vào ngưỡng cảnh báo
  for (auto& cfg : bagConfigs) {
    if (cfg.type == bagType) {
      int warningThreshold = cfg.target - cfg.warn;
      doneLedOn = (totalCount >= warningThreshold);  // true = sáng (LOW) khi đạt ngưỡng
      digitalWrite(DONE_LED_PIN, doneLedOn ? LOW : HIGH);
      break;
    }
  }
}

void updateStartLED() {
  // Đèn START (GPIO 22) chỉ phụ thuộc vào lệnh Start/Pause/Reset
  if (isRunning) {
    startLedOn = true;  // Sáng (LOW)  
  } else {
    startLedOn = false; // Tắt (HIGH)
  }
  digitalWrite(START_LED_PIN, startLedOn ? LOW : HIGH);
}

//----------------------------------------SETUP & LOOP
void setup() {
  // Tắt brownout detector để tránh reset do điện áp thấp
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);
  
  Serial.begin(115200);
  Serial.println("Booting...");
  LittleFS.begin();
  
  // Load cấu hình từ file
  loadBagTypesFromFile();
  loadBagConfigsFromFile();
  loadSettingsFromFile();  // Load cài đặt chung bao gồm IP Ethernet
  
  // Khởi tạo chân cảm biến và LED
  pinMode(SENSOR_PIN, INPUT_PULLUP);
  pinMode(TRIGGER_SENSOR_PIN, INPUT);
  pinMode(START_LED_PIN, OUTPUT);
  pinMode(DONE_LED_PIN, OUTPUT);
  
  // Khởi tạo IR Remote
  irrecv.enableIRIn();
  Serial.println("IR Remote initialized");
  
  // Tắt LED ban đầu
  digitalWrite(START_LED_PIN, HIGH);  // Đèn START tắt (HIGH)
  digitalWrite(DONE_LED_PIN, HIGH);   // Đèn DONE tắt (HIGH)
  
  // Khởi tạo các biến trạng thái
  isRunning = false;
  isTriggerEnabled = false;
  isCountingEnabled = false;
  isLimitReached = false;
  totalCount = 0;
  
  if (!LittleFS.begin()) {
    Serial.println("LittleFS failed!");
    while (1);
  }
  Serial.println("LittleFS OK");
  loadBagTypesFromFile();
  loadBagConfigsFromFile();
  setupNetwork();
  setupMQTT();
  Serial.println("MQTT OK");
  setupTime();
  Serial.println("Time OK");
  setupWebServer();
  Serial.println("WebServer OK");

  HUB75_I2S_CFG::i2s_pins _pins={R1_PIN, G1_PIN, B1_PIN, R2_PIN, G2_PIN, B2_PIN, A_PIN, B_PIN, C_PIN, D_PIN, E_PIN, LAT_PIN, OE_PIN, CLK_PIN};
  HUB75_I2S_CFG mxconfig(PANEL_RES_X, PANEL_RES_Y, PANEL_CHAIN, _pins);
  mxconfig.i2sspeed = HUB75_I2S_CFG::HZ_10M;
  dma_display = new MatrixPanel_I2S_DMA(mxconfig);
  dma_display->begin();
  
  // Load brightness từ settings
  int savedBrightness = 35; // default
  if (LittleFS.exists("/settings.json")) {
    File file = LittleFS.open("/settings.json", "r");
    if (file) {
      String content = file.readString();
      file.close();
      DynamicJsonDocument doc(1024);
      if (deserializeJson(doc, content) == DeserializationError::Ok) {
        savedBrightness = doc["brightness"] | 35;
      }
    }
  }
  dma_display->setBrightness8(map(savedBrightness, 0, 100, 0, 255));
  
  myBLACK = dma_display->color565(0, 0, 0);
  myWHITE = dma_display->color565(255, 255, 255);
  myRED = dma_display->color565(255, 0, 0);
  myGREEN = dma_display->color565(0, 255, 0);
  myBLUE = dma_display->color565(0, 0, 255);
  myYELLOW = dma_display->color565(255, 255, 0);
  myCYAN = dma_display->color565(0, 255, 255);
  dma_display->clearScreen();
  delay(1000);
  Serial.println("Setup done!");
}

void loop() {
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

  // Chỉ đếm khi được kích hoạt
  if (isCountingEnabled) {
    int reading = digitalRead(SENSOR_PIN);
    
    if (reading != lastSensorState) {
      lastDebounceTime = millis();
    }
    
    if ((millis() - lastDebounceTime) > debounceDelay) {
      if (reading != sensorState) {
        sensorState = reading;
        if (sensorState == LOW && isRunning && !isLimitReached) {
          Serial.print("COUNT SENSOR: Phat hien tui! Count: ");
          Serial.print(totalCount);
          Serial.print(" -> ");
          Serial.println(totalCount + 1);
          updateCount();
          needUpdate = true;
        } else if (sensorState == LOW) {
          Serial.print("COUNT SENSOR: Phat hien nhung khong dem (isRunning=");
          Serial.print(isRunning);
          Serial.print(", isLimitReached=");
          Serial.print(isLimitReached);
          Serial.println(")");
        }
      }
    }
    lastSensorState = reading;
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

  // Cập nhật LED chỉ khi thực sự cần thiết
  if (needUpdate) {
    updateDisplay();
    updateStartLED();  // Luôn cập nhật đèn START
    lastUpdate = millis();
  }
  
  // Kiểm tra và cập nhật thời gian bắt đầu nếu đang chờ đồng bộ
  if (timeWaitingForSync && time(nullptr) > 24 * 3600) {
    startTimeStr = getTimeStr();
    timeWaitingForSync = false;
    Serial.print("Time sync completed - Start time updated to: ");
    Serial.println(startTimeStr);
  }
  
  // 📡 MQTT Management
  if (!mqtt.connected()) {
    // Thử kết nối lại MQTT nếu mất kết nối
    static unsigned long lastReconnectAttempt = 0;
    if (millis() - lastReconnectAttempt > 5000) { // Thử 5 giây một lần
      lastReconnectAttempt = millis();
      Serial.println("🔄 Attempting MQTT reconnection...");
      setupMQTT();
    }
  } else {
    // MQTT connected - handle messages
    mqtt.loop();
    
    // Publish periodic updates
    if (millis() - lastMqttPublish > MQTT_PUBLISH_INTERVAL) {
      publishStatusMQTT();
      
      // Publish sensor data nếu đang hoạt động
      if (isCountingEnabled || isTriggerEnabled) {
        publishSensorData();
      }
      
      lastMqttPublish = millis();
    }
    
    // Publish heartbeat
    if (millis() - lastHeartbeat > HEARTBEAT_INTERVAL) {
      publishHeartbeat();
      lastHeartbeat = millis();
    }
  }
  
  server.handleClient();
}
//<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<



