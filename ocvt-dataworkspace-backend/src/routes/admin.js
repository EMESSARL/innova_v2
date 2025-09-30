const express = require("express");
const router = express.Router();
const { check, validationResult } = require("express-validator");
const { authMiddleware, requireRole } = require("../middleware/auth");
const dashboardService = require("../services/dashboardService");
const adminService = require("../services/adminService");

// Middleware pour extraire l'ID utilisateur depuis le token JWT
const extractUserId = (req, res, next) => {
  try {
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
// ROUTES DASHBOARD (ACCÈS ADMIN COMPLET)
// ========================================

// GET /dashboards - Récupère tous les dashboards (accès administrateur)
router.get(
  "/dashboards",
  authMiddleware,
  requireRole(["LIST_DASHBOARD"]),
  extractUserId,
  async (req, res) => {
    try {
      const result = await dashboardService.getAllDashboards(
        req.userId,
        req.query
      );
      res.json(result);
    } catch (error) {
      console.error("Erreur lors de la récupération des dashboards:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération des dashboards",
        message: error.message,
      });
    }
  }
);

// GET /dashboards/:id - Récupère un dashboard spécifique (accès administrateur)
router.get(
  "/dashboards/:id",
  authMiddleware,
  requireRole(["LIST_DASHBOARD"]),
  extractUserId,
  [check("id").isUUID().withMessage("ID de dashboard invalide")],
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await dashboardService.getDashboardById(
        req.params.id,
        req.userId
      );
      res.json(result);
    } catch (error) {
      console.error("Erreur lors de la récupération du dashboard:", error);

      if (error.message === "Dashboard non trouvé") {
        return res.status(404).json({
          success: false,
          error: "Dashboard non trouvé",
        });
      }

      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération du dashboard",
        message: error.message,
      });
    }
  }
);

// GET /statistics - Statistiques globales du système
router.get(
  "/statistics",
  authMiddleware,
  requireRole(["ROLE_ADMIN"]),
  extractUserId,
  async (req, res) => {
    try {
      const result = await dashboardService.getSystemStatistics(req.userId);
      res.json(result);
    } catch (error) {
      console.error("Erreur lors de la récupération des statistiques:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération des statistiques",
        message: error.message,
      });
    }
  }
);

// POST /dashboards/:id/force-status - Force le changement de statut
router.post(
  "/dashboards/:id/force-status",
  authMiddleware,
  requireRole(["ROLE_ADMIN"]),
  extractUserId,
  [
    check("id").isUUID().withMessage("ID de dashboard invalide"),
    check("new_status").isString().withMessage("Nouveau statut requis"),
    check("reason").isString().withMessage("Raison du changement requise"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await dashboardService.forceStatusChange(
        req.params.id,
        req.userId,
        req.body.new_status,
        req.body.reason
      );
      res.json(result);
    } catch (error) {
      console.error("Erreur lors du changement forcé de statut:", error);

      if (error.message === "Dashboard non trouvé") {
        return res.status(404).json({
          success: false,
          error: "Dashboard non trouvé",
        });
      }

      if (
        error.message.includes("Statut") &&
        error.message.includes("non trouvé")
      ) {
        return res.status(400).json({
          success: false,
          error: error.message,
        });
      }

      res.status(500).json({
        success: false,
        error: "Erreur lors du changement de statut",
        message: error.message,
      });
    }
  }
);

// DELETE /dashboards/:id/permanent - Suppression définitive d'un dashboard
router.delete(
  "/dashboards/:id/permanent",
  authMiddleware,
  requireRole(["DELETE_DASHBOARD"]),
  extractUserId,
  [
    check("id").isUUID().withMessage("ID de dashboard invalide"),
    check("reason").isString().withMessage("Raison de la suppression requise"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await dashboardService.permanentlyDeleteDashboard(
        req.params.id,
        req.userId,
        req.body.reason
      );
      res.json(result);
    } catch (error) {
      console.error("Erreur lors de la suppression définitive:", error);

      if (error.message === "Dashboard non trouvé") {
        return res.status(404).json({
          success: false,
          error: "Dashboard non trouvé",
        });
      }

      res.status(500).json({
        success: false,
        error: "Erreur lors de la suppression définitive",
        message: error.message,
      });
    }
  }
);

// ========================================
// GESTION DES TYPES D'ITEMS
// ========================================

// POST /item_types - Créer un nouveau type d'item
router.post(
  "/item_types",
  authMiddleware,
  requireRole(["ADD_ITEM_DASHBOARD"]),
  extractUserId,
  [
    check("name")
      .isString()
      .isLength({ min: 1, max: 100 })
      .withMessage("Nom requis (1-100 caractères)"),
    check("description")
      .optional()
      .isString()
      .withMessage("Description doit être une chaîne"),
    check("default_config")
      .optional()
      .isObject()
      .withMessage("Configuration par défaut doit être un objet"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await adminService.createItemType(req.userId, req.body);
      res.status(201).json(result);
    } catch (error) {
      console.error("Erreur lors de la création du type d'item:", error);

      if (error.message.includes("existe déjà")) {
        return res.status(409).json({
          success: false,
          error: error.message,
        });
      }

      res.status(500).json({
        success: false,
        error: "Erreur lors de la création du type d'item",
        message: error.message,
      });
    }
  }
);

