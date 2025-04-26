const jwt = require("jsonwebtoken");
require("dotenv").config();

const user = {
  user_id: "user123", // Simule un ID d'utilisateur
  role: "point_focal", // Simule un rôle d'utilisateur
};

const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: "24h" });
console.log("Token JWT généré :", token);
