// Pulsera LSM: lee la MPU-6050 de la muñeca (dorso de la mano), por el TCA9548A o conectada directo, y envía
// las lecturas a la laptop por WebSocket (WiFi) y por USB serie, con el protocolo de texto de
// docs/arquitectura.md (sección 3):
//   laptop  → pulsera:  ID?
//   pulsera → laptop :  ID,<L|R>,fw=<versión>,imus=1,halls=0
//                       D,<L|R>,<seq>,<t_ms>,p0,r0,…,p5,r5,gx,gy,gz,<status>
// La línea D conserva los 6 lugares del protocolo (dorso + 5 dedos) para que la app no cambie: el 0 es la
// muñeca y los dedos van en 0.0 con su bit de status apagado (la app usa la cámara para los dedos).
// Ángulos en grados (1 decimal), giroscopio de la muñeca en °/s.
//
// Calibración de giroscopios: el comando CAL (USB o WebSocket) mide el sesgo de las IMU durante CAL_MS con la
// mano quieta, lo rechaza si alguna se movió y, si sale bien, lo guarda en la memoria del ESP32 (sobrevive al
// apagado). Responde CAL,<L|R>,midiendo,<ms> y luego CAL,<L|R>,ok,<variación máx °/s> o
// CAL,<L|R>,error,<movimiento|no_responde>,<imu>. Al encender se mide de nuevo solo si la mano está quieta;
// si no, se usa el sesgo guardado.
//
// Modo de prueba: el comando PRUEBA (monitor serie) activa/desactiva un resumen legible cada 0.5 s (Hz, WiFi,
// clientes, estado, ángulos y giro de cada IMU). Mientras está activo no se
// imprimen las líneas D por USB (por WiFi se siguen mandando). Los cambios de WiFi se avisan siempre con #.
//
// Con ESPERAR_WIFI (config.h) los sensores se inician y se empiezan a leer solo cuando la pulsera ya está
// conectada a la red; mientras tanto el monitor dice cada 2 s que está esperando.
//
// Montaje de la MPU-6050: eje X hacia los dedos, eje Z saliendo del dorso de la mano.
// Así "p" (inclinación) es subir/bajar la mano y cubre −180…180°; "r" es el giro lateral de la muñeca.

#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <WebSocketsServer.h>
#include <Preferences.h>

#include "config.h"
#if __has_include("secrets.h")
#include "secrets.h"
#else
#include "secrets.example.h"
#warning "Falta secrets.h: se usan los datos de ejemplo (copia secrets.example.h como secrets.h)"
#endif

static const int N_IMU = sizeof(CANAL_IMU) / sizeof(CANAL_IMU[0]);  // IMU conectadas (1: la muñeca)
static const int IMU_PROTOCOLO = 6;  // lugares de la línea D (dorso + 5 dedos), fijos para la app
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
bool hayMultiplexor = false;  // se detecta al encender: TCA9548A en DIR_TCA9548A o la MPU directo en el bus
String entradaSerie;
Preferences memoria;
bool calPendiente = false;  // se pidió CAL (se atiende en loop, fuera del callback del WebSocket)
bool modoPrueba = false;    // PRUEBA: resumen legible en el monitor serie en vez de las líneas D
uint32_t proximaPrueba = 0;
uint32_t lecturasSeg = 0, contadorHz = 0, inicioHz = 0;
int ultimoWifi = -1;
bool sensoresListos = false;  // IMU iniciadas y lecturas en marcha
uint32_t proximoAvisoEspera = 0;

const char* nombreRed() { return LADO == 'R' ? NOMBRE_DER : NOMBRE_IZQ; }

