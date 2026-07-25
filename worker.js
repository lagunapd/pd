// Worker de Cloudflare para guardar, compartidas entre todos, las listas de
// clases de cada rango: Asistencias (Uniformados), Tenientes, Capitanes y
// Mayores. Las cuatro usan el mismo esquema (clases verde/amarillo, con
// Procedimientos obligatoria), pidiendo distinta cantidad de clases cada
// una. Al evaluar a alguien para el rango siguiente, si aprueba pasa de
// lista con el rango nuevo asignado; si reprueba, se queda donde está. En
// ambos casos queda una entrada en su historial de evaluaciones (de solo
// lectura, se ve desde evaluaciones.html).
// No requiere servidor propio: se despliega gratis en Cloudflare.
//
// Cada recurso funciona igual, cambiando ?recurso=xxx (asistencias es el
// default si no se manda recurso, por compatibilidad con versiones viejas):
//   GET  /?recurso=tenientes                                -> { tenientes: [...], ultimaActualizacion }
//   POST / { recurso:"tenientes", entries: [...] }           -> agrega clases/puntos
//   POST / { recurso:"tenientes", edit: {...} }              -> edita/renombra (admin)
//   POST / { recurso:"tenientes", delete: {...} }            -> elimina (admin)
//   POST / { recurso:"tenientes", evaluarAscenso: {...} }    -> evalúa para el rango siguiente
//   POST / { recurso:"tenientes", cambiarRango: {...} }      -> cambia el rango a mano (panel de administración)
//
// Recursos disponibles: "asistencias", "tenientes", "capitanes", "mayores".
// Mayores es el techo por ahora (no tiene rango siguiente configurado), así
// que ahí no existe la acción de evaluarAscenso en el cliente.

const KV_KEY_ASISTENCIAS = "asistencias";
const KV_KEY_EVALUACIONES = "evaluaciones"; // legacy, ya no lo usa nada activo

// Por seguridad, cambiá esto por tu dominio real de GitHub Pages una vez
// que lo tengas andando, ej: "https://tuusuario.github.io"
const ALLOWED_ORIGIN = "*";

function withCors(resp) {
  resp.headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  resp.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  resp.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return resp;
}

function json(data, status = 200) {
  return withCors(
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
}

function limpiarRegistro(r) {
  return {
    tipo: r && r.tipo === "amarillo" ? "amarillo" : "verde",
    fecha: (r && r.fecha) || "—",
    turno: (r && r.turno) || "—",
    instructor: (r && r.instructor) || "—",
    registrador: (r && r.registrador) || "Desconocido",
  };
}

// ==================== helpers genéricos de KV ====================
// Cargan/guardan { lista: [...], ultimaActualizacion } bajo una key dada,
// tolerando: valor vacío, formato viejo (array pelado), o JSON corrupto.
async function cargarLista(env, kvKey, campoLista) {
  const raw = await env.ASISTENCIAS_KV.get(kvKey);
  if (!raw) return { lista: [], ultimaActualizacion: null };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { lista: [], ultimaActualizacion: null };
  }

  let lista = [];
  let ultimaActualizacion = null;

  if (Array.isArray(parsed)) {
    lista = parsed; // formato viejo: array pelado
  } else if (parsed && Array.isArray(parsed[campoLista])) {
    lista = parsed[campoLista];
    ultimaActualizacion = parsed.ultimaActualizacion || null;
  }

  lista = lista.filter((p) => p && typeof p.nombre === "string" && p.nombre.trim());

  return { lista, ultimaActualizacion };
}

async function guardarLista(env, kvKey, campoLista, lista) {
  const estado = {
    [campoLista]: lista,
    ultimaActualizacion: new Date().toISOString(),
  };
  await env.ASISTENCIAS_KV.put(kvKey, JSON.stringify(estado));
  return estado;
}

// ==================== evaluaciones (legacy, orfanato) ====================
// Nada en el sitio actual usa esto (era de una versión vieja de
// evaluaciones.html, que ahora es el visor de solo lectura). Se deja sin
// tocar por si hiciera falta algún día.
function limpiarEvaluacionLegacy(nombre, e) {
  return {
    nombre,
    resultado: e && e.resultado === "reprobado" ? "reprobado" : "aprobado",
    fecha: (e && e.fecha) || "—",
    evaluador: (e && e.evaluador) || "—",
    observaciones: (e && e.observaciones) || "",
  };
}

