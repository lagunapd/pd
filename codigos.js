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
const NIVELES_ROL = { instructor: 1, evaluador: 2, administrador: 3 };
function rolAlcanza(rolActual, rolRequerido) {
  return (NIVELES_ROL[rolActual] || 0) >= (NIVELES_ROL[rolRequerido] || 99);
}
