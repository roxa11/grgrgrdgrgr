

const APP_CONFIG = {
    FIREBASE: {
        apiKey: "AIzaSyDyUUoxihnctmeBuAzluM6EPWHqpCAGw-0",
        authDomain: "semey-e0bc3.firebaseapp.com",
        databaseURL: "https://semey-e0bc3-default-rtdb.firebaseio.com",
        projectId: "semey-e0bc3",
        storageBucket: "semey-e0bc3.firebasestorage.app",
        messagingSenderId: "546395953015",
        appId: "1:546395953015:web:e5093b0d1f28786899f372",
        measurementId: "G-VYHQWF6BY9"
    },
    ADMIN_IINS: ["999999999999"],
    WORKER_DIRECTORY: {
        "222222222222": "ТОО Semey Road Service",
        "333333333333": "ТОО Semey Light Team"
    },
    SLA_HOURS: 48,
    POLL_INTERVAL_MS: 25000
};

const CATEGORY_LABELS = {
    roads: "Дороги и ямы",
    lights: "Освещение",
    trash: "Вывоз мусора",
    water: "Водоснабжение",
    other: "Благоустройство"
};

const STATUS_LABELS = {
    new: "Принято",
    assigned: "Назначен исполнитель",
    in_progress: "В работе",
    completed_pending_acceptance: "Выполнено, ждёт приемки",
    done: "Подтверждено жителем",
    rework: "Отправлено на доработку",
    rejected: "Отклонено"
};

const STATUS_COLOR = {
    new: "#6b7d93",
    assigned: "#3767ba",
    in_progress: "#c37d0f",
    completed_pending_acceptance: "#178a6b",
    done: "#0f7b5f",
    rework: "#b55c24",
    rejected: "#aa3535"
};

/* ============================================================
   App object
   ============================================================ */
