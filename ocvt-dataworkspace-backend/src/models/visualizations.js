const { Sequelize, DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const Datasets = require("./datasets");

const Visualizations = sequelize.define(
  "Visualizations",
  {
    visualization_id: {
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
    visualization_type: {
      type: DataTypes.ENUM("chart", "map"), // Type de visualisation
      allowNull: false,
    },
    visualization_config: {
      type: DataTypes.JSON, // Configuration (JSON)
      allowNull: true,
    },
    // created_at: {
    //   type: DataTypes.DATE,
    //   allowNull: false,
    //   defaultValue: Sequelize.NOW,
    // },
  },
  {
    tableName: "Visualizations",
    updatedAt: false,
    // timestamps: false,
  }
);

// Relations
Datasets.hasMany(Visualizations, { foreignKey: "dataset_id" });
Visualizations.belongsTo(Datasets, { foreignKey: "dataset_id" });

module.exports = Visualizations;
