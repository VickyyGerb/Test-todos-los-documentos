// Lectura de las líneas de producto de un documento, tomando SIEMPRE el valor que
// Fidel realmente muestra en pantalla (sin inventar ni calcular IVA).
//
// Esta función se ejecuta DENTRO del navegador (page.evaluate(leerLineasProducto, doc)).
// Por eso es autocontenida: no usa requires, closures ni nada del scope de Node.
//
// El "total" por línea = lo que se ve en la grilla:
//   - factura: campo .TotalIVA (ahí Fidel muestra el total CON IVA).
//   - presupuesto / pedido / remito: campo .Total (NETO, sin IVA). NO se calcula IVA:
//     presupuesto/pedido no lo muestran, así que agregarlo daba números que no
//     existen en Fidel.
function leerLineasProducto(doc) {
    const reId = /^(ListaProducto(?!Libre)\w*?|ProductosLista)\[(.+?)\]\.ProductoId$/;
    const aNum = (t) => parseFloat((t || '').replace(/\./g, '').replace(',', '.')) || 0;
    const val = (p, g, c) => { const el = document.querySelector(`[name="${p}[${g}].${c}"]`); return el ? el.value : null; };

    const out = [];
    document.querySelectorAll('input[name$=".ProductoId"]').forEach(inp => {
        const m = inp.name.match(reId);
        if (!m || !inp.value || inp.value.trim() === '') return;
        const prefijo = m[1], guid = m[2];

        const tIvaRaw = val(prefijo, guid, 'TotalIVA');
        // El total reportado es el que MUESTRA Fidel: TotalIVA si existe (factura),
        // si no el Total neto (presupuesto/pedido/remito). Sin cálculo de IVA.
        const total = tIvaRaw != null ? aNum(tIvaRaw) : aNum(val(prefijo, guid, 'Total'));
        const fuente = tIvaRaw != null ? 'TotalIVA' : 'Total (neto)';

        out.push({
            prefijo, guid,
            precio: aNum(val(prefijo, guid, 'Precio')),
            cantidad: aNum(val(prefijo, guid, 'Cantidad')),
            bonificacion: aNum(val(prefijo, guid, 'Bonificacion')),
            total,
            fuente,
            campos: Array.from(document.querySelectorAll(`[name^="${prefijo}[${guid}]."]`)).map(e => e.name.split('].')[1]),
        });
    });
    return out;
}

module.exports = { leerLineasProducto };
