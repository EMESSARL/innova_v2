const express = require("express");
const router = express.Router();
const { check, validationResult } = require("express-validator");
const { authMiddleware, requireRole } = require("../middleware/auth");
const aggregateService = require("../services/aggregateService");

// Fonction utilitaire pour valider une condition simple (utilisée pour les conditions d'agrégation)
const validateCondition = (condition, fieldName) => {
  if (!condition || typeof condition !== "object") {
    throw new Error(`${fieldName} doit être un objet`);
  }
  if (
    !condition.column ||
    !condition.operator ||
    condition.value === undefined
  ) {
    throw new Error(
      `${fieldName} doit inclure 'column', 'operator' et 'value'`
    );
  }
  const validOperators = [
    "=",
    "!=",
    ">",
    "<",
    ">=",
    "<=",
    "is_null",
    "is_not_null",
    "regex",
    "between",
  ];
  if (!validOperators.includes(condition.operator)) {
    throw new Error(
      `${fieldName}.operator invalide. Valeurs acceptées : ${validOperators.join(
        ", "
      )}`
    );
  }
  if (
    condition.operator === "between" &&
    (!Array.isArray(condition.value) || condition.value.length !== 2)
  ) {
    throw new Error(
      `${fieldName}.value doit être un tableau de deux éléments pour l'opérateur 'between'`
    );
  }
  return true;
};

router.post(
  "/",
  // authMiddleware,
  // requireRole(["ROLE_POINT_FOCAL", "ROLE_ADMIN"]),
  [
    check("dataset_id").isInt().withMessage("ID du dataset invalide"),
    check("group_by")
      .isArray()
      .withMessage("group_by doit être un tableau de chaînes")
      .notEmpty()
      .withMessage("group_by ne peut pas être vide"),
    check("aggregations")
      .isArray()
      .withMessage("aggregations doit être un tableau d'objets")
      .notEmpty()
      .withMessage("aggregations ne peut pas être vide")
      .custom((value, { req }) => {
        value.forEach((agg, index) => {
          if (
            !agg.column ||
            !Array.isArray(agg.functions) ||
            agg.functions.length === 0
          ) {
            throw new Error(
              `aggregations[${index}] doit inclure 'column' et 'functions' (tableau non vide)`
            );
          }
          const validFunctions = ["sum", "avg", "min", "max", "count", "std"];
          if (!agg.functions.every((func) => validFunctions.includes(func))) {
            throw new Error(
              `aggregations[${index}].functions contient des fonctions invalides. Valeurs acceptées : ${validFunctions.join(
                ", "
              )}`
            );
          }
          if (agg.condition) {
            validateCondition(
              agg.condition,
              `aggregations[${index}].condition`
            );
          }
        });
        return true;
      }),
    check("having")
      .optional()
      .isObject()
      .withMessage("having doit être un objet si présent")
      .custom((value, { req }) => {
        if (value) {
          if (!value.column || !value.operator || value.value === undefined) {
            throw new Error(
              "having doit inclure 'column', 'operator' et 'value'"
            );
          }
          const validOperators = ["=", "!=", ">", "<", ">=", "<="];
          if (!validOperators.includes(value.operator)) {
            throw new Error(
              `having.operator invalide. Valeurs acceptées : ${validOperators.join(
                ", "
              )}`
            );
          }
        }
        return true;
      }),
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

    const { dataset_id, group_by, aggregations, having, output_format } =
      req.body;
    // const userId = req.user.id;
    const userId = "user123";

    try {
      const result = await aggregateService.aggregateDataset(
        userId,
        dataset_id,
        group_by,
        aggregations,
        having,
        output_format
      );
      res.status(200).json(result);
    } catch (error) {
      console.error("Erreur dans la route d'agrégation:", error);
      if (
        error.message.includes("Dataset non trouvé") ||
        error.message.includes("Format non supporté") ||
        error.message.includes("Colonne de regroupement introuvable") ||
        error.message.includes("Colonne introuvable") ||
        error.message.includes("Fonctions non supportées") ||
        error.message.includes("La fonction 'std' nécessite") ||
        error.message.includes("Condition d'agrégation invalide") ||
        error.message.includes("Erreur lors de l'agrégation") ||
        error.message.includes("Colonne having introuvable") ||
        error.message.includes("Opérateur having non supporté") ||
        error.message.includes("Type incompatible pour la clause having")
      ) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: "Erreur serveur : " + error.message });
    }
  }
);

module.exports = router;
