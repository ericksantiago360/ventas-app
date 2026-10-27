from .conftest import datos, id_de, unico

N = {"negocio_id": "santal"}


def _movimiento(client, admin, cuenta, importe=100, tipo="egreso", concepto="Gasto de prueba"):
    r = client.post("/api/finanzas/movimientos", headers=admin, json={
        **N, "cuenta_id": cuenta, "tipo": tipo, "categoria": "gasto",
        "importe": importe, "concepto": concepto,
    })
    assert r.status_code == 200, r.text
    return id_de(r.json())


def test_editar_movimiento_manual(client, admin, cuenta_santal):
    mov = _movimiento(client, admin, cuenta_santal)
    r = client.put(f"/api/finanzas/movimientos/{mov}", headers=admin,
                   json={"importe": 250, "concepto": "Gasto corregido", "tipo": "ingreso"})
    assert r.status_code == 200, r.text
    assert r.json()["importe"] == 250
    assert r.json()["concepto"] == "Gasto corregido"
    assert r.json()["tipo"] == "ingreso"


def test_editar_movimiento_con_importe_invalido(client, admin, cuenta_santal):
    mov = _movimiento(client, admin, cuenta_santal)
    r = client.put(f"/api/finanzas/movimientos/{mov}", headers=admin, json={"importe": 0})
    assert r.status_code == 422


def test_editar_movimiento_a_cuenta_inexistente(client, admin, cuenta_santal):
    mov = _movimiento(client, admin, cuenta_santal)
    r = client.put(f"/api/finanzas/movimientos/{mov}", headers=admin,
                   json={"cuenta_id": "000000000000000000000000"})
    assert r.status_code == 404


def test_eliminar_movimiento_manual(client, admin, cuenta_santal):
    mov = _movimiento(client, admin, cuenta_santal)
    assert client.delete(f"/api/finanzas/movimientos/{mov}", headers=admin).status_code == 200
    listado = datos(client.get("/api/finanzas/movimientos", headers=admin, params=N).json())
    assert all(m["id"] != mov for m in listado)


def test_movimiento_de_cobro_no_se_edita_ni_elimina(client, admin, cuenta_santal):
    cuenta_c = cuenta_santal
    r = client.post("/api/finanzas/cobros", headers=admin, json={
        **N, "cuenta_id": cuenta_c, "importe": 300, "metodo_pago": "transferencia", "concepto": "Cobro de prueba",
    })
    assert r.status_code == 200, r.text
    listado = datos(client.get("/api/finanzas/movimientos", headers=admin, params=N).json())
    mov = next(m["id"] for m in listado if m.get("referencia_tipo") == "cobro")

    r = client.put(f"/api/finanzas/movimientos/{mov}", headers=admin, json={"importe": 1})
    assert r.status_code == 409
    assert "anula el cobro" in r.json()["detail"].lower()
    assert client.delete(f"/api/finanzas/movimientos/{mov}", headers=admin).status_code == 409


def test_editar_cuenta_nombre_duplicado_409(client, admin, cuenta_santal):
    nombre = unico("Dup")
    assert client.post("/api/finanzas/cuentas", headers=admin, json={**N, "nombre": nombre}).status_code == 200
    r = client.put(f"/api/finanzas/cuentas/{cuenta_santal}", headers=admin, json={"nombre": nombre})
    assert r.status_code == 409


def test_editar_saldo_inicial_de_cuenta(client, admin, cuenta_santal):
    r = client.put(f"/api/finanzas/cuentas/{cuenta_santal}", headers=admin, json={"saldo_inicial": 1234})
    assert r.status_code == 200, r.text
    assert r.json()["saldo_inicial"] == 1234


def test_reactivar_cuenta_con_put(client, admin, cuenta_santal):
    client.delete(f"/api/finanzas/cuentas/{cuenta_santal}", headers=admin)
    r = client.put(f"/api/finanzas/cuentas/{cuenta_santal}", headers=admin, json={"activo": True})
    assert r.status_code == 200, r.text
    assert r.json()["activo"] is True
