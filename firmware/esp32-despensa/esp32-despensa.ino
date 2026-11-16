// ============================================================
//  QHDC! — Firmware del ESP32 de la despensa
//
//  Hardware (ver docs/hardware.md):
//    * ESP32 DevKit (WiFi), alimentado por USB
//    * Celda de carga (1 a 5 kg) + módulo HX711   → peso
//    * Sensor DHT22                                → temperatura y humedad
//
//  Qué hace:
//    1. Se conecta al WiFi y sincroniza la hora por NTP.
//    2. Se conecta al broker MQTT con su identificador y su clave, y deja
//       una "última voluntad": si se desconecta sin avisar, el broker
//       publica {"estado":"fuera_de_linea"}.
//    3. Lee la báscula 5 veces por segundo y SOLO publica el peso cuando
//       es estable (las últimas 8 lecturas varían menos de UMBRAL_ESTABLE_G)
//       y cambió, o cada LATIDO_PESO_MS como latido.
//    4. Lee el DHT22 cada INTERVALO_DHT_MS y publica temperatura y humedad.
//    5. Atiende comandos del servidor: tara, calibrar y reportar. La
//       calibración se guarda en la memoria del ESP32 (sobrevive reinicios).
//    6. Si se cae el WiFi o el broker, reintenta solo (2 s, 4 s, 8 s... hasta 30 s).
//
//  Librerías (Arduino IDE → Herramientas → Administrar bibliotecas):
//    * "HX711" de Bogdan Necula
//    * "DHT sensor library" de Adafruit (+ "Adafruit Unified Sensor")
//    * "PubSubClient" de Nick O'Leary
//    * "ArduinoJson" de Benoit Blanchon (versión 7)
//  Placa: "ESP32 Dev Module" (paquete esp32 de Espressif).
//
//  Topics y mensajes: docs/mqtt.md (iguales a backend/src/modulos/iot/temas.js)
// ============================================================
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <HX711.h>
#include <DHT.h>
#include <sys/time.h>
#include <time.h>
#include "config.h"   // copia config.example.h como config.h

// Si tu config.h es de una versión anterior y no trae estas líneas
#ifndef USAR_BASCULA
#define USAR_BASCULA 1
#endif
#ifndef USAR_DHT22
#define USAR_DHT22 1
#endif

#define VERSION_FIRMWARE "1.0.0"
#define LECTURAS_VENTANA 8          // lecturas para decidir si el peso es estable
#define INTERVALO_PESO_MS 200       // el HX711 entrega ~10 lecturas por segundo
#define CONFIRMAR_CAMBIO_MS 3000    // tras un cambio se vuelve a publicar a los 3 s (el servidor exige 2 lecturas iguales)

WiFiClient red;
PubSubClient mqtt(red);
HX711 bascula;
DHT dht(PIN_DHT22, DHT22);
Preferences memoria;

// ---------- Estado ----------
bool calibrada = false;
char idArranque[5];                 // cambia en cada reinicio: hace únicos los msgId
unsigned long contador = 0;
float ventana[LECTURAS_VENTANA];
int nVentana = 0, iVentana = 0;
long ultimoCrudo = 0;
float ultimoPeso = NAN, ultimoPublicado = NAN;
bool ultimoEstable = false;
float ultimaTemp = NAN, ultimaHum = NAN;
unsigned long tPeso = 0, tEnvioPeso = 0, tDht = 0, tEstado = 0, tMqtt = 0, tWifi = 0, tSerie = 0;
unsigned long esperaMqtt = 2000;

String tema(const char* sufijo) { return String(MQTT_PREFIJO) + "/" + ID_DISPOSITIVO + "/" + sufijo; }
String nuevoMsgId() { return String(idArranque) + "-" + String(++contador); }
bool horaValida() { return time(nullptr) > 1700000000; }   // ya se sincronizó por NTP

long long ahoraMs() {
  struct timeval tv;
  gettimeofday(&tv, nullptr);
  return (long long)tv.tv_sec * 1000LL + tv.tv_usec / 1000;
}

void publicar(const String& t, JsonDocument& doc, bool retenido = false) {
  char buf[256];
  size_t n = serializeJson(doc, buf, sizeof(buf));
  if (!mqtt.publish(t.c_str(), (const uint8_t*)buf, n, retenido)) Serial.println("No se pudo publicar en " + t);
}

// Cada lectura lleva un id único (evita duplicados) y la hora real si ya hay NTP
void marcar(JsonDocument& doc) {
  doc["msgId"] = nuevoMsgId();
  if (horaValida()) doc["ts"] = ahoraMs();
}

void publicarEstado() {
  JsonDocument doc;
  doc["estado"] = "en_linea";
  doc["ip"] = WiFi.localIP().toString();
  doc["rssi"] = WiFi.RSSI();
  doc["firmware"] = VERSION_FIRMWARE;
  doc["calibrada"] = calibrada;
  doc["bascula"] = (bool)USAR_BASCULA;
  doc["dht22"] = (bool)USAR_DHT22;
  publicar(tema("estado"), doc, true);   // retenido: el servidor lo recibe aunque se conecte después
}

