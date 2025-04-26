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
        "compute",
        "stats",
        "prediction",
        "anomaly",
        "clustering"
      ),
      allowNull: false,
    },
    step_description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    parameters: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    result_dataset_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: Datasets,
        key: "dataset_id",
      },
    },
  },
  {
    tableName: "ProcessingSteps",
    updatedAt: false,
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
