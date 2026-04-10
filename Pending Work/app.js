/* ============================================================
   STUDYALERT — app.js  (v2)
   New in this version:
     • Edit task (pencil button → repopulates form)
     • Calendar view with task dots per day
     • Daily 3-day warning notifications (fires once per day on load)
   ============================================================ */

'use strict';

/* ── 1. STATE & CONSTANTS ── */
const STORAGE_KEY    = 'studyalert_tasks';
const LAST_DAILY_KEY = 'studyalert_last_daily_check';

let tasks = [];
let deferredInstallPrompt = null;
let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth();
let editingTaskId = null;

const CATEGORY_EMOJI = {
  assignment:'📝', exam:'📖', project:'🔬',
  lab:'🧪', reading:'📚', other:'📌',
};
const CATEGORY_COLOR = {
  assignment:'var(--cat-assignment)', exam:'var(--cat-exam)',
  project:'var(--cat-project)',       lab:'var(--cat-lab)',
  reading:'var(--cat-reading)',       other:'var(--cat-other)',
};

/* ── 2. DOM ELEMENTS ──
   Using a safe getter: if an ID doesn't exist in HTML,
   we get null instead of a crash that kills everything.
── */
function el(id) { return document.getElementById(id); }

const form           = el('task-form');
const titleInput     = el('task-title');
const categoryInput  = el('task-category');
const subjectInput   = el('task-subject');
const dateInput      = el('task-date');
const timeInput      = el('task-time');
const notesInput     = el('task-notes');
const taskList       = el('task-list');
const emptyState     = el('empty-state');
const pendingCount   = el('pending-count');
const searchInput    = el('search-input');
const sortSelect     = el('sort-select');
const filterTabs     = document.querySelectorAll('.filter-tab');
const notifBtn       = el('notif-btn');
const calendarBtn    = el('calendar-btn');
const clearCompBtn   = el('clear-completed-btn');
const titleCountEl   = el('title-count');
const toast          = el('toast');
const modalOverlay   = el('modal-overlay');
const modalContent   = el('modal-content');
const modalCloseBtn  = el('modal-close-btn');
const calOverlay     = el('calendar-overlay');
const calDaysEl      = el('cal-days');
const calMonthLabel  = el('cal-month-label');
const calPrevBtn     = el('cal-prev');
const calNextBtn     = el('cal-next');
const calCloseBtn    = el('calendar-close-btn');
const calDayDetail   = el('cal-day-detail');
const calDetailTitle = el('cal-detail-title');
const calDetailTasks = el('cal-detail-tasks');
const submitBtn      = el('submit-btn');
const cancelEditBtn  = el('cancel-edit-btn');
const formPanelTitle = el('form-panel-title');
const formPanel      = document.querySelector('.panel-form');
const aboutBtn       = el('about-btn');
const aboutOverlay   = el('about-overlay');
const aboutCloseBtn  = el('about-close-btn');

let currentFilter = 'all';
let toastTimeout  = null;

/* ── 3. INIT ── */
function init() {
  loadFromStorage();
  setDefaultDateTime();
  renderTasks();
  setInterval(tickCountdowns, 1000);
  checkNotificationPermission();
  listenForPWAInstall();
  scheduleAllReminders();
  runDailyCheck();
  bindEvents();
}

/* ── 4. DEFAULT DATE/TIME (+1 hour from now) ── */
function setDefaultDateTime() {
  const now = new Date(Date.now() + 3600000);
  dateInput.value = now.toISOString().split('T')[0];
  timeInput.value = now.toTimeString().slice(0, 5);
}

