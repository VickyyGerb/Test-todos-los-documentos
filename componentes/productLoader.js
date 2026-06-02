const { expect } = require('@playwright/test');

// Las tablas de productos se llaman distinto según el documento:
// ListaProductoVenta (factura/venta), ListaProductoPresupuestoVenta (presupuesto),
// ProductosLista (pedido). Por eso los selectores matchean ese patrón y excluyen
// los de productos libres (ListaProducto*Libre*, ProductosLibresLista).
// REGEX (prefijo de la tabla de productos), reutilizado en varios lugares:
//   /^(?:ListaProducto(?!Libre)\w*?|ProductosLista)\[<guid>\]\.<campo>$/

class ProductLoader {
    constructor(page, documento) {
        this.page = page;
        this.documento = (documento || '').toLowerCase();
    }

    // GUID de las filas de producto que YA tienen un producto cargado.
    async snapshotGuids() {
        return await this.page.evaluate(() => {
            const re = /^(?:ListaProducto(?!Libre)\w*?|ProductosLista)\[(.+?)\]\.ProductoId$/;
            const guids = [];
            document.querySelectorAll('input[name$=".ProductoId"]').forEach(inp => {
                const m = inp.name.match(re);
                if (m && inp.value && inp.value.trim() !== '') guids.push(m[1]);
            });
            return guids;
        });
    }

    // Espera a que aparezca una fila de producto nueva (GUID que no estaba en
    // guidsAntes) y devuelve su precio CON IVA (TotalIVA). Funciona para
    // cualquier tipo de documento y no depende de IDs select2 fijos.
    async leerPrecioNuevo(guidsAntes, timeout = 8000) {
        const intervalo = 300;
        let info = null;

        for (let t = 0; t < timeout; t += intervalo) {
            info = await this.page.evaluate((antes) => {
                const re = /^(ListaProducto(?!Libre)\w*?|ProductosLista)\[(.+?)\]\.ProductoId$/;
                const s = new Set(antes);
                const inputs = document.querySelectorAll('input[name$=".ProductoId"]');
                for (const inp of inputs) {
                    const m = inp.name.match(re);
                    if (m && inp.value && inp.value.trim() !== '' && !s.has(m[2])) {
                        return { prefijo: m[1], guid: m[2] };
                    }
                }
                return null;
            }, guidsAntes);

            if (info) break;
            await this.page.waitForTimeout(intervalo);
        }

        if (!info) {
            console.log('   ⚠️ No se detectó una fila de producto nueva');
            return 0;
        }

        const precio = await this.page.evaluate((info) => {
            const aNumero = (txt) => parseFloat((txt || '').replace(/\./g, '').replace(',', '.')) || 0;
            const IVA = 0.21; // presupuestos no guardan el IVA por línea: lo calculamos
            // Factura → TotalIVA (con IVA real). Presupuesto → Total neto × (1 + IVA).
            const tIva = document.querySelector(`input[name="${info.prefijo}[${info.guid}].TotalIVA"]`);
            if (tIva) return aNumero(tIva.value);
            const tot = document.querySelector(`input[name="${info.prefijo}[${info.guid}].Total"]`);
            return tot ? Math.round(aNumero(tot.value) * (1 + IVA) * 100) / 100 : 0;
        }, info);

        console.log(`   Precio del producto cargado (con IVA): ${precio}`);
        return precio;
    }

