import OpenAI from "openai";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { HfInferenceEndpoint } from '@huggingface/inference'
import { AutoTokenizer, PreTrainedTokenizer, env } from "@xenova/transformers";

const hfApiKey = import.meta.env.VITE_HF_API_KEY;

// Need to set this, otherwise loading the remote model fails!?
env.allowLocalModels = false;  
// Hack to get gated tokenizer models to load in webapp (rather than just node)
window.process = {
  release: { name: 'node' },
  env: { HF_TOKEN: hfApiKey },
};

// Put userMessage before/after each assistantMessage and append sysMessage (if given) to the beginning
// [assist0, assist1, assist2] -> [sys, user, assist0, user, assist1, user]
function promptedThoughtStream(
  sysMessage: string,
  userMessage: string,
  assistantMessages: string[]) {
  const allMessages = [];
  if (sysMessage) {
    allMessages.push({ role: 'system', content: sysMessage });
  }
  for (const message of assistantMessages) {
    if (message) {
      allMessages.push({ role: 'user', content: userMessage });
      allMessages.push({ role: 'assistant', content: message });
    }
  }
  allMessages.push({ role: 'user', content: userMessage });
  return allMessages;
}

// Format thought stream according to the Llama chat template. No dependency on Transformers lib
function getLlamaTemplatedChat(
  sysMessage: string,
  userMessage: string,
  assistantMessages: string[]
) {
  let templatedChat = "<s>[INST] ";
  if (sysMessage) {
    templatedChat = templatedChat.concat("<<SYS>>\n", sysMessage, "\n<</SYS>>\n\n");
  }
  templatedChat = templatedChat.concat(userMessage, " [/INST]");

  for (const message of assistantMessages) {
    if (message) {
      templatedChat = templatedChat.concat(" ", message.trim(), " </s><s>[INST] ", userMessage, " [/INST]");
    }
  }
  return templatedChat;
}

type ThinkerProperties = {
  name: string;
  acceptsSystemPrompt: boolean;
}

abstract class Thinker {
  properties: ThinkerProperties;

  constructor(properties: ThinkerProperties) {
    this.properties = properties;
  };

  abstract generateThought(options: {
    sysMessage: string;
    userMessage: string;
    assistantMessages: string[];
    max_tokens?: number;
    temperature?: number;
    stream?: boolean;
    onDelta: (delta: any) => void;
  }): Promise<any>;
};

class HfThinker extends Thinker {
  tokenizer: PreTrainedTokenizer;
  endpoint: HfInferenceEndpoint;

  constructor(properties: ThinkerProperties, tokenizer: PreTrainedTokenizer, endpoint: HfInferenceEndpoint) {
    super(properties);
    this.tokenizer = tokenizer;
    this.endpoint = endpoint;
  };

  static async build(properties: ThinkerProperties, endpointURL: string, endpointKey: string, tokenizerID: string) {
    const tokenizer = await AutoTokenizer.from_pretrained(tokenizerID);
    return new HfThinker(properties, tokenizer, new HfInferenceEndpoint(endpointURL, endpointKey));
  }

  async generateThought(
    options: {
      sysMessage: string;
      userMessage: string;
      assistantMessages: string[];
      max_tokens?: number;
      temperature?: number;
      stream?: boolean;
      onDelta: (delta: any) => void;
    }): Promise<any> {

    const messages = promptedThoughtStream(
      this.properties.acceptsSystemPrompt ? options.sysMessage : "",
      options.userMessage,
      options.assistantMessages);
    // console.log(
    //   'messages\n',
    //   JSON.stringify(messages).replace(/\\n/g, ' ')
    // );
    const templatedChat = this.tokenizer.apply_chat_template(
        messages, {
          tokenize: false,
          add_generation_prompt: false,
          return_tensor: false,
        });
    // console.log("templatedChat\n", templatedChat);

    const completion = this.endpoint.textGenerationStream({
      inputs: templatedChat,
      parameters: {
        max_new_tokens: options.max_tokens ?? 100,
        temperature: options.temperature ?? 0.5,
        return_full_text: false,
        // repetition_penalty: 1,
      }});

    let reply = "";
    const stream = completion as AsyncIterable<any>;
    for await (const chunk of stream) {
      const delta = chunk.token?.text || "";
      reply = reply.concat(delta);
      // Llama/Mixtral always finishes assistant completions with </s>, so it should be the last delta
      if (delta != "</s>") {
        options.onDelta(delta); // Invoke the callback with the incoming delta
      }
    }
    console.log("Reply:\n", reply);

    return completion;
  } 
}

