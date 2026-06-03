class ConfigApplier {
    constructor(page, documento) {
        this.page = page;
        this.documento = (documento || '').toLowerCase();
    }

    async aplicar(configuraciones, codigoProducto) {
        console.log('📋 Aplicando configuraciones:', configuraciones);
        console.log('📋 Código producto recibido en aplicar:', codigoProducto);

        for (const [nombre, valor] of Object.entries(configuraciones)) {
            await this.aplicarConfiguracion(nombre, valor, codigoProducto);
        }
    }

    async leerPrecios() {
        
        const precios = await this.page.evaluate((doc) => {
            const reId = /^(ListaProducto(?!Libre)\w*?|ProductosLista)\[(.+?)\]\.ProductoId$/;
            const aNumero = (txt) => parseFloat((txt || '').replace(/\./g, '').replace(',', '.')) || 0;
            const IVA = 0.21;
            // Remito no maneja IVA: el Total ya es el precio final (factor 1).
            const factor = doc === 'remito' ? 1 : (1 + IVA);
            const precioConIva = (prefijo, guid) => {
                const tIva = document.querySelector(`input[name="${prefijo}[${guid}].TotalIVA"]`);
                if (tIva) return aNumero(tIva.value);
                const tot = document.querySelector(`input[name="${prefijo}[${guid}].Total"]`);
                return tot ? Math.round(aNumero(tot.value) * factor * 100) / 100 : 0;
            };
            const resultados = [];
            document.querySelectorAll('input[name$=".ProductoId"]').forEach(inp => {
                const m = inp.name.match(reId);
                if (!m || !inp.value || inp.value.trim() === '') return;
                const precio = precioConIva(m[1], m[2]);
                if (precio > 0) resultados.push(precio);
            });
            return resultados;
        }, this.documento);

        console.log(`   Precios obtenidos: ${precios.join(', ')}`);
        return precios;
    }

    async aplicarDescuentoPorItem(valor) {
        
        const items = await this.page.evaluate(() => {
            const reId = /^(ListaProducto(?!Libre)\w*?|ProductosLista)\[(.+?)\]\.ProductoId$/;
            const out = [];
            document.querySelectorAll('input[name$=".ProductoId"]').forEach(inp => {
                const m = inp.name.match(reId);
                if (m && inp.value && inp.value.trim() !== '') out.push({ prefijo: m[1], guid: m[2] });
            });
            return out;
        });

        console.log(`   Aplicando descuento por ítem (${valor}) a ${items.length} producto(s)...`);

        const esperado = parseFloat(String(valor).replace(',', '.'));

        const ponerBonif = async (it) => {
            const input = this.page.locator(`input[name="${it.prefijo}[${it.guid}].Bonificacion"]`);
            await input.scrollIntoViewIfNeeded();
            await input.evaluate(el => el.removeAttribute('readonly')); // por si está soloLectura
            await input.click();
            await input.fill(String(valor));
            await this.page.keyboard.press('Tab'); // blur -> dispara el recálculo
            await this.page.waitForTimeout(400);
        };

        const bonifActual = async (it) => {
            const input = this.page.locator(`input[name="${it.prefijo}[${it.guid}].Bonificacion"]`);
            return parseFloat(((await input.inputValue()) || '').replace(',', '.')) || 0;
        };

        // El recálculo re-dibuja la tabla y a veces "pierde" el descuento en filas
        // ya editadas. Pasamos varias veces re-aplicando sólo las que no quedaron.
        for (let pasada = 1; pasada <= 4; pasada++) {
            const faltan = [];
            for (const it of items) {
                if (await bonifActual(it) !== esperado) faltan.push(it);
            }
            if (faltan.length === 0) {
                console.log(`   ✅ Los ${items.length} ítems quedaron con % Bon./Rec. = ${valor}`);
                break;
            }
            console.log(`   Pasada ${pasada}: ${faltan.length} ítem(s) sin el descuento, re-aplicando...`);
            for (const it of faltan) await ponerBonif(it);
            await this.page.waitForTimeout(800);
        }

        await this.page.waitForTimeout(1000); // que se asiente el recálculo final
    }

    async aplicarConfiguracion(nombre, valor, codigoProducto) {
        console.log(`⚙️ Aplicando configuración: ${nombre} = ${valor}`);
        
        switch(nombre) {
            case 'descuento_global': {
                try {
                    // Con "%" (ej. "%5" o "5%") => descuento porcentual (#Descuento).
                    // Sin "%" (ej. "5") => descuento por monto fijo $ (#ValorDescuento).
                    const esPorcentaje = String(valor).includes('%');
                    const numero = String(valor).replace('%', '').trim();
                    const campoId = esPorcentaje ? '#Descuento' : '#ValorDescuento';
                    console.log(`   Aplicando descuento global: ${numero} ${esPorcentaje ? '(porcentaje)' : '(monto fijo $)'} -> ${campoId}`);

                    const leerTotales = () => this.page.evaluate(() => {
                        const g = (id) => { const e = document.getElementById(id); return e ? e.value : '(n/a)'; };
                        return `Descuento%=${g('Descuento')}  ValorDescuento=${g('ValorDescuento')}  Subtotal=${g('SubtotalNetoGravado')}  TotalTemp=${g('TotalTemp')}`;
                    });
                    console.log('   📊 ANTES:   ' + await leerTotales());

                    const input = this.page.locator(campoId);
                    await input.scrollIntoViewIfNeeded();
                    await input.evaluate(el => el.removeAttribute('readonly'));
                    await input.click();
                    await input.fill(numero);
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
                try {
                    await this.page.locator('#MonedaId_chosen .chosen-single').click();
                    await this.page.keyboard.type(valor);
                    await this.page.keyboard.press("Enter");
                    await this.leerPrecios();
                    console.log(`   ✅ Moneda aplicada: ${valor}`);
                } catch (e) {
                    console.log(`   ⚠️ No pude aplicar moneda (¿el documento la tiene?): ${e.message}`);
                }
                break;
                
            case 'cotizacion': {
              
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
                if (this.documento === 'pedido') {
                    console.log('   ⏭️ Pedido no usa lista de precios — se omite');
                    break;
                }
                try {
                    const chosen = this.page.locator('#ListaDePreciosVentaId_chosen .chosen-single');
                    if (await chosen.count()) {
                        await chosen.click();
                        await this.page.keyboard.type(valor);
                        await this.page.keyboard.press('Enter');
                        await this.leerPrecios();
                        console.log(`   ✅ Lista de precios aplicada: ${valor}`);
                    } else {
                        const cand = await this.page.evaluate(() => {
                            const out = [];
                            document.querySelectorAll('select, .chosen-container, .select2-container').forEach(el => {
                                if (/precio/i.test(`${el.id} ${el.name || ''}`)) out.push(`<${el.tagName.toLowerCase()}> id=${el.id || '-'} name=${el.name || '-'}`);
                            });
                            return out;
                        });
                        console.log(`   ⚠️ No encontré el "chosen" de lista de precios en este documento.`);
                        console.log(`   🔎 Candidatos (id/name con "precio"): ${cand.join(' | ') || '(ninguno)'}`);
                    }
                } catch (e) {
                    console.log(`   ⚠️ No pude aplicar lista de precios: ${e.message}`);
                }
                break;

            case 'descuento_item': {
                try {
                    await this.aplicarDescuentoPorItem(valor);
                    const preciosItem = await this.leerPrecios();
                    console.log(`   Precios después del descuento por ítem: ${preciosItem.join(', ')}`);
                    console.log(`   ✅ Descuento por ítem aplicado: ${valor}`);
                } catch (e) {
                    console.log(`   ⚠️ No pude aplicar descuento por ítem: ${e.message}`);
                }
                break;
            }

            default:
                console.log(`Configuración no implementada: ${nombre}`);
        }
        await this.page.waitForTimeout(500);
    }
}

module.exports = { ConfigApplier };