void reiniciarVentana() {
  nVentana = 0;
  iVentana = 0;
  ultimoPublicado = NAN;
}

// ---------- Comandos del servidor (botón "Calibrar" de la app) ----------
void alRecibir(char* t, byte* datos, unsigned int largo) {
  JsonDocument cmd;
  if (deserializeJson(cmd, datos, largo)) return;
  const char* orden = cmd["cmd"] | "";
  JsonDocument r;
  r["solicitudId"] = cmd["solicitudId"] | "";
  r["cmd"] = orden;
  Serial.printf("Comando recibido: %s\n", orden);

  if (!USAR_BASCULA && (strcmp(orden, "tara") == 0 || strcmp(orden, "calibrar") == 0)) {
    r["ok"] = false;
    r["mensaje"] = "Este ESP32 no tiene báscula activada (USAR_BASCULA 0 en config.h)";
  } else if (strcmp(orden, "tara") == 0) {
    // Plataforma con el frasco vacío y sin tocar: ese es el nuevo cero
    if (!bascula.wait_ready_timeout(1000)) {
      r["ok"] = false;
      r["mensaje"] = "El HX711 no responde: revisa DT, SCK, VCC y GND";
    } else {
      long offset = bascula.read_average(20);   // ~2 s
      bascula.set_offset(offset);
      memoria.putLong("offset", offset);
      reiniciarVentana();
      r["ok"] = true;
      r["offset"] = offset;
      r["mensaje"] = "Tara lista";
    }
  } else if (strcmp(orden, "calibrar") == 0) {
    // Sobre la plataforma hay un peso conocido: factor = unidades crudas por gramo
    float referencia = cmd["pesoReferencia"] | 0.0f;
    if (referencia <= 0) {
      r["ok"] = false;
      r["mensaje"] = "Falta el peso de referencia";
    } else if (!bascula.wait_ready_timeout(1000)) {
      r["ok"] = false;
      r["mensaje"] = "El HX711 no responde: revisa DT, SCK, VCC y GND";
    } else {
      long neto = bascula.read_average(20) - bascula.get_offset();
      float factor = neto / referencia;
      if (fabs(factor) < 1.0) {
        r["ok"] = false;
        r["mensaje"] = "No se detectó el peso. Revisa los cables de la celda (E+, E-, A+, A-) y haz la tara primero";
      } else {
        bascula.set_scale(factor);
        memoria.putFloat("factor", factor);
        memoria.putBool("calibrada", true);
        calibrada = true;
        reiniciarVentana();
        r["ok"] = true;
        r["factor"] = factor;
        r["pesoMedido"] = referencia;
        r["mensaje"] = "Calibrada";
      }
    }
  } else if (strcmp(orden, "reportar") == 0) {
    publicarEstado();
    r["ok"] = true;
  } else {
    r["ok"] = false;
    r["mensaje"] = "Comando desconocido";
  }
  publicar(tema("respuestas"), r);
}

// ---------- Conexiones (con reintento automático) ----------
void revisarWifi() {
  if (WiFi.status() == WL_CONNECTED || millis() - tWifi < 10000) return;
  tWifi = millis();
  Serial.println("WiFi desconectado, reintentando…");
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_CLAVE);
}

void revisarMqtt() {
  if (mqtt.connected() || WiFi.status() != WL_CONNECTED || millis() - tMqtt < esperaMqtt) return;
  tMqtt = millis();
  String temaEstado = tema("estado");
  Serial.printf("Conectando a MQTT %s:%d… ", MQTT_HOST, MQTT_PUERTO);
  if (mqtt.connect(ID_DISPOSITIVO, ID_DISPOSITIVO, CLAVE_DISPOSITIVO,
                   temaEstado.c_str(), 1, true, "{\"estado\":\"fuera_de_linea\"}")) {
    Serial.println("listo");
    esperaMqtt = 2000;
    mqtt.subscribe(tema("comandos").c_str(), 1);
    publicarEstado();
    ultimoPublicado = NAN;   // vuelve a mandar el peso actual
  } else {
    // 4 = usuario/clave incorrectos, 5 = no autorizado, -2 = no se encontró el broker
    Serial.printf("falló (código %d). Reintento en %lu s\n", mqtt.state(), esperaMqtt / 1000);
    esperaMqtt = min(esperaMqtt * 2, 30000UL);
  }
}

