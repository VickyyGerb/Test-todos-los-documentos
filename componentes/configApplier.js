class ConfigApplier {
    constructor(page) {
        this.page = page;
    }

    async aplicar(configuraciones, codigoProducto) {
        console.log('📋 Aplicando configuraciones:', configuraciones);
        console.log('📋 Código producto recibido en aplicar:', codigoProducto);
        for (const [nombre, valor] of Object.entries(configuraciones)) {
            await this.aplicarConfiguracion(nombre, valor, codigoProducto);
        }
    }

    async leerPrecios() {
        // No usamos Tab con IDs #select2-chosen-N fijos: después de aplicar una
        // configuración las filas se vuelven a renderizar y esos IDs quedan
        // obsoletos. El precio CON IVA de cada producto está en el input cuyo
        // name termina en "].TotalIVA" dentro de ListaProductoVenta. Se excluye
        // la fila vacía de template filtrando precio 0.
        const precios = await this.page.evaluate(() => {
            const aNumero = (txt) => parseFloat((txt || '').replace(/\./g, '').replace(',', '.'));
            const resultados = [];
            const inputs = document.querySelectorAll('input[name^="ListaProductoVenta["][name$="].TotalIVA"]');
            inputs.forEach(inp => {
                const precio = aNumero(inp.value);
                if (!isNaN(precio) && precio > 0) {
                    resultados.push(precio);
                }
            });
            return resultados;
        });

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
                    
                    const precios = await this.leerPrecios();
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
                await this.leerPrecios();
                console.log(`   ✅ Moneda aplicada: ${valor}`);
                break;
                
            case 'cotizacion':
                await this.page.fill('#cotizacion', valor);
                await this.leerPrecios();
                console.log(`   ✅ Cotización aplicada: ${valor}`);
                break;
                
            case 'lista_precios':
                await this.page.click('#ListaDePreciosVentaId_chosen .chosen-single');
                await this.page.keyboard.type(valor);
                await this.page.keyboard.press('Enter');
                await this.leerPrecios();
                console.log(`   ✅ Lista de precios aplicada: ${valor}`);
                break;
                
            default:
                console.log(`Configuración no implementada: ${nombre}`);
        }
        await this.page.waitForTimeout(500);
    }
}

module.exports = { ConfigApplier };