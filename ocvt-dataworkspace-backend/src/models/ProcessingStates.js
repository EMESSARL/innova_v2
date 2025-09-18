const { Sequelize, DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const NonFinalSources = require("./NonFinalSources");

const ProcessingStates = sequelize.define(
  "ProcessingStates",
  {
    state_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    non_final_source_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: NonFinalSources,
        key: "non_final_source_id",
      },
    },
    parent_state_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: "ProcessingStates", // Auto-référence
        key: "state_id",
      },
    },
    version: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    is_current: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    file_path: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    file_format: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    transformation_type: {
      type: DataTypes.ENUM(
        "initial_import", // Pour les imports de DB/API
        "clean",
        "filter",
        "aggregate",
        "calculate_column",
        "merge",
        "predict",
        "anomaly_detection",
        "clustering"
      ),
      allowNull: true,
    },
    transformation_parameters: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "ProcessingStates",
    timestamps: true,
    paranoid: true,
    underscored: true,
  }
);

// Relations
NonFinalSources.hasMany(ProcessingStates, { foreignKey: "non_final_source_id" });
ProcessingStates.belongsTo(NonFinalSources, { foreignKey: "non_final_source_id" });

ProcessingStates.hasMany(ProcessingStates, {
  foreignKey: "parent_state_id",
  as: "ChildStates",
});
ProcessingStates.belongsTo(ProcessingStates, {
  foreignKey: "parent_state_id",
  as: "ParentState",
});

module.exports = ProcessingStates;