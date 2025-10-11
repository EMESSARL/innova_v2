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
const requireRole = (allowedPrivileges) => {
  return async (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
      return res.status(401).json({ error: "Authentification requise" });
    }

    try {
      // Normalise en liste plate de rôles (OR) : si au moins un rôle correspond, on autorise
      const requiredPrivileges = Array.isArray(allowedPrivileges)
        ? allowedPrivileges
        : typeof allowedPrivileges === "string" &&
          allowedPrivileges.trim() !== ""
        ? [allowedPrivileges]
        : [];

      // Valide le token et récupère le payload via l'API d'auth
      const response = await axios.post(
        AUTH_API_URL,
        {
          // On peut transmettre un rôle quelconque si l'API exige ce champ,
          // mais on effectue la décision d'autorisation localement (OR) ci-dessous.
          requiredPrivileges:
            requiredPrivileges.length > 0 ? [requiredPrivileges[0]] : [],
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const decoded = response?.data?.decodedToken || {};
      const userRoles =
        decoded?.resource_access["ocvt-dataset"].roles.concat(
          decoded?.resource_access["ocvt-dashboard"].roles
        ) || [];
      // console.log(userRoles);

      // OR logique: autorise si intersection non vide
      const isAuthorizedLocally =
        requiredPrivileges.length === 0
          ? true
          : requiredPrivileges.some((role) => userRoles.includes(role));

      if (!isAuthorizedLocally) {
        return res
          .status(403)
          .json({ error: "Accès refusé : rôle insuffisant" });
      }

      req.user = {
        id: decoded.sub,
        roles: userRoles,
        name: decoded.name,
        email: decoded.email,
        preferred_username: decoded.preferred_username,
      };
      next();
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
