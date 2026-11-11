
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const pool = require('./db');
const authRoutes = require('./auth');

const app = express();

app.use(cors()); // Solo para desarrollo local
app.use(express.json());

app.get('/api/estado-db', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT DATABASE() AS baseDatos');

        res.json({
            conectado: true,
            mensaje: 'Conexión con MySQL exitosa',
            baseDatos: rows[0].baseDatos
        });
    } catch (error) {
        console.error('Error de conexión:', error.message);

        res.status(500).json({
            conectado: false,
            mensaje: 'No se pudo conectar con MySQL'
        });
    }
});

app.use('/api/auth', authRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Servidor QHDC iniciado en http://localhost:${PORT}`);
});