// ---------------------------------------------------------------- I²C
bool seleccionarCanal(uint8_t canal) {
  if (!hayMultiplexor) return true;  // MPU directo en SDA/SCL: no hay canal que elegir
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
  float ax, ay, az, gx, gy, gz, sx = 0, sy = 0, sz = 0, qx = 0, qy = 0, qz = 0;
  int n = 0;
  for (int k = 0; k < 100; k++) {
    if (leerCrudo(ax, ay, az, gx, gy, gz)) {
      sx += gx; sy += gy; sz += gz; qx += gx * gx; qy += gy * gy; qz += gz * gz; n++;
    }
    delay(2);
  }
  if (n < 50) return false;
  float sd = sqrtf(fmaxf(fmaxf(qx / n - sq(sx / n), qy / n - sq(sy / n)), qz / n - sq(sz / n)));
  if (sd <= CAL_MAX_STD || !sesgoGuardado(i, m)) {  // quieta (o sin nada guardado): sesgo medido ahora
    m.bx = sx / n; m.by = sy / n; m.bz = sz / n;
  }
  if (!leerCrudo(ax, ay, az, gx, gy, gz)) return false;
  m.p = atan2f(-ax, az) * RAD_A_GRADOS;
  m.r = atan2f(ay, sqrtf(ax * ax + az * az)) * RAD_A_GRADOS;
  m.iniciada = m.ok = true;
  return true;
}

// Ángulos iniciales desde el acelerómetro, conservando el sesgo del giroscopio.
void iniciarDesdeAcelerometro(int i) {
  Imu& m = imus[i];
  float ax, ay, az, gx, gy, gz;
  if (!seleccionarCanal(CANAL_IMU[i]) || !leerCrudo(ax, ay, az, gx, gy, gz)) return;
  m.p = atan2f(-ax, az) * RAD_A_GRADOS;
  m.r = atan2f(ay, sqrtf(ax * ax + az * az)) * RAD_A_GRADOS;
  m.iniciada = m.ok = true;
}

// ---------------------------------------------------------------- Calibración guardada
// Clave "b<i>": 3 floats (sesgo x, y, z en °/s) de la IMU i.
bool sesgoGuardado(int i, Imu& m) {
  char clave[3] = {'b', char('0' + i), 0};
  float b[3];
  if (memoria.getBytesLength(clave) != sizeof(b)) return false;
  memoria.getBytes(clave, b, sizeof(b));
  m.bx = b[0]; m.by = b[1]; m.bz = b[2];
  return true;
}

void guardarSesgo(int i, const Imu& m) {
  char clave[3] = {'b', char('0' + i), 0};
  float b[3] = {m.bx, m.by, m.bz};
  memoria.putBytes(clave, b, sizeof(b));
}

void responder(String linea) {
  Serial.println(linea);
  ws.broadcastTXT(linea);
}

// CAL: CAL_MS con la mano quieta. Todas las IMU se miden a la vez; si alguna se movió (o no responde) no cambia
// nada. Mientras dura no se mandan datos (la app hace la cuenta regresiva y espera la respuesta).
void calibrarGiroscopios() {
  String pre = String("CAL,") + LADO + ",";
  if (!sensoresListos) {
    responder(pre + "error,sin_iniciar,0");  // aún esperando el WiFi: las IMU no están configuradas
    return;
  }
  responder(pre + "midiendo," + CAL_MS);
  double s[N_IMU][3] = {}, q[N_IMU][3] = {};
  int n[N_IMU] = {};
  uint32_t t0 = millis();
  while (millis() - t0 < (uint32_t)CAL_MS) {
    for (int i = 0; i < N_IMU; i++) {
      float ax, ay, az, g[3];
      if (!seleccionarCanal(CANAL_IMU[i]) || !leerCrudo(ax, ay, az, g[0], g[1], g[2])) continue;
      for (int k = 0; k < 3; k++) { s[i][k] += g[k]; q[i][k] += (double)g[k] * g[k]; }
      n[i]++;
    }
    ws.loop();
    delay(5);
  }
  float peor = 0;
  for (int i = 0; i < N_IMU; i++) {
    if (n[i] < CAL_MIN_MUESTRAS) { responder(pre + "error,no_responde," + i); return; }
    for (int k = 0; k < 3; k++) {
      double media = s[i][k] / n[i];
      float sd = sqrt(fmax(0.0, q[i][k] / n[i] - media * media));
      if (sd > CAL_MAX_STD) { responder(pre + "error,movimiento," + i); return; }
      peor = fmaxf(peor, sd);
    }
  }
  for (int i = 0; i < N_IMU; i++) {
    Imu& m = imus[i];
    m.bx = s[i][0] / n[i]; m.by = s[i][1] / n[i]; m.bz = s[i][2] / n[i];
    guardarSesgo(i, m);
    iniciarDesdeAcelerometro(i);  // reinicia el filtro con el sesgo nuevo
  }
  responder(pre + "ok," + String(peor, 2));
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
    if (millis() - m.ultimoIntento > 2000) iniciarImu(i);   // reintento si se desconectó
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
  return String("ID,") + LADO + ",fw=" + FIRMWARE + ",imus=" + N_IMU + ",halls=0";
}

