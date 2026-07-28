

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

    // Fallback para sistema React (presupuesto_compra, orden_compra, orden, preorden).
    // orden_compra/presupuesto_compra ya andaban bien con el escaneo genérico original — no
    // se tocan. Solo orden/preorden (que estaban rotos) usan primero el campo "Total" real
    // por nombre: "productServiceOrderList[0]total" — SIN punto (confirmado en vivo).
    const esDocumentoReact = ['presupuesto_compra', 'orden_compra', 'orden', 'preorden'].includes(doc);
    const esOrdenServicio = ['orden', 'preorden'].includes(doc);
    if (out.length === 0 && esDocumentoReact) {
        if (esOrdenServicio) {
            Array.from(document.querySelectorAll('input[name$="total"]'))
                .filter(i => i.offsetParent)
                .forEach((inp, idx) => {
                    const v = aNum(inp.value);
                    if (v > 0) {
                        out.push({
                            prefijo: 'React', guid: inp.name || `react-${idx}`,
                            precio: v, cantidad: 1, bonificacion: 0, total: v,
                            fuente: 'React-total',
                            campos: [inp.name || inp.id || `idx-${idx}`],
                        });
                    }
                });
        }

        // Fallback genérico por formato de precio (comportamiento ORIGINAL, sin cambios,
        // sigue siendo el único camino para orden_compra/presupuesto_compra).
        if (out.length === 0) {
            const esFormatoPrecio = (v) => /,\d{2}$/.test(v) || /^\d{1,3}(\.\d{3})*(,\d+)?$/.test(v);
            Array.from(document.querySelectorAll('input[type="text"], input[type="number"]'))
                .filter(i => i.offsetParent && !i.id.startsWith('react-select') && !i.readOnly)
                .forEach((inp, idx) => {
                    const v = aNum(inp.value);
                    if (v > 100 && esFormatoPrecio(inp.value)) {
                        out.push({
                            prefijo: 'React', guid: `react-${idx}`,
                            precio: v, cantidad: 1, bonificacion: 0, total: v,
                            fuente: 'React-input',
                            campos: [inp.name || inp.id || `idx-${idx}`],
                        });
                    }
                });
        }
    }

    return out;
}

module.exports = { leerLineasProducto };
