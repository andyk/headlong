import OpenAI from "openai";
const openAiOrg = import.meta.env.OPENAI_ORG;
const openAiApiKey = import.meta.env.OPENAI_API_KEY;
console.log("openAiApiKey: ", openAiApiKey);
const openai = new OpenAI({
    organization: openAiOrg,
    apiKey: openAiApiKey,
    dangerouslyAllowBrowser: true
});

export default openai