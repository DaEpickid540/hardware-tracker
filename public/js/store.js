// ============================================================
//  store.js — Firebase init + Firestore data layer
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, setDoc, addDoc, updateDoc,
  deleteDoc, query, where, orderBy, onSnapshot, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ── Auth ─────────────────────────────────────────────────────
export function onAuth(cb) { return onAuthStateChanged(auth, cb); }
export function signIn() {
  const provider = new GoogleAuthProvider();
  return signInWithPopup(auth, provider);
}
export function logOut() { return signOut(auth); }
export function currentUser() { return auth.currentUser; }

const uid = () => auth.currentUser?.uid;

// Unified cross-app identity doc — shared with GRIND and ARIA. See
// ../../../personal-suite-schema.md §2. Creates on first sign-in, refreshes
// lastSeenAt + apps.hardware on every subsequent one.
export async function upsertUnifiedUser(user) {
  const ref  = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      uid: user.uid, email: user.email || null,
      displayName: user.displayName, photoURL: user.photoURL,
      customPhotoURL: null,
      apps: { grind: false, hardware: true, aria: false },
      createdAt: serverTimestamp(), lastSeenAt: serverTimestamp(),
    });
  } else {
    await updateDoc(ref, { "apps.hardware": true, lastSeenAt: serverTimestamp() });
  }
}

// ── Live collection subscriptions ────────────────────────────
// Each returns an unsubscribe fn. We sort client-side to avoid
// requiring composite Firestore indexes for first run.
function liveCollection(name, cb) {
  const q = query(collection(db, name), where("uid", "==", uid()));
  return onSnapshot(q, (snap) => {
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) ||
      (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0));
    cb(rows);
  }, (err) => console.error(`[${name}]`, err));
}

export const watchClasses       = (cb) => liveCollection("hw_classes", cb);
export const watchGroups        = (cb) => liveCollection("hw_groups", cb);
export const watchCategories    = (cb) => liveCollection("hw_categories", cb);
export const watchSubcategories = (cb) => liveCollection("hw_subcategories", cb);

export function watchItems(cb) {
  const q = query(collection(db, "hw_items"), where("uid", "==", uid()));
  return onSnapshot(q, (snap) => {
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) =>
      (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) ||
      (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));
    cb(rows);
  }, (err) => console.error("[items]", err));
}

// ── Classes ──────────────────────────────────────────────────
export function addClass(data) {
  return addDoc(collection(db, "hw_classes"), {
    uid: uid(), name: data.name, color: data.color || "#e74c3c",
    icon: data.icon || "fa-layer-group", order: data.order ?? Date.now(),
    createdAtMs: Date.now(), createdAt: serverTimestamp(),
  });
}
export const updateClass = (id, patch) => updateDoc(doc(db, "hw_classes", id), patch);
export const deleteClass = (id) => deleteDoc(doc(db, "hw_classes", id));

// ── Groups (sidebar subsections) ─────────────────────────────
export function addGroup(data) {
  return addDoc(collection(db, "hw_groups"), {
    uid: uid(), name: data.name, order: data.order ?? Date.now(),
    createdAtMs: Date.now(), createdAt: serverTimestamp(),
  });
}
export const updateGroup = (id, patch) => updateDoc(doc(db, "hw_groups", id), patch);
export const deleteGroup = (id) => deleteDoc(doc(db, "hw_groups", id));

// ── Categories ───────────────────────────────────────────────
export function addCategory(data) {
  return addDoc(collection(db, "hw_categories"), {
    uid: uid(), name: data.name, icon: data.icon || "fa-microchip",
    groupId: data.groupId || null,
    order: data.order ?? Date.now(),
    createdAtMs: Date.now(), createdAt: serverTimestamp(),
  });
}
export const updateCategory = (id, patch) => updateDoc(doc(db, "hw_categories", id), patch);
export const deleteCategory = (id) => deleteDoc(doc(db, "hw_categories", id));

// ── Subcategories (nested under a category) ──────────────────
export function addSubcategory(data) {
  return addDoc(collection(db, "hw_subcategories"), {
    uid: uid(), name: data.name, categoryId: data.categoryId,
    order: data.order ?? Date.now(),
    createdAtMs: Date.now(), createdAt: serverTimestamp(),
  });
}
export const updateSubcategory = (id, patch) => updateDoc(doc(db, "hw_subcategories", id), patch);
export const deleteSubcategory = (id) => deleteDoc(doc(db, "hw_subcategories", id));

