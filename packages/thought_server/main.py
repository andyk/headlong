from fastapi import FastAPI
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from huggingface_hub import InferenceClient
from transformers import AutoTokenizer, PreTrainedTokenizer
from pydantic import BaseModel
import asyncio
import yaml

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Put userMessage before/after each assistantMessage and append sysMessage (if given) to the beginning
#  [assist0, assist1, assist2] -> [sys, user, assist0, user, assist1, user]
# If model doesn't accept a system message, include it with the first user message
#  [assist0, assist1, assist2] -> [sys + "\n" + user, assist0, user, assist1, user]
def prompted_thought_stream(
    system_message, user_message, assistant_messages, accepts_system_message
):
    all_messages = []
    if accepts_system_message:
        all_messages.append({"role": "system", "content": system_message})
        all_messages.append({"role": "user", "content": user_message})
    else:
        all_messages.append(
            {"role": "user", "content": system_message + "\n" + user_message}
        )
    for message in assistant_messages:
        if message:
            all_messages.append({"role": "assistant", "content": message})
            all_messages.append({"role": "user", "content": user_message})
    return all_messages


class Thinker:
    def __init__(self, accepts_system_prompt, end_token):
        self.accepts_system_prompt: bool = accepts_system_prompt
        self.end_token: str = end_token


class OpenAIThinker(Thinker):
    def __init__(self, client, openai_model_id, accepts_system_prompt, end_token):
        super().__init__(accepts_system_prompt, end_token)
        self.client: OpenAI = client
        self.openai_model_id: str = openai_model_id

    async def streamer(self, system_message, user_message, assistant_messages):

        all_messages = prompted_thought_stream(
            system_message, user_message, assistant_messages, self.accepts_system_prompt
        )
        chat_completion = self.client.chat.completions.create(
            model=self.openai_model_id, messages=all_messages, stream=True
        )
        print("Response:", end="", flush=True)
        for chunk in chat_completion:
            content = chunk.choices[0].delta.content
            if content is not None and content != self.end_token:
                yield content
                print(content, end="", flush=True)
            # TODO(rcarroll): Why do we need this? Otherwise stream comes all at once
            await asyncio.sleep(0)
        print()


class HuggingfaceThinker(Thinker):
    def __init__(self, client, tokenizer, accepts_system_prompt, end_token):
        super().__init__(accepts_system_prompt, end_token)
        self.client: InferenceClient = client
        self.tokenizer: PreTrainedTokenizer = tokenizer

    async def streamer(self, system_message, user_message, assistant_messages):

        all_messages = prompted_thought_stream(
            system_message, user_message, assistant_messages, self.accepts_system_prompt
        )
        prompt = self.tokenizer.apply_chat_template(
            all_messages, add_generation_prompt=True, tokenize=False
        )
        print("prompt", prompt)
        chat_completion = self.client.text_generation(
            prompt, max_new_tokens=100, stream=True
        )

        print("Response:", end="", flush=True)
        for chunk in chat_completion:
            if chunk != self.end_token:
                yield chunk
                print(chunk, end="", flush=True)
                # TODO(rcarroll): Why do we need this? Otherwise stream comes all at once
                await asyncio.sleep(0)
        print()


class CompletionRequest(BaseModel):
    model: str
    system_message: str
    user_message: str
    assistant_messages: list[str]
    max_tokens: int
    temperature: float


def parse_thinkers(configuration):
    thinkers: dict[str, Thinker] = {}
    for entry in configuration:
        match entry["type"]:
            case "OpenAI":
                thinkers[entry["name"]] = OpenAIThinker(
                    client=OpenAI(
                        api_key=entry["api_key"],
                        organization=entry["organization"],
                    ),
                    openai_model_id=entry["model_id"],
                    accepts_system_prompt=entry["accepts_system_prompt"],
                    end_token=entry["end_token"],
                )
            case "Huggingface":
                thinkers[entry["name"]] = HuggingfaceThinker(
                    client=InferenceClient(entry["url"]),
                    tokenizer=AutoTokenizer.from_pretrained(entry["tokenizer"]),
                    accepts_system_prompt=entry["accepts_system_prompt"],
                    end_token=entry["end_token"],
                )
            case _:
                print("Invalid model type:", entry.type)
    return thinkers


with open("thinkers.yaml", "r") as file:
    thinker_configuration = yaml.safe_load(file)
    thinkers = parse_thinkers(thinker_configuration)


@app.get("/models")
def get_models():
    return JSONResponse(content=list(thinkers.keys()))


@app.post("/")
async def blah(item: CompletionRequest):
    print("Received request for", item.model)
    return StreamingResponse(
        thinkers[item.model].streamer(
            item.system_message, item.user_message, item.assistant_messages
        ),
        media_type="text/event-stream",
    )
