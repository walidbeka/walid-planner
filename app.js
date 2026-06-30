/* ============================================
   Walid Planner - مدير المهام الشخصي
   جميع الحقوق محفوظة © 2025
   ============================================ */

// ==================== الحالة العامة ====================
let currentUser = null;
let tasks = [];
let projects = { work: ['Bruce Group', 'WDY Media', 'DOYA'], personal: ['المنزل', 'السيارة', 'العائلة', 'الأمور المالية'] };
let editingTaskId = null;
let currentFilter = 'all';
let currentView = 'list';
let calendarDate = new Date();
let selectedDate = null;
let allNotifications = [];
let confirmCallback = null;

const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

// ==================== Firebase ====================
function signInWithGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    firebase.auth().signInWithPopup(provider)
        .then(result => {
            const email = result.user.email;
            const allowedEmail = localStorage.getItem('wp_allowed_email');
            const errorEl = document.getElementById('login-error');
            if (allowedEmail && email !== allowedEmail) {
                errorEl.textContent = '❌ هذا البريد غير مسموح به. استخدم: ' + allowedEmail;
                firebase.auth().signOut();
                return;
            }
            if (!allowedEmail) {
                localStorage.setItem('wp_allowed_email', email);
            }
            currentUser = result.user;
            db.collection('users').doc(result.user.uid).set({ email: result.user.email, name: result.user.displayName || '' }, { merge: true }).then(() => {
                console.log('✅ User saved to Firestore:', result.user.uid);
            }).catch(err => {
                console.warn('❌ Failed to save user:', err.message);
            });
            errorEl.textContent = '';
            initApp();
        })
        .catch(err => {
            document.getElementById('login-error').textContent = '❌ ' + err.message;
        });
}

function signOut() {
    firebase.auth().signOut();
    currentUser = null;
    document.getElementById('app').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
}

// ==================== التهيئة ====================
function initApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    document.getElementById('user-name').textContent = currentUser.displayName || 'المستخدم';
    document.getElementById('user-email').textContent = currentUser.email;
    document.getElementById('settings-email').value = localStorage.getItem('wp_allowed_email') || currentUser.email;
    applySavedTheme();
    updateProjectsDropdown();
    loadProjects();
    loadTasks();
    setupDailyReminder();
    requestNotificationPermission();
    startTaskTimeChecker();
}

// ==================== التنقل ====================
function navigate(page, params) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const pageEl = document.getElementById('page-' + page);
    if (pageEl) pageEl.classList.add('active');
    const navBtn = document.querySelector(`.nav-btn[data-page="${page}"]`);
    if (navBtn) navBtn.classList.add('active');
    closeSidebar();
    if (page === 'home') renderHome();
    if (page === 'tasks') { if (!params?.project) currentProjectFilter = ''; renderTasks(); if (params && params.filter) filterTasks(params.filter); }
    if (page === 'calendar') renderCalendar();
    if (page === 'projects') renderProjects();
    if (page === 'events') renderEvents();
    if (page === 'exhibitions') renderExhibitions();
    if (page === 'stats') renderStats();
    if (page === 'search') document.getElementById('global-search-input').focus();
    if (page === 'archive') renderArchive();
    if (page === 'settings') { document.getElementById('theme-toggle-setting').checked = localStorage.getItem('wp_theme') === 'dark'; }
    if (location.hash !== '#page-' + page) location.hash = 'page-' + page;
}

window.addEventListener('hashchange', () => {
    const page = location.hash.replace('#page-', '') || 'home';
    const el = document.getElementById('page-' + page);
    if (el) navigate(page);
});

// ==================== القائمة الجانبية ====================
function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay').classList.toggle('open');
}
function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('open');
}

// ==================== المهام — تحميل من Firestore ====================
function loadTasks() {
    if (!currentUser) return;
    const userTasksRef = db.collection('users').doc(currentUser.uid).collection('tasks');
    userTasksRef.orderBy('createdAt', 'desc').onSnapshot(snapshot => {
        tasks = [];
        snapshot.forEach(doc => {
            tasks.push({ id: doc.id, ...doc.data() });
        });
        renderHome();
        renderTasks();
        renderCalendar();
        renderProjects();
        renderArchive();
        updateProgress();
        checkNotifications();
    });
}

function getTaskDocRef(taskId) {
    return db.collection('users').doc(currentUser.uid).collection('tasks').doc(taskId);
}

// ==================== المشاريع — تحميل وإدارة ====================
const DEFAULT_PROJECTS = {
    work: ['Bruce Group', 'WDY Media', 'DOYA'],
    personal: ['المنزل', 'السيارة', 'العائلة', 'الأمور المالية']
};
let deletedDefaults = JSON.parse(localStorage.getItem('wp_deleted_projects') || '[]');

function getProjectsLocal() {
    try { return JSON.parse(localStorage.getItem('wp_projects')); } catch(e) { return null; }
}
function setProjectsLocal() {
    localStorage.setItem('wp_projects', JSON.stringify(projects));
}

function loadProjects() {
    if (!currentUser) return;
    // 1. localStorage كـ cache سريع
    const local = getProjectsLocal();
    if (local && local.work && local.personal) {
        const wd = DEFAULT_PROJECTS.work.filter(p => !deletedDefaults.includes(p));
        const pd = DEFAULT_PROJECTS.personal.filter(p => !deletedDefaults.includes(p));
        projects.work = [...new Set([...wd, ...local.work])];
        projects.personal = [...new Set([...pd, ...local.personal])];
        updateProjectsDropdown();
        renderProjects();
    }

    // 2. Firebase هو مصدر البيانات الأساسي
    //    أي حاجة في localStorage مش موجودة في Firebase (من التحديث القديم)
    //    بنرفعها لـ Firebase عشان تتبعت لكل الأجهزة
    const localForMigration = getProjectsLocal();
    const batch = db.batch();
    let needsMigration = false;
    const ref = db.collection('users').doc(currentUser.uid).collection('projects');
    ref.onSnapshot(snapshot => {
        const fbProjects = { work: [], personal: [] };
        const fbNames = [];
        snapshot.forEach(doc => {
            const p = doc.data();
            if (p.type === 'work') { fbProjects.work.push(p.name); fbNames.push(p.name); }
            else { fbProjects.personal.push(p.name); fbNames.push(p.name); }
        });
        // ترحيل المشاريع القديمة من localStorage لـ Firebase
        if (localForMigration && snapshot.docs.length === 0) {
            const wd = DEFAULT_PROJECTS.work.filter(p => !deletedDefaults.includes(p));
            const pd = DEFAULT_PROJECTS.personal.filter(p => !deletedDefaults.includes(p));
            const allWork = [...new Set([...wd, ...localForMigration.work])];
            const allPersonal = [...new Set([...pd, ...localForMigration.personal])];
            allWork.forEach(n => {
                if (!fbNames.includes(n)) {
                    ref.add({ name: n, type: 'work', createdAt: firebase.firestore.FieldValue.serverTimestamp() });
                }
            });
            allPersonal.forEach(n => {
                if (!fbNames.includes(n)) {
                    ref.add({ name: n, type: 'personal', createdAt: firebase.firestore.FieldValue.serverTimestamp() });
                }
            });
        }
        // Firebase هو الأساس — الـ defaults بتظهر بس لو مفيش بيانات في Firebase
        const wd = DEFAULT_PROJECTS.work.filter(p => !deletedDefaults.includes(p));
        const pd = DEFAULT_PROJECTS.personal.filter(p => !deletedDefaults.includes(p));
        // حذف المشاريع المكررة من Firebase
        const seenNames = new Set();
        snapshot.forEach(doc => {
            const p = doc.data();
            if (seenNames.has(p.name)) {
                ref.doc(doc.id).delete();
            } else {
                seenNames.add(p.name);
            }
        });
        if (fbProjects.work.length === 0 && fbProjects.personal.length === 0) {
            // أول مرة — استخدم الـ defaults
            projects.work = wd;
            projects.personal = pd;
        } else {
            projects.work = [...new Set(fbProjects.work)];
            projects.personal = [...new Set(fbProjects.personal)];
        }
        setProjectsLocal();
        updateProjectsDropdown();
        renderProjects();
    }, err => console.warn('Projects sync error:', err));
}

function addProject(name, type) {
    if (!name.trim()) return;
    const n = name.trim();
    if (projects[type].includes(n)) { showToast('⚠️ المشروع موجود', 'error'); return; }
    // محلياً فوراً (عشان يظهر على طول)
    projects[type].push(n);
    setProjectsLocal();
    updateProjectsDropdown();
    renderProjects();
    showToast('✅ تم إضافة المشروع', 'success');
    // Firebase عشان السينك
    if (currentUser) {
        db.collection('users').doc(currentUser.uid).collection('projects').add({ name: n, type, createdAt: firebase.firestore.FieldValue.serverTimestamp() })
            .catch(err => console.warn('Firebase add project error:', err));
    }
}

