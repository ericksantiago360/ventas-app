"""Alta de negocios: queda listo para operar sin tocar código."""
import uuid

from .conftest import datos, id_de, unico


def nuevo_id() -> str:
    return f"neg_{uuid.uuid4().hex[:8]}"


def test_alta_de_negocio_lista_para_operar(client, admin):
    negocio = nuevo_id()
    r = client.post("/api/negocios", headers=admin, json={
        "id": negocio, "nombre": "Ferretería Prueba", "tipo": "distribucion", "prefijo": "FER",
    })
    assert r.status_code == 201, r.text
    assert r.json() == {"id": negocio, "nombre": "Ferretería Prueba", "tipo": "distribucion",
                        "prefijo": "FER", "activo": True}
    N = {"negocio_id": negocio}

    # Aparece en la lista del administrador que lo creó
    assert negocio in {n["id"] for n in client.get("/api/negocios", headers=admin).json()}

    # Catálogo contable sembrado
    cuentas = datos(client.get("/api/contabilidad/cuentas", headers=admin, params=N).json())
    assert len(cuentas) >= 40

    # Cotizaciones y pedidos usan sus prefijos
    r = client.post("/api/cotizaciones/", headers=admin, json=N)
    assert r.status_code == 201, r.text
    assert r.json()["numero"].startswith("FER")
    r = client.post("/api/pedidos/", headers=admin, json={**N, "cliente_nombre": "X", "total": 0})
    assert r.status_code == 201, r.text

    # Y los módulos que reciben ?negocio_id= lo aceptan
    for url in ("/api/crm/clientes", "/api/inventario/stock", "/api/personal/empleados", "/api/finanzas/cuentas"):
        assert client.get(url, headers=admin, params=N).status_code == 200, url


def test_alta_solo_para_administradores(client, solo_santal):
    r = client.post("/api/negocios", headers=solo_santal, json={
        "id": nuevo_id(), "nombre": "No autorizado", "prefijo": "NOA",
    })
    assert r.status_code == 403


def test_negocio_nuevo_no_es_visible_para_otros_usuarios(client, admin, solo_santal):
    negocio = nuevo_id()
    assert client.post("/api/negocios", headers=admin, json={
        "id": negocio, "nombre": "Privado", "prefijo": "PRI",
    }).status_code == 201
    assert negocio not in {n["id"] for n in client.get("/api/negocios", headers=solo_santal).json()}
    r = client.get("/api/crm/clientes", headers=solo_santal, params={"negocio_id": negocio})
    assert r.status_code == 403


def test_alta_duplicada_e_invalida(client, admin):
    negocio = nuevo_id()
    datos_ok = {"id": negocio, "nombre": "Duplicado", "prefijo": "DUP"}
    assert client.post("/api/negocios", headers=admin, json=datos_ok).status_code == 201
    assert client.post("/api/negocios", headers=admin, json=datos_ok).status_code == 409
    # No se puede pisar un negocio sembrado
    assert client.post("/api/negocios", headers=admin, json={**datos_ok, "id": "santal"}).status_code == 409

    for invalido in (
        {"id": "Con Espacios"}, {"id": "ab"}, {"id": "1empieza_con_numero"},
        {"prefijo": "minusculas"}, {"prefijo": "X"}, {"nombre": ""}, {"tipo": "inventado"},
    ):
        r = client.post("/api/negocios", headers=admin, json={**datos_ok, "id": nuevo_id(), **invalido})
        assert r.status_code == 422, invalido


def crear_negocio(client, admin, **datos) -> str:
    negocio = nuevo_id()
    r = client.post("/api/negocios", headers=admin, json={"id": negocio, "nombre": "Editable", "prefijo": "EDI", **datos})
    assert r.status_code == 201, r.text
    return negocio


