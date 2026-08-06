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
// permisos de Noticias, que no son sensibles y los necesitan varias
// páginas.
//
// "instructor_prueba" queda por debajo de "instructor" a propósito: no
// alcanza el nivel de "instructor" en ningún chequeo (no puede registrar
// clases ni figura como instructor elegible) — su único permiso especial
// (ver las Macros de Instrucción) se chequea aparte, explícitamente, en
// index.html, no a través de este ranking.
const NIVELES_ROL = {
  instructor_prueba: 1,
  instructor: 2,
  evaluador: 3,
  administrador: 4,
  // COMPATIBILIDAD TEMPORAL: "lider"/"sublider" (planos, sin división) son
  // los roles viejos, de antes de que existiera "líder/sublíder de
  // división". Se dejan acá SOLO para que un código que ya lo tenía
  // asignado no quede afuera del sistema (incluido admin.html) de un día
  // para el otro. Un administrador tiene que entrar a admin.html con ese
  // mismo código viejo y reasignarlo a "líder de división"/"sublíder de
  // división" (con su división) o a Federal General/Adjunto, según
  // corresponda — recién ahí el código tiene el permiso especial de
  // Noticias (puedeGestionarNoticiasEnDivision no reconoce "lider"/
  // "sublider" a secas, porque no tienen división asignada). Una vez que
  // ya no queden códigos viejos en uso, estas dos líneas se pueden borrar.
  lider: 4,
  sublider: 4,
};

// Divisiones válidas para "líder de división" / "sublíder de división"
// (tienen que ser las mismas que DIVISIONES_NOTICIAS en el Worker).
const DIVISIONES_ROL = [
  "Academia Policial",
  "División O.P.E.",
  "División SWAT",
  "Centro de Mando",
  "División de Reclutamiento",
];

// La división "Academia Policial" es la única cuyo líder/sublíder de
// división hereda TODOS los permisos de administrador del sistema
// (editar listas, evaluar, manejar códigos, etc.) — son la continuación
// directa de los viejos roles globales "líder"/"sublíder". El resto de
// las divisiones (O.P.E., SWAT, Centro de Mando, Reclutamiento) NO: su
// líder/sublíder de división solo tiene el permiso especial de Noticias
// en su propia división (ver puedeGestionarNoticiasEnDivision más abajo),
// nada de lo demás.
const DIVISION_CON_LIDERAZGO_ADMIN = "Academia Policial";

// "lider_division" y "sublider_division" no son un nivel fijo: su nivel
// depende de en qué división estén — por eso rolAlcanza ahora recibe un
// tercer parámetro opcional, divisionActual (el campo "division" que
// trae el código en el Worker). Para cualquier otro rol ese parámetro se
// ignora sin problema.
function rolAlcanza(rolActual, rolRequerido, divisionActual) {
  let nivel = NIVELES_ROL[rolActual] || 0;
  if (
    (rolActual === "lider_division" || rolActual === "sublider_division") &&
    divisionActual === DIVISION_CON_LIDERAZGO_ADMIN
  ) {
    nivel = NIVELES_ROL.administrador;
  }
  return nivel >= (NIVELES_ROL[rolRequerido] || 99);
}

// "bodycams" y "lider_bodycams" son roles aparte, fuera de la escalera de
// arriba a propósito: la división de BodyCams solo puede registrar
// BodyCams y generar su reporte — nada de clases, edición ni
// evaluaciones. No se agregan a NIVELES_ROL porque no son un nivel más
// (no heredan ni son heredados por nadie), son un permiso independiente.
// "lider_bodycams" tiene exactamente los mismos permisos que "bodycams"
// — la única diferencia es la categoría en Códigos de acceso (solo puede
// haber un líder de BodyCams — eso se valida en el Worker al guardar).
// Los roles que ya llegan a "instructor" (instructor, evaluador,
// administrador, y el liderazgo de la división Academia) siguen
// pudiendo registrar BodyCams también, como siempre — por eso acá
// también hace falta la división.
function puedeRegistrarBodycams(rol, division) {
  return rol === "bodycams" || rol === "lider_bodycams" || rolAlcanza(rol, "instructor", division);
}

// ==================== permisos de Noticias ====================
// Sistema de roles de Noticias (independiente de la escalera de arriba):
//   - "lider_division" / "sublider_division": publican y borran SOLO en
//     la división que tienen asignada (campo "division" del código). Sin
//     límite de cuántos puede haber por división. Esto incluye a los de
//     la división Academia Policial: para Noticias también están
//     limitados a su propia división, aunque además tengan permisos de
//     administrador para todo lo demás (ver rolAlcanza arriba).
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
  if (usuario.rol === "lider_division" || usuario.rol === "sublider_division") {
    return usuario.division === division;
  }
  return false;
}

// Devuelve en qué divisiones puede publicar/borrar noticias este
// usuario, para llenar el selector de división del composer. "todas"
// como bandera especial en vez de listar las 5 a mano, así no hay que
// tocar esta función si se agrega una división nueva.
function divisionesNoticiasPermitidas(usuario, todasLasDivisiones) {
  if (!usuario || !usuario.rol) return [];
  if (usuario.rol === "administrador" || usuario.rol === "federal_general" || usuario.rol === "federal_adjunto") {
    return todasLasDivisiones;
  }
  if ((usuario.rol === "lider_division" || usuario.rol === "sublider_division") && usuario.division) {
    return todasLasDivisiones.filter((d) => d === usuario.division);
  }
  return [];
}
