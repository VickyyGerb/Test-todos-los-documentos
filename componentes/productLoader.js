const { expect } = require('@playwright/test');
const { leerLineasProducto } = require('../utiles/lecturaPrecios');

class ProductLoader {
    constructor(page, documento) {
        this.page = page;
        this.documento = (documento || '').toLowerCase();
    }

    async snapshotGuids() {
        return await this.page.evaluate(() => {
            const re = /^(?:ListaProducto(?!Libre)\w*?|ProductosLista)\[(.+?)\]\.ProductoId$/;
            const guids = [];
            document.querySelectorAll('input[name$=".ProductoId"]').forEach(inp => {
                const m = inp.name.match(re);
                if (m && inp.value && inp.value.trim() !== '') guids.push(m[1]);
            });
            return guids;
        });
    }

    async leerPrecioNuevo(guidsAntes, timeout = 8000) {
        const intervalo = 300;
        let info = null;

        for (let t = 0; t < timeout; t += intervalo) {
            info = await this.page.evaluate((antes) => {
                const re = /^(ListaProducto(?!Libre)\w*?|ProductosLista)\[(.+?)\]\.ProductoId$/;
                const s = new Set(antes);
                const inputs = document.querySelectorAll('input[name$=".ProductoId"]');
                for (const inp of inputs) {
                    const m = inp.name.match(re);
                    if (m && inp.value && inp.value.trim() !== '' && !s.has(m[2])) {
                        return { prefijo: m[1], guid: m[2] };
                    }
                }
                return null;
            }, guidsAntes);

            if (info) break;
            await this.page.waitForTimeout(intervalo);
        }

        if (!info) {
            console.log('   ⚠️ No se detectó una fila de producto nueva');
            return 0;
        }

        const lineas = await this.page.evaluate(leerLineasProducto, this.documento);
        const linea = lineas.find(l => l.guid === info.guid);
        const precio = linea ? linea.total : 0;

        if (precio === 0 && linea) {
            console.log(`   ⚠️ Producto cargado pero precio=0. Campos: ${linea.campos.join(', ')}`);
            if (['orden', 'preorden'].includes(this.documento))
                console.log(`   (En órdenes de servicio el precio puede ser 0 si el servicio no tiene precio configurado en esta cuenta)`);
        }
        console.log(`   Precio del producto cargado: ${precio}`);
        return precio;
    }

