const minioClient = require("../config/minioClient");
const { Domain, SubDomain, Publication } = require("../models");

const BUCKET_NAME = process.env.MINIO_BUCKET;

// Crée une nouvelle publication avec les données fournies
const createPublication = async (
  userId,
  format,
  metadata,
  permissions,
  validatedDataId
) => {
  const { title, description, domain_id, sub_domain_id } = metadata;

  // Vérifier que le domaine existe
  const domain = await Domain.findByPk(domain_id);
  if (!domain) {
    throw new Error("Domaine invalide");
  }

  // Vérifier que le sous-domaine existe et appartient au domaine
  const subDomain = await SubDomain.findOne({
    where: { id: sub_domain_id, domain_id },
  });
  if (!subDomain) {
    throw new Error("Sous-domaine invalide");
  }

  const publication = await Publication.create({
    title,
    description,
    format,
    file_path: null,
    permissions,
    status: "pending",
    publication_date: new Date(),
    domain_id,
    sub_domain_id,
    user_id: userId,
    validated_data_id: validatedDataId,
  });

  return {
    id: publication.id,
    status: publication.status,
    file_path: publication.file_path,
  };
};

const getPublicationById = async (id) => {
  const publication = await Publication.findByPk(id, {
    include: [
      { model: Domain, attributes: ["name"], as: "Domain" },
      { model: SubDomain, attributes: ["name"], as: "SubDomain" },
    ],
  });

  if (!publication) {
    throw new Error("Publication non trouvée");
  }

  return {
    id: publication.id,
    format: publication.format,
    metadata: {
      title: publication.title,
      description: publication.description,
      domain_id: publication.domain_id,
      sub_domain_id: publication.sub_domain_id,
      domain_name: publication.Domain.name,
      sub_domain_name: publication.SubDomain.name,
    },
    permissions: publication.permissions,
    status: publication.status,
    publication_date: publication.publication_date,
    file_path: publication.file_path,
    user_id: publication.user_id,
    validated_data_id: publication.validated_data_id,
  };
};

const listPublications = async (filters, page = 1, limit = 10) => {
  const { domain_id, status } = filters;
  const where = {};
  if (domain_id) where.domain_id = domain_id;
  if (status) where.status = status;

  const offset = (page - 1) * limit;

  const { count, rows } = await Publication.findAndCountAll({
    where,
    attributes: ["id", "title", "format", "status"],
    limit,
    offset,
  });

  return {
    publications: rows.map((pub) => pub.toJSON()),
    total: count,
    page: parseInt(page),
    limit: parseInt(limit),
  };
};

const updatePublication = async (id, metadata, permissions) => {
  const publication = await Publication.findByPk(id);
  if (!publication) {
    throw new Error("Publication non trouvée");
  }

  const updates = {};
  if (metadata) {
    if (metadata.title) updates.title = metadata.title;
    if (metadata.description) updates.description = metadata.description;
    if (metadata.domain_id) {
      const domain = await Domain.findByPk(metadata.domain_id);
      if (!domain) throw new Error("Domaine invalide");
      updates.domain_id = metadata.domain_id;
    }
    if (metadata.sub_domain_id) {
      // Récupérer le domain_id actuel si non fourni dans metadata.
      const currentDomainId = metadata.domain_id || publication.domain_id;
      const subDomain = await SubDomain.findOne({
        where: { id: metadata.sub_domain_id, domain_id: currentDomainId },
      });
      if (!subDomain) throw new Error("Sous-domaine invalide");
      updates.sub_domain_id = metadata.sub_domain_id;
    }
  }
  if (permissions) updates.permissions = permissions;

  if (Object.keys(updates).length === 0) {
    throw new Error("Aucune mise à jour fournie");
  }

  await publication.update(updates);
  return { id, status: "updated" };
};

const deletePublication = async (id) => {
  const publication = await Publication.findByPk(id);
  if (!publication) {
    throw new Error("Publication non trouvée");
  }

  await publication.destroy();
  return { status: "deleted" };
};

// Cette fonction est implémentée pour effectuer l'upload d'un fichier vers
// MinIO. Elle est juste utilisée pour les tests.
const uploadFile = async (publicationId, file, userId) => {
  // Vérifier si la publication existe et appartient à l'utilisateur
  const publication = await Publication.findOne({
    where: { id: publicationId, user_id: userId },
  });
  if (!publication) {
    throw new Error("Publication non trouvée ou accès refusé");
  }

  const fileName = `publications/${publicationId}-${Date.now()}-${
    file.originalname
  }`;

  try {
    await minioClient.putObject(BUCKET_NAME, fileName, file.buffer, file.size, {
      "Content-Type": file.mimetype,
    });

    await publication.update({ file_path: fileName });
    return { id: publication.id, file_path: fileName };
  } catch (error) {
    throw new Error("Erreur lors de l'upload du fichier : " + error);
  }
};

const getFileForDownload = async (publicationId, userId) => {
  const publication = await Publication.findOne({
    where: { id: publicationId, status: "published" },
    attributes: ["file_path", "permissions", "user_id"],
  });
  if (!publication) {
    throw new Error("Publication non trouvée ou non publiée");
  }

  if (!publication.file_path) {
    throw new Error("Aucun fichier associé à cette publication");
  }

  const isOwner = userId === publication.user_id;
  const canDownload =
    (publication.permissions === "downloadable" && !isOwner) || isOwner;
  if (!canDownload) {
    throw new Error("Téléchargement non autorisé");
  }

  try {
    // Récupérer le fichier depuis MinIO sous forme de stream
    const fileStream = await minioClient.getObject(
      BUCKET_NAME,
      publication.file_path
    );
    const fileName = publication.file_path.split("/").pop();
    return { fileStream, fileName };
  } catch (error) {
    throw new Error("Fichier non trouvé dans le système de fichiers");
  }
};

