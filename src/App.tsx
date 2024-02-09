import { useEffect, useState, createRef, useRef } from "react";
import "./App-compiled.css";
import supabase from "./supabase";
import ScrollToBottom from "react-scroll-to-bottom";
import TextareaAutosize from "react-textarea-autosize";

export type Thought = {
    body: string;
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
    const [selectedAgentName, setSelectedAgentName] = useState<string>(null);
    const [agent, setAgent] = useState<Agent | null>(null);
    const [selectedThoughtIndex, setSelectedThoughtIndex] = useState<
        number | null
    >(null);

    async function getAgent(name: string): Promise<Agent> {
        const { data: agent, error } = await supabase
            .from("agents")
            .select("*")
            .eq("name", name)
            .maybeSingle();
        if (error) {
            console.log(error);
            throw error;
        } else if (!agent) {
            throw new Error(`No agent found with name ${name}`);
        }
        console.log("got agents from supabase: ", agent);
        return agent;
    }

    useEffect(() => {
        (async () => {
            const { data: agents, error } = await supabase
                .from("agents")
                .select("name");
            if (error) {
                console.log(error);
            } else if (agents === null) {
                console.log("no agents found");
            } else {
                console.log("got agent names from supabase: ", agents);
                setAgentNameList(
                    agents.map((agent: { name: string }) => agent.name)
                );
            }
        })();
    }, []);

    useEffect(() => {
        console.log("agentNameList: ", agentNameList);
        if (agentNameList.length > 0 && selectedAgentName === null) {
            setSelectedAgentName(agentNameList[0]);
        }
    }, [agentNameList, selectedAgentName]);

    useEffect(() => {
        if (!selectedAgentName) {
            console.log("no agent selected");
        } else {
            console.log(`${selectedAgentName} selected`);
            (async () => {
                setAgent(await getAgent(selectedAgentName));
            })();
        }
    }, [selectedAgentName]);

    useEffect(() => {
        console.log("pushing the updated agent to supabase: ", agent);
        if (agent) {
            (async () => {
                const { data, error } = await supabase
                    .from("agents")
                    .update(agent)
                    .eq("name", agent.name)
                    .select();
                if (error) {
                    console.log(error);
                } else {
                    console.log("agent updated in supabase: ", data);
                }
            })();
        }
    }, [agent]);

    useEffect(() => {
        console.log("selectedThoughtIndex: ", selectedThoughtIndex);
        const selectedTextArea =
            textAreaRefs.current[selectedThoughtIndex ?? 0];
        if (selectedTextArea) {
            selectedTextArea.focus();
            // put cursor at end of text
            selectedTextArea.setSelectionRange(
                selectedTextArea.value.length,
                selectedTextArea.value.length
            );
        }
    }, [selectedThoughtIndex]);

    const textAreaRefs = useRef<(HTMLTextAreaElement | null)[]>([]);

    return (
        <>
            {agentNameList.length > 0 ? (
                <select
                    id="agent-selector"
                    className="bg-[#121212] border border-gray-600 px-2 m-2"
                    value={selectedAgentName ?? ""}
                    onChange={(event) => {
                        console.log("selected agent: ", event.target.value);
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
                {agent ? (
                    <div>
                        <h1>{agent.name}</h1>
                        <p>{agent.created_at}</p>
                        <div>
                            <ScrollToBottom className="overflow-auto whitespace-pre border border-gray-500">
                              <div className="flex flex-col">
                                {agent?.thoughts.map((thought, index) => {
                                    let className =
                                        "m-1 cursor-pointer bg-zinc-800 rounded-sm h-[25px] overflow-auto w-full";
                                    if (index === selectedThoughtIndex) {
                                        console.log(
                                            `index ${index} === ${selectedThoughtIndex} means is selected`
                                        );
                                        className +=
                                            " border border-blue-600 bg-blue-950";
                                    }
                                    if (!textAreaRefs.current[index]) {
                                        textAreaRefs.current[index] =
                                            createRef();
                                    }
                                    return (
                                        <TextareaAutosize
                                            key={index}
                                            ref={(el) =>
                                                (textAreaRefs.current[index] =
                                                    el)
                                            }
                                            className={className}
                                            value={thought.body ?? ""}
                                            onChange={(e) => {
                                                console.log(
                                                    `in onChange for thought index ${index}`
                                                );
                                                setAgent((ag) => {
                                                    if (ag === null) {
                                                        return ag;
                                                    }
                                                    const newThoughts = [
                                                        ...ag.thoughts,
                                                    ];
                                                    newThoughts[index] = {
                                                        ...newThoughts[index],
                                                        body: e.target.value,
                                                    };
                                                    return {
                                                        ...ag,
                                                        thoughts: newThoughts,
                                                    };
                                                });
                                                e.target.style.height = "auto";
                                                e.target.style.height =
                                                    e.target.scrollHeight +
                                                    "px";
                                            }}
                                            onFocus={() => {
                                                if (
                                                    selectedThoughtIndex ===
                                                    index
                                                ) {
                                                    return;
                                                }
                                                setSelectedThoughtIndex(index);
                                            }}
                                            onKeyDown={(e) => {
                                                if (
                                                    e.key === "Enter" &&
                                                    !e.shiftKey
                                                ) {
                                                    e.preventDefault();
                                                    console.log(
                                                        "Enter key pressed"
                                                    );
                                                    setAgent((old) => {
                                                        if (old === null) {
                                                            return old;
                                                        }
                                                        const newThoughts = [
                                                            ...old.thoughts,
                                                        ];
                                                        newThoughts.splice(
                                                            index + 1,
                                                            0,
                                                            {
                                                                body: "",
                                                                human_generated_slices:
                                                                    [],
                                                            }
                                                        );
                                                        return {
                                                            ...old,
                                                            thoughts:
                                                                newThoughts,
                                                        };
                                                    });
                                                    setSelectedThoughtIndex(
                                                        (i) => (i ?? 0) + 1
                                                    );
                                                }
                                                if (
                                                    e.key === "Backspace" &&
                                                    thought.body === ""
                                                ) {
                                                    e.preventDefault();
                                                    console.log(
                                                        "Backspace key pressed"
                                                    );
                                                    setAgent((old) => {
                                                        if (
                                                            old === null ||
                                                            old.thoughts
                                                                .length <= 1
                                                        ) {
                                                            return old;
                                                        }
                                                        const newThoughts = [
                                                            ...old.thoughts,
                                                        ];
                                                        newThoughts.splice(
                                                            index,
                                                            1
                                                        ); // Remove the current thought

                                                        return {
                                                            ...old,
                                                            thoughts:
                                                                newThoughts,
                                                        };
                                                    });
                                                    setSelectedThoughtIndex(
                                                        (i) =>
                                                            (i ?? 0) === 0
                                                                ? 0
                                                                : (i ?? 0) - 1
                                                    );
                                                }
                                            }}
                                        />
                                    );
                                })}
                              </div>
                            </ScrollToBottom>
                        </div>
                    </div>
                ) : (
                    <h1>Select an agent</h1>
                )}
            </div>
        </>
    );
}
export default App;
