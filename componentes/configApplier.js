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
        // El precio CON IVA de cada producto está en el input cuyo name termina
        // en "].TotalIVA". El prefijo de la tabla cambia según el documento
        // (ListaProductoVenta, ListaProductoPresupuestoVenta, etc.), así que
        // matcheamos el patrón y excluimos "Libre". Se filtra precio 0 (fila vacía).
        const precios = await this.page.evaluate(() => {
            const reId = /^(ListaProducto(?!Libre)\w*Venta)\[(.+?)\]\.ProductoId$/;
            const aNumero = (txt) => parseFloat((txt || '').replace(/\./g, '').replace(',', '.')) || 0;
            const IVA = 0.21; // presupuestos no guardan el IVA por línea: lo calculamos
            const precioConIva = (prefijo, guid) => {
                const tIva = document.querySelector(`input[name="${prefijo}[${guid}].TotalIVA"]`);
                if (tIva) return aNumero(tIva.value);
                const tot = document.querySelector(`input[name="${prefijo}[${guid}].Total"]`);
                return tot ? Math.round(aNumero(tot.value) * (1 + IVA) * 100) / 100 : 0;
            };
            const resultados = [];
            document.querySelectorAll('input[name$=".ProductoId"]').forEach(inp => {
                const m = inp.name.match(reId);
                if (!m || !inp.value || inp.value.trim() === '') return;
                const precio = precioConIva(m[1], m[2]);
                if (precio > 0) resultados.push(precio);
            });
            return resultados;
        });

        console.log(`   Precios obtenidos: ${precios.join(', ')}`);
        return precios;
    }

    async aplicarDescuentoPorItem(valor) {
        // "% Bon./Rec." es el campo Bonificacion de cada producto. Recorremos
        // producto por producto (solo los cargados, TotalIVA > 0) y escribimos el
        // valor en esa columna. Agnóstico al tipo de documento.
        const items = await this.page.evaluate(() => {
            const reId = /^(ListaProducto(?!Libre)\w*Venta)\[(.+?)\]\.ProductoId$/;
            const out = [];
            document.querySelectorAll('input[name$=".ProductoId"]').forEach(inp => {
                const m = inp.name.match(reId);
                if (m && inp.value && inp.value.trim() !== '') out.push({ prefijo: m[1], guid: m[2] });
            });
            return out;
        });

        console.log(`   Aplicando descuento por ítem (${valor}) a ${items.length} producto(s)...`);

        for (const it of items) {
            const input = this.page.locator(`input[name="${it.prefijo}[${it.guid}].Bonificacion"]`);
            await input.scrollIntoViewIfNeeded();
            await input.evaluate(el => el.removeAttribute('readonly')); // por si está soloLectura
            await input.click();
            await input.fill(String(valor));
            await this.page.keyboard.press('Tab'); // blur -> dispara el recálculo
            await this.page.waitForTimeout(400);
            console.log(`   ✅ Ítem ${it.guid} -> % Bon./Rec. = ${valor}`);
        }
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

            case 'descuento_item': {
                await this.aplicarDescuentoPorItem(valor);
                const preciosItem = await this.leerPrecios();
                console.log(`   Precios después del descuento por ítem: ${preciosItem.join(', ')}`);
                console.log(`   ✅ Descuento por ítem aplicado: ${valor}`);
                break;
            }

            default:
                console.log(`Configuración no implementada: ${nombre}`);
        }
        await this.page.waitForTimeout(500);
    }
}

module.exports = { ConfigApplier };