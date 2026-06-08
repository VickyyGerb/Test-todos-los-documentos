const fs = require('fs');
const path = require('path');

async function leerCasosDePrueba(url) {
    const matches = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (!matches) {
        throw new Error('URL de Google Sheets inválida');
    }

    const sheetId = matches[1];

    const gidMatch = url.match(/[#&?]gid=([0-9]+)/);
    const gidParam = gidMatch ? `&gid=${gidMatch[1]}` : '';
    const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv${gidParam}`;

    console.log('Descargando desde:', csvUrl, gidMatch ? `(gid=${gidMatch[1]})` : '(primera hoja)');

    const response = await fetch(csvUrl);
    if (!response.ok) {
        throw new Error(`Error al descargar el CSV: ${response.status}`);
    }

    const csvText = await response.text();

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

    const pares = [];
    for (const token of configString.split(',')) {
        if (token.includes(':')) pares.push(token);
        else if (pares.length) pares[pares.length - 1] += ',' + token;
    }

    const configs = {};
    for (const par of pares) {
        const idx = par.indexOf(':');
        if (idx === -1) continue;

        const clave = par.slice(0, idx).replace(/"/g, '').trim()
            .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        const valor = par.slice(idx + 1).replace(/"/g, '').trim();
        if (clave && valor) {
            configs[clave] = valor;
        }
    }

    return configs;
}

function parseCsv(text) {
    const filas = [];
    let fila = [];
    let celda = '';
    let entreComillas = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (entreComillas) {
            if (ch === '"') {
                if (text[i + 1] === '"') { celda += '"'; i++; }
                else entreComillas = false;
            } else {
                celda += ch;
            }
        } else {
            if (ch === '"') entreComillas = true;
            else if (ch === ',') { fila.push(celda); celda = ''; }
            else if (ch === '\n') { fila.push(celda); filas.push(fila); fila = []; celda = ''; }
            else if (ch === '\r') {  }
            else celda += ch;
        }
    }
    if (celda !== '' || fila.length > 0) { fila.push(celda); filas.push(fila); }
    return filas;
}

module.exports = { leerCasosDePrueba };