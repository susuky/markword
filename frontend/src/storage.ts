const DATABASE_NAME = 'markword'
const DATABASE_VERSION = 1
const DRAFT_STORE = 'drafts'
const REVISION_STORE = 'revisions'
const CURRENT_DRAFT_ID = 'current'
const LEGACY_DOCUMENT_KEY = 'markword.document'
const PREFERENCE_PREFIX = 'markword.preference.'

export const AUTO_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000
export const MAX_REVISIONS = 120

export type MetadataValue = string | number | boolean | null
export type DraftMetadata = Record<string, MetadataValue>
export type RevisionReason = 'auto' | 'manual' | 'pre-restore'
export type PersistenceStatus = 'idle' | 'saving' | 'saved' | 'error'

export interface StoredDraft {
  id: typeof CURRENT_DRAFT_ID
  content: string
  metadata: DraftMetadata
  createdAt: number
  updatedAt: number
}

export interface Revision {
  id: string
  content: string
  metadata: DraftMetadata
  createdAt: number
  reason: RevisionReason
}

export interface PersistenceSessionOptions {
  snapshotIntervalMs?: number
  onStatusChange?: (status: PersistenceStatus, error?: Error) => void
  onRevisionCreated?: (revision: Revision) => void
}

export interface RestoredRevision {
  draft: StoredDraft
  revision: Revision
}

let databasePromise: Promise<IDBDatabase> | null = null
const revisionEvents = new EventTarget()

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
  })
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise

  databasePromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('此瀏覽器不支援 IndexedDB'))
      return
    }

    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(DRAFT_STORE)) {
        database.createObjectStore(DRAFT_STORE, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(REVISION_STORE)) {
        const revisions = database.createObjectStore(REVISION_STORE, { keyPath: 'id' })
        revisions.createIndex('createdAt', 'createdAt')
      }
    }
    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => {
        database.close()
        databasePromise = null
      }
      resolve(database)
    }
    request.onerror = () => {
      databasePromise = null
      reject(request.error ?? new Error('無法開啟 IndexedDB'))
    }
    request.onblocked = () => reject(new Error('請關閉其他 Markword 分頁後重試資料庫升級'))
  })

  return databasePromise
}

function cloneMetadata(metadata: DraftMetadata = {}): DraftMetadata {
  return { ...metadata }
}

function createRevisionId(): string {
  if ('randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export async function getCurrentDraft(): Promise<StoredDraft | null> {
  const database = await openDatabase()
  const transaction = database.transaction(DRAFT_STORE, 'readonly')
  const result = await requestResult(
    transaction.objectStore(DRAFT_STORE).get(CURRENT_DRAFT_ID) as IDBRequest<StoredDraft | undefined>,
  )
  await transactionComplete(transaction)
  return result ?? null
}

export async function loadCurrentDraft(
  fallbackContent = '',
  fallbackMetadata: DraftMetadata = {},
): Promise<StoredDraft> {
  const stored = await getCurrentDraft()
  if (stored) return stored

  const legacyContent = localStorage.getItem(LEGACY_DOCUMENT_KEY)
  const draft = await saveCurrentDraft(legacyContent ?? fallbackContent, fallbackMetadata)
  if (legacyContent !== null) localStorage.removeItem(LEGACY_DOCUMENT_KEY)
  return draft
}

export async function saveCurrentDraft(
  content: string,
  metadata: DraftMetadata = {},
): Promise<StoredDraft> {
  const previous = await getCurrentDraft()
  const now = Date.now()
  const draft: StoredDraft = {
    id: CURRENT_DRAFT_ID,
    content,
    metadata: cloneMetadata(metadata),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  }
  const database = await openDatabase()
  const transaction = database.transaction(DRAFT_STORE, 'readwrite')
  transaction.objectStore(DRAFT_STORE).put(draft)
  await transactionComplete(transaction)
  return draft
}

export async function listRevisions(): Promise<Revision[]> {
  const database = await openDatabase()
  const transaction = database.transaction(REVISION_STORE, 'readonly')
  const index = transaction.objectStore(REVISION_STORE).index('createdAt')
  const revisions = await requestResult(index.getAll() as IDBRequest<Revision[]>)
  await transactionComplete(transaction)
  revisions.reverse()
  return revisions
}

export async function getRevision(id: string): Promise<Revision | null> {
  const database = await openDatabase()
  const transaction = database.transaction(REVISION_STORE, 'readonly')
  const revision = await requestResult(
    transaction.objectStore(REVISION_STORE).get(id) as IDBRequest<Revision | undefined>,
  )
  await transactionComplete(transaction)
  return revision ?? null
}

async function pruneOldRevisions(): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(REVISION_STORE, 'readwrite')
  const store = transaction.objectStore(REVISION_STORE)
  const keys = await requestResult(store.index('createdAt').getAllKeys())
  const excess = keys.length - MAX_REVISIONS
  for (let index = 0; index < excess; index += 1) store.delete(keys[index])
  await transactionComplete(transaction)
}