int lineaDatos(char* buf, size_t n) {
  int k = snprintf(buf, n, "D,%c,%lu,%lu", LADO, (unsigned long)seq, (unsigned long)millis());
  for (int i = 0; i < IMU_PROTOCOLO; i++) {
    if (i < N_IMU) k += snprintf(buf + k, n - k, ",%.1f,%.1f", imus[i].p, imus[i].r);
    else k += snprintf(buf + k, n - k, ",0.0,0.0");  // dedo sin sensor (bit de status apagado)
  }
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
    } else if (msg == "CAL") {
      calPendiente = true;
    }
  }
}

void leerSerie() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      entradaSerie.trim();
      if (entradaSerie == "ID?") Serial.println(lineaId());
      else if (entradaSerie == "CAL") calPendiente = true;
      else if (entradaSerie == "PRUEBA") {
        modoPrueba = !modoPrueba;
        Serial.println(modoPrueba ? "# Modo de prueba ACTIVADO (escribe PRUEBA para salir)" : "# Modo de prueba desactivado");
      } else if (entradaSerie.length()) {
        Serial.println("# Comando desconocido. Usa: ID?  CAL  PRUEBA");
      }
      entradaSerie = "";
    } else if (entradaSerie.length() < 32) {
      entradaSerie += c;
    }
  }
}

// ---------------------------------------------------------------- Pruebas
const char* NOMBRES_IMU[IMU_PROTOCOLO] = {"muneca ", "pulgar ", "indice ", "medio  ", "anular ", "menique"};

String textoCanal(int i) {
  if (!hayMultiplexor) return "directo";
  return String("canal ") + CANAL_IMU[i];
}

String textoWifi() {
#if MODO_WIFI == WIFI_PUNTO_ACCESO
  return String("red propia ") + WIFI_SSID + " IP " + WiFi.softAPIP().toString() + " equipos " + WiFi.softAPgetStationNum();
#else
  switch (WiFi.status()) {
    case WL_CONNECTED: return String("conectado a ") + WIFI_SSID + " IP " + WiFi.localIP().toString() + " (" + nombreRed() + ".local)";
    case WL_NO_SSID_AVAIL: return String("no encuentra la red ") + WIFI_SSID + " (revisa el nombre y que sea 2.4 GHz)";
    case WL_CONNECT_FAILED: return String("no pudo entrar a ") + WIFI_SSID + " (revisa la contrasena en secrets.h)";
    case WL_CONNECTION_LOST: return "se perdio la conexion, reintentando";
    case WL_DISCONNECTED: return String("conectando a ") + WIFI_SSID + "...";
    default: return String("estado ") + (int)WiFi.status();
  }
#endif
}

// Avisa por el monitor cada vez que cambia el estado del WiFi (siempre, con o sin modo de prueba).
void avisarWifi() {
#if MODO_WIFI != WIFI_PUNTO_ACCESO
  int st = WiFi.status();
  if (st == ultimoWifi) return;
  ultimoWifi = st;
  Serial.println(String("# WiFi: ") + textoWifi());
#endif
}

