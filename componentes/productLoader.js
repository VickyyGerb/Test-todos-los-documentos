// components/productLoader.js
const { expect } = require('@playwright/test');

class ProductLoader {
    constructor(page) {
        this.page = page;
    }

    async obtenerPrecioUltimoProducto() {
        const precioTexto = await this.page.locator('table tbody tr:last-child td:nth-child(3)').textContent();
        const precioLimpio = precioTexto.replace(/\./g, '').replace(',', '.').replace('$', '').trim();
        return parseFloat(precioLimpio);
    }

    async cargarManual(codigoInterno, cantidad = 1) {
        await this.page.click('#select2-chosen-8');
        await this.page.keyboard.type(codigoInterno);
        await this.page.keyboard.press('Enter');
        await this.page.keyboard.press('Tab');
        await this.page.keyboard.press('Tab');
        return await this.obtenerPrecioUltimoProducto();
    }

    async cargarPorCodigoBarra(codigoBarra) {
        const barcodeIcon = this.page.locator('i.fa.fa-barcode').first();
        await barcodeIcon.waitFor({ state: 'visible', timeout: 5000 });
        await barcodeIcon.click();

        await this.page.keyboard.type(codigoBarra);
        await this.page.getByRole('link', { name: 'Confirmar ( F8 )' }).click();
        await this.page.waitForTimeout(500);
        await this.page.locator('#select2-chosen-27').click();
        await this.page.keyboard.press('Tab');
        await this.page.keyboard.press('Tab');
        return await this.obtenerPrecioUltimoProducto();
    }

    async cargarAsignacionMultiple(codigoInterno, cantidad = 1) {
        await this.page.click('#btn-color-youtube.dropdown-toggle.btn.btn-sm');
        await this.page.getByRole('link', { name: 'Asignación Múltiple' }).click();
        await this.page.fill('#NombreProducto', codigoInterno);
        await expect(this.page.getByRole('columnheader', { name: 'Código' })).toBeVisible();
        await this.page.getByRole('checkbox').click();
        await this.page.getByRole('button', { name: 'Agregar' }).click();
        return await this.obtenerPrecioUltimoProducto();
    }

    async cargarDesdePlantilla(nombrePlantilla) {
        await this.page.click('#btn-color-youtube.dropdown-toggle.btn.btn-sm');
        await this.page.getByRole('link', { name: 'Plantillas' }).click();
        await this.page.click('#PlantillasLista.chosen-select');
        await this.page.keyboard.press('ArrowDown');
        await this.page.keyboard.press('Enter');
        await this.page.getByRole('link', { name: 'Asociar' }).click();
        return await this.obtenerPrecioUltimoProducto();
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