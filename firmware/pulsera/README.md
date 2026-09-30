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
     anular, meñique). **Pendiente: actualizar con los pines del armado real.**

## Compilar y cargar

- Placa: **ESP32 Dev Module** (`esp32:esp32:esp32`), núcleo ESP32 de Arduino 3.x.
- Librería: **WebSockets** de Markus Sattler (links2004), desde el gestor de librerías.
- Arduino IDE o `arduino-cli compile --fqbn esp32:esp32:esp32 firmware/pulsera`.

## Montaje de las MPU-6050

Eje **X** hacia la punta del dedo y eje **Z** saliendo de la uña (en el dorso, saliendo de la mano). Con la mano
quieta ~0.2 s al encender, cada IMU mide el sesgo de su giroscopio.

## Monitor serie

Las líneas que empiezan con `#` son mensajes de estado (IMU que responden, red, IP). Enviar `ID?` responde la
identificación de la pulsera; cada 20 ms sale una línea `D,…`.
