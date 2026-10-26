# Pendientes

## E-commerce
- Aún crea clientes con `negocio_id` en la colección `clientes`.
- Reescribir cuando se haga la spec de e-commerce.

## /crm/leads → /crm/oportunidades
- frontend/src/pages/CRM.jsx
- frontend/src/api/client.js:77-95 (bloque `leads`; la línea 70 es `/clientes/{id}/estado`, no leads)
- backend/app/modules/ecommerce/services.py:325 (escribe en db.leads directamente)
Pendiente de migración coordinada con frontend.