async function manejarEvaluacionesLegacy(request, env, payload) {
  if (request.method === "GET") {
    const { lista, ultimaActualizacion } = await cargarLista(env, KV_KEY_EVALUACIONES, "evaluacionesLegacy");
    return json({ evaluacionesLegacy: lista, ultimaActualizacion });
  }
  return json({ error: "Este recurso legacy ya no acepta escrituras." }, 400);
}

// ==================== listas de clases (Asistencias/Tenientes/Capitanes/Mayores) ====================
// Cada persona: {
//   nombre, rango,
//   registros: [{tipo, fecha, turno, instructor, registrador}],
//   historialEvaluaciones: [{fecha, evaluador, observaciones, resultado, rangoDesde, rangoHacia}],
// }
//
// rango: se asigna solo/a (rangoDefault) cuando la persona recién aparece en
// esta lista, y NO se puede tocar desde acá — solo lo va a poder cambiar el
// futuro panel de administración.
//
// evaluarAscenso: evalúa a la persona para el rango SIGUIENTE. Siempre queda
// una entrada nueva en su historialEvaluaciones (apruebe o repruebe):
//   - reprobado -> se queda en esta lista, con el intento sumado al
//     historial. Se puede reintentar cuando se quiera.
//   - aprobado  -> se elimina de esta lista y se crea en la lista
//     siguiente, con el rango nuevo asignado y el historial completo viaja
//     con ella (nunca se pierde, es la carrera completa de la persona).
const LISTAS_CLASES = {
  asistencias: {
    kvKey: KV_KEY_ASISTENCIAS,
    rangoDefault: "Uniformado",
    siguiente: { recurso: "tenientes", rango: "Tenientes" },
  },
  tenientes: {
    kvKey: "tenientes",
    rangoDefault: "Tenientes",
    siguiente: { recurso: "capitanes", rango: "Capitanes" },
  },
  capitanes: {
    kvKey: "capitanes",
    rangoDefault: "Capitanes",
    siguiente: { recurso: "mayores", rango: "Mayores" },
  },
  mayores: {
    kvKey: "mayores",
    rangoDefault: "Mayores",
    siguiente: null, // techo por ahora: acá no hay evaluarAscenso
  },
};

