import { createClient } from '@supabase/supabase-js';
import { Database } from './database.types'

const supabaseURL = import.meta.env.VITE_SUPABASE_URL_HEADLONG;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY_HEADLONG;

// Assumes supabase SchemaName "public"
const supabase = createClient<Database>(
    supabaseURL,
    supabaseAnonKey
);

export default supabase;