def crear_usuario(client, admin, **datos) -> dict:
    email = f"u_{uuid.uuid4().hex[:8]}@test.mx"
    r = client.post("/api/usuarios", headers=admin, json={
        "nombre": "Usuario", "email": email, "password": "secreta123", **datos,
    })
    assert r.status_code == 201, r.text
    r = client.post("/auth/login", data={"username": email, "password": "secreta123"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_editar_negocio(client, admin):
    negocio = crear_negocio(client, admin)
    r = client.put(f"/api/negocios/{negocio}", headers=admin, json={
        "nombre": "Renombrado", "tipo": "servicios", "prefijo": "REN",
    })
    assert r.status_code == 200, r.text
    assert r.json() == {"id": negocio, "nombre": "Renombrado", "tipo": "servicios", "prefijo": "REN", "activo": True}

    listado = {n["id"]: n for n in client.get("/api/negocios", headers=admin).json()}
    assert listado[negocio]["nombre"] == "Renombrado"
    # Los folios nuevos usan el prefijo nuevo
    r = client.post("/api/cotizaciones/", headers=admin, json={"negocio_id": negocio})
    assert r.json()["numero"].startswith("REN")

    for invalido in ({"prefijo": "minus"}, {"tipo": "inventado"}, {"nombre": "x"}):
        assert client.put(f"/api/negocios/{negocio}", headers=admin, json=invalido).status_code == 422, invalido


def test_desactivar_y_reactivar_conserva_datos(client, admin):
    negocio = crear_negocio(client, admin)
    N = {"negocio_id": negocio}
    r = client.post("/api/crm/clientes", headers=admin,
                    json={"empresa": unico("Cliente"), "telefono": "5550500", "canal_origen": "directo"})
    cliente = id_de(r.json())
    # La lista de clientes solo muestra los que tienen actividad en el negocio
    assert client.post("/api/cotizaciones/", headers=admin, json={**N, "cliente_id": cliente}).status_code == 201

    assert client.put(f"/api/negocios/{negocio}", headers=admin, json={"activo": False}).status_code == 200
    assert negocio not in {n["id"] for n in client.get("/api/negocios", headers=admin).json()}
    inactivos = {n["id"]: n for n in client.get("/api/negocios", headers=admin, params={"incluir_inactivos": True}).json()}
    assert inactivos[negocio]["activo"] is False

    assert client.put(f"/api/negocios/{negocio}", headers=admin, json={"activo": True}).status_code == 200
    assert negocio in {n["id"] for n in client.get("/api/negocios", headers=admin).json()}
    clientes = datos(client.get("/api/crm/clientes", headers=admin, params=N).json())
    assert cliente in {id_de(c) for c in clientes}


def test_editar_requiere_admin_con_acceso(client, admin, solo_santal):
    negocio = crear_negocio(client, admin)
    assert client.put(f"/api/negocios/{negocio}", headers=solo_santal, json={"nombre": "Hackeado"}).status_code == 403

    # Un administrador sin acceso a ese negocio tampoco
    admin_santal = crear_usuario(client, admin, rol="admin", negocios=["santal"])
    assert client.put(f"/api/negocios/{negocio}", headers=admin_santal, json={"nombre": "Hackeado"}).status_code == 403
    assert client.put("/api/negocios/no_existe", headers=admin, json={"nombre": "Nada"}).status_code == 403


def test_no_desactiva_su_unico_negocio_activo(client, admin):
    negocio = crear_negocio(client, admin)
    solo_uno = crear_usuario(client, admin, rol="admin", negocios=[negocio])
    r = client.put(f"/api/negocios/{negocio}", headers=solo_uno, json={"activo": False})
    assert r.status_code == 400
    # Sí puede editar otros datos
    assert client.put(f"/api/negocios/{negocio}", headers=solo_uno, json={"nombre": "Sigue Activo"}).status_code == 200


def test_inactivos_ocultos_para_no_administradores(client, admin):
    negocio = crear_negocio(client, admin)
    vendedor = crear_usuario(client, admin, rol="vendedor", negocios=[negocio, "santal"])
    assert client.put(f"/api/negocios/{negocio}", headers=admin, json={"activo": False}).status_code == 200
    r = client.get("/api/negocios", headers=vendedor, params={"incluir_inactivos": True})
    assert negocio not in {n["id"] for n in r.json()}


def test_datos_fiscales_se_guardan_y_se_consultan(client, admin):
    negocio = nuevo_id()
    assert client.post("/api/negocios", headers=admin, json={"id": negocio, "nombre": "Fiscal", "prefijo": "FIS"}).status_code == 201
    url = f"/api/negocios/{negocio}/datos-fiscales"

    # Sin configurar: la consulta responde, pero marca que falta
    antes = client.get(url, headers=admin).json()
    assert antes["configurado"] is False and antes["serie_factura"] == "F" and antes["uso_cfdi_default"] == "G03"

    r = client.put(url, headers=admin, json={
        "rfc": "SMA850101AB1", "nombre": "Santal Machinery SA de CV", "regimen_fiscal": "601",
        "codigo_postal": "44100", "serie_factura": "B", "uso_cfdi_default": "D01",
    })
    assert r.status_code == 200, r.text
    dato = r.json()
    assert dato["configurado"] is True
    assert dato["rfc"] == "SMA850101AB1"
    assert dato["nombre"] == "SANTAL MACHINERY SA DE CV"        # razón social en mayúsculas, sin normalizar de más
    assert dato["serie_factura"] == "B" and dato["uso_cfdi_default"] == "D01"
    assert client.get(url, headers=admin).json()["rfc"] == "SMA850101AB1"


def test_datos_fiscales_rechazan_regimen_que_no_aplica(client, admin):
    negocio = nuevo_id()
    assert client.post("/api/negocios", headers=admin, json={"id": negocio, "nombre": "Régimen", "prefijo": "REG"}).status_code == 201
    # RFC de persona moral (12 caracteres) con régimen de persona física
    r = client.put(f"/api/negocios/{negocio}/datos-fiscales", headers=admin, json={
        "rfc": "SMA850101AB1", "nombre": "Empresa", "regimen_fiscal": "612", "codigo_postal": "44100",
    })
    assert r.status_code == 422, r.text


def test_datos_fiscales_permisos(client, admin, solo_santal):
    negocio = nuevo_id()
    assert client.post("/api/negocios", headers=admin, json={"id": negocio, "nombre": "Permisos", "prefijo": "PER"}).status_code == 201
    cuerpo = {"rfc": "SMA850101AB1", "nombre": "Empresa", "regimen_fiscal": "601", "codigo_postal": "44100"}

    # Solo un administrador edita; alguien sin acceso al negocio no lo ve
    assert client.put(f"/api/negocios/{negocio}/datos-fiscales", headers=solo_santal, json=cuerpo).status_code == 403
    assert client.get(f"/api/negocios/{negocio}/datos-fiscales", headers=solo_santal).status_code == 403