/* ── 5. STORAGE ── */
function saveToStorage() { localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks)); }
function loadFromStorage() {
  try { tasks = JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { tasks = []; }
}

/* ── 6. READ FORM ── */
function readForm() {
  return {
    title:    titleInput.value,
    category: categoryInput.value,
    subject:  subjectInput.value,
    date:     dateInput.value,
    time:     timeInput.value,
    priority: document.querySelector('input[name="priority"]:checked')?.value || 'medium',
    notes:    notesInput.value,
  };
}

/* ── 7. FORM SUBMIT (add OR edit) ── */
form.addEventListener('submit', e => {
  e.preventDefault();
  const d = readForm();

  if (!d.title.trim()) { showToast('⚠️ Please enter a task title!','warning'); titleInput.focus(); return; }
  if (!d.date || !d.time) { showToast('⚠️ Please set a due date and time!','warning'); return; }

  if (editingTaskId) {
    // ── EDIT MODE ──
    const idx = tasks.findIndex(t => t.id === editingTaskId);
    if (idx !== -1) {
      tasks[idx] = { ...tasks[idx],
        title: d.title.trim(), category: d.category, subject: d.subject.trim(),
        date: d.date, time: d.time, priority: d.priority, notes: d.notes.trim(),
        dueDateTime: `${d.date}T${d.time}:00`, alarmFired: false,
      };
      saveToStorage(); renderTasks(); scheduleReminder(tasks[idx]);
      showToast(`✏️ "${tasks[idx].title}" updated!`, 'success');
    }
    exitEditMode();
    return;
  }

  // ── ADD MODE ──
  if (new Date(`${d.date}T${d.time}:00`) < new Date()) showToast('⚠️ Due date is in the past. Adding anyway…','warning');
  const task = {
    id: crypto.randomUUID(), title: d.title.trim(), category: d.category,
    subject: d.subject.trim(), date: d.date, time: d.time, priority: d.priority,
    notes: d.notes.trim(), completed: false, createdAt: new Date().toISOString(),
    dueDateTime: `${d.date}T${d.time}:00`, alarmFired: false,
  };
  tasks.unshift(task);
  saveToStorage(); renderTasks(); scheduleReminder(task);
  showToast(`✅ "${task.title}" added!`, 'success');
  resetForm();
});

/* ── 8. EDIT MODE HELPERS ── */
function enterEditMode(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  editingTaskId        = id;
  titleInput.value     = task.title;
  categoryInput.value  = task.category;
  subjectInput.value   = task.subject;
  dateInput.value      = task.date;
  timeInput.value      = task.time;
  notesInput.value     = task.notes;
  titleCountEl.textContent = `${task.title.length} / 80`;
  document.querySelector(`input[name="priority"][value="${task.priority}"]`).checked = true;
  formPanelTitle.textContent = '✏️ Edit Task';
  submitBtn.querySelector('.btn-label').textContent = 'Save Changes';
  submitBtn.querySelector('.btn-icon').textContent  = '✓';
  cancelEditBtn.hidden = false;
  formPanel.classList.add('editing-mode');
  formPanel.scrollIntoView({ behavior:'smooth', block:'start' });
}

function exitEditMode() {
  editingTaskId = null;
  formPanelTitle.textContent = 'Add New Task';
  submitBtn.querySelector('.btn-label').textContent = 'Add Task';
  submitBtn.querySelector('.btn-icon').textContent  = '+';
  cancelEditBtn.hidden = true;
  formPanel.classList.remove('editing-mode');
  resetForm();
}

function resetForm() {
  titleInput.value = ''; subjectInput.value = ''; notesInput.value = '';
  categoryInput.value = 'assignment';
  document.querySelector('input[name="priority"][value="medium"]').checked = true;
  titleCountEl.textContent = '0 / 80';
  setDefaultDateTime();
}

/* ── 9. RENDER TASKS ── */
function renderTasks() {
  const q   = searchInput.value.toLowerCase();
  const now = new Date();
  const ord = { high:0, medium:1, low:2 };

  let list = tasks.filter(t => {
    const match = t.title.toLowerCase().includes(q) || t.subject.toLowerCase().includes(q);
    if (!match) return false;
    const due  = new Date(t.dueDateTime);
    const over = due < now && !t.completed;
    if (currentFilter === 'pending')   return !t.completed && !over;
    if (currentFilter === 'completed') return t.completed;
    if (currentFilter === 'overdue')   return over;
    return true;
  });

  list.sort((a,b) => {
    const sv = sortSelect.value;
    if (sv === 'date-asc')  return new Date(a.dueDateTime) - new Date(b.dueDateTime);
    if (sv === 'date-desc') return new Date(b.dueDateTime) - new Date(a.dueDateTime);
    if (sv === 'priority')  return ord[a.priority] - ord[b.priority];
    if (sv === 'title')     return a.title.localeCompare(b.title);
    return 0;
  });

  taskList.innerHTML = '';
  emptyState.hidden  = list.length > 0;
  list.forEach(t => taskList.appendChild(buildCard(t)));
  pendingCount.textContent = tasks.filter(t => !t.completed).length;
}

/* ── 10. BUILD TASK CARD ── */
function buildCard(task) {
  const now      = new Date();
  const due      = new Date(task.dueDateTime);
  const isOver   = due < now && !task.completed;
  const daysLeft = (due - now) / 86400000;
  const isSoon   = !task.completed && !isOver && daysLeft <= 3;

  const card = document.createElement('div');
  card.className = `task-card${task.completed?' completed':''}${isOver?' overdue':''}${isSoon?' due-soon':''}`;
  card.dataset.id       = task.id;
  card.dataset.priority = task.priority;
  card.setAttribute('role','listitem');

  // ⚠️ warning badge
  if (isSoon) {
    const wb = document.createElement('span');
    wb.className   = 'warning-badge';
    wb.textContent = daysLeft < 1 ? 'DUE TODAY' : `${Math.ceil(daysLeft)}d LEFT`;
    card.appendChild(wb);
  }

  // Checkbox
  const cb = document.createElement('div');
  cb.className = `task-checkbox${task.completed?' checked':''}`;
  cb.innerHTML = task.completed ? '✓' : '';
  cb.title     = task.completed ? 'Mark incomplete' : 'Mark complete';
  cb.addEventListener('click', e => { e.stopPropagation(); toggleComplete(task.id); });

  // Info
  const info = document.createElement('div');
  info.className = 'task-info';

  const hdr = document.createElement('div');
  hdr.className = 'task-header-row';
  const tEl = document.createElement('span');
  tEl.className = 'task-title'; tEl.textContent = task.title;
  const bEl = document.createElement('span');
  bEl.className = `task-badge badge-${task.category}`;
  bEl.textContent = `${CATEGORY_EMOJI[task.category]} ${task.category}`;
  hdr.append(tEl, bEl);

  const meta = document.createElement('div');
  meta.className = 'task-meta';
  if (task.subject) {
    const s = document.createElement('span');
    s.className = 'task-subject'; s.textContent = task.subject;
    meta.appendChild(s);
  }
  const dEl = document.createElement('span');
  dEl.className = 'task-date'; dEl.textContent = '📅 ' + fmtDT(task.dueDateTime);
  meta.appendChild(dEl);
  const cd = document.createElement('span');
  cd.className = 'task-countdown'; cd.dataset.due = task.dueDateTime;
  updateCd(cd, task);
  meta.appendChild(cd);

  info.append(hdr, meta);

  // Actions: edit · view · delete
  const acts = document.createElement('div');
  acts.className = 'task-actions';

  const mkBtn = (icon, cls, title, fn) => {
    const b = document.createElement('button');
    b.className = `task-action-btn ${cls}`; b.innerHTML = icon; b.title = title;
    b.addEventListener('click', e => { e.stopPropagation(); fn(); });
    return b;
  };
  acts.append(
    mkBtn('✏️','edit','Edit task',   () => enterEditMode(task.id)),
    mkBtn('👁','',    'View details', () => openModal(task.id)),
    mkBtn('🗑','delete','Delete task', () => deleteTask(task.id))
  );

  card.addEventListener('click', () => openModal(task.id));
  card.append(cb, info, acts);
  return card;
}

/* ── 11. FORMAT HELPERS ── */
function fmtDT(iso) {
  return new Date(iso).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true});
}
function fmtShort(iso) {
  return new Date(iso).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true});
}
function fmtDur(ms) {
  const s=Math.floor(ms/1000),m=Math.floor(s/60),h=Math.floor(m/60),d=Math.floor(h/24);
  if(d>0) return `${d}d ${h%24}h`;
  if(h>0) return `${h}h ${m%60}m`;
  if(m>0) return `${m}m`;
  return `${s}s`;
}
function pad(n) { return String(n).padStart(2,'0'); }

