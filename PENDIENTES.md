# Pendientes

## E-commerce
- Aún crea clientes con `negocio_id` en la colección `clientes`.
- Reescribir cuando se haga la spec de e-commerce.

## /crm/leads → /crm/oportunidades
- frontend/src/pages/CRM.jsx
- frontend/src/api/client.js:77-95 (bloque `leads`; la línea 70 es `/clientes/{id}/estado`, no leads)
- backend/app/modules/ecommerce/services.py:325 (escribe en db.leads directamente)
Pendiente de migración coordinada con frontend.


## Mostrador (cerrado para v1; ver docs/specs/SPEC_MOSTRADOR.md)
Pendientes para v2, sin urgencia:
- Ticket impreso o PDF.
- Pago mixto (varios métodos en una venta).
- Devoluciones parciales (hoy solo cancelación total).
- Turnos de caja con apertura y cierre, y fondo inicial.
- Facturación (CFDI) directa desde el mostrador.
- Rol de cajero con cancelaciones restringidas al supervisor.
- Descuentos manuales por línea (hoy solo sobre la venta completa).
- Stock por sucursal (hoy el inventario es único por negocio).

Fuera del mostrador, detectado durante las pruebas:
- `tests/test_nomina.py::test_acceso_a_empleados_de_otro_negocio` espera que un vendedor dé de baja a sus empleados, pero `personal.py` exige rol admin (`require_admin`). Decidir cuál de los dos es la regla correcta.
