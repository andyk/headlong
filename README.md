Headlong is a framework for human users to create and curate high quality chain-of-thought datasets and use them in AI Agents.
<img src="https://github.com/andyk/headlong/assets/228998/2ef972f0-95d1-4dcf-b1c0-4e76247916fb" alt="screenshot of Headlong webapp" align="right" style="width:500px">


## Architectural Parts

The webapp frontend is in `packages/webapp` - it's a vite Typescript project.

The webapp depends on a `thought_server` (found in `packages/thought_server`) which is written in Python and wraps LLMs for thought generation.

The environment is in `packages/env` - it's a node daemon written in Typescript. you should run this in a docker container or EC2 instance.

The environment uses GPT4 function calling to use tools, including a `terminalServer` that itself wraps `ht` ([headless terminal](https://github.com/andyk/ht)).

The webapp communicates with the environment via a Supabase `thoughts` table and Supabase's realtime system.


## Install and run

### == ht ==
Download the latest `ht` binary from https://github.com/andyk/ht/releases/latest
and add it to your `PATH`.

### == thought server ==
1. You need `python >= 3.10` since we use the `match` syntax.
2. Create or get a copy of `thinkers.yaml` and put it into `packages/thought_server/`
3. Then in a new terminal run:
```shell
cd packages/thought_server
virtualenv venv
. ./venv/bin/activate
pip install -r requirements.txt
. ./launch.sh
```

### == headlong UI webapp ==
By default, your webapp will connect to the main env running in EC2
via supabase realtime. If you want to override that and use a local
env, then you'll need to run the terminalServer and env locally.
We strongly recommend you run these in a docker instance.

```shell
cd packages/webapp
npm install
npm run dev
```

### == terminal server ==
In a new terminal run:
```shell
cd packages/env
npm install
npm run terminalServer
```

### == env daemon ==
In a new terminal run:
```shell
cd packages/env
npm run env
```
