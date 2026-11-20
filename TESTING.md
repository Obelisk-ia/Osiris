# Guía completa de pruebas y simulación · Osiris

Este documento explica paso a paso cómo levantar **Osiris** y simular todos los flujos del restaurante de punta a punta: desde que el **Dueño** crea el restaurante, carga inventario, arma el menú por áreas y coloca las mesas con sus **códigos QR**, hasta la operación en vivo entre **Comensal (QR)**, **Mesero**, **Cocina / Barra / Coctelería / Cafetería** y **Caja**.

---

## 1. Levantar el entorno o correr las pruebas automatizadas

### Pruebas automatizadas (Vitest + Convex Test)

Para validar toda la lógica de negocio (45 pruebas en 9 suites: autenticación, restaurante, plano de mesas, dueño/admin, inventario/preparación, mesero, cocina por áreas, caja y comensal QR):

```sh
pnpm test
pnpm typecheck
pnpm lint
```

### Prueba de fotos del menú en Chromium (Playwright)

Con `.env.local` apuntando a **Convex de desarrollo**, ejecuta:

```sh
pnpm exec playwright install chromium
OSIRIS_TEST_LIVE_SIGNUP=1 pnpm test:dev image-uploads.spec.ts
```

Crea una cuenta y un restaurante de prueba, sube fotos de platillo y fondo, y verifica el formato, las dimensiones y el peso de las imágenes que recibe un comensal. El JPEG de prueba se genera a partir de un recurso local; puedes usar otro JPEG de más de 1200 px con `OSIRIS_TEST_IMAGE_JPEG=/ruta/foto.jpg`. Si ya tienes `next dev` en el puerto 3000, añade `OSIRIS_TEST_PORT=3000` para reutilizarlo.

### Levantar la aplicación en local

En una primera terminal (sincroniza esquema y funciones de Convex):

```sh
pnpm exec convex dev
```

En una segunda terminal (servidor Next.js):

```sh
pnpm dev
```

Abre **http://localhost:3000** (o el puerto que uses, p. ej. `pnpm dev --port 3001`).

> **Consejo para probar varios roles a la vez:** abre una ventana normal para el **Dueño**, y usa ventanas de incógnito o perfiles distintos del navegador para **Mesero**, **Chef**, **Barra**, **Caja** y la pestaña del **Comensal (QR)**. Así verás cómo los cambios y avisos se reflejan en tiempo real entre pantallas sin recargar.

---

## 2. Crear la cuenta de Dueño y obtener el Código del Restaurante

1. Ve a **http://localhost:3000/crear-cuenta**.
2. Elige **«Soy dueño»**.
3. Llena los datos:
   - **Tu nombre:** `Alonso (Dueño)`
   - **Nombre del restaurante:** `Atelier Osiris`
   - **Correo (identificador de acceso):** `dueno@osiris.test`
   - **Contraseña (mínimo 10 caracteres):** `osiris12345`
4. Al enviar, entrarás directo al panel con el plano en **`/cuenta/mesas`**.
5. En la esquina inferior izquierda de la barra lateral, haz clic en tu perfil (`Alonso (Dueño)`):
   - Ahí verás el **Código del restaurante** (por ejemplo `OSR-XXXX-XXXX`).
   - Haz clic en **Copiar**. Con ese código registrarás a los empleados en el Paso 4.

---

## 3. Configurar el restaurante como Dueño

### 3.1 Características (`/cuenta/administracion/caracteristicas`)
1. En la barra lateral entra a **Características**.
2. Verifica que estén activas las **Áreas de preparación** que quieras usar:
   - **Cocina** (rol `Chef`)
   - **Barra** (rol `Barra`)
   - **Coctelería** (rol `Bartender`)
   - **Cafetería** (rol `Barista`)
3. Asegúrate de tener activo **Agotado automático por inventario** y los avisos automáticos.

### 3.2 Inventario (`/cuenta/administracion/inventario`)
1. Entra a **Inventario** y haz clic en **Nuevo insumo**.
2. Crea estos insumos de prueba:
   - **Carne Ribeye** · Categoría: `Carnes` · Unidad: `Gramo (g)` · Existencia inicial: `2000` · Mínimo: `500` · Costo: `350.00`
   - **Salmón fresco** · Categoría: `Mariscos` · Unidad: `Gramo (g)` · Existencia inicial: `1000` · Mínimo: `300` · Costo: `420.00`
   - **Arroz para sushi** · Categoría: `Abarrotes` · Unidad: `Gramo (g)` · Existencia inicial: `3000` · Mínimo: `500` · Costo: `80.00`
   - **Mezcal espadín** · Categoría: `Licores` · Unidad: `Mililitro (ml)` · Existencia inicial: `1500` · Mínimo: `300` · Costo: `600.00`
   - **Café en grano** · Categoría: `Cafetería` · Unidad: `Gramo (g)` · Existencia inicial: `500` · Mínimo: `100` · Costo: `250.00`
   - **Aguacate** · Categoría: `Verduras` · Unidad: `Gramo (g)` · Existencia inicial: `300` · Mínimo: `100` · Costo: `90.00`