/* ── 12. COUNTDOWN UPDATE ── */
function updateCd(el, task) {
  if (task.completed) { el.textContent='✓ Done'; el.className='task-countdown done'; return; }
  const diff = new Date(task.dueDateTime) - new Date();
  if (diff < 0) { el.textContent=`${fmtDur(-diff)} overdue`; el.className='task-countdown urgent'; }
  else { el.textContent=`⏱ ${fmtDur(diff)} left`; el.className=diff<7200000?'task-countdown urgent':'task-countdown'; }
}

function tickCountdowns() {
  document.querySelectorAll('.task-countdown[data-due]').forEach(el => {
    const id = el.closest('.task-card')?.dataset.id;
    const t  = tasks.find(x => x.id === id);
    if (t) updateCd(el, t);
  });
  // Alarm check
  const now = new Date();
  tasks.forEach(task => {
    if (task.completed || task.alarmFired) return;
    const due = new Date(task.dueDateTime);
    if (due <= now && (now - due) < 5000) {
      task.alarmFired = true; saveToStorage(); fireNotif(task,'now');
    }
  });
}

/* ── 13. TOGGLE / DELETE / CLEAR ── */
function toggleComplete(id) {
  const t = tasks.find(x => x.id === id); if (!t) return;
  t.completed = !t.completed; saveToStorage(); renderTasks();
  showToast(t.completed?`✅ "${t.title}" done!`:`↩️ "${t.title}" unmarked`, t.completed?'success':'info');
}
function deleteTask(id) {
  const t = tasks.find(x => x.id === id);
  if (!t || !confirm(`Delete "${t.title}"?`)) return;
  if (editingTaskId === id) exitEditMode();
  tasks = tasks.filter(x => x.id !== id); saveToStorage(); renderTasks();
  showToast('🗑️ Task deleted','info');
}
clearCompBtn?.addEventListener('click', () => {
  const n = tasks.filter(t=>t.completed).length;
  if (!n) { showToast('No completed tasks to clear','info'); return; }
  if (!confirm(`Remove ${n} completed task(s)?`)) return;
  tasks = tasks.filter(t=>!t.completed); saveToStorage(); renderTasks();
  showToast(`🧹 Cleared ${n} task(s)`,'success');
});

