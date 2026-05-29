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
                console.log('   📦 Carga manual...');
                const precio = await productLoader.cargarManual(caso.producto.codigoInterno);
                preciosAntes.push({ metodo: 'manual', precio });
                console.log(`      Precio: ${precio}`);
                await page.waitForTimeout(500);
            }
            
            if (caso.probarMetodos.codigoBarra && caso.producto.codigoBarra) {
                console.log('   📷 Código de barra...');
                const precio = await productLoader.cargarPorCodigoBarra(caso.producto.codigoBarra);
                preciosAntes.push({ metodo: 'codigoBarra', precio });
                console.log(`      Precio: ${precio}`);
                await page.waitForTimeout(500);
            }
            
            if (caso.probarMetodos.asignMultiple && caso.producto.codigoInterno) {
                console.log('   📋 Asignación múltiple...');
                const precio = await productLoader.cargarAsignacionMultiple(caso.producto.codigoInterno);
                preciosAntes.push({ metodo: 'asignMultiple', precio });
                console.log(`      Precio: ${precio}`);
                await page.waitForTimeout(500);
            }
            
            if (caso.probarMetodos.plantilla && caso.plantillaNombre) {
                console.log('   📄 Plantilla...');
                const precio = await productLoader.cargarDesdePlantilla(caso.plantillaNombre);
                preciosAntes.push({ metodo: 'plantilla', precio });
                console.log(`      Precio: ${precio}`);
                await page.waitForTimeout(500);
            }
            
            // ==================== 2. APLICAR CONFIGURACIONES ====================
            if (caso.configuraciones && Object.keys(caso.configuraciones).length > 0) {
                console.log('\n⚙️ Aplicando configuraciones...');
                const configApplier = new ConfigApplier(page);
                await configApplier.aplicar(caso.configuraciones);
                console.log(`✅ Configuraciones aplicadas`);
                await page.waitForTimeout(2000);
            } else {
                console.log('⚠️ No hay configuraciones para aplicar');
            }
            
            // ==================== 3. VERIFICACIONES ====================
            console.log('\n📊 VERIFICACIÓN ANTES de configuraciones:');
            const preciosUnicosAntes = [...new Set(preciosAntes.map(p => p.precio))];
            if (preciosUnicosAntes.length === 1) {
                console.log(`✅ ANTES: Todos los métodos dan el mismo precio: ${preciosUnicosAntes[0]}`);
            } else {
                console.log(`❌ ANTES: Los precios NO coinciden`);
                preciosAntes.forEach(p => console.log(`   ${p.metodo}: ${p.precio}`));
            }
            
            console.log('\n📊 Los precios DESPUÉS de configuraciones ya fueron capturados por el ConfigApplier');
            
            await page.waitForTimeout(2000);
            
        } catch (error) {
            console.error(`❌ Error en caso: ${error.message}`);
        }
        
        await page.close();
    }
    
    await browser.close();
    console.log('\n🏁 Prueba finalizada');
})();