3. **Prueba de suma de duplicados:** intenta crear otro insumo llamado `Aguacate` con existencia inicial `200`. Verás que en lugar de duplicarlo suma automáticamente los `200 g` al existente (`500 g` en total).
4. También puedes probar **Registrar entrada** y **Registrar pérdida** en cualquiera de los insumos.

### 3.3 Menú, modificadores y áreas (`/cuenta/administracion/menu`)
1. Entra a **Menú** y crea 4 categorías con **Nueva categoría**:
   - `Fuertes de cocina`
   - `Barra y sushi`
   - `Coctelería`
   - `Cafetería`
2. Ve a la pestaña **Modificadores** y crea 2 grupos:
   - **Término de la carne** · **Obligatorio** (mínimo 1, una sola opción):
     - `Término medio` (`$0.00`)
     - `Tres cuartos` (`$0.00`)
     - `Bien cocido` (`$0.00`)
   - **Extras** · **Opcional** (selección múltiple):
     - `Extra aguacate` (`+$35.00`, con insumo `Aguacate`: `100 g`)
     - `Salsa de la casa` (`+$15.00`)
3. Vuelve a la pestaña **Platillos** y crea estos 4 platillos con **Nuevo platillo**:
   - **Tacos de Ribeye** (`$240.00`)
     - Categoría: `Fuertes de cocina`
     - Área: solo **Cocina**
     - Modificadores: `Término de la carne` y `Extras`
     - Receta: `Carne Ribeye` → `250 g`
   - **Rollo Dragón (Platillo compartido Cocina + Barra)** (`$210.00`)
     - Categoría: `Barra y sushi`
     - Áreas: marca **Cocina** Y **Barra** (para probar que el platillo espera a que ambas estaciones terminen antes de poder entregarse)
     - Receta: `Salmón fresco` → `120 g`, `Arroz para sushi` → `150 g`
   - **Mezcalita de jamaica** (`$145.00`)
     - Categoría: `Coctelería`
     - Área: solo **Coctelería**
     - Receta: `Mezcal espadín` → `60 ml`
   - **Espresso doble** (`$65.00`)
     - Categoría: `Cafetería`
     - Área: solo **Cafetería**
     - Receta: `Café en grano` → `18 g`

### 3.4 Plano de mesas (`/cuenta/mesas`)
1. Entra a **Mesas** y haz clic en **Editar plano**.
2. Crea una sección con **+ Sección** (p. ej. `Salón principal`) y otra `Terraza`.
3. En `Salón principal`, haz clic en **+ Mesa** para crear `Mesa 1`, `Mesa 2` y `Mesa 3`.
4. Arrástralas libremente por la sección para acomodarlas y presiona **Terminar**.

---

## 4. Registrar los usuarios de cada rol

Abre ventanas de incógnito (o sesiones separadas) en **http://localhost:3000/crear-cuenta**, elige **«Soy empleado»**, pega el **Código del restaurante** del Paso 2 y crea estos usuarios:

| Usuario | Nombre | Correo | Contraseña | Rol a marcar | Pantalla a la que entra directo |
| --- | --- | --- | --- | --- | --- |
| **Mesero** | `Javier (Mesero)` | `mesero@osiris.test` | `osiris12345` | `Mesero` | `/cuenta/mesas` (*Mis mesas*) |
| **Chef** | `Marco (Chef)` | `chef@osiris.test` | `osiris12345` | `Chef (Cocina)` | `/cuenta/cocina` (*Cocina*) |
| **Barra** | `Elena (Barra)` | `barra@osiris.test` | `osiris12345` | `Barra` | `/cuenta/cocina` (*Barra*) |
| **Bartender** | `Leo (Coctelería)` | `bartender@osiris.test` | `osiris12345` | `Bartender (Coctelería)` | `/cuenta/cocina` (*Coctelería*) |
| **Caja** | `Sofía (Caja)` | `caja@osiris.test` | `osiris12345` | `Caja` | `/cuenta/caja` (*Caja y cobros*) |

