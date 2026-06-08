require('dotenv').config();
const { expect } = require('@playwright/test');

async function loginComoAdmin(page, cuentaID) {
    const urlBase = process.env.URL_BASE;
    const adminEmail = process.env.ADMIN_USER;
    const adminPass = process.env.ADMIN_PASS;

    const cuenta = (cuentaID || '').toString().trim();
    if (!/^\d+$/.test(cuenta)) {
        throw new Error(`❌ CuentaID inválido: "${cuentaID}". Tiene que ser un número. Revisá la primera columna (CuentaID) de la planilla.`);
    }

    for (let intento = 1; intento <= 2; intento++) {
        try {
            await page.goto(urlBase);
            const email = page.getByRole('textbox', { name: 'Email' });
            await email.waitFor({ state: 'visible', timeout: 15000 });
            await email.fill(adminEmail);
            await page.getByRole('textbox', { name: 'Contraseña' }).fill(adminPass);

            await page.getByRole('button', { name: 'Ingresar' }).click();
            await page.waitForNavigation();
            await page.waitForLoadState('networkidle');

            await page.getByRole('textbox', { name: 'ID de cuenta' }).fill(cuenta);
            await page.getByRole('button', { name: 'Ingresar' }).click();

            await page.waitForNavigation({ timeout: 5000 }).catch(() => {});
            return;
        } catch (e) {
            if (intento === 2) throw e;
            console.log(`   ⚠️ Login intento ${intento} falló, reintento...`);
        }
    }
}
module.exports = { loginComoAdmin };