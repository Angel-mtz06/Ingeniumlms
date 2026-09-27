# Plan 4: Firmware del guante (ESP32) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Firmware PlatformIO para cada guante (ESP32 clásico o ESP32-S3) que lee 6 MPU-6050 por un TCA9548A y 7–8 sensores Hall, calcula pitch/roll con filtro complementario y envía el protocolo de texto del spec §7.4 por USB, con modo simulado para trabajar sin sensores.

**Architecture:** La lógica pura (formato de líneas, filtro complementario, simulación, mapa de IMUs) vive en `lib/core/` como funciones `inline` sin Arduino, probadas en la PC con la plataforma `windows_x86` de PlatformIO (Unity). El código dependiente del hardware (`Wire`, ADC, watchdog) vive en `lib/hw/` y `src/main.cpp`. Una prueba de contrato en Python verifica que el parser del servidor entienda exactamente las líneas que produce el firmware.

**Tech Stack:** PlatformIO Core 6.1 (en el venv de `D:`), plataforma espressif32 6.8.1 (Arduino-ESP32 2.0.17), plataforma windows_x86 (MinGW) para pruebas nativas, Unity.

**Spec:** `D:\Ingenium\docs\superpowers\specs\2026-09-27-lsm-ingenium-design.md` (secciones 7.1–7.4)

## Global Constraints

- Todo en `D:\Ingenium`: `PLATFORMIO_CORE_DIR=D:/Ingenium/tools/platformio` (toolchains, paquetes y caché). Nunca escribir en `C:`.
- Protocolo exacto (spec §7.4): `ID,<L|R>,fw=1.0,imus=6,halls=<n>` y `D,<L|R>,<seq>,<t_ms>,p0,r0,…,p5,r5,gx,gy,gz,h0,…,h(n−1),<status>`; números con 1 decimal para ángulos y giroscopio, enteros para Hall; `status` en decimal, bit `i` = IMU `i` respondió en la última lectura.
- IMU `i` → canal TCA `i/2`, dirección `0x68 + (i % 2)`: 0 dorso, 1 pulgar, 2 índice, 3 medio, 4 anular, 5 meñique.
- Lectura a 100 Hz, envío a 50 Hz; `Serial` a 921600 baudios; responder `ID?` en cualquier momento.
- Todo a 3.3 V (pin `3V3`); sin WiFi (el ADC2 queda libre).
- Lado del guante definido al compilar: `-DGLOVE_SIDE='R'` o `'L'`. Modo simulado: `-DSIMULATE`.
- Cada commit termina con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Estructura de archivos

```
D:\Ingenium\firmware\
├── platformio.ini
├── lib/
│   ├── core/                 # sin Arduino: probado en la PC
│   │   ├── protocol.h        # formatData, formatId
│   │   ├── filter.h          # accelAngles, Attitude, complementary
│   │   ├── imu_map.h         # imuChannel, imuAddress, N_IMU
│   │   └── simulate.h        # waveFlex (igual que lsm/glove/simulator.py)
│   └── hw/
│       ├── mpu6050.h/.cpp    # registro a registro, sin librerías externas
│       └── tca9548a.h/.cpp
├── src/main.cpp
└── test/test_core/test_core.cpp
D:\Ingenium\server\tests\test_firmware_contract.py
```

---

### Task 1: PlatformIO en D: y lógica pura con pruebas nativas

**Files:**
- Create: `D:\Ingenium\firmware\platformio.ini`
- Create: `D:\Ingenium\firmware\lib\core\protocol.h`, `filter.h`, `imu_map.h`, `simulate.h`
- Test: `D:\Ingenium\firmware\test\test_core\test_core.cpp`
- Test: `D:\Ingenium\server\tests\test_firmware_contract.py`
- Modify: `D:\Ingenium\tools\env.sh` (agregar `PLATFORMIO_CORE_DIR`)

**Interfaces:**
- Produces (C++, `inline`, sin Arduino):
  - `int formatData(char* buf, size_t n, char side, uint32_t seq, uint32_t t_ms, const float pitch[6], const float roll[6], const float gyro[3], const int* hall, int nHall, uint8_t status)` → longitud escrita (sin `\n`).
  - `int formatId(char* buf, size_t n, char side, const char* fw, int imus, int halls)`.
  - `struct Attitude { float pitch; float roll; bool init; }`; `void accelAngles(float ax, float ay, float az, float& pitch, float& roll)` (grados); `void complementary(Attitude& a, float ax, float ay, float az, float gx, float gy, float dt, float alpha = 0.98f)`.
  - `constexpr int N_IMU = 6`; `uint8_t imuChannel(int i)`; `uint8_t imuAddress(int i)`.
  - `void waveFlex(uint32_t t_ms, float out[5])` = `45 + 40·sin(2π·(t/2000 + f/5))`.

