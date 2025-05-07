const { Sequelize, DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const DataSources = sequelize.define(
  "DataSources",
  {
    source_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    user_id: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    source_type: {
      type: DataTypes.ENUM("file", "database", "api"),
      allowNull: false,
    },
    source_name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    connection_details: {
      type: DataTypes.JSON,
      allowNull: true,
    },
  },
  {
    tableName: "DataSources",
  }
);

module.exports = DataSources;
