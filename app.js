    const tg = window.Telegram.WebApp; 
tg.ready(); 
tg.expand();

    // ===================== ТЕМА (авто / світла / темна) =====================
    function currentThemePref() { try { return localStorage.getItem('theme_pref') || 'auto'; } catch(e) { return 'auto'; } }
    function resolveTheme() {
        const p = currentThemePref();
        if (p !== 'auto') return p;
        if (tg.colorScheme) return tg.colorScheme;
        return (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    }
    function applyTheme() {
        const t = resolveTheme();
        document.documentElement.setAttribute('data-theme', t);
        try {
            tg.setHeaderColor(t === 'dark' ? '#0b1d36' : '#0a2f5c');
            tg.setBackgroundColor(t === 'dark' ? '#0e141c' : '#eef1f5');
            if (tg.setBottomBarColor) tg.setBottomBarColor(t === 'dark' ? '#18212c' : '#ffffff');
        } catch(e) {}
        const p = currentThemePref();
        [['auto','thAuto'],['light','thLight'],['dark','thDark']].forEach(([k, id]) => {
            const b = document.getElementById(id); if (b) b.classList.toggle('active', p === k);
        });
    }
    function setThemePref(p) {
        try { localStorage.setItem('theme_pref', p); } catch(e) {}
        applyTheme(); tg.HapticFeedback.selectionChanged();
    }
    tg.onEvent('themeChanged', applyTheme);
    try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme); } catch(e) {}

    // ===================== ПЕЧАТКА =====================
    function showStamp(text, kind) {
        if (!userSettings.animations) return; // Вимикає печатку, якщо налаштування викл
        const old = document.getElementById('stampFx'); if (old) old.remove();
        const el = document.createElement('div');
        el.id = 'stampFx'; el.className = 'stamp-fx ' + (kind || 'ok');
        const d = new Date().toLocaleDateString('uk-UA', { day:'2-digit', month:'2-digit', year:'numeric' });
        el.innerHTML = `<div class="stamp"><div class="stamp-top">ІС-о51</div><div class="stamp-main">${text}</div><div class="stamp-date">${d}</div></div>`;
        document.body.appendChild(el);
        try { tg.HapticFeedback.impactOccurred('heavy'); } catch(e) {}
        setTimeout(() => el.classList.add('out'), 1400);
        setTimeout(() => el.remove(), 1850);
    }
    // Конфеті замінено на печатки (залишок викликів у прихованій вкладці — тихий)
    window.confetti = function() {};

    // ===================== ДАТА В ШАПЦІ =====================
    function updateDocMeta() {
        const el = document.getElementById('docMeta'); if (!el) return;
        const n = new Date();
        el.innerText = 'Станом на ' + n.toLocaleDateString('uk-UA', { day:'numeric', month:'long', year:'numeric' })
            + ', ' + n.toLocaleTimeString('uk-UA', { hour:'2-digit', minute:'2-digit' });
    }

    const API_URL = "https://telegram-proxy-bot-desz.onrender.com/api";
// ===================== АВТОРИЗАЦІЯ ЗАПИТІВ (Telegram initData / PC токени) =====================
let pcAccess = null, pcRefresh = null;
const _origFetch = window.fetch.bind(window);

window.fetch = async (url, opts = {}) => {
    if (typeof url !== 'string' || !url.startsWith(API_URL)) return _origFetch(url, opts);
    opts = { ...opts, headers: { ...(opts.headers || {}) } };
    if (tg.initData) opts.headers['X-Tg-Init-Data'] = tg.initData;
    else if (pcAccess) opts.headers['Authorization'] = 'Bearer ' + pcAccess;

    let r = await _origFetch(url, opts);
    if (r.status === 401 && !tg.initData && !url.includes('/pc/login') && !url.includes('/pc/refresh')) {
        if (await pcRefreshTokens()) {
            opts.headers['Authorization'] = 'Bearer ' + pcAccess;
            r = await _origFetch(url, opts);
        } else showPcLogin();
    }
    return r;
};

function pcSave(d) {
    pcAccess = d.access; pcRefresh = d.refresh;
    try { localStorage.setItem('pc_access', pcAccess); localStorage.setItem('pc_refresh', pcRefresh); } catch(e) {}
    if (d.userId) { userId = d.userId; firstName = d.firstName || 'Студент'; }
}
function pcClear() {
    pcAccess = pcRefresh = null;
    try { localStorage.removeItem('pc_access'); localStorage.removeItem('pc_refresh'); } catch(e) {}
}
async function pcRefreshTokens() {
    if (!pcRefresh) return false;
    try {
        const r = await _origFetch(`${API_URL}/pc/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh: pcRefresh }) });
        if (!r.ok) { if (r.status === 401) pcClear(); return false; }
        pcSave(await r.json()); return true;
    } catch(e) { return false; }
}
function showPcLogin() { document.getElementById('pcLoginScreen').style.display = 'flex'; }

async function pcLogin() {
    const code = document.getElementById('pcCodeInput').value.trim();
    const err = document.getElementById('pcLoginError'); err.innerText = '';
    if (code.length < 8) { err.innerText = 'Введіть код повністю'; return; }
    try {
        const r = await _origFetch(`${API_URL}/pc/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, device: navigator.platform || 'ПК' })
        });
        if (r.status === 429) { err.innerText = 'Забагато спроб. Зачекайте 10 хвилин.'; return; }
        if (!r.ok) { err.innerText = 'Невірний або прострочений код'; return; }
        pcSave(await r.json());
        document.getElementById('pcLoginScreen').style.display = 'none';
        loadData();
    } catch(e) { err.innerText = "Немає зв'язку із сервером"; }
}

// ===== Керування кодами/пристроями (в налаштуваннях міні-аппу) =====
async function pcGenerateCode() {
    tg.HapticFeedback.impactOccurred('medium');
    try {
        const r = await fetch(`${API_URL}/pc/code`, { method: 'POST' });
        if (!r.ok) { showToast('❌ Не вдалося створити код'); return; }
        const d = await r.json();
        
        const box = document.getElementById('pcCodeBox');
        const magicBtn = document.getElementById('magicLinkBtn');
        
        box.innerText = d.code; 
        box.style.display = 'block';
        
        // Формуємо магічне посилання. window.location.origin дає поточну адресу сайту
        const magicUrl = `${window.location.origin}${window.location.pathname}?login_code=${d.code.replace('-', '')}`;
        magicBtn.href = magicUrl;
        magicBtn.style.display = 'block';
        
        setTimeout(() => { 
            box.style.display = 'none'; 
            box.innerText = ''; 
            magicBtn.style.display = 'none';
        }, d.expiresInSec * 1000);
    } catch(e) { showToast("❌ Немає зв'язку"); }
}
async function loadPcSessions() {
    const el = document.getElementById('pcSessionsList'); if (!el) return;
    try {
        const r = await fetch(`${API_URL}/pc/sessions`); if (!r.ok) return;
        const list = await r.json();
        el.innerHTML = list.length ? list.map(s => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-top:1px solid var(--line);font-size:12px;">
                <div><b>${escapeHtml(s.deviceName)}</b><br><span style="color:var(--hint);">активний: ${new Date(s.lastUsedAt).toLocaleString('uk-UA')}</span></div>
                <button onclick="pcRevoke(${s.id})" style="background:none;border:1px solid var(--red);color:var(--red);border-radius:var(--r);padding:5px 9px;cursor:pointer;font-size:11px;">Вийти</button>
            </div>`).join('') : '<div style="font-size:12px;color:var(--hint);">Активних ПК немає</div>';
    } catch(e) {}
}
async function pcRevoke(id) {
    await fetch(`${API_URL}/pc/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    loadPcSessions();
}
async function pcRevokeAll() {
    if (!confirm('Вийти на всіх ПК?')) return;
    await fetch(`${API_URL}/pc/revoke-all`, { method: 'POST' });
    showToast('🚫 Усі ПК відключено'); loadPcSessions();
}

async function bootstrap() {
    if (tg.initData) { loadData(); return; }          // відкрито в Telegram
    const blk = document.getElementById('pcAccessBlock'); if (blk) blk.style.display = 'none';

    // ===== Вхід за магічним посиланням ?login_code=XXXXXXXX =====
    const urlCode = new URLSearchParams(location.search).get('login_code');
    if (urlCode) {
        history.replaceState(null, '', location.pathname);   // одразу прибираємо код з адресного рядка
        const errEl = document.getElementById('pcLoginError');
        try {
            const r = await _origFetch(`${API_URL}/pc/login`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: urlCode, device: navigator.platform || 'ПК' })
            });
            if (r.ok) { pcSave(await r.json()); loadData(); return; }
            errEl.innerText = r.status === 429 ? 'Забагато спроб. Зачекайте 10 хвилин.' : 'Посилання недійсне або прострочене. Згенеруйте новий код.';
        } catch(e) { errEl.innerText = "Немає зв'язку із сервером"; }
        showPcLogin();
        return;
    }

    try { pcAccess = localStorage.getItem('pc_access'); pcRefresh = localStorage.getItem('pc_refresh'); } catch(e) {}
    if (pcRefresh && await pcRefreshTokens()) { loadData(); } else showPcLogin();
}

    let userId = tg.initDataUnsafe.user?.id || 0; // 0 = невідомий/неавторизований користувач, НЕ адмін
    let firstName = tg.initDataUnsafe.user?.first_name || 'Студент';
    const adminIds = ["1492389359", "5136345452"];
    
    let globalTasks = [], myCoins = 0, myTitles = ['Студент 🤓'], activeTitle = 'Студент 🤓';
    let streakCount = 0, canClaimBonus = false, mySpins = 0, hasChillBonus = false;
    let toastTimeout, pendingTaskId = null, pendingTaskState = null, currentFilter = 'all';
    let userSettings = { widget: true, panic: true, animations: true };
    let currentTab = 'home';

    // ===================== НАЛАШТУВАННЯ =====================
