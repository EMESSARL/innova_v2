const express = require("express");
const router = express.Router();
const { check, validationResult } = require("express-validator");
const { authMiddleware, requireRole } = require("../middleware/auth");
const domainService = require("../services/domainService");

// Middleware pour extraire l'ID utilisateur depuis le token JWT
const extractUserId = (req, res, next) => {
  req.user = { id: "user123" }; // other_user_002
  try {
    // Supposons que l'ID utilisateur est stocké dans req.user.id après l'authentification
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: "Utilisateur non authentifié",
      });
    }
    req.userId = req.user.id;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: "Token invalide",
    });
  }
};

// Validation des erreurs
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: "Données invalides",
      details: errors.array(),
    });
  }
  next();
};

// ========================================
// ROUTES POUR LES DOMAINES
// ========================================

// POST /domains - Créer un nouveau domaine
router.post(
  "/",
  // authMiddleware,
  // requireRole(["admin"]),
  extractUserId,
  [
    check("name")
      .trim()
      .isLength({ min: 1, max: 255 })
      .withMessage(
        "Le nom du domaine est obligatoire et doit faire entre 1 et 255 caractères"
      ),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await domainService.createDomain(req.body);
      res.status(201).json(result);
    } catch (error) {
      console.error("Erreur lors de la création du domaine:", error);

      if (error.name === "SequelizeUniqueConstraintError") {
        return res.status(400).json({
          success: false,
          error: "Un domaine avec ce nom existe déjà",
        });
      }

      res.status(500).json({
        success: false,
        error: "Erreur lors de la création du domaine",
        message: error.message,
      });
    }
  }
);

// GET /domains - Récupérer la liste de tous les domaines
router.get(
  "/",
  // authMiddleware,
  extractUserId,
  async (req, res) => {
    try {
      const result = await domainService.getAllDomains();
      res.json(result);
    } catch (error) {
      console.error("Erreur lors de la récupération des domaines:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération des domaines",
        message: error.message,
      });
    }
  }
);

// GET /domains/:id - Récupérer un domaine par son ID
router.get(
  "/:id",
  // authMiddleware,
  extractUserId,
  [check("id").isInt({ min: 1 }).withMessage("ID de domaine invalide")],
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await domainService.getDomainById(req.params.id);
      res.json(result);
    } catch (error) {
      console.error("Erreur lors de la récupération du domaine:", error);

      if (error.message === "Domaine non trouvé") {
        return res.status(404).json({
          success: false,
          error: "Domaine non trouvé",
        });
      }

      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération du domaine",
        message: error.message,
      });
    }
  }
);

// PUT /domains/:id - Mettre à jour un domaine
router.put(
  "/:id",
  // authMiddleware,
  // requireRole(["admin"]),
  extractUserId,
  [
    check("id").isInt({ min: 1 }).withMessage("ID de domaine invalide"),
    check("name")
      .optional()
      .trim()
      .isLength({ min: 1, max: 255 })
      .withMessage("Le nom du domaine doit faire entre 1 et 255 caractères"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await domainService.updateDomain(req.params.id, req.body);
      res.json(result);
    } catch (error) {
      console.error("Erreur lors de la mise à jour du domaine:", error);

      if (error.message === "Domaine non trouvé") {
        return res.status(404).json({
          success: false,
          error: "Domaine non trouvé",
        });
      }

      if (error.name === "SequelizeUniqueConstraintError") {
        return res.status(400).json({
          success: false,
          error: "Un domaine avec ce nom existe déjà",
        });
      }

      res.status(500).json({
        success: false,
        error: "Erreur lors de la mise à jour du domaine",
        message: error.message,
      });
    }
  }
);

// DELETE /domains/:id - Supprimer un domaine
router.delete(
  "/:id",
  // authMiddleware,
  // requireRole(["admin"]),
  extractUserId,
  [check("id").isInt({ min: 1 }).withMessage("ID de domaine invalide")],
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await domainService.deleteDomain(req.params.id);
      res.json(result);
    } catch (error) {
      console.error("Erreur lors de la suppression du domaine:", error);

      if (error.message === "Domaine non trouvé") {
        return res.status(404).json({
          success: false,
          error: "Domaine non trouvé",
        });
      }

      res.status(500).json({
        success: false,
        error: "Erreur lors de la suppression du domaine",
        message: error.message,
      });
    }
  }
);

// ========================================
// ROUTES POUR LES SOUS-DOMAINES
// ========================================

