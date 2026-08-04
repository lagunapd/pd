// Worker de Cloudflare para guardar, compartidas entre todos, las listas de
// clases de cada rango: Asistencias (Uniformados), Tenientes, Capitanes,
// Mayores y Coroneles. Las cinco usan el mismo esquema (clases
// verde/amarillo, con Procedimientos obligatoria), pidiendo distinta
// cantidad de clases cada una. Al evaluar a alguien para el rango
// siguiente, si aprueba pasa de lista con el rango nuevo asignado; si
// reprueba, se queda donde está. En ambos casos queda una entrada en su
// historial de evaluaciones (de solo lectura, se ve desde
// evaluaciones.html).
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
// Aparte, "horarios" guarda la grilla de horarios de Academia que se ve en
// index.html (uno por turno: título, hora, ubicación, instructores/
// auxiliares/evaluadores y días), editable desde admin.html:
//   GET  /?recurso=horarios                                  -> { horarios: [...], ultimaActualizacion }
//   POST / { recurso:"horarios", accion:"guardar", codigoAdmin, horarios: [...] } -> reemplaza la grilla completa (solo admin)
//
// Recursos disponibles: "asistencias", "tenientes", "capitanes", "mayores", "coroneles".
// Mayores es el techo por ahora (no tiene rango siguiente configurado), así
// que ahí no existe la acción de evaluarAscenso en el cliente.

const KV_KEY_ASISTENCIAS = "asistencias";
const KV_KEY_EVALUACIONES = "evaluaciones"; // legacy, ya no lo usa nada activo
const KV_KEY_CODIGOS = "codigos_acceso";
const KV_KEY_HORARIOS = "horarios_academia";
const KV_KEY_ASISTENCIA_INSTRUCTORES = "asistencia_instructores";

// Semilla inicial de los horarios de Academia (la grilla que se ve en
// index.html). Solo se usa la primera vez, si todavía no hay nada guardado
// en el KV bajo KV_KEY_HORARIOS — es la migración de lo que antes estaba
// escrito a mano en el HTML. Después de esa primera vez el KV manda
// siempre, y todo se edita desde el panel de administración (admin.html).
const HORARIOS_SEED = [
  {
    id: "evaluaciones",
    titulo: "🎯 EVALUACIONES",
    destacado: true,
    diasLabel: "Lunes y Jueves",
    hora: "🚨 Por Definir",
    ubicacion: "Piso 2",
    mapa: "vestidores",
    personas: [
      { label: "Evaluador", nombre: "Lilith Nyx" },
      { label: "Evaluador", nombre: "Drak Reem" },
      { label: "Evaluador", nombre: "Goliath Crawley" },
    ],
    dias: [],
  },
  {
    id: "clase1",
    titulo: "🕔 PRIMERA CLASE",
    destacado: false,
    diasLabel: "",
    hora: "17:00 - 19:00",
    ubicacion: "Sala de Revista",
    mapa: "sala-revista",
    personas: [
      { label: "Instructor", nombre: "Moises Medez" },
      { label: "Auxiliar", nombre: "🚨 Por Definir" },
    ],
    dias: [
      { dia: "Martes", texto: "📜 Modulo A" },
      { dia: "Miercoles", texto: "💬 Modulo B" },
      { dia: "Viernes", texto: "⚖️ Modulo C" },
    ],
  },
  {
    id: "clase2",
    titulo: "🕗 SEGUNDA CLASE",
    destacado: false,
    diasLabel: "",
    hora: "20:00 - 22:00",
    ubicacion: "Sala de Revista",
    mapa: "sala-revista",
    personas: [
      { label: "Instructor", nombre: "Jacobo Vargas" },
      { label: "Auxiliar", nombre: "Eliel Crawley" },
    ],
    dias: [
      { dia: "Martes", texto: "💬 Modulo B" },
      { dia: "Miercoles", texto: "⚖️ Modulo C" },
      { dia: "Viernes", texto: "🛡️ Modulo D" },
    ],
  },
  {
    id: "clase3",
    titulo: "🕚 TERCERA CLASE",
    destacado: false,
    diasLabel: "",
    hora: "23:00 - 01:00",
    ubicacion: "Sala de Revista",
    mapa: "sala-revista",
    personas: [
      { label: "Instructor", nombre: "Goliat Crawley" },
      { label: "Auxiliar", nombre: "Axo Velasco" },
    ],
    dias: [
      { dia: "Martes", texto: "⚖️ Modulo C" },
      { dia: "Miercoles", texto: "🛡️ Modulo D" },
      { dia: "Viernes", texto: "📜 Modulo A" },
    ],
  },
  {
    id: "clase4",
    titulo: "🕑 CUARTA CLASE",
    destacado: false,
    diasLabel: "",
    hora: "02:00 - 04:00",
    ubicacion: "Sala de Revista",
    mapa: "sala-revista",
    personas: [
      { label: "Instructor", nombre: "Lilith Black" },
      { label: "Auxiliar", nombre: "Sr Chakalito" },
    ],
    dias: [
      { dia: "Martes", texto: "🛡️ Modulo D" },
      { dia: "Miercoles", texto: "📜 Modulo A" },
      { dia: "Viernes", texto: "💬 Modulo B" },
    ],
  },
];

