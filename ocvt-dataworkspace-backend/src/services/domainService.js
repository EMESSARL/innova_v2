const { Domain, SubDomain, sequelize } = require("../models");

class DomainService {
  /**
   * Crée un nouveau domaine
   */
  async createDomain(domainData) {
    const transaction = await sequelize.transaction();

    try {
      const domain = await Domain.create(
        {
          name: domainData.name,
        },
        { transaction }
      );

      await transaction.commit();

      return {
        success: true,
        data: {
          id: domain.id,
          name: domain.name,
          created_at: domain.created_at,
        },
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Récupère la liste de tous les domaines
   */
  async getAllDomains() {
    try {
      const domains = await Domain.findAll({
        include: [
          {
            model: SubDomain,
            as: "subDomains",
            attributes: ["id", "name"],
            order: [["name", "ASC"]],
          },
        ],
        order: [["name", "ASC"]],
      });

      return {
        success: true,
        data: domains.map((domain) => ({
          id: domain.id,
          name: domain.name,
          subdomains_count: domain.subDomains.length,
          subdomains: domain.subDomains.map((subDomain) => ({
            id: subDomain.id,
            name: subDomain.name,
          })),
          created_at: domain.created_at,
        })),
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Récupère un domaine par son ID
   */
  async getDomainById(domainId) {
    try {
      const domain = await Domain.findByPk(domainId, {
        include: [
          {
            model: SubDomain,
            as: "subDomains",
            attributes: ["id", "name"],
            order: [["name", "ASC"]],
          },
        ],
      });

      if (!domain) {
        throw new Error("Domaine non trouvé");
      }

      return {
        success: true,
        data: {
          id: domain.id,
          name: domain.name,
          subdomains: domain.subDomains.map((subDomain) => ({
            id: subDomain.id,
            name: subDomain.name,
          })),
          created_at: domain.created_at,
          updated_at: domain.updated_at,
        },
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Met à jour un domaine
   */
  async updateDomain(domainId, updateData) {
    const transaction = await sequelize.transaction();

    try {
      const domain = await Domain.findByPk(domainId);

      if (!domain) {
        throw new Error("Domaine non trouvé");
      }

      await domain.update(
        {
          name: updateData.name || domain.name,
        },
        { transaction }
      );

      await transaction.commit();

      return {
        success: true,
        data: {
          id: domain.id,
          name: domain.name,
          updated_at: domain.updated_at,
        },
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Supprime un domaine
   */
  async deleteDomain(domainId) {
    const transaction = await sequelize.transaction();

    try {
      const domain = await Domain.findByPk(domainId);

      if (!domain) {
        throw new Error("Domaine non trouvé");
      }

      await domain.destroy({ transaction });

      await transaction.commit();

      return {
        success: true,
        message: "Domaine supprimé avec succès",
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Crée un nouveau sous-domaine
   */
  async createSubDomain(subDomainData) {
    const transaction = await sequelize.transaction();

    try {
      // Vérifier que le domaine parent existe
      const domain = await Domain.findByPk(subDomainData.domain_id);
      if (!domain) {
        throw new Error("Domaine parent non trouvé");
      }

      const subDomain = await SubDomain.create(
        {
          name: subDomainData.name,
          domain_id: subDomainData.domain_id,
        },
        { transaction }
      );

      await transaction.commit();

      return {
        success: true,
        data: {
          id: subDomain.id,
          name: subDomain.name,
          domain_id: subDomain.domain_id,
          created_at: subDomain.created_at,
        },
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Récupère la liste de tous les sous-domaines
   */
  async getAllSubDomains() {
    try {
      const subDomains = await SubDomain.findAll({
        include: [
          {
            model: Domain,
            as: "domain",
            attributes: ["id", "name"],
          },
        ],
        order: [["name", "ASC"]],
      });

      return {
        success: true,
        data: subDomains.map((subDomain) => ({
          id: subDomain.id,
          name: subDomain.name,
          domain_id: subDomain.domain_id,
          domain_name: subDomain.domain.name,
          created_at: subDomain.created_at,
        })),
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Récupère la liste des sous-domaines d'un domaine spécifique
   */
  async getSubDomainsByDomain(domainId) {
    try {
      // Vérifier que le domaine existe
      const domain = await Domain.findByPk(domainId);
      if (!domain) {
        throw new Error("Domaine non trouvé");
      }

      const subDomains = await SubDomain.findAll({
        where: { domain_id: domainId },
        include: [
          {
            model: Domain,
            as: "domain",
            attributes: ["id", "name"],
          },
        ],
        order: [["name", "ASC"]],
      });

      return {
        success: true,
        data: {
          domain: {
            id: domain.id,
            name: domain.name,
          },
          subdomains: subDomains.map((subDomain) => ({
            id: subDomain.id,
            name: subDomain.name,
            domain_id: subDomain.domain_id,
            created_at: subDomain.created_at,
          })),
        },
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Récupère un sous-domaine par son ID
   */
  async getSubDomainById(subDomainId) {
    try {
      const subDomain = await SubDomain.findByPk(subDomainId, {
        include: [
          {
            model: Domain,
            as: "domain",
            attributes: ["id", "name"],
          },
        ],
      });

      if (!subDomain) {
        throw new Error("Sous-domaine non trouvé");
      }

      return {
        success: true,
        data: {
          id: subDomain.id,
          name: subDomain.name,
          domain_id: subDomain.domain_id,
          domain_name: subDomain.domain.name,
          created_at: subDomain.created_at,
          updated_at: subDomain.updated_at,
        },
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Met à jour un sous-domaine
   */
  async updateSubDomain(subDomainId, updateData) {
    const transaction = await sequelize.transaction();

    try {
      const subDomain = await SubDomain.findByPk(subDomainId);

      if (!subDomain) {
        throw new Error("Sous-domaine non trouvé");
      }

      // Si le domain_id est modifié, vérifier que le nouveau domaine existe
      if (
        updateData.domain_id &&
        updateData.domain_id !== subDomain.domain_id
      ) {
        const domain = await Domain.findByPk(updateData.domain_id);
        if (!domain) {
          throw new Error("Nouveau domaine parent non trouvé");
        }
      }

      await subDomain.update(
        {
          name: updateData.name || subDomain.name,
          domain_id: updateData.domain_id || subDomain.domain_id,
        },
        { transaction }
      );

      await transaction.commit();

      return {
        success: true,
        data: {
          id: subDomain.id,
          name: subDomain.name,
          domain_id: subDomain.domain_id,
          updated_at: subDomain.updated_at,
        },
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Supprime un sous-domaine
   */
  async deleteSubDomain(subDomainId) {
    const transaction = await sequelize.transaction();

    try {
      const subDomain = await SubDomain.findByPk(subDomainId);

      if (!subDomain) {
        throw new Error("Sous-domaine non trouvé");
      }

      await subDomain.destroy({ transaction });

      await transaction.commit();

      return {
        success: true,
        message: "Sous-domaine supprimé avec succès",
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}

module.exports = new DomainService();
