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
// 1 = no se inician ni se leen los sensores hasta estar conectada a la red (solo en WIFI_ESTACION).
// 0 = empieza a leer de inmediato (útil para probar solo por USB, sin la zona con cobertura).
#define ESPERAR_WIFI 1

// IP fija en la zona con cobertura de Windows (siempre 192.168.137.x; la laptop es la .1): la app ya la trae
// escrita. 0 = la IP que asigne la red (entonces usa pulsera-der.local o la IP que diga el monitor serie).
#define IP_FIJA 1
#define IP_PULSERA_DER 192, 168, 137, 190
#define IP_PULSERA_IZQ 192, 168, 137, 191
#define IP_PUERTA 192, 168, 137, 1
#define IP_MASCARA 255, 255, 255, 0

#define PUERTO_WEBSOCKET 81
// Nombre en la red (mDNS): pulsera-der.local / pulsera-izq.local
#define NOMBRE_DER "pulsera-der"
#define NOMBRE_IZQ "pulsera-izq"

// ---------- I²C y multiplexor ----------
// Pulsera derecha: ESP32-C3 Super Mini (pines confirmados con el código de prueba del equipo).
#define PIN_SDA 8           // ESP32-C3 Super Mini: SDA = GPIO8
#define PIN_SCL 9           // ESP32-C3 Super Mini: SCL = GPIO9
#define I2C_HZ 100000       // 100 kHz: estable con los cables largos hasta los dedales
#define DIR_TCA9548A 0x70   // A0–A2 a GND
#define DIR_MPU6050 0x68    // AD0 a GND

// Solo una IMU: la de la muñeca (dorso de la mano). Es el canal del TCA9548A donde está conectada (SD2).
// Si la MPU va directo a SDA/SCL, sin multiplexor, el código lo detecta al encender y este canal no se usa.
// (Para volver a los 5 dedales: {2, 7, 6, 5, 4, 3} = dorso, pulgar, índice, medio, anular, meñique.)
static const uint8_t CANAL_IMU[] = {2};

// ---------- Envío ----------
#define PERIODO_MS 20       // 50 lecturas por segundo
#define SERIAL_BAUDIOS 921600
#define FIRMWARE "1.3"

// Filtro complementario: peso del giroscopio (0–1). Más alto = más suave, más bajo = responde más rápido.
#define ALFA_GIRO 0.96f

// ---------- Calibración de giroscopios (comando CAL) ----------
#define CAL_MS 2000         // tiempo que la mano debe quedarse quieta y apoyada
#define CAL_MAX_STD 1.5f    // °/s: si un giroscopio varía más que esto, la mano se movió y se rechaza
#define CAL_MIN_MUESTRAS 40 // lecturas mínimas por IMU para aceptar la calibración
