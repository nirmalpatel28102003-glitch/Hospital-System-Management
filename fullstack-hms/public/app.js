const state = {
  patients: [],
  appointments: [],
  doctors: [],
  billing: [],
  pharmacy: [],
  summary: {}
};

const titles = {
  dashboard: "Clinical Command Center",
  patients: "Patient Management",
  appointments: "Appointment Scheduler",
  doctors: "Doctor Management",
  billing: "Billing Desk",
  pharmacy: "Pharmacy Inventory"
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function statusClass(status) {
  const key = String(status).toLowerCase();
  if (key.includes("critical") || key.includes("pending") || key.includes("low")) return "red";
  if (key.includes("stable") || key.includes("paid") || key.includes("available") || key.includes("ok")) return "green";
  if (key.includes("review") || key.includes("waiting") || key.includes("insurance") || key.includes("rounds")) return "amber";
  if (key.includes("checked") || key.includes("confirmed") || key.includes("consulting")) return "blue";
  return "teal";
}

function initials(name) {
  return String(name).split(" ").map(part => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

function patientRow(patient) {
  return `
    <tr>
      <td>
        <div class="patient-cell">
          <span class="avatar">${initials(patient.name)}</span>
          <div class="meta"><strong>${patient.name}</strong><span>${patient.age} years</span></div>
        </div>
      </td>
      <td>${patient.ward}</td>
      <td>${patient.doctor}</td>
      <td>${patient.diagnosis}</td>
      <td><span class="pill ${statusClass(patient.status)}">${patient.status}</span></td>
      <td><button class="mini-btn" data-chart="${patient.id}">Chart</button></td>
    </tr>
  `;
}

function filteredPatients() {
  const search = document.getElementById("patientSearch").value.toLowerCase();
  const ward = document.getElementById("wardFilter").value;
  const status = document.getElementById("statusFilter").value;

  return state.patients.filter(patient => {
    const text = `${patient.name} ${patient.doctor} ${patient.diagnosis}`.toLowerCase();
    const wardMatch = ward === "all" || patient.ward === ward;
    const statusMatch = status === "all" || patient.status === status;
    return text.includes(search) && wardMatch && statusMatch;
  });
}

function renderSummary() {
  const summary = state.summary;
  document.getElementById("queueCount").textContent = summary.queue || 0;
  document.getElementById("availableDoctors").textContent = summary.availableDoctors || 0;
  document.getElementById("openBills").textContent = summary.openBills || 0;
  document.getElementById("metricPatients").textContent = summary.admittedPatients || 0;
  document.getElementById("metricAppointments").textContent = summary.todaysAppointments || 0;
  document.getElementById("metricLowStock").textContent = summary.lowStock || 0;
  document.getElementById("metricRevenue").textContent = money.format(summary.revenue || 0);
  document.getElementById("bedPercent").textContent = `${summary.bedOccupancy || 76}%`;
  document.getElementById("bedBar").style.width = `${summary.bedOccupancy || 76}%`;
}

function renderPatients() {
  const rows = filteredPatients();
  const allRows = state.patients.map(patientRow).join("");
  document.getElementById("patientRows").innerHTML = rows.map(patientRow).join("");
  document.getElementById("patientRowsMirror").innerHTML = allRows;
  document.getElementById("patientCountLabel").textContent = `${rows.length} records`;
  document.getElementById("patientModuleCount").textContent = `${state.patients.length} total`;
  document.querySelectorAll("[data-chart]").forEach(button => {
    button.addEventListener("click", () => showToast("Patient chart opened in preview mode."));
  });
}

function renderTriage() {
  const urgent = state.patients.filter(patient => patient.status !== "Stable").slice(0, 4);
  document.getElementById("triageList").innerHTML = urgent.map(patient => `
    <div class="list-item">
      <span class="avatar">${initials(patient.name)}</span>
      <div class="meta"><strong>${patient.name}</strong><span>${patient.ward} - ${patient.diagnosis}</span></div>
      <span class="pill ${statusClass(patient.status)}">${patient.status}</span>
    </div>
  `).join("") || `<div class="list-item"><span class="avatar">OK</span><div class="meta"><strong>No priority cases</strong><span>All patients are stable</span></div></div>`;
}

function renderAppointments() {
  const markup = state.appointments.map(item => `
    <div class="list-item">
      <span class="time">${item.time}</span>
      <div class="meta"><strong>${item.patient}</strong><span>${item.department} - ${item.doctor}</span></div>
      <span class="pill ${statusClass(item.status)}">${item.status}</span>
    </div>
  `).join("");
  document.getElementById("appointmentList").innerHTML = markup;
  document.getElementById("appointmentListFull").innerHTML = markup;
}

function renderDoctors() {
  document.getElementById("doctorList").innerHTML = state.doctors.map(doctor => `
    <div class="list-item">
      <span class="avatar">${initials(doctor.name.replace("Dr. ", ""))}</span>
      <div class="meta"><strong>${doctor.name}</strong><span>${doctor.specialty} - ${doctor.room}</span></div>
      <span class="pill ${statusClass(doctor.status)}">${doctor.status}</span>
    </div>
  `).join("");
}

function renderBilling() {
  document.getElementById("billingRows").innerHTML = state.billing.map(bill => `
    <tr>
      <td>${bill.invoice}</td>
      <td>${bill.patient}</td>
      <td>${bill.service}</td>
      <td>${money.format(bill.amount)}</td>
      <td><span class="pill ${statusClass(bill.status)}">${bill.status}</span></td>
      <td><button class="mini-btn" data-pay="${bill.id}" ${bill.status === "Paid" ? "disabled" : ""}>Process</button></td>
    </tr>
  `).join("");
  document.querySelectorAll("[data-pay]").forEach(button => {
    button.addEventListener("click", async () => {
      try {
        await api(`/api/billing/${button.dataset.pay}/pay`, { method: "PATCH" });
        await loadData();
        showToast("Invoice marked as paid.");
      } catch (error) {
        showToast(error.message);
      }
    });
  });
}

function renderPharmacy() {
  document.getElementById("pharmacyRows").innerHTML = state.pharmacy.map(item => {
    const low = item.stock < item.reorder;
    return `
      <tr>
        <td>${item.name}</td>
        <td>${item.category}</td>
        <td>${item.stock}</td>
        <td>${item.reorder}</td>
        <td><span class="pill ${low ? "red" : "green"}">${low ? "Low stock" : "OK"}</span></td>
        <td><button class="mini-btn" data-order="${item.id}">Order</button></td>
      </tr>
    `;
  }).join("");
  document.querySelectorAll("[data-order]").forEach(button => {
    button.addEventListener("click", async () => {
      try {
        await api(`/api/pharmacy/${button.dataset.order}/order`, { method: "POST" });
        await loadData();
        showToast("Stock reordered and updated.");
      } catch (error) {
        showToast(error.message);
      }
    });
  });
}

function renderAll() {
  renderSummary();
  renderPatients();
  renderTriage();
  renderAppointments();
  renderDoctors();
  renderBilling();
  renderPharmacy();
}

async function loadData() {
  const data = await api("/api/data");
  Object.assign(state, data);
  renderAll();
}

document.querySelectorAll(".nav button").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".nav button").forEach(item => item.classList.remove("active"));
    document.querySelectorAll(".module").forEach(item => item.classList.remove("active"));
    button.classList.add("active");
    document.getElementById(button.dataset.module).classList.add("active");
    document.getElementById("moduleTitle").textContent = titles[button.dataset.module];
  });
});

