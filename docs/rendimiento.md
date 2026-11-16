# Pruebas de rendimiento — QHDC!

Punto 2 del plan de evaluación (después de las pruebas automatizadas).

## Cómo se corre

Desde `backend/` (necesita MySQL, igual que `npm test`):

```bash
npm run rendimiento                          # 20 familias · 15 s por escenario · 1 semana de lecturas
npm run rendimiento -- --usuarios 5 --segundos 4 --lecturas 2000   # versión rápida (~30 s)
```

Opciones: `--usuarios`, `--segundos`, `--lecturas`, `--conexiones` (conexiones a MySQL).

El script `backend/pruebas/rendimiento/carga.js`:

1. Crea una base temporal `qhdc_prueba_*` con el script SQL real.
2. Arranca el servidor en **otro proceso** (como en producción), sin MQTT, simulador ni IA, con
   los límites por IP subidos (todo sale de la misma PC; ver `LIMITE_*` en `.env.example`).
3. Llena datos realistas: N hogares con 15 alimentos, 3 recetas, lista del súper y un ESP32;
   el hogar 1 con **una semana de lecturas** (403 200, lo que guarda un DHT22 cada 3 s).
4. Simula a N familias usando la app **sin pausas** (peor caso) y mide cada escenario.
5. Borra la base. Cada corrida queda en `pruebas/rendimiento/resultados/` (no se sube a Git).

## Resultados (2026-11-09)

PC del equipo: Windows 10, Node v26.13.0, MySQL 8.0.46, `DB_CONEXIONES=10`.
20 usuarios a la vez, 15 s por escenario.

| Escenario | Peticiones/s | p50 | p95 | Errores |
|---|---:|---:|---:|---:|
| Abrir una pantalla (`GET /api/estado`, 20 hogares) | 36 | 561 ms | 680 ms | 0 |
| Hogar con 1 semana de lecturas (`GET /api/estado`) | 24 | 866 ms | 1 014 ms | 0 |
| Dispositivos en vivo (`GET /api/sensores/vivo`) | 129 | 153 ms | 190 ms | 0 |
| Cambiar una cantidad (`PUT /api/alimentos/:id/existencia`) | 366 | 53 ms | 72 ms | 0 |
| Página estática (`GET /dashboard.html`) | 1 323 | 13 ms | 26 ms | 0 |
| Uso mixto (35 % estado · 50 % en vivo · 15 % cambios) | 26 | 681 ms | 1 399 ms | 0 |

Con 5 usuarios (más parecido al uso real de una familia) `GET /api/estado` responde en ~75 ms (p50)
y ~200 ms (p95). Los tiempos con 20 usuarios suben porque las 20 peticiones se reparten
10 conexiones a MySQL; no hay errores.

**Para comparar:** una familia abre una pantalla cada varios segundos y la pantalla Dispositivos
consulta cada 3 s; 20 usuarios sin pausas equivalen a cientos de familias reales.

## Problemas encontrados y corregidos

| Problema (medido) | Causa | Arreglo |
|---|---|---|
| Con una semana de lecturas, cada pantalla tardaba **~3.6 s** y Dispositivos **~1.4 s cada 3 s** | `vista_dispositivos` sacaba la última temperatura/humedad/gas con subconsultas que recorrían y ordenaban el historial de `lecturas_sensor` | Migración `002_rendimiento_lecturas.sql`: el trigger que ya corría con cada lectura guarda los últimos valores en `dispositivos_iot`; la vista solo los lee. `estado.js` y `iot/rutas-http.js` dejaron de agrupar el historial |
| Varias familias abriendo la app a la vez → **errores 500** (≈ 1 de cada 4 peticiones con 3–5 familias) | *Deadlock* en `GET /api/estado`: los `INSERT … SELECT` de `sp_generar_lista` y el `DELETE … JOIN` de la lista bloqueaban huecos de índices compartidos entre hogares | La sincronización corre en `READ COMMITTED` (`transaccion(fn, { aislamiento })` en `nucleo/db.js`); el borrado de la lista se hizo en dos pasos (leer ids sin bloqueo → borrar por id); los reintentos por deadlock subieron a 5 con espera al azar. Prueba de regresión en `pruebas/api/alacena-y-compras.test.js` (falla con el código anterior) |
| Los límites por IP y el tamaño del pool estaban fijos en el código | — | Configurables en `.env`: `DB_CONEXIONES` y `LIMITE_*` (con aviso si se suben en producción) |

## Límites recomendados

- `DB_CONEXIONES=10` alcanza para el uso esperado. En Hostinger compartido no pasar del máximo
  de conexiones del plan.
- Los `LIMITE_*` predeterminados son los recomendados; subirlos solo para pruebas de carga.
- Las lecturas de más de 7 días se resumen y se borran cada hora, así el historial no crece
  sin límite (la prueba usa justo ese peor caso: 7 días completos).
