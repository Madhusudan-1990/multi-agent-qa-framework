const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 1,
  workers: 2,
  use: {
    baseURL: 'https://ecommerce-api.fastapicloud.dev',
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Accept: 'application/json' },
  },
  reporter: [['list'], ['html', { open: 'never' }]],
});