    // Abre el buscador del select2 de producto de la fila vacía (ProductoId sin
    // valor), sin depender de #select2-chosen-N fijo ni del tipo de documento.
    async abrirSelectProductoVacio() {
        // El select2 de producto tiene la clase "productoId" en su contenedor
        // (vale para factura, presupuesto, etc.). Usamos un locator de Playwright
        // en vez de "marcar y clickear": el locator se re-resuelve y reintenta solo
        // si el elemento se detacha/re-renderiza (que era lo que rompía el click
        // cuando select2 se reinicia tras elegir el cliente).
        await this.page.waitForTimeout(1000); // dejar asentar el re-render inicial

        const choice = this.page.locator('.select2-container.productoId .select2-choice').first();
        try {
            await choice.waitFor({ state: 'visible', timeout: 15000 });
            await choice.click();
        } catch (e) {
            const info = await this.page.evaluate(() =>
                Array.from(document.querySelectorAll('.select2-container')).map(c => {
                    const ch = c.querySelector('.select2-chosen');
                    return `[${c.className}] "${ch ? ch.textContent.trim().slice(0, 20) : ''}"`;
                }).join('  ||  ')
            );
            throw new Error('No pude abrir el select2 de producto (.productoId). Select2 en la página: ' + (info || '(ninguno)') + ' | ' + e.message);
        }

        await this.page.waitForTimeout(500);
    }

    async cargarManual(codigoInterno, cantidad = 1) {
        const antes = await this.snapshotGuids();

        // Reintenta una vez si el producto no queda (el re-render del select2 a
        // veces hace que la selección no se confirme).
        for (let intento = 1; intento <= 2; intento++) {
            await this.abrirSelectProductoVacio();

            // Escribir en el buscador del dropdown activo de select2 (#select2-drop).
            // Si no se puede ubicar, respaldo tipeando al foco.
            const search = this.page.locator('#select2-drop input.select2-input').first();
            try {
                await search.waitFor({ state: 'visible', timeout: 5000 });
                await search.fill(codigoInterno);
            } catch (e) {
                await this.page.keyboard.type(codigoInterno);
            }
            await this.page.waitForTimeout(3000);

            // Elegir el primer resultado seleccionable (más confiable que Enter).
            const resultado = this.page.locator('.select2-results li.select2-result-selectable').first();
            try {
                await resultado.waitFor({ state: 'visible', timeout: 6000 });
                await resultado.click();
            } catch (e) {
                await this.page.keyboard.press('ArrowDown');
                await this.page.keyboard.press('Enter');
            }
            await this.page.waitForTimeout(3000);

            const precio = await this.leerPrecioNuevo(antes);
            if (precio > 0) return precio;
            console.log(`   ⚠️ Manual intento ${intento}: el producto no quedó, reintento...`);
        }

        return 0;
    }

    async cargarPorCodigoBarra(codigoBarra) {
        const antes = await this.snapshotGuids();

        await this.page.keyboard.press('F6');
        await this.page.keyboard.type(codigoBarra);
        await this.page.waitForTimeout(2000);
        await this.page.keyboard.press('F8', { force: true });
        await this.page.waitForTimeout(3000);

        return await this.leerPrecioNuevo(antes);
    }

    async cargarAsignacionMultiple(codigoInterno, cantidad = 1) {
        if (this.documento === 'pedido') return this.cargarAsignacionMultiplePedido(codigoInterno, cantidad);
        const antes = await this.snapshotGuids();

        await this.page.click('#btn-color-youtube.dropdown-toggle.btn.btn-sm');
        await this.page.waitForTimeout(500);

        await this.page.locator('a:has-text("Asignación Múltiple")').click();
        await this.page.waitForTimeout(1000);

        await this.page.fill('#NombreProducto', codigoInterno);
        await this.page.waitForTimeout(500);

        await this.page.keyboard.press('Enter');
        await this.page.waitForTimeout(2000);

        const filaProducto = this.page.locator('table tbody tr.odd');
        await filaProducto.waitFor({ state: 'visible', timeout: 5000 });

        await filaProducto.locator('input[type="checkbox"]').click();
        await this.page.waitForTimeout(500);

        await this.page.getByRole('button', { name: 'Agregar' }).click();
        await this.page.waitForTimeout(3000);

        return await this.leerPrecioNuevo(antes);
    }

