import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const missingEnv = !url || !anon;

export const supabase =
  url && anon
    ? createClient(url, anon)
    : createClient("https://placeholder.supabase.co", "placeholder");
