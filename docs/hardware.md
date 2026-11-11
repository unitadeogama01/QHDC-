# Hardware de la despensa — conexiones y pruebas

Hardware del proyecto (no se usa nada más):

| Componente | Función |
|---|---|
| ESP32 DevKit (WiFi) | Controlador: lee los sensores y los envía por MQTT |
| Celda de carga 1–5 kg | Mide el peso sobre la plataforma |
| Módulo HX711 | Amplifica y convierte la señal de la celda para el ESP32 |
| Sensor DHT22 | Temperatura y humedad relativa del ambiente |
| Protoboard(s) y cables | Conexiones |
| Cable USB | Programar y alimentar el ESP32 |

> **Lo que los sensores NO pueden saber:** el peso no dice cuántas piezas hay (para eso se configura el peso de una pieza) y el DHT22 no dice si un alimento está en buen o mal estado. La app solo informa las mediciones.

## 1. Voltajes y consumo

| Componente | Alimentación | Consumo aproximado | Conectar a |
|---|---|---|---|
| ESP32 DevKit | 5 V por USB (regulador interno a 3.3 V) | 80–240 mA (picos al transmitir por WiFi) | Cable USB |
| HX711 | 2.6–5.5 V | ~1.5 mA | **3V3** del ESP32 |
| DHT22 | 3.3–6 V | 1–2.5 mA al medir | **3V3** del ESP32 |

**Por qué 3.3 V y no 5 V:** los pines del ESP32 trabajan a 3.3 V y no toleran 5 V. Si el HX711 o el DHT22 se alimentan con 5 V, su señal de datos también sale a 5 V y puede dañar el ESP32. A 3.3 V ambos funcionan bien.

- Algunos módulos HX711 (como los rojos de SparkFun) tienen dos pines, **VCC** y **VDD**: conecta los dos a 3V3.
- Para pruebas basta el USB de la computadora. Para la instalación final usa un cargador USB de buena calidad (5 V, 1 A o más) y un cable corto. Un cargador malo produce lecturas de peso con ruido.

## 2. Pines del ESP32

| Señal | Pin ESP32 | Por qué este pin |
|---|---|---|
| HX711 **DT** (DOUT) | **GPIO 19** | Entrada/salida digital normal, sin función de arranque |
| HX711 **SCK** | **GPIO 18** | Salida digital normal, sin función de arranque |
| DHT22 **DATA** | **GPIO 27** | Entrada/salida digital normal, sin función de arranque |

Pines que **no** se usan, a propósito:
- **GPIO 0, 2, 5, 12 y 15:** definen cómo arranca el ESP32. Si un sensor los jala a un nivel, la placa puede no arrancar o no dejarse programar.
- **GPIO 6 a 11:** están conectados a la memoria flash interna.
- **GPIO 34 a 39:** solo son entradas y no tienen resistencia interna.
- **GPIO 1 y 3:** son el puerto serie del USB, que sirve para programar y para el monitor.
- **GPIO 16 y 17:** en las placas con módulo WROVER están ocupados por la memoria PSRAM.

Si cambias un pin, cámbialo también en `firmware/esp32-despensa/config.h` y en `firmware/prueba-sensores/prueba-sensores.ino`.

## 3. Conexiones

```
            ESP32 DevKit                          HX711                     Celda de carga
         ┌──────────────┐                  ┌──────────────┐             (4 cables, típico)
         │          3V3 ├──────┬──────────►│ VCC (y VDD)  │
         │          GND ├────┬─┼──────────►│ GND       E+ ├◄──── rojo
         │      GPIO 19 ├◄───┼─┼───────────┤ DT        E- ├◄──── negro
         │      GPIO 18 ├────┼─┼──────────►│ SCK       A- ├◄──── blanco
         │              │    │ │           │           A+ ├◄──── verde
         │              │    │ │           └──────────────┘   (B-, B+ sin conectar)
         │              │    │ │                 DHT22
         │              │    │ │           ┌──────────────┐
         │              │    │ └──────────►│ VCC  (+)     │
         │      GPIO 27 ├◄───┼──────┬──────┤ DATA (out)   │
         │              │    └──────┼─────►│ GND  (−)     │
         └───────┬──────┘           │      └──────────────┘
                 │ USB         10 kΩ entre DATA y 3V3
                 ▼             (solo si es el sensor suelto de 4 patas;
            computadora / cargador   los módulos con placa ya la traen)
```

### Celda de carga → HX711
| Cable de la celda | HX711 |
|---|---|
| Rojo | E+ |
| Negro | E− |
| Blanco | A− |
| Verde | A+ |

- Los colores son los más comunes, pero **revisa la hoja de datos de tu celda**: algunos fabricantes los cambian.
- Si al poner peso la lectura cruda **baja** en lugar de subir, intercambia A+ y A−. Aunque no lo hagas, la calibración funciona igual: el factor queda negativo y el peso sale bien.
- **Montaje mecánico:** atornilla un extremo de la barra a una base y el otro a la plataforma, respetando la flecha impresa en la celda. El peso debe "doblar" la barra. Si la plataforma toca la base u otra cosa, las lecturas no sirven.

### DHT22
Sensor suelto de 4 patas, con la rejilla hacia ti y las patas hacia abajo: **1 = VCC, 2 = DATA, 3 = sin conectar, 4 = GND**. Lleva una resistencia de 4.7–10 kΩ entre DATA y VCC.
Si es un módulo de 3 pines en placa, sigue las marcas (+, out, −); ya trae la resistencia.

- Colócalo lejos del ESP32, porque el chip se calienta y alteraría la temperatura, y lejos de fuentes de calor.
- Solo se puede leer cada 2 s o más. El firmware lo lee cada 10 s.

