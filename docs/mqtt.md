# Comunicación MQTT entre los ESP32 y el servidor

Los nombres de los topics son **iguales** en el firmware (`firmware/esp32-despensa/esp32-despensa.ino`), en el servidor (`backend/src/modulos/iot/temas.js`) y en el simulador (`backend/src/modulos/iot/simulador.js`). Si cambias uno, cambia los tres.

Las fotos de los alimentos **no** viajan por MQTT: se suben por HTTP desde la app.

## Topics

`<id>` es el identificador del dispositivo (por ejemplo `esp32-despensa-001`). El prefijo `despensa` se configura con `MQTT_PREFIJO`.

| Topic | Quién publica | QoS | Retenido | Contenido (JSON) |
|---|---|---|---|---|
| `despensa/<id>/bascula/peso` | ESP32 | 0* | no | `{"msgId":"a3f1-17","ts":1794181673610,"valor":812.5,"unidad":"g","estable":true,"crudo":8634512}` |
| `despensa/<id>/ambiente/temperatura` | ESP32 | 0* | no | `{"msgId":"a3f1-18","ts":…,"valor":22.8,"unidad":"°C"}` |
| `despensa/<id>/ambiente/humedad` | ESP32 | 0* | no | `{"msgId":"a3f1-19","ts":…,"valor":51.0,"unidad":"%"}` |
| `despensa/<id>/estado` | ESP32 (y el broker como última voluntad) | 1 | **sí** | `{"estado":"en_linea","ip":"192.168.1.80","rssi":-58,"firmware":"1.0.0","calibrada":true}` / `{"estado":"fuera_de_linea"}` |
| `despensa/<id>/respuestas` | ESP32 | 0* | no | `{"solicitudId":"…","cmd":"tara","ok":true,"offset":8421337,"mensaje":"Tara lista"}` |
| `despensa/<id>/comandos` | Servidor | 1 | no | `{"solicitudId":"…","cmd":"tara"}` · `{"solicitudId":"…","cmd":"calibrar","pesoReferencia":500}` · `{"solicitudId":"…","cmd":"reportar"}` |

\* La librería PubSubClient del ESP32 publica con QoS 0. El servidor y el simulador usan QoS 1.

### Campos
- **msgId:** único por mensaje, con la forma `<id de arranque>-<contador>`. El servidor ignora un `msgId` repetido del mismo dispositivo, gracias a la llave única `lecturas_sensor(dispositivo_id, msg_id)`.
- **ts:** hora del ESP32 en milisegundos desde 1970 (UTC, sincronizada por NTP). Si no viene o difiere más de 10 min de la hora del servidor, se usa la del servidor. La del ESP32 queda guardada en `leido_dispositivo_en`.
- **estable:** `false` si la báscula se estaba moviendo. Esa lectura se guarda como inválida y no cambia el inventario.
- **crudo:** lectura sin calibrar del HX711, para diagnóstico.

## Reglas del servidor (`backend/src/modulos/iot/procesar.js`)
1. Si el `msgId` está repetido, el mensaje se ignora.
2. Se guardan como **inválidas**, con su motivo y sin tocar el inventario:
   - un peso mayor que la capacidad de la celda (`dispositivos_iot.capacidad_g`) o menor a −20 g;
   - una lectura marcada como inestable;
   - una báscula sin alimento asignado;
   - una temperatura fuera de −40 a 80 °C o una humedad fuera de 0 a 100 %.
3. Un peso válido se aplica al inventario solo cuando llegan `lecturas_estables` lecturas seguidas parecidas (por defecto 2, que difieren menos de `umbral_cambio_g`). Lo aplica `sp_aplicar_lectura_peso`: resta la tara, convierte a la unidad del alimento e ignora cambios menores al ruido.
4. Gramos → unidad del alimento: solo para **g**, **kg** o **piezas con peso por pieza** (`alimentos.peso_unitario_g`). Los alimentos en L, ml o manojos no se pueden asignar a la báscula.
5. La temperatura y la humedad solo se registran y se comparan con los límites del lugar (`umbrales_ambiente` / `vista_umbrales_ambiente`). Generan un aviso neutral; nunca afirman que un alimento esté en mal estado.

## Seguridad
- **Usuario MQTT** = identificador del ESP32; **contraseña** = su clave. En la base solo se guarda el hash SHA-256 de la clave.
- Un ESP32 solo puede publicar en `despensa/<su id>/…` y solo puede suscribirse a `despensa/<su id>/comandos`. Si publica en el topic de otro, el broker corta su conexión.
- El servidor entra con `MQTT_USUARIO` / `MQTT_CLAVE`.
- En producción usa **TLS** (`mqtts://`, puerto 8883).

## Broker: local o Hostinger (solo cambia `backend/.env`)

### Broker interno (por defecto, recomendado en tu computadora)
```
MQTT_HABILITADO=true
MQTT_BROKER_INTERNO=true
MQTT_PUERTO_INTERNO=1883
```
El servidor trae su propio broker (Aedes), así que no hay que instalar nada. Los ESP32 se conectan a la IP de la computadora, al puerto 1883. También sirve en un VPS de Hostinger, abriendo ese puerto en su firewall.

### Broker externo (Mosquitto en un VPS, HiveMQ Cloud, EMQX Cloud)
```
MQTT_HABILITADO=true
MQTT_BROKER_INTERNO=false
MQTT_URL=mqtts://tu-broker:8883
MQTT_USUARIO=qhdc-servidor
MQTT_CLAVE=una-clave-larga
```
Con un broker externo, la **autenticación y los permisos los hace el broker**. Hay que darle de alta un usuario por cada ESP32 (identificador + clave) y uno para el servidor. Ejemplo para Mosquitto:

`/etc/mosquitto/conf.d/qhdc.conf`
```
listener 8883
certfile /etc/letsencrypt/live/tu-dominio/fullchain.pem
keyfile  /etc/letsencrypt/live/tu-dominio/privkey.pem
allow_anonymous false
password_file /etc/mosquitto/passwd
acl_file /etc/mosquitto/acl
```
`/etc/mosquitto/acl`
```
# El servidor lee y escribe todo lo de la despensa
user qhdc-servidor
topic readwrite despensa/#

# Cada ESP32 (%u = su usuario = su identificador) solo lo suyo
pattern write despensa/%u/#
pattern read  despensa/%u/comandos
```
Usuarios: `mosquitto_passwd /etc/mosquitto/passwd esp32-despensa-001` (y lo mismo para `qhdc-servidor`).

### Sin MQTT
Con `MQTT_HABILITADO=false`, el simulador y los ESP32 pueden mandar lecturas por `POST /api/iot/lecturas` (mismo formato y mismas reglas). La calibración desde la app sí necesita MQTT.

## Probar a mano
Con el servidor corriendo y Mosquitto instalado solo como herramienta (`mosquitto_sub` / `mosquitto_pub`):
```
mosquitto_sub -h localhost -u esp32-despensa-001 -P "<clave del dispositivo>" -t "despensa/esp32-despensa-001/comandos" -v
mosquitto_pub -h localhost -u esp32-despensa-001 -P "<clave del dispositivo>" -t "despensa/esp32-despensa-001/ambiente/temperatura" -m "{\"msgId\":\"manual-1\",\"valor\":23.4}"
```
