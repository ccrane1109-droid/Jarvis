/* ==========================================================================
   JARVIS — AI Video blob storage
   Thin IndexedDB wrapper for binary assets (voiceover audio, images, video
   clips, exported renders) that are too large for localStorage. Project
   metadata (scripts, captions, timings) stays in localStorage as JSON and
   just references these blobs by id.
   ========================================================================== */

(function () {
  "use strict";

  const DB_NAME = "jarvisVideoBlobs";
  const STORE_NAME = "blobs";
  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = function () {
        request.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
    return dbPromise;
  }

  function putBlob(id, blob) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(blob, id);
        tx.oncomplete = function () { resolve(id); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function getBlob(id) {
    if (!id) return Promise.resolve(null);
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(id);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function deleteBlob(id) {
    if (!id) return Promise.resolve();
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete(id);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  window.JarvisBlobStore = { putBlob: putBlob, getBlob: getBlob, deleteBlob: deleteBlob };
})();
