require('dotenv').config();
const { expect } = require('@playwright/test');

async function loginComoAdmin(page, cuentaID) {
    const urlBase = process.env.URL_BASE;
    const adminEmail = process.env.ADMIN_USER;
    const adminPass = process.env.ADMIN_PASS;

    await page.goto(urlBase);
    await page.getByRole('textbox', { name: 'Email' }).fill(adminEmail);
    await page.getByRole('textbox', { name: 'Contraseña' }).fill(adminPass);

    await page.getByRole('button', { name: 'Ingresar' }).click();
    await page.waitForNavigation();
    await page.waitForLoadState('networkidle');

    await page.getByRole('textbox', { name: 'ID de cuenta' }).fill(cuentaID);
    await page.getByRole('button', { name: 'Ingresar' }).click();

    await page.waitForNavigation(5000);
}
module.exports = { loginComoAdmin };