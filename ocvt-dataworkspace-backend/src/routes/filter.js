const express = require("express");
const router = express.Router();
const { check, validationResult } = require("express-validator");
const { authMiddleware, requireRole } = require("../middleware/auth");
const filterService = require("../services/filterService");

// Fonction utilitaire pour valider une condition simple
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
  if (
    condition.logical_operator &&
    !["AND", "OR"].includes(condition.logical_operator)
  ) {
    throw new Error(
      `${fieldName}.logical_operator invalide. Valeurs acceptées : AND, OR`
    );
  }
  return true;
};

// Fonction utilitaire pour valider les conditions imbriquées
const validateNestedConditions = (nestedConditions, fieldName) => {
  if (!nestedConditions || typeof nestedConditions !== "object") {
    throw new Error(`${fieldName} doit être un objet`);
  }
  if (
    !nestedConditions.logical_operator ||
    !["AND", "OR"].includes(nestedConditions.logical_operator)
  ) {
    throw new Error(
      `${fieldName}.logical_operator est requis et doit être 'AND' ou 'OR'`
    );
  }
  if (
    !Array.isArray(nestedConditions.conditions) ||
    nestedConditions.conditions.length === 0
  ) {
    throw new Error(
      `${fieldName}.conditions est requis et doit être un tableau non vide`
    );
  }

  for (const cond of nestedConditions.conditions) {
    if (cond.logical_operator) {
      // C'est une condition imbriquée
      validateNestedConditions(cond, `${fieldName}.conditions[]`);
    } else {
      // C'est une condition simple
      validateCondition(cond, `${fieldName}.conditions[]`);
    }
  }
  return true;
};

router.post(
  "/",
  // authMiddleware,
  // requireRole(["ROLE_POINT_FOCAL", "ROLE_ADMIN"]),
  [
    check("dataset_id").isInt().withMessage("ID du dataset invalide"),
    check("output_format")
      .isIn(["csv", "excel", "json"])
      .withMessage(
        "Format de sortie invalide. Valeurs acceptées : csv, excel, json"
      ),
    check().custom((value, { req }) => {
      const { conditions, nested_conditions } = req.body;
      if (!conditions && !nested_conditions) {
        throw new Error(
          "Au moins 'conditions' ou 'nested_conditions' est requis pour le filtrage"
        );
      }
      if (conditions) {
        if (!Array.isArray(conditions) || conditions.length === 0) {
          throw new Error("conditions doit être un tableau non vide");
        }
        conditions.forEach((cond, index) =>
          validateCondition(cond, `conditions[${index}]`)
        );
      }
      if (nested_conditions) {
        validateNestedConditions(nested_conditions, "nested_conditions");
      }
      return true;
    }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { dataset_id, conditions, nested_conditions, output_format } =
      req.body;
    // const userId = req.user.id;
    const userId = "user123";

    try {
      const result = await filterService.filterDataset(
        userId,
        dataset_id,
        conditions,
        nested_conditions,
        output_format
      );
      res.status(200).json(result);
    } catch (error) {
      console.error("Erreur dans la route de filtrage:", error);
      if (
        error.message.includes("Dataset non trouvé") ||
        error.message.includes("Format non supporté") ||
        error.message.includes("Colonne introuvable") ||
        error.message.includes("Opérateur non supporté") ||
        error.message.includes("Type incompatible") ||
        error.message.includes("Conditions ou nested_conditions requis") ||
        error.message.includes("Opérateur logique non supporté") ||
        error.message.includes("Aucune condition valide") ||
        error.message.includes("L'opérateur 'regex' nécessite") ||
        error.message.includes("L'opérateur 'between' nécessite")
      ) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: "Erreur serveur : " + error.message });
    }
  }
);

module.exports = router;
