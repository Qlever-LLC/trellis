const DB_NAME = "trellis-auth";
const DB_VERSION = 1;
const STORE_NAME = "keys";
const KEY_ID = "trellis-session-key";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
  });
}

export type StoredKeyPair = {
  id: string;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicKeyRaw: Uint8Array;
  createdAt: number;
};

export async function storeKeyPair(
  keyPair: CryptoKeyPair,
  publicKeyRaw: Uint8Array,
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    const record: StoredKeyPair = {
      id: KEY_ID,
      privateKey: keyPair.privateKey,
      publicKey: keyPair.publicKey,
      publicKeyRaw,
      createdAt: Date.now(),
    };

    const request = store.put(record);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();

    tx.oncomplete = () => db.close();
  });
}

export async function loadKeyPair(): Promise<StoredKeyPair | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);

    const request = store.get(KEY_ID);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result ?? null);

    tx.oncomplete = () => db.close();
  });
}

export async function deleteKeyPair(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    const request = store.delete(KEY_ID);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();

    tx.oncomplete = () => db.close();
  });
}

export async function hasKeyPair(): Promise<boolean> {
  const keyPair = await loadKeyPair();
  return keyPair !== null;
}