- [ ] **Step 1: Instalar PlatformIO en el venv y apuntar su directorio a D:** (pedir permiso al usuario: `platformio` desde PyPI ~10 MB; luego PlatformIO descarga el toolchain de ESP32 ~600 MB y MinGW ~150 MB, todo en `D:/Ingenium/tools/platformio`)

Agregar a `D:\Ingenium\tools\env.sh`:
```bash
export PLATFORMIO_CORE_DIR=D:/Ingenium/tools/platformio
```
Run: `source D:/Ingenium/tools/env.sh && uv pip install --python D:/Ingenium/.venv/Scripts/python.exe platformio==6.1.16 && pio --version`
Expected: `PlatformIO Core, version 6.1.16`

- [ ] **Step 2: Crear `platformio.ini`**

```ini
; D:/Ingenium/firmware/platformio.ini
[platformio]
default_envs = glove_r

[esp32_common]
platform = espressif32@6.8.1
framework = arduino
monitor_speed = 921600
lib_deps =
build_flags = -Ilib/core

[env:glove_r]
extends = esp32_common
board = esp32dev
build_flags = ${esp32_common.build_flags} -DGLOVE_SIDE=\'R\'

[env:glove_l]
extends = esp32_common
board = esp32dev
build_flags = ${esp32_common.build_flags} -DGLOVE_SIDE=\'L\'

[env:glove_r_s3]
extends = esp32_common
board = esp32-s3-devkitc-1
build_flags = ${esp32_common.build_flags} -DGLOVE_SIDE=\'R\' -DBOARD_S3 -DARDUINO_USB_CDC_ON_BOOT=1

[env:glove_l_s3]
extends = esp32_common
board = esp32-s3-devkitc-1
build_flags = ${esp32_common.build_flags} -DGLOVE_SIDE=\'L\' -DBOARD_S3 -DARDUINO_USB_CDC_ON_BOOT=1

[env:sim_r]
extends = esp32_common
board = esp32dev
build_flags = ${esp32_common.build_flags} -DGLOVE_SIDE=\'R\' -DSIMULATE

[env:native]
platform = windows_x86
build_flags = -Ilib/core -std=c++17
test_build_src = no
```

- [ ] **Step 3: Escribir las pruebas nativas**

```cpp
// D:/Ingenium/firmware/test/test_core/test_core.cpp
#include <math.h>
#include <string.h>
#include <unity.h>

#include "filter.h"
#include "imu_map.h"
#include "protocol.h"
#include "simulate.h"

void setUp() {}
void tearDown() {}

void test_format_data_golden() {
  const float pitch[6] = {0, 10, 20, 30, 40, 50};
  const float roll[6] = {0, 0, 0, 0, 0, -1.25f};
  const float gyro[3] = {0.5f, -0.5f, 0};
  const int hall[2] = {2048, 2648};
  char buf[256];
  int n = formatData(buf, sizeof buf, 'R', 7, 1234, pitch, roll, gyro, hall, 2, 63);
  TEST_ASSERT_EQUAL_STRING(
      "D,R,7,1234,0.0,0.0,10.0,0.0,20.0,0.0,30.0,0.0,40.0,0.0,50.0,-1.2,0.5,-0.5,0.0,2048,2648,63", buf);
  TEST_ASSERT_EQUAL_INT((int)strlen(buf), n);
}

void test_format_id() {
  char buf[64];
  formatId(buf, sizeof buf, 'L', "1.0", 6, 8);
  TEST_ASSERT_EQUAL_STRING("ID,L,fw=1.0,imus=6,halls=8", buf);
}

void test_accel_angles_flat_and_tilted() {
  float p, r;
  accelAngles(0, 0, 1, p, r);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 0, p);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 0, r);
  accelAngles(-1, 0, 0, p, r);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 90, p);
}

void test_complementary_converges_to_accel() {
  Attitude a{};
  for (int i = 0; i < 500; i++) complementary(a, -0.5f, 0, 0.8660254f, 0, 0, 0.01f);
  TEST_ASSERT_FLOAT_WITHIN(0.1f, 30, a.pitch);
}

void test_complementary_integrates_gyro_short_term() {
  Attitude a{};
  complementary(a, 0, 0, 1, 0, 0, 0.01f);  // inicializa en 0
  complementary(a, 0, 0, 1, 0, 100, 0.01f);  // 100 °/s por 10 ms
  TEST_ASSERT_FLOAT_WITHIN(0.05f, 0.98f, a.pitch);
}

void test_imu_map() {
  TEST_ASSERT_EQUAL_UINT8(0, imuChannel(0));
  TEST_ASSERT_EQUAL_UINT8(0x69, imuAddress(1));
  TEST_ASSERT_EQUAL_UINT8(2, imuChannel(5));
  TEST_ASSERT_EQUAL_UINT8(0x68, imuAddress(4));
}

void test_wave_flex_range() {
  float f[5];
  for (uint32_t t = 0; t < 4000; t += 250) {
    waveFlex(t, f);
    for (int i = 0; i < 5; i++) TEST_ASSERT_TRUE(f[i] >= 5 && f[i] <= 85);
  }
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_format_data_golden);
  RUN_TEST(test_format_id);
  RUN_TEST(test_accel_angles_flat_and_tilted);
  RUN_TEST(test_complementary_converges_to_accel);
  RUN_TEST(test_complementary_integrates_gyro_short_term);
  RUN_TEST(test_imu_map);
  RUN_TEST(test_wave_flex_range);
  return UNITY_END();
}
```

