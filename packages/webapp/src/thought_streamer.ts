
const url = 'http://localhost:8000/';

async function getModels() {
  const response = await fetch(url + 'models');
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

async function streamThought(
  options: {
    model: string;
    sysMessage: string;
    userMessage: string;
    assistantMessages: string[];
    max_tokens?: number;
    temperature?: number;
    stream?: boolean;
    onDelta: (delta: string) => void;
  }): Promise<any> {
  let decoder = new TextDecoder("utf-8");
  const request = new Request(url, {
    method: "POST",
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: options.model,
      system_message: options.sysMessage,
      user_message: options.userMessage,
      assistant_messages: options.assistantMessages,
      max_tokens: options.max_tokens ?? 100,
      temperature: options.temperature ?? 0.5,
    }),
  });

  let reply = "";
  fetch(request).then(async (response) => {
    const reader = response.body?.getReader();
    for await (const chunk of readChunks(reader)) {
      let decoded_chunk = decoder.decode(chunk);
      reply = reply.concat(decoded_chunk);
      options.onDelta(decoded_chunk);
    }
  });
  console.log("Reply:", reply);
}

export { getModels, streamThought }