// GET /item_types - Récupérer tous les types d'items
router.get(
  "/item_types",
  authMiddleware,
  requireRole(["LIST_DASHBOARD"]),
  extractUserId,
  async (req, res) => {
    try {
      const result = await adminService.getAllItemTypes(req.userId);
      res.json(result);
    } catch (error) {
      console.error("Erreur lors de la récupération des types d'items:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération des types d'items",
        message: error.message,
      });
    }
  }
);

// GET /item_types/:id - Récupérer un type d'item spécifique
router.get(
  "/item_types/:id",
  authMiddleware,
  requireRole(["LIST_DASHBOARD"]),
  extractUserId,
  [check("id").isUUID().withMessage("ID de type d'item invalide")],
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await adminService.getItemTypeById(
        req.params.id,
        req.userId
      );
      res.json(result);
    } catch (error) {
      console.error("Erreur lors de la récupération du type d'item:", error);

      if (error.message === "Type d'item non trouvé") {
        return res.status(404).json({
          success: false,
          error: "Type d'item non trouvé",
        });
      }

      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération du type d'item",
        message: error.message,
      });
    }
  }
);

// PUT /item_types/:id - Mettre à jour un type d'item
router.put(
  "/item_types/:id",
  authMiddleware,
  requireRole(["ADD_ITEM_DASHBOARD"]),
  extractUserId,
  [
    check("id").isUUID().withMessage("ID de type d'item invalide"),
    check("name")
      .optional()
      .isString()
      .isLength({ min: 1, max: 100 })
      .withMessage("Nom invalide (1-100 caractères)"),
    check("description")
      .optional()
      .isString()
      .withMessage("Description doit être une chaîne"),
    check("default_config")
      .optional()
      .isObject()
      .withMessage("Configuration par défaut doit être un objet"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await adminService.updateItemType(
        req.params.id,
        req.userId,
        req.body
      );
      res.json(result);
    } catch (error) {
      console.error("Erreur lors de la mise à jour du type d'item:", error);

      if (error.message === "Type d'item non trouvé") {
        return res.status(404).json({
          success: false,
          error: "Type d'item non trouvé",
        });
      }

      if (error.message.includes("existe déjà")) {
        return res.status(409).json({
          success: false,
          error: error.message,
        });
      }

      res.status(500).json({
        success: false,
        error: "Erreur lors de la mise à jour du type d'item",
        message: error.message,
      });
    }
  }
);

// DELETE /item_types/:id - Supprimer un type d'item
router.delete(
  "/item_types/:id",
  authMiddleware,
  requireRole(["DELETE_DASHBOARD"]),
  extractUserId,
  [check("id").isUUID().withMessage("ID de type d'item invalide")],
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await adminService.deleteItemType(
        req.params.id,
        req.userId
      );
      res.json(result);
    } catch (error) {
      console.error("Erreur lors de la suppression du type d'item:", error);

      if (error.message === "Type d'item non trouvé") {
        return res.status(404).json({
          success: false,
          error: "Type d'item non trouvé",
        });
      }

      if (error.message.includes("utilisé par")) {
        return res.status(400).json({
          success: false,
          error: error.message,
        });
      }

      res.status(500).json({
        success: false,
        error: "Erreur lors de la suppression du type d'item",
        message: error.message,
      });
    }
  }
);

// ========================================
// GESTION DES STATUTS
// ========================================

// POST /statuses - Créer un nouveau statut
router.post(
  "/statuses",
  authMiddleware,
  requireRole(["DELETE_DASHBOARD"]),
  extractUserId,
  [
    check("code")
      .isString()
      .isLength({ min: 1, max: 50 })
      .withMessage("Code requis (1-50 caractères)"),
    check("label")
      .isString()
      .isLength({ min: 1, max: 100 })
      .withMessage("Label requis (1-100 caractères)"),
    check("description")
      .optional()
      .isString()
      .withMessage("Description doit être une chaîne"),
    check("transitions")
      .optional()
      .isArray()
      .withMessage("Transitions doit être un tableau"),
    check("editable")
      .optional()
      .isBoolean()
      .withMessage("Editable doit être un booléen"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await adminService.createStatus(req.userId, req.body);
      res.status(201).json(result);
    } catch (error) {
      console.error("Erreur lors de la création du statut:", error);

      if (error.message.includes("existe déjà")) {
        return res.status(409).json({
          success: false,
          error: error.message,
        });
      }

      res.status(500).json({
        success: false,
        error: "Erreur lors de la création du statut",
        message: error.message,
      });
    }
  }
);

