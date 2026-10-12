
const API_URL = 'http://localhost:3000/api';

async function registrarUsuario(datos) {
    const respuesta = await fetch(`${API_URL}/auth/registro`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(datos)
    });

    const resultado = await respuesta.json();

    if (!respuesta.ok) {
        throw new Error(resultado.mensaje || 'Error al registrarse.');
    }

    return resultado;
}

async function iniciarSesion(correo, contrasena) {
    const respuesta = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ correo, contrasena })
    });

    const resultado = await respuesta.json();

    if (!respuesta.ok) {
        throw new Error(resultado.mensaje || 'Error al iniciar sesión.');
    }

    return resultado;
}
