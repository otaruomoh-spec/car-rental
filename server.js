const express = require("express");
const session = require("express-session");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = 3000;

const DATA_FILE = path.join(__dirname, "data", "data.json");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: "royal-arctic-rental-secret-change-this",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24
    }
  })
);

app.use(express.static(path.join(__dirname, "public")));

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (error) {
    return {
      users: [],
      vehicles: [],
      bookings: [],
      messages: []
    };
  }
}

function saveData(data) {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(data, null, 2)
  );
}

function createId(prefix) {
  return (
    prefix +
    "-" +
    Date.now().toString(36) +
    "-" +
    crypto.randomBytes(4).toString("hex")
  );
}

function hashPassword(password) {
  return crypto
    .createHash("sha256")
    .update(password)
    .digest("hex");
}

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({
      error: "Please login first"
    });
  }

  next();
}

function requireAdmin(req, res, next) {
  if (
    !req.session.user ||
    req.session.user.role !== "admin"
  ) {
    return res.status(403).json({
      error: "Admin access required"
    });
  }

  next();
}

function dateRangesOverlap(
  start1,
  end1,
  start2,
  end2
) {
  return (
    new Date(start1) < new Date(end2) &&
    new Date(start2) < new Date(end1)
  );
}

/* =========================
   AUTH
========================= */

app.post("/api/register", (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({
      error: "All fields are required"
    });
  }

  const data = loadData();

  const existing = data.users.find(
    user =>
      user.email.toLowerCase() ===
      email.toLowerCase()
  );

  if (existing) {
    return res.status(400).json({
      error: "Email already registered"
    });
  }

  const user = {
    id: createId("user"),
    name,
    email: email.toLowerCase(),
    password: hashPassword(password),
    role: "customer",
    createdAt: new Date().toISOString()
  };

  data.users.push(user);
  saveData(data);

  req.session.user = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role
  };

  res.json({
    success: true,
    user: req.session.user
  });
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body;

  const data = loadData();

  const user = data.users.find(
    u =>
      u.email === email.toLowerCase() &&
      u.password === hashPassword(password)
  );

  if (!user) {
    return res.status(401).json({
      error: "Invalid email or password"
    });
  }

  req.session.user = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role
  };

  res.json({
    success: true,
    user: req.session.user
  });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({
      success: true
    });
  });
});

app.get("/api/me", (req, res) => {
  res.json({
    user: req.session.user || null
  });
});

/* =========================
   VEHICLES
========================= */

app.get("/api/vehicles", (req, res) => {
  const data = loadData();

  let vehicles = data.vehicles;

  const {
    search,
    category,
    transmission,
    fuel
  } = req.query;

  if (search) {
    const term = search.toLowerCase();

    vehicles = vehicles.filter(vehicle =>
      (
        vehicle.name +
        " " +
        vehicle.category +
        " " +
        vehicle.location
      )
        .toLowerCase()
        .includes(term)
    );
  }

  if (category && category !== "All") {
    vehicles = vehicles.filter(
      vehicle => vehicle.category === category
    );
  }

  if (transmission && transmission !== "All") {
    vehicles = vehicles.filter(
      vehicle =>
        vehicle.transmission === transmission
    );
  }

  if (fuel && fuel !== "All") {
    vehicles = vehicles.filter(
      vehicle => vehicle.fuel === fuel
    );
  }

  res.json(vehicles);
});

app.get("/api/vehicles/:id", (req, res) => {
  const data = loadData();

  const vehicle = data.vehicles.find(
    v => v.id === req.params.id
  );

  if (!vehicle) {
    return res.status(404).json({
      error: "Vehicle not found"
    });
  }

  res.json(vehicle);
});

/* =========================
   BOOKINGS
========================= */

app.post("/api/bookings", requireLogin, (req, res) => {
  const {
    vehicleId,
    pickupDate,
    dropoffDate,
    location,
    notes
  } = req.body;

  if (
    !vehicleId ||
    !pickupDate ||
    !dropoffDate ||
    !location
  ) {
    return res.status(400).json({
      error: "Complete booking information is required"
    });
  }

  const start = new Date(pickupDate);
  const end = new Date(dropoffDate);

  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime())
  ) {
    return res.status(400).json({
      error: "Invalid dates"
    });
  }

  if (end <= start) {
    return res.status(400).json({
      error: "Drop-off must be after pick-up"
    });
  }

  const data = loadData();

  const vehicle = data.vehicles.find(
    v => v.id === vehicleId
  );

  if (!vehicle) {
    return res.status(404).json({
      error: "Vehicle not found"
    });
  }

  const conflictingBooking =
    data.bookings.find(booking => {
      if (
        booking.vehicleId !== vehicleId ||
        booking.status === "cancelled"
      ) {
        return false;
      }

      return dateRangesOverlap(
        pickupDate,
        dropoffDate,
        booking.pickupDate,
        booking.dropoffDate
      );
    });

  if (conflictingBooking) {
    return res.status(409).json({
      error:
        "This vehicle is already booked for those dates."
    });
  }

  const millisecondsPerDay =
    1000 * 60 * 60 * 24;

  const days = Math.max(
    1,
    Math.ceil(
      (end - start) /
        millisecondsPerDay
    )
  );

  const total = days * vehicle.price;

  const booking = {
    id: createId("booking"),
    userId: req.session.user.id,
    customerName: req.session.user.name,
    customerEmail: req.session.user.email,
    vehicleId: vehicle.id,
    vehicleName: vehicle.name,
    pickupDate,
    dropoffDate,
    location,
    days,
    pricePerDay: vehicle.price,
    total,
    notes: notes || "",
    status: "pending",
    paymentStatus: "unpaid",
    createdAt: new Date().toISOString()
  };

  data.bookings.push(booking);

  saveData(data);

  res.json({
    success: true,
    booking
  });
});

