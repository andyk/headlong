import { createClient } from '@supabase/supabase-js';
import { Database } from './database.types'

const supabaseUrl = process.env.SUPABASE_URL_HEADLONG
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY_HEADLONG

if (!supabaseUrl) {
    throw new Error('Env var SUPABASE_URL missing');
}
if (!supabaseServiceRole) {
    throw new Error('Env var SUPABASE_SERVICE_ROLE missing');
}

// Assumes supabase SchemaName "public"
const supabase = createClient<Database>(
    supabaseUrl,
    supabaseServiceRole
);

export default supabase;
