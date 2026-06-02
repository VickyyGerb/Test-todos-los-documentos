require('dotenv').config();
const { expect } = require('@playwright/test');

async function loginComoAdmin(page, cuentaID) {
    const urlBase = process.env.URL_BASE;
    const adminEmail = process.env.ADMIN_USER;
    const adminPass = process.env.ADMIN_PASS;

    // Validar que CuentaID sea un número. Si viene vacío o con texto (ej. quedó
    // "cuentaID" en la planilla), el campo "ID de cuenta" de la web se rompe con
    // NaN. Cortamos antes con un mensaje claro.
    const cuenta = (cuentaID || '').toString().trim();
    if (!/^\d+$/.test(cuenta)) {
        throw new Error(`❌ CuentaID inválido: "${cuentaID}". Tiene que ser un número. Revisá la primera columna (CuentaID) de la planilla.`);
    }

    await page.goto(urlBase);
    await page.getByRole('textbox', { name: 'Email' }).fill(adminEmail);
    await page.getByRole('textbox', { name: 'Contraseña' }).fill(adminPass);

    await page.getByRole('button', { name: 'Ingresar' }).click();
    await page.waitForNavigation();
    await page.waitForLoadState('networkidle');

    await page.getByRole('textbox', { name: 'ID de cuenta' }).fill(cuenta);
    await page.getByRole('button', { name: 'Ingresar' }).click();

    await page.waitForNavigation(5000);
}
module.exports = { loginComoAdmin };