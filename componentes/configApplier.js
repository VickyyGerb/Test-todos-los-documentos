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

    async leerPreciosConTab(codigoProducto) {
    const precios = [];
    
    // Obtener todos los selectores que contienen el código del producto, en el orden de la tabla
    const selectoresEncontrados = await this.page.evaluate((codigo) => {
        const resultados = [];
        // Buscar dentro de cada fila de la tabla
        const filas = document.querySelectorAll('table tbody tr');
        
        for (const fila of filas) {
            const selector = fila.querySelector('.select2-chosen');
            if (selector && selector.textContent.includes(codigo)) {
                resultados.push(selector.id ? `#${selector.id}` : null);
            }
        }
        return resultados.filter(r => r !== null);
    }, codigoProducto);
    
    console.log(`   Selectores encontrados (orden de tabla): ${selectoresEncontrados.join(', ')}`);
    
    // Procesar cada selector individualmente, cerrando el dropdown antes de cada uno
    for (let i = 0; i < selectoresEncontrados.length; i++) {
        const selector = selectoresEncontrados[i];
        
        // Cerrar cualquier dropdown abierto
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(200);
        
        // Hacer clic en el selector
        await this.page.click(selector);
        await this.page.waitForTimeout(200);
        
        // Cerrar el dropdown que se abrió
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(200);
        
        // Obtener el precio usando Tab (desde el selector correcto)
        const precio = await this.productLoader.obtenerPrecioConTab();
        precios.push(precio);
        console.log(`   Producto ${i+1} (${selector}) - Precio: ${precio}`);
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
                    
                    const precios = await this.leerPreciosConTab(codigoProducto);
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