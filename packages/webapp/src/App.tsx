import { useEffect, useState, useRef, useMemo } from "react";
import "./App-compiled.css";
import { Schema, Node as ProseMirrorNode } from "prosemirror-model";
import { EditorState, Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { joinTextblockBackward } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { Plugin, TextSelection } from "prosemirror-state";
import supabase from "./supabase";
import { v4 as uuidv4 } from "uuid";
import openai from "./openai";
import hf from "./huggingface";
import {
  ChatCompletionAssistantMessageParam,
  ChatCompletionSystemMessageParam,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import { throttle } from "lodash";
import { Database } from "./database.types";
import "prosemirror-view/style/prosemirror.css";
import { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

const THOUGHTS_TABLE_NAME = "thoughts";
const APP_INSTANCE_ID = uuidv4(); // used to keep subscriptions from handling their own updates

type Thought = Database["public"]["Tables"]["thoughts"]["Row"];

const removeHighlightOnInputPlugin = new Plugin({
  appendTransaction(transactions, oldState, newState) {
    let newTransaction: Transaction | null = null;
    let markAdded = false;
    transactions.forEach((tr) => {
      console.log("Inside appendTransaction, handling tr: ", tr);
      if (tr.docChanged) {
        // Loop through each step in the transaction
        tr.steps.forEach((step) => {
          if (step.toJSON().stepType === "addMark") {
            markAdded = true;
          }
          const stepMap = step.getMap();
          // We only care about "addText" steps, which don't exist explicitly.
          // ProseMirror uses "replace" steps with content for adding text.
          if (stepMap) {
            // Check each step to see if it's adding text within a highlight
            let removeHighlight = false;
            stepMap.forEach((oldStart, oldEnd, newStart, newEnd) => {
              // Check for highlight in the affected range
              const hasHighlight = newState.doc.rangeHasMark(newStart, newEnd, newState.schema.marks.highlight);
              if (hasHighlight) {
                removeHighlight = true;
              }
            });

            if (removeHighlight) {
              // If text was added in a highlight, create a transaction to remove the highlight mark
              const { from, to } = tr.selection;
              console.log("Removing highlight from", from, to);
              const mark = newState.schema.marks.highlight;
              if (newTransaction === null) {
                newTransaction = newState.tr.removeMark(from - 1, to, mark);
              } else {
                newTransaction.removeMark(from, to, newState.schema.marks.highlight);
              }
            }
          }
        });
      }
    });

    // Only append transactions if we've actually created any
    if (newTransaction !== null && !markAdded) {
      return newTransaction;
    }
    return null;
  },
});

function App() {
  const editorRef = useRef<HTMLElement>();
  const editorViewRef = useRef<EditorView | null>(null);
  const [selectedAgentName] = useState<string>("bilbo bossy baggins");
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [loading, setLoading] = useState(true);
  const [modelSelection, setModelSelection] = useState("GPT4");
  const [modelTemperature, setModelTemperature] = useState(0.5);
  const [envStatus, setEnvStatus] = useState("detached");
  const [thoughtsIdsToUpdate, setThoughtIdsToUpdate] = useState<Set<string>>(new Set());

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
    let prompt = "";
    for await (const message of options.messages) {
      switch (message.role) {
        case "system":
          prompt = prompt.concat("<s> [INST] <<SYS>> ", message.content, " </SYS>> [/INST]");
          break;
        case "assistant":
          prompt = prompt.concat(message.content ?? "", "\n");
          break;
        default:
          console.log("Unknown message type");
      }
    }
    console.log("Prompt:\n", prompt);

    const completion = hf.textGenerationStream({
      inputs: prompt,
      parameters: {
        max_new_tokens: options.max_tokens ?? 100,
        temperature: options.temperature ?? 0.5,
        return_full_text: false,
        // repetition_penalty: 1,
      },
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

  const enterKeyPlugin = keymap({
    Enter: (state, dispatch) => {
      if (dispatch && state.selection.empty) {
        const { tr } = state;
        // get the current thought id
        const currentThoughtIndex: number = state.selection.$head.parent.attrs.index;
        let nextThoughtIndex: number | null = null;

        state.doc.descendants((node, pos) => {
          if (node.type.name === "thought" && node.attrs.index > currentThoughtIndex) {
            if (nextThoughtIndex === null || node.attrs.index < nextThoughtIndex) {
              nextThoughtIndex = node.attrs.index;
            }
          }
        });
        const newThoughtIndex = nextThoughtIndex
          ? (currentThoughtIndex + nextThoughtIndex) / 2.0
          : currentThoughtIndex + 1.0;

        const thoughtNode = state.schema.nodes.thought.create({
          id: uuidv4(),
          index: newThoughtIndex,
          metadata: { needs_handling: false, last_updated_by: APP_INSTANCE_ID },
        });
        // if the current though is the last one, then update
        // it's metadata.needs_handling to be true
        const currentThoughtPos = state.selection.$head.before();
        const currentThoughtNode = state.doc.nodeAt(currentThoughtPos);
        if (currentThoughtNode === null) {
          console.error("currentThoughtNode is null, there should always be a thought node at the cursor position.");
          return false;
        }
        const isLastThought = currentThoughtPos + currentThoughtNode.nodeSize === state.doc.content.size;

        // Perform the necessary updates
        if (isLastThought) {
          console.log("Setting metadata.needs_handling = true for the 2nd to last thought");
          tr.setNodeAttribute(currentThoughtPos, "metadata", {
            needs_handling: true,
            last_updated_by: APP_INSTANCE_ID,
          });
          setThoughtIdsToUpdate((prev) => {
            return new Set(prev).add(currentThoughtNode.attrs.id);
          });
        } else {
          console.log("Not updating metadata.needs_handling for the last thought");
          //console.log("currentThoughtPos", currentThoughtPos);
          //console.log("currentThoughtNode", currentThoughtNode);
          //console.log("isLastThought", isLastThought);
        }

        if (!tr.selection.empty) tr.deleteSelection();
        const position = tr.selection.from; // Insert position

        // Adjust the insertion position to after the current node
        const insertPos = tr.doc.resolve(position).after(1);

        // Insert the new thought node and move the selection
        const newTr = tr.insert(insertPos, thoughtNode);

        // Calculate the position for the new selection
        // It should be within the newly inserted thought node, accounting for its start position
        const newPos = insertPos + 1; // Position inside the new thought node

        // Update the transaction with the new selection
        newTr.setSelection(TextSelection.create(newTr.doc, newPos));

        // Dispatch the updated transaction
        dispatch(newTr);

        // TODO: FIX ME
        // Not using database calls to compute next index because those are async and we need the index now
        // This might lead to issues with concurrent insertions of thoughts causing conflicts
        //(async () => {
        //  const computedIndex = await computeIndex(selectedAgentName, currentThoughtIndex);
        //  // Add a new thought to the Supabase database
        //  addNewThoughtToDatabase(thoughtNode.attrs.id, "", selectedAgentName, computedIndex);
        //})();

        // Add a new thought to the Supabase database
        addNewThoughtToDatabase(thoughtNode.attrs.id, "", selectedAgentName, newThoughtIndex);

        return true;
      }
      return false;
    },
  });

  const backspaceKeyPlugin = keymap({
    Backspace: (state, dispatch) => {
      // Use the joinBackward command directly
      // It returns true if it performed an action, false otherwise
      const currThoughtId = state.selection.$head.parent.attrs.id;
      console.log("backspacing while in thought id: ", currThoughtId);
      const jbRes = joinTextblockBackward(state, dispatch);
      // Remove the thought that is being deleted from the Supabase database
      setThoughtIdsToUpdate((prev) => {
        return new Set(prev).add(currThoughtId);
      });
      return jbRes;
    },
  });

  async function addNewThoughtToDatabase(id: string, body: string, agentName: string, index: number) {
    const { data, error } = await supabase
      .from(THOUGHTS_TABLE_NAME)
      .insert([{ id: id, index: index, body: body, agent_name: agentName }]);
    if (error) {
      console.error("Error adding new thought to database", error);
    } else {
      console.log("Added new thought to database ", id);
    }
  }

  function pushToDB(idsToUpdate: Set<string>) {
    // get the editor state as Json so we can fetch thoughts from it by id
    console.log("pushToDB called wit isToUpdate: ", idsToUpdate);
    const edState = editorViewRef.current?.state.toJSON();
    idsToUpdate.forEach(async (id: string) => {
      const thought = edState?.doc.content.find((node: any) => node.attrs.id === id);
      if (thought === undefined) {
        console.log(`deleting thought with id ${id} from databaset`);
        supabase
          .from(THOUGHTS_TABLE_NAME)
          .delete()
          .eq("id", id)
          .then(({ data, error }) => {
            if (error) {
              console.error("Error deleting thought from database", error);
            } else {
              console.log(`Deleted thought with id ${id} from database`, data);
            }
          });
      } else {
        console.log("pushing updates to database for thought: ", thought);
        const thoughtText = thought.content
          ? thought.content.reduce((acc: string, node: any) => {
              return acc + node.text;
            }, "")
          : "";
        const { error } = await supabase
          .from(THOUGHTS_TABLE_NAME)
          .update(
            {
              ...thought.attrs,
              metadata: { ...thought.attrs.metadata, last_updated_by: APP_INSTANCE_ID },
              agent_name: selectedAgentName,
              body: thoughtText
            })
          .eq("id", id);
        if (error) {
          console.error("Error updating thought:", error);
        } else {
          console.log(`Thought ${id} updated successfully.`);
        }
      }
    });
    setThoughtIdsToUpdate(new Set());
  }

  const throttlePushToDB = useMemo(() => throttle(pushToDB, 1000), []);

  useEffect(() => {
    if (thoughtsIdsToUpdate.size === 0) {
      return;
    }
    throttlePushToDB(thoughtsIdsToUpdate);
  }, [thoughtsIdsToUpdate]);

  useEffect(() => {
    const envPresenceRoom = supabase.channel("env_presence_room");
    envPresenceRoom
      .on("presence", { event: "sync" }, () => {
        const newState = envPresenceRoom.presenceState();
        console.log("sync", newState);
      })
      .on("presence", { event: "join" }, ({ key, newPresences }) => {
        console.log("join", key, newPresences);
        if (key === "env") {
          if (envStatus === "attached") {
            console.log("env already attached, ignoring new env");
            return;
          }
          setEnvStatus("attached");
        }
      })
      .on("presence", { event: "leave" }, ({ key, leftPresences }) => {
        if (key === "env") {
          if (envStatus !== "detached") {
            setEnvStatus("detached");
          }
        }
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await envPresenceRoom.track({ online_at: new Date().toISOString() });
        }
      });
  }, []);

  useEffect(() => {
    // Assuming newThought is the thought object you received from Supabase
    // and it includes an 'index' attribute you can use for ordering.

    // Function to find the insertion position for a new thought based on its index
    function findInsertPosition(doc: ProseMirrorNode, newIndex: number) {
      let insertPos = 0;
      let found = false;

      doc.descendants((node: ProseMirrorNode, pos) => {
        if (found) return false; // Stop the search once the position is found

        if (node.type.name === "thought") {
          const nodeIndex = node.attrs.index;
          if (newIndex < nodeIndex) {
            found = true;
            insertPos = pos;
            return false; // Stop searching
          }
          // Adjust insertPos to the end of the current node to continue searching
          insertPos = pos + node.nodeSize;
        }
      });

      return insertPos;
    }

    // Define a function to update the editor state based on changes from Supabase
    const updateEditorFromSupabase = (payload: RealtimePostgresChangesPayload<Thought>) => {
      if (!editorViewRef.current) return;

      const { new: newThought, old: oldThought, eventType } = payload;

      const state = editorViewRef.current.state;
      let { tr } = state;

      if (eventType === "INSERT") {
        // Insert the new thought into the editor
        // Determine where to insert the new thought based on its index
        const insertPos = findInsertPosition(state.doc, newThought.index);
        const thoughtNode = state.schema.nodes.thought.createAndFill(
          {
            id: newThought.id,
            index: newThought.index,
            // any other attributes
          },
          state.schema.text(newThought.body)
        );

        if (thoughtNode) {
          tr.insert(insertPos, thoughtNode);
        }
      } else if (eventType === "UPDATE") {
        // Update the thought in the editor by replacing the node with updated content
        state.doc.descendants((node, pos) => {
          if (node.type.name === "thought" && node.attrs.id === oldThought.id) {
            const updatedThoughtNode = state.schema.nodes.thought.createAndFill(
              {
                id: newThought.id,
                index: newThought.index,
                metadata: newThought.metadata,
              },
              state.schema.text(newThought.body)
            );

            if (updatedThoughtNode) {
              // Replace the existing node with the updated node
              tr = tr.replaceWith(pos, pos + node.nodeSize, updatedThoughtNode);
            }
          }
        });
      } else if (eventType === "DELETE") {
        // Remove the thought from the editor
        state.doc.descendants((node, pos) => {
          if (node.type.name === "thought" && node.attrs.id === oldThought.id) {
            tr.delete(pos, pos + node.nodeSize);
          }
        });
      }

      if (tr.docChanged) {
        editorViewRef.current.updateState(state.apply(tr));
      }
    };

    // Subscribe to the thoughts table
    const subscription = supabase
      .channel("thought_table_updates")
      .on<Thought>("postgres_changes", { event: "*", schema: "public", table: THOUGHTS_TABLE_NAME }, (payload) => {
        console.log("Change received!", payload);
        // call updateEditorFromSupabase with the payload if payload.new.agent_name === selectedAgentName
        if ("agent_name" in payload.new && payload.new.agent_name === selectedAgentName) {
          if (payload.new.metadata?.last_updated_by !== APP_INSTANCE_ID) {
            updateEditorFromSupabase(payload);
          }
        }
      })
      .subscribe();
    console.log("subscribed to thought updates for agent: ", selectedAgentName);

    // Cleanup subscription on component unmount
    return () => {
      console.log(`selectedAgentName changed: unsubscribing from updates about agent ${selectedAgentName}`);
      supabase.removeChannel(subscription);
    };
  }, [selectedAgentName]); // Empty dependency array ensures this effect runs only once on mount

  useEffect(() => {
    const fetchThoughts = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from(THOUGHTS_TABLE_NAME)
        .select("*")
        .order("index", { ascending: true })
        .eq("agent_name", selectedAgentName);

      if (error) {
        console.error("Error fetching thoughts:", error);
        setLoading(false);
      } else {
        setThoughts(data || []);
        setLoading(false);
      }
    };

    fetchThoughts();
  }, [selectedAgentName]);

  useEffect(() => {
    if (!editorRef.current || loading) return; // Wait until thoughts are loaded

    const schema = new Schema({
      nodes: {
        doc: { content: "thought+" },
        thought: {
          attrs: { id: { default: uuidv4() }, index: { default: 0 }, metadata: { default: null } },
          content: "text*",
          toDOM: () => ["p", { style: "border-bottom: thin #444 solid" }, 0],
        },
        text: {},
      },
      marks: {
        highlight: {
          toDOM: () => ["span", { style: "background-color: green;" }, 0],
          parseDOM: [{ tag: "span", style: "background-color: green;" }],
        },
      },
    });

    // Construct the initial document content
    const initialDocContent = thoughts.map((thought) => {
      const thoughtAttrs = {
        id: thought.id,
        index: thought.index,
        created_at: thought.created_at,
        processed_at: thought.processed_at,
        metadata: thought.metadata,
      };
      if (thought.body) {
        return schema.nodes.thought.create(thoughtAttrs, schema.text(thought.body));
      } else {
        return schema.nodes.thought.create(thoughtAttrs);
      }
    });
    const initialContent = schema.nodes.doc.create({}, initialDocContent);

    const state = EditorState.create({
      doc: initialContent,
      schema,
      plugins: [removeHighlightOnInputPlugin, enterKeyPlugin, backspaceKeyPlugin],
    });

    const view = new EditorView(editorRef.current, {
      state,
      dispatchTransaction(transaction) {
        if (editorViewRef.current === null) {
          return;
        }
        const newState = editorViewRef.current.state.apply(transaction);

        if (transaction.docChanged) {
          const { from, to } = newState.selection;
          let currentThoughtId: string | null = null;
          newState.doc.nodesBetween(from, to, (node, pos) => {
            if (node.type.name === "thought") {
              currentThoughtId = node.attrs.id; // Assuming each thought node has a unique ID
              return false; // Stop iterating once the first thought node is found
            }
          });

          if (currentThoughtId !== null) {
            setThoughtIdsToUpdate((prev) => {
              return new Set(prev).add(currentThoughtId);
            });
          }
        } else {
          console.log("doc didn't change");
        }
        editorViewRef.current.updateState(newState);
      },
    });

    editorViewRef.current = view;

    return () => {
      if (editorViewRef.current) {
        editorViewRef.current.destroy();
      }
    };
  }, [loading]);

  function extractThoughtTextFromPosition(doc: ProseMirrorNode, pos: number): string {
    let textContent = "";
    doc.nodesBetween(pos, pos, (node) => {
      if (node.type.name === "thought") {
        textContent = node.textContent;
        return false; // Stop iterating once the first thought node is found
      }
    });
    return textContent;
  }

  function extractThoughtTexts(doc: ProseMirrorNode) {
    const texts: [string, string][] = []; // id, thought_body

    // This function recursively walks through the nodes of the document
    function findTexts(node: ProseMirrorNode) {
      // Check if the current node is a 'thought' node
      if (node.type.name === "thought") {
        // If it is, extract its text content and add it to the texts array
        texts.push([node.attrs.id, node.textContent]);
      }
      // Recursively walk through the child nodes
      node.forEach(findTexts);
    }

    // Start the recursive search from the top-level document node
    findTexts(doc);

    return texts;
  }

  const insertTextAtCursor = (text: string) => {
    if (editorViewRef.current) {
      const { tr } = editorViewRef.current.state;
      const highlightMark = editorViewRef.current.state.schema.marks.highlight.create();
      if (!tr.selection.empty) tr.deleteSelection();
      const position = tr.selection.from; // Insert position
      const textNode = editorViewRef.current.state.schema.text(text);
      tr.insert(position, textNode);
      const endPosition = position + text.length;
      tr.addMark(position, endPosition, highlightMark);
      editorViewRef.current.dispatch(tr);
    }
  };

  const generateThought = () => {
    // Get list of thought texts from the editor
    if (editorViewRef.current === null) {
      return;
    }
    const thoughts = extractThoughtTexts(editorViewRef.current.state.doc);
    console.log("thoughts: ", thoughts);
    // use editorView to get the thought id of the current selection
    const currThoughtId = editorViewRef.current?.state.selection.$head.parent.attrs.id;
    // create a new list from `thoughts` that only has thoughts up to and not including
    // the thought with currThoughtId
    const thoughtsAfterCurr = thoughts.slice(
      0,
      thoughts.findIndex(([id, _]) => id === currThoughtId)
    );
    const sysMessage: ChatCompletionSystemMessageParam = {
      role: "system",
      content: "Come up with the next thought based on the following stream of thoughts",
    };
    const assistantMessages: ChatCompletionAssistantMessageParam[] = thoughtsAfterCurr.map(([id, body]) => {
      return { role: "assistant", content: body };
    });
    const messages = [sysMessage, ...assistantMessages];
    console.log("messages: ", messages);
    const chatArgs = {
      messages: messages,
      temperature: modelTemperature,
      stream: true,
      onDelta: (delta) => {
        if (delta) {
          insertTextAtCursor(delta);
        }
      },
    };
    modelSelection === "GPT4" ? gpt4TurboChat(chatArgs) : huggingFaceChat(chatArgs);
  };

  return (
    <div className="App">
      {envStatus === "attached" ? (
        <div className="text-green-500 text-right">Attached to environment</div>
      ) : (
        <div className="text-red-500 text-right">Detached from environment</div>
      )}
      <div className="border border-solid border-slate-100 w-full p-1" ref={editorRef}></div>
      <div className="flex mt-2">
        <button className="bg-blue-500 pl-2 pr-2" onClick={generateThought}>
          Generate
        </button>
        <div className="pt-3">
          {import.meta.env.VITE_HF_API_KEY && import.meta.env.VITE_HF_LLAMA_ENDPOINT ? (
            <>
              <label className="ml-3" htmlFor="modelSelection">
                Model:{" "}
              </label>
              <select id="modelSelection" value={modelSelection} onChange={(e) => setModelSelection(e.target.value)}>
                <option value="GPT4">GPT4</option>
                <option value="Headlong 7B">Headlong 7B</option>
              </select>
            </>
          ) : null}
          <label className="ml-3" htmlFor="modelTemperature">
            Temperature:{" "}
          </label>
          <input
            className="w-14"
            type="number"
            step="0.1"
            max="1.0"
            min="0.0"
            id="modelTemperature"
            value={modelTemperature}
            onChange={(e) => setModelTemperature(parseFloat(e.target.value))}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
