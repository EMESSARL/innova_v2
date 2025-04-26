const { Sequelize, DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const DataSources = require("./dataSources");

const Datasets = sequelize.define(
  "Datasets",
  {
    dataset_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    source_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: DataSources,
        key: "source_id",
      },
    },
    user_id: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    dataset_name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    data_format: {
      type: DataTypes.ENUM("csv", "excel", "json", "xml", "shapefile"),
      allowNull: false,
    },
    data_content: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
    },
  },
  {
    tableName: "Datasets",
  }
);

// Relations
DataSources.hasMany(Datasets, { foreignKey: "source_id" });
Datasets.belongsTo(DataSources, { foreignKey: "source_id" });

module.exports = Datasets;