- [ ] **Step 4: Escribir la prueba de contrato en Python**

```python
# D:/Ingenium/server/tests/test_firmware_contract.py
"""La línea dorada de firmware/test/test_core/test_core.cpp debe ser entendida por el parser del servidor."""
import numpy as np

from lsm.glove.protocol import GloveId, GloveReading, parse_line

GOLDEN = "D,R,7,1234,0.0,0.0,10.0,0.0,20.0,0.0,30.0,0.0,40.0,0.0,50.0,-1.2,0.5,-0.5,0.0,2048,2648,63"


def test_golden_line_parses():
    r = parse_line(GOLDEN)
    assert isinstance(r, GloveReading) and (r.side, r.seq, r.t_ms, r.status) == ("R", 7, 1234, 63)
    np.testing.assert_allclose(r.pitch, [0, 10, 20, 30, 40, 50])
    np.testing.assert_allclose(r.roll[5], -1.2)
    np.testing.assert_allclose(r.hall, [2048, 2648])


def test_golden_id_parses():
    assert parse_line("ID,L,fw=1.0,imus=6,halls=8") == GloveId("L", "1.0", 6, 8)


def test_golden_line_is_in_firmware_test():
    src = open("D:/Ingenium/firmware/test/test_core/test_core.cpp", encoding="utf-8").read()
    assert GOLDEN in src.replace('"\n      "', "")
```

- [ ] **Step 5: Correr para verificar que fallan**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium/firmware && pio test -e native`
Expected: error de compilación `protocol.h: No such file or directory`.
Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_firmware_contract.py -v`
Expected: `test_golden_line_is_in_firmware_test` PASS (el archivo ya existe) y las otras dos PASS solo si el Plan 2 (Task 4) ya está hecho; si `lsm.glove` no existe todavía, FAIL con `ModuleNotFoundError` — anotarlo en el reporte y seguir.

- [ ] **Step 6: Implementar los encabezados de `lib/core`**

```cpp
// D:/Ingenium/firmware/lib/core/protocol.h
#pragma once
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

inline int appendf(char* buf, size_t n, int pos, const char* fmt, double v) {
  if (pos < 0 || (size_t)pos >= n) return pos;
  return pos + snprintf(buf + pos, n - pos, fmt, v);
}

inline int formatData(char* buf, size_t n, char side, uint32_t seq, uint32_t t_ms, const float pitch[6],
                      const float roll[6], const float gyro[3], const int* hall, int nHall, uint8_t status) {
  int pos = snprintf(buf, n, "D,%c,%lu,%lu", side, (unsigned long)seq, (unsigned long)t_ms);
  for (int i = 0; i < 6; i++) {
    pos = appendf(buf, n, pos, ",%.1f", pitch[i]);
    pos = appendf(buf, n, pos, ",%.1f", roll[i]);
  }
  for (int i = 0; i < 3; i++) pos = appendf(buf, n, pos, ",%.1f", gyro[i]);
  for (int i = 0; i < nHall; i++) pos = appendf(buf, n, pos, ",%.0f", (double)hall[i]);
  pos = appendf(buf, n, pos, ",%.0f", (double)status);
  return pos;
}

inline int formatId(char* buf, size_t n, char side, const char* fw, int imus, int halls) {
  return snprintf(buf, n, "ID,%c,fw=%s,imus=%d,halls=%d", side, fw, imus, halls);
}
```

