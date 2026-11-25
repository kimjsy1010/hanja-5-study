(() => {
  const modes = Object.freeze({
    character: {name: "한자 → 훈음", question: "이 한자의 훈음은 무엇일까요?"},
    meaning: {name: "훈음 → 한자", question: "이 훈음에 해당하는 한자는 무엇일까요?"},
  });
  const goal = 3;
  const clean = meaning => meaning.replace(/\[[^\]]*\]|\([\p{Script=Han}]+\)/gu, "").trim();
  const normalize = value => value.normalize("NFKC").replace(/[\s()[\]·]/gu, "");

  function readings(entry) {
    const studyMeanings = clean(entry.meaning).split("·");
    const sounds = new Set([entry.reading, ...entry.sounds.split("·")]);
    const pairs = studyMeanings.flatMap(meaning =>
      [...sounds].filter(Boolean).map(sound => normalize(meaning + sound)));
    for (const alternate of entry.other.split(" / ").filter(Boolean)) {
      const separator = alternate.lastIndexOf(" ");
      const alternateMeanings = clean(alternate.slice(0, separator)).split("·");
      for (const meaning of alternateMeanings) {
        for (const sound of alternate.slice(separator + 1).split("·")) {
          pairs.push(normalize(meaning + sound));
        }
      }
    }
    return new Set(pairs);
  }

  function prepare(raw) {
    return raw.map(entry => ({
      ...entry,
      label: clean(entry.meaning) + " " + entry.reading,
      written: entry.char.normalize("NFKC"),
      accepted: readings(entry),
    }));
  }

  function emptyProgress() {
    return {character: {}, meaning: {}, correctCounts: {character: 0, meaning: 0}};
  }

  function readCorrectCounts(value) {
    const safe = count => Number.isSafeInteger(count) && count >= 0 ? count : 0;
    return {character: safe(value?.character), meaning: safe(value?.meaning)};
  }

  function parseProgress(value, entries) {
    const saved = JSON.parse(value ?? "null");
    const result = emptyProgress();
    result.correctCounts = readCorrectCounts(saved?.correctCounts);
    for (const mode of Object.keys(modes)) {
      for (const {id} of entries) {
        const count = saved?.[mode]?.[id];
        if (Number.isInteger(count) && count > 0 && count <= goal) {
          result[mode][id] = count;
        }
      }
    }
    return result;
  }

  function streak(progress, mode, id) {
    return progress[mode][id] ?? 0;
  }

  function record(progress, mode, id, correct) {
    if (correct) progress.correctCounts[mode]++;
    const before = streak(progress, mode, id);
    const after = before >= goal ? goal : (correct ? before + 1 : 0);
    if (after) progress[mode][id] = after;
    else delete progress[mode][id];
    return after;
  }

  function completed(entries, progress, mode) {
    return entries.filter(({id}) => mode
      ? streak(progress, mode, id) === goal
      : Object.keys(modes).every(direction => streak(progress, direction, id) === goal));
  }

  function shuffle(items, random) {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  function makeQuestion(entries, progress, mode, random = Math.random) {
    const available = entries.filter(({id}) => streak(progress, mode, id) < goal);
    if (available.length === 0) return null;
    const answer = available[Math.floor(random() * available.length)];
    const answerLabel = normalize(answer.label);
    const candidates = shuffle(entries.filter(entry =>
      entry.written !== answer.written &&
      !answer.accepted.has(normalize(entry.label)) &&
      !entry.accepted.has(answerLabel)), random);
    const used = new Set([mode === "character" ? answerLabel : answer.written]);
    const choices = [answer];
    for (const entry of candidates) {
      const value = mode === "character" ? normalize(entry.label) : entry.written;
      if (used.has(value)) continue;
      choices.push(entry);
      if (choices.length === 4) break;
      used.add(value);
    }
    if (choices.length !== 4) throw new Error("보기 4개를 만들 수 없습니다.");
    return {mode, answer, choices: shuffle(choices, random)};
  }

  globalThis.HanjaQuiz = {modes, goal, prepare, emptyProgress, readCorrectCounts, parseProgress, streak, record, completed, makeQuestion};
})();
