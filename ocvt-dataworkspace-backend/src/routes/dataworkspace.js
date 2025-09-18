const express = require("express");
const router = express.Router();
const { check, query, param, validationResult } = require("express-validator");
const { authMiddleware, requireRole } = require("../middleware/auth");
const dataworkspaceService = require("../services/dataworkspaceService");
const cleanRoutes = require("./clean");
const filterRoutes = require("./filter");
const aggregateRoutes = require("./aggregate");
const mergeRoutes = require("./merge");
const calculateRoutes = require("./calculate");
const predictRoutes = require("./predict");
const anomaliesRoutes = require("./anomalies");
const clusterRoutes = require("./cluster");
const dashboardRoutes = require("./dashboards");
const validationRoutes = require("./validator");
const publicationRoutes = require("./publisher");
const multer = require("multer");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
}); // Limite à 100 Mo

router.get(
  "/data-sources",
  authMiddleware,
  requireRole(["ROLE_POINT_FOCAL", "ROLE_ADMIN"]),
  async (req, res) => {
    const userId = req.user.id;

    try {
      const result = await dataworkspaceService.listDataSources(userId);
      res.status(200).json(result);
    } catch (error) {
      if (
        error.message ===
        "Aucune source de données trouvée pour cet utilisateur"
      ) {
        return res.status(404).json({ error: error.message });
      }
      res.status(500).json({ error: "Erreur serveur : " + error.message });
    }
  }
);

// GET /data-source-types
router.get(
  "/data-source-types",
  authMiddleware,
  requireRole(["ROLE_POINT_FOCAL", "ROLE_ADMIN"]),
  async (req, res) => {
    try {
      const result = await dataworkspaceService.listDataSourceTypes();
      res.status(200).json(result);
    } catch (error) {
      res.status(500).json({ error: "Erreur serveur : " + error.message });
    }
  }
);

// PATCH /data-source-types/:id/status
router.patch(
  "/data-source-types/:id/status",
  authMiddleware,
  requireRole(["ROLE_ADMIN"]),
  [
    check("id").isInt().withMessage("ID du type de source invalide"),
    check("status")
      .isIn(["active", "inactive"])
      .withMessage("Statut invalide. Valeurs acceptées : active, inactive"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const sourceTypeId = req.params.id;
    const { status } = req.body;

    try {
      const result = await dataworkspaceService.updateSourceTypeStatus(
        sourceTypeId,
        status
      );
      res.status(200).json(result);
    } catch (error) {
      if (error.message.includes("Type de source non trouvé")) {
        return res.status(404).json({ error: error.message });
      }
      if (error.message.includes("Statut invalide")) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: "Erreur serveur : " + error.message });
    }
  }
);