const App = {
    state: {
        user: null,
        db: null,          // Firebase database reference
        dbRef: null,       // /requests ref
        maps: {},
        listener: null,    // Firebase .on() listener
        currentView: "view-login",
        adminRows: [],
        workerRows: [],
        citizenRows: [],
        citizenSelectionMarker: null,
        allRows: []        // cached full dataset
    },

    /* ----------------------------------------------------------
       INIT
       ---------------------------------------------------------- */
    init: async function () {
        this.cacheElements();
        this.bindEvents();

        if (!this.isFirebaseConfigured()) {
            this.els.setupBanner.classList.remove("hidden");
            this.els.setupBanner.innerHTML = 'Заполните в <code>app.js</code> объект <code>APP_CONFIG.FIREBASE</code> данными из Firebase Console.';
            this.setConnectionBadge(false, "База: не настроена");
            this.showOnly("view-login");
            return;
        }

        try {
            firebase.initializeApp(APP_CONFIG.FIREBASE);
            this.state.db = firebase.database();
            this.state.dbRef = this.state.db.ref("requests");
        } catch (e) {
            this.els.setupBanner.classList.remove("hidden");
            this.els.setupBanner.textContent = "Ошибка инициализации Firebase: " + e.message;
            this.setConnectionBadge(false, "База: ошибка");
            this.showOnly("view-login");
            return;
        }

        // Проверяем подключение
        const connected = await this.checkDbConnection();
        if (!connected) {
            this.setConnectionBadge(false, "База: ошибка подключения");
            this.els.setupBanner.classList.remove("hidden");
            this.els.setupBanner.textContent = "Не удалось подключиться к Firebase. Проверьте databaseURL и правила доступа (Rules → test mode).";
            this.showOnly("view-login");
            return;
        }

        this.setConnectionBadge(true, "База: подключена ✓");

        // Восстанавливаем сессию
        const savedUser = localStorage.getItem("cityflow_user");
        if (savedUser) {
            try {
                this.state.user = JSON.parse(savedUser);
            } catch (_) {
                localStorage.removeItem("cityflow_user");
            }
        }

        if (this.state.user) {
            await this.enterRoleView();
        } else {
            this.showOnly("view-login");
        }

        // Подписка на realtime обновления
        this.startRealtimeListener();
    },

    cacheElements: function () {
        this.els = {
            setupBanner: document.getElementById("setup-banner"),
            connectionBadge: document.getElementById("connection-badge"),
            userChip: document.getElementById("user-chip"),
            logoutBtn: document.getElementById("btn-logout"),

            loginForm: document.getElementById("login-form"),
            loginIin: document.getElementById("login-iin"),
            loginName: document.getElementById("login-name"),

            citizenForm: document.getElementById("citizen-form"),
            citizenList: document.getElementById("citizen-list"),
            citizenMap: document.getElementById("citizen-map"),
            citizenPoints: document.getElementById("citizen-points"),

            reqAddress: document.getElementById("req-address"),
            reqCategory: document.getElementById("req-category"),
            reqDescription: document.getElementById("req-description"),
            reqPhoto: document.getElementById("req-photo"),
            reqLat: document.getElementById("req-lat"),
            reqLng: document.getElementById("req-lng"),
            detectGeoBtn: document.getElementById("btn-detect-geo"),
            citizenRefreshBtn: document.getElementById("citizen-refresh"),

            adminRefreshBtn: document.getElementById("admin-refresh"),
            adminFeed: document.getElementById("admin-feed"),
            adminMap: document.getElementById("admin-map"),
            adminRanking: document.getElementById("contractor-ranking"),
            adminHotspot: document.getElementById("admin-hotspot"),
            statTotal: document.getElementById("stat-total"),
            statOpen: document.getElementById("stat-open"),
            statAvg: document.getElementById("stat-avg"),
            statSla: document.getElementById("stat-sla"),

            workerRefreshBtn: document.getElementById("worker-refresh"),
            workerFeed: document.getElementById("worker-feed"),
            workerMap: document.getElementById("worker-map"),
            workerTotal: document.getElementById("worker-total"),
            workerActive: document.getElementById("worker-active"),
            workerCheck: document.getElementById("worker-check"),
            workerRework: document.getElementById("worker-rework")
        };
    },

    bindEvents: function () {
        this.els.loginForm.addEventListener("submit", (event) => {
            event.preventDefault();
            this.login();
        });

        this.els.logoutBtn.addEventListener("click", () => this.logout());
        this.els.detectGeoBtn.addEventListener("click", () => this.detectGeolocation());

        this.els.citizenForm.addEventListener("submit", (event) => {
            event.preventDefault();
            this.createRequest();
        });

        this.els.citizenRefreshBtn.addEventListener("click", () => this.refreshActiveView(true));
        this.els.adminRefreshBtn.addEventListener("click", () => this.refreshActiveView(true));
        this.els.workerRefreshBtn.addEventListener("click", () => this.refreshActiveView(true));

        this.els.citizenList.addEventListener("click", (event) => this.handleCitizenAction(event));
        this.els.adminFeed.addEventListener("click", (event) => this.handleAdminAction(event));
        this.els.workerFeed.addEventListener("click", (event) => this.handleWorkerAction(event));
    },

    /* ----------------------------------------------------------
       Firebase helpers
       ---------------------------------------------------------- */
    isFirebaseConfigured: function () {
        return APP_CONFIG.FIREBASE &&
            APP_CONFIG.FIREBASE.databaseURL &&
            !APP_CONFIG.FIREBASE.apiKey.includes("ВАШ_");
    },

    checkDbConnection: function () {
        return new Promise((resolve) => {
            const connRef = firebase.database().ref(".info/connected");
            const timeout = setTimeout(() => resolve(true), 3000); // assume OK after 3s

            connRef.once("value", (snap) => {
                clearTimeout(timeout);
                resolve(true);
            }, () => {
                clearTimeout(timeout);
                resolve(false);
            });
        });
    },

    /** Fetch all requests from Firebase (one-shot) */
    fetchAllRequests: function () {
        return new Promise((resolve) => {
            this.state.dbRef.once("value", (snapshot) => {
                const data = snapshot.val();
                if (!data) { resolve([]); return; }
                const rows = Object.values(data);
                rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
                resolve(rows);
            }, () => resolve([]));
        });
    },

    /** Real-time listener — auto-refreshes on any DB change */
    startRealtimeListener: function () {
        this.state.dbRef.on("value", (snapshot) => {
            const data = snapshot.val();
            this.state.allRows = data ? Object.values(data) : [];
            this.state.allRows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

            // Auto-render current view
            if (this.state.user) {
                this.renderActiveView();
            }
        });
    },

    /** Write a new request to Firebase */
    pushRequest: function (payload) {
        return this.state.dbRef.child(payload.id.toString()).set(payload);
    },

    /** Update fields on existing request */
    patchRequest: function (id, patch) {
        return this.state.dbRef.child(id.toString()).update(patch);
    },

    setConnectionBadge: function (isConnected, text) {
        this.els.connectionBadge.textContent = text;
        this.els.connectionBadge.classList.remove("ok", "bad");
        this.els.connectionBadge.classList.add(isConnected ? "ok" : "bad");
    },

    /* ----------------------------------------------------------
       AUTH
       ---------------------------------------------------------- */
    getRoleByIin: function (iin) {
        if (APP_CONFIG.ADMIN_IINS.includes(iin)) return "admin";
        if (APP_CONFIG.WORKER_DIRECTORY[iin]) return "worker";
        return "citizen";
    },

    login: async function () {
        const iin = this.els.loginIin.value.trim();
        const name = this.els.loginName.value.trim();

        if (!/^\d{12}$/.test(iin)) {
            alert("ИИН должен содержать ровно 12 цифр.");
            return;
        }

        if (!name || name.length < 2) {
            alert("Введите корректное ФИО.");
            return;
        }

        const role = this.getRoleByIin(iin);
        this.state.user = {
            iin,
            name,
            role,
            contractor: role === "worker" ? APP_CONFIG.WORKER_DIRECTORY[iin] : null
        };

        localStorage.setItem("cityflow_user", JSON.stringify(this.state.user));
        await this.enterRoleView();
    },

    logout: function () {
        this.state.user = null;
        localStorage.removeItem("cityflow_user");
        this.els.userChip.classList.add("hidden");
        this.els.logoutBtn.classList.add("hidden");
        this.showOnly("view-login");
    },

    showOnly: function (viewId) {
        ["view-login", "view-citizen", "view-admin", "view-worker"].forEach((id) => {
            const section = document.getElementById(id);
            if (!section) return;
            section.classList.toggle("hidden", id !== viewId);
        });
        this.state.currentView = viewId;
    },

    enterRoleView: async function () {
        if (!this.state.user) return;

        const roleName = this.state.user.role === "admin"
            ? "Администрация"
            : this.state.user.role === "worker"
                ? this.state.user.contractor
                : "Житель";

        this.els.userChip.textContent = `${this.escapeHtml(this.state.user.name)} — ${this.escapeHtml(roleName)}`;
        this.els.userChip.classList.remove("hidden");
        this.els.logoutBtn.classList.remove("hidden");

        // Fetch initial data
        this.state.allRows = await this.fetchAllRequests();

        if (this.state.user.role === "citizen") {
            this.showOnly("view-citizen");
            this.ensureCitizenMap();
            this.renderCitizenView();
        }

        if (this.state.user.role === "admin") {
            this.showOnly("view-admin");
            this.renderAdminView();
        }

        if (this.state.user.role === "worker") {
            this.showOnly("view-worker");
            this.renderWorkerView();
        }
    },

    refreshActiveView: function (notify) {
        if (!this.state.user) return;
        this.renderActiveView();
        if (notify) alert("Данные обновлены.");
    },

    renderActiveView: function () {
        if (!this.state.user) return;
        if (this.state.user.role === "citizen") this.renderCitizenView();
        if (this.state.user.role === "admin") this.renderAdminView();
        if (this.state.user.role === "worker") this.renderWorkerView();
    },

    /* ----------------------------------------------------------
       GEOLOCATION & MAP (citizen)
       ---------------------------------------------------------- */
    ensureCitizenMap: function () {
        if (this.state.maps.citizen) return;

        const map = L.map(this.els.citizenMap).setView([50.4111, 80.2274], 12);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: "&copy; OpenStreetMap"
        }).addTo(map);

        map.on("click", (event) => {
            this.setCitizenLocation(event.latlng.lat, event.latlng.lng);
        });

        this.state.maps.citizen = map;
    },

    setCitizenLocation: function (lat, lng) {
        this.els.reqLat.value = lat.toFixed(6);
        this.els.reqLng.value = lng.toFixed(6);

        if (this.state.citizenSelectionMarker) {
            this.state.citizenSelectionMarker.setLatLng([lat, lng]);
        } else {
            this.state.citizenSelectionMarker = L.marker([lat, lng]).addTo(this.state.maps.citizen);
        }

        this.state.maps.citizen.panTo([lat, lng], { animate: true, duration: 0.3 });
    },

    detectGeolocation: function () {
        if (!navigator.geolocation) {
            alert("Геолокация не поддерживается браузером.");
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                this.setCitizenLocation(position.coords.latitude, position.coords.longitude);
            },
            () => {
                alert("Не удалось получить геолокацию. Разрешите доступ в браузере или выберите точку на карте вручную.");
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    },

    /* ----------------------------------------------------------
       CITIZEN: create request
       ---------------------------------------------------------- */
    createRequest: async function () {
        const address = this.els.reqAddress.value.trim();
        const category = this.els.reqCategory.value;
        const description = this.els.reqDescription.value.trim();
        const lat = Number(this.els.reqLat.value);
        const lng = Number(this.els.reqLng.value);
        const file = this.els.reqPhoto.files[0];

        if (!address || !description) {
            alert("Заполните адрес и описание.");
            return;
        }

        if (!file) {
            alert("Фото проблемы обязательно.");
            return;
        }

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            alert("Укажите геолокацию: кнопка определения или клик на карте.");
            return;
        }

        try {
            const photoUrl = await this.compressAndEncode(file);
            const priority = category === "roads" || category === "water" ? "high" : "normal";

            const payload = {
                id: Date.now(),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                iin: this.state.user.iin,
                author: this.state.user.name,
                address,
                category,
                description,
                latitude: lat,
                longitude: lng,
                photo_problem_url: photoUrl,
                status: "new",
                priority,
                admin_comment: "",
                worker_comment: "",
                citizen_feedback: "",
                citizen_acceptance: "pending",
                assigned_contractor: "",
                started_at: "",
                completed_at: "",
                worker_before_url: "",
                worker_after_url: "",
                work_minutes: 0
            };

            await this.pushRequest(payload);

            this.els.citizenForm.reset();
            this.els.reqLat.value = "";
            this.els.reqLng.value = "";
            if (this.state.citizenSelectionMarker) {
                this.state.maps.citizen.removeLayer(this.state.citizenSelectionMarker);
                this.state.citizenSelectionMarker = null;
            }

            alert("Заявка зарегистрирована и отправлена в систему.");
        } catch (error) {
            console.error(error);
            alert("Не удалось создать заявку: " + error.message);
        }
    },

    /* ----------------------------------------------------------
       CITIZEN: view
       ---------------------------------------------------------- */
    renderCitizenView: function () {
        this.state.citizenRows = this.state.allRows.filter((r) => r.iin === this.state.user.iin);

        const points = this.state.citizenRows.filter((r) => r.status === "done").length * 10;
        this.els.citizenPoints.textContent = `Баллы активности: ${points} (по 10 за каждую подтвержденную заявку).`;

        if (!this.state.citizenRows.length) {
            this.els.citizenList.innerHTML = "<div class='alert'>Пока нет заявок.</div>";
            return;
        }

        this.els.citizenList.innerHTML = this.state.citizenRows.map((row) => this.renderCitizenCard(row)).join("");
    },

    renderCitizenCard: function (row) {
        const canAccept = row.status === "completed_pending_acceptance";

        return `
            <article class="request">
                <div class="request-head">
                    <div>
                        <h4 class="request-title">#${row.id} — ${this.escapeHtml(CATEGORY_LABELS[row.category] || row.category)}</h4>
                        <p class="request-meta">${this.escapeHtml(row.address)}</p>
                        <p class="request-meta">Создано: ${this.formatDate(row.created_at)}</p>
                    </div>
                    <span class="status status-${row.status}">${this.escapeHtml(STATUS_LABELS[row.status] || row.status)}</span>
                </div>

                ${this.renderTrack(row.status)}

                <p>${this.escapeHtml(row.description)}</p>

                <div class="request-photos">
                    ${this.renderPhotoFigure(row.photo_problem_url, "Фото проблемы")}
                    ${row.worker_before_url ? this.renderPhotoFigure(row.worker_before_url, "До работ") : ""}
                    ${row.worker_after_url ? this.renderPhotoFigure(row.worker_after_url, "После работ") : ""}
                </div>

                ${row.admin_comment ? `<div class="alert"><b>Комментарий администрации:</b> ${this.escapeHtml(row.admin_comment)}</div>` : ""}
                ${row.worker_comment ? `<div class="alert"><b>Комментарий подрядчика:</b> ${this.escapeHtml(row.worker_comment)}</div>` : ""}

                ${canAccept ? `
                    <div class="actions">
                        <div class="field">
                            <label for="citizen-feedback-${row.id}">Комментарий для приемки/доработки</label>
                            <textarea id="citizen-feedback-${row.id}" placeholder="Что подтвердить или что нужно исправить"></textarea>
                        </div>
                        <div class="inline">
                            <button class="btn btn-primary" data-action="citizen-accept" data-id="${row.id}" type="button">Подтвердить выполнение</button>
                            <button class="btn btn-danger" data-action="citizen-rework" data-id="${row.id}" type="button">Отправить на доработку</button>
                        </div>
                    </div>
                ` : ""}
            </article>
        `;
    },

    handleCitizenAction: async function (event) {
        const button = event.target.closest("button[data-action]");
        if (!button) return;

        const id = Number(button.dataset.id);
        const action = button.dataset.action;
        const feedbackElement = document.getElementById(`citizen-feedback-${id}`);
        const feedback = feedbackElement ? feedbackElement.value.trim() : "";

        if (action === "citizen-accept") {
            await this.patchRequest(id, {
                status: "done",
                citizen_acceptance: "accepted",
                citizen_feedback: feedback,
                updated_at: new Date().toISOString()
            });
            return;
        }

        if (action === "citizen-rework") {
            if (!feedback) {
                alert("Добавьте комментарий, что именно нужно доработать.");
                return;
            }

            await this.patchRequest(id, {
                status: "rework",
                citizen_acceptance: "rework",
                citizen_feedback: feedback,
                updated_at: new Date().toISOString()
            });
        }
    },

    /* ----------------------------------------------------------
       ADMIN: view
       ---------------------------------------------------------- */
    renderAdminView: function () {
        this.state.adminRows = this.state.allRows;
        this.renderAdminStats(this.state.adminRows);
        this.renderAdminRanking(this.state.adminRows);
        this.renderAdminFeed(this.state.adminRows);
        this.renderMap("admin", this.els.adminMap, this.state.adminRows);
    },

    renderAdminStats: function (rows) {
        const total = rows.length;
        const open = rows.filter((row) => !["done", "rejected"].includes(row.status)).length;

        const resolved = rows.filter((row) => row.status === "done" && row.completed_at);
        const avgHours = resolved.length
            ? resolved.reduce((sum, row) => sum + this.hoursBetween(row.created_at, row.completed_at), 0) / resolved.length
            : 0;

        const now = Date.now();
        const slaBreaches = rows.filter((row) => {
            if (["done", "rejected"].includes(row.status)) return false;
            const ageHours = (now - new Date(row.created_at).getTime()) / 3600000;
            return ageHours > APP_CONFIG.SLA_HOURS;
        }).length;

        this.els.statTotal.textContent = String(total);
        this.els.statOpen.textContent = String(open);
        this.els.statAvg.textContent = resolved.length ? `${avgHours.toFixed(1)} ч` : "—";
        this.els.statSla.textContent = String(slaBreaches);
    },

    renderAdminRanking: function (rows) {
        const doneRows = rows.filter((row) => row.status === "done" && row.assigned_contractor);
        if (!doneRows.length) {
            this.els.adminRanking.innerHTML = "<li><span>Пока нет завершенных заявок для рейтинга.</span></li>";
        } else {
            const grouped = {};
            doneRows.forEach((row) => {
                if (!grouped[row.assigned_contractor]) {
                    grouped[row.assigned_contractor] = { count: 0, hours: 0, workMinutes: 0 };
                }
                grouped[row.assigned_contractor].count += 1;
                grouped[row.assigned_contractor].hours += this.hoursBetween(row.created_at, row.completed_at || row.updated_at);
                grouped[row.assigned_contractor].workMinutes += Number(row.work_minutes || 0);
            });

            const items = Object.entries(grouped)
                .map(([name, value]) => {
                    const avgClose = value.hours / value.count;
                    const avgWork = value.workMinutes / Math.max(value.count, 1);
                    const score = (100 - avgClose * 2 + value.count * 4).toFixed(1);
                    return { name, avgClose, avgWork, score, count: value.count };
                })
                .sort((a, b) => Number(b.score) - Number(a.score));

            this.els.adminRanking.innerHTML = items.slice(0, 6).map((item, index) => `
                <li>
                    <span>${index + 1}. ${this.escapeHtml(item.name)} — ${item.count} заявок</span>
                    <span>Score ${item.score}, avg ${item.avgClose.toFixed(1)}ч, work ${item.avgWork.toFixed(0)} мин</span>
                </li>
            `).join("");
        }

        if (!rows.length) {
            this.els.adminHotspot.textContent = "Горячие точки появятся после поступления заявок.";
            return;
        }

        const categoryCounts = rows.reduce((acc, row) => {
            acc[row.category] = (acc[row.category] || 0) + 1;
            return acc;
        }, {});

        const top = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0];
        if (top) {
            this.els.adminHotspot.textContent = `Самая частая категория: ${CATEGORY_LABELS[top[0]] || top[0]} (${top[1]} шт.).`;
        }
    },

    renderAdminFeed: function (rows) {
        if (!rows.length) {
            this.els.adminFeed.innerHTML = "<div class='alert'>Заявок пока нет.</div>";
            return;
        }

        const contractorOptions = Object.values(APP_CONFIG.WORKER_DIRECTORY)
            .map((name) => `<option value="${this.escapeHtml(name)}">${this.escapeHtml(name)}</option>`)
            .join("");

        this.els.adminFeed.innerHTML = rows.map((row) => {
            const canDispatch = ["new", "rework", "assigned"].includes(row.status);
            const slaHours = this.hoursBetween(row.created_at, new Date().toISOString());
            const isLate = !["done", "rejected"].includes(row.status) && slaHours > APP_CONFIG.SLA_HOURS;

            return `
                <article class="request">
                    <div class="request-head">
                        <div>
                            <h4 class="request-title">#${row.id} — ${this.escapeHtml(CATEGORY_LABELS[row.category] || row.category)}</h4>
                            <p class="request-meta">${this.escapeHtml(row.author)} (${this.escapeHtml(row.iin)})</p>
                            <p class="request-meta">${this.escapeHtml(row.address)} | ${this.formatDate(row.created_at)}</p>
                        </div>
                        <span class="status status-${row.status}">${this.escapeHtml(STATUS_LABELS[row.status] || row.status)}</span>
                    </div>

                    ${this.renderTrack(row.status)}

                    <p>${this.escapeHtml(row.description)}</p>
                    <p class="request-meta">Приоритет: <b>${this.escapeHtml(row.priority || "normal")}</b>${row.assigned_contractor ? ` | Подрядчик: <b>${this.escapeHtml(row.assigned_contractor)}</b>` : ""}</p>
                    ${isLate ? `<div class="alert" style="background:#ffe9e9; border-color:#f4c5c5; color:#7f2f2f;">SLA просрочка: ${slaHours.toFixed(1)} ч с момента регистрации.</div>` : ""}

                    <div class="request-photos">
                        ${this.renderPhotoFigure(row.photo_problem_url, "Фото проблемы")}
                        ${row.worker_before_url ? this.renderPhotoFigure(row.worker_before_url, "До") : ""}
                        ${row.worker_after_url ? this.renderPhotoFigure(row.worker_after_url, "После") : ""}
                    </div>

                    ${row.citizen_feedback ? `<div class="alert"><b>Фидбек жителя:</b> ${this.escapeHtml(row.citizen_feedback)}</div>` : ""}
                    ${row.worker_comment ? `<div class="alert"><b>Комментарий подрядчика:</b> ${this.escapeHtml(row.worker_comment)}</div>` : ""}

                    ${canDispatch ? `
                        <div class="actions">
                            <div class="grid cols-3">
                                <div class="field">
                                    <label for="admin-contractor-${row.id}">Подрядчик</label>
                                    <select id="admin-contractor-${row.id}">
                                        <option value="">Выберите подрядчика</option>
                                        ${contractorOptions}
                                    </select>
                                </div>
                                <div class="field">
                                    <label for="admin-priority-${row.id}">Приоритет</label>
                                    <select id="admin-priority-${row.id}">
                                        <option value="low" ${row.priority === "low" ? "selected" : ""}>low</option>
                                        <option value="normal" ${row.priority === "normal" ? "selected" : ""}>normal</option>
                                        <option value="high" ${row.priority === "high" ? "selected" : ""}>high</option>
                                    </select>
                                </div>
                                <div class="field">
                                    <label for="admin-comment-${row.id}">Комментарий</label>
                                    <textarea id="admin-comment-${row.id}" placeholder="Решение диспетчера">${this.escapeHtml(row.admin_comment || "")}</textarea>
                                </div>
                            </div>
                            <div class="inline">
                                <button class="btn btn-primary" data-action="admin-assign" data-id="${row.id}" type="button">Назначить в работу</button>
                                <button class="btn btn-danger" data-action="admin-reject" data-id="${row.id}" type="button">Отклонить</button>
                            </div>
                        </div>
                    ` : ""}
                </article>
            `;
        }).join("");

        // Pre-select assigned contractors in dropdowns
        rows.forEach((row) => {
            const select = document.getElementById(`admin-contractor-${row.id}`);
            if (select && row.assigned_contractor) {
                select.value = row.assigned_contractor;
            }
        });
    },

    handleAdminAction: async function (event) {
        const button = event.target.closest("button[data-action]");
        if (!button) return;

        const id = Number(button.dataset.id);
        const action = button.dataset.action;

        const contractorElement = document.getElementById(`admin-contractor-${id}`);
        const priorityElement = document.getElementById(`admin-priority-${id}`);
        const commentElement = document.getElementById(`admin-comment-${id}`);

        const contractor = contractorElement ? contractorElement.value : "";
        const priority = priorityElement ? priorityElement.value : "normal";
        const comment = commentElement ? commentElement.value.trim() : "";

        if (action === "admin-assign") {
            if (!contractor) {
                alert("Выберите подрядчика.");
                return;
            }

            await this.patchRequest(id, {
                status: "assigned",
                assigned_contractor: contractor,
                priority,
                admin_comment: comment,
                citizen_acceptance: "pending",
                updated_at: new Date().toISOString()
            });
            return;
        }

        if (action === "admin-reject") {
            if (!comment) {
                alert("Добавьте комментарий причины отказа.");
                return;
            }

            await this.patchRequest(id, {
                status: "rejected",
                admin_comment: comment,
                updated_at: new Date().toISOString()
            });
        }
    },

    /* ----------------------------------------------------------
       WORKER: view
       ---------------------------------------------------------- */
    renderWorkerView: function () {
        const contractor = this.state.user.contractor;
        const relevant = this.state.allRows.filter((r) =>
            r.assigned_contractor === contractor &&
            ["assigned", "in_progress", "completed_pending_acceptance", "rework"].includes(r.status)
        );

        const priorityOrder = { high: 0, normal: 1, low: 2 };
        this.state.workerRows = relevant.sort((a, b) => {
            const p = (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9);
            if (p !== 0) return p;
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });

        this.renderWorkerStats(this.state.workerRows);
        this.renderWorkerFeed(this.state.workerRows);
        this.renderMap("worker", this.els.workerMap, this.state.workerRows);
    },

    renderWorkerStats: function (rows) {
        this.els.workerTotal.textContent = String(rows.length);
        this.els.workerActive.textContent = String(rows.filter((row) => row.status === "in_progress").length);
        this.els.workerCheck.textContent = String(rows.filter((row) => row.status === "completed_pending_acceptance").length);
        this.els.workerRework.textContent = String(rows.filter((row) => row.status === "rework").length);
    },

    renderWorkerFeed: function (rows) {
        if (!rows.length) {
            this.els.workerFeed.innerHTML = "<div class='alert'>Нет активных задач у вашей бригады.</div>";
            return;
        }

        this.els.workerFeed.innerHTML = rows.map((row) => {
            const canStart = row.status === "assigned" || row.status === "rework";
            const canComplete = row.status === "in_progress";

            return `
                <article class="request">
                    <div class="request-head">
                        <div>
                            <h4 class="request-title">Наряд #${row.id}</h4>
                            <p class="request-meta">${this.escapeHtml(CATEGORY_LABELS[row.category] || row.category)} | ${this.escapeHtml(row.address)}</p>
                            <p class="request-meta">Приоритет: <b>${this.escapeHtml(row.priority || "normal")}</b></p>
                        </div>
                        <span class="status status-${row.status}">${this.escapeHtml(STATUS_LABELS[row.status] || row.status)}</span>
                    </div>

                    <p>${this.escapeHtml(row.description)}</p>

                    <div class="request-photos">
                        ${this.renderPhotoFigure(row.photo_problem_url, "Проблема")}
                        ${row.worker_before_url ? this.renderPhotoFigure(row.worker_before_url, "Фото до") : ""}
                        ${row.worker_after_url ? this.renderPhotoFigure(row.worker_after_url, "Фото после") : ""}
                    </div>

                    ${canStart ? `
                        <div class="actions">
                            <button class="btn btn-primary" data-action="worker-start" data-id="${row.id}" type="button">Начать выполнение</button>
                        </div>
                    ` : ""}

                    ${canComplete ? `
                        <div class="actions">
                            <div class="grid cols-3">
                                <div class="field">
                                    <label for="worker-before-${row.id}">Фото До ${row.worker_before_url ? "(можно пропустить)" : "(обязательно)"}</label>
                                    <input id="worker-before-${row.id}" type="file" accept="image/*">
                                </div>
                                <div class="field">
                                    <label for="worker-after-${row.id}">Фото После (обязательно)</label>
                                    <input id="worker-after-${row.id}" type="file" accept="image/*">
                                </div>
                                <div class="field">
                                    <label for="worker-minutes-${row.id}">Время на объекте (мин.)</label>
                                    <input id="worker-minutes-${row.id}" type="number" min="1" value="${row.work_minutes || ""}" placeholder="Например: 75">
                                </div>
                            </div>
                            <div class="field">
                                <label for="worker-comment-${row.id}">Комментарий подрядчика</label>
                                <textarea id="worker-comment-${row.id}" placeholder="Что сделано на объекте">${this.escapeHtml(row.worker_comment || "")}</textarea>
                            </div>
                            <button class="btn btn-primary" data-action="worker-complete" data-id="${row.id}" type="button">Отправить на приемку жителю</button>
                        </div>
                    ` : ""}

                    ${row.status === "completed_pending_acceptance" ? "<div class='alert'>Ожидание решения жителя: подтвердить или отправить на доработку.</div>" : ""}
                </article>
            `;
        }).join("");
    },

    handleWorkerAction: async function (event) {
        const button = event.target.closest("button[data-action]");
        if (!button) return;

        const id = Number(button.dataset.id);
        const action = button.dataset.action;
        const row = this.state.workerRows.find((item) => item.id === id);
        if (!row) return;

        if (action === "worker-start") {
            await this.patchRequest(id, {
                status: "in_progress",
                started_at: row.started_at || new Date().toISOString(),
                updated_at: new Date().toISOString()
            });
            return;
        }

        if (action === "worker-complete") {
            const beforeInput = document.getElementById(`worker-before-${id}`);
            const afterInput = document.getElementById(`worker-after-${id}`);
            const minutesInput = document.getElementById(`worker-minutes-${id}`);
            const commentInput = document.getElementById(`worker-comment-${id}`);

            const beforeFile = beforeInput && beforeInput.files ? beforeInput.files[0] : null;
            const afterFile = afterInput && afterInput.files ? afterInput.files[0] : null;
            const minutes = Number(minutesInput ? minutesInput.value : 0);
            const comment = commentInput ? commentInput.value.trim() : "";

            if (!row.worker_before_url && !beforeFile) {
                alert("Добавьте фото До.");
                return;
            }

            if (!afterFile) {
                alert("Добавьте фото После.");
                return;
            }

            if (!Number.isFinite(minutes) || minutes <= 0) {
                alert("Введите корректное время выполнения в минутах.");
                return;
            }

            try {
                let beforeUrl = row.worker_before_url;
                if (beforeFile) {
                    beforeUrl = await this.compressAndEncode(beforeFile);
                }

                const afterUrl = await this.compressAndEncode(afterFile);

                await this.patchRequest(id, {
                    status: "completed_pending_acceptance",
                    worker_before_url: beforeUrl,
                    worker_after_url: afterUrl,
                    work_minutes: minutes,
                    worker_comment: comment,
                    completed_at: new Date().toISOString(),
                    citizen_acceptance: "pending",
                    updated_at: new Date().toISOString()
                });

                alert("Отчет отправлен. Заявка ожидает приемку жителем.");
            } catch (error) {
                console.error(error);
                alert("Не удалось отправить отчет: " + error.message);
            }
        }
    },

    /* ----------------------------------------------------------
       MAP RENDERING
       ---------------------------------------------------------- */
    renderMap: function (mapKey, container, rows) {
        if (!container) return;

        if (this.state.maps[mapKey]) {
            this.state.maps[mapKey].remove();
            delete this.state.maps[mapKey];
        }

        const map = L.map(container).setView([50.4111, 80.2274], 12);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: "&copy; OpenStreetMap"
        }).addTo(map);

        const markers = [];
        rows.forEach((row) => {
            const lat = Number(row.latitude);
            const lng = Number(row.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

            const color = STATUS_COLOR[row.status] || "#466892";
            const icon = L.divIcon({
                className: "city-pin",
                html: `<span style="background:${color}"></span>`,
                iconSize: [16, 16],
                iconAnchor: [8, 8]
            });

            const marker = L.marker([lat, lng], { icon }).addTo(map);
            marker.bindPopup(`
                <b>#${row.id}</b><br>
                ${this.escapeHtml(CATEGORY_LABELS[row.category] || row.category)}<br>
                ${this.escapeHtml(row.address)}<br>
                Статус: ${this.escapeHtml(STATUS_LABELS[row.status] || row.status)}
            `);

            markers.push(marker);
        });

        if (markers.length) {
            const bounds = L.featureGroup(markers).getBounds();
            map.fitBounds(bounds.pad(0.22));
        }

        this.state.maps[mapKey] = map;
    },

    /* ----------------------------------------------------------
       STATUS TRACK BAR
       ---------------------------------------------------------- */
    renderTrack: function (status) {
        const steps = [
            { key: "new", label: "Принято" },
            { key: "assigned", label: "Назначен" },
            { key: "in_progress", label: "В работе" },
            { key: "completed_pending_acceptance", label: "Проверка" },
            { key: "done", label: "Закрыто" }
        ];

        let activeIndex = 0;
        if (status === "assigned") activeIndex = 1;
        if (status === "in_progress" || status === "rework") activeIndex = 2;
        if (status === "completed_pending_acceptance") activeIndex = 3;
        if (status === "done") activeIndex = 4;
        if (status === "rejected") activeIndex = 0;

        return `
            <div class="track">
                ${steps.map((step, index) => {
                    const classes = ["track-step"];
                    if (index < activeIndex) classes.push("done");
                    if (index === activeIndex) classes.push("active");
                    if (status === "done" && index === activeIndex) classes.push("done");
                    return `<div class="${classes.join(" ")}">${step.label}</div>`;
                }).join("")}
            </div>
        `;
    },

    /* ----------------------------------------------------------
       PHOTO RENDERING & COMPRESSION
       ---------------------------------------------------------- */
    renderPhotoFigure: function (url, caption) {
        if (!url) return "";
        return `
            <figure>
                <img src="${this.escapeHtml(url)}" alt="${this.escapeHtml(caption)}" loading="lazy">
                <figcaption>${this.escapeHtml(caption)}</figcaption>
            </figure>
        `;
    },

    /** Compress image and return base64 data URL */
    compressAndEncode: function (file) {
        return new Promise((resolve, reject) => {
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            const img = new Image();

            img.onload = () => {
                const MAX_WIDTH = 800;
                let w = img.width, h = img.height;
                if (w > MAX_WIDTH) {
                    h = Math.round(h * MAX_WIDTH / w);
                    w = MAX_WIDTH;
                }
                canvas.width = w;
                canvas.height = h;
                ctx.drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL("image/jpeg", 0.6));
            };

            img.onerror = () => reject(new Error("Не удалось загрузить изображение"));
            img.src = URL.createObjectURL(file);
        });
    },

    /* ----------------------------------------------------------
       UTILITY
       ---------------------------------------------------------- */
    formatDate: function (value) {
        if (!value) return "—";
        const date = new Date(value);
        return date.toLocaleString("ru-RU", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
        });
    },

    hoursBetween: function (from, to) {
        const start = new Date(from).getTime();
        const end = new Date(to).getTime();
        if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
        return Math.max(0, (end - start) / 3600000);
    },

    escapeHtml: function (value) {
        const stringValue = String(value || "");
        return stringValue
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
};

window.addEventListener("DOMContentLoaded", () => App.init());

