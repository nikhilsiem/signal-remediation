export interface FaultState {
  on: boolean;
  params: Record<string, unknown>;
}
export type Faults = Record<string, FaultState>;
export interface Store {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<number>;
  deleteByPrefix(prefix: string): Promise<number>;
  getFaults(): Promise<Faults>;
  setFault(name: string, state: FaultState): Promise<void>;
  clearFaults(): Promise<void>;
}