// ---------- Báscula ----------
void leerPeso() {
  if (!USAR_BASCULA) return;
  if (millis() - tPeso < INTERVALO_PESO_MS) return;
  tPeso = millis();
  if (!bascula.is_ready()) return;

  long crudo = bascula.read();
  ultimoCrudo = crudo;
  float gramos = (crudo - bascula.get_offset()) / bascula.get_scale();
  ventana[iVentana] = gramos;
  iVentana = (iVentana + 1) % LECTURAS_VENTANA;
  if (nVentana < LECTURAS_VENTANA) nVentana++;
  if (nVentana < LECTURAS_VENTANA) return;

  float minimo = ventana[0], maximo = ventana[0], suma = 0;
  for (int i = 0; i < LECTURAS_VENTANA; i++) {
    minimo = min(minimo, ventana[i]);
    maximo = max(maximo, ventana[i]);
    suma += ventana[i];
  }
  ultimoPeso = suma / LECTURAS_VENTANA;
  ultimoEstable = (maximo - minimo) <= UMBRAL_ESTABLE_G;

  // Sin calibrar, los "gramos" no significan nada: no se publican
  if (!calibrada || !mqtt.connected()) return;

  bool cambio = isnan(ultimoPublicado) || fabs(ultimoPeso - ultimoPublicado) >= UMBRAL_PUBLICAR_G;
  bool latido = millis() - tEnvioPeso >= LATIDO_PESO_MS;
  if ((ultimoEstable && cambio) || latido) {
    JsonDocument doc;
    marcar(doc);
    doc["valor"] = roundf(ultimoPeso * 10) / 10.0;
    doc["unidad"] = "g";
    doc["estable"] = ultimoEstable;
    doc["crudo"] = crudo;
    publicar(tema("bascula/peso"), doc);
    // Tras un cambio, el siguiente envío llega a los 3 s para confirmarlo
    tEnvioPeso = (ultimoEstable && cambio) ? millis() - LATIDO_PESO_MS + CONFIRMAR_CAMBIO_MS : millis();
    if (ultimoEstable) ultimoPublicado = ultimoPeso;
  }
}

// ---------- DHT22 ----------
void leerAmbiente() {
  if (!USAR_DHT22) return;
  if (millis() - tDht < INTERVALO_DHT_MS) return;
  tDht = millis();
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (isnan(t) || isnan(h)) {
    Serial.println("DHT22 sin lectura: revisa DATA, VCC, GND y la resistencia de 10 kΩ");
    return;
  }
  ultimaTemp = t;
  ultimaHum = h;
  if (!mqtt.connected()) return;
  JsonDocument dt;
  marcar(dt);
  dt["valor"] = roundf(t * 10) / 10.0;
  dt["unidad"] = "°C";
  publicar(tema("ambiente/temperatura"), dt);
  JsonDocument dh;
  marcar(dh);
  dh["valor"] = roundf(h * 10) / 10.0;
  dh["unidad"] = "%";
  publicar(tema("ambiente/humedad"), dh);
}

// ---------- Diagnóstico por el monitor serie (115200 baudios) ----------
void imprimirDiagnostico() {
  if (millis() - tSerie < 2000) return;
  tSerie = millis();
  Serial.printf("[%s] WiFi:%s MQTT:%s | peso: %.1f g (%s, crudo %ld)%s | %.1f °C %.0f %%\n",
                ID_DISPOSITIVO,
                WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString().c_str() : "no",
                mqtt.connected() ? "sí" : "no",
                isnan(ultimoPeso) ? 0.0 : ultimoPeso, ultimoEstable ? "estable" : "moviéndose", ultimoCrudo,
                calibrada ? "" : " SIN CALIBRAR",
                ultimaTemp, ultimaHum);
}

void setup() {
  Serial.begin(115200);
  delay(200);
  snprintf(idArranque, sizeof(idArranque), "%04x", (unsigned)(esp_random() & 0xFFFF));
  Serial.printf("\nQHDC! ESP32 despensa · firmware %s · %s\n", VERSION_FIRMWARE, ID_DISPOSITIVO);

  // Calibración guardada en la memoria del ESP32
  memoria.begin("qhdc", false);
  calibrada = memoria.getBool("calibrada", false);
  if (USAR_BASCULA) {
    bascula.begin(PIN_HX711_DOUT, PIN_HX711_SCK);
    bascula.set_offset(memoria.getLong("offset", 0));
    bascula.set_scale(calibrada ? memoria.getFloat("factor", 1.0f) : 1.0f);
    if (!calibrada) Serial.println("La báscula no está calibrada: usa el botón Calibrar de la app.");
  } else {
    Serial.println("Báscula desactivada (USAR_BASCULA 0)");
  }
  if (USAR_DHT22) dht.begin();
  else Serial.println("DHT22 desactivado (USAR_DHT22 0)");

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_CLAVE);
  configTime(0, 0, "pool.ntp.org", "time.google.com");   // hora en UTC; el servidor la convierte

  mqtt.setServer(MQTT_HOST, MQTT_PUERTO);
  mqtt.setCallback(alRecibir);
  mqtt.setBufferSize(512);
  mqtt.setKeepAlive(15);   // si deja de responder ~20 s, el broker publica la última voluntad
}

void loop() {
  revisarWifi();
  revisarMqtt();
  mqtt.loop();
  leerPeso();
  leerAmbiente();
  if (mqtt.connected() && millis() - tEstado > 60000) { tEstado = millis(); publicarEstado(); }   // actualiza la señal WiFi
  imprimirDiagnostico();
}
