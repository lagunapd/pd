// Worker de Cloudflare para guardar, compartidas entre todos:
//  - la lista de Asistencias (Uniformados)
//  - la lista de Tenientes (mismo esquema que Asistencias, pero pidiendo
//    3 clases en vez de 6)
//  - la lista de Capitanes (por ahora sigue con el esquema de evaluación
//    con historial, hasta que se convierta también)
// No requiere servidor propio: se despliega gratis en Cloudflare.
//
// Recurso "asistencias" (comportamiento de siempre, sin cambios de URL):
//   GET  /                        -> { asistencias: [...], ultimaActualizacion }
//   POST / { entries: [...] }     -> agrega clases/puntos
//   POST / { edit: {...} }        -> edita/renombra a una persona
//   POST / { delete: {...} }      -> elimina a una persona
//   POST / { evaluarAscenso: {...} } -> evalúa para pasar a Tenientes
//
// Recurso "tenientes" (nuevo, mismo esquema que asistencias):
//   GET  /?recurso=tenientes                          -> { tenientes: [...], ultimaActualizacion }
//   POST / { recurso:"tenientes", entries: [...] }     -> agrega clases/puntos
//   POST / { recurso:"tenientes", edit: {...} }        -> edita/renombra
//   POST / { recurso:"tenientes", delete: {...} }      -> elimina
//   POST / { recurso:"tenientes", evaluarAscenso: {...} } -> evalúa para pasar a Capitanes
//
// Recurso "capitanes" (todavía con el esquema viejo de evaluación/historial):
//   GET  /?recurso=capitanes                        -> { capitanes: [...], ultimaActualizacion }
//   POST / { recurso:"capitanes", agregarIntento: {...} } -> evalúa/ingresa
//   POST / { recurso:"capitanes", arreglarErrores: {...} } -> admin corrige a mano
//   POST / { recurso:"capitanes", eliminar: {...} }        -> elimina

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
// Nada en el sitio actual usa esto (era de evaluaciones.html, que ya no
// está enlazado desde index.html). Se deja sin tocar por si hiciera falta.
function limpiarEvaluacion(nombre, e) {
  return {
    nombre,
    resultado: e && e.resultado === "reprobado" ? "reprobado" : "aprobado",
    fecha: (e && e.fecha) || "—",
    evaluador: (e && e.evaluador) || "—",
    observaciones: (e && e.observaciones) || "",
  };
}

async function manejarEvaluaciones(request, env, payload) {
  if (request.method === "GET") {
    const { lista, ultimaActualizacion } = await cargarLista(env, KV_KEY_EVALUACIONES, "evaluaciones");
    return json({ evaluaciones: lista, ultimaActualizacion });
  }

  const { lista: evaluaciones } = await cargarLista(env, KV_KEY_EVALUACIONES, "evaluaciones");

  if (payload.guardar && payload.guardar.nombre) {
    const nombreLimpio = String(payload.guardar.nombre).trim();
    const datos = limpiarEvaluacion(nombreLimpio, payload.guardar);

    let registro = evaluaciones.find(
      (ev) => ev.nombre.toLowerCase() === nombreLimpio.toLowerCase()
    );
    const intento = { fecha: datos.fecha, resultado: datos.resultado, evaluador: datos.evaluador };

    if (!registro) {
      registro = { ...datos, historial: [intento] };
      evaluaciones.push(registro);
    } else {
      registro.resultado = datos.resultado;
      registro.fecha = datos.fecha;
      registro.evaluador = datos.evaluador;
      registro.observaciones = datos.observaciones;
      if (!Array.isArray(registro.historial)) registro.historial = [];
      registro.historial.push(intento);
    }

    const estado = await guardarLista(env, KV_KEY_EVALUACIONES, "evaluaciones", evaluaciones);
    return json({ evaluaciones: estado.evaluaciones, ultimaActualizacion: estado.ultimaActualizacion });
  }

  if (payload.eliminar && payload.eliminar.nombre) {
    const nombreLimpio = String(payload.eliminar.nombre).trim().toLowerCase();
    const idx = evaluaciones.findIndex((ev) => ev.nombre.toLowerCase() === nombreLimpio);
    if (idx !== -1) {
      evaluaciones.splice(idx, 1);
      const estado = await guardarLista(env, KV_KEY_EVALUACIONES, "evaluaciones", evaluaciones);
      return json({ evaluaciones: estado.evaluaciones, ultimaActualizacion: estado.ultimaActualizacion });
    }
    const actual = await cargarLista(env, KV_KEY_EVALUACIONES, "evaluaciones");
    return json({ evaluaciones: actual.lista, ultimaActualizacion: actual.ultimaActualizacion });
  }

  return json({ error: "Acción de evaluaciones no reconocida" }, 400);
}

