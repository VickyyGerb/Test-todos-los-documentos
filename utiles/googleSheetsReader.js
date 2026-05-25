const fs = require('fs');
const path = require('path');

async function leerCasosDePrueba(url) {
    const matches = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (!matches) {
        throw new Error('URL de Google Sheets inválida');
    }
    
    const sheetId = matches[1];
    const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`;
    
    console.log('Descargando desde:', csvUrl);
    
    const response = await fetch(csvUrl);
    if (!response.ok) {
        throw new Error(`Error al descargar el CSV: ${response.status}`);
    }
    
    const csvText = await response.text();
    
    const lines = csvText.split('\n');
    const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
    
    console.log('📋 HEADERS (columnas del Excel):', headers);
    
    const casos = [];
    
    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        
        const values = lines[i].split(',');
        const row = {};
        
        for (let j = 0; j < headers.length; j++) {
            let valor = values[j];
            if (valor) {
                valor = valor.replace(/"/g, '').trim();
            }
            row[headers[j]] = valor || '';
        }
        
        console.log('==================================');
        console.log(`📌 FILA ${i}:`);
        console.log('  CuentaID:', row['CuentaID']);
        console.log('  Documento:', row['Documento']);
        console.log('  ClienteID:', row['ClienteID']);
        console.log('  Producto_Codigo:', row['Producto_Codigo']);
        console.log('  Producto_CodigoBarra:', row['Producto_CodigoBarra']);
        console.log('  Probar_Manual:', row['Probar_Manual']);
        console.log('  Probar_CodigoBarra:', row['Probar_CodigoBarra']);
        console.log('  Probar_AsignMultiple:', row['Probar_AsignMultiple']);
        console.log('  Probar_Plantilla:', row['Probar_Plantilla']);
        console.log('  Plantilla_Nombre:', row['Plantilla_Nombre']);
        console.log('==================================');
        
        const tieneMetodo = row['Probar_Manual'] === 'SI' || 
                           row['Probar_CodigoBarra'] === 'SI' || 
                           row['Probar_AsignMultiple'] === 'SI' || 
                           row['Probar_Plantilla'] === 'SI';
        
        if (!tieneMetodo) {
            console.log(`⚠️ Caso sin métodos de carga, omitiendo fila ${i}`);
            continue;
        }
        
        casos.push({
            cuentaID: row['CuentaID'] || '',
            documento: (row['Documento'] || '').toLowerCase(),
            clienteID: row['ClienteID'] || '',
            producto: {
                codigoInterno: row['Producto_Codigo'] || '',  // ← SOLO CAMBIÉ ESTO
                codigoBarra: row['Producto_CodigoBarra'] || ''
            },
            probarMetodos: {
                manual: row['Probar_Manual'] === 'SI',
                codigoBarra: row['Probar_CodigoBarra'] === 'SI',
                asignMultiple: row['Probar_AsignMultiple'] === 'SI',
                plantilla: row['Probar_Plantilla'] === 'SI'
            },
            plantillaNombre: row['Plantilla_Nombre'] || null,
            configuraciones: convertirConfiguraciones(row['Configuraciones'] || '')
        });
    }
    
    console.log(`✅ Procesados ${casos.length} casos de prueba`);
    return casos;
}

function convertirConfiguraciones(configString) {
    if (!configString || configString.trim() === '') {
        return {};
    }
    
    const configs = {};
    const pares = configString.split(',');
    
    for (const par of pares) {
        const [clave, valor] = par.split(':');
        if (clave && valor) {
            configs[clave.trim()] = valor.trim();
        }
    }
    
    return configs;
}

module.exports = { leerCasosDePrueba };