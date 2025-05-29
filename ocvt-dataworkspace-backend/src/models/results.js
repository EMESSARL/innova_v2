const { Sequelize, DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const Datasets = require("./datasets");

const Results = sequelize.define(
  "Results",
  {
    result_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    user_id: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    // dataset_id: {
    //   type: DataTypes.INTEGER,
    //   allowNull: false,
    //   references: {
    //     model: Datasets,
    //     key: "dataset_id",
    //   },
    // },
    result_type: {
      type: DataTypes.ENUM("image", "report", "json", "geojson", "shapefile"),
      allowNull: false,
    },
    file_path: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    format: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
    },
  },
  {
    tableName: "Results",
    updatedAt: false,
  }
);

// Relations
// Datasets.hasMany(Results, { foreignKey: "dataset_id" });
// Results.belongsTo(Datasets, { foreignKey: "dataset_id" });

module.exports = Results;
