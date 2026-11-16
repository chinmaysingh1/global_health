// Draft persistence on the device (IndexedDB). Failures are surfaced, never swallowed.
// Browser storage can be evicted by the OS/browser under storage pressure unless the
// origin is granted persistent storage; the UI says so.
import type { Encounter } from './types';

export interface Persistence {
  loadAll(): Promise<Encounter[]>;
  save(enc: Encounter): Promise<void>;
  remove(id: string): Promise<void>;
}

export class MemoryPersistence implements Persistence {
  private map = new Map<string, string>();
  failNextSave = false;
  async loadAll() {
    return [...this.map.values()].map((s) => JSON.parse(s) as Encounter);
  }
  async save(enc: Encounter) {
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error('QuotaExceededError (simulated)');
    }
    this.map.set(enc.id, JSON.stringify(enc));
  }
  async remove(id: string) {
    this.map.delete(id);
  }
}

const DB = 'chw-msk';
const STORE = 'encounters';

export class IdbPersistence implements Persistence {
  constructor(private factory: IDBFactory = indexedDB) {}
  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = this.factory.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
      req.onblocked = () => reject(new Error('IndexedDB blocked'));
    });
  }
  private async tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(req.result);
        t.onerror = () => reject(t.error ?? new Error('IndexedDB transaction failed'));
        t.onabort = () => reject(t.error ?? new Error('IndexedDB transaction aborted'));
      });
    } finally {
      db.close();
    }
  }
  loadAll() {
    return this.tx<Encounter[]>('readonly', (s) => s.getAll());
  }
  async save(enc: Encounter) {
    await this.tx('readwrite', (s) => s.put(enc));
  }
  async remove(id: string) {
    await this.tx('readwrite', (s) => s.delete(id));
  }
}

export type SaveState = { status: 'idle' | 'saving' | 'saved' | 'error'; at?: string; error?: string };

/** In-memory encounter store with write-through autosave. */
export class EncounterStore {
  private encounters = new Map<string, Encounter>();
  private listeners = new Set<() => void>();
  saveState: SaveState = { status: 'idle' };
  private chain: Promise<void> = Promise.resolve();

  constructor(private persistence: Persistence) {}

  async load(): Promise<void> {
    for (const e of await this.persistence.loadAll()) this.encounters.set(e.id, e);
    this.emit();
  }
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((l) => l());
  }
  all(): Encounter[] {
    return [...this.encounters.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  get(id: string): Encounter | null {
    return this.encounters.get(id) ?? null;
  }
  /** Stores the new revision immediately and persists it; a persistence failure is reported. */
  put(enc: Encounter): Promise<void> {
    const existing = this.encounters.get(enc.id);
    if (existing && existing.revision > enc.revision) return this.chain; // never regress to an older revision
    this.encounters.set(enc.id, enc);
    this.saveState = { status: 'saving' };
    this.emit();
    this.chain = this.chain
      .then(() => this.persistence.save(enc))
      .then(() => {
        this.saveState = { status: 'saved', at: new Date().toISOString() };
      })
      .catch((e) => {
        this.saveState = { status: 'error', error: String((e as Error)?.message ?? e) };
      })
      .then(() => this.emit());
    return this.chain;
  }
  async remove(id: string): Promise<void> {
    this.encounters.delete(id);
    await this.persistence.remove(id);
    this.emit();
  }
}
