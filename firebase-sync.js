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

function connectDocuments(onChange) {
  let levels = [];
  let authReady = false;
  let uid = null;
  let phase = "initializing";
  const savedLevels = new Map();
  let watches = [];
  let generation = 0;

  function referenceFor(owner, target) {
    return target.legacy
      ? doc(db, "studyProgress", owner)
      : doc(db, "studyProgress", owner, "levels", target.id);
  }

  function readDocument(snapshot, target) {
    const source = snapshot.data();
    const progress = emptyProgress();
    progress.correctCounts = readCorrectCounts(source?.correctCounts);
    for (const direction of directions) {
      for (const {id} of target.entries) {
        const count = source?.[direction]?.[id];
        if (Number.isInteger(count) && count >= 0 && count <= goal) progress[direction][id] = count;
      }
    }
    return {progress, revision: source?.revision ?? 0};
  }

  function publish(nextPhase) {
    phase = nextPhase;
    const progressByLevel = Object.fromEntries(
      [...savedLevels].map(([id, {progress}]) => [id, progress])
    );
    onChange({phase, uid, progressByLevel});
  }

  function accept(target, saved, current) {
    if (current !== generation || saved.revision <= (savedLevels.get(target.id)?.revision ?? -1)) return;
    savedLevels.set(target.id, saved);
    if (phase === "ready") publish("ready");
  }

  async function load(user) {
    const current = ++generation;
    for (const unwatch of watches) unwatch();
    watches = [];
    savedLevels.clear();
    uid = user?.uid ?? null;
    if (!authReady) return;
    if (!uid) {
      publish("guest");
      return;
    }
    if (!levels.length) {
      publish("ready");
      return;
    }
    publish("loading");
    try {
      const documents = await Promise.all(levels.map(async target => {
        const reference = referenceFor(uid, target);
        const saved = readDocument(await getDocFromServer(reference), target);
        return {target, reference, saved};
      }));
      if (current !== generation) return;
      for (const {target, saved} of documents) accept(target, saved, current);
      watches = documents.map(({target, reference}) => onSnapshot(reference, snapshot => {
        if (!snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites) {
          accept(target, readDocument(snapshot, target), current);
        }
      }, () => {
        if (current === generation) publish("error");
      }));
      publish("ready");
    } catch {
      if (current === generation) publish("error");
    }
  }

  async function update(target, change) {
    const current = generation;
    const owner = uid;
    if (phase !== "ready" || !levels.includes(target) || !owner || auth.currentUser?.uid !== owner) {
      throw new Error("No active study account.");
    }
    const reference = referenceFor(owner, target);
    const saved = await runTransaction(db, async transaction => {
      if (generation !== current || auth.currentUser?.uid !== owner) throw new Error("Study account changed.");
      const {progress, revision: previous} = readDocument(await transaction.get(reference), target);
      if (generation !== current || auth.currentUser?.uid !== owner) throw new Error("Study account changed.");
      const {changed, result} = change(progress, target.entries);
      const next = previous + Number(changed);
      if (changed) transaction.set(reference, {...progress, revision: next});
      return {progress, revision: next, result};
    });
    if (auth.currentUser?.uid !== owner) throw new Error("Study account changed.");
    accept(target, saved, current);
    return saved.result;
  }

  onAuthStateChanged(auth, user => {
    authReady = true;
    return load(user);
  });
  return {
    login() {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({prompt: "select_account"});
      return signInWithPopup(auth, provider);
    },
    logout() { return signOut(auth); },
    retry() { return load(auth.currentUser); },
    selectLevels(targets) {
      levels = targets;
      return load(auth.currentUser);
    },
    answer(target, direction, id, correct) {
      return update(target, progress => {
        const count = record(progress, direction, id, correct);
        // An attempted item stays present even when its streak returns to zero.
        progress[direction][id] = count;
        return {changed: true, result: count};
      });
    },
    importGuest(target, guest) {
      return update(target, (progress, entries) => {
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

export function connectDashboard(levels, onChange) {
  const connection = connectDocuments(onChange);
  connection.selectLevels(levels);
  return connection;
}

// Keep the earlier single-grade interface available for cached versions of the app.
export function connectProgress(entriesOrChange, legacyChange) {
  const onChange = legacyChange ?? entriesOrChange;
  let level = legacyChange ? {id: "grade5", legacy: true, entries: entriesOrChange} : null;
  const connection = connectDocuments(({progressByLevel, ...account}) =>
    onChange({...account, progress: progressByLevel[level?.id]})
  );
  if (level) connection.selectLevels([level]);
  return {
    login: connection.login,
    logout: connection.logout,
    retry: connection.retry,
    select(target) {
      if (level === target) return;
      level = target;
      return connection.selectLevels(target ? [target] : []);
    },
    answer(direction, id, correct) { return connection.answer(level, direction, id, correct); },
    importGuest(guest) { return connection.importGuest(level, guest); },
  };
}
