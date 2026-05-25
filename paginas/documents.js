class DocumentsPage {
    constructor(page) {
        this.page = page;
    }

    async navegar(tipoDocumento) {
        switch(tipoDocumento) {
            case 'factura':
                await this.page.goto("https://dev.fidel.com.ar/Sistema/Venta/Crear")
                await this.page.waitForLoadState('networkidle');
                break;
            case 'presupuesto':
                await this.page.goto("https://dev.fidel.com.ar/Sistema/PresupuestoVenta/Crear")
                await this.page.waitForLoadState('networkidle');
                break;
            case 'venta_unificada':
                await this.page.goto("https://dev.fidel.com.ar/Sistema/ComprobanteRapido/Crear")
                break;
            case 'pedido':
                await this.page.goto("https://dev.fidel.com.ar/Sistema/Pedido/Crear")
                await this.page.waitForLoadState('networkidle');
                break;
            case 'remito':
                await this.page.goto("https://dev.fidel.com.ar/Sistema/Remito/Crear")
                await this.page.waitForLoadState('networkidle');
                break;
            default:
                throw new Error(`Documento desconocido: ${tipoDocumento}`);
        }
        await this.page.waitForLoadState('networkidle');
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