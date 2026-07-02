const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT = process.env.PORT || 5000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DB_PATH = path.join(ROOT, "data", "db.json");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

function readDb() {
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function send(res, status, data, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type });
  if (Buffer.isBuffer(data) || typeof data === "string") {
    res.end(data);
  } else {
    res.end(JSON.stringify(data));
  }
}

function notFound(res) {
  send(res, 404, { error: "Not found" });
}

function badRequest(res, message) {
  send(res, 400, { error: message });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body is too large"));
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function nextId(records) {
  return records.reduce((max, record) => Math.max(max, Number(record.id) || 0), 0) + 1;
}

function requireFields(payload, fields) {
  const missing = fields.filter(field => payload[field] === undefined || payload[field] === "");
  return missing.length ? `Missing required field(s): ${missing.join(", ")}` : "";
}

function summary(db) {
  const criticalPatients = db.patients.filter(patient => patient.status === "Critical").length;
  const openBills = db.billing.filter(bill => bill.status !== "Paid").length;
  const availableDoctors = db.doctors.filter(doctor => doctor.status === "Available").length;
  const lowStock = db.pharmacy.filter(item => item.stock < item.reorder).length;
  const revenue = db.billing
    .filter(bill => bill.status === "Paid")
    .reduce((total, bill) => total + Number(bill.amount || 0), 0);

  return {
    admittedPatients: db.patients.length,
    todaysAppointments: db.appointments.length,
    criticalPatients,
    availableDoctors,
    openBills,
    lowStock,
    revenue,
    queue: 12 + db.patients.filter(patient => patient.status !== "Stable").length,
    bedOccupancy: 76
  };
}

async function handleApi(req, res, pathname) {
  const db = readDb();
  const method = req.method;

  if (method === "GET" && pathname === "/api/summary") {
    return send(res, 200, summary(db));
  }

  if (method === "GET" && pathname === "/api/data") {
    return send(res, 200, { ...db, summary: summary(db) });
  }

  if (method === "GET" && pathname === "/api/patients") return send(res, 200, db.patients);
  if (method === "GET" && pathname === "/api/appointments") return send(res, 200, db.appointments);
  if (method === "GET" && pathname === "/api/doctors") return send(res, 200, db.doctors);
  if (method === "GET" && pathname === "/api/billing") return send(res, 200, db.billing);
  if (method === "GET" && pathname === "/api/pharmacy") return send(res, 200, db.pharmacy);

  if (method === "POST" && pathname === "/api/patients") {
    const payload = await readBody(req);
    const missing = requireFields(payload, ["name", "age", "ward", "doctor", "diagnosis", "status"]);
    if (missing) return badRequest(res, missing);

    const patient = {
      id: nextId(db.patients),
      name: String(payload.name).trim(),
      age: Number(payload.age),
      ward: String(payload.ward).trim(),
      doctor: String(payload.doctor).trim(),
      diagnosis: String(payload.diagnosis).trim(),
      status: String(payload.status).trim(),
      notes: String(payload.notes || "").trim()
    };

    if (!Number.isFinite(patient.age) || patient.age < 0 || patient.age > 120) {
      return badRequest(res, "Age must be a number from 0 to 120");
    }

    db.patients.unshift(patient);
    writeDb(db);
    return send(res, 201, patient);
  }

  if (method === "POST" && pathname === "/api/appointments") {
    const payload = await readBody(req);
    const missing = requireFields(payload, ["patient", "department", "time"]);
    if (missing) return badRequest(res, missing);

    const doctor = db.doctors.find(item => item.specialty.includes(payload.department));
    const appointment = {
      id: nextId(db.appointments),
      time: String(payload.time).trim(),
      patient: String(payload.patient).trim(),
      department: String(payload.department).trim(),
      doctor: doctor ? doctor.name : "Dr. R. Sharma",
      status: "Confirmed"
    };

    db.appointments.push(appointment);
    db.appointments.sort((a, b) => a.time.localeCompare(b.time));
    writeDb(db);
    return send(res, 201, appointment);
  }

  const billingPayMatch = pathname.match(/^\/api\/billing\/(\d+)\/pay$/);
  if (method === "PATCH" && billingPayMatch) {
    const bill = db.billing.find(item => item.id === Number(billingPayMatch[1]));
    if (!bill) return notFound(res);
    bill.status = "Paid";
    writeDb(db);
    return send(res, 200, bill);
  }

  const pharmacyOrderMatch = pathname.match(/^\/api\/pharmacy\/(\d+)\/order$/);
  if (method === "POST" && pharmacyOrderMatch) {
    const item = db.pharmacy.find(record => record.id === Number(pharmacyOrderMatch[1]));
    if (!item) return notFound(res);
    item.stock += item.reorder;
    writeDb(db);
    return send(res, 200, item);
  }

  if (method === "POST" && pathname === "/api/emergency") {
    const emergency = {
      id: nextId(db.emergencies),
      message: "Code Blue activated",
      createdAt: new Date().toISOString()
    };
    db.emergencies.unshift(emergency);
    writeDb(db);
    return send(res, 201, emergency);
  }

  return notFound(res);
}

function serveStatic(res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return send(res, 403, "Forbidden", "text/plain; charset=utf-8");
  }

  fs.readFile(filePath, (error, content) => {
    if (error) return notFound(res);
    const ext = path.extname(filePath);
    send(res, 200, content, contentTypes[ext] || "application/octet-stream");
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url);
  const pathname = parsed.pathname;

  try {
    if (pathname.startsWith("/api/")) {
      await handleApi(req, res, pathname);
    } else {
      serveStatic(res, pathname);
    }
  } catch (error) {
    send(res, 500, { error: error.message || "Server error" });
  }
});

server.listen(PORT, () => {
  console.log(`Hospital Management System running at http://127.0.0.1:${PORT}`);
});
