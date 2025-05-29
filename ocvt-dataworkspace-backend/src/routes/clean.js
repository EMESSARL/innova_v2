const express = require("express");
const router = express.Router();
const { check, validationResult } = require("express-validator");
const { authMiddleware, requireRole } = require("../middleware/auth");
const cleanService = require("../services/cleanService");

router.post(
  "/",
  // authMiddleware,
  // requireRole(["ROLE_POINT_FOCAL", "ROLE_ADMIN"]),
  [
    check("dataset_id").isInt().withMessage("ID du dataset invalide"),
    check("cleaning_actions")
      .isObject()
      .withMessage("Les actions de nettoyage doivent être un objet"),
    check("keep_original")
      .optional()
      .isBoolean()
      .withMessage("keep_original doit être un booléen"),
    check("output_format")
      .isIn(["csv", "excel", "json"])
      .withMessage(
        "Format de sortie invalide. Valeurs acceptées : csv, excel, json"
      ),

    // Validations pour remove_duplicates
    check("cleaning_actions.remove_duplicates")
      .optional()
      .isObject()
      .withMessage("remove_duplicates doit être un objet si présent")
      .custom((value, { req }) => {
        if (value) {
          if (!Array.isArray(value.columns) || value.columns.length === 0) {
            throw new Error(
              "remove_duplicates.columns est requis et doit être un tableau non vide"
            );
          }
          if (!["keep_first", "keep_last", "drop"].includes(value.action)) {
            throw new Error(
              "remove_duplicates.action invalide. Valeurs acceptées : keep_first, keep_last, drop"
            );
          }
          if (value.condition) {
            if (
              typeof value.condition !== "object" ||
              !value.condition.column ||
              !["earliest", "latest"].includes(value.condition.keep)
            ) {
              throw new Error(
                "remove_duplicates.condition doit être un objet avec 'column' et 'keep' (earliest/latest)"
              );
            }
          }
        }
        return true;
      }),

    // Validations pour handle_missing
    check("cleaning_actions.handle_missing")
      .optional()
      .isObject()
      .withMessage("handle_missing doit être un objet si présent")
      .custom((value, { req }) => {
        if (value) {
          for (const col in value) {
            const action = value[col];
            if (!action || typeof action !== "object" || !action.action) {
              throw new Error(
                `handle_missing.${col} doit être un objet avec 'action'`
              );
            }
            if (
              !["drop", "mean", "median", "mode", "custom"].includes(
                action.action
              )
            ) {
              throw new Error(
                `handle_missing.${col}.action invalide. Valeurs acceptées : drop, mean, median, mode, custom`
              );
            }
            if (action.action === "custom" && action.value === undefined) {
              throw new Error(
                `handle_missing.${col}.value est requis pour l'action 'custom'`
              );
            }
          }
        }
        return true;
      }),

    // Validations pour text_cleaning
    check("cleaning_actions.text_cleaning")
      .optional()
      .isObject()
      .withMessage("text_cleaning doit être un objet si présent")
      .custom((value, { req }) => {
        if (value) {
          for (const col in value) {
            const cleaning = value[col];
            if (
              !cleaning ||
              typeof cleaning !== "object" ||
              !Array.isArray(cleaning.operations) ||
              cleaning.operations.length === 0
            ) {
              throw new Error(
                `text_cleaning.${col} doit être un objet avec un tableau non vide 'operations'`
              );
            }
            const validOperations = [
              "trim",
              "to_lower",
              "to_upper",
              "remove_special_chars",
            ];
            if (
              !cleaning.operations.every((op) => validOperations.includes(op))
            ) {
              throw new Error(
                `text_cleaning.${col}.operations contient des opérations invalides. Valeurs acceptées : ${validOperations.join(
                  ", "
                )}`
              );
            }
          }
        }
        return true;
      }),

    // Validations pour transformations
    check("cleaning_actions.transformations")
      .optional()
      .isObject()
      .withMessage("transformations doit être un objet si présent")
      .custom((value, { req }) => {
        if (value) {
          for (const col in value) {
            const transform = value[col];
            if (
              !transform ||
              typeof transform !== "object" ||
              !transform.action
            ) {
              throw new Error(
                `transformations.${col} doit être un objet avec 'action'`
              );
            }
            const validActions = [
              "to_int",
              "to_float",
              "to_string",
              "log",
              "to_date",
            ];
            if (!validActions.includes(transform.action)) {
              throw new Error(
                `transformations.${col}.action invalide. Valeurs acceptées : ${validActions.join(
                  ", "
                )}`
              );
            }
            if (
              transform.action === "log" &&
              transform.base !== undefined &&
              typeof transform.base !== "number"
            ) {
              throw new Error(
                `transformations.${col}.base doit être un nombre pour l'action 'log'`
              );
            }
          }
        }
        return true;
      }),

    // Validations pour outlier_handling
    check("cleaning_actions.outlier_handling")
      .optional()
      .isObject()
      .withMessage("outlier_handling doit être un objet si présent")
      .custom((value, { req }) => {
        if (value) {
          for (const col in value) {
            const handling = value[col];
            if (
              !handling ||
              typeof handling !== "object" ||
              !handling.method ||
              !handling.action
            ) {
              throw new Error(
                `outlier_handling.${col} doit être un objet avec 'method' et 'action'`
              );
            }
            if (!["IQR", "z-score"].includes(handling.method)) {
              throw new Error(
                `outlier_handling.${col}.method invalide. Valeurs acceptées : IQR, z-score`
              );
            }
            if (!["clip", "drop"].includes(handling.action)) {
              throw new Error(
                `outlier_handling.${col}.action invalide. Valeurs acceptées : clip, drop`
              );
            }
            if (
              handling.method === "z-score" &&
              handling.threshold !== undefined &&
              typeof handling.threshold !== "number"
            ) {
              throw new Error(
                `outlier_handling.${col}.threshold doit être un nombre pour la méthode 'z-score'`
              );
            }
          }
        }
        return true;
      }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { dataset_id, cleaning_actions, keep_original, output_format } =
      req.body;
    // const userId = req.user.id;
    const userId = "user123";

    try {
      const result = await cleanService.cleanDataset(
        userId,
        dataset_id,
        cleaning_actions,
        keep_original,
        output_format
      );
      res.status(200).json(result);
    } catch (error) {
      // console.error("Erreur dans la route de nettoyage:", error);
      if (
        error.message.includes("Dataset non trouvé") ||
        error.message.includes("Format non supporté") ||
        error.message.includes("Colonnes pour doublons introuvables") ||
        error.message.includes("Action de doublons invalide") ||
        error.message.includes("Colonne introuvable") ||
        error.message.includes("Action invalide") ||
        error.message.includes("Valeur personnalisée requise") ||
        error.message.includes("Colonne doit être textuelle") ||
        error.message.includes("Opération invalide") ||
        error.message.includes("Colonne doit être numérique") ||
        error.message.includes("Méthode invalide") ||
        error.message.includes("Écart-type nul") ||
        error.message.includes(
          "Colonne doit être numérique et positive pour log"
        ) ||
        error.message.includes("Format de sortie invalide")
      ) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: "Erreur serveur : " + error.message });
    }
  }
);

module.exports = router;
