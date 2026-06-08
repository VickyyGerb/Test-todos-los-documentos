

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