    async abrirSelectProductoVacio() {
        await this.page.waitForTimeout(1000);

        // Estrategia 1: selector conocido para documentos de venta (.productoId)
        const choice = this.page.locator('.select2-container.productoId .select2-choice').first();
        try {
            await choice.waitFor({ state: 'visible', timeout: 5000 });
            await choice.click();
            console.log('   🔎 Est.1 — abrió select2 por clase .productoId');
            await this.page.waitForTimeout(500);
            return 'select2';
        } catch {}

        // Estrategia 2: buscar el select2-choice asociado al hidden input .ProductoId vacío
        const clicadoPorHidden = await this.page.evaluate(() => {
            const re = /^(ListaProducto(?!Libre)\w*?|ProductosLista)\[(.+?)\]\.ProductoId$/;
            const vacios = Array.from(document.querySelectorAll('input[name$=".ProductoId"]'))
                .filter(inp => inp.name.match(re) && (!inp.value || inp.value.trim() === ''));

            for (const hidden of vacios) {
                const contenedor = hidden.closest('tr, [class*="row"], [class*="item"], [class*="linea"], [class*="producto"]');
                const scope = contenedor || hidden.parentElement;
                if (!scope) continue;
                const ch = scope.querySelector('.select2-choice');
                if (ch && ch.offsetParent) { ch.click(); return { ok: true, nombre: hidden.name }; }
            }
            return { ok: false };
        });

        if (clicadoPorHidden.ok) {
            console.log(`   🔎 Est.2 — abrió select2 via hidden input "${clicadoPorHidden.nombre}"`);
            await this.page.waitForTimeout(500);
            return 'select2';
        }

        // Estrategia 3: buscar Select2 vacío que sea el campo de producto
        // — recolectar candidatos con metadata, luego clickear el mejor
        const [idxParaClickar, debugCandidatos] = await this.page.evaluate(() => {
            const excluir = /vehiculo|vehicle|cliente|proveedor|deposito|moneda|vendedor|cuenta|certificado|lista.?precio|sucursal|condicion|pago|impuesto|alicuota|tipo|centro.?costo|concepto|caja.?grupo|categoria|grupo|marca|punto.?venta|transporte/i;
            const todos = Array.from(document.querySelectorAll('.select2-choice'));
            const candidatos = [];
            todos.forEach((ch, idx) => {
                if (!ch.offsetParent) return;
                const chosen = ch.querySelector('.select2-chosen');
                const chosenText = chosen ? chosen.textContent.trim() : '';
                const esPlaceholder = chosenText === '' || /^seleccion[ae]/i.test(chosenText);
                if (!esPlaceholder) return;
                const container = ch.closest('.select2-container');
                const containerId = container ? (container.id || '') : '';
                const containerClass = container ? Array.from(container.classList).join(' ') : '';
                // Excluir por clase o ID del container
                if (excluir.test(containerClass) || excluir.test(containerId)) return;
                // Excluir por select cercano en la misma fila
                const fila = ch.closest('tr, .producto-row, .item-row, td');
                const sel = fila ? fila.querySelector('select') : null;
                if (sel && excluir.test(`${sel.id} ${sel.name}`)) return;
                candidatos.push({
                    idx,
                    containerId,
                    containerClass: containerClass.replace(/select2-container\S*/g, '').trim() || '(sin clase)',
                    enTabla: !!(ch.closest('tr, tbody')),
                });
            });
            if (!candidatos.length) return [-1, candidatos];
            // Preferir el que está dentro de una tabla (filas de producto suelen estar en <tr>)
            const elegido = candidatos.find(c => c.enTabla) || candidatos[0];
            return [elegido.idx, candidatos];
        });

        console.log(`   🔎 Est.3 — candidatos Select2 vacíos: ${JSON.stringify(debugCandidatos)}`);
        if (idxParaClickar >= 0) {
            await this.page.locator('.select2-choice').nth(idxParaClickar).click();
            await this.page.waitForTimeout(500);
            return 'select2';
        }

        // Estrategia 4: Chosen widget (fallback para docs donde el producto usa Chosen en vez de Select2)
        const chosenInfo = await this.page.evaluate(() => {
            const excluir = /vehiculo|vehicle|cliente|proveedor|deposito|moneda|vendedor|cuenta|certificado|lista.?precio|sucursal|condicion|pago|impuesto|alicuota|tipo|centro.?costo|concepto|caja.?grupo|categoria|grupo|marca|punto.?venta|transporte/i;
            const todos = [];
            const candidatos = [];
            Array.from(document.querySelectorAll('.chosen-container')).forEach((c, i) => {
                const single = c.querySelector('.chosen-single');
                const txt = (single?.querySelector('span')?.textContent || single?.textContent || '').trim();
                const id = c.id || '';
                const cls = Array.from(c.classList).filter(x => !x.startsWith('chosen-container')).join('.');
                todos.push({ i, id, cls, txt: txt.slice(0, 40), visible: !!c.offsetParent });
                if (!c.offsetParent || !single) return;
                if (!/^seleccion[ae]/i.test(txt) && txt !== '') return;
                if (excluir.test(id) || excluir.test(cls)) return;
                candidatos.push(i);
            });
            return { todos, idx: candidatos.length > 0 ? candidatos[0] : -1 };
        });

        console.log(`   🔎 Est.4 — Chosen containers: ${JSON.stringify(chosenInfo.todos)}`);
        if (chosenInfo.idx >= 0) {
            await this.page.locator('.chosen-container').nth(chosenInfo.idx).locator('.chosen-single').click();
            console.log(`   🔎 Est.4 — abrió Chosen widget (índice ${chosenInfo.idx})`);
            await this.page.waitForTimeout(500);
            return 'chosen';
        }

        // Todas las estrategias fallaron — loguear para diagnóstico
        const info = await this.page.evaluate(() => {
            const s2 = Array.from(document.querySelectorAll('.select2-container')).map(c => {
                const ch = c.querySelector('.select2-chosen');
                const clases = Array.from(c.classList).filter(x => x !== 'select2-container' && !x.startsWith('select2-container-')).join('.');
                return `[${clases || 'sin-clase-extra'}] "${ch ? ch.textContent.trim().slice(0, 30) : ''}"`;
            }).join('  ||  ');
            const chosen = Array.from(document.querySelectorAll('.chosen-container')).map(c => {
                const txt = (c.querySelector('.chosen-single span')?.textContent || '').trim().slice(0, 30);
                return `[chosen:${c.id || '?'}] "${txt}"`;
            }).join('  ||  ');
            return [s2, chosen].filter(Boolean).join('   |||   ');
        });
        const botones = await this.page.evaluate(() =>
            Array.from(document.querySelectorAll('button, a.btn, input[type="button"]'))
                .filter(b => b.offsetParent)
                .map(b => `"${(b.textContent || b.value || '').trim().slice(0, 30)}"`)
                .join(', ')
        );
        throw new Error(`No pude abrir el select de producto en ${this.documento}. Widgets: ${info || '(ninguno)'}. Botones visibles: ${botones || '(ninguno)'}`);
    }

