const { leerLineasProducto } = require('../utiles/lecturaPrecios');

function canonConfig(nombre) {
    let n = String(nombre || '').replace(/\s+/g, '_').replace('rango_de_precios', 'rango_precios');
    if (/^reglas?_(de_)?descuentos?$/.test(n)) n = 'regla_descuento';
    if (/^guarda.*dolar/.test(n))             n = 'guardar_en_dolar';
    if (/^tipo(_factura)?$/.test(n) || /^tipo.*factura/.test(n)) n = 'tipo_factura';
    if (/^n.mero/.test(n))                    n = 'numero';
    if (/^fecha.?entrega/.test(n))            n = 'fecha_entrega';
    return n;
}

class ConfigApplier {
    constructor(page, documento) {
        this.page = page;
        this.documento = (documento || '').toLowerCase();
    }

    async aplicar(configuraciones, codigoProducto) {
        console.log('📋 Aplicando configuraciones:', configuraciones);
        console.log('📋 Código producto recibido en aplicar:', codigoProducto);

        const orden = ['rango_precios', 'lista_precios', 'moneda', 'cotizacion', 'descuento_item', 'alicuota', 'descuento_global'];
        const peso = (nombre) => { const i = orden.indexOf(canonConfig(nombre)); return i === -1 ? orden.length : i; };
        const entradas = Object.entries(configuraciones).sort((a, b) => peso(a[0]) - peso(b[0]));

        const aplicadas = {};
        for (const [nombre, valor] of entradas) {
            const ok = await this.aplicarConfiguracion(nombre, valor, codigoProducto);
            if (ok) aplicadas[nombre] = valor;
        }
        return aplicadas;
    }

    async leerPrecios() {
        const lineas = await this.page.evaluate(leerLineasProducto, this.documento);
        const precios = lineas.map(l => l.total).filter(p => p > 0);
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
            if (await input.count() === 0) return;
            const st = await input.evaluate(el => ({ disabled: el.disabled, visible: !!el.offsetParent })).catch(() => ({ disabled: true, visible: false }));
            if (st.disabled || !st.visible) { console.log('   ⏭️ Bonificación deshabilitada/oculta en una línea -> se omite ese ítem'); return; }
            await input.scrollIntoViewIfNeeded();
            await input.evaluate(el => el.removeAttribute('readonly'));
            await input.click({ timeout: 6000 });
            await input.fill(String(valor));
            await this.page.keyboard.press('Tab');
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

        await this.page.waitForTimeout(1000);
    }