app.get(
  "/api/my-bookings",
  requireLogin,
  (req, res) => {
    const data = loadData();

    const bookings = data.bookings.filter(
      booking =>
        booking.userId === req.session.user.id
    );

    res.json(bookings);
  }
);

app.post(
  "/api/bookings/:id/cancel",
  requireLogin,
  (req, res) => {
    const data = loadData();

    const booking = data.bookings.find(
      b =>
        b.id === req.params.id &&
        b.userId === req.session.user.id
    );

    if (!booking) {
      return res.status(404).json({
        error: "Booking not found"
      });
    }

    booking.status = "cancelled";

    saveData(data);

    res.json({
      success: true
    });
  }
);

/* =========================
   CONTACT
========================= */

app.post("/api/contact", (req, res) => {
  const {
    name,
    email,
    message
  } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({
      error: "Please complete all fields"
    });
  }

  const data = loadData();

  data.messages.push({
    id: createId("msg"),
    name,
    email,
    message,
    createdAt: new Date().toISOString()
  });

  saveData(data);

  res.json({
    success: true
  });
});

/* =========================
   ADMIN
========================= */

app.post("/api/admin/vehicles", requireAdmin, (req, res) => {
  const data = loadData();

  const vehicle = {
    id: createId("car"),
    name: req.body.name,
    category: req.body.category || "Premium",
    location: req.body.location || "Reykjavik",
    price: Number(req.body.price) || 0,
    transmission:
      req.body.transmission || "Automatic",
    fuel: req.body.fuel || "Petrol",
    seats: Number(req.body.seats) || 5,
    trunk: req.body.trunk || "450 L",
    rating: 5,
    reviews: 0,
    description:
      req.body.description || "",
    features: req.body.features
      ? req.body.features
          .split(",")
          .map(x => x.trim())
      : [],
    images: req.body.image
      ? [req.body.image]
      : [],
    available: true
  };

  data.vehicles.push(vehicle);

  saveData(data);

  res.json({
    success: true,
    vehicle
  });
});

app.put(
  "/api/admin/vehicles/:id",
  requireAdmin,
  (req, res) => {
    const data = loadData();

    const vehicle = data.vehicles.find(
      v => v.id === req.params.id
    );

    if (!vehicle) {
      return res.status(404).json({
        error: "Vehicle not found"
      });
    }

    Object.assign(vehicle, {
      ...req.body,
      price:
        req.body.price !== undefined
          ? Number(req.body.price)
          : vehicle.price,
      seats:
        req.body.seats !== undefined
          ? Number(req.body.seats)
          : vehicle.seats
    });

    saveData(data);

    res.json({
      success: true,
      vehicle
    });
  }
);

app.delete(
  "/api/admin/vehicles/:id",
  requireAdmin,
  (req, res) => {
    const data = loadData();

    data.vehicles =
      data.vehicles.filter(
        v => v.id !== req.params.id
      );

    saveData(data);

    res.json({
      success: true
    });
  }
);

app.get(
  "/api/admin/bookings",
  requireAdmin,
  (req, res) => {
    const data = loadData();

    res.json(data.bookings);
  }
);

app.put(
  "/api/admin/bookings/:id",
  requireAdmin,
  (req, res) => {
    const data = loadData();

    const booking = data.bookings.find(
      b => b.id === req.params.id
    );

    if (!booking) {
      return res.status(404).json({
        error: "Booking not found"
      });
    }

    if (req.body.status) {
      booking.status = req.body.status;
    }

    if (req.body.paymentStatus) {
      booking.paymentStatus =
        req.body.paymentStatus;
    }

    saveData(data);

    res.json({
      success: true,
      booking
    });
  }
);

/* =========================
   CREATE DEFAULT ADMIN
========================= */

function createAdmin() {
  const data = loadData();

  const exists = data.users.find(
    user =>
      user.email === "admin@royalarctic.com"
  );

  if (!exists) {
    data.users.push({
      id: createId("admin"),
      name: "Royal Arctic Admin",
      email: "admin@royalarctic.com",
      password: hashPassword("Admin123!"),
      role: "admin",
      createdAt: new Date().toISOString()
    });

    saveData(data);

    console.log(
      "Default admin created:"
    );

    console.log(
      "Email: admin@royalarctic.com"
    );

    console.log(
      "Password: Admin123!"
    );
  }
}

createAdmin();

app.get("*", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

app.listen(PORT, () => {
  console.log("");
  console.log("==============================");
  console.log(" ROYAL ARCTIC RENTAL");
  console.log("==============================");
  console.log(
    `Website: http://localhost:${PORT}`
  );
  console.log("==============================");
});