// ── Items (the "Options") ────────────────────────────────────
export function addItem(data) {
  return addDoc(collection(db, "hw_items"), {
    uid: uid(),
    categoryId:    data.categoryId    || null,
    subcategoryId: data.subcategoryId || null,
    classId:       data.classId       || null,
    groupIds:      data.groupIds      || [],
    name: data.name,
    info: data.info || "",
    link: data.link || "",
    quantity: data.quantity ?? 1,
    mediaType: data.mediaType || "image",   // "image" | "embed"
    photoUrl: data.photoUrl || "",
    embedUrl: data.embedUrl || "",
    pinned: false,
    createdAtMs: Date.now(), createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
export const updateItem = (id, patch) =>
  updateDoc(doc(db, "hw_items", id), { ...patch, updatedAt: serverTimestamp() });
export const deleteItem = (id) => deleteDoc(doc(db, "hw_items", id));
export const togglePin  = (id, pinned) => updateDoc(doc(db, "hw_items", id), { pinned });

// ── Settings (AI provider + keys + theme) ────────────────────
//  Split across the shared personal-suite collections (see
//  ../../../personal-suite-schema.md §3) so GRIND and ARIA can read/write the
//  same theme/provider prefs and encrypted key store instead of each app
//  keeping its own copy. External shape is unchanged — callers still get one
//  flat { theme, aiProvider, models, searchProvider, apiKeys, encrypted } object.
export async function getSettings() {
  const [prefsSnap, keysSnap] = await Promise.all([
    getDoc(doc(db, "user_preferences", uid())),
    getDoc(doc(db, "user_apikeys", uid())),
  ]);

  // One-time self-migration: settings written before this split still live in
  // hw_userSettings. If the new docs don't exist yet, read the old doc once,
  // copy it into the new collections, and keep using it going forward — no
  // Admin SDK migration script needed, and the account never appears to lose
  // its saved keys/theme when this shipped.
  if (!prefsSnap.exists() && !keysSnap.exists()) {
    const legacySnap = await getDoc(doc(db, "hw_userSettings", uid()));
    if (legacySnap.exists()) {
      const legacy = legacySnap.data();
      const { apiKeys, encrypted, ...prefs } = legacy;
      await saveSettings({ ...prefs, apiKeys: apiKeys || {}, encrypted: encrypted || false });
      return { ...prefs, apiKeys: apiKeys || {}, encrypted: encrypted || false };
    }
  }

  const prefs = prefsSnap.exists() ? prefsSnap.data() : {};
  const keysDoc = keysSnap.exists() ? keysSnap.data() : {};
  return { ...prefs, apiKeys: keysDoc.keys || {}, encrypted: keysDoc.encrypted || false };
}
export function saveSettings(patch) {
  const { apiKeys, encrypted, ...prefs } = patch;
  const writes = [];
  if (Object.keys(prefs).length) {
    writes.push(setDoc(doc(db, "user_preferences", uid()), { ...prefs, updatedAt: serverTimestamp() }, { merge: true }));
  }
  if (apiKeys !== undefined || encrypted !== undefined) {
    const keysPatch = { updatedAt: serverTimestamp() };
    if (apiKeys !== undefined) keysPatch.keys = apiKeys;
    if (encrypted !== undefined) keysPatch.encrypted = encrypted;
    writes.push(setDoc(doc(db, "user_apikeys", uid()), keysPatch, { merge: true }));
  }
  return Promise.all(writes);
}

// ── ARIA conversations ───────────────────────────────────────
export function watchConversations(cb) {
  const q = query(collection(db, "hw_conversations"), where("uid", "==", uid()));
  return onSnapshot(q, (snap) => {
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0));
    cb(rows);
  }, (err) => console.error("[conversations]", err));
}
export function createConversation(title) {
  return addDoc(collection(db, "hw_conversations"), {
    uid: uid(), title: title || "New chat", messages: [],
    createdAtMs: Date.now(), updatedAtMs: Date.now(),
  });
}
export function saveConversation(id, messages, title) {
  const patch = { messages, updatedAtMs: Date.now() };
  if (title) patch.title = title;
  return updateDoc(doc(db, "hw_conversations", id), patch);
}
export const deleteConversation = (id) => deleteDoc(doc(db, "hw_conversations", id));
