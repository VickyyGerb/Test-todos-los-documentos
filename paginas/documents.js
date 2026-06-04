class DocumentsPage {
    constructor(page) {
        this.page = page;
    }

    async navegar(tipoDocumento) {
        const urls = {
            factura: "https://dev.fidel.com.ar/Sistema/Venta/Crear",
            presupuesto: "https://dev.fidel.com.ar/Sistema/PresupuestoVenta/Crear",
            venta_unificada: "https://dev.fidel.com.ar/Sistema/ComprobanteRapido/Crear",
            pedido: "https://dev.fidel.com.ar/Sistema/Pedido/Crear",
            remito: "https://dev.fidel.com.ar/Sistema/Remito/Crear",
        };
        const url = urls[tipoDocumento];
        if (!url) throw new Error(`Documento desconocido: ${tipoDocumento}`);

        for (let intento = 1; intento <= 2; intento++) {
            try {
                await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
                break;
            } catch (e) {
                if (intento === 2) throw e;
                console.log(`   ⚠️ Navegación a ${tipoDocumento} falló (intento ${intento}), reintento: ${e.message}`);
            }
        }
        try {
            await this.page.waitForLoadState('networkidle', { timeout: 15000 });
        } catch (e) {
            console.log(`   ⚠️ networkidle no llegó en 15s, sigo igual`);
        }
    }

    async seleccionarCliente(clienteID) {
        await this.page.click('#select2-chosen-1');
        await this.page.keyboard.type(clienteID);
        await this.page.waitForTimeout(2000);
        await this.page.keyboard.press('Enter');
        await this.page.waitForTimeout(500);
    }
}

module.exports = { DocumentsPage };