/* ── 14. DETAIL MODAL ── */
function openModal(id) {
  const task = tasks.find(t => t.id === id); if (!task) return;
  const now    = new Date();
  const isOver = new Date(task.dueDateTime) < now && !task.completed;
  modalContent.innerHTML = `
    <h2 class="modal-task-title">${CATEGORY_EMOJI[task.category]} ${esc(task.title)}</h2>
    <div class="modal-detail-row">
      <span class="modal-detail-label">Category</span>
      <span class="modal-detail-value"><span class="task-badge badge-${task.category}">${task.category}</span></span>
    </div>
    ${task.subject?`<div class="modal-detail-row"><span class="modal-detail-label">Subject</span><span class="modal-detail-value task-subject">${esc(task.subject)}</span></div>`:''}
    <div class="modal-detail-row"><span class="modal-detail-label">Due</span><span class="modal-detail-value">${fmtDT(task.dueDateTime)}</span></div>
    <div class="modal-detail-row"><span class="modal-detail-label">Priority</span><span class="modal-detail-value" style="text-transform:capitalize;color:var(--priority-${task.priority})">${task.priority}</span></div>
    <div class="modal-detail-row"><span class="modal-detail-label">Status</span><span class="modal-detail-value" style="color:${task.completed?'var(--priority-low)':isOver?'var(--priority-high)':'var(--text-secondary)'}">
      ${task.completed?'✅ Completed':isOver?'🔴 Overdue':'⏳ Pending'}</span></div>
    ${task.notes?`<div class="modal-notes-box">📋 <strong>Notes:</strong><br>${esc(task.notes)}</div>`:''}
    <div class="modal-actions">
      <button class="btn btn-primary" id="mtoggle">${task.completed?'↩️ Mark Incomplete':'✅ Mark Complete'}</button>
      <button class="btn btn-ghost" id="medit" style="border-color:var(--accent);color:var(--accent)">✏️ Edit</button>
      <button class="btn btn-ghost" id="mdelete" style="color:var(--priority-high);border-color:var(--priority-high)">🗑️ Delete</button>
    </div>`;
  document.getElementById('mtoggle').onclick = () => { toggleComplete(id); closeModal(); };
  document.getElementById('medit').onclick   = () => { closeModal(); enterEditMode(id); };
  document.getElementById('mdelete').onclick = () => { closeModal(); deleteTask(id); };
  modalOverlay.hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeModal() { if(modalOverlay){ modalOverlay.hidden=true; document.body.style.overflow=''; } }
modalCloseBtn?.addEventListener('click', closeModal);
modalOverlay?.addEventListener('click', e => { if(e.target===modalOverlay) closeModal(); });

/* ── 15. TOAST ── */
function showToast(msg, type='info') {
  toast.textContent=msg; toast.className=`toast show ${type}`;
  clearTimeout(toastTimeout);
  toastTimeout=setTimeout(()=>{ toast.className='toast'; },3200);
}

/* ── 16. NOTIFICATIONS ── */
function checkNotificationPermission() {
  if (!('Notification' in window) || !notifBtn) return;
  if (Notification.permission==='granted') { notifBtn.innerHTML='🔔'; notifBtn.style.background='rgba(76,222,128,0.15)'; notifBtn.title='Notifications enabled'; }
  else if (Notification.permission==='denied') { notifBtn.innerHTML='🔕'; notifBtn.style.opacity='0.6'; }
}
notifBtn?.addEventListener('click', async () => {
  if (!('Notification' in window)) { showToast('❌ Browser does not support notifications','error'); return; }
  if (Notification.permission==='denied') { showToast('🔕 Notifications blocked. Allow in browser settings.','warning'); return; }
  if (Notification.permission==='granted') { showToast('✅ Notifications already enabled!','success'); return; }
  const p = await Notification.requestPermission();
  checkNotificationPermission();
  if (p==='granted') {
    showToast('🔔 Notifications enabled!','success');
    new Notification('StudyAlert ✅',{body:'You will be alerted when tasks are due.',icon:'icon-192.png'});
    runDailyCheck();
    if (typeof window.initFirebasePush === 'function') window.initFirebasePush();
  } else { showToast('⚠️ Permission denied','warning'); }
});

function scheduleReminder(task) {
  if (Notification.permission!=='granted') return;
  const now=Date.now(), due=new Date(task.dueDateTime).getTime(), diff=due-now;
  if (diff-900000 > 0) setTimeout(()=>fireNotif(task,'15min'), diff-900000);
  if (diff > 0)         setTimeout(()=>fireNotif(task,'now'),   diff);
}
function scheduleAllReminders() {
  tasks.filter(t=>!t.completed&&!t.alarmFired).forEach(scheduleReminder);
}
function fireNotif(task, when) {
  if (Notification.permission!=='granted'||task.completed) return;
  const title = when==='now' ? `⏰ DUE NOW: ${task.title}` : `⚠️ Due in 15 min: ${task.title}`;
  const body  = [task.subject&&`📚 ${task.subject}`,`📅 ${fmtDT(task.dueDateTime)}`,`🎯 Priority: ${task.priority}`].filter(Boolean).join('\n');
  try {
    const n = new Notification(title,{body,icon:'icon-192.png',tag:task.id,requireInteraction:when==='now'});
    n.onclick=()=>{ window.focus(); openModal(task.id); };
  } catch(e){}
  playBeep();
}

/* ── 17. DAILY 3-DAY WARNING ──
   Runs once per calendar day.
   Sends one notification for all tasks due within 3 days.
*/
function runDailyCheck() {
  if (Notification.permission!=='granted') return;
  const today     = new Date().toDateString();
  const lastCheck = localStorage.getItem(LAST_DAILY_KEY);
  if (lastCheck===today) return;          // Already ran today
  localStorage.setItem(LAST_DAILY_KEY, today);

  const now    = new Date();
  const cutoff = new Date(now.getTime() + 3*86400000);

  const soon = tasks.filter(t => {
    if (t.completed) return false;
    const d = new Date(t.dueDateTime);
    return d > now && d <= cutoff;
  });
  if (!soon.length) return;

  const lines = soon.map(t => {
    const days = Math.ceil((new Date(t.dueDateTime)-now)/86400000);
    return `• ${t.title} (${days<=1?'tomorrow':'in '+days+' days'})`;
  }).join('\n');

  try {
    const n = new Notification(
      `📚 ${soon.length} task${soon.length>1?'s':''} due soon — still pending!`,
      { body:lines, icon:'icon-192.png', tag:'daily-summary', requireInteraction:false }
    );
    n.onclick=()=>{ window.focus(); openCalendar(); };
  } catch(e){}
}

/* ── 18. BEEP SOUND ── */
function playBeep() {
  try {
    const ctx=new(window.AudioContext||window.webkitAudioContext)();
    [0,0.3,0.6].forEach(dl=>{
      const o=ctx.createOscillator(),g=ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value=880; o.type='sine';
      g.gain.setValueAtTime(0.3,ctx.currentTime+dl);
      g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+dl+0.25);
      o.start(ctx.currentTime+dl); o.stop(ctx.currentTime+dl+0.25);
    });
  } catch(e){}
}