// Semilla inicial: solo se usa la primera vez, si todavía no hay nada
// guardado en el KV bajo KV_KEY_CODIGOS. Después de esa primera vez, el KV
// manda siempre — esto ya no se vuelve a leer. Se puede seguir editando
// todo desde el panel de administración (admin.html).
const CODIGOS_SEED = {
  "1203d": { nombre: "Drak Reem", rol: "administrador" },
  "5678l": { nombre: "Lilith Velarys", rol: "administrador" },
  "1237c": { nombre: "Sr Chakalito", rol: "instructor" },
  "1236a": { nombre: "Axo Velasco", rol: "instructor" },
  "1235j": { nombre: "Joyce Blaxland", rol: "instructor" },
  "1234m": { nombre: "Moises Medez", rol: "instructor" },
  "1232e": { nombre: "Eliel Martinez", rol: "instructor" },
  "1231g": { nombre: "Goliat Crawley", rol: "instructor" },
};
// Mismo ranking que codigos.js (acá se necesita aparte porque el Worker no
// puede importar ese archivo). "instructor_prueba" queda por debajo de
// "instructor" a propósito (su único permiso, ver Macros de Instrucción, se
// chequea aparte en el cliente); "lider"/"sublider" quedan al mismo nivel
// que "administrador" (mismos permisos, pero categorías separadas — máximo
// 1 líder y 2 sublíderes, validado más abajo al guardar). "bodycams" y
// "lider_bodycams" NO están acá (son un permiso aparte, no un nivel — ver
// puedeRegistrarBodycams en codigos.js); "lider_bodycams" tiene el mismo
// permiso que "bodycams", pero como categoría separada tiene su propio
// tope de 1, igual que "lider".
const NIVELES_ROL = {
  instructor_prueba: 1,
  instructor: 2,
  evaluador: 3,
  administrador: 4,
  sublider: 4,
  lider: 4,
};
function rolAlcanza(rolActual, rolRequerido) {
  return (NIVELES_ROL[rolActual] || 0) >= (NIVELES_ROL[rolRequerido] || 99);
}

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

// Llamada de atención: cada una obliga a una clase (verde) extra antes de
// poder evaluar. Se muestran como ❗ en la columna de puntos verdes hasta
// que una clase real las "tapa" (ver puntosUtiles en el cliente).
function limpiarLlamada(l) {
  return {
    fecha: (l && l.fecha) || "—",
    motivo: (l && l.motivo) || "",
    registrador: (l && l.registrador) || "Desconocido",
  };
}