// POST /data-sources
router.post(
  "/data-sources",
  authMiddleware,
  requireRole(["ROLE_POINT_FOCAL"]),
  upload.single("file"),
  [
    check("type")
      .isIn(["file", "database", "api"])
      .withMessage(
        "Type de source invalide. Valeurs acceptées : file, database, api"
      ),
    check("description")
      .notEmpty()
      .withMessage("La description de la source est requise"),
    check("metadata")
      .if((value, { req }) => req.body.type !== "file")
      .notEmpty()
      .withMessage("Les détails de connexion sont requis pour database et api"),
    check("metadata")
      .if((value, { req }) => req.body.type === "database")
      .custom((value) => {
        const details = typeof value === "string" ? JSON.parse(value) : value;
        if (
          !details.host ||
          !details.dialect ||
          !details.username ||
          !details.password ||
          !details.dbname
        ) {
          throw new Error(
            "Tous les champs sont requis pour database : host, dialect, username, password, dbname"
          );
        }
        const validDialects = [
          "mysql",
          "postgres",
          "sqlite",
          "mariadb",
          "mongodb",
        ];
        if (!validDialects.includes(details.dialect)) {
          throw new Error(
            "Dialecte invalide. Valeurs acceptées : mysql, postgres, sqlite, mariadb, mongodb"
          );
        }
        return true;
      }),
    check("metadata")
      .if((value, { req }) => req.body.type === "api")
      .custom((value) => {
        const details = typeof value === "string" ? JSON.parse(value) : value;
        if (!details.url) {
          throw new Error("L'URL est requise pour api");
        }
        try {
          new URL(details.url);
        } catch {
          throw new Error("L'URL fournie est invalide");
        }
        if (details.credentials) {
          if (
            !(
              (details.credentials.username && details.credentials.password) ||
              details.credentials.api_key
            )
          ) {
            throw new Error(
              "Les credentials doivent inclure username/password ou api_key"
            );
          }
        }
        return true;
      }),
    check("file")
      .if((value, { req }) => req.body.type === "file")
      .custom((value, { req }) => {
        if (!req.file) {
          throw new Error("Un fichier est requis pour le type file");
        }
        return true;
      }),
    check("is_final")
      .optional()
      .isBoolean()
      .withMessage("Le paramètre is_final doit être un booléen")
      .toBoolean(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    let { type, description, metadata, is_final } = req.body;
    const file = req.file;
    const userId = req.user.id;

    if (type === "api" || type === "database") {
      is_final = false;
    }
    if (type === "file" && is_final == null) {
      return res
        .status(400)
        .json({ error: "Le paramètre is_final est requis pour le type file" });
    }
    try {
      const result = await dataworkspaceService.addDataSource(
        userId,
        type,
        description,
        file,
        metadata ? JSON.parse(metadata) : null,
        is_final
      );
      res.status(201).json(result);
    } catch (error) {
      if (
        error.message.includes("Type de source invalide") ||
        error.message.includes("La description de la source est requise") ||
        error.message.includes("Un fichier est requis") ||
        error.message.includes("Format de fichier non pris en charge") ||
        error.message.includes("Les détails de connexion sont requis") ||
        error.message.includes("Tous les champs sont requis") ||
        error.message.includes("Dialecte invalide") ||
        error.message.includes("L'URL est requise") ||
        error.message.includes("L'URL fournie est invalide") ||
        error.message.includes("Les credentials doivent inclure") ||
        error.message.includes("Le paramètre is_final doit être un booléen")
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
  requireRole(["ROLE_POINT_FOCAL", "ROLE_ADMIN"]),
  [
    param("source_id").isInt().withMessage("ID de la source invalide"),
    query("is_final")
      .isBoolean()
      .withMessage("Le paramètre is_final doit être un booléen")
      .toBoolean(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { source_id } = req.params;
    const userId = req.user.id;
    const isFinal = req.query.is_final === "true" ? true : false;
    try {
      const result = await dataworkspaceService.deleteDataSource(
        userId,
        source_id,
        isFinal
      );
      res.status(200).json(result);
    } catch (error) {
      if (error.message.includes("non trouvée ou non autorisée")) {
        return res.status(404).json({ error: error.message });
      }
      res.status(500).json({ error: "Erreur serveur : " + error.message });
    }
  }
);

router.get(
  "/data-sources/:source_id/data",
  authMiddleware,
  requireRole(["ROLE_POINT_FOCAL", "ROLE_ADMIN"]),
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

// GET /supported-database-types
router.get(
  "/supported-database-types",
  authMiddleware,
  requireRole(["ROLE_POINT_FOCAL", "ROLE_ADMIN"]),
  async (req, res) => {
    try {
      const result = await dataworkspaceService.listSupportedDatabaseTypes();
      res.status(200).json(result);
    } catch (error) {
      res.status(500).json({ error: "Erreur serveur : " + error.message });
    }
  }
);

// GET /supported-file-extensions
router.get(
  "/supported-file-extensions",
  authMiddleware,
  requireRole(["ROLE_POINT_FOCAL", "ROLE_ADMIN"]),
  async (req, res) => {
    try {
      const result = await dataworkspaceService.listSupportedFileExtensions();
      res.status(200).json(result);
    } catch (error) {
      res.status(500).json({ error: "Erreur serveur : " + error.message });
    }
  }
);

// GET /supported-charts
router.get(
  "/supported-charts",
  authMiddleware,
  requireRole(["ROLE_POINT_FOCAL", "ROLE_ADMIN"]),
  async (req, res) => {
    try {
      const result = await dataworkspaceService.listSupportedCharts();
      res.status(200).json(result);
    } catch (error) {
      res.status(500).json({ error: "Erreur serveur : " + error.message });
    }
  }
);

// GET /data-sources/:source_id/tables
router.get(
  "/data-sources/:source_id/tables",
  authMiddleware,
  requireRole(["ROLE_POINT_FOCAL", "ROLE_ADMIN"]),
  [param("source_id").isInt().withMessage("ID de la source invalide")],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { source_id } = req.params;
    try {
      const result = await dataworkspaceService.listTablesOfDatabaseSource(
        source_id
      );
      res.status(200).json(result);
    } catch (error) {
      if (
        error.message.includes(
          "Source finale de type base de données non trouvée"
        ) ||
        error.message.includes(
          "Source non-finale de type base de données non trouvée"
        )
      ) {
        return res.status(404).json({ error: error.message });
      }
      res.status(500).json({ error: "Erreur serveur : " + error.message });
    }
  }
);

// GET /data-sources/:source_id/tables/:table_name/columns
router.get(
  "/data-sources/:source_id/tables/:table_name/columns",
  authMiddleware,
  requireRole(["ROLE_POINT_FOCAL", "ROLE_ADMIN"]),
  [
    param("source_id").isInt().withMessage("ID de la source invalide"),
    param("table_name").notEmpty().withMessage("Le nom de la table est requis"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { source_id, table_name } = req.params;
    try {
      const result = await dataworkspaceService.listColumnsOfTable(
        source_id,
        table_name
      );
      res.status(200).json(result);
    } catch (error) {
      if (
        error.message.includes(
          "Source finale de type base de données non trouvée"
        ) ||
        error.message.includes(
          "Source non-finale de type base de données non trouvée"
        )
      ) {
        return res.status(404).json({ error: error.message });
      }
      res.status(500).json({ error: "Erreur serveur : " + error.message });
    }
  }
);

router.get(
  "/data-sources/:source_id/tables/with-columns-and-count",
  authMiddleware,
  requireRole(["ROLE_POINT_FOCAL", "ROLE_ADMIN"]),
  [param("source_id").isInt().withMessage("ID de la source invalide")],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { source_id } = req.params;
    try {
      const result = await dataworkspaceService.listTablesWithColumnsAndCount(
        source_id
      );
      res.status(200).json(result);
    } catch (error) {
      res.status(500).json({ error: "Erreur serveur : " + error.message });
    }
  }
);

// Créer l'état initial (version 0) pour une source (DB ou fichier)
router.post(
  "/processing-states/initial",
  authMiddleware,
  requireRole(["ROLE_POINT_FOCAL"]),
  [
    check("sourceId").isInt().withMessage("ID de la source requis"),
    check("columns").isArray({ min: 1 }).withMessage("Colonnes requises"),
    check("tableName").optional().isString(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const userId = req.user.id;
    const { sourceId, columns, tableName } = req.body;
    try {
      const result = await dataworkspaceService.createInitialProcessingState({
        userId,
        sourceId,
        columns,
        tableName,
      });
      res.status(201).json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// GET /processing-states/initial/:sourceId
// Récupère l'état initial (version 0) d'une source, lit le CSV et retourne le
// JSON (avec limite/offset)
router.get(
  "/processing-states/initial/:sourceId",
  authMiddleware,
  requireRole(["ROLE_POINT_FOCAL"]),
  [
    param("sourceId").isInt().withMessage("ID de la source requis"),
    query("limit").optional().isInt({ min: 1 }),
    query("offset").optional().isInt({ min: 0 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const userId = req.user.id;
    const sourceId = parseInt(req.params.sourceId);
    const limit = req.query.limit ? parseInt(req.query.limit) : 100;
    const offset = req.query.offset ? parseInt(req.query.offset) : 0;
    try {
      const result = await dataworkspaceService.getInitialStateAsJson({
        userId,
        sourceId,
        limit,
        offset,
      });
      res.status(200).json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// POST /processing-states/preview
// Prévisualise les données d'une source pour les colonnes sélectionnées (DB ou
// fichier)
router.post(
  "/processing-states/preview",
  authMiddleware,
  requireRole(["ROLE_POINT_FOCAL", "ROLE_ADMIN"]),
  [
    check("sourceId").isInt().withMessage("ID de la source requis"),
    check("columns").isArray({ min: 1 }).withMessage("Colonnes requises"),
    check("tableName").optional().isString(),
    check("limit").optional().isInt({ min: 1 }),
    check("offset").optional().isInt({ min: 0 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const userId = req.user.id;
    const { sourceId, columns, tableName, limit, offset } = req.body;
    try {
      const result = await dataworkspaceService.previewSelectedColumns({
        userId,
        sourceId,
        columns,
        tableName,
        limit,
        offset,
      });
      res.status(200).json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// GET /processing-states/:stateId/history
// Récupère l'historique des traitements (états enfants d'un stateId)
router.get(
  "/processing-states/:stateId/history",
  authMiddleware,
  requireRole(["ROLE_POINT_FOCAL", "ROLE_ADMIN"]),
  [param("stateId").isInt().withMessage("ID de l'état requis")],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const stateId = parseInt(req.params.stateId);
    try {
      const result = await dataworkspaceService.getProcessingStateHistory({
        stateId,
      });
      res.status(200).json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// GET /processing-states/contents/:stateId
// Récupère le contenu d'un état de traitement (JSON ou CSV)
router.get(
  "/processing-states/contents/:stateId",
  authMiddleware,
  requireRole(["ROLE_POINT_FOCAL", "ROLE_ADMIN"]),
  [
    param("stateId").isInt().withMessage("ID de l'état requis"),
    // query("limit").optional().isInt({ min: 1 }),
    // query("offset").optional().isInt({ min: 0 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    // const userId = req.user.id;
    const stateId = parseInt(req.params.stateId);
    // const limit = req.query.limit ? parseInt(req.query.limit) : 100;
    // const offset = req.query.offset ? parseInt(req.query.offset) : 0;
    try {
      const result = await dataworkspaceService.getStateContentsAsJson({
        // userId,
        stateId,
        // limit,
        // offset,
      });
      res.status(200).json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// GET /processing-history/:nonFinalSourceId
// Récupère l'historique complet des traitements pour une source non-finale
router.get(
  "/processing-history/:nonFinalSourceId",
  authMiddleware,
  requireRole(["ROLE_POINT_FOCAL", "ROLE_ADMIN"]),
  [param("nonFinalSourceId").isInt().withMessage("ID de la source requis")],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const nonFinalSourceId = parseInt(req.params.nonFinalSourceId);
    try {
      const result = await dataworkspaceService.getFullProcessingHistory(
        nonFinalSourceId
      );
      res.status(200).json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

router.use("/clean", cleanRoutes);
router.use("/filter", filterRoutes);
router.use("/aggregate", aggregateRoutes);
router.use("/calculate", calculateRoutes);
router.use("/predict", predictRoutes);
router.use("/anomalies", anomaliesRoutes);
router.use("/cluster", clusterRoutes);
router.use("/merge", mergeRoutes);
router.use("/dashboards", dashboardRoutes);
router.use("/validation", validationRoutes);
router.use("/publication", publicationRoutes);

module.exports = router;
