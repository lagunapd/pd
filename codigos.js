// ============================================================
// AYUDANTES DE ROL — WSPD Laguna
// ============================================================
// Los códigos de acceso y los nombres de instructores/evaluadores YA NO
// viven en este archivo: viven en el KV del Worker, y se administran
// desde admin.html (Panel de Administración). Cada página los pide en
// vivo (fetch al Worker) en vez de tenerlos escritos acá — así nadie que
// entre al repo de GitHub puede verlos.
//
// Lo único que se queda acá es la comparación de niveles de rol y los
// permisos de Noticias/BodyCams, que no son sensibles y los necesitan
// varias páginas.
//
// "instructor_prueba" queda por debajo de "instructor" a propósito: no
// alcanza el nivel de "instructor" en ningún chequeo (no puede registrar
// clases ni figura como instructor elegible) — su único permiso especial
// (ver las Macros de Instrucción) se chequea aparte, explícitamente, en
// index.html, no a través de este ranking.
//
// Estos tres viven organizativamente dentro de la división "Academia
// Policial" (ver PUESTOS_POR_DIVISION más abajo), pero esta escalera de
// niveles no cambia por eso: el nivel sale directo de acá, sin mirar la
// división del código (el parámetro divisionActual de rolAlcanza no
// afecta a estos tres, solo a "lider"/"sublider" — ver el comentario ahí).
const NIVELES_ROL = {
  instructor_prueba: 1,
  instructor: 2,
  evaluador: 3,
  administrador: 4,
};

// Divisiones (tienen que ser las mismas que DIVISIONES_NOTICIAS en el
// Worker). Cada una tiene su propia lista de puestos — ver
// PUESTOS_POR_DIVISION más abajo.
const DIVISIONES_ROL = [
  "Academia Policial",
  "División O.P.E.",
  "División SWAT",
  "Centro de Mando",
  "División de Reclutamiento",
  "BodyCams",
];

// Puestos válidos dentro de cada división — esto es lo que hace que en
// admin.html, después de elegir la división, el desplegable de rol solo
// muestre las opciones que corresponden a esa división. "lider" y
// "sublider" están en todas; el tercer puesto cambia según la división
// (líder de turno en SWAT/O.P.E./Centro de Mando, reclutador en
// Reclutamiento, supervisor en BodyCams). Academia Policial es la única
// que además tiene instructor a prueba/instructor/evaluador como puestos
// propios (son la escalera de instrucción — ver NIVELES_ROL arriba —
// pero organizativamente son parte de esta división).
const PUESTOS_POR_DIVISION = {
  "Academia Policial": [
    { valor: "lider", etiqueta: "líder" },
    { valor: "sublider", etiqueta: "sublíder" },
    { valor: "evaluador", etiqueta: "evaluador" },
    { valor: "instructor", etiqueta: "instructor" },
    { valor: "instructor_prueba", etiqueta: "instructor a prueba" },
  ],
  "División O.P.E.": [
    { valor: "lider", etiqueta: "líder" },
    { valor: "sublider", etiqueta: "sublíder" },
    { valor: "lider_de_turno", etiqueta: "líder de turno" },
  ],
  "División SWAT": [
    { valor: "lider", etiqueta: "líder" },
    { valor: "sublider", etiqueta: "sublíder" },
    { valor: "lider_de_turno", etiqueta: "líder de turno" },
  ],
  "Centro de Mando": [
    { valor: "lider", etiqueta: "líder" },
    { valor: "sublider", etiqueta: "sublíder" },
    { valor: "lider_de_turno", etiqueta: "líder de turno" },
  ],
  "División de Reclutamiento": [
    { valor: "lider", etiqueta: "líder" },
    { valor: "sublider", etiqueta: "sublíder" },
    { valor: "reclutador", etiqueta: "reclutador" },
  ],
  "BodyCams": [
    { valor: "lider", etiqueta: "líder" },
    { valor: "sublider", etiqueta: "sublíder" },
    { valor: "supervisor", etiqueta: "supervisor" },
  ],
};

// Roles "generales", sin división — solo quedan estos tres, porque
// instructor/instructor a prueba/evaluador ahora son puestos de la
// división Academia Policial (ver PUESTOS_POR_DIVISION arriba).
const ROLES_GENERALES = [
  { valor: "administrador", etiqueta: "administrador" },
  { valor: "federal_adjunto", etiqueta: "Federal Adjunto (Oficina de FG)" },
  { valor: "federal_general", etiqueta: "Federal General (Oficina de FG)" },
];

function puestosDeDivision(division) {
  return PUESTOS_POR_DIVISION[division] || [];
}

// La división "Academia Policial" es la única cuyo líder/sublíder
// hereda TODOS los permisos de administrador del sistema (editar listas,
// evaluar, manejar códigos, etc.). El resto de las divisiones NO: su
// líder/sublíder/tercer puesto solo tiene los permisos especiales de
// Noticias y/o BodyCams (ver más abajo), nada de lo demás.
const DIVISION_CON_LIDERAZGO_ADMIN = "Academia Policial";

