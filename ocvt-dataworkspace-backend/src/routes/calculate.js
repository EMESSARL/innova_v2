const express = require("express");
const router = express.Router();
const { check, validationResult } = require("express-validator");
const { authMiddleware, requireRole } = require("../middleware/auth");
const calculateService = require("../services/calculateService");

router.post(
  "/",
  authMiddleware,
  requireRole(["ROLE_POINT_FOCAL"]),
  [
    check("state_id").isInt().withMessage("ID du dataset invalide"),
    check("new_column_name")
      .notEmpty()
      .withMessage("Le nom de la nouvelle colonne est requis"),
    check("formula").notEmpty().withMessage("La formule est requise"),
    check("custom_functions")
      .optional()
      .isObject()
      .withMessage("custom_functions doit être un objet"),
    check("tests")
      .optional()
      .isArray()
      .withMessage("tests doit être un tableau")
      .custom((value, { req }) => {
        if (value) {
          value.forEach((test, index) => {
            if (!test.input_dict || typeof test.input_dict !== "object") {
              throw new Error(
                `tests[${index}].input_dict est requis et doit être un objet`
              );
            }
            if (!test.expected || typeof test.expected !== "object") {
              throw new Error(
                `tests[${index}].expected est requis et doit être un objet`
              );
            }
          });
        }
        return true;
      }),
    check("overwrite")
      .isBoolean()
      .withMessage("overwrite doit être un booléen"),
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
      state_id,
      new_column_name,
      formula,
      custom_functions,
      tests,
      overwrite,
      output_format,
    } = req.body;
    const userId = req.user.id;

    try {
      const result = await calculateService.calculateColumn(
        userId,
        state_id,
        new_column_name,
        formula,
        custom_functions,
        tests,
        overwrite,
        output_format
      );
      res.status(200).json(result);
    } catch (error) {
      // console.error("Erreur dans la route de calcul de colonne:", error);
      if (
        error.message.includes("Dataset non trouvé") ||
        error.message.includes("Format non supporté") ||
        error.message.includes("La colonne") ||
        error.message.includes("Syntaxe de formule invalide") ||
        error.message.includes("Colonnes référencées introuvables") ||
        error.message.includes("Erreur dans la formule") ||
        error.message.includes("Type de retour invalide") ||
        error.message.includes("Erreur lors de l'évaluation") ||
        error.message.includes("Format de sortie invalide")
      ) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: "Erreur serveur : " + error.message });
    }
  }
);

module.exports = router;
