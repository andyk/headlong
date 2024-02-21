import { createClient } from '@supabase/supabase-js';
import { Database } from './database.types'

const anonKey =
    // eslint-disable-next-line max-len
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpbXBianZudGhydndzYWxwZ3N5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE2OTYzNTExOTIsImV4cCI6MjAxMTkyNzE5Mn0.6Cn85__sFHAhbw5n3MOjJHn3zFIdZUrfXgm_pYeVZ_A";
 
const supabaseEnvKey = typeof window === "undefined" ?  process.env.SUPABASE_SERVICE_ROLE_KEY_HEADLONG : null;
//const supabaseEnvKey = typeof window === "undefined" ?  import.meta.env.SUPABASE_SERVICE_ROLE_KEY_HEADLONG : null;
//const supabaseEnvKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY_HEADLONG;

const supabaseKey = supabaseEnvKey ? supabaseEnvKey : anonKey;

// Assumes supabase SchemaName "public"
const supabase = createClient<Database>(
    "https://qimpbjvnthrvwsalpgsy.supabase.co",
    supabaseKey
);

export default supabase;