function editProject(oldName, newName, type) {
    if (!newName.trim()) return;
    const nn = newName.trim();
    // محلياً فوراً
    const idx = projects[type].indexOf(oldName);
    if (idx !== -1) {
        projects[type][idx] = nn;
        setProjectsLocal();
        updateProjectsDropdown();
        renderProjects();
    }
    tasks.forEach(t => { if (t.project === oldName) t.project = nn; });
    localStorage.setItem('wp_tasks', JSON.stringify(tasks));
    showToast('✅ تم تعديل اسم المشروع', 'success');
    // Firebase
    if (currentUser) {
        const ref = db.collection('users').doc(currentUser.uid).collection('projects');
        ref.where('name', '==', oldName).where('type', '==', type).get()
            .then(snap => snap.forEach(doc => doc.ref.update({ name: nn })))
            .catch(err => console.warn('Firebase edit project error:', err));
    }
}

function deleteProject(name, type) {
    // محلياً فوراً
    projects[type] = projects[type].filter(p => p !== name);
    setProjectsLocal();
    updateProjectsDropdown();
    renderProjects();
    showToast('🗑️ تم حذف المشروع', 'success');
    // Firebase
    if (currentUser) {
        const ref = db.collection('users').doc(currentUser.uid).collection('projects');
        ref.where('name', '==', name).where('type', '==', type).get()
            .then(snap => snap.forEach(doc => doc.ref.delete()))
            .catch(err => console.warn('Firebase delete project error:', err));
    }
}

// ==================== المهام — إضافة / حفظ ====================
function openAddTaskModal(data) {
    editingTaskId = null;
    document.getElementById('modal-title').textContent = 'إضافة مهمة جديدة';
    document.getElementById('modal-save-btn').textContent = '💾 إضافة';
    document.getElementById('task-name').value = data && data.name ? data.name : '';
    document.getElementById('task-desc').value = data && data.desc ? data.desc : '';
    document.getElementById('task-type').value = data && data.type ? data.type : 'work';
    document.getElementById('task-priority').value = data && data.priority ? data.priority : 'medium';
    document.getElementById('task-status').value = 'new';
    document.getElementById('task-date').value = data && data.date ? data.date : todayStr();
    document.getElementById('task-recurrence').value = data && data.recurrence ? data.recurrence : '';
    document.getElementById('task-reminder').value = data && data.reminder ? data.reminder : '15';
    document.getElementById('modal-error').textContent = '';
    updateProjectsDropdown();
    if (data && data.project) document.getElementById('task-project').value = data.project;
    document.getElementById('task-modal').style.display = 'flex';
    setTimeout(() => document.getElementById('task-name').focus(), 100);
}

function openEditTaskModal(task) {
    editingTaskId = task.id;
    document.getElementById('modal-title').textContent = 'تعديل المهمة';
    document.getElementById('modal-save-btn').textContent = '💾 حفظ التغييرات';
    document.getElementById('task-name').value = task.name || '';
    document.getElementById('task-desc').value = task.desc || '';
    document.getElementById('task-type').value = task.type || 'work';
    document.getElementById('task-project').value = task.project || '';
    document.getElementById('task-priority').value = task.priority || 'medium';
    document.getElementById('task-status').value = task.status || 'new';
    document.getElementById('task-date').value = task.date || todayStr();
    document.getElementById('task-recurrence').value = task.recurrence || '';
    document.getElementById('task-reminder').value = task.reminder || '15';
    document.getElementById('modal-error').textContent = '';
    updateProjectsDropdown();
    document.getElementById('task-project').value = task.project || '';
    document.getElementById('task-modal').style.display = 'flex';
}

function closeTaskModal() {
    document.getElementById('task-modal').style.display = 'none';
    editingTaskId = null;
}

function updateProjectsDropdown() {
    const type = document.getElementById('task-type').value;
    const sel = document.getElementById('task-project');
    const currentVal = sel.value;
    sel.innerHTML = '';
    (projects[type] || []).forEach(p => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        sel.appendChild(opt);
    });
    if (currentVal && projects[type].includes(currentVal)) sel.value = currentVal;
}

function saveTask() {
    const name = document.getElementById('task-name').value.trim();
    const desc = document.getElementById('task-desc').value.trim();
    const type = document.getElementById('task-type').value;
    const project = document.getElementById('task-project').value;
    const priority = document.getElementById('task-priority').value;
    const status = document.getElementById('task-status').value;
    const date = document.getElementById('task-date').value;
    const errorEl = document.getElementById('modal-error');

    if (!name) { errorEl.textContent = '❌ يرجى إدخال اسم المهمة'; return; }
    if (!date) { errorEl.textContent = '❌ يرجى اختيار تاريخ التنفيذ'; return; }
    errorEl.textContent = '';

    const taskData = {
        name, desc: desc || '',
        type, project,
        priority, status,
        date,
        recurrence: document.getElementById('task-recurrence').value || '',
        reminder: document.getElementById('task-reminder').value || '',
        archived: false,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    const userTasksRef = db.collection('users').doc(currentUser.uid).collection('tasks');

    if (editingTaskId) {
        userTasksRef.doc(editingTaskId).update(taskData);
    } else {
        taskData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        taskData.completedAt = null;
        userTasksRef.add(taskData);
    }

    closeTaskModal();
    showToast(editingTaskId ? '✅ تم تعديل المهمة' : '✅ تم إضافة المهمة', 'success');
}

// ==================== المهام — عمليات ====================
function toggleTaskComplete(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const newStatus = task.status === 'completed' ? 'new' : 'completed';
    const update = { status: newStatus };
    if (newStatus === 'completed') {
        update.completedAt = firebase.firestore.FieldValue.serverTimestamp();
    } else {
        update.completedAt = null;
    }
    getTaskDocRef(taskId).update(update);
    if (newStatus === 'completed' && task.recurrence) {
        handleRecurringTask(task);
    }
}

function startTask(taskId) {
    getTaskDocRef(taskId).update({
        startTime: new Date().toISOString(),
        status: 'in_progress'
    });
    showToast('▶️ تم بدء المهمة', 'success');
}

function finishTask(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const update = {
        endTime: new Date().toISOString(),
        status: 'completed',
        completedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    getTaskDocRef(taskId).update(update);
    if (task.recurrence) {
        handleRecurringTask(task);
    }
    showToast('✅ تم إنهاء المهمة', 'success');
}

function deleteTask(taskId) {
    showConfirm('حذف المهمة', 'هل أنت متأكد من حذف هذه المهمة؟', () => {
        getTaskDocRef(taskId).delete();
        showToast('🗑️ تم حذف المهمة', 'success');
    });
}

function archiveTask(taskId) {
    getTaskDocRef(taskId).update({ archived: true });
    showToast('📦 تم أرشفة المهمة', 'success');
}

function unarchiveTask(taskId) {
    getTaskDocRef(taskId).update({ archived: false });
    showToast('📦 تم إرجاع المهمة من الأرشيف', 'success');
}

function duplicateTask(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const newTask = {
        name: task.name + ' (نسخة)',
        desc: task.desc || '',
        type: task.type || 'work',
        project: task.project || '',
        priority: task.priority || 'medium',
        status: 'new',
        date: todayStr(),
        time: task.time || '',
        timeEnd: task.timeEnd || '',
        archived: false,
        completedAt: null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    db.collection('users').doc(currentUser.uid).collection('tasks').add(newTask);
    showToast('📋 تم نسخ المهمة', 'success');
}

function formatTime12(time24) {
    if (!time24) return '';
    const [h, m] = time24.split(':').map(Number);
    const period = h >= 12 ? 'مساءً' : 'صباحاً';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return h12 + ':' + String(m).padStart(2, '0') + ' ' + period;
}

function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// ==================== التصفية والعرض ====================
function filterTasks(filter) {
    currentFilter = filter;
    currentProjectFilter = '';
    document.querySelectorAll('#task-filters .chip').forEach(c => c.classList.remove('active'));
    document.querySelector(`#task-filters .chip[data-filter="${filter}"]`).classList.add('active');
    if (filter !== 'advanced') {
        document.getElementById('advanced-filter-panel').style.display = 'none';
    }
    renderTasks();
}

function toggleAdvancedFilter() {
    const panel = document.getElementById('advanced-filter-panel');
    const isOpen = panel.style.display !== 'none';
    panel.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) {
        populateAdvancedFilterProjects();
        applyAdvancedFilter();
    }
}

function populateAdvancedFilterProjects() {
    const sel = document.getElementById('adv-project');
    const current = sel.value;
    const projects = [...new Set(tasks.filter(t => t.project).map(t => t.project))];
    sel.innerHTML = '<option value="">الكل</option>' + projects.map(p => `<option value="${p}" ${p === current ? 'selected' : ''}>${p}</option>`).join('');
}

function applyAdvancedFilter() {
    currentFilter = 'advanced';
    document.querySelectorAll('#task-filters .chip').forEach(c => c.classList.remove('active'));
    document.querySelector('#task-filters .chip[data-filter="advanced"]').classList.add('active');
    renderTasks();
}

function clearAdvancedFilter() {
    document.getElementById('adv-date-from').value = '';
    document.getElementById('adv-date-to').value = '';
    document.getElementById('adv-project').value = '';
    document.getElementById('adv-priority').value = '';
    document.getElementById('adv-task-name').value = '';
    applyAdvancedFilter();
}

function getAdvancedFilterValues() {
    return {
        dateFrom: document.getElementById('adv-date-from').value || '',
        dateTo: document.getElementById('adv-date-to').value || '',
        project: document.getElementById('adv-project').value || '',
        priority: document.getElementById('adv-priority').value || '',
        name: (document.getElementById('adv-task-name').value || '').toLowerCase().trim()
    };
}

function setTaskView(view) {
    currentView = view;
    document.getElementById('view-list').classList.toggle('active', view === 'list');
    document.getElementById('view-kanban').classList.toggle('active', view === 'kanban');
    renderTasks();
}

function getFilteredTasks() {
    let filtered = tasks.filter(t => !t.archived);
    if (currentProjectFilter) {
        filtered = filtered.filter(t => t.project === currentProjectFilter);
    }
    const now = new Date();
    const today = todayStr();
    switch (currentFilter) {
        case 'remaining':
            filtered = filtered.filter(t => (t.date === today || t.date < today) && t.status !== 'completed');
            break;
        case 'today':
            filtered = filtered.filter(t => t.date === today);
            break;
        case 'overdue':
            filtered = filtered.filter(t => t.date < today && t.status !== 'completed');
            break;
        case 'upcoming':
            filtered = filtered.filter(t => t.date > today && t.status !== 'completed');
            break;
        case 'completed':
            filtered = filtered.filter(t => t.status === 'completed');
            break;
        case 'advanced':
            const f = getAdvancedFilterValues();
            if (f.dateFrom) filtered = filtered.filter(t => t.date >= f.dateFrom);
            if (f.dateTo) filtered = filtered.filter(t => t.date <= f.dateTo);
            if (f.project) filtered = filtered.filter(t => t.project === f.project);
            if (f.priority) filtered = filtered.filter(t => t.priority === f.priority);
            if (f.name) filtered = filtered.filter(t => t.name && t.name.toLowerCase().includes(f.name));
            const resultEl = document.getElementById('adv-filter-result');
            if (resultEl) resultEl.textContent = filtered.length + ' مهمة نتيجة';
            break;
    }
    return filtered;
}

function searchInTasks(query) {
    const q = query.toLowerCase().trim();
    document.querySelectorAll('#tasks-list-view .task-item').forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = !q || text.includes(q) ? '' : 'none';
    });
}

