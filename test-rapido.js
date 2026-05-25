const { chromium } = require('@playwright/test');
const { leerCasosDePrueba } = require('./utiles/googleSheetsReader');
const { loginComoAdmin } = require('./utiles/login');
const { ProductLoader } = require('./componentes/productLoader');
const { DocumentsPage } = require('./paginas/documents');
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

    const browser = await chromium.launch({ headless: false });
    
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
            const precios = [];
            
            // 1. MANUAL primero
            if (caso.probarMetodos.manual && caso.producto.codigoInterno) {
                console.log('📦 Probando carga manual...');
                const precio = await productLoader.cargarManual(caso.producto.codigoInterno);
                precios.push({ metodo: 'manual', precio });
                console.log(`   Precio: ${precio}`);
            }
            
            // 2. CÓDIGO DE BARRA segundo
            if (caso.probarMetodos.codigoBarra && caso.producto.codigoBarra) {
                console.log('📷 Probando código de barra...');
                const precio = await productLoader.cargarPorCodigoBarra(caso.producto.codigoBarra);
                precios.push({ metodo: 'codigoBarra', precio });
                console.log(`   Precio: ${precio}`);
            }
            
            // 3. ASIGNACIÓN MÚLTIPLE tercero
            if (caso.probarMetodos.asignMultiple && caso.producto.codigoInterno) {
                console.log('📋 Probando asignación múltiple...');
                const precio = await productLoader.cargarAsignacionMultiple(caso.producto.codigoInterno);
                precios.push({ metodo: 'asignMultiple', precio });
                console.log(`   Precio: ${precio}`);
            }
            
            // 4. PLANTILLA cuarto
            if (caso.probarMetodos.plantilla && caso.plantillaNombre) {
                console.log('📄 Probando plantilla...');
                const precio = await productLoader.cargarDesdePlantilla(caso.plantillaNombre);
                precios.push({ metodo: 'plantilla', precio });
                console.log(`   Precio: ${precio}`);
            }
            
            const preciosUnicos = [...new Set(precios.map(p => p.precio))];
            if (preciosUnicos.length === 1) {
                console.log(`✅ ÉXITO: Todos los precios coinciden en ${preciosUnicos[0]}`);
            } else {
                console.log(`❌ ERROR: Los precios no coinciden`);
                precios.forEach(p => console.log(`   ${p.metodo}: ${p.precio}`));
            }
            
            await page.waitForTimeout(3000);
            
        } catch (error) {
            console.error(`❌ Error en caso: ${error.message}`);
        }
        
        await page.close();
    }
    
    await browser.close();
    console.log('\n🏁 Prueba finalizada');
})();