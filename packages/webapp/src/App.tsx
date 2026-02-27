import { useEffect, useState, useRef, useMemo } from "react";
import "./App-compiled.css";
import { Schema, Mark, Node as ProseMirrorNode, Fragment, Slice } from "prosemirror-model";
import { EditorState, Transaction, Selection as ProsemirrorSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { joinTextblockBackward } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { Plugin, TextSelection } from "prosemirror-state";
import { undo, redo, history } from "prosemirror-history";
import supabase from "./supabase";
import { v4 as uuidv4 } from "uuid";
import { getModels, generateThought as apiGenerateThought, startLoop, stopLoop, getLoopStatus, getAgentStatus, getAgentActivity } from "./thought_streamer";
import { throttle } from "lodash";
import { Database } from "./database.types";
import "prosemirror-view/style/prosemirror.css";
import { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

const THOUGHTS_TABLE_NAME = "thoughts";
const APP_INSTANCE_ID = uuidv4(); // used to keep subscriptions from handling their own updates

const models: string[] = await getModels();

type Thought = Database["public"]["Tables"]["thoughts"]["Row"];

const humanHighlightOnInputPlugin = new Plugin({
  appendTransaction(transactions, oldState, newState) {
    let newTransaction: Transaction | null = null;
    let markAdded = false;
    transactions.forEach((tr) => {
      if (tr.docChanged) {
        tr.steps.forEach((step) => {
          if (step.toJSON().stepType === "addMark") {
            markAdded = true;
          }
          const stepMap = step.getMap();
          if (stepMap) {
            // When the user types into agent-highlighted text, swap to human highlight
            let swapToHuman = false;
            stepMap.forEach((oldStart, oldEnd, newStart, newEnd) => {
              const hasAgentHighlight = newState.doc.rangeHasMark(newStart, newEnd, newState.schema.marks.highlight);
              if (hasAgentHighlight) {
                swapToHuman = true;
              }
            });

            if (swapToHuman) {
              const { from, to } = tr.selection;
              const start = Math.max(from - 1, 0);
              if (newTransaction === null) {
                newTransaction = newState.tr;
              }
              // Remove agent highlight, add human highlight on the typed text
              newTransaction.removeMark(start, to, newState.schema.marks.highlight);
              newTransaction.addMark(start, to, newState.schema.marks.human_highlight.create());
            }
          }
        });
      }
    });

    if (newTransaction !== null && !markAdded) {
      return newTransaction;
    }
    return null;
  },
});

function breakTextAndPushToContent(text: string, content: ProseMirrorNode[], schema: Schema, marks?: Mark[]): ProseMirrorNode[] {
  // console.log("breakTextAndPushToContent handling text: ", text, " with marks: ", marks)
  const brokenText = text.split("\n");
  brokenText.forEach((line, index) => {
    if (index > 0) {
      content.push(schema.node("soft_break"));
    }
    if (line !== "") {
      if (marks === undefined) {
        content.push(schema.text(line));
      } else {
        content.push(schema.text(line, marks));
      }
    }
  })
  return content;
}

function App() {
  const editorRef = useRef<HTMLElement>();
  const editorViewRef = useRef<EditorView | null>(null);
  const [selectedAgentName, setSelectedAgentName] = useState<string>(
    () => localStorage.getItem("headlong_selected_agent") || "bilbo bossy baggins"
  );
  const [agentNames, setAgentNames] = useState<string[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [loading, setLoading] = useState(true);
  const [modelSelection, setModelSelection] = useState(
    () => localStorage.getItem("headlong_selected_model") || models[0]
  );
  const [modelTemperature, setModelTemperature] = useState(0.5);
  const [envStatus, setEnvStatus] = useState("detached");
  const [envPaneOpen, setEnvPaneOpen] = useState(false);
  const [envTools, setEnvTools] = useState<{name: string; description: string}[]>([]);
  const [envActivity, setEnvActivity] = useState<{ts: string; message: string}[]>([]);
  const [envAgentName, setEnvAgentName] = useState("");
  const [envUptime, setEnvUptime] = useState(0);
  const activityEndRef = useRef<HTMLDivElement>(null);
  const agentActivityEndRef = useRef<HTMLDivElement>(null);
  const [thoughtIdsToUpdate, setThoughtIdsToUpdate] = useState<Set<string>>(new Set());
  const [generatingLoopOn, setGeneratingLoopOn] = useState(false);
  const [agentStatus, setAgentStatus] = useState("detached");
  const [agentPaneOpen, setAgentPaneOpen] = useState(false);
  const [agentActivity, setAgentActivity] = useState<{ts: string; message: string}[]>([]);
  const [agentInfo, setAgentInfo] = useState<{agent_name: string; system_prompt: string; model: string; uptime_seconds: number} | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [agentSystemPrompt, setAgentSystemPrompt] = useState("");
  const [envSystemPrompt, setEnvSystemPrompt] = useState("");
  const [agentPromptHistory, setAgentPromptHistory] = useState<{id: string; system_prompt: string; created_at: string}[]>([]);
  const [envPromptHistory, setEnvPromptHistory] = useState<{id: string; system_prompt: string; created_at: string}[]>([]);
  const lastAgentPromptSaveRef = useRef<number>(0);
  const lastEnvPromptSaveRef = useRef<number>(0);
  const generateThoughtRef = useRef<() => void>(() => {});
  const [agentCollapsed, setAgentCollapsed] = useState<Record<string, boolean>>({});
  const [envCollapsed, setEnvCollapsed] = useState<Record<string, boolean>>({});
  const [actionStatus, setActionStatus] = useState<{
    status: "sent" | "processing" | "complete";
    action: string;
  } | null>(null);
  const actionStatusTimerRef = useRef<number | null>(null);

  function computeNewThoughtIndex(state: EditorState, appendToEnd?: boolean) {
    let newThought = null;

    state.doc.descendants((node, pos) => {
      // Iterate through the document to find the last 'thought' node with
      // id newThoughtId, and store its position and node object
      if (node.type.name === "thought") {
        newThought = node;
      }
    });
    const currentThoughtIndex: number = appendToEnd ? (
      // get the last thought id
      newThought.attrs.index
    ) : (
      // get the current thought id
      state.selection.$head.parent.attrs.index
    );
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

  function insertSoftBreak(state: EditorState, dispatch) {
    const softBreak = state.schema.nodes.soft_break.create();
    dispatch(state.tr.replaceSelectionWith(softBreak).scrollIntoView());
    return true;
  }

  const shiftEnterKeyPlugin = keymap({
    'Shift-Enter': (state, dispatch) => {
      return insertSoftBreak(state, dispatch);
    }
  });

  const enterKeyPlugin = keymap({
    Enter: (state, dispatch) => {
      if (dispatch && state.selection.empty) {
        const newThoughtIndex = computeNewThoughtIndex(state);
        let { tr } = state;
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

  function dispatchAction(state: EditorState, dispatch) {
    if (dispatch) {
      const currentThoughtPos = state.selection.$head.before();
      const node = state.doc.nodeAt(currentThoughtPos);

      if (node && node.type.name === "thought") {
        const metadataAttr = { ...node.attrs.metadata, needs_handling: true };
        const transaction = state.tr.setNodeAttribute(currentThoughtPos, "metadata", metadataAttr);
        dispatch(transaction);

        const text = node.textContent.trim();
        setActionStatus({ status: "sent", action: text.slice(0, 50) });
        if (actionStatusTimerRef.current) clearTimeout(actionStatusTimerRef.current);
        actionStatusTimerRef.current = window.setTimeout(() => {
          setActionStatus(prev => prev ? { ...prev, status: "processing" } : null);
        }, 1500);

        return true;
      }
    }

    return false;
  }

  const altEnterKeyPlugin = keymap({
    "Alt-Enter": dispatchAction,
    "Shift-Alt-Enter": dispatchAction,
  });

  const modEnterKeyPlugin = keymap({
    "Mod-Enter": () => {
      generateThoughtRef.current();
      return true;
    },
  });

  const backspaceKeyPlugin = keymap({
    Backspace: (state, dispatch) => {
      let retVal = false;
      const { from, to } = state.selection;

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
          retVal = true;
        }
      } else {
        // Here you can handle the deletion of thoughts by their IDs.
        // For example, mark them for deletion in the database, update state, etc.
 
        if (dispatch) {
          // Create and dispatch a transaction that deletes the selected range.
          const deleteTransaction = state.tr.delete(from, to);
          dispatch(deleteTransaction);
        }
        
        // Return true to indicate that the backspace handler has done something,
        // preventing the default backspace behavior.
        retVal = true;
      }
      if (thoughtIdsInSelection.size === 0 || retVal === false) {
        return false;
      }
      setThoughtIdsToUpdate((prev) => {
        thoughtIdsInSelection.forEach(id => prev.add(id));
        return new Set(prev);
      });
      return true;
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

  function pushToDB(idsToUpdate: Set<string>) {
    console.log("pushToDB called with idsToUpdate: ", idsToUpdate);

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
        // join the text nodes of the thought with the soft_break nodes
        // turning the soft_break nodes into newlines
        const thoughtTextContent = (foundNode as ProseMirrorNode).content.content
        const thoughtText = thoughtTextContent.reduce((acc, node) => {
          if (node.type.name === "text") {
            return acc + node.text;
          } else if (node.type.name === "soft_break") {
            return acc + "\n";
          }
        }, "")

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

        console.debug(`Attempting to update thought ${id} in database.`);
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
          console.debug(`Inserting new thought ${id} into database.`);
          const { data, error } = await supabase.from(THOUGHTS_TABLE_NAME).insert([
            {
              id: id,
              index: foundNode.attrs.index,
              body: thoughtText,
              agent_name: selectedAgentName,
              metadata: {
                ...foundNode.attrs.metadata,
                last_updated_by: APP_INSTANCE_ID,
                marks,
              },
            },
          ]);
          if (error) {
            console.error("Error inserting new thought into database", error);
          } else {
            console.debug(`Thought ${id} inserted successfully.`);
          }
        } else {
          console.debug(`Thought ${id} updated successfully.`);
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

  // Poll env status via HTTP (more reliable than presence WebSocket)
  useEffect(() => {
    const checkEnv = async () => {
      try {
        const res = await fetch("http://localhost:8000/env/status");
        if (res.ok) {
          setEnvStatus("attached");
          const data = await res.json();
          setEnvTools(data.tools);
          setEnvAgentName(data.agent_name);
          setEnvUptime(data.uptime_seconds);
        } else {
          setEnvStatus("detached");
        }
      } catch (_) {
        setEnvStatus("detached");
      }
    };
    checkEnv();
    const interval = setInterval(checkEnv, 3000);
    return () => clearInterval(interval);
  }, []);

  // Poll agent status via HTTP (more reliable than presence WebSocket)
  useEffect(() => {
    const checkAgent = async () => {
      try {
        const [statusData, loopData] = await Promise.all([
          getAgentStatus(),
          getLoopStatus(),
        ]);
        setAgentStatus("attached");
        setAgentInfo(statusData);
        setGeneratingLoopOn(loopData.running);
      } catch (_) {
        setAgentStatus("detached");
      }
    };
    checkAgent();
    const interval = setInterval(checkAgent, 3000);
    return () => clearInterval(interval);
  }, []);

  // Poll agent activity when pane is open
  useEffect(() => {
    if (!agentPaneOpen) return;
    const fetchActivity = async () => {
      try {
        const data = await getAgentActivity();
        setAgentActivity(data);
      } catch (_) { /* agent not reachable */ }
    };
    fetchActivity();
    const interval = setInterval(fetchActivity, 2000);
    return () => clearInterval(interval);
  }, [agentPaneOpen]);

  // Auto-scroll agent activity log
  useEffect(() => {
    agentActivityEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [agentActivity]);

  // Poll env activity when pane is open
  useEffect(() => {
    if (!envPaneOpen) return;
    const fetchActivity = async () => {
      try {
        const res = await fetch("http://localhost:8000/env/activity");
        if (res.ok) {
          const data = await res.json();
          setEnvActivity(data);
        }
      } catch (_) { /* env not reachable */ }
    };
    fetchActivity();
    const interval = setInterval(fetchActivity, 2000);
    return () => clearInterval(interval);
  }, [envPaneOpen]);

  // Auto-scroll activity log
  useEffect(() => {
    activityEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [envActivity]);

  // Load agent system prompt from Supabase
  useEffect(() => {
    const loadAgentPrompt = async () => {
      const { data } = await supabase.from("agents").select("system_prompt").eq("name", selectedAgentName).single();
      if (data?.system_prompt != null) setAgentSystemPrompt(data.system_prompt);
    };
    const loadHistory = async () => {
      const { data } = await supabase
        .from("system_prompt_history")
        .select("id, system_prompt, created_at")
        .eq("source_table", "agents")
        .eq("source_name", selectedAgentName)
        .order("created_at", { ascending: false })
        .limit(20);
      if (data) setAgentPromptHistory(data);
    };
    loadAgentPrompt();
    loadHistory();
  }, [selectedAgentName]);

  // Load env system prompt from Supabase
  useEffect(() => {
    const loadEnvPrompt = async () => {
      const { data } = await supabase.from("environments").select("system_prompt").eq("name", selectedAgentName).single();
      if (data?.system_prompt != null) setEnvSystemPrompt(data.system_prompt);
    };
    const loadHistory = async () => {
      const { data } = await supabase
        .from("system_prompt_history")
        .select("id, system_prompt, created_at")
        .eq("source_table", "environments")
        .eq("source_name", selectedAgentName)
        .order("created_at", { ascending: false })
        .limit(20);
      if (data) setEnvPromptHistory(data);
    };
    loadEnvPrompt();
    loadHistory();
  }, [selectedAgentName]);

  // Save agent system prompt (debounced) and checkpoint history (max 1/min)
  const saveAgentPrompt = useMemo(() => throttle(async (prompt: string) => {
    await supabase.from("agents").update({ system_prompt: prompt }).eq("name", selectedAgentName);
    const now = Date.now();
    if (now - lastAgentPromptSaveRef.current >= 60000) {
      lastAgentPromptSaveRef.current = now;
      await supabase.from("system_prompt_history").insert({
        source_table: "agents",
        source_name: selectedAgentName,
        system_prompt: prompt,
      });
      // Refresh history
      const { data } = await supabase
        .from("system_prompt_history")
        .select("id, system_prompt, created_at")
        .eq("source_table", "agents")
        .eq("source_name", selectedAgentName)
        .order("created_at", { ascending: false })
        .limit(20);
      if (data) setAgentPromptHistory(data);
    }
  }, 1000), [selectedAgentName]);

  // Save env system prompt (debounced) and checkpoint history (max 1/min)
  const saveEnvPrompt = useMemo(() => throttle(async (prompt: string) => {
    await supabase.from("environments").update({ system_prompt: prompt }).eq("name", selectedAgentName);
    const now = Date.now();
    if (now - lastEnvPromptSaveRef.current >= 60000) {
      lastEnvPromptSaveRef.current = now;
      await supabase.from("system_prompt_history").insert({
        source_table: "environments",
        source_name: selectedAgentName,
        system_prompt: prompt,
      });
      const { data } = await supabase
        .from("system_prompt_history")
        .select("id, system_prompt, created_at")
        .eq("source_table", "environments")
        .eq("source_name", selectedAgentName)
        .order("created_at", { ascending: false })
        .limit(20);
      if (data) setEnvPromptHistory(data);
    }
  }, 1000), [selectedAgentName]);

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
        // Skip if this thought is already in the editor (e.g. we just generated it)
        let alreadyExists = false;
        state.doc.descendants((node) => {
          if (node.type.name === "thought" && node.attrs.id === newThought.id) {
            alreadyExists = true;
            return false;
          }
        });
        if (alreadyExists) return;

        // Insert the new thought into the editor
        // Determine where to insert the new thought based on its index
        const insertPos = findInsertPosition(state.doc, newThought.index);
        // parse the newThought.body into text nodes separated by soft_break nodes
        // wherever there were \n characters in the body
        // Choose mark based on content: observations get amber, agent thoughts get purple
        const isObservation = newThought.body.trim().toLowerCase().startsWith("observation:");
        const highlightMark = isObservation
          ? state.schema.marks.observation_highlight.create()
          : state.schema.marks.highlight.create();
        const thoughtNode = state.schema.nodes.thought.createAndFill(
          {
            id: newThought.id,
            index: newThought.index,
          },
          newThought.body.split("\n").reduce((acc, text, index, array) => {
            if (text !== "") {
              acc.push(state.schema.text(text).mark([highlightMark]));
            }
            if (index < array.length - 1) {
              acc.push(state.schema.nodes.soft_break.create());
            }
            return acc;
          }, [])
        );

        if (thoughtNode) {
          tr.insert(insertPos, thoughtNode).scrollIntoView();

          // Persist the highlight marks to the database so other clients see them on load
          const markType = isObservation ? "observation_highlight" : "highlight";
          const serializedMarks = newThought.body.split("\n").reduce((acc, text, index, array) => {
            if (text !== "") {
              acc.push([text.length, [{ type: markType }]]);
            }
            if (index < array.length - 1) {
              acc.push([1, null]); // soft_break
            }
            return acc;
          }, [] as any[]);
          if (!newThought.metadata?.marks) {
            supabase
              .from(THOUGHTS_TABLE_NAME)
              .update({
                metadata: {
                  ...newThought.metadata,
                  last_updated_by: APP_INSTANCE_ID,
                  marks: serializedMarks,
                },
              })
              .eq("id", newThought.id)
              .then(({ error }) => {
                if (error) console.error("Error persisting marks for new thought:", error);
              });
          }
        }

        if (isObservation) {
          setActionStatus(prev => {
            if (prev) {
              if (actionStatusTimerRef.current) clearTimeout(actionStatusTimerRef.current);
              actionStatusTimerRef.current = window.setTimeout(() => {
                setActionStatus(null);
              }, 2500);
              return { ...prev, status: "complete" };
            }
            return null;
          });
        }
      } else if (eventType === "UPDATE") {
        // Update the thought in the editor by replacing the node with updated content
        let cursor = 0; // A cursor to track our position as we apply marks
        state.doc.descendants((node, pos) => {
          if (node.type.name === "thought" && node.attrs.id === oldThought.id) {
            // marks is an array of [length, markJSON] where markJSON is the serialized mark
            // of length length or null if there are no marks for that range.
            // create an array of text elements, each with the appropriate marks
            let nodes: ProseMirrorNode[] = [];
            if (newThought.metadata?.marks) {
              nodes = newThought.metadata.marks.reduce((acc, [length, markDefs]) => {
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
                  breakTextAndPushToContent(text, acc, state.schema, marks);
                } else {
                  breakTextAndPushToContent(text, acc, state.schema);
                }
                cursor += length; // Move the cursor forward
                return acc;
              }, [])
              // Handle any remaining text without marks
              if (cursor < newThought.body.length) {
                breakTextAndPushToContent(newThought.body.substring(cursor), nodes, state.schema);
              }
            } else {
              nodes = breakTextAndPushToContent(newThought.body, [], state.schema)
            }
            const updatedThoughtNode = state.schema.nodes.thought.createAndFill(
              {
                id: newThought.id,
                index: newThought.index,
                metadata: newThought.metadata,
              },
              nodes
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
        // updateState doesn't trigger scrollIntoView, so scroll manually
        const scrollParent = editorViewRef.current.dom.parentElement?.parentElement;
        if (scrollParent) {
          scrollParent.scrollTo({ top: scrollParent.scrollHeight, behavior: "smooth" });
        }
      }
    };

    // Subscribe to the thoughts table
    const subscription = supabase
      .channel("thought_table_updates")
      .on<Thought>("postgres_changes", { event: "*", schema: "public", table: THOUGHTS_TABLE_NAME }, (payload) => {
        console.debug("Change received!", payload);
        // call updateEditorFromSupabase with the payload if payload.new.agent_name === selectedAgentName
        if ("agent_name" in payload.new && payload.new.agent_name === selectedAgentName) {
          if (payload.new.metadata?.last_updated_by !== APP_INSTANCE_ID) {
            updateEditorFromSupabase(payload);
          }
        }
      })
      .subscribe();
    console.debug("subscribed to thought updates for agent: ", selectedAgentName);

    // Cleanup subscription on component unmount
    return () => {
      console.debug(`selectedAgentName changed: unsubscribing from updates about agent $Agent: {selectedAgentName}`);
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
    const fetchAgents = async () => {
      setLoadingAgents(true);

      // Warning: 'distinct' doesn't work via the SDK, workaround with postgres function
      const { data, error } = await supabase.rpc('get_agent_names')

      if (error) {
        console.error("Error fetching agent names:", error);
        setLoadingAgents(false);
      } else {
        setAgentNames(data || []);
        setLoadingAgents(false);
      }
    };

    fetchAgents();
  }, []);

  useEffect(() => {
    if (!editorRef.current || loading) return; // Wait until thoughts are loaded

    const schema = new Schema({
      nodes: {
        doc: { content: "thought+" },
        thought: {
          attrs: { id: { default: uuidv4() }, index: { default: 0 }, metadata: { default: null } },
          content: "inline*",
          toDOM: () => ["p", { style: "border-bottom: thin #393939 solid" }, 0],
        },
        text: {group: "inline"},
        soft_break: {
          inline: true,
          group: "inline",
          selectable: false,
          parseDOM: [{tag: "br"}],
          toDOM() { return ["br"]; },
        },
      },
      marks: {
        highlight: {
          toDOM: () => ["span", { style: "background-color: rgba(128, 0, 255, 0.25);" }, 0],
          parseDOM: [{ tag: "span", style: "background-color: rgba(128, 0, 255, 0.25);" }],
        },
        human_highlight: {
          toDOM: () => ["span", { style: "background-color: rgba(0, 180, 216, 0.2);" }, 0],
          parseDOM: [{ tag: "span", style: "background-color: rgba(0, 180, 216, 0.2);" }],
        },
        observation_highlight: {
          toDOM: () => ["span", { style: "background-color: rgba(255, 170, 0, 0.2);" }, 0],
          parseDOM: [{ tag: "span", style: "background-color: rgba(255, 170, 0, 0.2);" }],
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
        let content: ProseMirrorNode[] = [];
        let cursor = 0; // A cursor to track our position as we apply marks

        if (thoughtAttrs.metadata && thoughtAttrs.metadata.marks) {
          thoughtAttrs.metadata.marks.forEach(([length, markDefs]) => {
            const text = thought.body.substring(cursor, cursor + length);
            let marks: Mark[] = [];

            if (markDefs !== null) {
              markDefs.forEach((markDef) => {
                if (markDef.type) {
                  const markType = schema.marks[markDef.type];
                  if (markType) {
                    marks.push(markType.create(markDef.attrs));
                  }
                }
              });

              breakTextAndPushToContent(text, content, schema, marks);
            } else {
              breakTextAndPushToContent(text, content, schema);
            }
            cursor += length; // Move the cursor forward
          });

          // Handle any remaining text without marks
          if (cursor < thought.body.length) {
            breakTextAndPushToContent(thought.body.substring(cursor), content, schema);
          }
        } else {
          // No marks in metadata — infer highlight from content
          const isObservation = thought.body.trim().toLowerCase().startsWith("observation:");
          const isHuman = thought.body.trim().toLowerCase().startsWith("action:");
          const markType = isHuman
            ? schema.marks.human_highlight
            : isObservation
              ? schema.marks.observation_highlight
              : schema.marks.highlight;
          const mark = markType.create();
          let c: ProseMirrorNode[] = [];
          breakTextAndPushToContent(thought.body, c, schema, [mark]);
          content = c;
        }

        return schema.nodes.thought.create(thoughtAttrs, content);
      } else {
        return schema.nodes.thought.create(thoughtAttrs);
      }
    });
    const initialContent = schema.nodes.doc.create({}, initialDocContent);

    // Plugin to ensure human_highlight is always the active stored mark for user typing
    const humanHighlightDefaultPlugin = new Plugin({
      appendTransaction(_transactions, _oldState, newState) {
        const humanMark = newState.schema.marks.human_highlight;
        const storedMarks = newState.storedMarks || newState.selection.$from.marks();
        const hasHumanMark = storedMarks.some((m: Mark) => m.type === humanMark);
        if (!hasHumanMark) {
          return newState.tr.setStoredMarks([humanMark.create()]);
        }
        return null;
      },
    });

    let state = EditorState.create({
      doc: initialContent,
      schema,
      plugins: [
        humanHighlightOnInputPlugin,
        humanHighlightDefaultPlugin,
        shiftEnterKeyPlugin,
        enterKeyPlugin,
        altEnterKeyPlugin,
        modEnterKeyPlugin,
        backspaceKeyPlugin,
        modAKeyplugin,
        history(),
        keymap({ "Mod-z": undo, "Mod-y": redo, "Mod-Shift-z": redo }),
      ],
    });

    const view = new EditorView(editorRef.current, {
      state,
      transformPasted(slice) {
        const humanMark = schema.marks.human_highlight.create();
        const addMark = (fragment: Fragment): Fragment => {
          const nodes: ProseMirrorNode[] = [];
          fragment.forEach((node) => {
            if (node.isText) {
              nodes.push(node.mark([humanMark]));
            } else {
              nodes.push(node.copy(addMark(node.content)));
            }
          });
          return Fragment.from(nodes);
        };
        return new Slice(addMark(slice.content), slice.openStart, slice.openEnd);
      },
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
        } 
        editorViewRef.current.updateState(newState);
      },
    });

    const selection = ProsemirrorSelection.atEnd(view.state.doc);
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

  const generateThought = async () => {
    if (!editorViewRef.current || isGenerating) return;
    setIsGenerating(true);

    try {
      // Generate thought via RLM — server saves to DB and returns JSON
      const result = await apiGenerateThought({
        model: modelSelection,
        temperature: modelTemperature,
        agent_name: selectedAgentName,
      });

      // Insert the completed thought into the editor using the server's DB id.
      // We insert plain text first, then explicitly addMark — this prevents
      // humanHighlightOnInputPlugin from stripping the highlight.
      const schema = editorViewRef.current.state.schema;
      const textNode = schema.text(result.body);
      const newThoughtNode = schema.nodes.thought.create(
        { id: result.id, index: result.index, metadata: {} },
        textNode,
      );

      let tr = editorViewRef.current.state.tr;
      const insertPos = tr.doc.content.size;
      tr = tr.insert(insertPos, newThoughtNode);

      // Add highlight mark to the inserted text range (inside the thought node)
      const textStart = insertPos + 1; // +1 to skip into the thought node
      const textEnd = textStart + result.body.length;
      tr = tr.addMark(textStart, textEnd, schema.marks.highlight.create());

      tr = tr.setSelection(TextSelection.create(tr.doc, insertPos)).scrollIntoView();
      editorViewRef.current.dispatch(tr);
    } catch (e) {
      console.error("Error generating thought:", e);
    }

    setIsGenerating(false);
  };
  generateThoughtRef.current = generateThought;

  return (
    <div className="App flex flex-col h-screen max-h-screen">
      <div className="w-screen flex bg-gray-100 border-b border-gray-200">
        <svg xmlns="http://www.w3.org/2000/svg" width="61" height="49.5" viewBox="0 0 61 49.5" className="flex-none">
          <rect x="8" y="8" width="9" height="34.5" style={{ fill: "#b87df9" }} />
          <rect x="23" y="8" width="9" height="34.5" style={{ fill: "#b87df9" }} />
          <rect x="36.5" y="33.5" width="11.5" height="9" style={{ fill: "#b87df9" }} />
        </svg>
        <div className="flex-grow flex justify-end space-x-1">
          <button
            className="flex items-center space-x-2 p-2 rounded-md cursor-pointer hover:bg-gray-200"
            onClick={() => setAgentPaneOpen(prev => !prev)}
          >
            {agentStatus === "attached" ? (
              <>
                <span className="text-sm text-green-500">Agent: {selectedAgentName}</span>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-500" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-10.293a1 1 0 00-1.414-1.414L9 9.586 7.707 8.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              </>
            ) : (
              <>
                <span className="text-sm text-red-500">Agent: {selectedAgentName}</span>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20">
                  <circle cx="10" cy="10" r="9" stroke="#ef4444" fill="none" strokeWidth="2" />
                  <path stroke="#ef4444" strokeLinecap="round" strokeWidth="2" d="M6 6l8 8m0 -8l-8 8" />
                </svg>
              </>
            )}
          </button>
          <button
            className="flex items-center space-x-2 p-2 rounded-md cursor-pointer hover:bg-gray-200"
            onClick={() => setEnvPaneOpen(prev => !prev)}
          >
            {envStatus === "attached" ? (
              <>
                <span className="text-sm text-green-500">Environment</span>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-500" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-10.293a1 1 0 00-1.414-1.414L9 9.586 7.707 8.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              </>
            ) : (
              <>
                <span className="text-sm text-red-500">Environment</span>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20">
                  <circle cx="10" cy="10" r="9" stroke="#ef4444" fill="none" strokeWidth="2" />
                  <path stroke="#ef4444" strokeLinecap="round" strokeWidth="2" d="M6 6l8 8m0 -8l-8 8" />
                </svg>
              </>
            )}
          </button>
        </div>
      </div>
      <div className="flex-grow min-h-0 flex border border-solid border-[#e3ccfc]">
        <div className={(envPaneOpen || agentPaneOpen) ? "flex-1 min-w-0 overflow-y-auto" : "w-full overflow-y-auto"}>
          <div ref={editorRef} className="w-full h-full p-1"></div>
        </div>
        {agentPaneOpen && (
          <div className="w-1/2 border-l border-gray-200 flex flex-col overflow-hidden bg-gray-50">
            <div className="flex items-center justify-between p-3 border-b border-gray-200">
              <div className="flex items-center space-x-2">
                <span className={`inline-block rounded-full ${agentStatus === "attached" ? "bg-green-500" : "bg-red-500"}`} style={{width: "6px", height: "6px"}}></span>
                <span style={{fontSize: "16px", fontWeight: "bold"}}>Agent</span>
                {agentInfo?.agent_name && <span className="text-xs text-gray-400">{agentInfo.agent_name}</span>}
                {agentInfo && <span className="text-xs text-gray-500">uptime: {Math.floor(agentInfo.uptime_seconds / 60)}m {agentInfo.uptime_seconds % 60}s</span>}
              </div>
              <div className="flex items-center space-x-2">
                <button className="text-gray-400 hover:text-gray-700" onClick={() => setAgentPaneOpen(false)}>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="overflow-y-auto flex-1">
              {/* Config */}
              <div className="border-b border-gray-200">
                <button className="w-full flex items-center justify-between p-3 hover:bg-gray-200" onClick={() => setAgentCollapsed(p => ({...p, config: !p.config}))}>
                  <span className="text-sm font-bold">Config</span>
                  <svg xmlns="http://www.w3.org/2000/svg" className="text-gray-400" style={{width: "12px", height: "12px", flexShrink: 0, transform: agentCollapsed.config ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 0.15s"}} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                </button>
                {!agentCollapsed.config && (
                  <div className="px-3 pb-3 space-y-2">
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Agent</label>
                      <select className="bg-white border border-gray-300 px-2 py-1 text-sm w-full" value={selectedAgentName} onChange={(e) => { setSelectedAgentName(e.target.value); localStorage.setItem("headlong_selected_agent", e.target.value); }}>
                        {agentNames.map((name) => (<option key={name} value={name}>{name}</option>))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Model</label>
                      <select className="bg-white border border-gray-300 px-2 py-1 text-sm w-full" value={modelSelection} onChange={(e) => { setModelSelection(e.target.value); localStorage.setItem("headlong_selected_model", e.target.value); }}>
                        {models.map((key) => (<option key={key} value={key}>{key}</option>))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Temperature</label>
                      <input type="number" step="0.1" max="1.0" min="0.0" value={modelTemperature} onChange={(e) => setModelTemperature(parseFloat(e.target.value))} className="bg-white border border-gray-300 px-2 py-1 text-sm w-20" />
                    </div>
                  </div>
                )}
              </div>
              {/* System Prompt */}
              <div className="border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <button className="flex-1 flex items-center justify-between p-3 hover:bg-gray-200" onClick={() => setAgentCollapsed(p => ({...p, prompt: !p.prompt}))}>
                    <span className="text-sm font-bold">System Prompt</span>
                    <svg xmlns="http://www.w3.org/2000/svg" className="text-gray-400" style={{width: "12px", height: "12px", flexShrink: 0, transform: agentCollapsed.prompt ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 0.15s"}} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                  </button>
                </div>
                {!agentCollapsed.prompt && (
                  <div className="px-3 pb-3">
                    <textarea
                      className="w-full bg-white border border-gray-300 text-xs text-gray-700 p-2 rounded resize-y min-h-[120px] max-h-[400px]"
                      rows={8}
                      value={agentSystemPrompt}
                      onChange={(e) => { setAgentSystemPrompt(e.target.value); saveAgentPrompt(e.target.value); }}
                    />
                    <div className="flex items-center justify-between mt-1">
                      {agentPromptHistory.length > 0 && (
                        <select className="bg-white border border-gray-300 px-1 py-0.5 text-xs flex-1" value="" onChange={(e) => { const entry = agentPromptHistory.find(h => h.id === e.target.value); if (entry) { setAgentSystemPrompt(entry.system_prompt); saveAgentPrompt(entry.system_prompt); } }}>
                          <option value="" disabled>Restore from history...</option>
                          {agentPromptHistory.map((h) => (<option key={h.id} value={h.id}>{new Date(h.created_at).toLocaleString()} - {h.system_prompt.slice(0, 40)}...</option>))}
                        </select>
                      )}
                      <a
                        href={`https://supabase.com/dashboard/project/qimpbjvnthrvwsalpgsy/editor?schema=public&table=system_prompt_history&filter=source_table%3Aeq%3Aagents%2Csource_name%3Aeq%3A${encodeURIComponent(selectedAgentName)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center space-x-1 text-xs text-[#b87df9] hover:underline ml-2 flex-none"
                      >
                        <span>History</span>
                        <svg xmlns="http://www.w3.org/2000/svg" style={{width: "10px", height: "10px"}} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    </div>
                  </div>
                )}
              </div>
              {/* Activity */}
              <div className="border-b border-gray-200 flex-1 flex flex-col min-h-0">
                <button className="w-full flex items-center justify-between p-3 hover:bg-gray-200" onClick={() => setAgentCollapsed(p => ({...p, activity: !p.activity}))}>
                  <span className="text-sm font-bold">Activity</span>
                  <svg xmlns="http://www.w3.org/2000/svg" className="text-gray-400" style={{width: "12px", height: "12px", flexShrink: 0, transform: agentCollapsed.activity ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 0.15s"}} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                </button>
                {!agentCollapsed.activity && (
                  <div className="px-3 pb-3 overflow-y-auto text-xs space-y-1" style={{maxHeight: "300px"}}>
                    {agentActivity.map((entry, i) => (
                      <div key={i} className="flex">
                        <span className="text-gray-500 flex-none w-20">{new Date(entry.ts).toLocaleTimeString()}</span>
                        <span className="text-gray-600 ml-2">{entry.message}</span>
                      </div>
                    ))}
                    {agentActivity.length === 0 && <div className="text-gray-500">No activity yet</div>}
                    <div ref={agentActivityEndRef} />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        {envPaneOpen && (
          <div className="w-1/2 border-l border-gray-200 flex flex-col overflow-hidden bg-gray-50">
            <div className="flex items-center justify-between p-3 border-b border-gray-200">
              <div className="flex items-center space-x-2">
                <span className={`inline-block rounded-full ${envStatus === "attached" ? "bg-green-500" : "bg-red-500"}`} style={{width: "6px", height: "6px"}}></span>
                <span style={{fontSize: "16px", fontWeight: "bold"}}>Environment</span>
                {envUptime > 0 && <span className="text-xs text-gray-500">uptime: {Math.floor(envUptime / 60)}m {envUptime % 60}s</span>}
              </div>
              <div className="flex items-center space-x-2">
                <a
                  href="http://localhost:8000/env/status"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-400 hover:text-gray-700"
                  title="Open in new tab"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
                <button className="text-gray-400 hover:text-gray-700" onClick={() => setEnvPaneOpen(false)}>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="overflow-y-auto flex-1">
              {/* System Prompt */}
              <div className="border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <button className="flex-1 flex items-center justify-between p-3 hover:bg-gray-200" onClick={() => setEnvCollapsed(p => ({...p, prompt: !p.prompt}))}>
                    <span className="text-sm font-bold">System Prompt</span>
                    <svg xmlns="http://www.w3.org/2000/svg" className="text-gray-400" style={{width: "12px", height: "12px", flexShrink: 0, transform: envCollapsed.prompt ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 0.15s"}} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                  </button>
                </div>
                {!envCollapsed.prompt && (
                  <div className="px-3 pb-3">
                    <textarea
                      className="w-full bg-white border border-gray-300 text-xs text-gray-700 p-2 rounded resize-y min-h-[120px] max-h-[400px]"
                      rows={8}
                      value={envSystemPrompt}
                      onChange={(e) => { setEnvSystemPrompt(e.target.value); saveEnvPrompt(e.target.value); }}
                    />
                    <div className="flex items-center justify-between mt-1">
                      {envPromptHistory.length > 0 && (
                        <select className="bg-white border border-gray-300 px-1 py-0.5 text-xs flex-1" value="" onChange={(e) => { const entry = envPromptHistory.find(h => h.id === e.target.value); if (entry) { setEnvSystemPrompt(entry.system_prompt); saveEnvPrompt(entry.system_prompt); } }}>
                          <option value="" disabled>Restore from history...</option>
                          {envPromptHistory.map((h) => (<option key={h.id} value={h.id}>{new Date(h.created_at).toLocaleString()} - {h.system_prompt.slice(0, 40)}...</option>))}
                        </select>
                      )}
                      <a
                        href={`https://supabase.com/dashboard/project/qimpbjvnthrvwsalpgsy/editor?schema=public&table=system_prompt_history&filter=source_table%3Aeq%3Aenvironments%2Csource_name%3Aeq%3A${encodeURIComponent(selectedAgentName)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center space-x-1 text-xs text-[#b87df9] hover:underline ml-2 flex-none"
                      >
                        <span>History</span>
                        <svg xmlns="http://www.w3.org/2000/svg" style={{width: "10px", height: "10px"}} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    </div>
                  </div>
                )}
              </div>
              {/* Tools */}
              <div className="border-b border-gray-200">
                <button className="w-full flex items-center justify-between p-3 hover:bg-gray-200" onClick={() => setEnvCollapsed(p => ({...p, tools: !p.tools}))}>
                  <span className="text-sm font-bold">Tools ({envTools.length})</span>
                  <svg xmlns="http://www.w3.org/2000/svg" className="text-gray-400" style={{width: "12px", height: "12px", flexShrink: 0, transform: envCollapsed.tools ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 0.15s"}} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                </button>
                {!envCollapsed.tools && (
                  <div className="px-3 pb-3 space-y-1 max-h-40 overflow-y-auto">
                    {envTools.map((tool) => (
                      <div key={tool.name} className="text-xs">
                        <span className="text-[#b87df9]">{tool.name}</span>
                        <span className="text-gray-500 ml-1">- {tool.description}</span>
                      </div>
                    ))}
                    {envTools.length === 0 && <div className="text-xs text-gray-500">No tools loaded</div>}
                  </div>
                )}
              </div>
              {/* Activity */}
              <div className="border-b border-gray-200">
                <button className="w-full flex items-center justify-between p-3 hover:bg-gray-200" onClick={() => setEnvCollapsed(p => ({...p, activity: !p.activity}))}>
                  <span className="text-sm font-bold">Activity</span>
                  <svg xmlns="http://www.w3.org/2000/svg" className="text-gray-400" style={{width: "12px", height: "12px", flexShrink: 0, transform: envCollapsed.activity ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 0.15s"}} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                </button>
                {!envCollapsed.activity && (
                  <div className="px-3 pb-3 overflow-y-auto text-xs space-y-1" style={{maxHeight: "300px"}}>
                    {envActivity.map((entry, i) => (
                      <div key={i} className="flex">
                        <span className="text-gray-500 flex-none w-20">{new Date(entry.ts).toLocaleTimeString()}</span>
                        <span className="text-gray-600 ml-2">{entry.message}</span>
                      </div>
                    ))}
                    {envActivity.length === 0 && <div className="text-gray-500">No activity yet</div>}
                    <div ref={activityEndRef} />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="flex justify-between items-center p-2 border-t border-slate-200">
        <div className="flex items-center space-x-2">
          <button
            className={`${isGenerating ? "bg-gray-500" : "bg-blue-500"} text-white py-2 px-4 rounded-md`}
            onClick={() => generateThought()}
            disabled={isGenerating}
          >
            {isGenerating ? "Generating..." : "Generate Thought"}
          </button>
          <button
            className={generatingLoopOn ? (
              "bg-red-500 text-white py-2 px-4 rounded mx-2"
            ) : (
              "bg-blue-500 text-white py-2 px-4 rounded mx-2"
            )}
            onClick={async () => {
              if (generatingLoopOn) {
                await stopLoop();
                setGeneratingLoopOn(false);
              } else {
                await startLoop({
                  delay_ms: 5000,
                  model: modelSelection,
                  temperature: modelTemperature,
                });
                setGeneratingLoopOn(true);
              }
            }}
          >
            {generatingLoopOn ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path fill="#FFFFFF" d="M6 4h4v16H6z" />
                <path fill="#FFFFFF" d="M14 4h4v16h-4z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="currentColor" viewBox="2 5 20 14" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
          {generatingLoopOn && <span className="text-xs text-green-400">Loop running</span>}
          <span className="text-xs text-gray-400 ml-3">{navigator.platform?.includes("Mac") ? "Cmd" : "Ctrl"}+Enter generate | {navigator.platform?.includes("Mac") ? "Option" : "Alt"}+Enter trigger action</span>
          {actionStatus && (
            <span className="flex items-center space-x-1.5 ml-3 text-xs">
              {actionStatus.status === "sent" && (
                <>
                  <span className="inline-block rounded-full animate-pulse" style={{width: "8px", height: "8px", flexShrink: 0, backgroundColor: "#b87df9"}} />
                  <span className="text-[#b87df9]">Action sent</span>
                </>
              )}
              {actionStatus.status === "processing" && (
                <>
                  <svg className="animate-spin" style={{width: "12px", height: "12px", flexShrink: 0}} viewBox="0 0 24 24">
                    <circle opacity="0.25" cx="12" cy="12" r="10" stroke="#b87df9" strokeWidth="4" fill="none" />
                    <path opacity="0.75" fill="#b87df9" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span className="text-[#b87df9]">Environment processing...</span>
                </>
              )}
              {actionStatus.status === "complete" && (
                <>
                  <svg style={{width: "12px", height: "12px", flexShrink: 0}} viewBox="0 0 20 20" fill="#22c55e">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  <span className="text-green-500">Action complete</span>
                </>
              )}
              <span className="text-gray-600 truncate" style={{ maxWidth: "150px" }}>
                {actionStatus.action}
              </span>
            </span>
          )}
        </div>
        <div className="flex items-center text-xs text-gray-500">
          <span>{modelSelection} | t={modelTemperature}</span>
        </div>
      </div>
    </div>
  );
}

export default App;