*(Opcional)* En la ventana del **Dueño**, entra a `/cuenta/mesas` → **Editar plano** → edita la sección `Salón principal` y asígnala a `Javier (Mesero)`.

---

## 5. Caso 1 · Vista del Comensal (QR), toma de orden y candado de «Pedir la cuenta»

### 5.1 Abrir el QR de `Mesa 1` como cliente (antes de ordenar)
1. En la ventana del **Dueño**, entra a **Códigos QR** (`/cuenta/administracion/codigos-qr`).
2. Arriba puedes probar **Carta pública (sin mesa) → Abrir carta** (`/menu/[locationId]`), que es de solo lectura.
3. En la lista de mesas, busca **Mesa 1** y haz clic en **Abrir vista comensal** (se abrirá `/mesa/[qrToken]` en una pestaña nueva; también puedes escanear el código QR con tu celular si estás en la misma red).
4. En la vista del comensal de **Mesa 1**:
   - Revisa **La carta**: categorías, precios, modificadores y platillos disponibles.
   - Haz clic en **Llamar mesero** (arriba a la derecha):
     - En la ventana de `Javier (Mesero)` verás que la campana de **Avisos** se enciende al instante con *«Mesa 1 te está llamando»*.
     - Si el cliente vuelve a tocar **Llamar mesero** antes de 20 segundos, el sistema evita el spam y muestra *«Tu mesero ya recibió el aviso. Viene en camino.»*.
   - Cambia a la pestaña **Mi mesa**:
     - Verás que el botón **Pedir la cuenta** tiene **candado (`🔒`)** y está deshabilitado porque todavía no hay una orden abierta ni platillos entregados.

### 5.2 El Mesero toma la orden en `Mesa 1`
1. En la ventana de `Javier (Mesero)` (`/cuenta/mesas`), en la sección **Libres**, haz clic en **Mesa 1**.
2. Prueba agregar productos:
   - Haz clic en **Tacos de Ribeye**: como tiene un modificador obligatorio (*Término de la carne*), se abrirá el modal. Sube la cantidad a `2`, elige `Término medio`, marca `Extra aguacate` y escribe una nota individual en cada plato (ej. *«Sin cebolla»* en el plato 1).
   - Agrega `3 × Rollo Dragón` (el platillo compartido entre **Cocina** y **Barra**).
   - Agrega `2 × Mezcalita de jamaica` (va a **Coctelería**).
3. **Prueba de borrador guardado:** haz clic en **Volver** arriba a la izquierda → aparecerá el diálogo *«Tienes una orden sin confirmar»*. Elige **Guardar borrador y salir**. En *Mis mesas* verás el aviso amarillo con el resumen del borrador en `Mesa 1`.
4. Vuelve a entrar a `Mesa 1` y presiona **Tomar orden → Sí, mandar a cocina**.
5. Observa lo que pasa en tiempo real:
   - En el plano del **Dueño** (`/cuenta/mesas`), `Mesa 1` cambia a **Ocupada**.
   - En la pestaña **QR del Comensal** (`/mesa/[qrToken]`), aparece la barra inferior con el total de `Mesa 1`, y en **Mi mesa** aparece el listado de platillos enviados, pero **Pedir la cuenta sigue bloqueado con candado** indicando: *«Se desbloquea cuando te entreguen todos tus platillos (faltan 7 por llegar)»*.

---

## 6. Caso 2 · Cocina por estaciones, cantidades parciales y platillos compartidos

1. **Ruteo estricto por área:**
   - Abre la ventana de `Marco (Chef)` (`/cuenta/cocina`): solo ve `2 × Tacos de Ribeye` y `3 × Rollo Dragón` (con etiqueta `Compartido con Barra`). **No** ve las *Mezcalitas*.
   - Abre la ventana de `Elena (Barra)` (`/cuenta/cocina`): solo ve `3 × Rollo Dragón` (con etiqueta `Compartido con Cocina`). **No** ve los *Tacos de Ribeye* ni las *Mezcalitas*.
   - Abre la ventana de `Leo (Coctelería)` (`/cuenta/cocina`): solo ve `2 × Mezcalita de jamaica`.
