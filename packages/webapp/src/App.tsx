import { useEffect, useState, useRef, useMemo } from "react";
import "./App-compiled.css";
import { Schema, Node as ProseMirrorNode } from "prosemirror-model";
import { EditorState, Transaction, Selection as ProsemirrorSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { joinTextblockBackward } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { Plugin, TextSelection } from "prosemirror-state";
import { undo, redo, history } from "prosemirror-history";
import supabase from "./supabase";
import { v4 as uuidv4 } from "uuid";
import openai from "./openai";
import {hf, tokenizer} from "./huggingface";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";
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
    let consoleMsg = "";
    transactions.forEach((tr) => {
      if (tr.docChanged) {
        // Loop through each step in the transaction
        tr.steps.forEach((step) => {
          // console.log("step.toJSON().stepType: ", step.toJSON().stepType);
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
              consoleMsg = `Removing highlight from ${from} ${to}`
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
      console.log(consoleMsg);
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
  const [thoughtIdsToUpdate, setThoughtIdsToUpdate] = useState<Set<string>>(new Set());

  // Put userMessage before/after each assistantMessage and append sysMessage (if given) to the beginning
  // [assist0, assist1, assist2] -> [sys, user, assist0, user, assist1, user]
  function promptedThoughtStream(
    sysMessage: string,
    userMessage: string,
    assistantMessages: string[]) {
      const allMessages = [];
      if (sysMessage) {
        allMessages.push({role: 'system', content: sysMessage});
      }
      for (const message of assistantMessages) {
        if (message) {
          allMessages.push({role: 'user', content: userMessage});
          allMessages.push({role: 'assistant', content: message});
        }
      }
      allMessages.push({role: 'user', content: userMessage});
      return allMessages;
    }

    // Format thought stream according to the Llama chat template. No dependency on Transformers lib
    function getLlamaTemplatedChat(
      sysMessage: string,
      userMessage: string,
      assistantMessages: string[]
    ){
      let templatedChat = "<s>[INST] ";
      if (sysMessage) {
        templatedChat = templatedChat.concat("<<SYS>>\n", sysMessage, "\n<</SYS>>\n\n");
      }
      templatedChat = templatedChat.concat(userMessage, " [/INST]");

      for (const message of assistantMessages) {
        if (message) {
          templatedChat = templatedChat.concat(" ", message.trim(), " </s><s>[INST] ", userMessage, " [/INST]");
        }          
      }
      return templatedChat;
    }

  async function gpt4TurboChat(options: {
    sysMessage: string;
    userMessage: string;
    assistantMessages: string[];
    max_tokens?: number;
    temperature?: number;
    stream?: boolean; // Add stream option
    onDelta: (delta: any) => void; // Callback to handle incoming data
  }) {  
    // Assuming the OpenAI SDK has an event emitter or callback mechanism for streaming
    const allMessageParams = promptedThoughtStream(options.sysMessage, options.userMessage, options.assistantMessages);
    // Old version
    // const allMessageParams  =
    //   [{role: 'system', content: options.sysMessage}]
    //   + options.assistantMessages.map(message  => ({ role: 'assistant' , content: message }));
    const completion = await openai.chat.completions.create({
      model: "gpt-4-1106-preview",
      messages: allMessageParams as ChatCompletionMessageParam[],
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
    sysMessage: string;
    userMessage: string;
    assistantMessages: string[];
    max_tokens?: number;
    temperature?: number;
    stream?: boolean; // Add stream option
    onDelta: (delta: any) => void; // Callback to handle incoming data
  }) {
    const includeSysMessage = true;
    const templatedChat =
      tokenizer.apply_chat_template(
        promptedThoughtStream(
          includeSysMessage ? options.sysMessage : "",
          options.userMessage,
          options.assistantMessages),
        { tokenize: false,
          add_generation_prompt: false,
          return_tensor: false,
        });
    const templatedChat2 = getLlamaTemplatedChat(
      includeSysMessage ? options.sysMessage : "",
      options.userMessage,
      options.assistantMessages)
    console.log("templates match ", templatedChat == templatedChat2);

    const completion = hf.textGenerationStream({
      inputs: templatedChat,
      parameters: {
        max_new_tokens: options.max_tokens ?? 100,
        temperature: options.temperature ?? 0.5,
        return_full_text: false,
        // repetition_penalty: 1,
      }
    },
    { wait_for_model: true});

    let reply = "";
    const stream = completion as AsyncIterable<any>;
    for await (const chunk of stream) {
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

  function computeNewThoughtIndex(state: EditorState) {
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
    return newThoughtIndex;
  }

  const enterKeyPlugin = keymap({
    Enter: (state, dispatch) => {
      if (dispatch && state.selection.empty) {
        let { tr } = state;

        const newThoughtIndex = computeNewThoughtIndex(state);
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
        } else {
          console.log("Not updating metadata.needs_handling for the last thought");
        }

        if (!tr.selection.empty) tr.deleteSelection();
        const position = tr.selection.from; // Insert position

        // Adjust the insertion position to after the current node
        const insertPos = tr.doc.resolve(position).after(1);

        // Insert the new thought node and move the selection
        tr = tr.insert(insertPos, thoughtNode);

        // Calculate the position for the new selection
        // It should be within the newly inserted thought node, accounting for its start position
        const newPos = insertPos + 1; // Position inside the new thought node

        // Update the transaction with the new selection
        tr.setSelection(TextSelection.create(tr.doc, newPos)).scrollIntoView();

        // Dispatch the updated transaction
        dispatch(tr);

        // TODO: FIX ME
        // Not using database calls to compute next index because those are async and we need the index now
        // This might lead to issues with concurrent insertions of thoughts causing conflicts
        //(async () => {
        //  const computedIndex = await computeIndex(selectedAgentName, currentThoughtIndex);
        //  // Add a new thought to the Supabase database
        //  addNewThoughtToDatabase(thoughtNode.attrs.id, "", selectedAgentName, computedIndex);
        //})();

        // Add a new thought to the Supabase database
        //addNewThoughtToDatabase(thoughtNode.attrs.id, "", selectedAgentName, newThoughtIndex);
        setThoughtIdsToUpdate((prev) => {
          return new Set(prev).add(thoughtNode.attrs.id);
        });

        return true;
      }
      return false;
    },
  });

  const ctrlEnterKeyPlugin = keymap({
    "Ctrl-Enter": (state, dispatch) => {
      console.log("ctrl-enter, dispatch is ", dispatch);
      if (dispatch) {
        // Assuming you have a way to identify the current thought node
        // This is a simplistic approach, adjust according to your actual node structure and IDs
        const { $head } = state.selection;
        const currentThoughtIndex: number = $head.parent.attrs.index;
        const currentThoughtPos = state.selection.$head.before();
        const node = state.doc.nodeAt(currentThoughtPos);

        console.log("currentThoughtIndex: ", currentThoughtIndex);
        console.log("node: ", node);
        console.log("nodeType: ", node?.type.name);
        if (node && node.type.name === "thought") {
          console.log("handling thought");
          const metadataAttr = { ...node.attrs.metadata, needs_handling: true };
          const transaction = state.tr.setNodeAttribute(currentThoughtPos, "metadata", metadataAttr);
          dispatch(transaction);
          return true;
        }
      }

      return false;
    },
  });

  const backspaceKeyPlugin = keymap({
    Backspace: (state, dispatch) => {
      const { from, to } = state.selection;
      console.log("backspacing from: ", from, " to: ", to);

      // Collect all unique thought IDs within the selection range.
      const thoughtIdsInSelection = new Set();
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name === "thought" && node.attrs.id) {
          thoughtIdsInSelection.add(node.attrs.id);
        }
      });
  
      // Check if it's just a cursor position without a selection range.
      const isCursor = from === to;
      if (isCursor) {
        // Handle the case where it's just a cursor without a selection.
        // Attempt to join with the previous block if at the start of a thought, or delete the previous character.
        // Use joinTextblockBackward to try and merge this block with the previous block if applicable.
        const result = joinTextblockBackward(state, dispatch);
        if (result) {
          return true;
        }
      } else {
        console.log("Deleting a slice from within thoughts w/ IDs: ", Array.from(thoughtIdsInSelection));
        // Here you can handle the deletion of thoughts by their IDs.
        // For example, mark them for deletion in the database, update state, etc.
        setThoughtIdsToUpdate((prev) => {
          thoughtIdsInSelection.forEach(id => prev.add(id));
          return new Set(prev);
        });
  
        if (dispatch) {
          // Create and dispatch a transaction that deletes the selected range.
          const deleteTransaction = state.tr.delete(from, to);
          dispatch(deleteTransaction);
        }
        
        // Return true to indicate that the backspace handler has done something,
        // preventing the default backspace behavior.
        return true;
      }
    },
  });
  
  //const backspaceKeyPlugin = keymap({
  //  Backspace: (state, dispatch) => {
  //    // Use the joinBackward command directly
  //    // It returns true if it performed an action, false otherwise
  //    const currThoughtId = state.selection.$head.parent.attrs.id;
  //    console.log("backspacing while in thought id: ", currThoughtId);
  //    const jbRes = joinTextblockBackward(state, dispatch);
  //    // Remove the thought that is being deleted from the Supabase database
  //    setThoughtIdsToUpdate((prev) => {
  //      return new Set(prev).add(currThoughtId);
  //    });
  //    return jbRes;
  //  },
  //});

  const modAKeyplugin = keymap({
    "Mod-a": (state, dispatch) => {
      const { $from, $to } = state.selection;
      let start = $from.before(1); // Get the start position of the current thought
      let end = $to.after(1); // Get the end position of the current thought

      if (start === undefined) {
        // If the start is at the beginning of the document
        start = 1;
      }
      if (end === undefined) {
        // If the end is at the end of the document
        end = state.doc.content.size - 1;
      }

      // Check if the selection spans across multiple thoughts
      state.doc.nodesBetween(start, end, (node, pos) => {
        if (node.type.name === "thought") {
          // Adjust start and end to include the entire range of thoughts
          if (pos < start) {
            start = pos;
          }
          const nodeEnd = pos + node.nodeSize;
          if (nodeEnd > end) {
            end = nodeEnd;
          }
        }
      });

      if (dispatch) {
        dispatch(state.tr.setSelection(TextSelection.create(state.doc, start, end)));
      }
      return true;
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
    console.log("pushToDB called with isToUpdate: ", idsToUpdate);

    if (!editorViewRef.current) {
      console.error("Editor view is not available.");
      return;
    }

    const { doc } = editorViewRef.current.state;

    idsToUpdate.forEach(async (id) => {
      let foundNode: ProseMirrorNode | null = null;
      let foundNodePos: number | null = null;

      doc.descendants((node, pos) => {
        if (node.attrs.id === id) {
          foundNode = node;
          foundNodePos = pos;
          return false; // Stop searching
        }
      });

      if (foundNode === null || foundNodePos === null) {
        console.log(`Deleting thought with id ${id} from database.`);
        const { error } = await supabase.from(THOUGHTS_TABLE_NAME).delete().eq("id", id);

        if (error) {
          console.error("Error deleting thought from database", error);
        } else {
          console.log(`Deleted thought with id ${id} from database.`);
        }
      } else {
        // Extract the text from the found node
        const thoughtText = foundNode.textContent;

        // Extract marks using .toJSON() on each mark
        const marks = foundNode.content.content.reduce((acc, node) => {
          if (node.marks && node.marks.length > 0) {
            const serializedMarks = node.marks.map((mark) => mark.toJSON());
            acc.push([node.nodeSize, serializedMarks]);
          } else {
            acc.push([node.nodeSize, null]);
          }
          return acc;
        }, []);

        console.log("marks: ", marks);
        const { data: newThoughtRow, error } = await supabase
          .from(THOUGHTS_TABLE_NAME)
          .update({
            index: foundNode.attrs.index,
            body: thoughtText,
            agent_name: selectedAgentName,
            metadata: {
              ...foundNode.attrs.metadata,
              last_updated_by: APP_INSTANCE_ID,
              marks,
            },
          })
          .eq("id", id)
          .select()
          .maybeSingle();

        if (error) {
          console.error("Error updating thought:", error);
        } else if (newThoughtRow === null) {
          // This is a new thought so update failed and we need to insert it
          console.log(`Inserting new thought ${id} into database.`);
          const { data, error } = await supabase.from(THOUGHTS_TABLE_NAME).insert([
            {
              id: id,
              index: foundNode.attrs.index,
              body: thoughtText,
              agent_name: selectedAgentName,
              metadata: { last_updated_by: APP_INSTANCE_ID, marks },
            },
          ]);
          if (error) {
            console.error("Error inserting new thought into database", error);
          } else {
            console.log(`Thought ${id} inserted successfully.`);
          }
        } else {
          console.log(`Thought ${id} updated successfully.`);
        }
      }
    });

    setThoughtIdsToUpdate(new Set());
  }

  const throttlePushToDB = useMemo(() => throttle(pushToDB, 1000), []);

  useEffect(() => {
    if (thoughtIdsToUpdate.size === 0) {
      return;
    }
    throttlePushToDB(thoughtIdsToUpdate);
  }, [thoughtIdsToUpdate]);

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
          tr.insert(insertPos, thoughtNode).scrollIntoView();
        }
      } else if (eventType === "UPDATE") {
        // Update the thought in the editor by replacing the node with updated content
        state.doc.descendants((node, pos) => {
          if (node.type.name === "thought" && node.attrs.id === oldThought.id) {
            console.log("updating thought in editor with metadata: ", newThought.metadata); 
            const updatedThoughtNode = state.schema.nodes.thought.createAndFill(
              {
                id: newThought.id,
                index: newThought.index,
                metadata: newThought.metadata,
              },
              // marks is an array of [length, markJSON] where markJSON is the serialized mark
              // of length length or null if there are no marks for that range.
              // create an array of text elements, each with the appropriate marks
              newThought.metadata?.marks
                ? newThought.metadata.marks.reduce((acc, [length, markDefs]) => {
                    const text = newThought.body.substring(cursor, cursor + length);
                    let marks = [];

                    if (markDefs !== null) {
                      markDefs.forEach((markDef) => {
                        if (markDef.type) {
                          const markType = state.schema.marks[markDef.type];
                          if (markType) {
                            marks.push(markType.create(markDef.attrs));
                          }
                        }
                      });

                      acc.push(state.schema.text(text, marks));
                    } else {
                      acc.push(state.schema.text(text));
                    }
                    cursor += length; // Move the cursor forward
                    return acc;
                  }, [])
                : state.schema.text(newThought.body),
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
          toDOM: () => ["p", { style: "border-bottom: thin #393939 solid" }, 0],
        },
        text: {},
      },
      marks: {
        highlight: {
          toDOM: () => ["span", { style: "background-color: purple;" }, 0],
          parseDOM: [{ tag: "span", style: "background-color: purple;" }],
        },
      },
    });

    const initialDocContent = thoughts.map((thought) => {
      const thoughtAttrs = {
        id: thought.id,
        index: thought.index,
        created_at: thought.created_at,
        processed_at: thought.processed_at,
        metadata: thought.metadata,
      };

      if (thought.body) {
        // Initialize an empty array to hold the content of the thought node
        let content = [];
        let cursor = 0; // A cursor to track our position as we apply marks

        if (thoughtAttrs.metadata && thoughtAttrs.metadata.marks) {
          thoughtAttrs.metadata.marks.forEach(([length, markDefs]) => {
            const text = thought.body.substring(cursor, cursor + length);
            let marks = [];

            if (markDefs !== null) {
              markDefs.forEach((markDef) => {
                if (markDef.type) {
                  const markType = schema.marks[markDef.type];
                  if (markType) {
                    marks.push(markType.create(markDef.attrs));
                  }
                }
              });

              content.push(schema.text(text, marks));
            } else {
              content.push(schema.text(text));
            }
            cursor += length; // Move the cursor forward
          });

          // Handle any remaining text without marks
          if (cursor < thought.body.length) {
            content.push(schema.text(thought.body.substring(cursor)));
          }
        } else {
          // If there are no marks, just create a text node with the entire body
          content = [schema.text(thought.body)];
        }

        return schema.nodes.thought.create(thoughtAttrs, content);
      } else {
        return schema.nodes.thought.create(thoughtAttrs);
      }
    });
    const initialContent = schema.nodes.doc.create({}, initialDocContent);

    let state = EditorState.create({
      doc: initialContent,
      schema,
      plugins: [
        removeHighlightOnInputPlugin,
        enterKeyPlugin,
        ctrlEnterKeyPlugin,
        backspaceKeyPlugin,
        modAKeyplugin,
        history(),
        keymap({ "Mod-z": undo, "Mod-y": redo, "Mod-Shift-z": redo}),
      ],
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

    const selection = ProsemirrorSelection.atEnd(view.state.doc);
    console.log("selection: ", selection);
    const tr = view.state.tr.setSelection(selection).scrollIntoView();
    const updatedState = view.state.apply(tr);
    view.updateState(updatedState);

    editorViewRef.current = view;

    return () => {
      if (editorViewRef.current) {
        editorViewRef.current.destroy();
      }
    };
  }, [loading]);

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
  };

  const generateThought = async () => {
    if (!editorViewRef.current) {
      return;
    }

    // Generate a new thought ID and index
    const newThoughtId = uuidv4(); // Assuming uuidv4() is available for generating unique IDs
    const newThoughtIndex = computeNewThoughtIndex(editorViewRef.current.state);

    const schema = editorViewRef.current.state.schema;
    // Create a new thought without setting needs_handling yet
    const newThoughtNode = schema.nodes.thought.create({
      id: newThoughtId,
      index: newThoughtIndex,
      metadata: {}, // Initially empty or with other necessary initial metadata
    }); // Assuming your schema has a 'thought' node and 'text' node

    // Add the new thought to the editor state
    let tr = editorViewRef.current.state.tr;
    if (!tr.selection.empty) tr.deleteSelection();
    const position = tr.selection.from; // Insert position

    // Adjust the insertion position to after the current node
    const insertPos = tr.doc.resolve(position).after(1);

    // Insert the new thought node and move the selection
    tr = tr.insert(insertPos, newThoughtNode);

    // Calculate the position for the new selection
    // It should be within the newly inserted thought node, accounting for its start position
    const newPos = insertPos + 1; // Position inside the new thought node

    // Update the transaction with the new selection
    tr.setSelection(TextSelection.create(tr.doc, newPos)).scrollIntoView();
    editorViewRef.current.dispatch(tr);

    // Prepare for LLM text generation
    const thoughts = extractThoughtTexts(editorViewRef.current.state.doc);
    console.log("thoughts: ", thoughts);
    // use editorView to get the thought id of the current selection
    const currThoughtId = newThoughtId; // Use the newly created thought ID
    // create a new list from `thoughts` that only has thoughts up to and including
    // the thought with currThoughtId
    const thoughtsAfterCurr = thoughts.slice(0, thoughts.findIndex(([id, _]) => id === currThoughtId) + 1);
    const sysMessage = "You are going to do some thinking on your own. Try to be conscious of your own thoughts so you can tell them to me one by one.";
    const userMessage = "What is your next thought?";
    const assistantMessages: string[] = thoughtsAfterCurr.map(([_, body]) => {return body;});
    console.log("Assistant Messages: ", assistantMessages);
    const chatArgs = {
      sysMessage: sysMessage,
      userMessage: userMessage,
      assistantMessages: assistantMessages,
      temperature: modelTemperature,
      stream: true,
      onDelta: async (delta) => {
        if (delta) {
          if (editorViewRef.current) {
            const { tr } = editorViewRef.current.state;
            const highlightMark = editorViewRef.current.state.schema.marks.highlight.create();
            if (!tr.selection.empty) tr.deleteSelection();
            const position = tr.selection.from; // Insert position
            const textNode = editorViewRef.current.state.schema.text(delta);
            tr.insert(position, textNode);
            const endPosition = position + delta.length;
            tr.addMark(position, endPosition, highlightMark);
            let pos = null;
            tr.doc.descendants((node, position) => {
              if (node.attrs.id === newThoughtId) {
                pos = position;
                return false; // Stop searching
              }
            });
            if (pos !== null) {
              const node = tr.doc.nodeAt(pos);
              console.log("found node at position: ", position, node);
              const metadata = node.attrs.metadata;
              const newMetadata = { ...metadata, needs_handling: true };
              tr.setNodeMarkup(pos, null, { ...node.attrs, metadata: newMetadata });
            }
            editorViewRef.current.dispatch(tr);
          }
        }
      },
    };
    modelSelection === "GPT4" ? gpt4TurboChat(chatArgs) : huggingFaceChat(chatArgs);
    // After the LLM finishes generating the thought, mark it as needs handling
    setThoughtIdsToUpdate((prev) => {
      return new Set(prev).add(newThoughtId);
    });
  };

  return (
    <div className="App flex flex-col max-h-screen">
      <div className="w-screen flex">
        <svg xmlns="http://www.w3.org/2000/svg" width="61" height="49.5" viewBox="0 0 61 49.5" className="flex-none">
          <rect x="8" y="8" width="9" height="34.5" style={{ fill: "#b87df9" }} />
          <rect x="23" y="8" width="9" height="34.5" style={{ fill: "#b87df9" }} />
          <rect x="36.5" y="33.5" width="11.5" height="9" style={{ fill: "#b87df9" }} />
        </svg>
        <div className="flex-grow flex justify-end">
          <div className="flex items-center space-x-2 p-2 rounded-md">
            {envStatus === "attached" ? (
              <>
                <span className="text-sm text-green-500">Environment</span>
                {/* Online Icon */}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5 text-green-500"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-10.293a1 1 0 00-1.414-1.414L9 9.586 7.707 8.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
              </>
            ) : (
              <>
                <span className="text-sm text-red-500">Environment</span>
                {/* Offline Icon: Red circle (outline) with a red "X" */}
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20">
                  <circle cx="10" cy="10" r="9" stroke="#ef4444" fill="none" strokeWidth="2" />{" "}
                  {/* Red outlined circle with black fill */}
                  <path stroke="#ef4444" strokeLinecap="round" strokeWidth="2" d="M6 6l8 8m0 -8l-8 8" /> {/* Red X */}
                </svg>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="flex-grow overflow-y-auto border border-solid border-[#e3ccfc]">
        <div ref={editorRef} className="w-full h-full p-1"></div> {/* Ensure the ref div fills its parent */}
      </div>
      <div className="flex justify-between items-center p-2 border-t border-slate-200">
        {" "}
        {/* Use p-2 for padding and bg-gray-100 for a light background */}
        <button className="bg-blue-500 text-white py-1 px-2 rounded-md" onClick={generateThought}>
          Generate
        </button>
        <div className="flex items-center">
          {import.meta.env.VITE_HF_API_KEY && import.meta.env.VITE_HF_LLAMA_ENDPOINT && (
            <>
              <label htmlFor="modelSelection" className="ml-3">
                Model:{" "}
              </label>
              <select
                id="modelSelection"
                value={modelSelection}
                onChange={(e) => setModelSelection(e.target.value)}
                className="ml-1"
              >
                <option value="GPT4">GPT4</option>
                <option value="Headlong 7B">Headlong 7B</option>
              </select>
            </>
          )}
          <label htmlFor="modelTemperature" className="ml-3">
            Temperature:{" "}
          </label>
          <input
            type="number"
            step="0.1"
            max="1.0"
            min="0.0"
            id="modelTemperature"
            value={modelTemperature}
            onChange={(e) => setModelTemperature(parseFloat(e.target.value))}
            className="ml-1 w-14"
          />
        </div>
      </div>
    </div>
  );
}

export default App;
