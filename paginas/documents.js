class DocumentsPage {
    constructor(page, documento) {
        this.page = page;
        this.documento = (documento || '').toLowerCase();
    }

    async navegar(tipoDocumento) {
        const urls = {
            factura: "https://dev.fidel.com.ar/Sistema/Venta/Crear",
            presupuesto: "https://dev.fidel.com.ar/Sistema/PresupuestoVenta/Crear",
            venta_unificada: "https://dev.fidel.com.ar/Sistema/ComprobanteRapido/Crear",
            pedido: "https://dev.fidel.com.ar/Sistema/Pedido/Crear",
            remito: "https://dev.fidel.com.ar/Sistema/Remito/Crear",
        };
        const url = urls[tipoDocumento];
        if (!url) throw new Error(`Documento desconocido: ${tipoDocumento}`);

        for (let intento = 1; intento <= 2; intento++) {
            try {
                await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
                break;
            } catch (e) {
                if (intento === 2) throw e;
                console.log(`   ⚠️ Navegación a ${tipoDocumento} falló (intento ${intento}), reintento: ${e.message}`);
            }
        }
        try {
            await this.page.waitForLoadState('networkidle', { timeout: 15000 });
        } catch (e) {
            console.log(`   ⚠️ networkidle no llegó en 15s, sigo igual`);
        }
    }

    async seleccionarCliente(clienteID) {

        await this.page.click('#select2-chosen-1');
        await this.page.waitForTimeout(800);

        const enfocado = await this.page.evaluate(() => {
            const inp = Array.from(document.querySelectorAll('input.select2-input')).find(i => i.offsetParent !== null);
            if (!inp) return false;
            inp.focus();
            inp.value = '';
            return true;
        });
        if (!enfocado) console.log('   ⚠️ No vi el buscador del Select2 de cliente; tecleo global.');
        await this.page.keyboard.type(clienteID, { delay: 80 });
        await this.page.waitForTimeout(2500);

        await this.page.keyboard.press('Enter');
        await this.page.waitForTimeout(800);

        if (await this.page.locator('#select2-drop-mask').count()) {
            console.log('   ⚠️ El dropdown de cliente quedó abierto; lo cierro.');
            await this.page.keyboard.press('Escape').catch(() => {});
            await this.page.evaluate(() => document.querySelectorAll('#select2-drop-mask, .select2-drop-mask').forEach(m => m.remove()));
            await this.page.waitForTimeout(300);
        }
    }

    async seleccionarVendedor(nombre) {
        const r = await this.page.evaluate((nom) => {
            const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
            const textoDe = (s) => {
                let lbl = '';
                if (s.id) { const l = document.querySelector(`label[for="${s.id}"]`); if (l) lbl = l.textContent; }
                return `${s.id} ${s.name} ${lbl}`;
            };
            const sels = Array.from(document.querySelectorAll('select')).filter(s => /vendedor|usuario/i.test(textoDe(s)));
            sels.sort((a, b) => (/vendedor/i.test(textoDe(b)) ? 1 : 0) - (/vendedor/i.test(textoDe(a)) ? 1 : 0));
            if (!sels.length) {
                return { ok: false, cand: Array.from(document.querySelectorAll('select')).map(s => s.id || s.name).filter(Boolean).slice(0, 30) };
            }
            for (const s of sels) {
                const opt = Array.from(s.options).find(o => norm(o.textContent).includes(norm(nom)));
                if (opt) {
                    s.value = opt.value;
                    if (window.jQuery) { try { jQuery(s).val(opt.value).trigger('chosen:updated').trigger('change'); } catch (e) {} }
                    else s.dispatchEvent(new Event('change', { bubbles: true }));
                    return { ok: true, id: s.id || s.name, texto: opt.textContent.trim() };
                }
            }
            return { ok: false, id: sels[0].id || sels[0].name, opciones: Array.from(sels[0].options).map(o => o.textContent.trim()).slice(0, 20) };
        }, nombre);

        if (r.ok) {
            console.log(`   ✅ Vendedor seleccionado: ${r.texto} (${r.id})`);
            await this.page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
            await this.page.waitForTimeout(2000);
            return true;
        }

        const chosenSel = '#VendedorIdVenta_chosen, [id*="endedor"][id$="_chosen"], [id*="suario"][id$="_chosen"]';
        const chosen = this.page.locator(chosenSel).first();
        if (await chosen.count()) {
            try {
                await chosen.locator('.chosen-single').click();
                await this.page.waitForTimeout(400);
                const search = this.page.locator('.chosen-drop input.chosen-search-input, .chosen-search input').last();
                await search.fill(nombre).catch(async () => { await this.page.keyboard.type(nombre); });
                await this.page.waitForTimeout(800);
                const opcion = this.page.locator('.chosen-results li.active-result').first();
                await opcion.waitFor({ state: 'visible', timeout: 4000 });
                await opcion.click();
                console.log(`   ✅ Vendedor seleccionado por chosen: ${nombre}`);
                await this.page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
                await this.page.waitForTimeout(2000);
                return true;
            } catch (e) {
                console.log(`   ⚠️ No pude elegir el vendedor por la UI del chosen: ${e.message}`);
            }
        }

        if (r.opciones) console.log(`   ⚠️ No encontré el vendedor "${nombre}" en ${r.id}. Opciones: ${r.opciones.join(' / ')}`);
        else console.log(`   ⚠️ No encontré un select de vendedor. Selects: ${(r.cand || []).join(', ') || '(ninguno)'}`);
        await this.page.waitForTimeout(1000);
        return false;
    }

    async guardar({ confirmar = false } = {}) {
        const urlAntes = this.page.url();

        await this.page.evaluate(() =>
            document.querySelectorAll('.gritter-item, .toast, [class*="toast"], .alert, .notification, [class*="notification"]').forEach(e => e.remove())).catch(() => {});

        const accionesPorDoc = {
            factura: ['Guardar y Salir'],
            presupuesto: ['Guardar y Salir'],
            pedido: ['Guardar y Salir'],
            venta_unificada: ['Facturar'],
            remito: ['Guardar'],
        };
        const textos = [...new Set([...(accionesPorDoc[this.documento] || []), 'Guardar y Salir', 'Facturar', 'Presupuestar', 'Guardar', 'Confirmar'])];
        this.page.once('dialog', d => d.accept().catch(() => {}));
        const clickeado = await this.clickAccion(textos);
        if (!clickeado) {
            const cand = await this.page.evaluate(() =>
                [...new Set(Array.from(document.querySelectorAll('button, a.btn, input[type="submit"], input[type="button"]'))
                    .filter(b => b.offsetParent)
                    .map(b => (b.textContent || b.value || '').replace(/\s+/g, ' ').trim())
                    .filter(t => t && t.length < 35))].slice(0, 50));
            console.log(`   ⚠️ Guardar: no encontré el botón. Candidatos visibles: ${cand.join(' | ') || '(ninguno)'}`);
            return { intentado: false, estado: 'desconocido', mensaje: 'No encontré el botón Guardar' };
        }
        console.log(`   💾 Guardar: clickeé "${clickeado}"`);

        const modalInfo = await this.manejarModalConfirmacion().catch(() => ({ modal: false }));

        if (!modalInfo.modal) {
            return await this._leerResultadoGuardado(urlAntes);
        }
        if (!confirmar) {
            return { intentado: true, estado: 'desconocido', mensaje: 'Modal OK: checkbox de email procesado (sin confirmar todavía)' };
        }

        await this.page.evaluate(() =>
            document.querySelectorAll('.gritter-item, .toast, [class*="toast"], .alert, .notification, [class*="notification"]').forEach(e => e.remove())).catch(() => {});
        await this.clickEnModal(['Confirmar', 'Aceptar']);
        return await this._leerResultadoGuardado(urlAntes);
    }

    async _leerResultadoGuardado(urlAntes) {
        const leerToasts = () => this.page.evaluate(() => {
            const sels = ['#toast-container .toast', '.toast', '[class*="toast"]', '.gritter-item',
                '.noty_bar', '.growl-message', '.alert', '.notification', '[class*="notification"]',
                '.validation-summary-errors'];
            const vistos = new Set(); const out = [];
            sels.forEach(s => document.querySelectorAll(s).forEach(el => {
                const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
                if (txt && el.offsetParent && !vistos.has(txt)) { vistos.add(txt); out.push({ clase: String(el.className || ''), texto: txt.slice(0, 200) }); }
            }));
            return out;
        }).catch(() => []);

        let notis = [];
        for (let t = 0; t < 10000; t += 500) {
            notis = await leerToasts();
            if (notis.length) break;
            const u = this.page.url();
            if (u !== urlAntes && !/\/Crear/i.test(u)) break;
            await this.page.waitForTimeout(500);
        }

        const urlDespues = this.page.url();
        const redirigio = urlDespues !== urlAntes && !/\/Crear/i.test(urlDespues);

        const esError = (n) => /error|danger|fail|invalid/i.test(n.clase) || /error|fall[oó]|inv[aá]lid|requerid|no se pudo|no debe|debe ingresar|debe complet/i.test(n.texto);
        const esOk = (n) => /success|green|\bok\b/i.test(n.clase) || /guardad|correct|exitos|gener[oa]d|cre[oa]d|registr/i.test(n.texto);

        if (notis.length === 0) {
            console.log(`   💾 Guardar: no apareció notificación.${redirigio ? ` Redirigió a ${urlDespues} (probable OK).` : ''}`);
            return redirigio
                ? { intentado: true, estado: 'ok', mensaje: `Guardado (redirigió a ${urlDespues})` }
                : { intentado: true, estado: 'desconocido', mensaje: 'No se detectó notificación de resultado' };
        }
        console.log(`   💾 Guardar: notificación(es) -> ${notis.map(n => `[${n.clase}] ${n.texto}`).join(' || ')}`);

        const errores = notis.filter(esError);
        if (errores.length) return { intentado: true, estado: 'error', mensaje: errores.map(n => n.texto).join(' | ') };
        const oks = notis.filter(esOk);
        if (oks.length) return { intentado: true, estado: 'ok', mensaje: oks[0].texto };

        return redirigio
            ? { intentado: true, estado: 'ok', mensaje: notis[0].texto }
            : { intentado: true, estado: 'desconocido', mensaje: notis[0].texto };
    }

    async manejarModalConfirmacion() {

        const modal = this.page.locator('.modal:visible, [role="dialog"]:visible').first();
        try {
            await modal.waitFor({ state: 'visible', timeout: 10000 });
        } catch (e) {
            const modales = await this.page.evaluate(() =>
                Array.from(document.querySelectorAll('.modal, [role="dialog"]'))
                    .map(m => `${(m.id || m.className || m.tagName)}`.slice(0, 40) + ` (display=${getComputedStyle(m).display}, h=${Math.round(m.getBoundingClientRect().height)})`)
                    .slice(0, 12)).catch(() => []);
            console.log(`   ⚠️ No apareció un modal de confirmación tras Guardar. Modales: ${modales.join(' | ') || '(ninguno)'}`);
            return { modal: false };
        }
        await this.page.waitForTimeout(800);

        const info = await this.page.evaluate(() => {
            const cont = Array.from(document.querySelectorAll('.modal, [role="dialog"]')).find(m => {
                const s = getComputedStyle(m);
                return s.display !== 'none' && s.visibility !== 'hidden' && m.getBoundingClientRect().height > 5;
            }) || document;
            const labelDe = (el) => {
                let t = '';
                if (el.id) { const l = document.querySelector(`label[for="${el.id}"]`); if (l) t = l.textContent; }
                if (!t && el.closest('label')) t = el.closest('label').textContent;
                if (!t && el.parentElement) t = el.parentElement.textContent;
                return (t || '').replace(/\s+/g, ' ').trim().slice(0, 60);
            };
            const checks = Array.from(cont.querySelectorAll('input[type="checkbox"]')).map(c => ({
                id: c.id || '', name: c.name || '', checked: c.checked, label: labelDe(c),
            }));
            const botones = [...new Set(Array.from(cont.querySelectorAll('button, a.btn, input[type="submit"], input[type="button"]'))
                .map(b => (b.textContent || b.value || '').replace(/\s+/g, ' ').trim()).filter(Boolean))];
            return { checks, botones };
        }).catch(() => ({ checks: [], botones: [] }));
        console.log(`   🔎 Modal: checkboxes -> ${info.checks.map(c => `[${c.id || c.name || '?'}] "${c.label}" checked=${c.checked}`).join(' | ') || '(ninguno)'}`);
        console.log(`   🔎 Modal: botones -> ${info.botones.join(' | ') || '(ninguno)'}`);

        const objetivo = info.checks.find(c => /email|mail|correo|gmail|enviar/i.test(`${c.id} ${c.name} ${c.label}`) && c.checked)
            || info.checks.find(c => c.checked);
        if (!objetivo) {
            console.log('   ℹ️ Modal sin checkbox de email tildado (nada que destildar).');
            return { modal: true, ...info };
        }

        const destildado = await this.page.evaluate((o) => {
            const cont = Array.from(document.querySelectorAll('.modal, [role="dialog"]')).find(m => {
                const s = getComputedStyle(m);
                return s.display !== 'none' && s.visibility !== 'hidden' && m.getBoundingClientRect().height > 5;
            }) || document;
            const cb = Array.from(cont.querySelectorAll('input[type="checkbox"]'))
                .find(c => (o.id && c.id === o.id) || (o.name && c.name === o.name));
            if (!cb) return false;
            if (cb.checked) cb.click();
            return !cb.checked;
        }, objetivo).catch(() => false);
        console.log(`   ${destildado ? '✅' : '⚠️'} Checkbox de email "${objetivo.label || objetivo.id || objetivo.name}" ${destildado ? 'DESTILDADO' : 'NO se pudo destildar'}.`);

        await this.page.waitForTimeout(500);
        const botonesAhora = await this.page.evaluate(() => {
            const cont = Array.from(document.querySelectorAll('.modal, [role="dialog"]')).find(m => {
                const s = getComputedStyle(m);
                return s.display !== 'none' && s.visibility !== 'hidden' && m.getBoundingClientRect().height > 5;
            }) || document;
            return [...new Set(Array.from(cont.querySelectorAll('button, a.btn, input[type="submit"], input[type="button"]'))
                .map(b => (b.textContent || b.value || '').replace(/\s+/g, ' ').trim()).filter(Boolean))];
        }).catch(() => []);
        console.log(`   🔎 Modal: botones tras destildar -> ${botonesAhora.join(' | ') || '(ninguno)'}`);

        return { modal: true, ...info, emailDestildado: destildado, botonesTrasDestildar: botonesAhora };
    }

    async clickAccion(textos) {
        for (const txt of textos) {
            const t = txt.replace(/"/g, '\\"');
            const loc = this.page.locator(`button:text-is("${t}"), a:text-is("${t}"), input[type="submit"][value="${t}" i], input[type="button"][value="${t}" i]`);
            const count = await loc.count().catch(() => 0);
            for (let i = 0; i < count; i++) {
                const b = loc.nth(i);
                try {
                    if (!(await b.isVisible())) continue;
                    await b.scrollIntoViewIfNeeded();
                    await b.click({ timeout: 6000 });
                    return txt;
                } catch (e) {  }
            }
        }
        return null;
    }

    async clickEnModal(textos) {
        const modal = this.page.locator('.modal:visible, [role="dialog"]:visible').first();
        for (const txt of textos) {
            const t = txt.replace(/"/g, '\\"');
            const b = modal.locator(`button:text-is("${t}"), a:text-is("${t}"), input[value="${t}" i]`);
            const count = await b.count().catch(() => 0);
            for (let i = 0; i < count; i++) {
                const el = b.nth(i);
                try {
                    if (!(await el.isVisible())) continue;
                    await el.scrollIntoViewIfNeeded();
                    await el.click({ timeout: 6000 });
                    console.log(`   💾 Modal: clickeé "${txt}"`);
                    return true;
                } catch (e) { }
            }
        }
        console.log(`   ⚠️ Modal: no encontré ningún botón ${JSON.stringify(textos)} para confirmar.`);
        return false;
    }
}

module.exports = { DocumentsPage };