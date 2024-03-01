import { HfInferenceEndpoint } from '@huggingface/inference'
import { AutoTokenizer, env } from "@xenova/transformers";
const hfLlamaEndpoint = import.meta.env.VITE_HF_LLAMA_ENDPOINT;
const hfApiKey = import.meta.env.VITE_HF_API_KEY;
console.log("hfApiKey: ", hfApiKey);
console.log("hfLlamaEndpoint: ", hfLlamaEndpoint);
const hf = new HfInferenceEndpoint(hfLlamaEndpoint, hfApiKey);
env.allowLocalModels = false;  // Need to set this otherwise, loading the remote model fails!?
const tokenizer = await AutoTokenizer.from_pretrained('NousResearch/Llama-2-7b-chat-hf');
// Accessing gated tokenizers doesn't seem to work. Why?
// const tokenizer = await AutoTokenizer.from_pretrained('recarroll/headlong_llama2_7b_v3_prompted');
export {hf, tokenizer}