function globalSearch(query) {
    const q = query.toLowerCase().trim();
    const resultsEl = document.getElementById('search-results');
    if (!q) { resultsEl.innerHTML = '<p class="empty-msg">اكتب للبحث عن المهام...</p>'; return; }
    const results = tasks.filter(t =>
        !t.archived && (
            (t.name && t.name.toLowerCase().includes(q)) ||
            (t.desc && t.desc.toLowerCase().includes(q)) ||
            (t.project && t.project.toLowerCase().includes(q))
        )
    );
    if (!results.length) { resultsEl.innerHTML = '<p class="empty-msg">لا توجد نتائج</p>'; return; }
    resultsEl.innerHTML = results.map(t => createTaskHTML(t)).join('');
}

// ==================== الأعياد والمناسبات ====================
let eventsCountryFilter = 'all';

const exhibitionsData = [
    { date: '2026-02-01', name: 'Gulfood', nameAr: 'معرض جلفود', country: 'uae' },
    { date: '2026-06-01', name: 'Fi Africa', nameAr: 'معرض في أفريقيا', country: 'egypt' },
    { date: '2026-06-01', name: 'Food Expo', nameAr: 'المعرض العربي الدولي للصناعات الغذائية (فود إكسبو)', country: 'syria' },
    { date: '2026-07-01', name: 'SIAB MAROC', nameAr: 'معرض سياب المغرب', country: 'morocco' },
    { date: '2026-08-01', name: 'INFTEXPO', nameAr: 'المعرض الدولي للأغذية وتكنولوجيا الغذاء', country: 'jordan' },
    { date: '2026-09-01', name: 'ISM Middle East', nameAr: 'معرض آي إس إم الشرق الأوسط', country: 'uae' },
    { date: '2026-09-21', name: 'MENA Food', nameAr: 'معرض مينا للغذاء', country: 'libya' },
    { date: '2026-09-27', name: 'The Saudi Food Show', nameAr: 'معرض الغذاء السعودي', country: 'ksa' },
    { date: '2026-09-27', name: 'Saudi Food Manufacturing', nameAr: 'معرض تصنيع الأغذية السعودي', country: 'ksa' },
    { date: '2026-10-01', name: '360 Food Syria', nameAr: 'معرض 360 فود سوريا', country: 'syria' },
    { date: '2026-10-06', name: 'World Food Week', nameAr: 'الأسبوع العالمي للغذاء', country: 'uae' },
    { date: '2026-10-12', name: 'Food Qatar', nameAr: 'معرض فود قطر', country: 'qatar' },
    { date: '2026-11-15', name: 'Saudi Food Expo', nameAr: 'معرض الأغذية السعودي', country: 'ksa' },
    { date: '2026-11-16', name: 'Foodex Saudi', nameAr: 'معرض فودكس السعودية', country: 'ksa' },
    { date: '2026-12-07', name: 'Food Africa', nameAr: 'معرض فوود آفريكا', country: 'egypt' },
];

const holidaysData = [
    { date: '2026-06-16', name: 'رأس السنة الهجرية', nameAr: '1 محرم 1448هـ', country: 'ksa', category: 'islamic' },
    { date: '2026-06-16', name: 'رأس السنة الهجرية', nameAr: '1448هـ', country: 'egypt', category: 'islamic' },
    { date: '2026-06-25', name: 'يوم عاشوراء', nameAr: '10 محرم 1448هـ', country: 'ksa', category: 'islamic' },
    { date: '2026-06-25', name: 'يوم عاشوراء', nameAr: '10 محرم 1448هـ', country: 'egypt', category: 'islamic' },
    { date: '2026-06-30', name: 'ذكرى ثورة 30 يونيو', nameAr: '', country: 'egypt', category: 'national' },
    { date: '2026-07-23', name: 'عيد ثورة 23 يوليو', nameAr: '', country: 'egypt', category: 'national' },
    { date: '2026-08-27', name: 'المولد النبوي الشريف', nameAr: '12 ربيع الأول', country: 'ksa', category: 'islamic' },
    { date: '2026-08-27', name: 'المولد النبوي الشريف', nameAr: '12 ربيع الأول', country: 'egypt', category: 'islamic' },
    { date: '2026-08-31', name: 'بدء الدراسة (موسم العودة للمدارس)', nameAr: 'المتوقع', country: 'ksa', category: 'education' },
    { date: '2026-09-06', name: 'بدء الدراسة في المدارس الدولية', nameAr: '', country: 'egypt', category: 'education' },
    { date: '2026-09-12', name: 'بدء الدراسة بالمدارس الحكومية والخاصة الرسمية', nameAr: '', country: 'egypt', category: 'education' },
    { date: '2026-09-19', name: 'بدء الدراسة بالجامعات والمعاهد المصرية', nameAr: '', country: 'egypt', category: 'education' },
    { date: '2026-09-23', name: 'اليوم الوطني السعودي', nameAr: 'الـ96', country: 'ksa', category: 'national' },
    { date: '2026-10-06', name: 'عيد القوات المسلحة', nameAr: 'انتصارات أكتوبر', country: 'egypt', category: 'national' },
    { date: '2026-10-31', name: 'الهالوين', nameAr: '', country: 'ksa', category: 'social' },
    { date: '2026-11-11', name: 'يوم العزاب', nameAr: '11.11', country: 'ksa', category: 'social' },
    { date: '2026-11-11', name: 'يوم العزاب', nameAr: '11/11', country: 'egypt', category: 'social' },
    { date: '2026-11-27', name: 'الجمعة البيضاء', nameAr: '', country: 'ksa', category: 'shopping' },
    { date: '2026-11-27', name: 'الجمعة البيضاء', nameAr: '', country: 'egypt', category: 'shopping' },
    { date: '2026-12-18', name: 'اليوم العالمي للغة العربية', nameAr: '', country: 'ksa', category: 'cultural' },
    { date: '2026-12-31', name: 'إجازة منتصف العام الدراسي', nameAr: '', country: 'ksa', category: 'education' },
    { date: '2027-01-01', name: 'رأس السنة الميلادية', nameAr: '', country: 'ksa', category: 'social' },
    { date: '2027-01-07', name: 'عيد الميلاد المجيد', nameAr: '', country: 'egypt', category: 'religious' },
    { date: '2027-01-23', name: 'بدء إجازة نصف العام الدراسي', nameAr: 'تنتهي 4 فبراير', country: 'egypt', category: 'education' },
    { date: '2027-01-25', name: 'عيد الثورة وعيد الشرطة', nameAr: '', country: 'egypt', category: 'national' },
    { date: '2027-02-06', name: 'بدء الفصل الدراسي الثاني', nameAr: '', country: 'egypt', category: 'education' },
    { date: '2027-02-07', name: 'بداية شهر رمضان المبارك', nameAr: '1448هـ', country: 'ksa', category: 'islamic' },
    { date: '2027-02-07', name: 'أول أيام شهر رمضان المبارك', nameAr: '1448هـ', country: 'egypt', category: 'islamic' },
    { date: '2027-02-22', name: 'يوم التأسيس السعودي', nameAr: '', country: 'ksa', category: 'national' },
    { date: '2027-03-11', name: 'يوم العلم السعودي', nameAr: '', country: 'ksa', category: 'education' },
];