// BodyCam aprobada: usado (por ahora, en Tenientes/Capitanes para arriba)
// como requisito de evaluación junto con las clases de Procedimientos.
// "aprobador" ya no es un campo de texto libre: es siempre el dueño del
// código con el que se registra (mismo nombre que "registrador"), y
// "aprobadorRol" guarda su rol en ese momento — los manda el cliente ya
// resueltos, acá solo se limpian.
function limpiarBodycam(b) {
  return {
    fecha: (b && b.fecha) || "—",
    aprobador: (b && b.aprobador) || "—",
    aprobadorRol: (b && b.aprobadorRol) || "—",
    observaciones: (b && b.observaciones) || "",
    registrador: (b && b.registrador) || "Desconocido",
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

// ==================== códigos de acceso (en el KV, no en el repo) ====================
async function cargarCodigos(env) {
  const raw = await env.ASISTENCIAS_KV.get(KV_KEY_CODIGOS);
  if (!raw) return { ...CODIGOS_SEED };
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : { ...CODIGOS_SEED };
  } catch (e) {
    return { ...CODIGOS_SEED };
  }
}

async function guardarCodigos(env, codigos) {
  await env.ASISTENCIAS_KV.put(KV_KEY_CODIGOS, JSON.stringify(codigos));
}

function nombresDeCodigos(codigos) {
  const todos = Object.values(codigos).map((u) => u.nombre);
  const instructores = Object.values(codigos).filter((u) => u.rol === "instructor").map((u) => u.nombre);
  const instructoresPrueba = Object.values(codigos).filter((u) => u.rol === "instructor_prueba").map((u) => u.nombre);
  const evaluadores = Object.values(codigos).filter((u) => rolAlcanza(u.rol, "evaluador")).map((u) => u.nombre);
  const soloEvaluadores = Object.values(codigos).filter((u) => u.rol === "evaluador").map((u) => u.nombre);
  const lideres = Object.values(codigos).filter((u) => u.rol === "lider").map((u) => u.nombre);
  const sublideres = Object.values(codigos).filter((u) => u.rol === "sublider").map((u) => u.nombre);
  return { todos, instructores, instructoresPrueba, evaluadores, soloEvaluadores, lideres, sublideres };
}

// recurso "codigos": maneja el acceso (validar código) y el panel de
// administración (listar/guardar). Nunca le manda al cliente el mapa
// completo de códigos salvo que el código con el que pide sea de
// administrador (para eso está la acción "listar").
async function manejarCodigos(request, env, payload) {
  const codigos = await cargarCodigos(env);

  if (request.method === "GET" || payload.accion === "nombres") {
    // Público: solo nombres, sin códigos — para desplegables y el roster.
    return json(nombresDeCodigos(codigos));
  }

  if (payload.accion === "validar") {
    const codigo = String(payload.codigo || "").trim();
    const usuario = codigos[codigo];
    if (!usuario) return json({ error: "Código inválido." }, 401);
    return json({ nombre: usuario.nombre, rol: usuario.rol });
  }

  if (payload.accion === "listar") {
    const admin = codigos[String(payload.codigoAdmin || "").trim()];
    if (!admin || !rolAlcanza(admin.rol, "administrador")) {
      return json({ error: "Ese código no tiene permisos de administrador." }, 403);
    }
    return json({ codigos });
  }

  if (payload.accion === "guardar") {
    const admin = codigos[String(payload.codigoAdmin || "").trim()];
    if (!admin || !rolAlcanza(admin.rol, "administrador")) {
      return json({ error: "Ese código no tiene permisos de administrador." }, 403);
    }
    if (!payload.codigos || typeof payload.codigos !== "object" || Array.isArray(payload.codigos)) {
      return json({ error: "Formato de códigos inválido." }, 400);
    }
    for (const [cod, u] of Object.entries(payload.codigos)) {
      // "bodycams" y "lider_bodycams" son roles válidos aparte de la
      // escalera de NIVELES_ROL (no heredan ni son heredados por nadie —
      // ver comentario en codigos.js), así que hay que aceptarlos acá
      // explícitamente además de los que sí están en NIVELES_ROL.
      const rolValido = u && u.rol && (NIVELES_ROL[u.rol] || u.rol === "bodycams" || u.rol === "lider_bodycams");
      if (!cod || !u || !u.nombre || !rolValido) {
        return json({ error: `Entrada inválida para el código "${cod}".` }, 400);
      }
    }
    const entradas = Object.values(payload.codigos);
    const cantLideres = entradas.filter((u) => u.rol === "lider").length;
    const cantSublideres = entradas.filter((u) => u.rol === "sublider").length;
    const cantLideresBodycams = entradas.filter((u) => u.rol === "lider_bodycams").length;
    if (cantLideres > 1) {
      return json({ error: "Solo puede haber un líder — hay más de uno marcado." }, 400);
    }
    if (cantSublideres > 2) {
      return json({ error: "Solo puede haber hasta dos sublíderes — hay más de dos marcados." }, 400);
    }
    if (cantLideresBodycams > 1) {
      return json({ error: "Solo puede haber un líder de BodyCams — hay más de uno marcado." }, 400);
    }
    await guardarCodigos(env, payload.codigos);
    return json({ ok: true, codigos: payload.codigos });
  }

  return json({ error: "Acción de códigos no reconocida." }, 400);
}

// ==================== horarios de Academia (grilla que se ve en index.html) ====================
// Cada turno: {
//   id, titulo, destacado, diasLabel, hora, ubicacion, mapa,
//   personas: [{label, nombre}],   // Instructor/Auxiliar/Evaluador, en el orden que se muestran
//   dias: [{dia, texto}],          // desglose por día (ej. Martes: Modulo A), en el orden que se muestran
// }
// "diasLabel" es para el caso de un turno con un solo renglón de días en
// texto libre (ej. "Lunes y Jueves"), en vez del desglose día por día.
async function cargarHorarios(env) {
  const raw = await env.ASISTENCIAS_KV.get(KV_KEY_HORARIOS);
  if (!raw) return { horarios: HORARIOS_SEED, ultimaActualizacion: null };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.horarios)) {
      return { horarios: parsed.horarios, ultimaActualizacion: parsed.ultimaActualizacion || null };
    }
    return { horarios: HORARIOS_SEED, ultimaActualizacion: null };
  } catch (e) {
    return { horarios: HORARIOS_SEED, ultimaActualizacion: null };
  }
}