// ==================== escalafón (capitanes, y en el futuro mayores) ====================
// Cada persona: { nombre, rango, resultado, fecha, evaluador, observaciones, historial: [...] }
// resultado = estado del ÚLTIMO intento en ESTA lista ('aprobado' | 'reprobado' | null = sin evaluar).
// historial = TODA la carrera (todos los rangos), no se reinicia nunca.
//
// Regla de ascenso automático: al agregar un intento (agregarIntento), la
// persona SIEMPRE pasa a la siguiente lista, sea aprobada o reprobada, y se
// elimina de la lista en la que estaba — siempre que exista un escalón
// siguiente ya armado. Capitanes es el tope actual (no existe "mayores"
// todavía), así que ahí el registro se queda con el resultado actualizado,
// permitiendo reintentos ("Agregar Intento") hasta que se apruebe.
const RANGO_LABEL = {
  tenientes: "Teniente",
  capitanes: "Capitán",
  mayores: "Mayor",
};

const ESCALAFON_CONFIG = {
  capitanes: { kvKey: "capitanes", siguiente: "mayores" },
  // mayores: se agrega cuando exista ese escalón (Mayor es el techo por ahora)
};

function limpiarIntentoEscalafon(nombre, e) {
  return {
    nombre,
    resultado: e && e.resultado === "reprobado" ? "reprobado" : "aprobado",
    fecha: (e && e.fecha) || "—",
    evaluador: (e && e.evaluador) || "—",
    observaciones: (e && e.observaciones) || "",
  };
}

