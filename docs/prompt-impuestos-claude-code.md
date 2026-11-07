Implementa el cálculo de impuestos mexicanos (IVA e IEPS 2026) en esta app Flask + SQLAlchemy de tienda en línea, y un seed de productos tipo tienda de conveniencia (estilo OXXO) para probarlo.

## Reglas fiscales
- Los precios se capturan CON impuestos incluidos. Hay que desglosar: base + IEPS + IVA = precio.
- El IEPS se calcula sobre la base; la base del IVA incluye el IEPS.
  Fórmula: precio = (base × (1 + tasa_IEPS) + cuota_IEPS) × (1 + tasa_IVA).
- Usa Decimal y redondeo ROUND_HALF_UP a centavos. El IVA absorbe el redondeo para que la suma cuadre exacto con el precio.
- IVA: 16% general, 8% región fronteriza (activable con la variable de entorno IVA_REGION_FRONTERIZA=1), 0% (alimentos básicos) y exento.
- El envío causa IVA general.

## Perfiles fiscales (catálogo editable en un solo archivo, app/taxes.py)
| clave | IVA | IEPS |
|---|---|---|
| general | 16% | — |
| iva_cero | 0% | — |
| exento | sin IVA | — |
| bebida_azucarada | 16% | cuota $3.0818 por litro |
| bebida_edulcorante | 16% | cuota $1.50 por litro |
| bebida_energizante | 16% | 25% |
| alta_densidad (botanas, dulces ≥275 kcal/100 g) | 16% | 8% |
| alcohol_14 (cerveza hasta 14° GL) | 16% | 26.5% |
| alcohol_20 (14° a 20° GL) | 16% | 30% |
| alcohol_mas_20 (más de 20° GL) | 16% | 53% |
| cigarros | 16% | 200% + cuota $0.8516 por cigarro |
| puros_mano | 16% | 32% |

Si la cuota es mayor que el precio, la base queda en 0 (nunca negativa).

## Cambios en el código
1. app/taxes.py: perfiles, función breakdown_line(precio_unitario, cantidad, perfil, unidades_por_pieza, frontera) y breakdown_order(items, envío, frontera) con subtotal, IEPS, IVA, total e IVA agrupado por tasa.
2. Modelo Product: tax_profile (default 'general'), ieps_units (litros por pieza o cigarros por cajetilla), sat_product_key (c_ClaveProdServ, 8 dígitos), sat_unit_key (c_ClaveUnidad, default 'H87') y un método tax_breakdown(cantidad).
3. Modelos Order y OrderItem: guardar subtotal (base), ieps_amount, iva_amount, shipping_cost; en cada partida también tax_profile, base_amount e iva_rate. El total del pedido debe incluir el envío ($99 si los productos suman menos de $499; mueve estos valores a config.py).
4. Como el proyecto no usa migraciones, agrega una función que, después de db.create_all(), haga ALTER TABLE para las columnas nuevas en bases SQLite existentes.
5. Carrito y checkout: un partial de plantilla con el desglose (productos, envío, subtotal antes de impuestos, IEPS, IVA por tasa, total).
6. Detalle de pedido (usuario y admin): mostrar subtotal, IEPS, IVA y envío.
7. Admin: campos fiscales en el formulario de producto (ProductForm y admin/product_form.html). Revisa que las rutas de admin rendericen una plantilla que exista.

## Seed
Agrega en app/models/seed.py una función idempotente (busca por SKU) que cree la categoría "Tienda de conveniencia" con subcategorías y unos 19 productos, al menos uno por perfil: leche, pan y huevo (iva_cero), agua (iva_cero), refresco 600 ml y 2 L (bebida_azucarada, 0.6 y 2 litros), refresco sin azúcar (bebida_edulcorante), energizante, papas, chocolate y galletas (alta_densidad), cerveza lata y six pack (alcohol_14), vino (alcohol_20), tequila (alcohol_mas_20), cigarros cajetilla de 20 (cigarros, 20 piezas), revista (exento), jabón y pañales (general). Llámala desde seed_database() y agrega un comando `flask seed`.

## Pruebas
Crea tests con unittest:
- 116 con IVA 16% → base 100, IVA 16. 108 en frontera → IVA 8.
- 125.28 con alta_densidad → base 100, IEPS 8, IVA 17.28.
- Refresco 600 ml a $20 → base 15.39, IEPS 1.85, IVA 2.76.
- Para todos los perfiles y varios precios, base + IEPS + IVA = total.
- Un checkout completo que guarde el desglose en el pedido, y que el seed no duplique productos.

Corre las pruebas, haz commit en una rama nueva y abre un pull request. Al final, avísame que las tasas son de 2026 y deben confirmarse con un contador.