void imprimirPrueba() {
  Serial.printf("# ---- t=%.1f s | %lu Hz | WiFi: %s | app por WiFi: %u\n", millis() / 1000.0f, (unsigned long)lecturasSeg,
                textoWifi().c_str(), (unsigned)ws.connectedClients());
  for (int i = 0; i < N_IMU; i++) {
    const Imu& m = imus[i];
    if (!m.ok) {
      Serial.printf("#  %s %s  NO RESPONDE (revisa el cable)\n", NOMBRES_IMU[i], textoCanal(i).c_str());
      continue;
    }
    if (i == 0) {
      Serial.printf("#  %s %s  ok   inclinacion=%7.1f  giro lateral=%7.1f  vel=%6.1f %6.1f %6.1f\n", NOMBRES_IMU[i],
                    textoCanal(i).c_str(), m.p, m.r, m.gx, m.gy, m.gz);
    } else {
      float flex = imus[0].ok ? envolver(m.p - imus[0].p) : NAN;
      Serial.printf("#  %s %s  ok   p=%7.1f  r=%7.1f  flexion=%7.1f\n", NOMBRES_IMU[i], textoCanal(i).c_str(), m.p, m.r, flex);
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
  memoria.begin("pulsera", false);  // sesgo de los giroscopios guardado por CAL
  delay(200);
  Serial.printf("# Pulsera %c · firmware %s\n", LADO, FIRMWARE);
  Wire.beginTransmission(DIR_TCA9548A);
  hayMultiplexor = Wire.endTransmission() == 0;
  Serial.println(hayMultiplexor ? "# Multiplexor TCA9548A encontrado: la IMU se lee por su canal"
                                : "# Sin multiplexor: la IMU se lee directo en SDA/SCL");
  iniciarWifi();
  ws.begin();
  ws.onEvent(alRecibirWs);
  Serial.println(lineaId());
  Serial.println("# Comandos: ID?  CAL (calibrar giroscopios, mano quieta)  PRUEBA (resumen legible)");
  if (!debeEsperarWifi()) iniciarSensores();
}

// Con ESPERAR_WIFI en modo estación, los sensores esperan a que la pulsera se conecte a la red.
bool debeEsperarWifi() {
#if ESPERAR_WIFI && MODO_WIFI == WIFI_ESTACION
  return true;
#else
  return false;
#endif
}

void iniciarSensores() {
  Serial.println("# Iniciando sensores: mano quieta un momento (se mide el sesgo del giroscopio)");
  for (int i = 0; i < N_IMU; i++) {
    bool ok = iniciarImu(i);
    Serial.printf("# IMU %s(%s): %s\n", NOMBRES_IMU[i], textoCanal(i).c_str(), ok ? "ok" : "NO RESPONDE");
  }
  sensoresListos = true;
  ultimoMicros = micros();
  proximo = millis();
  Serial.println("# Lecturas en marcha");
}

void loop() {
  ws.loop();
  leerSerie();
  revisarMdns();
  avisarWifi();
  if (!sensoresListos) {
    if (WiFi.status() == WL_CONNECTED) {
      iniciarSensores();
    } else {
      if ((int32_t)(millis() - proximoAvisoEspera) >= 0) {
        proximoAvisoEspera = millis() + 2000;
        Serial.println(String("# Esperando WiFi para empezar las lecturas: ") + textoWifi());
      }
      if (calPendiente) {
        calPendiente = false;
        calibrarGiroscopios();  // responde que aún no hay sensores
      }
      return;
    }
  }
  if (calPendiente) {
    calPendiente = false;
    calibrarGiroscopios();
    ultimoMicros = micros();
    proximo = millis();
  }
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
  if (!modoPrueba) {
    Serial.write((const uint8_t*)buf, n);
    Serial.write('\n');
  }
  ws.broadcastTXT(buf, n);

  contadorHz++;
  if (ahora - inicioHz >= 1000) {
    lecturasSeg = contadorHz;
    contadorHz = 0;
    inicioHz = ahora;
  }
  if (modoPrueba && (int32_t)(ahora - proximaPrueba) >= 0) {
    proximaPrueba = ahora + 500;
    imprimirPrueba();
  }
}
