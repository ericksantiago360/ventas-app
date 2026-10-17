"""
Catálogo de cuentas contables base y periodo contable de un negocio.

Lo usan init_contabilidad.py (negocios sembrados) y el alta de negocios.
"""
import calendar
from datetime import date, datetime


CUENTAS_BASE = [
    # ========================================================
    # ACTIVO
    # ========================================================

    {
        "codigo": "1000",
        "nombre": "ACTIVO",
        "tipo": "activo",
        "subtipo": "principal",
        "naturaleza": "deudora",
        "nivel": 1,
        "padre": None,
    },
    {
        "codigo": "1100",
        "nombre": "Activo circulante",
        "tipo": "activo",
        "subtipo": "circulante",
        "naturaleza": "deudora",
        "nivel": 2,
        "padre": "1000",
    },
    {
        "codigo": "1110",
        "nombre": "Caja",
        "tipo": "activo",
        "subtipo": "circulante",
        "naturaleza": "deudora",
        "nivel": 3,
        "padre": "1100",
    },
    {
        "codigo": "1120",
        "nombre": "Bancos",
        "tipo": "activo",
        "subtipo": "circulante",
        "naturaleza": "deudora",
        "nivel": 3,
        "padre": "1100",
    },
    {
        "codigo": "1130",
        "nombre": "Clientes",
        "tipo": "activo",
        "subtipo": "circulante",
        "naturaleza": "deudora",
        "nivel": 3,
        "padre": "1100",
    },
    {
        "codigo": "1140",
        "nombre": "Inventarios",
        "tipo": "activo",
        "subtipo": "circulante",
        "naturaleza": "deudora",
        "nivel": 3,
        "padre": "1100",
    },
    {
        "codigo": "1150",
        "nombre": "Anticipos a proveedores",
        "tipo": "activo",
        "subtipo": "circulante",
        "naturaleza": "deudora",
        "nivel": 3,
        "padre": "1100",
    },

    {
        "codigo": "1200",
        "nombre": "Activo no circulante",
        "tipo": "activo",
        "subtipo": "no_circulante",
        "naturaleza": "deudora",
        "nivel": 2,
        "padre": "1000",
    },
    {
        "codigo": "1210",
        "nombre": "Maquinaria y equipo",
        "tipo": "activo",
        "subtipo": "no_circulante",
        "naturaleza": "deudora",
        "nivel": 3,
        "padre": "1200",
    },
    {
        "codigo": "1220",
        "nombre": "Herramientas",
        "tipo": "activo",
        "subtipo": "no_circulante",
        "naturaleza": "deudora",
        "nivel": 3,
        "padre": "1200",
    },
    {
        "codigo": "1230",
        "nombre": "Equipo de cómputo",
        "tipo": "activo",
        "subtipo": "no_circulante",
        "naturaleza": "deudora",
        "nivel": 3,
        "padre": "1200",
    },
    {
        "codigo": "1240",
        "nombre": "Depreciación acumulada",
        "tipo": "activo",
        "subtipo": "contra_activo",
        "naturaleza": "acreedora",
        "nivel": 3,
        "padre": "1200",
    },

    # ========================================================
    # PASIVO
    # ========================================================

    {
        "codigo": "2000",
        "nombre": "PASIVO",
        "tipo": "pasivo",
        "subtipo": "principal",
        "naturaleza": "acreedora",
        "nivel": 1,
        "padre": None,
    },
    {
        "codigo": "2100",
        "nombre": "Pasivo circulante",
        "tipo": "pasivo",
        "subtipo": "circulante",
        "naturaleza": "acreedora",
        "nivel": 2,
        "padre": "2000",
    },
    {
        "codigo": "2110",
        "nombre": "Proveedores",
        "tipo": "pasivo",
        "subtipo": "circulante",
        "naturaleza": "acreedora",
        "nivel": 3,
        "padre": "2100",
    },
    {
        "codigo": "2120",
        "nombre": "Acreedores diversos",
        "tipo": "pasivo",
        "subtipo": "circulante",
        "naturaleza": "acreedora",
        "nivel": 3,
        "padre": "2100",
    },
    {
        "codigo": "2130",
        "nombre": "Impuestos por pagar",
        "tipo": "pasivo",
        "subtipo": "circulante",
        "naturaleza": "acreedora",
        "nivel": 3,
        "padre": "2100",
    },
    {
        "codigo": "2140",
        "nombre": "Nómina por pagar",
        "tipo": "pasivo",
        "subtipo": "circulante",
        "naturaleza": "acreedora",
        "nivel": 3,
        "padre": "2100",
    },
    {
        "codigo": "2150",
        "nombre": "Anticipos de clientes",
        "tipo": "pasivo",
        "subtipo": "circulante",
        "naturaleza": "acreedora",
        "nivel": 3,
        "padre": "2100",
    },
    {
        "codigo": "2200",
        "nombre": "Pasivo no circulante",
        "tipo": "pasivo",
        "subtipo": "no_circulante",
        "naturaleza": "acreedora",
        "nivel": 2,
        "padre": "2000",
    },
    {
        "codigo": "2210",
        "nombre": "Créditos bancarios",
        "tipo": "pasivo",
        "subtipo": "no_circulante",
        "naturaleza": "acreedora",
        "nivel": 3,
        "padre": "2200",
    },

    # ========================================================
    # CAPITAL
    # ========================================================

    {
        "codigo": "3000",
        "nombre": "CAPITAL",
        "tipo": "capital",
        "subtipo": "principal",
        "naturaleza": "acreedora",
        "nivel": 1,
        "padre": None,
    },
    {
        "codigo": "3100",
        "nombre": "Capital social",
        "tipo": "capital",
        "subtipo": "capital",
        "naturaleza": "acreedora",
        "nivel": 2,
        "padre": "3000",
    },
    {
        "codigo": "3200",
        "nombre": "Aportaciones de socios",
        "tipo": "capital",
        "subtipo": "capital",
        "naturaleza": "acreedora",
        "nivel": 2,
        "padre": "3000",
    },
    {
        "codigo": "3300",
        "nombre": "Utilidades acumuladas",
        "tipo": "capital",
        "subtipo": "resultados_acumulados",
        "naturaleza": "acreedora",
        "nivel": 2,
        "padre": "3000",
    },
    {
        "codigo": "3400",
        "nombre": "Resultado del ejercicio",
        "tipo": "capital",
        "subtipo": "resultado",
        "naturaleza": "acreedora",
        "nivel": 2,
        "padre": "3000",
    },

    # ========================================================
    # INGRESOS
    # ========================================================

    {
        "codigo": "4000",
        "nombre": "INGRESOS",
        "tipo": "ingreso",
        "subtipo": "principal",
        "naturaleza": "acreedora",
        "nivel": 1,
        "padre": None,
    },
    {
        "codigo": "4100",
        "nombre": "Ventas",
        "tipo": "ingreso",
        "subtipo": "ventas",
        "naturaleza": "acreedora",
        "nivel": 2,
        "padre": "4000",
    },
    {
        "codigo": "4200",
        "nombre": "Servicios",
        "tipo": "ingreso",
        "subtipo": "servicios",
        "naturaleza": "acreedora",
        "nivel": 2,
        "padre": "4000",
    },
    {
        "codigo": "4300",
        "nombre": "Otros ingresos",
        "tipo": "ingreso",
        "subtipo": "otros",
        "naturaleza": "acreedora",
        "nivel": 2,
        "padre": "4000",
    },

    # ========================================================
    # COSTOS
    # ========================================================

    {
        "codigo": "5000",
        "nombre": "COSTOS",
        "tipo": "costo",
        "subtipo": "principal",
        "naturaleza": "deudora",
        "nivel": 1,
        "padre": None,
    },
    {
        "codigo": "5100",
        "nombre": "Costo de ventas",
        "tipo": "costo",
        "subtipo": "ventas",
        "naturaleza": "deudora",
        "nivel": 2,
        "padre": "5000",
    },
    {
        "codigo": "5200",
        "nombre": "Costo de fabricación",
        "tipo": "costo",
        "subtipo": "fabricacion",
        "naturaleza": "deudora",
        "nivel": 2,
        "padre": "5000",
    },
    {
        "codigo": "5300",
        "nombre": "Costo de servicios",
        "tipo": "costo",
        "subtipo": "servicios",
        "naturaleza": "deudora",
        "nivel": 2,
        "padre": "5000",
    },

    # ========================================================
    # GASTOS
    # ========================================================

    {
        "codigo": "6000",
        "nombre": "GASTOS",
        "tipo": "gasto",
        "subtipo": "principal",
        "naturaleza": "deudora",
        "nivel": 1,
        "padre": None,
    },
    {
        "codigo": "6100",
        "nombre": "Gastos administrativos",
        "tipo": "gasto",
        "subtipo": "administrativo",
        "naturaleza": "deudora",
        "nivel": 2,
        "padre": "6000",
    },
    {
        "codigo": "6200",
        "nombre": "Gastos de venta",
        "tipo": "gasto",
        "subtipo": "ventas",
        "naturaleza": "deudora",
        "nivel": 2,
        "padre": "6000",
    },
    {
        "codigo": "6300",
        "nombre": "Gastos financieros",
        "tipo": "gasto",
        "subtipo": "financiero",
        "naturaleza": "deudora",
        "nivel": 2,
        "padre": "6000",
    },
    {
        "codigo": "6400",
        "nombre": "Nómina",
        "tipo": "gasto",
        "subtipo": "nomina",
        "naturaleza": "deudora",
        "nivel": 2,
        "padre": "6000",
    },
    {
        "codigo": "6500",
        "nombre": "Renta",
        "tipo": "gasto",
        "subtipo": "operativo",
        "naturaleza": "deudora",
        "nivel": 2,
        "padre": "6000",
    },
    {
        "codigo": "6600",
        "nombre": "Servicios",
        "tipo": "gasto",
        "subtipo": "operativo",
        "naturaleza": "deudora",
        "nivel": 2,
        "padre": "6000",
    },
    {
        "codigo": "6700",
        "nombre": "Depreciación",
        "tipo": "gasto",
        "subtipo": "depreciacion",
        "naturaleza": "deudora",
        "nivel": 2,
        "padre": "6000",
    },
    {
        "codigo": "6800",
        "nombre": "Otros gastos",
        "tipo": "gasto",
        "subtipo": "otros",
        "naturaleza": "deudora",
        "nivel": 2,
        "padre": "6000",
    },
]