async function manejarEscalafon(request, env, payload, recurso) {
  const config = ESCALAFON_CONFIG[recurso];
  if (!config) return json({ error: `Recurso "${recurso}" no reconocido` }, 400);

  if (request.method === "GET") {
    const { lista, ultimaActualizacion } = await cargarLista(env, config.kvKey, recurso);
    return json({ [recurso]: lista, ultimaActualizacion });
  }

  const { lista } = await cargarLista(env, config.kvKey, recurso);

  // ---- agregar intento: evalúa (aprobado/reprobado), actualiza el estado
  // actual y suma una entrada al historial de carrera.
  //
  // La evaluación SIEMPRE hace avanzar a la persona a la siguiente lista,
  // sea aprobada o reprobada, y se elimina de la lista en la que estaba. Si
  // todavía no existe un escalón siguiente armado (por ahora, Capitanes es
  // el techo: "mayores" no está construido), el registro se queda en esta
  // lista con el resultado actualizado — así el botón "Agregar Intento"
  // puede volver a usarse para reintentar. ----
  if (payload.agregarIntento && payload.agregarIntento.nombre) {
    const nombreLimpio = String(payload.agregarIntento.nombre).trim();
    const datos = limpiarIntentoEscalafon(nombreLimpio, payload.agregarIntento);
    const soloRegistrar = payload.agregarIntento.soloRegistrar === true;
    const siguienteRecurso = config.siguiente;

    const rangoEvaluado = soloRegistrar ? recurso : (siguienteRecurso || recurso);
    const transicion = `Evaluación de ${RANGO_LABEL[rangoEvaluado] || rangoEvaluado}`;

    const idx = lista.findIndex((p) => p.nombre.toLowerCase() === nombreLimpio.toLowerCase());
    const historialPrevio = idx !== -1 && Array.isArray(lista[idx].historial) ? lista[idx].historial : [];
    const intento = { fecha: datos.fecha, resultado: datos.resultado, evaluador: datos.evaluador, observaciones: datos.observaciones, transicion };
    const historialNuevo = [...historialPrevio, intento];

    const rangoActual = (idx !== -1 && lista[idx].rango) || RANGO_LABEL[recurso] || recurso;
    const personaActualizada = {
      nombre: datos.nombre,
      rango: rangoActual,
      resultado: datos.resultado,
      fecha: datos.fecha,
      evaluador: datos.evaluador,
      observaciones: datos.observaciones,
      historial: historialNuevo,
    };

    if (soloRegistrar) {
      if (idx !== -1) lista[idx] = personaActualizada; else lista.push(personaActualizada);
      const estado = await guardarLista(env, config.kvKey, recurso, lista);
      return json({ [recurso]: estado[recurso], ultimaActualizacion: estado.ultimaActualizacion });
    }

    const siguienteConfig = siguienteRecurso ? ESCALAFON_CONFIG[siguienteRecurso] : null;

    if (siguienteConfig) {
      if (idx !== -1) lista.splice(idx, 1);
      const estadoOrigen = await guardarLista(env, config.kvKey, recurso, lista);

      const { lista: listaDestino } = await cargarLista(env, siguienteConfig.kvKey, siguienteRecurso);
      const idxDestino = listaDestino.findIndex((p) => p.nombre.toLowerCase() === personaActualizada.nombre.toLowerCase());
      const registroDestino = {
        nombre: personaActualizada.nombre,
        rango: RANGO_LABEL[siguienteRecurso] || siguienteRecurso,
        resultado: personaActualizada.resultado,
        fecha: personaActualizada.fecha,
        evaluador: personaActualizada.evaluador,
        observaciones: personaActualizada.observaciones,
        historial: personaActualizada.historial,
      };
      if (idxDestino !== -1) listaDestino[idxDestino] = registroDestino; else listaDestino.push(registroDestino);
      await guardarLista(env, siguienteConfig.kvKey, siguienteRecurso, listaDestino);

      return json({ [recurso]: estadoOrigen[recurso], ultimaActualizacion: estadoOrigen.ultimaActualizacion });
    }

    if (idx === -1) lista.push(personaActualizada); else lista[idx] = personaActualizada;
    const estado = await guardarLista(env, config.kvKey, recurso, lista);
    return json({ [recurso]: estado[recurso], ultimaActualizacion: estado.ultimaActualizacion });
  }

  // ---- arreglar errores (admin: corrige a mano un registro existente) ----
  if (payload.arreglarErrores && payload.arreglarErrores.nombre) {
    const nombreLimpio = String(payload.arreglarErrores.nombre).trim();
    const idx = lista.findIndex((p) => p.nombre.toLowerCase() === nombreLimpio.toLowerCase());
    if (idx === -1) return json({ error: "No se encontró a esa persona en esta lista." }, 404);

    const datos = payload.arreglarErrores;
    const persona = lista[idx];
    if (datos.nombreNuevo) persona.nombre = String(datos.nombreNuevo).trim() || persona.nombre;
    if (datos.resultado !== undefined) {
      persona.resultado = datos.resultado === "reprobado" ? "reprobado" : (datos.resultado ? "aprobado" : null);
    }
    if (datos.fecha !== undefined) persona.fecha = datos.fecha || null;
    if (datos.evaluador !== undefined) persona.evaluador = datos.evaluador || null;
    if (datos.observaciones !== undefined) persona.observaciones = datos.observaciones || '';

    const estado = await guardarLista(env, config.kvKey, recurso, lista);
    return json({ [recurso]: estado[recurso], ultimaActualizacion: estado.ultimaActualizacion });
  }

  // ---- eliminar ----
  if (payload.eliminar && payload.eliminar.nombre) {
    const nombreLimpio = String(payload.eliminar.nombre).trim().toLowerCase();
    const idx = lista.findIndex((p) => p.nombre.toLowerCase() === nombreLimpio);
    if (idx !== -1) {
      lista.splice(idx, 1);
      const estado = await guardarLista(env, config.kvKey, recurso, lista);
      return json({ [recurso]: estado[recurso], ultimaActualizacion: estado.ultimaActualizacion });
    }
    const actual = await cargarLista(env, config.kvKey, recurso);
    return json({ [recurso]: actual.lista, ultimaActualizacion: actual.ultimaActualizacion });
  }

  return json({ error: "Acción de escalafón no reconocida" }, 400);
}

