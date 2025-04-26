const express = require("express");
const router = express.Router();
const { check, query, param, validationResult } = require("express-validator");
const { authMiddleware, requireRole } = require("../middleware/auth");
const dataworkspaceService = require("../services/dataworkspaceService");
const multer = require("multer");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
}); // Limite à 100 Mo

router.get("/data-sources", authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await dataworkspaceService.listDataSources(userId);
    res.status(200).json(result);
  } catch (error) {
    if (
      error.message === "Aucune source de données trouvée pour cet utilisateur"
    ) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: "Erreur serveur : " + error.message });
  }
});

router.post(
  "/data-sources",
  authMiddleware,
  upload.single("file"),
  [
    check("type")
      .isIn(["file", "database", "api"])
      .withMessage(
        "Type de source invalide. Valeurs acceptées : file, database, api"
      ),
    check("name").notEmpty().withMessage("Le nom de la source est requis"),
    check("connection_details")
      .optional()
      .isObject()
      .withMessage("Les détails de connexion doivent être un objet"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { type, name, connection_details } = req.body;
    const file = req.file;
    const userId = req.user.id;

    try {
      const result = await dataworkspaceService.addDataSource(
        userId,
        type,
        name,
        file,
        connection_details ? JSON.parse(connection_details) : null
      );
      res.status(201).json(result);
    } catch (error) {
      if (
        error.message.includes("Type de source invalide") ||
        error.message.includes("Le nom de la source est requis") ||
        error.message.includes("Un fichier est requis") ||
        error.message.includes("Format de fichier non pris en charge") ||
        error.message.includes("URL et identifiants sont requis") ||
        error.message.includes("URL est requise")
      ) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: "Erreur serveur : " + error.message });
    }
  }
);

router.delete(
  "/data-sources/:source_id",
  authMiddleware,
  [param("source_id").isInt().withMessage("ID de la source invalide")],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { source_id } = req.params;
    const userId = req.user.id;

    try {
      const result = await dataworkspaceService.deleteDataSource(
        userId,
        source_id
      );
      res.status(200).json(result);
    } catch (error) {
      if (error.message === "Source de données non trouvée ou non autorisée") {
        return res.status(404).json({ error: error.message });
      }
      res.status(500).json({ error: "Erreur serveur : " + error.message });
    }
  }
);

router.get(
  "/data-sources/:source_id/data",
  authMiddleware,
  [
    param("source_id").isInt().withMessage("ID de la source invalide"),
    query("limit")
      .optional()
      .isInt({ min: 1 })
      .withMessage("La limite doit être un entier positif"),
    query("offset")
      .optional()
      .isInt({ min: 0 })
      .withMessage("L'offset doit être un entier positif ou zéro"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { source_id } = req.params;
    const { limit = 10, offset = 0 } = req.query;
    const userId = req.user.id;

    try {
      const result = await dataworkspaceService.loadDataFromSource(
        userId,
        source_id,
        parseInt(limit),
        parseInt(offset)
      );
      res.status(200).json(result);
    } catch (error) {
      if (
        error.message === "Source de données non trouvée ou non autorisée" ||
        error.message === "Aucun jeu de données associé à cette source"
      ) {
        return res.status(404).json({ error: error.message });
      }
      if (error.message === "Format de données non pris en charge") {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: "Erreur serveur : " + error.message });
    }
  }
);

