import openai from "./openai";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { getJson } from "serpapi";
import api from "api";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import twilioSDK from "twilio";
import net from "net";
import supabase from "./supabase";
import { Database } from "./database.types";

type Thought = Database["public"]["Tables"]["thoughts"]["Row"];

const bashServerPort = Number(process.env.BASH_SERVER_PORT) || 3031;

const supabaseUrlEnvName = "SUPABASE_URL_HEADLONG";
const supabaseKeyEnvName = "SUPABASE_SERVICE_ROLE_KEY_HEADLONG";
const openAIMaxTokens = 500;
const openAITemp = 0.5;

const serpApiKeyEnvName = process.env["SERPAPI_API_KEY"];

const pplx = api("@pplx/v0#wqe1glpipk635");
const pplxApiKeyEnvName = "PPLX_API_KEY";
pplx.auth(process.env[pplxApiKeyEnvName]);

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
const twilioClient = twilioSDK(accountSid, authToken);

const agentName = process.argv[2];
if (agentName === undefined) {
  console.log("agentName must be passed as first command line arg");
  process.exit(1);
}
console.log("agentName: ", agentName);

const thoughtsToOpenAIChatMessages = (thoughts: any, systemMsg: string = "") => {
  const messages = thoughts.map(([thought, history]) => ({ role: "assistant", content: thought.body }));
  if (systemMsg) {
    return [{ role: "system", content: systemMsg }, ...messages];
  }
  return messages;
};

const bashServerClient = net.createConnection({ port: bashServerPort }, () => {
  console.log("connected to bashServer on port ", bashServerPort);
});

bashServerClient.on("end", () => {
  console.log("disconnected from server");
});

// Last thought in the thoughtList is the call to action.
const generateMessages = (thoughtList: Thought[]) => {
  if (thoughtList === undefined || thoughtList.length === 0) {
    throw "thoughtList must have at least one thought";
  }
  const systemMsg: ChatCompletionMessageParam = {
    role: "system",
    content: `your job is to consider your recent thoughts and then take an action.
The way you take actions is by calling a function.
If you don't think you know of any funcions that are appropriate for this action, you can say "observation: i don't know how to do that".
When deciding on what action take, use on the following stream of recent thoughts for context:`,
  };
  const thoughtListStr = thoughtList
    .slice(0, thoughtList.length - 1)
    .map((thought) => {
      return thought.body;
    })
    .join("\n");
  const thoughtListMsg: ChatCompletionMessageParam = { role: "assistant", content: thoughtListStr };
  const callToActionMsg: ChatCompletionMessageParam = {
    role: "assistant",
    content: `I need to generate a function call that best accomplishes the ${
      thoughtList[thoughtList.length - 1].body
    }`,
  };
  console.log("generated messages: ", [
    systemMsg,
    { role: "assistant", content: "..." + thoughtListStr.slice(-200) },
    callToActionMsg,
  ]);
  return [systemMsg, thoughtListMsg, callToActionMsg];
};

