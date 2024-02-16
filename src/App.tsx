import React, { useEffect, useRef, useState } from "react";
import { Schema, DOMParser, NodeSpec, MarkSpec } from "prosemirror-model";
import { EditorState, Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import supabase from "./supabase";
import { keymap } from "prosemirror-keymap";
import { v4 as uuidv4 } from "uuid";
import { Plugin } from "prosemirror-state";


const removeHighlightOnInputPlugin = new Plugin({
  appendTransaction(transactions, oldState, newState) {
    let newTransaction: Transaction | null = null;
    transactions.forEach((tr) => {
      console.log("Inside appendTransaction, handling tr");
      if (tr.docChanged) {
        // Loop through each step in the transaction
        tr.steps.forEach((step) => {
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
    if (newTransaction !== null) {
      console.log("returning newTransactions: ", newTransaction);
      return newTransaction;
    }
    console.log("returning null");
    return null;
  },
});

const MyEditor = () => {
  const editorRef = useRef<HTMLElement>();
  const [editorView, setEditorView] = useState<EditorView | null>(null);

  const enterKeyPlugin = keymap({
    "Enter": (state, dispatch) => {
      // Prevent the default Enter key behavior
      const { tr } = state;
      if (dispatch) {
        const thoughtNode = state.schema.nodes.thought.create({id: uuidv4()});
        
        // Insert a new thought node after the current selection
        const insertPos = tr.selection.$from.end(0); // Adjust this as needed
        dispatch(tr.insert(insertPos, thoughtNode).scrollIntoView());
        
        // Add a new thought to the Supabase database
        addNewThoughtToDatabase(thoughtNode.attrs.id, "", "gimli");

        return true; // Indicate that the key event was handled
      }
      return false;
    }
  });

  async function addNewThoughtToDatabase(id: string, body: string, agentName: string) {
    // compute next index as 1.0 + max(index) in thoughts table
    const { data: maxIndexData, error: maxIndexError } = await supabase
      .from("thoughts")
      .select("index")
      .order("index", { ascending: false })
      .limit(1);
    if (maxIndexError) {
      console.error("Error fetching max(index)", maxIndexError);
      throw maxIndexError;
    }
    if (typeof maxIndexData[0].index !== "number") {
      throw new Error("maxIndexData[0] is not a number");
    }
    const maxIndex = maxIndexData ? maxIndexData[0].index + 1.0: 0.0;
    console.log("maxIndex: ", maxIndex)
    const { data, error } = await supabase
      .from("thoughts")
      .insert([
        { id: id, index: maxIndex, body: body, agent_name: agentName}
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
      plugins: [removeHighlightOnInputPlugin, enterKeyPlugin],
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

  const insertRandomText = () => {
    if (editorView) {
      const text = "Random " + Math.random().toString(36).substring(2);
      const { tr } = editorView.state;
      const highlightMark = editorView.state.schema.marks.highlight.create();
      if (!tr.selection.empty) tr.deleteSelection();
      const position = tr.selection.from; // Insert position
      const textNode = editorView.state.schema.text(text, [highlightMark]);
      tr.insert(position, textNode);
      editorView.dispatch(tr);
    }
  };

  return (
    <div>
      <button onClick={insertRandomText}>Insert Random Text</button>
      <div style={{ width: "100%", border: "solid 1px black" }} ref={editorRef}></div>
    </div>
  );
};

function App() {
  return (
    <div className="App">
      <MyEditor />
    </div>
  );
}

export default App;