export async function createSnapshot(
  content: string,
  metadata: DraftMetadata = {},
  reason: RevisionReason = 'manual',
): Promise<Revision> {
  const revision: Revision = {
    id: createRevisionId(),
    content,
    metadata: cloneMetadata(metadata),
    createdAt: Date.now(),
    reason,
  }
  const database = await openDatabase()
  const transaction = database.transaction(REVISION_STORE, 'readwrite')
  transaction.objectStore(REVISION_STORE).add(revision)
  await transactionComplete(transaction)
  await pruneOldRevisions()
  revisionEvents.dispatchEvent(new Event('change'))
  return revision
}

export async function deleteRevision(id: string): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(REVISION_STORE, 'readwrite')
  transaction.objectStore(REVISION_STORE).delete(id)
  await transactionComplete(transaction)
  revisionEvents.dispatchEvent(new Event('change'))
}

export async function restoreRevision(
  revisionId: string,
  currentContent: string,
  currentMetadata: DraftMetadata = {},
): Promise<RestoredRevision> {
  const revision = await getRevision(revisionId)
  if (!revision) throw new Error('找不到指定版本')

  await createSnapshot(currentContent, currentMetadata, 'pre-restore')
  const draft = await saveCurrentDraft(revision.content, revision.metadata)
  return { draft, revision }
}

export function subscribeToRevisions(listener: () => void): () => void {
  revisionEvents.addEventListener('change', listener)
  return () => revisionEvents.removeEventListener('change', listener)
}

export function loadPreference<T>(name: string, fallback: T): T {
  const raw = localStorage.getItem(`${PREFERENCE_PREFIX}${name}`)
  if (raw === null) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function savePreference<T>(name: string, value: T): void {
  localStorage.setItem(`${PREFERENCE_PREFIX}${name}`, JSON.stringify(value))
}

export class DraftPersistenceSession {
  private content = ''
  private metadata: DraftMetadata = {}
  private lastSnapshottedContent = ''
  private saveTimer: number | null = null
  private snapshotTimer: number | null = null
  private savePromise: Promise<StoredDraft> | null = null
  private started = false

  constructor(private readonly options: PersistenceSessionOptions = {}) {}

  async initialize(fallbackContent = '', fallbackMetadata: DraftMetadata = {}): Promise<StoredDraft> {
    const [draft, revisions] = await Promise.all([
      loadCurrentDraft(fallbackContent, fallbackMetadata),
      listRevisions(),
    ])
    this.content = draft.content
    this.metadata = cloneMetadata(draft.metadata)
    this.lastSnapshottedContent = revisions[0]?.content ?? draft.content
    return draft
  }

  start(): void {
    if (this.started) return
    this.started = true
    const interval = this.options.snapshotIntervalMs ?? AUTO_SNAPSHOT_INTERVAL_MS
    this.snapshotTimer = window.setInterval(() => {
      if (this.content !== this.lastSnapshottedContent) {
        void this.snapshot('auto').catch((error) => {
          const normalized = error instanceof Error ? error : new Error('自動建立版本失敗')
          this.options.onStatusChange?.('error', normalized)
        })
      }
    }, interval)
  }

  update(content: string, metadata: DraftMetadata = this.metadata): void {
    this.content = content
    this.metadata = cloneMetadata(metadata)
    this.options.onStatusChange?.('saving')
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer)
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null
      void this.flush()
    }, 350)
  }

  async flush(): Promise<StoredDraft> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (this.savePromise) await this.savePromise
    this.savePromise = saveCurrentDraft(this.content, this.metadata)
    try {
      const draft = await this.savePromise
      this.options.onStatusChange?.('saved')
      return draft
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error('儲存失敗')
      this.options.onStatusChange?.('error', normalized)
      throw normalized
    } finally {
      this.savePromise = null
    }
  }

  async snapshot(reason: RevisionReason = 'manual'): Promise<Revision> {
    await this.flush()
    const revision = await createSnapshot(this.content, this.metadata, reason)
    this.lastSnapshottedContent = this.content
    this.options.onRevisionCreated?.(revision)
    return revision
  }

  async restore(revisionId: string): Promise<RestoredRevision> {
    await this.flush()
    const restored = await restoreRevision(revisionId, this.content, this.metadata)
    this.content = restored.draft.content
    this.metadata = cloneMetadata(restored.draft.metadata)
    this.lastSnapshottedContent = restored.draft.content
    return restored
  }

  stop(): void {
    const hasPendingSave = this.saveTimer !== null
    this.started = false
    if (this.snapshotTimer !== null) window.clearInterval(this.snapshotTimer)
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer)
    this.snapshotTimer = null
    this.saveTimer = null
    if (hasPendingSave) void this.flush().catch(() => undefined)
  }
}
