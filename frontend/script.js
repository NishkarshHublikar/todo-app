const API =
  window.__ENV__ &&
  typeof window.__ENV__.API_URL === "string"
    ? window.__ENV__.API_URL.trim()
    : "http://localhost:3001";
const RAZORPAY_KEY = window.ENV_RAZORPAY_KEY || "rzp_test_REPLACE_ME";

function getToken() { return localStorage.getItem("token"); }
function setToken(token) { localStorage.setItem("token", token); }
function clearToken() { localStorage.removeItem("token"); }

function authHeader(useTemp = false) {
  const token = useTemp ? sessionStorage.getItem("mfaTempToken") : getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch(path, opts = {}) {
  const { headers = {}, useTemp = false, body, ...rest } = opts;
  const payload = body && typeof body !== "string" ? JSON.stringify(body) : body;
  const url = API ? `${API}${path}` : path;

  let res;
  try {
    res = await fetch(url, {
      ...rest,
      headers: { "Content-Type": "application/json", ...authHeader(useTemp), ...headers },
      body: payload,
    });
  } catch (networkError) {
    throw { status: 0, message: "Network error. Check that the backend is running and CORS is configured correctly.", data: networkError.message || networkError };
  }

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text };
  }

  if (!res.ok) {
    throw { status: res.status, message: data.error || data.message || "Request failed", data };
  }
  return data;
}

function setAuthError(msg) {
  document.getElementById("authError").textContent = msg;
}

function clearAuthViews() {
  document.getElementById("loginForm").style.display = "none";
  document.getElementById("registerForm").style.display = "none";
  document.getElementById("forgotForm").style.display = "none";
  document.getElementById("mfaChallenge").style.display = "none";
}

function switchTab(tab) {
  clearAuthViews();
  document.getElementById(tab === "login" ? "loginForm" : "registerForm").style.display = "flex";
  document.querySelectorAll(".tab").forEach((button, index) => {
    button.classList.toggle("active", tab === "login" ? index === 0 : index === 1);
  });
  setAuthError("");
}

function updateAuthControls(payload = null) {
  const tokenPayload = payload || parseJwt(getToken());
  const mfaStatus = document.getElementById("mfaStatus");
  const toggleButton = document.getElementById("toggleMfaBtn");
  const premiumBadge = document.getElementById("premiumBadge");
  const upgradeBtn = document.getElementById("upgradeBtn");

  const isPremium = tokenPayload?.is_premium;
  const mfaEnabled = tokenPayload?.mfa_enabled;

  if (mfaStatus) {
    mfaStatus.textContent = "MFA enabled";
    mfaStatus.className = "badge badge-gold";
  }

  if (toggleButton) {
    toggleButton.style.display = "none";
  }

  if (premiumBadge) {
    premiumBadge.style.display = isPremium ? "inline-block" : "none";
  }

  if (upgradeBtn) {
    upgradeBtn.style.display = isPremium ? "none" : "inline-flex";
  }
}

function showAuth() {
  document.getElementById("auth").style.display = "flex";
  document.getElementById("app").style.display = "none";
  
  const hero = document.querySelector(".hero-panel");
  if (hero) hero.style.display = "flex";
  document.querySelector(".main").classList.remove("app-active");
  
  clearAuthViews();
  switchTab("login");
  updateAuthControls();
  updateAuthLinks();
}

function updateAuthLinks() {
  const githubLink = document.getElementById("githubLoginLink");
  if (!githubLink) return;
  // Ask OAuth provider to show account chooser flow when possible.
  githubLink.href = `${API || ""}/auth/github?switch_account=1`;
}

function showAppPanel(payload) {
  document.getElementById("auth").style.display = "none";
  document.getElementById("app").style.display = "flex";
  document.getElementById("userEmail").textContent = payload.email;
  
  const hero = document.querySelector(".hero-panel");
  if (hero) hero.style.display = "none";
  document.querySelector(".main").classList.add("app-active");
  
  updateAuthControls(payload);
}

function parseJwt(token) {
  try {
    return JSON.parse(atob(token.split(".")[1]));
  } catch {
    return null;
  }
}

async function signUp() {
  const email = document.getElementById("regEmail").value.trim();
  const password = document.getElementById("regPassword").value;
  setAuthError("");
  try {
    const res = await apiFetch("/auth/register", {
      method: "POST",
      body: { email, password },
    });
    
    if (res.mfa_required) {
      sessionStorage.setItem("mfaTempToken", res.tempToken);
      showMfaChallenge();
      setAuthError(res.message || "Please enter the code sent to your email.");
      return;
    }

    setToken(res.token);
    initApp();
  } catch (err) {
    setAuthError(err.message);
  }
}

function showForgotPassword() {
  clearAuthViews();
  document.getElementById("forgotForm").style.display = "flex";
  document.querySelectorAll(".tab").forEach(button => button.classList.remove("active"));
  setAuthError("");
}

