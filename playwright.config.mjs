import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "portal/tests",
  testMatch: "**/*.spec.mjs",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  outputDir: "work/browser-results",
  use: {
    headless: true,
    launchOptions: {
      ...(process.env.CHROMIUM_PATH
        ? { executablePath: process.env.CHROMIUM_PATH }
        : {}),
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: "mobile",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