async function updateUserSetting(key, val) {
    userSettings[key] = val;
    
    if (key === 'widget') {
        document.getElementById('wgOn').classList.toggle('active', val);
        document.getElementById('wgOff').classList.toggle('active', !val);
    } else if (key === 'panic') {
        document.getElementById('panicOn').classList.toggle('active', val);
        document.getElementById('panicOff').classList.toggle('active', !val);
        renderTasks();
    } else if (key === 'animations') {
        document.getElementById('animOn').classList.toggle('active', val);
        document.getElementById('animOff').classList.toggle('active', !val);
    }
    
    tg.HapticFeedback.selectionChanged();
    
    try {
        await fetch(`${API_URL}/user/${userId}/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(userSettings)
        });
    } catch(e) { 
        showToast("Помилка збереження!");
    }
}

    const availableTitles = [
        { name:"Студент 🤓", price:0, desc:"Базовий статус" },
        { name:"Новачок 🐣", price:20, desc:"Почав шлях" },
        { name:"Любитель кави ☕", price:80, desc:"П'є еспресо" },
        { name:"Спить на парах 😴", price:150, desc:"Енергозбереження" },
        { name:"Дедлайн-кілер 🥷", price:200, desc:"В останню мить" },
        { name:"Майстер Вишмату 🧙‍♂️", price:299, desc:"Бачить матриці" },
        { name:"Код-машина 🤖", price:300, desc:"Без багів (майже)" },
        { name:"Шукач автоматів 🎯", price:350, desc:"Заради 60 балів" },
        { name:"Гроза Деканату ⚡", price:500, desc:"Еліта" },
        { name:"Кібер-Мозок 🧠", price:800, desc:"Компілює в голові" },
        { name:"Магнат КПІ 🎩", price:1500, desc:"Багатій" },
        { name:"Син Ректора 👑", price:3000, desc:"Йому можна все" },
        { name:"Бог Сесії 🌌", price:5000, desc:"Легенда" },
        { name:"Син маминої подруги 🦸‍♂️", price:99999, desc:"Тільки в казино" },
        { name:"Пілот-новачок ✈️", price:99999, desc:"1 виконаний політний план" },
        { name:"Досвідчений пілот 🛩️", price:99999, desc:"3 виконаних політних плани" },
        { name:"Ас неба 🦅", price:99999, desc:"7 виконаних політних планів" }
    ];
    const flightOnlyTitles = ["Пілот-новачок ✈️", "Досвідчений пілот 🛩️", "Ас неба 🦅"];

    // ===================== НАВІГАЦІЯ =====================
    function switchTab(tabId, btnEl) {
    tg.HapticFeedback.selectionChanged();
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    if (tabId === 'shop') tabId = 'profile';
    const page = document.getElementById('tab-' + tabId);
    if (page) page.classList.add('active');
    currentTab = tabId;
    if (tabId === 'profile') {
        updateProfileHeader();
        renderShop();
    }
    if (tabId === 'chill') openChillTab();
    if (tabId === 'admin') openAdminTab();
    if (tabId === 'news')  renderAnnouncements();
    if (tabId === 'schedule') {
        setTimeout(() => {
            const dayNames = ["Неділя", "Понеділок", "Вівторок", "Середа", "Четвер", "П'ятниця", "Субота"];
            const todayEl = document.getElementById(`day-${dayNames[new Date().getDay()]}`);
            if (todayEl) todayEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 50);
    }
 }
    function openNewsFromWidget() {
        switchTab('news', document.getElementById('navNews'));
    }

    // ===================== ОНОВЛЕННЯ ШАПКИ =====================
    function updateHeaderInfo() {
    document.getElementById('userName').innerText = `Привіт, ${firstName}!`;
    document.getElementById('profileCoinBalance').innerText = `💰 ${myCoins}`; // ОНОВЛЕНИЙ РЯДОК
    document.getElementById('chillCoinBalance')?.innerText !== undefined && (document.getElementById('chillCoinBalance').innerText = `💰 ${myCoins}`);
        const tb = document.getElementById('userTitleBadge');
        if (activeTitle && activeTitle !== "Студент 🤓") { tb.innerText = activeTitle; tb.style.display = "inline-block"; }
        else tb.style.display = "none";
    }

    // ===================== ЧІЛ / КАЗИНО =====================
    async function openChillTab() {
        if (!hasChillBonus) {
            try {
                const res = await fetch(`${API_URL}/chill/bonus/${userId}`, { method: 'POST' });
                if (res.ok) {
                    const d = await res.json();
                    if (d.bonusGiven) {
                        myCoins = d.coins; hasChillBonus = true; updateHeaderInfo();
                        confetti({ particleCount: 200, spread: 90 });
                        tg.showAlert("🎉 ПРИВІТАЛЬНИЙ БОНУС!\nТи вперше зайшов у зону 'Чіл' і отримав 150 🪙!");
                    }
                }
            } catch(e) {}
        }
        document.getElementById('spinDisplay') && (document.getElementById('spinDisplay').innerText = `Спінів зроблено: ${mySpins}`);
    }

    async function openLootbox() {
        if (myCoins < 50) { tg.showAlert("Бракує коїнів! Потрібно 50 🪙."); tg.HapticFeedback.notificationOccurred('error'); return; }
        const cont = document.getElementById('casinoContainer');
        cont.style.animation = "pulse-lock 0.3s infinite alternate"; tg.HapticFeedback.impactOccurred('heavy');
        try {
            const res = await fetch(`${API_URL}/lootbox/${userId}`, { method: 'POST' });
            setTimeout(() => cont.style.animation = "", 400);
            if (res.ok) {
                const d = await res.json();
                myCoins = d.coins; mySpins = d.spins;
                myTitles = d.unlockedTitles ? d.unlockedTitles.split(',') : ['Студент 🤓'];
                updateHeaderInfo();
                document.getElementById('spinDisplay') && (document.getElementById('spinDisplay').innerText = `Спінів зроблено: ${mySpins}`);
                if (d.prizeType === 'legendary') { confetti({ particleCount: 300, spread: 100 }); tg.showAlert(`😱 ШОК! ЛЕГЕНДА!\n\n${d.message}`); }
                else if (d.prizeType === 'epic' || d.prizeType === 'skin') { confetti({ particleCount: 120 }); showToast(d.message); tg.HapticFeedback.notificationOccurred('success'); }
                else showToast(d.message);
            } else showToast("Помилка рулетки ❌");
        } catch(e) { cont.style.animation = ""; showToast("Помилка зв'язку ❌"); }
    }
    // Перемикання вкладок всередині профілю
function switchProfileTab(section) {
    tg.HapticFeedback.selectionChanged();

    const toggleBtn = (id, isActive) => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('active', isActive);
    };
    const toggleSec = (id, isActive) => {
        const el = document.getElementById(id);
        if (el) el.style.display = isActive ? 'block' : 'none';
    };

    toggleBtn('subTabTasksBtn', section === 'localTasks');
    toggleBtn('subTabSettingsBtn', section === 'settings');
    toggleBtn('subTabShopBtn', section === 'shop');
    toggleBtn('subTabQueueBtn', section === 'queue');

    toggleSec('profileLocalTasksSection', section === 'localTasks');
    toggleSec('profileSettingsSection', section === 'settings');
    toggleSec('profileShopSection', section === 'shop');
    toggleSec('profileQueueSection', section === 'queue');

    if (section === 'queue') loadQueue();
    if (section === 'settings') loadPcSessions();
}

// Оновлення шапки профілю
function updateProfileHeader() {
    document.getElementById('profileFullName').innerText = firstName;
    document.getElementById('profileCoinBalance').innerText = `💰 ${myCoins}`;
    document.getElementById('profileActiveTitle').innerText = activeTitle;
}

async function addPersonalTask() {
        const subj = document.getElementById('myTaskSubject').value.trim();
        const title = document.getElementById('myTaskTitle').value.trim();
        const date = document.getElementById('myTaskDate').value;
        
        if (!subj || !title || !date) { 
            tg.showAlert("Заповни всі поля!"); 
            tg.HapticFeedback.notificationOccurred('error'); 
            return; 
        }
        
        tg.HapticFeedback.impactOccurred('medium');
        
        // ВАЖЛИВО: Створюємо час 23:59 саме у ТВОЄМУ часовому поясі, 
        // а .toISOString() автоматично переведе його для сервера без збоїв у днях
        const localDeadline = new Date(date + "T23:59:59");
        
        try {
            const res = await fetch(`${API_URL}/tasks/${userId}/personal`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subject: subj, title: title, deadline: localDeadline.toISOString() })
            });
            
            if (res.ok) {
                showToast("✅ Особисте завдання додано!");
                tg.HapticFeedback.notificationOccurred('success');
                // Очищаємо поля вводу
                document.getElementById('myTaskSubject').value = "";
                document.getElementById('myTaskTitle').value = "";
                document.getElementById('myTaskDate').value = "";
                // Оновлюємо дані з сервера
                loadData();
                // Перекидаємо в загальний список завдань
                switchTab('home', document.getElementById('navHome'));
            } else {
                const err = await res.json().catch(() => ({}));
                showToast("❌ " + (err.error || "Помилка сервера"));
            }
        } catch(e) { 
            showToast("❌ Немає зв'язку із сервером"); 
        }
    }

    async function addNewTask() {
        const subj  = document.getElementById('newTaskSubject').value.trim();
        const title = document.getElementById('newTaskTitle').value.trim();
        const date  = document.getElementById('newTaskDate').value;
        const time  = document.getElementById('newTaskTime').value || "23:59";
        const checklist = document.getElementById('newTaskChecklist').value
            .split('\n').map(s => s.trim()).filter(s => s.length > 0);
        
        if (!subj || !title || !date) { tg.showAlert("Заповни всі поля!"); tg.HapticFeedback.notificationOccurred('error'); return; }
        tg.HapticFeedback.impactOccurred('medium');
        
        // Будуємо дедлайн у ТВОЄМУ місцевому часовому поясі (обраний час, за замовчуванням 23:59),
        // а .toISOString() коректно переведе його в UTC для сервера
        const localDeadline = new Date(date + "T" + time + ":00");

        try {
            const res = await fetch(`${API_URL}/tasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subject: subj, title: title, deadline: localDeadline.toISOString(), adminId: userId, checklist: checklist })
            });
            if (res.ok) {
                showToast("✅ Завдання додано всім студентам!");
                tg.HapticFeedback.notificationOccurred('success');
                document.getElementById('newTaskSubject').selectedIndex = 0;
                document.getElementById('newTaskTitle').value = "";
                document.getElementById('newTaskDate').value = "";
                document.getElementById('newTaskTime').value = "23:59";
                document.getElementById('newTaskChecklist').value = "";
                loadAdminTasks();
                loadData();
            } else {
                const err = await res.json().catch(() => ({}));
                showToast("❌ " + (err.error || "Помилка сервера"));
            }
        } catch(e) { showToast("❌ Немає зв'язку із сервером"); }
    }

    // ===================== МАГАЗИН =====================
    function renderShop() {
        //document.getElementById('shopCoinBalance').innerText = `💰 ${myCoins}`;
        const fireClass = getFireClass(streakCount);
        document.getElementById('streakDisplay').innerHTML = `<span class="streak-fire ${fireClass}">🔥</span> Вогник: ${streakCount} днів`;
        const btn = document.getElementById('claimBonusBtn');
        if (canClaimBonus) {
            btn.innerText = "Забрати"; btn.disabled = false;
            btn.style.background = "linear-gradient(135deg, #ff9800, #f44336)"; btn.style.color = "#fff";
        } else {
            btn.innerText = "Отримано ✅"; btn.disabled = true;
            btn.style.background = "transparent"; btn.style.color = "var(--hint)";
        }
        const list = document.getElementById('titlesList'); list.innerHTML = "";
        availableTitles.forEach(t => {
            if (t.name.includes("Син маминої подруги") && !myTitles.includes(t.name)) return;
            if (flightOnlyTitles.includes(t.name) && !myTitles.includes(t.name)) return;
            const isOwned = myTitles.includes(t.name), isActive = activeTitle === t.name;
            let btnHtml = `<button class="buy-btn" onclick="buyTitle('${t.name}',${t.price})">${t.price} 🪙</button>`;
            if (isActive) btnHtml = `<span style="color:var(--green);font-weight:600;font-size:12px;">АКТИВНО</span>`;
            else if (isOwned) btnHtml = `<button class="buy-btn owned" onclick="buyTitle('${t.name}',0)">Надіти</button>`;
            const extraClass = t.name.includes("Син маминої подруги") ? "legendary" : "";
            list.innerHTML += `<div class="shop-item ${extraClass}"><div class="shop-info"><h4>${t.name}</h4><p>${t.desc}</p></div>${btnHtml}</div>`;
        });
    }
    async function buyTitle(name, price) {
        if (myTitles.includes(name)) {
            await fetch(`${API_URL}/user/${userId}/title`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({action:'equip', title:name}) });
            activeTitle = name; updateHeaderInfo(); renderShop(); tg.HapticFeedback.notificationOccurred('success');
        } else if (myCoins >= price) {
            const res = await fetch(`${API_URL}/user/${userId}/title`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({action:'buy', title:name, price}) });
            if (res.ok) { myCoins -= price; myTitles.push(name); activeTitle = name; updateHeaderInfo(); renderShop(); showStamp("ПРИДБАНО", "info"); tg.HapticFeedback.notificationOccurred('success'); }
            else showToast("Помилка покупки!");
        } else { tg.showAlert(`Бракує коїнів! Треба ще ${price - myCoins} 🪙.`); tg.HapticFeedback.notificationOccurred('error'); }
    }

    async function claimDailyBonus() {
        if (!canClaimBonus) return;
        tg.HapticFeedback.impactOccurred('medium');
        try {
            const res = await fetch(`${API_URL}/bonus/${userId}`, { method: 'POST' });
            if (res.ok) {
                const d = await res.json();
                myCoins = d.coins; streakCount = d.streak; canClaimBonus = false;
                updateHeaderInfo(); renderShop();
                showStamp("НАРАХОВАНО", "info"); showToast(`Забрано +${d.reward} 🪙! Вогник: ${streakCount} 🔥`);
            }
        } catch(e) {}
    }

    // ===================== АДМІН =====================
    function openAdminTab() {
        const sel = document.getElementById('subjectSelect'); sel.innerHTML = "";
        ["Бази даних","РСОІ","Теорія ймовірностей","Вища математика","Права і свободи","Англійська мова","Вступ до філософії"]
            .forEach(s => sel.innerHTML += `<option value="${s}">${s}</option>`);
        const list = document.getElementById('rollcallList'); list.innerHTML = "";
        ["1 Владика А.","2 Волков М.","3 Гриценко М.","4 Денисюк З.","5 Жук Т.","6 Калашнік Д.","7 Мартиненко В.","8 Постернак Р.","9 Скірко А.","10 Узун Д.","11 Фулга І.","12 Ханчопуло О.","13 Хоменко М.","14 Чороноплечий А."]
            .forEach(s => list.innerHTML += `<div class="student-row"><span class="student-name">${s}</span><button class="toggle-btn present" onclick="toggleAttendance(this)">🟢 Є</button></div>`);
        switchAdminTab('tasks');
    }

    function switchAdminTab(name) {
        document.getElementById('tabRollcallBtn').classList.toggle('active', name === 'rollcall');
        document.getElementById('tabTasksBtn').classList.toggle('active', name === 'tasks');
        document.getElementById('tabAnnouncementsBtn').classList.toggle('active', name === 'announcements');
        document.getElementById('tabPrefectBtn').classList.toggle('active', name === 'prefect');
        document.getElementById('adminRollcallSection').style.display = name === 'rollcall' ? 'block' : 'none';
        document.getElementById('adminTasksSection').style.display = name === 'tasks' ? 'block' : 'none';
        document.getElementById('adminAnnouncementsSection').style.display = name === 'announcements' ? 'block' : 'none';
        document.getElementById('adminPrefectSection').style.display = name === 'prefect' ? 'block' : 'none';
        if (name === 'tasks') loadAdminTasks();
        if (name === 'announcements') loadAdminAnnouncements();
        if (name === 'prefect') loadPrefectReport();
        tg.HapticFeedback.selectionChanged();
    }

    async function loadPrefectReport() {
        const box = document.getElementById('prefectReportPreview');
        box.innerText = "Завантаження...";
        try {
            const res = await fetch(`${API_URL}/admin/prefect-report/${userId}`);
            if (res.ok) {
                const d = await res.json();
                box.innerHTML = d.report.replace(/\n/g, '<br>');
            } else box.innerText = "Не вдалось завантажити зведення.";
        } catch (e) { box.innerText = "Немає зв'язку!"; }
    }

    async function sendPrefectReportNow() {
        tg.HapticFeedback.impactOccurred('medium');
        try {
            const res = await fetch(`${API_URL}/admin/prefect-report/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ adminId: userId })
            });
            if (res.ok) {
                showToast("📤 Зведення надіслано старостам!");
                tg.HapticFeedback.notificationOccurred('success');
            } else {
                const err = await res.json().catch(() => ({}));
                showToast("❌ " + (err.error || "Помилка сервера"));
            }
        } catch (e) { showToast("Немає зв'язку!"); }
    }

    function toggleAttendance(btn) {
        const isPresent = btn.classList.contains('present');
        btn.classList.toggle('present', !isPresent); btn.classList.toggle('absent', isPresent);
        btn.innerText = isPresent ? "🔴 Нема" : "🟢 Є";
        tg.HapticFeedback.impactOccurred(isPresent ? 'light' : 'medium');
    }

    async function saveAttendance() {
        const subject = document.getElementById('subjectSelect').value; if (!subject) return;
        const records = [];
        document.querySelectorAll('.student-row').forEach(row => records.push({ name: row.querySelector('.student-name').innerText, isPresent: row.querySelector('.toggle-btn').classList.contains('present') }));
        try {
            const res = await fetch(`${API_URL}/attendance`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({subject, records, adminId: userId}) });
            if (res.ok) { tg.showAlert("✅ Журнал збережено!"); switchTab('home', document.getElementById('navHome')); }
        } catch(e) {}
    }

    // ===================== АДМІН: ЗАВДАННЯ =====================
    async function loadAdminTasks() {
        const list = document.getElementById('adminTasksList');
        list.innerHTML = `<div style="text-align:center;padding:20px;color:var(--hint);font-size:13px;">⏳ Завантаження...</div>`;
        try {
            const res = await fetch(`${API_URL}/admin/tasks?adminId=${userId}`);
            if (!res.ok) { list.innerHTML = `<div style="color:var(--red);font-size:13px;padding:10px;">❌ Помилка сервера</div>`; return; }
            const tasks = await res.json();
            list.innerHTML = "";
            if (!tasks.length) {
                list.innerHTML = `<div style="text-align:center;padding:20px;color:var(--hint);font-size:13px;">Завдань ще немає 🎉</div>`;
                return;
            }
            tasks.forEach(t => {
                const d = new Date(t.deadline);
                const dateStr = !isNaN(d) ? d.toLocaleDateString('uk-UA', { day:'numeric', month:'long', year:'numeric' }) : "—";
                const isOverdue = d < new Date();
                list.innerHTML += `
                    <div style="background:var(--bg);padding:12px;border-radius:12px;margin-bottom:8px;border:1px solid rgba(0,0,0,0.06);display:flex;justify-content:space-between;align-items:center;gap:10px;">
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:10px;color:var(--hint);font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">${t.subject}</div>
                            <div style="font-size:13px;font-weight:600;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${t.title}</div>
                            <div style="font-size:11px;color:${isOverdue ? 'var(--red)' : 'var(--hint)'};margin-top:3px;font-weight:500;">
                                ${isOverdue ? '🔒 ' : '📅 '}До ${dateStr}
                            </div>
                        </div>
                        <button onclick="deleteAdminTask(${t.id})"
                            style="background:rgba(229,57,53,0.1);color:var(--red);border:none;padding:8px 12px;border-radius:10px;font-weight:600;cursor:pointer;font-size:12px;white-space:nowrap;flex-shrink:0;">
                            🗑 Видалити
                        </button>
                    </div>`;
            });
        } catch(e) {
            list.innerHTML = `<div style="color:var(--red);font-size:13px;padding:10px;">❌ Немає зв'язку із сервером</div>`;
        }
    }

    async function deleteAdminTask(id) {
        tg.HapticFeedback.impactOccurred('light');
        try {
            const res = await fetch(`${API_URL}/tasks/${id}?adminId=${userId}`, { method: 'DELETE' });
            if (res.ok) { showToast("🗑️ Завдання видалено"); tg.HapticFeedback.notificationOccurred('success'); loadAdminTasks(); loadData(); }
            else showToast("❌ Помилка видалення");
        } catch(e) { showToast("❌ Немає зв'язку"); }
    }

    // ===================== ЗАВДАННЯ =====================
    let _loadRetry = 0;
    async function loadData() {
        try {
                 // 1. ПЕРЕВІРКА АВТОРИЗАЦІЇ
        const authRes = await fetch(`${API_URL}/auth/check/${userId}`);
        if (authRes.ok) {
            const authData = await authRes.json();

            if (!authData.isVerified) {
                // Не в базі — блокуємо
                document.getElementById('authLockScreen').innerHTML = `
                    <div class="lock-hero"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg></div>
                    <h2 style="margin:0 0 8px;">Доступ обмежено</h2>
                    <p style="color:var(--hint); font-size:14px; max-width:280px;">
                        Цей застосунок доступний тільки студентам групи. Зверніться до адміністратора для верифікації.
                    </p>`;
                document.getElementById('authLockScreen').style.display = 'flex';
                document.getElementById('authLockScreen').style.opacity = '1';
                tg.HapticFeedback.notificationOccurred('error');
                return;
            }

            // Є в базі, але ще не давав(-ла) згоду на обробку персональних даних у боті — блокуємо застосунок
            if (!authData.consentGiven) {
                document.getElementById('authLockScreen').innerHTML = `
                    <div class="lock-hero"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg></div>
                    <h2 style="margin:0 0 8px;">Потрібна згода</h2>
                    <p style="color:var(--hint); font-size:14px; max-width:280px;">
                        Перш ніж користуватись застосунком, підтвердіть згоду на обробку персональних даних у Telegram-боті.
                    </p>
                    <p style="color:var(--hint); font-size:14px; max-width:280px; margin-top:10px;">
                        Відкрийте бота і натисніть <b>/start</b>, щоб надати згоду.
                    </p>`;
                document.getElementById('authLockScreen').style.display = 'flex';
                document.getElementById('authLockScreen').style.opacity = '1';
                tg.HapticFeedback?.notificationOccurred('warning');
                return;
            }

            // Все гаразд — ховаємо екран блокування
            document.getElementById('authLockScreen').style.opacity = '0';
            setTimeout(() => document.getElementById('authLockScreen').style.display = 'none', 300);

            // Показуємо панель адміна, якщо userId у списку adminIds
            if (adminIds.includes(String(userId))) {
                document.getElementById('navAdmin').style.display = 'flex';
                document.getElementById('tab-admin').style.display = 'block';
            }
        }
            const userRes = await fetch(`${API_URL}/user/${userId}`);
        if (userRes.ok) {
            const u = await userRes.json();
            myCoins = u.coins || 0; 
            activeTitle = u.activeTitle || 'Студент 🤓';
            myTitles = u.unlockedTitles ? u.unlockedTitles.split(',') : ['Студент 🤓'];
            streakCount = u.streak || 0; 
            canClaimBonus = u.canClaim;
            mySpins = u.spins || 0; 
            hasChillBonus = u.hasChillBonus;

            if (u.settings) {
                userSettings = u.settings;
                document.getElementById('wgOn').classList.toggle('active', userSettings.widget);
                document.getElementById('wgOff').classList.toggle('active', !userSettings.widget);
                document.getElementById('panicOn').classList.toggle('active', userSettings.panic);
                document.getElementById('panicOff').classList.toggle('active', !userSettings.panic);
                document.getElementById('animOn').classList.toggle('active', userSettings.animations);
                document.getElementById('animOff').classList.toggle('active', !userSettings.animations);
            }
        }
        updateHeaderInfo();
            _loadRetry = 0;

            const tasksRes = await fetch(`${API_URL}/tasks/${userId}`);
            if (tasksRes.ok) {
                globalTasks = await tasksRes.json();
                document.getElementById('filtersBlock').style.display = "flex";
                document.getElementById('statsCard').style.display = "block";
                renderTasks();
            }

            const rankRes = await fetch(`${API_URL}/rank/${userId}`);
            if (rankRes.ok) {
                const r = await rankRes.json();
                document.getElementById('rankBadge').innerText = r.rank === 1 ? "🥇 1 місце" : r.rank === 2 ? "🥈 2 місце" : r.rank === 3 ? "🥉 3 місце" : `👤 ${r.rank}/${r.total} місце`;
            }
            loadAnnouncements();
            loadSchedule();
        } catch(e) {
            _loadRetry++;
            if (_loadRetry <= 4) {
                // Авто-retry: 1→5с, 2→10с, 3→20с, 4→40с
                const delay = [5000, 10000, 20000, 40000][_loadRetry - 1];
                const secs = delay / 1000;
                document.getElementById('activeTaskList').innerHTML = `<div style="text-align:center;padding:20px;background:var(--sec);border-radius:14px;">
                    <p style="color:var(--hint);font-weight:600;font-size:14px;margin:0;">⏳ Підключення до сервера...</p>
                    <p style="color:var(--hint);font-size:12px;margin-top:8px;">Спроба ${_loadRetry} з 4 — повтор через ${secs} сек</p>
                </div>`;
                setTimeout(loadData, delay);
            } else {
                document.getElementById('activeTaskList').innerHTML = `<div style="text-align:center;padding:20px;background:var(--sec);border-radius:14px;">
                    <p style="color:var(--red);font-weight:600;font-size:14px;margin:0;">Помилка з'єднання ❌</p>
                    <p style="color:var(--hint);font-size:12px;margin-top:10px;">Сервер не відповідає. <b onclick="location.reload()" style="cursor:pointer;color:var(--btn);">Оновити сторінку</b></p>
                </div>`;
            }
        }
    }

    function applyFilter(type, btn) {
        currentFilter = type;
        document.querySelectorAll('#filtersBlock .filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        tg.HapticFeedback.selectionChanged();
        renderTasks();
    }

    function getFireClass(days) {
        if (days >= 15) return 'fire-inferno';
        if (days >= 8)  return 'fire-high';
        if (days >= 4)  return 'fire-mid';
        if (days >= 1)  return 'fire-low';
        return '';
    }

async function deletePersonalTask(taskId) {
    if (!confirm("Точно видалити це особисте завдання?")) return;
    tg.HapticFeedback.impactOccurred('light');
    try {
        const res = await fetch(`${API_URL}/tasks/${userId}/personal/${taskId}`, { method: 'DELETE' });
        if (res.ok) { 
            showToast("🗑️ Завдання видалено!"); 
            loadData(); // Оновлюємо списки
        } else showToast("❌ Помилка видалення");
    } catch(e) { showToast("❌ Немає зв'язку"); }
}

/* ===== ВИМКНЕНО: ПОЛІТНИЙ ПЛАН (розкоментуй разом із HTML-секцією та кнопкою вкладки) =====

let selectedFlightTaskIds = [];

async function loadFlightPlan() {
    try {
        const res = await fetch(`${API_URL}/flightplan/${userId}`);
        if (!res.ok) return;
        const d = await res.json();
        document.getElementById('flightMedalsCount').innerText = `🎖️ ${d.successfulFlights || 0}`;

        document.getElementById('flightNoActive').style.display = d.canSubmit ? 'block' : 'none';
        document.getElementById('flightActive').style.display = d.canSubmit ? 'none' : 'block';

        if (d.canSubmit) renderFlightTaskPicker();
        else renderActiveFlight(d.active);

        renderFlightHistory(d.history || []);
    } catch(e) { showToast("❌ Не вдалося завантажити політний план"); }
}

function renderFlightTaskPicker() {
    selectedFlightTaskIds = [];
    const picker = document.getElementById('flightTaskPicker');
    const backupSelect = document.getElementById('flightBackupSelect');
    const openTasks = (globalTasks || []).filter(t => !t.isCompleted);

    if (openTasks.length === 0) {
        picker.innerHTML = `<div style="text-align:center;padding:15px;color:var(--hint);font-size:12px;">Немає активних завдань для планування 🎉</div>`;
        backupSelect.innerHTML = `<option value="">— без резерву —</option>`;
        return;
    }

    picker.innerHTML = openTasks.map(t => `
        <label style="display:flex;align-items:center;gap:10px;padding:10px;border-radius:10px;cursor:pointer;" onclick="toggleFlightTask(${t.taskId}, this)">
            <input type="checkbox" style="width:18px;height:18px;flex-shrink:0;" data-flight-task="${t.taskId}">
            <div style="flex:1;min-width:0;">
                <div style="font-size:10px;color:var(--hint);font-weight:600;text-transform:uppercase;">${t.subject}</div>
                <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${t.title}</div>
            </div>
        </label>
    `).join('');

    backupSelect.innerHTML = `<option value="">— без резерву —</option>` +
        openTasks.map(t => `<option value="${t.taskId}">${t.subject} — ${t.title}</option>`).join('');
}

function toggleFlightTask(taskId, labelEl) {
    const idx = selectedFlightTaskIds.indexOf(taskId);
    const checkbox = labelEl.querySelector('input[type=checkbox]');
    if (idx >= 0) {
        selectedFlightTaskIds.splice(idx, 1);
        checkbox.checked = false;
    } else {
        if (selectedFlightTaskIds.length >= 5) { tg.showAlert("Максимум 5 завдань у маршруті."); return; }
        selectedFlightTaskIds.push(taskId);
        checkbox.checked = true;
    }
    tg.HapticFeedback.selectionChanged();
}

async function submitFlightPlan() {
    if (selectedFlightTaskIds.length < 2) { tg.showAlert("Обери щонайменше 2 завдання для маршруту."); return; }
    const backupVal = document.getElementById('flightBackupSelect').value;
    const backupTaskId = backupVal ? parseInt(backupVal) : null;

    tg.HapticFeedback.impactOccurred('medium');
    try {
        const res = await fetch(`${API_URL}/flightplan/${userId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mainTaskIds: selectedFlightTaskIds, backupTaskId })
        });
        if (res.ok) {
            showStamp("ПРИЙНЯТО", "info");
            tg.HapticFeedback.notificationOccurred('success');
            showToast("🛫 План подано! Гарного польоту.");
            loadFlightPlan();
        } else {
            const err = await res.json().catch(() => ({}));
            tg.showAlert("❌ " + (err.error || "Помилка подачі плану"));
        }
    } catch(e) { showToast("❌ Немає зв'язку із сервером"); }
}

async function cancelFlightPlan() {
    if (!confirm("Скасувати поточний політний план? Штрафу не буде.")) return;
    tg.HapticFeedback.impactOccurred('light');
    try {
        const res = await fetch(`${API_URL}/flightplan/${userId}`, { method: 'DELETE' });
        if (res.ok) { showToast("✖️ Виліт скасовано"); loadFlightPlan(); }
        else showToast("❌ Помилка скасування");
    } catch(e) { showToast("❌ Немає зв'язку"); }
}

function renderActiveFlight(active) {
    if (!active) return;
    const percent = active.total > 0 ? Math.round((active.doneCount / active.total) * 100) : 0;
    document.getElementById('flightProgressText').innerText = `${active.doneCount}/${active.total} виконано`;
    document.getElementById('flightProgressBar').style.width = `${percent}%`;

    const resolvesAt = new Date(active.resolvesAt);
    const now = new Date();
    const msLeft = resolvesAt - now;
    const daysLeft = Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));
    document.getElementById('flightEta').innerText = daysLeft > 0
        ? `⏱️ Підсумки посадки через ~${daysLeft} дн.`
        : `⏱️ Диспетчер підбиває підсумки з хвилини на хвилину...`;

    const mainIdsSet = new Set(active.mainTaskIds);
    const tasksInPlan = (globalTasks || []).filter(t => mainIdsSet.has(t.taskId));
    const listEl = document.getElementById('flightMainList');
    listEl.innerHTML = tasksInPlan.map(t => `
        <div style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--bg);border-radius:10px;margin-bottom:6px;">
            <div style="font-size:16px;">${t.isCompleted ? '✅' : '🕓'}</div>
            <div style="flex:1;min-width:0;">
                <div style="font-size:10px;color:var(--hint);font-weight:600;text-transform:uppercase;">${t.subject}</div>
                <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${t.isCompleted ? 'text-decoration:line-through;' : ''}">${t.title}</div>
            </div>
        </div>
    `).join('');

    if (active.backupTaskId) {
        const backupTask = (globalTasks || []).find(t => t.taskId === active.backupTaskId);
        if (backupTask) {
            listEl.innerHTML += `
                <div style="display:flex;align-items:center;gap:10px;padding:10px;background:rgba(255,152,0,0.08);border:1px dashed rgba(255,152,0,0.4);border-radius:10px;margin-top:4px;">
                    <div style="font-size:16px;">${backupTask.isCompleted ? '🛬' : '🅿️'}</div>
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:10px;color:var(--hint);font-weight:600;text-transform:uppercase;">Запасний аеродром</div>
                        <div style="font-size:13px;font-weight:600;">${backupTask.title}</div>
                    </div>
                </div>`;
        }
    }
}

function renderFlightHistory(history) {
    const el = document.getElementById('flightHistoryList');
    if (!history || history.length === 0) {
        el.innerHTML = `<div style="text-align:center;padding:15px;color:var(--hint);font-size:12px;">Тут з'явиться історія твоїх польотів 🗂️</div>`;
        return;
    }
    const statusMeta = {
        success: { icon: '✅', color: 'var(--green)', label: 'Успішна посадка' },
        rescued: { icon: '🛬', color: '#ff9800', label: 'Аварійна посадка' },
        failed:  { icon: '💥', color: 'var(--red)', label: 'Провал' }
    };
    el.innerHTML = history.map(h => {
        const meta = statusMeta[h.status] || { icon: '❓', color: 'var(--hint)', label: h.status };
        const d = new Date(h.resolvedAt);
        const dateStr = !isNaN(d) ? d.toLocaleDateString('uk-UA', { day:'numeric', month:'short' }) : '';
        const coinsText = h.coinsDelta >= 0 ? `+${h.coinsDelta} 🪙` : `${h.coinsDelta} 🪙`;
        return `
            <div style="background:var(--bg);padding:12px;border-radius:12px;margin-bottom:8px;border:1px solid rgba(0,0,0,0.06);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                    <div style="font-size:12px;font-weight:700;color:${meta.color};">${meta.icon} ${meta.label}</div>
                    <div style="font-size:12px;font-weight:700;color:${meta.color};">${coinsText}</div>
                </div>
                <div style="font-size:11px;color:var(--hint);">${dateStr}${h.resultMessage ? ' · ' + h.resultMessage : ''}</div>
            </div>`;
    }).join('');
}
===== КІНЕЦЬ: ПОЛІТНИЙ ПЛАН ===== */

function renderPersonalTasks(personalTasks) {
    const myPersonalList = document.getElementById('myPersonalTasksList');
    if (!myPersonalList) return;

    myPersonalList.innerHTML = "";
    if (!personalTasks || personalTasks.length === 0) {
        myPersonalList.innerHTML = `<div style="text-align:center;padding:15px;color:var(--hint);font-size:12px;">Тут будуть твої особисті завдання 📋</div>`;
        return;
    }

    const now = new Date();
    
    // Малюємо картки точнісінько як у панелі адміна
    personalTasks.forEach(t => {
        const taskId = t.taskId || t.id || t.TaskId;
        const d = new Date(t.deadline);
        const dateStr = !isNaN(d) ? (d.toLocaleDateString('uk-UA', { day:'numeric', month:'long' }) + ', ' + d.toLocaleTimeString('uk-UA', { hour:'2-digit', minute:'2-digit' })) : "—";
        const isOverdue = d < now && !t.isCompleted;
        
        let statusText = t.isCompleted ? "✅ Виконано" : (isOverdue ? `🔒 Протерміновано` : `📅 До ${dateStr}`);
        let statusColor = t.isCompleted ? "var(--green)" : (isOverdue ? "var(--red)" : "var(--hint)");

        myPersonalList.innerHTML += `
            <div style="background:var(--bg);padding:12px;border-radius:12px;margin-bottom:8px;border:1px solid rgba(0,0,0,0.06);display:flex;justify-content:space-between;align-items:center;gap:10px; opacity: ${t.isCompleted ? '0.6' : '1'};">
                <div style="flex:1;min-width:0;">
                    <div style="font-size:10px;color:var(--hint);font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">${t.subject}</div>
                    <div style="font-size:13px;font-weight:600;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; ${t.isCompleted ? 'text-decoration:line-through;' : ''}">${t.title}</div>
                    <div style="font-size:11px;color:${statusColor};margin-top:3px;font-weight:500;">
                        ${statusText}
                    </div>
                </div>
                
                <button onclick="deletePersonalTask(${taskId})"
                    style="background:rgba(229,57,53,0.1);color:var(--red);border:none;padding:8px 12px;border-radius:10px;font-weight:600;cursor:pointer;font-size:12px;white-space:nowrap;flex-shrink:0;">
                    🗑 Видалити
                </button>
            </div>`;
    });
}

    function renderTasks() {
        const activeList = document.getElementById('activeTaskList');
        const completedList = document.getElementById('completedTaskList');
        const completedSection = document.getElementById('completedSection');
        const progressWrapper = document.getElementById('progressWrapper');
        const progressText = document.getElementById('progressText');
        const progressBar = document.getElementById('progressBar');
        const streakBadge = document.getElementById('streakBadge');
        const levelBadge = document.getElementById('levelBadge');
        const analyticsText = document.getElementById('analyticsText');

        activeList.innerHTML = ""; completedList.innerHTML = "";

        if (!globalTasks || !globalTasks.length) {
            activeList.innerHTML = "<p style='text-align:center;color:var(--hint);font-size:13px;'>Завдань немає 🎉</p>";
            progressWrapper.style.display = "none"; completedSection.style.display = "none";
            document.getElementById('headerSubtitle').innerText = "Твої навчальні завдання"; 
            
            renderPersonalTasks([]); // Очищаємо локальні таски в профілі
            return;
        }

        const now = new Date();
        // БЕРЕМО ВСІ ЗАВДАННЯ ДЛЯ ГОЛОВНОЇ СТРІЧКИ (і універ, і особисті)
        let activeTasks = globalTasks.filter(t => !t.isCompleted);
        const completedTasks = globalTasks.filter(t => t.isCompleted);
        // Відбираємо ТІЛЬКИ особисті для дублювання в Профілі
        const personalTasks = globalTasks.filter(t => t.subject && t.subject.startsWith('👤'));
        // Прогрес тепер рахується по ВСІХ твоїх завданнях
        const percent = Math.round((completedTasks.length / globalTasks.length) * 100) || 0;
        const overdueCount = activeTasks.filter(t => !isNaN(new Date(t.deadline)) && new Date(t.deadline) < now).length;

        // Бейджі
        let badges = [];
        if (adminIds.includes(String(userId))) badges.push('<span style="font-size:18px;" title="Адмін">👑</span>');
        const mathTasks = globalTasks.filter(t => (t.subject||"").toLowerCase().includes("математика"));
        if (mathTasks.length > 0 && mathTasks.every(t => t.isCompleted)) badges.push('<span style="font-size:18px;" title="Броня Вишмату">🛡️</span>');
        let earlyBird = completedTasks.some(t => t.completionDate && t.deadline && (new Date(t.deadline) - new Date(t.completionDate)) / 3600000 > 72);
        if (earlyBird) badges.push('<span style="font-size:18px;" title="Рання пташка">⚡</span>');
        document.getElementById('headerBadges').innerHTML = badges.join('');

        // Панік мод
        const header = document.getElementById('mainHeader');
        if (overdueCount >= 7 && userSettings.panic) { // Додано && userSettings.panic
            header.classList.add('panic-mode');
            document.getElementById('userName').innerText = "🚨 УВАГА!";
            document.getElementById('headerSubtitle').innerText = `У тебе горять борги: ${overdueCount} шт.`;
            tg.HapticFeedback.notificationOccurred('error');
        } else {
            header.classList.remove('panic-mode');
            document.getElementById('userName').innerText = `Привіт, ${firstName}!`;
            document.getElementById('headerSubtitle').innerText = "Твої навчальні завдання";
        }

        // Стрік бейдж
        const fireClass = getFireClass(streakCount);
        if (overdueCount === 0) { streakBadge.className = 'badge badge-green'; streakBadge.innerHTML = `<span class="streak-fire ${fireClass}">🔥</span> Без боргів`; }
        else { streakBadge.className = 'badge badge-red'; streakBadge.innerHTML = `🧊 Боргів: ${overdueCount}`; }

        // Рівень
        if      (percent === 100) { levelBadge.innerHTML = '👑 Легенда';      levelBadge.className = 'badge badge-green'; analyticsText.innerHTML = '<b>Ідеально!</b> Ти розніс усі таски.'; }
        else if (percent >= 80)   { levelBadge.innerHTML = '🚀 Турбо';        levelBadge.className = 'badge badge-blue';  analyticsText.innerHTML = 'Йдеш краще за більшість групи!'; }
        else if (percent >= 50)   { levelBadge.innerHTML = '💪 Стабільний';   levelBadge.className = 'badge badge-blue';  analyticsText.innerHTML = 'Більша половина закрита. Не зупиняйся!'; }
        else if (percent > 0)     { levelBadge.innerHTML = '🐢 Початківець';  levelBadge.className = 'badge badge-red';   analyticsText.innerHTML = 'Треба піднажати!'; }
        else                      { levelBadge.innerHTML = '💤 Спить';        levelBadge.className = 'badge badge-red';   analyticsText.innerHTML = 'Зроби хоча б одне завдання!'; }

        // Прогрес
        progressWrapper.style.display = "block";
        setTimeout(() => {
            progressBar.style.width = `${percent}%`;
            let cur = 0; const steps = 40; const inc = percent / steps;
            const timer = setInterval(() => {
                cur = Math.min(cur + inc, percent);
                progressText.innerText = `Мій прогрес: ${completedTasks.length} з ${globalTasks.length} (${Math.round(cur)}%)`;
                if (cur >= percent) clearInterval(timer);
            }, 800 / steps);
        }, 100);

        // Фільтри
        if (currentFilter === 'overdue') activeTasks = activeTasks.filter(t => new Date(t.deadline) < now);
        else if (currentFilter === 'soon') activeTasks = activeTasks.filter(t => {
            const dl = new Date(t.deadline);
            if (isNaN(dl) || dl < now) return false; // вже протерміновано — не "скоро"
            const dateOnly = new Date(dl.getFullYear(), dl.getMonth(), dl.getDate());
            const nowOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const diff = Math.round((dateOnly - nowOnly) / 86400000);
            return diff >= 0 && diff <= 2;
        });

        if (!activeTasks.length) {
            if (currentFilter === 'overdue') activeList.innerHTML = "<p style='text-align:center;font-weight:600;font-size:13px;color:var(--green);padding:20px;'>Немає боргів! 🚀</p>";
            else if (currentFilter === 'soon') activeList.innerHTML = "<p style='text-align:center;font-weight:600;font-size:13px;color:var(--green);padding:20px;'>На найближчі дні все чисто! 😎</p>";
            else activeList.innerHTML = `<div style="text-align:center;padding:25px;"><span style="font-size:40px;">🏆</span><h3 style="margin-top:10px;font-size:18px;">Ти машина!</h3><p style="color:var(--hint);font-size:12px;">Усі завдання виконано.</p></div>`;
        } else {
            const grouped = {};
            activeTasks.forEach(t => { const s = t.subject||"Інше"; (grouped[s] = grouped[s]||[]).push(t); });
            for (const subj in grouped) {
                const h = document.createElement('div'); h.className = 'subject-group-title'; h.innerText = subj; activeList.appendChild(h);
                grouped[subj].forEach(t => activeList.appendChild(createTaskCard(t)));
            }
        }

        if (completedTasks.length) {
            completedSection.style.display = "block";
            document.getElementById('completedCount').innerText = completedTasks.length;
            const groupedC = {};
            completedTasks.forEach(t => { const s = t.subject||"Інше"; (groupedC[s] = groupedC[s]||[]).push(t); });
            for (const subj in groupedC) {
                const h = document.createElement('div'); h.className = 'subject-group-title'; h.innerText = subj; completedList.appendChild(h);
                groupedC[subj].forEach(t => completedList.appendChild(createTaskCard(t)));
            }
        } else completedSection.style.display = "none";

        renderPersonalTasks(personalTasks); // Відмальовуємо локальні завдання у профілі
        setTimeout(animateCards, 50);
    }
    function animateCards() {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry, i) => {
                if (entry.isIntersecting) {
                    setTimeout(() => entry.target.classList.add('visible'), i * 55);
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.05 });
        document.querySelectorAll('.task-card:not(.completed)').forEach(c => observer.observe(c));
        document.querySelectorAll('.task-card.completed').forEach(c => c.classList.add('visible'));
    }

    // ===================== 🔒 КАРТКА ЗАВДАННЯ =====================
   function createTaskCard(task) {
        const taskId = task.taskId ?? task.id ?? task.TaskId ?? task.Id;
        const isCompleted = task.isCompleted;
        let diffDays = 0, dateStr = "", d = new Date(task.deadline), isPastDeadline = false;
        if (!isNaN(d)) {
            const now = new Date();
            // Час уже минув (навіть якщо це відбулось сьогодні) — окремо від "скільки календарних днів лишилось"
            isPastDeadline = d < now;
            // Різниця рахується по КАЛЕНДАРНИХ днях (без урахування години),
            // а не по "рівно 24 год.", інакше "сьогодні" ніколи не наступає:
            // напр. дедлайн 23:00 сьогодні о 10:00 давав ceil(13/24)=1 ("Скоро!", а не "Сьогодні")
            const dateOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());
            const nowOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            diffDays = Math.round((dateOnly - nowOnly) / 86400000);
            dateStr = d.toLocaleDateString('uk-UA', { day:'numeric', month:'long' }) +
                      ', ' + d.toLocaleTimeString('uk-UA', { hour:'2-digit', minute:'2-digit' });
        }

        // 🔒 Блокуємо тільки якщо в назві є [lock] І дедлайн реально минув (за часом, не за днем)
        const hasLockTag = (task.title || "").toLowerCase().includes("[lock]");
        
        // ЄДИНЕ оголошення isLocked
        const isLocked = !isCompleted && hasLockTag && isPastDeadline;

        // Прибираємо мітку [lock] з відображуваної назви
        const displayTitle = (task.title || "").replace(/\[lock\]/gi, "").trim();

        let sc = "status-ok", bc = "card-ok", st = `Залишилось: ${diffDays} дн. (до ${dateStr})`;
        if (isLocked)              { sc = "status-locked"; bc = "card-overdue"; st = `🔒 ЗАБЛОКОВАНО (до ${dateStr})`; }
        else if (isPastDeadline)   { sc = "status-overdue"; bc = "card-overdue"; st = `Протерміновано! (до ${dateStr})`; }
        else if (diffDays === 0)   { sc = "status-soon";   bc = "card-soon";    st = `СЬОГОДНІ ДЕДЛАЙН! (до ${dateStr})`; }
        else if (diffDays <= 2)    { sc = "status-soon";   bc = "card-soon";    st = `Скоро! (${diffDays} дн., до ${dateStr})`; }

        // ✅ ЧЕК-ЛИСТ: якщо у завдання є пункти — замість одного чекбокса рендеримо список
        const checklist = Array.isArray(task.checklist) ? task.checklist : [];
        const checkedSet = new Set(Array.isArray(task.checkedIndices) ? task.checkedIndices : []);
        const hasChecklist = checklist.length > 0;

        // Права частина картки: замок, чекбокс, або нічого (для чек-листа прогрес показано всередині картки)
        const rightHtml = isLocked
            ? `<div class="lock-icon" title="Термін здачі минув">🔒</div>`
            : hasChecklist
                ? ``
                : `<div class="checkbox ${isCompleted ? 'checked' : ''}" onclick="askComplete(${taskId}, ${isCompleted})">
                       <svg viewBox="0 0 14 14"><polyline points="2,7 5.5,11 12,3"/></svg>
                   </div>`;

        const checklistHtml = hasChecklist ? `
            <div class="checklist">
                ${checklist.map((item, i) => `
                    <div class="checklist-item ${checkedSet.has(i) ? 'checked' : ''}" ${isLocked ? '' : `onclick="toggleChecklistItem(${taskId}, ${i})"`}>
                        <span class="chk-box">${checkedSet.has(i) ? '✓' : ''}</span>
                        <span class="chk-text">${escapeHtml(item)}</span>
                    </div>`).join('')}
                <div class="checklist-progress">${checkedSet.size}/${checklist.length} пунктів виконано</div>
            </div>` : '';

        const card = document.createElement('div');
        card.id = `task-${taskId}`;
        card.className = `task-card ${bc} ${isCompleted ? 'completed' : ''} ${isLocked ? 'locked-card' : ''}`;
        
        // Використовуємо displayTitle замість task.title
        card.innerHTML = `
            <div class="task-info">
                <div class="task-subject"><span>${task.subject || "Предмет"}</span><span class="reg-no">№ ${String(taskId).padStart(4, "0")}</span></div>
                <div class="task-title">${displayTitle}</div> 
                <div class="task-deadline ${sc}">${isCompleted ? 'Виконано ✓' : st}</div>
                ${checklistHtml}
            </div>
            ${rightHtml}`;
        return card;
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.innerText = str == null ? '' : String(str);
        return div.innerHTML;
    }

    // ===================== ✅ ЧЕК-ЛИСТ: тоглим один пункт =====================
    async function toggleChecklistItem(taskId, index) {
        tg.HapticFeedback.impactOccurred('light');
        try {
            const res = await fetch(`${API_URL}/tasks/${userId}/checklist/${taskId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ index: index })
            });
            if (res.status === 400) {
                const err = await res.json().catch(() => ({}));
                if (err.error === 'locked') { showToast("🔒 Термін вийшов — завдання заблоковано!"); tg.HapticFeedback.notificationOccurred('error'); }
                loadData();
                return;
            }
            if (res.ok) {
                const d = await res.json();
                if (d.isCompleted) { showStamp("ВИКОНАНО"); showToast("Чек-лист виконано! +10 🪙"); tg.HapticFeedback.notificationOccurred('success'); }
                loadData();
            } else { showToast("Помилка сервера!"); }
        } catch (e) { showToast("Немає зв'язку!"); }
    }

    // ===================== ПІДТВЕРДЖЕННЯ =====================
    function askComplete(taskId, state) {
        pendingTaskId = taskId; pendingTaskState = state;
        document.getElementById('confirmText').innerText = state ? "Повернути в роботу?" : "Ти виконав це завдання?";
        document.getElementById('confirmYesBtn').innerText = state ? "Повернути" : "Так, готово!";
        document.getElementById('confirmOverlay').classList.add('active');
        tg.HapticFeedback.impactOccurred('light');
    }
    function closeConfirm() { document.getElementById('confirmOverlay').classList.remove('active'); }

    document.getElementById('confirmYesBtn').addEventListener('click', async () => {
        if (pendingTaskId === null) return;
        const taskId = pendingTaskId, state = pendingTaskState;
        closeConfirm();
        const card = document.getElementById(`task-${taskId}`);
        if (card) card.classList.add(state ? 'uncompleting' : 'completing');
        tg.HapticFeedback.impactOccurred('medium');
        setTimeout(async () => {
            try {
                const res = await fetch(`${API_URL}/tasks/${userId}/complete/${taskId}`, { method: 'POST' });

                // 🔒 Сервер заблокував — термін вийшов
                if (res.status === 400) {
                    const err = await res.json().catch(() => ({}));
                    if (err.error === 'locked') {
                        showToast("🔒 Термін вийшов — завдання заблоковано!");
                        tg.HapticFeedback.notificationOccurred('error');
                        if (card) card.classList.remove('completing', 'uncompleting');
                        loadData();
                        return;
                    }
                }

                if (res.ok) {
                    if (!state) { showStamp("ВИКОНАНО"); showToast("Виконано! +10 🪙"); }
                    else showToast("Ех... знову в роботу");
                    loadData();
                } else {
                    showToast("Помилка сервера!");
                    if (card) { card.classList.remove('completing', 'uncompleting'); }
                }
            } catch(e) { showToast("Немає зв'язку!"); }
        }, 350);
    });

    // ===================== LIVE WIDGET (ОГОЛОШЕННЯ) =====================
    let globalAnnouncements = [];

    function getReadIds() {
        try { return JSON.parse(localStorage.getItem(`news_read_${userId}`) || '[]'); } catch(e) { return []; }
    }
    function markAsRead(id) {
        const ids = getReadIds();
        if (!ids.includes(id)) { ids.push(id); localStorage.setItem(`news_read_${userId}`, JSON.stringify(ids)); }
    }
    function isRead(id) { return getReadIds().includes(id); }

    function getActiveAnnouncement() {
        const now = new Date();
        // Беремо оголошення, що ще не закінчились, і сортуємо за найближчою датою початку
        const upcoming = globalAnnouncements
            .filter(a => new Date(a.expiresAt) >= now)
            .sort((a, b) => new Date(a.startsAt || a.expiresAt) - new Date(b.startsAt || b.expiresAt));
        return upcoming[0] || null;
    }

    function getUnreadCount() {
        return globalAnnouncements.filter(a => !isRead(a.id)).length;
    }

    function updateNewsBadge() {
        const count = getUnreadCount();
        const badge = document.getElementById('newsBadge');
        if (!badge) return;
        if (count > 0) { badge.innerText = count > 9 ? '9+' : String(count); badge.style.display = 'flex'; }
        else badge.style.display = 'none';
    }

    function updateAnnouncementWidget() {
        const ann = getActiveAnnouncement();
        const widget = document.getElementById('liveWidget');
        if (!ann) { widget.style.display = 'none'; return; }
        const now = new Date();
        const startsAt = ann.startsAt ? new Date(ann.startsAt) : null;
        const isSoon = startsAt && startsAt > now;
        const diffDays = startsAt ? Math.ceil((startsAt - now) / (1000 * 60 * 60 * 24)) : 0;
        let statusText = '';
        if (isSoon) {
            statusText = diffDays === 1 ? '⚠️ Завтра!' : `⏳ Через ${diffDays} дн.`;
        }
        document.getElementById('liveSubject').innerText = (statusText ? statusText + ' ' : '') + ann.title + (ann.text ? ' — ' + ann.text : '');
        document.getElementById('liveText').innerText = '';
        widget.style.display = 'flex';
    }

    async function loadAnnouncements() {
        try {
            const res = await fetch(`${API_URL}/announcements`);
            if (res.ok) globalAnnouncements = await res.json();
            else globalAnnouncements = [];
        } catch(e) { globalAnnouncements = []; }
        updateNewsBadge();
        updateAnnouncementWidget();
        if (currentTab === 'news') renderAnnouncements();
    }

    function renderAnnouncements() {
        const list = document.getElementById('newsList');
        if (!globalAnnouncements.length) {
            list.innerHTML = `<div style="text-align:center;padding:30px;color:var(--hint);font-size:13px;">Оголошень поки немає 📭</div>`;
            return;
        }
        list.innerHTML = '';
        const now = new Date();
        [...globalAnnouncements]
            .sort((a, b) => new Date(a.startsAt || a.expiresAt) - new Date(b.startsAt || b.expiresAt))
            .forEach(ann => {
                const isActive = new Date(ann.expiresAt) >= now;
                const read = isRead(ann.id);
                const now2 = new Date();
                const startsAt = ann.startsAt ? new Date(ann.startsAt) : null;
                const isSoon = startsAt && startsAt > now2;
                const diffDays = startsAt ? Math.ceil((startsAt - now2) / (1000*60*60*24)) : 0;
                const soonLabel = isSoon ? (diffDays === 1 ? ' ⚠️ Завтра!' : ` ⏳ Через ${diffDays} дн.`) : '';
                const createdStr = new Date(ann.createdAt).toLocaleDateString('uk-UA', { day:'numeric', month:'long', year:'numeric' });
                const startsStr  = startsAt ? startsAt.toLocaleDateString('uk-UA', { day:'numeric', month:'long', year:'numeric' }) : null;
                const expiresStr = new Date(ann.expiresAt).toLocaleDateString('uk-UA', { day:'numeric', month:'long', year:'numeric' });
                const dateLabel  = startsStr
                    ? `📅 від ${createdStr} &nbsp;·&nbsp; початок ${startsStr} &nbsp;·&nbsp; закінчення ${expiresStr}${soonLabel}`
                    : `📅 від ${createdStr} &nbsp;·&nbsp; відбудеться ${expiresStr}${soonLabel}`;
                const card = document.createElement('div');
                card.className = `announcement-card ${isActive ? '' : 'inactive'} ${!read ? 'unread' : ''}`;
                card.innerHTML = `
                    <div class="ann-header">
                        <div class="ann-title">${!read ? '<span class="ann-new-dot"></span>' : ''}${ann.title}${ann.text ? ' — ' + ann.text : ''}</div>
                        <span class="ann-status ${isActive ? 'active' : 'inactive'}">${isActive ? 'Активне' : 'Неактивне'}</span>
                    </div>
                    <div class="ann-meta">${dateLabel}</div>`;
                card.addEventListener('click', () => {
                    card.classList.toggle('expanded');
                    if (!read) {
                        markAsRead(ann.id);
                        card.classList.remove('unread');
                        card.querySelector('.ann-new-dot')?.remove();
                        updateNewsBadge();
                    }
                    tg.HapticFeedback.selectionChanged();
                });
                list.appendChild(card);
            });
    }

    // ===================== АДМІН: ОГОЛОШЕННЯ =====================
    async function loadAdminAnnouncements() {
        const list = document.getElementById('adminAnnouncementsList');
        list.innerHTML = `<div style="text-align:center;padding:20px;color:var(--hint);font-size:13px;">⏳ Завантаження...</div>`;
        try {
            const res = await fetch(`${API_URL}/announcements`);
            if (!res.ok) { list.innerHTML = `<div style="color:var(--red);font-size:13px;padding:10px;">❌ Помилка сервера</div>`; return; }
            const anns = await res.json();
            list.innerHTML = '';
            if (!anns.length) {
                list.innerHTML = `<div style="text-align:center;padding:20px;color:var(--hint);font-size:13px;">Оголошень ще немає 📭</div>`;
                return;
            }
            const now = new Date();
            anns.forEach(a => {
                const isActive = new Date(a.expiresAt) >= now;
                const expiresStr = new Date(a.expiresAt).toLocaleDateString('uk-UA', { day:'numeric', month:'long', year:'numeric' });
                list.innerHTML += `
                    <div style="background:var(--bg);padding:12px;border-radius:12px;margin-bottom:8px;border:1px solid rgba(0,0,0,0.06);display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:13px;font-weight:600;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${a.title}</div>
                            <div style="font-size:11px;color:${isActive ? 'var(--green)' : 'var(--hint)'};font-weight:500;">${isActive ? '🟢 Активне' : '⚫ Неактивне'} — до ${expiresStr}</div>
                        </div>
                        <button onclick="deleteAnnouncement(${a.id})"
                            style="background:rgba(229,57,53,0.1);color:var(--red);border:none;padding:8px 12px;border-radius:10px;font-weight:600;cursor:pointer;font-size:12px;white-space:nowrap;flex-shrink:0;">
                            🗑 Видалити
                        </button>
                    </div>`;
            });
        } catch(e) {
            list.innerHTML = `<div style="color:var(--red);font-size:13px;padding:10px;">❌ Немає зв'язку із сервером</div>`;
        }
    }

    async function addAnnouncement() {
        const title   = document.getElementById('newAnnTitle').value.trim();
        const text    = document.getElementById('newAnnText').value.trim();
        const starts  = document.getElementById('newAnnStarts').value;
        const expires = document.getElementById('newAnnExpires').value;
        if (!title || !text || !starts || !expires) { tg.showAlert("Заповни всі поля!"); tg.HapticFeedback.notificationOccurred('error'); return; }
        tg.HapticFeedback.impactOccurred('medium');
        try {
            const res = await fetch(`${API_URL}/announcements`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, text, adminId: userId, startsAt: starts + 'T00:00:00Z', expiresAt: (() => {
                    const timeVal = document.getElementById('newAnnExpiresTime').value || '23:59';
                    const [hh, mm] = timeVal.split(':').map(Number);
                    // Конвертуємо київський час (UTC+3) в UTC
                    const localDate = new Date(expires + 'T' + timeVal + ':00');
                    localDate.setHours(localDate.getHours() - 3);
                    return expires + 'T' + String(localDate.getUTCHours()).padStart(2,'0') + ':' + String(localDate.getUTCMinutes()).padStart(2,'0') + ':00Z';
                })() })
            });
            if (res.ok) {
                showToast("📢 Оголошення опубліковано!");
                tg.HapticFeedback.notificationOccurred('success');
                document.getElementById('newAnnTitle').value = '';
                document.getElementById('newAnnText').value = '';
                document.getElementById('newAnnStarts').value = '';
                document.getElementById('newAnnExpires').value = '';
                document.getElementById('newAnnExpiresTime').value = '23:59';
                loadAdminAnnouncements();
                loadAnnouncements();
            } else {
                const err = await res.json().catch(() => ({}));
                showToast("❌ " + (err.error || "Помилка сервера"));
            }
        } catch(e) { showToast("❌ Немає зв'язку із сервером"); }
    }

    async function deleteAnnouncement(id) {
        tg.HapticFeedback.impactOccurred('light');
        try {
            const res = await fetch(`${API_URL}/announcements/${id}?adminId=${userId}`, { method: 'DELETE' });
            if (res.ok) { showToast("🗑️ Оголошення видалено"); tg.HapticFeedback.notificationOccurred('success'); loadAdminAnnouncements(); loadAnnouncements(); }
            else showToast("❌ Помилка видалення");
        } catch(e) { showToast("❌ Немає зв'язку"); }
    }

    // ===================== TOAST =====================
    function showToast(msg) {
        const t = document.getElementById('toast');
        t.innerHTML = msg; t.classList.remove('show','hide'); void t.offsetWidth;
        t.classList.add('show'); clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => { t.classList.remove('show'); t.classList.add('hide'); }, 2800);
    }

    document.getElementById('confirmOverlay').addEventListener('click', function(e) {
        if (e.target === this) closeConfirm();
    });
    let mySchedule = null;

