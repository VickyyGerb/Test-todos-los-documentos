const { expect } = require('@playwright/test');

// Las tablas de productos se llaman distinto según el documento:
// ListaProductoVenta (factura/venta), ListaProductoPresupuestoVenta (presupuesto),
// etc. Por eso los selectores matchean el patrón ListaProducto<...>Venta y
// excluyen "Libre" (tabla de productos libres), en vez de un nombre fijo.

class ProductLoader {
    constructor(page) {
        this.page = page;
    }

    // GUID de las filas de producto que YA tienen un producto cargado.
    async snapshotGuids() {
        return await this.page.evaluate(() => {
            const re = /^ListaProducto(?!Libre)\w*Venta\[(.+?)\]\.ProductoId$/;
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
                const re = /^(ListaProducto(?!Libre)\w*Venta)\[(.+?)\]\.ProductoId$/;
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
        const ok = await this.page.evaluate(() => {
            const re = /^ListaProducto(?!Libre)\w*Venta\[(.+?)\]\.ProductoId$/;
            const inputs = document.querySelectorAll('input[name$=".ProductoId"]');
            for (const prod of inputs) {
                if (!re.test(prod.name)) continue;
                if (prod.value && prod.value.trim() !== '') continue; // ya tiene producto
                const cont = prod.id ? document.getElementById('s2id_' + prod.id) : null;
                const choice = cont ? (cont.querySelector('.select2-choice') || cont.querySelector('.select2-chosen')) : null;
                if (choice) {
                    choice.setAttribute('data-cargar-aqui', '1');
                    return true;
                }
            }
            return false;
        });

        if (!ok) throw new Error('No encontré el select2 de producto vacío para la carga manual');
        await this.page.click('[data-cargar-aqui="1"]');
        await this.page.evaluate(() => {
            const el = document.querySelector('[data-cargar-aqui="1"]');
            if (el) el.removeAttribute('data-cargar-aqui');
        });
        await this.page.waitForTimeout(500);
    }

    async cargarManual(codigoInterno, cantidad = 1) {
        const antes = await this.snapshotGuids();

        await this.abrirSelectProductoVacio();
        await this.page.keyboard.type(codigoInterno);
        await this.page.waitForTimeout(3000);
        await this.page.keyboard.press('Enter');
        await this.page.waitForTimeout(3000);

        return await this.leerPrecioNuevo(antes);
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
