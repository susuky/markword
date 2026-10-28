import { translate } from './i18n'
import { IS_STATIC_DEPLOYMENT } from './deployment'

export const usesSharedWorkspace = !IS_STATIC_DEPLOYMENT

const DATABASE_NAME = 'markword'
const DATABASE_VERSION = 3
const DRAFT_STORE = 'drafts'
const REVISION_STORE = 'revisions'
const ASSET_STORE = 'assets'
export const CURRENT_DRAFT_ID = 'current'
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
  id: string
  version?: number
  content: string
  metadata: DraftMetadata
  createdAt: number
  updatedAt: number
  trashedAt?: number | null
}

export interface Revision {
  id: string
  documentId: string
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
  documentId?: string
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
const documentEvents = new EventTarget()
let documentChannel: BroadcastChannel | null = null
let migrationPromise: Promise<void> | null = null
let importedDocumentIds: Record<string, string> = {}

class WorkspaceError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

async function workspaceFetch(path: string, options: RequestInit = {}, versioned = false): Promise<Response> {
  const response = await fetch(`/api/workspace${path}`, {
    cache: 'no-store',
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json', ...options.headers } : options.headers,
  })
  if (!response.ok) {
    if (response.status === 409 && versioned) throw new DraftConflictError()
    const body = await response.json().catch(() => null)
    const detail = body?.detail
    const message = typeof detail === 'string' ? detail
      : typeof detail?.message === 'string' ? `${detail.message}${detail.paths?.length ? ` ${detail.paths.join(', ')}` : ''}`
        : translate('The server could not process the request')
    throw new WorkspaceError(response.status, translate(message))
  }
  return response
}

async function sharedJSON<T>(path: string, options: RequestInit = {}, versioned = false): Promise<T> {
  await migrateBrowserWorkspace()
  return (await workspaceFetch(path, options, versioned)).json()
}

function assetData(asset: StoredAsset): Promise<Omit<StoredAsset, 'blob'> & { data: string }> {
  const { blob, ...metadata } = asset
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      resolve({ ...metadata, data: String(reader.result).split(',')[1] })
    }
    reader.readAsDataURL(blob)
  })
}

async function sharedAsset(metadata: Omit<StoredAsset, 'blob'>): Promise<StoredAsset> {
  const response = await workspaceFetch(`/assets/${encodeURIComponent(metadata.id)}`)
  return { ...metadata, blob: await response.blob() }
}

function migrateBrowserWorkspace(): Promise<void> {
  if (migrationPromise) return migrationPromise
  migrationPromise = (async () => {
    let drafts: StoredDraft[] = []
    let revisions: Revision[] = []
    let assets: StoredAsset[] = []
    if (typeof indexedDB !== 'undefined') {
      const database = await openDatabase()
      const transaction = database.transaction([DRAFT_STORE, REVISION_STORE, ASSET_STORE], 'readonly')
      const complete = transactionComplete(transaction)
      const records = await Promise.all([
        requestResult(transaction.objectStore(DRAFT_STORE).getAll() as IDBRequest<StoredDraft[]>),
        requestResult(transaction.objectStore(REVISION_STORE).getAll() as IDBRequest<Revision[]>),
        requestResult(transaction.objectStore(ASSET_STORE).getAll() as IDBRequest<StoredAsset[]>),
      ])
      drafts = records[0]
      revisions = records[1]
      assets = records[2]
      await complete
    }
    const legacy = localStorage.getItem(LEGACY_DOCUMENT_KEY)
    if (legacy !== null && !drafts.some((draft) => draft.id === CURRENT_DRAFT_ID)) {
      const now = Date.now()
      drafts.push({ id: CURRENT_DRAFT_ID, version: 0, content: legacy, metadata: { mode: 'markdown' }, createdAt: now, updatedAt: now })
    }
    if (!drafts.length && !revisions.length && !assets.length) return
    const response = await workspaceFetch('/import', {
      method: 'POST',
      body: JSON.stringify({ drafts, revisions, assets: await Promise.all(assets.map(assetData)) }),
    })
    const result = await response.json() as { documentIds: Record<string, string> }
    importedDocumentIds = result.documentIds
    const preferred = loadPreference('active-document', CURRENT_DRAFT_ID)
    if (result.documentIds[preferred]) savePreference('active-document', result.documentIds[preferred])
  })().catch((error) => { migrationPromise = null; throw error })
  return migrationPromise
}

