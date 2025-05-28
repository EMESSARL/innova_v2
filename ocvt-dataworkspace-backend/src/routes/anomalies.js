const express = require("express");
const router = express.Router();
const { check, validationResult } = require("express-validator");
const { authMiddleware, requireRole } = require("../middleware/auth");
const anomaliesService = require("../services/anomaliesService");

router.post(
  "/",
  // authMiddleware,
  // requireRole(["ROLE_POINT_FOCAL", "ROLE_ADMIN"]),
  [
    check("dataset_id").isInt().withMessage("ID du dataset invalide"),
    check("algorithm")
      .optional()
      .isIn(["isolation_forest", "lof", "one_class_svm", "elliptic_envelope"])
      .withMessage(
        "Algorithme invalide. Valeurs acceptées : isolation_forest, lof, one_class_svm, elliptic_envelope"
      ),
    check("hyperparameters")
      .optional()
      .isObject()
      .withMessage("hyperparameters doit être un objet"),
    check("preprocessing")
      .optional()
      .isObject()
      .withMessage("preprocessing doit être un objet")
      .custom((value, { req }) => {
        if (value) {
          const validScaling = ["none", "standard", "minmax", "robust"];
          if (value.scaling && !validScaling.includes(value.scaling)) {
            throw new Error(
              `preprocessing.scaling invalide. Valeurs acceptées : ${validScaling.join(
                ", "
              )}`
            );
          }
          const validEncoding = ["none", "onehot", "label"];
          if (value.encoding && !validEncoding.includes(value.encoding)) {
            throw new Error(
              `preprocessing.encoding invalide. Valeurs acceptées : ${validEncoding.join(
                ", "
              )}`
            );
          }
          const validImputation = ["drop", "mean", "median"];
          if (value.imputation && !validImputation.includes(value.imputation)) {
            throw new Error(
              `preprocessing.imputation invalide. Valeurs acceptées : ${validImputation.join(
                ", "
              )}`
            );
          }
        }
        return true;
      }),
    check("auto_algorithm_selection")
      .isBoolean()
      .withMessage("auto_algorithm_selection doit être un booléen"),
    check("anomaly_threshold")
      .optional()
      .isFloat({ min: 0, max: 1 })
      .withMessage("anomaly_threshold doit être un nombre entre 0 et 1"),
    check("output_format")
      .isIn(["csv", "excel", "json"])
      .withMessage(
        "Format de sortie invalide. Valeurs acceptées : csv, excel, json"
      ),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      dataset_id,
      algorithm,
      hyperparameters,
      preprocessing,
      auto_algorithm_selection,
      anomaly_threshold,
      output_format,
    } = req.body;
    const userId = req.user.id;

    try {
      const result = await anomaliesService.detectAnomalies(
        userId,
        dataset_id,
        algorithm,
        hyperparameters,
        preprocessing,
        auto_algorithm_selection,
        anomaly_threshold,
        output_format
      );
      res.status(200).json(result);
    } catch (error) {
      console.error("Erreur dans la route de détection d'anomalies:", error);
      if (
        error.message.includes("Dataset non trouvé") ||
        error.message.includes("Format non supporté") ||
        error.message.includes("Aucune colonne numérique pour l'imputation") ||
        error.message.includes("Aucune colonne catégorique pour l'encodage") ||
        error.message.includes("Aucune colonne numérique pour le scaling") ||
        error.message.includes("Aucune colonne numérique détectée") ||
        error.message.includes("Algorithme non supporté") ||
        error.message.includes("Aucun algorithme n'a pu être appliqué") ||
        error.message.includes("n_neighbors doit être inférieur") ||
        error.message.includes("Format de sortie invalide")
      ) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: "Erreur serveur : " + error.message });
    }
  }
);

module.exports = router;
