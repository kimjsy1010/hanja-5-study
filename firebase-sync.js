import { initializeApp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut }
  from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";
import { doc, getDocFromServer, getFirestore, onSnapshot, runTransaction }
  from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

const app = initializeApp({
  apiKey: "AIzaSyBp8syUAkkSiGZQGkpvdka8q3ueil53mV4",
  authDomain: "hanja-5-master-seojining.firebaseapp.com",
  projectId: "hanja-5-master-seojining",
  appId: "1:115222864849:web:794631c45814c5ef7236f0",
});
const auth = getAuth(app);
auth.languageCode = "ko";
const db = getFirestore(app);
const directions = ["character", "meaning"];
const {emptyProgress, readCorrectCounts, goal, record} = globalThis.HanjaQuiz;

export function connectProgress(entries, onChange) {
  let uid = null;
  let revision = -1;
  let watch;
  let generation = 0;

  function readDocument(snapshot) {
    const source = snapshot.data();
    const progress = emptyProgress();
    progress.correctCounts = readCorrectCounts(source?.correctCounts);
    for (const direction of directions) {
      for (const {id} of entries) {
        const count = source?.[direction]?.[id];
        if (Number.isInteger(count) && count >= 0 && count <= goal) progress[direction][id] = count;
      }
    }
    return {progress, revision: source?.revision ?? 0};
  }

  function accept(saved, current) {
    if (current !== generation || saved.revision < revision) return;
    revision = saved.revision;
    onChange({phase: "ready", uid, progress: saved.progress});
  }

  async function load(user) {
    const current = ++generation;
    watch?.();
    watch = undefined;
    uid = user?.uid ?? null;
    revision = -1;
    if (!uid) {
      onChange({phase: "guest", uid});
      return;
    }
    onChange({phase: "loading", uid});
    const reference = doc(db, "studyProgress", uid);
    try {
      accept(readDocument(await getDocFromServer(reference)), current);
      if (current !== generation) return;
      watch = onSnapshot(reference, snapshot => {
        if (!snapshot.metadata.fromCache) accept(readDocument(snapshot), current);
      }, () => {
        if (current === generation) onChange({phase: "error", uid});
      });
    } catch {
      if (current === generation) onChange({phase: "error", uid});
    }
  }

  async function update(change) {
    const current = generation;
    const owner = uid;
    if (!owner || auth.currentUser?.uid !== owner) throw new Error("No active study account.");
    const reference = doc(db, "studyProgress", owner);
    const saved = await runTransaction(db, async transaction => {
      if (generation !== current || auth.currentUser?.uid !== owner) throw new Error("Study account changed.");
      const {progress, revision: previous} = readDocument(await transaction.get(reference));
      const {changed, result} = change(progress);
      const next = previous + Number(changed);
      if (changed) transaction.set(reference, {...progress, revision: next});
      return {progress, revision: next, result};
    });
    if (generation !== current) throw new Error("Study account changed.");
    accept(saved, current);
    return saved.result;
  }

  onAuthStateChanged(auth, load);
  return {
    login() {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({prompt: "select_account"});
      return signInWithPopup(auth, provider);
    },
    logout() { return signOut(auth); },
    retry() { return load(auth.currentUser); },
    answer(direction, id, correct) {
      return update(progress => {
        const count = record(progress, direction, id, correct);
        // An attempted item stays present even when its streak returns to zero.
        progress[direction][id] = count;
        return {changed: true, result: count};
      });
    },
    importGuest(guest) {
      return update(progress => {
        let imported = 0;
        for (const direction of directions) {
          for (const {id} of entries) {
            if (progress[direction][id] !== undefined || !guest[direction][id]) continue;
            progress[direction][id] = guest[direction][id];
            imported++;
          }
        }
        return {changed: imported > 0, result: imported};
      });
    },
  };
}
