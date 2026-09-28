const express = require("express");
const session = require("express-session");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;

const vehiclesFile = path.join(__dirname, "data", "vehicles.json");
const bookingsFile = path.join(__dirname, "data", "bookings.json");

function readJSON(file) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return [];
    }
}

function writeJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function generateId() {
    return Date.now().toString();
}

app.set("view engine", "ejs");

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(express.static(path.join(__dirname, "public")));

app.use(
    session({
        secret: "royal-arctic-secret",
        resave: false,
        saveUninitialized: false
    })
);

app.use((req, res, next) => {
    res.locals.admin = req.session.admin || false;
    next();
});

/* =========================
   HOME
========================= */

app.get("/", (req, res) => {
    const vehicles = readJSON(vehiclesFile);

    res.render("home/index", {
        vehicles: vehicles.slice(0, 6)
    });
});

/* =========================
   VEHICLES
========================= */

app.get("/vehicles", (req, res) => {
    let vehicles = readJSON(vehiclesFile);

    const search = req.query.search || "";
    const category = req.query.category || "";

    if (search) {
        vehicles = vehicles.filter(v =>
            v.name.toLowerCase().includes(search.toLowerCase())
        );
    }

    if (category) {
        vehicles = vehicles.filter(v => v.category === category);
    }

    res.render("vehicles/index", {
        vehicles,
        search,
        category
    });
});

/* =========================
   VEHICLE DETAILS
========================= */

app.get("/vehicles/:id", (req, res) => {
    const vehicles = readJSON(vehiclesFile);

    const vehicle = vehicles.find(v => v.id === req.params.id);

    if (!vehicle) {
        return res.status(404).send("Vehicle not found");
    }

    res.render("vehicles/details", {
        vehicle
    });
});

/* =========================
   BOOKING PAGE
========================= */

app.get("/book/:id", (req, res) => {
    const vehicles = readJSON(vehiclesFile);

    const vehicle = vehicles.find(v => v.id === req.params.id);

    if (!vehicle) {
        return res.status(404).send("Vehicle not found");
    }

    res.render("booking/index", {
        vehicle
    });
});

/* =========================
   CREATE BOOKING
========================= */

app.post("/book", (req, res) => {
    const vehicles = readJSON(vehiclesFile);
    const bookings = readJSON(bookingsFile);

    const vehicle = vehicles.find(v => v.id === req.body.vehicleId);

    if (!vehicle) {
        return res.status(404).send("Vehicle not found");
    }

    const start = new Date(req.body.pickupDate);
    const end = new Date(req.body.dropoffDate);

    const difference = end - start;

    const days = Math.max(
        1,
        Math.ceil(difference / (1000 * 60 * 60 * 24))
    );

    const total = days * Number(vehicle.price);

    const booking = {
        id: generateId(),
        vehicleId: vehicle.id,
        vehicleName: vehicle.name,

        customerName: req.body.name,
        customerEmail: req.body.email,
        customerPhone: req.body.phone,

        pickupDate: req.body.pickupDate,
        dropoffDate: req.body.dropoffDate,

        location: req.body.location,

        days,
        total,

        status: "Pending",

        createdAt: new Date().toISOString()
    };

    bookings.push(booking);

    writeJSON(bookingsFile, bookings);

    res.render("booking/success", {
        booking
    });
});

/* =========================
   MY BOOKING
========================= */

app.get("/my-booking", (req, res) => {
    const bookings = readJSON(bookingsFile);

    res.render("booking/my-booking", {
        bookings
    });
});

/* =========================
   ABOUT
========================= */

app.get("/about", (req, res) => {
    res.render("home/about");
});

/* =========================
   CONTACT
========================= */

app.get("/contact", (req, res) => {
    res.render("home/contact");
});

/* =========================
   ADMIN LOGIN
========================= */

app.get("/admin/login", (req, res) => {
    res.render("admin/login", {
        error: null
    });
});

app.post("/admin/login", (req, res) => {

    const email = req.body.email;
    const password = req.body.password;

    /*
      CHANGE THESE LATER
    */

    if (
        email === "admin@royalarctic.com" &&
        password === "admin123"
    ) {
        req.session.admin = true;

        return res.redirect("/admin");
    }

    res.render("admin/login", {
        error: "Invalid email or password"
    });
});

/* =========================
   ADMIN AUTH
========================= */

function adminOnly(req, res, next) {

    if (!req.session.admin) {
        return res.redirect("/admin/login");
    }

    next();
}

/* =========================
   ADMIN DASHBOARD
========================= */

app.get("/admin", adminOnly, (req, res) => {

    const vehicles = readJSON(vehiclesFile);
    const bookings = readJSON(bookingsFile);

    const revenue = bookings.reduce(
        (sum, booking) => sum + Number(booking.total),
        0
    );

    res.render("admin/dashboard", {
        vehicles,
        bookings,
        revenue
    });
});

/* =========================
   ADMIN VEHICLES
========================= */

app.get("/admin/vehicles", adminOnly, (req, res) => {

    const vehicles = readJSON(vehiclesFile);

    res.render("admin/vehicles", {
        vehicles
    });
});

/* =========================
   ADD VEHICLE
========================= */

app.post("/admin/vehicles/add", adminOnly, (req, res) => {

    const vehicles = readJSON(vehiclesFile);

    const vehicle = {
        id: generateId(),

        name: req.body.name,
        category: req.body.category,
        price: Number(req.body.price),

        location: req.body.location,

        transmission: req.body.transmission,
        fuel: req.body.fuel,
        seats: Number(req.body.seats),

        image: req.body.image,

        description: req.body.description,

        available: true
    };

    vehicles.push(vehicle);

    writeJSON(vehiclesFile, vehicles);

    res.redirect("/admin/vehicles");
});

/* =========================
   DELETE VEHICLE
========================= */

app.post("/admin/vehicles/delete/:id", adminOnly, (req, res) => {

    let vehicles = readJSON(vehiclesFile);

    vehicles = vehicles.filter(
        vehicle => vehicle.id !== req.params.id
    );

    writeJSON(vehiclesFile, vehicles);

    res.redirect("/admin/vehicles");
});

/* =========================
   BOOKINGS
========================= */

app.get("/admin/bookings", adminOnly, (req, res) => {

    const bookings = readJSON(bookingsFile);

    res.render("admin/bookings", {
        bookings
    });
});

/* =========================
   UPDATE BOOKING STATUS
========================= */

app.post("/admin/bookings/status/:id", adminOnly, (req, res) => {

    const bookings = readJSON(bookingsFile);

    const booking = bookings.find(
        b => b.id === req.params.id
    );

    if (booking) {
        booking.status = req.body.status;
    }

    writeJSON(bookingsFile, bookings);

    res.redirect("/admin/bookings");
});

/* =========================
   ADMIN LOGOUT
========================= */

app.get("/admin/logout", (req, res) => {

    req.session.destroy(() => {
        res.redirect("/");
    });
});

/* =========================
   START SERVER
========================= */

app.listen(PORT, (const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
) => {

    console.log("");
    console.log("================================");
    console.log("ROYAL ARCTIC RENTAL");
    console.log("================================");
    console.log(`Website: http://localhost:${PORT}`);
    console.log(`Admin:   http://localhost:${PORT}/admin/login`);
    console.log("================================");
    console.log("");
});
