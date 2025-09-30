const express = require("express");
const router = express.Router();
const { check, validationResult } = require("express-validator");
const { authMiddleware, requireRole } = require("../middleware/auth");
const dashboardService = require("../services/dashboardService");
const ItemType = require("../models/ItemType");
const Status = require("../models/Status");

// Middleware pour extraire l'ID utilisateur depuis le token JWT
const extractUserId = (req, res, next) => {
  // req.user = { id: "user123" }; // other_user_002
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

// POST /dashboards - Créer un nouveau dashboard
router.post(
  "/",
  authMiddleware,
  requireRole(["CREATE_DASHBOARD"]),
  extractUserId,
  [
    check("title")
      .trim()
      .isLength({ min: 1, max: 255 })
      .withMessage(
        "Le titre est obligatoire et doit faire entre 1 et 255 caractères"
      ),
    check("description")
      .optional()
      .isString()
      .withMessage("La description doit être une chaîne de caractères"),
    check("domain_id")
    .optional()
      .isInt({ min: 1 })
      .withMessage("L'ID du domaine doit être un entier positif"),
    check("subdomain_id")
      .optional()
      .isInt({ min: 1 })
      .withMessage("L'ID du sous-domaine doit être un entier positif"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await dashboardService.createDashboard(
        req.userId,
        req.body
      );
      res.status(201).json(result);
    } catch (error) {
      console.error("Erreur lors de la création du dashboard:", error);

      if (error.message === "Domaine non trouvé") {
        return res.status(400).json({
          success: false,
          error: "Domaine non trouvé",
        });
      }

      if (error.message === "Sous-domaine non trouvé") {
        return res.status(400).json({
          success: false,
          error: "Sous-domaine non trouvé",
        });
      }

      if (error.message.includes("n'appartient pas au domaine")) {
        return res.status(400).json({
          success: false,
          error: error.message,
        });
      }

      res.status(500).json({
        success: false,
        error: "Erreur lors de la création du dashboard",
        message: error.message,
      });
    }
  }
);

// GET /dashboards/me - Récupérer la liste des dashboards de l'utilisateur connecté
router.get(
  "/me",
  authMiddleware,
  requireRole(["CREATE_DASHBOARD", "LIST_DASHBOARD"]),
  extractUserId,
  async (req, res) => {
    try {
      // const filters = {};
      // if (req.query.owner === "me") {
      //   filters.owner = "me";
      // }

      const result = await dashboardService.getDashboards(req.userId);
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

// GET /dashboards/:id - Récupérer les détails d'un dashboard
router.get(
  "/:id",
  authMiddleware,
  requireRole(["LIST_DASHBOARD"]),
  extractUserId,
  [check("id").isUUID().withMessage("ID de dashboard invalide")],
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await dashboardService.getDashboardById(
        req.params.id,
        req.userId,
        req.user.roles
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

      if (error.message === "Accès non autorisé à ce dashboard") {
        return res.status(403).json({
          success: false,
          error: "Accès non autorisé à ce dashboard",
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

// PUT /dashboards/:id - Mettre à jour un dashboard
router.put(
  "/:id",
  authMiddleware,
  requireRole(["UPDATE_DASHBOARD"]),
  extractUserId,
  [
    check("id").isUUID().withMessage("ID de dashboard invalide"),
    check("title")
      .optional()
      .trim()
      .isLength({ min: 1, max: 255 })
      .withMessage("Le titre doit faire entre 1 et 255 caractères"),
    check("description")
      .optional()
      .isString()
      .withMessage("La description doit être une chaîne de caractères"),
    check("domain_id")
      .optional()
      .isInt({ min: 1 })
      .withMessage("L'ID du domaine doit être un entier positif"),
    check("subdomain_id")
      .optional()
      .isInt({ min: 1 })
      .withMessage("L'ID du sous-domaine doit être un entier positif"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await dashboardService.updateDashboard(
        req.params.id,
        req.userId,
        req.body
      );
      res.json(result);
    } catch (error) {
      console.error("Erreur lors de la mise à jour du dashboard:", error);

      if (error.message === "Dashboard non trouvé") {
        return res.status(404).json({
          success: false,
          error: "Dashboard non trouvé",
        });
      }

      if (error.message.includes("n'êtes pas autorisé")) {
        return res.status(403).json({
          success: false,
          error: error.message,
        });
      }

      if (error.message.includes("ne peut pas être modifié")) {
        return res.status(400).json({
          success: false,
          error: error.message,
        });
      }

      if (error.message === "Domaine non trouvé") {
        return res.status(400).json({
          success: false,
          error: "Domaine non trouvé",
        });
      }

      if (error.message === "Sous-domaine non trouvé") {
        return res.status(400).json({
          success: false,
          error: "Sous-domaine non trouvé",
        });
      }

      if (error.message.includes("n'appartient pas au domaine")) {
        return res.status(400).json({
          success: false,
          error: error.message,
        });
      }

      res.status(500).json({
        success: false,
        error: "Erreur lors de la mise à jour du dashboard",
        message: error.message,
      });
    }
  }
);

// POST /dashboards/:id/items - Ajouter un item au dashboard
router.post(
  "/:id/items",
  authMiddleware,
  requireRole(["CREATE_DASHBOARD"]),
  extractUserId,
  [
    check("id").isUUID().withMessage("ID de dashboard invalide"),
    check("item_type_id").isUUID().withMessage("ID de type d'item invalide"),
    check("config")
      .isObject()
      .withMessage("La configuration doit être un objet"),
    check("position")
      .optional()
      .isInt({ min: 0 })
      .withMessage("La position doit être un entier positif"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await dashboardService.addDashboardItem(
        req.params.id,
        req.userId,
        req.body
      );
      res.status(201).json(result);
    } catch (error) {
      console.error("Erreur lors de l'ajout de l'item:", error);

      if (error.message === "Dashboard non trouvé") {
        return res.status(404).json({
          success: false,
          error: "Dashboard non trouvé",
        });
      }

      if (error.message === "Type d'item invalide") {
        return res.status(400).json({
          success: false,
          error: "Type d'item invalide",
        });
      }

      // Gestion des erreurs de validation de configuration
      if (error.message.includes("doit contenir")) {
        return res.status(400).json({
          success: false,
          error: "Configuration invalide",
          message: error.message,
        });
      }

      if (error.message === "Le fichier spécifié n'existe pas") {
        return res.status(400).json({
          success: false,
          error: "Fichier introuvable",
          message: error.message,
        });
      }

      if (error.message === "Vous n'êtes pas autorisé à utiliser ce fichier") {
        return res.status(403).json({
          success: false,
          error: "Accès au fichier non autorisé",
          message: error.message,
        });
      }

      if (error.message.includes("n'êtes pas autorisé")) {
        return res.status(403).json({
          success: false,
          error: error.message,
        });
      }

      if (error.message.includes("ne peut pas être modifié")) {
        return res.status(400).json({
          success: false,
          error: error.message,
        });
      }

      res.status(500).json({
        success: false,
        error: "Erreur lors de l'ajout de l'item",
        message: error.message,
      });
    }
  }
);

// PUT /dashboard_items/:itemId - Mettre à jour un item
router.put(
  "/items/:itemId",
  authMiddleware,
  requireRole(["UPDATE_DASHBOARD"]),
  extractUserId,
  [
    check("itemId").isUUID().withMessage("ID d'item invalide"),
    check("config")
      .optional()
      .isObject()
      .withMessage("La configuration doit être un objet"),
    check("position")
      .optional()
      .isInt({ min: 0 })
      .withMessage("La position doit être un entier positif"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await dashboardService.updateDashboardItem(
        req.params.itemId,
        req.userId,
        req.body
      );
      res.json(result);
    } catch (error) {
      console.error("Erreur lors de la mise à jour de l'item:", error);

      if (error.message === "Item non trouvé") {
        return res.status(404).json({
          success: false,
          error: "Item non trouvé",
        });
      }

      // Gestion des erreurs de validation de configuration
      if (error.message.includes("doit contenir")) {
        return res.status(400).json({
          success: false,
          error: "Configuration invalide",
          message: error.message,
        });
      }

      if (error.message === "Le fichier spécifié n'existe pas") {
        return res.status(400).json({
          success: false,
          error: "Fichier introuvable",
          message: error.message,
        });
      }

      // if (error.message === "Vous n'êtes pas autorisé à utiliser ce fichier") {
      //   return res.status(403).json({
      //     success: false,
      //     error: "Accès au fichier non autorisé",
      //     message: error.message,
      //   });
      // }

      if (error.message.includes("n'êtes pas autorisé")) {
        return res.status(403).json({
          success: false,
          error: error.message,
        });
      }

      if (error.message.includes("ne peut pas être modifié")) {
        return res.status(400).json({
          success: false,
          error: error.message,
        });
      }

      res.status(500).json({
        success: false,
        error: "Erreur lors de la mise à jour de l'item",
        message: error.message,
      });
    }
  }
);

// DELETE /dashboard_items/:itemId - Supprimer un item
router.delete(
  "/items/:itemId",
  authMiddleware,
  requireRole(["CREATE_DASHBOARD"]),
  extractUserId,
  [check("itemId").isUUID().withMessage("ID d'item invalide")],
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await dashboardService.deleteDashboardItem(
        req.params.itemId,
        req.userId
      );
      res.json(result);
    } catch (error) {
      console.error("Erreur lors de la suppression de l'item:", error);

      if (error.message === "Item non trouvé") {
        return res.status(404).json({
          success: false,
          error: "Item non trouvé",
        });
      }

      if (error.message.includes("n'êtes pas autorisé")) {
        return res.status(403).json({
          success: false,
          error: error.message,
        });
      }

      if (error.message.includes("ne peut pas être supprimé")) {
        return res.status(400).json({
          success: false,
          error: error.message,
        });
      }

      res.status(500).json({
        success: false,
        error: "Erreur lors de la suppression de l'item",
        message: error.message,
      });
    }
  }
);

// POST /dashboards/:id/submit - Soumettre un dashboard pour validation
router.post(
  "/:id/submit",
  authMiddleware,
  requireRole(["CREATE_DASHBOARD"]),
  extractUserId,
  [check("id").isUUID().withMessage("ID de dashboard invalide")],
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await dashboardService.submitDashboard(
        req.params.id,
        req.userId
      );
      res.json(result);
    } catch (error) {
      console.error("Erreur lors de la soumission du dashboard:", error);

      if (error.message === "Dashboard non trouvé") {
        return res.status(404).json({
          success: false,
          error: "Dashboard non trouvé",
        });
      }

      if (error.message.includes("n'êtes pas autorisé")) {
        return res.status(403).json({
          success: false,
          error: error.message,
        });
      }

      if (error.message.includes("ne peut pas être soumis")) {
        return res.status(400).json({
          success: false,
          error: error.message,
        });
      }

      res.status(500).json({
        success: false,
        error: "Erreur lors de la soumission du dashboard",
        message: error.message,
      });
    }
  }
);

// POST /dashboards/:id/duplicate - Dupliquer un dashboard
router.post(
  "/:id/duplicate",
  authMiddleware,
  requireRole(["CREATE_DASHBOARD"]),
  extractUserId,
  [check("id").isUUID().withMessage("ID de dashboard invalide")],
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await dashboardService.duplicateDashboard(
        req.params.id,
        req.userId
      );
      res.status(201).json(result);
    } catch (error) {
      console.error("Erreur lors de la duplication du dashboard:", error);

      if (error.message === "Dashboard non trouvé") {
        return res.status(404).json({
          success: false,
          error: "Dashboard non trouvé",
        });
      }

      if (error.message.includes("n'êtes pas autorisé")) {
        return res.status(403).json({
          success: false,
          error: error.message,
        });
      }

      res.status(500).json({
        success: false,
        error: "Erreur lors de la duplication du dashboard",
        message: error.message,
      });
    }
  }
);

// POST /files - Upload de fichiers
router.post(
  "/files",
  authMiddleware,
  requireRole(["ROLE_POINT_FOCAL"]),
  extractUserId,
  [
    check("filename")
      .trim()
      .isLength({ min: 1, max: 255 })
      .withMessage(
        "Le nom de fichier est obligatoire et doit faire entre 1 et 255 caractères"
      ),
    check("mime_type").isString().withMessage("Le type MIME est obligatoire"),
    check("size")
      .isInt({ min: 1 })
      .withMessage("La taille du fichier doit être un entier positif"),
    check("storage_path")
      .isString()
      .withMessage("Le chemin de stockage est obligatoire"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await dashboardService.uploadFile(req.userId, req.body);
      res.status(201).json(result);
    } catch (error) {
      console.error("Erreur lors de l'upload du fichier:", error);

      if (error.message === "Données de fichier incomplètes") {
        return res.status(400).json({
          success: false,
          error: "Données de fichier incomplètes",
        });
      }

      if (error.message === "Fichier trop volumineux") {
        return res.status(400).json({
          success: false,
          error: error.message,
        });
      }

      if (error.message === "Type de fichier non supporté") {
        return res.status(400).json({
          success: false,
          error: error.message,
        });
      }

      res.status(500).json({
        success: false,
        error: "Erreur lors de l'upload du fichier",
        message: error.message,
      });
    }
  }
);

// GET /dashboards/get/item_types - Récupérer la liste des types d'items
router.get(
  "/get/item_types",
  authMiddleware,
  requireRole(["CREATE_DASHBOARD"]),
  extractUserId,
  async (req, res) => {
    try {
      const result = await dashboardService.getItemTypes();
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

// GET /dashboards/get/statuses - Récupérer la liste des statuts
router.get(
  "/get/statuses",
  authMiddleware,
  requireRole(["CREATE_DASHBOARD"]),
  extractUserId,
  async (req, res) => {
    try {
      const result = await dashboardService.getStatuses();
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

module.exports = router;
