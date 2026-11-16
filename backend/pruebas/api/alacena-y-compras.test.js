// Pruebas de la API: alacena (alta, cambios de cantidad, borrar y restaurar)
// y lista del súper (anotar, marcar y "Terminé de comprar").
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { iniciar, alimento, dia } = require("../ayuda/entorno");

let amb, yo;
before(async () => { amb = await iniciar(); yo = await amb.cuentaNueva(); });
after(async () => { if (amb) await amb.cerrar(); });

const estado = async () => (await yo("GET", "/api/estado")).json;
const buscar = async (nombre) => (await estado()).productos.find((p) => p.nombre === nombre);

describe("alacena", () => {
  let idHuevo;

  it("agrega un alimento y aparece con su cantidad y caducidad", async () => {
    const r = await yo("POST", "/api/alimentos", alimento("Huevo", { cantidad: 6, capacidad: 12, caducidad: dia(10) }));
    assert.equal(r.estado, 201);
    idHuevo = r.json.id;
    const p = await buscar("Huevo");
    assert.equal(p.cantidad, 6);
    assert.equal(p.capacidad, 12);
    assert.equal(p.caducidad, dia(10));
  });

  it("valida los datos del formulario", async () => {
    assert.equal((await yo("POST", "/api/alimentos", alimento(""))).estado, 400);
    assert.equal((await yo("POST", "/api/alimentos", alimento("Pan", { cantidad: -1 }))).estado, 400);
    assert.equal((await yo("POST", "/api/alimentos", alimento("Pan", { caducidad: "mañana" }))).estado, 400);
    assert.equal((await yo("POST", "/api/alimentos", alimento("Pan", { unidad: "toneladas" }))).estado, 400);
  });

  it("no permite dos alimentos con el mismo nombre", async () => {
    assert.equal((await yo("POST", "/api/alimentos", alimento("huevo"))).estado, 409);
  });

  it("cambia la cantidad (usar un poco) y rellena hasta 'lleno'", async () => {
    assert.equal((await yo("PUT", `/api/alimentos/${idHuevo}/existencia`, { cantidad: 2 })).estado, 200);
    assert.equal((await buscar("Huevo")).cantidad, 2);
    assert.equal((await yo("POST", `/api/alimentos/${idHuevo}/rellenar`, {})).estado, 200);
    assert.equal((await buscar("Huevo")).cantidad, 12);
  });

  it("no acepta cantidades negativas", async () => {
    assert.equal((await yo("PUT", `/api/alimentos/${idHuevo}/existencia`, { cantidad: -5 })).estado, 400);
    assert.equal((await buscar("Huevo")).cantidad, 12);
  });

  it("borrar lo quita de la alacena y restaurar lo devuelve", async () => {
    assert.equal((await yo("DELETE", `/api/alimentos/${idHuevo}`)).estado, 200);
    assert.equal(await buscar("Huevo"), undefined);
    assert.equal((await yo("POST", `/api/alimentos/${idHuevo}/restaurar`, {})).estado, 200);
    assert.ok(await buscar("Huevo"));
  });

  it("un alimento que caducó genera un aviso en el historial", async () => {
    await yo("POST", "/api/alimentos", alimento("Yogur", { caducidad: dia(-1) }));
    await estado(); // al cargar se recalculan los avisos
    const h = await yo("GET", "/api/avisos/historial?dias=7");
    assert.equal(h.estado, 200);
    const aviso = h.json.avisos.find((a) => /yogur/i.test(`${a.titulo} ${a.mensaje}`));
    assert.ok(aviso, "hay un aviso del yogur");
    assert.equal((await yo("PUT", "/api/avisos/leida", { clave: aviso.clave, leida: true })).estado, 200);
    const despues = (await yo("GET", "/api/avisos/historial?dias=7")).json.avisos.find((a) => a.clave === aviso.clave);
    assert.equal(despues.leido, true);
  });
});

