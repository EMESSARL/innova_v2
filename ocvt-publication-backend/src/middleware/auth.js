// Middlewares pour vérifier la validité d'un token JWT et le rôle de
// l'utilisateur.

const jwt = require("jsonwebtoken");
require("dotenv").config();

// Middleware de base pour vérifier le token JWT
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1]; // "Bearer <token>"
  if (!token) {
    return res.status(401).json({ error: "Authentification requise" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: decoded.user_id, role: decoded.role };
    next();
  } catch (error) {
    return res.status(403).json({ error: "Token invalide ou expiré" });
  }
};

// Middleware pour vérifier les rôles
const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    // S'assurer que authMiddleware a été exécuté avant
    if (!req.user || !req.user.role) {
      return res
        .status(403)
        .json({ error: "Rôle non défini ou authentification manquante" });
    }

    const userRole = req.user.role;
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({ error: "Accès refusé : rôle insuffisant" });
    }

    next();
  };
};

module.exports = { authMiddleware, requireRole };
