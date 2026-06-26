import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://jeeqoyjfkwrmbaaiesbt.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_dCO3C6MohP-QpdG2C7PDCA_3ck5iFGK'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)