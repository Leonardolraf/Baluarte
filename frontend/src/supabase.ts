import { createClient } from '@supabase/supabase-js';

// Cliente Supabase (REST/Realtime) usando a chave ANON pública.
// As credenciais vêm do .env (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).
// Fica null se não configurado, para não quebrar o app sem .env.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigurado = Boolean(url && anon);

export const supabase = supabaseConfigurado ? createClient(url as string, anon as string) : null;

// Teste rápido de conectividade (usado para diagnóstico).
export async function pingSupabase(): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { error } = await supabase.from('_health_check_inexistente').select('*').limit(1);
    // Conexão OK mesmo que a tabela não exista (erro de schema, não de rede/auth).
    return !error || error.code === 'PGRST205' || error.code === '42P01';
  } catch {
    return false;
  }
}
