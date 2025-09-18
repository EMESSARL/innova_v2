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
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "SupportedFileExtensions",
    timestamps: false,
    paranoid: true,
    underscored: true,
  }
);

module.exports = SupportedFileExtensions;
