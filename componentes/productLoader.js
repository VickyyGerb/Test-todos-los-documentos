const { expect } = require('@playwright/test');
const { leerLineasProducto } = require('../utiles/lecturaPrecios');

class ProductLoader {
    constructor(page, documento) {
        this.page = page;
        this.documento = (documento || '').toLowerCase();
    }

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

        const lineas = await this.page.evaluate(leerLineasProducto, this.documento);
        const linea = lineas.find(l => l.guid === info.guid);
        const precio = linea ? linea.total : 0;

        console.log(`   Precio del producto cargado: ${precio}`);
        return precio;
    }

    async abrirSelectProductoVacio() {
        await this.page.waitForTimeout(1000);

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

        for (let intento = 1; intento <= 2; intento++) {
            if (intento > 1) {
                const tardio = await this.leerPrecioNuevo(antes, 2500);
                if (tardio > 0) {
                    console.log('   ℹ️ Manual: el producto del intento anterior cargó tarde, no reintento');
                    return tardio;
                }
            }

            await this.abrirSelectProductoVacio();

            const search = this.page.locator('#select2-drop input.select2-input').first();
            try {
                await search.waitFor({ state: 'visible', timeout: 5000 });
                await search.fill(codigoInterno);
            } catch (e) {
                await this.page.keyboard.type(codigoInterno);
            }
            await this.page.waitForTimeout(3000);

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
        if (this.documento === 'remito') {
            console.log('   ⏭️ Remito no tiene carga por código de barra — se omite');
            return 0;
        }
        const antes = await this.snapshotGuids();

        await this.page.keyboard.press('F6');
        await this.page.keyboard.type(codigoBarra);
        await this.page.waitForTimeout(2000);
        await this.page.keyboard.press('F8', { force: true });
        await this.page.waitForTimeout(3000);

        return await this.leerPrecioNuevo(antes);
    }

    async cerrarSelect2Abierto() {
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(300);
        await this.page.evaluate(() => {
            document.querySelectorAll('#select2-drop-mask, .select2-drop-mask').forEach(m => m.remove());
            if (window.jQuery) { try { jQuery('#select2-drop').hide(); } catch (e) {} }
        });
        await this.page.waitForTimeout(200);
    }

    async cargarAsignacionMultiple(codigoInterno, cantidad = 1) {
        if (this.documento === 'pedido') return this.cargarAsignacionMultiplePedido(codigoInterno, cantidad);
        if (this.documento === 'remito') return this.cargarAsignacionMultipleRemito(codigoInterno, cantidad);
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
        if (this.documento === 'remito') {
            console.log('   ⏭️ Remito no tiene carga por plantilla — se omite');
            return 0;
        }
        const antes = await this.snapshotGuids();

        await this.page.click('#btn-color-youtube.dropdown-toggle.btn.btn-sm');
        await this.page.getByRole('link', { name: 'Plantillas' }).click();
        await this.page.waitForTimeout(1000);

        await this.seleccionarPlantillaEnChosen(nombrePlantilla);

        await this.page.locator('.modal-footer:has-text("Asociar") a.btn-success').click();
        await this.page.waitForTimeout(3000);

        return await this.leerPrecioNuevo(antes);
    }

    async seleccionarPlantillaEnChosen(nombrePlantilla) {
        try {
            await this.page.click('#PlantillasLista_chosen .chosen-single');
            await this.page.waitForTimeout(400);

            const search = this.page.locator('#PlantillasLista_chosen .chosen-search input').first();
            await search.waitFor({ state: 'visible', timeout: 4000 });
            await search.type(String(nombrePlantilla), { delay: 50 });
            await this.page.waitForTimeout(800);

            const opcion = this.page.locator('#PlantillasLista_chosen .chosen-results li.active-result').first();
            await opcion.waitFor({ state: 'visible', timeout: 4000 });
            await opcion.click();
        } catch (e) {
            console.log(`   ⚠️ No pude elegir la plantilla por UI (${e.message}); intento por jQuery...`);
            const ok = await this.page.evaluate((nombre) => {
                const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
                const s = document.getElementById('PlantillasLista');
                if (!s) return false;
                const opt = Array.from(s.options).find(o => norm(o.textContent).includes(norm(nombre)));
                if (!opt) return false;
                s.value = opt.value;
                if (window.jQuery) { try { jQuery(s).val(opt.value).trigger('chosen:updated').trigger('change'); } catch (e) {} }
                else s.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }, nombrePlantilla);
            if (!ok) throw new Error(`No encontré la plantilla "${nombrePlantilla}" en el combo de plantillas`);
        }
        await this.page.waitForTimeout(1500);
    }

    async cargarAsignacionMultiplePedido(codigoInterno, cantidad = 1) {
        const antes = await this.snapshotGuids();

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

        await this.page.evaluate(() => {
            const link = document.getElementById('btnAbrirModal');
            if (link) link.click();
        });
        await this.page.waitForTimeout(2000);

        await this.seleccionarPlantillaEnChosen(nombrePlantilla);

        await this.page.locator('.modal-footer:has-text("Asociar") a.btn-success').click();
        await this.page.waitForTimeout(3000);

        return await this.leerPrecioNuevo(antes);
    }

    async cargarAsignacionMultipleRemito(codigoInterno, cantidad = 1) {
        const antes = await this.snapshotGuids();

        await this.cerrarSelect2Abierto();
        await this.page.evaluate(() => {
            const link = Array.from(document.querySelectorAll('a')).find(a => /Asignaci[oó]n M[uú]ltiple/i.test(a.textContent));
            if (link) link.click();
        });
        await this.page.waitForTimeout(1500);

        const modal = this.page.locator('#ModalBuscarMultiProducto');
        await this.page.fill('#NombreProducto', codigoInterno);
        await this.page.waitForTimeout(800);

        await this.page.locator('#NombreProducto').blur();
        await this.page.waitForTimeout(1500);

        const fila = modal.locator('table tbody tr.odd');
        await fila.waitFor({ state: 'visible', timeout: 5000 });
        await fila.locator('input[type="checkbox"]').click();
        await this.page.waitForTimeout(500);

        await modal.getByRole('button', { name: 'Agregar' }).click();
        await this.page.waitForTimeout(2500);

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
