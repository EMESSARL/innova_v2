const { ItemType, Status, sequelize } = require("../models");

class AdminService {
  // ========================================
  // GESTION DES TYPES D'ITEMS
  // ========================================

  /**
   * Crée un nouveau type d'item
   */
  async createItemType(adminId, itemTypeData) {
    try {
      const itemType = await ItemType.create({
        name: itemTypeData.name,
        description: itemTypeData.description,
        default_config: itemTypeData.default_config || null,
      });

      return {
        success: true,
        data: {
          id: itemType.id,
          name: itemType.name,
          description: itemType.description,
          default_config: itemType.default_config,
          created_at: itemType.created_at,
          message: "Type d'item créé avec succès",
        },
      };
    } catch (error) {
      if (error.name === "SequelizeUniqueConstraintError") {
        throw new Error("Un type d'item avec ce nom existe déjà");
      }
      throw error;
    }
  }

  /**
   * Met à jour un type d'item existant
   */
  async updateItemType(itemTypeId, adminId, updateData) {
    try {
      const itemType = await ItemType.findByPk(itemTypeId);

      if (!itemType) {
        throw new Error("Type d'item non trouvé");
      }

      await itemType.update({
        name: updateData.name || itemType.name,
        description:
          updateData.description !== undefined
            ? updateData.description
            : itemType.description,
        default_config:
          updateData.default_config !== undefined
            ? updateData.default_config
            : itemType.default_config,
      });

      return {
        success: true,
        data: {
          id: itemType.id,
          name: itemType.name,
          description: itemType.description,
          default_config: itemType.default_config,
          updated_at: itemType.updated_at,
          message: "Type d'item mis à jour avec succès",
        },
      };
    } catch (error) {
      if (error.name === "SequelizeUniqueConstraintError") {
        throw new Error("Un type d'item avec ce nom existe déjà");
      }
      throw error;
    }
  }