async function manejarListaClases(request, env, payload, recurso) {
  const config = LISTAS_CLASES[recurso];
  if (!config) return json({ error: `Recurso "${recurso}" no reconocido` }, 400);

  const cargaInicial = await cargarLista(env, config.kvKey, recurso);
  const lista = cargaInicial.lista;
  let ultimaActualizacion = cargaInicial.ultimaActualizacion;

  // ---- backfill: a quien le falte el rango (gente que ya estaba en la
  // lista antes de que existiera este campo) se le asigna el rango por
  // defecto de esta lista, una sola vez, y se guarda. ----
  let necesitaGuardar = false;
  for (const p of lista) {
    if (!p.rango) {
      p.rango = config.rangoDefault;
      necesitaGuardar = true;
    }
  }
  if (necesitaGuardar) {
    const estadoBackfill = await guardarLista(env, config.kvKey, recurso, lista);
    ultimaActualizacion = estadoBackfill.ultimaActualizacion;
  }

  if (request.method === "GET") {
    return json({ [recurso]: lista, ultimaActualizacion });
  }

  // ---- editar: reemplaza la lista completa de clases de una persona,
  // permite renombrarla vía nombreNuevo. El rango y el historial de
  // evaluaciones NO se tocan acá (el historial nunca se edita a mano). ----
  if (payload.edit && payload.edit.nombre) {
    const nombreLimpio = String(payload.edit.nombre).trim();
    const nombreNuevo = payload.edit.nombreNuevo
      ? String(payload.edit.nombreNuevo).trim()
      : nombreLimpio;
    const registrador = payload.edit.registrador || "Desconocido";

    let persona = lista.find(
      (p) => p.nombre.toLowerCase() === nombreLimpio.toLowerCase()
    );
    if (!persona) {
      persona = { nombre: nombreNuevo || nombreLimpio, rango: config.rangoDefault, registros: [], historialEvaluaciones: [] };
      lista.push(persona);
    }
    if (!persona.rango) persona.rango = config.rangoDefault;
    if (!Array.isArray(persona.historialEvaluaciones)) persona.historialEvaluaciones = [];
    // El rango normalmente no se toca acá — solo lo usa el panel de
    // administración para asignarlo a mano al dar de alta a alguien.
    if (payload.edit.rango) persona.rango = String(payload.edit.rango).trim() || persona.rango;

    const registrosNuevos = Array.isArray(payload.edit.registros)
      ? payload.edit.registros.map((r) => {
          const limpio = limpiarRegistro(r);
          if (!(r && r.registrador)) {
            limpio.registrador = `Editado por ${registrador}`;
          }
          return limpio;
        })
      : persona.registros;

    persona.nombre = nombreNuevo || persona.nombre;
    persona.registros = registrosNuevos;

    const estado = await guardarLista(env, config.kvKey, recurso, lista);
    return json({ [recurso]: estado[recurso], ultimaActualizacion: estado.ultimaActualizacion });
  }

  // ---- eliminar: borra por completo el historial de una persona ----
  if (payload.delete && payload.delete.nombre) {
    const nombreLimpio = String(payload.delete.nombre).trim().toLowerCase();
    const idx = lista.findIndex((p) => p.nombre.toLowerCase() === nombreLimpio);
    if (idx !== -1) {
      lista.splice(idx, 1);
      const estado = await guardarLista(env, config.kvKey, recurso, lista);
      return json({ [recurso]: estado[recurso], ultimaActualizacion: estado.ultimaActualizacion });
    }
    const actual = await cargarLista(env, config.kvKey, recurso);
    return json({ [recurso]: actual.lista, ultimaActualizacion: actual.ultimaActualizacion });
  }

  // ---- cambiar rango a mano (solo lo usa el panel de administración) ----
  if (payload.cambiarRango && payload.cambiarRango.nombre) {
    const nombreLimpio = String(payload.cambiarRango.nombre).trim();
    const idx = lista.findIndex((p) => p.nombre.toLowerCase() === nombreLimpio.toLowerCase());
    if (idx === -1) return json({ error: "No se encontró a esa persona en esta lista." }, 404);
    const rangoNuevo = String(payload.cambiarRango.rangoNuevo || "").trim();
    if (!rangoNuevo) return json({ error: "Falta el rango nuevo." }, 400);
    lista[idx].rango = rangoNuevo;
    const estado = await guardarLista(env, config.kvKey, recurso, lista);
    return json({ [recurso]: estado[recurso], ultimaActualizacion: estado.ultimaActualizacion });
  }

  // ---- evaluarAscenso: evalúa para el rango siguiente ----
  if (payload.evaluarAscenso && payload.evaluarAscenso.nombre) {
    const nombreLimpio = String(payload.evaluarAscenso.nombre).trim();
    const aprobado = payload.evaluarAscenso.resultado === "aprobado";
    const siguiente = config.siguiente;

    const idx = lista.findIndex((p) => p.nombre.toLowerCase() === nombreLimpio.toLowerCase());
    if (idx === -1) return json({ error: "No se encontró a esa persona en esta lista." }, 404);
    const persona = lista[idx];
    if (!Array.isArray(persona.historialEvaluaciones)) persona.historialEvaluaciones = [];

    const entradaHistorial = {
      fecha: payload.evaluarAscenso.fecha || "—",
      evaluador: payload.evaluarAscenso.evaluador || "—",
      observaciones: payload.evaluarAscenso.observaciones || "",
      resultado: aprobado ? "aprobado" : "reprobado",
      rangoDesde: persona.rango || config.rangoDefault,
      rangoHacia: siguiente ? siguiente.rango : (persona.rango || config.rangoDefault),
    };
    const historialNuevo = [...persona.historialEvaluaciones, entradaHistorial];

    if (!aprobado) {
      // Reprobado: se queda en esta lista, con el intento sumado al
      // historial para poder verlo en Evaluaciones.
      persona.historialEvaluaciones = historialNuevo;
      const estado = await guardarLista(env, config.kvKey, recurso, lista);
      return json({ [recurso]: estado[recurso], ultimaActualizacion: estado.ultimaActualizacion });
    }

    if (!siguiente) {
      return json({ error: "Todavía no está armado el siguiente rango." }, 400);
    }

    lista.splice(idx, 1);
    const estadoOrigen = await guardarLista(env, config.kvKey, recurso, lista);

    const siguienteConfig = LISTAS_CLASES[siguiente.recurso];
    const { lista: listaDestino } = await cargarLista(env, siguienteConfig.kvKey, siguiente.recurso);
    const yaEsta = listaDestino.find((p) => p.nombre.toLowerCase() === persona.nombre.toLowerCase());
    if (!yaEsta) {
      listaDestino.push({
        nombre: persona.nombre,
        rango: siguiente.rango,
        registros: [],
        historialEvaluaciones: historialNuevo,
      });
      await guardarLista(env, siguienteConfig.kvKey, siguiente.recurso, listaDestino);
    }

    return json({ [recurso]: estadoOrigen[recurso], ultimaActualizacion: estadoOrigen.ultimaActualizacion });
  }

  // ---- agregar entradas (registrar clases) ----
  const entries = Array.isArray(payload.entries) ? payload.entries : [];

  for (const entry of entries) {
    if (!entry || !entry.nombre || !entry.tipo) continue;
    const nombreLimpio = String(entry.nombre).trim();
    if (!nombreLimpio) continue;

    let persona = lista.find(
      (p) => p.nombre.toLowerCase() === nombreLimpio.toLowerCase()
    );
    if (!persona) {
      persona = { nombre: nombreLimpio, rango: config.rangoDefault, registros: [], historialEvaluaciones: [] };
      lista.push(persona);
    }
    if (!persona.rango) persona.rango = config.rangoDefault;
    if (!Array.isArray(persona.historialEvaluaciones)) persona.historialEvaluaciones = [];
    persona.registros.push(limpiarRegistro(entry));
  }

  const estado = await guardarLista(env, config.kvKey, recurso, lista);
  return json({ [recurso]: estado[recurso], ultimaActualizacion: estado.ultimaActualizacion });
}