// GET /statuses - Récupérer tous les statuts
router.get(
  "/statuses",
  authMiddleware,
  requireRole(["LIST_DASHBOARD"]),
  extractUserId,
  async (req, res) => {
    try {
      const result = await adminService.getAllStatuses(req.userId);
      res.json(result);
    } catch (error) {
      console.error("Erreur lors de la récupération des statuts:", error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération des statuts",
        message: error.message,
      });
    }
  }
);

// GET /statuses/:id - Récupérer un statut spécifique
router.get(
  "/statuses/:id",
  authMiddleware,
  requireRole(["LIST_DASHBOARD"]),
  extractUserId,
  [check("id").isUUID().withMessage("ID de statut invalide")],
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await adminService.getStatusById(
        req.params.id,
        req.userId
      );
      res.json(result);
    } catch (error) {
      console.error("Erreur lors de la récupération du statut:", error);

      if (error.message === "Statut non trouvé") {
        return res.status(404).json({
          success: false,
          error: "Statut non trouvé",
        });
      }

      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération du statut",
        message: error.message,
      });
    }
  }
);

// PUT /statuses/:id - Mettre à jour un statut
router.put(
  "/statuses/:id",
  authMiddleware,
  requireRole(["DELETE_DASHBOARD"]),
  extractUserId,
  [
    check("id").isUUID().withMessage("ID de statut invalide"),
    check("code")
      .optional()
      .isString()
      .isLength({ min: 1, max: 50 })
      .withMessage("Code invalide (1-50 caractères)"),
    check("label")
      .optional()
      .isString()
      .isLength({ min: 1, max: 100 })
      .withMessage("Label invalide (1-100 caractères)"),
    check("description")
      .optional()
      .isString()
      .withMessage("Description doit être une chaîne"),
    check("transitions")
      .optional()
      .isArray()
      .withMessage("Transitions doit être un tableau"),
    check("editable")
      .optional()
      .isBoolean()
      .withMessage("Editable doit être un booléen"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await adminService.updateStatus(
        req.params.id,
        req.userId,
        req.body
      );
      res.json(result);
    } catch (error) {
      console.error("Erreur lors de la mise à jour du statut:", error);

      if (error.message === "Statut non trouvé") {
        return res.status(404).json({
          success: false,
          error: "Statut non trouvé",
        });
      }

      if (error.message.includes("existe déjà")) {
        return res.status(409).json({
          success: false,
          error: error.message,
        });
      }

      res.status(500).json({
        success: false,
        error: "Erreur lors de la mise à jour du statut",
        message: error.message,
      });
    }
  }
);

// DELETE /statuses/:id - Supprimer un statut
router.delete(
  "/statuses/:id",
  authMiddleware,
  requireRole(["DELETE_DASHBOARD"]),
  extractUserId,
  [check("id").isUUID().withMessage("ID de statut invalide")],
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await adminService.deleteStatus(req.params.id, req.userId);
      res.json(result);
    } catch (error) {
      console.error("Erreur lors de la suppression du statut:", error);

      if (error.message === "Statut non trouvé") {
        return res.status(404).json({
          success: false,
          error: "Statut non trouvé",
        });
      }

      if (error.message.includes("utilisé par")) {
        return res.status(400).json({
          success: false,
          error: error.message,
        });
      }

      res.status(500).json({
        success: false,
        error: "Erreur lors de la suppression du statut",
        message: error.message,
      });
    }
  }
);

// PUT /statuses/:id/transitions - Mettre à jour les transitions d'un statut
router.put(
  "/statuses/:id/transitions",
  authMiddleware,
  requireRole(["DELETE_DASHBOARD"]),
  extractUserId,
  [
    check("id").isUUID().withMessage("ID de statut invalide"),
    check("transitions")
      .isArray()
      .withMessage("Transitions doit être un tableau"),
    check("transitions.*")
      .isString()
      .withMessage("Chaque transition doit être une chaîne"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await adminService.updateStatusTransitions(
        req.params.id,
        req.userId,
        req.body.transitions
      );
      res.json(result);
    } catch (error) {
      console.error("Erreur lors de la mise à jour des transitions:", error);

      if (error.message === "Statut non trouvé") {
        return res.status(404).json({
          success: false,
          error: "Statut non trouvé",
        });
      }

      if (error.message.includes("Statuts de transition invalides")) {
        return res.status(400).json({
          success: false,
          error: error.message,
        });
      }

      res.status(500).json({
        success: false,
        error: "Erreur lors de la mise à jour des transitions",
        message: error.message,
      });
    }
  }
);

// ========================================
// STATISTIQUES DÉTAILLÉES
// ========================================

// GET /admin/statistics/detailed - Statistiques détaillées du système
router.get(
  "/admin/statistics/detailed",
  authMiddleware,
  requireRole(["ROLE_ADMIN"]),
  extractUserId,
  async (req, res) => {
    try {
      const result = await adminService.getDetailedSystemStatistics(req.userId);
      res.json(result);
    } catch (error) {
      console.error(
        "Erreur lors de la récupération des statistiques détaillées:",
        error
      );
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération des statistiques détaillées",
        message: error.message,
      });
    }
  }
);

module.exports = router;
