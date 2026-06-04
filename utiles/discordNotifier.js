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

async function notificarDiscord({ exito, duracionMs, cuentaID, productoID, documento, tiposCarga, configs, precioAntes, precioDespues }) {
    const url = process.env.DISCORD_WEBHOOK_URL;
    if (!url) {
        console.log('⚠️ No hay DISCORD_WEBHOOK_URL en .env — no se envía notificación a Discord');
        return;
    }

    const estado = exito ? '✅ EXITOSO' : '❌ FALLÓ';
    const configsTexto = (configs && Object.keys(configs).length)
        ? Object.entries(configs).map(([k, v]) => `${k}: ${v}`).join('\n')
        : '-';

    const embed = {
        title: `Test ${estado}`,
        color: exito ? 0x2ecc71 : 0xe74c3c,
        fields: [
            { name: 'Resultado', value: estado, inline: true },
            { name: 'Tiempo de test', value: formatearDuracion(duracionMs), inline: true },
            { name: 'Cuenta', value: String(cuentaID || '-'), inline: true },
            { name: 'Producto', value: String(productoID || '-'), inline: true },
            { name: 'Documento', value: String(documento || '-'), inline: true },
            { name: 'Tipos de carga', value: (tiposCarga && tiposCarga.length) ? tiposCarga.join(', ') : '-', inline: false },
            { name: 'Configuraciones', value: configsTexto, inline: false },
            { name: 'Precio antes de configs', value: String(precioAntes || '-'), inline: true },
            { name: 'Precio después de configs', value: String(precioDespues || '-'), inline: true },
        ],
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