function getEventIcon(cat) {
    const icons = {
        islamic: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>',
        national: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg>',
        education: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>',
        social: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>',
        shopping: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>',
        cultural: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>',
        religious: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path></svg>',
        exhibition: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"></path><path d="M5 21V7l8-4v18"></path><path d="M19 21V11l-6-4"></path><path d="M9 9v.01"></path><path d="M9 12v.01"></path><path d="M9 15v.01"></path><path d="M9 18v.01"></path></svg>',
    };
    return icons[cat] || icons.social;
}

function renderExhibitions() {
    const el = document.getElementById('exhibitions-table');
    if (!el) return;
    const today = new Date().toISOString().slice(0, 10);
    const countryLabels = { ksa: 'السعودية', egypt: 'مصر', uae: 'الامارات', syria: 'سوريا', morocco: 'المغرب', jordan: 'الأردن', libya: 'ليبيا', qatar: 'قطر' };
    const sorted = [...exhibitionsData].sort((a, b) => a.date.localeCompare(b.date));
    el.innerHTML = sorted.map(e => {
        const diff = Math.ceil((new Date(e.date) - new Date(today)) / 86400000);
        let statusClass = 'later';
        let countdownText = 'بعد ' + diff + ' يوم';
        if (diff < 0) { statusClass = 'past'; countdownText = 'مر'; }
        else if (diff === 0) { statusClass = 'today'; countdownText = 'اليوم!'; }
        else if (diff === 1) { countdownText = 'بكرة!'; statusClass = 'soon'; }
        else if (diff <= 14) { statusClass = 'soon'; }
        const itemClass = diff < 0 ? 'past' : diff === 0 ? 'today' : 'upcoming';
        return `<div class="event-item ${itemClass}">
            <div class="event-flag">${getEventIcon('exhibition')}</div>
            <div class="event-info">
                <div class="event-name">${e.nameAr}</div>
                <div class="event-date">${e.name} — ${formatEventDate(e.date)}</div>
            </div>
            <span class="event-country-tag">${countryLabels[e.country]}</span>
            <span class="event-countdown ${statusClass}">${countdownText}</span>
        </div>`;
    }).join('');
}

function filterEvents(country) {
    eventsCountryFilter = country;
    document.querySelectorAll('[data-ecountry]').forEach(c => c.classList.remove('active'));
    document.querySelector(`[data-ecountry="${country}"]`).classList.add('active');
    renderEvents();
}

function renderEvents() {
    const today = new Date().toISOString().slice(0, 10);
    let filtered = holidaysData;
    if (eventsCountryFilter !== 'all') filtered = filtered.filter(e => e.country === eventsCountryFilter);
    filtered.sort((a, b) => a.date.localeCompare(b.date));

    const nextBox = document.getElementById('events-next');
    const upcoming = filtered.find(e => e.date >= today);
    if (upcoming) {
        const diff = Math.ceil((new Date(upcoming.date) - new Date(today)) / 86400000);
        const countryLabel = upcoming.country === 'ksa' ? 'السعودية' : 'مصر';
        nextBox.innerHTML = `
            <div class="events-next-label">الحدث القادم</div>
            <div class="events-next-name">${getEventIcon(upcoming.category)} ${upcoming.name}</div>
            <div class="events-next-date">${formatEventDate(upcoming.date)} — ${countryLabel}</div>
            <div class="events-next-countdown">${diff === 0 ? 'اليوم!' : diff === 1 ? 'بكرة!' : 'بعد ' + diff + ' يوم'}</div>
        `;
        nextBox.classList.add('visible');
    } else {
        nextBox.classList.remove('visible');
    }

    const listEl = document.getElementById('events-list');
    if (!filtered.length) {
        listEl.innerHTML = '<p class="empty-msg">لا توجد مناسبات</p>';
        return;
    }

    listEl.innerHTML = filtered.map(e => {
        const diff = Math.ceil((new Date(e.date) - new Date(today)) / 86400000);
        let statusClass = 'later';
        let countdownText = 'بعد ' + diff + ' يوم';
        if (diff < 0) { statusClass = 'past'; countdownText = 'مر'; }
        else if (diff === 0) { statusClass = 'today'; countdownText = 'اليوم!'; }
        else if (diff <= 14) { statusClass = 'soon'; countdownText = diff === 1 ? 'بكرة!' : 'بعد ' + diff + ' يوم'; }

        const itemClass = diff < 0 ? 'past' : diff === 0 ? 'today' : 'upcoming';
        const flagClass = e.country === 'ksa' ? 'ksa' : 'egypt';
        const countryTag = e.country === 'ksa' ? 'السعودية' : 'مصر';

        return `<div class="event-item ${itemClass}">
            <div class="event-flag ${flagClass}">${getEventIcon(e.category)}</div>
            <div class="event-info">
                <div class="event-name">${e.name}</div>
                <div class="event-date">${formatEventDate(e.date)}${e.nameAr ? ' — ' + e.nameAr : ''}</div>
            </div>
            <span class="event-country-tag ${flagClass}">${countryTag}</span>
            <span class="event-countdown ${statusClass}">${countdownText}</span>
        </div>`;
    }).join('');
}

function formatEventDate(dateStr) {
}

function formatEventDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    return days[d.getDay()] + ' ' + d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
}

// ==================== الإدخال الصوتي ====================
function startVoiceInput() {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
        showToast('❌ المتصفح لا يدعم الإدخال الصوتي', 'error');
        return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = 'ar-EG';
    recognition.continuous = false;
    recognition.interimResults = false;
    const btn = document.getElementById('voice-btn');
    btn.classList.add('recording');
    btn.textContent = '🔴';
    recognition.onresult = function(event) {
        const text = event.results[0][0].transcript;
        document.getElementById('task-name').value = text;
        btn.classList.remove('recording');
        btn.textContent = '🎤';
        showToast('🎤 تم التعرف على الصوت', 'success');
    };
    recognition.onerror = function() {
        btn.classList.remove('recording');
        btn.textContent = '🎤';
        showToast('❌ فشل التعرف على الصوت', 'error');
    };
    recognition.onend = function() {
        btn.classList.remove('recording');
        btn.textContent = '🎤';
    };
    recognition.start();
}

// ==================== المهام المتكررة ====================
function handleRecurringTask(task) {
    if (!task.recurrence || task.status !== 'completed') return;
    const nextDate = getNextDate(task.date, task.recurrence);
    if (!nextDate) return;
    const newTask = Object.assign({}, task);
    delete newTask.id;
    delete newTask.createdAt;
    delete newTask.completedAt;
    newTask.date = nextDate;
    newTask.status = 'new';
    newTask.completedAt = null;
    db.collection('users').doc(currentUser.uid).collection('tasks').add(newTask);
}

function getNextDate(dateStr, recurrence) {
    const d = new Date(dateStr + 'T00:00:00');
    if (recurrence === 'daily') d.setDate(d.getDate() + 1);
    else if (recurrence === 'weekly') d.setDate(d.getDate() + 7);
    else if (recurrence === 'monthly') d.setMonth(d.getMonth() + 1);
    else if (recurrence === 'yearly') d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().slice(0, 10);
}

function getRecurrenceLabel(r) {
    const m = { daily: '🔄 يومياً', weekly: '🔄 أسبوعياً', monthly: '🔄 شهرياً', yearly: '🔄 سنوياً' };
    return m[r] || '';
}

// ==================== التذكيرات المتعددة ====================
function setupReminders() {
    if (!currentUser || !('Notification' in window) || Notification.permission !== 'granted') return;
    const now = new Date();
    tasks.forEach(t => {
        if (t.archived || t.status === 'completed' || !t.time || !t.date) return;
        const reminderMin = parseInt(t.reminder) || 0;
        if (reminderMin === 0) return;
        const taskDateTime = new Date(t.date + 'T' + t.time + ':00');
        const reminderTime = new Date(taskDateTime.getTime() - reminderMin * 60000);
        const diff = reminderTime.getTime() - now.getTime();
        if (diff > 0 && diff < 60000) {
            const key = t.id + '_rem_' + today();
            if (!notifiedTasks.has(key)) {
                notifiedTasks.add(key);
                new Notification('⏰ تذكير: ' + t.name, {
                    body: 'بقال ' + reminderMin + ' دقيقة',
                    icon: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>⏰</text></svg>',
                    tag: key, requireInteraction: true
                });
            }
        }
    });
}
function today() { return new Date().toISOString().slice(0, 10); }