async function guardarHorarios(env, horarios) {
  const estado = { horarios, ultimaActualizacion: new Date().toISOString() };
  await env.ASISTENCIAS_KV.put(KV_KEY_HORARIOS, JSON.stringify(estado));
  return estado;
}

function limpiarPersonaHorario(p) {
  return {
    label: String((p && p.label) || "").trim() || "Instructor",
    nombre: String((p && p.nombre) || "").trim() || "🚨 Por Definir",
  };
}
function limpiarDiaHorario(d) {
  return {
    dia: String((d && d.dia) || "").trim(),
    texto: String((d && d.texto) || "").trim(),
  };
}
function limpiarTurnoHorario(t, i) {
  return {
    id: String((t && t.id) || "").trim() || `turno_${Date.now()}_${i}`,
    titulo: String((t && t.titulo) || "").trim() || "NUEVO TURNO",
    destacado: !!(t && t.destacado),
    diasLabel: String((t && t.diasLabel) || "").trim(),
    hora: String((t && t.hora) || "").trim() || "🚨 Por Definir",
    ubicacion: String((t && t.ubicacion) || "").trim(),
    mapa: String((t && t.mapa) || "").trim(),
    personas: Array.isArray(t && t.personas) ? t.personas.map(limpiarPersonaHorario) : [],
    dias: Array.isArray(t && t.dias) ? t.dias.map(limpiarDiaHorario) : [],
  };
}

async function manejarHorarios(request, env, payload) {
  if (request.method === "GET") {
    const { horarios, ultimaActualizacion } = await cargarHorarios(env);
    return json({ horarios, ultimaActualizacion });
  }

  if (payload.accion === "guardar") {
    const codigos = await cargarCodigos(env);
    const admin = codigos[String(payload.codigoAdmin || "").trim()];
    if (!admin || !rolAlcanza(admin.rol, "administrador")) {
      return json({ error: "Ese código no tiene permisos de administrador." }, 403);
    }
    if (!Array.isArray(payload.horarios)) {
      return json({ error: "Formato de horarios inválido." }, 400);
    }
    const limpio = payload.horarios.map((t, i) => limpiarTurnoHorario(t, i));
    const estado = await guardarHorarios(env, limpio);
    return json({ ok: true, horarios: estado.horarios, ultimaActualizacion: estado.ultimaActualizacion });
  }

  return json({ error: "Acción de horarios no reconocida." }, 400);
}

