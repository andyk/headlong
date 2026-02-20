
const AGENT_URL = 'http://localhost:8001';

async function getModels() {
  const response = await fetch(AGENT_URL + '/models');
  return response.json();
}

// readChunks() reads from the provided reader and yields the results into an async iterable
function readChunks(reader: ReadableStreamDefaultReader<Uint8Array>) {
  return {
    async*[Symbol.asyncIterator]() {
      let readResult = await reader.read();
      while (!readResult.done) {
        yield readResult.value;
        readResult = await reader.read();
      }
    },
  };
}

interface GenerateResult {
  id: string;
  body: string;
  index: number;
  agent_name: string;
}

async function generateThought(
  options: {
    model: string;
    temperature?: number;
    max_tokens?: number;
    agent_name?: string;
  }): Promise<GenerateResult> {
  const response = await fetch(AGENT_URL + '/generate', {
    method: "POST",
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: options.model,
      temperature: options.temperature ?? 0.5,
      max_tokens: options.max_tokens ?? 4096,
      agent_name: options.agent_name,
    }),
  });

  if (!response.ok) {
    throw new Error(`Generate failed: ${response.status}`);
  }

  return response.json();
}

async function startLoop(options: {
  delay_ms?: number;
  model?: string;
  temperature?: number;
  max_tokens?: number;
}): Promise<any> {
  const response = await fetch(AGENT_URL + '/loop/start', {
    method: "POST",
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
  return response.json();
}

async function stopLoop(): Promise<any> {
  const response = await fetch(AGENT_URL + '/loop/stop', { method: "POST" });
  return response.json();
}

async function getLoopStatus(): Promise<{ running: boolean }> {
  const response = await fetch(AGENT_URL + '/loop/status');
  return response.json();
}

async function getAgentStatus(): Promise<{
  agent_name: string;
  system_prompt: string;
  model: string;
  uptime_seconds: number;
}> {
  const response = await fetch(AGENT_URL + '/agent/status');
  return response.json();
}

async function getAgentActivity(): Promise<{ ts: string; message: string }[]> {
  const response = await fetch(AGENT_URL + '/agent/activity');
  return response.json();
}

export { getModels, generateThought, startLoop, stopLoop, getLoopStatus, getAgentStatus, getAgentActivity }
export type { GenerateResult }
