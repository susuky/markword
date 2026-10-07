import { translate } from './i18n'

const DATABASE_NAME = 'markword'
const DATABASE_VERSION = 2
const DRAFT_STORE = 'drafts'
const REVISION_STORE = 'revisions'
const ASSET_STORE = 'assets'
const CURRENT_DRAFT_ID = 'current'
const LEGACY_DOCUMENT_KEY = 'markword.document'
const PREFERENCE_PREFIX = 'markword.preference.'

export const AUTO_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000
export const MAX_REVISIONS = 120

export type MetadataValue = string | number | boolean | null
export type DraftMetadata = Record<string, MetadataValue>
export type RevisionReason = 'auto' | 'manual' | 'pre-restore' | 'pre-open'
export type PersistenceStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict'
export type AssetKind = 'image' | 'video' | 'audio' | 'file'

export interface StoredDraft {
  id: typeof CURRENT_DRAFT_ID
  version?: number
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

export interface StoredAsset {
  id: string
  path: string
  name: string
  type: string
  kind: AssetKind
  size: number
  blob: Blob
  createdAt: number
  updatedAt: number
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

export class DraftConflictError extends Error {
  constructor() {
    super(translate('Another tab saved changes. Download this copy before reloading.'))
  }
}

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
      reject(new Error(translate('This browser does not support IndexedDB')))
      return
    }

    let blocked = false
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
      if (!database.objectStoreNames.contains(ASSET_STORE)) {
        const assets = database.createObjectStore(ASSET_STORE, { keyPath: 'id' })
        assets.createIndex('path', 'path', { unique: true })
        assets.createIndex('createdAt', 'createdAt')
      }
    }
    request.onsuccess = () => {
      const database = request.result
      if (blocked) {
        database.close()
        return
      }
      database.onversionchange = () => {
        database.close()
        databasePromise = null
      }
      resolve(database)
    }
    request.onerror = () => {
      databasePromise = null
      reject(request.error ?? new Error(translate('Could not open local storage')))
    }
    request.onblocked = () => {
      blocked = true
      databasePromise = null
      reject(new Error(translate('Close other Markword tabs before upgrading local storage')))
    }
  })

  return databasePromise
}

function cloneMetadata(metadata: DraftMetadata = {}): DraftMetadata {
  return { ...metadata }
}

function createRevisionId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
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
  let draft: StoredDraft
  try {
    draft = await saveCurrentDraft(legacyContent ?? fallbackContent, fallbackMetadata, null)
  } catch (error) {
    if (!(error instanceof DraftConflictError)) throw error
    // Two tabs may initialize an empty database at the same time.
    const current = await getCurrentDraft()
    if (!current) throw error
    draft = current
  }
  if (legacyContent !== null) localStorage.removeItem(LEGACY_DOCUMENT_KEY)
  return draft
}

