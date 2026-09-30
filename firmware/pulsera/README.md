# Firmware de la pulsera (ESP32)

Lee 6 MPU-6050 (dorso + 5 dedales) por un multiplexor TCA9548A y envía las lecturas a la laptop por **WebSocket
(puerto 81)** y por **USB serie (921 600 baudios)** con el protocolo de `docs/arquitectura.md`, sección 3.

## Antes de cargarlo

1. Copia `secrets.example.h` como **`secrets.h`** y pon el nombre y la contraseña de la red WiFi
   (`secrets.h` no se sube a git).
2. En `config.h`:
   - `LADO`: `'R'` para la pulsera derecha y `'L'` para la izquierda (se carga una vez con cada valor).
   - `MODO_WIFI`: `WIFI_ESTACION` (se conecta a la zona con cobertura de la laptop) o `WIFI_PUNTO_ACCESO`.
   - Pines `PIN_SDA` / `PIN_SCL` y canales del TCA9548A en `CANAL_IMU` (orden: dorso, pulgar, índice, medio,
     anular, meñique). Ya están los del guante derecho: SDA 8, SCL 9, I²C a 100 kHz; dorso SD2, meñique SD3,
     anular SD4, medio SD5, índice SD6, pulgar SD7.

## Compilar y cargar

- Placa: **ESP32C3 Dev Module** (`esp32:esp32:esp32c3`, el ESP32-C3 Super Mini), núcleo ESP32 de Arduino 3.x.
  - En Herramientas: **USB CDC On Boot: Enabled**; si no, el monitor serie y la app no reciben nada por USB.
- Librería: **WebSockets** de Markus Sattler (links2004), desde el gestor de librerías. No hace falta
  MPU6050_light: este código lee las MPU directamente.
- Arduino IDE o `arduino-cli compile --fqbn esp32:esp32:esp32c3 firmware/pulsera`.

## Montaje de las MPU-6050

Eje **X** hacia la punta del dedo y eje **Z** saliendo de la uña (en el dorso, saliendo de la mano). Con la mano
quieta ~0.2 s al encender, cada IMU mide el sesgo de su giroscopio.

## Monitor serie (115200 o cualquier velocidad: el ESP32-C3 usa USB nativo)

Las líneas que empiezan con `#` son mensajes de estado (IMU que responden, cambios de WiFi con su IP). Comandos
(escríbelos y Enter):

| Comando | Qué hace |
|---|---|
| `ID?` | Responde la identificación de la pulsera (`ID,R,fw=1.1,…`). |
| `CAL` | Calibra los giroscopios: mano apoyada y quieta 2 s. Responde `CAL,R,ok,…` o qué sensor se movió. Se guarda en el ESP32. |
| `PRUEBA` | Activa/desactiva el modo de prueba: cada 0.5 s un resumen legible (Hz, WiFi e IP, app conectada, cada IMU ok o NO RESPONDE, ángulos y flexión de cada dedo respecto al dorso). Mientras está activo no salen las líneas `D,…` por USB. |

Fuera del modo de prueba, cada 20 ms sale una línea `D,…` (la que lee la app).

## WiFi (zona con cobertura de la laptop)

1. Windows → Configuración → Red e Internet → **Zona con cobertura inalámbrica móvil**: nombre `LSM-Dedales`,
   banda **2.4 GHz** (el ESP32-C3 no ve 5 GHz), contraseña a tu elección; desactiva el ahorro de energía.
2. Copia `secrets.example.h` como `secrets.h` (en esta misma carpeta) y escribe ahí el nombre y la contraseña.
3. Compila y carga. En el monitor serie debe salir `# WiFi: conectado a LSM-Dedales IP …`.