const tools = {
  searchGoogle: {
    execute: (args: object, addThought: (thought: string) => void) => {
      getJson(
        {
          api_key: serpApiKeyEnvName,
          engine: "google",
          q: args["query"],
          google_domain: "google.com",
          gl: "us",
          hl: "en",
        },
        (json) => {
          const thoughtStr =
            `observation: search results for query '${args["query"]}': \n\n` +
            json["organic_results"]
              .slice(0, 5)
              .map((result) => {
                return (
                  "title: " +
                  result["title"] +
                  "\n" +
                  "link: " +
                  result["link"] +
                  "\n" +
                  "snippet: " +
                  result["snippet"]
                );
              })
              .join("\n\n");
          addThought(thoughtStr);
        }
      );
    },
    schema: {
      type: "function" as "function",
      function: {
        name: "searchGoogle",
        description: "Google search, also known as web search, or just search. use this to look up things",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "the string to search for in google",
            },
          },
          required: ["query"],
        },
      },
    },
  },
  visitURL: {
    execute: async (args: object, addThought: (thought: string) => void) => {
      const response = await fetch(args["url"]);
      const htmlContent = await response.text();
      const dom = new JSDOM(htmlContent);
      const document = dom.window.document;

      const readability = new Readability(document);
      const article = readability.parse();

      if (article?.textContent) {
        addThought(`observation: fetched ${args["url"]}: ` + article.textContent);
      }
    },
    schema: {
      type: "function" as "function",
      function: {
        name: "visitURL",
        description: "fetch a website. can be in the form of clicking a link",
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "the url to fetch, which might be in the form of a link to click",
            },
          },
          required: ["url"],
        },
      },
    },
  },
  newShell: {
    execute: async (args: object, addThought: (thought: string) => void) => {
      bashServerClient.write(
        JSON.stringify({
          type: "newShell",
          payload: {
            shellID: args["shellID"],
            shellPath: args["shellPath"],
            shellArgs: args["shellArgs"],
          },
        })
      );
    },
    schema: {
      type: "function" as "function",
      function: {
        name: "newShell",
        description: "create a new shell",
        parameters: {
          type: "object",
          properties: {
            shellBinary: {
              type: "string",
              default: "/bin/bash",
              description: "path of shell binary, e.g. /bin/bash",
            },
            shellArgs: {
              type: "array",
              items: {
                type: "string",
              },
              description: "arguments to pass to the shell binary",
            },
            shellID: {
              type: "string",
              description: "unique ID for the new shell",
            },
          },
        },
      },
    },
  },
  switchToShell: {
    execute: async (args: object, addThought: (thought: string) => void) => {
      bashServerClient.write(
        JSON.stringify({
          type: "switchToShell",
          payload: { id: args["id"] },
        })
      );
    },
    schema: {
      type: "function" as "function",
      function: {
        name: "switchToShell",
        description: "switch to the specified shell, i.e. 'bring it to the front'",
        parameters: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "the ID of the shell to switch to",
            },
          },
        },
      },
    },
  },
  executeShellCommand: {
    execute: async (args: object, addThought: (thought: string) => void) => {
      bashServerClient.write(
        JSON.stringify({
          type: "runCommand",
          payload: { command: args["command"] },
        })
      );
    },
    schema: {
      type: "function" as "function",
      function: {
        name: "executeShellCommand",
        description: "run a command in the currently active shell",
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "the shell command to execute in the active shell",
            },
          },
        },
      },
    },
  },
  sendText: {
    execute: async (args: object, addThought: (thought: string) => void) => {
      if (args["to"] !== "+15103567082") {
        console.log("For now, we don't allow text anybody other than Andy");
        return;
      }
      twilioClient.messages
        .create({
          body: args["body"],
          from: twilioPhoneNumber,
          to: args["to"],
        })
        .then((message) => console.log(message.sid));
    },
    schema: {
      type: "function" as "function",
      function: {
        name: "sendText",
        description: "send a text message to a phone number",
        parameters: {
          type: "object",
          properties: {
            body: {
              type: "string",
              description: "the message to send",
            },
            to: {
              type: "string",
              description: "the phone number to send the message to",
            },
          },
        },
      },
    },
  },
  checkTime: {
    execute: async (args: object, addThought: (thought: string) => void) => {
      const now = new Date();
      const timeOptions = {
        timeZone: args["timezone"] || "America/Los_Angeles",
        year: "numeric" as "numeric",
        month: "long" as "long",
        day: "numeric" as "numeric",
        weekday: "long" as "long",
        hour: "2-digit" as "2-digit",
        minute: "2-digit" as "2-digit",
        second: "2-digit" as "2-digit",
        hour12: true,
      };
      const timeInPT = now.toLocaleString("en-US", timeOptions);
      addThought("observation: it's " + timeInPT);
    },
    schema: {
      type: "function" as "function",
      function: {
        name: "checkTime",
        description: "see what time it is, could be looking my watch or a clock",
        parameters: {
          type: "object",
          properties: {
            timezone: {
              type: "string",
              description: "the timezone. default is 'America/Los_Angeles'",
            },
          },
        },
      },
    },
  },
};

async function computeInsertIndex(insertAfterIndex: number) {
  console.log("computing index for insertAfterIndex: ", insertAfterIndex);
  const { data: sortedThoughtsAfterProvidedIndex, error: thoughtError } = await supabase
    .from("thoughts")
    .select("index")
    .eq("agent_name", agentName)
    .order("index", { ascending: true })
    .gt("index", insertAfterIndex)
    .limit(1)
    .maybeSingle();
  if (thoughtError) {
    console.error("Error fetching thoughts with index greater than insertAfterIndex", thoughtError);
    throw thoughtError;
  }
  if (sortedThoughtsAfterProvidedIndex === null) {
    return insertAfterIndex + 1.0;
  } else {
    return (insertAfterIndex + sortedThoughtsAfterProvidedIndex.index) / 2;
  }
}