    async cargarManualReact(codigoInterno) {
        // orden/preorden: la fila de producto no existe en el DOM hasta clickear "Nuevo"
        // en la card "Productos/Servicios" (y requiere que ya haya un cliente seleccionado).
        if (['orden', 'preorden'].includes(this.documento)) {
            const clickeado = await this.page.evaluate(() => {
                const norm = t => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
                const header = Array.from(document.querySelectorAll('h4, .card-title'))
                    .find(el => norm(el.textContent).includes('productos/servicios') || norm(el.textContent).includes('productos servicios'));
                if (!header) return false;
                const card = header.closest('.card') || header.parentElement?.parentElement;
                if (!card) return false;
                const link = Array.from(card.querySelectorAll('a')).find(a => a.querySelector('svg, i') && a.offsetParent !== null);
                if (!link) return false;
                link.click();
                return true;
            });
            if (!clickeado) console.log('   ⚠️ No pude clickear "Nuevo" en Productos/Servicios — la fila puede no existir');
            await this.page.waitForTimeout(1000);
        }

        // El campo de proveedor es el React Select con menor Y (más arriba en la página)
        const proveedorId = await this.page.evaluate(() => {
            const inputs = Array.from(document.querySelectorAll('input[id^="react-select-"][id$="-input"]'))
                .filter(inp => inp.offsetParent !== null);
            inputs.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
            return inputs[0]?.id || null;
        });

        // Recopilar candidatos ordenados por Y luego X (top→bottom, left→right), excluyendo el proveedor
        const candidatos = await this.page.evaluate((excluirId) => {
            return Array.from(document.querySelectorAll('input[id^="react-select-"][id$="-input"]'))
                .filter(inp => inp.offsetParent !== null && inp.id !== excluirId)
                .map(inp => {
                    const r = inp.getBoundingClientRect();
                    return { id: inp.id, x: Math.round(r.left), y: Math.round(r.top) };
                })
                .sort((a, b) => a.y !== b.y ? a.y - b.y : a.x - b.x);
        }, proveedorId);
        console.log(`   🔎 Candidatos React Select: ${JSON.stringify(candidatos)}`);

        // orden/preorden necesitaban más espera para que aparezcan las opciones del dropdown;
        // orden_compra/presupuesto_compra ya andaban bien con el timing original — no tocarlo.
        const esOrdenServicio = ['orden', 'preorden'].includes(this.documento);
        const esperaBusqueda = esOrdenServicio ? 4000 : 2500;

        // Probar cada candidato: tipear las primeras letras y ver si aparecen opciones
        let campoId = null;
        const prefijo = codigoInterno.slice(0, 3);
        for (const c of candidatos) {
            const inp = this.page.locator(`#${c.id}`);
            await inp.click();
            await inp.pressSequentially(prefijo, { delay: 80 });
            await this.page.waitForTimeout(esperaBusqueda);
            const opcionesPrefijo = await this.page.evaluate(() =>
                Array.from(document.querySelectorAll('.selectproduct__menu [class*="option"]:not([class*="notice"]):not([class*="no-options"])'))
                    .map(op => op.textContent.trim().slice(0, 60))
                    .filter(t => t.length > 0 && !/^ingrese|^no hay|^sin resultados|^cargando|^no se encontr/i.test(t))
                    .slice(0, 5)
            );
            const hayOpciones = opcionesPrefijo.length > 0;
            if (hayOpciones) {
                console.log(`   ✅ Campo de producto: "${c.id}" — opciones para "${prefijo}": ${JSON.stringify(opcionesPrefijo)}`);
                // Seguir tipeando el resto SIN limpiar (el prefijo ya está escrito)
                const resto = codigoInterno.slice(prefijo.length);
                if (resto) {
                    await inp.pressSequentially(resto, { delay: 100 });
                    await this.page.waitForTimeout(esperaBusqueda);
                }
                campoId = c.id;
                break;
            }
            // No es el campo correcto: limpiar y continuar
            await this.page.keyboard.press('Escape');
            await this.page.waitForTimeout(200);
        }

        if (!campoId) throw new Error(`Ningún React Select respondió al código "${prefijo}" en ${this.documento}`);

        // Snapshot ANTES de seleccionar la opción. Para orden/preorden se usa el campo "Total"
        // real por nombre (confirmado en vivo: name="productServicePreOrderList[0]total", sin
        // punto). orden_compra/presupuesto_compra ya andaban bien con el heurístico genérico
        // original (diff de inputs de texto) y NO se tocan.
        const SELECTOR_TOTAL = 'input[name$="total"], input[name$="productCost"]';
        const snapshotAntes = esOrdenServicio
            ? await this.page.evaluate((sel) =>
                Array.from(document.querySelectorAll(sel)).map(i => ({ name: i.name, value: i.value })),
                SELECTOR_TOTAL)
            : await this.page.evaluate(() =>
                Array.from(document.querySelectorAll('input[type="text"]'))
                    .filter(i => i.offsetParent && !i.id.startsWith('react-select'))
                    .map(i => i.value));

        const opcionTexto = await this.page.evaluate(() => {
            const op = Array.from(document.querySelectorAll('.selectproduct__menu [class*="option"]:not([class*="notice"]):not([class*="no-options"])'))
                .find(el => el.textContent.trim().length > 0);
            return op ? op.textContent.trim().slice(0, 60) : null;
        });
        console.log(`   🔎 Opción a seleccionar: "${opcionTexto || '(ninguna)'}"`);
        if (!opcionTexto) throw new Error(`No aparecieron opciones para "${codigoInterno}" en ${campoId}`);

        await this.page.keyboard.press('ArrowDown');
        await this.page.waitForTimeout(300);
        await this.page.keyboard.press('Enter');

        let precio = 0;

        if (!esOrdenServicio) {
            // orden_compra / presupuesto_compra: comportamiento ORIGINAL, sin cambios.
            await this.page.waitForTimeout(3000);
            precio = await this.page.evaluate((antes) => {
                const aNum = t => parseFloat((t || '').replace(/\./g, '').replace(',', '.')) || 0;
                const despues = Array.from(document.querySelectorAll('input[type="text"]'))
                    .filter(i => i.offsetParent && !i.id.startsWith('react-select'))
                    .map(i => i.value);
                for (let i = 0; i < despues.length; i++) {
                    const v = aNum(despues[i]);
                    if (v > 100 && v !== aNum(antes[i] || '0')) return v;
                }
                for (const v of despues.map(t => parseFloat((t || '').replace(/\./g, '').replace(',', '.')) || 0)) {
                    if (v > 100) return v;
                }
                return 0;
            }, snapshotAntes);
        } else {
            // orden/preorden: leer el campo "Total" real, comparando por nombre (no por
            // índice/posición). Se recalcula recién cuando termina un fetch async
            // (getProductById) que fija el precio de la fila — por eso hay polling.
            const leerTotal = () => this.page.evaluate(({ antes, sel }) => {
                const aNum = t => parseFloat((t || '').replace(/\./g, '').replace(',', '.')) || 0;
                const antesPorNombre = new Map(antes.map(a => [a.name, a.value]));
                const despues = Array.from(document.querySelectorAll(sel))
                    .map(i => ({ name: i.name, value: i.value }));

                for (const d of despues) {
                    const v = aNum(d.value);
                    if (v > 0 && v !== aNum(antesPorNombre.get(d.name) || '0')) return v;
                }
                for (const d of despues) {
                    if (!antesPorNombre.has(d.name) && aNum(d.value) > 0) return aNum(d.value);
                }
                return 0;
            }, { antes: snapshotAntes, sel: SELECTOR_TOTAL });

            const timeoutMs = 8000, intervaloMs = 400;
            for (let t = 0; t < timeoutMs; t += intervaloMs) {
                await this.page.waitForTimeout(intervaloMs);
                precio = await leerTotal();
                if (precio > 0) break;
            }

            if (precio === 0) {
                precio = await this.page.evaluate((sel) => {
                    const aNum = t => parseFloat((t || '').replace(/\./g, '').replace(',', '.')) || 0;
                    const campos = Array.from(document.querySelectorAll(sel));
                    for (let i = campos.length - 1; i >= 0; i--) {
                        const v = aNum(campos[i].value);
                        if (v > 0) return v;
                    }
                    return 0;
                }, SELECTOR_TOTAL);
                if (precio === 0) {
                    const diag = await this.page.evaluate((selTotal) => {
                        const totales = Array.from(document.querySelectorAll(selTotal)).map(i => ({ name: i.name, value: i.value }));
                        const precios = Array.from(document.querySelectorAll('input[name$="price"], input[name$="precio"]')).map(i => ({ name: i.name, value: i.value }));
                        const todosConNombre = totales.length === 0 && precios.length === 0
                            ? Array.from(document.querySelectorAll('input[name*="["]'))
                                .filter(i => i.offsetParent)
                                .map(i => ({ name: i.name, value: i.value, disabled: i.disabled }))
                            : [];
                        return { totales, precios, todosConNombre };
                    }, SELECTOR_TOTAL);
                    console.log(`   ⚠️ El campo "Total" siguió en 0 tras 8s de espera (¿fetch de precio lento o producto sin precio?)`);
                    console.log(`   🔎 Diagnóstico — campos Total: ${JSON.stringify(diag.totales)}`);
                    console.log(`   🔎 Diagnóstico — campos Precio: ${JSON.stringify(diag.precios)}`);
                    if (diag.todosConNombre.length) {
                        console.log(`   🔎 Diagnóstico — TODOS los inputs con nombre tipo [N] en la página: ${JSON.stringify(diag.todosConNombre)}`);
                    }
                }
            }
        }

        console.log(`   Precio del producto cargado (React): ${precio}`);
        return precio;
    }

