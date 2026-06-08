require('dotenv').config();

function formatearDuracion(ms) {
    const totalSeg = Math.round(ms / 1000);
    const h = Math.floor(totalSeg / 3600);
    const m = Math.floor((totalSeg % 3600) / 60);
    const s = totalSeg % 60;
    const partes = [];
    if (h) partes.push(`${h}h`);
    if (m) partes.push(`${m}m`);
    if (s || partes.length === 0) partes.push(`${s}s`);
    return partes.join(' ');
}

async function notificarDiscord({ exito, duracionMs, cuentaID, productoID, documento, tiposCarga, metodosEsperados, configs, precioUnitario, precioAntes, precioDespues, guardado }) {
    const url = process.env.DISCORD_WEBHOOK_URL;
    if (!url) {
        console.log('⚠️ No hay DISCORD_WEBHOOK_URL en .env — no se envía notificación a Discord');
        return;
    }

    const cargados = (tiposCarga && tiposCarga.length) || 0;
    let estado = exito ? '✅ EXITOSO' : '❌ FALLÓ';

    if (exito && metodosEsperados && cargados < metodosEsperados) {
        estado = `✅ EXITOSO (${cargados} de ${metodosEsperados} métodos)`;
    }
    const configsTexto = (configs && Object.keys(configs).length)
        ? Object.entries(configs).map(([k, v]) => `${k}: ${v}`).join('\n')
        : '-';

    const fields = [
        { name: 'Resultado', value: estado, inline: true },
        { name: 'Tiempo de test', value: formatearDuracion(duracionMs), inline: true },
        { name: 'Cuenta', value: String(cuentaID || '-'), inline: true },
        { name: 'Producto', value: String(productoID || '-'), inline: true },
        { name: 'Documento', value: String(documento || '-'), inline: true },
        { name: 'Tipos de carga', value: (tiposCarga && tiposCarga.length) ? tiposCarga.join(', ') : '-', inline: false },
        { name: 'Configuraciones', value: configsTexto, inline: false },
    ];

    const hayConfigs = configs && Object.keys(configs).length > 0;
    if (!hayConfigs) {

        fields.push({ name: 'Precio', value: String(precioDespues || precioAntes || '-'), inline: false });
    } else {

        fields.push({ name: 'Precio antes de configs', value: String(precioAntes || '-'), inline: false });
        const hayUnitario = precioUnitario && precioUnitario !== '-';
        if (hayUnitario) {
            fields.push({ name: 'Precio x producto (unit.)', value: String(precioUnitario), inline: true });
        }
        fields.push({ name: 'Precio después de configs', value: String(precioDespues || '-'), inline: true });
    }

    if (guardado && guardado.estado) {
        let txt;
        if (guardado.estado === 'ok') txt = `✅ Guardado OK${guardado.mensaje ? ` — ${guardado.mensaje}` : ''}`;
        else if (guardado.estado === 'error') txt = `❌ Error al guardar${guardado.mensaje ? ` — ${guardado.mensaje}` : ''}`;
        else txt = `⚠️ No concluyente${guardado.mensaje ? ` — ${guardado.mensaje}` : ''}`;
        fields.push({ name: 'Guardado', value: txt.slice(0, 1024), inline: false });
    }

    const embed = {
        title: `Test ${estado}`,
        color: exito ? 0x2ecc71 : 0xe74c3c,
        fields,
    };

    try {
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ embeds: [embed] }),
        });
        if (!resp.ok) {
            console.log(`⚠️ Discord respondió ${resp.status} al enviar la notificación`);
        } else {
            console.log('📨 Notificación enviada a Discord');
        }
    } catch (e) {
        console.log(`⚠️ No pude notificar a Discord: ${e.message}`);
    }
}

module.exports = { notificarDiscord, formatearDuracion };
