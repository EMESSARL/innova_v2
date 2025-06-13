// Middlewares pour vérifier la validité d'un token JWT et le rôle de
// l'utilisateur.

const jwt = require("jsonwebtoken");
const axios = require("axios");
require("dotenv").config();

const AUTH_API_URL = process.env.AUTH_API_URL;

// Middleware de base pour vérifier le token JWT
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1]; // "Bearer <token>"
  if (!token) {
    return res.status(401).json({ error: "Authentification requise" });
  }
  next();
};

// Middleware pour vérifier les rôles via l'API d'authentification
const requireRole = (allowedRoles) => {
  return async (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
      return res.status(401).json({ error: "Authentification requise" });
    }

    try {
      const response = await axios.post(
        AUTH_API_URL,
        {
          requiredRoles: allowedRoles,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (response.data.isAuthorized) {
        req.user = {
          id: response.data.decodedToken.sub,
          roles: response.data.decodedToken.realm_access.roles,
          name: response.data.decodedToken.name,
          email: response.data.decodedToken.email,
          preferred_username: response.data.decodedToken.preferred_username,
        };
        next();
      } else {
        return res
          .status(403)
          .json({ error: "Accès refusé : rôle insuffisant" });
      }
    } catch (error) {
      if (error.response) {
        if (error.response.data.message === "jwt expired") {
          return res.status(401).json({ error: "Token expiré" });
        }
        return res.status(403).json({ error: "Token invalide" });
      }
      return res
        .status(500)
        .json({ error: "Erreur lors de la vérification des rôles" });
    }
  };
};

module.exports = { authMiddleware, requireRole };
