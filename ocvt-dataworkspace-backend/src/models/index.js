const sequelize = require("../config/db");
const DataSources = require("./dataSources");
const Datasets = require("./datasets");
const ProcessingSteps = require("./processingSteps");
const Results = require("./results");
const Submissions = require("./submissions");
const SourceTypes = require("./sourceTypes");

(async () => {
  await sequelize.sync({ alter: true, logging: false });
  // console.log("Modèles synchronisés avec la base de données");
})();

// Exporter les modèles et Sequelize
module.exports = {
  sequelize,
  DataSources,
  Datasets,
  ProcessingSteps,
  Results,
  Submissions,
  SourceTypes,
};