    async cargarManual(codigoInterno, cantidad = 1) {
        if (['presupuesto_compra', 'orden_compra', 'orden', 'preorden'].includes(this.documento)) {
            return await this.cargarManualReact(codigoInterno);
        }

        const antes = await this.snapshotGuids();

        for (let intento = 1; intento <= 2; intento++) {
            if (intento > 1) {
                const tardio = await this.leerPrecioNuevo(antes, 2500);
                if (tardio > 0) {
                    console.log('   ℹ️ Manual: el producto del intento anterior cargó tarde, no reintento');
                    return tardio;
                }
            }

            const tipoWidget = await this.abrirSelectProductoVacio();

            if (tipoWidget === 'chosen') {
                // El campo de producto usa Chosen widget (ej: factura_compra)
                await this.page.evaluate(() => {
                    const inp = document.querySelector('.chosen-container-active .chosen-search input');
                    if (inp) inp.focus();
                });
                await this.page.keyboard.type(codigoInterno, { delay: 80 });
                await this.page.waitForTimeout(3000);

                const chosenResult = this.page.locator('.chosen-container-active .chosen-results li.active-result').first();
                try {
                    await chosenResult.waitFor({ state: 'visible', timeout: 6000 });
                    const txt = await chosenResult.textContent();
                    console.log(`   🔎 Chosen — opción encontrada: "${txt?.trim().slice(0, 60)}"`);
                    await chosenResult.click();
                } catch (e) {
                    await this.page.keyboard.press('ArrowDown');
                    await this.page.keyboard.press('Enter');
                }
            } else {
                // Select2 (flujo normal)
                const search = this.page.locator('#select2-drop input.select2-input').first();
                try {
                    await search.waitFor({ state: 'visible', timeout: 5000 });
                    await search.fill(codigoInterno);
                } catch (e) {
                    await this.page.keyboard.type(codigoInterno);
                }
                await this.page.waitForTimeout(3000);

                const resultado = this.page.locator('.select2-results li.select2-result-selectable').first();
                try {
                    await resultado.waitFor({ state: 'visible', timeout: 6000 });
                    await resultado.click();
                } catch (e) {
                    await this.page.keyboard.press('ArrowDown');
                    await this.page.keyboard.press('Enter');
                }
            }
            await this.page.waitForTimeout(3000);

            const precio = await this.leerPrecioNuevo(antes);
            if (precio > 0) return precio;
            await this.cerrarSelect2Abierto();
            console.log(`   ⚠️ Manual intento ${intento}: el producto no quedó, reintento...`);
        }

        return 0;
    }

