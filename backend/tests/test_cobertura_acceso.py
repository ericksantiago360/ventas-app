"""
Guardia: todo endpoint de app/routers y app/modules/*/routes debe verificar el acceso al negocio.

Revisa el código (AST), no la app en ejecución. Un endpoint cumple si llama a
verificar_acceso u obtener_del_negocio, depende de negocio_autorizado, o llama a
un helper de su mismo módulo que a su vez lo haga (por ejemplo, obtener_pedido).

Si esta prueba falla al agregar un endpoint, agrégale la verificación. Solo si
de verdad no maneja datos de un negocio, súmalo a SIN_NEGOCIO con el motivo.
"""
import ast
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"
ROUTERS = sorted([*(APP / "routers").glob("*.py"), *(APP / "modules").glob("*/routes/*.py")])
VERIFICADORES = {"verificar_acceso", "obtener_del_negocio", "negocio_autorizado"}
METODOS = {"get", "post", "put", "patch", "delete"}

# (archivo, función): motivo
SIN_NEGOCIO = {
    ("auth.py", "login"): "inicio de sesión, aún no hay usuario",
    ("auth.py", "me"): "datos del propio usuario",
    ("lab.py", "estado_correo"): "solo dice si el SMTP del servidor está configurado",
    ("negocios.py", "listar_negocios"): "solo lista los negocios del propio usuario",
    ("negocios.py", "crear_negocio"): "alta de un negocio nuevo; solo administradores (require_admin)",
    ("usuarios.py", "listar_usuarios"): "solo admin; filtra por los negocios del administrador (visible_para)",
    ("usuarios.py", "crear_usuario"): "solo admin; validar_negocios limita a los negocios del administrador",
    ("usuarios.py", "actualizar_usuario"): "solo admin; visible_para y validar_negocios limitan el alcance",
    ("recetas.py", "obtener_perfil_medico"): "perfil médico del propio usuario",
    ("recetas.py", "actualizar_perfil_medico"): "perfil médico del propio usuario",
    ("recetas.py", "verificar_receta"): "pública para farmacias: se busca por el UUID impreso en el QR",
    ("portal.py", "solicitar_acceso"): "portal del paciente: acceso por enlace firmado",
    ("portal.py", "mis_datos"): "portal del paciente: solo sus propios datos",
    ("portal.py", "mis_ordenes"): "portal del paciente: solo sus propias órdenes",
    ("portal.py", "detalle_orden"): "portal del paciente: _orden_del_paciente valida que sea suya",
    ("portal.py", "pdf_orden"): "portal del paciente: _orden_del_paciente valida que sea suya",
}


def _nombres_llamados(nodo) -> set[str]:
    """Funciones llamadas dentro del nodo, incluidas las de Depends(...)."""
    nombres = set()
    for c in ast.walk(nodo):
        if isinstance(c, ast.Call) and isinstance(c.func, ast.Name):
            nombres.add(c.func.id)
            if c.func.id == "Depends":
                nombres |= {a.id for a in c.args if isinstance(a, ast.Name)}
    return nombres


def _endpoints_sin_verificacion():
    faltantes = []
    for archivo in ROUTERS:
        arbol = ast.parse(archivo.read_text())
        funciones = {
            n.name: n for n in arbol.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
        }
        # Helpers del módulo que verifican, directa o indirectamente
        verifican = set(VERIFICADORES)
        while True:
            nuevos = {
                nombre for nombre, f in funciones.items()
                if nombre not in verifican and _nombres_llamados(f) & verifican
            }
            if not nuevos:
                break
            verifican |= nuevos

        for nombre, f in funciones.items():
            rutas = [
                d for d in f.decorator_list
                if isinstance(d, ast.Call) and getattr(d.func, "attr", "") in METODOS
            ]
            if not rutas or (archivo.name, nombre) in SIN_NEGOCIO:
                continue
            if not _nombres_llamados(f) & verifican:
                ruta = rutas[0].args[0].value if rutas[0].args else "?"
                faltantes.append(f"{archivo.name}: {rutas[0].func.attr.upper()} {ruta} ({nombre})")
    return faltantes


def test_todos_los_endpoints_verifican_el_negocio():
    faltantes = _endpoints_sin_verificacion()
    assert not faltantes, "Endpoints sin verificación de acceso al negocio:\n" + "\n".join(faltantes)


def test_excepciones_siguen_existiendo():
    # Una excepción de una función que ya no existe es ruido: hay que quitarla
    existentes = set()
    for archivo in ROUTERS:
        for n in ast.parse(archivo.read_text()).body:
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
                existentes.add((archivo.name, n.name))
    assert set(SIN_NEGOCIO) <= existentes, set(SIN_NEGOCIO) - existentes
