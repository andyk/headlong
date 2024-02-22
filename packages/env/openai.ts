1
import OpenAI from "openai";
const openAiApiKey = process.env.OPENAI_API_KEY;
const openAiOrg = process.env.OPENAI_ORG;
const openai = new OpenAI({
    organization: openAiOrg,
    apiKey: openAiApiKey,
    dangerouslyAllowBrowser: true
});

export default openai
