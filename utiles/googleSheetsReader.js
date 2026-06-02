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

    // Parser de CSV que respeta comillas: las celdas con comas (ej. la columna
    // Configuraciones) no se rompen. split(',') simple no servía.
    const filas = parseCsv(csvText);
    const headers = (filas[0] || []).map(h => h.trim());

    console.log('📋 HEADERS (columnas del Excel):', headers);

    const casos = [];

    for (let i = 1; i < filas.length; i++) {
        const values = filas[i];
        if (!values || values.join('').trim() === '') continue;

        const row = {};
        for (let j = 0; j < headers.length; j++) {
            row[headers[j]] = (values[j] || '').trim();
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
        console.log('  Configuraciones (crudo):', row['Configuraciones']);
        console.log('==================================');
        
        const tieneMetodo = row['Probar_Manual'] === 'SI' || 
                           row['Probar_CodigoBarra'] === 'SI' || 
                           row['Probar_AsignMultiple'] === 'SI' || 
                           row['Probar_Plantilla'] === 'SI';
        
        if (!tieneMetodo) {
            console.log(`⚠️ Caso sin métodos de carga, omitiendo fila ${i}`);
            continue;
        }
        
        const configuraciones = convertirConfiguraciones(row['Configuraciones'] || '');
        console.log('📋 Configuraciones convertidas:', configuraciones);
        
        casos.push({
            cuentaID: row['CuentaID'] || '',
            documento: (row['Documento'] || '').toLowerCase(),
            clienteID: row['ClienteID'] || '',
            producto: {
                codigoInterno: row['Producto_Codigo'] || '',
                codigoBarra: row['Producto_CodigoBarra'] || ''
            },
            probarMetodos: {
                manual: row['Probar_Manual'] === 'SI',
                codigoBarra: row['Probar_CodigoBarra'] === 'SI',
                asignMultiple: row['Probar_AsignMultiple'] === 'SI',
                plantilla: row['Probar_Plantilla'] === 'SI'
            },
            plantillaNombre: row['Plantilla_Nombre'] || null,
            configuraciones: configuraciones
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
    // Formato: clave: valor, clave: valor, ...  (separadas por coma)
    for (const par of configString.split(',')) {
        const idx = par.indexOf(':');
        if (idx === -1) continue;
        const clave = par.slice(0, idx).replace(/"/g, '').trim();
        const valor = par.slice(idx + 1).replace(/"/g, '').trim();
        if (clave && valor) {
            configs[clave] = valor;
        }
    }

    return configs;
}

// Parser de CSV: respeta comillas dobles (celdas con comas o saltos de línea)
// y comillas escapadas (""). Devuelve un array de filas (cada fila, array de celdas).
function parseCsv(text) {
    const filas = [];
    let fila = [];
    let celda = '';
    let entreComillas = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (entreComillas) {
            if (ch === '"') {
                if (text[i + 1] === '"') { celda += '"'; i++; } // comilla escapada
                else entreComillas = false;
            } else {
                celda += ch;
            }
        } else {
            if (ch === '"') entreComillas = true;
            else if (ch === ',') { fila.push(celda); celda = ''; }
            else if (ch === '\n') { fila.push(celda); filas.push(fila); fila = []; celda = ''; }
            else if (ch === '\r') { /* ignorar CR */ }
            else celda += ch;
        }
    }
    if (celda !== '' || fila.length > 0) { fila.push(celda); filas.push(fila); }
    return filas;
}

module.exports = { leerCasosDePrueba };