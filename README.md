# QHDC!? · ¿Qué hay de comer?

**Despensa inteligente con IoT e Inteligencia Artificial** · Equipo **Ark's System**
Universidad Tecnológica de Nezahualcóyotl · Administración de Proyectos · Grupo ITIC-901M

---

## Descripción

QHDC!? es una aplicación web para la gestión de alimentos del hogar. Ayuda a una familia a **no desperdiciar comida y no gastar de más**: unas básculas con ESP32 pesan los alimentos, la app lleva la alacena, avisa antes de que algo caduque, arma la lista del súper y un asistente sugiere qué usar primero y qué cocinar.

## Objetivo

Desarrollar una aplicación web en 4 meses con la metodología Scrum, utilizando HTML, CSS, JavaScript, SQL, Inteligencia Artificial (IA) e Internet de las Cosas (IoT).

## Propuesta de solución

Un sistema que registra el inventario del hogar, lo actualiza con sensores IoT, avisa de las caducidades y recomienda qué consumir, qué comprar y qué cocinar.

## Funcionalidades

- [x] Gestión de usuarios
- [x] Gestión de alimentos
- [x] Control de fechas de caducidad
- [x] Monitoreo de inventario mediante IoT (con simulador de ESP32)
- [x] Recomendaciones de consumo mediante IA (con reglas simuladas)
- [x] Generación de lista de compras
- [x] Gestión de recetas
- [ ] Gestión de reportes (pendiente)

## Pila tecnológica

| Capa | Tecnología |
|---|---|
| Frontend | HTML, CSS y JavaScript |
| Backend y API | Node.js 18+ con Express |
| Base de datos | MySQL 8 |
| IoT | ESP32 con básculas y sensores (enviando lecturas por HTTP, con simulador) |
| IA | Asistente y reconocimiento por cámara (simulados, listos para conectar un modelo) |
| Seguridad | bcrypt, cookies httpOnly y sesiones por hogar |
| Gestión | Scrum, GitHub y GitHub Projects |

---

## Cómo ejecutarlo

**Requisitos:** Node.js 18 o más nuevo y MySQL 8.

1. **Base de datos.** En MySQL Workbench abre `database/qhdc_base_de_datos.sql` y ejecútalo completo (icono del rayo). Si la base ya existía y quieres empezar de cero, descomenta la línea `DROP DATABASE IF EXISTS qhdc;` al inicio del script.
2. **Configuración.** En la carpeta `backend`, copia `.env.example` como `.env` y escribe tu usuario y contraseña de MySQL (`DB_USUARIO`, `DB_CONTRASENA`).
3. **Instalar y arrancar.** Dentro de `backend`:
   ```bash
   npm install
   npm start
   ```
4. **Abrir** <http://localhost:3000>

**Cuenta de ejemplo:** `admin@qhdc.mx` / `admin123`

> Las páginas necesitan el servidor corriendo; no se abren con doble clic.

## Estructura del repositorio

```text
QHDC/
├── README.md
├── database/   qhdc_base_de_datos.sql (tablas, vistas, procedimientos y datos de ejemplo)
├── backend/    server.js, simulador-esp32.js y src/ (rutas y servicios de la API)
└── frontend/   11 pantallas en HTML, con su CSS y JS (css/, js/, img/)
```

---

## Historias de usuario

Cada historia tiene sus **tareas** y **criterios de aceptación** en el tablero de GitHub Projects.

| HU | Historia | Pts | Sprint |
|---|---|:---:|:---:|
| HU-01 | Registro de alimentos | 4.3 | 1 |
| HU-02 | Consulta de cantidades | 8 | 1 |
| HU-03 | Actualización mediante sensores IoT | 11.3 | 2 |
| HU-04 | Registro de fechas de caducidad | 7.8 | 2 |
| HU-05 | Recomendaciones mediante IA | 6.5 | 3 |
| HU-06 | Predicción de consumo | 6.7 | 4 |
| HU-07 | Lista de compras automática | 5.5 | 4 |
| HU-08 | Recomendación de recetas | 5.5 | 4 |
| HU-09 | Consulta desde cualquier dispositivo | 6.5 | 1 |
| HU-10 | Identificación de alimentos mediante IA | 9.7 | 3 |

## Metodología Scrum

- **Fechas:** del 21 de septiembre al 15 de noviembre de 2026, en 4 sprints de 2 semanas.
- **Planeación:** tablero en GitHub Projects: <https://github.com/users/unitadeogama01/projects/2>
- **Repositorio:** una rama por integrante (`Tadeo`, `Axel`, `Rodrigo`, `Marilu`, `Hector`, `Diego`) y `master` como versión integrada.

| Sprint | Fechas (2026) | Objetivo |
|---|---|---|
| 1 | 21 sep – 4 oct | Inventario y acceso web (HU-01, 02, 09) |
| 2 | 5 oct – 18 oct | Caducidad y sensores IoT (HU-04, 03) |
| 3 | 19 oct – 1 nov | Cámara y recomendaciones (HU-10, 05) |
| 4 | 2 nov – 15 nov | Predicción, lista de compras y recetas (HU-06, 07, 08) |

## Estado actual

- **Funciona:** las 11 pantallas, la API, la base de datos con datos de ejemplo, el inicio de sesión y los sensores con simulador de ESP32.
- **Simulado o pendiente:** el reconocimiento por cámara y el asistente usan reglas, no un modelo de IA; las básculas ESP32 físicas aún no están conectadas; falta la gestión de reportes.

## Equipo

| Integrante | Rol |
|---|---|
| Tadeo Habith Contreras Gama | Scrum Master |
| Axel González Rivera | Desarrollador |
| Rodrigo Ortega Maldonado | Desarrollador |
| Marilú Ramírez López | Desarrolladora |
| Héctor Jesús Tabarez López | Desarrollador |
| Diego Rafael Ávila Peralta | Desarrollador |