```cpp
// D:/Ingenium/firmware/lib/core/filter.h
#pragma once
#include <math.h>

struct Attitude {
  float pitch = 0;
  float roll = 0;
  bool init = false;
};

constexpr float RAD2DEG = 57.2957795f;

inline void accelAngles(float ax, float ay, float az, float& pitch, float& roll) {
  pitch = atan2f(-ax, sqrtf(ay * ay + az * az)) * RAD2DEG;
  roll = atan2f(ay, az) * RAD2DEG;
}

inline void complementary(Attitude& a, float ax, float ay, float az, float gx, float gy, float dt,
                          float alpha = 0.98f) {
  float p, r;
  accelAngles(ax, ay, az, p, r);
  if (!a.init) {
    a.pitch = p;
    a.roll = r;
    a.init = true;
    return;
  }
  a.pitch = alpha * (a.pitch + gy * dt) + (1 - alpha) * p;
  a.roll = alpha * (a.roll + gx * dt) + (1 - alpha) * r;
}
```

```cpp
// D:/Ingenium/firmware/lib/core/imu_map.h
#pragma once
#include <stdint.h>

// 0 dorso, 1 pulgar, 2 índice, 3 medio, 4 anular, 5 meñique
constexpr int N_IMU = 6;
inline uint8_t imuChannel(int i) { return (uint8_t)(i / 2); }
inline uint8_t imuAddress(int i) { return (uint8_t)(0x68 + (i % 2)); }
```

```cpp
// D:/Ingenium/firmware/lib/core/simulate.h
#pragma once
#include <math.h>
#include <stdint.h>

// Igual que server/lsm/glove/simulator.py::wave_flex
inline void waveFlex(uint32_t t_ms, float out[5]) {
  for (int f = 0; f < 5; f++) out[f] = 45.0f + 40.0f * sinf(2.0f * 3.14159265f * (t_ms / 2000.0f + f / 5.0f));
}
```

Nota sobre el redondeo: `%.1f` de `-1.25` produce `-1.2` (redondeo al par más cercano en MinGW y en newlib); la línea dorada lo asume. Si en la PC sale `-1.3`, cambiar el valor de prueba a `-1.24f` y actualizar la línea dorada en **ambos** archivos de prueba.

- [ ] **Step 7: Correr las pruebas nativas y la de contrato**

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium/firmware && pio test -e native`
Expected: `7 Tests 0 Failures 0 Ignored`
Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium && python -m pytest server/tests/test_firmware_contract.py -v`
Expected: 3 PASS (o solo el de archivo si `lsm.glove` aún no existe; ver Step 5).

- [ ] **Step 8: Commit**

```bash
cd D:/Ingenium && git add firmware/platformio.ini firmware/lib/core firmware/test server/tests/test_firmware_contract.py
git add -f tools/env.sh
git commit -m "feat(firmware): protocolo, filtro complementario y simulación con pruebas nativas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Agregar también a `D:\Ingenium\.gitignore`: `firmware/.pio/` (ya cubierto por `.pio/`; verificar con `git status`).

---

### Task 2: Controladores de hardware y programa principal

**Files:**
- Create: `D:\Ingenium\firmware\lib\hw\tca9548a.h`, `tca9548a.cpp`
- Create: `D:\Ingenium\firmware\lib\hw\mpu6050.h`, `mpu6050.cpp`
- Create: `D:\Ingenium\firmware\src\main.cpp`

**Interfaces:**
- Consumes: todo `lib/core` (Task 1).
- Produces: binarios para `glove_r`, `glove_l`, `glove_r_s3`, `glove_l_s3`, `sim_r`. Pines: ESP32 clásico SDA 21 / SCL 22, Hall en GPIO 32, 33, 34, 35, 36, 39, 25, 26, LED en GPIO 2; ESP32-S3 SDA 41 / SCL 42, Hall en GPIO 1–8, sin LED.

- [ ] **Step 1: Implementar los controladores**

```cpp
// D:/Ingenium/firmware/lib/hw/tca9548a.h
#pragma once
#include <stdint.h>
constexpr uint8_t TCA_ADDR = 0x70;
bool tcaSelect(uint8_t channel);
```

```cpp
// D:/Ingenium/firmware/lib/hw/tca9548a.cpp
#include "tca9548a.h"
#include <Wire.h>