export async function saveCurrentDraft(
  content: string,
  metadata: DraftMetadata,
  expectedVersion: number | null,
): Promise<StoredDraft> {
  const database = await openDatabase()
  const transaction = database.transaction(DRAFT_STORE, 'readwrite')
  const complete = transactionComplete(transaction)
  const store = transaction.objectStore(DRAFT_STORE)
  const previous = await requestResult(store.get(CURRENT_DRAFT_ID) as IDBRequest<StoredDraft | undefined>)
  // Read, compare and write in one transaction across all browser tabs.
  if ((previous ? previous.version ?? 0 : null) !== expectedVersion) {
    await complete
    throw new DraftConflictError()
  }
  if (previous && previous.content === content && JSON.stringify(previous.metadata) === JSON.stringify(metadata)) {
    await complete
    return previous
  }
  const now = Date.now()
  const draft: StoredDraft = {
    id: CURRENT_DRAFT_ID,
    version: (previous?.version ?? 0) + 1,
    content,
    metadata: cloneMetadata(metadata),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  }
  store.put(draft)
  await complete
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

export async function listAssets(): Promise<StoredAsset[]> {
  const database = await openDatabase()
  const transaction = database.transaction(ASSET_STORE, 'readonly')
  const assets = await requestResult(
    transaction.objectStore(ASSET_STORE).index('createdAt').getAll() as IDBRequest<StoredAsset[]>,
  )
  await transactionComplete(transaction)
  return assets
}

export async function getAssetByPath(path: string): Promise<StoredAsset | null> {
  const database = await openDatabase()
  const transaction = database.transaction(ASSET_STORE, 'readonly')
  const asset = await requestResult(
    transaction.objectStore(ASSET_STORE).index('path').get(path) as IDBRequest<StoredAsset | undefined>,
  )
  await transactionComplete(transaction)
  return asset ?? null
}

export async function getAssetsByPaths(paths: readonly string[]): Promise<Map<string, StoredAsset>> {
  if (!paths.length) return new Map()
  const database = await openDatabase()
  const transaction = database.transaction(ASSET_STORE, 'readonly')
  const index = transaction.objectStore(ASSET_STORE).index('path')
  const requests = paths.map((path) => requestResult(index.get(path) as IDBRequest<StoredAsset | undefined>))
  const results = await Promise.all(requests)
  await transactionComplete(transaction)
  const assets = new Map<string, StoredAsset>()
  results.forEach((asset) => {
    if (asset) assets.set(asset.path, asset)
  })
  return assets
}

export async function putAssets(assets: readonly StoredAsset[]): Promise<void> {
  if (!assets.length) return
  const database = await openDatabase()
  const transaction = database.transaction(ASSET_STORE, 'readwrite')
  const store = transaction.objectStore(ASSET_STORE)
  assets.forEach((asset) => store.put(asset))
  await transactionComplete(transaction)
}

export async function deleteAsset(id: string): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(ASSET_STORE, 'readwrite')
  transaction.objectStore(ASSET_STORE).delete(id)
  await transactionComplete(transaction)
}

export async function restoreRevision(
  revisionId: string,
  currentContent: string,
  currentMetadata: DraftMetadata,
  expectedVersion: number,
): Promise<RestoredRevision> {
  const revision = await getRevision(revisionId)
  if (!revision) throw new Error(translate('Revision not found'))

  await createSnapshot(currentContent, currentMetadata, 'pre-restore')
  const draft = await saveCurrentDraft(revision.content, revision.metadata, expectedVersion)
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
  private version = 0

  constructor(private readonly options: PersistenceSessionOptions = {}) {}

  async initialize(fallbackContent = '', fallbackMetadata: DraftMetadata = {}): Promise<StoredDraft> {
    const [draft, revisions] = await Promise.all([
      loadCurrentDraft(fallbackContent, fallbackMetadata),
      listRevisions(),
    ])
    this.content = draft.content
    this.metadata = cloneMetadata(draft.metadata)
    this.version = draft.version ?? 0
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
          const normalized = error instanceof Error ? error : new Error(translate('Automatic revision failed'))
          this.options.onStatusChange?.(error instanceof DraftConflictError ? 'conflict' : 'error', normalized)
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
      void this.flush().catch(() => undefined)
    }, 350)
  }

  async flush(): Promise<StoredDraft> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    while (this.savePromise) await this.savePromise
    const content = this.content
    const metadata = this.metadata
    this.savePromise = saveCurrentDraft(content, metadata, this.version)
    try {
      const draft = await this.savePromise
      this.version = draft.version ?? 0
      this.options.onStatusChange?.(this.content === content && this.metadata === metadata ? 'saved' : 'saving')
      return draft
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(translate('Save failed'))
      this.options.onStatusChange?.(error instanceof DraftConflictError ? 'conflict' : 'error', normalized)
      throw normalized
    } finally {
      this.savePromise = null
    }
  }

  async snapshot(reason: RevisionReason = 'manual'): Promise<Revision> {
    const draft = await this.flush()
    const revision = await createSnapshot(draft.content, draft.metadata, reason)
    this.lastSnapshottedContent = revision.content
    this.options.onRevisionCreated?.(revision)
    return revision
  }

  async restore(revisionId: string): Promise<RestoredRevision> {
    await this.flush()
    const restored = await restoreRevision(revisionId, this.content, this.metadata, this.version)
    this.version = restored.draft.version ?? 0
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
