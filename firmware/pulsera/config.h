// Configuración de la pulsera. Ajusta estos valores al armado real antes de cargar el código.
#pragma once

// ---------- Mano ----------
// 'R' = pulsera derecha, 'L' = pulsera izquierda. Carga el código una vez con cada valor.
#define LADO 'R'

// ---------- WiFi ----------
// WIFI_ESTACION: la pulsera se conecta a la zona con cobertura de la laptop (recomendado: la laptop conserva internet).
// WIFI_PUNTO_ACCESO: la pulsera crea la red (solo en UNA pulsera; la otra se configura como estación).
#define WIFI_ESTACION 1
#define WIFI_PUNTO_ACCESO 2
#define MODO_WIFI WIFI_ESTACION
// El nombre y la contraseña de la red van en secrets.h (no se sube a git; copia secrets.example.h).

#define PUERTO_WEBSOCKET 81
// Nombre en la red (mDNS): pulsera-der.local / pulsera-izq.local
#define NOMBRE_DER "pulsera-der"
#define NOMBRE_IZQ "pulsera-izq"

// ---------- I²C y multiplexor ----------
#define PIN_SDA 21          // ESP32 DevKit: SDA = GPIO21
#define PIN_SCL 22          // ESP32 DevKit: SCL = GPIO22
#define I2C_HZ 400000
#define DIR_TCA9548A 0x70   // A0–A2 a GND
#define DIR_MPU6050 0x68    // AD0 a GND en todas las MPU (el multiplexor las separa)

// Canal del TCA9548A de cada IMU, en el orden del protocolo:
// 0 = dorso (pulsera), 1 = pulgar, 2 = índice, 3 = medio, 4 = anular, 5 = meñique
static const uint8_t CANAL_IMU[6] = {0, 1, 2, 3, 4, 5};

// ---------- Envío ----------
#define PERIODO_MS 20       // 50 lecturas por segundo
#define SERIAL_BAUDIOS 921600
#define FIRMWARE "1.0"

// Filtro complementario: peso del giroscopio (0–1). Más alto = más suave, más bajo = responde más rápido.
#define ALFA_GIRO 0.96f
