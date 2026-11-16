// ============================================================
//  QHDC! — Prueba de sensores (sin WiFi ni MQTT)
//
//  Sirve para comprobar el cableado ANTES de usar el firmware completo.
//  Abre el Monitor serie a 115200 baudios y escribe una letra + Enter:
//
//    t  → tara: deja la plataforma vacía y pon el cero
//    c  → calibrar: coloca un peso conocido y escribe "c500" (para 500 g)
//    r  → muestra las lecturas crudas del HX711 (diagnóstico)
//
//  Cada 2 s imprime: peso (g), lectura cruda, temperatura y humedad.
//  Pasos de prueba completos en docs/hardware.md.
// ============================================================
#include <HX711.h>
#include <DHT.h>

#define PIN_HX711_DOUT 19
#define PIN_HX711_SCK  18
#define PIN_DHT22      27

HX711 bascula;
DHT dht(PIN_DHT22, DHT22);
bool crudoContinuo = false;

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\n=== QHDC! prueba de sensores ===");
  bascula.begin(PIN_HX711_DOUT, PIN_HX711_SCK);
  dht.begin();

  Serial.print("HX711: ");
  if (bascula.wait_ready_timeout(2000)) {
    Serial.println("responde ✔");
  } else {
    Serial.println("NO responde ✖ → revisa VCC (3V3), GND, DT→GPIO19 y SCK→GPIO18");
  }
  Serial.println("Escribe t (tara), c500 (calibrar con 500 g) o r (lecturas crudas).");
}

void loop() {
  if (Serial.available()) {
    String linea = Serial.readStringUntil('\n');
    linea.trim();
    if (linea == "t") {
      Serial.println("Tara: no toques la báscula…");
      bascula.tare(20);
      Serial.printf("Cero listo. Offset = %ld\n", bascula.get_offset());
    } else if (linea.startsWith("c")) {
      float ref = linea.substring(1).toFloat();
      if (ref <= 0) { Serial.println("Escribe el peso: c500"); return; }
      long neto = bascula.read_average(20) - bascula.get_offset();
      float factor = neto / ref;
      bascula.set_scale(factor);
      Serial.printf("Factor = %.4f (unidades crudas por gramo)\n", factor);
      if (fabs(factor) < 1) Serial.println("⚠ Factor casi 0: la celda no detecta el peso. Revisa E+/E-/A+/A-.");
    } else if (linea == "r") {
      crudoContinuo = !crudoContinuo;
    }
  }

  static unsigned long t = 0;
  if (millis() - t < (crudoContinuo ? 250 : 2000)) return;
  t = millis();

  if (crudoContinuo) {
    if (bascula.is_ready()) Serial.printf("crudo: %ld\n", bascula.read());
    return;
  }
  if (bascula.wait_ready_timeout(500)) {
    long crudo = bascula.read_average(5);
    float gramos = (crudo - bascula.get_offset()) / bascula.get_scale();
    Serial.printf("Peso: %8.1f g   (crudo %ld)", gramos, crudo);
  } else {
    Serial.print("Peso: HX711 sin respuesta");
  }
  float temp = dht.readTemperature();
  float hum = dht.readHumidity();
  if (isnan(temp) || isnan(hum)) Serial.println("   | DHT22: sin lectura ✖ (revisa DATA→GPIO27 y la resistencia de 10 kΩ)");
  else Serial.printf("   | %.1f °C  %.1f %%\n", temp, hum);
}