// ==================== asistencia de instructores ====================
// Registro aparte del sistema de "clases" de los cadetes: acá NO hay tipos
// (verde/amarillo) ni rangos ni ascensos — cada instructor tiene una lista
// de "registros" {fecha, turno, registrador}, uno por cada clase/turno en
// el que se lo marcó presente (puede haber varios el mismo día si dio más
// de una clase). Lo usa el panel de administración para llevar un pulso de
// quién está viniendo. El roster de nombres (quién puede aparecer acá) sale
// en vivo del recurso "codigos" (instructores + instructores a prueba) —
// este KV solo guarda los registros para los nombres que ya tuvieron al
// menos uno.
// Acepta también el formato viejo ({fechas: [...]} de puras fechas sueltas)
// y lo migra solo a registros con turno "—" y registrador "Desconocido",
// para no perder historial de antes de este cambio.
function limpiarAsistenciaInstructor(p) {
  const registrosCrudos = Array.isArray(p && p.registros)
    ? p.registros
    : Array.isArray(p && p.fechas)
      ? p.fechas.map((f) => ({ fecha: f, turno: "—", registrador: "Desconocido" }))
      : [];

  const vistos = new Set();
  const registros = [];
  for (const r of registrosCrudos) {
    const fecha = String((r && r.fecha) || "").trim();
    if (!fecha) continue;
    const turno = String((r && r.turno) || "").trim() || "—";
    const registrador = String((r && r.registrador) || "").trim() || "Desconocido";
    const key = fecha + "|||" + turno.toLowerCase();
    if (vistos.has(key)) continue;
    vistos.add(key);
    registros.push({ fecha, turno, registrador });
  }
  registros.sort((a, b) => (a.fecha + "|" + a.turno).localeCompare(b.fecha + "|" + b.turno));
  return { nombre: (p && p.nombre) || "", registros };
}

