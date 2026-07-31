// ============================================================
// AYUDANTES DE ROL — WSPD Laguna
// ============================================================
// Los códigos de acceso y los nombres de instructores/evaluadores YA NO
// viven en este archivo: viven en el KV del Worker, y se administran
// desde admin.html (Panel de Administración). Cada página los pide en
// vivo (fetch al Worker) en vez de tenerlos escritos acá — así nadie que
// entre al repo de GitHub puede verlos.
//
// Lo único que se queda acá es la comparación de niveles de rol, que no
// es sensible y la necesitan todas las páginas.
//
// "instructor_prueba" queda por debajo de "instructor" a propósito: no
// alcanza el nivel de "instructor" en ningún chequeo (no puede registrar
// clases ni figura como instructor elegible) — su único permiso especial
// (ver las Macros de Instrucción) se chequea aparte, explícitamente, en
// index.html, no a través de este ranking.
// "lider" y "sublider" quedan al mismo nivel que "administrador": tienen
// los mismos permisos, pero son categorías separadas en Códigos de acceso
// (solo puede haber un líder y dos sublíderes — eso se valida en el
// Worker al guardar).
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
