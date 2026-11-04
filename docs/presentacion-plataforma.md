---
marp: true
title: Plataforma de Gestión Multi-negocio
paginate: true
---

# Plataforma de Gestión Multi-negocio

**Laboratorio clínico, clínica, carta porte, ventas, finanzas y contabilidad en un solo sistema**

Diagnóstico Plus · Santal Machinery · Dulce Tentación · Bienes Raíces

Octubre 2026

---

## El problema

- Cada negocio opera con herramientas separadas: hojas de cálculo, libretas, sistemas sueltos
- La misma información se captura dos o tres veces (cliente → cotización → pedido → cobro → póliza)
- No hay una vista consolidada de cuánto se vendió, cuánto se cobró y cuánto falta por cobrar
- En el laboratorio y la clínica, los resultados, las recetas y los expedientes se arman a mano

> Notas: enfatizar el costo del retrabajo y del error humano en la doble captura.

---

## La solución

Una sola plataforma web que:

- **Atiende varios negocios** desde la misma cuenta, cambiando de negocio con un clic
- **Conecta toda la operación**: lo que se vende genera el cobro, el movimiento de dinero y la póliza contable
- **Se adapta al giro**: laboratorio y clínica con roles por negocio, carta porte para traslados y módulos comerciales
- **Genera documentos listos**: cotizaciones, reportes de resultados, recetas, facturas y cartas porte en PDF
- **Funciona en el celular**: se instala como app y se usa desde cualquier pantalla

---

## Mapa de módulos

| Laboratorio | Clínica | Comercial | Carta Porte | Administración | Análisis |
|---|---|---|---|---|---|
| Pacientes | Agenda | CRM | Cartas porte | Finanzas | Reportes |
| Resultados | Expedientes | Catálogo | Mi flota | Contabilidad | |
| **Portal del paciente** | Recetas | Cotizaciones | Operadores | Inventario | |
| | Farmacia | Pedidos | | **Personal y nómina** | |
| | Consentimientos | Facturación | | | |
| | | **Tienda en línea** | | | |

---

## Laboratorio clínico

**Pacientes**
- Expediente con datos generales, tipo de sangre, alergias y médico tratante
- Resumen por sexo, tipo de sangre y médicos que más refieren pacientes

**Órdenes y resultados**
- Plantillas de estudios con analitos y rangos de referencia por edad y sexo
- Captura de resultados con **señalamiento automático**: normal, alto, bajo, crítico
- **Resultados críticos** que avisan al médico hasta que los revisa
- Flujo de validación: pendiente → capturado → validado
- **Reporte PDF** con membrete del laboratorio, listo para entregar

---

## Resultados al paciente — *nuevo*

**Envío por correo**
- Los resultados validados se envían con el PDF adjunto y un enlace al portal
- Historial de envíos en cada orden

**Portal del paciente**
- El paciente consulta y descarga sus resultados desde el navegador, sin contraseña
- Acceso con enlace firmado que vence y se puede revocar desde la ficha del paciente

---

## Clínica — *nuevo*

**Expediente y consulta**
- Expediente clínico digital con folio, antecedentes, notas SOAP y archivos adjuntos
- Diseñado conforme a la NOM-004-SSA3-2012; una nota firmada ya no se modifica

**Agenda y recetas**
- Agenda médica con vista diaria y creación de citas
- Recetas digitales en PDF con página de verificación

**Farmacia y consentimientos**
- Existencias de farmacia con entradas, salidas y alertas
- Consentimientos informados con firma en pantalla

**Roles por negocio**
- Recepción, médico, laboratorista, farmacia y administrador de clínica, cada uno con sus permisos

---

## Ciclo comercial

1. **CRM**: oportunidades en el pipeline de cada negocio, con etapas configurables; en Bienes Raíces por tipo de lead (propietario, comprador o arrendatario). Los clientes son unificados entre negocios
2. **Catálogo**: productos y servicios con categorías, variantes, atributos, listas de precios e imagen por producto (JPG, PNG o WebP, hasta 5 MB)
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

## Tienda en línea — *nuevo*

- **Catálogo público** por negocio, en su propia dirección (`/tienda/{slug}`)
- **Dos modos**: catálogo con precio y pago por transferencia SPEI u OXXO, o propiedades para Bienes Raíces
- **Cotizaciones y solicitudes de contacto** sin pago: llegan al CRM como oportunidad en la primera etapa del pipeline
- **Imágenes de producto** que se suben desde Catálogo y se muestran en la tienda
- Consulta de orden por folio y correo
- Límite de solicitudes por IP en la API pública

