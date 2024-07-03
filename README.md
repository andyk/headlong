Headlong is a framework for human users to create and curate high quality chain-of-thought datasets and use them in AI Agents.
<img src="https://github.com/andyk/headlong/assets/228998/2ef972f0-95d1-4dcf-b1c0-4e76247916fb" alt="screenshot of Headlong webapp" align="right" style="width:500px">


## Architectural Parts

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
# You need python >= 3.10 since we use the `match` syntax. 
virtualenv venv
. ./venv/bin/activate
pip install -r requirements.txt
# make sure you create or get a copy of thinkers.yaml and put it into ./
. ./launch.sh

## By default your webapp will connect to the main env running in EC2
## via supabase realtime. If you want to override that and use a local
## env, then you'll need to run the terminalServer and env locally.
## We strongly recommend you run these in a docker instance.
# in a new terminal 
cd packages/env
npm install
npm run terminalServer

# in a new terminal 
cd packages/env
npm run env
```
