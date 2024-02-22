import { HfInferenceEndpoint } from '@huggingface/inference'
const hfLlamaEndpoint = import.meta.env.VITE_HF_LLAMA_ENDPOINT;
const hfApiKey = import.meta.env.VITE_HF_API_KEY;
console.log("hfApiKey: ", hfApiKey);
console.log("hfLlamaEndpoint: ", hfLlamaEndpoint);
const hf = new HfInferenceEndpoint(hfLlamaEndpoint, hfApiKey);
export default hf
