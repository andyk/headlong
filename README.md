The webapp frontend is in packages/webapp - it's a vite typescript project.

The environment is in packages/env - it's a node daemon.

The two communicate via a Supabase `thoughts` table and Supabase's realtime system.