## 4. Programar el ESP32
1. Instala el **Arduino IDE 2** y el paquete de placas **esp32** de Espressif (Herramientas → Placa → Gestor de placas).
2. Instala las librerías (Herramientas → Administrar bibliotecas):
   - **HX711** de Bogdan Necula
   - **DHT sensor library** de Adafruit (te pedirá también **Adafruit Unified Sensor**: acéptala)
   - **PubSubClient** de Nick O'Leary
   - **ArduinoJson** de Benoit Blanchon (versión 7)
3. Placa: **ESP32 Dev Module**. Puerto: el COM que aparece al conectar el USB. Si no aparece ninguno, instala el controlador CP210x o CH340, según el chip USB de tu placa.
4. Si al subir el programa se queda en "Connecting…", mantén presionado el botón **BOOT** hasta que empiece a escribir.

## 5. Procedimiento de prueba

### Paso 1 — Sensores sin red (`firmware/prueba-sensores`)
1. Sube `prueba-sensores.ino` y abre el Monitor serie a **115200** baudios.
2. Debe decir **"HX711: responde ✔"**. Si no, revisa VCC, GND, DT y SCK.
3. Escribe `r` y presiona Enter: aparecen las lecturas crudas. Presiona la plataforma con el dedo: el número debe cambiar mucho. Si no cambia, revisa los cables de la celda. Vuelve a escribir `r` para salir.
4. Con la plataforma vacía, escribe `t` (tara). El peso debe quedar cerca de 0 g.
5. Coloca un peso conocido, por ejemplo un paquete de 500 g o una pesa, y escribe `c500`. Debe marcar ~500 g.
6. Pon **otro** peso conocido distinto. El error debe ser menor a ~2 %. Si es mayor, revisa el montaje mecánico.
7. La línea del DHT22 debe mostrar temperatura y humedad razonables, por ejemplo 18–30 °C y 30–70 %. Compara con un termómetro de casa: el DHT22 tiene ±0.5 °C de precisión.

### Paso 2 — Firmware completo con la app
1. **Vincula el dispositivo** en la app: Dispositivos → *Vincular dispositivo* → *Crear clave*. Anota el identificador y la clave. La clave solo se muestra esa vez. En una base nueva no hay ningún dispositivo: este es el primer paso.
2. Copia `firmware/esp32-despensa/config.example.h` como **`config.h`** y escribe:
   - Tu WiFi. Debe ser de **2.4 GHz**: el ESP32 no se conecta a redes de 5 GHz.
   - `MQTT_HOST`: la IP de tu computadora. En cmd: `ipconfig` → "Dirección IPv4", por ejemplo 192.168.1.50.
   - `ID_DISPOSITIVO` y `CLAVE_DISPOSITIVO`. Para el ESP32 que ya está vinculado (`esp32-despensa-001`), su clave está en `backend/.env` como `SIMULADOR_CLAVE` (la antigua clave de ejemplo ya no funciona). `config.h` está en `.gitignore`: no la subas a ningún lado.
   - Si todavía no tienes un sensor, desactívalo: `#define USAR_DHT22 0` o `#define USAR_BASCULA 0`. El ESP32 se conecta y reporta su estado con lo que tenga.
3. En `backend/.env` pon **`SIMULADOR=false`**. Si no lo haces, el simulador y el ESP32 real mandarán datos del mismo dispositivo. Luego reinicia el servidor (`npm start`).
4. **Firewall de Windows:** la primera vez que arranca el servidor, Windows pregunta si Node.js puede usar la red. Marca **Redes privadas** y acepta. Sin esto, el ESP32 no puede llegar al puerto 1883.
5. Sube `esp32-despensa.ino`. En el Monitor serie debe aparecer `WiFi:192.168.x.x MQTT:sí`.
6. En la app (Dispositivos), la báscula debe aparecer **En línea**, con temperatura y humedad.
7. Toca **Calibrar**:
   1. Elige el alimento que estará sobre la báscula y toca *Guardar*.
   2. Con el frasco vacío sobre la plataforma, toca **Poner en cero**.
   3. Pon un peso conocido dentro del frasco, escribe cuántos gramos pesa y toca **Calibrar**.
   4. Quita el peso de referencia y pon el alimento.
8. **Prueba de consumo:** saca unos 100 g del frasco. En 3 a 6 s aparece el cambio en la tarjeta y en *Actividad*. El inventario baja solo, y la gráfica de consumo lo registra.
9. **Prueba de desconexión:** desconecta el USB del ESP32. En unos 20–30 s la tarjeta pasa a **Desconectado** y aparece un aviso. Al reconectarlo vuelve a **En línea** solo.

### Problemas comunes
| Síntoma | Causa probable |
|---|---|
| Monitor serie: `MQTT falló (código -2)` | IP de `MQTT_HOST` incorrecta, el servidor no está corriendo o el firewall bloquea el puerto 1883 |
| `MQTT falló (código 4)` o `(código 5)` | Identificador o clave incorrectos, o el dispositivo no existe en la app |
| El peso "baila" y la app no lo actualiza | La plataforma toca algo, hay corrientes de aire o el cargador USB tiene ruido. Mientras la báscula se mueve, el ESP32 no publica |
| La app marca lecturas como inválidas | Peso mayor que la capacidad de la celda, tara mal hecha (peso negativo) o sensor fuera de rango. El motivo queda en `lecturas_sensor.motivo_invalidez` |
| `DHT22 sin lectura` | DATA en otro pin, falta la resistencia de 10 kΩ o el sensor está alimentado a 5 V con un cable muy largo |
