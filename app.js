const QUESTIONS = QUESTIONS_A.concat(QUESTIONS_B);
(function () {
  const STORAGE_KEY = "ohioDriversQuiz_v1";
  const MASTER_STREAK = 3;
  const SESSION_LEN = 20;

  const $ = (id) => document.getElementById(id);
  const screens = {
    start: $("screen-start"),
    quiz: $("screen-quiz"),
    results: $("screen-results")
  };

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.items && typeof s.counter === "number") return s;
      }
    } catch (e) {}
    return freshState();
  }

  function freshState() {
    return {
      items: {},
      counter: 0,
      recent: [],
      session: null,
      theme: "light"
    };
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function item(id) {
    if (!state.items[id]) {
      state.items[id] = {
        streak: 0,
        misses: 0,
        seen: 0,
        lastSeen: -999,
        lastWrongAt: null,
        lastCorrectAt: null,
        mastered: false,
        everMissed: false,
        dueAt: 0
      };
    }
    return state.items[id];
  }

  function masteredCount() {
    return QUESTIONS.filter((q) => item(q.id).mastered).length;
  }

  function hasProgress() {
    return QUESTIONS.some((q) => item(q.id).seen > 0);
  }

  function updateProgressUI() {
    const m = masteredCount();
    const t = QUESTIONS.length;
    $("mastered-count").textContent = String(m);
    $("total-count").textContent = String(t);
    $("progress-fill").style.width = ((m / t) * 100).toFixed(1) + "%";
    const seen = QUESTIONS.filter((q) => item(q.id).seen > 0).length;
    const missed = QUESTIONS.filter((q) => item(q.id).misses > 0 && !item(q.id).mastered).length;
    $("progress-sub").textContent = seen
      ? seen + " seen · " + missed + " still shaky"
      : "No questions answered yet";
  }

  function show(name) {
    Object.keys(screens).forEach((k) => screens[k].classList.toggle("hidden", k !== name));
  }

  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute("data-theme", theme === "dark" ? "dark" : "light");
    $("theme-btn").textContent = theme === "dark" ? "Light" : "Dark";
    save();
  }

  function scheduleAfter(it, correct) {
    const c = state.counter;
    if (!correct) {
      it.dueAt = c + 3 + Math.floor(Math.random() * 4);
      return;
    }
    if (it.streak === 1) it.dueAt = c + 8 + Math.floor(Math.random() * 5);
    else if (it.streak === 2) it.dueAt = c + 16 + Math.floor(Math.random() * 8);
    else it.dueAt = c + 28 + Math.floor(Math.random() * 18);
  }

  function weightFor(q, mode, lastId) {
    const it = item(q.id);
    const due = it.seen === 0 || state.counter >= it.dueAt;
    let w = due ? 1 : 0.015;
    if (it.seen === 0) w *= 9;
    w *= it.misses + 1;
    if (it.lastWrongAt !== null) {
      const sinceWrong = state.counter - it.lastWrongAt;
      if (sinceWrong >= 2 && sinceWrong <= 6) w *= 12;
      else if (sinceWrong <= 12) w *= 5;
      else w *= 2;
    }
    if (it.streak === 1) w *= 0.42;
    if (it.streak === 2) w *= 0.2;
    if (it.mastered) w *= 0.08;
    if (mode === "weak") {
      if (it.misses > 0) w *= 3.2;
      if (it.seen === 0) w *= 1.6;
      if (it.mastered && !it.everMissed) w *= 0.02;
      if (it.misses === 0 && it.streak > 0) w *= 0.12;
    }
    if (q.id === lastId) w *= 0.01;
    return Math.max(w, 0.0001);
  }

  function weightedPick(pool, mode, lastId) {
    let total = 0;
    const scored = pool.map((q) => {
      const w = weightFor(q, mode, lastId);
      total += w;
      return { q, w };
    });
    let r = Math.random() * total;
    for (let i = 0; i < scored.length; i++) {
      r -= scored[i].w;
      if (r <= 0) return scored[i].q;
    }
    return scored[scored.length - 1].q;
  }

  function pickQuestion(mode) {
    const lastId = state.recent[state.recent.length - 1];
    const dueMisses = QUESTIONS.filter((q) => {
      const it = item(q.id);
      return it.misses > 0 && it.streak === 0 && state.counter >= it.dueAt && q.id !== lastId;
    });
    if (dueMisses.length && Math.random() < 0.85) return weightedPick(dueMisses, mode, lastId);
    if (mode === "weak") {
      const weak = QUESTIONS.filter((q) => {
        const it = item(q.id);
        return !it.mastered || it.everMissed;
      });
      return weightedPick(weak.length ? weak : QUESTIONS, mode, lastId);
    }
    return weightedPick(QUESTIONS, mode, lastId);
  }

  function startSession(mode) {
    state.session = {
      mode: mode,
      asked: 0,
      correct: 0,
      missedIds: [],
      limit: mode === "full" ? Infinity : SESSION_LEN
    };
    save();
    nextQuestion();
  }

  let current = null;
  let locked = false;

  function nextQuestion() {
    if (state.session && state.session.asked >= state.session.limit) {
      showResults();
      return;
    }
    current = pickQuestion(state.session ? state.session.mode : "session");
    locked = false;
    renderQuestion(current);
    show("quiz");
  }

  function renderQuestion(q) {
    const sess = state.session;
    const n = sess ? sess.asked + 1 : 1;
    const denom = sess && isFinite(sess.limit) ? sess.limit : "\u221e";
    $("q-pos").textContent = "Question " + n + (isFinite(denom) ? " of " + denom : "");
    $("q-section").textContent = q.section;
    $("q-text").textContent = q.question;
    $("feedback").className = "feedback hidden";
    $("next-wrap").classList.add("hidden");
    const box = $("choices");
    box.innerHTML = "";
    q.choices.forEach((text, i) => {
      const b = document.createElement("button");
      b.className = "choice";
      b.type = "button";
      b.dataset.index = String(i);
      b.innerHTML = '<span class="key">' + (i + 1) + "</span><span>" + escapeHtml(text) + "</span>";
      b.addEventListener("click", () => answer(i));
      box.appendChild(b);
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function answer(index) {
    if (locked || !current) return;
    locked = true;
    const q = current;
    const it = item(q.id);
    const correct = index === q.correctIndex;
    it.seen += 1;
    it.lastSeen = state.counter;
    state.counter += 1;
    state.recent.push(q.id);
    if (state.recent.length > 12) state.recent.shift();
    if (correct) {
      it.streak += 1;
      it.lastCorrectAt = state.counter;
      if (it.streak >= MASTER_STREAK) it.mastered = true;
      if (state.session) state.session.correct += 1;
    } else {
      it.streak = 0;
      it.misses += 1;
      it.everMissed = true;
      it.mastered = false;
      it.lastWrongAt = state.counter;
      if (state.session && state.session.missedIds.indexOf(q.id) === -1) {
        state.session.missedIds.push(q.id);
      }
    }
    scheduleAfter(it, correct);
    if (state.session) state.session.asked += 1;
    save();
    updateProgressUI();
    const buttons = Array.from(document.querySelectorAll(".choice"));
    buttons.forEach((b) => {
      const i = Number(b.dataset.index);
      b.disabled = true;
      if (i === q.correctIndex) b.classList.add("is-correct");
      if (i === index && !correct) b.classList.add("is-wrong");
    });
    const fb = $("feedback");
    fb.className = "feedback " + (correct ? "ok" : "bad");
    fb.innerHTML = "<strong>" + (correct ? "Correct" : "Not quite") + "</strong>" + escapeHtml(q.explanation);
    $("next-wrap").classList.remove("hidden");
    $("next-btn").textContent = state.session && state.session.asked >= state.session.limit ? "See results" : "Next";
    $("next-btn").focus();
  }

  function showResults() {
    const sess = state.session || { asked: 0, correct: 0, missedIds: [] };
    const asked = sess.asked || 0;
    const correct = sess.correct || 0;
    const pct = asked ? Math.round((correct / asked) * 100) : 0;
    $("score-big").textContent = correct + " / " + asked;
    $("score-sub").textContent = pct + "% this session \u00b7 " + masteredCount() + " of " + QUESTIONS.length + " solid (3 in a row)";
    const list = $("miss-topics");
    list.innerHTML = "";
    if (!sess.missedIds.length) {
      const li = document.createElement("li");
      li.textContent = "No misses this session. Rights will still come back later to confirm they stuck.";
      list.appendChild(li);
    } else {
      sess.missedIds.forEach((id) => {
        const q = QUESTIONS.find((x) => x.id === id);
        if (!q) return;
        const li = document.createElement("li");
        li.innerHTML = "<strong>" + escapeHtml(q.section) + "</strong> \u2014 " + escapeHtml(q.question);
        list.appendChild(li);
      });
    }
    $("keep-misses").classList.toggle("hidden", sess.missedIds.length === 0);
    show("results");
    updateProgressUI();
  }

  function resetAll() {
    if (!confirm("Clear all quiz progress on this device?")) return;
    const theme = state.theme;
    state = freshState();
    state.theme = theme;
    save();
    updateStart();
    updateProgressUI();
    show("start");
  }

  function updateStart() {
    const resume = hasProgress();
    $("resume-btn").classList.toggle("hidden", !resume);
    $("weak-btn").classList.toggle("hidden", !resume);
    $("reset-btn").classList.toggle("hidden", !resume);
    $("start-btn").textContent = resume ? "New 20-question session" : "Start quiz";
  }

  document.addEventListener("keydown", (e) => {
    if (screens.quiz.classList.contains("hidden")) {
      if (e.key === "Enter" && !screens.results.classList.contains("hidden")) return;
      return;
    }
    if (!locked && ["1", "2", "3", "4"].indexOf(e.key) !== -1) {
      answer(Number(e.key) - 1);
      e.preventDefault();
    } else if (locked && (e.key === "Enter" || e.key === " ")) {
      nextQuestion();
      e.preventDefault();
    }
  });

  $("start-btn").addEventListener("click", () => startSession("session"));
  $("resume-btn").addEventListener("click", () => startSession("session"));
  $("weak-btn").addEventListener("click", () => startSession("weak"));
  $("full-btn").addEventListener("click", () => startSession("full"));
  $("next-btn").addEventListener("click", () => nextQuestion());
  $("again-btn").addEventListener("click", () => startSession("session"));
  $("keep-misses").addEventListener("click", () => startSession("weak"));
  $("home-btn").addEventListener("click", () => {
    updateStart();
    show("start");
  });
  $("reset-btn").addEventListener("click", resetAll);
  $("theme-btn").addEventListener("click", () => {
    applyTheme(state.theme === "dark" ? "light" : "dark");
  });

  let state = loadState();
  applyTheme(state.theme === "dark" ? "dark" : "light");
  updateStart();
  updateProgressUI();
  show("start");
})();
