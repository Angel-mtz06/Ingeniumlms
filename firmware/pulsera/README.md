# Firmware de la pulsera (ESP32)

Lee **una** MPU-6050, la de la muñeca (dorso de la mano), y envía las lecturas a la laptop por **WebSocket
(puerto 81)** y por **USB serie (921 600 baudios)** con el protocolo de `docs/arquitectura.md`, sección 3.

La MPU puede ir por el multiplexor TCA9548A (canal SD2) o directo a SDA/SCL: al encender se detecta sola y el
monitor serie dice cuál encontró. La línea `D,…` conserva los 6 lugares del protocolo para que la app no cambie:
el primero es la muñeca y los 5 dedos van en `0.0` con su bit de `status` apagado (los dedos los ve la cámara).

## Antes de cargarlo

1. Copia `secrets.example.h` como **`secrets.h`** y pon el nombre y la contraseña de la red WiFi
   (`secrets.h` no se sube a git).
2. En `config.h`:
   - `LADO`: `'R'` para la pulsera derecha y `'L'` para la izquierda (se carga una vez con cada valor).
   - `MODO_WIFI`: `WIFI_ESTACION` (se conecta a la zona con cobertura de la laptop) o `WIFI_PUNTO_ACCESO`.
   - Pines `PIN_SDA` / `PIN_SCL` y el canal del TCA9548A en `CANAL_IMU`. Ya están los de la pulsera derecha:
     SDA 8, SCL 9, I²C a 100 kHz, muñeca en SD2. Para volver a los 5 dedales:
     `CANAL_IMU[] = {2, 7, 6, 5, 4, 3}` (dorso, pulgar, índice, medio, anular, meñique).

## Compilar y cargar

- Placa: **ESP32C3 Dev Module** (`esp32:esp32:esp32c3`, el ESP32-C3 Super Mini), núcleo ESP32 de Arduino 3.x.
  - En Herramientas: **USB CDC On Boot: Enabled**; si no, el monitor serie y la app no reciben nada por USB.
- Librería: **WebSockets** de Markus Sattler (links2004), desde el gestor de librerías. No hace falta
  MPU6050_light: este código lee las MPU directamente.
- Arduino IDE o `arduino-cli compile --fqbn esp32:esp32:esp32c3 firmware/pulsera`.

## Montaje de la MPU-6050

En el dorso de la mano, junto a la muñeca: eje **X** hacia los dedos y eje **Z** saliendo del dorso. Con la mano
quieta ~0.2 s al encender, mide el sesgo de su giroscopio.

## Monitor serie (921600 baudios; con el ESP32-C3 cualquier velocidad funciona: usa USB nativo)

Las líneas que empiezan con `#` son mensajes de estado (IMU que responden, cambios de WiFi con su IP). Comandos
(escríbelos y Enter):

| Comando | Qué hace |
|---|---|
| `ID?` | Responde la identificación de la pulsera (`ID,R,fw=1.4,imus=1,…`). |
| `CAL` | Con la pulsera **plana sobre una mesa** y quieta 2 s: calibra el giroscopio y esa postura queda como el cero de la inclinación y el giro lateral. Responde `CAL,R,ok,…` o `CAL,R,error,movimiento,0`. Se guarda en el ESP32. |
| `PRUEBA` | Activa/desactiva el modo de prueba: cada 0.5 s un resumen legible (Hz, WiFi e IP, app conectada, muñeca ok o NO RESPONDE, inclinación, giro lateral y velocidad de giro). Mientras está activo no salen las líneas `D,…` por USB. |

Fuera del modo de prueba, cada 20 ms sale una línea `D,…` (la que lee la app).

## WiFi (zona con cobertura de la laptop)

1. Windows → Configuración → Red e Internet → **Zona con cobertura inalámbrica móvil**: nombre `LSM-Dedales`,
   banda **2.4 GHz** (el ESP32-C3 no ve 5 GHz), contraseña a tu elección; desactiva el ahorro de energía.
2. Copia `secrets.example.h` como `secrets.h` (en esta misma carpeta) y escribe ahí el nombre y la contraseña.
3. Compila y carga. En el monitor serie debe salir `# WiFi: conectado a LSM-Dedales IP 192.168.137.190`.

La IP es fija (`IP_FIJA 1` en config.h): **192.168.137.190** la derecha y **192.168.137.191** la izquierda, la que
la app ya trae escrita. Sirve con la zona con cobertura de Windows en cualquier laptop (siempre usa
192.168.137.x). Con otra red (p. ej. el celular), pon `IP_FIJA 0` y usa `pulsera-der.local` o la IP del monitor.

Con `ESPERAR_WIFI 1` (config.h) los sensores arrancan hasta que la pulsera se conecta: el monitor dice cada 2 s
«Esperando WiFi…» y luego «Iniciando sensores… Lecturas en marcha». Para probar solo por USB, sin la zona
con cobertura, pon `ESPERAR_WIFI 0`.
