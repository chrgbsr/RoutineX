/* RoutineX — Fixed & Fully Wired (Vanilla JS)
   - Robust drag & drop reordering
   - Add/Edit/Delete tasks
   - Create/Rename/Delete profiles
   - Start/Pause/Reset timer with accurate timing
   - Pre-task announcements, TTS, alarm, and auto triggers
   - Persistent localStorage
*/

(function(){
  "use strict";

  const CONFIG = {
    preTaskAnnounceSeconds: 10,
    autoTriggers: {
      "Morning Routine": "05:00",
      "Night Routine": "22:00"
    },
    alarm: {
      durationSeconds: 15,
      nonStop: true
    },
    storageKey: "routinex.v1"
  };

  // Short helpers
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

  const state = {
    profiles: {},
    currentProfile: null,
    currentIndex: 0,
    remainingMs: 0,
    targetTime: 0,
    intervalId: null,
    preAnnouncedForIndex: null,
    autoTriggerTimers: []
  };

  function defaultProfiles(){
    return {
      "Morning Routine": [
        { name: "Wake & Water", minutes: 5 },
        { name: "Stretch", minutes: 10 },
        { name: "Meditation", minutes: 10 },
        { name: "Plan the day", minutes: 5 }
      ],
      "Night Routine": [
        { name: "Digital sunset", minutes: 10 },
        { name: "Brush & Wash", minutes: 5 },
        { name: "Journaling", minutes: 10 },
        { name: "Read", minutes: 15 }
      ],
      "Custom Routine": []
    };
  }

  function load(){
    try{
      const raw = localStorage.getItem(CONFIG.storageKey);
      if(!raw){
        state.profiles = defaultProfiles();
        state.currentProfile = "Morning Routine";
        persist();
      }else{
        const parsed = JSON.parse(raw);
        state.profiles = parsed.profiles || defaultProfiles();
        state.currentProfile = parsed.currentProfile || Object.keys(state.profiles)[0];
      }
    }catch(e){
      console.warn("Failed to load from storage, using defaults", e);
      state.profiles = defaultProfiles();
      state.currentProfile = "Morning Routine";
    }
  }

  function persist(){
    localStorage.setItem(CONFIG.storageKey, JSON.stringify({
      profiles: state.profiles,
      currentProfile: state.currentProfile
    }));
  }

  // DOM elements
  const elProfile = $("#profileSelect");
  const elTaskList = $("#taskList");
  const elTimeText = $(".time-text");
  const elTaskText = $(".task-text");
  const elIndicator = $(".indicator");
  const elNextUp = $("#nextUp");
  const elAlarm = $("#alarmAudio");

  const btnStart = $("#btnStart");
  const btnPause = $("#btnPause");
  const btnReset = $("#btnReset");
  const btnAddTask = $("#btnAddTask");
  const btnNewProfile = $("#btnNewProfile");
  const btnRenameProfile = $("#btnRenameProfile");
  const btnDeleteProfile = $("#btnDeleteProfile");

  const dlgTask = $("#taskDialog");
  const formTask = $("#taskForm");
  const inputName = $("#taskName");
  const inputMinutes = $("#taskMinutes");
  const dlgTitle = $("#taskDialogTitle");

  let editIndex = null;
  // Circle geometry (match SVG)
  const R = 45;
  const CIRC = 2 * Math.PI * R;

  function fmt(ms){
    const s = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(s/60);
    const r = s % 60;
    return `${String(m).padStart(2,"0")}:${String(r).padStart(2,"0")}`;
  }

  function totalRoutineMs(profileName){
    return (state.profiles[profileName] || []).reduce((acc,t)=>acc+t.minutes*60000, 0);
  }

  function remainingAllMs(){
    const tasks = state.profiles[state.currentProfile] || [];
    let ms = state.remainingMs;
    for(let i=state.currentIndex+1; i<tasks.length; i++){
      ms += tasks[i].minutes * 60000;
    }
    return ms;
  }

  function updateIndicator(pct){
    const offset = CIRC * (1 - pct);
    elIndicator.style.strokeDashoffset = String(offset);
  }

  function speak(text){
    try{
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.0;
      u.pitch = 1.0;
      u.lang = navigator.language || "en-US";
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    }catch(e){
      console.warn("TTS failed", e);
    }
  }

  function announceUpcoming(nextTaskName){
    const msg = `Upcoming task: ${nextTaskName}`;
    speak(msg);
  }

  function playAlarm(){
    if(!elAlarm) return;
    try{
      elAlarm.currentTime = 0;
      elAlarm.loop = CONFIG.alarm.nonStop;
      const p = elAlarm.play();
      if(p && typeof p.catch === "function") p.catch(()=>{});
    }catch(e){ console.warn("Alarm play failed", e); }
  }

  function stopAlarm(){
    try{
      elAlarm.pause();
      elAlarm.currentTime = 0;
      elAlarm.loop = false;
    }catch(e){}
  }

  function scheduleAutoStartAfterAlarm(){
    setTimeout(()=>{
      stopAlarm();
      startTimer();
    }, CONFIG.alarm.durationSeconds * 1000);
  }

  /*** Rendering ***/
  function renderProfiles(){
    const names = Object.keys(state.profiles);
    elProfile.innerHTML = names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
    elProfile.value = state.currentProfile;
  }

  function escapeHtml(s){ return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;"); }

  function renderTasks(){
    const tasks = state.profiles[state.currentProfile] || [];
    elTaskList.innerHTML = "";
    tasks.forEach((t, i) => {
      const li = document.createElement("li");
      li.className = "task-item";
      li.draggable = true;
      li.dataset.index = i;
      li.innerHTML = `
        <div class="drag-handle" title="Drag to reorder" aria-hidden="true">☰</div>
        <div>
          <div class="task-name">${escapeHtml(t.name)}</div>
          <div class="task-duration">${t.minutes} min</div>
        </div>
        <div class="task-actions">
          <button class="icon-btn" data-action="edit" aria-label="Edit task">✎</button>
          <button class="icon-btn" data-action="delete" aria-label="Delete task">🗑</button>
        </div>
      `;
      // drag handlers per li
      li.addEventListener("dragstart", e => {
        e.dataTransfer.setData("text/plain", String(i));
        li.classList.add("dragging");
      });
      li.addEventListener("dragend", e => {
        li.classList.remove("dragging");
      });
      elTaskList.appendChild(li);
    });

    // After rendering, update UI
    renderNextUp();
    // Ensure buttons state
    btnPause.disabled = !state.isRunning;
    btnStart.disabled = state.isRunning;
  }

  function renderNextUp(){
    const tasks = state.profiles[state.currentProfile] || [];
    if(tasks.length === 0){
      elNextUp.textContent = "No tasks in this routine. Click “Add Task” to create one.";
      return;
    }
    const idx = Math.min(state.currentIndex, tasks.length-1);
    const cur = tasks[idx];
    const next = tasks[idx+1];
    const total = totalRoutineMs(state.currentProfile);
    const remainingAll = remainingAllMs();
    const pct = total ? 1 - (remainingAll / total) : 0;

    elNextUp.innerHTML = `
      <div>
        <div><strong>Current:</strong> ${cur ? escapeHtml(cur.name) : "—"}</div>
        <div><strong>Next:</strong> ${next ? escapeHtml(next.name) : "End"}</div>
        <div><strong>Progress:</strong> ${(pct*100).toFixed(1)}%</div>
      </div>
    `;
  }

  /*** Timer Core ***/
  function finishRoutine(){
    clearInterval(state.intervalId); state.intervalId = null;
    state.isRunning = false;
    btnStart.disabled = false;
    btnPause.disabled = true;
    updateIndicator(1);
    elTimeText.textContent = "00:00";
    elTaskText.textContent = "All done";
    renderNextUp();
    speak("Routine finished. Great job!");
  }

  function tick(){
    const tasks = state.profiles[state.currentProfile] || [];
    if(tasks.length === 0){
      resetTimer();
      return;
    }
    const cur = tasks[state.currentIndex];
    const now = Date.now();
    state.remainingMs = Math.max(0, state.targetTime - now);

    // Update UI
    elTimeText.textContent = fmt(state.remainingMs);
    elTaskText.textContent = cur ? cur.name : "";
    const allRemaining = remainingAllMs();
    const allTotal = totalRoutineMs(state.currentProfile);
    const pct = allTotal ? 1 - (allRemaining / allTotal) : 0;
    updateIndicator(pct);

    // Pre-task announcement
    if(cur && tasks[state.currentIndex+1]){
      const next = tasks[state.currentIndex+1];
      if(state.remainingMs <= CONFIG.preTaskAnnounceSeconds * 1000 && state.preAnnouncedForIndex !== state.currentIndex){
        announceUpcoming(next.name);
        state.preAnnouncedForIndex = state.currentIndex;
      }
    }

    if(state.remainingMs <= 0){
      // Move to next task
      const finished = tasks[state.currentIndex];
      if(finished) speak(`${finished.name} done`);
      state.currentIndex++;
      state.preAnnouncedForIndex = null;

      if(state.currentIndex >= tasks.length){
        finishRoutine();
        return;
      }else{
        const next = tasks[state.currentIndex];
        state.remainingMs = next.minutes * 60000;
        state.targetTime = Date.now() + state.remainingMs;
        speak(`${next.name} started`);
        renderNextUp();
      }
    }else{
      // continue
      renderNextUp();
    }
  }

  function startTimer(){
    const tasks = state.profiles[state.currentProfile] || [];
    if(tasks.length === 0) {
      alert("No tasks in this routine. Add one first.");
      return;
    }
    if(state.isRunning) return;
    state.isRunning = true;
    btnStart.disabled = true;
    btnPause.disabled = false;

    const cur = tasks[state.currentIndex] || tasks[0];
    if(state.remainingMs <= 0){
      // start fresh for current index
      state.currentIndex = Math.min(state.currentIndex, tasks.length-1);
      state.remainingMs = (cur ? cur.minutes * 60000 : 0);
      if(cur) speak(`${cur.name} started`);
    }
    state.targetTime = Date.now() + state.remainingMs;
    if(state.intervalId) clearInterval(state.intervalId);
    state.intervalId = setInterval(tick, 200);
  }

  function pauseTimer(){
    if(!state.isRunning) return;
    state.isRunning = false;
    btnStart.disabled = false;
    btnPause.disabled = true;
    if(state.intervalId) clearInterval(state.intervalId);
    // update remainingMs to current target
    state.remainingMs = Math.max(0, state.targetTime - Date.now());
    state.intervalId = null;
    renderNextUp();
  }

  function resetTimer(){
    if(state.intervalId) clearInterval(state.intervalId);
    state.intervalId = null;
    state.isRunning = false;
    state.currentIndex = 0;
    state.remainingMs = 0;
    state.targetTime = 0;
    state.preAnnouncedForIndex = null;
    btnStart.disabled = false;
    btnPause.disabled = true;
    updateIndicator(0);
    elTimeText.textContent = "00:00";
    elTaskText.textContent = "";
    renderNextUp();
  }

  /*** Drag & Drop Helpers (better UX) ***/
  function getDragAfterElement(container, y){
    const draggableElements = [...container.querySelectorAll('.task-item:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset: offset, element: child };
      } else {
        return closest;
      }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }

  function attachDnD(){
    let draggedIndex = null;

    elTaskList.addEventListener("dragstart", e => {
      const li = e.target.closest(".task-item");
      if(!li) return;
      draggedIndex = Number(li.dataset.index);
      e.dataTransfer.setData("text/plain", String(draggedIndex));
      li.classList.add("dragging");
    });

    elTaskList.addEventListener("dragend", e => {
      const li = e.target.closest(".task-item");
      if(li) li.classList.remove("dragging");
    });

    elTaskList.addEventListener("dragover", e => {
      e.preventDefault();
      const afterEl = getDragAfterElement(elTaskList, e.clientY);
      const draggingEl = elTaskList.querySelector('.dragging');
      if(!draggingEl) return;
      if(afterEl == null){
        elTaskList.appendChild(draggingEl);
      }else{
        elTaskList.insertBefore(draggingEl, afterEl);
      }
    });

    elTaskList.addEventListener("drop", e => {
      e.preventDefault();
      const data = e.dataTransfer.getData("text/plain");
      const from = Number(data);
      if(Number.isNaN(from)) return;
      const toLi = e.target.closest(".task-item");
      let to;
      const arr = state.profiles[state.currentProfile];
      if(!toLi){
        to = arr.length - 1;
      }else{
        to = Number(toLi.dataset.index);
        const rect = toLi.getBoundingClientRect();
        if(e.clientY > rect.top + rect.height/2) to = to + 1; // drop after element when dropping below midpoint
      }
      // Remove item from original position
      const [moved] = arr.splice(from, 1);
      // adjust index if necessary
      if(to > from) to = to - 1;
      if(to < 0) to = 0;
      if(to > arr.length) to = arr.length;
      arr.splice(to, 0, moved);
      persist();
      renderTasks();
    });
  }

  /*** Task CRUD ***/
  function openTaskDialog(mode, index=null){
    editIndex = index;
    dlgTitle.textContent = mode === "edit" ? "Edit Task" : "Add Task";
    if(mode === "edit" && index != null){
      const t = state.profiles[state.currentProfile][index];
      inputName.value = t.name;
      inputMinutes.value = t.minutes;
    }else{
      inputName.value = "";
      inputMinutes.value = "10";
    }
    try{
      dlgTask.showModal();
    }catch(e){
      // fallback for very old browsers
      alert("Browser doesn't support <dialog>. Add task with prompt.");
      const name = prompt("Task name:");
      if(!name) return;
      const minutes = parseInt(prompt("Minutes:", "10")||"10",10) || 10;
      state.profiles[state.currentProfile].push({ name, minutes });
      persist();
      renderTasks();
    }
    inputName.focus();
  }

  function saveTaskFromForm(){
    const name = inputName.value.trim();
    const minutes = Math.max(1, Math.min(240, parseInt(inputMinutes.value,10) || 10));
    if(!name) return;
    const arr = state.profiles[state.currentProfile];
    if(editIndex != null){
      arr[editIndex] = { name, minutes };
    }else{
      arr.push({ name, minutes });
    }
    persist();
    renderTasks();
    try{ dlgTask.close(); }catch(e){}
  }

  function deleteTask(index){
    if(!confirm("Delete this task?")) return;
    const arr = state.profiles[state.currentProfile];
    arr.splice(index,1);
    persist();
    renderTasks();
    // if deleted item was before currentIndex, adjust
    if(index <= state.currentIndex && state.currentIndex > 0){
      state.currentIndex = Math.max(0, state.currentIndex - 1);
    }
    resetIfNoTasks();
  }

  function resetIfNoTasks(){
    const tasks = state.profiles[state.currentProfile] || [];
    if(tasks.length === 0) resetTimer();
  }

  /*** Profiles ***/
  function createProfile(){
    const name = prompt("New profile name:");
    if(!name) return;
    if(state.profiles[name]){
      alert("Profile already exists.");
      return;
    }
    state.profiles[name] = [];
    state.currentProfile = name;
    persist();
    renderProfiles();
    renderTasks();
    resetTimer();
  }

  function renameProfile(){
    const old = state.currentProfile;
    const name = prompt("Rename profile:", old);
    if(!name || name === old) return;
    if(state.profiles[name]){
      alert("A profile with that name already exists.");
      return;
    }
    state.profiles[name] = state.profiles[old];
    delete state.profiles[old];
    state.currentProfile = name;
    persist();
    renderProfiles();
    renderTasks();
    resetTimer();
  }

  function deleteProfile(){
    const name = state.currentProfile;
    if(!confirm(`Delete profile “${name}”?`)) return;
    const keys = Object.keys(state.profiles);
    if(keys.length <= 1){
      alert("At least one profile is required.");
      return;
    }
    delete state.profiles[name];
    state.currentProfile = Object.keys(state.profiles)[0];
    persist();
    renderProfiles();
    renderTasks();
    resetTimer();
  }

  /*** Auto Triggers ***/
  function scheduleDailyTriggers(){
    // clear old timers
    state.autoTriggerTimers.forEach(id => clearTimeout(id));
    state.autoTriggerTimers = [];
    const now = new Date();
    for(const [profile, hhmm] of Object.entries(CONFIG.autoTriggers)){
      const [H,M] = hhmm.split(":").map(Number);
      const next = new Date();
      next.setHours(H, M, 0, 0);
      if(next <= now){ next.setDate(next.getDate() + 1); }
      const ms = next - now;
      const id = setTimeout(()=>{
        // trigger
        state.currentProfile = profile;
        persist();
        renderProfiles();
        renderTasks();
        resetTimer();
        playAlarm();
        scheduleAutoStartAfterAlarm();
        // reschedule for next day
        scheduleDailyTriggers();
      }, ms);
      state.autoTriggerTimers.push(id);
    }
  }

  /*** Wiring & Events ***/
  function wire(){
    btnStart.addEventListener("click", startTimer);
    btnPause.addEventListener("click", pauseTimer);
    btnReset.addEventListener("click", resetTimer);
    btnAddTask.addEventListener("click", ()=> openTaskDialog("add"));
    btnNewProfile.addEventListener("click", createProfile);
    btnRenameProfile.addEventListener("click", renameProfile);
    btnDeleteProfile.addEventListener("click", deleteProfile);

    elProfile.addEventListener("change", e => {
      if(!e.target.value) return;
      state.currentProfile = e.target.value;
      persist();
      renderTasks();
      resetTimer();
    });

    elTaskList.addEventListener("click", e => {
      const btn = e.target.closest("button");
      const li = e.target.closest(".task-item");
      if(!btn || !li) return;
      const index = Number(li.dataset.index);
      const action = btn.dataset.action;
      if(action === "edit"){
        openTaskDialog("edit", index);
      }else if(action === "delete"){
        deleteTask(index);
      }
    });

    formTask.addEventListener("submit", e => {
      e.preventDefault();
      saveTaskFromForm();
    });

    dlgTask.addEventListener("cancel", e => {
      // allow closing via escape, but prevent closing when form invalid
    });

    // simple delegation to close dialog when clicking outside (optional)
    try{
      dlgTask.addEventListener("click", (e) => {
        if(e.target === dlgTask){
          try{ dlgTask.close(); }catch(e){}
        }
      });
    }catch(e){}

    attachDnD();
  }

  /*** Init ***/
  function init(){
    load();
    renderProfiles();
    renderTasks();
    resetTimer();

    // Warm up TTS on first user gesture (silent utterance)
    document.addEventListener("click", function once(){
      try{
        const u = new SpeechSynthesisUtterance(" ");
        u.volume = 0;
        speechSynthesis.speak(u);
      }catch(e){}
      document.removeEventListener("click", once);
    }, { once: true });

    wire();
    scheduleDailyTriggers();
  }

  // expose small debug helpers in console
  window.RoutineX = {
    state, CONFIG, persist, resetTimer, startTimer, pauseTimer
  };

  init();
})();