["patientSearch", "wardFilter", "statusFilter"].forEach(id => {
  document.getElementById(id).addEventListener("input", renderPatients);
});

const modal = document.getElementById("patientModal");
function openModal() {
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  modal.querySelector("input").focus();
}
function closeModal() {
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}
document.getElementById("openPatientModal").addEventListener("click", openModal);
document.getElementById("closePatientModal").addEventListener("click", closeModal);
modal.addEventListener("click", event => {
  if (event.target === modal) closeModal();
});

document.getElementById("patientForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form).entries());
  try {
    const patient = await api("/api/patients", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    form.reset();
    closeModal();
    await loadData();
    showToast(`${patient.name} saved to the backend.`);
  } catch (error) {
    showToast(error.message);
  }
});

document.getElementById("appointmentForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form).entries());
  try {
    const appointment = await api("/api/appointments", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    form.reset();
    await loadData();
    showToast(`${appointment.patient} booked for ${appointment.time}.`);
  } catch (error) {
    showToast(error.message);
  }
});

document.getElementById("emergencyBtn").addEventListener("click", async () => {
  try {
    await api("/api/emergency", { method: "POST" });
    showToast("Emergency logged on the server.");
  } catch (error) {
    showToast(error.message);
  }
});

document.getElementById("todayLabel").textContent = new Date().toLocaleDateString(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric"
});

loadData().catch(error => showToast(error.message));
