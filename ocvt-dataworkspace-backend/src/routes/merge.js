const express = require("express");
const router = express.Router();
const { check, validationResult } = require("express-validator");
const { authMiddleware, requireRole } = require("../middleware/auth");
const mergeService = require("../services/mergeService");

router.post(
  "/",
  authMiddleware,
  requireRole(["PROCESS_DATA"]),
  [
    check("state_ids")
      .isArray()
      .withMessage("state_ids doit être un tableau")
      .notEmpty()
      .withMessage("state_ids ne peut pas être vide")
      .custom((value, { req }) => {
        // value.forEach((ds, index) => {
        //   if (!ds.dataset_id || !Number.isInteger(ds.dataset_id)) {
        //     throw new Error(
        //       `datasets[${index}].dataset_id est requis et doit être un entier`
        //     );
        //   }
        // });
        value.forEach((id, index) => {
          if (!id || !Number.isInteger(id)) {
            throw new Error(
              `state_ids[${index}] est requis et doit être un entier`
            );
          }
        });
        return true;
      }),
    check("key_mappings")
      .isObject()
      .withMessage("key_mappings doit être un objet")
      .notEmpty()
      .withMessage("key_mappings ne peut pas être vide")
      .custom((value, { req }) => {
        const state_ids = req.body.state_ids.map((ds) => ds.toString());
        for (const key in value) {
          if (!state_ids.includes(key)) {
            throw new Error(
              `key_mappings contient une clé (${key}) qui ne correspond à aucun state_id fourni`
            );
          }
          if (typeof value[key] !== "string" || value[key].trim() === "") {
            throw new Error(
              `La valeur de key_mappings pour le dataset de l'état ${key} doit être une chaîne non vide`
            );
          }
        }
        if (Object.keys(value).length !== state_ids.length) {
          throw new Error(
            "key_mappings doit contenir une entrée pour chaque state_id fourni"
          );
        }
        return true;
      }),
    check("merge_type")
      .isIn(["inner", "left", "right", "outer"])
      .withMessage(
        "merge_type invalide. Valeurs acceptées : inner, left, right, outer"
      ),
    check("output_format")
      .isIn(["csv", "excel", "json"])
      .withMessage(
        "Format de sortie invalide. Valeurs acceptées : csv, excel, json"
      ),
    check("duplicate_handling")
      .optional()
      .isIn(["keep_first", "keep_last", "drop_duplicates"])
      .withMessage(
        "duplicate_handling invalide. Valeurs acceptées : keep_first, keep_last, drop_duplicates"
      ),
    check("suffixes")
      .optional()
      .isArray()
      .withMessage("suffixes doit être un tableau de chaînes")
      .custom((value, { req }) => {
        if (value && value.length < req.body.state_ids.length) {
          throw new Error(
            "Le nombre de suffixes doit être égal ou supérieur au nombre de datasets"
          );
        }
        return true;
      }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      state_ids,
      key_mappings,
      merge_type,
      output_format,
      duplicate_handling,
      suffixes,
    } = req.body;
    const userId = req.user.id;

    try {
      const result = await mergeService.mergeDatasets(
        userId,
        state_ids,
        key_mappings,
        merge_type,
        output_format,
        duplicate_handling,
        suffixes
      );
      res.status(200).json(result);
    } catch (error) {
      // console.error("Erreur dans la route de fusion:", error);
      if (
        error.message.includes("Dataset non trouvé") ||
        error.message.includes("Format non supporté") ||
        error.message.includes("Type de fusion non supporté") ||
        error.message.includes("Clés de fusion manquantes") ||
        error.message.includes("Nombre de suffixes insuffisant") ||
        error.message.includes("introuvable dans le dataset") ||
        error.message.includes("Erreur lors de la fusion") ||
        error.message.includes("Format de sortie invalide")
      ) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: "Erreur serveur : " + error.message });
    }
  }
);

module.exports = router;
