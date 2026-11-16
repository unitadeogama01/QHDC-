// ============================================================
//  QHDC! — Configuración del ESP32 (PLANTILLA)
//
//  1. Copia este archivo como "config.h" en la misma carpeta.
//  2. Escribe tu WiFi, la IP de la computadora donde corre el
//     servidor y el identificador + clave que te dio la app
//     (Dispositivos → Vincular dispositivo).
//  config.h NO se sube a Git (tiene contraseñas).
// ============================================================
#pragma once

// ---------- WiFi (red de 2.4 GHz: el ESP32 no usa 5 GHz) ----------
#define WIFI_SSID      "NombreDeTuRed"
#define WIFI_CLAVE     "ContrasenaDeTuRed"

// ---------- Broker MQTT ----------
// Local: la IP de tu computadora en la red (en cmd: ipconfig → "Dirección IPv4").
// Hostinger: el dominio o IP del servidor/broker.
#define MQTT_HOST      "192.168.1.50"
#define MQTT_PUERTO    1883
#define MQTT_PREFIJO   "despensa"          // igual que MQTT_PREFIJO del .env

// ---------- Identidad del dispositivo (la da la app) ----------
#define ID_DISPOSITIVO    "esp32-despensa-001"
#define CLAVE_DISPOSITIVO "PEGA-AQUI-LA-CLAVE"  // la que da Dispositivos → Vincular dispositivo

// ---------- Sensores conectados ----------
// Pon 0 en lo que todavía no tengas conectado: el ESP32 funciona igual con
// lo demás (p. ej. sin DHT22 solo manda el peso y su estado).
#define USAR_BASCULA   1   // celda de carga + HX711
#define USAR_DHT22     1   // temperatura y humedad

// ---------- Pines (ver docs/hardware.md) ----------
#define PIN_HX711_DOUT 19   // DT / DOUT del HX711
#define PIN_HX711_SCK  18   // SCK / CLK del HX711
#define PIN_DHT22      27   // DATA del DHT22

// ---------- Báscula ----------
#define CAPACIDAD_G          5000.0  // capacidad de tu celda de carga (1000 a 5000 g)
#define UMBRAL_ESTABLE_G     3.0     // las últimas lecturas deben variar menos que esto
#define UMBRAL_PUBLICAR_G    2.0     // solo se publica si el peso cambió al menos esto
#define LATIDO_PESO_MS       30000   // aunque no cambie, se publica cada 30 s

// ---------- DHT22 ----------
#define INTERVALO_DHT_MS     10000   // el DHT22 no debe leerse más de una vez cada 2 s