router.post(
  "/data-transformations",
  authMiddleware,
  [
    check("source_id").isInt().withMessage("ID de la source invalide"),
    check("transformation_type")
      .isIn(["clean", "filter", "aggregate", "compute"])
      .withMessage(
        "Type de transformation invalide. Valeurs acceptées : clean, filter, aggregate, compute"
      ),
    check("parameters")
      .isObject()
      .withMessage("Les paramètres doivent être un objet"),
    // Validations spécifiques par type de transformation
    check("parameters").custom((parameters, { req }) => {
      const { transformation_type } = req.body;
      if (transformation_type === "clean") {
        if (!parameters.remove_duplicates && !parameters.handle_missing) {
          throw new Error("remove_duplicates et/ou handle_missing requis");
        }
        if (
          parameters.remove_duplicates !== undefined &&
          typeof parameters.remove_duplicates !== "boolean"
        ) {
          throw new Error("remove_duplicates doit être un booléen");
        }
        if (parameters.handle_missing) {
          if (!["drop", "fill"].includes(parameters.handle_missing.method)) {
            throw new Error(
              "La méthode de gestion des valeurs manquantes doit être 'drop' ou 'fill'"
            );
          }
          if (
            parameters.handle_missing.method === "fill" &&
            parameters.handle_missing.value === undefined
          ) {
            throw new Error(
              "Une valeur de remplacement est requise pour 'fill'"
            );
          }
        }
      } else if (transformation_type === "filter") {
        if (!parameters.criteria) {
          throw new Error("Critères de filtrage requis");
        }
        if (
          !parameters.criteria.column ||
          !parameters.criteria.operator ||
          parameters.criteria.value === undefined
        ) {
          throw new Error(
            "Les critères doivent inclure column, operator et value"
          );
        }
        if (
          !["eq", "gt", "lt", "geq", "leq", "neq"].includes(
            parameters.criteria.operator
          )
        ) {
          throw new Error("Opérateur de filtrage invalide");
        }
      } else if (transformation_type === "aggregate") {
        if (!parameters.group_by || !Array.isArray(parameters.group_by)) {
          throw new Error("group_by doit être un tableau");
        }
        if (
          !parameters.aggregations ||
          !Array.isArray(parameters.aggregations)
        ) {
          throw new Error("aggregations doit être un tableau");
        }
        for (const agg of parameters.aggregations) {
          if (
            !agg.column ||
            !agg.function ||
            !agg.output_column ||
            !["sum", "avg", "min", "max", "count"].includes(agg.function)
          ) {
            throw new Error(
              "Chaque agrégation doit avoir column, function (sum, avg, min, max, count) et output_column"
            );
          }
        }
      }
      // else if (transformation_type === "compute") {
      //   if (
      //     !parameters.new_column ||
      //     !parameters.new_column.name ||
      //     !parameters.new_column.formula
      //   ) {
      //     throw new Error("new_column doit inclure name et formula");
      //   }
      // }
      return true;
    }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { source_id, transformation_type, parameters } = req.body;
    const userId = req.user.id;

    try {
      const result = await dataworkspaceService.applyDataTransformation(
        userId,
        source_id,
        transformation_type,
        parameters
      );
      res.status(201).json(result);
    } catch (error) {
      if (
        error.message.includes("Source de données non trouvée") ||
        error.message.includes("Aucun jeu de données associé")
      ) {
        return res.status(404).json({ error: error.message });
      }
      if (
        error.message.includes("Type de transformation invalide") ||
        error.message.includes("Format de données non pris en charge") ||
        error.message.includes("Critères de filtrage requis") ||
        error.message.includes("Paramètres group_by et aggregations requis") ||
        error.message.includes("Paramètres new_column requis")
      ) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: "Erreur serveur : " + error.message });
    }
  }
);

