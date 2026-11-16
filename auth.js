
const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const pool = require('./db');

const router = express.Router();

// REGISTRO
router.post('/registro', async (req, res) => {
    const { nombre, correo, contrasena, nombreHogar, personas } = req.body;

    if (
        typeof nombre !== 'string' ||
        typeof correo !== 'string' ||
        typeof contrasena !== 'string' ||
        !nombre.trim() ||
        !correo.trim() ||
        contrasena.length < 8 ||
        contrasena.length > 72
    ) {
        return res.status(400).json({
            mensaje: 'Completa los datos y usa una contraseña de 8 a 72 caracteres.'
        });
    }

    const hogar = typeof nombreHogar === 'string' && nombreHogar.trim()
        ? nombreHogar.trim()
        : `Hogar de ${nombre.trim()}`;

    const cantidadPersonas = ['1-2', '3-4', '5+'].includes(personas)
        ? personas
        : '3-4';

    let conexion;

    try {
        const hash = await bcrypt.hash(contrasena, 12);
        conexion = await pool.getConnection();

        await conexion.beginTransaction();

        const [usuarioResult] = await conexion.execute(
            `INSERT INTO usuarios
                (nombre, correo, contrasena_hash)
             VALUES (?, ?, ?)`,
            [nombre.trim(), correo.trim().toLowerCase(), hash]
        );

        const usuarioId = usuarioResult.insertId;

        const [hogarResult] = await conexion.execute(
            `INSERT INTO hogares (nombre, personas, creado_por)
             VALUES (?, ?, ?)`,
            [hogar, cantidadPersonas, usuarioId]
        );

        const hogarId = hogarResult.insertId;

        await conexion.execute(
            `INSERT INTO hogar_miembros
                (hogar_id, usuario_id, rol, activo)
             VALUES (?, ?, 'administrador', TRUE)`,
            [hogarId, usuarioId]
        );

        await conexion.execute(
            `INSERT INTO preferencias_usuario (usuario_id)
             VALUES (?)`,
            [usuarioId]
        );

        await conexion.commit();

        return res.status(201).json({
            mensaje: 'Usuario registrado correctamente.',
            usuario: {
                id: usuarioId,
                nombre: nombre.trim(),
                correo: correo.trim().toLowerCase()
            },
            hogar: {
                id: hogarId,
                nombre: hogar
            }
        });
    } catch (error) {
        if (conexion) {
            await conexion.rollback();
        }

        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                mensaje: 'Este correo ya está registrado.'
            });
        }

        console.error('Error en registro:', error.message);

        return res.status(500).json({
            mensaje: 'No se pudo registrar el usuario.'
        });
    } finally {
        if (conexion) conexion.release();
    }
});

// INICIO DE SESIÓN
router.post('/login', async (req, res) => {
    const { correo, contrasena } = req.body;

    if (
        typeof correo !== 'string' ||
        typeof contrasena !== 'string' ||
        !correo.trim() ||
        !contrasena
    ) {
        return res.status(400).json({
            mensaje: 'Ingresa tu correo y contraseña.'
        });
    }

    try {
        const [usuarios] = await pool.execute(
            `SELECT id, nombre, correo, contrasena_hash
             FROM usuarios
             WHERE correo = ? AND activo = TRUE
             LIMIT 1`,
            [correo.trim().toLowerCase()]
        );

        if (usuarios.length === 0) {
            return res.status(401).json({
                mensaje: 'Correo o contraseña incorrectos.'
            });
        }

        const usuario = usuarios[0];
        const coincide = await bcrypt.compare(
            contrasena,
            usuario.contrasena_hash
        );

        if (!coincide) {
            return res.status(401).json({
                mensaje: 'Correo o contraseña incorrectos.'
            });
        }

        const [hogares] = await pool.execute(
            `SELECT h.id, h.nombre, hm.rol
             FROM hogar_miembros hm
             INNER JOIN hogares h ON h.id = hm.hogar_id
             WHERE hm.usuario_id = ? AND hm.activo = TRUE
             ORDER BY (hm.rol = 'administrador') DESC, h.id
             LIMIT 1`,
            [usuario.id]
        );

        if (hogares.length === 0) {
            return res.status(403).json({
                mensaje: 'Tu usuario no tiene un hogar activo.'
            });
        }

        // El token original se entrega al cliente;
        // solamente su hash se guarda en MySQL.
        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto
            .createHash('sha256')
            .update(token)
            .digest('hex');

        const hogar = hogares[0];

        await pool.execute(
            `INSERT INTO sesiones_autenticacion
                (usuario_id, hogar_id, token_hash, expira_en)
             VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))`,
            [usuario.id, hogar.id, tokenHash]
        );

        await pool.execute(
            `UPDATE usuarios
             SET ultimo_acceso = NOW()
             WHERE id = ?`,
            [usuario.id]
        );

        return res.json({
            mensaje: 'Inicio de sesión correcto.',
            token,
            usuario: {
                id: usuario.id,
                nombre: usuario.nombre,
                correo: usuario.correo
            },
            hogar: {
                id: hogar.id,
                nombre: hogar.nombre,
                rol: hogar.rol
            }
        });
    } catch (error) {
        console.error('Error en login:', error.message);

        return res.status(500).json({
            mensaje: 'No se pudo iniciar sesión.'
        });
    }
});

module.exports = router;
