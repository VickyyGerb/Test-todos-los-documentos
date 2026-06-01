const { chromium } = require('@playwright/test');
const { leerCasosDePrueba } = require('./utiles/googleSheetsReader');
const { loginComoAdmin } = require('./utiles/login');
const { ProductLoader } = require('./componentes/productLoader');
const { DocumentsPage } = require('./paginas/documents');
const { ConfigApplier } = require('./componentes/configApplier');
require('dotenv').config();

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

    const browser = await chromium.launch({ headless: false, slowMo: 300 });
    
    for (const caso of casos) {
        console.log(`\n🔍 Probando caso: Cuenta ${caso.cuentaID} - ${caso.documento}`);
        
        const page = await browser.newPage();
        
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
            
            const productLoader = new ProductLoader(page);
            const preciosAntes = [];
            
            // ==================== 1. CARGAR PRODUCTOS SIN CONFIGURACIONES ====================
            console.log('\n📦 Cargando productos SIN configuraciones:');
            
            if (caso.probarMetodos.manual && caso.producto.codigoInterno) {
                try {
                    console.log('📦 Probando carga manual...');
                    const precio = await productLoader.cargarManual(caso.producto.codigoInterno);
                    preciosAntes.push({ metodo: 'manual', precio });
                    console.log(`   ✅ Precio: ${precio}`);
                } catch (e) {
                    console.log(`   ❌ Error en manual: ${e.message}`);
                }
                await page.waitForTimeout(500);
            }

            if (caso.probarMetodos.codigoBarra && caso.producto.codigoBarra) {
                try {
                    console.log('📷 Probando código de barra...');
                    const precio = await productLoader.cargarPorCodigoBarra(caso.producto.codigoBarra);
                    preciosAntes.push({ metodo: 'codigoBarra', precio });
                    console.log(`   ✅ Precio: ${precio}`);
                } catch (e) {
                    console.log(`   ❌ Error en código de barra: ${e.message}`);
                }
                await page.waitForTimeout(500);
            }

            if (caso.probarMetodos.asignMultiple && caso.producto.codigoInterno) {
                try {
                    console.log('📋 Probando asignación múltiple...');
                    const precio = await productLoader.cargarAsignacionMultiple(caso.producto.codigoInterno);
                    preciosAntes.push({ metodo: 'asignMultiple', precio });
                    console.log(`   ✅ Precio: ${precio}`);
                } catch (e) {
                    console.log(`   ❌ Error en asignación múltiple: ${e.message}`);
                }
                await page.waitForTimeout(500);
            }

            if (caso.probarMetodos.plantilla && caso.plantillaNombre) {
                try {
                    console.log('📄 Probando plantilla...');
                    const precio = await productLoader.cargarDesdePlantilla(caso.plantillaNombre);
                    preciosAntes.push({ metodo: 'plantilla', precio });
                    console.log(`   ✅ Precio: ${precio}`);
                } catch (e) {
                    console.log(`   ❌ Error en plantilla: ${e.message}`);
                }
                await page.waitForTimeout(500);
            }
            
            // ==================== 2. APLICAR CONFIGURACIONES ====================
            if (caso.configuraciones && Object.keys(caso.configuraciones).length > 0) {
                console.log('\n⚙️ Aplicando configuraciones...');
                const configApplier = new ConfigApplier(page);
                await configApplier.aplicar(caso.configuraciones, caso.producto.codigoInterno);
                console.log(`✅ Configuraciones aplicadas`);
                await page.waitForTimeout(2000);
            } else {
                console.log('⚠️ No hay configuraciones para aplicar');
            }
            
            // ==================== 3. LEER PRECIOS DESPUÉS DE CONFIGURACIONES ====================
        console.log('\n💰 Leyendo precios DESPUÉS de configuraciones:');

        await page.waitForTimeout(3000);

        const preciosDespues = await page.evaluate(() => {
            const resultados = [];
            const filas = document.querySelectorAll('table tbody tr');
            
            console.log('Filas encontradas:', filas.length);
            
            for (let i = 0; i < filas.length; i++) {
                const fila = filas[i];
                const celdas = fila.querySelectorAll('td');
                console.log(`Fila ${i+1} - Cantidad de celdas:`, celdas.length);
                
                for (let j = 0; j < celdas.length; j++) {
                    const texto = celdas[j].textContent.trim();
                    if (texto && texto !== '') {
                        console.log(`  Celda ${j+1}: "${texto}"`);
                    }
                }
                
                // Buscar la última celda que tenga número de precio
                for (let j = celdas.length - 1; j >= 0; j--) {
                    const texto = celdas[j].textContent.trim();
                    const match = texto.match(/(\d{1,3}(?:\.\d{3})*,\d{2})/);
                    if (match) {
                        const numero = parseFloat(match[1].replace(/\./g, '').replace(',', '.'));
                        if (numero > 0 && numero < 1000000) {
                            resultados.push(numero);
                            console.log(`  PRECIO ENCONTRADO: ${numero} en celda ${j+1}`);
                            break;
                        }
                    }
                }
            }
            
            return resultados;
        });

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
        
        await page.close();
    }
    
    await browser.close();
    console.log('\n🏁 Prueba finalizada');
})();