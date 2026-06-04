const { chromium } = require('@playwright/test');
const { leerCasosDePrueba } = require('./utiles/googleSheetsReader');
const { loginComoAdmin } = require('./utiles/login');
const { ProductLoader } = require('./componentes/productLoader');
const { DocumentsPage } = require('./paginas/documents');
const { ConfigApplier } = require('./componentes/configApplier');
const { notificarDiscord } = require('./utiles/discordNotifier');
require('dotenv').config();
const fs = require('fs');
const util = require('util');

// Guardar TODO lo que se imprime en la terminal a un archivo, para poder
// analizar la corrida completa (cada caso con su banner). Se sobrescribe en
// cada corrida.
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
        let tiposCarga = [];
        let configsAplicadas = {};
        let precioAntes = '-';
        let precioDespues = '-';
        const nombreMetodo = { manual: 'Manual', codigoBarra: 'Código de barra', asignMultiple: 'Asignación múltiple', plantilla: 'Plantilla' };
        const fmtPrecios = (arr) => arr.length ? [...new Set(arr)].map(n => '$' + Number(n).toLocaleString('es-AR')).join(', ') : '-';

        // Contexto propio por caso: sesión limpia (sin arrastrar el login del anterior).
        // viewport null = usa el tamaño real de la ventana (maximizada).
        const context = await browser.newContext({ viewport: null });
        const page = await context.newPage();

        try {
            await loginComoAdmin(page, caso.cuentaID);
            console.log(`✅ Login exitoso en cuenta ${caso.cuentaID}`);
            
            const documentsPage = new DocumentsPage(page);
            await documentsPage.navegar(caso.documento);
            console.log(`✅ Navegó a ${caso.documento}`);
            
            if (caso.clienteID && caso.clienteID !== '') {
                await documentsPage.seleccionarCliente(caso.clienteID);
                console.log(`✅ Cliente ${caso.clienteID} seleccionado`);
            }
            
            const productLoader = new ProductLoader(page, caso.documento);
            const preciosAntes = [];
            
            // ==================== 1. CARGAR PRODUCTOS SIN CONFIGURACIONES ====================
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

            // Tipos de carga que REALMENTE cargaron en este documento (los que
            // dieron precio). Los que no aplican/no andan no se incluyen.
            tiposCarga = preciosAntes.map(p => nombreMetodo[p.metodo] || p.metodo);
            precioAntes = fmtPrecios(preciosAntes.map(p => p.precio));

            // ==================== 2. APLICAR CONFIGURACIONES ====================
            if (caso.configuraciones && Object.keys(caso.configuraciones).length > 0) {
                console.log('\n⚙️ Aplicando configuraciones...');
                const configApplier = new ConfigApplier(page, caso.documento);
                configsAplicadas = await configApplier.aplicar(caso.configuraciones, caso.producto.codigoInterno);
                console.log(`✅ Configuraciones aplicadas`);
                await page.waitForTimeout(2000);
            } else {
                console.log('⚠️ No hay configuraciones para aplicar');
            }
            
            // ==================== 3. LEER PRECIOS DESPUÉS DE CONFIGURACIONES ====================
        console.log('\n💰 Leyendo precios DESPUÉS de configuraciones:');

        await page.waitForTimeout(3000);

        // Leer el precio de cada producto cargado. Detectamos los productos por
        // ProductoId (existe en todo documento) y leemos TotalIVA si existe
        // (facturas → con IVA) o, si no, Total (presupuestos → sin IVA por línea).
        const preciosDespues = await page.evaluate((doc) => {
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
        }, caso.documento);

        console.log(`   Precios DESPUÉS: ${preciosDespues.join(', ')}`);
        console.log(`   Cantidad de precios: ${preciosDespues.length}`);
            
            // ==================== 4. VERIFICACIONES ====================
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
            exito = preciosDespues.length > 0 && preciosUnicosDespues.length === 1;
            precioDespues = fmtPrecios(preciosDespues);
            if (preciosUnicosDespues.length === 1) {
                console.log(`✅ DESPUÉS: Todos los productos tienen el mismo precio: ${preciosUnicosDespues[0]}`);
            } else {
                console.log(`❌ DESPUÉS: Los precios NO coinciden`);
                preciosDespues.forEach((p, i) => console.log(`   Producto ${i+1}: ${p}`));
            }
            
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
            configs: configsAplicadas,
            precioAntes,
            precioDespues,
        });
    }

    await browser.close();
    console.log('\n🏁 Prueba finalizada');
})();