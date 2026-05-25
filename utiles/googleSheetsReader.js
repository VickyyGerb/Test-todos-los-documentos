const fs = require('fs');
const path = require('path');

async function leerCasosDePrueba(url) {
    // Extraer el ID de la hoja desde la URL
    const matches = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (!matches) {
        throw new Error('URL de Google Sheets inválida');
    }
    
    const sheetId = matches[1];
    const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`;
    
    console.log('Descargando desde:', csvUrl);
    
    // Descargar el CSV
    const response = await fetch(csvUrl);
    if (!response.ok) {
        throw new Error(`Error al descargar el CSV: ${response.status}`);
    }
    
    const csvText = await response.text();
    
    // Parsear el CSV
    const lines = csvText.split('\n');
    const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
    
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
        
        // Solo agregar si tiene al menos un método para probar
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
            documento: (row['Documento'] || '').toLowerCase(), // Normalizado a minúsculas
            clienteID: row['ClienteID'] || '',
            producto: {
                codigoInterno: row['Producto_CodigoInterno'] || '',
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