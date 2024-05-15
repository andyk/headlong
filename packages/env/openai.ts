1
import OpenAI from "openai";
const openRouterApiKey = process.env.OPENROUTER_API_KEY;
const openai = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: openRouterApiKey,
    dangerouslyAllowBrowser: true
});
//const openAiApiKey = process.env.OPENAI_API_KEY;
//const openAiOrg = process.env.OPENAI_ORG;
//const openai = new OpenAI({
//    organization: openAiOrg,
//    apiKey: openAiApiKey,
//    dangerouslyAllowBrowser: true
//});

export default openai
