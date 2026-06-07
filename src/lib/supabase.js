import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://xaoriajbtywllmpuivrx.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_is-eX7FTxTnYaCo530e27g_LYjgVU7a'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)