async function addNewThought(agentName: string, body: string, addAfterIndex?: number) {
  console.log("adding thought: ", body, " after index: ", addAfterIndex);
  if (addAfterIndex === undefined) {
    // get max index from thoughts table
    const { data: row, error } = await supabase
      .from("thoughts")
      .select("index")
      .order("index", { ascending: false })
      .limit(1)
      .maybeSingle();
    const maxIndex = row?.index || 0;
    await supabase.from("thoughts").insert([{ agent_name: agentName, body: body, index: maxIndex + 1.0 }]);
  } else {
    const computedIndex = await computeInsertIndex(addAfterIndex);
    console.log("Inserting thought with computed index: ", computedIndex);
    supabase.from("thoughts").insert([{ agent_name: agentName, body: body, index: computedIndex }]);
  }
}

bashServerClient.on("data", (data) => {
  console.log(data.toString());
  addNewThought(agentName, data.toString());
});

const handleThought = async (thought: Thought) => {
  // test if thought.body starts with "action: " and return if not
  if (thought.body.toLowerCase().startsWith("action: ") && thought.metadata !== null && thought.metadata["needs_handling"] === true) {
    console.log("Handling action: ", thought);
    // update the thought row to mark needs_handling as false
    const { data, error } = await supabase
      .from("thoughts")
      .update({ metadata: { needs_handling: false } })
      .eq("id", thought.id)
      .eq("agent_name", agentName);
  } else {
    console.log("exiting handleThought since this isn't an ACTION or it doesn't *needs_handling*: ", thought);
    return;
  }
  console.log("handling an ACTION that *needs_handling*: ", thought.body);
  // get all thoughts up and including the one being handled:w

  const { data: thoughts, error } = await supabase
    .from("thoughts")
    .select("*")
    .eq("agent_name", agentName)
    .order("index", { ascending: true })
    .lte("index", thought.index);
  if (thoughts === null || thoughts.length === 0) {
    console.log("no thoughts found");
    return;
  }
  const prompt = generateMessages(thoughts);
  console.log("calling GPT4 for completion with message: ", prompt);
  const completion = await openai.chat.completions.create({
    model: "gpt-4-1106-preview",
    messages: prompt,
    max_tokens: openAIMaxTokens,
    temperature: openAITemp,
    tools: Object.values(tools).map((tool) => tool.schema),
    tool_choice: "auto",
  });

 console.log("GPT4 completion: ", completion.choices[0].message);

  if (completion.choices[0].message.content) {
    addNewThought(agentName, completion.choices[0].message.content);
    console.log("No functioun called, added thought: ", completion.choices[0].message.content);
  } else if (completion.choices[0].message.tool_calls) {
    console.log(completion.choices[0].message.tool_calls);
    const functionName = completion.choices[0].message.tool_calls[0].function.name;
    const parsedArgs = JSON.parse(completion.choices[0].message.tool_calls[0].function.arguments);
    console.log(`calling ${functionName} with args: ${JSON.stringify(parsedArgs)} `);
    function partialAddThought(thoughtBody: string) {
      addNewThought(agentName, thoughtBody, thought.index);
    }
    tools[functionName].execute(parsedArgs, partialAddThought);
  }
};

// use supabase client `supabase` to subscribe to the thoughts table
supabase
  .channel("any")
  .on<Thought>(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "thoughts",
    },
    async (payload) => {
      console.log("Got a new thought: ", payload.new);
      if ("body" in payload.new) {
        handleThought(payload.new);
      }
    }
  )
  .subscribe();

const envPresenceRoom = supabase.channel("env_presence_room", {
  config: {
    presence: {
      key: "env",
    },
  },
});
envPresenceRoom
  .on("presence", { event: "sync" }, () => {
    const newState = envPresenceRoom.presenceState();
    console.log('env_presence_room got a "sync" update: ', newState);
  })
  .on("presence", { event: "join" }, ({ key, newPresences }) => {
    console.log("env_presence_room had a join", key, newPresences);
  })
  .on("presence", { event: "leave" }, ({ key, leftPresences }) => {
    console.log("env_presence_room had a leave", key, leftPresences);
  })
  .subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      await envPresenceRoom.track({ online_at: new Date().toISOString() })
    }
  })
console.log("registered tools:\n", Object.keys(tools).join("\n"));
// TODO: Register any env listeners that would async interrupt "observations: "
// (or other thoughts?) into consciouness

// Listen for SIGTERM signal
process.on("SIGTERM", () => {
  console.log("SIGTERM signal received. Shutting down...");
  // Perform any cleanup operations here
  process.exit(0);
});
