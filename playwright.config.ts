import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
const python = process.env.RIPPLE_TEST_PYTHON || (existsSync('.venv/bin/python') ? '.venv/bin/python' : 'python3');
const publicBase = process.env.RIPPLE_TEST_BASE_URL?.replace(/\/?$/, '/');
export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: publicBase || 'http://127.0.0.1:5173', ...devices['Desktop Chrome'] },
  webServer: publicBase ? undefined : [
    { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: true },
    { command: `${python} -m uvicorn server.app:app --host 127.0.0.1 --port 8000`, url: 'http://127.0.0.1:8000/health', reuseExistingServer: true, env: { RIPPLE_MODE:'demo', RIPPLE_ACCESS_TOKEN:'', RIPPLE_INLINE_JOBS:'true' } },
  ],
  reporter: 'list',
});
