// ============================================================
// CÓDIGOS DE ACCESO — WSPD Laguna
// ============================================================
// Este es el ÚNICO lugar donde hay que editar los códigos: lo carga
// asistencias.html, tenientes.html, capitanes.html e index.html
// (las Macros de Instrucción), así que un cambio acá se aplica a los 4.
//
// rol tiene que ser exactamente uno de estos tres (en minúscula):
//   "instructor"    -> puede registrar asistencias
//   "evaluador"     -> además, puede evaluar (Tenientes/Capitanes) y
//                      registrar la clase de Procedimientos
//   "administrador" -> además, puede editar/eliminar registros y usar
//                      las funciones de alta manual
//
// Para agregar a alguien: sumá una línea nueva con su propio código
// (la clave del objeto), su nombre y su rol.
// Para sacar a alguien: borrá su línea entera.
// Los códigos tienen que ser únicos entre sí (no repetir la clave).
const CODIGOS = {
  "1203d": { nombre: "Drak Reem", rol: "administrador" },
  "5678l": { nombre: "Lilith Velarys", rol: "administrador" },
  "1231g": { nombre: "Goliat Crawley", rol: "instructor" },
  "1237c": { nombre: "Sr Chakalito", rol: "instructor" },
  "1236a": { nombre: "Axo Velasco", rol: "instructor" },
  "1232e": { nombre: "Eliel Martinez", rol: "instructor" },
  "1234m": { nombre: "Moises Medez", rol: "instructor" },
  "1238j": { nombre: "Jacobo Vargas", rol: "instructor" },
};

// No hace falta tocar nada de acá para abajo.
const NIVELES_ROL = { instructor: 1, evaluador: 2, administrador: 3 };
function rolAlcanza(rolActual, rolRequerido) {
  return (NIVELES_ROL[rolActual] || 0) >= (NIVELES_ROL[rolRequerido] || 99);
}
// Lista de todos los nombres (cualquier rol) - usada, por ejemplo, para
// elegir quién dictó una clase en asistencias.html.
const NOMBRES_TODOS = Object.values(CODIGOS).map(u => u.nombre);
// Nombres separados por rol — instructores (rol exactamente "instructor")
// y evaluadores (rol "evaluador" o "administrador", que también pueden
// evaluar). Se usan, por ejemplo, para dividir el desplegable de
// "Instructor" de asistencias.html en dos grupos, y para el select de
// "Evaluador" en tenientes.html / capitanes.html.
const NOMBRES_INSTRUCTORES = Object.values(CODIGOS)
  .filter(u => u.rol === 'instructor')
  .map(u => u.nombre);
const NOMBRES_EVALUADORES = Object.values(CODIGOS)
  .filter(u => rolAlcanza(u.rol, 'evaluador'))
  .map(u => u.nombre);
