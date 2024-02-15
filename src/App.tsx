import React, { useEffect, useRef, useState } from "react";
import { Schema, DOMParser, NodeSpec, MarkSpec } from "prosemirror-model";
import { EditorState, Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

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
  const editorRef = useRef();
  const [editorView, setEditorView] = useState(null);

  useEffect(() => {
    const schema = new Schema({
      nodes: {
        doc: { content: "block+" },
        paragraph: {
          content: "text*",
          group: "block",
          toDOM: () => ["p", 0],
        },
        text: {
          group: "inline",
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
    const initialContent = schema.nodes.doc.create({}, schema.nodes.paragraph.create({}, schema.text("Hi")));

    const state = EditorState.create({
      doc: initialContent,
      schema,
      plugins: [removeHighlightOnInputPlugin],
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
