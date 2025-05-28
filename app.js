const express = require("express");
const cors = require("cors");
const prisma = require("./prisma.js");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Pizza routes
// TODO

// Order routes
// TODO

// IAM routes (auth, register, etc.)
// TODO

module.exports = app;