// ==================== evaluaciones.html (visor de solo lectura) ====================
// No guarda nada propio: junta a todo el mundo de las 4 listas de clases y
// devuelve, para cada persona, su rango actual y su historialEvaluaciones.
async function manejarEvaluacionesVisor(request, env) {
  const recursos = Object.keys(LISTAS_CLASES);
  const personas = [];

  for (const recurso of recursos) {
    const config = LISTAS_CLASES[recurso];
    const { lista } = await cargarLista(env, config.kvKey, recurso);
    for (const p of lista) {
      personas.push({
        nombre: p.nombre,
        rangoActual: p.rango || config.rangoDefault,
        historialEvaluaciones: Array.isArray(p.historialEvaluaciones) ? p.historialEvaluaciones : [],
      });
    }
  }

  personas.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  return json({ personas });
}

export default {
  async fetch(request, env) {
    try {
      if (request.method === "OPTIONS") {
        return withCors(new Response(null, { status: 204 }));
      }

      if (!env.ASISTENCIAS_KV) {
        return json(
          { error: "Falta el binding ASISTENCIAS_KV en este Worker (Settings → Bindings → KV namespace)." },
          500
        );
      }

      const url = new URL(request.url);

      if (request.method === "GET") {
        const recurso = url.searchParams.get("recurso");
        if (recurso === "evaluacionesVisor") {
          return await manejarEvaluacionesVisor(request, env);
        }
        if (recurso === "evaluacionesLegacy") {
          return await manejarEvaluacionesLegacy(request, env, {});
        }
        if (recurso && LISTAS_CLASES[recurso]) {
          return await manejarListaClases(request, env, {}, recurso);
        }
        return await manejarListaClases(request, env, {}, "asistencias");
      }

      if (request.method === "POST") {
        let payload;
        try {
          payload = await request.json();
        } catch (e) {
          return json({ error: "JSON inválido" }, 400);
        }

        if (payload.recurso === "evaluacionesLegacy") {
          return await manejarEvaluacionesLegacy(request, env, payload);
        }
        if (payload.recurso && LISTAS_CLASES[payload.recurso]) {
          return await manejarListaClases(request, env, payload, payload.recurso);
        }
        return await manejarListaClases(request, env, payload, "asistencias");
      }

      return json({ error: "Método no soportado" }, 405);
    } catch (err) {
      // Cualquier error inesperado también sale con headers CORS y con el
      // mensaje real, en vez de un 500 pelado que el navegador reporta como
      // bloqueo de CORS.
      return json({ error: "Error interno del Worker: " + (err && err.message ? err.message : String(err)) }, 500);
    }
  },
};
