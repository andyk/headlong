import { useEffect, useState, useRef } from "react";
import "./App-compiled.css";
import supabase from "./supabase";
import openai from "./openai";
import hf from "./huggingface";
import {
  ChatCompletionAssistantMessageParam,
  ChatCompletionSystemMessageParam,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import { Editor, EditorState, ContentState, getDefaultKeyBinding, KeyBindingUtil } from "draft-js";

const { hasCommandModifier } = KeyBindingUtil;
type SyntheticKeyboardEvent = React.KeyboardEvent<{}>;

// In the database, we store thought body as a string.
export type ThoughtRow = {
  body: string;
  human_generated_slices: [number, number][];
  open_ai_embedding?: number[];
};
// We use the `EditorState` type from `draft-js` to represent the body of each thought.
export type Thought = {
  body: EditorState;
  human_generated_slices: [number, number][];
  open_ai_embedding?: number[];
};

type Agent = {
  name: string;
  thoughts: Thought[];
  created_at?: string;
  // A thought_handler is a Javascript function that returns a string.
  // When the thought_handler is evaluated, it has `thoughts` in scope to use.
  thought_handler?: string;
};

function App() {
  const [agentNameList, setAgentNameList] = useState<string[]>([]);
  const [selectedAgentName, setSelectedAgentName] = useState<string | null>(null);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [selectedThoughtIndex, setSelectedThoughtIndex] = useState<number | null>(null);

  async function gpt4TurboChat(options: {
    messages: ChatCompletionMessageParam[];
    max_tokens?: number;
    temperature?: number;
    stream?: boolean; // Add stream option
    onDelta: (delta: any) => void; // Callback to handle incoming data
  }) {
    // Assuming the OpenAI SDK has an event emitter or callback mechanism for streaming
    const completion = await openai.chat.completions.create({
      model: "gpt-4-1106-preview",
      messages: options.messages,
      max_tokens: options.max_tokens ?? 100,
      temperature: options.temperature ?? 0.5,
      stream: options.stream ?? true,
    });

    const stream = completion as AsyncIterable<any>;
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || "";
      options.onDelta(delta); // Invoke the callback with the incoming delta
    }

    return completion;
  }

  async function huggingFaceChat(options: {
    messages: ChatCompletionMessageParam[];
    max_tokens?: number;
    temperature?: number;
    stream?: boolean; // Add stream option
    onDelta: (delta: any) => void; // Callback to handle incoming data
  }) {

    // Generate prompt accoriding to HF template. 'user' messages aren't handled
    prompt = ""
    for await (const message of options.messages) {
      switch(message.role) {
        case 'system':
          prompt = prompt.concat("<s> [INST] <<SYS>> ", message.content, " </SYS>> [/INST]");
          break;
        case 'assistant':
          prompt = prompt.concat(message.content, "\n");
          break;
        default:
          console.log("Unknown message type");
      }
    }
    console.log("Prompt:\n", prompt);

    const completion = hf.textGenerationStream({
      inputs: prompt,
      parameters: {
        max_tokens: options.max_tokens ?? 100,
        temperature: options.temperature ?? 0.5,
        return_full_text: false,
        // repetition_penalty: 1,
      }
    });

    let reply = "";
    const stream = completion as AsyncIterable<any>;
    for await (const chunk of stream) {
      // console.log(chunk);
      const delta = chunk.token?.text || "";
      reply = reply.concat(delta);
      // Llama always finishes assistant completions with </s>, so it should be the last delta
      if (delta != "</s>") {
        options.onDelta(delta); // Invoke the callback with the incoming delta
      }
    }
    console.log("Reply:\n", reply);

    return completion;
  }

  function myKeyBindingFn(e: SyntheticKeyboardEvent): string | null {
    if (e.key === "Enter" && !e.shiftKey) {
      return "new-cell";
    }
    if (
      e.key === "Backspace" &&
      selectedThoughtIndex &&
      agent?.thoughts[selectedThoughtIndex].body.getCurrentContent().getPlainText() === ""
    ) {
      return "delete-cell";
    }
    return getDefaultKeyBinding(e);
  }

  function handleKeyCommand(command: string, index: number) {
    if (command === "new-cell") {
      console.log("Enter key pressed");
      setAgent((old) => {
        if (old === null) {
          return old;
        }
        const newThoughts = [...old.thoughts];
        newThoughts.splice(index + 1, 0, {
          body: EditorState.createEmpty(),
          human_generated_slices: [],
        });
        return {
          ...old,
          thoughts: newThoughts,
        };
      });
      setSelectedThoughtIndex((i) => (i ?? 0) + 1);
      return "handled";
    }
    if (command === "delete-cell") {
      console.log("Backspace key pressed on empty cell");
      setAgent((old) => {
        if (old === null || old.thoughts.length <= 1) {
          return old;
        }
        const newThoughts = [...old.thoughts];
        newThoughts.splice(index, 1); // Remove the current thought

        return {
          ...old,
          thoughts: newThoughts,
        };
      });
      setSelectedThoughtIndex((i) => ((i ?? 0) === 0 ? 0 : (i ?? 0) - 1));
      return "handled";
    }
    return "not-handled";
  }

  async function getAgent(name: string): Promise<Agent> {
    const { data: agent, error } = await supabase.from("agents").select("*").eq("name", name).maybeSingle();
    if (error) {
      console.log(error);
      throw error;
    } else if (!agent) {
      throw new Error(`No agent found with name ${name}`);
    }
    console.log("got agent", agent);
    return {
      ...agent,
      thoughts: agent.thoughts.map((thought: ThoughtRow) => {
        return {
          ...thought,
          body: EditorState.createWithContent(ContentState.createFromText(thought.body)),
        };
      }),
    };
  }

  useEffect(() => {
    (async () => {
      const { data: agents, error } = await supabase.from("agents").select("name");
      if (error) {
        console.log(error);
      } else if (agents === null) {
        console.log("no agents found");
      } else {
        setAgentNameList(agents.map((agent: { name: string }) => agent.name));
      }
    })();
  }, []);

  useEffect(() => {
    if (agentNameList.length > 0 && selectedAgentName === null) {
      setSelectedAgentName(agentNameList[0]);
    }
  }, [agentNameList, selectedAgentName]);

  useEffect(() => {
    if (!selectedAgentName) {
      console.log("no agent selected");
    } else {
      console.log("agent selected " + selectedAgentName);
      (async () => {
        setAgent(await getAgent(selectedAgentName));
      })();
    }
  }, [selectedAgentName]);

  useEffect(() => {
    if (agent) {
      const agentWithBodyAsString = {
        ...agent,
        thoughts: agent.thoughts.map((thought) => {
          return {
            ...thought,
            body: thought.body.getCurrentContent().getPlainText(),
          };
        }),
      };
      (async () => {
        const { error } = await supabase.from("agents").update(agentWithBodyAsString).eq("name", agent.name);
        if (error) {
          console.log(error);
        } else {
          console.log("got agent");
        }
      })();
    }
  }, [agent]);

  useEffect(() => {
    const selectedCell = cellRefs.current[selectedThoughtIndex ?? 0];
    if (selectedCell) {
      selectedCell.focus();
      // put cursor at end of text
      //selectedCell.setSelectionRange(selectedCell.value.length, selectedCell.value.length);
    }
  }, [selectedThoughtIndex]);

  const cellRefs = useRef<any>([null]);

  return (
    <>
      {agentNameList.length > 0 ? (
        <select
          id="agent-selector"
          className="bg-[#121212] border border-gray-600 px-2 m-2"
          value={selectedAgentName ?? ""}
          onChange={(event) => {
            const newAgentNameSelected = event.target.value;
            if (newAgentNameSelected) {
              setSelectedAgentName(newAgentNameSelected);
            }
          }}
        >
          {agentNameList.map((agentName) => (
            <option key={agentName} value={agentName}>
              {agentName}
            </option>
          ))}
        </select>
      ) : null}
      <div>
        {agent != null ? (
          <div>
            <h1 className={"pb-2"}>{agent.name}</h1>
            <>
              <div className="flex flex-col">
                {agent.thoughts.map((thought, index) => {
                  let className =
                    "editor-container m-1 cursor-pointer bg-zinc-800 rounded-sm h-[25px] overflow-auto w-full";
                  if (index === selectedThoughtIndex) {
                    className += " border border-blue-600 bg-blue-950";
                  }
                  if (!cellRefs.current[index]) {
                    cellRefs.current[index] = null;
                  }
                  return (
                    <div key={index} className={className}>
                      <Editor
                        ref={(el) => (cellRefs.current[index] = el)}
                        editorState={thought.body}
                        onChange={(e) => {
                          console.log(`in onChange for thought index ${index}`);
                          setAgent((ag) => {
                            if (ag === null) {
                              return ag;
                            }
                            const newThoughts = [...ag.thoughts];
                            newThoughts[index] = {
                              ...newThoughts[index],
                              body: e,
                            };
                            return {
                              ...ag,
                              thoughts: newThoughts,
                            };
                          });
                        }}
                        onFocus={() => {
                          if (selectedThoughtIndex === index) {
                            return;
                          }
                          setSelectedThoughtIndex(index);
                        }}
                        handleKeyCommand={(e) => handleKeyCommand(e, index)}
                        keyBindingFn={myKeyBindingFn}
                        //onKeyDown={(e) => {
                        //  if (e.key === "Enter" && !e.shiftKey) {
                        //    e.preventDefault();
                        //    console.log("Enter key pressed");
                        //    setAgent((old) => {
                        //      if (old === null) {
                        //        return old;
                        //      }
                        //      const newThoughts = [...old.thoughts];
                        //      newThoughts.splice(index + 1, 0, {
                        //        body: "",
                        //        human_generated_slices: [],
                        //      });
                        //      return {
                        //        ...old,
                        //        thoughts: newThoughts,
                        //      };
                        //    });
                        //    setSelectedThoughtIndex((i) => (i ?? 0) + 1);
                        //  }
                        //  if (e.key === "Backspace" && thought.body === "") {
                        //    e.preventDefault();
                        //    console.log("Backspace key pressed");
                        //    setAgent((old) => {
                        //      if (old === null || old.thoughts.length <= 1) {
                        //        return old;
                        //      }
                        //      const newThoughts = [...old.thoughts];
                        //      newThoughts.splice(index, 1); // Remove the current thought

                        //      return {
                        //        ...old,
                        //        thoughts: newThoughts,
                        //      };
                        //    });
                        //    setSelectedThoughtIndex((i) => ((i ?? 0) === 0 ? 0 : (i ?? 0) - 1));
                        //  }
                        //}}
                      />
                    </div>
                  );
                })}
              </div>
            </>
          </div>
        ) : (
          <h1>Select an agent</h1>
        )}
      </div>
      <div>
        <button
          onClick={() => {
            if (agent === null) {
              return;
            }
            let accumulatedText = "";
            const sysMessage: ChatCompletionSystemMessageParam = {
              role: "system",
              content: "Come up with the next thought based on the following stream of thoughts",
            };
            console.log("agent.thoughts", agent.thoughts);
            console.log("selectedThoughtIndex", selectedThoughtIndex);
            const idx = (selectedThoughtIndex ?? 0) + 1;
            console.log("idx: ", idx);
            console.log("agent thoughts slice: ", agent.thoughts.slice(0, idx));

            const assistantMessages: ChatCompletionAssistantMessageParam[] = agent.thoughts
              .slice(0, idx)
              .map((thought) => ({ role: "assistant", content: thought.body.getCurrentContent().getPlainText() }));
            const messages = [sysMessage, ...assistantMessages];
            console.log("messages", messages);
            // First add a new empty thought to the agent
            setAgent((old) => {
              if (old === null) {
                return old;
              }
              const newThoughts = [...old.thoughts];
              newThoughts.splice((selectedThoughtIndex ?? 0) + 1, 0, {
                body: EditorState.createEmpty(),
                human_generated_slices: [],
              });
              return {
                ...old,
                thoughts: newThoughts,
              };
            });
            setSelectedThoughtIndex((i) => (i ?? 0) + 1);

            let chatArgs = {
              messages: messages,
              stream: true,
              onDelta: (delta) => {
                if (delta) {
                  accumulatedText += delta;
                  setAgent((old) => {
                    if (old === null) {
                      return null;
                    }
                    const newThoughts = [...old.thoughts];
                    const newThoughtIndex = (selectedThoughtIndex ?? 0) + 1;
                    newThoughts[newThoughtIndex].body = EditorState.createWithContent(
                      ContentState.createFromText(accumulatedText)
                    );
                    return {
                      ...old,
                      thoughts: newThoughts,
                    };
                  });
                }
              },
            };
            const chat = import.meta.env.HEADLONG_INFERENCE_SERVICE ==
              "huggingface" ?
              huggingFaceChat(chatArgs) :
              gpt4TurboChat(chatArgs);

            // Then fill that thought in.
            chat.then(() => {
                console.log("Streaming complete");
                // Additional actions if needed after streaming is complete
              })
              .catch((error) => {
                console.error("Error with streaming:", error);
              });
          }}
        >
          Generate
        </button>
      </div>
    </>
  );
}
export default App;