2. **Preparación parcial y descuento incremental de inventario:**
   - En `Leo (Coctelería)`, en `2 × Mezcalita de jamaica`, inicia y marca lista solo **`1`** unidad (`+1 listo`).
   - En la pantalla de `Javier (Mesero)`, verás que `Mezcalita de jamaica` muestra **`1 para entregar`** y `1 preparando`.
   - `Javier (Mesero)` marca entregada esa primera bebida → `Mesa 1` pasa al estado **Entrega parcial** y en el QR del comensal dice `1 de 7 platillos entregados` (**Pedir la cuenta sigue bloqueado**).
3. **Regla del platillo compartido (`Rollo Dragón` en Cocina + Barra):**
   - En `Marco (Chef)`, inicia los `3 × Rollo Dragón` y marca listos `2`.
   - Mira la pantalla de `Javier (Mesero)`: aunque Cocina ya marcó 2 listos, el `Rollo Dragón` **aún no aparece como listo para entregar** porque **Barra** no ha terminado su parte (y el inventario solo se descontó una vez, sin duplicarse entre estaciones).
   - Ahora ve a `Elena (Barra)`, inicia los `3 × Rollo Dragón` y marca listos `3`.
   - Como Cocina tiene `2` listos y Barra `3` listos, el mínimo entre ambas estaciones es **`2`**: ahora sí al mesero le aparecen **`2 para entregar`** y le llega un **Aviso**.
4. **Terminar de preparar y entregar todo:**
   - Termina de marcar listos los platillos restantes en `Chef` (`Tacos de Ribeye` y el último `Rollo Dragón`) y en `Coctelería` (la segunda `Mezcalita`).
   - En `Javier (Mesero)`, haz clic en **Entregar todo lo listo** (o marca cada fila de platillo).
   - Cuando el contador llega a **`7 de 7 platillos entregados`**:
     - Mira la pestaña **QR del Comensal** (`/mesa/[qrToken]` → **Mi mesa**): **el candado desaparece y el botón coral «Pedir la cuenta» queda desbloqueado**.

---

## 7. Caso 3 · El Comensal pide la cuenta desde el QR → Mesero reporta → Caja verifica y confirma

### 7.1 El Comensal pide la cuenta desde su celular
1. En la pestaña **QR del Comensal** (`/mesa/[qrToken]`), toca **Pedir la cuenta → Sí, pedir la cuenta**.
2. En ese instante:
   - `Mesa 1` cambia a color amarillo (**Quieren pagar**) tanto en el plano del **Dueño** como en *Mis mesas* de `Javier (Mesero)`.
   - Llega un **Aviso** a `Javier (Mesero)` y a `Sofía (Caja)`: *«Mesa 1 pidió la cuenta (QR)»*.
   - En la ventana de `Sofía (Caja)` (`/cuenta/caja`), `Mesa 1` aparece automáticamente en **Listas para cobrar** y el contador de `Caja` en la barra lateral sube a `1`.

### 7.2 Control antifraude: el Mesero cobra en mesa y reporta a Caja
1. En la ventana de `Javier (Mesero)`, observa que **no existe ningún botón para que el mesero cierre la cuenta por su cuenta**.
2. `Javier (Mesero)` hace clic en **Reportar pago a caja**:
   - Elige método: `Efectivo`
   - Monto recibido: escribe `2000.00`
   - Propina: elige `10%`
   - Nota para caja: `Entregó 2 billetes de $1,000, pide cambio`
   - Envía con **Reportar a caja**.
3. Observa que `Mesa 1` **sigue ocupada en estado «Quieren pagar»** y en la pantalla del mesero dice *«Esperando confirmación de Caja para liberar la mesa»*.

### 7.3 Caja verifica el pago (devolución o confirmación)
1. Ve a la ventana de `Sofía (Caja)` (`/cuenta/caja`):
   - `Mesa 1` aparece hasta arriba de **Listas para cobrar** con la etiqueta **`Pago reportado por Javier (Mesero)`**, mostrando el monto, la propina y la nota.
2. **Simular discrepancia (opcional):**
   - Haz clic en **Revisar y confirmar** y en la esquina inferior izquierda del modal presiona **Devolver reporte al mesero**.
   - A `Javier (Mesero)` le llega un aviso inmediato (*«Revisar pago en caja: Mesa 1»*) y puede corregir y volver a reportar el pago.
3. **Confirmar el cobro en Caja:**
   - Haz clic en **Revisar y confirmar** en `Mesa 1`.
   - El modal de cobro ya viene **precargado** con los datos que reportó el mesero (y si el cliente pagó mitad con tarjeta y mitad en efectivo, el cajero puede hacer clic en **+ Agregar método** o hacer un **abono parcial**).
   - Verás en verde el **Cambio a entregar**.
   - Haz clic en **Confirmar cobro**.
