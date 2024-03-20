Headlong is a framework for human users to create and cureate high quality chain-of-thought datasets and use them in AI Agents.

The webapp frontend is in packages/webapp - it's a vite typescript project.

The environment is in packages/env - it's a node daemon.

The two communicate via a Supabase `thoughts` table and Supabase's realtime system.
