import { PersonApiClient } from './content/person-api-client';
import { loadPersonApiSettings, savePersonApiSettings } from './content/storage';

const baseUrlInput = document.getElementById('baseUrl') as HTMLInputElement | null;
const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement | null;
const saveButton = document.getElementById('saveBtn') as HTMLButtonElement | null;
const testButton = document.getElementById('testBtn') as HTMLButtonElement | null;
const status = document.getElementById('status') as HTMLDivElement | null;

function setStatus(message: string): void {
  if (status) {
    status.textContent = message;
  }
}

async function init(): Promise<void> {
  if (!baseUrlInput || !apiKeyInput || !saveButton || !testButton) {
    return;
  }

  const settings = await loadPersonApiSettings();
  baseUrlInput.value = settings?.baseUrl ?? '';
  apiKeyInput.value = settings?.apiKey ?? '';

  saveButton.addEventListener('click', async () => {
    await savePersonApiSettings({
      baseUrl: baseUrlInput.value.trim().replace(/\/$/, ''),
      apiKey: apiKeyInput.value.trim(),
    });

    setStatus('Saved');
  });

  testButton.addEventListener('click', async () => {
    const client = await PersonApiClient.create();

    if (!client) {
      setStatus('Set URL and API key first');
      return;
    }

    try {
      const ok = await client.testConnection();
      setStatus(ok ? 'Connection successful' : 'Health check failed');
    } catch {
      setStatus('Connection failed');
    }
  });
}

void init();
