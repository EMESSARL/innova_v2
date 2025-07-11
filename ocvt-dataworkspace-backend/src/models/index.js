const sequelize = require("../config/db");
const FinalResults = require("./FinalResults");
const NonFinalSources = require("./NonFinalSources");
const ProcessingStates = require("./ProcessingStates");
const Submissions = require("./submissions");
const SourceTypes = require("./sourceTypes");
const SupportedFileExtensions = require("./supportedFileExtensions");
const SupportedDatabaseTypes = require("./supportedDatabaseTypes");
const SupportedCharts = require("./supportedCharts");

(async () => {
  await sequelize.sync({ alter: true, logging: false });
  // console.log("Modèles synchronisés avec la base de données");
})();

// async function initializeSourceTypes() {
//   const transaction = await sequelize.transaction();
//   try {
//     await SourceTypes.destroy({ truncate: true, transaction });
//     await sequelize.query(
//       `SELECT setval(pg_get_serial_sequence('"SourceTypes"', 'source_type_id'), 1, false)`,
//       { transaction }
//     );
//     await SourceTypes.bulkCreate(
//       [
//         { type_name: "file", status: "active" },
//         { type_name: "database", status: "active" },
//         { type_name: "api", status: "inactive" },
//       ],
//       { transaction }
//     );
//     await transaction.commit();
//     console.log("Types de sources initiales insérées.");
//   } catch (error) {
//     await transaction.rollback();
//     console.error("Erreur lors de l'initialisation :", error);
//   }
// }

async function initializeSourceTypes() {
  const transaction = await sequelize.transaction();
  try {
    // Vider la table
    await SourceTypes.destroy({ truncate: true, transaction });

    // Vérifier si la séquence existe
    const [sequenceResult] = await sequelize.query(
      `SELECT pg_get_serial_sequence('"SourceTypes"', 'source_type_id')`,
      { transaction }
    );
    const sequenceName = sequenceResult[0].pg_get_serial_sequence;

    if (sequenceName) {
      // Réinitialiser la séquence si elle existe
      await sequelize.query(
        `SELECT setval($1, 1, false)`,
        { bind: [sequenceName], transaction }
      );
    } else {
      console.warn('Aucune séquence trouvée pour source_type_id. La table est peut-être mal configurée.');
      // Optionnel : Créer une séquence si nécessaire (voir ci-dessous)
    }

    // Insérer les nouvelles données
    await SourceTypes.bulkCreate(
      [
        { type_name: "file", status: "active" },
        { type_name: "database", status: "active" },
        { type_name: "api", status: "inactive" },
      ],
      { transaction }
    );

    await transaction.commit();
    console.log("Types de sources initiales insérées.");
  } catch (error) {
    await transaction.rollback();
    console.error("Erreur lors de l'initialisation :", error.name, error.message, error.stack);
  }
}

async function initializeExtensions() {
  const transaction = await sequelize.transaction();
  try {
    await SupportedFileExtensions.destroy({ truncate: true, transaction });
    await sequelize.query(
      `SELECT setval(pg_get_serial_sequence('"SupportedFileExtensions"', 'file_id'), 1, false)`,
      { transaction }
    );
    await SupportedFileExtensions.bulkCreate(
      [
        { file_extension: "csv", status: "active" },
        { file_extension: "xls", status: "active" },
        { file_extension: "xlsx", status: "active" },
        { file_extension: "pdf", status: "active" },
        { file_extension: "shp", status: "inactive" },
        { file_extension: "zip", status: "inactive" },
        { file_extension: "json", status: "active" },
        { file_extension: "geojson", status: "active" },
        { file_extension: "xml", status: "active" },
      ],
      { transaction }
    );
    await transaction.commit();
    console.log("Extensions initiales insérées.");
  } catch (error) {
    await transaction.rollback();
    console.error("Erreur lors de l'initialisation :", error);
  }
}

async function initializeDatabaseTypes() {
  const transaction = await sequelize.transaction();
  try {
    await SupportedDatabaseTypes.destroy({ truncate: true, transaction });
    await sequelize.query(
      `SELECT setval(pg_get_serial_sequence('"SupportedDatabaseTypes"', 'db_type_id'), 1, false)`,
      { transaction }
    );
    await SupportedDatabaseTypes.bulkCreate(
      [
        { db_type: "mysql", status: "active" },
        { db_type: "postgres", status: "active" },
        { db_type: "sqlite", status: "inactive" },
        { db_type: "mariadb", status: "inactive" },
        { db_type: "mongodb", status: "inactive" },
        { db_type: "firebase", status: "inactive" },
        { db_type: "google_sheets", status: "inactive" },
      ],
      { transaction }
    );
    await transaction.commit();
    console.log("Types de bases de données initiales insérées.");
  } catch (error) {
    await transaction.rollback();
    console.error("Erreur lors de l'initialisation :", error);
  }
}

async function initializeCharts() {
  const transaction = await sequelize.transaction();
  try {
    await SupportedCharts.destroy({ truncate: true, transaction });
    await sequelize.query(
      `SELECT setval(pg_get_serial_sequence('"SupportedCharts"', 'chart_id'), 1, false)`,
      { transaction }
    );
    await SupportedCharts.bulkCreate(
      [
        {
          chart_name: "bar",
          required_parameters: ["x_field", "y_field", "group_by"],
          status: "active",
        },
        {
          chart_name: "line",
          required_parameters: ["x_field", "y_field", "group_by"],
          status: "active",
        },
        {
          chart_name: "pie",
          required_parameters: ["category_field", "value_field"],
          status: "active",
        },
        {
          chart_name: "scatter",
          required_parameters: ["x_field", "y_field", "color_field"],
          status: "active",
        },
        {
          chart_name: "histogram",
          required_parameters: ["value_field", "bins"],
          status: "active",
        },
        {
          chart_name: "box",
          required_parameters: ["value_field", "group_by"],
          status: "active",
        },
        {
          chart_name: "area",
          required_parameters: ["x_field", "y_field", "group_by"],
          status: "active",
        },
        {
          chart_name: "heatmap",
          required_parameters: ["x_field", "y_field", "value_field"],
          status: "active",
        },
        {
          chart_name: "bubble",
          required_parameters: [
            "x_field",
            "y_field",
            "size_field",
            "color_field",
          ],
          status: "active",
        },
        {
          chart_name: "donut",
          required_parameters: ["category_field", "value_field", "innerRadius"],
          status: "active",
        },
      ],
      { transaction }
    );
    await transaction.commit();
    console.log("Types de graphiques initiaux insérés.");
  } catch (error) {
    await transaction.rollback();
    console.error("Erreur lors de l'initialisation des graphiques :", error);
  }
}

(async () => {
  await initializeSourceTypes();
  await initializeExtensions();
  await initializeDatabaseTypes();
  await initializeCharts();
})();

// Exporter les modèles et Sequelize
module.exports = {
  sequelize,
  FinalResults,
  NonFinalSources,
  ProcessingStates,
  Submissions,
  SourceTypes,
  SupportedFileExtensions,
  SupportedDatabaseTypes,
  SupportedCharts,
};
