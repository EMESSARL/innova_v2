const express = require("express");
const { body, param, query, validationResult } = require("express-validator");
const { authMiddleware, requireRole } = require("../middleware/auth");
const multer = require("multer");
const {
  createPublication,
  getPublicationById,
  listPublications,
  updatePublication,
  deletePublication,
  uploadFile,
  getFileForDownload,
  getFileForView,
  deleteFile,
  listDomains,
  listSubDomains,
  checkPermissions,
  getPublicationStatus,
  listPublicPublications,
  getPublicPublicationById,
  getPublicFileForDownload,
} = require("../services/publicationService");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// POST /publication
router.post(
  "/publication",
  authMiddleware,
  requireRole(["editor", "admin"]),
  [
    body("format")
      .isIn(["pdf", "csv", "excel", "shapefile"])
      .withMessage("Format invalide"),
    body("metadata.title").notEmpty().withMessage("Titre requis"),
    body("metadata.description").optional().isString(),
    body("metadata.domain_id").isInt().withMessage("Domaine invalide"),
    body("metadata.sub_domain_id").isInt().withMessage("Sous-domaine invalide"),
    body("permissions")
      .isIn(["view_only", "downloadable"])
      .withMessage("Permission invalide"),
    body("validated_data_id")
      .isInt()
      .withMessage("ID de donnée validée invalide"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { format, metadata, permissions, validated_data_id } = req.body;
    const userId = req.user.id;

    try {
      const publication = await createPublication(
        userId,
        format,
        metadata,
        permissions,
        validated_data_id
      );
      return res.status(201).json(publication);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  }
);

// GET /publication/:id
router.get(
  "/publication/:id",
  authMiddleware,
  requireRole(["editor", "admin"]),
  [param("id").isInt().withMessage("ID invalide")],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;

    try {
      const publication = await getPublicationById(id);
      return res.status(200).json(publication);
    } catch (error) {
      if (error.message === "Publication non trouvée") {
        return res.status(404).json({ error: error.message });
      }
      return res
        .status(500)
        .json({ error: "Erreur serveur : " + error.message });
    }
  }
);

// GET /publication
router.get(
  "/publication",
  authMiddleware,
  requireRole(["editor", "admin"]),
  [
    query("domain_id").optional().isInt().withMessage("Domaine invalide"),
    query("status").optional().isString().withMessage("Statut invalide"),
    query("page").optional().isInt({ min: 1 }).withMessage("Page invalide"),
    query("limit").optional().isInt({ min: 1 }).withMessage("Limite invalide"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { domain_id, status, page = 1, limit = 10 } = req.query;
    const filters = { domain_id, status };

    try {
      const result = await listPublications(
        filters,
        parseInt(page),
        parseInt(limit)
      );
      return res.status(200).json(result);
    } catch (error) {
      return res
        .status(500)
        .json({ error: "Erreur serveur : " + error.message });
    }
  }
);

// PUT /publication/:id
router.put(
  "/publication/:id",
  authMiddleware,
  requireRole(["admin"]),
  [
    param("id").isInt().withMessage("ID invalide"),
    body("metadata.title")
      .optional()
      .notEmpty()
      .withMessage("Titre requis si fourni"),
    body("metadata.description").optional().isString(),
    body("metadata.domain_id")
      .optional()
      .isInt()
      .withMessage("Domaine invalide"),
    body("metadata.sub_domain_id")
      .optional()
      .isInt()
      .withMessage("Sous-domaine invalide"),
    body("permissions")
      .optional()
      .isIn(["view_only", "downloadable"])
      .withMessage("Permission invalide"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { metadata, permissions } = req.body;

    try {
      const result = await updatePublication(id, metadata, permissions);
      return res.status(200).json(result);
    } catch (error) {
      if (error.message === "Publication non trouvée") {
        return res.status(404).json({ error: error.message });
      }
      return res.status(400).json({ error: error.message });
    }
  }
);

// DELETE /publication/:id
router.delete(
  "/publication/:id",
  authMiddleware,
  requireRole(["admin"]),
  [param("id").isInt().withMessage("ID invalide")],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const userId = req.user.id;

    try {
      // await deleteFile(id, userId); // Supprimer le fichier associé
      const result = await deletePublication(id);
      return res.status(200).json(result);
    } catch (error) {
      if (error.message === "Publication non trouvée") {
        return res.status(404).json({ error: error.message });
      }
      return res
        .status(500)
        .json({ error: "Erreur serveur : " + error.message });
    }
  }
);

// POST /publication/{id}/files
// Ne sera pas utilisée en production.
router.post(
  "/publication/:id/files",
  authMiddleware,
  requireRole(["editor", "admin"]),
  upload.single("file"),
  [param("id").isInt().withMessage("ID invalide")],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    if (!req.file) {
      return res.status(400).json({ error: "Aucun fichier fourni" });
    }

    const { id } = req.params;
    const userId = req.user.id;

    try {
      const result = await uploadFile(id, req.file, userId);
      return res.status(200).json(result);
    } catch (error) {
      if (error.message === "Publication non trouvée ou accès refusé") {
        return res.status(404).json({ error: error.message });
      }
      return res
        .status(500)
        .json({ error: "Erreur serveur : " + error.message });
    }
  }
);

// GET /publication/:id/download
router.get(
  "/publication/:id/download",
  authMiddleware,
  requireRole(["editor", "admin"]),
  [param("id").isInt().withMessage("ID invalide")],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const userId = req.user.id;

    try {
      const { fileStream, fileName } = await getFileForDownload(id, userId);

      // Définir les en-têtes pour le téléchargement
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${fileName}"`
      );

      // Stream le fichier vers le client
      fileStream.pipe(res);
    } catch (error) {
      if (
        error.message === "Publication non trouvée ou non publiée" ||
        error.message === "Aucun fichier associé à cette publication" ||
        error.message === "Téléchargement non autorisé" ||
        error.message === "Fichier non trouvé dans le système de fichiers"
      ) {
        return res.status(403).json({ error: error.message });
      }
      return res
        .status(500)
        .json({ error: "Erreur serveur : " + error.message });
    }
  }
);