async function manejarAsistenciaInstructores(request, env, payload) {
  const cargaInicial = await cargarLista(env, KV_KEY_ASISTENCIA_INSTRUCTORES, "asistenciaInstructores");
  let lista = cargaInicial.lista.map(limpiarAsistenciaInstructor);
  let ultimaActualizacion = cargaInicial.ultimaActualizacion;

  if (request.method === "GET") {
    return json({ asistenciaInstructores: lista, ultimaActualizacion });
  }

  // agregar: registra uno o varios {nombre, fecha, turno} de una sola vez —
  // así se puede cargar, en un solo modal, la asistencia de varios
  // instructores a la vez y para varias clases/turnos del mismo día. Si a
  // alguno todavía no le había marcado ningún registro, se crea su entrada.
  // No duplica si esa persona ya tenía marcado ese mismo fecha+turno.
  if (payload.accion === "agregar") {
    const entries = Array.isArray(payload.entries)
      ? payload.entries
      : payload.nombre
        ? [{ nombre: payload.nombre, fecha: payload.fecha, turno: payload.turno }]
        : [];
    if (!entries.length) return json({ error: "Falta el nombre." }, 400);
    const registrador = String(payload.registrador || "Desconocido").trim() || "Desconocido";

    for (const entry of entries) {
      if (!entry || !entry.nombre) continue;
      const nombreLimpio = String(entry.nombre).trim();
      if (!nombreLimpio) continue;
      const fecha = String(entry.fecha || "").trim() || new Date().toISOString().slice(0, 10);
      const turno = String(entry.turno || "").trim() || "—";

      let persona = lista.find((p) => p.nombre.toLowerCase() === nombreLimpio.toLowerCase());
      if (!persona) {
        persona = { nombre: nombreLimpio, registros: [] };
        lista.push(persona);
      }
      const yaExiste = persona.registros.some(
        (r) => r.fecha === fecha && r.turno.toLowerCase() === turno.toLowerCase()
      );
      if (!yaExiste) {
        persona.registros.push({ fecha, turno, registrador });
        persona.registros.sort((a, b) => (a.fecha + "|" + a.turno).localeCompare(b.fecha + "|" + b.turno));
      }
    }

    const estado = await guardarLista(env, KV_KEY_ASISTENCIA_INSTRUCTORES, "asistenciaInstructores", lista);
    return json({ asistenciaInstructores: estado.asistenciaInstructores, ultimaActualizacion: estado.ultimaActualizacion });
  }

  // quitar: saca un registro puntual (fecha + turno), para corregir una
  // carga hecha por error, sin tocar el resto de los registros de esa
  // persona.
  if (payload.accion === "quitar" && payload.nombre && payload.fecha) {
    const nombreLimpio = String(payload.nombre).trim();
    const turno = String(payload.turno || "").trim() || "—";
    const persona = lista.find((p) => p.nombre.toLowerCase() === nombreLimpio.toLowerCase());
    if (persona) {
      persona.registros = persona.registros.filter(
        (r) => !(r.fecha === payload.fecha && r.turno.toLowerCase() === turno.toLowerCase())
      );
      const estado = await guardarLista(env, KV_KEY_ASISTENCIA_INSTRUCTORES, "asistenciaInstructores", lista);
      return json({ asistenciaInstructores: estado.asistenciaInstructores, ultimaActualizacion: estado.ultimaActualizacion });
    }
    return json({ asistenciaInstructores: lista, ultimaActualizacion });
  }

  return json({ error: "Acción de asistencia de instructores no reconocida." }, 400);
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

// ==================== listas de clases (Asistencias/Tenientes/Capitanes/Mayores/Coroneles) ====================
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
    siguiente: { recurso: "tenientes", rango: "Teniente" },
  },
  tenientes: {
    kvKey: "tenientes",
    rangoDefault: "Teniente",
    siguiente: { recurso: "capitanes", rango: "Capitán" },
  },
  capitanes: {
    kvKey: "capitanes",
    rangoDefault: "Capitán",
    siguiente: { recurso: "mayores", rango: "Mayor" },
  },
  mayores: {
    kvKey: "mayores",
    rangoDefault: "Mayor",
    siguiente: { recurso: "coroneles", rango: "Coronel" },
  },
  coroneles: {
    kvKey: "coroneles",
    rangoDefault: "Coronel",
    siguiente: null, // techo por ahora: acá no hay evaluarAscenso
  },
};

// Dado un nombre de rango ("Teniente", "Capitán", etc.), devuelve el
// recurso (lista) al que corresponde, o null si no matchea con ninguno de
// los rangoDefault configurados arriba (ej. un texto libre/custom).
function recursoParaRango(rangoNombre) {
  for (const [recurso, cfg] of Object.entries(LISTAS_CLASES)) {
    if (cfg.rangoDefault === rangoNombre) return recurso;
  }
  return null;
}

// Combina dos historiales de evaluaciones sin duplicar entradas idénticas
// (usado al fusionar a alguien con un registro que ya existía en la lista
// destino).
function combinarHistorial(a, b) {
  const combinado = [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])];
  const vistos = new Set();
  return combinado.filter((h) => {
    const clave = JSON.stringify([h.fecha, h.evaluador, h.resultado, h.rangoDesde, h.rangoHacia, h.observaciones]);
    if (vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  });
}