    async aplicarRangoPrecios(valor) {
        const cantidad = parseFloat(String(valor).replace(',', '.'));
        if (!(cantidad > 0)) {
            console.log(`   ⚠️ Rango de precios: cantidad inválida "${valor}"`);
            return false;
        }

        const items = await this.page.evaluate(() => {
            const reId = /^(ListaProducto(?!Libre)\w*?|ProductosLista)\[(.+?)\]\.ProductoId$/;
            const out = [];
            document.querySelectorAll('input[name$=".ProductoId"]').forEach(inp => {
                const m = inp.name.match(reId);
                if (m && inp.value && inp.value.trim() !== '') out.push({ prefijo: m[1], guid: m[2] });
            });
            return out;
        });

        console.log(`   Aplicando cantidad ${cantidad} a ${items.length} línea(s) (rango de precios)...`);

        const cantidadActual = async (it) => {
            const input = this.page.locator(`input[name="${it.prefijo}[${it.guid}].Cantidad"]`);
            if (await input.count() === 0) return NaN;
            return parseFloat(((await input.inputValue()) || '').replace(',', '.')) || 0;
        };

        const ponerCantidad = async (it) => {
            const input = this.page.locator(`input[name="${it.prefijo}[${it.guid}].Cantidad"]`);
            if (await input.count() === 0) {
                const campos = await this.page.evaluate((g) =>
                    Array.from(document.querySelectorAll('input[name], select[name]'))
                        .map(e => e.name).filter(n => n.includes(g)), it.guid);
                console.log(`   ⚠️ No encontré el campo "Cantidad" de la línea. Campos: ${campos.join(', ') || '(ninguno)'}`);
                return;
            }
            const st = await input.evaluate(el => ({ disabled: el.disabled, visible: !!el.offsetParent })).catch(() => ({ disabled: true, visible: false }));
            if (st.disabled || !st.visible) { console.log('   ⏭️ Cantidad deshabilitada/oculta en una línea -> se omite el rango en ese ítem'); return; }
            await input.scrollIntoViewIfNeeded();
            await input.evaluate(el => el.removeAttribute('readonly'));
            await input.click({ timeout: 6000 });
            await input.fill(String(cantidad));
            await this.page.keyboard.press('Tab');
            await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
            await this.page.waitForTimeout(800);
        };

        for (let pasada = 1; pasada <= 4; pasada++) {
            const faltan = [];
            for (const it of items) {
                if (await cantidadActual(it) !== cantidad) faltan.push(it);
            }
            if (faltan.length === 0) {
                console.log(`   ✅ Las ${items.length} línea(s) quedaron con cantidad = ${cantidad}`);
                break;
            }
            console.log(`   Pasada ${pasada}: ${faltan.length} línea(s) sin la cantidad, re-aplicando...`);
            for (const it of faltan) await ponerCantidad(it);
            await this.page.waitForTimeout(1000);
        }

        await this.page.waitForTimeout(1000);
        return true;
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

    async aplicarMoneda(valor) {
        const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
        const objetivo = norm(valor);

        const leerMoneda = () => this.page.evaluate(() => {
            const s = document.getElementById('MonedaId');
            if (!s) return null;
            const o = s.options[s.selectedIndex];
            return o ? o.textContent.trim() : null;
        });

        const inicial = await leerMoneda();
        if (inicial === null) {
            console.log('   ⚠️ No hay combo de moneda (#MonedaId) en este documento — se omite');
            return false;
        }
        console.log(`   Moneda actual: "${inicial}"  ->  objetivo "${valor}"`);

        const coincide = (txt) => !!txt && norm(txt).includes(objetivo);

        for (let intento = 1; intento <= 3; intento++) {
            if (intento === 1) {
                try {
                    await this.page.locator('#MonedaId_chosen .chosen-single').click();
                    await this.page.waitForTimeout(300);
                    await this.page.keyboard.type(valor);
                    await this.page.waitForTimeout(400);
                    await this.page.keyboard.press('Enter');
                } catch (e) { }
            } else {
                await this.page.evaluate((obj) => {
                    const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
                    const s = document.getElementById('MonedaId');
                    if (!s) return;
                    const opt = Array.from(s.options).find(o => norm(o.textContent).includes(obj));
                    if (!opt) return;
                    s.value = opt.value;
                    if (window.jQuery) { try { jQuery(s).val(opt.value).trigger('chosen:updated').trigger('change'); } catch (e) {} }
                    else s.dispatchEvent(new Event('change', { bubbles: true }));
                }, objetivo);
            }
            await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
            await this.page.waitForTimeout(1000);

            const actual = await leerMoneda();
            console.log(`   Intento ${intento}: moneda quedó en "${actual}"`);
            if (coincide(actual)) {
                await this.leerPrecios();
                console.log(`   ✅ Moneda aplicada: ${valor}`);
                return true;
            }
        }

        console.log(`   ⚠️ No pude confirmar el cambio de moneda a "${valor}"`);
        return false;
    }

    async _marcarCheckboxPorLabel(labelTexto, activar) {
        const result = await this.page.evaluate((txt) => {
            const norm = t => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
            // Estrategia 1: <label> clásico
            for (const label of document.querySelectorAll('label')) {
                if (!norm(label.textContent).includes(norm(txt))) continue;
                const cb = label.querySelector('input[type="checkbox"]')
                    || (label.getAttribute('for') && document.getElementById(label.getAttribute('for')));
                if (!cb || cb.type !== 'checkbox') continue;
                return { encontrado: true, id: cb.id || null, name: cb.name || null };
            }
            // Estrategia 2: cualquier elemento de texto (span, div, td, p…) con checkbox cercano (sistemas React)
            for (const el of document.querySelectorAll('span, p, div, td, th, strong, small, b')) {
                if (el.children.length > 0) continue;
                if (!norm(el.textContent).includes(norm(txt))) continue;
                const parent = el.closest('div, tr, li, td, section');
                if (!parent) continue;
                const cb = parent.querySelector('input[type="checkbox"]');
                if (cb) return { encontrado: true, id: cb.id || null, name: cb.name || null };
            }
            return { encontrado: false };
        }, labelTexto);

        if (!result.encontrado) {
            console.log(`   ⚠️ No encontré el checkbox "${labelTexto}"`);
            return false;
        }
        const sel = result.id ? `#${result.id}` : `input[name="${result.name}"]`;
        const cb = this.page.locator(sel).first();
        if ((await cb.isChecked()) !== activar) await cb.click();
        await this.page.waitForTimeout(500);
        return true;
    }

    async _seleccionarSelectPorLabel(labelTexto, valor) {
        const selectId = await this.page.evaluate((txt) => {
            const norm = t => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
            for (const label of document.querySelectorAll('label')) {
                if (!norm(label.textContent).includes(norm(txt))) continue;
                const forAttr = label.getAttribute('for');
                if (!forAttr) continue;
                const el = document.getElementById(forAttr);
                if (el && el.tagName === 'SELECT') return el.id;
            }
            return null;
        }, labelTexto);

        if (!selectId) {
            console.log(`   ⚠️ No encontré el select "${labelTexto}"`);
            return false;
        }

        // Primero intentar via jQuery/Chosen API (funciona sin importar si tiene buscador o no)
        const setOk = await this.page.evaluate(({ id, val }) => {
            const norm = t => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
            const s = document.getElementById(id);
            if (!s) return false;
            const opt = Array.from(s.options).find(o => norm(o.textContent).includes(norm(val)) || norm(o.value) === norm(val));
            if (!opt) return false;
            s.value = opt.value;
            if (window.jQuery) {
                try { jQuery(s).val(opt.value).trigger('chosen:updated').trigger('change'); } catch (e) {}
            } else {
                s.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return true;
        }, { id: selectId, val: valor });

        if (setOk) {
            await this.page.waitForTimeout(800);
            return true;
        }

        // Fallback UI: abrir el Chosen y clickear la opción por texto (sin tipear)
        const chosen = this.page.locator(`#${selectId}_chosen .chosen-single`);
        if (await chosen.count()) {
            await chosen.click();
            await this.page.waitForTimeout(500);
            const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
            const clicked = await this.page.locator('.chosen-results li.active-result').evaluateAll((items, v) => {
                const n = t => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
                const item = items.find(li => n(li.textContent).includes(n(v)));
                if (item) { item.click(); return true; }
                return false;
            }, valor);
            if (!clicked) {
                await this.page.keyboard.press('Escape').catch(() => {});
                console.log(`   ⚠️ No encontré la opción "${valor}" en ${selectId}`);
                return false;
            }
        }

        await this.page.waitForTimeout(800);
        return true;
    }

    async _llenarInputPorLabel(labelTexto, valor) {
        const result = await this.page.evaluate((txt) => {
            const norm = t => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
            for (const label of document.querySelectorAll('label')) {
                if (!norm(label.textContent).includes(norm(txt))) continue;
                // Estrategia 1: label con for apuntando a un input
                const forAttr = label.getAttribute('for');
                if (forAttr) {
                    const el = document.getElementById(forAttr);
                    if (el && ['INPUT', 'TEXTAREA'].includes(el.tagName)) return { encontrado: true, id: forAttr };
                }
                // Estrategia 2: input.form-control más cercano al label (sistemas sin for).
                // En layouts React (Bootstrap Row/Col) label e input suelen estar en Col
                // hermanas dentro de un mismo Row, no en el mismo div — probar varios niveles.
                const scopes = [
                    label.closest('.row'),
                    label.closest('div, td, .form-group, .field, li'),
                    label.parentElement?.parentElement,
                ].filter(Boolean);
                for (const scope of scopes) {
                    const inp = scope.querySelector('input.form-control, textarea.form-control, input[type="text"], input[type="number"]');
                    if (inp) {
                        if (inp.id) return { encontrado: true, id: inp.id };
                        inp.setAttribute('data-fill-target', 'true');
                        return { encontrado: true, id: null, usarAtributo: true };
                    }
                }
            }
            return { encontrado: false };
        }, labelTexto);

        if (!result.encontrado) {
            const labelsDisponibles = await this.page.evaluate(() =>
                Array.from(document.querySelectorAll('label'))
                    .map(l => l.textContent.replace(/\s+/g, ' ').trim())
                    .filter(t => t && t.length < 60)
                    .slice(0, 40)
            );
            console.log(`   ⚠️ No encontré el campo "${labelTexto}". Labels: ${labelsDisponibles.join(' | ') || '(ninguno)'}`);
            return false;
        }

        const input = result.id
            ? this.page.locator(`#${result.id}`)
            : this.page.locator('[data-fill-target="true"]');
        await input.scrollIntoViewIfNeeded();
        await input.click({ timeout: 6000 });
        await input.fill(String(valor));
        await this.page.keyboard.press('Tab');
        await this.page.waitForTimeout(500);
        // Limpiar atributo temporal si se usó
        if (result.usarAtributo) await input.evaluate(el => el.removeAttribute('data-fill-target')).catch(() => {});
        return true;
    }

    async _aplicarTipoFacturaCompra(valor) {
        // Esperar a que el select de "tipo" exista en el DOM (Fidel puede tardar en renderizarlo
        // después de elegir cuenta/proveedor) antes de darlo por no encontrado.
        const timeoutMs = 8000;
        const intervalo = 400;
        let hayCandidato = false;
        for (let t = 0; t < timeoutMs; t += intervalo) {
            hayCandidato = await this.page.evaluate(() =>
                Array.from(document.querySelectorAll('select')).some(s => /tipo/i.test(s.id + ' ' + (s.name || '')) && s.options.length > 1));
            if (hayCandidato) break;
            await this.page.waitForTimeout(intervalo);
        }
        if (!hayCandidato) {
            console.log(`   ⚠️ El select de "tipo" no apareció en ${timeoutMs}ms`);
        }

        // Escanear selects por ID/name con "tipo" — más fiable que buscar por label en forms legacy
        const info = await this.page.evaluate((val) => {
            const norm = t => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
            let candidatos = Array.from(document.querySelectorAll('select'))
                .filter(s => /tipo/i.test(s.id + ' ' + (s.name || '')));
            if (!candidatos.length) {
                const todos = Array.from(document.querySelectorAll('select'))
                    .map(s => `${s.id || s.name || '?'}`)
                    .filter(Boolean).slice(0, 20);
                return { ok: false, motivo: 'no-select', todos };
            }
            // Priorizar el select de "tipo de comprobante" (ej: TipoComprobanteId) por sobre otros
            // "tipo" que puedan existir en la página (TipoDocumentoId, TipoIvaId, etc.)
            candidatos = candidatos.sort((a, b) => {
                const pa = /comprobante|factura/i.test(a.id + ' ' + (a.name || '')) ? 0 : 1;
                const pb = /comprobante|factura/i.test(b.id + ' ' + (b.name || '')) ? 0 : 1;
                return pa - pb;
            });
            // Probar TODOS los candidatos antes de rendirse — no cortar en el primero sin la opción
            let sinOpcion = null;
            for (const s of candidatos) {
                const opciones = Array.from(s.options).map(o => o.textContent.trim());
                const opt = Array.from(s.options).find(o =>
                    norm(o.textContent) === norm(val) || norm(o.value) === norm(val) || norm(o.textContent).includes(norm(val)));
                if (!opt) { if (!sinOpcion) sinOpcion = { id: s.id, opciones }; continue; }
                s.value = opt.value;
                if (window.jQuery) { try { jQuery(s).val(opt.value).trigger('chosen:updated').trigger('change'); } catch(e) {} }
                else s.dispatchEvent(new Event('change', { bubbles: true }));
                return { ok: true, id: s.id, elegido: opt.textContent.trim() };
            }
            if (sinOpcion) return { ok: false, motivo: 'no-opcion', id: sinOpcion.id, opciones: sinOpcion.opciones };
            return { ok: false, motivo: 'sin-match' };
        }, valor);

        if (!info.ok) {
            if (info.motivo === 'no-select')
                console.log(`   ⚠️ No encontré select con "tipo" en ID/name. Selects: ${(info.todos || []).join(', ') || '(ninguno)'}`);
            else if (info.motivo === 'no-opcion')
                console.log(`   ⚠️ Select "${info.id}" no tiene la opción "${valor}". Opciones: ${(info.opciones || []).join(' / ')}`);
            // Fallback: label "Tipo"
            return await this._seleccionarSelectPorLabel('Tipo', valor);
        }

        // Fidel reconstruye la tabla de productos por AJAX al cambiar el Tipo de comprobante
        // (CambioTipoComprobante -> DetalleProductos), y recién ~2s después agrega la fila
        // vacía (NuevoProducto). Hay que esperar ese ciclo completo antes de tocar el producto.
        await this.page.waitForTimeout(3500);
        console.log(`   🔎 Select "${info.id}" → elegido "${info.elegido}" vía jQuery`);

        // Verificar que el valor quedó (algunos Chosen revierten)
        const norm = t => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
        const actual = await this.page.evaluate((id) => {
            const s = document.getElementById(id);
            return s ? (s.options[s.selectedIndex]?.textContent.trim() || null) : null;
        }, info.id);

        if (actual && norm(actual).includes(norm(valor))) return true;

        // jQuery no surtió efecto — intentar Chosen UI
        console.log(`   ⚠️ jQuery no persistió (actual: "${actual || 'n/a'}"), probando Chosen UI...`);
        const chosenId = `${info.id}_chosen`;
        const chosen = this.page.locator(`#${chosenId} .chosen-single`);
        if (await chosen.count()) {
            try {
                await chosen.scrollIntoViewIfNeeded();
                await chosen.click();
                await this.page.waitForTimeout(500);
                const clicked = await this.page.locator('.chosen-results li.active-result').evaluateAll((items, v) => {
                    const n = t => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
                    const item = items.find(li => n(li.textContent).includes(n(v)));
                    if (item) { item.click(); return true; }
                    return false;
                }, valor);
                if (!clicked) {
                    await this.page.keyboard.press('Escape').catch(() => {});
                    console.log(`   ⚠️ Chosen UI: no encontré la opción "${valor}"`);
                    return false;
                }
                // Mismo motivo que en el camino jQuery: esperar el ciclo AJAX + NuevoProducto (~2s)
                await this.page.waitForTimeout(3500);
                return true;
            } catch (e) {
                console.log(`   ⚠️ Chosen UI falló: ${e.message}`);
                return false;
            }
        }
        return false;
    }

    async aplicarConfiguracion(nombre, valor, codigoProducto) {
        console.log(`⚙️ Aplicando configuración: ${nombre} = ${valor}`);

        let aplicada = false;
        switch(canonConfig(nombre)) {
            case 'rango_precios':
                try {
                    aplicada = await this.aplicarRangoPrecios(valor);
                } catch (e) {
                    console.log(`   ⚠️ No pude aplicar rango de precios: ${e.message}`);
                }
                break;

            case 'descuento_global': {
                try {
                    const esPorcentaje = String(valor).includes('%');
                    const numero = String(valor).replace('%', '').trim();
                    const campoId = esPorcentaje ? '#Descuento' : '#ValorDescuento';
                    console.log(`   Aplicando descuento global: ${numero} ${esPorcentaje ? '(porcentaje)' : '(monto fijo $)'} -> ${campoId}`);

                    const input = this.page.locator(campoId);
                    if (await input.count() === 0) {
                        console.log(`   ⏭️ ${this.documento} no tiene el campo ${campoId} -> se omite el descuento global`);
                        break;
                    }
                    const estado = await input.evaluate(el => ({ disabled: el.disabled, visible: !!el.offsetParent }));
                    if (estado.disabled || !estado.visible) {
                        console.log(`   ⏭️ El campo ${campoId} está ${estado.disabled ? 'deshabilitado' : 'oculto'} en ${this.documento} -> se omite el descuento global`);
                        break;
                    }

                    const leerTotales = () => this.page.evaluate(() => {
                        const g = (id) => { const e = document.getElementById(id); return e ? e.value : '(n/a)'; };
                        return `Descuento%=${g('Descuento')}  ValorDescuento=${g('ValorDescuento')}  Subtotal=${g('SubtotalNetoGravado')}  TotalTemp=${g('TotalTemp')}`;
                    });
                    console.log('   📊 ANTES:   ' + await leerTotales());

                    await input.scrollIntoViewIfNeeded();
                    await input.evaluate(el => el.removeAttribute('readonly'));
                    await input.click({ timeout: 6000 });
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
                if (this.documento === 'venta_unificada') {
                    console.log('   ⏭️ Venta unificada no tiene moneda — se omite');
                    break;
                }
                try {
                    aplicada = await this.aplicarMoneda(valor);
                } catch (e) {
                    console.log(`   ⚠️ No pude aplicar moneda: ${e.message}`);
                }
                break;

            case 'cotizacion':
                if (this.documento === 'venta_unificada') {
                    console.log('   ⏭️ Venta unificada no tiene cotización — se omite');
                    break;
                }
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

            case 'regla_descuento': {
                console.log(`   ℹ️ Regla de descuento (cliente con la regla: ${valor}). El cambio de cliente y la verificación los maneja el orquestador; acá no se aplica nada.`);
                aplicada = true;
                break;
            }

            case 'tipo_factura':
                if (this.documento !== 'factura_compra') {
                    console.log(`   ⏭️ tipo_factura solo aplica a factura_compra — se omite`);
                    break;
                }
                try {
                    aplicada = await this._aplicarTipoFacturaCompra(valor);
                    if (aplicada) console.log(`   ✅ Tipo de factura aplicado: ${valor}`);
                } catch (e) {
                    console.log(`   ⚠️ No pude aplicar tipo de factura: ${e.message}`);
                }
                break;

            case 'numero':
                if (!['factura_compra', 'presupuesto_compra'].includes(this.documento)) {
                    console.log(`   ⏭️ numero solo aplica a factura_compra y presupuesto_compra — se omite`);
                    break;
                }
                try {
                    if (String(valor).includes('-')) {
                        const [puntoVenta, nro] = String(valor).split('-');
                        await this.page.locator('#PuntoVenta').fill(puntoVenta.trim());
                        await this.page.locator('#Numero').fill(nro.trim());
                        console.log(`   ✅ Número aplicado: punto de venta=${puntoVenta.trim()}, número=${nro.trim()}`);
                        aplicada = true;
                    } else {
                        // Intentar por label, luego por ID directo (#Numero es el campo en presupuesto_compra)
                        aplicada = await this._llenarInputPorLabel('Número', valor)
                            || await this._llenarInputPorLabel('Numero', valor);
                        if (!aplicada) {
                            const campo = this.page.locator('#Numero');
                            if (await campo.count() > 0) {
                                await campo.fill(String(valor));
                                aplicada = true;
                            }
                        }
                        if (aplicada) console.log(`   ✅ Número aplicado: ${valor}`);
                    }
                } catch (e) {
                    console.log(`   ⚠️ No pude aplicar número: ${e.message}`);
                }
                break;

            case 'guardar_en_dolar':
                if (!['factura_compra', 'presupuesto_compra'].includes(this.documento)) {
                    console.log(`   ⏭️ guardar_en_dolar solo aplica a compras — se omite`);
                    break;
                }
                // En presupuesto_compra los checkboxes ya vienen activos por defecto en el form
                if (this.documento === 'presupuesto_compra') {
                    console.log(`   ✅ guardar_en_dolar: activo por defecto en presupuesto_compra`);
                    aplicada = true;
                    break;
                }
                try {
                    const activar = /^(si|true|1|yes)$/i.test(String(valor).trim());
                    aplicada = await this._marcarCheckboxPorLabel('dólar', activar)
                        || await this._marcarCheckboxPorLabel('dolar', activar);
                    if (aplicada) console.log(`   ✅ Guardar en dólar: ${activar ? 'activado' : 'desactivado'}`);
                } catch (e) {
                    console.log(`   ⚠️ No pude aplicar guardar en dólar: ${e.message}`);
                }
                break;

            case 'fecha':
                if (!['orden', 'preorden'].includes(this.documento)) {
                    console.log(`   ⏭️ ${this.documento} no tiene campo Fecha específico — se omite`);
                    break;
                }
                try {
                    aplicada = await this._llenarInputPorLabel('Fecha', valor);
                    if (aplicada) console.log(`   ✅ Fecha aplicada: ${valor}`);
                } catch (e) {
                    console.log(`   ⚠️ No pude aplicar fecha: ${e.message}`);
                }
                break;

            case 'vehiculo':
                if (!['orden', 'preorden'].includes(this.documento)) {
                    console.log(`   ⏭️ ${this.documento} no tiene campo Vehículo — se omite`);
                    break;
                }
                try {
                    // React Select (react-select SIN classNamePrefix) cercano al label "Vehículo".
                    // Sin classNamePrefix no hay clases semánticas (usa hashes de emotion), pero
                    // react-select siempre pone id="<inputId>-option-N" y role="option" en las
                    // opciones renderizadas, con o sin prefix — eso es lo estable para matchear.
                    // Tampoco hace falta tipear: la lista de vehículos ya viene cargada entera.
                    const vehiculoId = await this.page.evaluate(() => {
                        const norm = t => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
                        for (const label of document.querySelectorAll('label')) {
                            if (!norm(label.textContent).includes('vehiculo')) continue;
                            const scope = label.closest('.row') || label.closest('div, td, .form-group, li') || label.parentElement;
                            if (!scope) continue;
                            const inp = scope.querySelector('input[id^="react-select-"][id$="-input"]');
                            if (inp) return inp.id;
                        }
                        return null;
                    });
                    if (!vehiculoId) {
                        console.log(`   ⚠️ No encontré el React Select de Vehículo`);
                        break;
                    }
                    const inpVehiculo = this.page.locator(`#${vehiculoId}`);
                    await inpVehiculo.click();
                    await this.page.waitForTimeout(500);
                    const opcionesVehiculo = await this.page.evaluate(() =>
                        Array.from(document.querySelectorAll('[role="option"]'))
                            .map(el => el.textContent.trim())
                            .filter(Boolean));
                    console.log(`   🔎 Opciones de Vehículo: ${JSON.stringify(opcionesVehiculo)}`);
                    const opcionV = this.page.locator('[role="option"]', { hasText: String(valor) }).first();
                    try {
                        await opcionV.waitFor({ state: 'visible', timeout: 4000 });
                        await opcionV.click();
                        await this.page.waitForTimeout(500);
                        aplicada = true;
                        console.log(`   ✅ Vehículo aplicado: ${valor}`);
                    } catch {
                        await this.page.keyboard.press('Escape').catch(() => {});
                        console.log(`   ⚠️ No apareció opción de vehículo para "${valor}" — opciones disponibles arriba`);
                    }
                } catch (e) {
                    console.log(`   ⚠️ No pude aplicar vehículo: ${e.message}`);
                }
                break;

            case 'kilometros':
                if (!['orden', 'preorden'].includes(this.documento)) {
                    console.log(`   ⏭️ ${this.documento} no tiene campo Kilómetros — se omite`);
                    break;
                }
                try {
                    aplicada = await this._llenarInputPorLabel('Kilómetros', valor)
                        || await this._llenarInputPorLabel('Kilometros', valor);
                    if (aplicada) console.log(`   ✅ Kilómetros aplicado: ${valor}`);
                    else console.log(`   ⚠️ No encontré el campo Kilómetros`);
                } catch (e) {
                    console.log(`   ⚠️ No pude aplicar kilómetros: ${e.message}`);
                }
                break;

            case 'transporte':
                if (this.documento !== 'orden_compra') {
                    console.log(`   ⏭️ transporte solo aplica a orden_compra — se omite`);
                    break;
                }
                try {
                    // Buscar el React Select cercano al label "Transporte"
                    const transporteId = await this.page.evaluate(() => {
                        const norm = t => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
                        for (const el of document.querySelectorAll('label, span, p, div')) {
                            if (el.children.length > 0) continue;
                            if (!norm(el.textContent).includes('transporte')) continue;
                            const scope = el.closest('div, td, .form-group, li, section') || el.parentElement;
                            if (!scope) continue;
                            const inp = scope.querySelector('input[id^="react-select-"][id$="-input"]');
                            if (inp) return inp.id;
                        }
                        return null;
                    });
                    if (!transporteId) {
                        console.log(`   ⚠️ No encontré el React Select de transporte`);
                        break;
                    }
                    const inpTransporte = this.page.locator(`#${transporteId}`);
                    await inpTransporte.click();
                    await inpTransporte.pressSequentially(String(valor), { delay: 80 });
                    await this.page.waitForTimeout(1500);
                    const opcionT = this.page.locator('.selectproduct__menu [class*="option"]:not([class*="notice"]):not([class*="no-options"])').first();
                    try {
                        await opcionT.waitFor({ state: 'visible', timeout: 4000 });
                        await opcionT.click();
                        await this.page.waitForTimeout(500);
                        aplicada = true;
                        console.log(`   ✅ Transporte aplicado: ${valor}`);
                    } catch {
                        await this.page.keyboard.press('Escape').catch(() => {});
                        console.log(`   ⚠️ No apareció opción de transporte para "${valor}"`);
                    }
                } catch (e) {
                    console.log(`   ⚠️ No pude aplicar transporte: ${e.message}`);
                }
                break;

            case 'fecha_entrega':
                if (this.documento !== 'orden_compra') {
                    console.log(`   ⏭️ fecha_entrega solo aplica a orden_compra — se omite`);
                    break;
                }
                try {
                    aplicada = await this._llenarInputPorLabel('Fecha de Entrega', valor)
                        || await this._llenarInputPorLabel('Entrega', valor);
                    if (aplicada) console.log(`   ✅ Fecha de entrega aplicada: ${valor}`);
                    else console.log(`   ⚠️ No encontré el campo de fecha de entrega`);
                } catch (e) {
                    console.log(`   ⚠️ No pude aplicar fecha de entrega: ${e.message}`);
                }
                break;

            default:
                console.log(`Configuración no implementada: ${nombre}`);
        }
        await this.page.waitForTimeout(500);
        return aplicada;
    }
}

module.exports = { ConfigApplier };