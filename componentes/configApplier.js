const { ProductLoader } = require('./productLoader');

class ConfigApplier {
    constructor(page) {
        this.page = page;
    }

    async aplicar(configuraciones) {
        console.log('📋 Aplicando configuraciones:', configuraciones);
        for (const [nombre, valor] of Object.entries(configuraciones)) {
            await this.aplicarConfiguracion(nombre, valor);
        }
    }

    async leerValorConTab() {
        const productLoader = new ProductLoader(this.page);
        
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(500);
        
        // Obtener los textos de todos los selectores para saber cuál es cuál
        const infoSelectores = await this.page.evaluate(() => {
            const selectores = ['#select2-chosen-6', '#select2-chosen-9', '#select2-chosen-11', '#select2-chosen-13'];
            const resultados = [];
            
            for (const selector of selectores) {
                const elemento = document.querySelector(selector);
                if (elemento) {
                    resultados.push({
                        selector: selector,
                        texto: elemento.textContent.trim()
                    });
                }
            }
            return resultados;
        });
        
        console.log('   Estado de selectores:', infoSelectores);
        
        // Filtrar SOLO los que tienen texto de producto (no "Seleccione...")
        const selectoresConProducto = infoSelectores
            .filter(s => s.texto !== 'Seleccione...' && s.texto !== '')
            .map(s => s.selector);
        
        console.log('   Selectores con producto:', selectoresConProducto);
        
        // Procesar en orden
        for (const selector of selectoresConProducto) {
            await this.page.click(selector);
            await this.page.waitForTimeout(300);
            await this.page.keyboard.press('Escape');
            await this.page.waitForTimeout(300);
            await productLoader.obtenerPrecioConTab();
            await this.page.waitForTimeout(500);
        }
    }

    async aplicarConfiguracion(nombre, valor) {
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
                    
                    await this.leerValorConTab();
                    console.log(`   ✅ Descuento global aplicado: ${valor}`);
                } catch (e) {
                    console.log(`   ❌ Error: ${e.message}`);
                }
                break;
                
            case 'moneda':
                await this.page.locator('#MonedaId_chosen .chosen-single').click();        
                await this.page.keyboard.type(valor); 
                await this.page.keyboard.press("Enter");
                await this.leerValorConTab();
                console.log(`   ✅ Moneda aplicada: ${valor}`);
                break;
                
            case 'cotizacion':
                await this.page.fill('#cotizacion', valor);
                await this.leerValorConTab();
                console.log(`   ✅ Cotización aplicada: ${valor}`);
                break;
                
            case 'lista_precios':
                await this.page.click('#ListaDePreciosVentaId_chosen .chosen-single');
                await this.page.keyboard.type(valor);
                await this.page.keyboard.press('Enter');
                await this.leerValorConTab();
                console.log(`   ✅ Lista de precios aplicada: ${valor}`);
                break;
                
            case 'descuento_items':
                console.log(`   Aplicando descuento por ítems: ${valor}`);
                await this.page.evaluate((valor) => {
                    const campos = document.querySelectorAll('input');
                    for (const campo of campos) {
                        if ((campo.name && campo.name.toLowerCase().includes('bonificacion')) ||
                            (campo.id && campo.id.toLowerCase().includes('bonificacion'))) {
                            campo.value = valor;
                            campo.dispatchEvent(new Event('change', { bubbles: true }));
                            campo.dispatchEvent(new Event('input', { bubbles: true }));
                        }
                    }
                }, valor);
                await this.page.waitForTimeout(1000);
                await this.leerValorConTab();
                console.log(`   ✅ Descuento por ítems aplicado: ${valor}`);
                break;
                
            default:
                console.log(`Configuración no implementada: ${nombre}`);
        }
        await this.page.waitForTimeout(500);
    }
}

module.exports = { ConfigApplier };