> Notas: la tienda solo acepta transferencia SPEI y pago en OXXO, no tarjeta. El administrador marca el pago como recibido y después confirma la orden, lo que crea el pedido y descuenta el stock.

---

## Carta Porte 3.1 — *nuevo*

- **CFDI de traslado** con complemento Carta Porte 3.1: origen, destinos, mercancías, vehículo y operadores
- **Flota** con permisos SCT, seguros y remolques; **operadores** con su licencia
- **Asistente de cuatro pasos** que importa los artículos desde un pedido
- No se marca como lista una carta porte con seguros o licencias vencidos
- XML validado contra los esquemas oficiales del SAT, con catálogos oficiales

> Notas: el timbrado requiere CSD y un PAC; mientras tanto el PDF sale con la leyenda "SIN TIMBRE FISCAL".

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
- Cuentas de caja, banco y monedero con saldo en tiempo real, activables y desactivables
- Ingresos, egresos, cobros y métodos de pago
- Movimientos editables y eliminables; los que vienen de un cobro se anulan desde el cobro

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
- Cálculo fiscal de la nómina (ver siguiente lámina)

**Reportes**
- Indicadores clave, evolución mensual de ventas y productos más vendidos

---

## Nómina con cálculo fiscal 2026 — *nuevo*

- **Retención de ISR** con la tarifa del Art. 96 y el subsidio al empleo 2026
- **Cuota obrera del IMSS** por ramo, sobre el salario base de cotización (SBC) topado en 25 UMA
- **SBC integrado** con factor por antigüedad (aguinaldo, vacaciones y prima vacacional)
- **Prestaciones por negocio**: aguinaldo, prima y días extra de vacaciones; solo un administrador las modifica
- Sin deducciones para **salario mínimo** ni **honorarios**
- **Recálculo automático** de recibos pendientes al cambiar salario, contrato o prestaciones; los periodos cerrados y los recibos pagados no cambian

> Notas: las tablas 2026 (ISR, subsidio) deben cotejarse con el Anexo 8 de la RMF antes de usar los recibos de forma oficial.

---

## Tecnología

| Capa | Herramienta |
|---|---|
| Interfaz | React (Vite), instalable como app (PWA) |
| API | FastAPI (Python) |
| Base de datos | MongoDB |
| Documentos PDF | ReportLab · WeasyPrint |
| Despliegue | Docker Compose · Nginx (listo para Coolify) |
| Pruebas | pytest contra MongoDB real (572 pruebas automatizadas) |

- Acceso con usuario y contraseña (tokens JWT con expiración)
- Cada usuario solo ve los negocios que tiene asignados
- Rol de administrador para configuraciones sensibles, y roles de clínica por negocio
- Sitio público con landing y contacto directo por WhatsApp

---

## Estado actual

**En operación**
- Los módulos del mapa (21 pantallas), con integración pedido → cobro → contabilidad
- Clínica: expediente, agenda, recetas, farmacia y consentimientos
- Carta Porte 3.1: captura, flota, operadores y XML validado (sin timbrar)
- Facturación conectada con Finanzas
- Finanzas con alta, edición y baja de movimientos y cuentas
- Tienda en línea con imágenes de producto; las solicitudes llegan al CRM
- Envío de resultados por correo y portal del paciente
- Nómina con ISR, IMSS y SBC integrado
- App instalable y adaptada al celular
- Suite de pruebas automatizadas que se corre con un solo comando
- Catálogo contable listo en los cuatro negocios
- Alta y edición de negocios y usuarios desde la app, con acceso por negocio

**Pendiente de configurar**
- Diagnóstico Plus: dar de alta sus cuentas financieras (caja / banco)
- Timbrado de CFDI y Carta Porte: falta el CSD del negocio y el contrato con un PAC

---

## Siguientes pasos

1. **Timbrado CFDI 4.0 y Carta Porte** mediante un PAC (XML, UUID, cancelación ante el SAT)
2. Póliza de venta para facturas de laboratorio y manuales
3. Evitar cobros duplicados entre Pedidos y Facturación
4. Envío de facturas por correo al cliente
5. Timbrado de recibos de nómina (CFDI de nómina)

## Timbrado SAT: requisitos y configuración

**Antes de empezar, reúne:**
- **CSD del negocio** descargado del portal del SAT: archivo `.cer`, archivo `.key` y la contraseña de la llave
- **RFC y datos fiscales** del negocio, iguales a los del certificado (RFC, razón social, régimen, código postal)
- **Cuenta en SW Sapien** (PAC): primero el sandbox de pruebas, después producción

> Notas: el RFC del certificado debe coincidir con el del negocio; si no, la plataforma no lo acepta.

---

## Timbrado SAT: configurar el servidor