async def sembrar_catalogo_cuentas(db, negocio_id: str) -> tuple[int, int]:
    """Crea las cuentas base que falten en el negocio. Devuelve (creadas, existentes)."""
    creadas = existentes = 0
    for base in CUENTAS_BASE:
        cuenta = {
            **base,
            "negocio_id": negocio_id,
            "activo": True,
            "sistema": True,
            "descripcion": "",
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }
        resultado = await db.catalogo_cuentas.update_one(
            {"negocio_id": negocio_id, "codigo": base["codigo"]},
            {"$setOnInsert": cuenta},
            upsert=True,
        )
        if resultado.upserted_id:
            creadas += 1
        else:
            existentes += 1
    return creadas, existentes


async def abrir_periodo(db, negocio_id: str, periodo: str, fecha_inicio: str, fecha_fin: str) -> bool:
    """Abre el periodo contable si no existe. Devuelve True si lo creó."""
    if await db.periodos_contables.find_one({"negocio_id": negocio_id, "periodo": periodo}):
        return False
    await db.periodos_contables.insert_one({
        "negocio_id": negocio_id,
        "periodo": periodo,
        "fecha_inicio": fecha_inicio,
        "fecha_fin": fecha_fin,
        "estado": "abierto",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    })
    return True


async def abrir_periodo_actual(db, negocio_id: str) -> tuple[str, bool]:
    """Abre el periodo del mes en curso si no existe. Devuelve (periodo, creado)."""
    hoy = date.today()
    ultimo_dia = calendar.monthrange(hoy.year, hoy.month)[1]
    periodo = hoy.strftime("%Y-%m")
    creado = await abrir_periodo(
        db, negocio_id, periodo, hoy.replace(day=1).isoformat(), hoy.replace(day=ultimo_dia).isoformat(),
    )
    return periodo, creado
