const { ProductLoader } = require('./productLoader');

class ConfigApplier {
    constructor(page) {
        this.page = page;
        this.productLoader = new ProductLoader(page);
    }

    async aplicar(configuraciones, codigoProducto) {
        console.log('📋 Aplicando configuraciones:', configuraciones);
        console.log('📋 Código producto recibido en aplicar:', codigoProducto);
        for (const [nombre, valor] of Object.entries(configuraciones)) {
            await this.aplicarConfiguracion(nombre, valor, codigoProducto);
        }
    }

    async leerPreciosConTab() {
        const precios = [];
        
        // Lista de selectores en orden
        const selectores = ['#select2-chosen-6', '#select2-chosen-9', '#select2-chosen-11', '#select2-chosen-13'];
        
        for (const selector of selectores) {
            const existe = await this.page.locator(selector).count();
            if (existe > 0) {
                await this.page.click(selector);
                await this.page.waitForTimeout(300);
                const precio = await this.productLoader.obtenerPrecioConTab();
                precios.push(precio);
                console.log(`   Selector ${selector} - Precio: ${precio}`);
            }
        }
        
        console.log(`   Precios obtenidos: ${precios.join(', ')}`);
        return precios;
    }

    async aplicarConfiguracion(nombre, valor, codigoProducto) {
        console.log(`⚙️ Aplicando configuración: ${nombre} = ${valor}`);
        
        switch(nombre) {
            case 'descuento_global':
                try {
                    console.log(`   Aplicando descuento global: ${valor}`);
                    await this.page.evaluate((valor) => {
                        const campos = document.querySelectorAll('input');
                        for (const campo of campos) {
                            if ((campo.name && campo.name.toLowerCase().includes('descuento')) ||
                                (campo.id && campo.id.toLowerCase().includes('descuento'))) {
                                campo.value = valor;
                                campo.dispatchEvent(new Event('change', { bubbles: true }));
                                campo.dispatchEvent(new Event('input', { bubbles: true }));
                            }
                        }
                    }, valor);
                    await this.page.waitForTimeout(1000);
                    
                    const precios = await this.leerPreciosConTab();
                    console.log(`   Precios después del descuento: ${precios.join(', ')}`);
                    console.log(`   ✅ Descuento global aplicado: ${valor}`);
                } catch (e) {
                    console.log(`   ❌ Error: ${e.message}`);
                }
                break;
                
            case 'moneda':
                await this.page.locator('#MonedaId_chosen .chosen-single').click();        
                await this.page.keyboard.type(valor); 
                await this.page.keyboard.press("Enter");
                await this.leerPreciosConTab();
                console.log(`   ✅ Moneda aplicada: ${valor}`);
                break;
                
            case 'cotizacion':
                await this.page.fill('#cotizacion', valor);
                await this.leerPreciosConTab();
                console.log(`   ✅ Cotización aplicada: ${valor}`);
                break;
                
            case 'lista_precios':
                await this.page.click('#ListaDePreciosVentaId_chosen .chosen-single');
                await this.page.keyboard.type(valor);
                await this.page.keyboard.press('Enter');
                await this.leerPreciosConTab();
                console.log(`   ✅ Lista de precios aplicada: ${valor}`);
                break;
                
            default:
                console.log(`Configuración no implementada: ${nombre}`);
        }
        await this.page.waitForTimeout(500);
    }
}

module.exports = { ConfigApplier };