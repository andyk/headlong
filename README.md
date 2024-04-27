Headlong is a framework for human users to create and cureate high quality chain-of-thought datasets and use them in AI Agents.

The webapp frontend is in packages/webapp - it's a vite Typescript project.

The environment is in packages/env - it's a node daemon written in Typescript. The webapp depends on a `thought_server` (found in `packages/thought_server`) which is written in Python and wraps LLMs for thought generation.

The webapp communicates with the environment via a Supabase `thoughts` table and Supabase's realtime system.