function workspaceChannel() {
  if (!documentChannel && typeof BroadcastChannel !== 'undefined') {
    try { documentChannel = new BroadcastChannel('markword-documents') } catch { return null }
  }
  return documentChannel
}

function notifyDocuments() {
  documentEvents.dispatchEvent(new Event('change'))
  workspaceChannel()?.postMessage('change')
}

export function subscribeToDocuments(listener: () => void) {
  documentEvents.addEventListener('change', listener)
  window.addEventListener('focus', listener)
  const channel = workspaceChannel()
  channel?.addEventListener('message', listener)
  const timer = usesSharedWorkspace ? window.setInterval(() => { if (!document.hidden) listener() }, 2000) : null
  return () => {
    documentEvents.removeEventListener('change', listener)
    window.removeEventListener('focus', listener)
    channel?.removeEventListener('message', listener)
    if (timer !== null) window.clearInterval(timer)
  }
}

export function documentName(draft: Pick<StoredDraft, 'content' | 'metadata'>) {
  const name = typeof draft.metadata.name === 'string' && draft.metadata.name.trim()
    ? draft.metadata.name.trim()
    : draft.content.match(/^#\s+(.+)$/m)?.[1]?.replace(/[*_`~]/g, '').trim() || translate('Untitled document')
  return name.slice(0, 120)
}

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
      const revisions = request.transaction!.objectStore(REVISION_STORE)
      if (!revisions.indexNames.contains('documentId')) {
        revisions.createIndex('documentId', 'documentId')
        const cursor = revisions.openCursor()
        cursor.onsuccess = () => {
          const entry = cursor.result
          if (!entry) return
          if (!entry.value.documentId) entry.update({ ...entry.value, documentId: CURRENT_DRAFT_ID })
          entry.continue()
        }
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

export async function getCurrentDraft(id = CURRENT_DRAFT_ID): Promise<StoredDraft | null> {
  if (usesSharedWorkspace) {
    try { return await sharedJSON<StoredDraft>(`/drafts/${encodeURIComponent(id)}`) }
    catch (error) { if (error instanceof WorkspaceError && error.status === 404) return null; throw error }
  }
  const database = await openDatabase()
  const transaction = database.transaction(DRAFT_STORE, 'readonly')
  const result = await requestResult(
    transaction.objectStore(DRAFT_STORE).get(id) as IDBRequest<StoredDraft | undefined>,
  )
  await transactionComplete(transaction)
  return result ?? null
}

export async function loadCurrentDraft(
  fallbackContent = '',
  fallbackMetadata: DraftMetadata = {},
  id = CURRENT_DRAFT_ID,
): Promise<StoredDraft> {
  const stored = await getCurrentDraft(id)
  if (stored?.trashedAt) throw new Error(translate('This document is in the trash. Restore it before opening.'))
  if (stored) return stored
  if (id !== CURRENT_DRAFT_ID && id !== 'html') throw new Error(translate('Document not found'))

  const legacyContent = id === CURRENT_DRAFT_ID ? localStorage.getItem(LEGACY_DOCUMENT_KEY) : null
  let draft: StoredDraft
  try {
    draft = await saveCurrentDraft(legacyContent ?? fallbackContent, fallbackMetadata, null, id)
  } catch (error) {
    if (!(error instanceof DraftConflictError)) throw error
    // Two tabs may initialize an empty database at the same time.
    const current = await getCurrentDraft(id)
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
  id = CURRENT_DRAFT_ID,
): Promise<StoredDraft> {
  if (usesSharedWorkspace) {
    const draft = await sharedJSON<StoredDraft>(`/drafts/${encodeURIComponent(id)}`, {
      method: 'POST', body: JSON.stringify({ content, metadata, expectedVersion }),
    }, true)
    if (id !== 'html') notifyDocuments()
    return draft
  }
  const database = await openDatabase()
  const transaction = database.transaction(DRAFT_STORE, 'readwrite')
  const complete = transactionComplete(transaction)
  const store = transaction.objectStore(DRAFT_STORE)
  const previous = await requestResult(store.get(id) as IDBRequest<StoredDraft | undefined>)
  // Read, compare and write in one transaction across all browser tabs.
  if (previous?.trashedAt) {
    await complete
    throw new DraftConflictError()
  }
  if (previous && previous.content === content && JSON.stringify(previous.metadata) === JSON.stringify(metadata)) {
    await complete
    return previous
  }
  if ((previous ? previous.version ?? 0 : null) !== expectedVersion) {
    await complete
    throw new DraftConflictError()
  }
  const now = Date.now()
  const draft: StoredDraft = {
    id,
    version: (previous?.version ?? 0) + 1,
    content,
    metadata: cloneMetadata(metadata),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  }
  store.put(draft)
  await complete
  if (id !== 'html') notifyDocuments()
  return draft
}

export async function listWorkspaceDrafts(): Promise<StoredDraft[]> {
  if (usesSharedWorkspace) {
    const drafts = await sharedJSON<StoredDraft[]>('/drafts')
    return drafts.filter((draft) => draft.id !== 'html').sort((left, right) => right.updatedAt - left.updatedAt)
  }
  const database = await openDatabase()
  const transaction = database.transaction(DRAFT_STORE, 'readonly')
  const drafts = await requestResult(transaction.objectStore(DRAFT_STORE).getAll() as IDBRequest<StoredDraft[]>)
  await transactionComplete(transaction)
  return drafts.filter((draft) => draft.id === CURRENT_DRAFT_ID || draft.id.startsWith('doc-'))
    .sort((left, right) => right.updatedAt - left.updatedAt)
}

export async function createWorkspaceDocument(content = '', metadata: DraftMetadata = {}): Promise<StoredDraft> {
  return saveCurrentDraft(content, metadata, null, `doc-${createRevisionId()}`)
}

export async function chooseWorkspaceDocument(preferred: string, fallbackContent: string): Promise<string> {
  const drafts = await listWorkspaceDrafts()
  if (usesSharedWorkspace) preferred = importedDocumentIds[preferred] ?? preferred
  const active = drafts.filter((draft) => !draft.trashedAt)
  if (active.some((draft) => draft.id === preferred)) return preferred
  if (active.length) return active[0].id
  if (drafts.length) return (await createWorkspaceDocument('', { mode: 'markdown' })).id
  return (await loadCurrentDraft(usesSharedWorkspace ? '' : fallbackContent, { mode: 'markdown', theme: 'Light' })).id
}

export async function renameWorkspaceDocument(id: string, name: string, expectedVersion: number): Promise<StoredDraft> {
  const draft = await getCurrentDraft(id)
  if (!draft || draft.trashedAt) throw new Error(translate('Document not found'))
  const nextName = name.trim().slice(0, 120)
  if (!nextName) throw new Error(translate('Enter a document name'))
  return saveCurrentDraft(draft.content, { ...draft.metadata, name: nextName }, expectedVersion, id)
}

export async function setDocumentTrashed(id: string, trashed: boolean, expectedVersion: number): Promise<void> {
  if (usesSharedWorkspace) {
    await sharedJSON(`/drafts/${encodeURIComponent(id)}/trash`, {
      method: 'POST', body: JSON.stringify({ trashed, expectedVersion }),
    }, true)
    notifyDocuments()
    return
  }
  const database = await openDatabase()
  const transaction = database.transaction(DRAFT_STORE, 'readwrite')
  const complete = transactionComplete(transaction)
  const store = transaction.objectStore(DRAFT_STORE)
  const draft = await requestResult(store.get(id) as IDBRequest<StoredDraft | undefined>)
  if (!draft || (draft.version ?? 0) !== expectedVersion) {
    await complete
    throw new DraftConflictError()
  }
  store.put({ ...draft, version: expectedVersion + 1, trashedAt: trashed ? Date.now() : null })
  await complete
  notifyDocuments()
}

export async function listRevisions(documentId = CURRENT_DRAFT_ID): Promise<Revision[]> {
  if (usesSharedWorkspace) return sharedJSON<Revision[]>(`/revisions?documentId=${encodeURIComponent(documentId)}`)
  const database = await openDatabase()
  const transaction = database.transaction(REVISION_STORE, 'readonly')
  const index = transaction.objectStore(REVISION_STORE).index('documentId')
  const revisions = await requestResult(index.getAll(documentId) as IDBRequest<Revision[]>)
  await transactionComplete(transaction)
  return revisions.sort((left, right) => right.createdAt - left.createdAt)
}

export async function listWorkspaceRevisions(): Promise<Revision[]> {
  if (usesSharedWorkspace) return sharedJSON<Revision[]>('/revisions')
  const database = await openDatabase()
  const transaction = database.transaction(REVISION_STORE, 'readonly')
  const revisions = await requestResult(transaction.objectStore(REVISION_STORE).getAll() as IDBRequest<Revision[]>)
  await transactionComplete(transaction)
  return revisions
}

export async function getRevision(id: string, documentId = CURRENT_DRAFT_ID): Promise<Revision | null> {
  if (usesSharedWorkspace) return (await listRevisions(documentId)).find((revision) => revision.id === id) ?? null
  const database = await openDatabase()
  const transaction = database.transaction(REVISION_STORE, 'readonly')
  const revision = await requestResult(
    transaction.objectStore(REVISION_STORE).get(id) as IDBRequest<Revision | undefined>,
  )
  await transactionComplete(transaction)
  return revision?.documentId === documentId ? revision : null
}

async function pruneOldRevisions(documentId: string): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(REVISION_STORE, 'readwrite')
  const store = transaction.objectStore(REVISION_STORE)
  const revisions = await requestResult(store.index('documentId').getAll(documentId) as IDBRequest<Revision[]>)
  revisions.sort((left, right) => left.createdAt - right.createdAt)
  const excess = revisions.length - MAX_REVISIONS
  for (let index = 0; index < excess; index += 1) store.delete(revisions[index].id)
  await transactionComplete(transaction)
}

export async function createSnapshot(
  content: string,
  metadata: DraftMetadata = {},
  reason: RevisionReason = 'manual',
  documentId = CURRENT_DRAFT_ID,
): Promise<Revision> {
  const revision: Revision = {
    id: createRevisionId(),
    documentId,
    content,
    metadata: cloneMetadata(metadata),
    createdAt: Date.now(),
    reason,
  }
  if (usesSharedWorkspace) {
    await sharedJSON('/revisions', { method: 'POST', body: JSON.stringify(revision) })
    revisionEvents.dispatchEvent(new Event('change'))
    return revision
  }
  const database = await openDatabase()
  const transaction = database.transaction(REVISION_STORE, 'readwrite')
  transaction.objectStore(REVISION_STORE).add(revision)
  await transactionComplete(transaction)
  await pruneOldRevisions(documentId)
  revisionEvents.dispatchEvent(new Event('change'))
  return revision
}

export async function deleteRevision(id: string, documentId = CURRENT_DRAFT_ID): Promise<void> {
  if (usesSharedWorkspace) {
    await sharedJSON(`/revisions/${encodeURIComponent(id)}?documentId=${encodeURIComponent(documentId)}`, { method: 'DELETE' })
    revisionEvents.dispatchEvent(new Event('change'))
    return
  }
  if (!await getRevision(id, documentId)) throw new Error(translate('Revision not found'))
  const database = await openDatabase()
  const transaction = database.transaction(REVISION_STORE, 'readwrite')
  transaction.objectStore(REVISION_STORE).delete(id)
  await transactionComplete(transaction)
  revisionEvents.dispatchEvent(new Event('change'))
}

export async function listAssets(): Promise<StoredAsset[]> {
  if (usesSharedWorkspace) return Promise.all((await sharedJSON<Omit<StoredAsset, 'blob'>[]>('/assets')).map(sharedAsset))
  const database = await openDatabase()
  const transaction = database.transaction(ASSET_STORE, 'readonly')
  const assets = await requestResult(
    transaction.objectStore(ASSET_STORE).index('createdAt').getAll() as IDBRequest<StoredAsset[]>,
  )
  await transactionComplete(transaction)
  return assets
}

export async function getAssetByPath(path: string): Promise<StoredAsset | null> {
  if (usesSharedWorkspace) {
    const asset = (await sharedJSON<Omit<StoredAsset, 'blob'>[]>('/assets')).find((item) => item.path === path)
    return asset ? sharedAsset(asset) : null
  }
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
  if (usesSharedWorkspace) {
    const metadata = await sharedJSON<Omit<StoredAsset, 'blob'>[]>('/assets')
    const assets = await Promise.all(metadata.filter((asset) => paths.includes(asset.path)).map(sharedAsset))
    return new Map(assets.map((asset) => [asset.path, asset]))
  }
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
  if (usesSharedWorkspace) {
    await sharedJSON('/assets', { method: 'POST', body: JSON.stringify(await Promise.all(assets.map(assetData))) })
    return
  }
  const database = await openDatabase()
  const transaction = database.transaction(ASSET_STORE, 'readwrite')
  const store = transaction.objectStore(ASSET_STORE)
  assets.forEach((asset) => store.put(asset))
  await transactionComplete(transaction)
}

export async function deleteAsset(id: string): Promise<void> {
  if (usesSharedWorkspace) { await sharedJSON(`/assets/${encodeURIComponent(id)}`, { method: 'DELETE' }); return }
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
  documentId = CURRENT_DRAFT_ID,
): Promise<RestoredRevision> {
  if (usesSharedWorkspace) {
    const restored = await sharedJSON<RestoredRevision>('/restore', {
      method: 'POST', body: JSON.stringify({ revisionId, currentContent, currentMetadata, expectedVersion, documentId }),
    }, true)
    revisionEvents.dispatchEvent(new Event('change'))
    notifyDocuments()
    return restored
  }
  const revision = await getRevision(revisionId, documentId)
  if (!revision) throw new Error(translate('Revision not found'))

  await createSnapshot(currentContent, currentMetadata, 'pre-restore', documentId)
  const draft = await saveCurrentDraft(revision.content, revision.metadata, expectedVersion, documentId)
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

  get documentId() { return this.options.documentId ?? CURRENT_DRAFT_ID }

  async initialize(fallbackContent = '', fallbackMetadata: DraftMetadata = {}): Promise<StoredDraft> {
    const [draft, revisions] = await Promise.all([
      loadCurrentDraft(fallbackContent, fallbackMetadata, this.documentId),
      listRevisions(this.documentId),
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
    this.metadata = { ...this.metadata, ...metadata }
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
    this.savePromise = saveCurrentDraft(content, metadata, this.version, this.documentId)
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
    const revision = await createSnapshot(draft.content, draft.metadata, reason, this.documentId)
    this.lastSnapshottedContent = revision.content
    this.options.onRevisionCreated?.(revision)
    return revision
  }

  async createCopy(metadata: DraftMetadata = {}): Promise<StoredDraft> {
    try { await this.flush() }
    catch (error) { if (!(error instanceof DraftConflictError)) throw error }
    return createWorkspaceDocument(this.content, { ...this.metadata, ...metadata })
  }

  async restore(revisionId: string): Promise<RestoredRevision> {
    await this.flush()
    const restored = await restoreRevision(revisionId, this.content, this.metadata, this.version, this.documentId)
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
