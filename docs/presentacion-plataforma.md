---
marp: true
title: Plataforma de Gestión Multi-negocio
paginate: true
---

# Plataforma de Gestión Multi-negocio

**Laboratorio clínico, ventas, finanzas y contabilidad en un solo sistema**

Diagnóstico Plus · Santal Machinery · Dulce Tentación · Bienes Raíces

Octubre 2026

---

## El problema

- Cada negocio opera con herramientas separadas: hojas de cálculo, libretas, sistemas sueltos
- La misma información se captura dos o tres veces (cliente → cotización → pedido → cobro → póliza)
- No hay una vista consolidada de cuánto se vendió, cuánto se cobró y cuánto falta por cobrar
- En el laboratorio, los resultados y los reportes se arman a mano

> Notas: enfatizar el costo del retrabajo y del error humano en la doble captura.

---

## La solución

Una sola plataforma web que:

- **Atiende varios negocios** desde la misma cuenta, cambiando de negocio con un clic
- **Conecta toda la operación**: lo que se vende genera el cobro, el movimiento de dinero y la póliza contable
- **Se adapta al giro**: módulos de laboratorio clínico para Diagnóstico Plus y módulos comerciales para el resto
- **Genera documentos listos**: cotizaciones, reportes de resultados y facturas en PDF

---

## Mapa de módulos

| Laboratorio | Comercial | Administración | Análisis |
|---|---|---|---|
| Pacientes | CRM | Finanzas | Reportes |
| Resultados | Catálogo | Contabilidad | |
| | Cotizaciones | Inventario | |
| | Pedidos | Personal | |
| | **Facturación** | | |

---

## Laboratorio clínico

**Pacientes**
- Expediente con datos generales, tipo de sangre, alergias y médico tratante
- Resumen por sexo, tipo de sangre y médicos que más refieren pacientes

**Órdenes y resultados**
- Plantillas de estudios con analitos y rangos de referencia por sexo
- Captura de resultados con **señalamiento automático**: normal, alto, bajo, crítico
- Flujo de validación: pendiente → capturado → validado
- **Reporte PDF** con membrete del laboratorio, listo para entregar

---

## Ciclo comercial

1. **CRM**: prospectos por etapa (nuevo → contactado → calificado → cotización → ganado / perdido) y conversión a cliente
2. **Catálogo**: productos y servicios con categorías, variantes, atributos y listas de precios
3. **Cotizaciones**: plantillas PDF con la imagen de cada negocio
4. **Pedidos**: tablero Kanban (confirmado → en proceso → listo → entregado → cobrado), etapas internas de producción y registro de pagos

---

## Facturación ágil — *nuevo*

- **Facturar en un clic** los pedidos y las órdenes de laboratorio pendientes
- Datos del cliente o paciente y conceptos se copian del origen: sin recaptura
- Borradores editables, folios por serie, IVA por concepto (16 %, 8 %, exento)
- Pagos parciales con saldo y vencimientos; la factura pasa sola a *Pagada*
- PDF de la factura y tablero: facturado, cobrado, por cobrar y vencido
- Candado contra duplicados: un pedido u orden no se factura dos veces

> Notas: es facturación interna; el timbrado CFDI ante el SAT es una fase posterior.

---

## Todo conectado

```
Pedido ──► Póliza de venta (Clientes / Ventas / IVA)
   │
   ▼
Factura ──► Pago ──► Cobro en Finanzas ──► Ingreso en la cuenta (caja / banco)
                                     └──► Póliza de cobro (Bancos / Clientes)
```

- Un pago registrado en una factura **actualiza el saldo bancario** y la **contabilidad** sin capturar nada más
- Si un pago se elimina, el cobro, el movimiento y la póliza se cancelan juntos

---

## Finanzas y contabilidad

**Finanzas**
- Cuentas de caja, banco y monedero con saldo en tiempo real
- Ingresos, egresos, cobros y métodos de pago

**Contabilidad**
- Catálogo de cuentas, periodos contables y pólizas (manuales y automáticas)
- Reportes: **balanza de comprobación, estado de resultados y balance general**

---

## Inventario, personal y reportes

**Inventario**
- Existencias por producto y variante, entradas y salidas
- Control de mercancía en consignación

**Personal**
- Expediente de empleados, periodos de nómina, cálculo, cierre y recibos

**Reportes**
- Indicadores clave, evolución mensual de ventas y productos más vendidos

---

## Tecnología

| Capa | Herramienta |
|---|---|
| Interfaz | React (Vite) |
| API | FastAPI (Python) |
| Base de datos | MongoDB |
| Documentos PDF | ReportLab · WeasyPrint |
| Despliegue | Docker Compose · Nginx (listo para Coolify) |

- Acceso con usuario y contraseña (tokens JWT con expiración)
- Cada usuario solo ve los negocios que tiene asignados

---

## Estado actual

**En operación**
- Los 12 módulos del mapa, con integración pedido → cobro → contabilidad
- Facturación conectada con Finanzas

**Pendiente de configurar por negocio**
- Diagnóstico Plus: dar de alta cuentas financieras (caja / banco) y su catálogo contable

---

## Siguientes pasos

1. **Timbrado CFDI 4.0** mediante un PAC (XML, UUID, cancelación ante el SAT)
2. Póliza de venta para facturas de laboratorio y manuales
3. Evitar cobros duplicados entre Pedidos y Facturación
4. Envío de resultados y facturas por correo al paciente / cliente
5. Portal para que el paciente consulte sus resultados

---

# Gracias

**Una plataforma, todos los negocios, cero doble captura.**

¿Preguntas?
