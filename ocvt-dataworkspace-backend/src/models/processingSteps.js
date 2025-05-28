const { Sequelize, DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const Datasets = require("./datasets");

const ProcessingSteps = sequelize.define(
  "ProcessingSteps",
  {
    step_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    dataset_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: Datasets,
        key: "dataset_id",
      },
    },
    step_type: {
      type: DataTypes.ENUM(
        "clean",
        "filter",
        "aggregate",
        "calculate_column",
        "merge",
        "predict",
        "anomaly_detection",
        "clustering"
      ), // Type de traitement
      allowNull: false,
    },
    step_description: {
      type: DataTypes.TEXT, // Description du traitement (texte)
      allowNull: true,
    },
    parameters: {
      type: DataTypes.JSON, // Paramètres du traitement (JSON)
      allowNull: true,
    },
    result_dataset_id: {
      type: DataTypes.INTEGER,
      allowNull: true, // Clé étrangère optionnelle vers un nouveau Datasets
      references: {
        model: Datasets,
        key: "dataset_id",
      },
    },
    // created_at: {
    //   type: DataTypes.DATE,
    //   allowNull: false,
    //   defaultValue: Sequelize.NOW,
    // },
  },
  {
    tableName: "ProcessingSteps",
    updatedAt: false,
    // timestamps: false,
  }
);

// Relations
Datasets.hasMany(ProcessingSteps, { foreignKey: "dataset_id" });
ProcessingSteps.belongsTo(Datasets, { foreignKey: "dataset_id" });

// Relation optionnelle avec un nouveau dataset résultant
Datasets.hasMany(ProcessingSteps, {
  foreignKey: "result_dataset_id",
  as: "ResultSteps",
});
ProcessingSteps.belongsTo(Datasets, {
  foreignKey: "result_dataset_id",
  as: "ResultDataset",
});

module.exports = ProcessingSteps;
