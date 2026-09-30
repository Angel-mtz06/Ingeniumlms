// Pulsera LSM: lee 6 MPU-6050 (dorso + 5 dedales) por un TCA9548A y envía las lecturas a la laptop
// por WebSocket (WiFi) y por USB serie, con el protocolo de texto de docs/arquitectura.md (sección 3):
//   laptop  → pulsera:  ID?
//   pulsera → laptop :  ID,<L|R>,fw=<versión>,imus=6,halls=0
//                       D,<L|R>,<seq>,<t_ms>,p0,r0,…,p5,r5,gx,gy,gz,<status>
// IMU 0 = dorso; 1–5 = pulgar→meñique. Ángulos en grados (1 decimal), giroscopio del dorso en °/s.
//
// Montaje de cada MPU-6050: eje X hacia la punta del dedo, eje Z saliendo de la uña (o del dorso).
// Así "p" (inclinación) gira al doblar el dedo y cubre −180…180°; "r" es el giro lateral.

#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <WebSocketsServer.h>

#include "config.h"
#if __has_include("secrets.h")
#include "secrets.h"
#else
#include "secrets.example.h"
#warning "Falta secrets.h: se usan los datos de ejemplo (copia secrets.example.h como secrets.h)"
#endif

static const int N_IMU = 6;
static const float ACC_LSB = 8192.0f;   // ±4 g
static const float GIRO_LSB = 65.5f;    // ±500 °/s
static const float RAD_A_GRADOS = 57.2957795f;

struct Imu {
  bool ok = false;           // respondió en la última lectura
  bool iniciada = false;
  float p = 0, r = 0;        // inclinación y giro filtrados (grados)
  float gx = 0, gy = 0, gz = 0;        // °/s sin sesgo
  float bx = 0, by = 0, bz = 0;        // sesgo del giroscopio (se mide al iniciar)
  uint32_t ultimoIntento = 0;
};

Imu imus[N_IMU];
WebSocketsServer ws(PUERTO_WEBSOCKET);
uint32_t seq = 0;
uint32_t proximo = 0;
uint32_t ultimoMicros = 0;
bool mdnsListo = false;
String entradaSerie;

const char* nombreRed() { return LADO == 'R' ? NOMBRE_DER : NOMBRE_IZQ; }

// ---------------------------------------------------------------- I²C
bool seleccionarCanal(uint8_t canal) {
  Wire.beginTransmission(DIR_TCA9548A);
  Wire.write(1 << canal);
  return Wire.endTransmission() == 0;
}

bool escribirRegistro(uint8_t reg, uint8_t valor) {
  Wire.beginTransmission(DIR_MPU6050);
  Wire.write(reg);
  Wire.write(valor);
  return Wire.endTransmission() == 0;
}

// Lee acelerómetro (g) y giroscopio (°/s) de la MPU del canal seleccionado.
bool leerCrudo(float& ax, float& ay, float& az, float& gx, float& gy, float& gz) {
  Wire.beginTransmission(DIR_MPU6050);
  Wire.write(0x3B);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((uint8_t)DIR_MPU6050, (uint8_t)14) != 14) return false;
  int16_t v[7];
  for (int i = 0; i < 7; i++) v[i] = (int16_t)((Wire.read() << 8) | Wire.read());
  ax = v[0] / ACC_LSB; ay = v[1] / ACC_LSB; az = v[2] / ACC_LSB;   // v[3] = temperatura
  gx = v[4] / GIRO_LSB; gy = v[5] / GIRO_LSB; gz = v[6] / GIRO_LSB;
  return true;
}

// Despierta la MPU, fija escalas y filtro, y mide el sesgo del giroscopio (la mano debe estar quieta ~0.2 s).
bool iniciarImu(int i) {
  Imu& m = imus[i];
  m.ultimoIntento = millis();
  if (!seleccionarCanal(CANAL_IMU[i])) return false;
  if (!escribirRegistro(0x6B, 0x01)) return false;   // despertar, reloj del giroscopio X
  escribirRegistro(0x1A, 0x03);                       // filtro digital ~44 Hz
  escribirRegistro(0x1B, 0x08);                       // giroscopio ±500 °/s
  escribirRegistro(0x1C, 0x08);                       // acelerómetro ±4 g
  delay(10);
  float ax, ay, az, gx, gy, gz, sx = 0, sy = 0, sz = 0;
  int n = 0;
  for (int k = 0; k < 100; k++) {
    if (leerCrudo(ax, ay, az, gx, gy, gz)) { sx += gx; sy += gy; sz += gz; n++; }
    delay(2);
  }
  if (n < 50) return false;
  m.bx = sx / n; m.by = sy / n; m.bz = sz / n;
  if (!leerCrudo(ax, ay, az, gx, gy, gz)) return false;
  m.p = atan2f(-ax, az) * RAD_A_GRADOS;
  m.r = atan2f(ay, sqrtf(ax * ax + az * az)) * RAD_A_GRADOS;
  m.iniciada = m.ok = true;
  return true;
}

float envolver(float a) {   // a −180…180
  while (a > 180.0f) a -= 360.0f;
  while (a < -180.0f) a += 360.0f;
  return a;
}

