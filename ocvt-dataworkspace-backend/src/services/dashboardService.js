const { config } = require("dotenv");
const {
  Dashboard,
  DashboardItem,
  ItemType,
  Status,
  File,
  DashboardFile,
  Validation,
  Publication,
  sequelize,
} = require("../models");

class DashboardService {
  /**
   * Crée un nouveau dashboard avec statut DRAFT
   */
  async createDashboard(userId, dashboardData) {
    const transaction = await sequelize.transaction();

    try {
      // Récupérer le statut DRAFT
      const draftStatus = await Status.findOne({
        where: { code: "DRAFT" },
      });

      if (!draftStatus) {
        throw new Error("Statut DRAFT non trouvé dans la base de données");
      }

      // Créer le dashboard
      const dashboard = await Dashboard.create(
        {
          title: dashboardData.title,
          description: dashboardData.description || null,
          status_id: draftStatus.id,
          owner_id: userId,
        },
        { transaction }
      );

      await transaction.commit();

      return {
        success: true,
        data: {
          dashboard_id: dashboard.id,
          title: dashboard.title,
          description: dashboard.description,
          status: "DRAFT",
          owner_id: dashboard.owner_id,
          created_at: dashboard.created_at,
        },
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Récupère la liste des dashboards
   */
  async getDashboards(userId) {
    try {
      // const whereClause = {};

      // // Filtrer par propriétaire si demandé
      // if (filters.owner === "me") {
      //   whereClause.owner_id = userId;
      // }

      const dashboards = await Dashboard.findAll({
        where: { owner_id: userId },
        include: [
          {
            model: Status,
            as: "status",
            attributes: ["code", "label", "description"],
          },
        ],
        order: [["created_at", "DESC"]],
      });

      return {
        success: true,
        data: dashboards.map((dashboard) => ({
          id: dashboard.id,
          title: dashboard.title,
          description: dashboard.description,
          status: dashboard.status.code,
          owner_id: dashboard.owner_id,
          created_at: dashboard.created_at,
          updated_at: dashboard.updated_at,
        })),
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Récupère les détails d'un dashboard spécifique
   */
  async getDashboardById(dashboardId, userId) {
    try {
      const dashboard = await Dashboard.findOne({
        where: { id: dashboardId },
        include: [
          {
            model: Status,
            as: "status",
            attributes: ["code", "label", "description", "editable"],
          },
          {
            model: DashboardItem,
            as: "items",
            include: [
              {
                model: ItemType,
                as: "itemType",
                attributes: ["name", "description"],
              },
            ],
            order: [["position", "ASC"]],
          },
          {
            model: File,
            as: "files",
            attributes: ["id", "filename", "mime_type", "size"],
          },
        ],
      });

      if (!dashboard) {
        throw new Error("Dashboard non trouvé");
      }

      // Vérifier les permissions (propriétaire ou public)
      if (dashboard.owner_id !== userId) {
        // Vérifier si le dashboard est publié et public
        const publication = await dashboard.getPublication();
        if (!publication || publication.visibility !== "PUBLIC") {
          throw new Error("Accès non autorisé à ce dashboard");
        }
      }

      return {
        success: true,
        data: {
          id: dashboard.id,
          title: dashboard.title,
          description: dashboard.description,
          status: dashboard.status.code,
          owner_id: dashboard.owner_id,
          editable: dashboard.status.editable,
          created_at: dashboard.created_at,
          updated_at: dashboard.updated_at,
          items: dashboard.items.map((item) => ({
            id: item.id,
            type: item.itemType.name,
            config: item.config,
            position: item.position,
          })),
          files: dashboard.files.map((file) => ({
            id: file.id,
            filename: file.filename,
            mime_type: file.mime_type,
            size: file.size,
          })),
        },
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Met à jour les métadonnées d'un dashboard
   */
  async updateDashboard(dashboardId, userId, updateData) {
    const transaction = await sequelize.transaction();

    try {
      // Récupérer le dashboard avec son statut
      const dashboard = await Dashboard.findOne({
        where: { id: dashboardId },
        include: [
          {
            model: Status,
            as: "status",
          },
        ],
      });

      if (!dashboard) {
        throw new Error("Dashboard non trouvé");
      }

      // Vérifier la propriété
      if (dashboard.owner_id !== userId) {
        throw new Error("Vous n'êtes pas autorisé à modifier ce dashboard");
      }

      // Vérifier que le statut est éditable
      if (!dashboard.status.editable) {
        throw new Error(
          "Ce dashboard ne peut pas être modifié dans son état actuel"
        );
      }

      // Mettre à jour
      await dashboard.update(
        {
          title: updateData.title || dashboard.title,
          description:
            updateData.description !== undefined
              ? updateData.description
              : dashboard.description,
        },
        { transaction }
      );

      await transaction.commit();

      return {
        success: true,
        data: {
          id: dashboard.id,
          title: dashboard.title,
          description: dashboard.description,
          status: dashboard.status.code,
          updated_at: dashboard.updated_at,
        },
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Valide la configuration d'un item selon son type
   */
  async validateItemConfig(itemType, config, userId) {
    switch (itemType.name) {
      case "graph":
        if (!config.sub_type) {
          throw new Error(
            "La configuration d'un graphe doit contenir la clé 'sub_type'"
          );
        }
        break;

      case "file":
        if (!config.file_id) {
          throw new Error(
            "La configuration d'un fichier doit contenir la clé 'file_id'"
          );
        }

        // Vérifier que le fichier existe et appartient à l'utilisateur
        const file = await File.findByPk(config.file_id);
        if (!file) {
          throw new Error("Le fichier spécifié n'existe pas");
        }

        if (file.uploaded_by !== userId) {
          throw new Error("Vous n'êtes pas autorisé à utiliser ce fichier");
        }
        break;

      case "table":
        if (!config.columns || !Array.isArray(config.columns)) {
          throw new Error(
            "La configuration d'une table doit contenir un tableau 'columns'"
          );
        }
        if (!config.rows || !Array.isArray(config.rows)) {
          throw new Error(
            "La configuration d'une table doit contenir un tableau 'rows'"
          );
        }
        break;

      default:
        // Pour les autres types, on accepte n'importe quelle configuration
        break;
    }
  }

  /**
   * Ajoute un nouvel item à un dashboard
   */
  async addDashboardItem(dashboardId, userId, itemData) {
    const transaction = await sequelize.transaction();

    try {
      // Vérifier que le dashboard existe et est éditable
      const dashboard = await Dashboard.findOne({
        where: { id: dashboardId },
        include: [
          {
            model: Status,
            as: "status",
          },
        ],
      });

      if (!dashboard) {
        throw new Error("Dashboard non trouvé");
      }

      if (dashboard.owner_id !== userId) {
        throw new Error("Vous n'êtes pas autorisé à modifier ce dashboard");
      }

      if (!dashboard.status.editable) {
        throw new Error(
          "Ce dashboard ne peut pas être modifié dans son état actuel"
        );
      }

      // Vérifier que le type d'item existe
      const itemType = await ItemType.findByPk(itemData.item_type_id);
      if (!itemType) {
        throw new Error("Type d'item invalide");
      }

      // Valider la configuration selon le type d'item
      await this.validateItemConfig(itemType, itemData.config, userId);

      // Créer l'item
      const item = await DashboardItem.create(
        {
          dashboard_id: dashboardId,
          item_type_id: itemData.item_type_id,
          config: itemData.config,
          position: itemData.position || 0,
        },
        { transaction }
      );

      await transaction.commit();

      return {
        success: true,
        data: {
          id: item.id,
          dashboard_id: item.dashboard_id,
          type: itemType.name,
          config: item.config,
          position: item.position,
          created_at: item.created_at,
        },
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Met à jour un item de dashboard
   */
  async updateDashboardItem(itemId, userId, updateData) {
    const transaction = await sequelize.transaction();

    try {
      // Récupérer l'item avec le dashboard et son statut
      const item = await DashboardItem.findOne({
        where: { id: itemId },
        include: [
          {
            model: Dashboard,
            as: "dashboard",
            include: [
              {
                model: Status,
                as: "status",
              },
            ],
          },
          {
            model: ItemType,
            as: "itemType",
          },
        ],
      });

      if (!item) {
        throw new Error("Item non trouvé");
      }

      if (item.dashboard.owner_id !== userId) {
        throw new Error("Vous n'êtes pas autorisé à modifier cet item");
      }

      if (!item.dashboard.status.editable) {
        throw new Error(
          "Cet item ne peut pas être modifié dans l'état actuel du dashboard"
        );
      }

      // Valider la nouvelle configuration si elle est fournie
      if (updateData !== undefined) {
        // await this.validateItemConfig(item.itemType, updateData.config, userId);

        // Mettre à jour l'item
        await item.update(
          {
            config:
              updateData.config !== undefined ? updateData.config : item.config,
            position:
              updateData.position !== undefined
                ? updateData.position
                : item.position,
          },
          { transaction }
        );
      }

      await transaction.commit();

      return {
        success: true,
        data: {
          id: item.id,
          config: item.config,
          position: item.position,
          updated_at: item.updated_at,
        },
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Supprime logiquement un item de dashboard
   */
  async deleteDashboardItem(itemId, userId) {
    const transaction = await sequelize.transaction();

    try {
      // Récupérer l'item avec le dashboard et son statut
      const item = await DashboardItem.findOne({
        where: { id: itemId },
        include: [
          {
            model: Dashboard,
            as: "dashboard",
            include: [
              {
                model: Status,
                as: "status",
              },
            ],
          },
        ],
      });

      if (!item) {
        throw new Error("Item non trouvé");
      }

      if (item.dashboard.owner_id !== userId) {
        throw new Error("Vous n'êtes pas autorisé à supprimer cet item");
      }

      if (!item.dashboard.status.editable) {
        throw new Error(
          "Cet item ne peut pas être supprimé dans l'état actuel du dashboard"
        );
      }

      // Suppression logique
      await item.destroy({ transaction });

      await transaction.commit();

      return {
        success: true,
        message: "Item supprimé avec succès",
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Soumet un dashboard pour validation
   */
  async submitDashboard(dashboardId, userId) {
    const transaction = await sequelize.transaction();

    try {
      // Récupérer le dashboard avec son statut
      const dashboard = await Dashboard.findOne({
        where: { id: dashboardId },
        include: [
          {
            model: Status,
            as: "status",
          },
        ],
      });

      if (!dashboard) {
        throw new Error("Dashboard non trouvé");
      }

      if (dashboard.owner_id !== userId) {
        throw new Error("Vous n'êtes pas autorisé à soumettre ce dashboard");
      }

      // Vérifier que le statut permet la soumission
      if (!["DRAFT", "UPDATE_REQUESTED"].includes(dashboard.status.code)) {
        throw new Error(
          "Ce dashboard ne peut pas être soumis dans son état actuel"
        );
      }

      // Récupérer le statut SUBMITTED
      const submittedStatus = await Status.findOne({
        where: { code: "SUBMITTED" },
      });

      if (!submittedStatus) {
        throw new Error("Statut SUBMITTED non trouvé");
      }

      // Changer le statut
      await dashboard.update(
        {
          status_id: submittedStatus.id,
        },
        { transaction }
      );

      // Créer une entrée de validation
      // await Validation.create(
      //   {
      //     dashboard_id: dashboardId,
      //     validator_id: userId, // Le créateur qui soumet
      //     action: "SUBMIT",
      //     comments: "Dashboard soumis pour validation",
      //   },
      //   { transaction }
      // );

      await transaction.commit();

      return {
        success: true,
        data: {
          id: dashboard.id,
          status: "SUBMITTED",
          submitted_at: new Date(),
        },
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Duplique un dashboard existant
   */
  async duplicateDashboard(dashboardId, userId) {
    const transaction = await sequelize.transaction();

    try {
      // Récupérer le dashboard avec ses items
      const dashboard = await Dashboard.findOne({
        where: { id: dashboardId },
        include: [
          {
            model: DashboardItem,
            as: "items",
            order: [["position", "ASC"]],
          },
        ],
      });

      if (!dashboard) {
        throw new Error("Dashboard non trouvé");
      }

      if (dashboard.owner_id !== userId) {
        throw new Error("Vous n'êtes pas autorisé à dupliquer ce dashboard");
      }

      // Récupérer le statut DRAFT
      const draftStatus = await Status.findOne({
        where: { code: "DRAFT" },
      });

      if (!draftStatus) {
        throw new Error("Statut DRAFT non trouvé");
      }

      // Créer le nouveau dashboard
      const newDashboard = await Dashboard.create(
        {
          title: `${dashboard.title} (Copie)`,
          description: dashboard.description,
          status_id: draftStatus.id,
          owner_id: userId,
        },
        { transaction }
      );

      // Dupliquer les items
      for (const item of dashboard.items) {
        await DashboardItem.create(
          {
            dashboard_id: newDashboard.id,
            item_type_id: item.item_type_id,
            config: item.config,
            position: item.position,
          },
          { transaction }
        );
      }

      await transaction.commit();

      return {
        success: true,
        data: {
          id: newDashboard.id,
          title: newDashboard.title,
          description: newDashboard.description,
          status: "DRAFT",
          owner_id: newDashboard.owner_id,
          items_count: dashboard.items.length,
          created_at: newDashboard.created_at,
        },
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Récupère les dashboards soumis pour validation
   */
  async getSubmittedDashboards(validatorId) {
    try {
      const submittedStatus = await Status.findOne({
        where: { code: "SUBMITTED" },
      });

      if (!submittedStatus) {
        throw new Error("Statut SUBMITTED non trouvé");
      }

      const dashboards = await Dashboard.findAll({
        where: { status_id: submittedStatus.id },
        include: [
          {
            model: Status,
            as: "status",
            attributes: ["code", "label", "description"],
          },
          {
            model: DashboardItem,
            as: "items",
            include: [
              {
                model: ItemType,
                as: "itemType",
                attributes: ["name", "description"],
              },
            ],
            order: [["position", "ASC"]],
          },
          {
            model: File,
            as: "files",
            attributes: ["id", "filename", "mime_type", "size"],
          },
        ],
        order: [["created_at", "ASC"]],
      });

      return {
        success: true,
        data: dashboards.map((dashboard) => ({
          id: dashboard.id,
          title: dashboard.title,
          description: dashboard.description,
          status: dashboard.status.code,
          owner_id: dashboard.owner_id,
          created_at: dashboard.created_at,
          updated_at: dashboard.updated_at,
          items_count: dashboard.items.length,
          files_count: dashboard.files.length,
        })),
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Valide, rejette ou demande des modifications pour un dashboard
   */
  async validateDashboard(dashboardId, validatorId, validationData) {
    const transaction = await sequelize.transaction();

    try {
      // Récupérer le dashboard avec son statut
      const dashboard = await Dashboard.findOne({
        where: { id: dashboardId },
        include: [
          {
            model: Status,
            as: "status",
          },
        ],
      });

      if (!dashboard) {
        throw new Error("Dashboard non trouvé");
      }

      // Vérifier que le dashboard est en statut SUBMITTED
      if (dashboard.status.code !== "SUBMITTED") {
        throw new Error(
          "Ce dashboard ne peut pas être validé dans son état actuel"
        );
      }

      let newStatus;
      let statusCode;

      // Déterminer le nouveau statut selon l'action
      switch (validationData.action) {
        case "VALIDATE":
          newStatus = await Status.findOne({ where: { code: "VALIDATED" } });
          statusCode = "VALIDATED";
          break;
        case "REJECT":
          newStatus = await Status.findOne({ where: { code: "REJECTED" } });
          statusCode = "REJECTED";
          break;
        case "REQUEST_UPDATE":
          newStatus = await Status.findOne({
            where: { code: "UPDATE_REQUESTED" },
          });
          statusCode = "UPDATE_REQUESTED";
          break;
        default:
          throw new Error(
            "Action de validation invalide. Doit être VALIDATE, REJECT ou REQUEST_UPDATE"
          );
      }

      if (!newStatus) {
        throw new Error(`Statut ${statusCode} non trouvé`);
      }

      // Mettre à jour le statut du dashboard
      await dashboard.update(
        {
          status_id: newStatus.id,
        },
        { transaction }
      );

      // Créer l'entrée de validation
      await Validation.create(
        {
          dashboard_id: dashboardId,
          validator_id: validatorId,
          action: validationData.action,
          comments: validationData.comments || null,
        },
        { transaction }
      );

      await transaction.commit();

      return {
        success: true,
        data: {
          id: dashboard.id,
          status: statusCode,
          action: validationData.action,
          validator_id: validatorId,
          comments: validationData.comments,
          validated_at: new Date(),
        },
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Récupère les dashboards validés prêts à être publiés
   */
  async getValidatedDashboards(publisherId) {
    try {
      const validatedStatus = await Status.findOne({
        where: { code: "VALIDATED" },
      });

      if (!validatedStatus) {
        throw new Error("Statut VALIDATED non trouvé");
      }

      const dashboards = await Dashboard.findAll({
        where: { status_id: validatedStatus.id },
        include: [
          {
            model: Status,
            as: "status",
            attributes: ["code", "label", "description"],
          },
          {
            model: DashboardItem,
            as: "items",
            include: [
              {
                model: ItemType,
                as: "itemType",
                attributes: ["name", "description"],
              },
            ],
            order: [["position", "ASC"]],
          },
          {
            model: File,
            as: "files",
            attributes: ["id", "filename", "mime_type", "size"],
          },
        ],
        order: [["created_at", "ASC"]],
      });

      return {
        success: true,
        data: dashboards.map((dashboard) => ({
          id: dashboard.id,
          title: dashboard.title,
          description: dashboard.description,
          status: dashboard.status.code,
          owner_id: dashboard.owner_id,
          created_at: dashboard.created_at,
          updated_at: dashboard.updated_at,
          items_count: dashboard.items.length,
          files_count: dashboard.files.length,
          ready_for_publication: true,
        })),
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Publie un dashboard validé
   */
  async publishDashboard(dashboardId, publisherId, publicationData) {
    const transaction = await sequelize.transaction();

    try {
      // Récupérer le dashboard avec son statut
      const dashboard = await Dashboard.findOne({
        where: { id: dashboardId },
        include: [
          {
            model: Status,
            as: "status",
          },
        ],
      });

      if (!dashboard) {
        throw new Error("Dashboard non trouvé");
      }

      // Vérifier que le dashboard est en statut VALIDATED
      if (dashboard.status.code !== "VALIDATED") {
        throw new Error(
          "Ce dashboard ne peut pas être publié dans son état actuel"
        );
      }

      // Récupérer le statut PUBLISHED
      const publishedStatus = await Status.findOne({
        where: { code: "PUBLISHED" },
      });

      if (!publishedStatus) {
        throw new Error("Statut PUBLISHED non trouvé");
      }

      // Mettre à jour le statut du dashboard
      await dashboard.update(
        {
          status_id: publishedStatus.id,
        },
        { transaction }
      );

      // Créer l'entrée de publication
      await Publication.create(
        {
          dashboard_id: dashboardId,
          group_id: publicationData.group_id || null,
          visibility: publicationData.visibility || "PRIVATE",
          published_at: new Date(),
        },
        { transaction }
      );

      await transaction.commit();

      return {
        success: true,
        data: {
          id: dashboard.id,
          status: "PUBLISHED",
          visibility: publicationData.visibility || "PRIVATE",
          group_id: publicationData.group_id,
          published_at: new Date(),
          message: "Dashboard publié avec succès",
        },
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Retire un dashboard de la publication
   */
  async withdrawDashboard(dashboardId, publisherId) {
    const transaction = await sequelize.transaction();

    try {
      // Récupérer le dashboard avec son statut et sa publication
      const dashboard = await Dashboard.findOne({
        where: { id: dashboardId },
        include: [
          {
            model: Status,
            as: "status",
          },
          {
            model: Publication,
            as: "publication",
          },
        ],
      });

      if (!dashboard) {
        throw new Error("Dashboard non trouvé");
      }

      // Vérifier que le dashboard est publié
      if (dashboard.status.code !== "PUBLISHED") {
        throw new Error("Ce dashboard n'est pas publié");
      }

      if (!dashboard.publication) {
        throw new Error("Aucune publication trouvée pour ce dashboard");
      }

      // Récupérer le statut UNPUBLISHED
      const unpublishedStatus = await Status.findOne({
        where: { code: "UNPUBLISHED" },
      });

      if (!unpublishedStatus) {
        throw new Error("Statut UNPUBLISHED non trouvé");
      }

      // Mettre à jour le statut du dashboard
      await dashboard.update(
        {
          status_id: unpublishedStatus.id,
        },
        { transaction }
      );

      // Supprimer l'entrée de publication
      await dashboard.publication.destroy({ transaction });

      await transaction.commit();

      return {
        success: true,
        data: {
          id: dashboard.id,
          status: "UNPUBLISHED",
          withdrawn_at: new Date(),
          message: "Dashboard retiré de la publication avec succès",
        },
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Permet au validateur d'éditer un dashboard en statut REQUEST_UPDATE
   */
  async editRequestedDashboard(dashboardId, validatorId, updateData) {
    const transaction = await sequelize.transaction();

    try {
      // Récupérer le dashboard avec son statut
      const dashboard = await Dashboard.findOne({
        where: { id: dashboardId },
        include: [
          {
            model: Status,
            as: "status",
          },
        ],
      });

      if (!dashboard) {
        throw new Error("Dashboard non trouvé");
      }

      // Vérifier que le dashboard est en statut UPDATE_REQUESTED
      if (dashboard.status.code !== "UPDATE_REQUESTED") {
        throw new Error(
          "Ce dashboard ne peut pas être modifié dans son état actuel"
        );
      }

      // Mettre à jour les métadonnées
      if (updateData.title || updateData.description) {
        await dashboard.update(
          {
            title: updateData.title || dashboard.title,
            description:
              updateData.description !== undefined
                ? updateData.description
                : dashboard.description,
          },
          { transaction }
        );
      }

      // Mettre à jour les items si fournis
      if (updateData.items && Array.isArray(updateData.items)) {
        for (const itemUpdate of updateData.items) {
          if (itemUpdate.id && itemUpdate.config) {
            await DashboardItem.update(
              { config: itemUpdate.config },
              {
                where: { id: itemUpdate.id, dashboard_id: dashboardId },
                transaction,
              }
            );
          }
        }
      }

      await transaction.commit();

      return {
        success: true,
        data: {
          id: dashboard.id,
          title: dashboard.title,
          description: dashboard.description,
          status: dashboard.status.code,
          updated_at: dashboard.updated_at,
          message: "Dashboard modifié avec succès",
        },
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Gère l'upload de fichiers
   */
  async uploadFile(userId, fileData) {
    try {
      // Validation du fichier
      if (
        !fileData.filename ||
        !fileData.mime_type ||
        !fileData.size ||
        !fileData.storage_path
      ) {
        throw new Error("Données de fichier incomplètes");
      }

      // Vérifier la taille (max 10MB)
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (fileData.size > maxSize) {
        throw new Error("Fichier trop volumineux. Taille maximale : 10MB");
      }

      // Vérifier le type MIME
      const allowedMimeTypes = [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "text/csv",
        "image/jpeg",
        "image/png",
        "image/gif",
      ];

      if (!allowedMimeTypes.includes(fileData.mime_type)) {
        throw new Error("Type de fichier non supporté");
      }

      // Créer l'entrée de fichier
      const file = await File.create({
        filename: fileData.filename,
        mime_type: fileData.mime_type,
        size: fileData.size,
        storage_path: fileData.storage_path,
        uploaded_by: userId,
      });

      return {
        success: true,
        data: {
          id: file.id,
          filename: file.filename,
          mime_type: file.mime_type,
          size: file.size,
          uploaded_by: file.uploaded_by,
          created_at: file.created_at,
        },
      };
    } catch (error) {
      throw error;
    }
  }

  // ========================================
  // MÉTHODES D'ADMINISTRATION
  // ========================================

  /**
   * Récupère tous les dashboards (accès administrateur)
   */
  async getAllDashboards(adminId, filters = {}) {
    try {
      const whereClause = {};

      // Filtres optionnels
      if (filters.status) {
        const status = await Status.findOne({
          where: { code: filters.status },
        });
        if (status) {
          whereClause.status_id = status.id;
        }
      }

      if (filters.owner_id) {
        whereClause.owner_id = filters.owner_id;
      }

      const dashboards = await Dashboard.findAll({
        where: whereClause,
        include: [
          {
            model: Status,
            as: "status",
            attributes: ["code", "label", "description"],
          },
          {
            model: DashboardItem,
            as: "items",
            include: [
              {
                model: ItemType,
                as: "itemType",
                attributes: ["name", "description"],
              },
            ],
            order: [["position", "ASC"]],
          },
          {
            model: File,
            as: "files",
            attributes: ["id", "filename", "mime_type", "size"],
          },
          {
            model: Publication,
            as: "publication",
            attributes: ["visibility", "group_id", "published_at"],
          },
        ],
        order: [["created_at", "DESC"]],
      });

      return {
        success: true,
        data: dashboards.map((dashboard) => ({
          id: dashboard.id,
          title: dashboard.title,
          description: dashboard.description,
          status: dashboard.status.code,
          owner_id: dashboard.owner_id,
          created_at: dashboard.created_at,
          updated_at: dashboard.updated_at,
          items_count: dashboard.items.length,
          files_count: dashboard.files.length,
          publication: dashboard.publication
            ? {
                visibility: dashboard.publication.visibility,
                group_id: dashboard.publication.group_id,
                published_at: dashboard.publication.published_at,
              }
            : null,
        })),
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Récupère les statistiques globales du système
   */
  async getSystemStatistics(adminId) {
    try {
      const [
        totalDashboards,
        dashboardsByStatus,
        totalItems,
        totalFiles,
        totalPublications,
      ] = await Promise.all([
        Dashboard.count(),
        Dashboard.findAll({
          include: [{ model: Status, as: "status", attributes: ["code"] }],
          attributes: ["status_id"],
          group: ["status_id"],
        }),
        DashboardItem.count(),
        File.count(),
        Publication.count(),
      ]);

      // Compter par statut
      const statusCounts = {};
      dashboardsByStatus.forEach((item) => {
        const statusCode = item.status.code;
        statusCounts[statusCode] = (statusCounts[statusCode] || 0) + 1;
      });

      return {
        success: true,
        data: {
          dashboards: {
            total: totalDashboards,
            by_status: statusCounts,
          },
          items: totalItems,
          files: totalFiles,
          publications: totalPublications,
          generated_at: new Date(),
        },
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Force la modification du statut d'un dashboard (accès administrateur)
   */
  async forceStatusChange(dashboardId, adminId, newStatusCode, reason) {
    const transaction = await sequelize.transaction();

    try {
      const dashboard = await Dashboard.findOne({
        where: { id: dashboardId },
        include: [{ model: Status, as: "status" }],
      });

      if (!dashboard) {
        throw new Error("Dashboard non trouvé");
      }

      const newStatus = await Status.findOne({
        where: { code: newStatusCode },
      });

      if (!newStatus) {
        throw new Error(`Statut ${newStatusCode} non trouvé`);
      }

      const oldStatus = dashboard.status.code;

      // Mettre à jour le statut
      await dashboard.update(
        {
          status_id: newStatus.id,
        },
        { transaction }
      );

      // Enregistrer l'action administrative
      await Validation.create(
        {
          dashboard_id: dashboardId,
          validator_id: adminId,
          action: "ADMIN_STATUS_CHANGE",
          comments: `Changement forcé de ${oldStatus} vers ${newStatusCode}. Raison: ${reason}`,
        },
        { transaction }
      );

      await transaction.commit();

      return {
        success: true,
        data: {
          id: dashboard.id,
          old_status: oldStatus,
          new_status: newStatusCode,
          changed_by: adminId,
          reason: reason,
          changed_at: new Date(),
        },
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Supprime définitivement un dashboard (accès administrateur)
   */
  async permanentlyDeleteDashboard(dashboardId, adminId, reason) {
    const transaction = await sequelize.transaction();

    try {
      const dashboard = await Dashboard.findOne({
        where: { id: dashboardId },
        include: [
          { model: Status, as: "status" },
          { model: Publication, as: "publication" },
        ],
      });

      if (!dashboard) {
        throw new Error("Dashboard non trouvé");
      }

      // Supprimer la publication si elle existe
      if (dashboard.publication) {
        await dashboard.publication.destroy({ transaction });
      }

      // Supprimer définitivement le dashboard et ses éléments
      await DashboardItem.destroy({
        where: { dashboard_id: dashboardId },
        force: true,
        transaction,
      });

      await Dashboard.destroy({
        where: { id: dashboardId },
        force: true,
        transaction,
      });

      // Enregistrer l'action administrative
      await Validation.create(
        {
          dashboard_id: dashboardId,
          validator_id: adminId,
          action: "ADMIN_DELETE",
          comments: `Suppression définitive. Raison: ${error}`,
        },
        { transaction }
      );

      await transaction.commit();

      return {
        success: true,
        data: {
          id: dashboardId,
          deleted_by: adminId,
          reason: reason,
          deleted_at: new Date(),
          message: "Dashboard supprimé définitivement",
        },
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}

module.exports = new DashboardService();
