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
    loadFinanceTransactions();
    document.getElementById('fin-date').value = todayStr();
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
    if (page === 'tasks') { renderTasks(); if (params && params.filter) filterTasks(params.filter); }
    if (page === 'calendar') renderCalendar();
    if (page === 'projects') renderProjects();
    if (page === 'finance') renderFinance();
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
        if (fbProjects.work.length === 0 && fbProjects.personal.length === 0) {
            // أول مرة — استخدم الـ defaults
            projects.work = wd;
            projects.personal = pd;
        } else {
            projects.work = fbProjects.work;
            projects.personal = fbProjects.personal;
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
    document.getElementById('task-time').value = data && data.time ? data.time : '';
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
    document.getElementById('task-time').value = task.time || '';
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
    const time = document.getElementById('task-time').value;
    const errorEl = document.getElementById('modal-error');

    if (!name) { errorEl.textContent = '❌ يرجى إدخال اسم المهمة'; return; }
    if (!date) { errorEl.textContent = '❌ يرجى اختيار تاريخ التنفيذ'; return; }
    errorEl.textContent = '';

    const taskData = {
        name, desc: desc || '',
        type, project,
        priority, status,
        date, time: time || '',
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
        archived: false,
        completedAt: null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    db.collection('users').doc(currentUser.uid).collection('tasks').add(newTask);
    showToast('📋 تم نسخ المهمة', 'success');
}

function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// ==================== التصفية والعرض ====================
function filterTasks(filter) {
    currentFilter = filter;
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

// ==================== الأموال ====================
let financeTransactions = [];
let financeFilter = 'all';
let startingBalance = 0;



function saveStartingBalance() {
    const val = parseFloat(document.getElementById('fin-starting-balance').value) || 0;
    startingBalance = val;
    db.collection('users').doc(currentUser.uid).set({ startingBalance: val }, { merge: true })
        .then(() => showToast('✅ تم حفظ رصيد البداية', 'success'))
        .catch(err => {
            console.error('Starting balance save error:', err);
            showToast('❌ فشل الحفظ', 'error');
        });
}

function populateFinanceProjects() {
    const sel = document.getElementById('fin-project');
    if (!sel) return;
    const current = sel.value;
    let allProjects = [];
    if (Array.isArray(projects)) {
        allProjects = projects.map(p => ({ name: p.name || p, label: (p.type === 'personal' ? '🏠 ' : '💼 ') + (p.name || p) }));
    } else if (projects.work || projects.personal) {
        (projects.work || []).forEach(p => allProjects.push({ name: p, label: '💼 ' + p }));
        (projects.personal || []).forEach(p => allProjects.push({ name: p, label: '🏠 ' + p }));
    }
    sel.innerHTML = '<option value="">بدون مشروع</option>' + allProjects.map(p =>
        `<option value="${p.name}" ${p.name === current ? 'selected' : ''}>${p.label}</option>`
    ).join('');
}

async function addFinanceTransaction() {
    const nameEl = document.getElementById('fin-name');
    const amountEl = document.getElementById('fin-amount');
    const name = nameEl.value.trim();
    const amount = parseFloat(amountEl.value);
    const type = document.getElementById('fin-type').value;
    const project = document.getElementById('fin-project').value;
    const date = document.getElementById('fin-date').value;
    const note = document.getElementById('fin-note').value.trim();

    if (!name) { showToast('ادخل اسم المعاملة', 'error'); return; }
    if (!amount || amount <= 0) { showToast('ادخل مبلغ صحيح', 'error'); return; }
    if (!date) { showToast('اختر التاريخ', 'error'); return; }
    if (!currentUser) { showToast('سجل دخول أولاً', 'error'); return; }

    const tx = { name, amount, type, project, date, note, createdAt: new Date().toISOString() };
    const colRef = db.collection('users').doc(currentUser.uid).collection('finance');

    try {
        const docRef = await colRef.add(tx);
        tx.id = docRef.id;
        financeTransactions.unshift(tx);
        renderFinance();
        showToast('✅ تمت الإضافة', 'success');
        nameEl.value = '';
        amountEl.value = '';
        document.getElementById('fin-note').value = '';
        console.log('Finance saved with doc id:', docRef.id);
    } catch(err) {
        alert('خطأ في الحفظ: ' + err.code + ' - ' + err.message);
        console.error('Finance save error:', err);
    }
}

function loadFinanceTransactions() {
    if (!currentUser) return;
    db.collection('users').doc(currentUser.uid).collection('finance')
        .orderBy('createdAt', 'desc').get().then(snapshot => {
        financeTransactions = [];
        snapshot.forEach(doc => {
            financeTransactions.push({ id: doc.id, ...doc.data() });
        });
        console.log('Finance loaded:', financeTransactions.length);
        renderFinance();
    }).catch(err => {
        console.error('Finance load error:', err.code, err.message);
    });
}

function deleteFinanceTransaction(id) {
    if (!confirm('حذف المعاملة؟')) return;
    db.collection('users').doc(currentUser.uid).collection('finance').doc(id).delete()
    .then(() => {
        financeTransactions = financeTransactions.filter(t => t.id !== id);
        renderFinance();
        showToast('🗑️ تم الحذف', 'success');
    }).catch(err => alert('خطأ: ' + err.message));
}

function filterFinance(filter) {
    financeFilter = filter;
    document.querySelectorAll('[data-ffilter]').forEach(c => c.classList.remove('active'));
    document.querySelector(`[data-ffilter="${filter}"]`).classList.add('active');
    renderFinance();
}

function renderFinance() {
    populateFinanceProjects();
    let filtered = financeTransactions;
    if (financeFilter !== 'all') filtered = filtered.filter(t => t.type === financeFilter);

    const totalIncome = financeTransactions.filter(t => t.type === 'income').reduce((s, t) => s + (t.amount || 0), 0);
    const totalExpense = financeTransactions.filter(t => t.type === 'expense').reduce((s, t) => s + (t.amount || 0), 0);
    const balance = startingBalance + totalIncome - totalExpense;

    document.getElementById('finance-total-income').textContent = formatNumber(totalIncome);
    document.getElementById('finance-total-expense').textContent = formatNumber(totalExpense);
    document.getElementById('finance-balance').textContent = formatNumber(balance);

    // ملخص المشاريع
    const projectMap = {};
    financeTransactions.forEach(t => {
        const p = t.project || 'بدون مشروع';
        if (!projectMap[p]) projectMap[p] = { income: 0, expense: 0 };
        if (t.type === 'income') projectMap[p].income += t.amount || 0;
        else projectMap[p].expense += t.amount || 0;
    });
    const projectsSummary = document.getElementById('finance-projects-summary');
    const projectsListEl = document.getElementById('finance-projects-list');
    const projectNames = Object.keys(projectMap);
    if (projectNames.length > 0) {
        projectsSummary.style.display = 'block';
        projectsListEl.innerHTML = projectNames.map(p => {
            const data = projectMap[p];
            const net = data.income - data.expense;
            return `<div class="finance-item">
                <div class="finance-item-icon">📁</div>
                <div class="finance-item-info">
                    <div class="finance-item-name">${p}</div>
                    <div class="finance-item-note">دخل: ${formatNumber(data.income)} | مصروف: ${formatNumber(data.expense)}</div>
                </div>
                <div class="finance-item-right">
                    <div class="finance-item-amount" style="color:${net >= 0 ? 'var(--success)' : 'var(--danger)'}">${net >= 0 ? '+' : ''}${formatNumber(net)}</div>
                </div>
            </div>`;
        }).join('');
    } else {
        projectsSummary.style.display = 'none';
    }

    // سجل المعاملات
    const listEl = document.getElementById('finance-list');
    if (!filtered.length) {
        listEl.innerHTML = '<p class="empty-msg">لا توجد معاملات</p>';
        return;
    }

    listEl.innerHTML = filtered.map(t => `
        <div class="finance-item ${t.type}">
            <div class="finance-item-icon">${t.type === 'income' ? '📈' : '📉'}</div>
            <div class="finance-item-info">
                <div class="finance-item-name">${t.name}</div>
                <div class="finance-item-note">${t.project ? '📁 ' + t.project : ''} ${t.note ? '| ' + t.note : ''}</div>
            </div>
            <div class="finance-item-right">
                <div class="finance-item-amount">${t.type === 'income' ? '+' : '-'}${formatNumber(t.amount)}</div>
                <div class="finance-item-date">${t.date}</div>
            </div>
            <div class="finance-item-actions">
                <button class="icon-btn" onclick="deleteFinanceTransaction('${t.id}')" title="حذف">🗑️</button>
            </div>
        </div>
    `).join('');
}

function formatNumber(num) {
    return num.toLocaleString('ar-EG', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
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
        { key: 'new', label: 'جديدة', icon: '🆕' },
        { key: 'in_progress', label: 'جاري التنفيذ', icon: '🔄' },
        { key: 'completed', label: 'مكتملة', icon: '✅' },
    ];
    const board = document.getElementById('tasks-kanban-view');
    board.innerHTML = statuses.map(s => {
        const items = tasksList.filter(t => t.status === s.key);
        return `<div class="kanban-col">
            <div class="kanban-col-header">
                <span>${s.icon}</span>
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
    return `<div class="task-item ${task.status === 'completed' ? 'completed' : ''} ${isOverdue ? 'overdue' : ''}">
        <div class="task-check ${task.status === 'completed' ? 'done' : ''}" onclick="toggleTaskComplete('${task.id}')">
            ${task.status === 'completed' ? '✓' : ''}
        </div>
        <div class="task-content" onclick="openEditTaskModal(tasks.find(t => t.id === '${task.id}'))">
            <div class="task-text">${task.name}</div>
            <div class="task-meta">
                <span class="type-badge type-${task.type}">${task.type === 'work' ? '💼 عمل' : '🏠 شخصي'}</span>
                <span class="priority-badge priority-${task.priority}">${priorityLabel[task.priority]}</span>
                <span class="status-badge status-${task.status}">${statusLabel[task.status]}</span>
                ${task.project ? '<span class="type-badge" style="background:#fef3c7;color:#92400e;">📁 ' + task.project + '</span>' : ''}
                ${task.date ? '<span class="type-badge" style="background:#f0f0f0;color:#555;">📅 ' + task.date + '</span>' : ''}
                ${task.time ? '<span class="type-badge" style="background:#f0f0f0;color:#555;">⏰ ' + task.time + '</span>' : ''}
                ${isOverdue ? '<span class="priority-badge priority-high">🔴 متأخرة</span>' : ''}
            </div>
        </div>
        <div class="task-actions">
            <button class="icon-btn" onclick="event.stopPropagation();duplicateTask('${task.id}')" title="نسخ">📋</button>
            <button class="icon-btn" onclick="event.stopPropagation();archiveTask('${task.id}')" title="أرشفة">📦</button>
            <button class="icon-btn" onclick="event.stopPropagation();deleteTask('${task.id}')" title="حذف">🗑️</button>
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
        : '<p class="empty-msg">لا توجد مهام اليوم 🎉</p>';

    const homeOverdue = document.getElementById('home-overdue-list');
    homeOverdue.innerHTML = overdueTasks.length
        ? overdueTasks.slice(0, 5).map(t => createTaskHTML(t)).join('')
        : '<p class="empty-msg">لا توجد مهام متأخرة 👍</p>';
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
    dateLabel.textContent = '📅 مهام ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
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
                    <button class="icon-btn" onclick="event.stopPropagation();startEditProjectFromPage('${p.replace(/'/g,"\\'")}','${type}')" title="تعديل">✏️</button>
                    <button class="icon-btn" onclick="event.stopPropagation();confirmDeleteProjectFromPage('${p.replace(/'/g,"\\'")}','${type}')" title="حذف">🗑️</button>
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

function filterByProject(project) {
    navigate('tasks');
    document.getElementById('task-search-input').value = project;
    searchInTasks(project);
}

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
                <button class="icon-btn" onclick="unarchiveTask('${task.id}')" title="إلغاء الأرشفة">📤</button>
                <button class="icon-btn" onclick="deleteTask('${task.id}')" title="حذف">🗑️</button>
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
    document.getElementById('theme-toggle').textContent = newTheme === 'dark' ? '☀️' : '🌙';
}

function toggleThemeFromSettings() {
    const checked = document.getElementById('theme-toggle-setting').checked;
    const newTheme = checked ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('wp_theme', newTheme);
    document.getElementById('theme-toggle').textContent = newTheme === 'dark' ? '☀️' : '🌙';
}

function applySavedTheme() {
    const saved = localStorage.getItem('wp_theme');
    if (saved === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        document.getElementById('theme-toggle').textContent = '☀️';
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

    // إشعار المتصفح
    if (todayTasks.length > 0 && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('Walid Planner - مهام اليوم', {
            body: `لديك ${todayTasks.length} مهمة اليوم`,
            icon: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>📋</text></svg>'
        });
    }

    if (overdueTasks.length > 0 && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('Walid Planner - مهام متأخرة ⚠️', {
            body: `لديك ${overdueTasks.length} مهمة متأخرة`,
            icon: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🔴</text></svg>'
        });
    }

    // الإشعارات داخل التطبيق
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
            if (t.time) body += '   └ الوقت: ' + t.time + '\n';
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

    // إشعار متصفح
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('📋 Walid Planner - تذكير يومي', {
            body: body.slice(0, 200),
            icon: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>📋</text></svg>'
        });
    }

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