async function forgotPassword() {
  const email = document.getElementById("forgotEmail").value.trim();
  if (!email) return setAuthError("Email required");
  setAuthError("");
  try {
    await apiFetch("/auth/forgot-password", {
      method: "POST",
      body: { email },
    });
    setAuthError("Reset link sent! Check server logs for the link.");
  } catch (err) {
    setAuthError(err.message);
  }
}

async function resetPassword() {
  const newPassword = document.getElementById("resetPassword").value;
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get("token");
  if (!token) return alert("No reset token found in URL");
  if (!newPassword || newPassword.length < 6) return alert("Password must be at least 6 characters");

  try {
    await apiFetch("/auth/reset-password", {
      method: "POST",
      body: { token, newPassword },
    });
    alert("Password reset successful! Please login with your new password.");
    closeModal("resetModal");
    window.location.href = "/";
  } catch (err) {
    alert(err.message);
  }
}

window.addEventListener("load", () => {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has("token")) {
    document.getElementById("resetModal").style.display = "flex";
  }
});

async function signIn() {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  setAuthError("");
  try {
    const res = await apiFetch("/auth/login", {
      method: "POST",
      body: { email, password },
    });

    if (res.mfa_required) {
      sessionStorage.setItem("mfaTempToken", res.tempToken);
      clearAuthViews();
      document.getElementById("mfaChallenge").style.display = "flex";
      setAuthError(res.message || "Enter your MFA code.");
      return;
    }

    setToken(res.token);
    sessionStorage.removeItem("mfaTempToken");
    initApp();
  } catch (err) {
    setAuthError(err.message);
  }
}

function logout() {
  clearToken();
  sessionStorage.removeItem("mfaTempToken");
  location.reload();
}

function showMfaChallenge() {
  clearAuthViews();
  document.getElementById("mfaChallenge").style.display = "flex";
  setAuthError("");
}

function cancelMfa() {
  sessionStorage.removeItem("mfaTempToken");
  showAuth();
  setAuthError("MFA sign in canceled.");
}

async function verifyMfa() {
  const code = document.getElementById("mfaCode").value.trim();
  if (!code) return setAuthError("Enter the 6-digit code.");

  try {
    const { token } = await apiFetch("/auth/mfa/verify", {
      method: "POST",
      useTemp: true,
      body: { code },
    });
    sessionStorage.removeItem("mfaTempToken");
    setToken(token);
    initApp();
  } catch (err) {
    setAuthError(err.message);
  }
}


async function initApp() {
  updateAuthLinks();

  const params = new URLSearchParams(window.location.search);
  if (params.has("token")) {
    setToken(params.get("token"));
    window.history.replaceState({}, "", "/");
  }

  const token = getToken();
  if (!token) {
    showAuth();
    return;
  }

  const payload = parseJwt(token);
  if (!payload || payload.exp * 1000 < Date.now()) {
    clearToken();
    showAuth();
    return;
  }

  showAppPanel(payload);
  fetchTasks(payload.is_premium);
}

async function fetchTasks(isPremium) {
  try {
    const tasks = await apiFetch("/todos");
    renderTasks(tasks);
    document.getElementById("freeLimit").style.display = isPremium ? "none" : "flex";
  } catch (err) {
    if (err.status === 401) { clearToken(); location.reload(); }
    console.error(err);
  }
}

async function addTask() {
  const input = document.getElementById("taskInput");
  if (!input.value.trim()) return;

  try {
    await apiFetch("/todos", {
      method: "POST",
      body: { task: input.value },
    });
    input.value = "";
    const payload = parseJwt(getToken());
    fetchTasks(payload?.is_premium);
  } catch (err) {
    if (err.data?.upgrade_required) {
      openUpgrade();
    } else {
      alert(err.message);
    }
  }
}

async function toggleTask(id, completed) {
  try {
    await apiFetch(`/todos/${id}`, {
      method: "PUT",
      body: { completed: !completed },
    });
    const payload = parseJwt(getToken());
    fetchTasks(payload?.is_premium);
  } catch (err) {
    console.error(err);
  }
}

async function editTask(id, oldText) {
  console.log("Edit task clicked:", id, oldText);
  const newText = prompt("Edit task:", oldText);
  if (!newText || !newText.trim()) return;
  try {
    await apiFetch(`/todos/${id}`, {
      method: "PUT",
      body: { task: newText },
    });
    const payload = parseJwt(getToken());
    fetchTasks(payload?.is_premium);
  } catch (err) {
    console.error("Edit task error:", err);
  }
}

async function deleteTask(id) {
  console.log("Delete task clicked:", id);
  if (!confirm("Delete this task?")) return;
  try {
    await apiFetch(`/todos/${id}`, { method: "DELETE" });
    const payload = parseJwt(getToken());
    fetchTasks(payload?.is_premium);
  } catch (err) {
    console.error("Delete task error:", err);
  }
}

