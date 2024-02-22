import OpenAI from "openai";
const openAiOrg = import.meta.env.VITE_OPENAI_ORG;
const openAiApiKey = import.meta.env.VITE_OPENAI_API_KEY;
console.log("openAiOrg: ", openAiOrg);
console.log("openAiApiKey: ", openAiApiKey);
const openai = new OpenAI({
    organization: openAiOrg,
    apiKey: openAiApiKey,
    dangerouslyAllowBrowser: true
});

export default openai