const getFileForView = async (publicationId) => {
  const publication = await Publication.findOne({
    where: { id: publicationId, status: "published" },
    attributes: ["file_path", "format"],
  });
  if (!publication) {
    throw new Error("Publication non trouvée ou non publiée");
  }

  if (!publication.file_path) {
    throw new Error("Aucun fichier associé à cette publication");
  }

  try {
    // Générer une URL pour le fichier (valide pendant 1 heure)
    const presignedUrl = await minioClient.presignedUrl(
      "GET",
      BUCKET_NAME,
      publication.file_path,
      3600
    );
    return presignedUrl;
  } catch (error) {
    throw new Error("Fichier non trouvé dans le système de fichiers");
  }
};

// Ne sera pas utilisée en production.
const deleteFile = async (publicationId, userId) => {
  const publication = await Publication.findOne({
    where: { id: publicationId, user_id: userId },
    attributes: ["file_path"],
  });
  if (!publication) {
    throw new Error("Publication non trouvée ou accès refusé");
  }

  if (!publication.file_path) {
    throw new Error("Aucun fichier associé à cette publication");
  }

  try {
    await minioClient.removeObject(BUCKET_NAME, publication.file_path);
    await publication.update({ file_path: null });
    return { id: publication.id, status: "file_deleted" };
  } catch (error) {
    throw new Error("Erreur lors de la suppression du fichier");
  }
};

const listDomains = async () => {
  const domains = await Domain.findAll({
    attributes: ["id", "name"],
    order: [["name", "ASC"]],
  });
  return domains.map((domain) => domain.toJSON());
};

const listSubDomains = async (domainId) => {
  const where = domainId ? { domain_id: domainId } : {};
  const subDomains = await SubDomain.findAll({
    where,
    attributes: ["id", "name", "domain_id"],
    order: [["name", "ASC"]],
  });
  return subDomains.map((subDomain) => subDomain.toJSON());
};

const checkPermissions = async (publicationId, userId) => {
  const publication = await Publication.findByPk(publicationId, {
    attributes: ["permissions", "status", "user_id"],
  });
  if (!publication) {
    throw new Error("Publication non trouvée");
  }

  const isPublished = publication.status === "published";
  const isOwner = userId === publication.user_id;
  const canView = isPublished || isOwner; // Consultable si publié ou si l'utilisateur est le propriétaire
  const canDownload =
    (publication.permissions === "downloadable" && isPublished) || isOwner; // Téléchargeable si autorisé et publié, ou si propriétaire

  return {
    can_view: canView,
    can_download: canDownload,
  };
};

const getPublicationStatus = async (publicationId) => {
  const publication = await Publication.findByPk(publicationId, {
    attributes: ["id", "status"],
  });
  if (!publication) {
    throw new Error("Publication non trouvée");
  }

  return {
    publication_id: publication.id,
    status: publication.status,
  };
};

const listPublicPublications = async ({
  domain_id,
  sub_domain_id,
  format,
  page = 1,
  limit = 10,
}) => {
  const where = { status: "published" };
  if (domain_id) where.domain_id = domain_id;
  if (sub_domain_id) where.sub_domain_id = sub_domain_id;
  if (format) where.format = format;

  const offset = (page - 1) * limit;

  const { count, rows } = await Publication.findAndCountAll({
    where,
    attributes: [
      "id",
      "title",
      "description",
      "format",
      "file_path",
      "permissions",
      "publication_date",
    ],
    limit,
    offset,
  });

  return {
    publications: rows.map((pub) => pub.toJSON()),
    total: count,
    page: parseInt(page),
    limit: parseInt(limit),
  };
};

const getPublicPublicationById = async (id) => {
  const publication = await Publication.findOne({
    where: { id, status: "published" },
    include: [
      { model: Domain, attributes: ["id", "name"], as: "Domain" },
      { model: SubDomain, attributes: ["id", "name"], as: "SubDomain" },
    ],
  });

  if (!publication) {
    throw new Error("Publication non trouvée ou non publique");
  }

  return {
    id: publication.id,
    title: publication.title,
    description: publication.description,
    format: publication.format,
    file_path: publication.file_path,
    permissions: publication.permissions,
    publication_date: publication.publication_date,
    domain: { id: publication.domain_id, name: publication.Domain.name },
    sub_domain: {
      id: publication.sub_domain_id,
      name: publication.SubDomain.name,
    },
  };
};

const getPublicFileForDownload = async (publicationId) => {
  const publication = await Publication.findOne({
    where: { id: publicationId, status: "published" },
    attributes: ["file_path", "permissions"],
  });
  if (!publication) {
    throw new Error("Publication non trouvée ou non publique");
  }

  if (!publication.file_path) {
    throw new Error("Aucun fichier associé à cette publication");
  }
  if (publication.permissions !== "downloadable") {
    throw new Error("Téléchargement non autorisé");
  }

  try {
    const fileStream = await minioClient.getObject(
      BUCKET_NAME,
      publication.file_path
    );
    const fileName = publication.file_path.split("/").pop();
    return { fileStream, fileName };
  } catch (error) {
    throw new Error("Fichier non trouvé dans le système de fichiers");
  }
};

module.exports = {
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
};
