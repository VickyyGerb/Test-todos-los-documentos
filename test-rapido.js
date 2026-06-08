const { chromium } = require('@playwright/test');
const { leerCasosDePrueba } = require('./utiles/googleSheetsReader');
const { loginComoAdmin } = require('./utiles/login');
const { ProductLoader } = require('./componentes/productLoader');
const { DocumentsPage } = require('./paginas/documents');
const { ConfigApplier } = require('./componentes/configApplier');
const { notificarDiscord } = require('./utiles/discordNotifier');
const { leerLineasProducto } = require('./utiles/lecturaPrecios');
require('dotenv').config();
const fs = require('fs');
const util = require('util');

const logStream = fs.createWriteStream('resultado-corrida.log', { flags: 'w' });
const _log = console.log.bind(console);
const _err = console.error.bind(console);
console.log = (...a) => { _log(...a); logStream.write(util.format(...a) + '\n'); };
console.error = (...a) => { _err(...a); logStream.write(util.format(...a) + '\n'); };

const urlExcel = process.argv[2];

if (!urlExcel) {
    console.error('❌ Tenés que pasar la URL del Excel');
    console.log('Ejemplo: node test-rapido.js "https://docs.google.com/spreadsheets/d/xxxxx"');
    process.exit(1);
}

(async () => {
    console.log('📖 Leyendo casos de prueba desde Google Sheets...');
    const casos = await leerCasosDePrueba(urlExcel);
    console.log(`✅ Se encontraron ${casos.length} casos`);

    const browser = await chromium.launch({ headless: false, slowMo: 80, args: ['--start-maximized'] });

    let numeroCaso = 0;
    for (const caso of casos) {
        numeroCaso++;
        const m = caso.probarMetodos;
        console.log('\n' + '═'.repeat(72));
        console.log(`🔍 CASO #${numeroCaso}  |  Cuenta: ${caso.cuentaID}  |  Documento: ${caso.documento}  |  Cliente: ${caso.clienteID}`);
        console.log(`   Producto: ${caso.producto.codigoInterno} / barra ${caso.producto.codigoBarra}  |  Plantilla: ${caso.plantillaNombre || '-'}`);
        console.log(`   Métodos:  manual=${m.manual}  codigoBarra=${m.codigoBarra}  asignMultiple=${m.asignMultiple}  plantilla=${m.plantilla}`);
        console.log(`   Configuraciones: ${JSON.stringify(caso.configuraciones)}`);
        console.log('═'.repeat(72));

        const inicioCaso = Date.now();
        let exito = false;
        let reglaDescuentoOk = true;
        let guardado = { intentado: false, estado: 'desconocido', mensaje: '' };
        let tiposCarga = [];
        let configsAplicadas = {};
        let precioAntes = '-';
        let precioDespues = '-';
        let precioUnitario = '-';
        const nombreMetodo = { manual: 'Manual', codigoBarra: 'Código de barra', asignMultiple: 'Asignación múltiple', plantilla: 'Plantilla' };
        const fmtPrecios = (arr) => arr.length ? [...new Set(arr)].map(n => '$' + Number(n).toLocaleString('es-AR')).join(', ') : '-';

        const metodosEsperados = [
            m.manual && caso.producto.codigoInterno,
            m.codigoBarra && caso.producto.codigoBarra,
            m.asignMultiple && caso.producto.codigoInterno,
            m.plantilla && caso.plantillaNombre,
        ].filter(Boolean).length;

        const context = await browser.newContext({ viewport: null });
        const page = await context.newPage();

        try {
            await loginComoAdmin(page, caso.cuentaID);
            console.log(`✅ Login exitoso en cuenta ${caso.cuentaID}`);

            const documentsPage = new DocumentsPage(page, caso.documento);
            await documentsPage.navegar(caso.documento);
            console.log(`✅ Navegó a ${caso.documento}`);

            if (caso.clienteID && caso.clienteID !== '') {
                await documentsPage.seleccionarCliente(caso.clienteID);
                console.log(`✅ Cliente ${caso.clienteID} seleccionado`);
            }

            const productLoader = new ProductLoader(page, caso.documento);
            const preciosAntes = [];

            console.log('\n📦 Cargando productos SIN configuraciones:');

            if (caso.probarMetodos.manual && caso.producto.codigoInterno) {
                try {
                    console.log('📦 Probando carga manual...');
                    const precio = await productLoader.cargarManual(caso.producto.codigoInterno);
                    if (precio > 0) {
                        preciosAntes.push({ metodo: 'manual', precio });
                        console.log(`   ✅ Precio: ${precio}`);
                    } else {
                        console.log('   ⚠️ Manual no cargó el producto — se OMITE de la comparación');
                    }
                } catch (e) {
                    console.log(`   ❌ Error en manual: ${e.message}`);
                }
                await page.waitForTimeout(500);
            }

            if (caso.probarMetodos.codigoBarra && caso.producto.codigoBarra) {
                try {
                    console.log('📷 Probando código de barra...');
                    const precio = await productLoader.cargarPorCodigoBarra(caso.producto.codigoBarra);
                    if (precio > 0) {
                        preciosAntes.push({ metodo: 'codigoBarra', precio });
                        console.log(`   ✅ Precio: ${precio}`);
                    } else {
                        console.log('   ⚠️ Código de barra no cargó el producto — se OMITE de la comparación');
                    }
                } catch (e) {
                    console.log(`   ❌ Error en código de barra: ${e.message}`);
                }
                await page.waitForTimeout(500);
            }

            if (caso.probarMetodos.asignMultiple && caso.producto.codigoInterno) {
                try {
                    console.log('📋 Probando asignación múltiple...');
                    const precio = await productLoader.cargarAsignacionMultiple(caso.producto.codigoInterno);
                    if (precio > 0) {
                        preciosAntes.push({ metodo: 'asignMultiple', precio });
                        console.log(`   ✅ Precio: ${precio}`);
                    } else {
                        console.log('   ⚠️ Asignación múltiple no cargó el producto — se OMITE de la comparación');
                    }
                } catch (e) {
                    console.log(`   ❌ Error en asignación múltiple: ${e.message}`);
                }
                await page.waitForTimeout(500);
            }

            if (caso.probarMetodos.plantilla && caso.plantillaNombre) {
                try {
                    console.log('📄 Probando plantilla...');
                    const precio = await productLoader.cargarDesdePlantilla(caso.plantillaNombre);
                    if (precio > 0) {
                        preciosAntes.push({ metodo: 'plantilla', precio });
                        console.log(`   ✅ Precio: ${precio}`);
                    } else {
                        console.log('   ⚠️ Plantilla no cargó el producto — se OMITE de la comparación');
                    }
                } catch (e) {
                    console.log(`   ❌ Error en plantilla: ${e.message}`);
                }
                await page.waitForTimeout(500);
            }

            tiposCarga = preciosAntes.map(p => nombreMetodo[p.metodo] || p.metodo);
            precioAntes = fmtPrecios(preciosAntes.map(p => p.precio));

            const reglaKey = Object.keys(caso.configuraciones || {}).find(k =>
                /^reglas?_(de_)?descuentos?$/.test(String(k).replace(/\s+/g, '_')));
            if (reglaKey) {
                const raw = String(caso.configuraciones[reglaKey] || '').trim();
                const m = raw.match(/^\(\s*(cliente|zona|vendedor)\s*\)\s*(.+)$/i);
                const tipo = m ? m[1].toLowerCase() : 'cliente';
                const dato = m ? m[2].trim() : raw;
                if (!dato || /^(cliente|zona|vendedor)$/i.test(dato)) {
                    console.log(`\n🏷️ Regla de descuento: falta el dato. Usá "regla_descuentos: (cliente) 0002" o "regla_descuentos: (vendedor) Fede". Se omite el cambio.`);
                } else {
                    console.log(`\n🏷️ Regla de descuento (${tipo}): cambiando a "${dato}"...`);
                    try {
                        page.once('dialog', d => d.accept().catch(() => {}));
                        if (tipo === 'vendedor') await documentsPage.seleccionarVendedor(dato);
                        else await documentsPage.seleccionarCliente(dato);
                        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
                        await page.waitForTimeout(2500);
                        console.log(`   ✅ Cambiado (${tipo}: ${dato}); Fidel recalcula con la regla.`);
                    } catch (e) {
                        console.log(`   ❌ No pude cambiar ${tipo} a "${dato}": ${e.message}`);
                    }
                }
            }

            if (caso.configuraciones && Object.keys(caso.configuraciones).length > 0) {
                console.log('\n⚙️ Aplicando configuraciones...');
                const configApplier = new ConfigApplier(page, caso.documento);
                configsAplicadas = await configApplier.aplicar(caso.configuraciones, caso.producto.codigoInterno);
                console.log(`✅ Configuraciones aplicadas`);
                await page.waitForTimeout(2000);
            } else {
                console.log('⚠️ No hay configuraciones para aplicar');
            }

        console.log('\n💰 Leyendo precios DESPUÉS de configuraciones:');

        await page.waitForTimeout(3000);

        const lineasDetalle = await page.evaluate(leerLineasProducto, caso.documento);
        const preciosDespues = lineasDetalle.map(l => l.total).filter(p => p > 0);

        console.log(`   Precios DESPUÉS: ${preciosDespues.join(', ')}`);
        console.log(`   Cantidad de precios: ${preciosDespues.length}`);

        console.log('\n📊 DETALLE POR LÍNEA (Precio / Cantidad / Bonif. / Total):');
        lineasDetalle.forEach((l, i) =>
            console.log(`   Línea ${i + 1}: precio=${l.precio}  cant=${l.cantidad}  bonif=${l.bonificacion}  total=${l.total}  [${l.fuente}]`));

        const tieneRango = Object.keys(caso.configuraciones || {}).some(k =>
            k.replace(/\s+/g, '_').replace('rango_de_precios', 'rango_precios') === 'rango_precios');
        if (tieneRango) {
            precioUnitario = fmtPrecios(lineasDetalle.map(l => l.precio).filter(p => p > 0));
        }

        const camposComparar = [
            ['precio', 'Precio (unitario)'],
            ['cantidad', 'Cantidad'],
            ['bonificacion', 'Bonificación'],
            ['total', 'Total'],
        ];
        let camposConsistentes = lineasDetalle.length > 0;
        for (const [campo, etiqueta] of camposComparar) {
            const distintos = [...new Set(lineasDetalle.map(l => l[campo]))];
            if (distintos.length === 1) {
                console.log(`   ✅ ${etiqueta}: coincide en todas las líneas (${distintos[0]})`);
            } else {
                camposConsistentes = false;
                console.log(`   ❌ ${etiqueta}: NO coincide -> ${distintos.join(', ')}`);
            }
        }
        if (lineasDetalle.length && lineasDetalle[0].precio === 0) {
            console.log(`   ⚠️ "Precio" vino 0: quizá el campo no se llama ".Precio". Campos de la línea: ${lineasDetalle[0].campos.join(', ')}`);
        }

        const tieneReglaDescuento = Object.keys(caso.configuraciones || {}).some(k =>
            /^reglas?_(de_)?descuentos?$/.test(String(k).replace(/\s+/g, '_')));
        if (tieneReglaDescuento && lineasDetalle.length) {
            const bonifs = [...new Set(lineasDetalle.map(l => l.bonificacion))];

            const r2 = (n) => Math.round(n * 100) / 100;
            const baseSet = [...new Set(preciosAntes.map(p => p.precio))];
            const descSet = [...new Set(lineasDetalle.map(l => l.cantidad > 0 ? r2(l.total / l.cantidad) : l.total))];
            console.log('\n🏷️ REGLA DE DESCUENTO (verificación del efecto):');

            let bonifOk = false;
            if (bonifs.length === 1) {
                const b = bonifs[0];
                bonifOk = b > 0;
                console.log(`   ${bonifOk ? '✅' : '⚠️'} Bonificación uniforme en las ${lineasDetalle.length} carga(s): ${b}%`);
                if (!bonifOk) console.log('   ⚠️ La bonificación quedó en 0: el cliente con la regla quizá no la tiene, o por zona/vendedor no se disparó en este documento.');
            } else {
                console.log(`   ❌ La bonificación NO es igual entre cargas: ${bonifs.join(', ')}% → la regla no se aplicó pareja.`);
            }

            let bajoOk = false;
            if (baseSet.length === 1 && descSet.length === 1) {
                const base = baseSet[0], desc = descSet[0];
                if (desc < base) {
                    const pct = base > 0 ? Math.round((1 - desc / base) * 1000) / 10 : 0;
                    bajoOk = true;
                    console.log(`   ✅ El precio por unidad BAJÓ con la regla: base $${base} → con descuento $${desc} (~${pct}% menos).`);
                } else if (desc === base) {
                    console.log(`   ❌ El precio por unidad NO cambió (base $${base} = con regla $${desc}): la regla no tuvo efecto.`);
                } else {
                    console.log(`   ❌ El precio por unidad SUBIÓ (base $${base} → $${desc}): algo está mal, revisar la regla.`);
                }
            } else {
                console.log(`   ⚠️ No pude comparar por unidad (base: ${baseSet.join(', ') || '-'} / con regla: ${descSet.join(', ') || '-'}).`);
            }

            reglaDescuentoOk = bonifOk && bajoOk;
        }

            console.log('\n📊 VERIFICACIÓN ANTES de configuraciones:');
            const preciosUnicosAntes = [...new Set(preciosAntes.map(p => p.precio))];
            if (preciosUnicosAntes.length === 1) {
                console.log(`✅ ANTES: Todos los métodos dan el mismo precio: ${preciosUnicosAntes[0]}`);
            } else {
                console.log(`❌ ANTES: Los precios NO coinciden`);
                preciosAntes.forEach(p => console.log(`   ${p.metodo}: ${p.precio}`));
            }

            console.log('\n📊 VERIFICACIÓN DESPUÉS de configuraciones:');
            const preciosUnicosDespues = [...new Set(preciosDespues)];

            exito = preciosDespues.length > 0 && preciosUnicosDespues.length === 1 && camposConsistentes && reglaDescuentoOk;
            precioDespues = fmtPrecios(preciosDespues);
            if (preciosUnicosDespues.length === 1) {
                console.log(`✅ DESPUÉS: Todos los productos tienen el mismo precio: ${preciosUnicosDespues[0]}`);
            } else {
                console.log(`❌ DESPUÉS: Los precios NO coinciden`);
                preciosDespues.forEach((p, i) => console.log(`   Producto ${i+1}: ${p}`));
            }

            console.log('\n💾 Guardando el documento...');
            guardado = await documentsPage.guardar({ confirmar: true });
            const iconoGuardado = guardado.estado === 'ok' ? '✅ OK' : guardado.estado === 'error' ? '❌ Error (Fidel)' : '⚠️ no concluyente';
            console.log(`   Resultado del guardado: ${iconoGuardado}${guardado.mensaje ? ' -> ' + guardado.mensaje : ''}`);

            await page.waitForTimeout(2000);

        } catch (error) {
            console.error(`❌ Error en caso: ${error.message}`);
        }

        await context.close();

        const duracionMs = Date.now() - inicioCaso;
        await notificarDiscord({
            exito,
            duracionMs,
            cuentaID: caso.cuentaID,
            productoID: caso.producto.codigoInterno,
            documento: caso.documento,
            tiposCarga,
            metodosEsperados,
            configs: configsAplicadas,
            precioUnitario,
            precioAntes,
            precioDespues,
            guardado,
        });
    }

    await browser.close();
    console.log('\n🏁 Prueba finalizada');
})();