/* ═══════════════════════════════════════════════════════════
   ── 19. CALENDAR VIEW ──
═══════════════════════════════════════════════════════════ */
const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];

function openCalendar() {
  if (!calOverlay) return;
  calYear=new Date().getFullYear(); calMonth=new Date().getMonth();
  renderCal();
  calOverlay.hidden=false; document.body.style.overflow='hidden';
}
function closeCalendar() {
  if (!calOverlay) return;
  calOverlay.hidden=true; document.body.style.overflow='';
  if (calDayDetail) calDayDetail.hidden=true;
}
calendarBtn?.addEventListener('click', openCalendar);
calCloseBtn?.addEventListener('click', closeCalendar);
calOverlay?.addEventListener('click', e=>{ if(e.target===calOverlay) closeCalendar(); });

calPrevBtn?.addEventListener('click', ()=>{ if(--calMonth<0){calMonth=11;calYear--;} renderCal(); });
calNextBtn?.addEventListener('click', ()=>{ if(++calMonth>11){calMonth=0;calYear++;} renderCal(); });

function renderCal() {
  calDayDetail.hidden=true;
  calDaysEl.innerHTML='';
  calMonthLabel.textContent=`${MONTH_NAMES[calMonth]} ${calYear}`;

  const firstDay   = new Date(calYear,calMonth,1).getDay();
  const daysInMon  = new Date(calYear,calMonth+1,0).getDate();
  const daysInPrev = new Date(calYear,calMonth,0).getDate();

  const todayStr = `${new Date().getFullYear()}-${pad(new Date().getMonth()+1)}-${pad(new Date().getDate())}`;

  // Build lookup: "YYYY-MM-DD" → tasks[]
  const byDate={};
  tasks.forEach(t=>{ if(!byDate[t.date]) byDate[t.date]=[]; byDate[t.date].push(t); });

  // Leading (prev month)
  for(let i=0;i<firstDay;i++) {
    const d=daysInPrev-firstDay+1+i;
    const m=calMonth-1<0?11:calMonth-1, y=calMonth-1<0?calYear-1:calYear;
    calDaysEl.appendChild(mkCell(d,y,m,byDate,todayStr,true));
  }
  // Current month
  for(let d=1;d<=daysInMon;d++) calDaysEl.appendChild(mkCell(d,calYear,calMonth,byDate,todayStr,false));
  // Trailing (next month)
  const trail=(firstDay+daysInMon)%7; const need=trail?7-trail:0;
  const nm=calMonth+1>11?0:calMonth+1, ny=calMonth+1>11?calYear+1:calYear;
  for(let d=1;d<=need;d++) calDaysEl.appendChild(mkCell(d,ny,nm,byDate,todayStr,true));
}