    async cargarPorCodigoBarra(codigoBarra) {
        if (this.documento === 'remito') {
            console.log('   ⏭️ Remito no tiene carga por código de barra — se omite');
            return 0;
        }
        const antes = await this.snapshotGuids();

        await this.page.keyboard.press('F6');
        await this.page.keyboard.type(codigoBarra);
        await this.page.waitForTimeout(2000);
        await this.page.keyboard.press('F8', { force: true });
        await this.page.waitForTimeout(3000);

        return await this.leerPrecioNuevo(antes);
    }

    async cerrarSelect2Abierto() {
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(300);
        await this.page.evaluate(() => {
            document.querySelectorAll('#select2-drop-mask, .select2-drop-mask').forEach(m => m.remove());
            if (window.jQuery) { try { jQuery('#select2-drop').hide(); } catch (e) {} }
        });
        await this.page.waitForTimeout(200);
    }

    async filaProductoPorCodigo(scope, codigoInterno) {
        const filas = scope.locator('table tbody tr.odd');
        await filas.first().waitFor({ state: 'visible', timeout: 5000 });
        const total = await filas.count();
        for (let i = 0; i < total; i++) {
            const fila = filas.nth(i);
            const texto = (await fila.textContent()) || '';
            if (texto.includes(codigoInterno)) return fila;
        }
        console.log(`   ⚠️ Ninguna fila de resultados contiene el código exacto "${codigoInterno}" — uso la primera (puede ser otro producto)`);
        return filas.first();
    }