async function loadSchedule() {
    try {
        const res = await fetch(`${API_URL}/schedule/${userId}`);
        if (res.ok) {
            mySchedule = await res.json();
           // Визначаємо поточний тиждень (відлік від 2 березня 2026)
            const now = new Date();
            now.setHours(0, 0, 0, 0);
            const semesterStart = new Date(2026, 2, 2); // 2 = Березень
            const daysPassed = Math.floor((now - semesterStart) / 86400000);
            const weekIndex = Math.floor(Math.max(0, daysPassed) / 7);
            const currentWeek = (weekIndex % 2 === 0) ? 1 : 2;
            currentWeekNum = currentWeek;
            renderWeek(currentWeek); 
        }
    } catch(e) {}
}

      let currentWeekNum = 1;      // який тиждень зараз за календарем
let schShownWeek = 1;        // який тиждень відкритий
let schSelectedDay = null;   // обраний день
const SCH_SHORT = { 'Понеділок':'Пн', 'Вівторок':'Вт', 'Середа':'Ср', 'Четвер':'Чт', "П'ятниця":'Пт', 'Субота':'Сб', 'Неділя':'Нд' };
const SCH_DAYS = ["Неділя", "Понеділок", "Вівторок", "Середа", "Четвер", "П'ятниця", "Субота"];