function mkCell(day,yr,mo,byDate,todayStr,other) {
  const key=`${yr}-${pad(mo+1)}-${pad(day)}`;
  const dt = byDate[key]||[];

  const cell=document.createElement('div');
  cell.className='cal-day'+(other?' other-month':'')+(key===todayStr?' today':'')+(dt.length?' has-tasks':'');

  const num=document.createElement('div');
  num.className='cal-day-num'; num.textContent=day;
  cell.appendChild(num);

  if(dt.length) {
    const dots=document.createElement('div');
    dots.className='cal-dots';
    dt.slice(0,4).forEach(t=>{
      const dot=document.createElement('span');
      dot.className=`dot dot-${t.completed?'other':t.category}`;
      dot.title=t.title;
      dots.appendChild(dot);
    });
    if(dt.length>4){
      const m=document.createElement('span');
      m.className='cal-more'; m.textContent=`+${dt.length-4}`;
      dots.appendChild(m);
    }
    cell.appendChild(dots);
    cell.addEventListener('click',()=>showDayDetail(key,dt,cell));
  }
  return cell;
}

function showDayDetail(key, dt, clickedCell) {
  // Highlight selected cell
  document.querySelectorAll('.cal-day.selected').forEach(c=>c.classList.remove('selected'));
  clickedCell.classList.add('selected');

  const d=new Date(key+'T12:00:00');
  calDetailTitle.textContent=d.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  calDetailTasks.innerHTML='';

  const now=new Date();
  dt.forEach(task=>{
    const due     = new Date(task.dueDateTime);
    const isOver  = due<now && !task.completed;
    const daysL   = (due-now)/86400000;
    let sc,sl;
    if(task.completed)  {sc='status-done';sl='✓ Done';}
    else if(isOver)     {sc='status-overdue';sl='Overdue';}
    else if(daysL<=3)   {sc='status-soon';sl='⚠️ Soon';}
    else                {sc='status-pending';sl='Pending';}

    const item=document.createElement('div');
    item.className='cal-task-item';
    item.innerHTML=`
      <span class="cal-task-item-dot" style="background:${CATEGORY_COLOR[task.category]}"></span>
      <div class="cal-task-item-info">
        <div class="cal-task-item-title">${esc(task.title)}</div>
        <div class="cal-task-item-meta">${task.subject?esc(task.subject)+' · ':''}${fmtShort(task.dueDateTime)}</div>
      </div>
      <span class="cal-task-item-status ${sc}">${sl}</span>`;
    item.addEventListener('click',()=>{ closeCalendar(); openModal(task.id); });
    calDetailTasks.appendChild(item);
  });
  calDayDetail.hidden=false;
}

