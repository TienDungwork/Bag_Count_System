//>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> Bag Counter Display
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"
#include <WebServer_ESP32_SC_W5500.h>
#include <LittleFS.h>
#include <ArduinoJson.h>
#include <PubSubClient.h>
#include <time.h>
#include <vector>
#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>
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

//----------------------------------------Network & MQTT config
const char* mqtt_server = "test.mosquitto.org";

//----------------------------------------IP tĩnh config
IPAddress local_IP(192, 168, 1, 200);     // IP tĩnh
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
#define SENSOR_PIN 4 // Chân kết nối cảm biến E3F1-DS5C4
#define TRIGGER_SENSOR_PIN 39  // Chân cảm biến khởi động
#define START_LED_PIN 38  // Đèn báo bắt đầu đếm
#define DONE_LED_PIN 5   // Đèn báo hoàn thành

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

// File paths
#define BAGTYPES_FILE "/bagtypes.json"
#define BAGCONFIGS_FILE "/bagconfigs.json"

//----------------------------------------IR Remote functions
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
  
  switch(button) {
    case 1: // Start
      Serial.println("IR Remote: Start command");
      isRunning = true;
      isTriggerEnabled = true;
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
      updateStartLED();
      needUpdate = true;
      // Publish MQTT để thông báo thay đổi
      doc.clear();
      doc["source"] = "IR_REMOTE";
      doc["action"] = "START";
      doc["status"] = "RUNNING";
      doc["count"] = totalCount;
      msg = "";
      serializeJson(doc, msg);
      mqtt.publish("bagcounter/ir_command", msg.c_str());
      break;
    case 2: // Pause
      Serial.println("IR Remote: Pause command");
      isRunning = false;
      isTriggerEnabled = false;
      isCountingEnabled = false;
      updateStartLED();
      needUpdate = true;
      // Publish MQTT để thông báo thay đổi
      doc.clear();
      doc["source"] = "IR_REMOTE";
      doc["action"] = "PAUSE";
      doc["status"] = "STOPPED";
      doc["count"] = totalCount;
      msg = "";
      serializeJson(doc, msg);
      mqtt.publish("bagcounter/ir_command", msg.c_str());
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
      updateStartLED();
      updateDoneLED();
      needUpdate = true;
      // Publish MQTT để thông báo thay đổi
      doc.clear();
      doc["source"] = "IR_REMOTE";
      doc["action"] = "RESET";
      doc["status"] = "STOPPED";
      doc["count"] = totalCount;
      msg = "";
      serializeJson(doc, msg);
      mqtt.publish("bagcounter/ir_command", msg.c_str());
      break;
  }
}

// Cấu hình từng loại
struct BagConfig {
  String type;
  int target;
  int warn;
  String status; // WAIT, RUNNING, DONE
};
std::vector<BagConfig> bagConfigs;

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

//----------------------------------------Ethernet, MQTT, Time
void setupEthernet() {
  Serial.println("Initializing W5500 Ethernet...");
  
  // To be called before ETH.begin()
  ESP32_W5500_onEvent();
  
  // Initialize W5500 with static IP
  ETH.begin(MISO_GPIO, MOSI_GPIO, SCK_GPIO, CS_GPIO, INT_GPIO, SPI_CLOCK_MHZ, ETH_SPI_HOST, mac);
  ETH.config(local_IP, gateway, subnet, primaryDNS, secondaryDNS);
  
  // Wait for connection
  ESP32_W5500_waitForConnect();
  
  Serial.println("W5500 Ethernet connected!");
  Serial.print("IP address: ");
  Serial.println(ETH.localIP());
  Serial.print("Gateway: ");
  Serial.println(gateway);
  Serial.print("Subnet: ");
  Serial.println(subnet);
}

void setupMQTT() {
  mqtt.setServer(mqtt_server, 1883);
  mqtt.connect("esp32_bag_counter");
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
  
  // API trạng thái hiện tại
  server.on("/api/status", HTTP_GET, [](){
    DynamicJsonDocument doc(256);
    doc["status"] = isRunning ? "RUNNING" : "STOPPED";
    doc["count"] = totalCount;
    doc["startTime"] = startTimeStr;
    doc["currentType"] = bagType;
    doc["target"] = targetCount;
    doc["isWarning"] = false;
    
    // Kiểm tra ngưỡng cảnh báo
    for (auto& cfg : bagConfigs) {
      if (cfg.type == bagType) {
        int warningThreshold = cfg.target - cfg.warn;
        doc["isWarning"] = (totalCount >= warningThreshold);
        break;
      }
    }
    
    String out;
    serializeJson(doc, out);
    server.send(200, "application/json", out);
  });

  // API kiểm tra thay đổi từ IR Remote
  server.on("/api/ir_status", HTTP_GET, [](){
    DynamicJsonDocument doc(256);
    doc["lastIRCommand"] = "";  // Có thể thêm biến để track lệnh IR cuối
    doc["status"] = isRunning ? "RUNNING" : "STOPPED";
    doc["count"] = totalCount;
    doc["timestamp"] = millis();
    
    String out;
    serializeJson(doc, out);
    server.send(200, "application/json", out);
  });

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
        Serial.println("Start command received");
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
        updateStartLED();
        needUpdate = true;
      } else if (cmd == "pause") {
        Serial.println("Pause command received");
        isRunning = false;
        isTriggerEnabled = false;
        isCountingEnabled = false;
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
        updateStartLED();
        updateDoneLED();
        needUpdate = true;
      } else if (cmd == "select") {
        String type = doc["type"];
        for (auto& cfg : bagConfigs) {
          if (cfg.type == type) {
            bagType = cfg.type;
            targetCount = cfg.target;
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
            // Đánh dấu trạng thái RUNNING cho loại này, các loại khác là WAIT hoặc DONE
            for (auto& c : bagConfigs) {
              if (c.type == type) c.status = "RUNNING";
              else if (c.status != "DONE") c.status = "WAIT";
            }
            saveBagConfigsToFile();
            needUpdate = true;
            break;
          }
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
    
    // Kiểm tra ngưỡng cảnh báo và cập nhật đèn DONE
    for (auto& cfg : bagConfigs) {
      if (cfg.type == bagType) {
        int warningThreshold = cfg.target - cfg.warn;
        if (totalCount >= warningThreshold) {
          Serial.println("Đạt ngưỡng cảnh báo!");
          Serial.print("isRunning trước khi cập nhật DONE: ");
          Serial.println(isRunning);
          updateDoneLED();  // Cập nhật đèn DONE khi đạt ngưỡng cảnh báo
          Serial.print("isRunning sau khi cập nhật DONE: ");
          Serial.println(isRunning);
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
      // Publish MQTT
      DynamicJsonDocument doc(256);
      doc["count"] = totalCount;
      doc["time"] = (time(nullptr) > 24 * 3600) ? getTimeStr() : "Time not synced";
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
  loadBagTypesFromFile();
  loadBagConfigsFromFile();
  
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
  setupEthernet();
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
  dma_display->setBrightness8(35);
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
          handleIRCommand(btn);
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
          updateCount();
          needUpdate = true;
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
  
  server.handleClient();
  mqtt.loop();
}
//<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
