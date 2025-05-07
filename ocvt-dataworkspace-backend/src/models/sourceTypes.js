const { Sequelize, DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const SourceTypes = sequelize.define(
  "SourceTypes",
  {
    source_type_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    type_name: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    status: {
      type: DataTypes.ENUM("active", "inactive"),
      allowNull: false,
      defaultValue: "active",
    },
  },
  {
    tableName: "SourceTypes",
    createdAt: false,
    updatedAt: false,
  }
);

module.exports = SourceTypes;