// ==================== listas de clases (Asistencias, Tenientes) ====================
// Cada persona: { nombre, rango, registros: [{tipo, fecha, turno, instructor, registrador}] }
//
// rango: se asigna solo/a (rangoDefault) cuando la persona recién aparece en
// esta lista, y NO se puede tocar desde acá — solo lo va a poder cambiar el
// futuro panel de administración.
//
// evaluarAscenso: evalúa a la persona para el rango SIGUIENTE.
//   - reprobado -> no pasa nada, se queda en esta lista (se puede
//     reintentar cuando se quiera, no se guarda un "intento" aparte).
//   - aprobado  -> se elimina de esta lista y se crea en la lista
//     siguiente, ya con el rango nuevo asignado.
const LISTAS_CLASES = {
  asistencias: {
    kvKey: KV_KEY_ASISTENCIAS,
    rangoDefault: "Uniformado",
    siguiente: { recurso: "tenientes", rango: "Tenientes", modelo: "clases" },
  },
  tenientes: {
    kvKey: "tenientes",
    rangoDefault: "Tenientes",
    siguiente: { recurso: "capitanes", rango: "Capitanes", modelo: "escalafon" },
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
  // permite renombrarla vía nombreNuevo. El rango NO se toca acá todavía
  // (va a ser editable desde el futuro panel de administración). ----
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
      persona = { nombre: nombreNuevo || nombreLimpio, rango: config.rangoDefault, registros: [] };
      lista.push(persona);
    }
    if (!persona.rango) persona.rango = config.rangoDefault;

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

  // ---- evaluarAscenso: evalúa para el rango siguiente ----
  if (payload.evaluarAscenso && payload.evaluarAscenso.nombre) {
    const nombreLimpio = String(payload.evaluarAscenso.nombre).trim();
    const aprobado = payload.evaluarAscenso.resultado === "aprobado";

    if (!aprobado) {
      // Reprobado: no se mueve nada, se queda en esta lista tal cual para
      // poder reintentar más adelante.
      return json({ [recurso]: lista, ultimaActualizacion });
    }

    const idx = lista.findIndex((p) => p.nombre.toLowerCase() === nombreLimpio.toLowerCase());
    if (idx === -1) return json({ error: "No se encontró a esa persona en esta lista." }, 404);
    const persona = lista[idx];

    const siguiente = config.siguiente;
    if (!siguiente) {
      return json({ error: "Todavía no está armado el siguiente rango." }, 400);
    }

    lista.splice(idx, 1);
    const estadoOrigen = await guardarLista(env, config.kvKey, recurso, lista);

    if (siguiente.modelo === "clases") {
      const siguienteConfig = LISTAS_CLASES[siguiente.recurso];
      const { lista: listaDestino } = await cargarLista(env, siguienteConfig.kvKey, siguiente.recurso);
      const yaEsta = listaDestino.find((p) => p.nombre.toLowerCase() === persona.nombre.toLowerCase());
      if (!yaEsta) {
        listaDestino.push({ nombre: persona.nombre, rango: siguiente.rango, registros: [] });
        await guardarLista(env, siguienteConfig.kvKey, siguiente.recurso, listaDestino);
      }
    } else if (siguiente.modelo === "escalafon") {
      const siguienteConfig = ESCALAFON_CONFIG[siguiente.recurso];
      const { lista: listaDestino } = await cargarLista(env, siguienteConfig.kvKey, siguiente.recurso);
      const yaEsta = listaDestino.find((p) => p.nombre.toLowerCase() === persona.nombre.toLowerCase());
      if (!yaEsta) {
        const transicion = `Evaluación de ${RANGO_LABEL[siguiente.recurso] || siguiente.recurso}`;
        listaDestino.push({
          nombre: persona.nombre,
          rango: siguiente.rango,
          resultado: "aprobado",
          fecha: payload.evaluarAscenso.fecha || "—",
          evaluador: payload.evaluarAscenso.evaluador || "—",
          observaciones: payload.evaluarAscenso.observaciones || "",
          historial: [{
            fecha: payload.evaluarAscenso.fecha || "—",
            resultado: "aprobado",
            evaluador: payload.evaluarAscenso.evaluador || "—",
            observaciones: payload.evaluarAscenso.observaciones || "",
            transicion,
          }],
        });
        await guardarLista(env, siguienteConfig.kvKey, siguiente.recurso, listaDestino);
      }
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
      persona = { nombre: nombreLimpio, rango: config.rangoDefault, registros: [] };
      lista.push(persona);
    }
    if (!persona.rango) persona.rango = config.rangoDefault;
    persona.registros.push(limpiarRegistro(entry));
  }

  const estado = await guardarLista(env, config.kvKey, recurso, lista);
  return json({ [recurso]: estado[recurso], ultimaActualizacion: estado.ultimaActualizacion });
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
        if (recurso === "evaluaciones") {
          return await manejarEvaluaciones(request, env, {});
        }
        if (recurso && LISTAS_CLASES[recurso]) {
          return await manejarListaClases(request, env, {}, recurso);
        }
        if (recurso && ESCALAFON_CONFIG[recurso]) {
          return await manejarEscalafon(request, env, {}, recurso);
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

        if (payload.recurso === "evaluaciones") {
          return await manejarEvaluaciones(request, env, payload);
        }
        if (payload.recurso && LISTAS_CLASES[payload.recurso]) {
          return await manejarListaClases(request, env, payload, payload.recurso);
        }
        if (payload.recurso && ESCALAFON_CONFIG[payload.recurso]) {
          return await manejarEscalafon(request, env, payload, payload.recurso);
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
