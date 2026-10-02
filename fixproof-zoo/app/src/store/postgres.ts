import pg from "pg";
import type { Faults, FaultState, Store } from "./types.ts";
const like = (p: string) => p.replace(/[\\%_]/g, "\\$&") + "%";
export class PostgresStore implements Store {
  private pool: pg.Pool;
  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url, max: 3, ssl: url.includes("sslmode=") ? undefined : { rejectUnauthorized: false } });
  }
  async get(key: string) {
    const r = await this.pool.query("select value from zoo_cache where key = $1", [key]);
    return r.rows[0]?.value;
  }
  async set(key: string, value: unknown) {
    await this.pool.query(
      "insert into zoo_cache(key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value",
      [key, JSON.stringify(value)],
    );
  }
  async delete(key: string) {
    return (await this.pool.query("delete from zoo_cache where key = $1", [key])).rowCount ?? 0;
  }
  async deleteByPrefix(prefix: string) {
    return (await this.pool.query("delete from zoo_cache where key like $1", [like(prefix)])).rowCount ?? 0;
  }
  async getFaults() {
    const r = await this.pool.query('select name, "on", params from zoo_faults');
    const out: Faults = {};
    for (const row of r.rows) out[row.name] = { on: row.on, params: row.params ?? {} };
    return out;
  }
  async setFault(name: string, s: FaultState) {
    await this.pool.query(
      `insert into zoo_faults(name, "on", params, updated_at) values ($1, $2, $3::jsonb, now())
       on conflict (name) do update set "on" = excluded."on", params = excluded.params, updated_at = now()`,
      [name, s.on, JSON.stringify(s.params)],
    );
  }
  async clearFaults() {
    await this.pool.query("delete from zoo_faults");
  }
  async close() {
    await this.pool.end();
  }
}