function renderTasks(tasks) {
  const activeList = document.getElementById("activeTasks");
  const completedList = document.getElementById("completedTasks");
  const activeBadge = document.getElementById("activeBadge");
  const completedBadge = document.getElementById("completedBadge");

  const activeTasks = tasks.filter(task => !task.completed);
  const completedTasks = tasks.filter(task => task.completed);

  activeList.innerHTML = activeTasks.length ? "" : "<li class='empty-state'>No active tasks — add one to get started.</li>";
  completedList.innerHTML = completedTasks.length ? "" : "<li class='empty-state'>No completed tasks yet — finish a task to move it here.</li>";

  activeTasks.forEach(task => activeList.appendChild(createTaskItem(task)));
  completedTasks.forEach(task => completedList.appendChild(createTaskItem(task)));

  activeBadge.textContent = activeTasks.length;
  completedBadge.textContent = completedTasks.length;
  document.getElementById("activeCount").textContent = activeTasks.length;
  document.getElementById("completeCount").textContent = completedTasks.length;
}

function createTaskItem(task) {
  const li = document.createElement("li");
  li.className = task.completed ? "task-item done" : "task-item";

  const check = document.createElement("button");
  check.type = "button";
  check.className = `todo-check${task.completed ? " done" : ""}`;
  check.title = task.completed ? "Mark incomplete" : "Mark complete";
  check.onclick = () => toggleTask(task.id, task.completed);

  const content = document.createElement("div");
  content.className = "task-content";

  const title = document.createElement("span");
  title.textContent = task.task;
  if (task.completed) title.className = "done-text";

  const meta = document.createElement("small");
  meta.className = "todo-meta";
  meta.textContent = `Added ${formatDate(task.created_at)}${task.updated_at ? " · Edited " + formatDate(task.updated_at) : ""}`;

  content.append(title, meta);

  const actions = document.createElement("div");
  actions.className = "task-actions";

  const editBtn = document.createElement("button");
  editBtn.className = "btn-edit";
  editBtn.textContent = "Edit";
  editBtn.onclick = () => editTask(task.id, task.task);

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "btn-delete";
  deleteBtn.textContent = "Delete";
  deleteBtn.onclick = () => deleteTask(task.id);

  actions.append(editBtn, deleteBtn);
  li.append(check, content, actions);
  return li;
}

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function openUpgrade() {
  document.getElementById("upgradeModal").style.display = "flex";
}
function closeUpgrade() {
  document.getElementById("upgradeModal").style.display = "none";
}

async function startPayment() {
  try {
    const order = await apiFetch("/payment/create-order", { method: "POST" });

    if (!window.Razorpay) {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://checkout.razorpay.com/v1/checkout.js";
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }

    const payload = parseJwt(getToken());
    const rzp = new window.Razorpay({
      key: order.key_id,
      amount: order.amount,
      currency: order.currency,
      order_id: order.order_id,
      name: "TodoApp Premium",
      description: "Unlimited todos — one-time payment",
      prefill: { email: payload?.email || "" },
      theme: { color: "#6366f1" },
      handler: async response => {
        try {
          const result = await apiFetch("/payment/verify", {
            method: "POST",
            body: {
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            },
          });
          setToken(result.token);
          closeUpgrade();
          alert("🎉 Welcome to Premium!");
          initApp();
        } catch (err) {
          alert("Payment verification failed: " + err.message);
        }
      },
    });
    rzp.open();
  } catch (err) {
    if (err.message === "Already a premium user") {
      closeUpgrade();
      return;
    }
    alert("Could not initiate payment: " + err.message);
  }
}

async function mockVerify() {
  try {
    const result = await apiFetch("/payment/mock-verify", { method: "POST" });
    setToken(result.token);
    closeUpgrade();
    alert("🎉 Premium activated via MOCK!");
    initApp();
  } catch (err) {
    alert("Mock verification failed: " + err.message);
  }
}

function closeModal(id) {
  document.getElementById(id).style.display = "none";
}

function openChangePassword() {
  document.getElementById("chgPassError").textContent = "";
  document.getElementById("chgCurrentPass").value = "";
  document.getElementById("chgNewPass").value = "";
  document.getElementById("passwordModal").style.display = "flex";
}
function closeChangePassword() {
  document.getElementById("passwordModal").style.display = "none";
}

async function submitPasswordChange() {
  const currentPassword = document.getElementById("chgCurrentPass").value;
  const newPassword = document.getElementById("chgNewPass").value;
  const errEl = document.getElementById("chgPassError");
  errEl.textContent = "";
  errEl.style.color = "#ef4444";

  if (!currentPassword || !newPassword) {
    errEl.textContent = "Please fill in all fields.";
    return;
  }

  try {
    await apiFetch("/auth/change-password", {
      method: "POST",
      body: { currentPassword, newPassword },
    });
    errEl.style.color = "#10b981";
    errEl.textContent = "Password updated successfully! 🎉";
    setTimeout(closeChangePassword, 1500);
  } catch (err) {
    errEl.textContent = err.message;
  }
}

initApp();