    async cargarAsignacionMultiple(codigoInterno, cantidad = 1) {
        if (this.documento === 'pedido') return this.cargarAsignacionMultiplePedido(codigoInterno, cantidad);
        if (this.documento === 'remito') return this.cargarAsignacionMultipleRemito(codigoInterno, cantidad);
        const antes = await this.snapshotGuids();

        await this.page.click('#btn-color-youtube.dropdown-toggle.btn.btn-sm');
        await this.page.waitForTimeout(500);

        await this.page.locator('a:has-text("Asignación Múltiple")').click();
        await this.page.waitForTimeout(1000);

        await this.page.fill('#NombreProducto', codigoInterno);
        await this.page.waitForTimeout(500);

        await this.page.keyboard.press('Enter');
        await this.page.waitForTimeout(2000);

        const filaProducto = await this.filaProductoPorCodigo(this.page, codigoInterno);

        await filaProducto.locator('input[type="checkbox"]').click();
        await this.page.waitForTimeout(500);

        await this.page.getByRole('button', { name: 'Agregar' }).click();
        await this.page.waitForTimeout(3000);

        return await this.leerPrecioNuevo(antes);
    }

    async cargarDesdePlantilla(nombrePlantilla) {
        if (this.documento === 'pedido') return this.cargarDesdePlantillaPedido(nombrePlantilla);
        if (this.documento === 'remito') {
            console.log('   ⏭️ Remito no tiene carga por plantilla — se omite');
            return 0;
        }
        const antes = await this.snapshotGuids();

        await this.page.click('#btn-color-youtube.dropdown-toggle.btn.btn-sm');
        await this.page.getByRole('link', { name: 'Plantillas' }).click();
        await this.page.waitForTimeout(1000);

        await this.seleccionarPlantillaEnChosen(nombrePlantilla);

        await this.page.locator('.modal-footer:has-text("Asociar") a.btn-success').click();
        await this.page.waitForTimeout(3000);

        return await this.leerPrecioNuevo(antes);
    }

