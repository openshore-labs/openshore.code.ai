// A PostgREST failure carries its `code` (Vault M7, migration 0021): the team
// vault tells the plan (OV402) and the delete rule (OV403) from any other
// refusal by it, so the client reads the code from the body, not the words.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon');

const { rpc, select, SupabaseRequestError } = await import('../src/lib/supabase.js');

afterEach(() => {
  vi.unstubAllGlobals();
});

function answer(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

describe('supabase request errors', () => {
  it("an RPC's raised SQLSTATE arrives as the error's code, with its status", async () => {
    answer(400, { code: 'OV402', message: 'the plan is not active', details: null, hint: null });
    const err = await rpc('org_vault_write', 'tok', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SupabaseRequestError);
    expect(err).toMatchObject({ status: 400, code: 'OV402', message: 'the plan is not active' });
  });

  it("PostgREST's own code comes through too, and a body with none leaves it unset", async () => {
    answer(404, { code: 'PGRST202', message: 'Could not find the function' });
    await expect(rpc('org_vault_move', 'tok', {})).rejects.toMatchObject({
      status: 404,
      code: 'PGRST202',
    });
    answer(400, { message: 'no' });
    const err = (await select('org_vault_notes', 'tok', 'select=path').catch(
      (e: unknown) => e,
    )) as InstanceType<typeof SupabaseRequestError>;
    expect(err.status).toBe(400);
    expect(err.code).toBeUndefined();
  });
});