// ==================== الإحصائيات ====================
function renderStats() {
    const today = todayStr();
    const completed = tasks.filter(t => t.status === 'completed');
    const active = tasks.filter(t => t.status !== 'completed' && !t.archived);
    const overdue = tasks.filter(t => t.date < today && t.status !== 'completed' && !t.archived);

    document.getElementById('stats-overview').innerHTML = `
        <div class="stat-card"><div class="stat-number">${active.length}</div><div class="stat-label">مهام نشطة</div></div>
        <div class="stat-card"><div class="stat-number">${completed.length}</div><div class="stat-label">مكتملة</div></div>
        <div class="stat-card"><div class="stat-number">${overdue.length}</div><div class="stat-label">متأخرة</div></div>
    `;

    const weeklyData = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const ds = d.toISOString().slice(0, 10);
        const count = completed.filter(t => {
            if (!t.completedAt) return false;
            const cd = t.completedAt.toDate ? t.completedAt.toDate() : new Date(t.completedAt);
            return cd.toISOString().slice(0, 10) === ds;
        }).length;
        const dayNames = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];
        weeklyData.push({ day: dayNames[d.getDay()], count });
    }
    const maxWeekly = Math.max(...weeklyData.map(w => w.count), 1);
    document.getElementById('stats-weekly-chart').innerHTML = weeklyData.map(w =>
        `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span style="width:40px;font-size:12px;color:var(--text-muted)">${w.day}</span>
            <div class="chart-bar" style="flex:1"><div class="chart-bar-fill" style="width:${(w.count/maxWeekly)*100}%"></div></div>
            <span style="width:20px;font-size:13px;font-weight:700;text-align:center">${w.count}</span>
        </div>`
    ).join('');

    const priorities = { high: 0, medium: 0, low: 0 };
    overdue.forEach(t => { priorities[t.priority] = (priorities[t.priority] || 0) + 1; });
    const maxPri = Math.max(priorities.high, priorities.medium, priorities.low, 1);
    document.getElementById('stats-priority-chart').innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span style="width:50px;font-size:12px;color:var(--danger)">عالية</span>
            <div class="chart-bar" style="flex:1"><div class="chart-bar-fill" style="width:${(priorities.high/maxPri)*100}%;background:var(--danger)"></div></div>
            <span style="width:20px;font-size:13px;font-weight:700;text-align:center">${priorities.high}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span style="width:50px;font-size:12px;color:var(--warning-dark)">متوسطة</span>
            <div class="chart-bar" style="flex:1"><div class="chart-bar-fill" style="width:${(priorities.medium/maxPri)*100}%;background:var(--warning)"></div></div>
            <span style="width:20px;font-size:13px;font-weight:700;text-align:center">${priorities.medium}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span style="width:50px;font-size:12px;color:var(--success)">منخفضة</span>
            <div class="chart-bar" style="flex:1"><div class="chart-bar-fill" style="width:${(priorities.low/maxPri)*100}%;background:var(--success)"></div></div>
            <span style="width:20px;font-size:13px;font-weight:700;text-align:center">${priorities.low}</span>
        </div>
    `;

    const projMap = {};
    active.forEach(t => { const p = t.project || 'بدون مشروع'; projMap[p] = (projMap[p] || 0) + 1; });
    const projEntries = Object.entries(projMap).sort((a, b) => b[1] - a[1]);
    const maxProj = Math.max(...projEntries.map(e => e[1]), 1);
    document.getElementById('stats-project-chart').innerHTML = projEntries.map(([name, count]) =>
        `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span style="width:100px;font-size:12px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name}</span>
            <div class="chart-bar" style="flex:1"><div class="chart-bar-fill" style="width:${(count/maxProj)*100}%"></div></div>
            <span style="width:20px;font-size:13px;font-weight:700;text-align:center">${count}</span>
        </div>`
    ).join('');
}

// ==================== العرض — المهام ====================
function renderTasks() {
    const filtered = getFilteredTasks();
    const listView = document.getElementById('tasks-list-view');
    const kanbanView = document.getElementById('tasks-kanban-view');
    listView.style.display = currentView === 'list' ? 'block' : 'none';
    kanbanView.style.display = currentView === 'kanban' ? 'flex' : 'none';
    if (currentView === 'list') {
        listView.innerHTML = filtered.length ? filtered.map(t => createTaskHTML(t)).join('') : '<p class="empty-msg">لا توجد مهام</p>';
    } else {
        renderKanban(filtered);
    }
}

function renderKanban(tasksList) {
    const statuses = [
        { key: 'new', label: 'جديدة' },
        { key: 'in_progress', label: 'جاري التنفيذ' },
        { key: 'completed', label: 'مكتملة' },
    ];
    const board = document.getElementById('tasks-kanban-view');
    board.innerHTML = statuses.map(s => {
        const items = tasksList.filter(t => t.status === s.key);
        return `<div class="kanban-col">
            <div class="kanban-col-header">
                <span>${s.label}</span>
                <span class="count">${items.length}</span>
            </div>
            <div class="kanban-col-body">
                ${items.length ? items.map(t => `
                    <div class="kanban-card" onclick="openEditTaskModal(tasks.find(x => x.id === '${t.id}'))">
                        <div class="k-title">${t.name}</div>
                        <div class="k-meta">
                            <span class="priority-badge priority-${t.priority}">${t.priority === 'high' ? 'عالية' : t.priority === 'medium' ? 'متوسطة' : 'منخفضة'}</span>
                            ${t.date ? '<span>' + t.date + '</span>' : ''}
                        </div>
                    </div>
                `).join('') : '<p class="empty-msg">لا توجد مهام</p>'}
            </div>
        </div>`;
    }).join('');
}

function createTaskHTML(task) {
    const priorityLabel = { high: 'عالية', medium: 'متوسطة', low: 'منخفضة' };
    const statusLabel = { new: 'جديدة', in_progress: 'جاري التنفيذ', completed: 'مكتملة' };
    const isOverdue = task.date < todayStr() && task.status !== 'completed';
    const isStarted = !!task.startTime;
    const isFinished = !!task.endTime;
    let timeBadge = '';
    if (isFinished && task.startTime && task.endTime) {
        const dur = Math.round((new Date(task.endTime) - new Date(task.startTime)) / 60000);
        const h = Math.floor(dur / 60);
        const m = dur % 60;
        timeBadge = '<span class="type-badge" style="background:#e8f5e9;color:#2e7d32;">' + (h > 0 ? h + 'س ' : '') + m + 'د</span>';
    } else if (isStarted) {
        timeBadge = '<span class="type-badge" style="background:#fff3e0;color:#e65100;">جاري التنفيذ</span>';
    }
    const actionBtns = task.status === 'completed' ? '' :
        !isStarted ?
            '<button class="task-action-btn start-btn" onclick="event.stopPropagation();startTask(\'' + task.id + '\')" title="ابدأ"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></button>' :
            '<button class="task-action-btn finish-btn" onclick="event.stopPropagation();finishTask(\'' + task.id + '\')" title="أنهِ"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect></svg></button>';
    return `<div class="task-item ${task.status === 'completed' ? 'completed' : ''} ${isOverdue ? 'overdue' : ''}">
        <div class="task-check ${task.status === 'completed' ? 'done' : ''}" onclick="toggleTaskComplete('${task.id}')">
            ${task.status === 'completed' ? '✓' : ''}
        </div>
        <div class="task-content" onclick="openEditTaskModal(tasks.find(t => t.id === '${task.id}'))">
            <div class="task-text">${task.name}</div>
            <div class="task-meta">
                <span class="type-badge type-${task.type}">${task.type === 'work' ? 'عمل' : 'شخصي'}</span>
                <span class="priority-badge priority-${task.priority}">${priorityLabel[task.priority]}</span>
                <span class="status-badge status-${task.status}">${statusLabel[task.status]}</span>
                ${task.project ? '<span class="type-badge" style="background:#fef3c7;color:#92400e;">' + task.project + '</span>' : ''}
                ${task.date ? '<span class="type-badge" style="background:#f0f0f0;color:#555;">' + task.date + '</span>' : ''}
                ${timeBadge}
                ${task.recurrence ? '<span class="type-badge" style="background:#ede9ff;color:#7c3aed;">' + getRecurrenceLabel(task.recurrence) + '</span>' : ''}
                ${isOverdue ? '<span class="priority-badge priority-high">متأخرة</span>' : ''}
            </div>
        </div>
        <div class="task-actions">
            ${actionBtns}
            <button class="icon-btn" onclick="event.stopPropagation();duplicateTask('${task.id}')" title="نسخ"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>
            <button class="icon-btn" onclick="event.stopPropagation();archiveTask('${task.id}')" title="أرشفة"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg></button>
            <button class="icon-btn" onclick="event.stopPropagation();deleteTask('${task.id}')" title="حذف"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
        </div>
    </div>`;
}

// ==================== الصفحة الرئيسية ====================
const QUOTES = [
    { text: 'المهام الكبيرة تبدأ بخطوة صغيرة. ابدأ الآن ولن تندم.', author: 'بروفيسور شولتس' },
    { text: 'ليس المهم أن تفعل كل شيء، المهم أن تفعل الشيء الصحيح.', author: 'آدم غرانت' },
    { text: 'لا تنتظر أن يصبح لديك وقت. خذ الوقت الذي لديك وابدأ به.', author: 'جون وودن' },
    { text: 'التنظيم هو الخطوة الأولى نحو الإنجاز.', author: 'فرانكلين كوفي' },
    { text: 'كل مهمة مكتملة كانت في يوم ما مجرد فكرة. اليوم أنت تبدأ.', author: 'أنت' },
    { text: 'أفضل طريقة لإنهاء مشروع صعب هي أن تبدأ به.', author: 'مارك توين' },
    { text: 'الانتصار ليس في التخطيط للعمل، بل في العمل على التخطيط.', author: 'نابليون بونابرت' },
    { text: 'لا تدع الكمال يكون عدو الإنجاز. أنجز اليوم ما تستطيع.', author: 'voltaire' },
    { text: 'الانضباط هو الفرق بين من يحلم ومن ينجز.', author: 'جوردن بيتشر' },
    { text: 'ما لا يُقاس لا يُدار. حدد هدفك وتابع تقدمك.', author: 'بيتر دراكر' },
];

function renderHome() {
    const today = todayStr();
    const now = new Date();
    const dayName = now.toLocaleDateString('ar-SA', { weekday: 'long' });
    const monthName = now.toLocaleDateString('ar-SA', { month: 'long' });
    const dateStr = dayName + '، ' + now.getDate() + ' ' + monthName + ' ' + now.getFullYear();
    document.getElementById('home-date').textContent = dateStr;

    // ترحيب حسب الوقت
    const hour = now.getHours();
    const firstName = 'وليد';
    let greeting = 'مساء الخير يا ' + firstName + ' 🌙';
    if (hour >= 5 && hour < 12) greeting = 'صباح النور يا ' + firstName + ' ☀️';
    else if (hour >= 12 && hour < 17) greeting = 'مساء النور يا ' + firstName + ' 🌤️';
    else if (hour >= 17 && hour < 21) greeting = 'مساء الخير يا ' + firstName + ' 🌅';
    document.getElementById('home-greeting').textContent = greeting;

    // اقتباس تحفيزي - واحد على كل الأجهزة
    const quoteEl = document.getElementById('home-quote');
    const todayKey = todayStr();
    const quoteRef = db.collection('dailyQuotes').doc(todayKey);
    quoteRef.get().then(doc => {
        let q;
        if (doc.exists && doc.data().text) {
            q = QUOTES.find(x => x.text === doc.data().text) || QUOTES[Math.floor(Math.random() * QUOTES.length)];
        } else {
            q = QUOTES[Math.floor(Math.random() * QUOTES.length)];
            quoteRef.set({ text: q.text, author: q.author, date: todayKey }).catch(() => {});
        }
        quoteEl.innerHTML = '<span class="quote-text">« ' + q.text + ' »</span><span class="quote-author">— ' + q.author + '</span>';
    }).catch(() => {
        const q = QUOTES[Math.floor(Math.random() * QUOTES.length)];
        quoteEl.innerHTML = '<span class="quote-text">« ' + q.text + ' »</span><span class="quote-author">— ' + q.author + '</span>';
    });

    const todayTasks = tasks.filter(t => t.date === today && !t.archived);
    const overdueTasks = tasks.filter(t => t.date < today && t.status !== 'completed' && !t.archived);
    const upcomingTasks = tasks.filter(t => t.date > today && t.status !== 'completed' && !t.archived);
    const completedTasks = tasks.filter(t => t.status === 'completed' && !t.archived);

    document.getElementById('stat-today').textContent = todayTasks.length;
    document.getElementById('stat-overdue').textContent = overdueTasks.length;
    document.getElementById('stat-upcoming').textContent = upcomingTasks.length;
    document.getElementById('stat-completed').textContent = completedTasks.length;

    const homeToday = document.getElementById('home-today-list');
    homeToday.innerHTML = todayTasks.length
        ? todayTasks.slice(0, 5).map(t => createTaskHTML(t)).join('')
        : '<p class="empty-msg">لا توجد مهام اليوم</p>';

    const homeOverdue = document.getElementById('home-overdue-list');
    homeOverdue.innerHTML = overdueTasks.length
        ? overdueTasks.slice(0, 5).map(t => createTaskHTML(t)).join('')
        : '<p class="empty-msg">لا توجد مهام متأخرة</p>';
}

function updateClock() {
    const cairo = document.getElementById('clock-cairo');
    const riyadh = document.getElementById('clock-riyadh');
    if (!cairo || !riyadh) return;
    const now = new Date();
    function fmt(tz) {
        const s = now.toLocaleString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
        const [h, m] = s.split(':').map(Number);
        const ampm = h >= 12 ? 'مساءاً' : 'صباحاً';
        const h12 = h % 12 || 12;
        return String(h12).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ' ' + ampm;
    }
    cairo.textContent = fmt('Africa/Cairo');
    riyadh.textContent = fmt('Asia/Riyadh');
}

function updateProgress() {
    const today = todayStr();
    const todayTasks = tasks.filter(t => t.date === today && !t.archived);
    const overdueTasks = tasks.filter(t => t.date < today && t.status !== 'completed' && !t.archived);
    const activeTasks = [...todayTasks, ...overdueTasks];
    const total = activeTasks.length;
    const completed = activeTasks.filter(t => t.status === 'completed').length;
    const pct = total ? Math.round((completed / total) * 100) : 0;
    document.getElementById('progress-fill').style.width = pct + '%';
    document.getElementById('progress-percent').textContent = pct + '%';
    document.getElementById('sidebar-progress-fill').style.width = pct + '%';
    document.getElementById('sidebar-progress-text').textContent = pct + '%';
}

// ==================== التقويم ====================
function renderCalendar() {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    document.getElementById('calendar-month-year').textContent = MONTHS[month] + ' ' + year;

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = '';

    const today = todayStr();

    // الأيام من الشهر السابق
    for (let i = firstDay; i > 0; i--) {
        const day = daysInPrevMonth - i + 1;
        const cell = createDayCell(year, month - 1, day, true);
        grid.appendChild(cell);
    }

    // أيام الشهر الحالي
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
        const cell = createDayCell(year, month, day, false, dateStr === today, dateStr);
        grid.appendChild(cell);
    }

    // الأيام من الشهر التالي
    const totalCells = firstDay + daysInMonth;
    const remaining = (7 - (totalCells % 7)) % 7;
    for (let day = 1; day <= remaining; day++) {
        const cell = createDayCell(year, month + 1, day, true);
        grid.appendChild(cell);
    }

    document.getElementById('calendar-tasks-card').style.display = 'none';
}

function createDayCell(year, month, day, otherMonth, isToday, dateStr) {
    const cell = document.createElement('div');
    cell.className = 'calendar-day';
    if (otherMonth) cell.classList.add('other-month');
    if (isToday) cell.classList.add('today');
    if (selectedDate === dateStr) cell.classList.add('selected');

    const hasTasks = dateStr && tasks.filter(t => t.date === dateStr && !t.archived).length > 0;
    if (hasTasks) cell.classList.add('has-tasks');

    cell.textContent = day;
    if (dateStr) {
        cell.addEventListener('click', () => selectDate(dateStr));
    }
    return cell;
}

function selectDate(dateStr) {
    selectedDate = dateStr;
    renderCalendar();
    const dayTasks = tasks.filter(t => t.date === dateStr && !t.archived);
    const el = document.getElementById('calendar-tasks-card');
    const list = document.getElementById('calendar-day-tasks');
    const dateLabel = document.getElementById('calendar-selected-date');

    const d = new Date(dateStr + 'T00:00:00');
    dateLabel.textContent = 'مهام ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
    el.style.display = 'block';
    list.innerHTML = dayTasks.length
        ? dayTasks.map(t => createTaskHTML(t)).join('')
        : '<p class="empty-msg">لا توجد مهام في هذا اليوم</p>';
}

function changeMonth(dir) {
    calendarDate.setMonth(calendarDate.getMonth() + dir);
    selectedDate = null;
    renderCalendar();
    document.getElementById('calendar-tasks-card').style.display = 'none';
}

// ==================== المشاريع ====================
function renderProjects() {
    ['work', 'personal'].forEach(type => {
        const container = document.getElementById('proj-list-' + type);
        if (!container) return;
        const items = projects[type] || [];
        if (!items.length) {
            container.innerHTML = '<p class="empty-msg" style="margin:12px 0">لا توجد مشاريع. أضف أول مشروع!</p>';
            return;
        }
        container.innerHTML = items.map(p => {
            const count = tasks.filter(t => t.project === p && !t.archived).length;
            const icon = p.charAt(0).toUpperCase();
            const colors = ['#6c5ce7','#00cec9','#fd79a8','#00b894','#fdcb6e','#e17055','#0984e3','#d63031','#6c5ce7','#00b894'];
            const color = colors[items.indexOf(p) % colors.length];
            return `
            <div class="project-card" onclick="filterByProject('${p.replace(/'/g,"\\'")}')">
                <div class="project-icon" style="background:${color}">${icon}</div>
                <div class="project-info">
                    <div class="project-name">${p}</div>
                    <div class="project-count">${count} مهام</div>
                </div>
                <div class="project-card-actions">
                    <button class="icon-btn" onclick="event.stopPropagation();startEditProjectFromPage('${p.replace(/'/g,"\\'")}','${type}')" title="تعديل"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>
                    <button class="icon-btn" onclick="event.stopPropagation();confirmDeleteProjectFromPage('${p.replace(/'/g,"\\'")}','${type}')" title="حذف"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
                </div>
            </div>
            <div class="project-edit-inline" id="edit-inline-${p.replace(/\s/g,'_')}" style="display:none">
                <input type="text" id="edit-input-${p.replace(/\s/g,'_')}" value="${p}" style="flex:1">
                <button class="btn btn-sm btn-success" onclick="doEditProjectFromPage('${p.replace(/'/g,"\\'")}','${type}')">حفظ</button>
                <button class="btn btn-sm btn-secondary" onclick="cancelEditProjectFromPage('${p.replace(/\s/g,'_')}')">إلغاء</button>
            </div>`;
        }).join('');
    });
}

function addProjectFromPage(type) {
    const input = document.getElementById('project-input-' + type);
    const name = input.value.trim();
    if (!name) { showToast('❌ أدخل اسم المشروع', 'error'); return; }
    if ((projects[type] || []).includes(name)) { showToast('⚠️ المشروع موجود مسبقاً', 'error'); return; }
    input.value = '';
    addProject(name, type);
}

function startEditProjectFromPage(name, type) {
    document.getElementById('edit-inline-' + name.replace(/\s/g,'_')).style.display = 'flex';
}

function cancelEditProjectFromPage(id) {
    document.getElementById('edit-inline-' + id).style.display = 'none';
}

function doEditProjectFromPage(oldName, type) {
    const input = document.getElementById('edit-input-' + oldName.replace(/\s/g,'_'));
    const newName = input.value.trim();
    if (!newName) { showToast('❌ أدخل اسم صحيح', 'error'); return; }
    if ((projects[type] || []).includes(newName) && newName !== oldName) { showToast('⚠️ الاسم موجود بالفعل', 'error'); return; }
    document.getElementById('edit-inline-' + oldName.replace(/\s/g,'_')).style.display = 'none';
    editProject(oldName, newName, type);
}

function confirmDeleteProjectFromPage(name, type) {
    showConfirm('حذف المشروع', 'سيتم حذف المشروع "' + name + '".', () => {
        // لو المشروع افتراضي، نخزنه في localStorage علا مايظهرش تاني
        if (DEFAULT_PROJECTS[type].includes(name)) {
            if (!deletedDefaults.includes(name)) deletedDefaults.push(name);
            localStorage.setItem('wp_deleted_projects', JSON.stringify(deletedDefaults));
        }
        deleteProject(name, type);
    });
}

function switchProjectTab(tab) {
    document.querySelectorAll('.project-tab').forEach(t => t.classList.remove('active'));
    document.getElementById('ptab-' + tab).classList.add('active');
    document.querySelectorAll('.project-section').forEach(s => s.classList.remove('active'));
    document.getElementById('projects-' + tab).classList.add('active');
}

let currentProjectFilter = '';

function filterByProject(project) {
    currentProjectFilter = project;
    navigate('tasks');
    setTimeout(() => {
        document.querySelectorAll('#task-filters .chip').forEach(c => c.classList.remove('active'));
        renderTasks();
    }, 50);
}

// ==================== العملاء ====================
// ==================== الأرشيف ====================
function renderArchive() {
    const archived = tasks.filter(t => t.archived);
    const el = document.getElementById('archive-list');
    if (!archived.length) { el.innerHTML = '<p class="empty-msg">لا توجد مهام مؤرشفة</p>'; return; }
    el.innerHTML = archived.map(t => {
        const task = t;
        return `<div class="task-item">
            <div class="task-content">
                <div class="task-text">${task.name}</div>
                <div class="task-meta">
                    <span>📅 ${task.date || ''}</span>
                    ${task.project ? '<span>📁 ' + task.project + '</span>' : ''}
                </div>
            </div>
            <div class="task-actions">
                <button class="icon-btn" onclick="unarchiveTask('${task.id}')" title="إلغاء الأرشفة"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><path d="M4 20L21 3"></path></svg></button>
                <button class="icon-btn" onclick="deleteTask('${task.id}')" title="حذف"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
            </div>
        </div>`;
    }).join('');
}

// ==================== الوضع الليلي ====================
function toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const newTheme = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('wp_theme', newTheme);
    document.getElementById('theme-toggle').innerHTML = newTheme === 'dark'
        ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>'
        : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';
}

function toggleThemeFromSettings() {
    const checked = document.getElementById('theme-toggle-setting').checked;
    const newTheme = checked ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('wp_theme', newTheme);
    document.getElementById('theme-toggle').innerHTML = newTheme === 'dark'
        ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>'
        : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';
}

function applySavedTheme() {
    const saved = localStorage.getItem('wp_theme');
    if (saved === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        document.getElementById('theme-toggle').innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';
    }
}

// ==================== الإشعارات ====================
function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission !== 'granted') {
        Notification.requestPermission();
    }
}

let notifiedTasks = new Set();

function startTaskTimeChecker() {
    checkTaskTimes();
    setInterval(checkTaskTimes, 60000);
    setInterval(setupReminders, 60000);
}

function checkTaskTimes() {
    if (!currentUser || !('Notification' in window) || Notification.permission !== 'granted') return;
    const now = new Date();
    const currentHour = String(now.getHours()).padStart(2, '0');
    const currentMin = String(now.getMinutes()).padStart(2, '0');
    const currentTime = currentHour + ':' + currentMin;
    const today = todayStr();

    tasks.forEach(t => {
        if (t.archived || t.status === 'completed' || !t.time || !t.date) return;
        const notifyKey = t.id + '_' + today;
        if (notifiedTasks.has(notifyKey)) return;
        if (t.date === today && t.time === currentTime) {
            notifiedTasks.add(notifyKey);
            new Notification('لديك مهمة جديدة', {
                body: '⏰ حان موعد مهمة',
                icon: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🔔</text></svg>',
                tag: notifyKey,
                requireInteraction: true
            });
        }
    });
}

function checkNotifications() {
    const today = todayStr();
    const overdueTasks = tasks.filter(t => t.date < today && t.status !== 'completed' && !t.archived);
    const todayTasks = tasks.filter(t => t.date === today && t.status !== 'completed' && !t.archived);
    const highPriority = tasks.filter(t => t.priority === 'high' && t.status !== 'completed' && !t.archived);

    // الإشعارات داخل التطبيق (الجرس)
    allNotifications = [];
    todayTasks.forEach(t => {
        allNotifications.push({ text: '📅 مهمة اليوم: ' + t.name, time: 'اليوم', type: 'reminder' });
    });
    overdueTasks.forEach(t => {
        allNotifications.push({ text: '🔴 متأخرة: ' + t.name, time: t.date, type: 'overdue' });
    });
    highPriority.forEach(t => {
        allNotifications.push({ text: '🔴 أولوية عالية: ' + t.name, time: t.date || '', type: 'high' });
    });

    const badge = document.getElementById('notif-badge');
    if (allNotifications.length > 0) {
        badge.style.display = 'flex';
        badge.textContent = allNotifications.length;
    } else {
        badge.style.display = 'none';
    }
}

function showNotificationPanel() {
    const panel = document.getElementById('notif-panel');
    const list = document.getElementById('notif-list');
    const isOpen = panel.classList.contains('open');
    if (isOpen) {
        panel.classList.remove('open');
        return;
    }
    if (!allNotifications.length) {
        list.innerHTML = '<p class="empty-msg">لا توجد إشعارات</p>';
    } else {
        list.innerHTML = allNotifications.map(n =>
            `<div class="notif-item ${n.type === 'overdue' ? 'notif-overdue' : 'notif-reminder'}">
                <div>${n.text}</div>
                <div class="notif-time">${n.time}</div>
            </div>`
        ).join('');
    }
    panel.classList.add('open');
}

function closeNotificationPanel() {
    document.getElementById('notif-panel').classList.remove('open');
}

// ==================== التذكير اليومي ====================
function setupDailyReminder() {
    const enabled = localStorage.getItem('wp_reminder') !== 'false';
    document.getElementById('reminder-toggle').checked = enabled;

    if (!enabled || !currentUser) return;
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0);
    if (now > target) target.setDate(target.getDate() + 1);
    const delay = target - now;
    setTimeout(() => {
        sendDailyReminder();
        setInterval(sendDailyReminder, 24 * 60 * 60 * 1000);
    }, delay);
}

document.getElementById('reminder-toggle').addEventListener('change', function() {
    localStorage.setItem('wp_reminder', this.checked);
    if (this.checked) setupDailyReminder();
});

function buildTasksSummary() {
    const today = todayStr();
    const todayTasks = tasks.filter(t => t.date === today && t.status !== 'completed' && !t.archived);
    const overdueTasks = tasks.filter(t => t.date < today && t.status !== 'completed' && !t.archived);
    let body = '';
    if (todayTasks.length) {
        body += '═══════════════════════════════════\n';
        body += '📅 مهام اليوم (' + todayTasks.length + ')\n';
        body += '═══════════════════════════════════\n\n';
        todayTasks.forEach((t, i) => {
            const p = t.priority === 'high' ? '🔴 عالية' : t.priority === 'low' ? '🟢 منخفضة' : '🟡 متوسطة';
            const type = t.type === 'personal' ? '👤 شخصي' : '💼 عمل';
            body += (i + 1) + '. ' + t.name + '\n';
            body += '   ├ الأولوية: ' + p + '\n';
            body += '   ├ النوع: ' + type + '\n';
            if (t.project) body += '   ├ المشروع: ' + t.project + '\n';
            if (t.time) body += '   └ الوقت: ' + formatTime12(t.time) + (t.timeEnd ? ' → ' + formatTime12(t.timeEnd) : '') + '\n';
            else body += '   └───────────\n';
            if (i < todayTasks.length - 1) body += '\n';
        });
    }
    if (overdueTasks.length) {
        if (todayTasks.length) body += '\n';
        body += '═══════════════════════════════════\n';
        body += '🔴 مهام متأخرة (' + overdueTasks.length + ')\n';
        body += '═══════════════════════════════════\n\n';
        overdueTasks.forEach((t, i) => {
            const p = t.priority === 'high' ? '🔴 عالية' : t.priority === 'low' ? '🟢 منخفضة' : '🟡 متوسطة';
            body += (i + 1) + '. ' + t.name + '\n';
            body += '   ├ الأولوية: ' + p + '\n';
            body += '   ├ الموعد: ' + t.date + '\n';
            if (t.project) body += '   └ المشروع: ' + t.project + '\n';
            else body += '   └───────────\n';
            if (i < overdueTasks.length - 1) body += '\n';
        });
    }
    if (!todayTasks.length && !overdueTasks.length) {
        body = '🎉 لا توجد مهام اليوم!';
    }
    return body;
}

function testReminderEmail() {
    const email = document.getElementById('settings-email').value.trim();
    if (!email || !email.includes('@')) {
        showToast('❌ أدخل بريداً إلكترونياً صحيحاً أولاً', 'error');
        return;
    }
    const body = buildTasksSummary();
    sendEmail('📋 Walid Planner - اختبار الإرسال', body, email);
    // حفظ الملخص لـ Firebase عشان الـ GitHub Action يقراه
    if (currentUser && body.trim()) {
        db.collection('reminders').doc(todayStr()).set({
            body: body,
            date: todayStr(),
            sent: true,
            email: email,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(err => console.warn('Reminder save error:', err));
    }
}

function sendDailyReminder() {
    if (!currentUser) return;
    const today = todayStr();
    const todayTasks = tasks.filter(t => t.date === today && t.status !== 'completed' && !t.archived);
    const overdueTasks = tasks.filter(t => t.date < today && t.status !== 'completed' && !t.archived);

    if (todayTasks.length === 0 && overdueTasks.length === 0) return;

    const body = buildTasksSummary();

    // حفظ الملخص في Firebase عشان الـ GitHub Action يقراه ويبعت الإيميل
    if (currentUser && body.trim()) {
        db.collection('reminders').doc(todayStr()).set({
            body: body,
            date: todayStr(),
            sent: false,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(err => console.warn('Reminder save error:', err));
    }
}

// ==================== البريد الإلكتروني ====================
// يستخدم FormSubmit (formsubmit.co) — مجاني, مفيش إعدادات مطلوبة

function sendEmail(subject, body, toEmail) {
    fetch('https://formsubmit.co/ajax/' + encodeURIComponent(toEmail), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
            subject: subject,
            message: body
        })
    }).then(r => {
        if (r.ok) { showToast('📨 تم إرسال البريد بنجاح', 'success'); }
        else { throw new Error('فشل الإرسال'); }
    }).catch(err => {
        console.error('FormSubmit error:', err);
        showToast('❌ فشل الإرسال، تأكد من صحة البريد', 'error');
    });
}

// ==================== الإعدادات ====================
function saveAllowedEmail() {
    const email = document.getElementById('settings-email').value.trim();
    if (email && email.includes('@')) {
        localStorage.setItem('wp_allowed_email', email);
        document.getElementById('login-email-display').textContent = email;
        showToast('✅ تم حفظ البريد الإلكتروني', 'success');
    } else {
        showToast('❌ يرجى إدخال بريد إلكتروني صحيح', 'error');
    }
}

// ==================== التصدير ====================
function exportToExcel() {
    const data = tasks.filter(t => !t.archived);
    if (!data.length) { showToast('❌ لا توجد بيانات للتصدير', 'error'); return; }
    const csv = tasksToCSV(data);
    downloadFile(csv, 'walid-planner-tasks.xls', 'text/csv');
    showToast('✅ تم تصدير المهام بنجاح', 'success');
}

function exportToCSV() {
    const data = tasks.filter(t => !t.archived);
    if (!data.length) { showToast('❌ لا توجد بيانات للتصدير', 'error'); return; }
    const csv = tasksToCSV(data);
    downloadFile(csv, 'walid-planner-tasks.csv', 'text/csv;charset=utf-8');
    showToast('✅ تم تصدير المهام بنجاح', 'success');
}

function tasksToCSV(data) {
    const headers = ['الاسم', 'الوصف', 'النوع', 'المشروع', 'الأولوية', 'الحالة', 'التاريخ', 'الوقت', 'تاريخ الإنجاز'];
    const rows = data.map(t => [
        `"${t.name}"`, `"${(t.desc || '').replace(/"/g, '""')}"`,
        t.type === 'work' ? 'عمل' : 'شخصي',
        t.project || '', t.priority, t.status, t.date, t.time,
        t.completedAt ? new Date(t.completedAt.seconds * 1000).toISOString().slice(0, 10) : ''
    ]);
    return '\uFEFF' + headers.join(',') + '\n' + rows.map(r => r.join(',')).join('\n');
}

