import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "public", "brand", "landing");
const BASE_URL = process.env.LANDING_SHOT_URL || "http://localhost:3000";
const API_URL = process.env.LANDING_SHOT_API || "http://localhost:8000";

const SHOTS = [
  { label: "Financeiro", file: "financeiro-painel.png", nav: "Financeiro" },
  { label: "RH", file: "rh-painel.png", nav: "RH" },
  { label: "Fila", file: "fila-painel.png", nav: "Fila" },
];

async function login() {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" }),
  });
  if (!response.ok) {
    throw new Error(`Login falhou (${response.status}). Verifique se o backend está em ${API_URL}.`);
  }
  const payload = await response.json();
  if (!payload.access_token) {
    throw new Error("Token de acesso não retornado pelo backend.");
  }
  return payload.access_token;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const token = await login();

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate((accessToken) => {
    window.localStorage.setItem("fin_access_token", accessToken);
  }, token);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".platform-frame", { timeout: 30000 });

  for (const shot of SHOTS) {
    await page.getByRole("button", { name: shot.nav, exact: true }).click();
    await page.waitForTimeout(shot.nav === "Fila" ? 1800 : 1200);

    if (shot.nav === "Fila") {
      const secondTicket = page.locator(".fila-ticket-item").nth(1);
      if (await secondTicket.count()) {
        await secondTicket.click();
        await page.waitForTimeout(600);
      }
    }

    const frame = page.locator(".platform-frame");
    await frame.screenshot({
      path: path.join(OUT_DIR, shot.file),
      type: "png",
    });
    console.log(`Capturado: ${shot.file}`);
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
