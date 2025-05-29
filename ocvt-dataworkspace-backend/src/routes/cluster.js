const express = require("express");
const router = express.Router();
const { check, validationResult } = require("express-validator");
const { authMiddleware, requireRole } = require("../middleware/auth");
const clusterService = require("../services/clusterService");

router.post(
  "/",
  // authMiddleware,
  // requireRole(["ROLE_POINT_FOCAL", "ROLE_ADMIN"]),
  [
    check("dataset_id").isInt().withMessage("ID du dataset invalide"),
    check("algorithm")
      .isIn(["kmeans", "hierarchical", "dbscan", "optics"])
      .withMessage(
        "Algorithme invalide. Valeurs acceptées : kmeans, hierarchical, dbscan, optics"
      ),
    check("parameters")
      .isObject()
      .withMessage("parameters doit être un objet")
      .custom((value, { req }) => {
        const { algorithm } = req.body;
        if (algorithm === "kmeans") {
          if (
            value.n_clusters &&
            (!Number.isInteger(value.n_clusters) || value.n_clusters <= 0)
          ) {
            throw new Error(
              "parameters.n_clusters doit être un entier positif pour kmeans"
            );
          }
          if (
            value.max_iter &&
            (!Number.isInteger(value.max_iter) || value.max_iter <= 0)
          ) {
            throw new Error(
              "parameters.max_iter doit être un entier positif pour kmeans"
            );
          }
          if (value.init && !["k-means++", "random"].includes(value.init)) {
            throw new Error(
              "parameters.init doit être 'k-means++' ou 'random' pour kmeans"
            );
          }
          if (
            value.n_init &&
            (!Number.isInteger(value.n_init) || value.n_init <= 0)
          ) {
            throw new Error(
              "parameters.n_init doit être un entier positif pour kmeans"
            );
          }
        } else if (algorithm === "hierarchical") {
          if (
            value.n_clusters &&
            (!Number.isInteger(value.n_clusters) || value.n_clusters <= 0)
          ) {
            throw new Error(
              "parameters.n_clusters doit être un entier positif pour hierarchical"
            );
          }
          if (
            value.linkage &&
            !["ward", "complete", "average", "single"].includes(value.linkage)
          ) {
            throw new Error("parameters.linkage invalide pour hierarchical");
          }
          if (
            value.distance_threshold &&
            (typeof value.distance_threshold !== "number" ||
              value.distance_threshold <= 0)
          ) {
            throw new Error(
              "parameters.distance_threshold doit être un nombre positif pour hierarchical"
            );
          }
          if (!value.n_clusters && !value.distance_threshold) {
            throw new Error(
              "parameters.n_clusters ou parameters.distance_threshold est requis pour hierarchical"
            );
          }
        } else if (algorithm === "dbscan") {
          if (value.eps && (typeof value.eps !== "number" || value.eps <= 0)) {
            throw new Error(
              "parameters.eps doit être un nombre positif pour dbscan"
            );
          }
          if (
            value.min_samples &&
            (!Number.isInteger(value.min_samples) || value.min_samples <= 0)
          ) {
            throw new Error(
              "parameters.min_samples doit être un entier positif pour dbscan"
            );
          }
          if (
            value.metric &&
            !["euclidean", "manhattan", "cosine"].includes(value.metric)
          ) {
            throw new Error("parameters.metric invalide pour dbscan");
          }
        } else if (algorithm === "optics") {
          if (
            value.min_samples &&
            (!Number.isInteger(value.min_samples) || value.min_samples <= 0)
          ) {
            throw new Error(
              "parameters.min_samples doit être un entier positif pour optics"
            );
          }
          if (
            value.xi &&
            (typeof value.xi !== "number" || value.xi <= 0 || value.xi >= 1)
          ) {
            throw new Error(
              "parameters.xi doit être un nombre entre 0 et 1 pour optics"
            );
          }
          if (
            value.metric &&
            !["euclidean", "manhattan", "cosine"].includes(value.metric)
          ) {
            throw new Error("parameters.metric invalide pour optics");
          }
        }
        return true;
      }),
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
          const validDimReduction = ["none", "PCA", "t-SNE", "UMAP"];
          if (
            value.dimensionality_reduction &&
            !validDimReduction.includes(value.dimensionality_reduction)
          ) {
            throw new Error(
              `preprocessing.dimensionality_reduction invalide. Valeurs acceptées : ${validDimReduction.join(
                ", "
              )}`
            );
          }
          if (
            value.n_components &&
            (!Number.isInteger(value.n_components) || value.n_components <= 0)
          ) {
            throw new Error(
              "preprocessing.n_components doit être un entier positif"
            );
          }
        }
        return true;
      }),
    check("features")
      .optional()
      .isArray()
      .withMessage("features doit être un tableau de chaînes"),
    check("auto_cluster_selection")
      .isBoolean()
      .withMessage("auto_cluster_selection doit être un booléen"),
    check("metrics")
      .isArray()
      .withMessage("metrics doit être un tableau de chaînes")
      .custom((value, { req }) => {
        const validMetrics = ["silhouette", "inertia", "davies_bouldin"];
        if (!value.every((m) => validMetrics.includes(m))) {
          throw new Error(
            `metrics contient des valeurs invalides. Valeurs acceptées : ${validMetrics.join(
              ", "
            )}`
          );
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

    const {
      dataset_id,
      algorithm,
      parameters,
      preprocessing,
      features,
      auto_cluster_selection,
      metrics,
      output_format,
    } = req.body;
    // const userId = req.user.id;
    const userId = "user123";

    try {
      const result = await clusterService.clusterDataset(
        userId,
        dataset_id,
        algorithm,
        parameters,
        preprocessing,
        features,
        auto_cluster_selection,
        metrics,
        output_format
      );
      res.status(200).json(result);
    } catch (error) {
      // console.error("Erreur dans la route de clustering:", error);
      if (
        error.message.includes("Dataset non trouvé") ||
        error.message.includes("Format non supporté") ||
        error.message.includes("Aucune colonne numérique détectée") ||
        error.message.includes("Aucune colonne numérique pour l'imputation") ||
        error.message.includes("Aucune colonne catégorique pour l'encodage") ||
        error.message.includes("Aucune colonne numérique pour le scaling") ||
        error.message.includes("n_clusters doit être positif") ||
        error.message.includes("max_iter doit être positif") ||
        error.message.includes("init doit être") ||
        error.message.includes("n_init doit être positif") ||
        error.message.includes(
          "n_clusters ou distance_threshold doit être spécifié"
        ) ||
        error.message.includes("linkage doit être") ||
        error.message.includes("distance_threshold doit être positif") ||
        error.message.includes("eps doit être positif") ||
        error.message.includes("min_samples doit être positif") ||
        error.message.includes("metric doit être") ||
        error.message.includes("xi doit être dans") ||
        error.message.includes("auto_cluster_selection n'est supporté que") ||
        error.message.includes("Impossible de déterminer le nombre optimal") ||
        error.message.includes("Algorithme non supporté") ||
        error.message.includes("Format de sortie invalide")
      ) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: "Erreur serveur : " + error.message });
    }
  }
);

module.exports = router;