    async seleccionarPlantillaEnChosen(nombrePlantilla) {
        try {
            await this.page.click('#PlantillasLista_chosen .chosen-single');
            await this.page.waitForTimeout(400);

            const search = this.page.locator('#PlantillasLista_chosen .chosen-search input').first();
            await search.waitFor({ state: 'visible', timeout: 4000 });
            await search.type(String(nombrePlantilla), { delay: 50 });
            await this.page.waitForTimeout(800);

            const opcion = this.page.locator('#PlantillasLista_chosen .chosen-results li.active-result').first();
            await opcion.waitFor({ state: 'visible', timeout: 4000 });
            await opcion.click();
        } catch (e) {
            console.log(`   ⚠️ No pude elegir la plantilla por UI (${e.message}); intento por jQuery...`);
            const ok = await this.page.evaluate((nombre) => {
                const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
                const s = document.getElementById('PlantillasLista');
                if (!s) return false;
                const opt = Array.from(s.options).find(o => norm(o.textContent).includes(norm(nombre)));
                if (!opt) return false;
                s.value = opt.value;
                if (window.jQuery) { try { jQuery(s).val(opt.value).trigger('chosen:updated').trigger('change'); } catch (e) {} }
                else s.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }, nombrePlantilla);
            if (!ok) throw new Error(`No encontré la plantilla "${nombrePlantilla}" en el combo de plantillas`);
        }
        await this.page.waitForTimeout(1500);
    }

    async cargarAsignacionMultiplePedido(codigoInterno, cantidad = 1) {
        const antes = await this.snapshotGuids();

        await this.page.evaluate(() => {
            const link = Array.from(document.querySelectorAll('a')).find(a => /Asignación Múltiple/i.test(a.textContent));
            if (link) link.click();
        });
        await this.page.waitForTimeout(1500);

        await this.page.fill('#NombreProducto', codigoInterno);
        await this.page.waitForTimeout(500);

        await this.page.keyboard.press('Enter');
        await this.page.waitForTimeout(2000);

        const filaProducto = await this.filaProductoPorCodigo(this.page, codigoInterno);

        await filaProducto.locator('input[type="checkbox"]').click();
        await this.page.waitForTimeout(500);

        await this.page.getByRole('button', { name: 'Agregar' }).click();
        await this.page.waitForTimeout(3000);

        return await this.leerPrecioNuevo(antes);
    }

    async cargarDesdePlantillaPedido(nombrePlantilla) {
        const antes = await this.snapshotGuids();

        await this.page.evaluate(() => {
            const link = document.getElementById('btnAbrirModal');
            if (link) link.click();
        });
        await this.page.waitForTimeout(2000);

        await this.seleccionarPlantillaEnChosen(nombrePlantilla);

        await this.page.locator('.modal-footer:has-text("Asociar") a.btn-success').click();
        await this.page.waitForTimeout(3000);

        return await this.leerPrecioNuevo(antes);
    }

    async cargarAsignacionMultipleRemito(codigoInterno, cantidad = 1) {
        const antes = await this.snapshotGuids();

        await this.cerrarSelect2Abierto();
        await this.page.evaluate(() => {
            const link = Array.from(document.querySelectorAll('a')).find(a => /Asignaci[oó]n M[uú]ltiple/i.test(a.textContent));
            if (link) link.click();
        });
        await this.page.waitForTimeout(1500);

        const modal = this.page.locator('#ModalBuscarMultiProducto');
        await this.page.fill('#NombreProducto', codigoInterno);
        await this.page.waitForTimeout(800);

        await this.page.locator('#NombreProducto').blur();
        await this.page.waitForTimeout(1500);

        const fila = await this.filaProductoPorCodigo(modal, codigoInterno);
        await fila.locator('input[type="checkbox"]').click();
        await this.page.waitForTimeout(500);

        await modal.getByRole('button', { name: 'Agregar' }).click();
        await this.page.waitForTimeout(2500);

        return await this.leerPrecioNuevo(antes);
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