// Filtro complementario: giroscopio a corto plazo + acelerómetro a largo plazo.
void actualizarImu(int i, float dt) {
  Imu& m = imus[i];
  if (!m.iniciada) {
    if (millis() - m.ultimoIntento > 2000) iniciarImu(i);   // reintento si se desconectó un dedal
    return;
  }
  float ax, ay, az, gx, gy, gz;
  if (!seleccionarCanal(CANAL_IMU[i]) || !leerCrudo(ax, ay, az, gx, gy, gz)) {
    m.ok = false;
    m.iniciada = false;
    return;
  }
  m.gx = gx - m.bx; m.gy = gy - m.by; m.gz = gz - m.bz;
  float pAcc = atan2f(-ax, az) * RAD_A_GRADOS;
  float rAcc = atan2f(ay, sqrtf(ax * ax + az * az)) * RAD_A_GRADOS;
  float pGiro = m.p + m.gy * dt;
  m.p = envolver(pGiro + (1.0f - ALFA_GIRO) * envolver(pAcc - pGiro));
  m.r = ALFA_GIRO * (m.r + m.gx * dt) + (1.0f - ALFA_GIRO) * rAcc;
  m.ok = true;
}

// ---------------------------------------------------------------- Protocolo
String lineaId() {
  return String("ID,") + LADO + ",fw=" + FIRMWARE + ",imus=6,halls=0";
}

int lineaDatos(char* buf, size_t n) {
  int k = snprintf(buf, n, "D,%c,%lu,%lu", LADO, (unsigned long)seq, (unsigned long)millis());
  for (int i = 0; i < N_IMU; i++) k += snprintf(buf + k, n - k, ",%.1f,%.1f", imus[i].p, imus[i].r);
  uint8_t status = 0;
  for (int i = 0; i < N_IMU; i++) if (imus[i].ok) status |= (1 << i);
  k += snprintf(buf + k, n - k, ",%.1f,%.1f,%.1f,%u", imus[0].gx, imus[0].gy, imus[0].gz, status);
  return k;
}

void alRecibirWs(uint8_t cliente, WStype_t tipo, uint8_t* datos, size_t largo) {
  if (tipo == WStype_CONNECTED) {
    String id = lineaId();
    ws.sendTXT(cliente, id);
  } else if (tipo == WStype_TEXT) {
    String msg = String((const char*)datos, largo);
    msg.trim();
    if (msg == "ID?") {
      String id = lineaId();
      ws.sendTXT(cliente, id);
    }
  }
}

void leerSerie() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      entradaSerie.trim();
      if (entradaSerie == "ID?") Serial.println(lineaId());
      entradaSerie = "";
    } else if (entradaSerie.length() < 32) {
      entradaSerie += c;
    }
  }
}

// ---------------------------------------------------------------- WiFi
void iniciarWifi() {
  WiFi.setHostname(nombreRed());
#if MODO_WIFI == WIFI_PUNTO_ACCESO
  WiFi.mode(WIFI_AP);
  WiFi.softAP(WIFI_SSID, WIFI_PASS);
  Serial.printf("# Red creada: %s  IP %s\n", WIFI_SSID, WiFi.softAPIP().toString().c_str());
#else
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);          // menor retraso: sin ahorro de energía del radio
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.printf("# Conectando a %s…\n", WIFI_SSID);
#endif
}

void revisarMdns() {
  bool enRed = (MODO_WIFI == WIFI_PUNTO_ACCESO) || WiFi.status() == WL_CONNECTED;
  if (enRed && !mdnsListo) {
    if (MDNS.begin(nombreRed())) {
      MDNS.addService("ws", "tcp", PUERTO_WEBSOCKET);
      mdnsListo = true;
      Serial.printf("# En la red: ws://%s.local:%d/  (IP %s)\n", nombreRed(), PUERTO_WEBSOCKET,
                    WiFi.localIP().toString().c_str());
    }
  } else if (!enRed && mdnsListo) {
    MDNS.end();
    mdnsListo = false;
  }
}

// ---------------------------------------------------------------- Arduino
void setup() {
  Serial.begin(SERIAL_BAUDIOS);
  Wire.begin(PIN_SDA, PIN_SCL, I2C_HZ);
  delay(200);
  Serial.printf("# Pulsera %c · firmware %s\n", LADO, FIRMWARE);
  for (int i = 0; i < N_IMU; i++) {
    bool ok = iniciarImu(i);
    Serial.printf("# IMU %d (canal %d): %s\n", i, CANAL_IMU[i], ok ? "ok" : "NO RESPONDE");
  }
  iniciarWifi();
  ws.begin();
  ws.onEvent(alRecibirWs);
  Serial.println(lineaId());
  ultimoMicros = micros();
  proximo = millis();
}

void loop() {
  ws.loop();
  leerSerie();
  revisarMdns();
  uint32_t ahora = millis();
  if ((int32_t)(ahora - proximo) < 0) return;
  proximo += PERIODO_MS;
  if ((int32_t)(ahora - proximo) > 5 * PERIODO_MS) proximo = ahora + PERIODO_MS;   // tras una pausa larga

  uint32_t us = micros();
  float dt = (us - ultimoMicros) / 1e6f;
  ultimoMicros = us;
  for (int i = 0; i < N_IMU; i++) actualizarImu(i, dt);

  static char buf[200];
  int n = lineaDatos(buf, sizeof(buf));
  seq++;
  Serial.write((const uint8_t*)buf, n);
  Serial.write('\n');
  ws.broadcastTXT(buf, n);
}