describe("lista del súper", () => {
  const extra = async (nombre, cantidad) => (await yo("POST", "/api/lista/extras", { nombre, cantidad })).json.id;
  const marcar = (id) => yo("PUT", "/api/lista/comprado", { clave: `x-${id}`, comprado: true });

  it("valida lo que se anota", async () => {
    assert.equal((await yo("POST", "/api/lista/extras", { nombre: "" })).estado, 400);
    assert.equal((await yo("PUT", "/api/lista/comprado", { clave: "cualquier-cosa", comprado: true })).estado, 400);
  });

  it("'Terminé de comprar' pasa a la alacena lo marcado (también lo anotado a mano)", async () => {
    await yo("PUT", `/api/alimentos/${(await buscar("Huevo")).id}/existencia`, { cantidad: 1 });
    const ids = {
      huevos: await extra("huevos", "12 piezas"),     // ya existe como "Huevo": se rellena, no se duplica
      cebolla: await extra("Cebolla", "2 piezas"),    // nuevo
      leche: await extra("Leche", "2 litros"),        // nuevo, con unidad
      azucar: await extra("Azúcar", "1 kg"),          // no se marca: se queda en la lista
    };
    for (const k of ["huevos", "cebolla", "leche"]) assert.equal((await marcar(ids[k])).estado, 200);
    const fin = await yo("POST", "/api/lista/finalizar", {});
    assert.equal(fin.estado, 200);
    assert.equal(fin.json.total, 3);

    const e = await estado();
    const n = (nombre) => e.productos.filter((p) => p.nombre.toLowerCase().startsWith(nombre));
    assert.equal(n("huevo").length, 1, "no se duplicó el huevo");
    assert.equal(n("huevo")[0].cantidad, 12, "se rellenó a lleno");
    assert.equal(n("cebolla")[0].cantidad, 2);
    assert.equal(n("leche")[0].cantidad, 2);
    assert.equal(n("leche")[0].unidad, "L");
    assert.deepEqual(e.listaExtra.map((x) => x.nombre), ["Azúcar"], "lo no comprado sigue en la lista");
  });

  it("terminar sin nada marcado no cambia la alacena", async () => {
    const antes = (await estado()).productos.map((p) => `${p.nombre}:${p.cantidad}`).sort();
    assert.equal((await yo("POST", "/api/lista/finalizar", {})).json.total, 0);
    const despues = (await estado()).productos.map((p) => `${p.nombre}:${p.cantidad}`).sort();
    assert.deepEqual(despues, antes);
  });

  it("quitar algo anotado", async () => {
    const id = (await estado()).listaExtra[0].id;
    assert.equal((await yo("DELETE", `/api/lista/extras/${id}`)).estado, 200);
    assert.equal((await estado()).listaExtra.length, 0);
  });
});

describe("lista sugerida y varias familias a la vez", () => {
  const enLista = async (alimentoId) => {
    const { consulta } = require("../../src/nucleo/db");
    const filas = await consulta(
      `SELECT it.id FROM lista_compras_items it
         JOIN listas_compras l ON l.id = it.lista_id AND l.estado = 'activa'
        WHERE it.alimento_id = ? AND it.comprado = FALSE`, [alimentoId]);
    return filas.length > 0;
  };

  it("lo que se acaba entra a la lista y sale al rellenarlo", async () => {
    const id = (await yo("POST", "/api/alimentos", alimento("Arroz", { cantidad: 1, capacidad: 10 }))).json.id;
    await estado();
    assert.equal(await enLista(id), true, "queda poco: está en la lista");
    await yo("POST", `/api/alimentos/${id}/rellenar`, {});
    await estado();
    assert.equal(await enLista(id), false, "ya está lleno: se quitó de la lista");
  });

  it("varias familias abriendo la app al mismo tiempo no chocan (sin deadlocks)", async () => {
    // Antes, con 5 familias a la vez, MySQL cancelaba transacciones (deadlock → error 500)
    const familias = [yo];
    for (let k = 0; k < 4; k++) {
      const f = await amb.cuentaNueva();
      await f("POST", "/api/alimentos", alimento("Frijol", { cantidad: 1, capacidad: 10 }));
      familias.push(f);
    }
    const r = await Promise.all(Array.from({ length: 60 }, (_, i) => familias[i % familias.length]("GET", "/api/estado")));
    assert.deepEqual([...new Set(r.map((x) => x.estado))], [200]);
  });
});