class OpenAIThinker extends Thinker {
  openai: OpenAI;  
  modelId: string;

  constructor(properties: ThinkerProperties, openai: OpenAI, modelId: string) {
    super(properties);
    this.openai = openai;
    this.modelId = modelId;
  };

  static build_from_org(properties: ThinkerProperties, org: string, key: string, modelId: string) {
    const openai = new OpenAI({
      organization: org,
      apiKey: key,
      dangerouslyAllowBrowser: true
    });
    return new OpenAIThinker(properties, openai, modelId);

  }

  // Can use this to interface with TGI endpoints, or other services, supporting OpenAI messages API
  static build_from_url(properties: ThinkerProperties, endpointURL: string, endpointKey: string) {
    const openai = new OpenAI({
      apiKey: endpointKey,
      baseURL: endpointURL + '/v1/',
      dangerouslyAllowBrowser: true
    });
    return new OpenAIThinker(properties, openai, 'tgi');
  }

  async generateThought(
    options: {
      sysMessage: string;
    userMessage: string;
    assistantMessages: string[];
    max_tokens?: number;
    temperature?: number;
    stream?: boolean;
    onDelta: (delta: any) => void;
  }): Promise<any> {
    return new Promise(async (resolve, reject) => {
      try {
        const messages = promptedThoughtStream(
          this.properties.acceptsSystemPrompt ? options.sysMessage : "",
          options.userMessage,
          options.assistantMessages);
        const completion = await this.openai.chat.completions.create({
          model: this.modelId,
          messages: messages as ChatCompletionMessageParam[],
          max_tokens: options.max_tokens ?? 100,
          temperature: options.temperature ?? 0.5,
          stream: options.stream ?? true,
        });
        const stream = completion as AsyncIterable<any>;
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content || "";
          options.onDelta(delta); // Invoke the callback with the incoming delta
        }

        resolve(completion); // Resolve the promise after the stream is fully processed
      } catch (error) {
        reject(error); // Reject the promise if there's an error
      }
    });
  }
}

let thinkers: { [id: string]: Thinker } = {};
// TODO(Rob): Load these from a config file. 
thinkers['GPT4'] = OpenAIThinker.build_from_org(
  {name: 'GPT4', acceptsSystemPrompt: true},
  import.meta.env.VITE_OPENAI_ORG,
  import.meta.env.VITE_OPENAI_API_KEY,
  'gpt-4-turbo-preview');

thinkers['Headlong Llama7B'] = await HfThinker.build(
  {name: 'Headlong Llama7B', acceptsSystemPrompt: true},
  import.meta.env.VITE_LLAMA7B_ENDPOINT,
  import.meta.env.VITE_LLAMA7B_API_KEY,
  'meta-llama/Llama-2-7b-chat-hf');

thinkers['Headlong Mixtral'] = await HfThinker.build(
  {name: 'Headlong Mixtral', acceptsSystemPrompt: false},
  import.meta.env.VITE_MIXTRAL_ENDPOINT,
  import.meta.env.VITE_MIXTRAL_API_KEY,
  'mistralai/Mixtral-8x7B-Instruct-v0.1');

console.log("thinkers", thinkers)

export { thinkers }
