(() => {
  const {modes, goal, prepare, emptyProgress, parseProgress, streak, record, completed, makeQuestion} = HanjaQuiz;
  const entries = prepare(window.HANJA_DATA);
  const key = "hanja-five-progress-v1";
  const app = document.getElementById("app");
  const home = document.getElementById("home-template");
  const mastery = document.getElementById("header-mastery");
  const cloudPanel = document.getElementById("cloud-panel");
  const cloudStatus = document.getElementById("cloud-status");
  const cloudMessage = document.getElementById("cloud-message");
  const cloudAction = document.getElementById("cloud-action");
  const cloudRetry = document.getElementById("cloud-retry");
  const cloudImport = document.getElementById("cloud-import");
  let progress = emptyProgress();
  let storageAvailable = true;
  let account = {phase: "guest", uid: null};
  let cloud;
  let cloudBusy = false;
  let view = "home";
  let question;
  let options = [];
  let busy = false;
  let answered = false;

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function button(label, className, action) {
    const element = node("button", className, label);
    element.type = "button";
    element.addEventListener("click", action);
    return element;
  }

  function loadGuest() {
    if (!storageAvailable) return null;
    try {
      return parseProgress(localStorage.getItem(key), entries);
    } catch {
      storageAvailable = false;
      return null;
    }
  }

  function refreshProgress() {
    if (!account.uid) progress = loadGuest() ?? progress;
  }

  async function storeAnswer(active, selected) {
    const correct = selected.id === active.answer.id;
    if (account.uid) {
      if (account.phase !== "ready") throw new Error("Study account unavailable.");
      const count = await cloud.answer(active.mode, active.answer.id, correct);
      return {correct, count};
    }
    const update = () => {
      refreshProgress();
      const count = record(progress, active.mode, active.answer.id, correct);
      if (storageAvailable) {
        try {
          localStorage.setItem(key, JSON.stringify(progress));
        } catch {
          storageAvailable = false;
        }
      }
      return {correct, count};
    };
    if (navigator.locks && location.protocol !== "file:") {
      return navigator.locks.request(key, update);
    }
    return update();
  }

  function updateHeader() {
    mastery.textContent = completed(entries, progress).length;
    const counts = progress.correctCounts;
    const total = counts.character + counts.meaning;
    for (const number of app.querySelectorAll("[data-correct]")) {
      const count = number.dataset.correct === "total" ? total : counts[number.dataset.correct];
      number.textContent = count.toLocaleString("ko-KR") + "원";
    }
  }

  function storageNotice() {
    if (account.uid) return node("p", "storage-note", "같은 Google 계정으로 로그인하면 다른 기기에서도 이어서 공부할 수 있습니다.");
    return node("p", "storage-note", storageAvailable
      ? "학습 진도는 이 브라우저에 저장됩니다."
      : "이 브라우저에 진도를 저장할 수 없습니다. 이 창을 닫으면 현재 기록이 사라집니다.");
  }

  function setView(name, ...children) {
    view = name;
    app.replaceChildren(...children);
    updateHeader();
  }

  function focus(element) {
    element.tabIndex = -1;
    element.focus();
  }

  function showHome(moveFocus = true) {
    refreshProgress();
    const fragment = home.content.cloneNode(true);
    fragment.getElementById("storage-note").replaceWith(storageNotice());
    for (const mode of Object.keys(modes)) {
      const count = completed(entries, progress, mode).length;
      fragment.querySelector(`[data-progress="${mode}"]`).value = count;
      fragment.querySelector(`[data-progress-text="${mode}"]`).textContent = `${count} / ${entries.length}`;
      const start = fragment.querySelector(`[data-mode="${mode}"]`);
      start.disabled = account.phase === "loading" || account.phase === "error";
      if (count === entries.length) start.textContent = `${modes[mode].name} 완료`;
      start.addEventListener("click", () => nextQuestion(mode));
    }
    setView("home", fragment);
    if (moveFocus) focus(document.getElementById("hero-title"));
  }

  function exampleLine(entry) {
    const line = node("p", "examples");
    entry.examples.forEach((word, index) => {
      if (index) line.append(node("span", "separator", " · "));
      const item = node("span", "example");
      for (const char of word) {
        if (char.normalize("NFKC") === entry.written) item.append(node("strong", "example-hanja", char));
        else item.append(char);
      }
      line.append(item);
    });
    return line;
  }

  function studyEntry(entry, caption) {
    const row = node("div", "study-entry");
    const content = node("div", "study-entry-content");
    if (caption) content.append(node("p", "study-caption", caption));
    const identity = node("div", "study-identity");
    identity.append(node("p", "study-label", entry.label));
    if (entry.radical) {
      identity.append(node("span", "study-radical", `부수 ${entry.radical} · ${entry.radicalName}`));
    }
    content.append(identity);
    if (entry.hint) {
      const hint = node("p", "study-hint");
      hint.append(node("strong", "study-hint-type", entry.hintType), " ", entry.hint);
      content.append(hint);
    }
    content.append(exampleLine(entry));
    row.append(node("span", "study-hanja", entry.char), content);
    return row;
  }

  function showLibrary() {
    refreshProgress();
    const known = completed(entries, progress);
    const page = node("section", "library");
    const heading = node("h1", "", "내가 익힌 한자");
    page.append(button("홈", "quiet", () => showHome()), heading,
      node("p", "page-note", `두 방향에서 모두 익힌 한자 ${known.length} / ${entries.length}`));
    if (known.length) {
      const list = node("ul", "library-grid");
      for (const entry of known) {
        const item = node("li", "library-item");
        item.append(studyEntry(entry, entry.grade));
        list.append(item);
      }
      page.append(list);
    } else {
      const empty = node("div", "empty-panel");
      empty.append(node("span", "empty-mark", "習"),
        node("p", "", "같은 글자를 두 방향에서 각각 3번 연속 맞히면 여기에 모입니다."),
        button("학습 모드 선택", "primary", () => showHome()));
      page.append(empty);
    }
    setView("library", page);
    focus(heading);
  }

  function renderComplete(mode) {
    const page = node("section", "empty-panel completed-panel");
    const heading = node("h1", "", `${modes[mode].name} 완료!`);
    const other = mode === "character" ? "meaning" : "character";
    page.append(node("span", "empty-mark", "成"), heading,
      node("p", "", `이 방향에서 한자 ${entries.length}자를 모두 익혔어요.`));
    if (completed(entries, progress, other).length < entries.length) {
      page.append(button(modes[other].name + " 시작", "primary", () => nextQuestion(other)));
    }
    page.append(button("내가 익힌 한자", "quiet", showLibrary),
      button("홈", "quiet", () => showHome()));
    setView("complete", page);
    focus(heading);
  }

  function nextQuestion(mode) {
    if (account.phase === "loading" || account.phase === "error") {
      showHome();
      return;
    }
    refreshProgress();
    question = makeQuestion(entries, progress, mode);
    if (!question) {
      renderComplete(mode);
      return;
    }
    answered = false;
    busy = false;
    const page = node("section", `quiz ${mode === "character" ? "mode-blue" : "mode-green"}`);
    const toolbar = node("div", "quiz-toolbar");
    const progressLabel = node("p", "quiz-progress");
    const score = node("p", "quiz-score");
    const scoreCount = node("strong", "", "0원");
    scoreCount.dataset.correct = "total";
    score.append("누적 적립금 ", scoreCount);
    const progressBar = node("progress", "quiz-progress-bar");
    progressBar.max = entries.length;
    progressBar.setAttribute("aria-label", "이 방향에서 익힌 한자 수");
    const update = () => {
      const count = completed(entries, progress, mode).length;
      progressLabel.textContent = `익힌 한자 ${count} / ${entries.length}`;
      progressBar.value = count;
    };
    update();
    toolbar.append(button("홈", "quiet", () => showHome()), node("h1", "", modes[mode].name), progressLabel);
    const card = node("div", "question-card");
    const heading = node("h2", "", modes[mode].question);
    const clue = node("p", mode === "character" ? "clue glyph" : "clue",
      mode === "character" ? question.answer.char : question.answer.label);
    clue.id = "clue";
    heading.setAttribute("aria-describedby", clue.id);
    card.append(heading, clue);
    const list = node("div", "choices");
    const feedback = node("section", "feedback");
    feedback.hidden = true;
    options = question.choices.map((entry, index) => {
      const option = button("", "choice", () => reveal(question, entry, feedback, update));
      option.append(node("span", "choice-number", index + 1),
        node("span", mode === "meaning" ? "choice-value hanja-choice" : "choice-value",
          mode === "meaning" ? entry.char : entry.label));
      list.append(option);
      return option;
    });
    page.append(toolbar, progressBar, score, card, list, feedback);
    setView("quiz", page);
    focus(heading);
  }

  async function reveal(active, selected, feedback, update) {
    if (busy || answered || view !== "quiz") return;
    busy = true;
    let result;
    try {
      result = await storeAnswer(active, selected);
    } catch {
      busy = false;
      if (view !== "quiz" || question !== active) return;
      const notice = node("p", "storage-note", account.uid
        ? "계정에 답을 저장하지 못했습니다. 인터넷 연결을 확인하고 보기를 다시 눌러 주세요."
        : "답을 기록하지 못했습니다. 보기를 다시 눌러 주세요.");
      notice.setAttribute("role", "status");
      feedback.replaceChildren(notice);
      feedback.hidden = false;
      return;
    }
    updateHeader();
    if (view !== "quiz" || question !== active) return;
    answered = true;
    busy = false;
    const {correct, count} = result;
    const title = node("h2", "feedback-title", correct ? (count === goal ? "이 방향에서 익혔어요!" : "정답이에요!") : "정답을 확인해 보세요");
    if (correct) title.append(node("span", "score-gain", "+1원"));
    const status = count === goal && !correct
      ? "이 글자는 다른 기기에서 이미 익혔어요."
      : count === goal
      ? (completed([active.answer], progress).length
        ? "두 방향 모두 완료했어요. ‘내가 익힌 한자’에 추가됐어요."
        : "3회 연속 정답이에요. 이 방향의 출제에서 빠집니다.")
      : (correct ? `이 글자에서 ${count}회 연속 정답` : "이 글자의 연속 정답 기록이 0회가 됐어요.");
    feedback.className = `feedback ${correct ? "correct" : "incorrect"}`;
    const details = node("div", "feedback-details");
    details.tabIndex = 0;
    details.setAttribute("role", "region");
    details.setAttribute("aria-label", "정답과 예시 풀이");
    details.append(studyEntry(active.answer, "정답"));
    if (!correct) details.append(studyEntry(selected, "내가 고른 답"));
    if (!account.uid && !storageAvailable) details.append(storageNotice());
    feedback.replaceChildren(title, node("p", "feedback-status", status), details,
      button("다음 문제", "primary", () => nextQuestion(active.mode)));
    for (const [index, option] of options.entries()) {
      const entry = active.choices[index];
      option.disabled = true;
      if (entry.id === active.answer.id) {
        option.classList.add("option-correct");
        option.append(node("span", "choice-status", "정답"));
      } else if (entry.id === selected.id) {
        option.classList.add("option-incorrect");
        option.append(node("span", "choice-status", "선택한 답"));
      }
    }
    update();
    feedback.hidden = false;
    focus(title);
  }

  document.getElementById("brand").addEventListener("click", () => showHome());
  document.getElementById("open-library").addEventListener("click", showLibrary);
  window.addEventListener("keydown", event => {
    if (view !== "quiz" || answered || busy || event.repeat || event.altKey || event.ctrlKey ||
        event.metaKey || !/^[1-4]$/.test(event.key)) return;
    event.preventDefault();
    options[Number(event.key) - 1].click();
  });
  window.addEventListener("storage", event => {
    if (event.key !== key && event.key !== null) return;
    refreshProgress();
    updateHeader();
    updateCloudPanel();
    if (view === "home") showHome(false);
  });

  function updateCloudPanel() {
    if (cloudPanel.hidden) return;
    const {phase, uid} = account;
    const messages = {
      initializing: "계정 연결을 확인하는 중…",
      guest: "다른 기기에서도 이어서 공부하려면 로그인하세요.",
      loading: "Google 계정의 학습 진도를 불러오는 중…",
      ready: "Google 계정으로 학습 진도를 저장합니다.",
      error: "계정의 학습 진도를 불러오지 못했습니다.",
      unavailable: "계정 연결을 시작하지 못했습니다. 새로고침 후 다시 시도해 주세요.",
    };
    cloudStatus.textContent = messages[phase];
    cloudAction.textContent = uid ? "로그아웃" : "Google 로그인";
    cloudAction.disabled = !cloud || phase === "initializing" || cloudBusy;
    cloudRetry.hidden = phase !== "error";
    cloudRetry.disabled = cloudBusy;
    const local = phase === "ready" && loadGuest();
    cloudImport.hidden = !local || !Object.keys(modes).some(mode =>
      Object.keys(local[mode]).some(id => progress[mode][id] === undefined));
    cloudImport.disabled = cloudBusy;
  }

  function onAccountChange(next) {
    const switched = account.uid !== next.uid;
    account = next;
    if (switched) progress = emptyProgress();
    if (next.progress) progress = next.progress;
    refreshProgress();
    updateCloudPanel();
    if (switched || view === "home") showHome(false);
    else if (view === "library") showLibrary();
    else updateHeader();
  }

  async function cloudInteraction(action) {
    if (!cloud || cloudBusy) return;
    cloudBusy = true;
    cloudMessage.hidden = true;
    updateCloudPanel();
    try {
      const message = await action();
      if (message) {
        cloudMessage.textContent = message;
        cloudMessage.hidden = false;
      }
    } catch (error) {
      cloudMessage.textContent = error.code === "auth/popup-blocked"
        ? "브라우저에서 팝업을 허용하고 Google 로그인을 다시 눌러 주세요."
        : "계정 작업을 완료하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.";
      cloudMessage.hidden = false;
    } finally {
      cloudBusy = false;
      updateCloudPanel();
    }
  }

  cloudAction.addEventListener("click", () => cloudInteraction(() => account.uid
    ? cloud.logout()
    : cloud.login().then(() => undefined)));
  cloudRetry.addEventListener("click", () => cloudInteraction(() => cloud.retry()));
  cloudImport.addEventListener("click", () => cloudInteraction(async () => {
    const imported = await cloud.importGuest(loadGuest() ?? emptyProgress());
    return imported ? `이 브라우저의 학습 기록 ${imported}개를 가져왔습니다.` : "가져올 새 학습 기록이 없습니다.";
  }));
  showHome(false);
  if (/^https?:$/.test(location.protocol)) {
    account = {phase: "initializing", uid: null};
    cloudPanel.hidden = false;
    updateCloudPanel();
    import("./firebase-sync.js").then(({connectProgress}) => {
      cloud = connectProgress(entries, onAccountChange);
      updateCloudPanel();
    }).catch(() => onAccountChange({phase: "unavailable", uid: null}));
  }
})();