// GET /publication/:id/view
router.get(
  "/publication/:id/view",
  authMiddleware,
  requireRole(["editor", "admin"]),
  [param("id").isInt().withMessage("ID invalide")],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;

    try {
      const presignedUrl = await getFileForView(id);

      // Rediriger vers l'URL présignée pour visualiser le fichier
      res.redirect(presignedUrl);
    } catch (error) {
      if (
        error.message === "Publication non trouvée ou non publiée" ||
        error.message === "Aucun fichier associé à cette publication" ||
        error.message === "Fichier non trouvé dans le système de fichiers"
      ) {
        return res.status(400).json({ error: error.message });
      }
      return res
        .status(500)
        .json({ error: "Erreur serveur : " + error.message });
    }
  }
);

// DELETE /publication/{id}/files
// Ne sera pas utilisée en production.
router.delete(
  "/publication/:id/files",
  authMiddleware,
  requireRole(["admin"]),
  [param("id").isInt().withMessage("ID invalide")],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const userId = req.user.id;

    try {
      const result = await deleteFile(id, userId);
      return res.status(200).json(result);
    } catch (error) {
      if (
        error.message === "Publication non trouvée ou accès refusé" ||
        error.message === "Aucun fichier associé à cette publication"
      ) {
        return res.status(404).json({ error: error.message });
      }
      return res
        .status(500)
        .json({ error: "Erreur serveur : " + error.message });
    }
  }
);

// GET /publication/get/domains
router.get(
  "/publication/get/domains",
  authMiddleware,
  requireRole(["editor", "admin"]),
  async (req, res) => {
    try {
      const domains = await listDomains();
      return res.status(200).json(domains);
    } catch (error) {
      return res
        .status(500)
        .json({ error: "Erreur serveur : " + error.message });
    }
  }
);

