const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const SupportedFileExtensions = sequelize.define(
  "SupportedFileExtensions",
  {
    file_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    file_extension: {
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
    tableName: "SupportedFileExtensions",
    createdAt: false,
    updatedAt: false,
  }
);

module.exports = SupportedFileExtensions;