/* ── 20. SEARCH / FILTER / SORT ── */
searchInput?.addEventListener('input', renderTasks);
filterTabs.forEach(tab=>{
  tab.addEventListener('click',()=>{
    filterTabs.forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    currentFilter=tab.dataset.filter;
    renderTasks();
  });
});
sortSelect?.addEventListener('change', renderTasks);
titleInput?.addEventListener('input', ()=>{ if(titleCountEl) titleCountEl.textContent=`${titleInput.value.length} / 80`; });
cancelEditBtn?.addEventListener('click', exitEditMode);

/* ── 21. KEYBOARD SHORTCUTS ── */
document.addEventListener('keydown', e=>{
  if(e.key==='Escape') { closeModal(); closeCalendar(); closeAbout(); }
});

/* ── 22. ABOUT MODAL ── */
function openAbout() {
  if (!aboutOverlay) return;
  aboutOverlay.hidden          = false;
  document.body.style.overflow = 'hidden';
}
function closeAbout() {
  if (!aboutOverlay) return;
  aboutOverlay.hidden          = true;
  document.body.style.overflow = '';
}
aboutBtn?.addEventListener('click', openAbout);
aboutCloseBtn?.addEventListener('click', closeAbout);
aboutOverlay?.addEventListener('click', e => {
  if (e.target === aboutOverlay) closeAbout();
});

/* ── 22. PWA INSTALL ── */
function listenForPWAInstall() {
  window.addEventListener('beforeinstallprompt',e=>{
    e.preventDefault(); deferredInstallPrompt=e; showInstallBanner();
  });
  window.addEventListener('appinstalled',()=>{ removeInstallBanner(); showToast('🎉 App installed!','success'); });
}
function showInstallBanner() {
  if(document.getElementById('install-banner')) return;
  const b=document.createElement('div'); b.id='install-banner';
  b.innerHTML=`<span class="banner-text">📱 Install StudyAlert for offline access!</span>
    <button id="iyes">Install</button><button class="banner-dismiss" id="ino">✕</button>`;
  document.body.appendChild(b);
  document.getElementById('iyes').onclick=async()=>{
    if(!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const {outcome}=await deferredInstallPrompt.userChoice;
    if(outcome==='accepted') showToast('Installing…','info');
    deferredInstallPrompt=null; removeInstallBanner();
  };
  document.getElementById('ino').onclick=removeInstallBanner;
}
function removeInstallBanner() { document.getElementById('install-banner')?.remove(); }

/* ── 23. ESCAPE HTML ── */
function esc(s) { const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }

/* ── 24. BIND EXTRA EVENTS ── */
function bindEvents() { /* all events are bound inline above */ }

/* ── START ── */
init();