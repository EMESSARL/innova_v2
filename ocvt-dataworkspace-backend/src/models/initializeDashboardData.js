const Status = require("./Status");
const ItemType = require("./ItemType");
const sequelize = require("../config/db");

async function initializeStatuses() {
  const transaction = await sequelize.transaction();
  try {
    // await Status.destroy({ truncate: true, transaction });
    await Status.destroy({ where: {}, transaction });


    await Status.bulkCreate(
      [
        {
          code: "DRAFT",
          label: "Brouillon",
          description: "Dashboard en cours de création ou modification",
          transitions: ["SUBMITTED"],
          editable: true,
        },
        {
          code: "SUBMITTED",
          label: "Soumis",
          description: "Dashboard soumis pour validation",
          transitions: ["VALIDATED", "REJECTED", "UPDATE_REQUESTED"],
          editable: false,
        },
        {
          code: "VALIDATED",
          label: "Validé",
          description: "Dashboard approuvé par le validateur",
          transitions: ["PUBLISHED"],
          editable: false,
        },
        {
          code: "REJECTED",
          label: "Rejeté",
          description: "Dashboard rejeté par le validateur",
          transitions: ["DRAFT"],
          editable: true,
        },
        {
          code: "UPDATE_REQUESTED",
          label: "Modifications demandées",
          description: "Le validateur a demandé des modifications",
          transitions: ["DRAFT"],
          editable: true,
        },
        {
          code: "PUBLISHED",
          label: "Publié",
          description: "Dashboard publié et accessible",
          transitions: ["UNPUBLISHED"],
          editable: false,
        },
        {
          code: "UNPUBLISHED",
          label: "Dépublié",
          description: "Dashboard retiré de la publication",
          transitions: ["PUBLISHED", "DRAFT"],
          editable: true,
        },
      ],
      { transaction }
    );

    await transaction.commit();
    console.log("Statuts de dashboard initialisés avec succès.");
  } catch (error) {
    await transaction.rollback();
    console.error("Erreur lors de l'initialisation des statuts :", error);
  }
}

async function initializeItemTypes() {
  const transaction = await sequelize.transaction();
  try {
    // await ItemType.destroy({ truncate: true, transaction });
    await ItemType.destroy({ where: {}, transaction });

    await ItemType.bulkCreate(
      [
        { name: "graph", default_config: { sub_type: "line" } },
        { name: "table", default_config: { columns: [], rows: [] } },
        { name: "file", default_config: {} },
      ],
      { transaction }
    );

    await transaction.commit();
    console.log("Types d'éléments de dashboard initialisés avec succès.");
  } catch (error) {
    await transaction.rollback();
    console.error(
      "Erreur lors de l'initialisation des types d'éléments :",
      error
    );
  }
}

module.exports = {
  initializeStatuses,
  initializeItemTypes,
};
