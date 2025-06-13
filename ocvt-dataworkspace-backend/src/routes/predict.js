const express = require("express");
const router = express.Router();
const { check, validationResult } = require("express-validator");
const { authMiddleware, requireRole } = require("../middleware/auth");
const predictService = require("../services/predictService");

router.post(
  "/",
  authMiddleware,
  requireRole(["ROLE_POINT_FOCAL"]),
  [
    check("dataset_id").isInt().withMessage("ID du dataset invalide"),
    check("target_column")
      .notEmpty()
      .withMessage("La colonne cible est requise"),
    check("prediction_type")
      .isIn(["regression", "classification"])
      .withMessage(
        "prediction_type doit être 'regression' ou 'classification'"
      ),
    check("model")
      .optional()
      .isIn([
        "linear_regression",
        "logistic_regression",
        "random_forest",
        "xgboost",
      ])
      .withMessage(
        "Modèle invalide. Valeurs acceptées : linear_regression, logistic_regression, random_forest, xgboost"
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
          const validScaling = ["none", "standard", "minmax"];
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
    check("auto_model_selection")
      .isBoolean()
      .withMessage("auto_model_selection doit être un booléen"),
    check("confidence")
      .isBoolean()
      .withMessage("confidence doit être un booléen"),
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
      target_column,
      prediction_type,
      model,
      hyperparameters,
      preprocessing,
      auto_model_selection,
      confidence,
      output_format,
    } = req.body;
    const userId = req.user.id;

    try {
      const result = await predictService.predictDataset(
        userId,
        dataset_id,
        target_column,
        prediction_type,
        model,
        hyperparameters,
        preprocessing,
        auto_model_selection,
        confidence,
        output_format
      );
      res.status(200).json(result);
    } catch (error) {
      // console.error("Erreur dans la route de prédiction:", error);
      if (
        error.message.includes("Dataset non trouvé") ||
        error.message.includes("Format non supporté") ||
        error.message.includes("Colonne cible manquante") ||
        error.message.includes("Aucune colonne numérique pour l'imputation") ||
        error.message.includes("Aucune colonne catégorique pour l'encodage") ||
        error.message.includes("Aucune colonne numérique pour le scaling") ||
        error.message.includes("Aucun modèle n'a pu être ajusté") ||
        error.message.includes("Modèle non compatible") ||
        error.message.includes("Modèle non supporté") ||
        error.message.includes("Confidence intervals not supported") ||
        error.message.includes("Format de sortie invalide")
      ) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: "Erreur serveur : " + error.message });
    }
  }
);

module.exports = router;