    async cargarDesdePlantilla(nombrePlantilla) {
        if (this.documento === 'pedido') return this.cargarDesdePlantillaPedido(nombrePlantilla);
        const antes = await this.snapshotGuids();

        await this.page.click('#btn-color-youtube.dropdown-toggle.btn.btn-sm');
        await this.page.getByRole('link', { name: 'Plantillas' }).click();
        await this.page.click('#PlantillasLista_chosen .chosen-single.chosen-default');
        await this.page.keyboard.press('ArrowDown');
        await this.page.keyboard.press('Enter');
        await this.page.waitForTimeout(3000);
        await this.page.locator('.modal-footer:has-text("Asociar") a.btn-success').click();
        await this.page.waitForTimeout(3000);

        return await this.leerPrecioNuevo(antes);
    }

    // ========================================================================
    // SECCIÓN EXCLUSIVA DE PEDIDO
    // En Pedido la carga MANUAL y por CÓDIGO DE BARRA son iguales que en el
    // resto (mismo select2 .productoId); solo cambia el nombre de la tabla
    // (ProductosLista), ya contemplado en la detección. Por eso esos dos NO
    // pasan por acá. Asignación múltiple y plantilla usan otros botones en
    // Pedido, así que quedan exclusivos (pendientes).
    // ========================================================================
    async cargarAsignacionMultiplePedido(codigoInterno, cantidad = 1) {
        const antes = await this.snapshotGuids();

        // En Pedido el link "Asignación Múltiple" vive en un dropdown colapsado
        // (Playwright lo ve "not visible"). Lo disparamos por JS: su onclick
        // BuscarProducto(false) abre el modal igual.
        await this.page.evaluate(() => {
            const link = Array.from(document.querySelectorAll('a')).find(a => /Asignación Múltiple/i.test(a.textContent));
            if (link) link.click();
        });
        await this.page.waitForTimeout(1500);

        await this.page.fill('#NombreProducto', codigoInterno);
        await this.page.waitForTimeout(500);

        await this.page.keyboard.press('Enter');
        await this.page.waitForTimeout(2000);

        const filaProducto = this.page.locator('table tbody tr.odd');
        await filaProducto.waitFor({ state: 'visible', timeout: 5000 });

        await filaProducto.locator('input[type="checkbox"]').click();
        await this.page.waitForTimeout(500);

        await this.page.getByRole('button', { name: 'Agregar' }).click();
        await this.page.waitForTimeout(3000);

        return await this.leerPrecioNuevo(antes);
    }

    async cargarDesdePlantillaPedido(nombrePlantilla) {
        const antes = await this.snapshotGuids();

        // En Pedido el link "Plantillas" (#btnAbrirModal) también está en el
        // dropdown colapsado; lo disparamos por JS para abrir el modal.
        await this.page.evaluate(() => {
            const link = document.getElementById('btnAbrirModal');
            if (link) link.click();
        });
        await this.page.waitForTimeout(2000);

        await this.page.click('#PlantillasLista_chosen .chosen-single.chosen-default');
        await this.page.keyboard.press('ArrowDown');
        await this.page.keyboard.press('Enter');
        await this.page.waitForTimeout(3000);
        await this.page.locator('.modal-footer:has-text("Asociar") a.btn-success').click();
        await this.page.waitForTimeout(3000);

        return await this.leerPrecioNuevo(antes);
    }

    async cargar(metodo, datos) {
        switch(metodo) {
            case 'manual':
                return await this.cargarManual(datos.codigoInterno, datos.cantidad);
            case 'codigoBarra':
                return await this.cargarPorCodigoBarra(datos.codigoBarra);
            case 'asignMultiple':
                return await this.cargarAsignacionMultiple(datos.codigoInterno, datos.cantidad);
            case 'plantilla':
                return await this.cargarDesdePlantilla(datos.nombrePlantilla);
            default:
                throw new Error(`Método desconocido: ${metodo}`);
        }
    }
}

module.exports = { ProductLoader };
