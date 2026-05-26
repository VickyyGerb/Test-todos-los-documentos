const { expect } = require('@playwright/test');

class ProductLoader {
    constructor(page) {
        this.page = page;
    }

    async obtenerPrecioConTab() {
        await this.page.keyboard.press('Tab');
        await this.page.keyboard.press('Tab');
        await this.page.keyboard.press('Tab');
        await this.page.keyboard.press('Tab');
        await this.page.keyboard.press('Tab');
        
        const valor = await this.page.evaluate(() => {
            const activeElement = document.activeElement;
            return activeElement.value;
        });
        
        console.log('Valor capturado con Tab:', valor);
        
        const precioLimpio = valor.replace(/\./g, '').replace(',', '.').trim();
        return parseFloat(precioLimpio);
    }

    async cargarManual(codigoInterno, cantidad = 1) {   
        await this.page.click('#select2-chosen-6');
        await this.page.keyboard.type(codigoInterno);
        await this.page.waitForTimeout(3000);
        await this.page.keyboard.press('Enter');
        await this.page.waitForTimeout(3000);
        
        return await this.obtenerPrecioConTab();
    }

    async cargarPorCodigoBarra(codigoBarra) {
        await this.page.keyboard.press('F6');
        await this.page.keyboard.type(codigoBarra);
        await this.page.waitForTimeout(2000);
        await this.page.keyboard.press('F8');
        await this.page.waitForTimeout(3000);
        
        await this.page.click('#select2-chosen-9');
        await this.page.waitForTimeout(500);
        
        return await this.obtenerPrecioConTab();
    }

    async cargarAsignacionMultiple(codigoInterno, cantidad = 1) {
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
        
        await this.page.click('#select2-chosen-11');
        await this.page.waitForTimeout(500);
        
        return await this.obtenerPrecioConTab();
        await this.page.pause()
    }

    async cargarDesdePlantilla(nombrePlantilla) {
        await this.page.click('#btn-color-youtube.dropdown-toggle.btn.btn-sm');
        await this.page.getByRole('link', { name: 'Plantillas' }).click();
        await this.page.click('#PlantillasLista_chosen .chosen-single.chosen-default');
        await this.page.keyboard.press('ArrowDown');
        await this.page.keyboard.press('Enter');
        await this.page.waitForTimeout(3000);
        await this.page.locator('.modal-footer:has-text("Asociar") a.btn-success').click();
        await this.page.waitForTimeout(3000);
        
        await this.page.click('#select2-chosen-13');
        await this.page.waitForTimeout(500);
        
        return await this.obtenerPrecioConTab();
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