bool tcaSelect(uint8_t channel) {
  if (channel > 7) return false;
  Wire.beginTransmission(TCA_ADDR);
  Wire.write((uint8_t)(1 << channel));
  return Wire.endTransmission() == 0;
}
```

```cpp
// D:/Ingenium/firmware/lib/hw/mpu6050.h
#pragma once
#include <stdint.h>

struct ImuSample {
  float ax, ay, az;  // g
  float gx, gy, gz;  // °/s
};

class Mpu6050 {
 public:
  explicit Mpu6050(uint8_t addr) : addr_(addr) {}
  bool begin();                 // ±4 g, ±500 °/s, DLPF 44 Hz
  bool read(ImuSample& s);

 private:
  uint8_t addr_;
  bool write(uint8_t reg, uint8_t val);
};
```

```cpp
// D:/Ingenium/firmware/lib/hw/mpu6050.cpp
#include "mpu6050.h"
#include <Wire.h>

bool Mpu6050::write(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(addr_);
  Wire.write(reg);
  Wire.write(val);
  return Wire.endTransmission() == 0;
}

bool Mpu6050::begin() {
  return write(0x6B, 0x00) && write(0x1A, 0x03) && write(0x1B, 0x08) && write(0x1C, 0x08);
}

bool Mpu6050::read(ImuSample& s) {
  Wire.beginTransmission(addr_);
  Wire.write(0x3B);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)addr_, 14) != 14) return false;
  int16_t v[7];
  for (int i = 0; i < 7; i++) v[i] = (int16_t)((Wire.read() << 8) | Wire.read());
  s.ax = v[0] / 8192.0f;
  s.ay = v[1] / 8192.0f;
  s.az = v[2] / 8192.0f;
  s.gx = v[4] / 65.5f;
  s.gy = v[5] / 65.5f;
  s.gz = v[6] / 65.5f;
  return true;
}
```

- [ ] **Step 2: Implementar `main.cpp`**

```cpp
// D:/Ingenium/firmware/src/main.cpp
#include <Arduino.h>
#include <Wire.h>
#include <esp_task_wdt.h>

#include "filter.h"
#include "imu_map.h"
#include "mpu6050.h"
#include "protocol.h"
#include "simulate.h"
#include "tca9548a.h"

#ifndef GLOVE_SIDE
#define GLOVE_SIDE 'R'
#endif

#ifdef BOARD_S3
constexpr int SDA_PIN = 41, SCL_PIN = 42, LED_PIN = -1;
constexpr int HALL_PINS[] = {1, 2, 3, 4, 5, 6, 7, 8};
#else
constexpr int SDA_PIN = 21, SCL_PIN = 22, LED_PIN = 2;
constexpr int HALL_PINS[] = {32, 33, 34, 35, 36, 39, 25, 26};
#endif
constexpr int N_HALL = sizeof(HALL_PINS) / sizeof(HALL_PINS[0]);
constexpr char FW[] = "1.0";
constexpr uint32_t READ_US = 10000, SEND_MS = 20, RETRY_MS = 2000;

Mpu6050* imus[N_IMU];
Attitude att[N_IMU];
float gyroBack[3] = {0, 0, 0};
uint8_t status = 0;
uint32_t seq = 0, lastRead = 0, lastSend = 0, lastRetry = 0;
char line[256];
String cmd;

bool readImu(int i, ImuSample& s) {
  return tcaSelect(imuChannel(i)) && imus[i]->read(s);
}

void initImus() {
  for (int i = 0; i < N_IMU; i++) {
    if (status & (1 << i)) continue;
    if (tcaSelect(imuChannel(i)) && imus[i]->begin()) status |= (1 << i);
  }
}

void sendId() {
  formatId(line, sizeof line, GLOVE_SIDE, FW, N_IMU, N_HALL);
  Serial.println(line);
}

void pollSerial() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (cmd == "ID?") sendId();
      cmd = "";
    } else if (cmd.length() < 16) {
      cmd += c;
    }
  }
}

void setup() {
  Serial.begin(921600);
  esp_task_wdt_init(3, true);
  esp_task_wdt_add(NULL);
  if (LED_PIN >= 0) pinMode(LED_PIN, OUTPUT);
  for (int i = 0; i < N_IMU; i++) imus[i] = new Mpu6050(imuAddress(i));
#ifndef SIMULATE
  Wire.begin(SDA_PIN, SCL_PIN, 400000);
  analogReadResolution(12);
  initImus();
#else
  status = 0b111111;
#endif
  sendId();
  lastRead = micros();
}