// GET /publication/get/subdomains
router.get(
  "/publication/get/subdomains",
  authMiddleware,
  requireRole(["editor", "admin"]),
  [query("domain_id").optional().isInt().withMessage("Domaine invalide")],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { domain_id } = req.query;

    try {
      const subDomains = await listSubDomains(
        domain_id ? parseInt(domain_id) : null
      );
      return res.status(200).json(subDomains);
    } catch (error) {
      return res
        .status(500)
        .json({ error: "Erreur serveur : " + error.message });
    }
  }
);

// GET /publication/:id/permissions
router.get(
  "/publication/:id/permissions",
  authMiddleware,
  requireRole(["editor", "admin"]),
  [param("id").isInt().withMessage("ID invalide")],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const userId = req.user.id;

    try {
      const permissions = await checkPermissions(id, userId);
      return res.status(200).json(permissions);
    } catch (error) {
      if (error.message === "Publication non trouvée") {
        return res.status(404).json({ error: error.message });
      }
      return res
        .status(500)
        .json({ error: "Erreur serveur : " + error.message });
    }
  }
);

// GET /publication/:id/status
router.get(
  "/publication/:id/status",
  authMiddleware,
  requireRole(["editor", "admin"]),
  [param("id").isInt().withMessage("ID invalide")],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;

    try {
      const result = await getPublicationStatus(id);
      return res.status(200).json(result);
    } catch (error) {
      if (error.message === "Publication non trouvée") {
        return res.status(404).json({ error: error.message });
      }
      return res
        .status(500)
        .json({ error: "Erreur serveur : " + error.message });
    }
  }
);

// GET /publication/get/public
router.get(
  "/publication/get/public",
  [
    query("domain_id").optional().isInt().withMessage("Domaine invalide"),
    query("sub_domain_id")
      .optional()
      .isInt()
      .withMessage("Sous-domaine invalide"),
    query("format").optional().isString().withMessage("Format invalide"),
    query("page").optional().isInt({ min: 1 }).withMessage("Page invalide"),
    query("limit").optional().isInt({ min: 1 }).withMessage("Limite invalide"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { domain_id, sub_domain_id, format, page, limit } = req.query;

    try {
      const result = await listPublicPublications({
        domain_id: domain_id ? parseInt(domain_id) : undefined,
        sub_domain_id: sub_domain_id ? parseInt(sub_domain_id) : undefined,
        format,
        page: page ? parseInt(page) : 1,
        limit: limit ? parseInt(limit) : 10,
      });
      return res.status(200).json(result);
    } catch (error) {
      return res
        .status(500)
        .json({ error: "Erreur serveur : " + error.message });
    }
  }
);

// GET /publication/get/public/:id
router.get(
  "/publication/get/public/:id",
  [param("id").isInt().withMessage("ID invalide")],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;

    try {
      const result = await getPublicPublicationById(id);
      return res.status(200).json(result);
    } catch (error) {
      if (error.message === "Publication non trouvée ou non publique") {
        return res.status(404).json({ error: error.message });
      }
      return res
        .status(500)
        .json({ error: "Erreur serveur : " + error.message });
    }
  }
);

// GET /publication/public/:id/download
router.get(
  "/publication/public/:id/download",
  [param("id").isInt().withMessage("ID invalide")],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;

    try {
      const { fileStream, fileName } = await getPublicFileForDownload(id);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${fileName}"`
      );
      fileStream.pipe(res);
    } catch (error) {
      if (
        error.message === "Publication non trouvée ou non publique" ||
        error.message === "Aucun fichier associé à cette publication" ||
        error.message === "Téléchargement non autorisé" ||
        error.message === "Fichier non trouvé dans le système de fichiers"
      ) {
        return res.status(403).json({ error: error.message });
      }
      return res
        .status(500)
        .json({ error: "Erreur serveur : " + error.message });
    }
  }
);

module.exports = router;