  /**
   * Supprime un type d'item
   */
  async deleteItemType(itemTypeId, adminId) {
    try {
      const itemType = await ItemType.findByPk(itemTypeId);

      if (!itemType) {
        throw new Error("Type d'item non trouvé");
      }

      // Vérifier s'il y a des dashboards qui utilisent ce type
      const usageCount = await itemType.countDashboardItems();

      if (usageCount > 0) {
        throw new Error(
          `Ce type d'item est utilisé par ${usageCount} élément(s) de dashboard et ne peut pas être supprimé`
        );
      }

      await itemType.destroy();

      return {
        success: true,
        data: {
          id: itemTypeId,
          deleted_at: new Date(),
          message: "Type d'item supprimé avec succès",
        },
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Récupère tous les types d'items
   */
  async getAllItemTypes(adminId) {
    try {
      const itemTypes = await ItemType.findAll({
        order: [["name", "ASC"]],
      });

      return {
        success: true,
        data: itemTypes.map((itemType) => ({
          id: itemType.id,
          name: itemType.name,
          description: itemType.description,
          default_config: itemType.default_config,
          created_at: itemType.created_at,
          updated_at: itemType.updated_at,
        })),
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Récupère un type d'item spécifique
   */
  async getItemTypeById(itemTypeId, adminId) {
    try {
      const itemType = await ItemType.findByPk(itemTypeId);

      if (!itemType) {
        throw new Error("Type d'item non trouvé");
      }

      return {
        success: true,
        data: {
          id: itemType.id,
          name: itemType.name,
          description: itemType.description,
          default_config: itemType.default_config,
          created_at: itemType.created_at,
          updated_at: itemType.updated_at,
        },
      };
    } catch (error) {
      throw error;
    }
  }

  // ========================================
  // GESTION DES STATUTS
  // ========================================

  /**
   * Crée un nouveau statut
   */
  async createStatus(adminId, statusData) {
    try {
      const status = await Status.create({
        code: statusData.code,
        label: statusData.label,
        description: statusData.description,
        transitions: statusData.transitions || [],
        editable:
          statusData.editable !== undefined ? statusData.editable : true,
      });

      return {
        success: true,
        data: {
          id: status.id,
          code: status.code,
          label: status.label,
          description: status.description,
          transitions: status.transitions,
          editable: status.editable,
          created_at: status.created_at,
          message: "Statut créé avec succès",
        },
      };
    } catch (error) {
      if (error.name === "SequelizeUniqueConstraintError") {
        throw new Error("Un statut avec ce code existe déjà");
      }
      throw error;
    }
  }

  /**
   * Met à jour un statut existant
   */
  async updateStatus(statusId, adminId, updateData) {
    try {
      const status = await Status.findByPk(statusId);

      if (!status) {
        throw new Error("Statut non trouvé");
      }

      await status.update({
        code: updateData.code || status.code,
        label: updateData.label || status.label,
        description:
          updateData.description !== undefined
            ? updateData.description
            : status.description,
        transitions:
          updateData.transitions !== undefined
            ? updateData.transitions
            : status.transitions,
        editable:
          updateData.editable !== undefined
            ? updateData.editable
            : status.editable,
      });

      return {
        success: true,
        data: {
          id: status.id,
          code: status.code,
          label: status.label,
          description: status.description,
          transitions: status.transitions,
          editable: status.editable,
          updated_at: status.updated_at,
          message: "Statut mis à jour avec succès",
        },
      };
    } catch (error) {
      if (error.name === "SequelizeUniqueConstraintError") {
        throw new Error("Un statut avec ce code existe déjà");
      }
      throw error;
    }
  }

  /**
   * Supprime un statut
   */
  async deleteStatus(statusId, adminId) {
    try {
      const status = await Status.findByPk(statusId);

      if (!status) {
        throw new Error("Statut non trouvé");
      }

      // Vérifier s'il y a des dashboards qui utilisent ce statut
      const usageCount = await status.countDashboards();

      if (usageCount > 0) {
        throw new Error(
          `Ce statut est utilisé par ${usageCount} dashboard(s) et ne peut pas être supprimé`
        );
      }

      await status.destroy();

      return {
        success: true,
        data: {
          id: statusId,
          deleted_at: new Date(),
          message: "Statut supprimé avec succès",
        },
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Récupère tous les statuts
   */
  async getAllStatuses(adminId) {
    try {
      const statuses = await Status.findAll({
        order: [["code", "ASC"]],
      });

      return {
        success: true,
        data: statuses.map((status) => ({
          id: status.id,
          code: status.code,
          label: status.label,
          description: status.description,
          transitions: status.transitions,
          editable: status.editable,
          created_at: status.created_at,
          updated_at: status.updated_at,
        })),
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Récupère un statut spécifique
   */
  async getStatusById(statusId, adminId) {
    try {
      const status = await Status.findByPk(statusId);

      if (!status) {
        throw new Error("Statut non trouvé");
      }

      return {
        success: true,
        data: {
          id: status.id,
          code: status.code,
          label: status.label,
          description: status.description,
          transitions: status.transitions,
          editable: status.editable,
          created_at: status.created_at,
          updated_at: status.updated_at,
        },
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Met à jour les transitions d'un statut
   */
  async updateStatusTransitions(statusId, adminId, transitions) {
    try {
      const status = await Status.findByPk(statusId);

      if (!status) {
        throw new Error("Statut non trouvé");
      }

      // Vérifier que tous les statuts de transition existent
      if (transitions && transitions.length > 0) {
        const existingStatuses = await Status.findAll({
          where: { code: transitions },
        });

        if (existingStatuses.length !== transitions.length) {
          const existingCodes = existingStatuses.map((s) => s.code);
          const invalidCodes = transitions.filter(
            (code) => !existingCodes.includes(code)
          );
          throw new Error(
            `Statuts de transition invalides: ${invalidCodes.join(", ")}`
          );
        }
      }

      await status.update({
        transitions: transitions || [],
      });

      return {
        success: true,
        data: {
          id: status.id,
          code: status.code,
          transitions: status.transitions,
          updated_at: status.updated_at,
          message: "Transitions du statut mises à jour avec succès",
        },
      };
    } catch (error) {
      throw error;
    }
  }

  // ========================================
  // STATISTIQUES SYSTÈME
  // ========================================

  /**
   * Récupère les statistiques détaillées du système
   */
  async getDetailedSystemStatistics(adminId) {
    try {
      const [itemTypesCount, statusesCount, itemTypesUsage, statusesUsage] =
        await Promise.all([
          ItemType.count(),
          Status.count(),
          ItemType.findAll({
            include: [
              {
                model: require("../models").DashboardItem,
                as: "dashboardItems",
                attributes: ["id"],
              },
            ],
          }),
          Status.findAll({
            include: [
              {
                model: require("../models").Dashboard,
                as: "dashboards",
                attributes: ["id"],
              },
            ],
          }),
        ]);

      // Compter l'utilisation des types d'items
      const itemTypeUsage = itemTypesUsage.map((itemType) => ({
        id: itemType.id,
        name: itemType.name,
        usage_count: itemType.dashboardItems.length,
      }));

      // Compter l'utilisation des statuts
      const statusUsage = statusesUsage.map((status) => ({
        id: status.id,
        code: status.code,
        label: status.label,
        usage_count: status.dashboards.length,
      }));

      return {
        success: true,
        data: {
          item_types: {
            total: itemTypesCount,
            usage: itemTypeUsage,
          },
          statuses: {
            total: statusesCount,
            usage: statusUsage,
          },
          generated_at: new Date(),
        },
      };
    } catch (error) {
      throw error;
    }
  }
}

module.exports = new AdminService();
