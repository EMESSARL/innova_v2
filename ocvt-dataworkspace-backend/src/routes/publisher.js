const express = require("express");
const router = express.Router();
const { check, validationResult } = require("express-validator");
const { authMiddleware, requireRole } = require("../middleware/auth");
const dashboardService = require("../services/dashboardService");

// Middleware pour extraire l'ID utilisateur depuis le token JWT
const extractUserId = (req, res, next) => {
  // req.user = { id: "user123" }; // other_user_002
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

// GET /dashboards?status=VALIDATED - Lister les dashboards validés prêts à être publiés
// router.get(
//   "/dashboards",
//   authMiddleware,
//   requireRole(["ROLE_VALIDATOR", "ROLE_ADMIN"]),
//   extractUserId,
//   async (req, res) => {
//     try {
//       // Vérifier que le statut demandé est VALIDATED
//       if (req.query.status !== "VALIDATED") {
//         return res.status(400).json({
//           success: false,
//           error: "Seul le statut VALIDATED est autorisé pour les validateurs",
//         });
//       }

//       const result = await dashboardService.getValidatedDashboards(req.userId);
//       res.json(result);
//     } catch (error) {
//       console.error(
//         "Erreur lors de la récupération des dashboards validés:",
//         error
//       );
//       res.status(500).json({
//         success: false,
//         error: "Erreur lors de la récupération des dashboards validés",
//         message: error.message,
//       });
//     }
//   }
// );

// POST /dashboards/:id/publish - Publier un dashboard validé
router.post(
  "/dashboards/:id/publish",
  authMiddleware,
  requireRole(["PUBLISH_DASHBOARD"]),
  extractUserId,
  [
    check("id").isUUID().withMessage("ID de dashboard invalide"),
    check("visibility")
      .isIn(["PUBLIC", "PRIVATE", "PROTECTED"])
      .withMessage(
        "Niveau de visibilité invalide. Doit être PUBLIC, PRIVATE ou PROTECTED"
      ),
    check("group_id")
      .optional()
      .isString()
      .withMessage("L'ID du groupe doit être une chaîne de caractères"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      // Validation supplémentaire : group_id obligatoire pour PROTECTED
      if (req.body.visibility === "PROTECTED" && !req.body.group_id) {
        return res.status(400).json({
          success: false,
          error: "L'ID du groupe est obligatoire pour la visibilité PROTECTED",
        });
      }

      const result = await dashboardService.publishDashboard(
        req.params.id,
        req.userId,
        req.body
      );
      res.json(result);
    } catch (error) {
      console.error("Erreur lors de la publication du dashboard:", error);

      if (error.message === "Dashboard non trouvé") {
        return res.status(404).json({
          success: false,
          error: "Dashboard non trouvé",
        });
      }

      if (
        error.message ===
        "Ce dashboard ne peut pas être publié dans son état actuel"
      ) {
        return res.status(400).json({
          success: false,
          error: error.message,
        });
      }

      if (error.message === "Statut PUBLISHED non trouvé") {
        return res.status(500).json({
          success: false,
          error: "Erreur de configuration du système",
        });
      }

      res.status(500).json({
        success: false,
        error: "Erreur lors de la publication du dashboard",
        message: error.message,
      });
    }
  }
);

// DELETE /dashboards/:id/publish - Retirer un dashboard de la publication
router.delete(
  "/dashboards/:id/publish",
  authMiddleware,
  requireRole(["UNPUBLISH_DASHBOARD"]),
  extractUserId,
  [check("id").isUUID().withMessage("ID de dashboard invalide")],
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await dashboardService.withdrawDashboard(
        req.params.id,
        req.userId
      );
      res.json(result);
    } catch (error) {
      console.error("Erreur lors du retrait de la publication:", error);

      if (error.message === "Dashboard non trouvé") {
        return res.status(404).json({
          success: false,
          error: "Dashboard non trouvé",
        });
      }

      if (error.message === "Ce dashboard n'est pas publié") {
        return res.status(400).json({
          success: false,
          error: error.message,
        });
      }

      if (error.message === "Aucune publication trouvée pour ce dashboard") {
        return res.status(400).json({
          success: false,
          error: error.message,
        });
      }

      if (error.message === "Statut UNPUBLISHED non trouvé") {
        return res.status(500).json({
          success: false,
          error: "Erreur de configuration du système",
        });
      }

      res.status(500).json({
        success: false,
        error: "Erreur lors du retrait de la publication",
        message: error.message,
      });
    }
  }
);

module.exports = router;