function schRange(t) {
    const m = t.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
    return m ? [+m[1] * 60 + +m[2], +m[3] * 60 + +m[4]] : null;
}
const schFmt = m => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
function schPairsWord(n) {
    const l = n % 10, t = n % 100;
    if (t >= 11 && t <= 14) return 'пар';
    return l === 1 ? 'пара' : (l >= 2 && l <= 4) ? 'пари' : 'пар';
}
function schDur(min) {
    const h = Math.floor(min / 60), m = min % 60;
    return (h ? h + ' год ' : '') + (m ? m + ' хв' : '').trim();
}
function schInitials(name) {
    const p = name.split(/\s+/).filter(Boolean);
    return ((p[0] || '')[0] || '') + ((p[1] || '')[0] || '');
}

// Розбір одного дня у список елементів
function schParseDay(d) {
    let currentType = 'Практика';
    const items = [];
    d.text.split('\n\n').forEach(raw => {
        const block = raw.trim();
        if (!block) return;
        if (/^\*[^*]+\*$/.test(block)) { currentType = block.replace(/\*/g, '').trim(); return; }

        const m = block.match(/^(\d)\.\s*\((.*?)\)\s*([\s\S]*)/);
        if (!m) return;
        const pairNo = m[1], time = m[2];
        let rest = m[3].trim();

        let nextType = null;
        const tail = rest.match(/\*([^*]+)\*\s*$/);
        if (tail) { nextType = tail[1].trim(); rest = rest.slice(0, tail.index).trim(); }

        const range = schRange(time);
        if (rest.includes('Спимо')) {
            items.push({ kind: 'window', pairNo, range });
            if (nextType) currentType = nextType;
            return;
        }

        let type = currentType;
        const pref = rest.match(/^(Лекція|Практика)\s+/i);
        if (pref) { type = pref[1]; rest = rest.slice(pref[0].length); }

        const clean = rest.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/_(.*?)_/g, '$1');
        const parts = clean.split(' — ');
        items.push({
            kind: 'lesson', pairNo, range,
            isLecture: /лекц/i.test(type),
            title: parts[0].trim(),
            teacher: parts.length > 1 ? parts.slice(1).join(' — ').trim() : ''
        });
        if (nextType) currentType = nextType;
    });

    // Вікна на початку і в кінці дня нікому не цікаві
    while (items.length && items[0].kind === 'window') items.shift();
    while (items.length && items[items.length - 1].kind === 'window') items.pop();
    return items;
}

