Headlong is a framework for human users to create and curate high quality chain-of-thought datasets and use them in AI Agents.

The webapp frontend is in `packages/webapp` - it's a vite Typescript project.

The webapp depends on a `thought_server` (found in `packages/thought_server`) which is written in Python and wraps LLMs for thought generation.

The environment is in `packages/env` - it's a node daemon written in Typescript. you should run this in a docker container or EC2 instance.

The environment uses GPT4 function calling to use tools, including a `terminalServer` that itself wraps `ht` ([headless terminal](https://github.com/andyk/ht)).

The webapp communicates with the environment via a Supabase `thoughts` table and Supabase's realtime system.


## install and run

```
# Download latest ht binary from https://github.com/andyk/ht/releases/latest
# and make sure it is on your path.

cd packages/webapp
npm install
npm run dev

# in a new terminal 
cd packages/thought_server
virtualenv env
./venv/bin/activate
python thought_server.py

# in a new terminal 
cd packages/env
npm install
npm run thoughtServer

# in a new terminal 
cd packages/env
npm run env
```