void loop() {
  esp_task_wdt_reset();
  pollSerial();
  uint32_t now = micros();
  if (now - lastRead >= READ_US) {
    float dt = (now - lastRead) / 1e6f;
    lastRead = now;
#ifdef SIMULATE
    float flex[5];
    waveFlex(millis(), flex);
    att[0].pitch = 0;
    for (int f = 0; f < 5; f++) att[f + 1].pitch = flex[f];
#else
    for (int i = 0; i < N_IMU; i++) {
      ImuSample s;
      if (!(status & (1 << i))) continue;
      if (!readImu(i, s)) {
        status &= ~(1 << i);
        continue;
      }
      complementary(att[i], s.ax, s.ay, s.az, s.gx, s.gy, dt);
      if (i == 0) {
        gyroBack[0] = s.gx;
        gyroBack[1] = s.gy;
        gyroBack[2] = s.gz;
      }
    }
#endif
  }
#ifndef SIMULATE
  if (millis() - lastRetry >= RETRY_MS) {
    lastRetry = millis();
    initImus();
  }
#endif
  if (millis() - lastSend >= SEND_MS) {
    lastSend = millis();
    float pitch[N_IMU], roll[N_IMU];
    for (int i = 0; i < N_IMU; i++) {
      pitch[i] = att[i].pitch;
      roll[i] = att[i].roll;
    }
    int hall[N_HALL];
    for (int h = 0; h < N_HALL; h++) {
#ifdef SIMULATE
      hall[h] = 2048;
#else
      int acc = 0;
      for (int k = 0; k < 4; k++) acc += analogRead(HALL_PINS[h]);
      hall[h] = acc / 4;
#endif
    }
    formatData(line, sizeof line, GLOVE_SIDE, seq++, millis(), pitch, roll, gyroBack, hall, N_HALL, status);
    Serial.println(line);
    if (LED_PIN >= 0) digitalWrite(LED_PIN, status == 0b111111 ? HIGH : ((millis() / 250) % 2));
  }
}
```

- [ ] **Step 3: Compilar todos los entornos** (descarga el toolchain la primera vez, ~10 min)

Run: `source D:/Ingenium/tools/env.sh && cd D:/Ingenium/firmware && pio run -e glove_r -e glove_l -e glove_r_s3 -e glove_l_s3 -e sim_r`
Expected: `SUCCESS` en los 5 entornos. Anotar RAM/Flash usados.

- [ ] **Step 4: Prueba en placa real con modo simulado** (solo si hay un ESP32 conectado por USB; no requiere sensores)

Run:
```bash
source D:/Ingenium/tools/env.sh && cd D:/Ingenium/firmware && pio device list
pio run -e sim_r -t upload && pio device monitor -b 921600 --quiet | head -5
```
Expected: una línea `ID,R,fw=1.0,imus=6,halls=8` y líneas `D,R,...,63`. Pegar 3 líneas en el reporte y verificar con:
`source D:/Ingenium/tools/env.sh && python -c "from lsm.glove.protocol import parse_line; print(parse_line('<línea pegada>'))"`
Si no hay placa conectada, anotarlo en el reporte (la Task 1 ya garantiza el formato).

- [ ] **Step 5: Commit**

```bash
cd D:/Ingenium && git add firmware/lib/hw firmware/src
git commit -m "feat(firmware): controladores MPU-6050/TCA9548A y programa principal con modo simulado

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Guía de cableado para el evento (para el esquema de instrumentación)

| Señal | ESP32 clásico | ESP32-S3 |
|---|---|---|
| SDA / SCL → TCA9548A | GPIO 21 / 22 | GPIO 41 / 42 |
| TCA canal 0 | dorso (AD0→GND, 0x68) + pulgar (AD0→3V3, 0x69) | igual |
| TCA canal 1 | índice (0x68) + medio (0x69) | igual |
| TCA canal 2 | anular (0x68) + meñique (0x69) | igual |
| Hall 0–3 (contacto pulgar con índice, medio, anular, meñique) | GPIO 32, 33, 34, 35 | GPIO 1, 2, 3, 4 |
| Hall 4–7 (separación entre dedos) | GPIO 36, 39, 25, 26 | GPIO 5, 6, 7, 8 |
| Alimentación de todo | 3V3 y GND | 3V3 y GND |

Los Hall 0–3 alimentan `contacts()` del servidor; el imán va en la punta del pulgar y cada sensor en la yema del dedo correspondiente.