function schPickDay(day) { schSelectedDay = day; renderWeek(schShownWeek); tg.HapticFeedback?.selectionChanged(); }

function renderWeek(weekNum) {
    schShownWeek = weekNum;
    document.getElementById('btnWeek1').classList.toggle('active', weekNum === 1);
    document.getElementById('btnWeek2').classList.toggle('active', weekNum === 2);

    const container = document.getElementById('scheduleContainer');
    if (!mySchedule) {
        container.innerHTML = `<div class="sch-free"><div class="big">⚠️</div>Помилка завантаження</div>`;
        return;
    }

    const weekData = (weekNum === 1 ? mySchedule.week1 : mySchedule.week2);
    const parsed = weekData.map(d => ({ day: d.day, items: schParseDay(d) }));

    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const todayName = SCH_DAYS[now.getDay()];
    const todayVisible = weekNum === currentWeekNum;

    // Який день відкрити: обраний, інакше сьогодні, інакше понеділок
    if (!schSelectedDay || !parsed.some(p => p.day === schSelectedDay)) {
        schSelectedDay = parsed.some(p => p.day === todayName) ? todayName : parsed[0].day;
    }
    const cur = parsed.find(p => p.day === schSelectedDay);
    const isToday = todayVisible && cur.day === todayName;

    // Смуга днів
    const strip = parsed.map(p => {
        const n = p.items.filter(i => i.kind === 'lesson').length;
        const cls = [p.day === schSelectedDay ? 'active' : '', todayVisible && p.day === todayName ? 'today' : ''].join(' ');
        return `<button class="sch-chip ${cls}" onclick="schPickDay(&quot;${p.day}&quot;)">
                    <span class="nm">${SCH_SHORT[p.day] || p.day}</span>
                    <span class="ct">${n ? n + ' ' + schPairsWord(n) : '—'}</span>
                </button>`;
    }).join('');

    // Шапка дня
    const lessons = cur.items.filter(i => i.kind === 'lesson' && i.range);
    let sub = 'Пар немає';
    if (lessons.length) {
        const start = Math.min(...lessons.map(l => l.range[0]));
        const end = Math.max(...lessons.map(l => l.range[1]));
        sub = `${lessons.length} ${schPairsWord(lessons.length)} · ${schFmt(start)}–${schFmt(end)}`;
    }
    const hero = `
        <div class="sch-hero">
            <div class="sch-hero-top">
                <h3>${escapeHtml(cur.day)}</h3>
                ${isToday ? '<span class="tag">СЬОГОДНІ</span>' : ''}
            </div>
            <div class="sub">${sub} · ${weekNum}-й тиждень</div>
        </div>`;

    // Таймлайн
    let body;
    if (!cur.items.length) {
        body = `<div class="sch-free"><div class="big">🌿</div>Пар немає, можна відпочити</div>`;
    } else {
        body = '<div class="sch-timeline">' + cur.items.map(it => {
            const r = it.range;
            let state = '';
            if (isToday && r) state = nowMin >= r[0] && nowMin < r[1] ? 'now' : (nowMin >= r[1] ? 'done' : '');
            const tHtml = r ? `<div class="sch-t"><b>${schFmt(r[0])}</b><span>${schFmt(r[1])}</span></div>` : `<div class="sch-t"></div>`;

            if (it.kind === 'window') {
                const dur = r ? schDur(r[1] - r[0]) : '';
                return `<div class="sch-row window ${state}">${tHtml}<span class="sch-dot"></span>
                            <div class="sch-card">Вікно${dur ? ' · ' + dur : ''}</div></div>`;
            }

            const pct = state === 'now' && r ? Math.round((nowMin - r[0]) / (r[1] - r[0]) * 100) : 0;
            return `<div class="sch-row ${it.isLecture ? '' : 'practice'} ${state}">
                ${tHtml}<span class="sch-dot"></span>
                <div class="sch-card">
                    <div class="top">
                        <span class="sch-pill">${it.isLecture ? 'Лекція' : 'Практика'}</span>
                        ${state === 'now' ? '<span class="sch-live">ЗАРАЗ</span>' : `<span class="sch-no">пара ${it.pairNo}</span>`}
                    </div>
                    <div class="sch-title">${escapeHtml(it.title)}</div>
                    ${it.teacher ? `<div class="sch-teacher"><span class="sch-ava">${escapeHtml(schInitials(it.teacher))}</span>${escapeHtml(it.teacher)}</div>` : ''}
                    ${state === 'now' ? `<div class="sch-prog"><i style="width:${pct}%"></i></div>` : ''}
                </div>
            </div>`;
        }).join('') + '</div>';
    }

    container.innerHTML = `<div class="sch-strip">${strip}</div>${hero}${body}`;
}