**1. Generar la clave de cifrado** (una sola vez):

```
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

**2. Agregar las variables al `.env`**, en la raíz del proyecto y en `backend/.env`:

```
CSD_MASTER_KEY=<la clave generada>
SW_URL=https://services.test.sw.com.mx
SW_USER=<correo de tu cuenta SW Sapien>
SW_PASSWORD=<contraseña de SW Sapien>
```

**3. Reiniciar el backend** para que tome los cambios: `docker compose up -d --build backend`

> Atención: guarda `CSD_MASTER_KEY` en un lugar seguro, aparte del servidor. Sin ella los CSD guardados no se pueden descifrar y hay que volver a subirlos.

---

## Timbrado SAT: cargar el CSD

1. Entra como **administrador** y ve a **Negocios**
2. Selecciona el negocio y pulsa **editar**
3. En **Certificado fiscal (CSD)**, sube el `.cer`, el `.key` y la contraseña
4. Pulsa **Subir CSD**: la pantalla muestra el número de certificado y la vigencia

**Estados del certificado**
- **CSD activo**: listo para timbrar
- **Vence pronto**: faltan menos de 30 días; sube el nuevo antes del vencimiento
- **CSD vencido** o **Sin CSD**: no se puede timbrar

> Notas: subir un CSD nuevo reemplaza al anterior, que queda archivado. **Revocar** deja al negocio sin CSD activo.

---

## Timbrar una factura

1. Ve a **Facturación**, abre la factura y pulsa **Emitir factura** si aún es borrador
2. Pulsa **Timbrar ante el SAT** y confirma
3. La factura muestra el **folio fiscal (UUID)** y el estado en el SAT
4. Descarga el **XML timbrado** o imprime el **PDF**, que ya trae el UUID y el código QR

**Antes de timbrar, revisa:**
- Solo se timbran facturas en **pesos (MXN)**
- Si el receptor no es público en general, debe tener nombre, código postal y régimen fiscal
- Por ahora **no se timbran facturas con descuento general**; usa descuentos por concepto

---

## Timbrar una carta porte

1. Crea la carta porte y completa sus datos (la carta se guarda como borrador)
2. Pulsa **Marcar como lista** cuando el vehículo, los operadores y las vigencias estén correctos
3. Pulsa **Timbrar ante el SAT** y confirma
4. Descarga el **XML timbrado** o imprime el **PDF** con el UUID y el QR

> Notas: una carta porte timbrada ya no se edita ni regresa a borrador. Si hay que corregirla, cancélala ante el SAT y crea una nueva.

---

## Cancelar ante el SAT

Pulsa **Cancelar ante el SAT** en la factura o carta porte timbrada y elige el motivo:

| Motivo | Cuándo aplica |
|---|---|
| **01** | Con relación: la sustituye otro CFDI; pide el UUID del que la reemplaza |
| **02** | Sin relación: hubo un error y no hay sustituto |
| **03** | No se llevó a cabo la operación |
| **04** | Operación nominativa relacionada con una factura global |

- Si el SAT confirma, el documento queda **cancelado**
- Si el SAT aún lo tiene **en proceso**, el documento sigue timbrado y muestra el estado pendiente; revisa de nuevo más tarde

---

## Timbrado SAT: pruebas antes de producción

1. Con `SW_URL` apuntando al **sandbox**, sube un CSD de prueba y timbra una factura y una carta porte
2. Comprueba cada UUID en el **verificador de CFDI del SAT**
3. Prueba la cancelación con motivo 02 y revisa que el estado cambie
4. Cuando todo funcione, cambia `SW_URL` a `https://services.sw.com.mx`, sube el **CSD real** del negocio y repite una prueba

> Notas: los timbres del sandbox tienen UUID real pero **no tienen validez fiscal**. Cambia a producción solo con el CSD real cargado.

---

## Timbrado SAT: si algo falla

| Mensaje | Qué revisar |
|---|---|
| No hay un CSD activo | Sube el CSD en Negocios o revisa que no esté revocado |
| La contraseña no abre la llave | Revisa la contraseña del `.key` |
| El certificado es del RFC… | El CSD es de otro contribuyente; usa el del negocio |
| El CSD venció | Sube un CSD vigente |
| No se pudo abrir el CSD del negocio | `CSD_MASTER_KEY` cambió o falta; restablece la clave original |
| El PAC no timbró el comprobante | El mensaje trae el código de SW Sapien; corrige el dato indicado |
| Faltan datos del receptor | Completa nombre, código postal y régimen de la factura |

---

# Gracias

**Una plataforma, todos los negocios, cero doble captura.**

¿Preguntas?
   