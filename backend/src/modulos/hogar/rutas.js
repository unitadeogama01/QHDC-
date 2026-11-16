// ============================================================
//  /api/estado — Todo lo del hogar en una sola respuesta (con sesión)
//  Antes de responder se sincroniza: lista sugerida y avisos al día.
//  (Lo que cambia en vivo está en modulos/iot: GET /api/sensores/vivo)
// ============================================================
const express = require("express");
const { transaccion } = require("../../nucleo/db");
const { async_ } = require("../../nucleo/errores");
const { sesionPublica } = require("../auth/sesiones");
const hogar = require("./estado");

const router = express.Router();

router.get("/estado", async_(async (req, res) => {
  const u = req.usuario;
  // READ COMMITTED: con el aislamiento normal, los INSERT ... SELECT de los
  // procedimientos bloqueaban huecos de índices compartidos y varias familias
  // abriendo la app a la vez chocaban (deadlock, medido con npm run rendimiento).
  // La lista sigue protegida por el bloqueo del hogar en sp_generar_lista.
  await transaccion((c) => hogar.sincronizar(c, u.hogarId, u.id), { aislamiento: "READ COMMITTED" });
  const estado = await hogar.estadoCompleto(u);
  res.json({ sesion: sesionPublica(u), ...estado });
}));

module.exports = router;