// Оновлюємо «ЗАРАЗ» і прогрес раз на хвилину, поки відкрита вкладка розкладу
setInterval(() => {
    if (currentTab === 'schedule' && mySchedule) renderWeek(schShownWeek);
}, 60000);
    let isCurrentlyInQueue = false;

async function loadQueue() {
    try {
        const res = await fetch(`${API_URL}/queue/${userId}`);
        if (res.ok) {
            const data = await res.json();
            if (!data.active) {
                document.getElementById('queueInactiveState').style.display = 'block';
                document.getElementById('queueActiveState').style.display = 'none';
                return;
            }
            
            document.getElementById('queueInactiveState').style.display = 'none';
            document.getElementById('queueActiveState').style.display = 'block';
            document.getElementById('queueSubjectName').innerText = data.subject;
            
            isCurrentlyInQueue = data.inQueue;
            const btn = document.getElementById('queueActionBtn');
            if (isCurrentlyInQueue) {
                btn.innerText = "🏃 Вийти з черги";
                btn.style.background = "var(--red)";
            } else {
                btn.innerText = "🙋‍♂️ Встати в чергу";
                btn.style.background = "var(--btn)";
            }
            
            const listContainer = document.getElementById('queueListContainer');
            if (data.queue.length === 0) {
                listContainer.innerHTML = `<div style="text-align:center; padding:10px; font-size:12px; color:var(--hint);">Черга порожня. Будь першим!</div>`;
            } else {
                listContainer.innerHTML = "";
                data.queue.forEach((student, index) => {
                    const isMe = student.id == userId;
                    listContainer.innerHTML += `
                        <div style="display:flex; align-items:center; padding:10px; border-bottom:1px solid rgba(0,0,0,0.04); ${isMe ? 'background:rgba(36,129,204,0.08); border-radius:8px;' : ''}">
                            <div style="font-weight:700; color:${isMe ? 'var(--btn)' : 'var(--hint)'}; width:25px;">${index + 1}.</div>
                            <div style="font-weight:600; font-size:13px; color:${isMe ? 'var(--btn)' : 'var(--text)'};">${student.name} ${isMe ? '(Ти)' : ''}</div>
                        </div>
                    `;
                });
            }
        }
    } catch(e) {}
}

async function toggleQueue() {
    tg.HapticFeedback.impactOccurred('medium');
    const action = isCurrentlyInQueue ? 'leave' : 'join';
    try {
        const res = await fetch(`${API_URL}/queue/action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: userId, action: action })
        });
        if (res.ok) {
            showToast(isCurrentlyInQueue ? "Ти вийшов з черги" : "Ти встав у чергу!");
            loadQueue(); // Оновлюємо список
        } else {
            showToast("❌ Помилка");
        }
    } catch(e) { showToast("❌ Немає зв'язку"); }
}
    applyTheme();
    updateDocMeta(); setInterval(updateDocMeta, 60000);
    bootstrap();