function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// ==================== حذف البيانات ====================
function clearAllData() {
    showConfirm('مسح جميع البيانات', 'هل أنت متأكد؟ لا يمكن التراجع عن هذا الإجراء.', async () => {
        if (!currentUser) return;
        const snapshot = await db.collection('users').doc(currentUser.uid).collection('tasks').get();
        const batch = db.batch();
        snapshot.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        showToast('🗑️ تم مسح جميع البيانات', 'success');
    });
}

// ==================== مودال التأكيد ====================
function showConfirm(title, message, callback) {
    confirmCallback = callback;
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    document.getElementById('confirm-modal').style.display = 'flex';
}

function closeConfirmModal() {
    document.getElementById('confirm-modal').style.display = 'none';
    confirmCallback = null;
}

function confirmAction() {
    if (confirmCallback) confirmCallback();
    closeConfirmModal();
}

// ==================== Toast ====================
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ==================== إغلاق المودال عند النقر خارجياً ====================
function closeModalOnOverlay(event) {
    if (event.target.classList.contains('modal-overlay')) {
        event.target.style.display = 'none';
    }
}

// ==================== التحقق من حالة المصادقة ====================
firebase.auth().onAuthStateChanged(user => {
    if (user) {
        const allowedEmail = localStorage.getItem('wp_allowed_email');
        if (allowedEmail && user.email !== allowedEmail) {
            firebase.auth().signOut();
            document.getElementById('login-screen').style.display = 'flex';
            document.getElementById('login-error').textContent = '❌ هذا البريد غير مسموح به';
            return;
        }
        if (!allowedEmail) {
            localStorage.setItem('wp_allowed_email', user.email);
        }
        currentUser = user;
        // حفظ UID المستخدم في Firebase عشان الـ Action يعرف يقرا المهام
        db.collection('users').doc(user.uid).set({ email: user.email, name: user.displayName || '' }, { merge: true }).then(() => {
            console.log('✅ User saved to Firestore:', user.uid);
        }).catch(err => {
            console.warn('❌ Failed to save user:', err.message);
        });
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app').style.display = 'flex';
        document.getElementById('user-name').textContent = user.displayName || 'المستخدم';
        document.getElementById('user-email').textContent = user.email;
        document.getElementById('settings-email').value = localStorage.getItem('wp_allowed_email') || user.email;
        applySavedTheme();
        updateProjectsDropdown();
        loadProjects();
        loadTasks();
        setupDailyReminder();
        requestNotificationPermission();
        // إغلاق القائمة المنسدلة عند الضغط خارجها
        document.addEventListener('click', function(e) {
            const panel = document.getElementById('notif-panel');
            const bell = document.getElementById('notification-bell');
            if (panel.classList.contains('open') &&
                !panel.contains(e.target) &&
                !bell.contains(e.target)) {
                panel.classList.remove('open');
            }
        });
        // تشغيل الساعة
        updateClock();
        if (window.clockInterval) clearInterval(window.clockInterval);
        window.clockInterval = setInterval(updateClock, 1000);
        // استعادة آخر صفحة من الهاش
        const page = location.hash.replace('#page-', '') || 'home';
        if (page !== 'home') navigate(page);
    } else if (!currentUser) {
        document.getElementById('login-screen').style.display = 'flex';
        document.getElementById('app').style.display = 'none';
    }
});