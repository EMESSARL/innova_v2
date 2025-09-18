const express = require("express");
const router = express.Router();
const { check, validationResult } = require("express-validator");
const { authMiddleware, requireRole } = require("../middleware/auth");
const dashboardService = require("../services/dashboardService");

// Middleware pour extraire l'ID utilisateur depuis le token JWT
const extractUserId = (req, res, next) => {
  req.user = { id: "user123" }; // other_user_002
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

// GET /dashboards
router.get(
  "/dashboards",
  // authMiddleware,
  // requireRole(["ROLE_VALIDATOR", "ROLE_ADMIN"]),
  extractUserId,
  async (req, res) => {
    try {
      // Vérifier que le statut demandé est SUBMITTED
      // if (req.query.status !== "SUBMITTED") {
      //   return res.status(400).json({
      //     success: false,
      //     error: "Seul le statut SUBMITTED est autorisé pour les validateurs",
      //   });
      // }
      if (req.query.status !== undefined) {
        if (req.query.status === "SUBMITTED") {
          const result = await dashboardService.getSubmittedDashboards(
            req.userId
          );
          res.json(result);
        } else if (req.query.status === "REJECTED") {
          const result = await dashboardService.getRejectedDashboards(
            req.userId
          );
          res.json(result);
        } else if (req.query.status === "VALIDATED") {
          const result = await dashboardService.getValidatedDashboards(
            req.userId
          );
          res.json(result);
        } else {
          return res.status(400).json({
            success: false,
            error: "Seul le statut SUBMITTED, REJECTED ou VALIDATED est autorisé",
          });
        }
      } else {
        const result = await dashboardService.getAllDashboards(req.userId);
        res.json(result);
      }
    } catch (error) {
      console.error(
        "Erreur lors de la récupération des dashboards:",
        error
      );
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération des dashboards",
        message: error.message,
      });
    }
  }
);

// GET /dashboards/:id - Afficher un dashboard soumis en mode lecture seule
router.get(
  "/dashboards/:id",
  authMiddleware,
  requireRole(["ROLE_VALIDATOR", "ROLE_ADMIN"]),
  extractUserId,
  [check("id").isUUID().withMessage("ID de dashboard invalide")],
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await dashboardService.getDashboardById(
        req.params.id,
        req.userId,
        req.roles
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

// POST /dashboards/:id/validate - Valider, rejeter ou demander des modifications
router.post(
  "/dashboards/:id/validate",
  authMiddleware,
  requireRole(["ROLE_VALIDATOR"]),
  extractUserId,
  [
    check("id").isUUID().withMessage("ID de dashboard invalide"),
    check("action")
      .isIn(["VALIDATE", "REJECT", "REQUEST_UPDATE"])
      .withMessage(
        "Action de validation invalide. Doit être VALIDATE, REJECT ou REQUEST_UPDATE"
      ),
    check("comments")
      .optional()
      .isString()
      .withMessage("Les commentaires doivent être une chaîne de caractères"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      // Validation supplémentaire : commentaires obligatoires pour REJECT et REQUEST_UPDATE
      if (
        (req.body.action === "REJECT" ||
          req.body.action === "REQUEST_UPDATE") &&
        !req.body.comments
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Les commentaires sont obligatoires pour rejeter ou demander des modifications",
        });
      }

      const result = await dashboardService.validateDashboard(
        req.params.id,
        req.userId,
        req.body
      );
      res.json(result);
    } catch (error) {
      console.error("Erreur lors de la validation du dashboard:", error);

      if (error.message === "Dashboard non trouvé") {
        return res.status(404).json({
          success: false,
          error: "Dashboard non trouvé",
        });
      }

      if (
        error.message ===
        "Ce dashboard ne peut pas être validé dans son état actuel"
      ) {
        return res.status(400).json({
          success: false,
          error: error.message,
        });
      }

      if (error.message === "Action de validation invalide") {
        return res.status(400).json({
          success: false,
          error: error.message,
        });
      }

      res.status(500).json({
        success: false,
        error: "Erreur lors de la validation du dashboard",
        message: error.message,
      });
    }
  }
);

// PUT /dashboards/:id - Éditer un dashboard en statut REQUEST_UPDATE
router.put(
  "/dashboards/:id",
  authMiddleware,
  requireRole(["ROLE_POINT_FOCAL"]),
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
    check("items")
      .optional()
      .isArray()
      .withMessage("Les items doivent être un tableau"),
    check("items.*.id").optional().isUUID().withMessage("ID d'item invalide"),
    check("items.*.config")
      .optional()
      .isObject()
      .withMessage("La configuration de l'item doit être un objet"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await dashboardService.editRequestedDashboard(
        req.params.id,
        req.userId,
        req.body
      );
      res.json(result);
    } catch (error) {
      console.error("Erreur lors de la modification du dashboard:", error);

      if (error.message === "Dashboard non trouvé") {
        return res.status(404).json({
          success: false,
          error: "Dashboard non trouvé",
        });
      }

      if (
        error.message ===
        "Ce dashboard ne peut pas être modifié dans son état actuel"
      ) {
        return res.status(400).json({
          success: false,
          error: error.message,
        });
      }

      res.status(500).json({
        success: false,
        error: "Erreur lors de la modification du dashboard",
        message: error.message,
      });
    }
  }
);

module.exports = router;
