class ConfigApplier {
    constructor(page, documento) {
        this.page = page;
        this.documento = (documento || '').toLowerCase();
    }

    async aplicar(configuraciones, codigoProducto) {
        console.log('📋 Aplicando configuraciones:', configuraciones);
        console.log('📋 Código producto recibido en aplicar:', codigoProducto);

        // Orden fijo de aplicación (NO el del Excel): la alícuota va casi al final
        // porque otras configs la resetean; descuento_global cierra. Las que no
        // estén acá se aplican después, en el orden en que vengan.
        const orden = ['lista_precios', 'moneda', 'cotizacion', 'descuento_item', 'alicuota', 'descuento_global'];
        const peso = (nombre) => { const i = orden.indexOf(nombre); return i === -1 ? orden.length : i; };
        const entradas = Object.entries(configuraciones).sort((a, b) => peso(a[0]) - peso(b[0]));

        const aplicadas = {};
        for (const [nombre, valor] of entradas) {
            const ok = await this.aplicarConfiguracion(nombre, valor, codigoProducto);
            if (ok) aplicadas[nombre] = valor;
        }
        return aplicadas;
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

    async _descubrirSelectsAlicuota(objetivo) {
        return await this.page.evaluate((objetivo) => {
            const reId = /^(ListaProducto(?!Libre)\w*?|ProductosLista)\[(.+?)\]\.ProductoId$/;
            const aNum = (t) => {
                const m = String(t || '').replace(',', '.').match(/-?\d+(\.\d+)?/);
                return m ? parseFloat(m[0]) : NaN;
            };

            const items = [];
            document.querySelectorAll('input[name$=".ProductoId"]').forEach(inp => {
                const m = inp.name.match(reId);
                if (m && inp.value && inp.value.trim() !== '') items.push({ prefijo: m[1], guid: m[2] });
            });

            const selects = [];
            items.forEach(it => {
                const base = `${it.prefijo}[${it.guid}].`;
                const sel = Array.from(document.querySelectorAll('select[name]'))
                    .find(el => el.name.startsWith(base) && /alicuota|aliquota|iva/i.test(el.name));
                if (sel) selects.push({ name: sel.name, opciones: Array.from(sel.options).map(o => o.textContent.trim()) });
            });

            return { itemsCount: items.length, selects };
        }, objetivo);
    }

    async _leerAlicuotasActuales(names) {
        return await this.page.evaluate((names) => {
            const aNum = (t) => {
                const m = String(t || '').replace(',', '.').match(/-?\d+(\.\d+)?/);
                return m ? parseFloat(m[0]) : NaN;
            };
            return names.map(n => {
                const s = document.querySelector(`select[name="${n}"]`);
                const o = s ? s.options[s.selectedIndex] : null;
                return { name: n, pct: o ? aNum(o.textContent) : NaN };
            });
        }, names);
    }

    async _setAlicuota(name, objetivo) {
        return await this.page.evaluate(({ name, objetivo }) => {
            const aNum = (t) => { const m = String(t || '').replace(',', '.').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : NaN; };
            const s = document.querySelector(`select[name="${name}"]`);
            if (!s) return false;
            const opt = Array.from(s.options).find(o => Math.abs(aNum(o.textContent) - objetivo) < 0.01);
            if (!opt) return false;
            s.value = opt.value;
            if (window.jQuery) {
                try { jQuery(s).val(opt.value).trigger('chosen:updated').trigger('change'); } catch (e) {}
            } else {
                s.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return true;
        }, { name, objetivo });
    }

    async aplicarAlicuota(valor) {
        const objetivo = parseFloat(String(valor).replace('%', '').replace(',', '.')) || 0;
        console.log(`   Aplicando alícuota de IVA = ${objetivo}% a los ítems cargados...`);

        if (this.documento !== 'factura' && this.documento !== 'remito') {
            console.log(`   ⚠️ ${this.documento} lee el precio como Total×1,21 (IVA fijo 21%); si la alícuota no es 21% puede no reflejarse.`);
        }

        const { itemsCount, selects } = await this._descubrirSelectsAlicuota(objetivo);
        if (selects.length === 0) {
            console.log(`   ⚠️ No encontré ningún select de alícuota en las filas (ítems: ${itemsCount}).`);
            return false;
        }

        const names = selects.map(s => s.name);
        console.log(`   Ítems: ${itemsCount}  |  opciones: ${selects[0].opciones.join(' / ')}`);

        for (let pasada = 1; pasada <= 6; pasada++) {
            const actuales = await this._leerAlicuotasActuales(names);
            const faltan = names.filter((n, i) => Math.abs(actuales[i].pct - objetivo) >= 0.01);
            if (faltan.length === 0) {
                console.log(`   Pasada ${pasada}: ${names.length} ítem(s) en ${objetivo}%, esperando recálculo...`);
                await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
                await this.page.waitForTimeout(2500);
                const reCheck = await this._leerAlicuotasActuales(names);
                if (reCheck.every(a => Math.abs(a.pct - objetivo) < 0.01)) {
                    console.log(`   ✅ Los ${names.length} ítem(s) quedaron con alícuota = ${objetivo}%`);
                    break;
                }
                console.log(`   ⚠️ El servidor revirtió la alícuota, re-aplicando...`);
                continue;
            }
            console.log(`   Pasada ${pasada}: ${faltan.length} ítem(s) sin la alícuota, re-aplicando...`);
            for (const n of faltan) await this._setAlicuota(n, objetivo);
            await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
            await this.page.waitForTimeout(800);
        }

        await this.page.waitForTimeout(1000);
        const fin = await this._leerAlicuotasActuales(names);
        return fin.every(a => Math.abs(a.pct - objetivo) < 0.01);
    }

    async aplicarCotizacion(valor) {
        const objetivo = parseFloat(String(valor).replace(/\./g, '').replace(',', '.'));
        console.log(`   Aplicando cotización = ${valor} (objetivo ${objetivo})`);

        const estado = await this.page.evaluate(() => {
            return Array.from(document.querySelectorAll('input[name="CotizacionDolar"]')).map(el => ({
                value: el.value, visible: !!el.offsetParent, readonly: el.readOnly, disabled: el.disabled,
            }));
        });
        console.log(`   🔎 Campos CotizacionDolar: ${JSON.stringify(estado)}`);
        if (estado.length === 0) {
            console.log('   ⚠️ No hay campo de cotización (¿la moneda quedó en peso o no se aplicó?)');
            return false;
        }

        const aNum = (t) => parseFloat(String(t || '').replace(/\./g, '').replace(',', '.'));

        for (let pasada = 1; pasada <= 4; pasada++) {
            const cot = this.page.locator('input[name="CotizacionDolar"]:visible').first();
            try {
                await cot.waitFor({ state: 'visible', timeout: 5000 });
            } catch (e) {
                console.log('   ⚠️ El campo de cotización no está visible');
                return false;
            }
            await cot.evaluate(el => { el.removeAttribute('readonly'); el.removeAttribute('disabled'); });
            await cot.click();
            await cot.fill('');
            await cot.type(String(valor));
            await this.page.keyboard.press('Tab');
            await this.page.evaluate((v) => {
                const el = Array.from(document.querySelectorAll('input[name="CotizacionDolar"]')).find(e => e.offsetParent);
                if (!el) return;
                el.value = v;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                if (window.jQuery) { try { jQuery(el).trigger('input').trigger('change').blur(); } catch (e) {} }
            }, String(valor));
            await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
            await this.page.waitForTimeout(1500);

            const actual = await cot.inputValue().catch(() => '');
            console.log(`   Pasada ${pasada}: cotización quedó en "${actual}"`);
            if (Math.abs(aNum(actual) - objetivo) < 0.01) {
                console.log(`   ✅ Cotización aplicada: ${valor}`);
                await this.leerPrecios();
                return true;
            }
            console.log('   ⚠️ La cotización no quedó / revirtió, reintento...');
        }
        return false;
    }

    async aplicarConfiguracion(nombre, valor, codigoProducto) {
        console.log(`⚙️ Aplicando configuración: ${nombre} = ${valor}`);

        let aplicada = false;
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
                    aplicada = true;
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
                    aplicada = true;
                } catch (e) {
                    console.log(`   ⚠️ No pude aplicar moneda (¿el documento la tiene?): ${e.message}`);
                }
                break;
                
            case 'cotizacion':
                try {
                    aplicada = await this.aplicarCotizacion(valor);
                } catch (e) {
                    console.log(`   ⚠️ No pude aplicar cotización: ${e.message}`);
                }
                break;
                
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
                        aplicada = true;
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
                    aplicada = true;
                } catch (e) {
                    console.log(`   ⚠️ No pude aplicar descuento por ítem: ${e.message}`);
                }
                break;
            }

            case 'alicuota': {
                try {
                    if (await this.aplicarAlicuota(valor)) {
                        const preciosAli = await this.leerPrecios();
                        console.log(`   Precios después de la alícuota: ${preciosAli.join(', ')}`);
                        console.log(`   ✅ Alícuota aplicada: ${valor}`);
                        aplicada = true;
                    }
                } catch (e) {
                    console.log(`   ⚠️ No pude aplicar alícuota: ${e.message}`);
                }
                break;
            }

            default:
                console.log(`Configuración no implementada: ${nombre}`);
        }
        await this.page.waitForTimeout(500);
        return aplicada;
    }
}

module.exports = { ConfigApplier };