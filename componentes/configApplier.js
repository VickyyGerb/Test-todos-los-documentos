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
        
        const precios = await this.page.evaluate(() => {
            const reId = /^(ListaProducto(?!Libre)\w*?)\[(.+?)\]\.ProductoId$/;
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
        
        const items = await this.page.evaluate(() => {
            const reId = /^(ListaProducto(?!Libre)\w*?)\[(.+?)\]\.ProductoId$/;
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
            case 'descuento_global': {
                try {
                    console.log(`   Aplicando descuento global: ${valor}`);
                    // El descuento global es a nivel documento (#Descuento = %),
                    // no por producto. Logueamos los totales antes/después para
                    // ver si se aplica y dónde se refleja.
                    const leerTotales = () => this.page.evaluate(() => {
                        const g = (id) => { const e = document.getElementById(id); return e ? e.value : '(n/a)'; };
                        return `Descuento%=${g('Descuento')}  ValorDescuento=${g('ValorDescuento')}  Subtotal=${g('SubtotalNetoGravado')}  TotalTemp=${g('TotalTemp')}`;
                    });
                    console.log('   📊 ANTES:   ' + await leerTotales());

                    const input = this.page.locator('#Descuento');
                    await input.scrollIntoViewIfNeeded();
                    await input.evaluate(el => el.removeAttribute('readonly'));
                    await input.click();
                    await input.fill(String(valor));
                    await this.page.keyboard.press('Tab');
                    await this.page.waitForTimeout(1500);

                    console.log('   📊 DESPUÉS: ' + await leerTotales());
                    console.log(`   ✅ Descuento global aplicado: ${valor}`);
                } catch (e) {
                    console.log(`   ❌ Error: ${e.message}`);
                }
                break;
            }
                
            case 'moneda':
                await this.page.locator('#MonedaId_chosen .chosen-single').click();        
                await this.page.keyboard.type(valor); 
                await this.page.keyboard.press("Enter");
                await this.leerPrecios();
                console.log(`   ✅ Moneda aplicada: ${valor}`);
                break;
                
            case 'cotizacion': {
                // La cotización solo es editable con moneda extranjera elegida. El
                // campo visible/editable es CotizacionDolarGeneral (NuevaCotizacionDolar
                // queda oculto; CotizacionDolar es solo display). Llenar + Tab para
                // recalcular. Si no está visible (sin moneda extranjera), se avisa.
                try {
                    const cot = this.page.locator('input[name="CotizacionDolar"]:visible').first();
                    await cot.waitFor({ state: 'visible', timeout: 5000 });
                    await cot.evaluate(el => el.removeAttribute('readonly'));
                    await cot.fill(String(valor));
                    await this.page.keyboard.press('Tab');
                    await this.page.waitForTimeout(1500);
                    await this.leerPrecios();
                    console.log(`   ✅ Cotización aplicada: ${valor}`);
                } catch (e) {
                    console.log(`   ⚠️ No pude aplicar cotización (¿el caso tiene moneda extranjera?): ${e.message}`);
                }
                break;
            }
                
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