router.post(
  "/data-analyses",
  authMiddleware,
  [
    check("source_id").isInt().withMessage("ID de la source invalide"),
    check("analysis_type")
      .isIn(["stats", "prediction", "anomaly", "clustering"])
      .withMessage(
        "Type d'analyse invalide. Valeurs acceptées : stats, prediction, anomaly, clustering"
      ),
    check("parameters")
      .isObject()
      .withMessage("Les paramètres doivent être un objet"),
    check("parameters").custom((parameters, { req }) => {
      const { analysis_type } = req.body;
      if (analysis_type === "stats") {
        if (!parameters.columns || !Array.isArray(parameters.columns)) {
          throw new Error("Colonnes à analyser requises");
        }
      } else if (analysis_type === "prediction") {
        if (
          !parameters.features ||
          !Array.isArray(parameters.features) ||
          !parameters.target ||
          !parameters.model_type ||
          !["regression", "classification"].includes(parameters.model_type)
        ) {
          throw new Error(
            "Paramètres features (tableau), target (chaîne) et model_type (regression/classification) requis"
          );
        }
      } else if (analysis_type === "anomaly") {
        if (
          !parameters.columns ||
          !Array.isArray(parameters.columns) ||
          !parameters.method ||
          !["zscore"].includes(parameters.method)
        ) {
          throw new Error("Colonnes (tableau) et méthode (zscore) requises");
        }
        if (parameters.threshold && typeof parameters.threshold !== "number") {
          throw new Error("Le seuil doit être un nombre");
        }
        if (parameters.threshold <= 0) {
          throw new Error("Le seuil doit être un nombre strictement positif");
        }
      } else if (analysis_type === "clustering") {
        if (
          !parameters.columns ||
          !Array.isArray(parameters.columns) ||
          !parameters.k ||
          !Number.isInteger(parameters.k) ||
          parameters.k <= 0
        ) {
          throw new Error("Colonnes (tableau) et k (entier positif) requis");
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

    const { source_id, analysis_type, parameters } = req.body;
    const userId = req.user.id;

    try {
      const result = await dataworkspaceService.performDataAnalysis(
        userId,
        source_id,
        analysis_type,
        parameters
      );
      res.status(200).json(result);
    } catch (error) {
      if (
        error.message.includes("Source de données non trouvée") ||
        error.message.includes("Aucun jeu de données associé")
      ) {
        return res.status(404).json({ error: error.message });
      }
      if (
        error.message.includes("Type d'analyse invalide") ||
        error.message.includes("Format de données non pris en charge") ||
        error.message.includes("Colonnes à analyser requises") ||
        error.message.includes(
          "Paramètres features, target et model_type requis"
        ) ||
        error.message.includes("Colonnes et méthode requises") ||
        error.message.includes("Colonnes et nombre de clusters (k) requis") ||
        error.message.includes(
          "Méthode de détection d'anomalies non prise en charge"
        )
      ) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: "Erreur serveur : " + error.message });
    }
  }
);

router.post(
  "/results",
  authMiddleware,
  upload.any(),
  [
    check("source_id").isInt().withMessage("ID de la source invalide"),
    check("result_type")
      .isIn(["image", "report", "json", "geojson", "shapefile"])
      .withMessage(
        "Type de résultat invalide. Valeurs acceptées : image, report, json, geojson, shapefile"
      ),
    check("files").custom((value, { req }) => {
      if (!req.files || req.files.length === 0) {
        throw new Error("Au moins un fichier est requis");
      }
      return true;
    }),
  ],
  async (req, res) => {
    if (req.body.config) {
      try {
        req.body.config = JSON.parse(req.body.config);
      } catch (e) {
        return res
          .status(400)
          .json({ error: "La configuration doit être un objet" });
      }
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { source_id, result_type, config } = req.body;
    const userId = req.user.id;
    const files = req.files;

    try {
      const result = await dataworkspaceService.saveResult(
        userId,
        source_id,
        result_type,
        config,
        files
      );
      res.status(200).json(result);
    } catch (error) {
      if (
        error.message.includes("Source de données non trouvée") ||
        error.message.includes("Aucun jeu de données associé")
      ) {
        return res.status(404).json({ error: error.message });
      }
      if (
        error.message.includes("Type de résultat invalide") ||
        error.message.includes("MIME type invalide") ||
        error.message.includes("Type de fichier invalide") ||
        error.message.includes("Au moins un fichier est requis") ||
        error.message.includes("Un shapefile doit inclure") ||
        error.message.includes("Le fichier ZIP doit contenir") ||
        error.message.includes(
          "Trop de fichiers pour un résultat non-shapefile"
        ) ||
        error.message.includes(
          "Le format des données initiales est shapefile"
        ) ||
        error.message.includes(
          "Le format des données initiales n'est pas shapefile"
        )
      ) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: "Erreur serveur : " + error.message });
    }
  }
);

router.get(
  "/results/:id/download",
  authMiddleware,
  [check("id").isInt().withMessage("ID du résultat invalide")],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const resultId = req.params.id;
    const userId = req.user.id;

    try {
      const result = await dataworkspaceService.downloadResult(
        userId,
        resultId
      );
      res.status(200).json(result);
    } catch (error) {
      if (error.message.includes("Résultat non trouvé")) {
        return res.status(404).json({ error: error.message });
      }
      res.status(500).json({ error: "Erreur serveur : " + error.message });
    }
  }
);