4. **Resultado inmediato:**
   - Aparece el comprobante con el monto aplicado, la propina y el cambio exacto a devolver.
   - `Mesa 1` pasa automáticamente a **Libre** en el plano del Dueño y en *Mis mesas* del Mesero.
   - A `Javier (Mesero)` le llega el aviso *«Mesa 1: cuenta cerrada y libre»*.
   - La cuenta pasa a la pestaña **Ya cobradas** en Caja.

---

## 8. Caso 4 · Turno y Corte de Caja, Descuentos, Reabrir cuenta y Agotados

1. **Turno y corte (`/cuenta/caja` → pestaña `Turno y corte`):**
   - Haz clic en **Abrir turno** con un fondo inicial de `1500.00`.
   - Registra un **Ingreso** de `200.00` (*«Cambio en monedas»*) y un **Retiro** de `350.00` (*«Pago de hielo»*).
   - Cobra otra cuenta en efectivo y observa cómo se actualiza en vivo **Efectivo esperado en caja**, **Ventas del turno**, **Propinas (aparte)** y el desglose por método (`Efectivo`, `Tarjeta`, `Transferencia`, `Vales`).
   - Haz clic en **Hacer corte y cerrar turno**: escribe el efectivo físico contado (prueba escribir `50.00` menos para ver el aviso de faltante) y confirma. El corte queda guardado en **Cortes anteriores** y el Dueño recibe un aviso con el resumen.
2. **Descuentos y cortesías al 100%:**
   - Abre cualquier cuenta activa desde Caja o como Dueño → **Más acciones → Aplicar descuento o cortesía**.
   - Prueba un descuento por porcentaje (`20%`) o del `100%` (cortesía total con motivo obligatorio) y ciérrala desde **Cobrar → Cerrar cortesía**.
3. **Reabrir una cuenta cerrada (Dueño / Gerente):**
   - En la ventana del **Dueño**, entra a **Caja → Ya cobradas** y haz clic en **Reabrir** en una cuenta cerrada.
   - Escribe el motivo y confirma: los pagos anteriores quedan marcados como **Revertidos** y la cuenta regresa a **Listas para cobrar** (si la mesa ya estaba ocupada por otra cuenta nueva, el sistema impide reabrirla sobre la misma mesa).
4. **Agotados desde Caja (`/cuenta/caja` → pestaña `Agotados`):**
   - Marca `Tacos de Ribeye` como **Agotado**.
   - Verifica en la ventana del **Mesero** y en la **Carta QR del Comensal** que `Tacos de Ribeye` aparece inmediatamente como **Agotado** y no permite ordenarse.

---

## 9. Caso 5 · Cancelación con aviso `NO PREPARAR`, Reasignar mesero y Para llevar

1. **Cancelar un platillo en preparación (`NO PREPARAR`):**
   - Toma una orden en `Mesa 2` y haz que `Marco (Chef)` presione **Preparar** en el platillo (lo cual descuenta sus insumos del inventario).
   - Desde la cuenta de `Mesa 2` (como Mesero o Dueño), haz clic en **Cancelar** junto al platillo.
   - Como Cocina ya había empezado a prepararlo, el modal te pedirá elegir qué hacer con los insumos: **Devolver al inventario** o **Registrar como pérdida (merma)**.
   - Al confirmar, en la pantalla de `Marco (Chef)` la tarjeta se pone en rojo con la etiqueta **`NO PREPARAR`** y el motivo de cancelación hasta que el chef presiona **Enterado**.
2. **Mover de mesa y Reasignar mesero:**
   - Dentro de una cuenta abierta → **Más acciones**, prueba **Mover a otra mesa** (pasa la cuenta de `Mesa 2` a `Mesa 3` liberando `Mesa 2`) y **Reasignar mesero** (transfiere la cuenta a otro mesero activo y le envía un aviso).
3. **Pedidos Para llevar / Para recoger / Barra (`/cuenta/mesero/llevar`):**
   - Haz clic en **Nueva cuenta sin mesa**, elige `Para llevar`, escribe el nombre del cliente, hora estimada de entrega y teléfono de 10 dígitos (marcando el consentimiento de aviso de privacidad).
   - Toma la orden, prepárala en Cocina, márcala entregada en el tablero Kanban (`Nuevo` → `Preparando` → `Listo` → `Entregado`), repórtala/cóbrala en Caja y verifica que permanece visible en la columna **Entregado** con la etiqueta **Pagado**.