async function manejarListaClases(request, env, payload, recurso) {
  const config = LISTAS_CLASES[recurso];
  if (!config) return json({ error: `Recurso "${recurso}" no reconocido` }, 400);

  const cargaInicial = await cargarLista(env, config.kvKey, recurso);
  const lista = cargaInicial.lista;
  let ultimaActualizacion = cargaInicial.ultimaActualizacion;

  // ---- backfill: a quien le falte el rango, el array de llamadas o el de
  // bodycams (gente que ya estaba en la lista antes de que existieran esos
  // campos) se les completa una sola vez, y se guarda. ----
  let necesitaGuardar = false;
  for (const p of lista) {
    if (!p.rango) {
      p.rango = config.rangoDefault;
      necesitaGuardar = true;
    }
    if (!Array.isArray(p.llamadas)) {
      p.llamadas = [];
      necesitaGuardar = true;
    }
    if (!Array.isArray(p.bodycams)) {
      p.bodycams = [];
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
      persona = { nombre: nombreNuevo || nombreLimpio, rango: config.rangoDefault, registros: [], historialEvaluaciones: [], llamadas: [], bodycams: [] };
      lista.push(persona);
    }
    if (!persona.rango) persona.rango = config.rangoDefault;
    if (!Array.isArray(persona.historialEvaluaciones)) persona.historialEvaluaciones = [];
    if (!Array.isArray(persona.llamadas)) persona.llamadas = [];
    if (!Array.isArray(persona.bodycams)) persona.bodycams = [];
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

    // Llamadas de atención: solo se tocan si el pedido las incluye
    // explícitamente (para no borrarlas sin querer desde ediciones que no
    // las mandan).
    if (Array.isArray(payload.edit.llamadas)) {
      persona.llamadas = payload.edit.llamadas.map((l) => {
        const limpio = limpiarLlamada(l);
        if (!(l && l.registrador)) {
          limpio.registrador = `Registrada por ${registrador}`;
        }
        return limpio;
      });
    }

    // BodyCams: mismo criterio que las llamadas — solo se tocan si el
    // pedido las incluye explícitamente (se usan para poder borrar una
    // cargada por error desde el panel de administración).
    if (Array.isArray(payload.edit.bodycams)) {
      persona.bodycams = payload.edit.bodycams.map((b) => {
        const limpio = limpiarBodycam(b);
        if (!(b && b.registrador)) {
          limpio.registrador = `Registrada por ${registrador}`;
        }
        return limpio;
      });
    }


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
  // Si el rango nuevo corresponde a otra lista, la persona se MUEVE a esa
  // lista (igual que un ascenso por evaluación), pero:
  //   - sus clases/llamadas de la lista vieja se reinician (no viajan)
  //   - queda una entrada en su historialEvaluaciones con
  //     resultado:"manual", dejando registrado quién hizo el cambio
  //   - si ya existía alguien con ese nombre en la lista destino (ej. un
  //     rango anterior), se fusiona: se conservan sus clases/llamadas de
  //     esa lista y se combina el historial sin duplicar entradas.
  if (payload.cambiarRango && payload.cambiarRango.nombre) {
    const nombreLimpio = String(payload.cambiarRango.nombre).trim();
    const idx = lista.findIndex((p) => p.nombre.toLowerCase() === nombreLimpio.toLowerCase());
    if (idx === -1) return json({ error: "No se encontró a esa persona en esta lista." }, 404);
    const rangoNuevo = String(payload.cambiarRango.rangoNuevo || "").trim();
    if (!rangoNuevo) return json({ error: "Falta el rango nuevo." }, 400);
    const registrador = payload.cambiarRango.registrador || "Desconocido";

    const persona = lista[idx];
    const rangoAnterior = persona.rango || config.rangoDefault;
    const recursoDestino = recursoParaRango(rangoNuevo);

    // Rango nuevo sin lista propia conocida (texto libre), o misma lista
    // en la que ya está: solo se actualiza el texto del rango in situ,
    // sin mover a nadie ni tocar el historial.
    if (!recursoDestino || recursoDestino === recurso) {
      persona.rango = rangoNuevo;
      const estado = await guardarLista(env, config.kvKey, recurso, lista);
      return json({ [recurso]: estado[recurso], ultimaActualizacion: estado.ultimaActualizacion, movida: false });
    }

    if (!Array.isArray(persona.historialEvaluaciones)) persona.historialEvaluaciones = [];
    const entradaHistorial = {
      fecha: payload.cambiarRango.fecha || new Date().toISOString().slice(0, 10),
      evaluador: registrador,
      observaciones: payload.cambiarRango.observaciones || "Cambio de rango manual desde el panel de administración.",
      resultado: "manual",
      rangoDesde: rangoAnterior,
      rangoHacia: rangoNuevo,
    };
    const historialNuevo = [...persona.historialEvaluaciones, entradaHistorial];

    // Sacar a la persona de la lista actual (sus clases/llamadas de acá
    // se reinician, no viajan a la lista destino).
    lista.splice(idx, 1);
    const estadoOrigen = await guardarLista(env, config.kvKey, recurso, lista);

    const configDestino = LISTAS_CLASES[recursoDestino];
    const { lista: listaDestino } = await cargarLista(env, configDestino.kvKey, recursoDestino);
    const existente = listaDestino.find((p) => p.nombre.toLowerCase() === persona.nombre.toLowerCase());
    if (existente) {
      // Fusionar: se conservan las clases/llamadas que ya tenía en la
      // lista destino, y se combina el historial sin duplicar.
      existente.rango = rangoNuevo;
      existente.historialEvaluaciones = combinarHistorial(existente.historialEvaluaciones, historialNuevo);
    } else {
      listaDestino.push({
        nombre: persona.nombre,
        rango: rangoNuevo,
        registros: [],
        llamadas: [],
        bodycams: [],
        historialEvaluaciones: historialNuevo,
      });
    }
    await guardarLista(env, configDestino.kvKey, recursoDestino, listaDestino);

    return json({
      [recurso]: estadoOrigen[recurso],
      ultimaActualizacion: estadoOrigen.ultimaActualizacion,
      movida: true,
      recursoDestino,
    });
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
      // Techo del escalafón (Coronel): "aprobado" no mueve a nadie a
      // ningún lado porque no hay rango siguiente — se queda en esta
      // misma lista, pero marcado como aprobado (con el intento sumado
      // al historial, igual que un reprobado).
      persona.historialEvaluaciones = historialNuevo;
      persona.evaluacionAprobada = true;
      const estado = await guardarLista(env, config.kvKey, recurso, lista);
      return json({ [recurso]: estado[recurso], ultimaActualizacion: estado.ultimaActualizacion });
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
        llamadas: [],
        bodycams: [],
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
      persona = { nombre: nombreLimpio, rango: config.rangoDefault, registros: [], historialEvaluaciones: [], llamadas: [], bodycams: [] };
      lista.push(persona);
    }
    if (!persona.rango) persona.rango = config.rangoDefault;
    if (!Array.isArray(persona.historialEvaluaciones)) persona.historialEvaluaciones = [];
    if (!Array.isArray(persona.llamadas)) persona.llamadas = [];
    if (!Array.isArray(persona.bodycams)) persona.bodycams = [];
    persona.registros.push(limpiarRegistro(entry));
  }

  // ---- agregar bodycams aprobadas (mismo mecanismo que las clases, pero
  // con su propio array por persona) ----
  const bodycamEntries = Array.isArray(payload.bodycamEntries) ? payload.bodycamEntries : [];

  for (const entry of bodycamEntries) {
    if (!entry || !entry.nombre) continue;
    const nombreLimpio = String(entry.nombre).trim();
    if (!nombreLimpio) continue;

    let persona = lista.find(
      (p) => p.nombre.toLowerCase() === nombreLimpio.toLowerCase()
    );
    if (!persona) {
      persona = { nombre: nombreLimpio, rango: config.rangoDefault, registros: [], historialEvaluaciones: [], llamadas: [], bodycams: [] };
      lista.push(persona);
    }
    if (!persona.rango) persona.rango = config.rangoDefault;
    if (!Array.isArray(persona.historialEvaluaciones)) persona.historialEvaluaciones = [];
    if (!Array.isArray(persona.llamadas)) persona.llamadas = [];
    if (!Array.isArray(persona.bodycams)) persona.bodycams = [];
    persona.bodycams.push(limpiarBodycam(entry));
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
        if (recurso === "codigos") {
          return await manejarCodigos(request, env, {});
        }
        if (recurso === "horarios") {
          return await manejarHorarios(request, env, {});
        }
        if (recurso === "asistenciaInstructores") {
          return await manejarAsistenciaInstructores(request, env, {});
        }
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

        if (payload.recurso === "codigos") {
          return await manejarCodigos(request, env, payload);
        }
        if (payload.recurso === "horarios") {
          return await manejarHorarios(request, env, payload);
        }
        if (payload.recurso === "asistenciaInstructores") {
          return await manejarAsistenciaInstructores(request, env, payload);
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