// "lider"/"sublider" no son un nivel fijo: su nivel depende de en qué
// división estén — por eso rolAlcanza recibe un tercer parámetro
// opcional, divisionActual (el campo "division" que trae el código en
// el Worker).
//
// COMPATIBILIDAD TEMPORAL: si rolActual es "lider"/"sublider" y NO
// viene división (divisionActual vacío/undefined), es un código viejo,
// de antes de que existieran las divisiones — se lo sigue tratando como
// administrador de todo, para no dejar a nadie afuera del sistema de un
// día para el otro. Hay que entrar a admin.html con ese mismo código y
// reasignarlo a una división + puesto (lo más parecido a lo que tenía
// antes es "líder"/"sublíder" de Academia Policial); recién ahí el
// código tiene también el permiso especial de Noticias, porque
// puedeGestionarNoticiasEnDivision no puede darle un permiso "de su
// división" a un código que no tiene ninguna división asignada. Una vez
// que ya no queden códigos viejos sin división, esta salvedad se puede
// borrar.
function rolAlcanza(rolActual, rolRequerido, divisionActual) {
  let nivel = NIVELES_ROL[rolActual] || 0;
  if (rolActual === "lider" || rolActual === "sublider") {
    if (!divisionActual || divisionActual === DIVISION_CON_LIDERAZGO_ADMIN) {
      nivel = NIVELES_ROL.administrador;
    }
  }
  return nivel >= (NIVELES_ROL[rolRequerido] || 99);
}

// ==================== permisos de BodyCams ====================
// Cualquier puesto (líder, sublíder o supervisor) dentro de la división
// "BodyCams" puede registrar BodyCams — no hace falta ser líder para
// eso, todos los de esa división pueden. Los roles que ya llegan a
// "instructor" en la escalera de arriba (instructor, evaluador,
// administrador, y el liderazgo de Academia Policial) siguen pudiendo
// registrar BodyCams también, como siempre.
// COMPATIBILIDAD TEMPORAL: "bodycams"/"lider_bodycams" (roles viejos,
// de antes de que BodyCams fuera una división) se siguen reconociendo
// para no dejar afuera a un código que ya los tenía asignados — hay que
// reasignarlo a división "BodyCams" con el puesto que corresponda.
function puedeRegistrarBodycams(rol, division) {
  if (division === "BodyCams") return true;
  if (rol === "bodycams" || rol === "lider_bodycams") return true; // legacy
  return rolAlcanza(rol, "instructor", division);
}

// ==================== permisos de Noticias ====================
// Sistema de roles de Noticias (independiente de la escalera de arriba):
//   - "lider" / "sublider" (con una división asignada): publican y
//     borran SOLO en esa división. Sin límite de cuántos sublíderes
//     puede haber por división; líder, como máximo uno por división
//     (se valida en el Worker al guardar). Esto incluye a Academia
//     Policial: para Noticias también están limitados a su propia
//     división, aunque además tengan permisos de administrador para
//     todo lo demás (ver rolAlcanza arriba). El tercer puesto de cada
//     división (líder de turno, reclutador, supervisor) NO tiene
//     permiso de Noticias — solo es una categoría dentro de esa
//     división, sin ese permiso en particular.
//   - "federal_general" / "federal_adjunto" (Oficina de FG): publican y
//     borran en CUALQUIER división. No tienen ningún otro permiso extra
//     en el resto del sistema (no entran en NIVELES_ROL). Sin límite de
//     cuántos puede haber.
//   - "administrador": puede publicar y borrar en cualquier división,
//     como parte de sus permisos generales.
// "usuario" acá es el objeto { rol, division } que devuelve el Worker al
// validar un código.
function puedeGestionarNoticiasEnDivision(usuario, division) {
  if (!usuario || !usuario.rol) return false;
  if (usuario.rol === "administrador" || usuario.rol === "federal_general" || usuario.rol === "federal_adjunto") {
    return true;
  }
  if (usuario.rol === "lider" || usuario.rol === "sublider") {
    return !!usuario.division && usuario.division === division;
  }
  return false;
}

// Devuelve en qué divisiones puede publicar/borrar noticias este
// usuario, para llenar el selector de división del composer. "todas"
// como bandera especial en vez de listar las divisiones a mano, así no
// hay que tocar esta función si se agrega una división nueva.
function divisionesNoticiasPermitidas(usuario, todasLasDivisiones) {
  if (!usuario || !usuario.rol) return [];
  if (usuario.rol === "administrador" || usuario.rol === "federal_general" || usuario.rol === "federal_adjunto") {
    return todasLasDivisiones;
  }
  if ((usuario.rol === "lider" || usuario.rol === "sublider") && usuario.division) {
    return todasLasDivisiones.filter((d) => d === usuario.division);
  }
  return [];
}
