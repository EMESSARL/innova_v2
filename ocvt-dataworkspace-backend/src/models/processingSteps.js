const { Sequelize, DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const ProcessingStates = require("./ProcessingStates");

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
        model: ProcessingStates,
        key: "state_id",
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
        model: ProcessingStates,
        key: "state_id",
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
ProcessingStates.hasMany(ProcessingSteps, { foreignKey: "dataset_id" });
ProcessingSteps.belongsTo(ProcessingStates, { foreignKey: "dataset_id" });

// Relation optionnelle avec un nouvel état résultant
ProcessingStates.hasMany(ProcessingSteps, {
  foreignKey: "result_dataset_id",
  as: "ResultSteps",
});
ProcessingSteps.belongsTo(ProcessingStates, {
  foreignKey: "result_dataset_id",
  as: "ResultState",
});

module.exports = ProcessingSteps;
