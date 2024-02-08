import { useEffect, useState, createRef, useRef } from 'react'
import './App.css'
import supabase from './supabase'
import ScrollToBottom from 'react-scroll-to-bottom'
import TextareaAutosize from 'react-textarea-autosize';

export type Thought = {
  body: string;
  human_generated_slices: [number, number][];
  open_ai_embedding: number[];
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
  const [selectedThoughtIndex, setSelectedThoughtIndex] = useState<number | null>(null);

  async function getAgent(name: string): Promise<Agent> {
    const { data: agent, error } = await supabase
    .from("agents")
    .select("*")
    .eq("name", name)
    .maybeSingle()
    if (error) {
      console.log(error);
      throw error;
    } else if (!agent) {
      throw new Error(`No agent found with name ${name}`);
    }
    console.log("got agents from supabase: ", agent);
    return agent
  }

  useEffect(() => {
    (async () => {
      const { data: agents, error } = await supabase.from("agents").select("name");
      if (error) {
        console.log(error);
      } else if (agents === null) {
        console.log("no agents found");
      } else {
        console.log("got agent names from supabase: ", agents);
        setAgentNameList(agents.map((agent: { name: string }) => agent.name));
      }
    })();
  }, []);

  useEffect(() => {
    console.log("agentNameList: ", agentNameList)
    if (agentNameList.length > 0 && selectedAgentName === null) {
      setSelectedAgentName(agentNameList[0]);
    }
  }, [agentNameList, selectedAgentName]);

  useEffect(() => {
    if (!selectedAgentName) {
      console.log("no agent selected")
    } else {
      console.log(`${selectedAgentName} selected`);
      (async () => {
        setAgent(await getAgent(selectedAgentName));
      })();
    }
  }, [selectedAgentName]);

  useEffect(() => {
    console.log("pushing the updated agent to supabase");
    if (agent) {
      (async () => {
        const { data, error } = await supabase
          .from("agents")
          .update(agent)
          .eq("name", agent.name)
        if (error) {
          console.log(error);
        } else {
          console.log("agent updated in supabase: ", data);
        }
      })();
    }
  }, [agent]);

  const textAreaRefs = useRef<(HTMLTextAreaElement | null)[]>([]);

  return (
    <>
     { agentNameList ? (
      <select
        id="agent-selector"
        className="bg-[#121212] border border-gray-600 px-2 m-2"
        value={selectedAgentName}
        onChange={(event) => {
          console.log("selected agent: ", event.target.value)
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
      ) : (
        null
      )}
      <div>
        {agent ? ( 
          <div>
            <h1>{agent.name}</h1>
            <p>{agent.created_at}</p>
          {/*<p>{agent.thoughts.length} thoughts</p>*/}
          <ScrollToBottom className="overflow-auto whitespace-pre border border-gray-500">
              {agent
                ?.thoughts.map((thought, index) => {
                    let className =
                        "m-1 cursor-pointer bg-zinc-800 rounded-sm flex h-[25px] overflow-auto w-full";
                    if (index === selectedThoughtIndex) {
                        className +=
                            " border border-blue-600 bg-blue-950";
                    }
                    if (!textAreaRefs.current[index]) {
                        textAreaRefs.current[index] = createRef();
                    }
                    return (
                        <TextareaAutosize
                            ref={(el) => textAreaRefs.current[index] = el}
                            className={className}
                            value={thought.body ?? ""}
                            onChange={(e) => {
                                console.log(`in onChange for thought index ${index}`)
                                setAgent(ag => {
                                  if (!ag) {
                                    return ag
                                  }
                                  return {
                                    ...agent,
                                    thoughts: [
                                      ...ag.thoughts.slice(0, index-1),
                                      {
                                        ...ag.thoughts[index],
                                        body: e.target.value
                                      },
                                      ...ag.thoughts.slice(index+1)
                                    ]
                                  }
                                });
                                e.target.style.height = 'auto';
                                e.target.style.height = e.target.scrollHeight + 'px';
                            }}
                            onFocus={() => {
                                if (selectedThoughtIndex === index) {
                                    return;
                                }
                                setSelectedThoughtIndex(index);
                            }}
                        />
                    );
                })
            }
            </ScrollToBottom>
          </div>
        ) : (
          <h1>Select an agent</h1>
        )}
      </div>
    </>
  )
}
/*

                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault()
                                    console.log('Enter key pressed');
                                    setAgent(old => {
                                      if (old === null) {

                                      }
                                      return {
                                        ...old,
                                        thoughts: [...old.thoughts]
                                      }
                                    });
                                }
                                if (e.key === 'Backspace' && thought.body === "") {
                                    e.preventDefault()
                                    console.log('Backspace key pressed');
                                    setAppState(old => {
                                        return old.deleteThought();
                                    });
                                }
                            }}
*/

export default App
