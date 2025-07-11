const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const SupportedDatabaseTypes = sequelize.define(
  "SupportedDatabaseTypes",
  {
    db_type_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    db_type: {
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
    tableName: "SupportedDatabaseTypes",
    createdAt: false,
    updatedAt: false,
  }
);

module.exports = SupportedDatabaseTypes;
