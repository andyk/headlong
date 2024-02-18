import React, { useEffect, useRef, useState } from "react";
import { Schema, NodeSpec, Node as ProseMirrorNode } from "prosemirror-model";
import { EditorState, Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { joinBackward } from "prosemirror-commands";
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


const removeHighlightOnInputPlugin = new Plugin({
  appendTransaction(transactions, oldState, newState) {
    let newTransaction: Transaction | null = null;
    let markAdded = false;
    transactions.forEach((tr) => {
      console.log("Inside appendTransaction, handling tr: ", tr);
      if (tr.docChanged) {
        // Loop through each step in the transaction
        tr.steps.forEach((step) => {
          console.log("step.toJSON().stepType: ", step.toJSON().stepType);
          if (step.toJSON().stepType === 'addMark') {
            markAdded = true;
          }
          console.log("hanlding a tr.step");
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
                newTransaction = newState.tr.removeMark(from-1, to, mark);
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
      console.log("returning newTransaction: ", newTransaction);
      return newTransaction;
    }
    console.log("returning null");
    return null;
  },
});

function App() {
  const editorRef = useRef<HTMLElement>();
  const [editorView, setEditorView] = useState<EditorView | null>(null);
  const [selectedAgentName] = useState<string>("gimli");

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
    let prompt = ""
    for await (const message of options.messages) {
      switch(message.role) {
        case 'system':
          prompt = prompt.concat("<s> [INST] <<SYS>> ", message.content, " </SYS>> [/INST]");
          break;
        case 'assistant':
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

  const enterKeyPlugin = keymap({
    "Enter": (state, dispatch) => {
      if (dispatch && state.selection.empty) {
        const { tr } = state;
        const thoughtNode = state.schema.nodes.thought.create({ id: uuidv4() });
        
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

        // Add a new thought to the Supabase database
        addNewThoughtToDatabase(thoughtNode.attrs.id, "", selectedAgentName);
        
        return true;
      }
      return false;
    }
  });

  const backspaceKeyPlugin = keymap({
    "Backspace": (state, dispatch) => {
      // Use the joinBackward command directly
      // It returns true if it performed an action, false otherwise
      const jbRes = joinBackward(state, dispatch);
      // Remove the thought that is being deleted from the Supabase database
      if (jbRes) {
        const thoughtId = state.selection.$head.parent.attrs.id;
        supabase
          .from("thoughts")
          .delete()
          .eq("id", thoughtId)
          .then(({ data, error }) => {
            if (error) {
              console.error("Error deleting thought from database", error);
            } else {
              console.log(`Deleted thought with id ${thoughtId} from database`, data);
            }
          });
      }
      return jbRes;
    }
  });

  async function addNewThoughtToDatabase(id: string, body: string, agentName: string, insertAfterIndex?: number) {
    let computedIndex;
    if (insertAfterIndex !== undefined) {
      // get the index of the thought after which we want to insert
      // and insert the new thought with an index that is the average of the two
      // truncate the beginning so that the first thought is the one with
      // index = insertAfterIndex
      const { data: sortedThoughtsAfterProvidedIndex, error: thoughtError } = await supabase
        .from("thoughts")
        .select("index")
        .eq("agent_name", agentName)
        .order("index", { ascending: false })
        .gt("index", insertAfterIndex)
      if (thoughtError) {
        console.error("Error fetching thoughts with index greater than insertAfterIndex", thoughtError);
        throw thoughtError;
      }
      computedIndex = (insertAfterIndex + sortedThoughtsAfterProvidedIndex[0].index) / 2;
    } else {
      const { data: maxIndexData, error: maxIndexError } = await supabase
        .from("thoughts")
        .select("index")
        .eq("agent_name", agentName)
        .order("index", { ascending: false })
        .limit(1);
      if (maxIndexError) {
        console.error("Error fetching max(index)", maxIndexError);
        throw maxIndexError;
      }
      computedIndex = maxIndexData ? maxIndexData[0].index + 1.0: 0.0;
    }
    const { data, error } = await supabase
      .from("thoughts")
      .insert([
        { id: id, index: computedIndex, body: body, agent_name: agentName}
      ]);
    if (error) {
      console.error("Error adding new thought to database", error);
    } else {
      console.log("Added new thought to database", data);
    }
  }

  useEffect(() => {
    const schema = new Schema({
      nodes: {
        doc: { content: "thought+" },
        thought: {
          attrs: { id: { default: uuidv4() } },
          content: "text*",
          toDOM: () => ["p", 0],
        },
        text: {
        },
      },
      marks: {
        highlight: {
          toDOM: () => ["span", { style: "background-color: green;" }, 0],
          parseDOM: [{ tag: "span", style: "background-color: green;" }],
        },
      },
    });

    // Create a document node with initial content "Hi"
    const initialContent = schema.nodes.doc.create({}, schema.nodes.thought.create({}, schema.text("Hi")));

    const state = EditorState.create({
      doc: initialContent,
      schema,
      plugins: [removeHighlightOnInputPlugin, enterKeyPlugin, backspaceKeyPlugin],
    });

    const view = new EditorView(editorRef.current, {
      state,
      dispatchTransaction(transaction) {
        const newState = view.state.apply(transaction);
        view.updateState(newState);
      },
    });

    setEditorView(view);

    return () => {
      view.destroy();
    };
  }, []);

  useEffect(() => {
    console.log("editorView updated: ", editorView)
  }, [editorView]);

  function extractThoughtTexts(doc: ProseMirrorNode) {
    const texts: [string, string][] = []; // id, thought_body
  
    // This function recursively walks through the nodes of the document
    function findTexts(node: ProseMirrorNode) {
      // Check if the current node is a 'thought' node
      if (node.type.name === 'thought') {
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
    if (editorView) {
      const { tr } = editorView.state;
      const highlightMark = editorView.state.schema.marks.highlight.create();
      if (!tr.selection.empty) tr.deleteSelection();
      const position = tr.selection.from; // Insert position
      const textNode = editorView.state.schema.text(text);
      tr.insert(position, textNode);
      const endPosition = position + text.length;
      tr.addMark(position, endPosition, highlightMark);
      editorView.dispatch(tr);
    }
  };

  const generateThoughtUsingGPT4 = () => {
    // Get list of thought texts from the editor
    if (editorView === null) {
      return;
    }
    const thoughts = extractThoughtTexts(editorView.state.doc)
    console.log("thoughts: ", thoughts)
    // use editorView to get the thought id of the current selection
    const currThoughtId = editorView?.state.selection.$head.parent.attrs.id;
    // create a new list from `thoughts` that only has thoughts up to and including
    // the thought with currThoughtId
    const thoughtsAfterCurr = thoughts.slice(0, thoughts.findIndex(([id, _]) => id === currThoughtId) + 1); 
    const sysMessage: ChatCompletionSystemMessageParam = {
      role: "system",
      content: "Come up with the next thought based on the following stream of thoughts",
    };
    const assistantMessages: ChatCompletionAssistantMessageParam[] = thoughtsAfterCurr.map(([id, body]) => {
      return { role: "assistant", content: body };
    });
    const messages = [sysMessage, ...assistantMessages];
    console.log("messages: ", messages);
    gpt4TurboChat({
      messages: messages,
      stream: true,
      onDelta: (delta) => {
        if (delta) {
          insertTextAtCursor(delta);
        }
      },
    })
  }

  return (
    <div className="App">
      <div style={{ width: "100%", border: "solid 1px black" }} ref={editorRef}></div>
      <button onClick={generateThoughtUsingGPT4}>Generate</button>
    </div>
  );
}

export default App;