router.post(
  "/submissions",
  authMiddleware,
  [
    check("dataset_id")
      .optional()
      .isInt()
      .withMessage("dataset_id doit être un entier"),
    check("result_id")
      .optional()
      .isInt()
      .withMessage("result_id doit être un entier"),
    check("comments")
      .optional()
      .isString()
      .withMessage("comments doit être une chaîne"),
    check().custom((value, { req }) => {
      if (!req.body.dataset_id && !req.body.result_id) {
        throw new Error("Au moins un dataset_id ou result_id est requis");
      }
      return true;
    }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { dataset_id, result_id, comments } = req.body;
    const userId = req.user.id;

    try {
      const result = await dataworkspaceService.submitResult(
        userId,
        dataset_id,
        result_id,
        comments
      );
      res.status(200).json(result);
    } catch (error) {
      if (
        error.message.includes("Dataset non trouvé") ||
        error.message.includes("Résultat non trouvé") ||
        error.message.includes("Vous ne pouvez pas") ||
        error.message.includes("Au moins un")
      ) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: "Erreur serveur : " + error.message });
    }
  }
);

router.get(
  "/submissions/:id/status",
  authMiddleware,
  [check("id").isInt().withMessage("ID de la soumission invalide")],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const submissionId = req.params.id;
    const userId = req.user.id;

    try {
      const result = await dataworkspaceService.getSubmissionStatus(
        userId,
        submissionId
      );
      res.status(200).json(result);
    } catch (error) {
      if (error.message.includes("Soumission non trouvée")) {
        return res.status(404).json({ error: error.message });
      }
      res.status(500).json({ error: "Erreur serveur : " + error.message });
    }
  }
);

router.put(
  "/submissions/:id",
  authMiddleware,
  [
    check("id").isInt().withMessage("ID de la soumission invalide"),
    check("dataset_id")
      .optional()
      .isInt()
      .withMessage("dataset_id doit être un entier"),
    check("result_id")
      .optional()
      .isInt()
      .withMessage("result_id doit être un entier"),
    check("comments")
      .optional()
      .isString()
      .withMessage("comments doit être une chaîne"),
    check().custom((value, { req }) => {
      const { dataset_id, result_id, comments } = req.body;
      if (!dataset_id && !result_id && !comments) {
        throw new Error(
          "Au moins un champ à mettre à jour est requis (dataset_id, result_id, comments)"
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

    const submissionId = req.params.id;
    const { dataset_id, result_id, comments } = req.body;
    const userId = req.user.id;

    try {
      const result = await dataworkspaceService.updateSubmission(
        userId,
        submissionId,
        dataset_id,
        result_id,
        comments
      );
      res.status(200).json(result);
    } catch (error) {
      if (
        error.message.includes("Soumission non trouvée") ||
        error.message.includes("Dataset non trouvé") ||
        error.message.includes("Résultat non trouvé")
      ) {
        return res.status(404).json({ error: error.message });
      } else if (
        error.message.includes("Seules les soumissions") ||
        error.message.includes("Au moins un champ") ||
        error.message.includes("Vous ne pouvez pas")
      ) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: "Erreur serveur : " + error.message });
    }
  }
);

// DELETE /submissions/:id
router.delete(
  "/submissions/:id",
  authMiddleware,
  [check("id").isInt().withMessage("ID de la soumission invalide")],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const submissionId = req.params.id;
    const userId = req.user.id;

    try {
      const result = await dataworkspaceService.cancelSubmission(
        userId,
        submissionId
      );
      res.status(200).json(result);
    } catch (error) {
      if (error.message.includes("Soumission non trouvée")) {
        return res.status(404).json({ error: error.message });
      } else if (error.message.includes("Seules les soumissions")) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: "Erreur serveur : " + error.message });
    }
  }
);

router.patch(
  "/submissions/:id/status",
  authMiddleware,
  [
    check("id").isInt().withMessage("ID de la soumission invalide"),
    check("status")
      .isIn(["pending", "approved", "rejected", "revision_requested"])
      .withMessage(
        "Statut invalide. Valeurs acceptées : pending, approved, rejected, revision_requested"
      ),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const submissionId = req.params.id;
    const { status } = req.body;
    const user = req.user;

    try {
      const result = await dataworkspaceService.updateSubmissionStatus(
        user,
        submissionId,
        status
      );
      res.status(200).json(result);
    } catch (error) {
      if (error.message.includes("Soumission non trouvée")) {
        return res.status(404).json({ error: error.message });
      }
      if (
        error.message.includes("Seuls les validateurs") ||
        error.message.includes("Statut invalide")
      ) {
        return res.status(403).json({ error: error.message });
      }
      res.status(500).json({ error: "Erreur serveur : " + error.message });
    }
  }
);

module.exports = router;