// POST /subdomains - Créer un nouveau sous-domaine
router.post(
  "/subdomains",
  // authMiddleware,
  // requireRole(["admin"]),
  extractUserId,
  [
    check("name")
      .trim()
      .isLength({ min: 1, max: 255 })
      .withMessage(
        "Le nom du sous-domaine est obligatoire et doit faire entre 1 et 255 caractères"
      ),
    check("domain_id")
      .isInt({ min: 1 })
      .withMessage(
        "L'ID du domaine parent est obligatoire et doit être un entier positif"
      ),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await domainService.createSubDomain(req.body);
      res.status(201).json(result);
    } catch (error) {
      console.error("Erreur lors de la création du sous-domaine:", error);

      if (error.message === "Domaine parent non trouvé") {
        return res.status(400).json({
          success: false,
          error: "Domaine parent non trouvé",
        });
      }

      if (error.name === "SequelizeUniqueConstraintError") {
        return res.status(400).json({
          success: false,
          error: "Un sous-domaine avec ce nom existe déjà dans ce domaine",
        });
      }

      res.status(500).json({
        success: false,
        error: "Erreur lors de la création du sous-domaine",
        message: error.message,
      });
    }
  }
);

// GET /subdomains - Récupérer la liste de tous les sous-domaines
router.get(
  "/subdomains/get",
  // authMiddleware,
  extractUserId,
  async (req, res) => {
    try {
      const result = await domainService.getAllSubDomains();
      res.json(result);
    } catch (error) {
      console.error("Erreur lors de la récupération des sous-domaines:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération des sous-domaines",
        message: error.message,
      });
    }
  }
);

// GET /subdomains/:id - Récupérer un sous-domaine par son ID
router.get(
  "/subdomains/:id",
  // authMiddleware,
  extractUserId,
  [check("id").isInt({ min: 1 }).withMessage("ID de sous-domaine invalide")],
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await domainService.getSubDomainById(req.params.id);
      res.json(result);
    } catch (error) {
      console.error("Erreur lors de la récupération du sous-domaine:", error);

      if (error.message === "Sous-domaine non trouvé") {
        return res.status(404).json({
          success: false,
          error: "Sous-domaine non trouvé",
        });
      }

      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération du sous-domaine",
        message: error.message,
      });
    }
  }
);

// GET /domains/:domainId/subdomains - Récupérer les sous-domaines d'un domaine spécifique
router.get(
  "/:domainId/subdomains",
  // authMiddleware,
  extractUserId,
  [check("domainId").isInt({ min: 1 }).withMessage("ID de domaine invalide")],
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await domainService.getSubDomainsByDomain(
        req.params.domainId
      );
      res.json(result);
    } catch (error) {
      console.error("Erreur lors de la récupération des sous-domaines:", error);

      if (error.message === "Domaine non trouvé") {
        return res.status(404).json({
          success: false,
          error: "Domaine non trouvé",
        });
      }

      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération des sous-domaines",
        message: error.message,
      });
    }
  }
);

// PUT /subdomains/:id - Mettre à jour un sous-domaine
router.put(
  "/subdomains/:id",
  // authMiddleware,
  // requireRole(["admin"]),
  extractUserId,
  [
    check("id").isInt({ min: 1 }).withMessage("ID de sous-domaine invalide"),
    check("name")
      .optional()
      .trim()
      .isLength({ min: 1, max: 255 })
      .withMessage(
        "Le nom du sous-domaine doit faire entre 1 et 255 caractères"
      ),
    check("domain_id")
      .optional()
      .isInt({ min: 1 })
      .withMessage("L'ID du domaine parent doit être un entier positif"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await domainService.updateSubDomain(
        req.params.id,
        req.body
      );
      res.json(result);
    } catch (error) {
      console.error("Erreur lors de la mise à jour du sous-domaine:", error);

      if (error.message === "Sous-domaine non trouvé") {
        return res.status(404).json({
          success: false,
          error: "Sous-domaine non trouvé",
        });
      }

      if (error.message === "Nouveau domaine parent non trouvé") {
        return res.status(400).json({
          success: false,
          error: "Nouveau domaine parent non trouvé",
        });
      }

      if (error.name === "SequelizeUniqueConstraintError") {
        return res.status(400).json({
          success: false,
          error: "Un sous-domaine avec ce nom existe déjà dans ce domaine",
        });
      }

      res.status(500).json({
        success: false,
        error: "Erreur lors de la mise à jour du sous-domaine",
        message: error.message,
      });
    }
  }
);

// DELETE /subdomains/:id - Supprimer un sous-domaine
router.delete(
  "/subdomains/:id",
  // authMiddleware,
  // requireRole(["admin"]),
  extractUserId,
  [check("id").isInt({ min: 1 }).withMessage("ID de sous-domaine invalide")],
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await domainService.deleteSubDomain(req.params.id);
      res.json(result);
    } catch (error) {
      console.error("Erreur lors de la suppression du sous-domaine:", error);

      if (error.message === "Sous-domaine non trouvé") {
        return res.status(404).json({
          success: false,
          error: "Sous-domaine non trouvé",
        });
      }

      res.status(500).json({
        success: false,
        error: "Erreur lors de la suppression du sous-domaine",
        message: error.message,
      });
    }
  }
);

module.exports = router;
