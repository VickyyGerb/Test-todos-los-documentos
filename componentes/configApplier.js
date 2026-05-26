class ConfigApplier {
    constructor(page) {
        this.page = page;
    }

    async aplicar(configuraciones) {
        console.log('📋 Aplicando configuraciones:', configuraciones);
        for (const [nombre, valor] of Object.entries(configuraciones)) {
            await this.aplicarConfiguracion(nombre, valor);
        }
    }

    async aplicarConfiguracion(nombre, valor) {
        console.log(`⚙️ Aplicando configuración: ${nombre} = ${valor}`);
        
        switch(nombre) {
            case 'descuento_global':
                try {
                    await this.page.getByRole('textbox', { name: 'Descuento $' }).fill(valor);
                    console.log(`   ✅ Descuento global aplicado: ${valor}`);
                } catch (e) {
                    console.log(`   ❌ Error: ${e.message}`);
                }
                break;
            case 'moneda':
                await this.page.selectOption('#moneda', valor);
                break;
            case 'cotizacion':
                await this.page.fill('#cotizacion', valor);
                break;
            case 'lista_precios':
                await this.page.click('#select2-chosen-1');
                await this.page.keyboard.type(valor);
                await this.page.keyboard.press('Enter');
                break;
            case 'descuento_items':
                await this.page.fill('#descuento-items', valor);
                break;
            default:
                console.log(`Configuración no implementada: ${nombre}`);
        }
        await this.page.waitForTimeout(500);
    }
}

module.exports = { ConfigApplier };