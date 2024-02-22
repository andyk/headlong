import { createClient } from '@supabase/supabase-js';
import { Database } from './database.types'

const supabaseURL = import.meta.env.VITE_SUPABASE_URL_HEADLONG;
const supabaseServiceRoleKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY_HEADLONG;

// Assumes supabase SchemaName "public"
const supabase = createClient<Database>(
    supabaseURL,
    supabaseServiceRoleKey
);

export default supabase;
